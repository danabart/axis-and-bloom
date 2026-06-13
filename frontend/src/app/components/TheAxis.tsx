import { motion } from 'motion/react';
import { Link } from 'react-router';

// ── Archetype data ─────────────────────────────────────────────────────────────

const ARCHETYPES = [
  { name: 'Fruity',            color: '#ca445f', desc: 'Bright acidity, stone fruit and berry, lively complex finish.' },
  { name: 'Floral',            color: '#8a7cbe', desc: 'Delicate aromatics, tea-like brightness, clean and elegant.' },
  { name: 'Balanced & Sweet',  color: '#c9a830', desc: 'Gentle sweetness, soft acidity, approachable and easy to love.' },
  { name: 'Chocolate & Nutty', color: '#a54c2d', desc: 'Deep cocoa, roasted nuts, rich body with a lingering dry finish.' },
  { name: 'Earthy',            color: '#7a6a4f', desc: 'Full body, deep savory complexity, long and memorable finish.' },
];

// Illustrative radar polygons per archetype (cx=60, cy=60, r=45, 6 spokes)
// Hand-coded shapes — not real calibration data
const RADAR_SHAPES: Record<string, number[]> = {
  'Fruity':            [0.55, 0.95, 0.20, 0.40, 0.25, 0.30],
  'Floral':            [0.60, 0.85, 0.15, 0.35, 0.20, 0.25],
  'Balanced & Sweet':  [0.80, 0.55, 0.25, 0.60, 0.20, 0.40],
  'Chocolate & Nutty': [0.60, 0.25, 0.75, 0.85, 0.65, 0.60],
  'Earthy':            [0.40, 0.25, 0.65, 0.95, 0.90, 0.92],
};

// ── Small inline radar (archetype card) ──────────────────────────────────────

function MiniRadar({ archetype, color }: { archetype: string; color: string }) {
  const cx = 32, cy = 32, r = 24;
  const n = 6;
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const vals = RADAR_SHAPES[archetype] ?? [];
  const pts = vals.map((v, i) =>
    `${(cx + v * r * Math.cos(angle(i))).toFixed(1)},${(cy + v * r * Math.sin(angle(i))).toFixed(1)}`
  ).join(' ');
  return (
    <svg viewBox="0 0 64 64" width={52} height={52} style={{ display: 'block', flexShrink: 0 }}>
      {[0.33, 0.66, 1].map(s => {
        const gpts = Array.from({ length: n }, (_, i) =>
          `${(cx + s * r * Math.cos(angle(i))).toFixed(1)},${(cy + s * r * Math.sin(angle(i))).toFixed(1)}`
        ).join(' ');
        return <polygon key={s} points={gpts} fill="none" stroke="rgba(0,0,0,0.1)" strokeWidth={0.75} />;
      })}
      {Array.from({ length: n }, (_, i) => (
        <line key={i}
          x1={cx} y1={cy}
          x2={cx + r * Math.cos(angle(i))}
          y2={cy + r * Math.sin(angle(i))}
          stroke="rgba(0,0,0,0.08)" strokeWidth={0.75}
        />
      ))}
      <polygon points={pts} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={1.5} strokeOpacity={0.85} />
    </svg>
  );
}

// ── Unlabeled concept parallel coordinates ────────────────────────────────────

const CONCEPT_LINES = [
  { color: '#ca445f', vals: [7, 13,  2,  5,  3,  4,  7] },
  { color: '#8a7cbe', vals: [8, 12,  2,  5,  2,  3,  4] },
  { color: '#c9a830', vals: [11,  7,  3,  8,  2,  5,  7] },
  { color: '#a54c2d', vals: [8,  3,  9, 12,  9,  8, 10] },
  { color: '#7a6a4f', vals: [5,  3,  8, 14, 13, 13, 12] },
];

