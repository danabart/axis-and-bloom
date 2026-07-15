import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Link, useSearchParams } from 'react-router';
import AxisMap, { type ArchetypeKey, type AxisMapStats } from './axis/AxisMap';

// ── The Axis V2 — "Watch the data work" ──────────────────────────────────────
// Copy is verbatim from backend/src/features/the_axis_page/THE_AXIS_PAGE_COPY_V2.md.
// Strategy/competitive-safety rules: backend/src/features/the_axis_page/THE_AXIS_REDESIGN_STRATEGY.md
// and CLAUDE_CODE_PROMPT_THE_AXIS_V2.md. Do not add numeric scales, dimension
// names, formulas, table names, real coffee names, or quiz/adjacency logic to
// this page — see the prompt's competitive-safety audit checklist.

const VALID_ARCHETYPES: ArchetypeKey[] = ['fruity', 'floral', 'balanced_sweet', 'chocolate_nutty', 'earthy'];

const ARCHETYPES = [
  { key: 'fruity' as const,           name: 'Fruity',            desc: 'lively, juicy, full of movement.' },
  { key: 'floral' as const,           name: 'Floral',            desc: 'delicate, aromatic, refined.' },
  { key: 'balanced_sweet' as const,   name: 'Balanced & Sweet',  desc: 'soft, rounded, effortlessly satisfying.' },
  { key: 'chocolate_nutty' as const,  name: 'Chocolate & Nutty', desc: 'rich, grounding, deeply comforting.' },
  { key: 'earthy' as const,           name: 'Earthy',            desc: 'full-bodied, savory, expressive depth.' },
];

const ARCHETYPE_COLOR: Record<ArchetypeKey, string> = {
  fruity: 'var(--color-archetype-fruity)',
  floral: 'var(--color-archetype-floral)',
  balanced_sweet: 'var(--color-archetype-balanced-sweet)',
  chocolate_nutty: 'var(--color-archetype-chocolate-nutty)',
  earthy: 'var(--color-archetype-earthy)',
};

const RED = '#9a2918';

const calloutCard: React.CSSProperties = {
  background: '#f2f1ea',
  border: '0.5px solid rgba(154,41,24,0.15)',
  borderRadius: 12,
  padding: '1.1rem 1.25rem',
};

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
}

// ── Depth expander — closed by default, calm chevron, no layout jank ────────

function DepthExpander({ question, children }: { question: string; children: React.ReactNode }) {
  return (
    <details style={{ marginTop: '1.25rem', borderTop: '0.5px solid rgba(154,41,24,0.15)', paddingTop: '0.9rem' }}>
      <summary
        style={{
          cursor: 'pointer', listStyle: 'none', fontSize: 14, fontWeight: 500,
          color: RED, display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none',
        }}
      >
        <span className="axis-chevron" style={{ display: 'inline-block', transition: 'transform 0.3s ease', fontSize: 10 }}>▸</span>
        {question}
      </summary>
      <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.55)', lineHeight: 1.75, margin: '0.75rem 0 0', maxWidth: 560 }}>
        {children}
      </div>
    </details>
  );
}

// ── Journey step — text block that reports its own stage to the parent ──────

function JourneyStep({
  stage, onEnter, label, headline, children,
}: {
  stage: number;
  onEnter: (stage: number) => void;
  label: string;
  headline: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      onViewportEnter={() => onEnter(stage)}
      viewport={{ amount: 0.5, margin: '-10% 0px -10% 0px' }}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      style={{ padding: '3rem 0', borderTop: stage > 1 ? '0.5px solid rgba(154,41,24,0.1)' : undefined }}
    >
      <p style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', margin: '0 0 8px' }}>
        {label}
      </p>
      <h2 style={{ fontSize: 'clamp(1.3rem,3vw,1.65rem)', fontWeight: 400, margin: '0 0 1.1rem', color: RED, lineHeight: 1.2 }}>
        {headline}
      </h2>
      {children}
    </motion.div>
  );
}

const p14: React.CSSProperties = { fontSize: '1.1rem', color: 'rgba(0,0,0,0.55)', lineHeight: 1.7, margin: '0 0 1rem', maxWidth: 560 };

