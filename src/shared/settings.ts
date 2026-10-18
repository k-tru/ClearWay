export type FeatureId = 'contrast' | 'links' | 'images' | 'forms' | 'buttons' | 'focus' | 'language';

export interface Settings {
  enabled: boolean;
  features: Record<FeatureId, boolean>;
  contrastLevel: 'AA' | 'AAA';
  /** Outline every element the extension changed. Off by default. */
  showChanges: boolean;
  /** Hostnames where the user switched the extension off. */
  disabledSites: string[];
  /** Image descriptions need a vision API; empty key means images are skipped. */
  geminiApiKey: string;
  geminiModel: string;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  features: { contrast: true, links: true, images: true, forms: true, buttons: true, focus: true, language: true },
  contrastLevel: 'AA',
  showChanges: false,
  disabledSites: [],
  geminiApiKey: '',
  geminiModel: 'gemini-3.5-flash-lite',
};

// The API key stays in storage.local (never synced); everything else syncs.
const LOCAL_KEYS = ['geminiApiKey', 'geminiModel'] as const;

export async function loadSettings(): Promise<Settings> {
  const [synced, local] = await Promise.all([
    chrome.storage.sync.get('settings'),
    chrome.storage.local.get(LOCAL_KEYS as unknown as string[]),
  ]);
  const s = { ...DEFAULT_SETTINGS, ...(synced.settings as Partial<Settings> | undefined), ...local };
  s.features = { ...DEFAULT_SETTINGS.features, ...s.features };
  return s;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  const { geminiApiKey, geminiModel, ...synced } = next;
  await Promise.all([
    chrome.storage.sync.set({ settings: synced }),
    chrome.storage.local.set({ geminiApiKey, geminiModel }),
  ]);
}

export function isActiveOn(s: Settings, host: string, feature: FeatureId): boolean {
  return s.enabled && !s.disabledSites.includes(host) && s.features[feature];
}
