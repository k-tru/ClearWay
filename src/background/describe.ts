import type { DescribeResult, Description, ImageContext } from '../shared/messages';
import { loadSettings } from '../shared/settings';
import { describeWithGemini, VisionError } from './gemini';

const SUPPORTED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']);
const MAX_SIDE = 1024;
const MAX_CONCURRENT = 2;

// ---- Cache: same image URL is described once per browser session ---------------------------

async function cached(url: string): Promise<Description | undefined> {
  const key = 'desc:' + url;
  return (await chrome.storage.session.get(key))[key] as Description | undefined;
}

async function remember(url: string, d: Description) {
  await chrome.storage.session.set({ ['desc:' + url]: d }).catch(() => {
    /* session storage is ~10 MB; a full cache just means re-describing */
  });
}

// ---- Concurrency: free tiers have low per-minute limits --------------------------------------

let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

// ---- Cooldown: after a 429, nobody calls the API until Gemini says it is worth it ---------

const MINUTE_COOLDOWN_MS = 30_000;
const DAILY_COOLDOWN_MS = 60 * 60_000;
let cooldown = { until: 0, daily: false, account: '' };

function coolingDown(account: string): DescribeResult | null {
  if (cooldown.account !== account || Date.now() >= cooldown.until) return null;
  return { ok: false, error: cooldown.daily ? 'quota-exhausted' : 'rate-limited', retryAfterMs: cooldown.until - Date.now() };
}

// ---- Image bytes ------------------------------------------------------------------------------

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Fetches with the extension's host permissions (no canvas tainting), then shrinks to save tokens. */
async function loadImage(url: string): Promise<{ mimeType: string; base64: string }> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let blob = await res.blob();
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    // SVG and other formats createImageBitmap cannot read in a worker.
    if (!SUPPORTED.has(blob.type)) throw new Error('unsupported');
  }
  if (bitmap && (!SUPPORTED.has(blob.type) || Math.max(bitmap.width, bitmap.height) > MAX_SIDE)) {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; // transparent PNG/GIF → white, not black, for JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  }
  bitmap?.close();
  return { mimeType: blob.type, base64: toBase64(await blob.arrayBuffer()) };
}

// ---- Entry point -----------------------------------------------------------------------------

export async function describeImage(url: string, context: ImageContext): Promise<DescribeResult> {
  const hit = await cached(url);
  if (hit) return { ok: true, description: hit, cached: true };

  const settings = await loadSettings();
  if (!settings.geminiApiKey) return { ok: false, error: 'no-key' };

  // A new key or model gets a fresh start.
  const account = `${settings.geminiApiKey}|${settings.geminiModel}`;
  const early = coolingDown(account);
  if (early) return early;

  return slot(async (): Promise<DescribeResult> => {
    // Another request may have hit the limit while this one waited for a slot.
    const waited = coolingDown(account);
    if (waited) return waited;
    let image;
    try {
      image = await loadImage(url);
    } catch (e) {
      return { ok: false, error: String(e).includes('unsupported') ? 'unsupported' : 'fetch-failed', detail: String(e) };
    }
    try {
      const description = await describeWithGemini(image, context, settings.geminiApiKey, settings.geminiModel);
      await remember(url, description);
      return { ok: true, description, cached: false };
    } catch (e) {
      if (e instanceof VisionError && e.code === 'rate-limited') {
        const wait = e.daily ? DAILY_COOLDOWN_MS : Math.max(e.retryAfterMs ?? 0, MINUTE_COOLDOWN_MS);
        cooldown = { until: Date.now() + wait, daily: e.daily, account };
        return { ok: false, error: e.daily ? 'quota-exhausted' : 'rate-limited', detail: e.message, retryAfterMs: wait };
      }
      return { ok: false, error: 'api-error', detail: e instanceof Error ? e.message : String(e) };
    }
  });
}
