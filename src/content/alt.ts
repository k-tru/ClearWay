import type { DescribeResult, FeatureStats, ImageContext, ToBackground } from '../shared/messages';
import { fixedTotal, isTouched, markFixed, restore, restoreAll, setAttr } from './registry';
import type { Feature } from './runtime';
import { readableText } from './links';

const PREFIX = 'Auto-described: ';
const PLACEHOLDER = 'Image, describing…';
/** Enough outstanding requests for the background to fill a batch (see BATCH_SIZE in describe.ts). */
const MAX_IN_FLIGHT = 10;
const MIN_SIZE = 48;

const FILE_NAME = /\.(png|jpe?g|gif|webp|avif|svg|bmp|tiff?|heic)$/i;
const CAMERA_NAME = /^(img|image|dsc|dscn|pxl|photo|pic|screenshot|screen shot|untitled|file)[\s_-]*\d*/i;
const GENERIC_ALT = new Set(['image', 'img', 'photo', 'picture', 'graphic', 'icon', 'logo', 'banner', 'thumbnail', 'placeholder', 'spacer']);

export function altLooksUseless(alt: string): boolean {
  const a = alt.trim().toLowerCase();
  if (!a) return false; // empty alt is a deliberate "decorative" signal, handled separately
  return FILE_NAME.test(a) || (CAMERA_NAME.test(a) && a.split(/\s+/).length <= 2) || GENERIC_ALT.has(a) || /^[\w-]{20,}$/.test(a);
}

/** True when the image is all there is inside a link or button, so it must have a name. */
function soleContentOfControl(img: HTMLImageElement): Element | null {
  const control = img.closest('a[href], button, [role="button"], [role="link"]');
  if (!control) return null;
  const others = readableText(control).replace(img.alt ?? '', '').trim();
  return others ? null : control;
}

type Triage = 'skip' | 'describe';

export function triage(img: HTMLImageElement): Triage {
  if (img.closest('[aria-hidden="true"]') || img.getAttribute('role') === 'presentation' || img.getAttribute('role') === 'none') return 'skip';
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const rect = img.getBoundingClientRect();
  if ((w && w < MIN_SIZE) || (h && h < MIN_SIZE) || (rect.width && rect.width < MIN_SIZE) || (rect.height && rect.height < MIN_SIZE)) return 'skip';
  if (img.hasAttribute('aria-label') || img.hasAttribute('aria-labelledby')) return 'skip';
  const alt = img.getAttribute('alt');
  if (alt === null) return 'describe';
  if (alt.trim() === '') return soleContentOfControl(img) ? 'describe' : 'skip';
  return altLooksUseless(alt) ? 'describe' : 'skip';
}

const HEADING = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

/** The closest heading before the image, looking outward from its own container. */
function nearestHeading(img: Element): string | undefined {
  for (let c = img.parentElement; c; c = c.parentElement) {
    const before = [...c.querySelectorAll(HEADING)].filter((h) => h.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (before.length) return readableText(before.at(-1)!).slice(0, 150);
  }
  return undefined;
}

function nearbyParagraph(img: Element): string | undefined {
  const container = img.closest('figure, article, section, li') ?? img.parentElement;
  const p = container?.querySelector('p') ?? img.closest('figure')?.nextElementSibling;
  const text = p ? readableText(p) : '';
  return text ? text.slice(0, 300) : undefined;
}

export function imageContext(img: HTMLImageElement): ImageContext {
  const alt = img.getAttribute('alt');
  return {
    heading: nearestHeading(img),
    figcaption: img.closest('figure')?.querySelector('figcaption')?.textContent?.trim().slice(0, 300) || undefined,
    paragraph: nearbyParagraph(img),
    linkHref: (img.closest('a[href]') as HTMLAnchorElement | null)?.href,
    existingAlt: alt?.trim() || undefined,
  };
}

/** blob: URLs only exist in the page, so turn them into data: URLs the worker can read. */
async function transferableUrl(img: HTMLImageElement): Promise<string> {
  const src = img.currentSrc || img.src;
  if (!src.startsWith('blob:')) return src;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.85);
}

// ---- Queue: describe images just before the reader reaches them ------------------------------

let running = false;
let apiNote: string | undefined;
const queued = new Set<HTMLImageElement>();
const inFlight = new Set<HTMLImageElement>();
const unresolved = new Set<HTMLImageElement>();
let seen = new WeakSet<HTMLImageElement>();
/** Bumped on stop so late replies from a previous run are ignored. */
let generation = 0;
/** Rate-limit retries per image; after MAX_RETRIES the image is left as it was. */
let retries = new WeakMap<HTMLImageElement, number>();
const MAX_RETRIES = 3;
const retryTimers = new Set<number>();
/** Set when the free quota is used up: stop asking until the feature restarts (e.g. a new key). */
let quotaExhausted = false;
/** Final alt per image URL, so a re-rendered copy of the same image is named instantly. */
const known = new Map<string, string>();

// Created in start(): it is not available when tests import this module.
let lookahead: IntersectionObserver;
const makeLookahead = () => new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const img = e.target as HTMLImageElement;
      lookahead.unobserve(img);
      enqueue(img);
    }
  },
  // Up to two screens ahead (and one behind, for people scrolling back up).
  { rootMargin: '200% 0px 100% 0px' },
);

