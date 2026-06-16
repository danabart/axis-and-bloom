import { useRef, useEffect, useState } from 'react';
import coffeePic13 from '../../design/IMAGES/lifestyle/CoffeePic13.png';
import bag3 from '../../design/IMAGES/bags/TransparentBag03.png';
import Footer from './Footer';

/*
  Architecture:
  - The wrapper is exactly STRIPE_H tall in normal document flow — no empty space.
  - The curtain (chaff photo) sits position:absolute over the stripe and slides LEFT.
  - Wheel / touch events are intercepted at page-bottom to drive the animation.
  - The footer is NOT in the DOM until the hold phase completes (footerShown ref).
    When footer appears, page scrollHeight grows and the user can naturally scroll to it.

  Stage timeline — acc range [-CLOSE_HOLD, HOLD_END]:

  Opening (scroll down):
    0    → PRE_OPEN (400):           pre-open wait — nothing moves
    400  → PRE_OPEN+OPEN (2400):     curtain slides open, progress 0→1
    2400 → HOLD_END (3100):          open hold (700 units) — bag visible, breathe before footer
    3100:                            footer added to DOM

  Closing (scroll up) — mirrors opening in reverse:
    3100 → 2400:                     open hold reverse (curtain stays at 100%)
    2400 → 400:                      curtain slides closed, progress 1→0
    400  → 0:                        pre-open wait reverse (curtain shut, page intercepted)
    0    → -CLOSE_HOLD (-600):       close hold — curtain stays shut before page scrolls up
    -600:                            interception released, page scrolls up

  Re-opening from close hold: acc snaps to 0 so curtain moves immediately.

  progress = max(0, min(1, (acc - PRE_OPEN) / OPEN))
*/

const STRIPE_H         = 360;
const WHEEL_PRE_OPEN   = 400;   // wait before curtain starts moving
const WHEEL_OPEN       = 2000;  // curtain travel — deliberate, gift-unwrapping pace
const WHEEL_HOLD_END   = WHEEL_PRE_OPEN + WHEEL_OPEN + 700; // 3100: footer appears
const WHEEL_CLOSE_HOLD = 600;   // pause after curtain shuts before page scrolls up

