import { motion } from 'motion/react';
import { Link, useNavigate } from 'react-router';
import { TasteFinderSection } from './TasteFinderSection';
import coffeePic16 from '../../design/IMAGES/lifestyle/CoffeePic16.jpg'
import bag1 from '../../design/IMAGES/bags/TransparentBag01.png'
import bag2 from '../../design/IMAGES/bags/TransparentBag02.png'
import bag3 from '../../design/IMAGES/bags/TransparentBag03.png'
import placeholderVideo from '../../design/IMAGES/videos/PlaceHolder01.mp4'

// ─── Data ────────────────────────────────────────────────────────────────────

const archetypes = [
  { name: 'Floral',              bg: '#a34b78', text: '#f2f1ea' },
  { name: 'Fruity',              bg: '#ca445f', text: '#f2f1ea' },
  { name: 'Balanced\n& Sweet',   bg: '#d1ac11', text: '#111110' },
  { name: 'Chocolate\n& Nutty',  bg: '#a54c2d', text: '#f2f1ea' },
  { name: 'Spicy\n& Earthy',     bg: '#912f2f', text: '#f2f1ea' },
  { name: 'Experimental',        bg: '#056c7a', text: '#f2f1ea' },
];

const bags = [
  { img: bag1, label: 'No. 01 — Floral' },
  { img: bag2, label: 'No. 02 — Balanced' },
  { img: bag3, label: 'No. 03 — Bold' },
];

// ─── Shared animation preset ─────────────────────────────────────────────────

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 } as const,
  viewport: { once: true, amount: 0.25 },
  transition: { duration: 0.85, delay, ease: [0.16, 1, 0.3, 1] as const },
});

// ─── Component ───────────────────────────────────────────────────────────────

