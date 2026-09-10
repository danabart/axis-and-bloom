import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { CAMPAIGNS, rememberCampaign, type CampaignSlug } from '../lib/campaign';
import { trackEvent } from '../lib/analytics';
import { logCampaignLanding } from '../lib/api';
import { reportError } from '../lib/errorReporter';

function isCampaignSlug(value: string | null): value is CampaignSlug {
  return value !== null && value in CAMPAIGNS;
}

/**
 * Social campaign links (2026-09-10) — a generic sibling to CrawlLanding.tsx's own
 * hardcoded stamp (its printed URL carries no `campaign` param, so it's left untouched).
 * Mounted once next to <AnalyticsRouteTracker /> in App.tsx. Renders nothing; on every
 * location change, reads `?campaign=` and — if it's a known slug — does exactly what
 * CrawlLanding's mount effect does: stamp, track, fire-and-forget the landing beacon.
 * Deliberately duplicated rather than extracted into a shared helper (see brief
 * CONSTRAINTS) — small, and keeps CrawlLanding untouched two weeks before its event.
 * Never strips the param from the URL — GA4 reads it natively, and rewriting the URL
 * would fight the router for no gain.
 */
export default function CampaignQueryReader() {
  const location = useLocation();
  const firedSlugsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const raw = params.get('campaign');
    if (!isCampaignSlug(raw)) return; // absent or unknown — do nothing, no error
    if (firedSlugsRef.current.has(raw)) return; // at most once per slug per page load
    firedSlugsRef.current.add(raw);

    const slug = raw;
    const stamp = rememberCampaign(slug);
    trackEvent('CampaignLanding', { campaign: slug });

    logCampaignLanding({
      campaign: slug,
      vid: stamp.vid,
      utmSource: params.get('utm_source'),
      utmMedium: params.get('utm_medium'),
      utmCampaign: params.get('utm_campaign'),
      referrer: document.referrer || null,
    }).catch(err => reportError('[CampaignQueryReader/logCampaignLanding]', err));
  }, [location.search]);

  return null;
}
