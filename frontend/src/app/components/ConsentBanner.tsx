import { useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router';
import { hasStoredConsentChoice, setAnalyticsConsent } from '../lib/analytics';

const BRAND = '#a33726';
const CREAM = '#f2f1ea';

// Step 03 (B2) — calm cookie/consent banner. Two equal-weight choices, no
// pre-selected default, remembered so it never reappears once decided.
// Not shown on /admin — internal staff, not the paid-ad visitor this exists for.
export default function ConsentBanner() {
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!hasStoredConsentChoice());
  }, []);

  if (pathname.startsWith('/admin') || !visible) return null;

  const choose = (granted: boolean) => {
    setAnalyticsConsent(granted);
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10000, // above PreLaunch's/FilmModal's fixed inset-0 z-[9999] overlays — the banner
        // must stay reachable on the pre-launch front door, the site's only entry point right now.
        backgroundColor: CREAM,
        borderTop: `1px solid rgba(154,41,24,0.15)`,
        boxShadow: '0 -4px 20px rgba(0,0,0,0.06)',
        padding: 'clamp(16px, 2.5vw, 24px) clamp(20px, 5vw, 56px)',
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <p
          style={{
            fontFamily: "'Lato', Arial, sans-serif",
            fontSize: '0.85rem',
            color: BRAND,
            opacity: 0.8,
            lineHeight: 1.6,
            margin: 0,
            maxWidth: 640,
          }}
        >
          We use cookies to understand how the site's used and to run our ads. Read our{' '}
          <Link to="/privacy" style={{ color: BRAND, textDecoration: 'underline' }}>Privacy Policy</Link>.
          Essential features, like taking the quiz, work either way.
        </p>
        <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
          <button
            onClick={() => choose(false)}
            style={{
              fontFamily: "'Lato', Arial, sans-serif",
              fontSize: '0.72rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: BRAND,
              background: 'transparent',
              border: `1px solid ${BRAND}`,
              padding: '11px 20px',
              cursor: 'pointer',
            }}
          >
            Essential only
          </button>
          <button
            onClick={() => choose(true)}
            style={{
              fontFamily: "'Lato', Arial, sans-serif",
              fontSize: '0.72rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: CREAM,
              background: BRAND,
              border: `1px solid ${BRAND}`,
              padding: '11px 20px',
              cursor: 'pointer',
            }}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
