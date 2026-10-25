import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';

// Liam answer evals (2026-10-25), Part E: the eval set (GET /api/admin/
// sommelier/evals). A case is one question asked by an invented fixture
// customer; its phrasings are the ways it is asked; its checks are what a
// right answer must and must not contain. Global checks (no case) also run on
// every production reply and show as flags on System Health. Every edit goes
// through sommelierEvalService: a change is a new row, a removal sets
// superseded_at, nothing is deleted. "Run evals now" runs the whole set once
// (it spends money: Sonnet per phrasing, Haiku for the gate and the judge).
// Labelled Sonnet turns are offered as phrasings, never added on their own.

interface Phrasing { id: number; message: string; source: string; note: string | null }
interface Check { id: number; case_id: number | null; kind: string; value: string | null; flag_code: string | null; note: string | null }
interface Case {
  id: number; key: string; kind: string; fixture_key: string; catalog_alias: string | null; turn_context: string | null;
  rule_key: string | null; note: string | null; phrasings: Phrasing[]; checks: Check[];
}
interface Run { id: number; trigger: string; model: string; finished_at: string; phrasings: number; passed: number; failed: number; usd_micros: string; note: string | null }
interface Failure { case_key: string; message: string; route: string; reply: string; judge_notes: string | null }
interface Candidate { turnId: number; caseKey: string; label: string; at: string; message: string }
interface Option { value: string; label: string }
interface Payload {
  cases: Case[]; globalChecks: Check[]; lastRun: Run | null; recentRuns: Run[]; lastRunFailures: Failure[];
  candidates: Candidate[]; fixtures: string[]; vocab: { checkKinds: Option[]; caseKinds: Option[]; flags: Option[] };
}

const NO_VALUE = new Set(['must_name_catalog_coffee', 'must_not_name_roaster', 'price_in_catalog_only']);
const passRate = (r: { passed: number; phrasings: number }) => (r.phrasings ? `${Math.round((r.passed / r.phrasings) * 100)}%` : '—');
const dollars = (micros: string | number) => `$${(Number(micros) / 1_000_000).toFixed(4)}`;
const EMPTY_CASE = { key: '', kind: 'brand', fixtureKey: '', coffeeAlias: '', turnContext: '', ruleKey: '' };

