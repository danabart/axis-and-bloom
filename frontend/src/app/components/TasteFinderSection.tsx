import { useRef, useEffect, useState } from 'react';
import coffeePic13 from '../../design/IMAGES/lifestyle/CoffeePic13.png'
import bag3 from '../../design/IMAGES/bags/TransparentBag03.png'

const STRIPE_H = 320; // px — curtain height matches chaff image height exactly

export function TasteFinderSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const calc = () => {
      if (!sectionRef.current) return;
      const { top } = sectionRef.current.getBoundingClientRect();
      const vh = window.innerHeight;
      /*
        Animation window: section enters viewport (top = vh) → section top
        reaches 20% from top of viewport (top = vh * 0.2).
        Scroll distance ≈ 0.8 × vh (~720px on a 900px screen) — smooth,
        no sticky, no extra container space.
      */
      const raw = (vh - top) / (vh * 0.8);
      setProgress(Math.max(0, Math.min(1, raw)));
    };
    window.addEventListener('scroll', calc, { passive: true });
    window.addEventListener('resize', calc);
    calc();
    return () => {
      window.removeEventListener('scroll', calc);
      window.removeEventListener('resize', calc);
    };
  }, []);

  // Curtain slides LEFT from 0% → -100%
  const curtainX = -(progress * 100);

  return (
    /*
      Section is EXACTLY STRIPE_H tall — no extra scroll zone, no empty gap.
      overflow:hidden clips the curtain as it slides left.
      Footer follows immediately in the normal page flow.
    */
    <div
      ref={sectionRef}
      style={{
        position: 'relative',
        height: STRIPE_H,
        overflow: 'hidden',
        backgroundColor: '#f2f1ea',
      }}
    >

      {/* ── REVEALED LAYER ─────────────────────────────────────────────────── */}
      {/* text/CTA left · coffee bag right */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex',
        backgroundColor: '#f2f1ea',
      }}>

        {/* Left: text + CTA */}
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

        {/* Right: coffee bag — first thing revealed as chaff exits left */}
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

      {/* ── CURTAIN LAYER ──────────────────────────────────────────────────── */}
      {/* Same height as section — slides LEFT on scroll */}
      <div
        style={{
          position: 'absolute', inset: 0,
          display: 'flex',
          transform: `translateX(${curtainX}%)`,
          willChange: 'transform',
          zIndex: 10,
        }}
      >

        {/* Left: editorial text */}
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
            margin: '0 0 14px',
          }}>
            <span style={{ display: 'block', fontSize: 'clamp(2rem, 3.8vw, 3.8rem)', color: '#9a2918' }}>
              Which
            </span>
            <span style={{
              display: 'inline-block',
              fontSize: 'clamp(2rem, 3.8vw, 3.8rem)',
              backgroundColor: '#ee5974',
              color: '#f2f1ea',
              padding: '2px 10px',
              margin: '3px 0',
            }}>
              archetype
            </span>
            <span style={{ display: 'block', fontSize: 'clamp(2rem, 3.8vw, 3.8rem)', color: '#9a2918', marginTop: 3 }}>
              is yours?
            </span>
          </div>

          <p style={{
            fontFamily: "'Genova', sans-serif",
            fontSize: 'clamp(0.78rem, 1vw, 0.88rem)',
            fontWeight: 400,
            color: '#7b7f80',
            lineHeight: 1.65,
            margin: '0 0 14px',
            maxWidth: 300,
          }}>
            Our flavor system removes the guesswork — answer a few questions and find your perfect coffee match.
          </p>

          <a
            href="/find-my-flavor"
            style={{
              fontFamily: "'Genova', sans-serif",
              fontSize: '0.74rem',
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

        {/* Right: chaff photo — fills remaining 58% */}
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
  );
}
