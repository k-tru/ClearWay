import type { FeatureId } from './settings';

export interface ImageContext {
  heading?: string;
  figcaption?: string;
  paragraph?: string;
  linkHref?: string;
  existingAlt?: string;
}

export type ImageKind = 'photo' | 'chart' | 'screenshot' | 'logo' | 'decorative' | 'other';

export interface Description {
  kind: ImageKind;
  alt: string;
  confidence: 'high' | 'medium' | 'low';
}

/** Content script → service worker. */
export type ToBackground = { type: 'describe'; url: string; context: ImageContext };

export type DescribeResult =
  | { ok: true; description: Description; cached: boolean }
  | {
      ok: false;
      error: 'no-key' | 'rate-limited' | 'quota-exhausted' | 'fetch-failed' | 'unsupported' | 'api-error';
      detail?: string;
      /** For rate limits: how long before another request is worth trying. */
      retryAfterMs?: number;
    };

export interface FeatureStats {
  fixed: number;
  /** Links with no usable context, images still waiting, etc. */
  pending: number;
  unresolved: number;
  note?: string;
}

/** Popup → content script. */
export type ToContent = { type: 'stats' };
export type StatsReply = Record<FeatureId, FeatureStats>;
