import type { CSSProperties } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router';
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
  userArchetype: string | null;
  /** Profile Part 6, issue D: hides the "Your flavor profile →" action-row link.
   * Additive, default false (shown) — every existing consumer keeps the link;
   * only the Profile page itself passes true, since a self-link there is noise. */
  hideProfileLink?: boolean;
  /** Pre-Launch Gate: hides "Explore the full breakdown →" (flavor-intelligence
   * is a hidden route while gated) and "Talk to Liam →" (/sommelier, also
   * hidden). "Your flavor profile →" is unaffected by this prop — /profile
   * stays open throughout the gate, per hideProfileLink above. Default false,
   * derived by DialArchetypeSection from the same lib/prelaunch.ts source of
   * truth as the route guard. */
  prelaunch?: boolean;
}

const RULE_STYLE: CSSProperties = { border: 'none', borderTop: '1px solid #deded1', margin: '32px 0' };
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
 * Signature notes) → footer (actions). Brand type/color language throughout
 * (matches the Bloom Dial above it), 1px hairlines instead of nested rounded
 * cards, no emojis. See PROMPT_reveal_panel_redesign.md.
 *
 * Part 16 §A — "Nearby on the dial" hop chips moved OUT of this footer and onto
 * the dial instrument itself (`BloomDial.tsx`, rendered pre-reveal below the
 * "TURN THE WHEEL" hint) — no longer this component's concern at all; `hops`/
 * `onHopClick` dropped from the prop surface accordingly.
 *
 * Part 17 §A — on wide panels (≥ ~1200px) prose no longer stacks above the
 * evidence grid; it becomes the first column of one shared row (prose | cupping
 * | signature notes, ~40/30/30). Medium/narrow unchanged. See the inline
 * comment at the row itself for how one nested flex+grid structure covers
 * every breakpoint and every evidence-presence combination without a
 * JS-computed template per case.
 */
export function RevealedPanel({ isRevealed, archetype, dialSortOrder, content, dimensions, wheelRows, userArchetype, hideProfileLink = false, prelaunch = false }: RevealedPanelProps) {
  const { compat, dimCompText } = useCompatibility(archetype, userArchetype, dimensions);
  const exploreLink = archetype && dialSortOrder != null ? `/flavor-intelligence?archetype=${archetype}&slot=${dialSortOrder}` : '/flavor-intelligence';
  const hasDimensions = dimensions.length > 0;
  const hasWheel = wheelRows.length > 0;
  const hasEvidence = hasDimensions || hasWheel;

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

            {/* ── Row 2+3 · Three voices + Evidence ──
                Part 17 §A — on wide panels (≥ ~1200px) prose stops stacking above
                the evidence grid and instead shares ONE row with it: prose | cupping
                | signature notes, roughly 40/30/30. Medium keeps today's behavior
                (prose full-width, then the evidence grid below); narrow keeps
                everything stacked. One outer flex row (column below 1200px, row at
                it) does the 40/60 prose/evidence split; the evidence side is its own
                nested grid (1 col below md, 2 col from md up) for the dims|wheel
                split — nesting rather than one flat 3-col grid so the SAME markup
                naturally satisfies every breakpoint without a separate JS-computed
                template per hasDimensions/hasWheel combination. Part 16 §C's rule
                still applies: an absent evidence column's share isn't reserved —
                the evidence side just holds whichever one block exists (or none),
                so 40/60 quietly becomes "prose alone" when there's no evidence at
                all (the wide row itself is skipped in that case, see hasEvidence
                below) and prose/single-block when there's exactly one. */}
            <div className="flex flex-col min-[1200px]:flex-row gap-10">
              <div className="min-w-0 min-[1200px]:flex-[2]">
                <TastingNotes content={content} contentLoading={!content} variant="reveal" />
              </div>
              {hasEvidence && (
                <div
                  className={
                    hasDimensions && hasWheel
                      ? 'min-w-0 min-[1200px]:flex-[3] grid grid-cols-1 md:grid-cols-2 gap-10'
                      : 'min-w-0 min-[1200px]:flex-[3]'
                  }
                >
                  {hasDimensions && <DimensionBars dimensions={dimensions} variant="reveal" />}
                  {hasWheel && <CollaborativeFlavorWheel wheelRows={wheelRows} variant="signature" />}
                </div>
              )}
            </div>

            <hr style={RULE_STYLE} />

            {/* ── Row 4 · Footer: actions ── */}
            <div className="flex flex-wrap gap-x-9 gap-y-3">
              {!prelaunch && <Link to={exploreLink} className={QUIET_LINK_CLASS}>Explore the full breakdown →</Link>}
              {!prelaunch && <Link to="/sommelier" className={QUIET_LINK_CLASS}>Talk to Liam →</Link>}
              {!hideProfileLink && <Link to="/profile" className={QUIET_LINK_CLASS}>Your flavor profile →</Link>}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
