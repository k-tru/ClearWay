import { defineContentScript } from 'wxt/utils/define-content-script';
import { imagesFeature } from '../../src/content/alt';
import { buttonsFeature } from '../../src/content/buttons';
import { contrastFeature } from '../../src/content/contrast';
import { focusFeature } from '../../src/content/focus';
import { formsFeature } from '../../src/content/forms';
import { languageFeature } from '../../src/content/language';
import { linksFeature } from '../../src/content/links';
import { setShowChanges } from '../../src/content/registry';
import { onPageChange, startObserving, type Feature } from '../../src/content/runtime';
import type { StatsReply, ToContent } from '../../src/shared/messages';
import { isActiveOn, loadSettings, type FeatureId, type Settings } from '../../src/shared/settings';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  async main() {
    const features: Feature[] = [contrastFeature, linksFeature, imagesFeature, formsFeature, buttonsFeature, focusFeature, languageFeature];
    const host = location.hostname;
    const active = new Set<FeatureId>();
    let applied: Settings | null = null;

    function apply(s: Settings) {
      for (const f of features) {
        const want = isActiveOn(s, host, f.id);
        // A new contrast level needs a fresh pass.
        const restart = want && active.has(f.id) && f.id === 'contrast' && applied?.contrastLevel !== s.contrastLevel;
        if (active.has(f.id) && (!want || restart)) {
          f.stop();
          active.delete(f.id);
        }
        if (want && !active.has(f.id)) {
          f.start(s);
          active.add(f.id);
        }
      }
      setShowChanges(s.showChanges && s.enabled);
      applied = s;
    }

    startObserving();
    onPageChange((roots) => {
      for (const f of features) if (active.has(f.id)) f.rescan(roots);
    });

    apply(await loadSettings());
    chrome.storage.onChanged.addListener(async () => apply(await loadSettings()));

    chrome.runtime.onMessage.addListener((msg: ToContent, _sender, reply) => {
      if (msg.type !== 'stats') return;
      const off = { fixed: 0, pending: 0, unresolved: 0, note: 'Off' };
      const stats = Object.fromEntries(features.map((f) => [f.id, active.has(f.id) ? f.stats() : off]));
      reply(stats as StatsReply);
    });
  },
});
