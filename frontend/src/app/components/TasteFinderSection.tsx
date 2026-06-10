import { useRef, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import coffeePic13 from '../../design/IMAGES/lifestyle/CoffeePic13.png'
import transparentBag03 from '../../design/IMAGES/bags/TransparentBag03.png'

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

  let maskX = 0;
  if (progress > 0.9) maskX = -105;
  else if (progress > 0.1) maskX = -((progress - 0.1) / 0.8) * 105;

  return (
    <div ref={containerRef} className="h-[160vh] relative z-0" style={{ backgroundColor: '#f2f1ea' }}>
      <div className="sticky top-0 h-screen w-full overflow-hidden">

        {/* Revealed layer — coffee bag + quiz copy */}
        <div className="absolute inset-0 z-0 w-full h-full flex flex-col md:flex-row" style={{ backgroundColor: '#f2f1ea' }}>
          {/* Left: coffee bag */}
          <div className="w-full md:w-1/2 h-1/2 md:h-full flex items-center justify-center relative overflow-hidden">
            <img
              src={transparentBag03}
              alt="Axis & Bloom coffee bag"
              style={{ width: '120%', maxWidth: 520, height: '100%', objectFit: 'contain', objectPosition: 'center', display: 'block' }}
            />
          </div>
          {/* Right: quiz copy + CTA */}
          <div className="w-full md:w-1/2 h-1/2 md:h-full flex flex-col justify-end p-10 md:p-16 relative z-10">
            <div className="flex flex-col items-start text-left mb-4 md:mb-8">
              <p style={{ fontFamily: "'Genova', sans-serif", color: '#b15643', fontSize: 'clamp(1rem, 1.8vw, 1.4rem)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                Our flavor system is designed to remove the guesswork. Answer a few questions and find your perfect coffee match.
              </p>
              <a
                href="https://axisandbloomcoffee.com/find-my-flavor"
                style={{ fontFamily: "'Genova', sans-serif", color: '#b15643', fontSize: 'clamp(0.9rem, 1.3vw, 1.1rem)', letterSpacing: '0.18em', textTransform: 'uppercase', textDecoration: 'none', borderBottom: '2px solid #b15643', paddingBottom: 2 }}
              >
                TAKE THE QUIZ →
              </a>
            </div>
          </div>
        </div>

        {/* Curtain layer — split layout, slides on scroll */}
        <motion.div
          className="absolute inset-0 z-10 w-full h-full flex flex-col md:flex-row will-change-transform"
          style={{ transform: `translateX(${maskX}%)` }}
        >
          {/* Left: editorial text on clean background */}
          <div
            className="w-full md:w-1/2 h-1/2 md:h-full flex flex-col justify-center"
            style={{ backgroundColor: '#f2f1ea', padding: 'clamp(28px, 4vw, 52px) clamp(28px, 4vw, 56px)' }}
          >
            <p style={{ fontFamily: "'Genova', sans-serif", fontSize: '0.68rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: '#9a2918', margin: '0 0 20px' }}>
              The Taste Finder
            </p>
            <div style={{ fontFamily: "'Genova', sans-serif", fontWeight: 400, lineHeight: 1.0, margin: '0 0 24px' }}>
              <span style={{ display: 'block', fontSize: 'clamp(1.8rem, 3.5vw, 3.2rem)', color: '#9a2918' }}>Which</span>
              <span style={{ display: 'inline-block', fontSize: 'clamp(1.8rem, 3.5vw, 3.2rem)', backgroundColor: '#ee5974', color: '#f2f1ea', padding: '2px 10px', margin: '3px 0' }}>archetype</span>
              <span style={{ display: 'block', fontSize: 'clamp(1.8rem, 3.5vw, 3.2rem)', color: '#9a2918', marginTop: 3 }}>is yours?</span>
            </div>
            <p style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(0.82rem, 1.1vw, 0.92rem)', fontWeight: 400, color: '#7b7f80', lineHeight: 1.75, margin: '0 0 24px', maxWidth: 320 }}>
              Our flavor system removes the guesswork — answer a few questions and find your perfect coffee match.
            </p>
            <a
              href="/find-my-flavor"
              style={{ fontFamily: "'Genova', sans-serif", fontSize: '0.75rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#9a2918', textDecoration: 'none', borderBottom: '1px solid rgba(154,41,24,0.4)', paddingBottom: 3, width: 'fit-content' }}
            >
              TAKE THE QUIZ →
            </a>
          </div>

          {/* Right: chaff photo */}
          <div className="w-full md:w-1/2 h-1/2 md:h-full" style={{ position: 'relative', overflow: 'hidden' }}>
            <img
              src={coffeePic13}
              alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }}
            />
          </div>
        </motion.div>

      </div>
    </div>
  );
}
