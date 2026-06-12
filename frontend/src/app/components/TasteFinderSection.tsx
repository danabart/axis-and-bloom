import { useRef, useEffect, useState } from 'react';
import coffeePic13 from '../../design/IMAGES/lifestyle/CoffeePic13.png';
import bag3 from '../../design/IMAGES/bags/TransparentBag03.png';
import Footer from './Footer';

/*
  Scroll-driven curtain reveal.

  Architecture:
  - 400vh scroll container with a 100vh sticky viewport inside.
  - The sticky viewport holds a single STRIPE (STRIPE_H tall) centered vertically.
    Above and below the stripe: plain cream background.
  - Inside the stripe, two layers stack:
      REVEALED (bottom): bag left | text right — always there, gets uncovered
      CURTAIN (top):     cream text panel left | chaff photo right — slides LEFT

  The curtain is a single solid horizontal panel that slides left as one piece.
  The left panel carries the "Which archetype is yours?" headline on cream background,
  separate from the chaff photo (they sit side-by-side, not overlaid).

  Footer lives in normal document flow AFTER the 400vh container so it cannot
  appear until the full scroll + hold cycle is complete.

  Stage timing (progress 0→1 maps to ~300vh of scroll):
    0.00–0.15  Stage 1: full curtain stripe visible
    0.15–0.65  Stage 2–3: curtain slides left, bag + text revealed
    0.65–1.00  Stage 4: hold — bag + text fully visible, footer still off-screen
    1.00+      Stage 5: footer enters in normal flow below the scroll container
*/

const STRIPE_H = 400; // px — tall enough for a large bag + the bigger headline
const OPEN_START = 0.15;
const OPEN_END = 0.65;

