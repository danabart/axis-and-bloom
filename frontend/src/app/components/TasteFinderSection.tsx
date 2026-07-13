import { useRef, useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { Link } from 'react-router';
import Footer from './Footer';
import spicyEarthyPattern from '../../design/IMAGES/patterns/spicy-earthy-2048.jpg';

interface Props {
  visitorName?: string;
}

export function TasteFinderSection({ visitorName }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const onScroll = () => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const { top, height } = wrapper.getBoundingClientRect();
      const total = height - window.innerHeight;
      setProgress(Math.min(1, Math.max(0, -top / total)));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const hold = 0.35;
  const slide = progress < hold ? 0 : (progress - hold) / (1 - hold);
  const name = (visitorName || localStorage.getItem('axisbloom.name') || '').trim().toUpperCase() || 'YOU';

  return (
    <div ref={wrapperRef} style={{ position: 'relative', height: '280vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden', isolation: 'isolate' }}>

        {/* ── Layer A: reveal beneath the curtain ──────────────────────── */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundColor: '#f2f1ea',
          display: 'grid', gridTemplateColumns: '1fr 1.2fr',
          alignItems: 'center',
          padding: '0 40px',
          boxSizing: 'border-box',
          paddingBottom: 80,
        }}>
          {/* Bag addressed to visitor — scales down on short viewports, never cropped */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <svg
              viewBox="0 0 230 320"
              aria-label={`Coffee bag addressed from Axis and Bloom to ${name}`}
              style={{ height: 'clamp(240px, 38vh, 320px)', width: 'auto', display: 'block' }}
            >
              <path d="M30 38 Q30 24 44 24 L186 24 Q200 24 200 38 L200 282 Q200 296 186 296 L44 296 Q30 296 30 282 Z" fill="#9a2918" />
              <rect x="30" y="24" width="170" height="26" rx="8" fill="#7c2020" />
              <rect x="30" y="196" width="170" height="10" fill="#f2f1ea" opacity=".85" />
              <rect x="30" y="210" width="170" height="8" fill="#6e1c1c" />
              <rect x="30" y="222" width="170" height="8" fill="#f2f1ea" opacity=".35" />
              <text x="48" y="84" fill="#f2f1ea" fontSize="11" letterSpacing="2" fontFamily="Lato,sans-serif">FROM:</text>
              <text x="48" y="108" fill="#f2f1ea" fontSize="17" letterSpacing="2" fontFamily="Lato,sans-serif">AXIS &amp; BLOOM</text>
              <text x="48" y="140" fill="#f2f1ea" fontSize="11" letterSpacing="2" fontFamily="Lato,sans-serif">TO:</text>
              <text x="48" y="170" fill="#f2f1ea" fontSize="24" letterSpacing="1" fontFamily="Lato,sans-serif">{name}</text>
            </svg>
          </div>

          {/* Copy + CTA */}
          <div>
            <span style={{ display: 'block', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#9a2918', marginBottom: 14 }}>
              The taste finder
            </span>
            <h2 style={{ fontSize: 'clamp(36px,4.6vw,60px)', fontWeight: 400, lineHeight: 1.18, margin: '0 0 32px', color: '#9a2918' }}>
              Which{' '}
              <span style={{ backgroundColor: '#ee5974', color: '#f2f1ea', padding: '2px 10px' }}>archetype</span>
              <br />is yours?
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
              <Link
                to="/find-my-flavor"
                style={{ display: 'inline-block', backgroundColor: '#9a2918', color: '#f2f1ea', padding: '14px 28px', fontSize: '0.75rem', letterSpacing: '0.14em', textTransform: 'uppercase', textDecoration: 'none' }}
              >
                Take the quiz →
              </Link>
              <Link
                to="/sign-in"
                style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#45474a', textDecoration: 'none', borderBottom: '1px solid #45474a', paddingBottom: 2 }}
              >
                Or sign in
              </Link>
            </div>
          </div>

          {/* Footer pinned to bottom */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
            <Footer />
          </div>
        </div>

        {/* ── Layer B: official Spicy & Earthy tissue-paper curtain ─────── */}
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 10,
            backgroundColor: '#9a2918',
            backgroundImage: `url(${spicyEarthyPattern})`,
            backgroundSize: 'clamp(900px, 80vw, 1400px)',
            backgroundPosition: 'center',
            backgroundRepeat: 'repeat',
            willChange: 'transform',
            ...(prefersReducedMotion
              ? { opacity: Math.max(0, 1 - progress * 2), transform: 'none' }
              : { transform: `translateX(${-slide * 100}%)`, opacity: 1 }),
          }}
        >
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 6, backgroundColor: 'rgba(0,0,0,.15)' }} />
          <div style={{ position: 'absolute', bottom: 40, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
            <span style={{ color: 'rgba(242,241,234,.9)', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              Keep scrolling to unwrap
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
