import { useRef, useEffect, useState } from 'react';
import coffeePic13 from '../../design/IMAGES/lifestyle/CoffeePic13.png';
import bag3 from '../../design/IMAGES/bags/TransparentBag03.png';
import Footer from './Footer';

const STRIPE_H = 320;

/*
  How this works:
  - The page scrolls normally until it hits its natural bottom.
  - At that point, further wheel/swipe motion opens the curtain LEFT instead of scrolling.
  - The curtain must be fully closed and visible before any animation begins.
  - Scrolling back up closes the curtain before the page scrolls up again.
*/
const WHEEL_OPEN = 480; // total deltaY needed to fully open curtain

export function TasteFinderSection() {
  const [progress, setProgress] = useState(0);
  const acc = useRef(0);

  useEffect(() => {
    // ── Mouse / trackpad wheel ──────────────────────────────────────────────
    const onWheel = (e: WheelEvent) => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const atBottom = window.scrollY >= maxScroll - 3;

      if (atBottom && e.deltaY > 0 && acc.current < WHEEL_OPEN) {
        // At page bottom, scrolling down → open curtain instead of scrolling
        e.preventDefault();
        acc.current = Math.min(WHEEL_OPEN, acc.current + e.deltaY);
        setProgress(acc.current / WHEEL_OPEN);
        return;
      }

      if (e.deltaY < 0 && acc.current > 0) {
        // Curtain partially open, scrolling up → close curtain before page scrolls
        e.preventDefault();
        acc.current = Math.max(0, acc.current + e.deltaY); // deltaY is negative
        setProgress(acc.current / WHEEL_OPEN);
      }
    };

    // ── Touch (mobile) ──────────────────────────────────────────────────────
    let touchY = 0;

    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const atBottom = window.scrollY >= maxScroll - 3;
      const delta = touchY - e.touches[0].clientY; // positive = finger moving up = scroll down
      touchY = e.touches[0].clientY;

      if (atBottom && delta > 0 && acc.current < WHEEL_OPEN) {
        e.preventDefault();
        acc.current = Math.min(WHEEL_OPEN, acc.current + delta * 2.2);
        setProgress(acc.current / WHEEL_OPEN);
      } else if (delta < 0 && acc.current > 0) {
        e.preventDefault();
        acc.current = Math.max(0, acc.current + delta * 2.2);
        setProgress(acc.current / WHEEL_OPEN);
      }
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });

    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>

      {/* ── REVEALED LAYER: normal flow → defines wrapper height ─────────────── */}
      <div>

        {/* Stripe row: bag LEFT · text RIGHT */}
        <div style={{ height: STRIPE_H, display: 'flex', backgroundColor: '#f2f1ea' }}>

          {/* Left 50% — coffee bag */}
          <div style={{
            width: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}>
            <img
              src={bag3}
              alt="Axis & Bloom coffee bag"
              style={{ height: '86%', width: 'auto', objectFit: 'contain', display: 'block' }}
            />
          </div>

          {/* Right 50% — text + CTA, right-aligned */}
          <div style={{
            width: '50%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'flex-end',
            textAlign: 'right',
            padding: '32px clamp(28px, 5vw, 72px) 32px 24px',
          }}>
            <p style={{
              fontFamily: "'Genova', sans-serif",
              fontSize: 'clamp(0.85rem, 1.1vw, 0.98rem)',
              fontWeight: 400,
              color: '#9a2918',
              opacity: 0.65,
              lineHeight: 1.8,
              margin: '0 0 22px',
              maxWidth: 360,
            }}>
              Our flavor system is designed to remove the guesswork.
              Answer a few questions and find your perfect coffee match.
            </p>
            <a
              href="/find-my-flavor"
              style={{
                fontFamily: "'Genova', sans-serif",
                fontSize: '0.78rem',
                letterSpacing: '0.2em',
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

        {/* Footer lives behind the curtain — the last thing revealed */}
        <Footer />
      </div>

      {/* ── CURTAIN LAYER: covers full wrapper (stripe + footer), slides LEFT ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          transform: `translateX(${-(progress * 100)}%)`,
          transition: 'transform 0.08s ease-out',
          willChange: 'transform',
          zIndex: 10,
        }}
      >
        {/* Left 40% — editorial text panel */}
        <div style={{
          width: '40%',
          flexShrink: 0,
          backgroundColor: '#f2f1ea',
        }}>
          <div style={{
            height: STRIPE_H,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '28px clamp(20px, 3.5vw, 52px)',
          }}>
            <p style={{
              fontFamily: "'Genova', sans-serif",
              fontSize: '0.68rem',
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: '#9a2918',
              margin: '0 0 12px',
            }}>
              The Taste Finder
            </p>

            <div style={{
              fontFamily: "'Genova', sans-serif",
              fontWeight: 400,
              lineHeight: 0.95,
              margin: '0 0 14px',
            }}>
              <span style={{ display: 'block', fontSize: 'clamp(1.8rem, 2.8vw, 3rem)', color: '#9a2918' }}>
                Which
              </span>
              <span style={{
                display: 'inline-block',
                fontSize: 'clamp(1.8rem, 2.8vw, 3rem)',
                backgroundColor: '#ee5974',
                color: '#f2f1ea',
                padding: '2px 10px 4px',
                margin: '4px 0',
              }}>
                archetype
              </span>
              <span style={{ display: 'block', fontSize: 'clamp(1.8rem, 2.8vw, 3rem)', color: '#9a2918', marginTop: 4 }}>
                is yours?
              </span>
            </div>

            <p style={{
              fontFamily: "'Genova', sans-serif",
              fontSize: 'clamp(0.75rem, 0.88vw, 0.85rem)',
              fontWeight: 400,
              color: '#9a2918',
              opacity: 0.55,
              lineHeight: 1.65,
              margin: '0 0 14px',
              maxWidth: 260,
            }}>
              Our flavor system removes the guesswork — answer a few questions and find your perfect coffee match.
            </p>

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
          {/* Plain cream continues below stripe height, covering the footer area */}
        </div>

        {/* Right 60% — chaff photo, full-bleed across entire curtain height */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
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

    </div>
  );
}
