import { motion } from 'motion/react';
import { Link, useNavigate } from 'react-router';
import { TasteFinderSection } from './TasteFinderSection';
import logoCircle from '../../design/LOGO/LogoCircle.svg'
import coffeePic16 from '../../design/IMAGES/lifestyle/CoffeePic16.jpg'
import bag1 from '../../design/IMAGES/bags/TransparentBag01.png'
import bag2 from '../../design/IMAGES/bags/TransparentBag02.png'
import bag3 from '../../design/IMAGES/bags/TransparentBag03.png'

// ─── Data ────────────────────────────────────────────────────────────────────

const steps = [
  {
    num: '01',
    title: 'Tell us how you drink coffee',
    body: 'Your routine, your taste, your milk habits, your mood, your curiosity.',
  },
  {
    num: '02',
    title: 'We map your flavor profile',
    body: 'Our system connects your answers to flavor notes, roast level, body, acidity, and aroma.',
  },
  {
    num: '03',
    title: 'Receive your coffee match',
    body: 'A curated coffee chosen for your profile, with room to explore.',
  },
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
          3. Adjust objectPosition if needed
      */}
      <section style={{ position: 'relative', height: '100vh', overflow: 'hidden', backgroundColor: '#111110' }}>
        <video
          autoPlay loop muted playsInline
          poster={coffeePic16}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 40%' }}
        >
          <source src="https://i.imgur.com/HKuT8YR.mp4" type="video/mp4" />
        </video>

        {/* Bottom-weighted gradient for text legibility */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(17,17,16,0.72) 0%, rgba(17,17,16,0.28) 45%, rgba(17,17,16,0.06) 100%)' }} />

        {/* Content — bottom left */}
        <div style={{ position: 'absolute', bottom: 'clamp(48px, 8vh, 96px)', left: 'clamp(32px, 6vw, 96px)', maxWidth: 600 }}>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(2.4rem, 5vw, 4.8rem)', fontWeight: 400, color: '#f2f1ea', lineHeight: 1.1, margin: '0 0 20px', letterSpacing: '-0.01em' }}
          >
            Coffee matched to<br />your personal flavor.
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

      {/* ━━━ 2. CONCEPT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', padding: 'clamp(80px, 12vw, 140px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 760 }}>
          <motion.p {...fadeUp(0)} style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(1.8rem, 3.5vw, 3rem)', fontWeight: 400, color: '#9a2918', lineHeight: 1.2, margin: '0 0 32px' }}>
            You already know what you love. You just don't have the words for it yet.
          </motion.p>
          <motion.p {...fadeUp(0.18)} style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(0.95rem, 1.5vw, 1.05rem)', fontWeight: 400, color: '#7b7f80', lineHeight: 1.85, margin: 0, maxWidth: 520 }}>
            Axis & Bloom translates your habits, preferences, and rituals into a coffee profile — so you can find coffees that actually feel like you.
          </motion.p>
        </div>
      </section>

      {/* ━━━ 3. HOW IT WORKS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#e5e5da', padding: 'clamp(80px, 10vw, 120px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <motion.p {...fadeUp(0)} style={{ fontFamily: "'Genova', sans-serif", fontSize: '0.68rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: '#9a2918', margin: '0 0 52px' }}>
            How it works
          </motion.p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'clamp(40px, 5vw, 64px)' }}>
            {steps.map((step, i) => (
              <motion.div key={step.num} {...fadeUp(i * 0.13)}>
                <p style={{ fontFamily: "'Genova', sans-serif", fontSize: '0.68rem', letterSpacing: '0.15em', color: '#9a2918', margin: '0 0 16px', opacity: 0.55 }}>{step.num}</p>
                <p style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(1.05rem, 1.6vw, 1.25rem)', fontWeight: 400, color: '#9a2918', lineHeight: 1.3, margin: '0 0 14px' }}>{step.title}</p>
                <p style={{ fontFamily: "'Genova', sans-serif", fontSize: '0.9rem', fontWeight: 400, color: '#7b7f80', lineHeight: 1.75, margin: 0 }}>{step.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ━━━ 4. PROFILE ENTRY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ position: 'relative', width: '100%', height: '90vh', overflow: 'hidden' }}>
        <img
          src={coffeePic16}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 40%', display: 'block' }}
        />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to left, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0) 55%)' }} />

        {/* Form — top right */}
        <div style={{ position: 'absolute', top: 'clamp(72px, 10vh, 120px)', right: 'clamp(32px, 5vw, 64px)', maxWidth: 400, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', textAlign: 'right' }}>
          <p style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(1.5rem, 2.8vw, 2.6rem)', fontWeight: 400, color: '#f2f1ea', lineHeight: 1.2, margin: 0 }}>
            You already know what you love. You just don't have the words for it yet.
          </p>
          <p style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(1rem, 1.6vw, 1.3rem)', fontWeight: 400, color: '#f2f1ea', lineHeight: 1.3, margin: '28px 0 0' }}>
            Whose palate are we profiling today?
          </p>
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

      {/* ━━━ 5. THE FLAVOR MAP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', padding: 'clamp(80px, 10vw, 120px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'clamp(48px, 7vw, 96px)', alignItems: 'center' }}>
          <motion.div {...fadeUp(0)} style={{ display: 'flex', justifyContent: 'center' }}>
            <img
              src={logoCircle}
              alt="The Axis & Bloom flavor map"
              style={{ width: '100%', maxWidth: 360, height: 'auto', display: 'block' }}
            />
          </motion.div>
          <motion.div {...fadeUp(0.15)}>
            <p style={{ fontFamily: "'Genova', sans-serif", fontSize: '0.68rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: '#9a2918', margin: '0 0 18px' }}>The Flavor Map</p>
            <h2 style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(1.8rem, 3vw, 2.8rem)', fontWeight: 400, color: '#9a2918', lineHeight: 1.15, margin: '0 0 22px' }}>
              Every coffee has a direction.
            </h2>
            <p style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(0.95rem, 1.5vw, 1.05rem)', fontWeight: 400, color: '#7b7f80', lineHeight: 1.85, margin: '0 0 32px' }}>
              Chocolatey, floral, fruity, spicy, earthy, balanced, experimental. Our system helps locate the profile that feels most like you — and points you toward the coffees that belong in your cup.
            </p>
            <Link
              to="/how-it-works"
              style={{ fontFamily: "'Genova', sans-serif", fontSize: '0.78rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#9a2918', textDecoration: 'none', borderBottom: '1px solid rgba(154,41,24,0.35)', paddingBottom: 4 }}
            >
              How it works →
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ━━━ 6. CINEMATIC VIDEO PLACEHOLDER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*
        Video-ready component. To swap in brand video:
          1. Replace <source src="..."> with real video URL
          2. Update poster={} to the still-frame image
          3. Optional: update the caption below
      */}
      <section style={{ position: 'relative', height: '65vh', overflow: 'hidden', backgroundColor: '#111110' }}>
        <video
          autoPlay loop muted playsInline
          poster={coffeePic16}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 40%' }}
        >
          <source src="https://i.imgur.com/HKuT8YR.mp4" type="video/mp4" />
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

      {/* ━━━ 7. COFFEE COLLECTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', padding: 'clamp(80px, 10vw, 120px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>

          {/* Section header */}
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

          {/* Bag cards */}
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

      {/* ━━━ 8. HUMAN + AI ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#9a2918', padding: 'clamp(80px, 10vw, 120px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 620, margin: '0 auto', textAlign: 'center' }}>
          <motion.h2 {...fadeUp(0)} style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(1.8rem, 3vw, 2.8rem)', fontWeight: 400, color: '#f2f1ea', lineHeight: 1.2, margin: '0 0 24px' }}>
            Guided by AI. Curated by taste.
          </motion.h2>
          <motion.p {...fadeUp(0.18)} style={{ fontFamily: "'Genova', sans-serif", fontSize: 'clamp(0.95rem, 1.5vw, 1.05rem)', fontWeight: 400, color: 'rgba(242,241,234,0.72)', lineHeight: 1.85, margin: 0 }}>
            Our system helps decode your preferences, but every match is shaped by real coffees, sensory language, and human judgment.
          </motion.p>
        </div>
      </section>

      {/* ━━━ 9. CURTAIN (unchanged) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <TasteFinderSection />

    </div>
  );
}
