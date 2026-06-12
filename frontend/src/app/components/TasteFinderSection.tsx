import { useRef, useEffect, useState } from 'react';
import coffeePic13 from '../../design/IMAGES/lifestyle/CoffeePic13.png';
import bag3 from '../../design/IMAGES/bags/TransparentBag03.png';
import Footer from './Footer';

/*
  Scroll-driven curtain reveal — 5 stages:

  Stage 1 (progress 0–0.15):   Full chaff image visible — user "sees the wrapping paper"
  Stage 2–3 (0.15–0.65):       Curtain (chaff) slides LEFT revealing the bag + text underneath
  Stage 4 (0.65–1.0):          Hold — bag + text fully visible, footer NOT yet in view
  Stage 5 (progress = 1.0):    Scroll container ends, footer enters in normal document flow

  The 400vh container gives ~300vh of scrollable distance through the sticky viewport.
  Footer is placed AFTER the container in normal flow — it cannot appear until the
  entire 300vh of scroll is consumed.
*/

const SCROLL_HEIGHT = '400vh';
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
        .tsf-revealed { display: flex; align-items: center; }
        .tsf-bag-col {
          width: 50%; height: 100%;
          display: flex; align-items: center; justify-content: center;
          padding-left: clamp(24px, 5vw, 80px);
        }
        .tsf-text-col {
          width: 50%;
          display: flex; flex-direction: column; justify-content: center;
          align-items: flex-end; text-align: right;
          padding: 0 clamp(32px, 5vw, 80px) 0 24px;
        }
        @media (max-width: 640px) {
          .tsf-revealed { flex-direction: column; }
          .tsf-bag-col {
            width: 100% !important; height: 55% !important;
            padding: 28px 28px 0 28px !important;
          }
          .tsf-text-col {
            width: 100% !important; height: 45% !important;
            align-items: center !important; text-align: center !important;
            padding: 20px 28px 32px !important;
          }
        }
      `}</style>

      {/* ── Tall scroll container — creates the scroll room for all 5 stages ── */}
      <div ref={containerRef} style={{ height: SCROLL_HEIGHT, position: 'relative' }}>

        {/* Sticky viewport — pinned for the full 300vh of scroll distance */}
        <div style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflow: 'hidden',
          backgroundColor: '#f2f1ea',
        }}>

          {/* ── REVEALED LAYER: the gift ──────────────────────────────────────── */}
          <div className="tsf-revealed" style={{ position: 'absolute', inset: 0 }}>

            {/* Left — coffee bag */}
            <div className="tsf-bag-col">
              <img
                src={bag3}
                alt="Axis & Bloom coffee bag"
                style={{
                  height: 'clamp(300px, 60vh, 540px)',
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
                  fontSize: '0.85rem',
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

          {/* ── CURTAIN LAYER: the wrapping paper ────────────────────────────── */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transform: `translateX(${curtainX}%)`,
              transition: 'transform 0.07s ease-out',
              willChange: 'transform',
              zIndex: 10,
            }}
          >
            {/* Full-bleed chaff photo */}
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

            {/* Soft left-edge gradient — lifts text off the photo */}
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(to right, rgba(242,241,234,0.52) 0%, rgba(242,241,234,0.18) 38%, transparent 60%)',
            }} />

            {/* Editorial headline — top left, 2× original size */}
            <div style={{
              position: 'absolute',
              top: 'clamp(48px, 7vh, 88px)',
              left: 'clamp(32px, 5vw, 72px)',
              zIndex: 2,
            }}>
              <p style={{
                fontFamily: "'Genova', sans-serif",
                fontSize: 'clamp(0.68rem, 0.8vw, 0.78rem)',
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: '#9a2918',
                margin: '0 0 18px',
                opacity: 0.8,
              }}>
                The Taste Finder
              </p>
              <div style={{ fontFamily: "'Genova', sans-serif", fontWeight: 400, lineHeight: 0.95 }}>
                <span style={{ display: 'block', fontSize: 'clamp(3rem, 5.5vw, 5.5rem)', color: '#9a2918' }}>
                  Which
                </span>
                <span style={{
                  display: 'inline-block',
                  fontSize: 'clamp(3rem, 5.5vw, 5.5rem)',
                  backgroundColor: '#ee5974',
                  color: '#f2f1ea',
                  padding: '4px 16px 8px',
                  margin: '8px 0',
                }}>
                  archetype
                </span>
                <span style={{ display: 'block', fontSize: 'clamp(3rem, 5.5vw, 5.5rem)', color: '#9a2918', marginTop: 8 }}>
                  is yours?
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Footer — normal document flow, AFTER the 400vh container.             */}
      {/* It cannot enter the viewport until the entire scroll container ends.  */}
      <Footer />
    </>
  );
}
