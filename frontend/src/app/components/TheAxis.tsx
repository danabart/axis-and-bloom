import { motion } from 'motion/react';

// ── Design constants ───────────────────────────────────────────────────────────

// Five illustrative line colors — aesthetic only, not mapped to specific archetypes
const LINE_COLORS = ['#a54c2d', '#c9a830', '#7a6a4f', '#8a7cbe', '#ca445f'];

const DIM_LABELS = ['Sweet', 'Acidity', 'Bitter', 'Body', 'Texture', 'Depth', 'Finish'];

// Illustrative values — chosen for visual differentiation, not real archetype data
const CONCEPT_LINES = [
  [9,  3, 10, 13, 10,  9, 11],
  [11,  8,  3,  7,  2,  4,  6],
  [ 5,  3,  8, 14, 14, 13, 12],
  [ 9, 12,  2,  5,  2,  3,  4],
  [ 7, 11,  2,  5,  3,  4,  7],
];

// ── Concept parallel coordinates (static, illustrative) ───────────────────────

function ConceptChart() {
  const W = 660, H = 160, pt = 12, pb = 34, pl = 12, pr = 12;
  const plotH = H - pt - pb;
  const n = DIM_LABELS.length;
  const step = (W - pl - pr) / (n - 1);
  const xOf = (i: number) => pl + i * step;
  const yOf = (v: number) => pt + (1 - v / 15) * plotH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      {/* Vertical axes */}
      {DIM_LABELS.map((label, i) => (
        <g key={label}>
          <line
            x1={xOf(i)} y1={pt} x2={xOf(i)} y2={H - pb}
            stroke="rgba(0,0,0,0.12)" strokeWidth={1}
          />
          <text
            x={xOf(i)} y={H - 4}
            textAnchor="middle" fontSize={9.5}
            fill="rgba(0,0,0,0.45)" fontFamily="Arial,sans-serif"
          >
            {label}
          </text>
        </g>
      ))}
      {/* Illustrative lines */}
      {CONCEPT_LINES.map((vals, li) => {
        const color = LINE_COLORS[li];
        const pts = vals.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
        return (
          <g key={li}>
            <polyline
              points={pts}
              fill="none" stroke={color} strokeWidth={1.8}
              strokeLinejoin="round" opacity={0.8}
            />
            {vals.map((v, i) => (
              <circle key={i} cx={xOf(i)} cy={yOf(v)} r={3.5} fill={color} opacity={0.88} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TheAxis() {
  return (
    <div style={{ fontFamily: 'Arial, sans-serif', backgroundColor: '#f2f1ea', minHeight: '100vh' }}>

      {/* ── Hero ── */}
      <section style={{ padding: 'clamp(88px,10vw,124px) clamp(24px,6vw,80px) clamp(48px,6vw,80px)' }}>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        >
          <p style={{
            fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
            color: 'rgba(0,0,0,0.4)', margin: '0 0 10px',
          }}>
            The Axis
          </p>
          <h1 style={{
            fontSize: 'clamp(2.4rem,6vw,3.8rem)', fontWeight: 400,
            lineHeight: 1.1, margin: '0 0 1.25rem', color: '#9a2918',
          }}>
            Every taste has<br />a location.
          </h1>
          <p style={{
            fontSize: 15, color: 'rgba(0,0,0,0.55)', lineHeight: 1.8,
            margin: 0, maxWidth: 500,
          }}>
            Flavor isn't subjective noise — it's signal. The Axis maps every coffee and every palate to
            the same seven-dimensional sensory space. Matching means finding how close those two points are.
          </p>
        </motion.div>
      </section>

      {/* ── Section 1: The Flavor Space ── */}
      <section style={{
        borderTop: '0.5px solid rgba(154,41,24,0.15)',
        padding: 'clamp(40px,6vw,64px) clamp(24px,6vw,80px)',
      }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          <p style={{
            fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
            color: 'rgba(0,0,0,0.4)', margin: '0 0 6px',
          }}>
            Step 1 — the flavor space
          </p>
          <h2 style={{ fontSize: 20, fontWeight: 400, margin: '0 0 0.75rem', color: '#9a2918' }}>
            Five regions. One continuous map.
          </h2>
          <p style={{
            fontSize: 14, color: 'rgba(0,0,0,0.55)', lineHeight: 1.75,
            maxWidth: 520, margin: '0 0 1.25rem',
          }}>
            A single word like "fruity" collapses dozens of separable signals. Parallel coordinates
            show all seven dimensions at once — and why two coffees in the same word category can
            taste completely different.
          </p>

          {/* Concept chart */}
          <div style={{ background: '#e5e5da', borderRadius: 12, padding: '1.25rem 1rem 0.75rem' }}>
            <ConceptChart />
          </div>
          <p style={{
            fontSize: 11, color: 'rgba(0,0,0,0.35)', margin: '8px 0 0',
            fontFamily: 'Arial,sans-serif', fontStyle: 'italic',
          }}>
            Five distinct flavor profiles — each a different shape across seven sensory dimensions.
          </p>

          {/* Callout cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5" style={{ marginTop: '1.5rem' }}>
            {[
              {
                title: 'What about decaf?',
                body: 'Decaf is a preference layer, not an archetype. A Chocolate & Nutty drinker who prefers decaf receives the same profile — the decaf flag is passed separately to the AI sommelier.',
              },
              {
                title: 'What about experimental coffees?',
                body: 'Experimental processing amplifies flavor but doesn\'t create a new archetype. Dimension scores still place the coffee in one of the five regions — tagged experimental, matched as usual.',
              },
            ].map(card => (
              <div key={card.title} style={{
                background: '#f2f1ea',
                border: '0.5px solid rgba(154,41,24,0.15)',
                borderRadius: 12, padding: '1.1rem 1.25rem',
              }}>
                <p style={{ fontSize: 12.5, fontWeight: 500, margin: '0 0 6px', color: '#9a2918' }}>
                  {card.title}
                </p>
                <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', margin: 0, lineHeight: 1.65 }}>
                  {card.body}
                </p>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ── Section 2: The Seven Dimensions ── */}
      <section style={{
        borderTop: '0.5px solid rgba(154,41,24,0.15)',
        background: '#e5e5da',
        padding: 'clamp(40px,6vw,64px) clamp(24px,6vw,80px)',
      }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          <p style={{
            fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
            color: 'rgba(0,0,0,0.4)', margin: '0 0 6px',
          }}>
            Step 2 — the seven dimensions
          </p>
          <h2 style={{ fontSize: 20, fontWeight: 400, margin: '0 0 1.5rem', color: '#9a2918' }}>
            A coffee is a shape, not a word.
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">

            {/* Left — data sources + evolve callout */}
            <div>
              <p style={{
                fontSize: 14, color: 'rgba(0,0,0,0.55)', marginBottom: '1.1rem', lineHeight: 1.75,
              }}>
                Each coffee's position is built from three overlapping sources,
                aggregated via the Collaborative Flavor Wheel:
              </p>
              <div style={{ marginBottom: '1rem' }}>
                {[
                  { color: '#a33726', label: 'Trained cuppers',   desc: '— SCA-scored sessions, assessed across all seven dimensions.' },
                  { color: '#7a8c6e', label: 'Roastery notes',    desc: '— bag descriptors mapped to the SCA wheel.' },
                  { color: '#7a6fa0', label: 'Customer feedback', desc: '— post-delivery tasting notes, weighted by volume and recency.' },
                ].map(s => (
                  <div key={s.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: s.color, flexShrink: 0, marginTop: 5,
                    }} />
                    <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', lineHeight: 1.6 }}>
                      <strong style={{ color: 'rgba(0,0,0,0.72)', fontWeight: 500 }}>{s.label}</strong>
                      {' '}{s.desc}
                    </span>
                  </div>
                ))}
              </div>

              <div style={{
                background: 'rgba(242,241,234,0.8)',
                borderRadius: 8, padding: '0.75rem 1rem',
                borderLeft: '2.5px solid #a33726',
              }}>
                <p style={{ fontSize: 12.5, fontWeight: 500, margin: '0 0 4px', color: '#9a2918' }}>
                  Profiles evolve continuously
                </p>
                <p style={{ fontSize: 12.5, color: 'rgba(0,0,0,0.5)', margin: 0, lineHeight: 1.55 }}>
                  As community feedback accumulates, every coffee's position in flavor space is recalibrated.
                  A profile from six months ago reflects what hundreds of drinkers have said since.
                </p>
              </div>
            </div>

            {/* Right — dimension list + how matching works */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ background: 'rgba(242,241,234,0.7)', borderRadius: 12, padding: '1.1rem' }}>
                <p style={{ fontSize: 12.5, fontWeight: 500, margin: '0 0 10px', color: '#9a2918' }}>
                  The seven dimensions
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { name: 'Sweetness',      desc: 'Perceived sugar presence and residual sweetness.' },
                    { name: 'Acidity',        desc: 'Brightness, liveliness, and citrus or wine-like sharpness.' },
                    { name: 'Bitterness',     desc: 'The roast-derived edge — from clean to intense.' },
                    { name: 'Body',           desc: 'Weight and fullness in the mouth.' },
                    { name: 'Texture',        desc: 'From silky and smooth to drying and rough.' },
                    { name: 'Savory / Depth', desc: 'Complexity, earthiness, and umami-like resonance.' },
                    { name: 'Finish Length',  desc: 'How long the flavor lingers after the last sip.' },
                  ].map(dim => (
                    <div key={dim.name} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                      <span style={{
                        fontSize: 12.5, fontWeight: 500, flexShrink: 0,
                        color: '#9a2918', width: 120,
                      }}>
                        {dim.name}
                      </span>
                      <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', lineHeight: 1.5 }}>
                        {dim.desc}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{
                background: '#f2f1ea',
                border: '0.5px solid rgba(154,41,24,0.15)',
                borderRadius: 12, padding: '1.1rem 1.25rem',
              }}>
                <p style={{ fontSize: 12.5, fontWeight: 500, margin: '0 0 6px', color: '#9a2918' }}>
                  How matching works
                </p>
                <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', margin: 0, lineHeight: 1.65 }}>
                  We calculate the flavor distance between your profile and every coffee in our catalogue.
                  The closer the match, the more precisely the coffee fits who you are as a drinker —
                  across every dimension at once.
                </p>
              </div>
            </div>

          </div>
        </motion.div>
      </section>

      {/* ── Section 3: Matching ── */}
      <section style={{
        borderTop: '0.5px solid rgba(154,41,24,0.15)',
        padding: 'clamp(40px,6vw,64px) clamp(24px,6vw,80px)',
      }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          <p style={{
            fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
            color: 'rgba(0,0,0,0.4)', margin: '0 0 6px',
          }}>
            Step 3 — matching
          </p>
          <h2 style={{ fontSize: 20, fontWeight: 400, margin: '0 0 1.5rem', color: '#9a2918' }}>
            Nearest neighbor in flavor space.
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">

            {/* Match plot SVG — static conceptual */}
            <div style={{ background: '#e5e5da', borderRadius: 12, padding: '1.25rem' }}>
              <p style={{ fontSize: 12.5, fontWeight: 500, margin: '0 0 10px', color: '#9a2918' }}>
                Your position relative to all archetypes
              </p>
              <svg viewBox="0 0 440 280" width="100%" style={{ display: 'block' }}>
                <defs>
                  <marker id="mWh" viewBox="0 0 8 6" refX="7" refY="3" markerWidth="6" markerHeight="5" orient="auto">
                    <path d="M0 0 L8 3 L0 6 z" fill="#a33726" />
                  </marker>
                  <marker id="mEx" viewBox="0 0 8 6" refX="7" refY="3" markerWidth="6" markerHeight="5" orient="auto">
                    <path d="M0 0 L8 3 L0 6 z" fill="#c4821a" />
                  </marker>
                  <marker id="mOut" viewBox="0 0 8 6" refX="7" refY="3" markerWidth="6" markerHeight="5" orient="auto">
                    <path d="M0 0 L8 3 L0 6 z" fill="#9a9595" />
                  </marker>
                </defs>
                <rect x="8" y="8" width="424" height="264" rx="8" fill="#f2f1ea" stroke="currentColor" strokeOpacity="0.07" strokeWidth="0.5" />
                <circle cx="222" cy="172" r="92" fill="#c4821a" fillOpacity="0.05" stroke="#c4821a" strokeWidth="0.75" strokeDasharray="4,3" opacity="0.7" />
                <circle cx="222" cy="172" r="60" fill="#a33726" fillOpacity="0.05" stroke="#a33726" strokeWidth="0.75" strokeDasharray="4,3" opacity="0.8" />
                <text x="278" y="111" fontSize="9" fontFamily="Arial,sans-serif" fill="#a33726" fillOpacity="0.7" letterSpacing=".07em">WHEELHOUSE</text>
                <text x="301" y="84" fontSize="9" fontFamily="Arial,sans-serif" fill="#c4821a" fillOpacity="0.65" letterSpacing=".07em">EXPLORING</text>
                <line x1="211" y1="176" x2="96" y2="224" stroke="#9a9595" strokeWidth="1" strokeDasharray="4,3" markerEnd="url(#mOut)" opacity="0.5" />
                <line x1="213" y1="163" x2="87" y2="80" stroke="#9a9595" strokeWidth="1" strokeDasharray="4,3" markerEnd="url(#mOut)" opacity="0.5" />
                <line x1="233" y1="172" x2="298" y2="178" stroke="#c4821a" strokeWidth="1.5" markerEnd="url(#mEx)" />
                <line x1="212" y1="163" x2="163" y2="133" stroke="#c4821a" strokeWidth="1.5" markerEnd="url(#mEx)" />
                <line x1="229" y1="162" x2="258" y2="133" stroke="#a33726" strokeWidth="2.5" markerEnd="url(#mWh)" />
                <circle cx="80" cy="76" r="9" fill="#7a6a4f" />
                <text x="92" y="73" fontSize="11" fill="#7a6a4f" fontFamily="Arial,sans-serif" fontWeight="500">Earthy</text>
                <circle cx="85" cy="228" r="9" fill="#a54c2d" />
                <text x="85" y="251" fontSize="10.5" fill="#a54c2d" fontFamily="Arial,sans-serif" textAnchor="middle">Choc. &amp; Nutty</text>
                <circle cx="153" cy="128" r="9" fill="#c9a830" />
                <text x="141" y="120" fontSize="10.5" fill="#c9a830" fontFamily="Arial,sans-serif" textAnchor="end">Balanced</text>
                <text x="141" y="133" fontSize="10.5" fill="#c9a830" fontFamily="Arial,sans-serif" textAnchor="end">&amp; Sweet</text>
                <circle cx="308" cy="178" r="9" fill="#8a7cbe" />
                <text x="320" y="175" fontSize="11" fill="#8a7cbe" fontFamily="Arial,sans-serif">Floral</text>
                <circle cx="266" cy="128" r="9" fill="#ca445f" />
                <text x="278" y="125" fontSize="11" fill="#ca445f" fontFamily="Arial,sans-serif">Fruity</text>
                <circle cx="222" cy="172" r="16" fill="#a33726" fillOpacity="0.12" />
                <circle cx="222" cy="172" r="10" fill="#a33726" />
                <text x="236" y="169" fontSize="12" fill="#a33726" fontFamily="Arial,sans-serif" fontWeight="500">You</text>
              </svg>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 10 }}>
                {[
                  { color: '#a33726', solid: true,  thick: 2.5, label: 'In your wheelhouse' },
                  { color: '#c4821a', solid: true,  thick: 1.5, label: 'Worth exploring' },
                  { color: '#9a9595', solid: false, thick: 1,   label: 'Outside comfort zone' },
                ].map(item => (
                  <span key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
                    <span style={{
                      display: 'inline-block', width: 20, height: 0,
                      borderTop: `${item.thick}px ${item.solid ? 'solid' : 'dashed'} ${item.color}`,
                    }} />
                    {item.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Tier cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{
                fontSize: 14, color: 'rgba(0,0,0,0.55)', lineHeight: 1.75,
                margin: '0 0 0.5rem',
              }}>
                The AI sommelier groups every coffee in your lineup into three tiers based on its
                flavor distance from your profile:
              </p>
              {[
                {
                  label:      'In your wheelhouse',
                  badge:      'closest match',
                  badgeColor: '#a33726',
                  desc:       'Same archetype region. Direct match — the coffees most likely to feel immediately right.',
                },
                {
                  label:      'Worth exploring',
                  badge:      'adjacent archetype',
                  badgeColor: '#c4821a',
                  desc:       'Neighboring region in flavor space — similar in several dimensions but with a new direction. Good for calibrated adventure.',
                },
                {
                  label:      'Outside your comfort zone',
                  badge:      'furthest match',
                  badgeColor: 'rgba(0,0,0,0.38)',
                  desc:       'Contrasting profile. Great for discovery boxes or gifting someone with a very different palate.',
                },
              ].map(tier => (
                <div key={tier.label} style={{
                  background: '#f2f1ea',
                  border: '0.5px solid rgba(154,41,24,0.15)',
                  borderRadius: 10, padding: '10px 14px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: 'rgba(0,0,0,0.75)' }}>{tier.label}</span>
                    <span style={{
                      fontSize: 10, padding: '2px 9px', borderRadius: 4,
                      background: `${tier.badgeColor}15`,
                      color: tier.badgeColor,
                    }}>
                      {tier.badge}
                    </span>
                  </div>
                  <p style={{ fontSize: 12.5, color: 'rgba(0,0,0,0.5)', margin: 0, lineHeight: 1.55 }}>
                    {tier.desc}
                  </p>
                </div>
              ))}
            </div>

          </div>
        </motion.div>
      </section>

    </div>
  );
}
