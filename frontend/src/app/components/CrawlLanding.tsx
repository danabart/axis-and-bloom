import { useEffect } from 'react';
import { Link } from 'react-router';
import { brandAssets } from '../../design/assets';
import { trackEvent } from '../lib/analytics';
import { rememberCampaign } from '../lib/campaign';
import { logCampaignLanding } from '../lib/api';
import { ARCHETYPE_VISUALS } from './bloom/bloomVisuals';
import { reportError } from '../lib/errorReporter';

const CAMPAIGN_SLUG = 'hoboken-crawl-2026';

// Same brand mark PreLaunch.tsx uses (raw SVG from the bucket) — no new image assets.
const logoMark = brandAssets.logoQuarter1;
const TERRA = '#9a2918';
const FONT = "'Lato', Arial, sans-serif";

// Copy in one block, positive register, matches the printed card's voice. Camila may
// polish wording later — keep every user-facing string here, nowhere else in the file.
const COPY = {
  kicker: 'HOBOKEN COFFEE CRAWL · SEPTEMBER 20',
  h1: "What's your coffee archetype?",
  body: "You know you love coffee. Today you'll taste your way across Hoboken, and somewhere in those cups is a pattern: your family of taste. Three minutes, no jargon. Find it.",
  ctaLabel: 'Take the quiz →',
  ctaMicro: 'Free · three minutes · your match lands in your inbox',
  fieldGuideHeading: 'A field guide for today',
  fieldGuideSub: 'As you taste your way through Hoboken, notice which words keep coming back.',
  fieldGuideClosing: 'The words that keep returning are your axis. Take the quiz and see if you were right.',
  offerKicker: 'FOR CRAWLERS ONLY',
  offerBody: 'Find your archetype today and your first order ships free. Five of you will receive your first match free, drawn when the doors open.',
  footDoors: 'Doors open this fall · axisandbloomcoffee.com',
  footSocial: 'Follow @axisandbloom',
  footSignature: 'FROM: AXIS & BLOOM — TO: HOBOKEN',
} as const;

// Same six archetypes, same order, as the printed card back. num + color come from
// bloomVisuals.ts's ARCHETYPE_VISUALS — the one shared source of truth for these six
// hex values (see PreLaunch.tsx's ARCHETYPE_SWATCHES for the other consumer).
const FIELD_GUIDE = [
  { key: 'floral', name: 'Floral', words: 'Fragrant · Bright · Delicate · Clean' },
  { key: 'fruity', name: 'Fruity', words: 'Sweet · Vibrant · Expressive · Lively' },
  { key: 'balanced_sweet', name: 'Balanced & Sweet', words: 'Smooth · Sweet · Harmonious · Easy' },
  { key: 'chocolate_nutty', name: 'Chocolate & Nutty', words: 'Rich · Grounded · Full · Comforting' },
  { key: 'earthy', name: 'Earthy', words: 'Warm · Deep · Bold · Lasting' },
  { key: 'experimental', name: 'Experimental', words: 'Wild · Unique · Surprising' },
] as const;

function fireCtaClick() {
  trackEvent('CampaignCTA', { campaign: CAMPAIGN_SLUG });
}

