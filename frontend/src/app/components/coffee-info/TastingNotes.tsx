import type { CSSProperties } from 'react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router';
import { SOURCE_LABEL, SOURCE_COLOR } from './CollaborativeFlavorWheel';

export interface ContentData {
  aiSummary: string;
  surpriseNote: string | null;
  threeVoiceStory: string | null;
}

const RULE_STYLE: CSSProperties = { border: 'none', borderTop: '1px solid #deded1', margin: '32px 0' };
const QUIET_LINK_CLASS = 'text-[10.5px] uppercase tracking-[.14em] text-[#9a2918] opacity-[.85] hover:opacity-100 no-underline transition-opacity';

/** Loading skeleton — brand-neutral (`#f2f1ea`, the track/skeleton background), used by
 * both variants (Part 13 introduced it for 'reveal'; Part 15 reused it for 'full' rather
 * than keep a second, legacy-`#e0dcd4` skeleton around). */
function ContentSkeletonReveal() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-3 rounded w-3/4" style={{ backgroundColor: '#f2f1ea' }} />
      <div className="h-3 rounded w-full" style={{ backgroundColor: '#f2f1ea' }} />
      <div className="h-3 rounded w-2/3" style={{ backgroundColor: '#f2f1ea' }} />
    </div>
  );
}

interface TastingNotesProps {
  content: ContentData | null;
  contentLoading: boolean;
  /** When provided, renders "Explore the full flavor breakdown →" linking here (Bloom only — CoffeesPage IS this destination). */
  exploreLink?: string;
  /** When provided, renders "Talk to Liam about this coffee →" linking here (Bloom only, The Bloom Part 4). */
  talkToLiamLink?: string;
  /** When provided, renders "Your flavor profile →" linking here (Profile Part 6, issue D —
   * every RevealedPanel surface except Profile itself, guests included since /profile
   * redirects to sign-in, which is the right nudge right after finishing the quiz). */
  profileLink?: string;
  /** Reveal-panel trimmed presentation (Part 13) — renders ONLY the Three voices block
   * (with the surprise-note fallback when there's no story yet): no surprise-note block
   * when a story exists, no Liam's intake box, no action links (those move to
   * RevealedPanel's own footer). Default 'full' preserves today's rendering byte-for-byte —
   * FlavorIntelligencePage's own TastingNotes call keeps rendering unchanged. */
  variant?: 'full' | 'reveal';
}

