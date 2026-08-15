import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { ARCHETYPE_COLOR } from './coffee-info/archetypeConstants';
import { reportError } from '../lib/errorReporter';

const RUST = '#a33726';

interface StoryData {
  displayName: string;
  story: string | null;
  archetype: string | null;
  archetypeLabel: string | null;
  dialPosition: { label: string; sortOrder: number } | null;
}

/** HOME_TASK_5 (§4.4) — the public story page: "their coffee, explained."
 * Public, roaster-blind, no auth required. Deliberately a small, dedicated
 * page rather than an extension of BloomPage.tsx — BloomPage carries cart,
 * compare, and personalization state that this surface has no use for and
 * shouldn't inherit; this reuses BloomPage's *display* conventions (archetype
 * color, editorial typography) without forking its heavier logic.
 *
 * This is also the route Task 7's QR redirect resolves a signed-in
 * non-owner scan to, and — via `?retired=1&nearestHop=`, added by Task 7 —
 * a retired-coffee scan. The past-tense framing below is UI chrome around
 * this page's existing (present-tense) story text, not a rewrite of the
 * story content itself — Task 7's own scope line is explicit that story
 * content (Task 5) isn't touched here. */
export default function CoffeeStoryPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const isRetired = searchParams.get('retired') === '1';
  const nearestHopParam = searchParams.get('nearestHop');
  const nearestHopCoffeeId = nearestHopParam && /^\d+$/.test(nearestHopParam) ? nearestHopParam : null;
  const [data, setData] = useState<StoryData | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!id) return;
    fetch(`/api/coffees/${id}/story`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((j: StoryData) => { setData(j); setPhase('ready'); })
      .catch(err => { reportError('[CoffeeStoryPage/load]', err); setPhase('error'); });
  }, [id]);

  if (phase === 'loading') {
    return <div className="min-h-[50vh] flex items-center justify-center text-sm text-stone-400">Loading…</div>;
  }
  if (phase === 'error' || !data) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4 text-center px-6">
        <p className="text-sm text-stone-500">We couldn't find that coffee.</p>
        <Link to="/find-my-flavor" className="text-xs uppercase tracking-[0.2em] border-b pb-0.5" style={{ color: RUST, borderColor: RUST }}>
          Find your flavor <ArrowRight size={12} className="inline" />
        </Link>
      </div>
    );
  }

  const color = data.archetype ? (ARCHETYPE_COLOR[data.archetype] ?? RUST) : RUST;

  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      {isRetired && (
        <p className="text-xs italic text-stone-400 mb-6">This one's moved on from our lineup.</p>
      )}
      <p className="text-[10px] uppercase tracking-[0.3em] mb-2" style={{ color: `${color}99` }}>
        {data.archetypeLabel ?? 'Axis & Bloom'}
      </p>
      <h1 className="text-2xl font-normal mb-1" style={{ color: '#3a2e28' }}>{data.displayName}</h1>
      {data.dialPosition && (
        <p className="text-xs uppercase tracking-[0.2em] text-stone-400 mb-8">{data.dialPosition.label}</p>
      )}
      {!data.dialPosition && <div className="mb-8" />}

      {data.story ? (
        <p className="text-[15px] leading-[1.8] whitespace-pre-wrap" style={{ color: '#4a3f38' }}>
          {data.story}
        </p>
      ) : (
        <p className="text-sm text-stone-400 italic">The story for this coffee isn't ready yet — check back soon.</p>
      )}

      {isRetired && nearestHopCoffeeId && (
        <div className="mt-10 pt-6 border-t border-stone-100">
          <p className="text-sm text-stone-500 mb-3">Here's its closest relative in the lineup today.</p>
          <Link
            to={`/coffee/${nearestHopCoffeeId}/story`}
            className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] border-b pb-0.5 transition-colors"
            style={{ color: RUST, borderColor: RUST }}
          >
            See the closest relative <ArrowRight size={12} />
          </Link>
        </div>
      )}

      <div className="mt-12 pt-8 border-t border-stone-100">
        <p className="text-sm text-stone-500 mb-3">Curious what your own match would be?</p>
        <Link
          to="/find-my-flavor"
          className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] border-b pb-0.5 transition-colors"
          style={{ color: RUST, borderColor: RUST }}
        >
          Take the flavor quiz <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}
