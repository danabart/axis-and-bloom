import type { CSSProperties } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router';
import type { Hop } from './types';
import { TastingNotes, type ContentData } from '../coffee-info/TastingNotes';
import { DimensionBars, type DimensionRow } from '../coffee-info/DimensionBars';
import { CollaborativeFlavorWheel, type WheelRow } from '../coffee-info/CollaborativeFlavorWheel';
import { CompatibilityBadge, useCompatibility } from '../coffee-info/useCompatibility';

interface RevealedPanelProps {
  isRevealed: boolean;
  archetype: string;
  dialSortOrder: number | null;
  content: ContentData | null;
  dimensions: DimensionRow[];
  wheelRows: WheelRow[];
  hops: Hop[];
  userArchetype: string | null;
  onHopClick: (targetArchetype: string, targetDialSortOrder: number) => void;
  /** Profile Part 6, issue D: hides the "Your flavor profile →" action-row link.
   * Additive, default false (shown) — every existing consumer keeps the link;
   * only the Profile page itself passes true, since a self-link there is noise. */
  hideProfileLink?: boolean;
}

const RULE_STYLE: CSSProperties = { border: 'none', borderTop: '1px solid #deded1', margin: '32px 0' };
const MICRO_LABEL_STYLE: CSSProperties = { color: '#7b7f80', fontWeight: 400 };
const MICRO_LABEL_CLASS = 'text-[10px] uppercase tracking-[.18em]';
const QUIET_LINK_CLASS = 'text-[10.5px] uppercase tracking-[.14em] text-[#9a2918] opacity-[.85] hover:opacity-100 no-underline transition-opacity';

/**
 * The revealed informational layer, full-width — split out of PositionCard.tsx
 * (The Bloom Part 4, Phase D) so it renders below the photo/dial/card
 * three-column row instead of being squeezed into the ~40% position-card
 * column.
 *
 * Part 13 (reveal-panel redesign) — new order: verdict (compatibility badge +
 * why-sentence) → Three voices (the only prose left; TastingNotes' surprise-note
 * and Liam's-intake blocks are retired here) → evidence (trimmed cupping bars +
 * Signature notes) → footer (actions + nearby-on-the-dial hops). Brand type/color
 * language throughout (matches the Bloom Dial above it), 1px hairlines instead of
 * nested rounded cards, no emojis. See PROMPT_reveal_panel_redesign.md.
 */
export function RevealedPanel({ isRevealed, archetype, dialSortOrder, content, dimensions, wheelRows, hops, userArchetype, onHopClick, hideProfileLink = false }: RevealedPanelProps) {
  const { compat, dimCompText } = useCompatibility(archetype, userArchetype, dimensions);
  const exploreLink = archetype && dialSortOrder != null ? `/flavor-intelligence?archetype=${archetype}&slot=${dialSortOrder}` : '/flavor-intelligence';
  const hasEvidence = dimensions.length > 0 || wheelRows.length > 0;

  return (
    <AnimatePresence initial={false}>
      {isRevealed && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden"
        >
          <div
            className="border px-[22px] py-[28px] md:px-[48px] md:py-[44px]"
            style={{ borderColor: '#deded1', borderRadius: 2, backgroundColor: '#fff', marginTop: 'clamp(20px, 3vh, 32px)' }}
          >
            {/* ── Row 1 · Verdict ── */}
            {userArchetype == null ? (
              <Link to="/find-my-flavor" className={QUIET_LINK_CLASS}>
                Find your flavor to see your match →
              </Link>
            ) : compat ? (
              <div className="flex items-baseline gap-5 flex-wrap">
                <CompatibilityBadge level={compat} userArchetype={userArchetype} variant="reveal" />
                {dimCompText && (
                  <p className="text-[15.5px] font-light" style={{ color: '#45474a', lineHeight: 1.55, maxWidth: '52ch' }}>
                    {dimCompText}
                  </p>
                )}
              </div>
            ) : null}

            <hr style={RULE_STYLE} />

            {/* ── Row 2 · Three voices ── */}
            <TastingNotes content={content} contentLoading={!content} variant="reveal" />

            {/* ── Row 3 · Evidence ── */}
            {hasEvidence && (
              <>
                <hr style={RULE_STYLE} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                  <DimensionBars dimensions={dimensions} variant="reveal" />
                  <CollaborativeFlavorWheel wheelRows={wheelRows} variant="signature" />
                </div>
              </>
            )}

            <hr style={RULE_STYLE} />

            {/* ── Row 4 · Footer: actions + nearby positions ── */}
            <div>
              <div className="flex flex-wrap gap-x-9 gap-y-3">
                <Link to={exploreLink} className={QUIET_LINK_CLASS}>Explore the full breakdown →</Link>
                <Link to="/sommelier" className={QUIET_LINK_CLASS}>Talk to Liam →</Link>
                {!hideProfileLink && <Link to="/profile" className={QUIET_LINK_CLASS}>Your flavor profile →</Link>}
              </div>

              {hops.length > 0 && (
                <div style={{ marginTop: 26 }}>
                  <span className={MICRO_LABEL_CLASS} style={MICRO_LABEL_STYLE}>Nearby on the dial</span>
                  <div className="flex flex-wrap gap-2" style={{ marginTop: 10 }}>
                    {hops.map((hop, i) => (
                      <button
                        key={i}
                        onClick={() => onHopClick(hop.target.archetype, hop.target.dialSortOrder)}
                        className="text-[11px] tracking-[.03em] px-[14px] py-[6px] rounded-full border border-[#deded1] bg-transparent text-[#7b7f80] hover:border-[#9a2918] hover:text-[#9a2918] transition-colors text-left"
                      >
                        {hop.direction === 'more' ? 'More' : 'Less'} {hop.dimensionName.toLowerCase()} → {hop.target.positionLabel}
                        {hop.target.archetype !== archetype && ` · ${hop.target.archetypeLabel}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