function useAdminFetch() {
  const { user } = useAuth();
  return async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`/api/admin/sommelier/evals${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user!.getIdToken()}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body;
  };
}

/** "Last eval run: date, pass rate" for the config page, next to the prompt fields (C4). */
export function LastEvalRunLine() {
  const call = useAdminFetch();
  const [run, setRun] = useState<Run | null | undefined>(undefined);
  useEffect(() => {
    call('/last').then((b: { lastRun: Run | null }) => setRun(b.lastRun)).catch(err => { reportError('[LastEvalRunLine]', err); setRun(null); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (run === undefined) return null;
  return (
    <p className="text-xs text-stone-400">
      {run
        ? `Last eval run: ${new Date(run.finished_at).toLocaleString()}, ${passRate(run)} passed (${run.passed}/${run.phrasings}). After a prompt edit, run the evals from the Liam evals card.`
        : 'No eval run yet. After a prompt edit, run the evals from the Liam evals card.'}
    </p>
  );
}

export default function LiamEvalsCard() {
  const call = useAdminFetch();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [newPhrasing, setNewPhrasing] = useState<Record<string, string>>({});
  const [newCheck, setNewCheck] = useState<Record<string, { kind: string; value: string; flagCode: string }>>({});
  const [newCase, setNewCase] = useState(EMPTY_CASE);
  const [edits, setEdits] = useState<Record<string, typeof EMPTY_CASE>>({});
  const [candidateCase, setCandidateCase] = useState<Record<number, string>>({});
  const [runResult, setRunResult] = useState<{ phrasings: number; passed: number; failed: number; usdMicros: number; note: string | null; failures: Failure[] } | null>(null);

  async function load() {
    try {
      setData(await call(''));
      setError('');
    } catch (err) {
      reportError('[LiamEvalsCard/load]', err);
      setError(err instanceof Error ? err.message : 'Failed to load the Liam evals');
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  async function act(label: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(label);
    setMessage(null);
    try {
      await fn();
      setMessage({ text: ok, ok: true });
      await load();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Failed', ok: false });
    } finally {
      setBusy(null);
    }
  }

  const post = (path: string, body: unknown) => call(path, { method: 'POST', body: JSON.stringify(body) });
  const del = (path: string) => call(path, { method: 'DELETE' });
  const checkLabel = (c: Check) => `${c.kind}${c.value ? `: ${c.value}` : ''}${c.flag_code ? ` → ${c.flag_code}` : ''}`;

  function checkForm(scope: string, global: boolean) {
    const nc = newCheck[scope] ?? { kind: global ? 'must_not_claim' : 'judge', value: '', flagCode: 'banned_claim' };
    const set = (patch: Partial<typeof nc>) => setNewCheck({ ...newCheck, [scope]: { ...nc, ...patch } });
    return (
      <div className="flex flex-wrap gap-2 mt-2">
        <select className="border border-stone-200 rounded px-2 py-1 text-xs bg-white" value={nc.kind} onChange={e => set({ kind: e.target.value })}>
          {data!.vocab.checkKinds.filter(k => !global || k.value !== 'judge').map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        {!NO_VALUE.has(nc.kind) && (
          <input className="flex-1 min-w-48 border border-stone-200 rounded px-2 py-1 text-xs" placeholder={nc.kind === 'judge' ? 'A yes/no question; yes = pass' : 'value'}
            value={nc.value} onChange={e => set({ value: e.target.value })} />
        )}
        {global && (
          <select className="border border-stone-200 rounded px-2 py-1 text-xs bg-white" value={nc.flagCode} onChange={e => set({ flagCode: e.target.value })}>
            {data!.vocab.flags.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        )}
        <button className="text-xs border-b border-stone-400 text-stone-700" disabled={!!busy}
          onClick={() => act(`check:${scope}`, () => post('/checks', { caseKey: global ? null : scope, kind: nc.kind, value: nc.value || null, flagCode: global ? nc.flagCode : null }), 'Check added')}>
          Add check
        </button>
      </div>
    );
  }

  return (
    <section className="mb-8">
      <h2 className="text-sm font-normal tracking-widest uppercase text-stone-400 mb-4">Liam Evals</h2>
      <div className="border border-stone-200 rounded-lg p-4 space-y-4">
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!data && !error && <p className="text-sm text-stone-400">Loading…</p>}
        {data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-xs text-stone-500">
                {data.lastRun
                  ? `Last run ${new Date(data.lastRun.finished_at).toLocaleString()} (${data.lastRun.trigger}): ${passRate(data.lastRun)} passed, ${data.lastRun.passed}/${data.lastRun.phrasings}, ${dollars(data.lastRun.usd_micros)}.`
                  : 'No run yet.'}
                {' '}Trend: {data.recentRuns.slice().reverse().map(passRate).join(' · ') || '—'}
              </p>
              <button className="text-sm px-3 py-1.5 rounded bg-stone-800 text-white disabled:opacity-50" disabled={!!busy}
                onClick={() => act('run', async () => setRunResult(await post('/run', {})), 'Eval run finished')}>
                {busy === 'run' ? 'Running… (a minute or two)' : 'Run evals now'}
              </button>
            </div>
            {message && <p className="text-xs" style={{ color: message.ok ? undefined : '#b05642' }}>{message.text}</p>}
            {runResult && (
              <p className="text-xs text-stone-600">
                This run: {runResult.passed}/{runResult.phrasings} passed, {runResult.failed} failed, {dollars(runResult.usdMicros)}{runResult.note ? `; ${runResult.note}` : ''}.
              </p>
            )}

            {(runResult?.failures ?? data.lastRunFailures).length > 0 && (
              <div>
                <p className="text-xs text-stone-400 mb-1">Failures in the {runResult ? 'run just made' : 'last run'}</p>
                <ul className="space-y-2 text-xs text-stone-600">
                  {(runResult?.failures ?? data.lastRunFailures).map((f, i) => (
                    <li key={i}>
                      <span className="text-stone-800">{f.case_key}</span> ({f.route}) “{f.message}”
                      <p className="text-stone-400">{f.judge_notes ?? 'no note'}</p>
                      <p className="text-stone-400 italic">{f.reply.slice(0, 300)}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="text-xs text-stone-400 mb-1">Global checks (every eval reply and every production reply; a hit is a flag on the turn ledger)</p>
              <ul className="text-xs text-stone-700 space-y-1">
                {data.globalChecks.map(c => (
                  <li key={c.id} className="flex justify-between gap-4">
                    <span>{checkLabel(c)}</span>
                    <button className="text-stone-400 hover:text-stone-700" disabled={!!busy} onClick={() => act(`retire-check:${c.id}`, () => del(`/checks/${c.id}`), 'Check retired')}>retire</button>
                  </li>
                ))}
              </ul>
              {checkForm('__global__', true)}
            </div>

            <ul className="divide-y divide-stone-100">
              {data.cases.map(c => {
                const e = edits[c.key] ?? { key: c.key, kind: c.kind, fixtureKey: c.fixture_key, coffeeAlias: c.catalog_alias ?? '', turnContext: c.turn_context ?? '', ruleKey: c.rule_key ?? '' };
                const setE = (patch: Partial<typeof e>) => setEdits({ ...edits, [c.key]: { ...e, ...patch } });
                return (
                  <li key={c.key} className="py-3">
                    <button className="w-full text-left" onClick={() => setOpen(open === c.key ? null : c.key)}>
                      <span className="text-sm text-stone-800">{c.key}</span>
                      <span className="text-xs text-stone-400"> · {c.kind} · {c.fixture_key}{c.catalog_alias ? ` · ${c.catalog_alias}` : ''} · {c.phrasings.length} phrasing(s), {c.checks.length} check(s)</span>
                    </button>
                    {open === c.key && (
                      <div className="mt-2 space-y-3 text-xs">
                        {c.note && <p className="text-stone-400">{c.note}</p>}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <label>Fixture
                            <select className="ml-2 border border-stone-200 rounded px-2 py-1 bg-white" value={e.fixtureKey} onChange={ev => setE({ fixtureKey: ev.target.value })}>
                              {data.fixtures.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                          </label>
                          <label>Coffee alias <input className="ml-2 border border-stone-200 rounded px-2 py-1" value={e.coffeeAlias} onChange={ev => setE({ coffeeAlias: ev.target.value })} /></label>
                          <label>Gate rule <input className="ml-2 border border-stone-200 rounded px-2 py-1" value={e.ruleKey} onChange={ev => setE({ ruleKey: ev.target.value })} /></label>
                          <label className="md:col-span-2">Previous Liam turn
                            <textarea rows={2} className="mt-1 w-full border border-stone-200 rounded px-2 py-1" value={e.turnContext} onChange={ev => setE({ turnContext: ev.target.value })} />
                          </label>
                        </div>
                        <div className="flex gap-4">
                          <button className="border-b border-stone-400 text-stone-700" disabled={!!busy}
                            onClick={() => act(`edit:${c.key}`, () => post('/cases', { ...e, expect: 'edit' }), 'Case saved (a new row; phrasings and checks carried over)')}>Save case</button>
                          <button className="text-stone-400 hover:text-stone-700" disabled={!!busy}
                            onClick={() => act(`retire:${c.key}`, () => del(`/cases/${c.key}`), 'Case retired')}>Retire case</button>
                        </div>
                        <div>
                          <p className="text-stone-400 mb-1">Phrasings</p>
                          <ul className="space-y-1">
                            {c.phrasings.map(p => (
                              <li key={p.id} className="flex justify-between gap-4 text-stone-700">
                                <span>“{p.message}” <span className="text-stone-400">({p.source === 'customer_turn' ? 'from a customer' : p.note ?? 'hand'})</span></span>
                                <button className="text-stone-400 hover:text-stone-700" disabled={!!busy} onClick={() => act(`retire-p:${p.id}`, () => del(`/phrasings/${p.id}`), 'Phrasing retired')}>retire</button>
                              </li>
                            ))}
                          </ul>
                          <div className="flex gap-2 mt-2">
                            <input className="flex-1 border border-stone-200 rounded px-2 py-1" placeholder="Another way to ask it"
                              value={newPhrasing[c.key] ?? ''} onChange={ev => setNewPhrasing({ ...newPhrasing, [c.key]: ev.target.value })} />
                            <button className="border-b border-stone-400 text-stone-700" disabled={!!busy || !(newPhrasing[c.key] ?? '').trim()}
                              onClick={() => act(`phr:${c.key}`, async () => { await post(`/cases/${c.key}/phrasings`, { message: newPhrasing[c.key] }); setNewPhrasing({ ...newPhrasing, [c.key]: '' }); }, 'Phrasing added')}>
                              Add phrasing
                            </button>
                          </div>
                        </div>
                        <div>
                          <p className="text-stone-400 mb-1">Checks</p>
                          <ul className="space-y-1">
                            {c.checks.map(ch => (
                              <li key={ch.id} className="flex justify-between gap-4 text-stone-700">
                                <span>{checkLabel(ch)}</span>
                                <button className="text-stone-400 hover:text-stone-700" disabled={!!busy} onClick={() => act(`retire-check:${ch.id}`, () => del(`/checks/${ch.id}`), 'Check retired')}>retire</button>
                              </li>
                            ))}
                          </ul>
                          {checkForm(c.key, false)}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="text-xs">
              <p className="text-stone-400 mb-1">New case</p>
              <div className="flex flex-wrap gap-2">
                <input className="border border-stone-200 rounded px-2 py-1" placeholder="key (snake_case)" value={newCase.key} onChange={e => setNewCase({ ...newCase, key: e.target.value })} />
                <select className="border border-stone-200 rounded px-2 py-1 bg-white" value={newCase.kind} onChange={e => setNewCase({ ...newCase, kind: e.target.value })}>
                  {data.vocab.caseKinds.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
                <select className="border border-stone-200 rounded px-2 py-1 bg-white" value={newCase.fixtureKey} onChange={e => setNewCase({ ...newCase, fixtureKey: e.target.value })}>
                  <option value="">fixture…</option>
                  {data.fixtures.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <input className="border border-stone-200 rounded px-2 py-1" placeholder="coffee alias (optional)" value={newCase.coffeeAlias} onChange={e => setNewCase({ ...newCase, coffeeAlias: e.target.value })} />
                <button className="border-b border-stone-400 text-stone-700" disabled={!!busy || !newCase.key || !newCase.fixtureKey}
                  onClick={() => act('new-case', async () => { await post('/cases', { ...newCase, expect: 'new' }); setNewCase(EMPTY_CASE); }, 'Case added; add its phrasings and checks')}>
                  Add case
                </button>
              </div>
            </div>

            {data.candidates.length > 0 && (
              <div className="text-xs">
                <p className="text-stone-400 mb-1">Sonnet turns the nightly labeller marked as a gate question (a model's guess; add only the ones that fit)</p>
                <ul className="space-y-2">
                  {data.candidates.map(c => (
                    <li key={c.turnId} className="flex flex-wrap items-center justify-between gap-2 text-stone-700">
                      <span>“{c.message}” <span className="text-stone-400">({c.label})</span></span>
                      <span className="flex gap-2">
                        <select className="border border-stone-200 rounded px-2 py-1 bg-white" value={candidateCase[c.turnId] ?? c.caseKey}
                          onChange={e => setCandidateCase({ ...candidateCase, [c.turnId]: e.target.value })}>
                          {data.cases.map(x => <option key={x.key} value={x.key}>{x.key}</option>)}
                        </select>
                        <button className="border-b border-stone-400" disabled={!!busy}
                          onClick={() => act(`cand:${c.turnId}`, () => post(`/candidates/${c.turnId}`, { caseKey: candidateCase[c.turnId] ?? c.caseKey }), 'Added as a phrasing')}>
                          Add as phrasing
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
