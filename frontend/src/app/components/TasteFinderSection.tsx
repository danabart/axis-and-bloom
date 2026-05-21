import { useRef, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Link } from 'react-router';

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
    <div ref={containerRef} className="h-[200vh] relative z-0" style={{ backgroundColor: '#f2f1ea' }}>
      <div className="sticky top-0 h-screen w-full overflow-hidden">
        <div className="absolute inset-0 z-0 w-full h-full flex flex-col md:flex-row" style={{ backgroundColor: '#f2f1ea' }}>
          <div className="w-full md:w-1/2 h-1/2 md:h-full flex items-center justify-center relative overflow-hidden">
            <div className="w-1/2 h-48 bg-[#deded1] flex items-center justify-center">
              <span className="text-[#a33726] text-xs uppercase tracking-widest">Axis & Bloom</span>
            </div>
          </div>
          <div className="w-full md:w-1/2 h-1/2 md:h-full flex flex-col justify-end p-12 md:p-24 relative z-10">
            <div className="max-w-xl flex flex-col items-start text-left mb-4 md:mb-12">
              <p className="text-2xl md:text-3xl leading-relaxed mb-8" style={{ color: '#b15643' }}>
                Our flavor system is designed to remove the guesswork. Answer a few questions and find your perfect coffee match.
              </p>
              <Link to="/find-my-flavor" className="text-lg md:text-xl uppercase tracking-widest group relative inline-flex items-center" style={{ color: '#b15643' }}>
                <span className="relative pb-1">
                  TAKE THE QUIZ →
                  <span className="absolute bottom-0 left-0 w-0 h-[2px] transition-all duration-500 ease-out group-hover:w-full" style={{ backgroundColor: '#b15643' }} />
                </span>
              </Link>
            </div>
          </div>
        </div>

        <motion.div
          className="absolute inset-0 z-10 w-full h-full flex flex-col md:flex-row will-change-transform"
          style={{ transform: `translateX(${maskX}%)` }}
        >
          <div className="w-full md:w-1/2 h-1/2 md:h-full flex flex-col justify-center p-12 md:p-24" style={{ backgroundColor: '#f2f1ea' }}>
            <div className="flex flex-col items-start w-full font-medium">
              <div className="mb-6">
                <span className="inline-block text-base md:text-2xl tracking-widest uppercase px-6 py-2" style={{ color: '#ee5974', backgroundColor: '#f2f1ea' }}>
                  THE TASTE FINDER
                </span>
              </div>
              <div className="text-7xl md:text-8xl lg:text-[120px] xl:text-[140px] leading-[1.05] tracking-tight flex flex-col items-start">
                <span className="inline-block px-6 py-2 mb-2 -ml-6" style={{ color: '#b25946', backgroundColor: '#f2f1ea' }}>Which</span>
                <span className="inline-block px-6 py-2 mb-2 -ml-6" style={{ color: '#f2f1ea', backgroundColor: '#ee5974' }}>archetype</span>
                <span className="inline-block px-6 py-2 -ml-6" style={{ color: '#b25946', backgroundColor: '#f2f1ea' }}>is yours?</span>
              </div>
            </div>
          </div>
          <div className="w-full md:w-1/2 h-1/2 md:h-full" style={{ backgroundColor: '#ee5974' }} />
        </motion.div>
      </div>
    </div>
  );
}
