import type { FeatureStats } from '../shared/messages';
import type { Settings } from '../shared/settings';
import { composite, contrast, fixForeground, luminance, parseColor, toCss, WHITE, type RGBA } from './color';
import { fixedTotal, isTouched, restore, restoreAll, setAttr, setFeatureCss, setStyle } from './registry';
import { inIdleChunks, type Feature } from './runtime';

/** One solid colour, the colour stops of a gradient, or an image we cannot read. */
type Bg = RGBA | { stops: RGBA[] } | { unknown: Element };

const STOP_RE = /rgba?\([^)]*\)/g;

let level: Settings['contrastLevel'] = 'AA';
let running = false;
let cancelScan: (() => void) | null = null;
let bgMemo = new WeakMap<Element, Bg>();
const unresolved = new Set<Element>();
const haloed = new Set<Element>();
const placeholderRules = new Map<string, string>();
let placeholderSeq = 0;
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function textElements(root: Element): Element[] {
  const out = new Set<Element>();
  const visit = (r: Node) => {
    const walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.parentElement) out.add(n.parentElement);
    // TreeWalker stops at shadow boundaries; step into open shadow roots by hand.
    if (r instanceof Element || r instanceof ShadowRoot)
      for (const el of r.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot);
  };
  visit(root);
  return [...out];
}

function placeholderInputs(root: Element): HTMLElement[] {
  const list = [...root.querySelectorAll<HTMLElement>('input[placeholder], textarea[placeholder]')];
  if (root.matches('input[placeholder], textarea[placeholder]')) list.push(root as HTMLElement);
  return list;
}

function skip(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return true; // SVG text uses fill, not color
  if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION'].includes(el.tagName)) return true;
  if (el.closest('[aria-hidden="true"], button:disabled, fieldset:disabled, [aria-disabled="true"]')) return true;
  if (el.matches(':disabled')) return true;
  return !el.checkVisibility({ visibilityProperty: true });
}

function parentOf(el: Element): Element | null {
  return el.parentElement ?? ((el.getRootNode() as ShadowRoot).host || null);
}

/** Effective opaque background behind `el`, or the element whose image makes it unknowable. */
function background(el: Element | null): Bg {
  if (!el) return WHITE;
  const memo = bgMemo.get(el);
  if (memo) return memo;
  const cs = getComputedStyle(el);
  let result: Bg;
  const own = parseColor(cs.backgroundColor) ?? { r: 0, g: 0, b: 0, a: 0 };
  const below = (): Bg => background(parentOf(el));
  const solidUnder = (b: Bg): RGBA | null => ('unknown' in b ? null : 'stops' in b ? b.stops[0] : b);
  if (cs.backgroundImage !== 'none') {
    // Gradients list their stops in the computed style; images (url()) are unknowable.
    const stops = cs.backgroundImage.includes('url(') ? [] : (cs.backgroundImage.match(STOP_RE) ?? []).map(parseColor);
    const base = own.a >= 1 ? own : solidUnder(below());
    result =
      stops.length && base && stops.every(Boolean)
        ? { stops: stops.map((c) => composite(c!, composite(own, base))) }
        : { unknown: el };
  } else if (own.a >= 1) {
    result = own;
  } else {
    const b = below();
    result = 'unknown' in b || own.a === 0 ? b : 'stops' in b ? { stops: b.stops.map((s) => composite(own, s)) } : composite(own, b);
  }
  bgMemo.set(el, result);
  return result;
}

function opacity(el: Element): number {
  let o = 1;
  for (let p: Element | null = el; p; p = parentOf(p)) o *= parseFloat(getComputedStyle(p).opacity) || 1;
  return o;
}

function targetFor(cs: CSSStyleDeclaration): number {
  const size = parseFloat(cs.fontSize);
  const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
  if (level === 'AAA') return large ? 4.5 : 7;
  return large ? 3 : 4.5;
}

