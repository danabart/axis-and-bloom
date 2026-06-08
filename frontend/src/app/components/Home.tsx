import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Link } from 'react-router';
import { TasteFinderSection } from './TasteFinderSection';
import chaffPhoto from '../../design/IMAGES/A_B06.png'
import logoLines from '../../design/LOGO/LogoLines.svg'
import logoCircle from '../../design/LOGO/LogoCircle.svg'
import coffeePic16 from '../../design/IMAGES/lifestyle/CoffeePic16.jpg'

export default function Home() {
  const [linesVisible, setLinesVisible] = useState(false);
  const [showCircle, setShowCircle] = useState(false);

  useEffect(() => {
    // After slide-in (1.2s): fade LogoLines in
    const t1 = setTimeout(() => setLinesVisible(true), 1200);
    // After slide-in (1.2s) + fade-in (0.8s) + rest (1s): cross-fade to LogoCircle
    const t2 = setTimeout(() => setShowCircle(true), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="w-full bg-[#f2f1ea]" >
      <div className="relative z-10 bg-[#e5e5da]">
        {/* Hero */}
        <div className="h-screen relative overflow-hidden">
          <div className="absolute inset-0 flex">

            {/* Left panel: logo bloom animation */}
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              transition={{ duration: 1.2, ease: [0.6, 0.05, 0.01, 0.9] }}
              className="w-1/2"
              style={{ position: 'relative', overflow: 'hidden', backgroundColor: '#ebebe3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {/* Stacked logo container — LogoLines over LogoCircle */}
              <div style={{ position: 'relative', width: '60%' }}>
                {/* LogoCircle: beneath, blooms in on cross-fade */}
                <motion.div
                  style={{ position: 'absolute', inset: 0 }}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={showCircle ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                >
                  <img src={logoCircle} alt="Axis & Bloom" style={{ width: '100%', height: 'auto', display: 'block' }} />
                </motion.div>

                {/* LogoLines: on top, fades in after slide-in then fades out on cross-fade */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: linesVisible && !showCircle ? 1 : 0 }}
                  transition={{ duration: showCircle ? 0.9 : 0.8, ease: [0.16, 1, 0.3, 1] }}
                >
                  <img src={logoLines} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
                </motion.div>
              </div>
            </motion.div>

            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 1.2, ease: [0.6, 0.05, 0.01, 0.9] }} className="w-1/2 relative overflow-hidden" style={{ backgroundColor: '#deded1' }}>
              <video autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover" src="https://i.imgur.com/HKuT8YR.mp4" />
            </motion.div>
          </div>

          <div className="relative z-10 h-full flex pt-24">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.8 }} className="absolute right-0 w-1/2 flex flex-col items-start justify-start pt-48 pl-8" style={{ top: 0, bottom: 0 }}>
              <h1 className="text-7xl leading-tight mb-6" style={{ color: '#a33726' }}>
                Coffee,<br />
                <span style={{ backgroundColor: '#ee5974', color: '#DEDED1', paddingLeft: '12px', paddingRight: '12px', display: 'inline-block' }}>matched</span> to your<br />
                personal flavor.
              </h1>
              <div className="flex flex-col gap-1">
                <Link to="/find-my-flavor" className="text-lg tracking-widest group relative inline-block w-fit" style={{ color: '#a33726' }}>
                  <span className="relative">FIND MY FLAVOR --&gt;<span className="absolute bottom-0 left-0 w-0 h-[1px] group-hover:w-full transition-all duration-500 ease-out" style={{ backgroundColor: '#a33726' }} /></span>
                </Link>
                <Link to="/shop" className="text-xs tracking-widest group relative inline-block w-fit" style={{ color: '#a33726' }}>
                  <span className="relative">BROWSE ALL COFFEES --&gt;<span className="absolute bottom-0 left-0 w-0 h-[1px] group-hover:w-full transition-all duration-500 ease-out" style={{ backgroundColor: '#a33726' }} /></span>
                </Link>
              </div>
            </motion.div>
          </div>
        </div>

        {/* Manifesto strip */}
        <div style={{ backgroundColor: '#a94936', paddingTop: 'clamp(80px, 12vw, 160px)', paddingBottom: 'clamp(80px, 12vw, 160px)', width: '100%' }}>
          <div style={{ paddingLeft: 'clamp(24px, 8vw, 120px)', paddingRight: '24px' }}>
            <div style={{ maxWidth: 600 }}>
              <motion.p
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(2rem, 4vw, 3.5rem)', fontWeight: 300, color: '#f2f1ea', lineHeight: 1.2, marginBottom: 0 }}
              >
                You already know what you love. You just don't have the words for it yet.
              </motion.p>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.25 }}
                style={{ marginTop: 'clamp(28px, 3vw, 40px)' }}
              >
                <Link
                  to="/find-my-flavor"
                  style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(0.95rem, 1.4vw, 1.1rem)', fontWeight: 300, color: '#f2f1ea', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4em' }}
                  onMouseEnter={e => { (e.currentTarget.querySelector('span') as HTMLElement).style.textDecorationColor = '#f2f1ea'; (e.currentTarget.querySelector('span') as HTMLElement).style.opacity = '1'; }}
                  onMouseLeave={e => { (e.currentTarget.querySelector('span') as HTMLElement).style.textDecorationColor = 'rgba(242,241,234,0.55)'; (e.currentTarget.querySelector('span') as HTMLElement).style.opacity = '0.85'; }}
                >
                  <span style={{ textDecoration: 'underline', textUnderlineOffset: '3px', textDecorationColor: 'rgba(242,241,234,0.55)', textDecorationThickness: '1px', opacity: 0.85, transition: 'opacity 0.2s, text-decoration-color 0.2s' }}>Find your flavor</span>
                  <span style={{ opacity: 0.85 }}>→</span>
                </Link>
              </motion.div>
            </div>
          </div>
        </div>

        {/* Bridge section */}
        <div style={{ position: 'relative', width: '100%', height: '60vh', overflow: 'hidden' }}>
          <img
            src={coffeePic16}
            alt=""
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center bottom', display: 'block' }}
          />
          <p style={{ position: 'absolute', bottom: 'clamp(32px, 4vw, 56px)', left: 'clamp(32px, 4vw, 56px)', margin: 0, color: '#ffffff', fontFamily: "'Genova', sans-serif", fontSize: 'clamp(20px, 1.8vw, 22px)', fontWeight: 400, lineHeight: 1.4 }}>
            There are six taste identities. One is made for you.
          </p>
        </div>
      </div>

      <TasteFinderSection />
    </div>
  );
}
