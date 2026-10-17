import type { FeatureStats } from '../shared/messages';
import { restoreAll, setAttr } from './registry';
import type { Feature } from './runtime';

/** BCP 47-ish: "en", "pt-BR", "zh-Hant". Anything else ("english", "") counts as missing. */
const VALID_LANG = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;
const MIN_SAMPLE = 80;
const MAX_SAMPLE = 3000;
/** Share of the sample the top language must cover before we commit to it. */
const MIN_PERCENT = 60;

export function hasValidLang(html: Element): boolean {
  const lang = html.getAttribute('lang')?.trim() ?? '';
  return VALID_LANG.test(lang) && lang.toLowerCase() !== 'und';
}

/** Visible prose from the main content, falling back to the whole body. */
export function sampleText(doc: Document): string {
  const root = doc.querySelector('main, [role="main"], article') ?? doc.body;
  const text = (root as HTMLElement | null)?.innerText ?? root?.textContent ?? '';
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_SAMPLE);
}

export interface Detection {
  isReliable: boolean;
  languages: { language: string; percentage: number }[];
}

/** Chrome's on-device detector (CLD3): free, offline, no API key. */
function detect(text: string): Promise<Detection> {
  return new Promise((resolve) => chrome.i18n.detectLanguage(text, (r) => resolve(r as Detection)));
}

/** The language to declare, or null when the detector is not sure enough. */
export function pickLanguage(d: Detection): string | null {
  const top = [...(d.languages ?? [])].sort((a, b) => b.percentage - a.percentage)[0];
  if (!d.isReliable || !top || top.language === 'und' || top.percentage < MIN_PERCENT) return null;
  return top.language;
}

function displayName(code: string): string {
  try {
    return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

let running = false;
let set: string | null = null;
let note: string | undefined;
let attempts = 0;
let retryTimer: number | undefined;

async function run() {
  if (!running) return;
  const html = document.documentElement;
  if (hasValidLang(html) && !set) {
    note = `Page already declares "${html.getAttribute('lang')}"`;
    return;
  }
  const text = sampleText(document);
  if (text.length < MIN_SAMPLE) {
    note = 'Not enough text to detect the language yet';
    // Pages that render their content late get a couple more tries.
    if (++attempts <= 3) retryTimer = window.setTimeout(run, 2000);
    return;
  }
  const lang = pickLanguage(await detect(text));
  if (!running) return;
  if (!lang) {
    note = 'Language unclear or mixed; left unset';
    return;
  }
  setAttr('language', html, 'lang', lang);
  set = lang;
  note = `Set to ${displayName(lang)} (${lang})`;
}

export const languageFeature: Feature = {
  id: 'language',
  start() {
    running = true;
    attempts = 0;
    void run();
  },
  stop() {
    running = false;
    clearTimeout(retryTimer);
    restoreAll('language');
    set = null;
    note = undefined;
  },
  rescan() {},
  stats(): FeatureStats {
    return { fixed: set ? 1 : 0, pending: 0, unresolved: 0, note };
  },
};