function evaluate(el: Element) {
  if (skip(el)) return;
  const html = el as HTMLElement;
  // Measure the page's own colour, not ours.
  if (isTouched('contrast', el)) restore('contrast', el);
  unresolved.delete(el);
  haloed.delete(el);

  const cs = getComputedStyle(html);
  const fg = parseColor(cs.color);
  if (!fg || fg.a === 0) return;
  const fill = parseColor(cs.getPropertyValue('-webkit-text-fill-color'));
  if (fill && (fill.r !== fg.r || fill.g !== fg.g || fill.b !== fg.b || fill.a !== fg.a)) return; // gradient or clipped text
  if (cs.backgroundClip === 'text' || cs.getPropertyValue('-webkit-background-clip') === 'text') return;

  const bg = background(html);
  if ('unknown' in bg) {
    // Text over an image or gradient: we cannot know the colour behind it, so add a halo
    // instead of guessing. Page-wide textures on <html>/<body> are left alone.
    // const owner = bg.unknown;
    // if (owner === document.documentElement || owner === document.body || cs.textShadow !== 'none') return;
    // const lightText = luminance(fg) > 0.4;
    // setStyle('contrast', html, 'background-color', lightText ? 'rgba(0, 0, 0, 0.9)' : 'rgb(255, 255, 255)');
    // setStyle('contrast', html, 'padding', '2px 4px');
    // setStyle('contrast', html, 'border-radius', '3px');
    // haloed.add(el);
    return;
  }

  const bgs = 'stops' in bg ? bg.stops : [bg];
  const worst = (c: RGBA) => Math.min(...bgs.map((b) => contrast(c, b)));
  const target = targetFor(cs);
  let fixed = composite({ ...fg, a: fg.a * opacity(html) }, bgs[0]);
  if (worst(fixed) >= target) return;
  // For gradients, fix against the worst stop until every stop passes.
  for (let i = 0; i < 4 && worst(fixed) < target; i++) {
    const hardest = bgs.reduce((a, b) => (contrast(fixed, a) <= contrast(fixed, b) ? a : b));
    fixed = fixForeground(fixed, hardest, target);
  }
  if (worst(fixed) < target) unresolved.add(el);
  setStyle('contrast', html, 'color', toCss(fixed));
  // Underlines and borders drawn in currentColor follow automatically.
}

function evaluatePlaceholder(input: HTMLElement) {
  if (input.matches(':disabled') || !input.checkVisibility()) return;
  const fg = parseColor(getComputedStyle(input, '::placeholder').color);
  const bg = background(input);
  if (!fg || !('r' in bg)) return;
  const effective = composite(fg, bg);
  const target = level === 'AAA' ? 7 : 4.5;
  if (contrast(effective, bg) >= target) return;
  let id = input.dataset.a11yFixerPh;
  if (!id) {
    id = String(++placeholderSeq);
    setAttr('contrast', input, 'data-a11y-fixer-ph', id);
  }
  const color = toCss(fixForeground(effective, bg, target));
  placeholderRules.set(id, `[data-a11y-fixer-ph="${id}"]::placeholder { color: ${color} !important; opacity: 1 !important; }`);
  setFeatureCss('contrast-placeholder', [...placeholderRules.values()].join('\n'));
}

function scan(roots: Element[]) {
  bgMemo = new WeakMap();
  const els = roots.flatMap(textElements);
  // Visible text first, then the rest of the page from top to bottom.
  const vh = innerHeight;
  const keyed = els.map((el) => {
    const top = el.getBoundingClientRect().top;
    return { el, key: top >= 0 && top < vh ? top - 1e6 : Math.abs(top) };
  });
  keyed.sort((a, b) => a.key - b.key);
  cancelScan?.();
  cancelScan = inIdleChunks(keyed, ({ el }) => evaluate(el));
  for (const input of roots.flatMap(placeholderInputs)) evaluatePlaceholder(input);
}

function rescanAll() {
  if (running) scan([document.documentElement]);
}

export const contrastFeature: Feature = {
  id: 'contrast',
  start(settings) {
    level = settings.contrastLevel;
    running = true;
    darkQuery.addEventListener('change', rescanAll);
    rescanAll();
  },
  stop() {
    running = false;
    cancelScan?.();
    darkQuery.removeEventListener('change', rescanAll);
    restoreAll('contrast');
    placeholderRules.clear();
    setFeatureCss('contrast-placeholder', '');
    unresolved.clear();
    haloed.clear();
  },
  rescan(roots) {
    if (!running) return;
    // <html>/<body> only arrive here for attribute changes, usually a theme switch: redo everything.
    if (roots.some((r) => r === document.documentElement || r === document.body)) return rescanAll();
    scan(roots);
  },
  stats(): FeatureStats {
    const fixed = fixedTotal('contrast');
    return {
      fixed,
      pending: 0,
      unresolved: unresolved.size,
      note: haloed.size ? `${haloed.size} over images got a halo` : undefined,
    };
  },
};

