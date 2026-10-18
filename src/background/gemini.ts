import type { Description, ImageContext } from '../shared/messages';

export class VisionError extends Error {
  constructor(
    readonly code: 'rate-limited' | 'api-error',
    message: string,
    /** From Gemini's RetryInfo, when it says how long to wait. */
    readonly retryAfterMs?: number,
    /** A daily (or zero) quota, as opposed to a per-minute burst. */
    readonly daily = false,
  ) {
    super(message);
  }
}

/** Reads `"retryDelay": "37s"` and the quota kind from a 429 body. */
export function parseRateLimit(body: string): { retryAfterMs?: number; daily: boolean; message: string } {
  let message = 'Rate limited';
  let retryAfterMs: number | undefined;
  try {
    const err = JSON.parse(body).error ?? {};
    message = err.message ?? message;
    for (const d of err.details ?? []) {
      const m = /^([\d.]+)s$/.exec(d.retryDelay ?? '');
      if (m) retryAfterMs = Math.ceil(parseFloat(m[1]) * 1000);
    }
  } catch {}
  const daily = /per ?day|limit: ?0(?!\d)/i.test(message);
  return { retryAfterMs, daily, message };
}

const SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      index: { type: 'INTEGER' },
      kind: { type: 'STRING', enum: ['photo', 'chart', 'screenshot', 'logo', 'decorative', 'other'] },
      alt: { type: 'STRING' },
      confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    },
    required: ['index', 'kind', 'alt', 'confidence'],
  },
};

const RULES = [
  'Write alt text for each of the numbered images below for a blind screen reader user browsing a web page.',
  'Return one entry per image, with "index" set to the number given before that image.',
  'Rules:',
  '- Say what the image communicates in this context, purpose first. Do not start with "image of", "picture of" or "photo of".',
  '- Photos and illustrations: one sentence, under 25 words.',
  '- Charts and graphs: say the chart type, what it measures, the time range or categories, and the main trend or key values, in under 45 words.',
  '- Screenshots or images of text: summarise the text it contains in under 40 words.',
  '- Logos: the organisation name followed by "logo". If it is a link, describe where the link goes instead.',
  '- If the image is purely decorative, set kind to "decorative".',
  '- If you cannot tell what it shows, set confidence to "low" rather than guessing.',
  '- Do not invent names, numbers or text that are not visible in the image or given in the context.',
  '- Each image comes with its own page context, which may help or may be unrelated. Never use one image’s context for another.',
].join('\n');

/** The text part placed just before image `index`. */
export function imageLabel(index: number, ctx: ImageContext): string {
  const context = [
    ctx.heading && `Nearest heading: ${ctx.heading}`,
    ctx.figcaption && `Caption: ${ctx.figcaption}`,
    ctx.paragraph && `Nearby text: ${ctx.paragraph}`,
    ctx.linkHref && `The image is a link to: ${ctx.linkHref}`,
    ctx.existingAlt && `Current (unhelpful) alt text: ${ctx.existingAlt}`,
  ].filter((l): l is string => !!l);
  return [`Image ${index}.`, ...(context.length ? ['Page context:', ...context] : ['No page context.'])].join('\n');
}

export interface BatchItem {
  image: { mimeType: string; base64: string };
  context: ImageContext;
}

/** Matches entries back to images by index; a missing, duplicate or out-of-range index leaves that slot undefined. */
export function parseBatch(text: string, count: number): (Description | undefined)[] {
  const out: (Description | undefined)[] = new Array(count).fill(undefined);
  let entries: unknown;
  try {
    entries = JSON.parse(text);
  } catch {
    throw new VisionError('api-error', 'Unreadable response');
  }
  if (!Array.isArray(entries)) throw new VisionError('api-error', 'Unreadable response');
  for (const e of entries as (Partial<Description> & { index?: unknown })[]) {
    const i = e?.index;
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= count || out[i]) continue;
    out[i] = { kind: e.kind ?? 'other', alt: (e.alt ?? '').trim(), confidence: e.confidence ?? 'low' };
  }
  return out;
}

/** Describes several images in one request, so they cost one request of the per-minute and per-day quota. */
export async function describeBatchWithGemini(items: BatchItem[], apiKey: string, model: string): Promise<(Description | undefined)[]> {
  const parts: object[] = [{ text: RULES }];
  items.forEach(({ image, context }, i) => {
    parts.push({ text: imageLabel(i, context) }, { inline_data: { mime_type: image.mimeType, data: image.base64 } });
  });
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2 },
    }),
  });
  if (res.status === 429) {
    const { retryAfterMs, daily, message } = parseRateLimit(await res.text());
    throw new VisionError('rate-limited', message, retryAfterMs, daily);
  }
  if (!res.ok) {
    const body = await res.text();
    let message = `${res.status}`;
    try {
      message = JSON.parse(body).error?.message ?? message;
    } catch {}
    throw new VisionError('api-error', message);
  }
  const data = await res.json();
  const text: string = (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
  return parseBatch(text, items.length);
}
