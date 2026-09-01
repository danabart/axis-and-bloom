import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { campaignAssets } from '../../design/assets';
import { trackEvent } from '../lib/analytics';
import { rememberCampaign } from '../lib/campaign';
import { logCampaignLanding } from '../lib/api';
import { reportError } from '../lib/errorReporter';
import { usePrelaunchBypass } from '../lib/prelaunch';

const CAMPAIGN_SLUG = 'hoboken-crawl-2026';
const photoBand = campaignAssets.hobokenCrawl2026.photoBand;

// Camila's approved mockup (42-crawl-landing-mockup-v9.html) uses a different quarter-
// round mark than brandAssets.logoQuarter1 (different viewBox, different path data/
// palette — confirmed by diffing both SVGs, not assumed) — inlined here verbatim rather
// than through the bucket registry, same as the mockup itself does.
function LogoMark() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 154.2804 155.8073" height={24} width="auto" aria-hidden="true">
      <path d="M125.3727,142.3929L14.71,89.89c8.2847-17.553,19.7762-33.2925,33.7246-46.4617l86.8586,86.6848c-4.2533,3.1809-7.6794,7.4016-9.9205,12.2797Z" fill="#c24526"/>
      <path d="M77.227,58.5206c21.1485-16.7981,47.9002-26.8439,77.0062-26.8439v22.0518c-22.99.0421-44.2201,7.7177-61.2927,20.6192l-15.7135-15.8272Z" fill="#e8c3a7"/>
      <path d="M123.2306,104.8575c9.0398-5.5476,19.648-8.7748,31.0025-8.8101v27.4337c-3.7511,0-7.3497.6481-10.6964,1.8295l-20.3061-20.4531Z" fill="#c24526"/>
      <path d="M120.6661,84.9454c4.4534-2.0896,9.0584-3.7597,13.8627-4.8199,5.0093-1.1056,10.1493-1.7349,15.2624-2.1097,1.4129-.1032,3.0741-.1753,4.4892-.2351l-.2465-77.7807h.2393c-36.186,0-69.7299,12.3681-96.142,33.1073l-3.166,3.0396,55.2338,55.5323c3.2131-2.6406,6.7045-4.9682,10.4671-6.7338Z" fill="#e9526f"/>
      <path d="M80.0742,135.4081c.501-1.3251,1.0311-2.6387,1.5725-3.9476L10.5988,98.4424C4.422,111.4823,0,136.3962,0,155.8073h76.5024c.2091-1.4608-1.2581-4.2187-.9385-5.6666,1.1055-5.0093,2.6982-9.9367,4.5103-14.7325Z" fill="#868787"/>
      <path d="M98.4218,79.8687c15.6351-11.5445,34.9377-18.3939,55.8114-18.4352v35.6194c-13.4765.0376-19.9289,1.4416-30.4644,8.3041l-25.347-25.4883Z" fill="#c24526"/>
      <path d="M122.4776,150.753c-.2421,1.5856-.376,3.2065-.376,4.8601h-47.4305c.0625-8.8526,1.583-17.3609,4.315-25.3124l43.4915,20.4523Z" fill="#c24526"/>
    </svg>
  );
}

// Copy in one block, character for character from the handoff (§3). House rule: no em
// dashes except the FROM/TO lockup, which uses one as a graphic element. No Genova/
// Gotham glyph rule with Lato — Lato's own & and ? are used as-is (Dana + Camila,
// 2026-09-01 revision: no web license for Genova/Gotham before launch).
const COPY = {
  wordmark: 'AXIS & BLOOM',
  kicker: 'HOBOKEN COFFEE CRAWL · SEPTEMBER 20 · WITH THE HOBOKEN HISTORICAL MUSEUM',
  h1Line1: 'Hey,',
  h1Line2: 'Hoboken',
  lede: 'Today the whole city is tasting. Somewhere between those cups is a pattern, and it’s yours: your family of taste. Three minutes, no jargon.',
  photoAlt: 'A cup of Axis & Bloom beans on the Hoboken waterfront',
  gamePrefix: 'Been noticing which words keep coming back?',
  gameGood: 'Good.',
  gameSuffix: 'The quiz will tell you if you were right.',
  palatePrefix: 'Whose',
  palateWord: 'palate',
  palateSuffix: 'are we profiling today?',
  fieldPlaceholder: 'Enter your name',
  // Two non-breaking spaces before the arrow, per the handoff — a plain double space
  // collapses to one in HTML, which would lose the intended gap at this letter-spacing.
  buttonLabel: 'START THE QUIZ  →',
  perkLead: 'FOR CRAWLERS ONLY',
  perkBody1: 'Finish the quiz today and your first order',
  perkHot1: 'ships free',
  perkBody2: '. Five of you will receive your',
  perkHot2: 'first match free',
  perkBody3: ', drawn when the doors open this fall.',
} as const;

