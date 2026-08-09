// The Match Ending & The Folded Dial (Part 21) — the door band: a folded
// piece of the dial itself. Sits directly under the match card on every
// folded-by-default surface (quiz results, quiz returning-user, Profile
// archetype box), full card width, in the archetype's own field color.
// Clicking it unfolds the dial beside (desktop) or beneath (phone) the card —
// see DialArchetypeSection.tsx, which owns the open/closed state and passes
// this component nothing but what it needs to render itself.
//
// Shared subcomponent per the prompt's own instruction (§2.5) — one
// definition, used identically by every folded surface via
// DialArchetypeSection, no forks. Static layout/hover/wrap CSS lives in
// BloomDial.tsx's stylesheet (bd-band*, injected once by ensureStyles()) —
// only the per-archetype dynamic colors are inline here, matching the
// Part 20 card's own inline-vs-class split.

interface DoorBandProps {
  archetypeLabel: string;
  /** The archetype's dial field color (config.color) — the band's background. */
  color: string;
  /** The archetype's field-text color (config.ftext) — '#9a2918' (ink) for
   * Balanced & Sweet's mustard field, '#f2f1ea' (beige) everywhere else. The
   * exact same rule BloomDial's own field/needle/ruler already use — reused
   * here rather than re-derived, per the prompt's explicit instruction. */
  ftext: string;
  onClick: () => void;
}

export function DoorBand({ archetypeLabel, color, ftext, onClick }: DoorBandProps) {
  const isDark = ftext === '#9a2918';
  const textWeak = isDark ? 'rgba(154,41,24,.75)' : 'rgba(242,241,234,.75)';
  const ringWeak = isDark ? 'rgba(154,41,24,.45)' : 'rgba(255,255,255,.55)';
  const ringWeaker = isDark ? 'rgba(154,41,24,.28)' : 'rgba(255,255,255,.35)';
  const pillBorder = isDark ? 'rgba(154,41,24,.5)' : 'rgba(255,255,255,.55)';

  return (
    <button type="button" className="bd-band" onClick={onClick} style={{ background: color, color: ftext }}>
      <svg className="bd-band-glyph" width="34" height="34" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="16" fill="none" stroke={ringWeak} strokeWidth={2.5} />
        <circle cx="20" cy="20" r="8" fill="none" stroke={ringWeaker} strokeWidth={2} />
        <line x1="20" y1="4" x2="20" y2="11" stroke={ftext} strokeWidth={2.5} />
      </svg>
      <span className="bd-band-text">
        <span className="bd-band-micro" style={{ color: textWeak }}>The Bloom Dial</span>
        <span className="bd-band-line">{archetypeLabel} is your family. The dial finds your place in it.</span>
      </span>
      <span className="bd-band-act" style={{ border: `1px solid ${pillBorder}` }}>
        Find your exact spot&nbsp;→
      </span>
    </button>
  );
}
