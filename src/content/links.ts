import type { FeatureStats } from '../shared/messages';
import { iconName, isSymbolOnly } from './icons';
import { fixedTotal, markFixed, restore, restoreAll, setAttr } from './registry';
import type { Feature } from './runtime';

// ---- Accessible name (the subset that matters for links) -----------------------------

function hidden(el: Element): boolean {
  return el.closest('[aria-hidden="true"]') !== null || (el instanceof HTMLElement && el.hidden !== false);
}

/** Text content as a screen reader would read it: image alts included, hidden parts skipped. */
export function readableText(root: Node): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) out += n.nodeValue;
    else if (n instanceof Element) {
      if (n.getAttribute('aria-hidden') === 'true' || (n instanceof HTMLElement && n.hidden !== false)) return;
      if (n.tagName === 'IMG') out += ' ' + (n.getAttribute('alt') ?? '') + ' ';
      else if (n.tagName === 'svg') out += ' ' + (n.querySelector('title')?.textContent ?? '') + ' ';
      else if (n.getAttribute('aria-label') && n !== root) out += ' ' + n.getAttribute('aria-label') + ' ';
      else n.childNodes.forEach(walk);
      if (getComputedStyle(n).display !== 'inline') out += ' ';
    }
  };
  walk(root);
  return out.replace(/\s+/g, ' ').trim();
}

export function accessibleName(a: Element): string {
  const ids = a.getAttribute('aria-labelledby');
  if (ids) {
    const text = ids
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el)
      .map(readableText)
      .join(' ')
      .trim();
    if (text) return text;
  }
  const label = a.getAttribute('aria-label')?.trim();
  if (label) return label;
  return readableText(a) || (a.getAttribute('title') ?? '').trim();
}

// ---- Detection --------------------------------------------------------------------------

const GENERIC = new Set([
  'read more', 'more', 'learn more', 'click here', 'here', 'details', 'more details', 'continue',
  'continue reading', 'view more', 'see more', 'find out more', 'more info', 'info', 'view', 'open',
  'link', 'this', 'go', 'full story', 'read the full story', 'read full article', 'read article',
  'view details', 'see details', 'show more', 'discover more', 'explore', 'download', 'click',
  // Spanish / French
  'leer más', 'más', 'haz clic aquí', 'aquí', 'ver más', 'saber más', 'leer mas', 'ver mas',
  'lire la suite', 'en savoir plus', 'cliquez ici', 'ici', 'plus', 'voir plus',
]);

/** Phrases that read naturally as "<phrase> about <topic>". */
const ABOUT = new Set(['read more', 'more', 'learn more', 'more details', 'details', 'find out more', 'more info', 'see more', 'view more', 'discover more', 'continue reading', 'show more', 'view details', 'see details']);

