import type { StatsReply, ToContent } from '../../src/shared/messages';
import { loadSettings, saveSettings, type FeatureId, type ReadingFont } from '../../src/shared/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const enabled = $<HTMLInputElement>('enabled');
const siteEnabled = $<HTMLInputElement>('site-enabled');
const level = $<HTMLSelectElement>('level');
const readingFont = $<HTMLSelectElement>('reading-font');
const showChanges = $<HTMLInputElement>('show-changes');
const featureBoxes = [...document.querySelectorAll<HTMLInputElement>('input[data-feature]')];

let tabId: number | undefined;
let host = '';

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  try {
    host = tab?.url ? new URL(tab.url).hostname : '';
  } catch {}
  $('host').textContent = host || 'this site';
  if (!host) $('site-row').hidden = true;

  const s = await loadSettings();
  enabled.checked = s.enabled;
  siteEnabled.checked = !s.disabledSites.includes(host);
  level.value = s.contrastLevel;
  readingFont.value = s.readingFont;
  showChanges.checked = s.showChanges;
  for (const box of featureBoxes) box.checked = s.features[box.dataset.feature as FeatureId];

  showEnabled(s.enabled);

  enabled.addEventListener('change', async () => {
    // Only the master setting changes, so turning ClearWay back on restores every other choice.
    showEnabled(enabled.checked);
    await saveSettings({ enabled: enabled.checked });
  });
  siteEnabled.addEventListener('change', async () => {
    const list = new Set((await loadSettings()).disabledSites);
    if (siteEnabled.checked) list.delete(host);
    else list.add(host);
    await saveSettings({ disabledSites: [...list] });
  });
  level.addEventListener('change', () => saveSettings({ contrastLevel: level.value as 'AA' | 'AAA' }));
  readingFont.addEventListener('change', () => saveSettings({ readingFont: readingFont.value as ReadingFont }));
  showChanges.addEventListener('change', () => saveSettings({ showChanges: showChanges.checked }));
  for (const box of featureBoxes)
    box.addEventListener('change', async () => {
      const features = { ...(await loadSettings()).features, [box.dataset.feature as FeatureId]: box.checked };
      await saveSettings({ features });
    });

  refresh();
  setInterval(refresh, 1000);
}

/** While ClearWay is off, the other controls keep their settings but are greyed out. */
function showEnabled(on: boolean) {
  for (const control of [siteEnabled, level, readingFont, showChanges, ...featureBoxes]) control.disabled = !on;
}

const LABELS: Record<FeatureId, (fixed: number) => string> = {
  contrast: (n) => `${n} fixed`,
  links: (n) => `${n} named`,
  images: (n) => `${n} described`,
  forms: (n) => `${n} labelled`,
  buttons: (n) => `${n} named`,
  focus: () => 'On',
  language: (n) => (n ? 'Set' : 'No change'),
  reading: () => 'On',
};

const FEATURES = Object.keys(LABELS) as FeatureId[];

async function refresh() {
  if (tabId === undefined) return;
  let stats: StatsReply | undefined;
  try {
    stats = await chrome.tabs.sendMessage(tabId, { type: 'stats' } satisfies ToContent);
  } catch {
    // No content script: chrome:// pages, the Web Store, or a tab opened before install.
  }
  for (const id of FEATURES) {
    const s = stats?.[id];
    $(`count-${id}`).textContent = s ? LABELS[id](s.fixed) : '–';
    const extra = s
      ? [s.pending && `${s.pending} pending`, s.unresolved && `${s.unresolved} unresolved`, s.note].filter(Boolean).join(' · ')
      : 'Reload the page to start';
    $(`note-${id}`).textContent = extra;
  }
}

init();
