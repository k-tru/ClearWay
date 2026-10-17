/** sRGB channels 0-255, alpha 0-1. */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const RGB_RE = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;
const parseCache = new Map<string, RGBA | null>();
let probe: CanvasRenderingContext2D | null | undefined;

/** Parses a computed CSS colour. Non-rgb() forms (oklch(), color(), …) go through a 1×1 canvas. */
export function parseColor(css: string): RGBA | null {
  const hit = parseCache.get(css);
  if (hit !== undefined) return hit;
  let out: RGBA | null = null;
  const m = RGB_RE.exec(css.trim());
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    out = { r: +m[1], g: +m[2], b: +m[3], a };
  } else if (css === 'transparent') {
    out = { r: 0, g: 0, b: 0, a: 0 };
  } else if (typeof document !== 'undefined') {
    if (probe === undefined) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      probe = c.getContext('2d', { willReadFrequently: true });
    }
    if (probe) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = '#000';
      probe.fillStyle = css;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
      out = { r, g, b, a: a / 255 };
    }
  }
  parseCache.set(css, out);
  return out;
}

/** Paints `top` over an opaque-or-not `bottom`. */
export function composite(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function luminance(c: RGBA): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

/** WCAG 2.x contrast ratio, 1-21. Both colours must be opaque. */
export function contrast(a: RGBA, b: RGBA): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

interface OKLCH {
  L: number;
  C: number;
  h: number;
}

export function toOklch(c: RGBA): OKLCH {
  const r = toLinear(c.r), g = toLinear(c.g), b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), h: Math.atan2(B, A) };
}

/** Returns linear sRGB 0-1 without clamping, so callers can test the gamut. */
function oklchToRgbRaw({ L, C, h }: OKLCH): [number, number, number] {
  const A = C * Math.cos(h), B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (lin: number[]) => lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH → sRGB, lowering chroma (hue and lightness held) until the colour fits. */
export function fromOklch(c: OKLCH): RGBA {
  let lin = oklchToRgbRaw(c);
  if (!inGamut(lin)) {
    let lo = 0, hi = c.C;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToRgbRaw({ ...c, C: mid }))) lo = mid;
      else hi = mid;
    }
    lin = oklchToRgbRaw({ ...c, C: lo });
  }
  const [r, g, b] = lin.map((v) => Math.round(Math.min(255, Math.max(0, fromLinear(Math.min(1, Math.max(0, v)))))));
  return { r, g, b, a: 1 };
}

export const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };
export const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };

/**
 * Smallest lightness shift (hue kept, chroma kept where the gamut allows) that makes
 * `fg` reach `target` against opaque `bg`. Falls back to black or white when nothing
 * on the chosen side passes.
 */
export function fixForeground(fg: RGBA, bg: RGBA, target: number): RGBA {
  const goal = target + 0.02; // headroom for rounding
  const towardBlack = contrast(BLACK, bg), towardWhite = contrast(WHITE, bg);
  let dark = luminance(fg) <= luminance(bg);
  if (dark && towardBlack < goal && towardWhite > towardBlack) dark = false;
  if (!dark && towardWhite < goal && towardBlack > towardWhite) dark = true;
  const extreme = dark ? BLACK : WHITE;
  if (contrast(extreme, bg) < goal) return extreme;

  const start = toOklch(fg);
  let lo = start.L, hi = dark ? 0 : 1;
  let best = extreme;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const candidate = fromOklch({ ...start, L: mid });
    if (contrast(candidate, bg) >= goal) {
      best = candidate;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return best;
}

export const toCss = (c: RGBA) => `rgb(${c.r}, ${c.g}, ${c.b})`;
