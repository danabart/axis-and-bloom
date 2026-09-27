import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';

// Customer Blueprint · brief C3, Part E (D20) — the three Liam numbers, read
// from GET /api/admin/liam/outcomes. Cloned from AdminCustomerIntegrity.tsx's
// shape (same fetch pattern, same card style). Honest empty state: no number
// is invented — a null rate renders as "no data yet", never a fake 0%.

interface LiamOutcomes {
  windowDays: number;
  recommendations: { total: number; followedWithinWindow: number; followedRate: number | null };
  feedbackRating: { recommendedMean: number | null; recommendedCount: number; selfChosenMean: number | null; selfChosenCount: number };
  threads: { totalAsked: number; totalAnswered: number; answeredRate: number | null };
}

const LABEL = 'text-xs text-stone-400 tracking-widest uppercase mb-1';
const CARD = 'border rounded-lg p-4 bg-white border-stone-200';

function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 1000) / 10}%`;
}

function formatMean(mean: number | null): string {
  return mean === null ? '—' : mean.toFixed(2);
}

export default function AdminLiamOutcomes() {
  const { user } = useAuth();
  const [data, setData] = useState<LiamOutcomes | null>(null);
  const [days, setDays] = useState<7 | 14 | 30>(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(windowDays: 7 | 14 | 30) {
    setLoading(true);
    setError('');
    try {
      const token = await user!.getIdToken();
      const res = await fetch(`/api/admin/liam/outcomes?days=${windowDays}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error();
      setData((await res.json()) as LiamOutcomes);
    } catch (err) {
      reportError('[AdminLiamOutcomes/load]', err);
      setError('Failed to load Liam outcomes');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(days); }, [days]);

  const hasRecommendations = !!data && data.recommendations.total > 0;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <p className={LABEL}>Liam Outcomes</p>
        <div className="flex items-center gap-3">
          <div className="flex text-xs border border-stone-200 rounded overflow-hidden">
            {([7, 14, 30] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-2 py-1 ${days === d ? 'bg-stone-700 text-white' : 'text-stone-500 hover:bg-stone-50'}`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button onClick={() => load(days)} disabled={loading} className="text-xs text-stone-400 hover:text-stone-600 disabled:opacity-50">
            {loading ? 'Loading…' : 'Re-run'}
          </button>
        </div>
      </div>
      <div className={CARD}>
        {loading && !data ? (
          <p className="text-sm text-stone-400">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-500">{error}</p>
        ) : !hasRecommendations ? (
          <p className="text-sm text-stone-400">No recommendations recorded yet (L3)</p>
        ) : data ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-2xl font-normal text-stone-800">{formatRate(data.recommendations.followedRate)}</p>
              <p className="text-xs text-stone-400 mt-1">
                Recommendations followed within {data.windowDays}d ({data.recommendations.followedWithinWindow} of {data.recommendations.total})
              </p>
            </div>
            <div>
              <p className="text-2xl font-normal text-stone-800">
                {formatMean(data.feedbackRating.recommendedMean)} <span className="text-sm text-stone-400">vs</span> {formatMean(data.feedbackRating.selfChosenMean)}
              </p>
              <p className="text-xs text-stone-400 mt-1">
                Mean feedback rating — recommended ({data.feedbackRating.recommendedCount}) vs self-chosen ({data.feedbackRating.selfChosenCount})
              </p>
            </div>
            <div>
              <p className="text-2xl font-normal text-stone-800">{formatRate(data.threads.answeredRate)}</p>
              <p className="text-xs text-stone-400 mt-1">
                Palate questions answered ({data.threads.totalAnswered} of {data.threads.totalAsked})
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
