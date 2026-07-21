import { useState } from 'react';
import { trackEvent } from '../lib/analytics';

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

    if (navigator.share) {
      try {
        await navigator.share({
          title: `My coffee archetype: ${archetypeName}`,
          text: `I'm ${archetypeName} — find your match too.`,
          url: shareUrl,
        });
      } catch {
        // user cancelled the native sheet — not an error
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — silently do nothing rather than throw
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 24px 0' }}>
      <button
        onClick={handleShare}
        style={{
          background: 'none',
          border: '1px solid rgba(154, 41, 24, 0.35)',
          borderRadius: 999,
          padding: '9px 22px',
          fontFamily: "'Lato', Arial, sans-serif",
          fontSize: '0.68rem',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: '#9a2918',
          cursor: 'pointer',
        }}
      >
        {copied ? 'Link copied' : 'Share your match'}
      </button>
    </div>
  );
}