/** Surprise note + three-voice story + collapsible "Liam's intake" (ai_summary) + optional explore-further/Liam/profile links. */
export function TastingNotes({ content, contentLoading, exploreLink, talkToLiamLink, profileLink, variant = 'full' }: TastingNotesProps) {
  const [aiExpanded, setAiExpanded] = useState(false);

  if (variant === 'reveal') {
    const story = content?.threeVoiceStory;
    const fallback = content?.surpriseNote;
    const stillLoading = contentLoading && !story && !fallback;

    if (stillLoading) return <ContentSkeletonReveal />;

    if (story) {
      return (
        <div>
          <div className="flex items-center gap-[18px] flex-wrap mb-[14px]">
            <span className="text-[10px] uppercase tracking-[.18em]" style={{ color: '#7b7f80', fontWeight: 400 }}>
              Three voices
            </span>
            <div className="flex gap-[14px] flex-wrap">
              {Object.entries(SOURCE_LABEL).map(([source, label]) => (
                <div key={source} className="flex items-center gap-1.5">
                  <span className="w-[7px] h-[7px] rounded-full" style={{ backgroundColor: SOURCE_COLOR[source] }} />
                  <span className="text-[11px]" style={{ color: '#7b7f80' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[15.5px] font-light" style={{ color: '#45474a', lineHeight: 1.75, maxWidth: '66ch' }}>
            {story}
          </p>
        </div>
      );
    }

    if (fallback) {
      return (
        <p className="text-[15.5px] font-light" style={{ color: '#45474a', lineHeight: 1.7, maxWidth: '66ch' }}>
          {fallback}
        </p>
      );
    }

    return null;
  }

  // Part 15 — brand reskin of the 'full' variant (Flavor Intelligence + CompareOverlay
  // never call TastingNotes, so this branch is FI-only). Content/structure unchanged;
  // sections separated by 1px #deded1 hairlines instead of plain vertical gaps, no
  // tinted rounded box for Liam's intake. Track which blocks actually render so a
  // conditionally-empty block (surprise/three-voice can both be null) never leaves an
  // orphaned hairline — Liam's intake and (when link props are given) the actions row
  // always render, so hairlines before them are unconditional.
  const showSurprise = (contentLoading && !content?.surpriseNote) || !!content?.surpriseNote;
  const showThreeVoice = (contentLoading && !content?.threeVoiceStory) || !!content?.threeVoiceStory;
  const hasActions = !!(exploreLink || talkToLiamLink || profileLink);

  return (
    <div>
      {/* ─ Surprise angle ─ */}
      {showSurprise && (
        <div>
          {contentLoading && !content?.surpriseNote ? (
            <ContentSkeletonReveal />
          ) : (
            <p className="text-[15.5px] font-light" style={{ color: '#45474a', lineHeight: 1.7, maxWidth: '66ch' }}>
              {content!.surpriseNote}
            </p>
          )}
        </div>
      )}

      {showSurprise && <hr style={RULE_STYLE} />}

      {/* ─ Three-voice story ─ */}
      {showThreeVoice && (
        <div>
          {contentLoading && !content?.threeVoiceStory ? (
            <ContentSkeletonReveal />
          ) : (
            <div>
              <div className="flex items-center gap-[18px] flex-wrap mb-[14px]">
                <span className="text-[10px] uppercase tracking-[.18em]" style={{ color: '#7b7f80', fontWeight: 400 }}>
                  Three voices
                </span>
                <div className="flex gap-[14px] flex-wrap">
                  {Object.entries(SOURCE_LABEL).map(([source, label]) => (
                    <div key={source} className="flex items-center gap-1.5">
                      <span className="w-[7px] h-[7px] rounded-full" style={{ backgroundColor: SOURCE_COLOR[source] }} />
                      <span className="text-[11px]" style={{ color: '#7b7f80' }}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-[15.5px] font-light" style={{ color: '#45474a', lineHeight: 1.7, maxWidth: '66ch' }}>
                {content!.threeVoiceStory}
              </p>
            </div>
          )}
        </div>
      )}

      {showThreeVoice && <hr style={RULE_STYLE} />}

      {/* ─ Liam's intake (collapsible) — flat hairline section, no tinted rounded box. ─ */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[.18em]" style={{ color: '#7b7f80', fontWeight: 400 }}>Liam's intake</span>
            <span className="text-[10px] uppercase tracking-[.06em] px-1.5 py-0.5" style={{ backgroundColor: '#f2f1ea', color: '#9a2918' }}>AI</span>
          </div>
          {content?.aiSummary && (
            <button
              onClick={() => setAiExpanded(v => !v)}
              className="transition-opacity hover:opacity-100"
              style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: '#ee5974', background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: 0.9 }}
            >
              {aiExpanded ? 'Collapse ↑' : 'Read full note ↓'}
            </button>
          )}
        </div>
        {contentLoading && !content?.aiSummary ? (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full border-2 animate-spin" style={{ borderColor: '#deded1', borderTopColor: '#7b7f80' }} />
            <span className="text-[15.5px] font-light" style={{ color: '#7b7f80' }}>Generating…</span>
          </div>
        ) : content?.aiSummary ? (
          <AnimatePresence initial={false}>
            {aiExpanded ? (
              <motion.p
                key="expanded"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden text-[15.5px] font-light"
                style={{ color: '#45474a', lineHeight: 1.7, maxWidth: '66ch' }}
              >
                {content.aiSummary}
              </motion.p>
            ) : (
              <motion.p
                key="collapsed"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="line-clamp-2 text-[15.5px] font-light"
                style={{ color: '#7b7f80', lineHeight: 1.7, maxWidth: '66ch' }}
              >
                {content.aiSummary}
              </motion.p>
            )}
          </AnimatePresence>
        ) : (
          <p className="text-[15.5px] font-light" style={{ color: '#7b7f80' }}>Not enough data to generate a summary yet.</p>
        )}
      </div>

      {/* ─ Explore-further / Talk to Liam links (Bloom only) — set apart as a quiet
          actions row, no emojis. ─ */}
      {hasActions && <hr style={RULE_STYLE} />}
      {hasActions && (
        <div className="flex flex-wrap gap-x-9 gap-y-3">
          {exploreLink && (
            <Link to={exploreLink} className={QUIET_LINK_CLASS}>
              Explore the full flavor breakdown →
            </Link>
          )}
          {talkToLiamLink && (
            <Link to={talkToLiamLink} className={QUIET_LINK_CLASS}>
              Talk to Liam about this coffee →
            </Link>
          )}
          {profileLink && (
            <Link to={profileLink} className={QUIET_LINK_CLASS}>
              Your flavor profile →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
