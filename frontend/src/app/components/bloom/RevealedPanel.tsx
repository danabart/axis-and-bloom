import { motion, AnimatePresence } from 'motion/react';
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

/**
 * The revealed informational layer, full-width — split out of PositionCard.tsx
 * (The Bloom Part 4, Phase D) so it renders below the photo/dial/card
 * three-column row instead of being squeezed into the ~40% position-card
 * column. Content/order unchanged from Part 2: notes/Liam's intake (+
 * explore-further and Talk-to-Liam links) → dimension bars → Collaborative
 * Flavor Wheel → compatibility badge → hop links.
 */
export function RevealedPanel({ isRevealed, archetype, dialSortOrder, content, dimensions, wheelRows, hops, userArchetype, onHopClick, hideProfileLink = false }: RevealedPanelProps) {
  const { compat, dimCompText } = useCompatibility(archetype, userArchetype, dimensions);

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
            className="rounded-xl border px-5 py-6 md:px-8 md:py-8 space-y-8"
            style={{ borderColor: '#e0dcd4', backgroundColor: '#fff', marginTop: 'clamp(20px, 3vh, 32px)' }}
          >
            <TastingNotes
              content={content}
              contentLoading={!content}
              exploreLink={archetype && dialSortOrder != null ? `/flavor-intelligence?archetype=${archetype}&slot=${dialSortOrder}` : '/flavor-intelligence'}
              talkToLiamLink="/sommelier"
              profileLink={hideProfileLink ? undefined : '/profile'}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <DimensionBars dimensions={dimensions} />
              <CollaborativeFlavorWheel wheelRows={wheelRows} />
            </div>

            {compat && userArchetype && (
              <div className="flex flex-col gap-3">
                <CompatibilityBadge level={compat} userArchetype={userArchetype} />
                {dimCompText && (
                  <p className="text-sm font-light leading-relaxed" style={{ color: '#8a8070' }}>{dimCompText}</p>
                )}
              </div>
            )}

            {hops.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {hops.map((hop, i) => (
                  <button
                    key={i}
                    onClick={() => onHopClick(hop.target.archetype, hop.target.dialSortOrder)}
                    className="text-xs px-3 py-1.5 rounded-full border"
                    style={{ borderColor: '#d0ccc4', color: '#8a8070' }}
                  >
                    {hop.target.archetype !== archetype && `→ ${hop.target.archetypeLabel} · `}
                    {hop.target.positionLabel} — {hop.target.platformName} · {hop.direction} {hop.dimensionName.toLowerCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
