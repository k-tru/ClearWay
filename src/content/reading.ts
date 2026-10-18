import type { FeatureStats } from '../shared/messages';
import type { ReadingFont } from '../shared/settings';
import { setFeatureCss } from './registry';
import type { Feature } from './runtime';

/**
 * Easier reading for dyslexic readers: a plain sans-serif font (fonts the British Dyslexia
 * Association recommends, already installed on Windows and macOS) and the WCAG 1.4.12
 * text spacing, which research supports more than any special font.
 */
const FONTS: Record<ReadingFont, { css: string; name: string } | null> = {
  verdana: { css: 'Verdana, Tahoma, sans-serif', name: 'Verdana' },
  arial: { css: 'Arial, Helvetica, sans-serif', name: 'Arial' },
  comic: { css: '"Comic Sans MS", "Comic Sans", "Chalkboard SE", sans-serif', name: 'Comic Sans' },
  site: null,
};

/**
 * Icon fonts draw symbols from letters (Material's "home", Font Awesome's private glyphs), and a
 * new font or letter spacing turns them into stray text. Code keeps its monospace font.
 */
const SKIP = '[class*="icon" i], [class*="fa-"], [class*="material-symbols"], [class*="glyph" i], code, pre, kbd, samp, pre *, code *';
const TEXT = `:is(body, body *):not(${SKIP})`;

export function readingCss(font: ReadingFont): string {
  const chosen = FONTS[font];
  const family = chosen ? `font-family: ${chosen.css} !important;` : '';
  return `
${TEXT} {
  ${family}
  line-height: 1.5 !important;
  letter-spacing: 0.12em !important;
  word-spacing: 0.16em !important;
}
body p { margin-block-end: 2em !important; }
`;
}

let running = false;
let font: ReadingFont = 'verdana';

export const readingFeature: Feature = {
  id: 'reading',
  start(settings) {
    running = true;
    font = settings.readingFont;
    setFeatureCss('reading', readingCss(font));
  },
  stop() {
    running = false;
    setFeatureCss('reading', '');
  },
  rescan() {},
  stats(): FeatureStats {
    const chosen = FONTS[font];
    const note = chosen ? `${chosen.name} with wider spacing` : 'Wider spacing, site font kept';
    return { fixed: 0, pending: 0, unresolved: 0, note: running ? note : undefined };
  },
};
