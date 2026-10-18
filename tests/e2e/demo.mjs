// End-to-end check: runs axe on the demo page without the extension, then with it, and
// fails if any WCAG A/AA violation is left. Gemini is mocked, so no key or network is needed.
//
// Builds its own copy of the extension into .output/chrome-mv3-e2e (with a placeholder key
// so the image feature runs), leaving the normal build in .output/chrome-mv3 alone.
import { AxeBuilder } from '@axe-core/playwright';
import { execSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveDemo } from '../../scripts/serve-demo.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const extensionDir = join(root, '.output', 'chrome-mv3-e2e');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const TIMEOUT_MS = 30_000;
const MOCK_ALT = 'Illustration supplied by the mocked describer';

console.log('Building the extension for e2e…');
execSync('npx wxt build --mode e2e', {
  cwd: root,
  stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, WXT_GEMINI_API_KEY: 'e2e-mock-key' },
});

const server = await serveDemo(0);
const url = `http://localhost:${server.address().port}/`;

/** Violations grouped by rule: { 'color-contrast': 12, ... } (counted per element). */
async function audit(page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return Object.fromEntries(violations.map((v) => [v.id, v.nodes.length]));
}
const total = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);

let before, after, geminiCalls = 0, described = 0;
const userDataDir = await mkdtemp(join(tmpdir(), 'clearway-e2e-'));
try {
  // Without the extension.
  const plain = await chromium.launch();
  const page0 = await (await plain.newContext()).newPage();
  await page0.goto(url);
  before = await audit(page0);
  await plain.close();

  // With the extension.
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  try {
    // The service worker calls Gemini; answer every request with a fixed description.
    await context.route('https://generativelanguage.googleapis.com/**', (route) => {
      geminiCalls++;
      const description = { kind: 'photo', alt: MOCK_ALT, confidence: 'high' };
      route.fulfill({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(description) }] } }] } });
    });
    if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker');

    const page = await context.newPage();
    await page.goto(url);
    // Scroll through so the image lookahead sees everything, then back to the top.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, 0));

    // Fixes land over a few seconds (idle-time scans, image descriptions): poll until clean.
    const deadline = Date.now() + TIMEOUT_MS;
    do {
      await page.waitForTimeout(1000);
      after = await audit(page);
    } while (total(after) > 0 && Date.now() < deadline);

    described = await page.locator('img[alt^="Auto-described: "]').count();
  } finally {
    await context.close();
  }
} finally {
  server.close();
  await rm(userDataDir, { recursive: true, force: true });
}

const rules = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
console.log(`\naxe (${TAGS.join(', ')}) on ${url}\n`);
console.log('rule'.padEnd(28) + 'before'.padStart(8) + 'after'.padStart(8));
for (const r of rules) console.log(r.padEnd(28) + String(before[r] ?? 0).padStart(8) + String(after[r] ?? 0).padStart(8));
console.log('total'.padEnd(28) + String(total(before)).padStart(8) + String(total(after)).padStart(8));
console.log(`\nImages described: ${described} (mocked Gemini calls: ${geminiCalls})`);

const problems = [];
if (total(before) === 0) problems.push('the demo page has no violations to fix');
if (total(after) > 0) problems.push(`${total(after)} violations left after ${TIMEOUT_MS / 1000}s`);
if (described === 0) problems.push('no image was auto-described');
if (problems.length) {
  console.error(`\nFAIL: ${problems.join('; ')}`);
  process.exit(1);
}
console.log('\nPASS');
