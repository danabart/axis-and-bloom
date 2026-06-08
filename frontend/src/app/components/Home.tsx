import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Link, useNavigate } from 'react-router';
import { TasteFinderSection } from './TasteFinderSection';
import chaffPhoto from '../../design/IMAGES/A_B06.png'
import logoLines from '../../design/LOGO/LogoLines.svg'
import logoCircle from '../../design/LOGO/LogoCircle.svg'
import coffeePic16 from '../../design/IMAGES/lifestyle/CoffeePic16.jpg'

export default function Home() {
  const navigate = useNavigate();
  const [linesVisible, setLinesVisible] = useState(false);
  const [showCircle, setShowCircle] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setLinesVisible(true), 1200);
    const t2 = setTimeout(() => setShowCircle(true), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const handleProfileStart = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = new FormData(e.currentTarget).get('name');
    if (name) {
      sessionStorage.setItem('axisBloomCustomerName', name.toString());
      navigate('/find-my-flavor');
    }
  };

  return (
    <div className="w-full bg-[#f2f1ea]">
      <div className="relative z-10 bg-[#e5e5da]">

        {/* Hero */}
        <div className="h-screen relative overflow-hidden">
          <div className="absolute inset-0 flex">
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              transition={{ duration: 1.2, ease: [0.6, 0.05, 0.01, 0.9] }}
              className="w-1/2"
              style={{ position: 'relative', overflow: 'hidden', backgroundColor: '#ebebe3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <div style={{ position: 'relative', width: '60%' }}>
                <motion.div
                  style={{ position: 'absolute', inset: 0 }}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={showCircle ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                >
                  <img src={logoCircle} alt="Axis & Bloom" style={{ width: '100%', height: 'auto', display: 'block' }} />
                </motion.div>
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

        {/* CTA + Bridge — one full-bleed photo section */}
        <div style={{ position: 'relative', width: '100%', height: '90vh', overflow: 'hidden' }}>

          {/* Background photo */}
          <img
            src={coffeePic16}
            alt=""
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 40%', display: 'block' }}
          />

          {/* Subtle right gradient for legibility */}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to left, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 55%)' }} />

          {/* Text + form — top right */}
          <div style={{
            position: 'absolute',
            top: 'clamp(72px, 10vh, 120px)',
            right: 'clamp(32px, 5vw, 64px)',
            maxWidth: 420,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            textAlign: 'right',
          }}>
            <p style={{
              fontFamily: "'Genova', sans-serif",
              fontSize: 'clamp(1.6rem, 3vw, 2.8rem)',
              fontWeight: 400,
              color: '#f2f1ea',
              lineHeight: 1.2,
              margin: 0,
            }}>
              You already know what you love. You just don't have the words for it yet.
            </p>

            <p style={{
              fontFamily: "'Genova', sans-serif",
              fontSize: 'clamp(1rem, 1.8vw, 1.4rem)',
              fontWeight: 400,
              color: '#f2f1ea',
              lineHeight: 1.3,
              margin: '32px 0 0',
            }}>
              Whose palate are we profiling today?
            </p>

            <form onSubmit={handleProfileStart} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: '100%' }}>
              <style>{`#profile-name::placeholder { color: rgba(242,241,234,0.5); }`}</style>
              <input
                id="profile-name"
                type="text"
                name="name"
                required
                placeholder="Enter your name"
                style={{
                  marginTop: 24,
                  width: '100%',
                  maxWidth: 320,
                  background: 'none',
                  border: 'none',
                  borderBottom: '1px solid rgba(242,241,234,0.7)',
                  borderRadius: 0,
                  outline: 'none',
                  fontFamily: "'Genova', sans-serif",
                  fontSize: '1rem',
                  fontWeight: 400,
                  color: '#f2f1ea',
                  padding: '8px 0',
                  textAlign: 'right',
                }}
              />
              <button
                type="submit"
                style={{
                  marginTop: 20,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontFamily: "'Genova', sans-serif",
                  fontSize: 13,
                  fontWeight: 400,
                  color: '#f2f1ea',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  textDecoration: 'underline',
                  textUnderlineOffset: '3px',
                  textDecorationColor: 'rgba(242,241,234,0.5)',
                  transition: 'text-decoration-color 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.textDecorationColor = '#f2f1ea'}
                onMouseLeave={e => e.currentTarget.style.textDecorationColor = 'rgba(242,241,234,0.5)'}
              >
                BEGIN PROFILE →
              </button>
            </form>
          </div>

        </div>

      </div>

      <TasteFinderSection />
    </div>
  );
}