function enqueue(img: HTMLImageElement) {
  if (!running || quotaExhausted || queued.has(img) || inFlight.has(img)) return;
  const alt = known.get(img.currentSrc || img.src);
  if (alt) {
    setAttr('images', img, 'alt', alt);
    markFixed('images', img);
    return;
  }
  queued.add(img);
  // Tell screen reader users something is coming instead of reading a file name.
  setAttr('images', img, 'alt', PLACEHOLDER);
  setAttr('images', img, 'aria-busy', 'true');
  pump();
}

/** Closest to the viewport goes first. */
function nextImage(): HTMLImageElement | undefined {
  let best: HTMLImageElement | undefined, bestDist = Infinity;
  for (const img of queued) {
    if (!img.isConnected) {
      queued.delete(img);
      continue;
    }
    const r = img.getBoundingClientRect();
    const dist = r.bottom < 0 ? -r.bottom + innerHeight : r.top > innerHeight ? r.top - innerHeight : -1;
    if (dist < bestDist) [best, bestDist] = [img, dist];
  }
  return best;
}

function pump() {
  while (running && inFlight.size < MAX_IN_FLIGHT) {
    const img = nextImage();
    if (!img) return;
    queued.delete(img);
    inFlight.add(img);
    void describe(img).finally(() => {
      inFlight.delete(img);
      pump();
    });
  }
}

async function describe(img: HTMLImageElement) {
  const gen = generation;
  let result: DescribeResult;
  try {
    const msg: ToBackground = { type: 'describe', url: await transferableUrl(img), context: imageContext(img) };
    result = await chrome.runtime.sendMessage(msg);
  } catch (e) {
    result = { ok: false, error: 'fetch-failed', detail: String(e) };
  }
  if (gen !== generation || !img.isConnected) return;

  if (result.ok && result.description.confidence !== 'low' && result.description.kind !== 'decorative' && result.description.alt) {
    const alt = PREFIX + result.description.alt.replace(/^(an? )?(image|photo|picture) of /i, '');
    // Written over the placeholder; the registry still remembers the author's original alt.
    setAttr('images', img, 'alt', alt);
    setAttr('images', img, 'aria-busy', null);
    known.set(img.currentSrc || img.src, alt);
    markFixed('images', img);
    unresolved.delete(img);
    apiNote = undefined;
    return;
  }
  restore('images', img); // drop the placeholder, back to the author's alt
  unresolved.add(img);
  if (result.ok) return; // low confidence or decorative: left alone on purpose
  apiNote = {
    'no-key': 'Add a Gemini API key in the popup to describe images',
    'rate-limited': 'Free-tier rate limit hit; waiting before retrying',
    'quota-exhausted': 'Free-tier quota used up; images stay as they were (try later or another key)',
    'fetch-failed': 'Could not download some images',
    unsupported: 'Some image formats are not supported',
    'api-error': `Vision API error${result.detail ? `: ${result.detail.slice(0, 80)}` : ''}`,
  }[result.error];
  if (result.error === 'quota-exhausted') {
    // No point asking again: put every waiting image back the way it was.
    quotaExhausted = true;
    for (const q of queued) {
      restore('images', q);
      unresolved.add(q);
    }
    queued.clear();
    return;
  }
  if (result.error === 'rate-limited') {
    // Per-minute limits pass: retry this image a few times, no sooner than Gemini asks.
    const n = (retries.get(img) ?? 0) + 1;
    retries.set(img, n);
    if (n > MAX_RETRIES) return;
    const wait = Math.max(result.retryAfterMs ?? 0, 10_000 * 2 ** (n - 1));
    const t = window.setTimeout(() => {
      retryTimers.delete(t);
      seen.delete(img);
      consider(img);
    }, wait);
    retryTimers.add(t);
  }
}

function consider(img: HTMLImageElement) {
  if (!running || seen.has(img) || isTouched('images', img)) return;
  if (!img.complete) {
    img.addEventListener('load', () => consider(img), { once: true });
    return;
  }
  if (img.naturalWidth === 0 || triage(img) !== 'describe') return; // broken images too
  seen.add(img);
  lookahead.observe(img);
}

function imagesIn(root: Element): HTMLImageElement[] {
  const list = [...root.querySelectorAll('img')];
  if (root instanceof HTMLImageElement) list.push(root);
  return list;
}

export const imagesFeature: Feature = {
  id: 'images',
  start() {
    running = true;
    lookahead ??= makeLookahead();
    imagesIn(document.documentElement).forEach(consider);
  },
  stop() {
    running = false;
    generation++;
    lookahead?.disconnect();
    queued.clear();
    inFlight.clear();
    unresolved.clear();
    seen = new WeakSet();
    retries = new WeakMap();
    retryTimers.forEach(clearTimeout);
    retryTimers.clear();
    quotaExhausted = false;
    known.clear();
    restoreAll('images');
    apiNote = undefined;
  },
  rescan(roots) {
    if (!running) return;
    for (const r of roots) imagesIn(r).forEach(consider);
  },
  stats(): FeatureStats {
    return {
      fixed: fixedTotal('images'),
      pending: queued.size + inFlight.size,
      unresolved: [...unresolved].filter((i) => i.isConnected).length,
      note: apiNote,
    };
  },
};
