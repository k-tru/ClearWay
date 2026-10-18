import type { DescribeResult, Description, ImageContext } from '../shared/messages';
import { loadSettings } from '../shared/settings';
import { describeBatchWithGemini, VisionError } from './gemini';

const SUPPORTED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']);
const MAX_SIDE = 1024;
/** Batches in flight at once; each is one request, so free-tier limits apply per batch. */
const MAX_CONCURRENT = 2;
const BATCH_SIZE = 8;
/** How long the first image waits for others to join its batch. Small next to Gemini's response time. */
const BATCH_WINDOW_MS = 300;
/** Keeps the request well under Gemini's inline-data size limit. */
const BATCH_MAX_BYTES = 10_000_000;

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

// ---- Batching: images queued close together share one request -------------------------------

interface Job {
  url: string;
  context: ImageContext;
  image: { mimeType: string; base64: string };
  resolve: (r: DescribeResult) => void;
}

interface Account {
  id: string;
  apiKey: string;
  model: string;
}

let pending: Job[] = [];
let pendingBytes = 0;
let pendingAccount: Account | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function enqueue(job: Job, account: Account) {
  // A batch goes to one key and model, and stays under the size limit.
  if (pending.length && (pendingAccount!.id !== account.id || pendingBytes + job.image.base64.length > BATCH_MAX_BYTES)) flush();
  pending.push(job);
  pendingBytes += job.image.base64.length;
  pendingAccount = account;
  if (pending.length >= BATCH_SIZE) flush();
  else flushTimer ??= setTimeout(flush, BATCH_WINDOW_MS);
}

function flush() {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  const jobs = pending, account = pendingAccount;
  pending = [];
  pendingBytes = 0;
  if (jobs.length && account) void slot(() => sendBatch(jobs, account, true));
}

/** Turns a failed request into the result every image in it gets, starting a cooldown on a 429. */
function failure(e: unknown, account: Account): DescribeResult {
  if (e instanceof VisionError && e.code === 'rate-limited') {
    const wait = e.daily ? DAILY_COOLDOWN_MS : Math.max(e.retryAfterMs ?? 0, MINUTE_COOLDOWN_MS);
    cooldown = { until: Date.now() + wait, daily: e.daily, account: account.id };
    return { ok: false, error: e.daily ? 'quota-exhausted' : 'rate-limited', detail: e.message, retryAfterMs: wait };
  }
  return { ok: false, error: 'api-error', detail: e instanceof Error ? e.message : String(e) };
}

async function sendBatch(jobs: Job[], account: Account, retryMissing: boolean): Promise<void> {
  // Another batch may have hit the limit while this one waited for a slot.
  const waited = coolingDown(account.id);
  if (waited) return jobs.forEach((j) => j.resolve(waited));
  let results: (Description | undefined)[];
  try {
    results = await describeBatchWithGemini(jobs, account.apiKey, account.model);
  } catch (e) {
    const r = failure(e, account);
    return jobs.forEach((j) => j.resolve(r));
  }
  const missing: Job[] = [];
  for (const [i, job] of jobs.entries()) {
    const description = results[i];
    if (!description) {
      missing.push(job);
      continue;
    }
    await remember(job.url, description);
    job.resolve({ ok: true, description, cached: false });
  }
  if (!missing.length) return;
  // The model skipped or mislabelled some images: ask once more for just those, together.
  if (retryMissing && jobs.length > 1) return sendBatch(missing, account, false);
  missing.forEach((j) => j.resolve({ ok: false, error: 'api-error', detail: 'No description returned' }));
}

// ---- Entry point -----------------------------------------------------------------------------

/** Requests for an image already on its way to Gemini share that answer. */
const inProgress = new Map<string, Promise<DescribeResult>>();

export async function describeImage(url: string, context: ImageContext): Promise<DescribeResult> {
  const hit = await cached(url);
  if (hit) return { ok: true, description: hit, cached: true };
  const same = inProgress.get(url);
  if (same) return same;
  const p = describeUncached(url, context).finally(() => inProgress.delete(url));
  inProgress.set(url, p);
  return p;
}

async function describeUncached(url: string, context: ImageContext): Promise<DescribeResult> {
  const settings = await loadSettings();
  if (!settings.geminiApiKey) return { ok: false, error: 'no-key' };

  // A new key or model gets a fresh start.
  const account = { id: `${settings.geminiApiKey}|${settings.geminiModel}`, apiKey: settings.geminiApiKey, model: settings.geminiModel };
  const early = coolingDown(account.id);
  if (early) return early;

  // Downloaded now, while the batch fills, so a failed download never takes a place in it.
  let image;
  try {
    image = await loadImage(url);
  } catch (e) {
    return { ok: false, error: String(e).includes('unsupported') ? 'unsupported' : 'fetch-failed', detail: String(e) };
  }
  return new Promise((resolve) => enqueue({ url, context, image, resolve }, account));
}