export default function CrawlLanding() {
  const navigate = useNavigate();
  const [name, setName] = useState('');

  // /crawl is always open regardless of the prelaunch gate (return value unused here),
  // but calling this is what actually writes the sessionStorage bypass flag when
  // ?preview=true is present. Every other open route gets this as a side effect of
  // rendering <Navigation>/<PrelaunchGate> inside <PublicLayout>; /crawl deliberately
  // renders neither (Camila's page has its own header/footer), so without this call
  // ?preview=true here would stamp nothing and the rest of the site would stay gated.
  usePrelaunchBypass();

  // Part 1 behavior, kept verbatim: stamp the campaign, fire the landing beacon
  // (fire-and-forget, never blocks rendering), never forward UTMs anywhere else —
  // the localStorage stamp + visitor key is the whole attribution mechanism.
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

  const trimmedName = name.trim();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmedName) return;
    // Reuse the existing Home.tsx -> FlavorQuiz.tsx name handoff verbatim — no new
    // key, no router state, no query param (handoff §7/Part 2 decision 3).
    try { sessionStorage.setItem('axisBloomCustomerName', trimmedName); } catch {}
    trackEvent('CampaignCTA', { campaign: CAMPAIGN_SLUG });
    navigate('/find-my-flavor');
  }

  return (
    <>
      <style>{`
        .crawl-page {
          background: #f2f1ea;
          font-family: 'Lato', sans-serif;
          color: #45474a;
          -webkit-font-smoothing: antialiased;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }
        .crawl-wrap {
          width: 100%;
          max-width: 560px;
          margin: 0 auto;
          padding: 0 30px;
          text-align: center;
        }
        .crawl-header { padding: 34px 0 0; }
        .crawl-wordmark {
          font-size: 10.5px;
          letter-spacing: .3em;
          color: #9a2918;
          font-weight: 400;
          margin-top: 9px;
        }
        .crawl-kicker {
          font-size: 10px;
          letter-spacing: .26em;
          color: #7b7f80;
          font-weight: 400;
          margin-top: 34px;
        }
        .crawl-h1 {
          font-size: 54px;
          font-weight: 500;
          letter-spacing: .02em;
          line-height: 1.16;
          margin-top: 18px;
          text-transform: uppercase;
        }
        .crawl-h1-pink { color: #ee5974; }
        .crawl-h1-terra { color: #9a2918; }
        .crawl-lede {
          font-size: 15.5px;
          font-weight: 300;
          line-height: 1.7;
          color: #45474a;
          margin: 20px auto 0;
          max-width: 400px;
        }
        .crawl-photo {
          margin-top: 34px;
          height: 178px;
          position: relative;
          overflow: hidden;
        }
        .crawl-photo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: 48% 60%;
          display: block;
        }
        .crawl-game {
          font-size: 14px;
          font-weight: 300;
          line-height: 1.7;
          color: #9a2918;
          margin: 34px auto 0;
          max-width: 380px;
        }
        .crawl-good {
          font-weight: 900;
          background: #f8b3bd;
          color: #9a2918;
          padding: .06em .24em .1em;
          border-radius: 1px;
        }
        .crawl-palate {
          font-size: 29px;
          font-weight: 400;
          color: #9a2918;
          letter-spacing: .01em;
          line-height: 1.32;
          margin: 30px auto 0;
          max-width: 420px;
        }
        .crawl-palate-pink { color: #ee5974; }
        .crawl-form { margin-top: 26px; }
        .crawl-field {
          display: block;
          width: 100%;
          max-width: 340px;
          margin: 0 auto;
          background: none;
          border: none;
          border-bottom: 1px solid #c5c7c8;
          font-family: 'Lato', sans-serif;
          font-size: 19px;
          font-weight: 300;
          color: #45474a;
          padding: 10px 2px;
          text-align: center;
          outline: none;
        }
        .crawl-field::placeholder { color: #7b7f80; opacity: .8; }
        .crawl-field:focus { border-bottom-color: #ee5974; }
        .crawl-btn {
          display: inline-block;
          background: #9a2918;
          color: #f2f1ea;
          font-size: 12.5px;
          letter-spacing: .24em;
          font-weight: 900;
          padding: 17px 42px;
          text-decoration: none;
          border: none;
          cursor: pointer;
          font-family: 'Lato', sans-serif;
          margin-top: 30px;
          transition: background .3s;
        }
        .crawl-btn:hover:not(:disabled) { background: #8a2416; }
        .crawl-btn:focus-visible { outline: 2px solid #ee5974; outline-offset: 2px; }
        .crawl-btn:disabled { opacity: .3; cursor: not-allowed; }
        .crawl-perk {
          font-size: 11px;
          font-weight: 400;
          line-height: 1.65;
          color: #45474a;
          margin: 26px auto 0;
          max-width: 360px;
        }
        .crawl-perk-lead {
          font-weight: 900;
          font-size: 10px;
          letter-spacing: .06em;
          color: #ee5974;
        }
        .crawl-hot { color: #9a2918; font-weight: 900; }
        .crawl-footer { margin-top: auto; padding-top: 44px; }
        .crawl-fromto {
          font-size: 9.5px;
          letter-spacing: .2em;
          color: #7b7f80;
          margin-bottom: 16px;
          font-weight: 400;
        }
        .crawl-band { display: flex; height: 10px; }
        .crawl-band div { flex: 1; }

        @media (min-width: 900px) {
          .crawl-h1 { font-size: 84px; }
          .crawl-palate { font-size: 38px; max-width: 560px; }
          .crawl-wrap { max-width: 720px; }
          .crawl-lede { font-size: 17px; max-width: 470px; }
          .crawl-photo { height: 480px; }
          .crawl-photo img { object-position: 48% 52%; }
        }
      `}</style>

      <div className="crawl-page">
        <header className="crawl-wrap crawl-header">
          <LogoMark />
          <div className="crawl-wordmark">{COPY.wordmark}</div>

          <div className="crawl-kicker">{COPY.kicker}</div>
          <h1 className="crawl-h1">
            <span className="crawl-h1-pink">{COPY.h1Line1}</span><br />
            <span className="crawl-h1-terra">{COPY.h1Line2}</span>
          </h1>
          <p className="crawl-lede">{COPY.lede}</p>
        </header>

        <div className="crawl-photo">
          <img
            src={photoBand.src}
            srcSet={`${photoBand.mobileSrc} 900w, ${photoBand.src} 1800w`}
            sizes="100vw"
            alt={COPY.photoAlt}
            loading="eager"
            decoding="async"
            onError={e => { e.currentTarget.style.display = 'none'; }}
          />
        </div>

        <div className="crawl-wrap">
          <p className="crawl-game">
            {COPY.gamePrefix} <b className="crawl-good">{COPY.gameGood}</b> {COPY.gameSuffix}
          </p>

          <p className="crawl-palate">
            {COPY.palatePrefix} <span className="crawl-palate-pink">{COPY.palateWord}</span> {COPY.palateSuffix}
          </p>

          <form className="crawl-form" onSubmit={handleSubmit}>
            <input
              className="crawl-field"
              type="text"
              placeholder={COPY.fieldPlaceholder}
              autoComplete="given-name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <br />
            <button className="crawl-btn" type="submit" disabled={!trimmedName}>
              {COPY.buttonLabel}
            </button>
          </form>

          <p className="crawl-perk">
            <b className="crawl-perk-lead">{COPY.perkLead}</b>{' '}{COPY.perkBody1}{' '}
            <span className="crawl-hot">{COPY.perkHot1}</span>{COPY.perkBody2} <span className="crawl-hot">{COPY.perkHot2}</span>{COPY.perkBody3}
          </p>
        </div>

        <footer className="crawl-wrap crawl-footer">
          <div className="crawl-fromto">FROM: AXIS & BLOOM {'—'} TO: HOBOKEN</div>
          <div className="crawl-band">
            <div style={{ background: '#a34b78' }} />
            <div style={{ background: '#ca445f' }} />
            <div style={{ background: '#d1ac11' }} />
            <div style={{ background: '#a54c2d' }} />
            <div style={{ background: '#912f2f' }} />
            <div style={{ background: '#056c7a' }} />
          </div>
        </footer>
      </div>
    </>
  );
}
