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
  { name: 'Floral',              bg: '#d4bec8', text: '#2c1810' },
  { name: 'Fruity',              bg: '#c06040', text: '#f2f1ea' },
  { name: 'Balanced\n& Sweet',   bg: '#c8a878', text: '#2c1810' },
  { name: 'Chocolate\n& Nutty',  bg: '#3a2012', text: '#f2f1ea' },
  { name: 'Spicy\n& Earthy',     bg: '#9a2918', text: '#f2f1ea' },
  { name: 'Experimental',        bg: '#2a3830', text: '#f2f1ea' },
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
        Video-ready hero. To swap in real brand video:
          1. Replace the <source src="..."> with the new video URL
          2. Update poster={} to your hero still-frame
      */}
      <section style={{ position: 'relative', height: '100vh', overflow: 'hidden', backgroundColor: '#111110' }}>
        <video
          autoPlay loop muted playsInline
          poster={coffeePic16}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 40%' }}
        >
          <source src="https://i.imgur.com/HKuT8YR.mp4" type="video/mp4" />
        </video>

        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(17,17,16,0.72) 0%, rgba(17,17,16,0.28) 45%, rgba(17,17,16,0.06) 100%)' }} />

        <div style={{ position: 'absolute', bottom: 'clamp(48px, 8vh, 96px)', left: 'clamp(32px, 6vw, 96px)', maxWidth: 640 }}>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(2.4rem, 5vw, 4.8rem)', fontWeight: 400, color: '#f2f1ea', lineHeight: 1.1, margin: '0 0 20px', letterSpacing: '-0.01em' }}
          >
            Coffee matched<br />
            to your personal{' '}
            <span style={{ backgroundColor: '#9a2918', padding: '0 10px 3px' }}>flavor.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.55, ease: [0.16, 1, 0.3, 1] }}
            style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(0.95rem, 1.5vw, 1.1rem)', fontWeight: 400, color: 'rgba(242,241,234,0.72)', margin: '0 0 36px', lineHeight: 1.7 }}
          >
            A smarter way to discover coffee through taste, ritual, and mood.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.75, ease: [0.16, 1, 0.3, 1] }}
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
              style={{ fontFamily: "'Genova', sans-serif", fontSize: '0.78rem', fontWeight: 400, color: 'rgba(242,241,234,0.55)', letterSpacing: '0.18em', textTransform: 'uppercase', textDecoration: 'none', borderBottom: '1px solid rgba(242,241,234,0.25)', paddingBottom: 4 }}
            >
              Explore coffees →
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ━━━ 2. PROFILE ENTRY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ position: 'relative', width: '100%', height: '90vh', overflow: 'hidden' }}>
        <img
          src={coffeePic16}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 40%', display: 'block' }}
        />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to left, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0) 58%)' }} />

        <div style={{ position: 'absolute', top: 'clamp(72px, 10vh, 120px)', right: 'clamp(32px, 5vw, 64px)', maxWidth: 380, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', textAlign: 'right' }}>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.2 }}
            style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(1rem, 1.6vw, 1.3rem)', fontWeight: 400, color: '#f2f1ea', lineHeight: 1.35, margin: 0 }}
          >
            Whose palate are we profiling today?
          </motion.p>
          <form onSubmit={handleProfileStart} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: '100%' }}>
            <style>{`#profile-name::placeholder { color: rgba(242,241,234,0.48); }`}</style>
            <input
              id="profile-name"
              type="text"
              name="name"
              required
              placeholder="Enter your name"
              style={{ marginTop: 22, width: '100%', maxWidth: 300, background: 'none', border: 'none', borderBottom: '1px solid rgba(242,241,234,0.6)', borderRadius: 0, outline: 'none', fontFamily: "'Genova', sans-serif", fontSize: '1rem', fontWeight: 400, color: '#f2f1ea', padding: '8px 0', textAlign: 'right' }}
            />
            <button
              type="submit"
              style={{ marginTop: 18, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: "'Genova', sans-serif", fontSize: 12, fontWeight: 400, color: '#f2f1ea', letterSpacing: '0.18em', textTransform: 'uppercase', textDecoration: 'underline', textUnderlineOffset: '3px', textDecorationColor: 'rgba(242,241,234,0.45)', transition: 'text-decoration-color 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.textDecorationColor = '#f2f1ea'}
              onMouseLeave={e => e.currentTarget.style.textDecorationColor = 'rgba(242,241,234,0.45)'}
            >
              BEGIN PROFILE →
            </button>
          </form>
        </div>
      </section>

      {/* ━━━ 3. FLAVOR MAP — archetype color blocks ━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', padding: 'clamp(72px, 10vw, 112px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <motion.div {...fadeUp(0)} style={{ marginBottom: 'clamp(36px, 5vw, 52px)' }}>
            <p style={{ fontFamily: "'Genova', sans-serif", fontSize: '0.68rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: '#9a2918', margin: '0 0 16px' }}>
              The Flavor Map
            </p>
            <h2 style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(1.6rem, 2.5vw, 2.4rem)', fontWeight: 400, color: '#111110', lineHeight: 1.15, margin: '0 0 14px' }}>
              Every palate has a direction.
            </h2>
            <p style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(0.88rem, 1.3vw, 0.98rem)', fontWeight: 400, color: '#7b7f80', lineHeight: 1.8, margin: '0 0 20px', maxWidth: 480 }}>
              Six flavor archetypes. Each one maps to a different way of experiencing coffee.
            </p>
            <Link
              to="/how-it-works"
              style={{ fontFamily: "'Genova', sans-serif", fontSize: '0.75rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#9a2918', textDecoration: 'none', borderBottom: '1px solid rgba(154,41,24,0.35)', paddingBottom: 3 }}
            >
              How it works →
            </Link>
          </motion.div>

          {/* Horizontal row on desktop — scroll on mobile */}
          <div style={{ display: 'flex', gap: 3, overflowX: 'auto', width: '100%', paddingBottom: 2 }}>
            {archetypes.map((arch, i) => (
              <motion.div
                key={arch.name}
                {...fadeUp(i * 0.07)}
                style={{
                  flex: '1 0 clamp(140px, 15vw, 200px)',
                  height: 224,
                  backgroundColor: arch.bg,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                  padding: '18px 16px',
                }}
              >
                <p style={{
                  fontFamily: "'Genova', sans-serif",
                  fontSize: '0.72rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  fontWeight: 400,
                  color: arch.text,
                  margin: 0,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-line',
                }}>
                  {arch.name}
                </p>
              </motion.div>
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
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.28)' }} />
        <p style={{
          position: 'absolute', bottom: 'clamp(32px, 5vh, 56px)', left: 'clamp(32px, 6vw, 64px)',
          fontFamily: "'Genova', sans-serif", fontSize: 'clamp(0.85rem, 1.3vw, 1rem)', fontWeight: 400,
          color: 'rgba(242,241,234,0.82)', margin: 0, maxWidth: 440, lineHeight: 1.7,
        }}>
          Coffee is never just flavor. It is morning, memory, temperature, texture, time.
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
