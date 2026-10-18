// Renders the extension icon from inline SVG into public/icon/<size>.png, which WXT adds to
// the manifest automatically. Edit ICON below and run `npm run icons` to change it.
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icon');
const SIZES = [16, 32, 48, 96, 128];

// A white road winding up through a blue tile: a clear way through the page.
const ICON = `
  <rect x="4" y="4" width="120" height="120" rx="28" fill="#1b4fd8"/>
  <path d="M40 108 C40 78 88 74 88 50 C88 34 74 24 64 20" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round"/>
  <path d="M40 108 C40 78 88 74 88 50 C88 34 74 24 64 20" fill="none" stroke="#1b4fd8" stroke-width="3" stroke-dasharray="8 9"/>`;

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">${ICON}</svg>`;
    await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
    await page.screenshot({ path: join(outDir, `${size}.png`), omitBackground: true });
    await page.close();
    console.log(`wrote public/icon/${size}.png`);
  }
} finally {
  await browser.close();
}
