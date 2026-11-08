import { useState } from 'react';
import { trackEvent } from '../lib/analytics';
import { shareOrCopy } from '../lib/share';

const SITE_ORIGIN = 'https://www.axisandbloomcoffee.com';

interface Props {
  archetypeName: string;
  /** URL slug for the archetype's public /match page, e.g. 'floral', 'chocolate-nutty'. Omit (Experimental) to hide the row — no share page exists for it. */
  shareSlug: string | null;
}

// Step 07 (A3) — one-tap share row on the free Section 1 reveal (available even to a
// locked first-time guest, since sharing your identity match doesn't need email capture).
// Native share sheet on mobile (feature-detected via navigator.share, not UA-sniffed),
// copy-link fallback on desktop.
export function ShareMatchRow({ archetypeName, shareSlug }: Props) {
  const [copied, setCopied] = useState(false);

  if (!shareSlug) return null;

  const shareUrl = `${SITE_ORIGIN}/match/${shareSlug}`;

  async function handleShare() {
    trackEvent('share_match', { archetype: archetypeName });

    // Family Household 1 (2026-11-07): one share helper, lib/share.ts.
    const outcome = await shareOrCopy(shareUrl, `My coffee archetype: ${archetypeName}`, `I'm ${archetypeName} — find your match too.`);
    if (outcome === 'copied') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    // Website 7B (2026-11-06): restyled to the chrome tokens (caps, underline link).
    <div style={{ display: 'flex', justifyContent: 'center', padding: '28px 24px 0' }}>
      <button
        type="button"
        onClick={handleShare}
        className="ab-caps qz-ulink"
        style={{ color: 'var(--ab-ink)', fontWeight: 400 }}
        data-testid="share-match"
      >
        {copied ? 'Link copied' : 'Share your match'}
      </button>
    </div>
  );
}