export default function Home() {
  const navigate = useNavigate();

  const handleProfileStart = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = new FormData(e.currentTarget).get('name');
    if (name) {
      sessionStorage.setItem('axisBloomCustomerName', name.toString());
      navigate('/find-my-flavor');
    }
  };

  return (
    <div style={{ backgroundColor: '#f2f1ea' }}>

      {/* ━━━ 1. HERO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*
        To swap in real brand video: replace <source src="..."> and update poster={}
      */}
      <section style={{ position: 'relative', height: '100vh', overflow: 'hidden', backgroundColor: '#111110' }}>
        <video
          autoPlay loop muted playsInline
          poster={coffeePic16}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 40%' }}
        >
          <source src="https://i.imgur.com/HKuT8YR.mp4" type="video/mp4" />
        </video>

        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(17,17,16,0.68) 0%, rgba(17,17,16,0.22) 50%, rgba(17,17,16,0.04) 100%)' }} />

        <div style={{ position: 'absolute', bottom: 'clamp(48px, 8vh, 96px)', left: 'clamp(32px, 6vw, 96px)' }}>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(3rem, 6.5vw, 6.5rem)', fontWeight: 400, lineHeight: 1.0, margin: '0 0 28px', letterSpacing: '-0.02em' }}
          >
            <span style={{ display: 'block', color: '#9a2918' }}>Coffee,</span>
            <span style={{ display: 'block', margin: '6px 0' }}>
              <span style={{ backgroundColor: '#ee5974', color: '#f2f1ea', padding: '2px 16px 6px', display: 'inline-block' }}>matched</span>
            </span>
            <span style={{ display: 'block', color: '#9a2918' }}>to your</span>
            <span style={{ display: 'block', color: '#9a2918' }}>personal flavor.</span>
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.7, ease: [0.16, 1, 0.3, 1] }}
            style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}
          >
            <Link
              to="/find-my-flavor"
              style={{ fontFamily: "'Genova', sans-serif", fontSize: '0.78rem', fontWeight: 400, color: '#f2f1ea', letterSpacing: '0.18em', textTransform: 'uppercase', textDecoration: 'none', borderBottom: '1px solid rgba(242,241,234,0.65)', paddingBottom: 4 }}
            >
              Find my flavor →
            </Link>
            <Link
              to="/shop"
              style={{ fontFamily: "'Genova', sans-serif", fontSize: '0.78rem', fontWeight: 400, color: 'rgba(242,241,234,0.52)', letterSpacing: '0.18em', textTransform: 'uppercase', textDecoration: 'none', borderBottom: '1px solid rgba(242,241,234,0.22)', paddingBottom: 4 }}
            >
              Explore coffees →
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ━━━ 2. PROFILE CTA — lightweight transition band ━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#e5e5da', padding: 'clamp(52px, 6vw, 72px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', justifyContent: 'flex-end' }}>
          <motion.div
            {...fadeUp(0)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', textAlign: 'right' }}
          >
            <p style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(0.95rem, 1.4vw, 1.15rem)', fontWeight: 400, color: '#9a2918', lineHeight: 1.4, margin: 0 }}>
              Whose palate are we profiling today?
            </p>
            <form onSubmit={handleProfileStart} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: '100%', marginTop: 20 }}>
              <style>{`#profile-name::placeholder { color: rgba(154,41,24,0.36); }`}</style>
              <input
                id="profile-name"
                type="text"
                name="name"
                required
                placeholder="Enter your name"
                style={{ width: 240, background: 'none', border: 'none', borderBottom: '1px solid rgba(154,41,24,0.38)', borderRadius: 0, outline: 'none', fontFamily: "'Genova', sans-serif", fontSize: '0.95rem', fontWeight: 400, color: '#9a2918', padding: '6px 0', textAlign: 'right' }}
              />
              <button
                type="submit"
                style={{ marginTop: 14, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: "'Genova', sans-serif", fontSize: '0.72rem', fontWeight: 400, color: '#9a2918', letterSpacing: '0.2em', textTransform: 'uppercase', textDecoration: 'underline', textUnderlineOffset: '3px', textDecorationColor: 'rgba(154,41,24,0.32)', transition: 'text-decoration-color 0.2s' }}
                onMouseEnter={e => e.currentTarget.style.textDecorationColor = '#9a2918'}
                onMouseLeave={e => e.currentTarget.style.textDecorationColor = 'rgba(154,41,24,0.32)'}
              >
                BEGIN PROFILE →
              </button>
            </form>
          </motion.div>
        </div>
      </section>

      {/* ━━━ 3. FLAVOR MAP — archetype blocks ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', padding: 'clamp(64px, 9vw, 100px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <motion.div {...fadeUp(0)} style={{ marginBottom: 'clamp(32px, 4vw, 48px)' }}>
            <p style={{ fontFamily: "'Genova', sans-serif", fontSize: '0.68rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: '#9a2918', margin: '0 0 14px' }}>
              The Flavor Map
            </p>
            <h2 style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(1.5rem, 2.2vw, 2.2rem)', fontWeight: 400, color: '#111110', lineHeight: 1.15, margin: 0 }}>
              Every palate has a direction.
            </h2>
          </motion.div>

          {/* Static row on desktop — horizontal scroll on mobile */}
          <div style={{ display: 'flex', gap: 3, overflowX: 'auto', width: '100%', paddingBottom: 2 }}>
            {archetypes.map((arch) => (
              <div
                key={arch.name}
                style={{
                  flex: '1 0 clamp(130px, 14vw, 190px)',
                  height: 200,
                  backgroundColor: arch.bg,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                  padding: '16px 14px',
                }}
              >
                <p style={{
                  fontFamily: "'Genova', sans-serif",
                  fontSize: '0.68rem',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  fontWeight: 400,
                  color: arch.text,
                  margin: 0,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-line',
                }}>
                  {arch.name}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ━━━ 4. CINEMATIC VIDEO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*
        To swap in a different video: replace <source src={...}> and update poster={}
      */}
      <section style={{ position: 'relative', height: '65vh', overflow: 'hidden', backgroundColor: '#111110' }}>
        <video
          autoPlay loop muted playsInline
          poster={coffeePic16}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 40%' }}
        >
          <source src={placeholderVideo} type="video/mp4" />
        </video>
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(17,17,16,0.3)' }} />
        <p style={{
          position: 'absolute',
          bottom: 'clamp(32px, 5vh, 56px)',
          left: 'clamp(32px, 6vw, 64px)',
          fontFamily: "'Genova', sans-serif",
          fontSize: 'clamp(1.05rem, 1.9vw, 1.45rem)',
          fontWeight: 400,
          color: '#f2f1ea',
          margin: 0,
          maxWidth: 500,
          lineHeight: 1.6,
        }}>
          Coffee is never just flavor.<br />
          It is morning,{' '}
          <span style={{ backgroundColor: '#ee5974', color: '#f2f1ea', padding: '0 7px 2px', display: 'inline' }}>memory</span>,<br />
          temperature, texture, time.
        </p>
      </section>

      {/* ━━━ 5. COFFEE COLLECTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', padding: 'clamp(80px, 10vw, 120px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 'clamp(40px, 5vw, 64px)', flexWrap: 'wrap', gap: 16 }}>
            <motion.div {...fadeUp(0)}>
              <p style={{ fontFamily: "'Genova', sans-serif", fontSize: '0.68rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: '#9a2918', margin: '0 0 10px' }}>The Collection</p>
              <h2 style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(1.8rem, 3vw, 2.8rem)', fontWeight: 400, color: '#9a2918', margin: 0, lineHeight: 1.1 }}>Find your bag.</h2>
            </motion.div>
            <Link
              to="/shop"
              style={{ fontFamily: "'Genova', sans-serif", fontSize: '0.78rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#9a2918', textDecoration: 'none', borderBottom: '1px solid rgba(154,41,24,0.35)', paddingBottom: 4, alignSelf: 'flex-end' }}
            >
              Shop all coffees →
            </Link>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'clamp(20px, 3vw, 36px)' }}>
            {bags.map((bag, i) => (
              <motion.div key={i} {...fadeUp(i * 0.1)} style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ backgroundColor: '#e5e5da', aspectRatio: '3/4', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 14 }}>
                  <img src={bag.img} alt={bag.label} style={{ width: '70%', height: '80%', objectFit: 'contain', display: 'block' }} />
                </div>
                <p style={{ fontFamily: "'Genova', sans-serif", fontSize: '0.8rem', letterSpacing: '0.1em', color: '#9a2918', margin: 0, textAlign: 'center' }}>{bag.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ━━━ 6. HUMAN + AI — quiet editorial statement ━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', borderTop: '1px solid rgba(154,41,24,0.18)', padding: 'clamp(48px, 6vw, 72px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
          <motion.p {...fadeUp(0)} style={{ fontFamily: "'Genova', sans-serif", fontSize: '0.72rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: '#9a2918', margin: '0 0 18px' }}>
            Guided by AI. Curated by taste.
          </motion.p>
          <motion.p {...fadeUp(0.12)} style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(0.88rem, 1.4vw, 1rem)', fontWeight: 400, color: '#7b7f80', lineHeight: 1.85, margin: 0 }}>
            Every match is shaped by real coffees, sensory language, and human judgment.
          </motion.p>
        </div>
      </section>

      {/* ━━━ 7. TASTE FINDER (curtain animation) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <TasteFinderSection />

    </div>
  );
}
