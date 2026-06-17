import { useRef, useEffect, useState } from 'react';
import coffeePic13 from '../../design/IMAGES/lifestyle/CoffeePic13.png';
import bag3 from '../../design/IMAGES/bags/TransparentBag03.png';
import Footer from './Footer';

/*
  Architecture:
  - Wrapper is exactly 100vh in document flow.
  - The revealed layer (bag + taste finder text + footer) sits position:absolute, inset:0.
  - The curtain (full-screen chaff photo, no text) sits above it, position:absolute, inset:0, z-index 10.
  - Wheel / touch events are intercepted at page-bottom to drive the translateY animation.
  - Footer is always in the DOM (inside the revealed layer) — no dynamic height changes.

  Stage timeline — acc range [-WHEEL_CLOSE_HOLD, WHEEL_HOLD_END]:

  Opening (scroll down):
    0 → WHEEL_PRE_OPEN (200):               pre-open wait — curtain still covers
    200 → WHEEL_PRE_OPEN+WHEEL_OPEN (1100): curtain lifts, progress 0→1
    1100 → WHEEL_HOLD_END (1300):           open hold — curtain at 100%
    1300+:                                  nothing moves (curtain fully open)

  Closing (scroll up) — mirrors in reverse:
    1300 → 1100:                            open hold reverse
    1100 → 200:                             curtain lowers, progress 1→0
    200 → 0:                                pre-close wait
    0 → -WHEEL_CLOSE_HOLD (-500):           close hold — page still intercepted
    -500:                                   interception released, page scrolls up

  progress = max(0, min(1, (acc - WHEEL_PRE_OPEN) / WHEEL_OPEN))
*/

const WHEEL_PRE_OPEN   = 200;
const WHEEL_OPEN       = 900;   // large value = slow, user-controlled curtain travel
const WHEEL_HOLD_END   = WHEEL_PRE_OPEN + WHEEL_OPEN + 200; // 1300
const WHEEL_CLOSE_HOLD = 500;   // generous hold before page scrolls up on close

