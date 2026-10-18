# ClearWay

A Chrome extension that fixes common accessibility failures on any page, live, for the person browsing.

| Feature | What it fixes |
| --- | --- |
| **Contrast** | Text below WCAG AA (or AAA) is darkened or lightened just enough to pass, keeping its hue. Handles gradients and placeholders. |
| **Link names** | "Read more", "Click here" and icon-only links get names from their card heading or sentence, e.g. "Read more about Q3 reports". |
| **Image descriptions** | Images with no alt, or alt like `IMG_2041.png`, are described by Gemini and labelled "Auto-described". |
| **Form labels** | Unlabelled fields are named from nearby text, table headers, autofill hints or field names. |
| **Button names** | Icon-only buttons (`×`, `☰`, search icons) are named from their symbol, icon classes or form. |
| **Focus ring** | A visible keyboard focus ring, even where the site removes it. |
| **Page language** | A missing `<html lang>` is detected on-device and set, so screen readers use the right voice. |

Every change is additive and can be undone: switching a feature off restores the page exactly. Uncertain cases are left alone.

## Install

For image descriptions, get a free Gemini API key at <https://aistudio.google.com/apikey> and put it in `.env` as `WXT_GEMINI_API_KEY`. The key is built into the extension, so rebuild after changing it, and don't share a build with your key in it. Images you view are sent to Google, and on the free tier Google may use them to improve its products.

```sh
npm install
npm run build
```

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select `.output/chrome-mv3`.

The popup has a switch for each feature, per-site on/off, live counts, and **Outline what changed** to highlight every element the extension touched.

## Development

```sh
npm run dev       # Chrome with the extension loaded and hot reload
npm run demo      # demo page with deliberate bugs at http://localhost:8080/
npm test          # unit tests
npm run e2e       # axe before/after on the demo page, Gemini mocked
```

`npm run e2e` needs Playwright's Chromium once (`npx playwright install chromium`). It builds its own copy of the extension into `.output/chrome-mv3-e2e` with a placeholder key, so your normal build is left alone. On the demo page, axe (WCAG 2.1 A and AA) goes from 29 violations (contrast, link names, image alt, form labels, select names, button names, page language) to 0.

Each bug on the demo page is marked with a `BUG` comment in `demo/index.html`. Its images are rendered from SVG by `npm run demo:images`.

Code layout: `src/content/` holds one file per feature, all writing through `registry.ts` (which handles undo, counts and outlines) and one shared `MutationObserver` in `runtime.ts`. `src/background/` fetches images and calls Gemini; swap providers by replacing `describeWithGemini` in `describe.ts`.

## Limits

- Names and labels come from heuristics; anything without usable clues is left unchanged and counted as "unresolved".
- Hover and focus colours, CSS background images, `<svg>`, `<canvas>`, closed shadow roots and cross-origin iframes aren't handled.
- Some screen readers pick the voice when a page loads and may not switch after the language fix.
- With descriptions on, images are sent to Google; on the free tier Google may use them to improve its products.
