import { useRef, useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { Link } from 'react-router';

// Archetype paper patterns (1600px JPGs) — sourced from the shared bucket registry
import { patternAssets } from '../../design/assets';

const patternSpicy        = patternAssets['spicy-earthy'].src;
const patternFruity       = patternAssets.fruity.src;
const patternBalanced     = patternAssets['balanced-sweet'].src;
const patternExperimental = patternAssets.experimental.src;
const patternFloral       = patternAssets.floral.src;
const patternChocolate    = patternAssets['chocolate-nutty'].src;

// Bag SVGs as raw strings for name substitution — kept as local imports, not migrated:
// these are inlined as markup via Vite's ?raw loader, not fetched as a URL, so they
// don't fit the registry's src/mobileSrc shape. Small files (~0.1MB total), no
// performance case for moving them.
import bagFloralRaw        from '../../design/IMAGES/bags/bag-floral.svg?raw';
import bagFruityRaw        from '../../design/IMAGES/bags/bag-fruity.svg?raw';
import bagBalancedRaw      from '../../design/IMAGES/bags/bag-balanced.svg?raw';
import bagChocolateRaw     from '../../design/IMAGES/bags/bag-chocolate.svg?raw';
import bagSpicyRaw         from '../../design/IMAGES/bags/bag-spicy.svg?raw';
import bagExperimentalRaw  from '../../design/IMAGES/bags/bag-experimental.svg?raw';

const ARCHETYPE_PATTERNS: Record<string, string> = {
  floral:       patternFloral,
  fruity:       patternFruity,
  balanced:     patternBalanced,
  chocolate:    patternChocolate,
  spicy:        patternSpicy,
  experimental: patternExperimental,
};

const ARCHETYPE_BAGS: Record<string, string> = {
  floral:       bagFloralRaw,
  fruity:       bagFruityRaw,
  balanced:     bagBalancedRaw,
  chocolate:    bagChocolateRaw,
  spicy:        bagSpicyRaw,
  experimental: bagExperimentalRaw,
};

const ARCHETYPE_TAGS: Record<string, string> = {
  floral:       'fragrant · bright · delicate · clean',
  fruity:       'sweet · vibrant · expressive · lively',
  balanced:     'smooth · sweet · harmonious · easy',
  chocolate:    'rich · grounded · full · comforting',
  spicy:        'warm · deep · bold · lasting',
  experimental: 'wild · unique · surprising',
};

// Normalize API archetype id (e.g. 'spicy_earthy' → 'spicy', 'balanced_sweet' → 'balanced')
function normalizeArchetypeId(id: string): string {
  const s = id.toLowerCase().replace(/[_\s-]+/g, '_');
  if (s.startsWith('spicy'))        return 'spicy';
  if (s.startsWith('balanced'))     return 'balanced';
  if (s.startsWith('chocolate'))    return 'chocolate';
  if (s.startsWith('fruity'))       return 'fruity';
  if (s.startsWith('floral'))       return 'floral';
  if (s.startsWith('experimental')) return 'experimental';
  return s;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const seg   = (p: number, a: number, b: number) => clamp((p - a) / (b - a), 0, 1);
const ease  = (t: number) => 1 - Math.pow(1 - t, 3);

interface Props {
  visitorName?: string;
  archetype?: { name: string; id: string; color: string; features: string[] } | null;
}

export function TasteFinderSection({ visitorName, archetype }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [cardHovered, setCardHovered] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const onScroll = () => {
      const w = wrapperRef.current;
      if (!w) return;
      const { top, height } = w.getBoundingClientRect();
      const total = height - window.innerHeight;
      setProgress(clamp(-top / total, 0, 1));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const name    = (visitorName || localStorage.getItem('axisbloom.name') || '').trim();
  const forName = name || 'you';
  const toName  = name.toUpperCase() || 'YOU';

  const archetypeKey = archetype ? normalizeArchetypeId(archetype.id) : null;
  const hasQuiz = !!(archetypeKey && ARCHETYPE_BAGS[archetypeKey]);

  // After quiz: all 4 layers = user's own archetype ("one world")
  const leafLPat  = hasQuiz ? ARCHETYPE_PATTERNS[archetypeKey!] : patternSpicy;
  const leafRPat  = hasQuiz ? ARCHETYPE_PATTERNS[archetypeKey!] : patternFruity;
  const sheetPat  = hasQuiz ? ARCHETYPE_PATTERNS[archetypeKey!] : patternBalanced;
  const tissuePat = hasQuiz ? ARCHETYPE_PATTERNS[archetypeKey!] : patternExperimental;

  // Scroll progress mapped to each layer
  const aL = ease(seg(progress, .07, .36));
  const aR = ease(seg(progress, .17, .46));
  const aS = ease(seg(progress, .38, .64));
  const aT = ease(seg(progress, .56, .78));
  const dimOp  = .38 * (1 - ease(seg(progress, .46, .76)));
  const objScl = ease(seg(progress, .60, .88));
  const footOp = ease(seg(progress, .88, .97));
  const hintOp = 1 - seg(progress, .03, .09);

  // Reduced motion: layers fade out in sequence instead of moving
  const rmOpacity = (layerIndex: number) => {
    if (!prefersReducedMotion) return 1;
    const start = layerIndex * 0.18;
    return clamp(1 - (progress - start) / 0.35, 0, 1);
  };

  const leafLStyle: React.CSSProperties = prefersReducedMotion
    ? { opacity: rmOpacity(3), transition: 'opacity .4s' }
    : { transform: `translate(${-118 * aL}%, ${-26 * aL}%) rotate(${-13 * aL}deg)` };

  const leafRStyle: React.CSSProperties = prefersReducedMotion
    ? { opacity: rmOpacity(2), transition: 'opacity .4s' }
    : { transform: `translate(${116 * aR}%, ${-22 * aR}%) rotate(${12 * aR}deg)` };

  const sheetStyle: React.CSSProperties = prefersReducedMotion
    ? { opacity: rmOpacity(1), transition: 'opacity .4s' }
    : { transform: `translate(${-6 * aS}%, ${-114 * aS}%) rotate(${-2.2 * aS}deg)` };

  const tissueStyle: React.CSSProperties = prefersReducedMotion
    ? { opacity: rmOpacity(0), transition: 'opacity .4s' }
    : { transform: `translateY(${-112 * aT}%) rotate(${1.4 * aT}deg)` };

  // Bag SVG with visitor name substituted into the vertical "TO:" text
  const bagRaw = archetypeKey ? ARCHETYPE_BAGS[archetypeKey] : null;
  const bagSvg = bagRaw ? bagRaw.replace('TO: YOU<', `TO: ${toName}<`) : null;

  const archColor  = archetype?.color || '#9a2918';
  const archName   = archetype?.name || '';
  const archTags   = archetypeKey ? (ARCHETYPE_TAGS[archetypeKey] || archetype?.features?.join(' · ') || '') : '';

  const bgUrl = (src: string) => `url(${src})`;

  return (
    <div ref={wrapperRef} style={{ position: 'relative', height: '400vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden', isolation: 'isolate' }}>

        {/* ── Beige inside — always visible beneath the papers ─────────── */}
        <div style={{
          position: 'absolute', inset: 0, backgroundColor: '#f2f1ea',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '40px 44px 110px', boxSizing: 'border-box',
        }}>
          {/* Gift object */}
          <div style={{ transform: `scale(${.95 + .05 * objScl}) translateY(${16 * (1 - objScl)}px)` }}>
            {hasQuiz && bagSvg ? (
              /* After-quiz state: archetype bag with visitor name */
              <a
                href="/coffees"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: 'inherit' }}
              >
                <div
                  style={{ width: 210, height: 294 }}
                  dangerouslySetInnerHTML={{ __html: bagSvg }}
                />
                <div style={{ width: 150, height: 16, background: 'rgba(30,20,14,.15)', borderRadius: '50%', margin: '8px auto 0' }} />
                <p style={{ fontSize: 13, letterSpacing: '.14em', textTransform: 'uppercase', color: archColor, margin: '18px 0 0', textAlign: 'center' }}>
                  Your archetype — {archName}
                </p>
                <p style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: '#7b7f80', margin: '6px 0 0', textAlign: 'center' }}>
                  {archTags}
                </p>
                <span style={{ display: 'inline-block', marginTop: 14, fontSize: 11, letterSpacing: '.2em', textTransform: 'uppercase', color: '#9a2918', borderBottom: '1px solid #9a2918', paddingBottom: 3 }}>
                  See your coffees →
                </span>
              </a>
            ) : (
              /* First-visit state: quiz card */
              <a
                href="/find-my-flavor"
                aria-label="Open the taste quiz"
                onMouseEnter={() => setCardHovered(true)}
                onMouseLeave={() => setCardHovered(false)}
                style={{ display: 'block', textDecoration: 'none', color: 'inherit', outline: 'none' }}
              >
                <div style={{
                  width: 330, backgroundColor: '#f2f1ea', border: '1px solid #c5c7c8',
                  padding: '44px 36px 34px', textAlign: 'center',
                  boxShadow: cardHovered
                    ? '0 28px 56px -20px rgba(30,20,14,.38)'
                    : '0 14px 40px -18px rgba(30,20,14,.28)',
                  transform: cardHovered ? 'translateY(-8px) rotate(-.6deg)' : 'none',
                  transition: 'transform .35s cubic-bezier(.22,1,.36,1), box-shadow .35s',
                }}>
                  <div style={{ marginBottom: 20 }}>
                    <svg width="26" height="26" viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M10 2 A8 8 0 0 1 18 10 L14 10 A4 4 0 0 0 10 6 Z" fill="#9a2918" />
                      <path d="M2 10 A8 8 0 0 1 6 3.1 L8.2 6.5 A4 4 0 0 0 6 10 Z" fill="#ee5974" />
                      <path d="M10 18 A8 8 0 0 1 3.2 14.3 L6.7 12.3 A4 4 0 0 0 10 14 Z" fill="#7b7f80" />
                    </svg>
                  </div>
                  <p style={{ fontSize: 11, letterSpacing: '.22em', textTransform: 'uppercase', color: '#9a2918', margin: '0 0 16px' }}>
                    For {forName}
                  </p>
                  <p style={{ fontSize: 19, lineHeight: 1.5, color: '#45474a', margin: 0 }}>
                    A coffee that fits the way you taste.
                  </p>
                  <hr style={{ border: 'none', borderTop: '1px solid #c5c7c8', margin: '24px auto', width: 56 }} />
                  <p style={{ fontSize: 22, lineHeight: 1.35, color: '#9a2918', margin: 0 }}>
                    Which archetype is yours?
                  </p>
                  <span style={{ display: 'inline-block', marginTop: 26, fontSize: 11, letterSpacing: '.2em', textTransform: 'uppercase', color: '#9a2918', borderBottom: '1px solid #9a2918', paddingBottom: 3 }}>
                    Begin →
                  </span>
                </div>
              </a>
            )}
          </div>

          {/* Footer line — fades in last */}
          <div style={{
            position: 'absolute', left: 44, right: 44, bottom: 22,
            display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
            borderTop: '1px solid #c5c7c8', paddingTop: 15,
            fontSize: 12, color: '#45474a', letterSpacing: '.08em',
            opacity: footOp,
          }}>
            <span>FROM: AXIS & BLOOM — TO: {toName} · © 2026</span>
            <span style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link to="/sign-in"        style={{ color: 'inherit', textDecoration: 'none' }}>Sign in</Link>
              <span aria-hidden="true">·</span>
              <Link to="/find-my-flavor" style={{ color: 'inherit', textDecoration: 'none' }}>Find my flavor</Link>
              <span aria-hidden="true">·</span>
              <Link to="/coffees"        style={{ color: 'inherit', textDecoration: 'none' }}>Our coffees</Link>
              <span aria-hidden="true">·</span>
              <Link to="/shop"           style={{ color: 'inherit', textDecoration: 'none' }}>Shop</Link>
              <span aria-hidden="true">·</span>
              <Link to="/about"          style={{ color: 'inherit', textDecoration: 'none' }}>About</Link>
              <span aria-hidden="true">·</span>
              <Link to="/contact"        style={{ color: 'inherit', textDecoration: 'none' }}>Contact</Link>
            </span>
          </div>

          {/* Dim — dark veil inside the wrapping, clears as papers peel */}
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(24,15,10,.38)', opacity: dimOp, pointerEvents: 'none' }} />
        </div>

        {/* ── Paper layers ─────────────────────────────────────────────────── */}

        {/* Tissue (Experimental) — topmost paper, z-index 7 */}
        <div style={{
          position: 'absolute', inset: '-4% 0 0 0', zIndex: 7,
          backgroundColor: '#ebebe3',
          backgroundImage: bgUrl(tissuePat),
          backgroundSize: '1250px', backgroundPosition: '60% 40%',
          boxShadow: '0 10px 30px -12px rgba(20,12,8,.3)',
          willChange: 'transform',
          ...tissueStyle,
        }} />

        {/* Sheet (Balanced) — z-index 9 */}
        <div style={{
          position: 'absolute', inset: '-5% 0 0 0', zIndex: 9,
          backgroundColor: '#a94936',
          backgroundImage: bgUrl(sheetPat),
          backgroundSize: '1250px', backgroundPosition: '40% 15%',
          boxShadow: '0 12px 36px -12px rgba(20,12,8,.4)',
          willChange: 'transform',
          ...sheetStyle,
        }} />

        {/* Right leaf (Fruity) — z-index 11 */}
        <div style={{
          position: 'absolute', top: '-6%', bottom: '-6%',
          right: '-4%', width: '60%', zIndex: 11,
          clipPath: 'polygon(7% 0, 100% 0, 100% 100%, 0 100%)',
          boxShadow: '-14px 0 34px -10px rgba(20,12,8,.4)',
          backgroundColor: '#9a2918',
          backgroundImage: bgUrl(leafRPat),
          backgroundSize: '1250px', backgroundPosition: '78% 62%',
          willChange: 'transform',
          ...leafRStyle,
        }} />

        {/* Left leaf (Spicy) — z-index 12, contains gift tag */}
        <div style={{
          position: 'absolute', top: '-6%', bottom: '-6%',
          left: '-4%', width: '62%', zIndex: 12,
          clipPath: 'polygon(0 0, 100% 0, 93% 100%, 0 100%)',
          boxShadow: '14px 0 34px -10px rgba(20,12,8,.45)',
          backgroundColor: '#9a2918',
          backgroundImage: bgUrl(leafLPat),
          backgroundSize: '1250px', backgroundPosition: '12% 30%',
          willChange: 'transform',
          ...leafLStyle,
        }}>
          {/* Gift tag */}
          <div style={{ position: 'absolute', top: '48%', right: '4%', zIndex: 13, transform: 'rotate(7deg)' }}>
            <span style={{ position: 'absolute', left: -24, top: 12, width: 24, height: 1, backgroundColor: '#f2f1ea', transform: 'rotate(-16deg)', display: 'block' }} />
            <span style={{ display: 'inline-block', backgroundColor: '#f2f1ea', color: '#9a2918', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', padding: '10px 14px', boxShadow: '0 3px 10px rgba(0,0,0,.28)' }}>
              For {forName}
            </span>
          </div>
        </div>

        {/* Hint text — above all layers */}
        <span style={{
          position: 'absolute', bottom: 30, left: 0, right: 0, textAlign: 'center', zIndex: 14,
          color: 'rgba(242,241,234,.92)', fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase',
          textShadow: '0 1px 8px rgba(0,0,0,.4)', opacity: hintOp, pointerEvents: 'none',
        }}>
          Scroll to open
        </span>

      </div>
    </div>
  );
}