function ConceptChart() {
  const W = 620, H = 150, pt = 12, pb = 14, pl = 12, pr = 12;
  const plotH = H - pt - pb;
  const n = 7;
  const step = (W - pl - pr) / (n - 1);
  const xOf = (i: number) => pl + i * step;
  const yOf = (v: number) => pt + (1 - v / 15) * plotH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      {Array.from({ length: n }, (_, i) => (
        <line key={i}
          x1={xOf(i)} y1={pt} x2={xOf(i)} y2={H - pb}
          stroke="rgba(0,0,0,0.12)" strokeWidth={1}
        />
      ))}
      {CONCEPT_LINES.map(({ color, vals }, li) => {
        const pts = vals.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
        return (
          <g key={li}>
            <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" opacity={0.82} />
            {vals.map((v, i) => (
              <circle key={i} cx={xOf(i)} cy={yOf(v)} r={3.5} fill={color} opacity={0.88} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// ── Section 1 split visual ────────────────────────────────────────────────────

function SplitVisual() {
  return (
    <svg viewBox="0 0 520 180" width="100%" style={{ display: 'block' }}>
      {/* Left panel — origin / map */}
      <rect x="0" y="0" width="238" height="180" rx="10" fill="rgba(0,0,0,0.04)" />
      <text x="119" y="22" textAnchor="middle" fontSize={9} fontFamily="Arial,sans-serif" fill="rgba(0,0,0,0.35)" letterSpacing="0.1em">WHERE IT&apos;S FROM</text>
      {/* Simplified map outline */}
      <ellipse cx="119" cy="95" rx="80" ry="55" fill="none" stroke="rgba(0,0,0,0.1)" strokeWidth={1} strokeDasharray="4,3" />
      {/* Location pins */}
      {[[90,70],[140,85],[105,110],[155,65],[80,100]].map(([px, py], i) => (
        <g key={i}>
          <circle cx={px} cy={py} r={5} fill="rgba(154,41,24,0.25)" />
          <circle cx={px} cy={py} r={2.5} fill="#9a2918" />
          <line x1={px} y1={py + 5} x2={px} y2={py + 12} stroke="#9a2918" strokeWidth={1} opacity={0.5} />
        </g>
      ))}
      <text x="119" y="165" textAnchor="middle" fontSize={9} fontFamily="Arial,sans-serif" fill="rgba(0,0,0,0.35)" fontStyle="italic">Origin · Season · Terroir</text>

      {/* Arrow */}
      <text x="260" y="97" textAnchor="middle" fontSize={18} fill="rgba(154,41,24,0.5)" fontFamily="Arial,sans-serif">→</text>

      {/* Right panel — flavor shape */}
      <rect x="282" y="0" width="238" height="180" rx="10" fill="rgba(154,41,24,0.05)" />
      <text x="401" y="22" textAnchor="middle" fontSize={9} fontFamily="Arial,sans-serif" fill="rgba(154,41,24,0.5)" letterSpacing="0.1em">WHAT IT ACTUALLY TASTES LIKE</text>
      {/* Radar polygon */}
      {(() => {
        const cx = 401, cy = 98, r = 52;
        const n = 6;
        const ang = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
        const vs = [0.7, 0.55, 0.85, 0.6, 0.75, 0.5];
        const gpts = (s: number) => Array.from({ length: n }, (_, i) =>
          `${(cx + s * r * Math.cos(ang(i))).toFixed(1)},${(cy + s * r * Math.sin(ang(i))).toFixed(1)}`
        ).join(' ');
        const spts = vs.map((v, i) =>
          `${(cx + v * r * Math.cos(ang(i))).toFixed(1)},${(cy + v * r * Math.sin(ang(i))).toFixed(1)}`
        ).join(' ');
        return (
          <>
            {[0.33, 0.66, 1].map(s => <polygon key={s} points={gpts(s)} fill="none" stroke="rgba(154,41,24,0.12)" strokeWidth={1} />)}
            {Array.from({ length: n }, (_, i) => (
              <line key={i} x1={cx} y1={cy}
                x2={cx + r * Math.cos(ang(i))}
                y2={cy + r * Math.sin(ang(i))}
                stroke="rgba(154,41,24,0.1)" strokeWidth={1}
              />
            ))}
            <polygon points={spts} fill="#9a2918" fillOpacity={0.12} stroke="#9a2918" strokeWidth={2} />
          </>
        );
      })()}
      <text x="401" y="165" textAnchor="middle" fontSize={9} fontFamily="Arial,sans-serif" fill="rgba(154,41,24,0.5)" fontStyle="italic">A precise, repeatable flavor signature</text>
    </svg>
  );
}

// ── Feedback loop diagram ─────────────────────────────────────────────────────

function FeedbackLoop() {
  const cx = 200, cy = 145, r = 88;
  const nodes = [
    { label: 'You take\nthe quiz',      angle: -90,  color: '#9a2918' },
    { label: 'We match\n& deliver',     angle:  30,  color: '#7a6a4f' },
    { label: 'You log\ntasting notes',  angle: 150,  color: '#8a7cbe' },
  ];
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const nx = (deg: number) => cx + r * Math.cos(toRad(deg));
  const ny = (deg: number) => cy + r * Math.sin(toRad(deg));

  return (
    <svg viewBox="0 0 400 290" width="100%" style={{ display: 'block' }}>
      {/* Connecting arcs — drawn as curved paths */}
      {nodes.map((_, i) => {
        const from = nodes[i];
        const to = nodes[(i + 1) % 3];
        const x1 = nx(from.angle), y1 = ny(from.angle);
        const x2 = nx(to.angle),   y2 = ny(to.angle);
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const dx = mx - cx, dy = my - cy;
        const len = Math.sqrt(dx * dx + dy * dy);
        const pull = 0.35;
        const cpx = cx + (dx / len) * (len - pull * r);
        const cpy = cy + (dy / len) * (len - pull * r);
        return (
          <path key={i}
            d={`M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cpx.toFixed(1)} ${cpy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`}
            fill="none" stroke="rgba(0,0,0,0.15)" strokeWidth={1.5}
            markerEnd={`url(#arr${i})`}
          />
        );
      })}
      <defs>
        {nodes.map((node, i) => (
          <marker key={i} id={`arr${i}`} viewBox="0 0 8 6" refX="7" refY="3" markerWidth="6" markerHeight="5" orient="auto">
            <path d="M0 0 L8 3 L0 6 z" fill={node.color} opacity={0.6} />
          </marker>
        ))}
      </defs>
      {/* Center label */}
      <text x={cx} y={cy - 9} textAnchor="middle" fontSize={10} fontFamily="Arial,sans-serif" fill="rgba(0,0,0,0.4)">Refine your</text>
      <text x={cx} y={cy + 6} textAnchor="middle" fontSize={10} fontFamily="Arial,sans-serif" fill="rgba(0,0,0,0.4)">vector</text>
      <circle cx={cx} cy={cy} r={28} fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth={1} strokeDasharray="3,2" />
      {/* Node circles + labels */}
      {nodes.map((node, i) => {
        const x = nx(node.angle), y = ny(node.angle);
        const lines = node.label.split('\n');
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={20} fill={node.color} fillOpacity={0.1} stroke={node.color} strokeWidth={1.5} />
            {lines.map((line, li) => (
              <text key={li}
                x={x} y={y + (li - (lines.length - 1) / 2) * 13}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={9.5} fontFamily="Arial,sans-serif" fill={node.color}
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// ── Shared card style ─────────────────────────────────────────────────────────

const calloutCard: React.CSSProperties = {
  background: '#f2f1ea',
  border: '0.5px solid rgba(154,41,24,0.15)',
  borderRadius: 12, padding: '1.1rem 1.25rem',
};

// ── Main component ────────────────────────────────────────────────────────────

export default function TheAxis() {
  return (
    <div style={{ fontFamily: 'Arial, sans-serif', backgroundColor: '#f2f1ea', minHeight: '100vh' }}>

      {/* ── Hero ── */}
      <section style={{ padding: 'clamp(88px,10vw,124px) clamp(24px,6vw,80px) clamp(56px,7vw,88px)' }}>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        >
          <p style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', margin: '0 0 10px' }}>
            The Axis
          </p>
          <h1 style={{ fontSize: 'clamp(2.4rem,6vw,3.8rem)', fontWeight: 400, lineHeight: 1.1, margin: '0 0 1rem', color: '#9a2918' }}>
            Every cup you love<br />has a location.
          </h1>
          <p style={{ fontSize: 16, color: 'rgba(0,0,0,0.55)', lineHeight: 1.7, margin: '0 0 1.5rem', maxWidth: 480 }}>
            We built a system to find it — and keep finding it, every time.
          </p>
          <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.5)', lineHeight: 1.8, maxWidth: 520, margin: 0 }}>
            Most coffee shopping is guesswork. Origin stories are romantic. Roaster descriptions are
            poetic. But neither tells you whether you will love what's in the bag.
          </p>
          <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.5)', lineHeight: 1.8, maxWidth: 520, margin: '0.75rem 0 0' }}>
            The Axis changes the question. Instead of asking where a coffee comes from, we ask
            what it tastes like — precisely, consistently, and in terms that map directly to your palate.
          </p>
          <a href="#how-it-works" style={{ display: 'inline-block', marginTop: '1.5rem', fontSize: 13, color: '#9a2918', textDecoration: 'none', opacity: 0.7 }}>
            ↓ See how it works
          </a>
        </motion.div>
      </section>

      {/* ── Section 1: The Problem ── */}
      <section id="how-it-works" style={{ borderTop: '0.5px solid rgba(154,41,24,0.15)', background: '#e5e5da', padding: 'clamp(40px,6vw,64px) clamp(24px,6vw,80px)' }}>
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }}>
          <p style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', margin: '0 0 6px' }}>
            Why origin isn't enough
          </p>
          <h2 style={{ fontSize: 'clamp(1.3rem,3vw,1.65rem)', fontWeight: 400, margin: '0 0 1.25rem', color: '#9a2918', lineHeight: 1.2 }}>
            Coffee is agriculture. Agriculture is seasonal.<br />Your morning isn't.
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            <div>
              <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.55)', lineHeight: 1.8, margin: '0 0 1rem' }}>
                A single-origin coffee you love in October may taste different by March. Harvest
                conditions shift. Micro-lots sell out. Processing variables compound. Even blends —
                typically engineered for consistency — are exposed when their component beans change
                source or crop.
              </p>
              <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.55)', lineHeight: 1.8, margin: '0 0 1rem' }}>
                The specialty coffee industry has long treated origin as a proxy for quality. We
                respect that tradition, but we don't rely on it. Origin tells you a story. It doesn't
                guarantee a flavor.
              </p>
              <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.55)', lineHeight: 1.8, margin: 0 }}>
                So we stopped targeting origins. We started targeting profiles.
              </p>
            </div>
            <div>
              <div style={{ background: 'rgba(242,241,234,0.6)', borderRadius: 12, padding: '1.25rem 1rem' }}>
                <SplitVisual />
              </div>
              <div style={{ ...calloutCard, marginTop: '1rem', borderLeft: '2.5px solid #a33726' }}>
                <p style={{ fontSize: 13.5, color: 'rgba(0,0,0,0.55)', margin: 0, lineHeight: 1.7, fontStyle: 'italic' }}>
                  "The coffee you love isn't tied to a region. It's tied to a set of sensory properties
                  that a region happened to produce this season."
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ── Section 2: The Inputs ── */}
      <section style={{ borderTop: '0.5px solid rgba(154,41,24,0.15)', padding: 'clamp(40px,6vw,64px) clamp(24px,6vw,80px)' }}>
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }}>
          <p style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', margin: '0 0 6px' }}>
            The foundation
          </p>
          <h2 style={{ fontSize: 'clamp(1.3rem,3vw,1.65rem)', fontWeight: 400, margin: '0 0 0.4rem', color: '#9a2918' }}>
            Mapping your palate. Mapping the coffee.
          </h2>
          <p style={{ fontSize: 15, color: 'rgba(0,0,0,0.45)', margin: '0 0 2rem', fontStyle: 'italic' }}>
            Two profiles. One coordinate system.
          </p>
          <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.55)', lineHeight: 1.8, maxWidth: 640, margin: '0 0 2.5rem' }}>
            The Axis works because we speak the same language on both sides of the match.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8" style={{ marginBottom: '2.5rem' }}>
            {/* Your profile */}
            <div style={{ ...calloutCard }}>
              <p style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', margin: '0 0 8px' }}>Your profile</p>
              <p style={{ fontSize: 13.5, fontWeight: 500, color: '#9a2918', margin: '0 0 8px' }}>Starts with a diagnostic quiz.</p>
              <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', margin: 0, lineHeight: 1.65 }}>
                In a few minutes, our onboarding quiz isolates the sensory properties that define your palate —
                not what you think you like, but what your responses reveal about how you experience flavor.
                The result is your personal flavor vector: a precise, multi-attribute signature that we carry
                into every recommendation we make.
              </p>
            </div>
            {/* Every coffee */}
            <div style={{ ...calloutCard }}>
              <p style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', margin: '0 0 8px' }}>Every coffee</p>
              <p style={{ fontSize: 13.5, fontWeight: 500, color: '#9a2918', margin: '0 0 8px' }}>Mapped across standardized sensory dimensions.</p>
              <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', margin: 0, lineHeight: 1.65 }}>
                We categorize each coffee using dimensions defined by the Specialty Coffee Association —
                characteristics like sweetness, acidity, body, bitterness, texture, and finish. Each
                attribute is scored through a rigorous combination of cupper assessments, roastery notes,
                and community feedback. The result isn't a tasting note. It's a coordinate.
              </p>
            </div>
          </div>

          {/* Archetype intro */}
          <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.55)', lineHeight: 1.8, maxWidth: 640, margin: '0 0 1.25rem' }}>
            Every coffee belongs to one of five distinct sensory archetypes — five well-defined flavor
            regions that every coffee we carry maps into. Your archetype is your anchor point in flavor
            space. It's the lens through which we filter and rank every recommendation.
          </p>

          {/* Archetype cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4" style={{ marginBottom: '2rem' }}>
            {ARCHETYPES.map(arch => (
              <div key={arch.name} style={{
                background: '#e5e5da', borderRadius: 12,
                padding: '1rem', display: 'flex', flexDirection: 'column', gap: 10,
                border: `0.5px solid ${arch.color}25`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: arch.color, display: 'inline-block' }} />
                  <MiniRadar archetype={arch.name} color={arch.color} />
                </div>
                <div>
                  <p style={{ fontSize: 12.5, fontWeight: 500, color: arch.color, margin: '0 0 4px' }}>{arch.name}</p>
                  <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', margin: 0, lineHeight: 1.5 }}>{arch.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Concept parallel coordinates */}
          <div style={{ background: '#e5e5da', borderRadius: 12, padding: '1.25rem 1.25rem 1rem' }}>
            <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', margin: '0 0 10px', fontStyle: 'italic' }}>
              Each archetype has a distinct flavor signature.
            </p>
            <ConceptChart />
          </div>
        </motion.div>
      </section>

      {/* ── Section 3: The Engine ── */}
      <section style={{ borderTop: '0.5px solid rgba(154,41,24,0.15)', background: '#e5e5da', padding: 'clamp(40px,6vw,64px) clamp(24px,6vw,80px)' }}>
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }}>
          <p style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', margin: '0 0 6px' }}>
            The matching system
          </p>
          <h2 style={{ fontSize: 'clamp(1.3rem,3vw,1.65rem)', fontWeight: 400, margin: '0 0 0.4rem', color: '#9a2918' }}>
            Not a filter. A distance.
          </h2>
          <p style={{ fontSize: 15, color: 'rgba(0,0,0,0.45)', margin: '0 0 1.5rem', fontStyle: 'italic' }}>
            Matching means finding how close two flavor coordinates are — across every dimension at once.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            <div>
              <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.55)', lineHeight: 1.8, margin: '0 0 1rem' }}>
                When you take the quiz, your responses generate a personal flavor vector — a
                multi-attribute representation of your palate across all sensory dimensions
                simultaneously. Every coffee in our catalogue has its own vector, built from
                standardized SCA scoring.
              </p>
              <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.55)', lineHeight: 1.8, margin: '0 0 1.5rem' }}>
                Our engine performs multidimensional distance analysis: it calculates the similarity
                between your vector and every coffee's vector in real time. The smaller the distance,
                the closer the match. We don't surface results by trend, margin, or geography. We
                surface them by proximity to who you are as a drinker.
              </p>

              {/* Three-column explainer */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { label: 'Proprietary vector mapping',        desc: 'Your palate and every coffee share the same coordinate system.' },
                  { label: 'Multidimensional distance analysis', desc: 'We measure how close two flavor profiles are across all dimensions simultaneously.' },
                  { label: 'Dynamic rotation',                  desc: 'As our catalogue updates with seasonal lots, your recommendations recalibrate automatically.' },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#9a2918', flexShrink: 0, marginTop: 6 }} />
                    <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', lineHeight: 1.6 }}>
                      <strong style={{ color: 'rgba(0,0,0,0.72)', fontWeight: 500 }}>{item.label}</strong>
                      {' · '}{item.desc}
                    </span>
                  </div>
                ))}
              </div>

              {/* Callout */}
              <div style={{ ...calloutCard, marginTop: '1.5rem' }}>
                <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', margin: 0, lineHeight: 1.7 }}>
                  Your subscription doesn't lock you to a coffee. It locks you to a flavor profile.
                  As coffees rotate in and out of our catalogue, your recommendations stay accurate —
                  because we're matching the profile, not the product.
                </p>
              </div>
            </div>

            {/* Distance plot — static conceptual */}
            <div style={{ background: 'rgba(242,241,234,0.7)', borderRadius: 12, padding: '1.25rem' }}>
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
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10 }}>
                {[
                  { color: '#a33726', solid: true,  thick: 2.5, label: 'In your wheelhouse' },
                  { color: '#c4821a', solid: true,  thick: 1.5, label: 'Worth exploring' },
                  { color: '#9a9595', solid: false, thick: 1,   label: 'Outside comfort zone' },
                ].map(item => (
                  <span key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
                    <span style={{ display: 'inline-block', width: 20, height: 0, borderTop: `${item.thick}px ${item.solid ? 'solid' : 'dashed'} ${item.color}` }} />
                    {item.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ── Section 4: The Feedback Loop ── */}
      <section style={{ borderTop: '0.5px solid rgba(154,41,24,0.15)', padding: 'clamp(40px,6vw,64px) clamp(24px,6vw,80px)' }}>
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }}>
          <p style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', margin: '0 0 6px' }}>
            The Collaborative Flavor Wheel
          </p>
          <h2 style={{ fontSize: 'clamp(1.3rem,3vw,1.65rem)', fontWeight: 400, margin: '0 0 0.4rem', color: '#9a2918' }}>
            The more you drink, the smarter it gets.
          </h2>
          <p style={{ fontSize: 15, color: 'rgba(0,0,0,0.45)', margin: '0 0 1.5rem', fontStyle: 'italic' }}>
            Your feedback doesn't go into a void. It trains the system.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            <div>
              <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.55)', lineHeight: 1.8, margin: '0 0 1rem' }}>
                The initial match is precise. But it's still a starting point.
              </p>
              <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.55)', lineHeight: 1.8, margin: '0 0 1.25rem' }}>
                After each delivery, we invite you to log a short tasting note through the
                Collaborative Flavor Wheel — our community-driven feedback layer built on top of
                the SCA sensory framework. Did the acidity hit harder than expected? Was the finish
                longer than the archetype suggested? You tell us.
              </p>
              <p style={{ fontSize: 13.5, fontWeight: 500, color: 'rgba(0,0,0,0.65)', margin: '0 0 10px' }}>Your notes do three things:</p>
              {[
                {
                  title: 'Sharpen your profile.',
                  desc:  'Post-brew feedback refines your personal flavor vector over time, capturing nuance that a quiz alone can\'t detect — the difference between acidity you find bright and acidity you find harsh.',
                },
                {
                  title: 'Refine the coffee\'s position.',
                  desc:  'Aggregated community feedback adjusts where a coffee sits in flavor space. A coffee that consistently rates high on texture across hundreds of drinkers will have that reflected in its vector.',
                },
                {
                  title: 'Improve the match for everyone.',
                  desc:  'Your input contributes to a continuously improving model. The more our community engages, the more accurate the system becomes — for every drinker whose palate resembles yours.',
                },
              ].map(item => (
                <div key={item.title} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#9a2918', flexShrink: 0, marginTop: 7 }} />
                  <span style={{ fontSize: 13.5, color: 'rgba(0,0,0,0.55)', lineHeight: 1.65 }}>
                    <strong style={{ color: 'rgba(0,0,0,0.72)', fontWeight: 500 }}>{item.title}</strong>
                    {' '}{item.desc}
                  </span>
                </div>
              ))}

              {/* Callout */}
              <div style={{ ...calloutCard, marginTop: '1rem', borderLeft: '2.5px solid #a33726' }}>
                <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', margin: '0 0 6px', lineHeight: 1.7, fontStyle: 'italic' }}>
                  "Most recommendation engines optimize for clicks. Ours optimizes for your palate —
                  updated every time you tell us what you actually tasted."
                </p>
              </div>
              <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)', lineHeight: 1.7, margin: '1rem 0 0' }}>
                The Axis isn't a static catalog. It's a living system that gets more accurate the more it knows you.
              </p>
            </div>

            {/* Feedback loop diagram */}
            <div style={{ background: '#e5e5da', borderRadius: 12, padding: '1.25rem' }}>
              <FeedbackLoop />
            </div>
          </div>
        </motion.div>
      </section>

      {/* ── Section 5: CTA ── */}
      <section style={{ borderTop: '0.5px solid rgba(154,41,24,0.15)', background: '#e5e5da', padding: 'clamp(48px,7vw,80px) clamp(24px,6vw,80px)' }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          style={{ maxWidth: 480 }}
        >
          <p style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', margin: '0 0 10px' }}>
            Start here
          </p>
          <h2 style={{ fontSize: 'clamp(1.6rem,4vw,2.4rem)', fontWeight: 400, margin: '0 0 1rem', color: '#9a2918', lineHeight: 1.15 }}>
            Find your archetype.
          </h2>
          <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.55)', lineHeight: 1.8, margin: '0 0 1.75rem' }}>
            Three minutes. A few questions about how you experience flavor. The result: a flavor
            vector that drives every recommendation we make — and gets sharper with every cup.
          </p>
          <Link to="/find-my-flavor" style={{
            display: 'inline-block',
            background: '#9a2918', color: '#f2f1ea',
            fontSize: 14, padding: '13px 32px',
            borderRadius: 4, textDecoration: 'none',
            letterSpacing: '0.04em',
            transition: 'opacity 0.2s',
          }}
            className="hover:opacity-80"
          >
            → Take the Flavor Quiz
          </Link>
          <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', margin: '10px 0 0' }}>
            Free to take. No commitment. Your results are yours.
          </p>
        </motion.div>
      </section>

    </div>
  );
}
