import { describe, expect, it } from 'vitest';
import { buildPrompt, parseRateLimit } from '../../src/background/gemini';

function body(message: string, details: object[]) {
  return JSON.stringify({ error: { code: 429, message, details } });
}

describe('parseRateLimit', () => {
  it('reads the retry delay and spots per-minute limits', () => {
    const r = parseRateLimit(
      body('Quota exceeded', [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }],
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37.2s' },
      ]),
    );
    expect(r).toEqual({ retryAfterMs: 37200, daily: false, message: 'Quota exceeded' });
  });

  it('spots daily and zero quotas', () => {
    const perDay = [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }];
    expect(parseRateLimit(body('Quota exceeded', perDay)).daily).toBe(true);
    expect(parseRateLimit(body('Quota exceeded for metric x, limit: 0', [])).daily).toBe(true);
    expect(parseRateLimit(body('Quota exceeded for metric x, limit: 10', [])).daily).toBe(false);
  });

  it('survives a body that is not JSON', () => {
    expect(parseRateLimit('<html>Too many requests</html>')).toEqual({ retryAfterMs: undefined, daily: false, message: 'Rate limited' });
  });
});

describe('buildPrompt', () => {
  it('adds only the context it has', () => {
    const prompt = buildPrompt({ heading: 'Quarterly results', linkHref: 'https://example.com/q3' });
    expect(prompt).toContain('Nearest heading: Quarterly results');
    expect(prompt).toContain('The image is a link to: https://example.com/q3');
    expect(prompt).not.toContain('Caption:');
  });

  it('leaves out the context section when there is none', () => {
    expect(buildPrompt({})).not.toContain('Page context');
  });
});
