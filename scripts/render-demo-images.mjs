// Renders the demo page's images from inline SVG so they can be regenerated instead of
// hand-edited. Output: demo/images/*.png. Run with `npm run demo:images`.
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo', 'images');

const images = {
  // A hillside town at sunset: stands in for a photo.
  'harbour.png': {
    width: 800,
    height: 450,
    svg: `
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f6a45c"/><stop offset="1" stop-color="#fde7c2"/>
        </linearGradient>
      </defs>
      <rect width="800" height="450" fill="url(#sky)"/>
      <circle cx="600" cy="170" r="60" fill="#ffd27a"/>
      <path d="M0 300 L160 210 L320 280 L480 190 L640 270 L800 220 L800 450 L0 450 Z" fill="#7a5c8e"/>
      <rect y="330" width="800" height="120" fill="#2f6f8f"/>
      <g fill="#f4efe6">
        <rect x="90" y="250" width="40" height="80"/>
        <rect x="150" y="235" width="50" height="95"/>
        <rect x="220" y="260" width="36" height="70"/>
      </g>
      <path d="M380 360 L470 360 L455 380 L395 380 Z" fill="#8b4a2b"/><path d="M425 300 L425 360 L460 355 Z" fill="#fff"/>`,
  },
  // A bar chart with readable values, so a description has something to say.
  'chart.png': {
    width: 640,
    height: 400,
    svg: `
      <rect width="640" height="400" fill="#fff"/>
      <text x="320" y="36" font-family="Arial" font-size="22" text-anchor="middle" fill="#222">Subscribers by quarter (thousands)</text>
      <line x1="70" y1="340" x2="600" y2="340" stroke="#444" stroke-width="2"/>
      ${[
        ['Q1', 42],
        ['Q2', 58],
        ['Q3', 71],
        ['Q4', 96],
      ]
        .map(([q, v], i) => {
          const x = 110 + i * 125;
          const h = v * 2.8;
          return `<rect x="${x}" y="${340 - h}" width="80" height="${h}" fill="#3867d6"/>
            <text x="${x + 40}" y="${330 - h}" font-family="Arial" font-size="18" text-anchor="middle" fill="#222">${v}</text>
            <text x="${x + 40}" y="368" font-family="Arial" font-size="18" text-anchor="middle" fill="#222">${q}</text>`;
        })
        .join('')}`,
  },
  // A product shot: a mug on a plain background.
  'mug.png': {
    width: 500,
    height: 500,
    svg: `
      <rect width="500" height="500" fill="#eae6df"/>
      <ellipse cx="240" cy="400" rx="140" ry="20" fill="#d3cdc3"/>
      <path d="M340 220 a60 60 0 1 1 0 120" fill="none" stroke="#c0392b" stroke-width="22"/>
      <rect x="130" y="160" width="220" height="240" rx="18" fill="#c0392b"/>
      <ellipse cx="240" cy="160" rx="110" ry="18" fill="#a93226"/>
      <text x="240" y="300" font-family="Georgia" font-size="40" text-anchor="middle" fill="#fff">GAZETTE</text>`,
  },
  // The masthead logo, used as the only content of the home link.
  'logo.png': {
    width: 240,
    height: 64,
    svg: `
      <rect width="240" height="64" rx="8" fill="#1f2a44"/>
      <text x="120" y="42" font-family="Georgia" font-size="26" text-anchor="middle" fill="#fff">Harbour Gazette</text>`,
  },
};

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [name, { width, height, svg }] of Object.entries(images)) {
    const page = await browser.newPage({ viewport: { width, height } });
    const size = `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"`;
    await page.setContent(`<body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" ${size}>${svg}</svg></body>`);
    await page.screenshot({ path: join(outDir, name) });
    await page.close();
    console.log(`wrote demo/images/${name}`);
  }
} finally {
  await browser.close();
}
