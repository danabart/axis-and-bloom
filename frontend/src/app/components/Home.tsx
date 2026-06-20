import { useRef, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Link, useNavigate } from 'react-router';
import { TasteFinderSection } from './TasteFinderSection';
import bag1 from '../../design/IMAGES/bags/TransparentBag01.png'
import bag2 from '../../design/IMAGES/bags/TransparentBag02.png'
import bag3 from '../../design/IMAGES/bags/TransparentBag03.png'
import placeholderVideo from '../../design/IMAGES/videos/PlaceHolder01.mp4'
import heroVideo from '../../design/IMAGES/videos/PlaceHolder10.mp4'
import archetypeFloral   from '../../design/IMAGES/lifestyle/ARCHETYPE_Floral01.png'
import archetypeBalanced from '../../design/IMAGES/lifestyle/ARCHETYPE_Balanced_Sweet01.png'
import archetypeSpicy    from '../../design/IMAGES/lifestyle/ARCHETYPE_Spicy_Earthy01.png'

// ─── Data ────────────────────────────────────────────────────────────────────

const archetypes = [
  {
    num: '01',
    name: 'Floral',
    body: 'Light, elegant, and aromatic. Hints of jasmine, citrus, and a tea-like clarity.',
    footer: 'FRAGRANT, BRIGHT, DELICATE, CLEAN',
    bg: '#a34b78',
  },
  {
    num: '02',
    name: 'Fruity',
    body: 'Juicy and lively with notes of berries and ripe fruit.',
    footer: 'SWEET, VIBRANT, EXPRESSIVE, LIVELY',
    bg: '#ca445f',
  },
  {
    num: '03',
    name: 'Balanced & Sweet',
    body: 'Round, smooth, and comforting. Notes of caramel, honey, and soft fruit.',
    footer: 'SMOOTH, SWEET, HARMONIOUS, EASY',
    bg: '#d1ac11',
  },
  {
    num: '04',
    name: 'Chocolate & Nutty',
    body: 'Deep and satisfying with cocoa, roasted nuts, and a rich presence.',
    footer: 'RICH, GROUNDED, FULL, COMFORTING',
    bg: '#a54c2d',
  },
  {
    num: '05',
    name: 'Spicy & Earthy',
    body: 'Warm and bold with hints of spice, wood, and lingering depth.',
    footer: 'WARM, DEEP, BOLD, LASTING',
    bg: '#912f2f',
  },
  {
    num: '06',
    name: 'Experimental',
    body: 'Ever-changing and wonderfully unconventional. A rotating selection of boundary-pushing coffees that are always unique and distinctly amazing.',
    footer: 'WILD, UNIQUE, SURPRISING',
    bg: '#056c7a',
  },
];

