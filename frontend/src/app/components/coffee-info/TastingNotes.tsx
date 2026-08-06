import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router';
import { SOURCE_LABEL, SOURCE_COLOR } from './CollaborativeFlavorWheel';

export interface ContentData {
  aiSummary: string;
  surpriseNote: string | null;
  threeVoiceStory: string | null;
}

function ContentSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-3 rounded w-3/4" style={{ backgroundColor: '#e0dcd4' }} />
      <div className="h-3 rounded w-full" style={{ backgroundColor: '#e0dcd4' }} />
      <div className="h-3 rounded w-2/3" style={{ backgroundColor: '#e0dcd4' }} />
    </div>
  );
}

/** Reveal-panel loading skeleton (Part 13) — same shape as ContentSkeleton, brand
 * neutral (`#f2f1ea`, the new track/skeleton background) instead of the legacy hairline. */
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

  return (
    <div className="space-y-8">
      {/* ─ Surprise angle ─ */}
      <div>
        {contentLoading && !content?.surpriseNote ? (
          <ContentSkeleton />
        ) : content?.surpriseNote ? (
          <p
            className="text-base leading-relaxed"
            style={{ color: '#3a3020', borderLeft: '2px solid #b0564240', paddingLeft: '1rem' }}
          >
            {content.surpriseNote}
          </p>
        ) : null}
      </div>

      {/* ─ Three-voice story ─ */}
      <div>
        {contentLoading && !content?.threeVoiceStory ? (
          <ContentSkeleton />
        ) : content?.threeVoiceStory ? (
          <div>
            <p className="text-xs uppercase tracking-widest mb-3" style={{ color: '#a09880' }}>
              Three voices
            </p>
            <div className="flex gap-3 mb-3">
              {Object.entries(SOURCE_LABEL).map(([source, label]) => (
                <div key={source} className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SOURCE_COLOR[source] }} />
                  <span className="text-xs" style={{ color: '#8a8070' }}>{label}</span>
                </div>
              ))}
            </div>
            <p className="text-base leading-relaxed" style={{ color: '#3a3020' }}>
              {content.threeVoiceStory}
            </p>
          </div>
        ) : null}
      </div>

      {/* ─ Liam's intake (collapsible) ─ */}
      <div className="rounded-xl border px-6 py-5" style={{ borderColor: '#e0dcd4', backgroundColor: '#faf9f5' }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-widest" style={{ color: '#a09880' }}>Liam's intake</span>
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f0ede6', color: '#b05642' }}>AI</span>
          </div>
          {content?.aiSummary && (
            <button
              onClick={() => setAiExpanded(v => !v)}
              className="text-xs transition-colors"
              style={{ color: '#a09880' }}
            >
              {aiExpanded ? 'Collapse ↑' : 'Read full note ↓'}
            </button>
          )}
        </div>
        {contentLoading && !content?.aiSummary ? (
          <div className="flex items-center gap-2 text-stone-400">
            <div className="w-3 h-3 rounded-full border-2 border-stone-300 border-t-stone-400 animate-spin" />
            <span className="text-sm">Generating…</span>
          </div>
        ) : content?.aiSummary ? (
          <AnimatePresence initial={false}>
            {aiExpanded ? (
              <motion.p
                key="expanded"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="text-base leading-relaxed overflow-hidden"
                style={{ color: '#3a3020' }}
              >
                {content.aiSummary}
              </motion.p>
            ) : (
              <motion.p
                key="collapsed"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-sm line-clamp-2"
                style={{ color: '#8a8070' }}
              >
                {content.aiSummary}
              </motion.p>
            )}
          </AnimatePresence>
        ) : (
          <p className="text-sm" style={{ color: '#a09880' }}>Not enough data to generate a summary yet.</p>
        )}
      </div>

      {/* ─ Explore-further / Talk to Liam links (Bloom only) — set apart as an actions
          row with a top border/spacing and leading icons, not more prose to skim past. ─ */}
      {(exploreLink || talkToLiamLink || profileLink) && (
        <div
          className="flex flex-wrap gap-x-8 gap-y-3 pt-6"
          style={{ borderTop: '1px solid #e0dcd4' }}
        >
          {exploreLink && (
            <Link
              to={exploreLink}
              className="inline-flex items-center gap-2 text-sm font-normal hover:underline"
              style={{ color: '#b05642' }}
            >
              <span aria-hidden="true">🧭</span>
              Explore the full flavor breakdown →
            </Link>
          )}
          {talkToLiamLink && (
            <Link
              to={talkToLiamLink}
              className="inline-flex items-center gap-2 text-sm font-normal hover:underline"
              style={{ color: '#b05642' }}
            >
              <span aria-hidden="true">💬</span>
              Talk to Liam about this coffee →
            </Link>
          )}
          {profileLink && (
            <Link
              to={profileLink}
              className="inline-flex items-center gap-2 text-sm font-normal hover:underline"
              style={{ color: '#b05642' }}
            >
              <span aria-hidden="true">🌱</span>
              Your flavor profile →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
