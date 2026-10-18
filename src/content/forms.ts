import type { FeatureStats } from '../shared/messages';
import { readableText } from './links';
import { fixedTotal, markFixed, restore, restoreAll, setAttr } from './registry';
import type { Feature } from './runtime';

const CONTROLS =
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea, ' +
  '[role="textbox"], [role="combobox"], [role="searchbox"], [role="spinbutton"]';

/** The name a screen reader would announce today, from the sources forms actually use. */
export function controlName(el: HTMLElement): string {
  const ids = el.getAttribute('aria-labelledby');
  if (ids) {
    const t = ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
    if (t) return t;
  }
  const label = el.getAttribute('aria-label')?.trim();
  if (label) return label;
  const labels = (el as HTMLInputElement).labels;
  if (labels?.length) {
    const t = [...labels].map((l) => readableText(l)).join(' ').trim();
    if (t) return t;
  }
  return (el.getAttribute('title') ?? el.getAttribute('placeholder') ?? '').trim();
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/[\s:*]+$/, '').replace(/^[\s*]+/, '').trim();
const usable = (s: string) => !!s && s.length <= 80 && s.split(' ').length <= 10 && /[a-z]/i.test(s);

/** Short text right next to the control, e.g. <span>Email</span><input> or <td>Email</td><td><input></td>. */
function adjacentText(el: Element, direction: 'before' | 'after'): string {
  const step = (n: Node) => (direction === 'before' ? n.previousSibling : n.nextSibling);
  let node: Element | null = el;
  for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
    for (let sib = step(node); sib; sib = step(sib)) {
      if (sib instanceof Element && sib.matches(`${CONTROLS}, button, a[href]`)) return '';
      if (sib instanceof Element && sib.querySelector(`${CONTROLS}, button`)) return '';
      const text = tidy(sib instanceof Element ? readableText(sib) : sib.textContent ?? '');
      if (text) return usable(text) ? text : '';
    }
    // Stop climbing once the parent holds other controls: their text is not ours.
    if (node.parentElement && node.parentElement.querySelectorAll(CONTROLS).length > 1) return '';
  }
  return '';
}

/** The column header (or row header) of a table cell holding the control. */
function tableHeader(el: Element): string {
  const cell = el.closest('td, th');
  const row = cell?.parentElement;
  const table = cell?.closest('table');
  if (!cell || !row || !table) return '';
  const index = [...row.children].indexOf(cell);
  const headRow = table.querySelector('thead tr') ?? (table.rows[0] !== row ? table.rows[0] : null);
  const header = headRow?.children[index];
  if (header && header !== cell) {
    const t = tidy(readableText(header));
    if (usable(t)) return t;
  }
  const first = row.children[0];
  if (first && first !== cell && !first.querySelector(CONTROLS)) {
    const t = tidy(readableText(first));
    if (usable(t)) return t;
  }
  return '';
}

const AUTOCOMPLETE: Record<string, string> = {
  name: 'Full name', 'given-name': 'First name', 'family-name': 'Last name', 'additional-name': 'Middle name',
  email: 'Email', tel: 'Phone number', 'street-address': 'Street address', 'address-line1': 'Address line 1',
  'address-line2': 'Address line 2', 'address-level2': 'City', 'address-level1': 'State or province',
  'postal-code': 'Postal code', country: 'Country', 'country-name': 'Country', organization: 'Organization',
  username: 'Username', 'current-password': 'Password', 'new-password': 'New password', 'one-time-code': 'One-time code',
  bday: 'Date of birth', 'cc-name': 'Name on card', 'cc-number': 'Card number', 'cc-exp': 'Card expiry date', 'cc-csc': 'Security code',
  url: 'Website',
};

const TYPE_NAMES: Record<string, string> = { email: 'Email', tel: 'Phone number', search: 'Search', url: 'Website', password: 'Password' };

