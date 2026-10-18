import { describe, expect, it } from 'vitest';
import { BLACK, WHITE, composite, contrast, fixForeground, fromOklch, luminance, parseColor, toOklch } from '../../src/content/color';

describe('parseColor', () => {
  it('reads rgb() and rgba() in comma and space syntax', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor('rgb(1 2 3 / 50%)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });

  it('reads transparent', () => {
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});

describe('contrast', () => {
  it('matches the WCAG extremes', () => {
    expect(contrast(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrast(WHITE, WHITE)).toBe(1);
  });

  it('is symmetric', () => {
    const grey = { r: 119, g: 119, b: 119, a: 1 };
    expect(contrast(grey, WHITE)).toBeCloseTo(contrast(WHITE, grey), 10);
    // #777 on white is the classic just-under-AA grey.
    expect(contrast(grey, WHITE)).toBeCloseTo(4.48, 2);
  });
});

describe('composite', () => {
  it('blends a translucent colour over an opaque one', () => {
    const c = composite({ r: 0, g: 0, b: 0, a: 0.5 }, WHITE);
    expect(c.r).toBeCloseTo(127.5);
    expect(c.a).toBe(1);
  });
});

describe('OKLCH', () => {
  it('round-trips an in-gamut colour', () => {
    const c = { r: 200, g: 50, b: 30, a: 1 };
    const back = fromOklch(toOklch(c));
    expect(Math.abs(back.r - c.r)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.g - c.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.b - c.b)).toBeLessThanOrEqual(1);
  });
});

describe('fixForeground', () => {
  it('darkens light grey on white just enough to pass AA', () => {
    const fixed = fixForeground({ r: 170, g: 170, b: 170, a: 1 }, WHITE, 4.5);
    const ratio = contrast(fixed, WHITE);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeLessThan(4.8); // a small shift, not a jump to black
  });

  it('lightens dark text on a dark background', () => {
    const bg = { r: 30, g: 30, b: 40, a: 1 };
    const fixed = fixForeground({ r: 70, g: 70, b: 80, a: 1 }, bg, 4.5);
    expect(contrast(fixed, bg)).toBeGreaterThanOrEqual(4.5);
    expect(luminance(fixed)).toBeGreaterThan(luminance(bg));
  });

  it('keeps the hue', () => {
    const fixed = fixForeground({ r: 120, g: 160, b: 255, a: 1 }, WHITE, 4.5);
    expect(contrast(fixed, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(fixed.b).toBeGreaterThan(fixed.r);
    expect(fixed.b).toBeGreaterThan(fixed.g);
  });

  it('falls back to black or white when nothing on either side reaches the target', () => {
    // Mid grey: black gives about 5.3:1 and white about 3.9:1, so 7:1 is impossible.
    expect(fixForeground(WHITE, { r: 128, g: 128, b: 128, a: 1 }, 7)).toEqual(BLACK);
  });
});
