import { describe, expect, it } from 'vitest';
import { hasValidLang, pickLanguage, sampleText } from '../../src/content/language';

function html(lang: string | null): Element {
  const el = document.createElement('html');
  if (lang !== null) el.setAttribute('lang', lang);
  return el;
}

describe('hasValidLang', () => {
  it('accepts BCP 47 tags', () => {
    expect(hasValidLang(html('en'))).toBe(true);
    expect(hasValidLang(html('pt-BR'))).toBe(true);
    expect(hasValidLang(html('zh-Hant'))).toBe(true);
  });

  it('rejects missing, empty, made-up and undetermined values', () => {
    expect(hasValidLang(html(null))).toBe(false);
    expect(hasValidLang(html(''))).toBe(false);
    expect(hasValidLang(html('english'))).toBe(false);
    expect(hasValidLang(html('und'))).toBe(false);
  });
});

describe('pickLanguage', () => {
  it('returns the top language when the detector is sure', () => {
    const languages = [
      { language: 'fr', percentage: 20 },
      { language: 'en', percentage: 80 },
    ];
    expect(pickLanguage({ isReliable: true, languages })).toBe('en');
  });

  it('returns null when unsure, mixed or undetermined', () => {
    expect(pickLanguage({ isReliable: false, languages: [{ language: 'en', percentage: 95 }] })).toBeNull();
    const mixed = [
      { language: 'en', percentage: 50 },
      { language: 'es', percentage: 50 },
    ];
    expect(pickLanguage({ isReliable: true, languages: mixed })).toBeNull();
    expect(pickLanguage({ isReliable: true, languages: [{ language: 'und', percentage: 100 }] })).toBeNull();
    expect(pickLanguage({ isReliable: true, languages: [] })).toBeNull();
  });
});

describe('sampleText', () => {
  it('prefers the main content', () => {
    document.body.innerHTML = '<nav>Home  About</nav><main>  The   main   text. </main>';
    expect(sampleText(document)).toBe('The main text.');
  });
});