const NOISE = new Set([
  'input', 'inp', 'field', 'fld', 'txt', 'text', 'tb', 'form', 'frm',
  'ctl', 'ctrl', 'el', 'id', 'val', 'value', 'data', 'js', 'the',
]);
const EXPAND: Record<string, string> = {
  fname: 'first name', lname: 'last name', dob: 'date of birth', zip: 'zip code', addr: 'address', tel: 'phone',
  qty: 'quantity', pwd: 'password', pw: 'password', msg: 'message', num: 'number', q: 'search',
};

/** first_name → "First name", emailAddress → "Email address"; null for ids like "field_23". */
export function humanise(raw: string | null): string {
  if (!raw) return '';
  const words = raw
    .replace(/\[\]$/, '')
    .replace(/.*[[.](\w+)\]?$/, '$1') // user[email] → email, form.email → email
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !NOISE.has(w) && !/^\d+$/.test(w))
    .map((w) => EXPAND[w] ?? w);
  const text = words.join(' ').trim();
  if (!text || !/[aeiouy]/.test(text) || !words.some((w) => w.length >= 3) || words.length > 5) return EXPAND[raw] ? cap(EXPAND[raw]) : '';
  return cap(text);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Select a country" / "-- Choose state --" → kept as the name. */
function selectPrompt(el: Element): string {
  if (!(el instanceof HTMLSelectElement)) return '';
  const first = el.options[0];
  if (!first || (first.value && !/^(|0|-1|none)$/.test(first.value))) return '';
  const t = tidy(first.text.replace(/^[-–—\s]+|[-–—\s]+$/g, ''));
  return /^(select|choose|pick|please)/i.test(t) && usable(t) ? t : '';
}

/** Best label for an unlabelled control, most trustworthy source first. */
export function findLabel(el: HTMLElement): string {
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  const choice = type === 'checkbox' || type === 'radio';
  const visible = choice ? adjacentText(el, 'after') || adjacentText(el, 'before') : adjacentText(el, 'before') || tableHeader(el);
  if (visible) return visible;
  const ac = (el.getAttribute('autocomplete') ?? '').split(/\s+/).pop() ?? '';
  if (AUTOCOMPLETE[ac]) return AUTOCOMPLETE[ac];
  // A visible "Select your neighborhood" prompt beats a developer's name="hood".
  const prompt = selectPrompt(el);
  if (prompt) return prompt;
  const fromName = humanise(el.getAttribute('name')) || humanise(el.id);
  if (fromName) return fromName;
  if (TYPE_NAMES[type]) return TYPE_NAMES[type];
  if (el.closest('form[role="search"], [role="search"]')) return 'Search';
  // A fieldset with a single control: its legend is effectively the label.
  const fs = el.closest('fieldset');
  if (fs && fs.querySelectorAll(CONTROLS).length === 1) {
    const legend = tidy(fs.querySelector('legend')?.textContent ?? '');
    if (usable(legend)) return legend;
  }
  return '';
}

let running = false;
const unresolved = new Set<Element>();
let timer: number | undefined;

function controls(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(CONTROLS)].filter((el) => !el.closest('[aria-hidden="true"]') && el.checkVisibility());
}

function scanAll() {
  if (!running) return; // a rescan timer can fire after stop()
  for (const el of controls()) {
    restore('forms', el);
    unresolved.delete(el);
    if (controlName(el)) continue;
    const label = findLabel(el);
    if (!label) {
      unresolved.add(el);
      continue;
    }
    setAttr('forms', el, 'aria-label', label);
    markFixed('forms', el);
  }
}

export const formsFeature: Feature = {
  id: 'forms',
  start() {
    running = true;
    scanAll();
  },
  stop() {
    running = false;
    clearTimeout(timer);
    restoreAll('forms');
    unresolved.clear();
  },
  rescan(roots) {
    if (!running || !roots.some((r) => r.matches(CONTROLS) || r.querySelector(CONTROLS))) return;
    clearTimeout(timer);
    timer = window.setTimeout(scanAll, 300);
  },
  stats(): FeatureStats {
    return { fixed: fixedTotal('forms'), pending: 0, unresolved: [...unresolved].filter((e) => e.isConnected).length };
  },
};
