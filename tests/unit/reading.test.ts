import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { readingCss, readingFeature } from '../../src/content/reading';

const sheet = () => document.querySelector('style[data-clearway-sheet="reading"]');

afterEach(() => {
  readingFeature.stop();
  document.body.innerHTML = '';
});

describe('readingCss', () => {
  it('sets the chosen font and the WCAG 1.4.12 spacing', () => {
    const css = readingCss('verdana');
    expect(css).toContain('font-family: Verdana, Tahoma, sans-serif !important');
    expect(css).toContain('line-height: 1.5 !important');
    expect(css).toContain('letter-spacing: 0.12em !important');
    expect(css).toContain('word-spacing: 0.16em !important');
    expect(css).toContain('margin-block-end: 2em !important');
  });

  it('keeps the site font when asked', () => {
    const css = readingCss('site');
    expect(css).not.toContain('font-family');
    expect(css).toContain('letter-spacing: 0.12em !important');
  });

  it('leaves icon fonts and code alone', () => {
    document.body.innerHTML = `
      <p id="text">Text</p>
      <i id="fa" class="fa-solid fa-house"></i>
      <span id="material" class="material-icons">home</span>
      <pre><span id="code">x</span></pre>`;
    const selector = readingCss('arial').match(/^(:is.*) \{/m)![1];
    const matches = (id: string) => document.getElementById(id)!.matches(selector);
    expect(matches('text')).toBe(true);
    expect(matches('fa')).toBe(false);
    expect(matches('material')).toBe(false);
    expect(matches('code')).toBe(false);
  });
});

describe('readingFeature', () => {
  it('adds its stylesheet on start and removes it on stop', () => {
    readingFeature.start({ ...DEFAULT_SETTINGS, readingFont: 'comic' });
    expect(sheet()?.textContent).toContain('Comic Sans');
    expect(readingFeature.stats().note).toBe('Comic Sans with wider spacing');

    readingFeature.stop();
    expect(sheet()).toBeNull();
    expect(readingFeature.stats().note).toBeUndefined();
  });
});
