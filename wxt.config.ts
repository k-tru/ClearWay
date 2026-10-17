import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'A11y Fixer',
    description:
      'Fixes low contrast, vague links, missing alt text, unlabelled forms, empty buttons, missing page language and invisible focus on any page.',
    permissions: ['storage', 'tabs'],
    // Needed so the service worker can fetch cross-origin image bytes for descriptions.
    host_permissions: ['<all_urls>'],
  },
  // Keep the built files readable (real names, normal line breaks) so anyone can
  // inspect what the extension does. The size cost is a few kilobytes.
  vite: () => ({
    build: { minify: false },
  }),
  hooks: {
    // WXT writes manifest.json on one line; indent it so it is easy to read.
    'build:done': async (wxt) => {
      const file = join(wxt.config.outDir, 'manifest.json');
      const manifest = JSON.parse(await readFile(file, 'utf8'));
      await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
    },
  },
});
