import { useRef, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import bag3 from '../../design/IMAGES/bags/TransparentBag03.png'

export function TasteFinderSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const totalScroll = rect.height - viewportHeight;
      const scrolled = -rect.top;
      setProgress(Math.max(0, Math.min(1, scrolled / totalScroll)));
    };
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    handleScroll();
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, []);

  // Curtain slides from 10%→90% of scroll progress
  let maskX = 0;
  if (progress > 0.9) maskX = -105;
  else if (progress > 0.1) maskX = -((progress - 0.1) / 0.8) * 105;

  return (
    <div ref={containerRef} className="h-[200vh] relative z-0" style={{ backgroundColor: '#f2f1ea' }}>
      <div className="sticky top-0 h-screen w-full overflow-hidden">

        {/* Revealed layer: bag (left) + text/CTA (right) */}
        <div style={{ position: 'absolute', inset: 0, backgroundColor: '#f2f1ea', display: 'flex' }}>

          {/* Left: bag image, centered */}
          <div style={{
            width: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            paddingLeft: 'clamp(40px, 6vw, 96px)',
          }}>
            <img
              src={bag3}
              alt="Axis & Bloom coffee bag"
              style={{ height: '68vh', width: 'auto', objectFit: 'contain', display: 'block' }}
            />
          </div>

          {/* Right: text + CTA, right-aligned, slightly below center */}
          <div style={{
            width: '50%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            paddingTop: '10vh',
            paddingRight: 'clamp(40px, 6vw, 96px)',
            alignItems: 'flex-end',
            textAlign: 'right',
          }}>
            <p style={{
              fontFamily: "'Genova', sans-serif",
              fontSize: 'clamp(1rem, 1.4vw, 1.2rem)',
              fontWeight: 400,
              color: '#9a2918',
              lineHeight: 1.75,
              margin: '0 0 28px',
              maxWidth: 380,
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
              }}
            >
              TAKE THE QUIZ →
            </a>
          </div>

        </div>

        {/* Curtain: solid terracotta panel that slides left on scroll to reveal content */}
        <motion.div
          className="will-change-transform"
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: '#9a2918',
            transform: `translateX(${maskX}%)`,
            zIndex: 10,
          }}
        />

      </div>
    </div>
  );
}