const bags = [
  { img: bag1, label: 'No. 01 — Floral',   hoverImg: archetypeFloral   },
  { img: bag2, label: 'No. 02 — Balanced', hoverImg: archetypeBalanced },
  { img: bag3, label: 'No. 03 — Bold',     hoverImg: archetypeSpicy    },
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
  const heroVideoRef      = useRef<HTMLVideoElement>(null);
  const cinematicVideoRef = useRef<HTMLVideoElement>(null);
  const [hoveredBag, setHoveredBag] = useState<number | null>(null);

  useEffect(() => {
    // rAF-based loop: fires every frame (~60fps) so we catch the end before any black frame
    const attachLoop = (ref: React.RefObject<HTMLVideoElement | null>) => {
      const video = ref.current;
      if (!video) return () => {};
      let rafId: number;
      const tick = () => {
        if (video.duration && video.currentTime >= video.duration - 0.5) {
          video.currentTime = 0.05; // skip black first frame; cut end 500ms early
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafId);
    };
    const cleanHero      = attachLoop(heroVideoRef);
    const cleanCinematic = attachLoop(cinematicVideoRef);
    return () => { cleanHero(); cleanCinematic(); };
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
    <div style={{ backgroundColor: '#f2f1ea' }}>

      {/* ━━━ 1. HERO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*
        To swap in real brand video: replace <source src="..."> and update poster={}
      */}
      <section style={{ position: 'relative', height: '100vh', overflow: 'hidden', backgroundColor: '#1a1208' }}>
        <video
          ref={heroVideoRef}
          autoPlay muted playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 40%', display: 'block', transform: 'scale(1.06)' }}
        >
          <source src={heroVideo} type="video/mp4" />
        </video>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(17,17,16,0.68) 0%, rgba(17,17,16,0.22) 50%, rgba(17,17,16,0.04) 100%)' }} />

        <div style={{ position: 'absolute', bottom: 'clamp(48px, 8vh, 96px)', left: 'clamp(32px, 6vw, 96px)' }}>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            style={{ fontFamily: "Arial, sans-serif", fontSize: 'clamp(3rem, 6.5vw, 6.5rem)', fontWeight: 400, lineHeight: 1.0, margin: '0 0 28px', letterSpacing: '-0.02em' }}
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
              style={{ fontFamily: "Arial, sans-serif", fontSize: '0.78rem', fontWeight: 400, color: '#f2f1ea', letterSpacing: '0.18em', textTransform: 'uppercase', textDecoration: 'none', borderBottom: '1px solid rgba(242,241,234,0.65)', paddingBottom: 4 }}
            >
              Find my flavor →
            </Link>
            <Link
              to="/shop"
              style={{ fontFamily: "Arial, sans-serif", fontSize: '0.78rem', fontWeight: 400, color: 'rgba(242,241,234,0.52)', letterSpacing: '0.18em', textTransform: 'uppercase', textDecoration: 'none', borderBottom: '1px solid rgba(242,241,234,0.22)', paddingBottom: 4 }}
            >
              Explore coffees →
            </Link>
            <Link
              to="/sign-in"
              style={{ fontFamily: "Arial, sans-serif", fontSize: '0.78rem', fontWeight: 400, color: 'rgba(242,241,234,0.52)', letterSpacing: '0.18em', textTransform: 'uppercase', textDecoration: 'none', borderBottom: '1px solid rgba(242,241,234,0.22)', paddingBottom: 4 }}
            >
              Sign in →
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ━━━ 2. PROFILE CTA ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#e5e5da', padding: 'clamp(72px, 10vw, 120px) clamp(32px, 6vw, 96px)' }}>
        <motion.div
          {...fadeUp(0)}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', textAlign: 'right', maxWidth: 600, marginLeft: 'auto' }}
        >
          <p style={{ fontFamily: "Arial, sans-serif", fontSize: 'clamp(2rem, 3.6vw, 3.6rem)', fontWeight: 400, color: '#9a2918', lineHeight: 1.15, margin: 0 }}>
            Whose palate are we<br />profiling today?
          </p>
          <form onSubmit={handleProfileStart} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: '100%', marginTop: 36 }}>
            <style>{`#profile-name::placeholder { color: rgba(154,41,24,0.36); }`}</style>
            <input
              id="profile-name"
              type="text"
              name="name"
              required
              placeholder="Enter your name"
              style={{ width: '100%', maxWidth: 400, background: 'none', border: 'none', borderBottom: '1px solid rgba(154,41,24,0.42)', borderRadius: 0, outline: 'none', fontFamily: "Arial, sans-serif", fontSize: '1.25rem', fontWeight: 400, color: '#9a2918', padding: '10px 0', textAlign: 'right' }}
            />
            <button
              type="submit"
              style={{ marginTop: 22, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: "Arial, sans-serif", fontSize: '0.88rem', fontWeight: 400, color: '#9a2918', letterSpacing: '0.22em', textTransform: 'uppercase', textDecoration: 'underline', textUnderlineOffset: '4px', textDecorationColor: 'rgba(154,41,24,0.32)', transition: 'text-decoration-color 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.textDecorationColor = '#9a2918'}
              onMouseLeave={e => e.currentTarget.style.textDecorationColor = 'rgba(154,41,24,0.32)'}
            >
              BEGIN PROFILE →
            </button>
            <Link
              to="/sign-in"
              style={{ marginTop: 14, fontFamily: "Arial, sans-serif", fontSize: '0.72rem', fontWeight: 400, color: '#9a2918', letterSpacing: '0.14em', textTransform: 'uppercase', textDecoration: 'none', opacity: 0.45, borderBottom: '1px solid rgba(154,41,24,0.25)', paddingBottom: 2 }}
            >
              Already a member? Sign in →
            </Link>
          </form>
        </motion.div>
      </section>

      {/* ━━━ 3. COFFEE COLLECTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', padding: 'clamp(80px, 10vw, 120px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 'clamp(40px, 5vw, 64px)', flexWrap: 'wrap', gap: 16 }}>
            <motion.div {...fadeUp(0)}>
              <p style={{ fontFamily: "Arial, sans-serif", fontSize: '0.68rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: '#9a2918', margin: '0 0 10px' }}>The Collection</p>
              <h2 style={{ fontFamily: "Arial, sans-serif", fontSize: 'clamp(1.8rem, 3vw, 2.8rem)', fontWeight: 400, color: '#9a2918', margin: 0, lineHeight: 1.1 }}>Find your bag.</h2>
            </motion.div>
            <Link
              to="/shop"
              style={{ fontFamily: "Arial, sans-serif", fontSize: '0.78rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#9a2918', textDecoration: 'none', borderBottom: '1px solid rgba(154,41,24,0.35)', paddingBottom: 4, alignSelf: 'flex-end' }}
            >
              Shop all coffees →
            </Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'clamp(20px, 3vw, 36px)' }}>
            {bags.map((bag, i) => (
              <motion.div
                key={i}
                {...fadeUp(i * 0.1)}
                style={{ display: 'flex', flexDirection: 'column', cursor: 'default' }}
                onMouseEnter={() => setHoveredBag(i)}
                onMouseLeave={() => setHoveredBag(null)}
              >
                {/* Tile — bag and archetype image crossfade within the same container */}
                <div style={{ backgroundColor: '#e5e5da', aspectRatio: '3/4', position: 'relative', overflow: 'hidden' }}>
                  {/* Bag — fades out on hover */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: hoveredBag === i ? 0 : 1,
                    transition: 'opacity 0.45s ease',
                  }}>
                    <img src={bag.img} alt={bag.label} style={{ width: '70%', height: '80%', objectFit: 'contain', display: 'block' }} />
                  </div>
                  {/* Archetype photo — fades in on hover */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    opacity: hoveredBag === i ? 1 : 0,
                    transition: 'opacity 0.45s ease',
                  }}>
                    <img src={bag.hoverImg} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }} />
                  </div>
                </div>

                {/* Label */}
                <p style={{ fontFamily: "Arial, sans-serif", fontSize: '0.8rem', letterSpacing: '0.1em', color: '#9a2918', margin: '14px 0 0', textAlign: 'center' }}>{bag.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ━━━ 4. CINEMATIC VIDEO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*
        To swap in a different video: replace <source src={...}> and update poster={}
      */}
      <section style={{ position: 'relative', height: '65vh', overflow: 'hidden', backgroundColor: '#1a1208' }}>
        <video
          ref={cinematicVideoRef}
          autoPlay muted playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 40%', display: 'block', transform: 'scale(1.06)' }}
        >
          <source src={placeholderVideo} type="video/mp4" />
        </video>
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(17,17,16,0.3)' }} />
        <p style={{
          position: 'absolute',
          bottom: 'clamp(32px, 5vh, 56px)',
          left: 'clamp(32px, 6vw, 64px)',
          fontFamily: "Arial, sans-serif",
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

      {/* ━━━ 5. FLAVOR MAP — archetype cards ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', padding: 'clamp(56px, 8vw, 88px) clamp(24px, 4vw, 64px)' }}>
        {/* Header — left-aligned with the blocks (no centering wrapper) */}
        <motion.div {...fadeUp(0)} style={{ marginBottom: 'clamp(28px, 4vw, 44px)' }}>
          <p style={{ fontFamily: "Arial, sans-serif", fontSize: '0.68rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: '#9a2918', margin: '0 0 12px' }}>
            The Flavor Map
          </p>
          <h2 style={{ fontFamily: "Arial, sans-serif", fontSize: 'clamp(1.5rem, 2.2vw, 2.2rem)', fontWeight: 400, color: '#9a2918', lineHeight: 1.15, margin: 0 }}>
            Every palate has a direction.
          </h2>
        </motion.div>

        {/* Blocks — full width between section paddings, scroll on narrow screens */}
        <div style={{ display: 'flex', gap: 3, overflowX: 'auto' }}>
          {archetypes.map((arch) => (
            <div
              key={arch.num}
              style={{
                flex: '1 0 140px',
                minHeight: 360,
                backgroundColor: arch.bg,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '22px 16px 18px',
                boxSizing: 'border-box',
              }}
            >
                {/* Top: number + headline + body */}
                <div>
                  <p style={{ fontFamily: "Arial, sans-serif", fontSize: '0.6rem', letterSpacing: '0.2em', color: '#ebebe3', margin: '0 0 10px', opacity: 0.65 }}>
                    {arch.num}
                  </p>
                  <h3 style={{ fontFamily: "Arial, sans-serif", fontSize: 'clamp(1rem, 1.5vw, 1.3rem)', fontWeight: 400, color: '#ebebe3', margin: '0 0 14px', lineHeight: 1.2 }}>
                    {arch.name}
                  </h3>
                  <p style={{ fontFamily: "Arial, sans-serif", fontSize: 'clamp(0.72rem, 0.9vw, 0.8rem)', color: '#ebebe3', lineHeight: 1.65, margin: 0, opacity: 0.88 }}>
                    {arch.body}
                  </p>
                </div>
                {/* Bottom: keywords */}
                <p style={{
                  fontFamily: "Arial, sans-serif",
                  fontSize: '0.58rem',
                  letterSpacing: '0.13em',
                  textTransform: 'uppercase',
                  color: '#ebebe3',
                  margin: '16px 0 0',
                  opacity: 0.58,
                  borderTop: '1px solid rgba(235,235,227,0.22)',
                  paddingTop: 10,
                  lineHeight: 1.6,
                }}>
                  {arch.footer}
                </p>
              </div>
            ))}
        </div>
      </section>

      {/* ━━━ 6. QUIZ CTA ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', borderTop: '1px solid rgba(154,41,24,0.18)', padding: 'clamp(48px, 6vw, 72px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
          <motion.div {...fadeUp(0)} style={{ marginBottom: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <a
              href="/find-my-flavor"
              style={{ fontFamily: "Arial, sans-serif", fontSize: '0.85rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: '#9a2918', textDecoration: 'none', borderBottom: '1px solid rgba(154,41,24,0.4)', paddingBottom: 3 }}
            >
              TAKE THE QUIZ →
            </a>
            <Link
              to="/sign-in"
              style={{ fontFamily: "Arial, sans-serif", fontSize: '0.72rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9a2918', textDecoration: 'none', opacity: 0.45, borderBottom: '1px solid rgba(154,41,24,0.25)', paddingBottom: 2 }}
            >
              or sign in →
            </Link>
          </motion.div>
          <motion.p {...fadeUp(0.12)} style={{ fontFamily: "Arial, sans-serif", fontSize: 'clamp(0.88rem, 1.4vw, 1rem)', fontWeight: 400, color: '#9a2918', opacity: 0.62, lineHeight: 1.85, margin: 0 }}>
            Our flavor system is designed to remove the guesswork. Answer a few questions and find your perfect coffee match.
          </motion.p>
        </div>
      </section>

      {/* ━━━ 7. TASTE FINDER (curtain animation) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <TasteFinderSection />

    </div>
  );
}
