// Hoboken Coffee Crawl (2026-08-31) — campaign allowlist + input normalizers.
// `campaign` is a second, orthogonal dimension from `source` (never replaces it —
// source stays 'post_quiz' for quiz signups; see newsletter.ts). Anyone can POST to
// /subscribe or /campaign/landing, so an allowlist keeps stray client-supplied values
// out of the DB and out of Mailchimp tags.

export const KNOWN_CAMPAIGNS = new Set(['hoboken-crawl-2026']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTM_RE = /^[a-z0-9_-]+$/;

export function normalizeCampaign(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const clean = input.trim().toLowerCase();
  return KNOWN_CAMPAIGNS.has(clean) ? clean : null;
}

export function normalizeVid(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const clean = input.trim();
  return UUID_RE.test(clean) ? clean : null;
}

export function normalizeUtm(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const clean = input.trim().toLowerCase().slice(0, 64);
  return clean && UTM_RE.test(clean) ? clean : null;
}
