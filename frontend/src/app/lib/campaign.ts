// Hoboken Coffee Crawl (2026-08-31) — campaign attribution helper. The ONLY place
// that touches the `ab_campaign` localStorage key. `vid` is a self-issued anonymous
// visitor key that joins scan (/crawl landing) -> quiz -> email signup in our own DB,
// regardless of cookie consent (GA4 events are consent-gated; this isn't).
//
// localStorage, not sessionStorage: a crawler scans in the morning and may finish the
// quiz that evening on the same phone — the stamp has to survive a closed tab.

export const CAMPAIGNS = { 'hoboken-crawl-2026': { label: 'Hoboken Coffee Crawl 2026' } } as const;
export type CampaignSlug = keyof typeof CAMPAIGNS;

const STORAGE_KEY = 'ab_campaign';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface CampaignStamp {
  slug: CampaignSlug;
  vid: string;
  at: number;
}

function isCampaignSlug(value: unknown): value is CampaignSlug {
  return typeof value === 'string' && value in CAMPAIGNS;
}

function readStamp(): CampaignStamp | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isCampaignSlug(parsed?.slug) || typeof parsed?.vid !== 'string' || typeof parsed?.at !== 'number') {
      return null;
    }
    return { slug: parsed.slug, vid: parsed.vid, at: parsed.at };
  } catch {
    return null;
  }
}

/**
 * Stamps (or refreshes) the active campaign for this visitor. Keeps the existing `vid`
 * when a stamp for the SAME slug already exists — a rescan refreshes `at`, never the
 * visitor key. Wrapped in try/catch: private browsing / blocked storage still returns a
 * usable in-memory stamp for this page load, it just won't persist across reloads.
 */
export function rememberCampaign(slug: CampaignSlug): CampaignStamp {
  const existing = readStamp();
  const vid = existing?.slug === slug ? existing.vid : crypto.randomUUID();
  const stamp: CampaignStamp = { slug, vid, at: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stamp));
  } catch {
    // private mode / storage blocked — stamp still returned for this page load.
  }
  return stamp;
}

/**
 * Reads the active campaign stamp, or null if missing, unknown slug, malformed, or
 * older than 30 days. `/crawl` itself has no expiry — a scan re-stamps it regardless.
 */
export function getActiveCampaign(): CampaignStamp | null {
  const stamp = readStamp();
  if (!stamp) return null;
  if (Date.now() - stamp.at > MAX_AGE_MS) return null;
  return stamp;
}
