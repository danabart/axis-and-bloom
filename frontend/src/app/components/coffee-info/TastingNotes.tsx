import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router';

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

interface TastingNotesProps {
  content: ContentData | null;
  contentLoading: boolean;
  /** When provided, renders "Explore the full flavor breakdown →" linking here (Bloom only — CoffeesPage IS this destination). */
  exploreLink?: string;
  /** When provided, renders "Talk to Liam about this coffee →" linking here (Bloom only, The Bloom Part 4). */
  talkToLiamLink?: string;
}

/** Surprise note + three-voice story + collapsible "Liam's intake" (ai_summary) + optional explore-further/Liam links. */
export function TastingNotes({ content, contentLoading, exploreLink, talkToLiamLink }: TastingNotesProps) {
  const [aiExpanded, setAiExpanded] = useState(false);

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
              {['Internal cupping', 'Roastery notes', 'Customer feedback'].map((label, i) => {
                const colors = ['#b05642', '#7c9e87', '#8a7cbe'];
                return (
                  <div key={label} className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors[i] }} />
                    <span className="text-xs" style={{ color: '#8a8070' }}>{label}</span>
                  </div>
                );
              })}
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
      {(exploreLink || talkToLiamLink) && (
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
        </div>
      )}
    </div>
  );
}
