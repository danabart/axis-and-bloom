import { motion } from 'motion/react';
import { Link } from 'react-router';
import familyPhoto from '../../design/IMAGES/lifestyle/FamilyEdit.jpg'
import video08 from '../../design/IMAGES/videos/PlaceHolder08.mp4'

// ─── Data ────────────────────────────────────────────────────────────────────

const archetypes = [
  { name: 'Floral', bg: '#a34b78' },
  { name: 'Fruity', bg: '#ca445f' },
  { name: 'Balanced & Sweet', bg: '#d1ac11' },
  { name: 'Chocolate & Nutty', bg: '#a54c2d' },
  { name: 'Spicy & Earthy', bg: '#912f2f' },
  { name: 'Experimental', bg: '#056c7a' },
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
  return (
    <div style={{ backgroundColor: '#f2f1ea' }}>

      {/* ━━━ 1. HERO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}>
        <img
          src={familyPhoto}
          alt=""
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'center 30%',
          }}
        />
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to top, rgba(15,12,11,0.75) 0%, rgba(15,12,11,0.35) 50%, rgba(15,12,11,0.08) 100%)',
        }} />
        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          style={{
            position: 'absolute',
            bottom: 'clamp(52px, 8vh, 96px)',
            left: 'clamp(32px, 6vw, 96px)',
          }}
        >
          <p style={{
            fontFamily: "'Genova', sans-serif",
            fontSize: '0.7rem',
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: '#bf6a58',
            margin: '0 0 18px',
          }}>
            Our Story
          </p>
          <h1 style={{
            fontFamily: "'Genova', sans-serif",
            fontSize: 'clamp(3rem, 6vw, 6rem)',
            fontWeight: 400,
            lineHeight: 1.0,
            letterSpacing: '-0.02em',
            color: '#f2f1ea',
            margin: '0 0 22px',
          }}>
            About Axis<br />& Bloom
          </h1>
          <p style={{
            fontFamily: "'Genova', sans-serif",
            fontSize: 'clamp(0.95rem, 1.4vw, 1.15rem)',
            fontWeight: 400,
            color: 'rgba(242,241,234,0.72)',
            lineHeight: 1.7,
            margin: 0,
            maxWidth: 480,
          }}>
            Choosing coffee should feel personal,<br />intuitive, and pleasurable.
          </p>
        </motion.div>
      </section>

      {/* ━━━ 2. BRAND STORY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', padding: 'clamp(88px, 11vw, 148px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 1160, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 'clamp(40px, 7vw, 112px)', flexWrap: 'wrap' }}>

            <motion.div {...fadeUp(0)} style={{ flex: '0 0 auto', width: 'clamp(220px, 26%, 300px)' }}>
              <p style={{
                fontFamily: "'Genova', sans-serif",
                fontSize: '0.68rem', letterSpacing: '0.24em',
                textTransform: 'uppercase', color: '#9a2918', margin: '0 0 20px',
              }}>
                What we are
              </p>
              <h2 style={{
                fontFamily: "'Genova', sans-serif",
                fontSize: 'clamp(1.8rem, 2.8vw, 2.8rem)',
                fontWeight: 400, color: '#9a2918', lineHeight: 1.1, margin: 0,
              }}>
                A new way<br />to discover<br />coffee.
              </h2>
            </motion.div>

            <motion.div {...fadeUp(0.15)} style={{ flex: '1 1 380px', maxWidth: 640 }}>
              <div style={{
                fontFamily: "'Genova', sans-serif",
                fontSize: 'clamp(0.95rem, 1.2vw, 1.05rem)',
                fontWeight: 400,
                color: '#7b7f80',
                lineHeight: 1.9,
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
                  Through a personalized taste quiz, we help you understand your preferences and find coffees that feel aligned with the way you naturally enjoy flavor. From there, we connect you to a flavor archetype — a sensory world that gives language to what you already know you love.
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
      <section style={{ backgroundColor: '#e5e5da', padding: 'clamp(80px, 10vw, 120px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 1160, margin: '0 auto' }}>
          <motion.p {...fadeUp(0)} style={{
            fontFamily: "'Genova', sans-serif",
            fontSize: '0.68rem', letterSpacing: '0.24em',
            textTransform: 'uppercase', color: '#9a2918', margin: '0 0 52px',
          }}>
            The name
          </motion.p>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>

            {/* AXIS block */}
            <motion.div {...fadeUp(0)} style={{
              flex: '1 1 320px',
              backgroundColor: '#9a2918',
              padding: 'clamp(40px, 5vw, 64px)',
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
              minHeight: 340,
            }}>
              <p style={{
                fontFamily: "'Genova', sans-serif",
                fontSize: 'clamp(4rem, 8vw, 8rem)',
                fontWeight: 900,
                color: '#f2f1ea',
                lineHeight: 1,
                margin: '0 0 40px',
                opacity: 0.12,
                letterSpacing: '-0.02em',
              }}>
                Axis
              </p>
              <div>
                <p style={{
                  fontFamily: "'Genova', sans-serif",
                  fontSize: 'clamp(1.3rem, 2.2vw, 1.9rem)',
                  fontWeight: 400, color: '#f2f1ea', lineHeight: 1.25, margin: '0 0 14px',
                }}>
                  The point of orientation.
                </p>
                <p style={{
                  fontFamily: "'Genova', sans-serif",
                  fontSize: 'clamp(0.88rem, 1.1vw, 0.98rem)',
                  fontWeight: 400,
                  color: 'rgba(242,241,234,0.62)',
                  lineHeight: 1.8, margin: 0, maxWidth: 380,
                }}>
                  The direction that grounds you. The flavor axis that anchors your taste — the foundation every great cup is built upon.
                </p>
              </div>
            </motion.div>

            {/* BLOOM block */}
            <motion.div {...fadeUp(0.1)} style={{
              flex: '1 1 320px',
              backgroundColor: '#f2f1ea',
              border: '1px solid rgba(154,41,24,0.12)',
              padding: 'clamp(40px, 5vw, 64px)',
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
              minHeight: 340,
            }}>
              <p style={{
                fontFamily: "'Genova', sans-serif",
                fontSize: 'clamp(4rem, 8vw, 8rem)',
                fontWeight: 900,
                color: '#9a2918',
                lineHeight: 1,
                margin: '0 0 40px',
                opacity: 0.08,
                letterSpacing: '-0.02em',
              }}>
                Bloom
              </p>
              <div>
                <p style={{
                  fontFamily: "'Genova', sans-serif",
                  fontSize: 'clamp(1.3rem, 2.2vw, 1.9rem)',
                  fontWeight: 400, color: '#9a2918', lineHeight: 1.25, margin: '0 0 14px',
                }}>
                  What opens from there.
                </p>
                <p style={{
                  fontFamily: "'Genova', sans-serif",
                  fontSize: 'clamp(0.88rem, 1.1vw, 0.98rem)',
                  fontWeight: 400,
                  color: '#7b7f80',
                  lineHeight: 1.8, margin: 0, maxWidth: 380,
                }}>
                  Aroma, pleasure, discovery. The sensory world of coffee that unfolds once you know your direction.
                </p>
              </div>
            </motion.div>

          </div>
        </div>
      </section>

      {/* ━━━ 4. A NOTE FROM US ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', padding: 'clamp(88px, 11vw, 148px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 1160, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 'clamp(40px, 7vw, 112px)', flexWrap: 'wrap', alignItems: 'flex-start' }}>

            <motion.div {...fadeUp(0)} style={{ flex: '0 0 auto', width: 'clamp(200px, 26%, 300px)' }}>
              <p style={{
                fontFamily: "'Genova', sans-serif",
                fontSize: '0.68rem', letterSpacing: '0.24em',
                textTransform: 'uppercase', color: '#9a2918', margin: '0 0 20px',
              }}>
                A note from us
              </p>
              <p style={{
                fontFamily: "'Genova', sans-serif",
                fontSize: 'clamp(1.1rem, 1.5vw, 1.35rem)',
                fontWeight: 400, color: '#9a2918', lineHeight: 1.4, margin: '0 0 18px',
              }}>
                Camila<br />& Dana
              </p>
              <div style={{ width: 32, height: 1, backgroundColor: '#9a2918', opacity: 0.25, margin: '0 0 18px' }} />
              <p style={{
                fontFamily: "'Genova', sans-serif",
                fontSize: '0.7rem', letterSpacing: '0.14em',
                textTransform: 'uppercase', color: '#9a2918', opacity: 0.55, margin: 0,
                lineHeight: 1.7,
              }}>
                Partners in life<br />and in this project.
              </p>
            </motion.div>

            <motion.div {...fadeUp(0.15)} style={{ flex: '1 1 380px', maxWidth: 640 }}>
              <div style={{
                fontFamily: "'Genova', sans-serif",
                fontSize: 'clamp(0.95rem, 1.2vw, 1.05rem)',
                fontWeight: 400,
                color: '#7b7f80',
                lineHeight: 1.9,
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
          autoPlay loop muted playsInline
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'center',
          }}
        >
          <source src={video08} type="video/mp4" />
        </video>
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(15,12,11,0.42)' }} />
        <div style={{
          position: 'absolute',
          bottom: 'clamp(40px, 6vh, 72px)',
          left: 'clamp(32px, 6vw, 96px)',
        }}>
          <p style={{
            fontFamily: "'Genova', sans-serif",
            fontSize: 'clamp(1.1rem, 2.1vw, 1.65rem)',
            fontWeight: 400,
            color: '#f2f1ea',
            lineHeight: 1.6,
            margin: 0,
            maxWidth: 540,
          }}>
            For us, coffee is a morning{' '}
            <span style={{
              backgroundColor: '#ee5974',
              color: '#f2f1ea',
              padding: '0 9px 3px',
              display: 'inline',
            }}>
              pause
            </span>
            ,<br />a shared table, a moment alone,<br />a return.
          </p>
        </div>
      </section>

      {/* ━━━ 6. ARCHETYPE BRIDGE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#f2f1ea', padding: 'clamp(80px, 10vw, 120px) clamp(32px, 6vw, 96px)' }}>
        <div style={{ maxWidth: 1160, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 'clamp(40px, 7vw, 96px)', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 'clamp(40px, 5vw, 64px)' }}>
            <motion.div {...fadeUp(0)} style={{ flex: '1 1 320px' }}>
              <p style={{
                fontFamily: "'Genova', sans-serif",
                fontSize: '0.68rem', letterSpacing: '0.24em',
                textTransform: 'uppercase', color: '#9a2918', margin: '0 0 16px',
              }}>
                The flavor system
              </p>
              <h2 style={{
                fontFamily: "'Genova', sans-serif",
                fontSize: 'clamp(1.7rem, 2.8vw, 2.6rem)',
                fontWeight: 400, color: '#9a2918', lineHeight: 1.15, margin: 0,
              }}>
                Every palate belongs<br />to a sensory world.
              </h2>
            </motion.div>
            <motion.p {...fadeUp(0.1)} style={{
              flex: '1 1 280px', maxWidth: 400,
              fontFamily: "'Genova', sans-serif",
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
                  fontFamily: "'Genova', sans-serif",
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

      {/* ━━━ 7. FINAL CTA ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <section style={{ backgroundColor: '#9a2918', padding: 'clamp(96px, 12vw, 160px) clamp(32px, 6vw, 96px)' }}>
        <motion.div {...fadeUp(0)} style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: "'Genova', sans-serif",
            fontWeight: 400,
            lineHeight: 1.0,
            marginBottom: 44,
            display: 'inline-block',
          }}>
            <span style={{ display: 'block', fontSize: 'clamp(2.6rem, 5.5vw, 5.5rem)', color: '#f2f1ea' }}>
              Which
            </span>
            <span style={{
              display: 'inline-block',
              fontSize: 'clamp(2.6rem, 5.5vw, 5.5rem)',
              backgroundColor: '#ee5974',
              color: '#f2f1ea',
              padding: '2px 18px 8px',
              margin: '6px 0',
            }}>
              archetype
            </span>
            <span style={{ display: 'block', fontSize: 'clamp(2.6rem, 5.5vw, 5.5rem)', color: '#f2f1ea', marginTop: 6 }}>
              is yours?
            </span>
          </div>
          <div>
            <Link
              to="/find-my-flavor"
              style={{
                fontFamily: "'Genova', sans-serif",
                fontSize: '0.82rem',
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: '#f2f1ea',
                textDecoration: 'none',
                borderBottom: '1px solid rgba(242,241,234,0.38)',
                paddingBottom: 4,
              }}
            >
              TAKE THE QUIZ →
            </Link>
          </div>
        </motion.div>
      </section>

    </div>
  );
}
