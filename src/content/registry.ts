import type { FeatureId } from '../shared/settings';

/**
 * Every DOM change the extension makes goes through here, so one place knows how to
 * undo it, how many fixes each feature made, and which elements to outline.
 */

type Key = `${FeatureId}|${'style' | 'attr'}|${string}`;

interface Record_ {
  /** Value before we touched it; null means the attribute/property was absent. */
  original: string | null;
  originalPriority: string;
  /** What we wrote, so we can tell if the page has since overwritten it. */
  applied: string | null;
}

const changes = new Map<Element, Map<Key, Record_>>();
const fixedCount: Record<FeatureId, Set<Element>> = {
  contrast: new Set(),
  links: new Set(),
  images: new Set(),
  forms: new Set(),
  buttons: new Set(),
  focus: new Set(),
  language: new Set(),
};

let suppress: (fn: () => void) => void = (fn) => fn();
/** The observer installs this so our own writes do not trigger re-scans. */
export function setMutationSuppressor(s: (fn: () => void) => void) {
  suppress = s;
}

function record(el: Element, key: Key, read: () => [string | null, string]): Record_ {
  let perEl = changes.get(el);
  if (!perEl) changes.set(el, (perEl = new Map()));
  let rec = perEl.get(key);
  const [current, priority] = read();
  if (!rec) {
    rec = { original: current, originalPriority: priority, applied: null };
    perEl.set(key, rec);
  } else if (current !== rec.applied) {
    // The page changed the value after we did; that is the new baseline.
    rec.original = current;
    rec.originalPriority = priority;
  }
  return rec;
}

function styleKey(feature: FeatureId, prop: string): Key {
  return `${feature}|style|${prop}`;
}

export function setStyle(feature: FeatureId, el: HTMLElement, prop: string, value: string) {
  const rec = record(el, styleKey(feature, prop), () => [
    el.style.getPropertyValue(prop) || null,
    el.style.getPropertyPriority(prop),
  ]);
  suppress(() => el.style.setProperty(prop, value, 'important'));
  rec.applied = el.style.getPropertyValue(prop);
  fixedCount[feature].add(el);
  markChanged(el, feature);
}

/** Pass `null` to remove the attribute. */
export function setAttr(feature: FeatureId, el: Element, name: string, value: string | null) {
  const rec = record(el, `${feature}|attr|${name}`, () => [el.getAttribute(name), '']);
  suppress(() => (value === null ? el.removeAttribute(name) : el.setAttribute(name, value)));
  rec.applied = value;
}

/** Counts an element as fixed for the popup and the "show changes" outline. */
export function markFixed(feature: FeatureId, el: Element) {
  fixedCount[feature].add(el);
  markChanged(el, feature);
}

export function isTouched(feature: FeatureId, el: Element): boolean {
  const perEl = changes.get(el);
  if (!perEl) return false;
  for (const key of perEl.keys()) if (key.startsWith(feature + '|')) return true;
  return false;
}

/** Puts one element back the way it was for one feature. */
export function restore(feature: FeatureId, el: Element) {
  const perEl = changes.get(el);
  if (!perEl) return;
  suppress(() => {
    for (const [key, rec] of perEl) {
      if (!key.startsWith(feature + '|')) continue;
      const [, kind, name] = key.split('|');
      if (kind === 'style') {
        const style = (el as HTMLElement).style;
        // Leave it if the page restyled the element after us.
        if (style.getPropertyValue(name) !== rec.applied) continue;
        if (rec.original === null) style.removeProperty(name);
        else style.setProperty(name, rec.original, rec.originalPriority);
      } else {
        if (el.getAttribute(name) !== rec.applied) continue;
        if (rec.original === null) el.removeAttribute(name);
        else el.setAttribute(name, rec.original);
      }
      perEl.delete(key);
    }
    unmarkChanged(el, feature);
  });
  if (perEl.size === 0) changes.delete(el);
  fixedCount[feature].delete(el);
}

export function restoreAll(feature: FeatureId) {
  for (const el of [...changes.keys()]) restore(feature, el);
  fixedCount[feature].clear();
}

export function fixedTotal(feature: FeatureId): number {
  let n = 0;
  for (const el of fixedCount[feature]) {
    if (el.isConnected) n++;
    else fixedCount[feature].delete(el);
  }
  return n;
}

// ---- "Show changes" outlines -------------------------------------------------------

const MARK = 'data-clearway';

function markChanged(el: Element, feature: FeatureId) {
  const set = new Set((el.getAttribute(MARK) ?? '').split(' ').filter(Boolean));
  if (set.has(feature)) return;
  set.add(feature);
  suppress(() => el.setAttribute(MARK, [...set].join(' ')));
}

function unmarkChanged(el: Element, feature: FeatureId) {
  const set = new Set((el.getAttribute(MARK) ?? '').split(' ').filter(Boolean));
  set.delete(feature);
  if (set.size) el.setAttribute(MARK, [...set].join(' '));
  else el.removeAttribute(MARK);
}

const OUTLINE_CSS = `
html[data-clearway-show] [data-clearway~="contrast"] { outline: 2px dashed #0a7d32 !important; outline-offset: 1px !important; }
html[data-clearway-show] [data-clearway~="links"] { outline: 3px solid #1b4fd8 !important; outline-offset: 2px !important; }
html[data-clearway-show] [data-clearway~="images"] { outline: 4px solid #b3261e !important; outline-offset: 2px !important; }
html[data-clearway-show] [data-clearway~="forms"] { outline: 3px solid #7c3aed !important; outline-offset: 2px !important; }
html[data-clearway-show] [data-clearway~="buttons"] { outline: 3px solid #c2410c !important; outline-offset: 2px !important; }
`;

let styleEl: HTMLStyleElement | null = null;

export function setShowChanges(on: boolean) {
  suppress(() => {
    if (on && !styleEl) {
      styleEl = document.createElement('style');
      styleEl.textContent = OUTLINE_CSS;
      (document.head ?? document.documentElement).append(styleEl);
    }
    document.documentElement.toggleAttribute('data-clearway-show', on);
  });
}

/** Injects (or replaces) a stylesheet owned by one feature, e.g. ::placeholder rules. */
const featureSheets = new Map<string, HTMLStyleElement>();
export function setFeatureCss(id: string, css: string) {
  suppress(() => {
    let el = featureSheets.get(id);
    if (!css) {
      el?.remove();
      featureSheets.delete(id);
      return;
    }
    if (!el) {
      el = document.createElement('style');
      el.dataset.clearwaySheet = id;
      (document.head ?? document.documentElement).append(el);
      featureSheets.set(id, el);
    }
    el.textContent = css;
  });
}
