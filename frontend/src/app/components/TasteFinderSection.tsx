import { useRef, useEffect, useState } from 'react';
import coffeePic13 from '../../design/IMAGES/lifestyle/CoffeePic13.png'
import bag3 from '../../design/IMAGES/bags/TransparentBag03.png'

const STRIPE_H = 380; // matches the reference image proportions

export function TasteFinderSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const calc = () => {
      if (!sectionRef.current) return;
      const { top } = sectionRef.current.getBoundingClientRect();
      const vh = window.innerHeight;
      /*
        Animation window:
          start  → section just fully entered viewport: top = vh - STRIPE_H
          end    → section top at viewport top:         top = 0
        Scroll distance ≈ vh - STRIPE_H  (~520px at 900px viewport).
        Progress clamps 0→1, curtain fully gone when top reaches 0.
      */
      const raw = (vh - STRIPE_H - top) / (vh - STRIPE_H);
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

  // Curtain slides LEFT: 0% → -100% (completely exits left edge)
  const curtainX = -(progress * 100);

  return (
    /*
      Section = exactly STRIPE_H tall, overflow:hidden clips curtain.
      No scroll zone, no sticky — footer sits directly below, tight.
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

      {/* ── REVEALED LAYER: bag LEFT · text/CTA RIGHT ──────────────────────── */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex',
        backgroundColor: '#f2f1ea',
      }}>

        {/* Left 50%: coffee bag centered */}
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
            style={{
              height: '88%',
              width: 'auto',
              objectFit: 'contain',
              display: 'block',
            }}
          />
        </div>

        {/* Right 50%: explanatory text + CTA */}
        <div style={{
          width: '50%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '32px clamp(28px, 4vw, 64px) 32px 24px',
        }}>
          <p style={{
            fontFamily: "'Genova', sans-serif",
            fontSize: 'clamp(0.88rem, 1.15vw, 1rem)',
            fontWeight: 400,
            color: '#7b7f80',
            lineHeight: 1.75,
            margin: '0 0 20px',
            maxWidth: 360,
          }}>
            Our flavor system is designed to remove the guesswork. Answer a few questions and find your perfect coffee match.
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
              width: 'fit-content',
            }}
          >
            TAKE THE QUIZ →
          </a>
        </div>

      </div>

      {/* ── CURTAIN: text LEFT (40%) · chaff photo RIGHT (60%) ─────────────── */}
      {/* Slides entirely LEFT on scroll — exits through left edge of section */}
      <div
        style={{
          position: 'absolute', inset: 0,
          display: 'flex',
          transform: `translateX(${curtainX}%)`,
          willChange: 'transform',
          zIndex: 10,
        }}
      >

        {/* Left 40%: editorial text on cream background */}
        <div style={{
          width: '40%',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '32px clamp(28px, 4vw, 64px)',
          backgroundColor: '#f2f1ea',
        }}>
          <p style={{
            fontFamily: "'Genova', sans-serif",
            fontSize: '0.72rem',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: '#9a2918',
            margin: '0 0 14px',
          }}>
            The Taste Finder
          </p>

          <div style={{
            fontFamily: "'Genova', sans-serif",
            fontWeight: 400,
            lineHeight: 0.95,
            margin: '0 0 18px',
          }}>
            <span style={{ display: 'block', fontSize: 'clamp(2.6rem, 4vw, 4rem)', color: '#9a2918' }}>
              Which
            </span>
            <span style={{
              display: 'inline-block',
              fontSize: 'clamp(2.6rem, 4vw, 4rem)',
              backgroundColor: '#ee5974',
              color: '#f2f1ea',
              padding: '2px 12px',
              margin: '5px 0',
            }}>
              archetype
            </span>
            <span style={{ display: 'block', fontSize: 'clamp(2.6rem, 4vw, 4rem)', color: '#9a2918', marginTop: 5 }}>
              is yours?
            </span>
          </div>

          <p style={{
            fontFamily: "'Genova', sans-serif",
            fontSize: 'clamp(0.82rem, 1vw, 0.9rem)',
            fontWeight: 400,
            color: '#7b7f80',
            lineHeight: 1.65,
            margin: '0 0 16px',
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

        {/* Right 60%: chaff photo full-bleed */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <img
            src={coffeePic13}
            alt=""
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
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
