import { useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { TasteFinderSection } from './TasteFinderSection';
import familyPhoto from '../../design/IMAGES/lifestyle/FamilyEdit.jpg'
import coffeePic15 from '../../design/IMAGES/lifestyle/CoffeePic15.jpg'
import heroVideo from '../../design/IMAGES/videos/PlaceHolder09.mp4'
import video08 from '../../design/IMAGES/videos/PlaceHolder08.mp4'

// ─── Data ────────────────────────────────────────────────────────────────────

const archetypes = [
  { name: 'Floral',            bg: '#a34b78' },
  { name: 'Fruity',            bg: '#ca445f' },
  { name: 'Balanced & Sweet',  bg: '#d1ac11' },
  { name: 'Chocolate & Nutty', bg: '#a54c2d' },
  { name: 'Spicy & Earthy',    bg: '#912f2f' },
  { name: 'Experimental',      bg: '#056c7a' },
];

// ─── Shared animation preset ─────────────────────────────────────────────────

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 } as const,
  viewport: { once: true, amount: 0.2 },
  transition: { duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] as const },
});

// ─── Component ───────────────────────────────────────────────────────────────

export default function About() {
  const heroVideoRef      = useRef<HTMLVideoElement>(null);
  const emotionalVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const attachLoop = (ref: React.RefObject<HTMLVideoElement | null>) => {
      const video = ref.current;
      if (!video) return () => {};
      let rafId: number;
      const tick = () => {
        if (video.duration && video.currentTime >= video.duration - 0.5) {
          video.currentTime = 0.05;
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafId);
    };
    const cleanHero      = attachLoop(heroVideoRef);
    const cleanEmotional = attachLoop(emotionalVideoRef);
    return () => { cleanHero(); cleanEmotional(); };
  }, []);

  return (
    <div style={{ backgroundColor: '#f2f1ea' }}>

      {/* ━━━ 1. HERO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*
        Placeholder09.mp4 — swap <source src> for final brand video when ready.
        Poster uses first-frame fallback via CSS background on the section.
      */}
      <section style={{ position: 'relative', height: '100vh', overflow: 'hidden', backgroundColor: '#111110' }}>
        <video
          ref={heroVideoRef}
          autoPlay muted playsInline
          poster={coffeePic15}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'center 40%',
            display: 'block', transform: 'scale(1.06)',
          }}
        >
          <source src={heroVideo} type="video/mp4" />
        </video>

        {/* Bottom-weighted gradient — same treatment as homepage hero */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to top, rgba(17,17,16,0.72) 0%, rgba(17,17,16,0.24) 50%, rgba(17,17,16,0.04) 100%)',
        }} />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          style={{
            position: 'absolute',
            bottom: 'clamp(48px, 8vh, 96px)',
            left: 'clamp(32px, 6vw, 96px)',
          }}
        >
          {/* Eyebrow */}
          <p style={{
            fontFamily: "Arial, sans-serif",
            fontSize: '0.7rem',
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: '#bf6a58',
            margin: '0 0 20px',
          }}>
            Our Story
          </p>

          {/* Display heading — terracotta, cinematic scale */}
          <h1 style={{
            fontFamily: "Arial, sans-serif",
            fontSize: 'clamp(3rem, 6.5vw, 6.5rem)',
            fontWeight: 400,
            lineHeight: 1.0,
            letterSpacing: '-0.02em',
            margin: '0 0 28px',
          }}>
            <span style={{ display: 'block', color: '#9a2918' }}>About</span>
            <span style={{ display: 'block', color: '#9a2918' }}>Axis &</span>
            <span style={{ display: 'block', color: '#9a2918' }}>Bloom.</span>
          </h1>

          {/* Sub-heading — "personal" highlighted in pink */}
          <p style={{
            fontFamily: "Arial, sans-serif",
            fontSize: 'clamp(0.95rem, 1.4vw, 1.15rem)',
            fontWeight: 400,
            color: 'rgba(242,241,234,0.78)',
            lineHeight: 1.75,
            margin: 0,
            maxWidth: 500,
          }}>
            Choosing coffee should feel{' '}
            <span style={{
              backgroundColor: '#ee5974',
              color: '#f2f1ea',
              padding: '1px 10px 4px',
              display: 'inline',
            }}>
              personal
            </span>
            ,{' '}intuitive, and pleasurable.
          </p>
        </motion.div>
      </section>

      {/* ━━━ 2. BRAND STORY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', padding: 'clamp(80px, 10vw, 136px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 1160, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 'clamp(40px, 7vw, 112px)', flexWrap: 'wrap' }}>

            <motion.div {...fadeUp(0)} style={{ flex: '0 0 auto', width: 'clamp(200px, 26%, 280px)' }}>
              <p style={{
                fontFamily: "Arial, sans-serif",
                fontSize: '0.68rem', letterSpacing: '0.24em',
                textTransform: 'uppercase', color: '#9a2918', margin: '0 0 20px',
              }}>
                What we are
              </p>
              <h2 style={{
                fontFamily: "Arial, sans-serif",
                fontSize: 'clamp(1.7rem, 2.6vw, 2.6rem)',
                fontWeight: 400, color: '#9a2918', lineHeight: 1.1, margin: 0,
              }}>
                A new way<br />to discover<br />coffee.
              </h2>
            </motion.div>

            <motion.div {...fadeUp(0.15)} style={{ flex: '1 1 380px', maxWidth: 640 }}>
              <div style={{
                fontFamily: "Arial, sans-serif",
                fontSize: 'clamp(0.95rem, 1.2vw, 1.05rem)',
                fontWeight: 400, color: '#7b7f80', lineHeight: 1.9,
              }}>
                <p style={{ margin: '0 0 1.6em' }}>
                  Axis & Bloom was created from a simple idea: choosing coffee should feel personal, intuitive, and pleasurable.
                </p>
                <p style={{ margin: '0 0 1.6em' }}>
                  Coffee is full of language — roast levels, origins, processing methods, tasting notes, acidity, body, balance. For some people, that language is exciting. For many others, it can feel like a barrier.
                </p>
                <p style={{ margin: '0 0 1.6em' }}>
                  You may know that you want something warm, smooth, bright, floral, chocolatey, deep, or surprising — but not know how to translate that into the right coffee. Axis & Bloom begins there.
                </p>
                <p style={{ margin: '0 0 1.6em', color: '#9a2918', fontSize: 'clamp(1rem, 1.3vw, 1.1rem)', lineHeight: 1.75 }}>
                  Instead of asking you to become a coffee expert, we ask questions about taste, mood, ritual, comfort, curiosity, and how coffee fits into your day.
                </p>
                <p style={{ margin: '0 0 1.6em' }}>
                  Through a personalized taste quiz, we help you understand your preferences and find coffees that feel aligned with the way you naturally enjoy flavor.
                </p>
                <p style={{ margin: 0 }}>
                  Axis & Bloom turns those instincts into a clearer path.
                </p>
              </div>
            </motion.div>

          </div>
        </div>
      </section>

      {/* ━━━ 3. AXIS / BLOOM ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*
        Editorial typographic composition — no rectangular cards.
        Left: "Axis" display type + copy.
        Right: CoffeePic15 editorial photo + "Bloom" display type + copy.
      */}
      <section style={{ backgroundColor: '#f2f1ea', padding: 'clamp(80px, 10vw, 128px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 1160, margin: '0 auto' }}>

          <motion.p {...fadeUp(0)} style={{
            fontFamily: "Arial, sans-serif",
            fontSize: '0.68rem', letterSpacing: '0.24em',
            textTransform: 'uppercase', color: '#9a2918',
            margin: '0 0 clamp(48px, 7vw, 80px)',
            opacity: 0.7,
          }}>
            The name
          </motion.p>

          <div style={{ display: 'flex', gap: 'clamp(32px, 6vw, 80px)', flexWrap: 'wrap', alignItems: 'flex-start' }}>

            {/* ── Axis column ─────────────────────────────────────────── */}
            <motion.div {...fadeUp(0)} style={{ flex: '1 1 280px' }}>
              {/* Ghost display word */}
              <p style={{
                fontFamily: "Arial, sans-serif",
                fontSize: 'clamp(5rem, 9vw, 9rem)',
                fontWeight: 400,
                color: '#9a2918',
                opacity: 0.07,
                lineHeight: 0.85,
                letterSpacing: '-0.03em',
                margin: '0 0 clamp(24px, 3vw, 36px)',
                pointerEvents: 'none',
                userSelect: 'none',
              }}>
                Axis
              </p>
              {/* Headline */}
              <p style={{
                fontFamily: "Arial, sans-serif",
                fontSize: 'clamp(1.4rem, 2.2vw, 2rem)',
                fontWeight: 400,
                color: '#9a2918',
                lineHeight: 1.2,
                margin: '0 0 20px',
              }}>
                The point of orientation.
              </p>
              {/* Thin rule */}
              <div style={{ width: 40, height: 1, backgroundColor: '#9a2918', opacity: 0.22, margin: '0 0 20px' }} />
              {/* Body */}
              <p style={{
                fontFamily: "Arial, sans-serif",
                fontSize: 'clamp(0.9rem, 1.15vw, 1rem)',
                fontWeight: 400,
                color: '#7b7f80',
                lineHeight: 1.85,
                margin: 0,
                maxWidth: 360,
              }}>
                The direction that grounds you. The flavor axis that anchors your taste — the foundation every great cup is built upon.
              </p>
            </motion.div>

            {/* ── Bloom column ─────────────────────────────────────────── */}
            <motion.div {...fadeUp(0.12)} style={{ flex: '1 1 280px' }}>
              {/* Editorial photo */}
              <div style={{
                width: '100%',
                aspectRatio: '4 / 5',
                overflow: 'hidden',
                marginBottom: 'clamp(24px, 3.5vw, 40px)',
              }}>
                <img
                  src={coffeePic15}
                  alt=""
                  style={{
                    width: '100%', height: '100%',
                    objectFit: 'cover', objectPosition: 'center 35%',
                    display: 'block',
                  }}
                />
              </div>
              {/* Ghost display word */}
              <p style={{
                fontFamily: "Arial, sans-serif",
                fontSize: 'clamp(5rem, 9vw, 9rem)',
                fontWeight: 400,
                color: '#9a2918',
                opacity: 0.07,
                lineHeight: 0.85,
                letterSpacing: '-0.03em',
                margin: '0 0 clamp(24px, 3vw, 36px)',
                pointerEvents: 'none',
                userSelect: 'none',
              }}>
                Bloom
              </p>
              {/* Headline */}
              <p style={{
                fontFamily: "Arial, sans-serif",
                fontSize: 'clamp(1.4rem, 2.2vw, 2rem)',
                fontWeight: 400,
                color: '#9a2918',
                lineHeight: 1.2,
                margin: '0 0 20px',
              }}>
                What opens from there.
              </p>
              {/* Thin rule */}
              <div style={{ width: 40, height: 1, backgroundColor: '#9a2918', opacity: 0.22, margin: '0 0 20px' }} />
              {/* Body */}
              <p style={{
                fontFamily: "Arial, sans-serif",
                fontSize: 'clamp(0.9rem, 1.15vw, 1rem)',
                fontWeight: 400,
                color: '#7b7f80',
                lineHeight: 1.85,
                margin: 0,
                maxWidth: 360,
              }}>
                Aroma, pleasure, discovery. The sensory world of coffee that unfolds once you know your direction.
              </p>
            </motion.div>

          </div>
        </div>
      </section>

      {/* ━━━ 4. A NOTE FROM US ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*
        Left column: meta label + names + family photo (intimate, editorial).
        Right column: founders' letter.
      */}
      <section style={{ backgroundColor: '#e5e5da', padding: 'clamp(80px, 10vw, 128px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 1160, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 'clamp(40px, 7vw, 112px)', flexWrap: 'wrap', alignItems: 'flex-start' }}>

            {/* Left: meta + photo */}
            <motion.div {...fadeUp(0)} style={{ flex: '0 0 auto', width: 'clamp(220px, 32%, 360px)' }}>
              <p style={{
                fontFamily: "Arial, sans-serif",
                fontSize: '0.68rem', letterSpacing: '0.24em',
                textTransform: 'uppercase', color: '#9a2918', margin: '0 0 20px',
              }}>
                A note from us
              </p>
              <p style={{
                fontFamily: "Arial, sans-serif",
                fontSize: 'clamp(1.1rem, 1.5vw, 1.35rem)',
                fontWeight: 400, color: '#9a2918', lineHeight: 1.4, margin: '0 0 16px',
              }}>
                Camila<br />& Dana
              </p>
              <div style={{ width: 32, height: 1, backgroundColor: '#9a2918', opacity: 0.25, margin: '0 0 14px' }} />
              <p style={{
                fontFamily: "Arial, sans-serif",
                fontSize: '0.7rem', letterSpacing: '0.12em',
                textTransform: 'uppercase', color: '#9a2918', opacity: 0.55,
                lineHeight: 1.7, margin: '0 0 clamp(28px, 4vw, 44px)',
              }}>
                Partners in life<br />and in this project.
              </p>

              {/* Family photo — intimate, vertical, editorial */}
              <div style={{
                width: '100%',
                aspectRatio: '3 / 4',
                overflow: 'hidden',
              }}>
                <img
                  src={familyPhoto}
                  alt="Camila and Dana"
                  style={{
                    width: '100%', height: '100%',
                    objectFit: 'cover', objectPosition: 'center 25%',
                    display: 'block',
                  }}
                />
              </div>
            </motion.div>

            {/* Right: letter copy */}
            <motion.div {...fadeUp(0.15)} style={{ flex: '1 1 380px', maxWidth: 620 }}>
              <div style={{
                fontFamily: "Arial, sans-serif",
                fontSize: 'clamp(0.95rem, 1.2vw, 1.05rem)',
                fontWeight: 400, color: '#7b7f80', lineHeight: 1.9,
              }}>
                <p style={{ margin: '0 0 1.6em', color: '#9a2918', fontSize: 'clamp(1.05rem, 1.4vw, 1.2rem)', lineHeight: 1.65 }}>
                  We created Axis & Bloom because we wanted coffee discovery to feel more human, more beautiful, and more connected to everyday ritual.
                </p>
                <p style={{ margin: '0 0 1.6em' }}>
                  We both love the small moments that shape a day: the first cup in the morning, the pause after a long stretch of work, the coffee shared across a table, the quiet cup you make just for yourself.
                </p>
                <p style={{ margin: '0 0 1.6em' }}>
                  Between work, family, children, and the speed of everyday life, coffee became more than something we drink. It became a way to pause. A way to return. A way to begin again.
                </p>
                <p style={{ margin: '0 0 1.6em' }}>
                  We wanted to create an experience that felt thoughtful from the first question to the first sip. Something personal, but not complicated. Beautiful, but useful. Guided, but still full of your own instincts and preferences.
                </p>
                <p style={{ margin: 0 }}>
                  Axis & Bloom is our way of bringing those things together: taste, design, ritual, and care. We hope it helps you discover not just a coffee you like, but a ritual that feels like yours.
                </p>
              </div>
            </motion.div>

          </div>
        </div>
      </section>

      {/* ━━━ 5. EMOTIONAL VIDEO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ position: 'relative', height: '68vh', overflow: 'hidden', backgroundColor: '#111110' }}>
        <video
          ref={emotionalVideoRef}
          autoPlay muted playsInline
          poster={coffeePic15}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'center',
            display: 'block', transform: 'scale(1.06)',
          }}
        >
          <source src={video08} type="video/mp4" />
        </video>
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(15,12,11,0.44)' }} />
        <div style={{
          position: 'absolute',
          bottom: 'clamp(40px, 6vh, 72px)',
          left: 'clamp(32px, 6vw, 96px)',
        }}>
          <p style={{
            fontFamily: "Arial, sans-serif",
            fontSize: 'clamp(1.05rem, 2vw, 1.55rem)',
            fontWeight: 400,
            color: '#f2f1ea',
            lineHeight: 1.65,
            margin: 0,
            maxWidth: 520,
          }}>
            For us, coffee is a morning{' '}
            <span style={{
              backgroundColor: '#ee5974',
              color: '#f2f1ea',
              padding: '0 8px 3px',
              display: 'inline',
            }}>
              pause
            </span>
            ,<br />a shared table, a moment alone,<br />a return.
          </p>
        </div>
      </section>

      {/* ━━━ 6. FLAVOR SYSTEM / ARCHETYPE BRIDGE ━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', padding: 'clamp(72px, 9vw, 112px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 1160, margin: '0 auto' }}>
          <div style={{
            display: 'flex', gap: 'clamp(40px, 7vw, 96px)',
            flexWrap: 'wrap', alignItems: 'flex-end',
            marginBottom: 'clamp(36px, 5vw, 56px)',
          }}>
            <motion.div {...fadeUp(0)} style={{ flex: '1 1 320px' }}>
              <p style={{
                fontFamily: "Arial, sans-serif",
                fontSize: '0.68rem', letterSpacing: '0.24em',
                textTransform: 'uppercase', color: '#9a2918', margin: '0 0 16px',
              }}>
                The flavor system
              </p>
              <h2 style={{
                fontFamily: "Arial, sans-serif",
                fontSize: 'clamp(1.6rem, 2.6vw, 2.4rem)',
                fontWeight: 400, color: '#9a2918', lineHeight: 1.15, margin: 0,
              }}>
                Every palate belongs<br />to a sensory world.
              </h2>
            </motion.div>
            <motion.p {...fadeUp(0.1)} style={{
              flex: '1 1 280px', maxWidth: 400,
              fontFamily: "Arial, sans-serif",
              fontSize: 'clamp(0.88rem, 1.1vw, 0.98rem)',
              fontWeight: 400, color: '#7b7f80', lineHeight: 1.85, margin: 0,
            }}>
              Six flavor archetypes. Each one a different direction. One is made for you.
            </motion.p>
          </div>

          <motion.div {...fadeUp(0.1)} style={{ display: 'flex', gap: 3, overflowX: 'auto' }}>
            {archetypes.map((a) => (
              <div
                key={a.name}
                style={{
                  flex: '1 0 100px',
                  height: 72,
                  backgroundColor: a.bg,
                  display: 'flex',
                  alignItems: 'flex-end',
                  padding: '0 12px 10px',
                  boxSizing: 'border-box',
                }}
              >
                <span style={{
                  fontFamily: "Arial, sans-serif",
                  fontSize: '0.58rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: '#ebebe3',
                  opacity: 0.78,
                  lineHeight: 1.4,
                }}>
                  {a.name}
                </span>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ━━━ 7. CURTAIN REVEAL + FOOTER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/*
        Same TasteFinderSection as the homepage — any changes to that component
        automatically apply here too.
      */}
      <TasteFinderSection />

    </div>
  );
}
