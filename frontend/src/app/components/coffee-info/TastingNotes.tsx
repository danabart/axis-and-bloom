import type { CSSProperties } from 'react';
import { Link } from 'react-router';

export interface ContentData {
  /** Coffee presentation brief 2: retired from customer surfaces; still in GET /:id/content for one release, rendered by nothing. */
  aiSummary?: string;
  /** Coffee presentation brief 2: retired from customer surfaces, as aiSummary. */
  surpriseNote?: string | null;
  threeVoiceStory: string | null;
  /** Coffee presentation brief 4: the card's small tags (award, best brew), labels from the backend. */
  tags?: CardTag[];
}

export interface CardTag { kind: 'award' | 'brew'; label: string }

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

/** The one description, under its header. Coffee presentation brief 2, decision 6:
 * "In the roaster's words" (was "Three voices" with a source legend; there are no
 * three voices any more: the roaster leads, customers add, we only confirm). */
function StoryBlock({ story }: { story: string }) {
  return (
    <div>
      <span className="block text-[10px] uppercase tracking-[.18em] mb-[14px]" style={{ color: '#7b7f80', fontWeight: 400 }}>
        In the roaster's words
      </span>
      <p className="text-[15.5px] font-light" style={{ color: '#45474a', lineHeight: 1.75, maxWidth: '66ch' }}>
        {story}
      </p>
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
  /** Reveal-panel trimmed presentation (Part 13) — renders ONLY the description block,
   * no action links (those move to RevealedPanel's own footer). 'full' (Flavor
   * Intelligence) adds the actions row when link props are given. */
  variant?: 'full' | 'reveal';
}

/**
 * The coffee's one description (three_voice_story) + optional explore-further/Liam/profile links.
 * Coffee presentation brief 2 (2026-10-24), decision 6: one description per coffee. The
 * surprise-note block, its reveal-variant fallback and the "Liam's intake" block (which
 * rendered ai_summary) are gone, with their skeletons; both columns stay in the data.
 */
export function TastingNotes({ content, contentLoading, exploreLink, talkToLiamLink, profileLink, variant = 'full' }: TastingNotesProps) {
  const story = content?.threeVoiceStory ?? null;

  if (variant === 'reveal') {
    if (contentLoading && !story) return <ContentSkeletonReveal />;
    return story ? <StoryBlock story={story} /> : null;
  }

  // Part 15 — brand reskin of the 'full' variant (Flavor Intelligence only). Sections
  // separated by 1px #deded1 hairlines; the hairline before the actions row only
  // renders when the description block above it does.
  const showStory = (contentLoading && !story) || !!story;
  const hasActions = !!(exploreLink || talkToLiamLink || profileLink);

  return (
    <div>
      {showStory && (contentLoading && !story ? <ContentSkeletonReveal /> : <StoryBlock story={story!} />)}

      {/* ─ Explore-further / Talk to Liam links (Bloom only) — set apart as a quiet
          actions row, no emojis. ─ */}
      {showStory && hasActions && <hr style={RULE_STYLE} />}
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
