import { useRef, useEffect, useState } from 'react';
import coffeePic13 from '../../design/IMAGES/lifestyle/CoffeePic13.png'
import bag3 from '../../design/IMAGES/bags/TransparentBag03.png'

// Stripe height defines everything — no viewport-relative sizing
const STRIPE_H = 320;
// Extra scroll distance for the animation — compact, not 200vh
const SCROLL_ZONE = 440;

export function TasteFinderSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;
      const top = containerRef.current.getBoundingClientRect().top;
      // Animates as the section scrolls through SCROLL_ZONE px past the top of viewport
      setProgress(Math.min(1, Math.max(0, -top / SCROLL_ZONE)));
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    handleScroll();
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, []);

  // Curtain slides LEFT: 0% → -100%
  const curtainX = -(progress * 100);

  return (
    /*
      Container = STRIPE_H (sticky stripe) + SCROLL_ZONE (animation scroll space).
      Total ≈ 760px — compact, not a full-screen scene.
    */
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        height: STRIPE_H + SCROLL_ZONE,
        backgroundColor: '#f2f1ea',
      }}
    >
      {/* Sticky wrapper — pins the stripe at viewport top during the scroll zone */}
      <div style={{ position: 'sticky', top: 0, height: STRIPE_H }}>

        {/* Clip wrapper — keeps the curtain from spilling outside the stripe */}
        <div style={{ position: 'relative', height: STRIPE_H, overflow: 'hidden' }}>

          {/* ── REVEALED LAYER (underneath) ──────────────────────────────────── */}
          {/* text/CTA left · coffee bag right */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex',
            backgroundColor: '#f2f1ea',
          }}>

            {/* Left: explanatory text + CTA */}
            <div style={{
              width: '42%',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '32px clamp(28px, 4vw, 64px)',
            }}>
              <p style={{
                fontFamily: "'Genova', sans-serif",
                fontSize: 'clamp(0.84rem, 1.1vw, 0.95rem)',
                fontWeight: 400,
                color: '#7b7f80',
                lineHeight: 1.7,
                margin: '0 0 18px',
                maxWidth: 340,
              }}>
                Our flavor system is designed to remove the guesswork. Answer a few questions and find your perfect coffee match.
              </p>
              <a
                href="/find-my-flavor"
                style={{
                  fontFamily: "'Genova', sans-serif",
                  fontSize: '0.78rem',
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: '#9a2918',
                  textDecoration: 'none',
                  borderBottom: '1px solid rgba(154,41,24,0.4)',
                  paddingBottom: 3,
                  width: 'fit-content',
                }}
              >
                TAKE THE QUIZ →
              </a>
            </div>

            {/* Right: coffee bag — revealed last as chaff exits left */}
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}>
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

          </div>

          {/* ── CURTAIN LAYER (on top, slides LEFT on scroll) ────────────────── */}
          {/* Same height as stripe — no extra vertical space */}
          <div
            style={{
              position: 'absolute', inset: 0,
              display: 'flex',
              transform: `translateX(${curtainX}%)`,
              willChange: 'transform',
              zIndex: 10,
            }}
          >

            {/* Left panel: editorial text */}
            <div style={{
              width: '42%',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '32px clamp(28px, 4vw, 64px)',
              backgroundColor: '#f2f1ea',
            }}>
              <p style={{
                fontFamily: "'Genova', sans-serif",
                fontSize: '0.74rem',
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: '#9a2918',
                margin: '0 0 16px',
              }}>
                The Taste Finder
              </p>

              <div style={{
                fontFamily: "'Genova', sans-serif",
                fontWeight: 400,
                lineHeight: 0.92,
                margin: '0 0 18px',
              }}>
                <span style={{ display: 'block', fontSize: 'clamp(2.4rem, 4.5vw, 4.5rem)', color: '#9a2918' }}>
                  Which
                </span>
                <span style={{
                  display: 'inline-block',
                  fontSize: 'clamp(2.4rem, 4.5vw, 4.5rem)',
                  backgroundColor: '#ee5974',
                  color: '#f2f1ea',
                  padding: '2px 12px',
                  margin: '4px 0',
                }}>
                  archetype
                </span>
                <span style={{ display: 'block', fontSize: 'clamp(2.4rem, 4.5vw, 4.5rem)', color: '#9a2918', marginTop: 4 }}>
                  is yours?
                </span>
              </div>

              <p style={{
                fontFamily: "'Genova', sans-serif",
                fontSize: 'clamp(0.84rem, 1.1vw, 0.95rem)',
                fontWeight: 400,
                color: '#7b7f80',
                lineHeight: 1.7,
                margin: '0 0 18px',
                maxWidth: 340,
              }}>
                Our flavor system removes the guesswork — answer a few questions and find your perfect coffee match.
              </p>

              <a
                href="/find-my-flavor"
                style={{
                  fontFamily: "'Genova', sans-serif",
                  fontSize: '0.78rem',
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: '#9a2918',
                  textDecoration: 'none',
                  borderBottom: '1px solid rgba(154,41,24,0.4)',
                  paddingBottom: 3,
                  width: 'fit-content',
                }}
              >
                TAKE THE QUIZ →
              </a>
            </div>

            {/* Right panel: chaff photo — fills remaining 58% */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
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

        </div>
      </div>
    </div>
  );
}
