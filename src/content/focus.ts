import type { FeatureStats } from '../shared/messages';
import { setFeatureCss } from './registry';
import type { Feature } from './runtime';

/**
 * A two-tone ring (white gap, then dark blue) stays visible on light and dark backgrounds,
 * and :focus-visible keeps it off mouse clicks, so it only appears for keyboard users.
 */
const RING_CSS = `
:focus-visible {
  outline: 3px solid #0b3fbf !important;
  outline-offset: 2px !important;
  box-shadow: 0 0 0 2px #ffffff !important;
}
`;

let running = false;

export const focusFeature: Feature = {
  id: 'focus',
  start() {
    running = true;
    setFeatureCss('focus-ring', RING_CSS);
  },
  stop() {
    running = false;
    setFeatureCss('focus-ring', '');
  },
  rescan() {},
  stats(): FeatureStats {
    return { fixed: 0, pending: 0, unresolved: 0, note: running ? 'Visible focus ring on every control' : undefined };
  },
};