export default function TheAxis() {
  const [searchParams] = useSearchParams();
  const rawArchetype = searchParams.get('archetype');
  const focusArchetype: ArchetypeKey | null = VALID_ARCHETYPES.includes(rawArchetype as ArchetypeKey)
    ? (rawArchetype as ArchetypeKey)
    : null;

  const [stage, setStage] = useState(0);
  const [ctaInView, setCtaInView] = useState(false);
  const [stats, setStats] = useState<(AxisMapStats & { lastTightenedAt: string; coffeesMapped: number }) | null>(null);
  const [statsError, setStatsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/axis/stats')
      .then(r => r.json())
      .then(data => { if (!cancelled) setStats(data); })
      .catch(() => { if (!cancelled) setStatsError(true); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ fontFamily: "'Lato', Arial, sans-serif", backgroundColor: '#f2f1ea', minHeight: '100vh' }}>

      {/* ── Hero ── */}
      <motion.section
        onViewportEnter={() => setStage(0)}
        viewport={{ amount: 0.6 }}
        style={{ padding: 'clamp(88px,10vw,124px) clamp(24px,6vw,80px) clamp(40px,6vw,64px)' }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          >
            <p style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', margin: '0 0 10px' }}>
              The Axis
            </p>
            <h1 style={{ fontSize: 'clamp(2.2rem,5.5vw,3.4rem)', fontWeight: 400, lineHeight: 1.15, margin: '0 0 1.1rem', color: RED }}>
              Every cup you love has a location. Here&apos;s how it earns one.
            </h1>
            <p style={{ fontSize: '1.15rem', color: 'rgba(0,0,0,0.55)', lineHeight: 1.7, margin: '0 0 1.25rem', maxWidth: 480 }}>
              This isn&apos;t a brochure about our system. It&apos;s a window into it — the same living map our
              recommendations, our sommelier, and your profile all read.
            </p>
            <p style={{ fontSize: '1.1rem', color: 'rgba(0,0,0,0.5)', lineHeight: 1.7, maxWidth: 500, margin: 0 }}>
              Most coffee shopping asks you to trust adjectives. We&apos;d rather show you the work: how a coffee
              goes from a roaster&apos;s description to a measured place on a map, how that map connects every
              coffee to its neighbors, and how it quietly gets more accurate every time someone tells us what
              they actually tasted.
            </p>
            <a href="#journey" style={{ display: 'inline-block', marginTop: '1.5rem', fontSize: 14, color: RED, textDecoration: 'none', opacity: 0.7 }}>
              ↓ Follow the journey
            </a>
          </motion.div>

          <div>
            <div style={{ background: 'rgba(242,241,234,0.6)', borderRadius: 16, padding: '1.5rem' }}>
              <AxisMap stage={0} focusArchetype={focusArchetype} stats={stats ?? undefined} />
            </div>
            {!statsError && (
              <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)', textAlign: 'center', marginTop: 10, fontStyle: 'italic' }}>
                Map last tightened {formatDate(stats?.lastTightenedAt)}.
              </p>
            )}
          </div>
        </div>
      </motion.section>

      {/* ── The journey: Capture → Structure → Connect → Consume → Refine ── */}
      <section id="journey" style={{ borderTop: '0.5px solid rgba(154,41,24,0.15)', padding: '0 clamp(24px,6vw,80px)' }}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">

          {/* Sticky map column (desktop). On mobile this renders first as a static preview. */}
          <div className="order-1 lg:order-2 lg:sticky" style={{ top: 96, paddingTop: '3rem' }}>
            <div style={{ background: stage === 1 ? '#ebebe3' : 'rgba(242,241,234,0.6)', borderRadius: 16, padding: '1.5rem', transition: 'background 0.8s ease' }}>
              <AxisMap stage={Math.max(1, Math.min(stage, 5))} focusArchetype={focusArchetype} stats={stats ?? undefined} />
            </div>
            {stage === 1 && (
              <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)', textAlign: 'center', marginTop: 10, fontStyle: 'italic' }}>
                From farm to first measurement.
              </p>
            )}
          </div>

          {/* Scrolling step text */}
          <div className="order-2 lg:order-1">

            <JourneyStep stage={1} onEnter={setStage} label="Where the data begins" headline="Two streams meet at a coordinate.">
              <p style={p14}>
                Every coffee arrives with a story: where it grew, how it was processed, how it was roasted, what
                the roaster tastes in it. We keep all of it — it&apos;s the beginning of the data, and it matters.
              </p>
              <p style={p14}>
                But we don&apos;t stop there, because a story can&apos;t tell you whether <em>you</em> will love what&apos;s
                in the bag. So we taste. In structured cupping sessions, we measure each coffee across the same
                sensory dimensions, the same way, every time. The story tells us where a coffee came from. The
                cupping tells us where it <em>is</em>.
              </p>
              <DepthExpander question="How do we know our numbers mean anything?">
                Our tasting vocabulary and intensity method are built on the same published standards the
                specialty industry uses to train professional tasters: the World Coffee Research Sensory
                Lexicon and the SCA&apos;s descriptive assessment approach, calibrated to coffee. We didn&apos;t
                invent a private language — we adopted a shared one, so our measurements stay honest and
                comparable.
              </DepthExpander>
              <div style={{ ...calloutCard, marginTop: '1.25rem', borderLeft: `2.5px solid ${RED}` }}>
                <p style={{ fontSize: 14.5, color: 'rgba(0,0,0,0.6)', margin: 0, lineHeight: 1.7, fontStyle: 'italic' }}>
                  &ldquo;Origin is where the data starts. It was never the destination.&rdquo;
                </p>
              </div>
            </JourneyStep>

            <JourneyStep stage={2} onEnter={setStage} label="From impressions to coordinates" headline="How a coffee earns its place.">
              <p style={p14}>
                Raw tasting data is noisy — a cloud of impressions. Structure turns it into a <em>place</em>:
                every coffee is assigned to one of five sensory archetypes, and given a position within it.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '0 0 1rem', maxWidth: 560 }}>
                {ARCHETYPES.map(a => (
                  <div
                    key={a.key}
                    style={{
                      display: 'flex', gap: 10, alignItems: 'baseline',
                      opacity: focusArchetype && focusArchetype !== a.key ? 0.55 : 1,
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: ARCHETYPE_COLOR[a.key], flexShrink: 0 }} />
                    <span style={{ fontSize: 14.5, color: 'rgba(0,0,0,0.65)' }}>
                      <strong style={{ color: ARCHETYPE_COLOR[a.key], fontWeight: 500 }}>{a.name}</strong>
                      {' — '}{a.desc}
                    </span>
                  </div>
                ))}
              </div>
              <p style={p14}>
                A position is not a poetic note. It&apos;s a claim we can check — and we do. New coffees enter
                the map with an honest label: <em>provisional</em>. As cuppings and drinker feedback accumulate,
                the position hardens. We&apos;d rather tell you a coordinate is young than pretend it was born
                perfect.
              </p>
              <DepthExpander question="What does &lsquo;provisional&rsquo; mean?">
                Every position carries a confidence level based on how much evidence supports it. More cuppings,
                more Bloom Notes, more signal — higher confidence. You&apos;ll see this honesty elsewhere on the
                site too; it&apos;s how a measured system behaves.
              </DepthExpander>
            </JourneyStep>

            <JourneyStep stage={3} onEnter={setStage} label="The network beneath the shelf" headline="No coffee is an island.">
              <p style={p14}>
                A shelf is a list. A map has <em>neighbors</em>. Every coffee on The Axis is connected to the
                coffees nearest it in taste — a step brighter, a step deeper, a step softer. Archetypes touch
                where real sensory bridges exist: some fruity coffees lean floral; some chocolatey coffees
                shade into earth.
              </p>
              <p style={p14}>
                This is why you never fall off the map. Whatever you&apos;re drinking, there is always a next
                step that makes sense — a small move, not a leap of faith.
              </p>
              <p style={p14}>
                And scattered across the regions, you&apos;ll find coffees flagged <strong style={{ color: 'var(--color-experimental)' }}>Experimental</strong> —
                unusual, seasonal, hard to place. They&apos;re not a separate world. Each one lives near its kin
                (an experimental with floral notes sits near Floral) and is exactly one hop away when you&apos;re
                feeling curious.
              </p>
              <div style={{ ...calloutCard, marginTop: '1.25rem' }}>
                <p style={{ fontSize: 14.5, color: 'rgba(0,0,0,0.6)', margin: 0, lineHeight: 1.75, fontStyle: 'italic' }}>
                  The Axis is your direction: the profile you naturally return to. The Bloom is what unfolds
                  within it — the small surprises, variations, and new expressions that keep coffee interesting.
                </p>
              </div>
            </JourneyStep>

            <JourneyStep stage={4} onEnter={setStage} label="Where AI reads the map" headline="One map. Many readers.">
              <p style={p14}>
                Everything you meet as a customer reads this same map. The quiz places <em>you</em> on it.
                Recommendations are the coffees nearest your position. And when you talk to <strong>Liam</strong>,
                our AI sommelier, he isn&apos;t improvising — before he says a word, he reads the map: your
                taste profile, the coffees near it, and the paths between them.
              </p>
              <p style={p14}>
                That&apos;s the difference between AI with a map and AI with a vibe. Liam can&apos;t recommend a
                coffee we haven&apos;t measured, and he doesn&apos;t guess your taste — he reads it.
              </p>
              <p style={p14}>
                We&apos;ll be plain about the rest, too: AI helps us <em>build</em> the map, not just read it.
                As cupping data accumulates, AI suggests where a coffee&apos;s position should move, and audits
                the map&apos;s logic. Humans taste; AI keeps the bookkeeping honest.
              </p>
              <DepthExpander question="What Liam can and can&rsquo;t see">
                Liam sees your taste profile and the measured map. He doesn&apos;t see anything we haven&apos;t
                measured, and he never invents a coffee. If he suggests a step, that step exists.
              </DepthExpander>
            </JourneyStep>

            <JourneyStep stage={5} onEnter={setStage} label="The loop" headline="A map that tightens itself.">
              <p style={p14}>The map is deliberately unfinished. That&apos;s its best feature.</p>
              <p style={p14}>
                After each delivery, you can log a <strong>Bloom Note</strong> — a short record of what actually
                happened in your cup. Brighter than expected? Longer finish? That&apos;s signal. Your Bloom
                Notes sharpen your <strong>Taste Memory</strong> — the profile that compounds with every bag, so
                we never ask you to start over. And in aggregate, everyone&apos;s notes gently move the coffees
                themselves: positions shift, confidence grows, the map tightens.
              </p>
              <p style={p14}>You&apos;re not shouting into a void. You&apos;re editing the map — and you can watch it happen, right here.</p>

              {!statsError && stats && (
                <p style={{ fontSize: 13.5, color: 'rgba(0,0,0,0.45)', letterSpacing: '0.02em', margin: '0.5rem 0 1.1rem' }}>
                  {stats.bloomNotesThisMonth} Bloom Notes this month · {stats.positionsRefinedThisQuarter} positions refined this quarter · Map last tightened {formatDate(stats.lastTightenedAt)}.
                </p>
              )}

              <div style={{ ...calloutCard, borderLeft: `2.5px solid ${RED}` }}>
                <p style={{ fontSize: 14.5, color: 'rgba(0,0,0,0.6)', margin: 0, lineHeight: 1.75, fontStyle: 'italic' }}>
                  Your coffee may change. Your flavor stays close to home.
                </p>
              </div>
            </JourneyStep>

          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <motion.section
        onViewportEnter={() => { setStage(6); setCtaInView(true); }}
        viewport={{ amount: 0.4 }}
        style={{ borderTop: '0.5px solid rgba(154,41,24,0.15)', background: '#ebebe3', padding: 'clamp(48px,7vw,80px) clamp(24px,6vw,80px)' }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }} style={{ maxWidth: 480 }}>
            <p style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', margin: '0 0 10px' }}>
              Start here
            </p>
            <h2 style={{ fontSize: 'clamp(1.6rem,4vw,2.4rem)', fontWeight: 400, margin: '0 0 1rem', color: RED, lineHeight: 1.15 }}>
              Find your place on the map.
            </h2>
            <p style={{ fontSize: '1.1rem', color: 'rgba(0,0,0,0.55)', lineHeight: 1.7, margin: '0 0 1.75rem' }}>
              Three minutes. A few questions about how you experience flavor — not what you know about coffee. The
              result is your position on The Axis, and every recommendation flows from it.
            </p>
            <Link
              to="/find-my-flavor"
              style={{
                display: 'inline-block', background: RED, color: '#f2f1ea', fontSize: 14,
                padding: '13px 32px', borderRadius: 4, textDecoration: 'none', letterSpacing: '0.04em',
              }}
              className="hover:opacity-80"
            >
              → Take the Flavor Quiz
            </Link>
            <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.35)', margin: '10px 0 0' }}>
              Free to take. No commitment.
            </p>
          </motion.div>

          {/* Handoff visual — mounts only once this section is in view, so the
              detach→bag animation plays once, on arrival, not on page load. */}
          {ctaInView && (
            <div style={{ background: 'rgba(242,241,234,0.6)', borderRadius: 16, padding: '1.5rem' }}>
              <AxisMap stage={6} focusArchetype={focusArchetype} stats={stats ?? undefined} />
            </div>
          )}
        </div>
      </motion.section>

      <style>{`
        details > summary::-webkit-details-marker { display: none; }
        details[open] > summary .axis-chevron { transform: rotate(90deg); }
      `}</style>
    </div>
  );
}