export function TasteFinderSection() {
  const [progress, setProgress] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => {
      const el = containerRef.current;
      if (!el) return;
      const scrolled = -el.getBoundingClientRect().top;
      const scrollableDistance = el.offsetHeight - window.innerHeight;
      setProgress(Math.max(0, Math.min(1, scrolled / scrollableDistance)));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const curtainProgress =
    progress <= OPEN_START ? 0
    : progress >= OPEN_END ? 1
    : (progress - OPEN_START) / (OPEN_END - OPEN_START);

  const curtainX = -(curtainProgress * 100);

  return (
    <>
      <style>{`
        /* ── Revealed layer ── */
        .tsf-revealed { display: flex; height: 100%; }
        .tsf-bag-col {
          width: 50%; display: flex; align-items: center;
          justify-content: center; padding-left: clamp(24px, 5vw, 72px);
        }
        .tsf-text-col {
          width: 50%; display: flex; flex-direction: column;
          justify-content: center; align-items: flex-end; text-align: right;
          padding: 0 clamp(32px, 5vw, 72px) 0 24px;
        }
        /* ── Curtain layer ── */
        .tsf-curtain { display: flex; height: 100%; }
        .tsf-curtain-text {
          width: 40%; flex-shrink: 0; background: #f2f1ea;
          display: flex; flex-direction: column; justify-content: center;
          padding: 28px clamp(20px, 3.5vw, 52px);
        }
        .tsf-curtain-photo { flex: 1; position: relative; overflow: hidden; }
        /* ── Mobile: stack both layers vertically ── */
        @media (max-width: 600px) {
          .tsf-revealed { flex-direction: column; }
          .tsf-bag-col   { width: 100% !important; height: 55% !important; padding: 20px 24px 0 !important; }
          .tsf-text-col  { width: 100% !important; height: 45% !important; align-items: center !important; text-align: center !important; padding: 12px 24px 20px !important; }
          .tsf-curtain   { flex-direction: column; }
          .tsf-curtain-text  { width: 100% !important; height: 45% !important; padding: 20px 24px 12px !important; }
          .tsf-curtain-photo { height: 55% !important; }
        }
      `}</style>

      {/* ── Tall scroll container — 300vh of scroll drives the 5 stages ──────── */}
      <div ref={containerRef} style={{ height: '400vh', position: 'relative' }}>

        {/* ── Sticky viewport — stays pinned while progress goes 0→1 ─────────── */}
        <div style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflow: 'hidden',
          backgroundColor: '#f2f1ea',
          display: 'flex',
          alignItems: 'center',
        }}>

          {/* ── Stripe zone — fixed height, full viewport width ─────────────── */}
          {/* Both layers are absolutely positioned inside this relative container */}
          <div style={{ width: '100%', height: STRIPE_H, position: 'relative' }}>

            {/* ── REVEALED LAYER: the gift ─────────────────────────────────── */}
            <div className="tsf-revealed" style={{ position: 'absolute', inset: 0, backgroundColor: '#f2f1ea' }}>

              {/* Left — large coffee bag */}
              <div className="tsf-bag-col">
                <img
                  src={bag3}
                  alt="Axis & Bloom coffee bag"
                  style={{
                    height: '88%',
                    width: 'auto',
                    objectFit: 'contain',
                    display: 'block',
                  }}
                />
              </div>

              {/* Right — text + CTA */}
              <div className="tsf-text-col">
                <p style={{
                  fontFamily: "'Genova', sans-serif",
                  fontSize: 'clamp(1rem, 1.4vw, 1.3rem)',
                  fontWeight: 400,
                  color: '#9a2918',
                  opacity: 0.65,
                  lineHeight: 1.85,
                  margin: '0 0 28px',
                  maxWidth: 420,
                }}>
                  Our flavor system is designed to remove the guesswork.
                  Answer a few questions and find your perfect coffee match.
                </p>
                <a
                  href="/find-my-flavor"
                  style={{
                    fontFamily: "'Genova', sans-serif",
                    fontSize: '0.88rem',
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    color: '#9a2918',
                    textDecoration: 'none',
                    borderBottom: '1px solid rgba(154,41,24,0.4)',
                    paddingBottom: 3,
                  }}
                >
                  TAKE THE QUIZ →
                </a>
              </div>
            </div>

            {/* ── CURTAIN LAYER: the wrapping paper, slides LEFT ───────────── */}
            {/* Left 40%: cream panel with headline (separate from chaff photo) */}
            {/* Right 60%: chaff photo                                          */}
            {/* Both panels move as one solid horizontal piece                  */}
            <div
              className="tsf-curtain"
              style={{
                position: 'absolute',
                inset: 0,
                transform: `translateX(${curtainX}%)`,
                transition: 'transform 0.07s ease-out',
                willChange: 'transform',
                zIndex: 10,
              }}
            >
              {/* Left panel — cream with editorial headline */}
              <div className="tsf-curtain-text">
                <p style={{
                  fontFamily: "'Genova', sans-serif",
                  fontSize: '0.68rem',
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  color: '#9a2918',
                  margin: '0 0 14px',
                  opacity: 0.7,
                }}>
                  The Taste Finder
                </p>
                <div style={{ fontFamily: "'Genova', sans-serif", fontWeight: 400, lineHeight: 0.95, margin: '0 0 18px' }}>
                  <span style={{ display: 'block', fontSize: 'clamp(2.2rem, 3.2vw, 3.4rem)', color: '#9a2918' }}>
                    Which
                  </span>
                  <span style={{
                    display: 'inline-block',
                    fontSize: 'clamp(2.2rem, 3.2vw, 3.4rem)',
                    backgroundColor: '#ee5974',
                    color: '#f2f1ea',
                    padding: '3px 12px 6px',
                    margin: '6px 0',
                  }}>
                    archetype
                  </span>
                  <span style={{ display: 'block', fontSize: 'clamp(2.2rem, 3.2vw, 3.4rem)', color: '#9a2918', marginTop: 6 }}>
                    is yours?
                  </span>
                </div>
                <a
                  href="/find-my-flavor"
                  style={{
                    fontFamily: "'Genova', sans-serif",
                    fontSize: '0.72rem',
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: '#9a2918',
                    textDecoration: 'none',
                    borderBottom: '1px solid rgba(154,41,24,0.38)',
                    paddingBottom: 3,
                    width: 'fit-content',
                  }}
                >
                  TAKE THE QUIZ →
                </a>
              </div>

              {/* Right panel — chaff photo, full-bleed within its panel */}
              <div className="tsf-curtain-photo">
                <img
                  src={coffeePic13}
                  alt=""
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    objectPosition: 'center',
                    display: 'block',
                  }}
                />
              </div>
            </div>

          </div>{/* /stripe zone */}
        </div>{/* /sticky viewport */}
      </div>{/* /scroll container */}

      {/* Footer — normal document flow after the 400vh container.           */}
      {/* Cannot enter the viewport until the full scroll + hold is done.   */}
      <Footer />
    </>
  );
}
