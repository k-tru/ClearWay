export type FeatureId = 'contrast' | 'links' | 'images' | 'forms' | 'buttons' | 'focus' | 'language' | 'reading';

/** Font for the readable text feature; 'site' keeps the page's font and only adds spacing. */
export type ReadingFont = 'verdana' | 'arial' | 'comic' | 'site';

export interface Settings {
  enabled: boolean;
  features: Record<FeatureId, boolean>;
  contrastLevel: 'AA' | 'AAA';
  readingFont: ReadingFont;
  /** Outline every element the extension changed. Off by default. */
  showChanges: boolean;
  /** Hostnames where the user switched the extension off. */
  disabledSites: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  // Readable text changes how every page looks, so it is opt-in.
  features: { contrast: true, links: true, images: true, forms: true, buttons: true, focus: true, language: true, reading: false },
  contrastLevel: 'AA',
  readingFont: 'verdana',
  showChanges: false,
  disabledSites: [],
};

export async function loadSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.sync.get('settings');
  const s = { ...DEFAULT_SETTINGS, ...(settings as Partial<Settings> | undefined) };
  s.features = { ...DEFAULT_SETTINGS.features, ...s.features };
  return s;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  await chrome.storage.sync.set({ settings: { ...current, ...patch } });
}

export function isActiveOn(s: Settings, host: string, feature: FeatureId): boolean {
  return s.enabled && !s.disabledSites.includes(host) && s.features[feature];
}