export function TasteFinderSection() {
  const [progress, setProgress]     = useState(0);
  const [footerVisible, setFooterVisible] = useState(false);
  const acc         = useRef(0);
  const footerShown = useRef(false); // ref so event handler sees latest value without re-binding

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const atBottom  = window.scrollY >= maxScroll - 3;

      // ── Scrolling down at page bottom → pre-open wait → open → hold ─────
      if (atBottom && e.deltaY > 0 && acc.current < WHEEL_HOLD_END) {
        e.preventDefault();
        if (acc.current < 0) acc.current = 0; // skip close-hold zone on re-open
        acc.current = Math.min(WHEEL_HOLD_END, acc.current + e.deltaY);
        setProgress(Math.max(0, Math.min(1, (acc.current - WHEEL_PRE_OPEN) / WHEEL_OPEN)));
        if (acc.current >= WHEEL_HOLD_END && !footerShown.current) {
          footerShown.current = true;
          setFooterVisible(true);
        }
        return;
      }

      // ── Scrolling up → open-hold reverse → curtain closes → close hold ───
      if (e.deltaY < 0 && acc.current > -WHEEL_CLOSE_HOLD) {
        e.preventDefault();
        acc.current = Math.max(-WHEEL_CLOSE_HOLD, acc.current + e.deltaY);
        setProgress(Math.max(0, Math.min(1, (acc.current - WHEEL_PRE_OPEN) / WHEEL_OPEN)));
        // Hide footer the moment curtain reaches fully closed (acc ≤ PRE_OPEN, progress = 0)
        if (acc.current <= WHEEL_PRE_OPEN && footerShown.current) {
          footerShown.current = false;
          setFooterVisible(false);
        }
      }
    };

    // ── Touch (mobile) — same logic, 2.2× multiplier for finger velocity ─────
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
        if (acc.current >= WHEEL_HOLD_END && !footerShown.current) {
          footerShown.current = true;
          setFooterVisible(true);
        }
      } else if (delta < 0 && acc.current > -WHEEL_CLOSE_HOLD) {
        e.preventDefault();
        acc.current = Math.max(-WHEEL_CLOSE_HOLD, acc.current + delta * 2.2);
        setProgress(Math.max(0, Math.min(1, (acc.current - WHEEL_PRE_OPEN) / WHEEL_OPEN)));
        if (acc.current <= WHEEL_PRE_OPEN && footerShown.current) {
          footerShown.current = false;
          setFooterVisible(false);
        }
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
        /* ── Stripe wrapper: fixed height on both breakpoints ── */
        .tsf-stripe { position: relative; overflow: hidden; }
        @media (min-width: 601px) { .tsf-stripe { height: ${STRIPE_H}px; } }
        @media (max-width: 600px) { .tsf-stripe { height: 440px; } }

        /* ── Revealed layer ── */
        .tsf-revealed { display: flex; height: 100%; background: #f2f1ea; }
        .tsf-bag-col  {
          width: 50%; display: flex; align-items: center;
          justify-content: center; padding-left: clamp(24px, 5vw, 72px);
        }
        .tsf-text-col {
          width: 50%; display: flex; flex-direction: column;
          justify-content: center; align-items: flex-end; text-align: right;
          padding: 0 clamp(28px, 5vw, 72px) 0 20px;
        }

        /* ── Curtain layer ── */
        .tsf-curtain       { display: flex; height: 100%; }
        .tsf-curtain-text  {
          width: 40%; flex-shrink: 0; background: #f2f1ea;
          display: flex; flex-direction: column; justify-content: center;
          padding: 24px clamp(18px, 3.2vw, 48px);
        }
        .tsf-curtain-photo { flex: 1; position: relative; overflow: hidden; }

        /* ── Mobile: stack vertically ── */
        @media (max-width: 600px) {
          .tsf-revealed { flex-direction: column; }
          .tsf-bag-col  { width: 100% !important; height: 55% !important; padding: 20px 24px 0 !important; }
          .tsf-text-col { width: 100% !important; height: 45% !important; align-items: center !important; text-align: center !important; padding: 12px 24px 20px !important; }
          .tsf-curtain       { flex-direction: column; }
          .tsf-curtain-text  { width: 100% !important; height: 42% !important; padding: 18px 24px 10px !important; }
          .tsf-curtain-photo { flex: 1 !important; }
        }
      `}</style>

      {/* ── Stripe wrapper — exactly STRIPE_H tall, no extra space ──────────── */}
      <div className="tsf-stripe">

        {/* ── REVEALED LAYER: bag left / text right ─────────────────────────── */}
        <div className="tsf-revealed" style={{ position: 'absolute', inset: 0 }}>

          <div className="tsf-bag-col">
            <img
              src={bag3}
              alt="Axis & Bloom coffee bag"
              style={{ height: '88%', width: 'auto', objectFit: 'contain', display: 'block' }}
            />
          </div>

          <div className="tsf-text-col">
            <p style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 'clamp(0.95rem, 1.35vw, 1.25rem)',
              fontWeight: 400,
              color: '#9a2918',
              opacity: 0.65,
              lineHeight: 1.85,
              margin: '0 0 24px',
              maxWidth: 400,
            }}>
              Our flavor system is designed to remove the guesswork.
              Answer a few questions and find your perfect coffee match.
            </p>
            <a
              href="/find-my-flavor"
              style={{
                fontFamily: "Arial, sans-serif",
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

        {/* ── CURTAIN LAYER: cream text panel + chaff photo, slides LEFT ──────── */}
        <div
          className="tsf-curtain"
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translateX(${-(progress * 100)}%)`,
            transition: 'transform 0.05s ease-out',
            willChange: 'transform',
            zIndex: 10,
          }}
        >
          {/* Left cream panel — "Which archetype is yours?" on cream, not on chaff */}
          <div className="tsf-curtain-text">
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
            <div style={{ fontFamily: "Arial, sans-serif", fontWeight: 400, lineHeight: 0.95, margin: '0 0 16px' }}>
              <span style={{ display: 'block', fontSize: 'clamp(1.9rem, 2.8vw, 3rem)', color: '#9a2918' }}>
                Which
              </span>
              <span style={{
                display: 'inline-block',
                fontSize: 'clamp(1.9rem, 2.8vw, 3rem)',
                backgroundColor: '#ee5974',
                color: '#f2f1ea',
                padding: '3px 10px 5px',
                margin: '5px 0',
              }}>
                archetype
              </span>
              <span style={{ display: 'block', fontSize: 'clamp(1.9rem, 2.8vw, 3rem)', color: '#9a2918', marginTop: 5 }}>
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

          {/* Right chaff photo — full-bleed within its 60% panel */}
          <div className="tsf-curtain-photo">
            <img
              src={coffeePic13}
              alt=""
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover', objectPosition: 'center',
                display: 'block',
              }}
            />
          </div>
        </div>

      </div>{/* /stripe wrapper */}

      {/* Footer — added to DOM only after hold completes.                        */}
      {/* Page scrollHeight grows when it appears; user scrolls naturally to it. */}
      {footerVisible && <Footer />}
    </>
  );
}
