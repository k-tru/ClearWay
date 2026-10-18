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
  // The quota kind lives in QuotaFailure.violations[].quotaId (e.g. "GenerateRequestsPerDayPerProjectPerModel-FreeTier").
  let quotaIds = '';
  try {
    const err = JSON.parse(body).error ?? {};
    message = err.message ?? message;
    for (const d of err.details ?? []) {
      const m = /^([\d.]+)s$/.exec(d.retryDelay ?? '');
      if (m) retryAfterMs = Math.ceil(parseFloat(m[1]) * 1000);
      for (const v of d.violations ?? []) quotaIds += ` ${v.quotaId ?? ''}`;
    }
  } catch {}
  const daily = /per ?day|limit: ?0(?!\d)/i.test(message + quotaIds);
  return { retryAfterMs, daily, message };
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    kind: { type: 'STRING', enum: ['photo', 'chart', 'screenshot', 'logo', 'decorative', 'other'] },
    alt: { type: 'STRING' },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
  },
  required: ['kind', 'alt', 'confidence'],
};

export function buildPrompt(ctx: ImageContext): string {
  const lines = [
    'Write alt text for this image for a blind screen reader user browsing a web page.',
    'Rules:',
    '- Say what the image communicates in this context, purpose first. Do not start with "image of", "picture of" or "photo of".',
    '- Photos and illustrations: one sentence, under 25 words.',
    '- Charts and graphs: say the chart type, what it measures, the time range or categories, ' +
      'and the main trend or key values, in under 45 words.',
    '- Screenshots or images of text: summarise the text it contains in under 40 words.',
    '- Logos: the organisation name followed by "logo". If it is a link, describe where the link goes instead.',
    '- If the image is purely decorative, set kind to "decorative".',
    '- If you cannot tell what it shows, set confidence to "low" rather than guessing.',
    '- Do not invent names, numbers or text that are not visible in the image or given in the context.',
  ];
  const context = [
    ctx.heading && `Nearest heading: ${ctx.heading}`,
    ctx.figcaption && `Caption: ${ctx.figcaption}`,
    ctx.paragraph && `Nearby text: ${ctx.paragraph}`,
    ctx.linkHref && `The image is a link to: ${ctx.linkHref}`,
    ctx.existingAlt && `Current (unhelpful) alt text: ${ctx.existingAlt}`,
  ].filter((l): l is string => !!l);
  if (context.length) lines.push('', 'Page context (may help, may be unrelated):', ...context);
  return lines.join('\n');
}

export async function describeWithGemini(
  image: { mimeType: string; base64: string },
  ctx: ImageContext,
  apiKey: string,
  model: string,
): Promise<Description> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: image.mimeType, data: image.base64 } }, { text: buildPrompt(ctx) }] }],
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
  try {
    const parsed = JSON.parse(text) as Description;
    return { kind: parsed.kind ?? 'other', alt: (parsed.alt ?? '').trim(), confidence: parsed.confidence ?? 'low' };
  } catch {
    throw new VisionError('api-error', 'Unreadable response');
  }
}
