import { afterEach, describe, expect, it } from 'vitest';
import { altLooksUseless, imageContext, triage } from '../../src/content/alt';

afterEach(() => {
  document.body.innerHTML = '';
});

function img(html: string): HTMLImageElement {
  document.body.innerHTML = html;
  return document.querySelector('img')!;
}

describe('altLooksUseless', () => {
  it('flags file names, camera names and placeholder words', () => {
    for (const alt of ['IMG_2041.png', 'hero.jpg', 'DSC0042', 'PXL_20250101', 'image', 'Logo', 'a1b2c3d4e5f6g7h8i9j0k'])
      expect(altLooksUseless(alt), alt).toBe(true);
  });

  it('accepts real descriptions and leaves empty alt alone', () => {
    expect(altLooksUseless('A golden retriever on a beach')).toBe(false);
    expect(altLooksUseless('Photo of the team at the 2025 offsite')).toBe(false);
    expect(altLooksUseless('')).toBe(false);
  });
});

describe('triage', () => {
  it('describes images with no alt or a useless alt', () => {
    expect(triage(img('<img src="a.png" width="200" height="200">'))).toBe('describe');
    expect(triage(img('<img src="a.png" width="200" height="200" alt="IMG_2041.png">'))).toBe('describe');
  });

  it('respects empty alt, except when the image is all a link contains', () => {
    expect(triage(img('<img src="a.png" width="200" height="200" alt="">'))).toBe('skip');
    expect(triage(img('<a href="/home"><img src="a.png" width="200" height="200" alt=""></a>'))).toBe('describe');
  });

  it('skips hidden, presentational, labelled and tiny images', () => {
    expect(triage(img('<div aria-hidden="true"><img src="a.png" width="200" height="200"></div>'))).toBe('skip');
    expect(triage(img('<img src="a.png" width="200" height="200" role="presentation">'))).toBe('skip');
    expect(triage(img('<img src="a.png" width="200" height="200" aria-label="Chart">'))).toBe('skip');
    expect(triage(img('<img src="a.png" width="16" height="16">'))).toBe('skip');
  });

  it('keeps good alt text', () => {
    expect(triage(img('<img src="a.png" width="200" height="200" alt="Sales rose 20% in Q3">'))).toBe('skip');
  });
});

describe('imageContext', () => {
  it('collects the heading, caption, nearby text and link', () => {
    const el = img(`
      <h2>Quarterly results</h2>
      <figure>
        <a href="https://example.com/q3"><img src="chart.png" alt="chart.png"></a>
        <figcaption>Revenue by quarter</figcaption>
      </figure>
      <p>Revenue grew every quarter.</p>`);
    expect(imageContext(el)).toEqual({
      heading: 'Quarterly results',
      figcaption: 'Revenue by quarter',
      paragraph: 'Revenue grew every quarter.',
      linkHref: 'https://example.com/q3',
      existingAlt: 'chart.png',
    });
  });
});
