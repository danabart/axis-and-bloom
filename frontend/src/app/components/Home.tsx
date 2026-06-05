import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Link, useNavigate } from 'react-router';
import { TasteFinderSection } from './TasteFinderSection';
import chaffPhoto from '../../design/IMAGES/A_B06.png'
import logoLines from '../../design/LOGO/LogoLines.svg'
import logoCircle from '../../design/LOGO/LogoCircle.svg'

export default function Home() {
  const navigate = useNavigate();
  const [linesVisible, setLinesVisible] = useState(false);
  const [showCircle, setShowCircle] = useState(false);

  useEffect(() => {
    // After slide-in (1.2s): fade LogoLines in
    const t1 = setTimeout(() => setLinesVisible(true), 1200);
    // After slide-in (1.2s) + fade-in (0.8s) + rest (1s): cross-fade to LogoCircle
    const t2 = setTimeout(() => setShowCircle(true), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const handleProfileStart = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name');
    if (name) {
      sessionStorage.setItem('axisBloomCustomerName', name.toString());
      navigate('/find-my-flavor');
    }
  };

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

        {/* Ticker */}
        <div className="w-full relative z-20 shadow-2xl overflow-hidden" style={{ backgroundColor: '#deded1' }}>
          <div className="relative z-10 w-full flex overflow-hidden whitespace-nowrap py-3" style={{ backgroundColor: '#ee5974', color: '#f2f1ea' }}>
            <motion.div animate={{ x: ['0%', '-50%'] }} transition={{ repeat: Infinity, ease: 'linear', duration: 35 }} className="flex w-max">
              {[...Array(20)].map((_, i) => (
                <div key={i} className="flex gap-8 items-center shrink-0 pr-8 text-[11px] uppercase tracking-[0.3em] font-normal">
                  <span>THE TASTE FINDER</span>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: '#f2f1ea' }} />
                  <span>DISCOVER YOUR ARCHETYPE</span>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: '#f2f1ea' }} />
                </div>
              ))}
            </motion.div>
          </div>

          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-10%' }}
            variants={{ visible: { transition: { staggerChildren: 0.15 } }, hidden: {} }}
            className="relative z-10 max-w-[1400px] mx-auto px-12 md:px-20 lg:px-32 py-16 md:py-24 flex flex-col md:flex-row items-center justify-between gap-12"
          >
            <div className="flex-1 flex flex-col items-start gap-10 overflow-hidden">
              <motion.h3
                variants={{ hidden: { y: '100%', opacity: 0 }, visible: { y: 0, opacity: 1, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } } }}
                className="text-4xl md:text-5xl lg:text-6xl tracking-tight text-left leading-[1.1]"
                style={{ color: '#a33726' }}
              >
                Whose palate are we<br/>profiling today?
              </motion.h3>

              <motion.div variants={{ hidden: { opacity: 0, y: 30 }, visible: { opacity: 1, y: 0, transition: { duration: 0.8 } } }} className="w-full max-w-xl">
                <form onSubmit={handleProfileStart} className="flex flex-col sm:flex-row items-stretch w-full shadow-xl">
                  <input type="text" name="name" required placeholder="Enter your name..." className="w-full sm:w-80 px-8 py-5 text-xl outline-none border-none transition-colors" style={{ backgroundColor: '#f2f1ea', color: '#a33726' }} />
                  <button type="submit" className="w-full sm:w-auto px-10 py-5 text-sm uppercase tracking-[0.2em] whitespace-nowrap flex items-center justify-center gap-3 transition-colors group" style={{ backgroundColor: '#a33726', color: '#f2f1ea' }} onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#ee5974')} onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#a33726')}>
                    <span>Begin Profile</span>
                    <span className="text-lg leading-none transform transition-transform group-hover:translate-x-2">→</span>
                  </button>
                </form>
              </motion.div>
            </div>
          </motion.div>
        </div>

        {/* Section 2 */}
        <div className="h-screen relative">
          <div className="absolute inset-0 flex">
            <div className="w-1/2" style={{ backgroundColor: '#f2f1ea' }} />
            <div className="w-1/2" style={{ backgroundColor: '#deded1' }} />
          </div>
          <div className="relative z-10 h-full flex">
            <div className="w-1/2 flex flex-col justify-center px-12 md:px-20 lg:px-32">
              <motion.div initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 1 }}>
                <h2 className="text-7xl lg:text-[110px] xl:text-[130px] leading-[0.95] tracking-tight mb-12" style={{ color: '#b15643' }}>
                  Where taste<br />becomes<br />a match.
                </h2>
                <p className="text-2xl lg:text-4xl leading-tight mb-16" style={{ color: '#b15643' }}>
                  A personalized system<br />for finding coffee that<br />fits your taste.
                </p>
                <Link to="/how-it-works" className="text-xl lg:text-2xl uppercase tracking-widest group relative inline-flex items-center" style={{ color: '#b15643' }}>
                  <span className="relative pb-1">How it works<span className="absolute bottom-0 left-0 w-0 h-[2px] transition-all duration-500 ease-out group-hover:w-full" style={{ backgroundColor: '#b15643' }} /></span>
                  <span className="ml-4 transition-transform duration-500 group-hover:translate-x-3">→</span>
                </Link>
              </motion.div>
            </div>
            <div className="w-1/2" />
          </div>
        </div>
      </div>

      <TasteFinderSection />
    </div>
  );
}