export function TasteFinderSection() {
  const [progress, setProgress] = useState(0);
  const acc = useRef(0);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const atBottom  = window.scrollY >= maxScroll - 3;

      // Scrolling down at page bottom → pre-open wait → open → hold
      if (atBottom && e.deltaY > 0 && acc.current < WHEEL_HOLD_END) {
        e.preventDefault();
        if (acc.current < 0) acc.current = 0; // skip close-hold on re-open
        acc.current = Math.min(WHEEL_HOLD_END, acc.current + e.deltaY);
        setProgress(Math.max(0, Math.min(1, (acc.current - WHEEL_PRE_OPEN) / WHEEL_OPEN)));
        return;
      }

      // Scrolling up → open-hold reverse → curtain closes → close hold
      if (e.deltaY < 0 && acc.current > -WHEEL_CLOSE_HOLD) {
        e.preventDefault();
        acc.current = Math.max(-WHEEL_CLOSE_HOLD, acc.current + e.deltaY);
        setProgress(Math.max(0, Math.min(1, (acc.current - WHEEL_PRE_OPEN) / WHEEL_OPEN)));
      }
    };

    // Touch — same logic, 2.2× multiplier for finger velocity
    let touchY = 0;
    const onTouchStart = (e: TouchEvent) => { touchY = e.touches[0].clientY; };
    const onTouchMove  = (e: TouchEvent) => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const atBottom  = window.scrollY >= maxScroll - 3;
      const delta     = touchY - e.touches[0].clientY;
      touchY = e.touches[0].clientY;

      if (atBottom && delta > 0 && acc.current < WHEEL_HOLD_END) {
        e.preventDefault();
        if (acc.current < 0) acc.current = 0;
        acc.current = Math.min(WHEEL_HOLD_END, acc.current + delta * 2.2);
        setProgress(Math.max(0, Math.min(1, (acc.current - WHEEL_PRE_OPEN) / WHEEL_OPEN)));
      } else if (delta < 0 && acc.current > -WHEEL_CLOSE_HOLD) {
        e.preventDefault();
        acc.current = Math.max(-WHEEL_CLOSE_HOLD, acc.current + delta * 2.2);
        setProgress(Math.max(0, Math.min(1, (acc.current - WHEEL_PRE_OPEN) / WHEEL_OPEN)));
      }
    };

    window.addEventListener('wheel',      onWheel,      { passive: false });
    window.addEventListener('touchstart', onTouchStart, { passive: true  });
    window.addEventListener('touchmove',  onTouchMove,  { passive: false });
    return () => {
      window.removeEventListener('wheel',      onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove',  onTouchMove);
    };
  }, []);

  return (
    <>
      <style>{`
        .tsf-main {
          flex: 1;
          display: flex;
          min-height: 0;
        }
        .tsf-bag-col {
          width: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding-left: clamp(24px, 5vw, 72px);
        }
        .tsf-text-col {
          width: 50%;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 0 clamp(28px, 5vw, 72px) 0 20px;
        }
        @media (max-width: 600px) {
          .tsf-main        { flex-direction: column; }
          .tsf-bag-col     { width: 100% !important; height: 55%; padding-left: 0 !important; justify-content: center; }
          .tsf-text-col    { width: 100% !important; height: auto; padding: 0 24px 20px !important; align-items: center; text-align: center; }
        }
      `}</style>

      {/* ── Wrapper: 100vh, clips both layers ─────────────────────────────── */}
      <div style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}>

        {/* ── REVEALED LAYER: bag + taste finder text + footer ───────────── */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          backgroundColor: '#f2f1ea',
        }}>

          {/* Main row: bag (left) + taste finder text (right) */}
          <div className="tsf-main">

            <div className="tsf-bag-col">
              <img
                src={bag3}
                alt="Axis & Bloom coffee bag"
                style={{ height: '80%', width: 'auto', maxHeight: 500, objectFit: 'contain', display: 'block' }}
              />
            </div>

            <div className="tsf-text-col">
              <p style={{
                fontFamily: "Arial, sans-serif",
                fontSize: '0.68rem',
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: '#9a2918',
                margin: '0 0 12px',
                opacity: 0.7,
              }}>
                The Taste Finder
              </p>
              <div style={{ fontFamily: "Arial, sans-serif", fontWeight: 400, lineHeight: 0.95, margin: '0 0 20px' }}>
                <span style={{ display: 'block', fontSize: 'clamp(2rem, 3vw, 3.2rem)', color: '#9a2918' }}>
                  Which
                </span>
                <span style={{
                  display: 'inline-block',
                  fontSize: 'clamp(2rem, 3vw, 3.2rem)',
                  backgroundColor: '#ee5974',
                  color: '#f2f1ea',
                  padding: '3px 10px 5px',
                  margin: '5px 0',
                }}>
                  archetype
                </span>
                <span style={{ display: 'block', fontSize: 'clamp(2rem, 3vw, 3.2rem)', color: '#9a2918', marginTop: 5 }}>
                  is yours?
                </span>
              </div>
              <a
                href="/find-my-flavor"
                style={{
                  fontFamily: "Arial, sans-serif",
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

          </div>

          {/* Footer — always visible once curtain lifts */}
          <Footer />

        </div>

        {/* ── CURTAIN: full-screen chaff photo, lifts up as progress → 1 ── */}
        <div
          style={{
            position: 'absolute', inset: 0,
            transform: `translateY(${-(progress * 100)}%)`,
            transition: 'transform 0.12s ease-out',
            willChange: 'transform',
            zIndex: 10,
          }}
        >
          <img
            src={coffeePic13}
            alt=""
            style={{
              width: '100%', height: '100%',
              objectFit: 'cover', objectPosition: 'center',
              display: 'block',
            }}
          />
        </div>

      </div>
    </>
  );
}
