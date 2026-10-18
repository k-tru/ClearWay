import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { accessibleName, cleanTopic, findContext, isGeneric, linksFeature, normalise } from '../../src/content/links';

afterEach(() => {
  linksFeature.stop();
  document.body.innerHTML = '';
});

function link(html: string): HTMLAnchorElement {
  document.body.innerHTML = html;
  return document.querySelector('a')!;
}

describe('isGeneric', () => {
  it('spots vague link text, ignoring arrows and punctuation', () => {
    expect(isGeneric('Read more')).toBe(true);
    expect(isGeneric('Read more →')).toBe(true);
    expect(isGeneric('Learn more…')).toBe(true);
    expect(isGeneric('Click HERE!')).toBe(true);
    expect(isGeneric('')).toBe(true);
    expect(isGeneric('en savoir plus')).toBe(true);
  });

  it('accepts descriptive text', () => {
    expect(isGeneric('Read more about Q3 reports')).toBe(false);
    expect(isGeneric('Annual report 2025')).toBe(false);
  });

  it('normalises case, arrows and quotes', () => {
    expect(normalise('  “Read MORE” » ')).toBe('read more');
  });
});

describe('cleanTopic', () => {
  it('trims trailing punctuation', () => {
    expect(cleanTopic('  Q3 reports:  ')).toBe('Q3 reports');
  });

  it('caps long topics at ten words', () => {
    expect(cleanTopic('one two three four five six seven eight nine ten eleven twelve')).toBe('one two three four five six seven eight nine ten…');
  });
});

describe('accessibleName', () => {
  it('prefers aria-labelledby, then aria-label, then text', () => {
    document.body.innerHTML = '<span id="x">Labelled</span><a href="#" aria-labelledby="x" aria-label="Label">Text</a>';
    expect(accessibleName(document.querySelector('a')!)).toBe('Labelled');
    expect(accessibleName(link('<a href="#" aria-label="Label">Text</a>'))).toBe('Label');
    expect(accessibleName(link('<a href="#">Text <img alt="and alt"></a>'))).toBe('Text and alt');
  });
});

describe('findContext', () => {
  it('uses the heading of the card the link sits in', () => {
    const a = link('<article><h3>Q3 reports</h3><p>Summary.</p><a href="/q3">Read more</a></article>');
    expect(findContext(a, 'Read more')).toMatchObject({ topic: 'Q3 reports', confident: true });
  });

  it('uses the sentence before the link', () => {
    const a = link('<p>Download the annual report. <a href="/r">Click here</a></p>');
    expect(findContext(a, 'Click here')).toMatchObject({ topic: 'Download the annual report', confident: true });
  });

  it('uses the sentence after the link when nothing comes before', () => {
    const a = link('<p><a href="/r">Click here</a> to download the annual report.</p>');
    expect(findContext(a, 'Click here')).toMatchObject({ topic: 'download the annual report' });
  });

  it('prefers a descriptive title attribute', () => {
    const a = link('<a href="/r" title="Annual report 2025">More</a>');
    expect(findContext(a, 'More')).toMatchObject({ topic: 'Annual report 2025', confident: true });
  });

  it('gives up when there is nothing to go on', () => {
    expect(findContext(link('<a href="/r">More</a>'), 'More')).toBeNull();
  });
});

describe('linksFeature', () => {
  it('names vague links and undoes it on stop', () => {
    document.body.innerHTML = `
      <article><h3>Q3 reports</h3><a href="/q3">Read more</a></article>
      <article><h3>Hiring</h3><a href="/jobs" aria-label="Open roles">Jobs</a></article>`;
    const [vague, fine] = document.querySelectorAll('a');
    linksFeature.start(DEFAULT_SETTINGS);
    expect(vague.getAttribute('aria-label')).toBe('Read more about Q3 reports');
    expect(fine.getAttribute('aria-label')).toBe('Open roles');
    expect(linksFeature.stats().fixed).toBe(1);

    linksFeature.stop();
    expect(vague.hasAttribute('aria-label')).toBe(false);
    expect(fine.getAttribute('aria-label')).toBe('Open roles');
  });

  it('names icon-only links from their icon classes', () => {
    document.body.innerHTML = '<a href="https://example.com/social"><i class="fa-brands fa-github"></i></a>';
    linksFeature.start(DEFAULT_SETTINGS);
    expect(document.querySelector('a')!.getAttribute('aria-label')).toBe('GitHub');
  });

  it('treats the same words pointing to different places as vague', () => {
    document.body.innerHTML = `
      <article><h3>Spring sale</h3><a href="/spring">Shop now</a></article>
      <article><h3>Summer sale</h3><a href="/summer">Shop now</a></article>`;
    linksFeature.start(DEFAULT_SETTINGS);
    const labels = [...document.querySelectorAll('a')].map((a) => a.getAttribute('aria-label'));
    expect(labels).toEqual(['Shop now: Spring sale', 'Shop now: Summer sale']);
  });
});
