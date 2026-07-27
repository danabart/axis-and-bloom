import { Link } from 'react-router';
import { lifestyleAssets, brandAssets } from '../../design/assets';
import { trackEvent } from '../lib/analytics';

// Real brand mark — same logo the site nav uses (raw SVG from the bucket).
const logoMark = brandAssets.logoQuarter1;

// Her original pre-launch photograph (vertical crop) — kept per brief 28's note.
const coffeeCup = lifestyleAssets.coffee15Vertical.src;

// Palette — matches the quiz terracotta (#9a2918) and the six archetype colors
// used on the result screen, so the flavor-world swatches read as a preview of it.
const TERRA = '#9a2918';
const FONT  = "'Lato', Arial, sans-serif";

const ARCHETYPE_SWATCHES = [
  '#a34b78', // floral
  '#ca445f', // fruity
  '#d1ac11', // balanced & sweet
  '#a54c2d', // chocolate & nutty
  '#912f2f', // spicy & earthy
  '#056c7a', // experimental
];

// Pre-launch = the gate. No email capture here — the only action is the quiz;
// email is captured at the post-quiz gate (brief 25). "Find my flavor" routes
// straight to /find-my-flavor.
export default function PreLaunch() {
  return (
    <>
      <style>{`
        .pl-page {
          display: grid;
          grid-template-columns: 1fr 1fr;
          min-height: 100vh;
          min-height: 100dvh;
          font-family: ${FONT};
          background: #f2f1ea;
          color: #45474a;
          line-height: 1.6;
        }
        .pl-photo {
          background: #1c1512 center / cover no-repeat;
          background-image: url('${coffeeCup}');
        }
        .pl-content {
          display: flex;
          flex-direction: column;
          padding: 34px clamp(28px, 5vw, 64px) 26px;
          position: relative;
        }
        .pl-wordmark {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          letter-spacing: .18em;
          color: ${TERRA};
          font-weight: 500;
        }
        .pl-mid {
          margin: auto 0;
          max-width: 520px;
          padding: 60px 0;
        }
        .pl-kicker {
          font-size: 11px;
          letter-spacing: .24em;
          text-transform: uppercase;
          color: ${TERRA};
          display: block;
          margin-bottom: 22px;
        }
        .pl-h1 {
          font-size: clamp(34px, 3.6vw, 50px);
          font-weight: 400;
          line-height: 1.14;
          color: #45474a;
          margin-bottom: 22px;
        }
        .pl-hl {
          background: #ee5974;
          color: #f2f1ea;
          padding: 1px 10px;
        }
        .pl-sub {
          font-size: 15.5px;
          line-height: 1.7;
          color: #45474a;
          max-width: 440px;
          margin-bottom: 34px;
        }
        .pl-worlds {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 8px;
        }
        .pl-worlds span {
          width: 26px;
          height: 3px;
          display: inline-block;
        }
        .pl-worlds-cap {
          font-size: 11.5px;
          letter-spacing: .08em;
          color: #7b7f80;
          margin-bottom: 40px;
        }
        .pl-btn {
          display: inline-block;
          background: ${TERRA};
          color: #f2f1ea;
          padding: 16px 34px;
          font-size: 12.5px;
          letter-spacing: .18em;
          text-transform: uppercase;
          text-decoration: none;
          transition: background 0.2s;
        }
        .pl-btn:hover { background: #a94936; }
        .pl-micro {
          margin-top: 20px;
          font-size: 11.5px;
          letter-spacing: .06em;
          color: #7b7f80;
        }
        .pl-foot {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          border-top: 1px solid #c5c7c8;
          padding-top: 14px;
          font-size: 11px;
          color: #7b7f80;
          letter-spacing: .06em;
          gap: 12px;
        }
        .pl-foot a {
          color: #7b7f80;
          text-decoration: none;
          margin-left: 16px;
        }
        .pl-foot a:hover { color: ${TERRA}; }

        @media (max-width: 820px) {
          .pl-page { grid-template-columns: 1fr; }
          .pl-photo {
            min-height: 44vh;
            background-position: center 65%;
          }
          .pl-content { padding: 28px 28px 20px; }
          .pl-mid { padding: 44px 0; }
        }
      `}</style>

      <div className="pl-page">
        <div className="pl-photo" aria-hidden="true" />

        <div className="pl-content">
          <div className="pl-wordmark">
            <img src={logoMark} alt="Axis & Bloom" style={{ height: 18, width: 'auto' }} />
            AXIS &amp; BLOOM
          </div>

          <div className="pl-mid">
            <span className="pl-kicker">Coffee, matched to your flavor</span>
            <h1 className="pl-h1">
              You already know what you <span className="pl-hl">love.</span>
            </h1>
            <p className="pl-sub">The doors open October&nbsp;1.</p>

            <div className="pl-worlds" aria-hidden="true">
              {ARCHETYPE_SWATCHES.map((c) => (
                <span key={c} style={{ background: c }} />
              ))}
            </div>
            <p className="pl-worlds-cap">Six flavor worlds. One is yours.</p>

            <Link
              className="pl-btn"
              to="/find-my-flavor"
              onClick={() => trackEvent('PreLaunchCTA', { source: 'pre_launch' })}
            >
              Find my flavor &rarr;
            </Link>
            <p className="pl-micro">Free · three minutes · no account needed</p>
          </div>

          <div className="pl-foot">
            <span>FROM: AXIS &amp; BLOOM — TO: YOU</span>
            <span>
              <Link to="/privacy">Privacy</Link>
              <Link to="/terms">Terms</Link>
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
