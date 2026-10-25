import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';

// Liam answer layer (2026-10-25), Part D: the gate's rules, read-only
// (GET /api/admin/sommelier/gate-rules). Each rule's keywords pick a
// candidate message, a Haiku call confirms it, and the resolver answers from
// one row; the examples are the rule's tests, run on every write. Editing
// rules here is a later brief; until then they change through the seed or
// `npm run gate:rules:apply`. The kill switch (gate.enabled) is in "Liam Gate"
// further down this page.

interface RuleStats { hits7d: number; hits30d: number; misses7d: number; replayAgreed: number; replayTotal: number }
interface Rule {
  key: string; priority: number; resolver: string; answerKey: string | null; topicKey: string | null;
  keywords: string[]; maxMessageChars: number | null; since: string; note: string | null; createdBy: string;
  examples: Array<{ message: string; expectation: string; expectedLabel: string | null }>;
  stats: RuleStats | null;
}
interface Payload { enabled: boolean; offlineEnabled: boolean; rules: Rule[] }

export default function LiamGateRulesCard() {
  const { user } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/sommelier/gate-rules', { headers: { Authorization: `Bearer ${await user?.getIdToken()}` } });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load the gate rules');
        const json = (await res.json()) as Payload;
        if (!cancelled) setData(json);
      } catch (err) {
        reportError('[LiamGateRulesCard/load]', err);
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the gate rules');
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  return (
    <section className="mb-8">
      <h2 className="text-sm font-normal tracking-widest uppercase text-stone-400 mb-4">Liam Gate Rules</h2>
      <div className="border border-stone-200 rounded-lg p-4">
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!data && !error && <p className="text-sm text-stone-400">Loading…</p>}
        {data && (
          <>
            <p className="text-xs text-stone-400 mb-4">
              The gate is <span className="text-stone-700">{data.enabled ? 'on' : 'off'}</span>; the nightly labeller is{' '}
              <span className="text-stone-700">{data.offlineEnabled ? 'on' : 'off'}</span>. Read-only: rules change through the seed or{' '}
              <code>npm run gate:rules:apply</code>, and every write runs these examples as tests. Lower priority wins.
            </p>
            {data.rules.length === 0 && <p className="text-sm text-stone-400">No active rules.</p>}
            <ul className="divide-y divide-stone-100">
              {data.rules.map(r => (
                <li key={r.key} className="py-3">
                  <button className="w-full text-left" onClick={() => setOpen(open === r.key ? null : r.key)}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm text-stone-800">
                        {r.priority} · {r.key}
                        <span className="text-stone-400"> → {r.resolver}{r.answerKey ? ` (${r.answerKey})` : ''}</span>
                      </span>
                      {r.stats && (
                        <span className="text-xs text-stone-400">
                          hits {r.stats.hits7d} (7 d), {r.stats.hits30d} (30 d) · misses {r.stats.misses7d} · replay{' '}
                          {r.stats.replayTotal ? `${r.stats.replayAgreed}/${r.stats.replayTotal}` : '—'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-stone-500 mt-1">{r.keywords.join(', ')}</p>
                  </button>
                  {open === r.key && (
                    <div className="mt-2 text-xs text-stone-600">
                      <p className="text-stone-400 mb-1">
                        Topic {r.topicKey ?? '—'} · max {r.maxMessageChars ?? 'config'} characters · since {String(r.since).slice(0, 10)} by {r.createdBy}
                        {r.note ? ` · ${r.note}` : ''}
                      </p>
                      <ul className="space-y-0.5">
                        {r.examples.map((e, i) => (
                          <li key={i}>
                            <span className={e.expectation === 'must_match' ? 'text-stone-700' : 'text-stone-400'}>
                              {e.expectation === 'must_match' ? 'answers' : 'leaves to Liam'}
                            </span>{' '}
                            “{e.message}” <span className="text-stone-400">→ {e.expectedLabel ?? 'judgment'}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
