import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';

// Cupping evidence brief 6, E3 (2026-10-21): the evidence parameters, editable.
// One row per key (GET /api/admin/evidence/parameters): its note, current and
// previous value, an input and Save (PUT /api/admin/evidence/parameters/:key →
// evidenceParameterService.setParameter: a new row superseding the current
// one). The sane range lives in each key's note; a key without one is shown
// read-only. Lives on the Configuration page: System Health is read-only by
// policy (OBSERVABILITY_POLICY.md). The card reloads after a save, so the
// previous value stays visible and the next Dimensions tab open is re-weighted.

interface Parameter {
  key: string; value: number; since: string; note: string | null;
  previous_value: number | null; previous_since: string | null;
}

const RANGE = /Range:\s*[^.|]*/;
const describe = (note: string | null) => (note ?? '').replace(/ \| changed .*$/s, '');

export default function EvidenceParametersCard() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Parameter[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ key: string; text: string; ok: boolean } | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/admin/evidence/parameters', { headers: { Authorization: `Bearer ${await user!.getIdToken()}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Parameter[] = await res.json();
      setRows(data);
      setDrafts(Object.fromEntries(data.map(p => [p.key, String(p.value)])));
    } catch (err) {
      reportError('[EvidenceParametersCard/load]', err);
      setMessage({ key: '', text: 'Failed to load the evidence parameters', ok: false });
    }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(key: string) {
    setBusy(key);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/evidence/parameters/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user!.getIdToken()}` },
        body: JSON.stringify({ value: drafts[key], note: 'admin Configuration page' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMessage({ key, text: body.unchanged ? 'Unchanged.' : `Saved: ${body.previousValue} → ${body.value}.`, ok: true });
      await load();
    } catch (err) {
      setMessage({ key, text: err instanceof Error ? err.message : 'Save failed', ok: false });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-10" data-testid="evidence-parameters">
      <h2 className="text-sm font-medium text-stone-800 mb-1">Evidence parameters</h2>
      <p className="text-sm text-stone-500 mb-3">Cupping evidence thresholds and weights. A save writes a new row that supersedes the current one; nothing is overwritten.</p>
      <div className="border border-stone-200 rounded-lg bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-stone-400">
              <th className="px-3 py-2 font-normal">Key</th>
              <th className="px-3 py-2 font-normal">Current</th>
              <th className="px-3 py-2 font-normal">Previous</th>
              <th className="px-3 py-2 font-normal">New value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => {
              const range = RANGE.exec(p.note ?? '')?.[0] ?? null;
              const desc = describe(p.note).replace(/\s*Range:[^|]*$/, '').trim();
              return (
                <tr key={p.key} className="border-t border-stone-100 align-top">
                  <td className="px-3 py-2 min-w-[16rem]">
                    <div className="text-stone-800 font-mono text-xs">{p.key}</div>
                    <div className="text-xs text-stone-500 mt-0.5">{desc}</div>
                    <div className="text-xs text-stone-400 mt-0.5">{range ?? 'no range declared: read-only'}</div>
                  </td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                    {p.value}
                    <div className="text-xs text-stone-400">since {String(p.since).slice(0, 10)}</div>
                  </td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap text-stone-500">
                    {p.previous_value ?? '—'}
                    {p.previous_since && <div className="text-xs text-stone-400">from {String(p.previous_since).slice(0, 10)}</div>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {range ? (
                      <div className="flex items-center gap-2">
                        <input value={drafts[p.key] ?? ''} onChange={e => setDrafts(d => ({ ...d, [p.key]: e.target.value }))}
                          inputMode="decimal" aria-label={`New value for ${p.key}`}
                          className="w-24 border border-stone-300 rounded px-2 py-1 text-sm tabular-nums" />
                        <button onClick={() => save(p.key)} disabled={busy !== null || drafts[p.key] === String(p.value)}
                          className="px-3 py-1 text-sm border border-stone-300 rounded text-stone-700 hover:bg-stone-50 disabled:opacity-40">
                          {busy === p.key ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    ) : <span className="text-xs text-stone-400">—</span>}
                    {message && message.key === p.key && (
                      <div className={`text-xs mt-1 ${message.ok ? 'text-stone-500' : 'text-red-600'}`}>{message.text}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {message && message.key === '' && <p className="text-xs text-red-600 mt-1">{message.text}</p>}
      <p className="text-xs text-stone-500 mt-2">A change applies to every coffee at once: the pooled ranges, the session flags and the customer voice are views over these rows, re-read on the next page open.</p>
    </section>
  );
}
