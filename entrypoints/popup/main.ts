import type { StatsReply, ToContent } from '../../src/shared/messages';
import { loadSettings, saveSettings, type FeatureId } from '../../src/shared/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const enabled = $<HTMLInputElement>('enabled');
const siteEnabled = $<HTMLInputElement>('site-enabled');
const level = $<HTMLSelectElement>('level');
const showChanges = $<HTMLInputElement>('show-changes');
const key = $<HTMLInputElement>('key');
const model = $<HTMLInputElement>('model');
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
  showChanges.checked = s.showChanges;
  key.value = s.geminiApiKey;
  model.value = s.geminiModel;
  for (const box of featureBoxes) box.checked = s.features[box.dataset.feature as FeatureId];
  if (!s.geminiApiKey) ($('api') as HTMLDetailsElement).open = true;

  enabled.addEventListener('change', async () => {
    const isChecked = enabled.checked;

    // 1. Update the UI state of all other checkboxes
    siteEnabled.checked = isChecked;
    showChanges.checked = isChecked;
    for (const box of featureBoxes) {
      box.checked = isChecked;
    }

    // 2. Prepare the updated features map
    const features: Record<string, boolean> = {};
    for (const box of featureBoxes) {
      features[box.dataset.feature as FeatureId] = isChecked;
    }

    // 3. Update disabled sites list based on siteEnabled toggle
    const list = new Set((await loadSettings()).disabledSites);
    if (isChecked) {
      list.delete(host);
    } else {
      list.add(host);
    }

    // 4. Save all changes to settings storage
    await saveSettings({
      enabled: isChecked,
      showChanges: isChecked,
      features: features as Record<FeatureId, boolean>,
      disabledSites: [...list],
    });
  });
  siteEnabled.addEventListener('change', async () => {
    const list = new Set((await loadSettings()).disabledSites);
    if (siteEnabled.checked) list.delete(host);
    else list.add(host);
    await saveSettings({ disabledSites: [...list] });
  });
  level.addEventListener('change', () => saveSettings({ contrastLevel: level.value as 'AA' | 'AAA' }));
  showChanges.addEventListener('change', () => saveSettings({ showChanges: showChanges.checked }));
  for (const box of featureBoxes)
    box.addEventListener('change', async () => {
      const features = { ...(await loadSettings()).features, [box.dataset.feature as FeatureId]: box.checked };
      await saveSettings({ features });
    });
  $('save-api').addEventListener('click', async () => {
    await saveSettings({ geminiApiKey: key.value.trim(), geminiModel: model.value.trim() || 'gemini-3.5-flash-lite' });
    $('api-status').textContent = 'Saved.';
  });

  refresh();
  setInterval(refresh, 1000);
}

const LABELS: Record<FeatureId, (fixed: number) => string> = {
  contrast: (n) => `${n} fixed`,
  links: (n) => `${n} named`,
  images: (n) => `${n} described`,
  forms: (n) => `${n} labelled`,
  buttons: (n) => `${n} named`,
  focus: () => 'On',
  language: (n) => (n ? 'Set' : 'No change'),
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