export default function CrawlLanding() {
  useEffect(() => {
    document.title = 'Hoboken Coffee Crawl · Axis & Bloom';

    const stamp = rememberCampaign(CAMPAIGN_SLUG);
    trackEvent('CampaignLanding', { campaign: CAMPAIGN_SLUG });

    const params = new URLSearchParams(window.location.search);
    logCampaignLanding({
      campaign: CAMPAIGN_SLUG,
      vid: stamp.vid,
      utmSource: params.get('utm_source'),
      utmMedium: params.get('utm_medium'),
      utmCampaign: params.get('utm_campaign'),
      referrer: document.referrer || null,
    }).catch(err => reportError('[CrawlLanding/logCampaignLanding]', err));
  }, []);

  return (
    <>
      <style>{`
        .crawl-page {
          font-family: ${FONT};
          background: #f2f1ea;
          color: #45474a;
          line-height: 1.6;
        }
        .crawl-wrap {
          max-width: 640px;
          margin: 0 auto;
          padding: 28px clamp(20px, 5vw, 40px) 60px;
        }
        .crawl-wordmark {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          letter-spacing: .18em;
          color: ${TERRA};
          font-weight: 500;
          margin-bottom: 32px;
        }
        .crawl-kicker {
          font-size: 11px;
          letter-spacing: .22em;
          text-transform: uppercase;
          color: ${TERRA};
          display: block;
          margin-bottom: 16px;
        }
        .crawl-h1 {
          font-size: clamp(30px, 6vw, 44px);
          font-weight: 400;
          line-height: 1.14;
          color: #45474a;
          margin: 0 0 18px;
        }
        .crawl-body {
          font-size: 16px;
          line-height: 1.7;
          color: #45474a;
          margin: 0 0 28px;
        }
        .crawl-cta {
          display: inline-block;
          background: ${TERRA};
          color: #f2f1ea;
          padding: 16px 30px;
          font-size: 13px;
          letter-spacing: .14em;
          text-transform: uppercase;
          text-decoration: none;
          min-height: 44px;
          box-sizing: border-box;
          transition: background 0.2s;
        }
        .crawl-cta:hover { background: #a94936; }
        .crawl-cta-micro {
          margin: 12px 0 0;
          font-size: 12px;
          letter-spacing: .04em;
          color: #7b7f80;
        }
        .crawl-section {
          margin-top: 52px;
        }
        .crawl-section-h2 {
          font-size: clamp(22px, 4vw, 28px);
          font-weight: 400;
          color: #45474a;
          margin: 0 0 8px;
        }
        .crawl-section-sub {
          font-size: 14px;
          color: #7b7f80;
          margin: 0 0 24px;
          max-width: 480px;
        }
        .crawl-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        .crawl-tile {
          padding: 18px 14px;
          color: #f2f1ea;
        }
        .crawl-tile-num {
          display: block;
          font-size: 11px;
          letter-spacing: .1em;
          opacity: 0.85;
          margin-bottom: 8px;
        }
        .crawl-tile-name {
          display: block;
          font-size: 15px;
          font-weight: 500;
          margin-bottom: 6px;
        }
        .crawl-tile-words {
          display: block;
          font-size: 11.5px;
          line-height: 1.5;
          opacity: 0.92;
        }
        .crawl-closing {
          margin-top: 28px;
          font-size: 14px;
          color: #45474a;
          max-width: 480px;
        }
        .crawl-closing a {
          color: ${TERRA};
          font-weight: 500;
          text-decoration: none;
        }
        .crawl-offer {
          margin-top: 52px;
          padding: 24px;
          background: #e8e5d8;
        }
        .crawl-offer-kicker {
          font-size: 11px;
          letter-spacing: .22em;
          text-transform: uppercase;
          color: ${TERRA};
          display: block;
          margin-bottom: 10px;
        }
        .crawl-offer-body {
          font-size: 14.5px;
          line-height: 1.65;
          color: #45474a;
          margin: 0;
        }
        .crawl-foot {
          margin-top: 52px;
          border-top: 1px solid #c5c7c8;
          padding-top: 16px;
          font-size: 12px;
          color: #7b7f80;
          letter-spacing: .04em;
        }
        .crawl-foot p { margin: 0 0 6px; }
        .crawl-foot-sig {
          margin-top: 14px;
          font-size: 11px;
          letter-spacing: .1em;
          text-transform: uppercase;
          color: #7b7f80;
        }

        @media (max-width: 640px) {
          .crawl-grid { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>

      <div className="crawl-page">
        <div className="crawl-wrap">
          <div className="crawl-wordmark">
            <img src={logoMark} alt="Axis & Bloom" style={{ height: 18, width: 'auto' }} />
            AXIS &amp; BLOOM
          </div>

          <span className="crawl-kicker">{COPY.kicker}</span>
          <h1 className="crawl-h1">{COPY.h1}</h1>
          <p className="crawl-body">{COPY.body}</p>

          <Link className="crawl-cta" to="/find-my-flavor" onClick={fireCtaClick}>
            {COPY.ctaLabel}
          </Link>
          <p className="crawl-cta-micro">{COPY.ctaMicro}</p>

          <div className="crawl-section">
            <h2 className="crawl-section-h2">{COPY.fieldGuideHeading}</h2>
            <p className="crawl-section-sub">{COPY.fieldGuideSub}</p>

            <div className="crawl-grid">
              {FIELD_GUIDE.map(item => {
                const visual = ARCHETYPE_VISUALS[item.key];
                return (
                  <div key={item.key} className="crawl-tile" style={{ background: visual.color }}>
                    <span className="crawl-tile-num">{visual.num}</span>
                    <span className="crawl-tile-name">{item.name}</span>
                    <span className="crawl-tile-words">{item.words}</span>
                  </div>
                );
              })}
            </div>

            <p className="crawl-closing">
              {COPY.fieldGuideClosing}{' '}
              <Link to="/find-my-flavor" onClick={fireCtaClick}>Take the quiz →</Link>
            </p>
          </div>

          <div className="crawl-offer">
            <span className="crawl-offer-kicker">{COPY.offerKicker}</span>
            <p className="crawl-offer-body">{COPY.offerBody}</p>
          </div>

          <div className="crawl-foot">
            <p>{COPY.footDoors}</p>
            <p>{COPY.footSocial}</p>
            <div className="crawl-foot-sig">{COPY.footSignature}</div>
          </div>
        </div>
      </div>
    </>
  );
}
