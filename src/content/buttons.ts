import type { FeatureStats } from '../shared/messages';
import { iconName, isSymbolOnly } from './icons';
import { readableText } from './links';
import { fixedTotal, markFixed, restore, restoreAll, setAttr } from './registry';
import type { Feature } from './runtime';

const BUTTONS = 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"], input[type="image"]';

/** What a screen reader announces for the button today. */
export function buttonName(el: HTMLElement): string {
  const ids = el.getAttribute('aria-labelledby');
  if (ids) {
    const t = ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
    if (t) return t;
  }
  const label = el.getAttribute('aria-label')?.trim();
  if (label) return label;
  if (el instanceof HTMLInputElement) {
    if (el.type === 'image') return (el.alt || el.title).trim();
    // Browsers announce a default "Submit" / "Reset" when there is no value.
    return (el.value || (el.type === 'submit' ? 'Submit' : el.type === 'reset' ? 'Reset' : '') || el.title).trim();
  }
  const labels = (el as HTMLButtonElement).labels;
  if (labels?.length) return [...labels].map(readableText).join(' ').trim();
  return readableText(el) || (el.getAttribute('title') ?? '').trim();
}

/** Name for an unnamed (or symbol-only) button, or '' if there is nothing to go on. */
export function findButtonName(el: HTMLElement, current: string): string {
  const fromIcon = iconName(el, current);
  if (fromIcon) return fromIcon;
  // aria-controls pointing at a labelled element: "Toggle Main navigation".
  const controlled = el.getAttribute('aria-controls');
  const target = controlled ? document.getElementById(controlled) : null;
  const targetName = target?.getAttribute('aria-label')?.trim();
  if (targetName) return `Toggle ${targetName}`;
  const form = el.closest('form');
  if (form && (el.getAttribute('type') ?? 'submit') === 'submit' && el.tagName === 'BUTTON') {
    if (form.matches('[role="search"]') || form.querySelector('input[type="search"]')) return 'Search';
    return 'Submit';
  }
  return '';
}

let running = false;
const unresolved = new Set<Element>();
let timer: number | undefined;

function scanAll() {
  if (!running) return; // a rescan timer can fire after stop()
  const all = [...document.querySelectorAll<HTMLElement>(BUTTONS)].filter((b) => !b.closest('[aria-hidden="true"]') && b.checkVisibility());
  for (const b of all) {
    restore('buttons', b);
    unresolved.delete(b);
    const name = buttonName(b);
    if (name && !isSymbolOnly(name)) continue;
    const found = findButtonName(b, name);
    if (!found) {
      unresolved.add(b);
      continue;
    }
    setAttr('buttons', b, 'aria-label', found);
    markFixed('buttons', b);
  }
}

export const buttonsFeature: Feature = {
  id: 'buttons',
  start() {
    running = true;
    scanAll();
  },
  stop() {
    running = false;
    clearTimeout(timer);
    restoreAll('buttons');
    unresolved.clear();
  },
  rescan(roots) {
    if (!running || !roots.some((r) => r.matches(BUTTONS) || r.querySelector(BUTTONS))) return;
    clearTimeout(timer);
    timer = window.setTimeout(scanAll, 300);
  },
  stats(): FeatureStats {
    return { fixed: fixedTotal('buttons'), pending: 0, unresolved: [...unresolved].filter((e) => e.isConnected).length };
  },
};
