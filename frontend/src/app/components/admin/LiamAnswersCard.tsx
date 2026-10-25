import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';

// Liam brand answers brief Rev 3, A7 (2026-10-24): the brand facts Liam may
// state, one row per key (GET /api/admin/sommelier/answers). Edit = a new row
// that supersedes the current one (PUT /:key); the old one stays, visible
// under "history". Add a key (POST), retire one (DELETE /:key: no successor,
// nothing deleted). Every write goes through sommelierAnswerService, which
// refuses a roaster name, a price / size / count, or a coffee alias, naming
// the rule. The on/off switch and the rules Liam follows around these facts
// stay in "Brand Facts in Liam's Prompt" below (config/sommelier).

interface AnswerRow {
  id: number; key: string; kind: string; delivery: string; answer_text: string;
  sort_order: number; since: string; superseded_at: string | null; note: string | null; created_by: string;
}
interface Answer extends AnswerRow { history: AnswerRow[] }
interface Option { value: string; label: string }
interface Payload { answers: Answer[]; retired: string[]; kinds: Option[]; deliveries: Option[] }

interface Draft { answerText: string; kind: string; delivery: string; sortOrder: string; note: string }
const EMPTY_NEW = { key: '', answerText: '', kind: '', delivery: '', sortOrder: '', note: '' };

const day = (s: string | null) => (s ? String(s).slice(0, 10) : '');
const who = (uid: string) => (uid === 'seed' ? 'seed' : `admin ${uid.slice(0, 6)}…`);