export function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/[←-⇿➔-➿»«›‹>…]+/g, ' ') // arrows, chevrons, ellipsis
    .replace(/[.:!?,;()[\]"'“”‘’]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isGeneric(name: string): boolean {
  const n = normalise(name);
  return n === '' || GENERIC.has(n);
}

// ---- Context extraction -------------------------------------------------------------------

const CARD = 'article, li, [class*="card" i], [class*="tile" i], [class*="teaser" i], [class*="post" i], [class*="item" i], figure, td';
const HEADING = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

interface Context {
  topic: string;
  /** Element the topic came from, used for aria-describedby when we are unsure. */
  source?: Element;
  confident: boolean;
}

export function cleanTopic(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim().replace(/[\s:;,.–—-]+$/, '');
  const words = t.split(' ');
  if (words.length > 10) t = words.slice(0, 10).join(' ') + '…';
  return t;
}

function headingIn(container: Element, link: Element): { el: Element; only: boolean } | null {
  const hs = [...container.querySelectorAll(HEADING)].filter((h) => !h.contains(link) && !hidden(h) && readableText(h));
  if (!hs.length) return null;
  if (hs.length === 1) return { el: hs[0], only: true };
  // Several headings: prefer the closest one before the link.
  const before = hs.filter((h) => h.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING);
  return { el: before.at(-1) ?? hs[0], only: false };
}

/** The sentence the link sits in, without the link's own words. */
function sentenceAround(link: Element): string {
  const block = link.parentElement?.closest('p, li, dd, td, blockquote, figcaption, div, section, article');
  if (!block) return '';
  const range = document.createRange();
  range.selectNodeContents(block);
  range.setEndBefore(link);
  const before = range.toString().replace(/\s+/g, ' ').trim();
  range.selectNodeContents(block);
  range.setStartAfter(link);
  const after = range.toString().replace(/\s+/g, ' ').trim();

  const lastSentence = before.split(/(?<=[.!?])\s+/).at(-1) ?? '';
  if (lastSentence.split(' ').length >= 2) return lastSentence;
  // "Click here to download the annual report." → "download the annual report"
  const nextSentence = (after.split(/(?<=[.!?])\s+/)[0] ?? '').replace(/^(to|for|about|on)\s+/i, '');
  return nextSentence.split(' ').length >= 2 ? nextSentence : '';
}

export function findContext(link: Element, name: string): Context | null {
  const title = link.getAttribute('title')?.trim();
  if (title && !isGeneric(title) && normalise(title) !== normalise(name)) return { topic: cleanTopic(title), confident: true };

  const card = link.closest(CARD);
  if (card) {
    const h = headingIn(card, link);
    if (h) return { topic: cleanTopic(readableText(h.el)), source: h.el, confident: h.only };
  }

  const sentence = sentenceAround(link);
  if (sentence) return { topic: cleanTopic(sentence), confident: true };

  const img = card?.querySelector('img[alt]:not([alt=""])');
  if (img && !link.contains(img)) return { topic: cleanTopic(img.getAttribute('alt')!), source: img, confident: true };

  // Last resort: the nearest heading anywhere above the link, as a description only.
  const section = link.closest('section, main, [role="main"]');
  if (section) {
    const h = headingIn(section, link);
    if (h) return { topic: cleanTopic(readableText(h.el)), source: h.el, confident: false };
  }
  return null;
}

// ---- Applying -----------------------------------------------------------------------------

const unresolved = new Set<Element>();
const described = new Set<Element>();
let running = false;
let idSeq = 0;

function linksIn(root: Element): HTMLAnchorElement[] {
  const list = [...root.querySelectorAll<HTMLAnchorElement>('a[href], [role="link"]')];
  if (root.matches('a[href], [role="link"]')) list.unshift(root as HTMLAnchorElement);
  return list.filter((a) => !hidden(a));
}

function hrefOf(a: Element): string {
  return (a as HTMLAnchorElement).href || a.getAttribute('href') || '';
}

function heal(a: Element, duplicate: boolean) {
  restore('links', a);
  unresolved.delete(a);
  described.delete(a);
  const name = accessibleName(a);
  if (!isGeneric(name) && !duplicate && !isSymbolOnly(name)) return;

  // Icon-only links (social icons, close "×"): the icon's class names say more than the card.
  const visibleText = readableText(a);
  if (!normalise(visibleText) || isSymbolOnly(visibleText)) {
    const icon = iconName(a, visibleText);
    if (icon) {
      if (a.hasAttribute('aria-labelledby')) setAttr('links', a, 'aria-labelledby', null);
      setAttr('links', a, 'aria-label', icon);
      markFixed('links', a);
      return;
    }
  }

  const ctx = findContext(a, name);
  if (!ctx || !ctx.topic || normalise(ctx.topic) === normalise(name)) {
    unresolved.add(a);
    return;
  }

  if (!ctx.confident && ctx.source) {
    // Not sure enough to rename it: point at the likely heading instead.
    let id = ctx.source.id;
    if (!id) {
      id = `clearway-ctx-${++idSeq}`;
      setAttr('links', ctx.source, 'id', id);
    }
    setAttr('links', a, 'aria-describedby', [a.getAttribute('aria-describedby'), id].filter(Boolean).join(' '));
    described.add(a);
    markFixed('links', a);
    return;
  }

  // WCAG 2.5.3: the visible words come first, so "click Read more" still works by voice.
  const visible = readableText(a);
  const visibleNorm = normalise(visible);
  const label = !visibleNorm
    ? ctx.topic
    : ABOUT.has(visibleNorm)
      ? `${visible.replace(/[\s.…→»›>]+$/, '')} about ${ctx.topic}`
      : `${visible.replace(/[\s.…→»›>]+$/, '')}: ${ctx.topic}`;
  if (a.hasAttribute('aria-labelledby')) setAttr('links', a, 'aria-labelledby', null);
  setAttr('links', a, 'aria-label', label);
  markFixed('links', a);
}

function scanAll() {
  if (!running) return; // a rescan timer can fire after stop()
  const links = linksIn(document.documentElement);
  // Same words pointing to different places are as unhelpful as "click here".
  const byName = new Map<string, Set<string>>();
  for (const a of links) {
    restore('links', a);
    const n = normalise(accessibleName(a));
    if (!byName.has(n)) byName.set(n, new Set());
    byName.get(n)!.add(hrefOf(a));
  }
  for (const a of links) heal(a, (byName.get(normalise(accessibleName(a)))?.size ?? 0) > 1);
}

let rescanTimer: number | undefined;

export const linksFeature: Feature = {
  id: 'links',
  start() {
    running = true;
    scanAll();
  },
  stop() {
    running = false;
    clearTimeout(rescanTimer);
    restoreAll('links');
    unresolved.clear();
    described.clear();
  },
  rescan(roots) {
    if (!running) return;
    // Duplicate detection needs the whole page, so batch new links into one full pass.
    if (!roots.some((r) => linksIn(r).length)) return;
    clearTimeout(rescanTimer);
    rescanTimer = window.setTimeout(scanAll, 300);
  },
  stats(): FeatureStats {
    return {
      fixed: fixedTotal('links'),
      pending: 0,
      unresolved: [...unresolved].filter((a) => a.isConnected).length,
      note: described.size ? `${described.size} given a description instead of a new name` : undefined,
    };
  },
};