export default function LiamAnswersCard() {
  const { user } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState(EMPTY_NEW);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ key: string; text: string; ok: boolean } | null>(null);

  async function call(path: string, init: RequestInit = {}) {
    const res = await fetch(`/api/admin/sommelier/answers${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user!.getIdToken()}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body;
  }

  async function load() {
    try {
      const body: Payload = await call('');
      setData(body);
      setDrafts(Object.fromEntries(body.answers.map(a => [a.key, {
        answerText: a.answer_text, kind: a.kind, delivery: a.delivery, sortOrder: String(a.sort_order), note: '',
      }])));
    } catch (err) {
      reportError('[LiamAnswersCard/load]', err);
      setMessage({ key: '', text: 'Failed to load the Liam answers', ok: false });
    }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      setMessage({ key, text: done, ok: true });
      await load();
    } catch (err) {
      setMessage({ key, text: err instanceof Error ? err.message : 'Save failed', ok: false });
    } finally {
      setBusy(null);
    }
  }

  const save = (a: Answer) => {
    const d = drafts[a.key];
    return run(a.key, () => call(`/${encodeURIComponent(a.key)}`, {
      method: 'PUT',
      body: JSON.stringify({ answerText: d.answerText, kind: d.kind, delivery: d.delivery, sortOrder: Number(d.sortOrder), note: d.note || null }),
    }), 'Saved. The previous text is kept under history.');
  };
  const retire = (a: Answer) => run(a.key, () => call(`/${encodeURIComponent(a.key)}`, {
    method: 'DELETE', body: JSON.stringify({ note: drafts[a.key]?.note || null }),
  }), 'Retired. Liam no longer has this fact.');
  const add = () => run('__new', () => call('', {
    method: 'POST',
    body: JSON.stringify({ ...newRow, sortOrder: newRow.sortOrder === '' ? undefined : Number(newRow.sortOrder), note: newRow.note || null }),
  }).then(() => { setNewRow(EMPTY_NEW); setAdding(false); }), 'Added.');

  const changed = (a: Answer) => {
    const d = drafts[a.key];
    return d && (d.answerText !== a.answer_text || d.kind !== a.kind || d.delivery !== a.delivery || d.sortOrder !== String(a.sort_order));
  };
  const select = (value: string, options: Option[], onChange: (v: string) => void, label: string) => (
    <select value={value} onChange={e => onChange(e.target.value)} aria-label={label}
      className="border border-stone-300 rounded px-2 py-1 text-xs bg-white">
      <option value="" disabled>{label}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  return (
    <section className="mb-10" data-testid="liam-answers">
      <h2 className="text-sm font-medium text-stone-800 mb-1">Liam answers</h2>
      <p className="text-sm text-stone-500 mb-3">
        The brand facts Liam may state. A save writes a new row that supersedes the current one; the old text stays under history.
        Never a roaster name, a price, a size or count, or a coffee name: those are refused.
      </p>
      {!data && !message && <p className="text-xs text-stone-400">Loading…</p>}
      {data && (
        <div className="border border-stone-200 rounded-lg bg-white divide-y divide-stone-100">
          {data.answers.map(a => {
            const d = drafts[a.key];
            if (!d) return null;
            const set = (patch: Partial<Draft>) => setDrafts(prev => ({ ...prev, [a.key]: { ...prev[a.key], ...patch } }));
            return (
              <div key={a.key} className="p-3">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="font-mono text-xs text-stone-800">{a.key}</span>
                  {select(d.kind, data.kinds, v => set({ kind: v }), 'Kind')}
                  {select(d.delivery, data.deliveries, v => set({ delivery: v }), 'Delivery')}
                  <label className="text-xs text-stone-500 flex items-center gap-1">
                    order
                    <input value={d.sortOrder} onChange={e => set({ sortOrder: e.target.value })} inputMode="numeric"
                      className="w-12 border border-stone-300 rounded px-1 py-0.5 text-xs tabular-nums" />
                  </label>
                  <span className="text-xs text-stone-400 ml-auto">since {day(a.since)} · {who(a.created_by)}</span>
                </div>
                <textarea rows={2} value={d.answerText} onChange={e => set({ answerText: e.target.value })}
                  aria-label={`Answer text for ${a.key}`}
                  className="w-full border border-stone-200 rounded px-3 py-1.5 text-sm" />
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <input value={d.note} onChange={e => set({ note: e.target.value })} placeholder="Why (optional, kept with the row)"
                    className="flex-1 min-w-[12rem] border border-stone-200 rounded px-2 py-1 text-xs" />
                  <button onClick={() => save(a)} disabled={busy !== null || !changed(a)}
                    className="px-3 py-1 text-sm border border-stone-300 rounded text-stone-700 hover:bg-stone-50 disabled:opacity-40">
                    {busy === a.key ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => retire(a)} disabled={busy !== null}
                    className="px-3 py-1 text-xs text-stone-400 hover:text-stone-700 disabled:opacity-40">
                    Retire
                  </button>
                  {a.history.length > 0 && (
                    <button onClick={() => setOpenHistory(openHistory === a.key ? null : a.key)}
                      className="text-xs text-stone-500 border-b border-stone-300">
                      history ({a.history.length})
                    </button>
                  )}
                </div>
                {message && message.key === a.key && (
                  <p className={`text-xs mt-1 ${message.ok ? 'text-stone-500' : 'text-red-600'}`}>{message.text}</p>
                )}
                {openHistory === a.key && (
                  <ul className="mt-2 space-y-1">
                    {a.history.map(h => (
                      <li key={h.id} className="text-xs text-stone-500">
                        <span className="text-stone-400">{day(h.since)} to {day(h.superseded_at)} · {who(h.created_by)}{h.note ? ` · ${h.note}` : ''}:</span> {h.answer_text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          <div className="p-3">
            {!adding ? (
              <button onClick={() => setAdding(true)} className="text-xs text-stone-600 border-b border-stone-300">Add an answer</button>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input value={newRow.key} onChange={e => setNewRow(r => ({ ...r, key: e.target.value }))} placeholder="key_in_snake_case"
                    className="border border-stone-300 rounded px-2 py-1 text-xs font-mono" />
                  {select(newRow.kind, data.kinds, v => setNewRow(r => ({ ...r, kind: v })), 'Kind')}
                  {select(newRow.delivery, data.deliveries, v => setNewRow(r => ({ ...r, delivery: v })), 'Delivery')}
                  <input value={newRow.sortOrder} onChange={e => setNewRow(r => ({ ...r, sortOrder: e.target.value }))} placeholder="order"
                    inputMode="numeric" className="w-16 border border-stone-300 rounded px-2 py-1 text-xs" />
                </div>
                <textarea rows={2} value={newRow.answerText} onChange={e => setNewRow(r => ({ ...r, answerText: e.target.value }))}
                  placeholder="The answer, as Liam should say it" className="w-full border border-stone-200 rounded px-3 py-1.5 text-sm" />
                <div className="flex items-center gap-2">
                  <input value={newRow.note} onChange={e => setNewRow(r => ({ ...r, note: e.target.value }))} placeholder="Why (optional)"
                    className="flex-1 border border-stone-200 rounded px-2 py-1 text-xs" />
                  <button onClick={add} disabled={busy !== null}
                    className="px-3 py-1 text-sm border border-stone-300 rounded text-stone-700 hover:bg-stone-50 disabled:opacity-40">
                    {busy === '__new' ? 'Adding…' : 'Add'}
                  </button>
                  <button onClick={() => { setAdding(false); setNewRow(EMPTY_NEW); }} className="text-xs text-stone-400">Cancel</button>
                </div>
                {message && message.key === '__new' && (
                  <p className={`text-xs ${message.ok ? 'text-stone-500' : 'text-red-600'}`}>{message.text}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {data && data.retired.length > 0 && (
        <p className="text-xs text-stone-400 mt-2">Retired keys (no current answer): {data.retired.join(', ')}</p>
      )}
      {message && message.key === '' && <p className="text-xs text-red-600 mt-1">{message.text}</p>}
    </section>
  );
}
