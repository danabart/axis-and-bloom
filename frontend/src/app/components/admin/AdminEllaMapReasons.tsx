// Ella's Bloom Map 9 (2026-11-20), C2 — two panels of /admin/map:
//  * "What we say back": every current quiz answer, feeling and kitchen brand
//    with its phrase (empty = never quoted), edited in place (PUT /said-back,
//    dialPlacementService.setSaidBack), and a "never quote" switch per row
//    (is_quoted: the phrase is kept, never quoted on purpose). A change shows
//    on the next read of /map.
//  * "Read it as": search a customer by email and see their /map text as built
//    now, with the rows each text used (GET /reasons, matchService.steps; read
//    only). A customer with no decision is read from their start rule.
//  * Ella map 10: each said-back row carries the direction it argues for
//    (picker; the options are the customer moves from the API), and "How a
//    card is chosen" lists the ordered, switchable choices (dial_reason_choice;
//    GET/PUT /reason-choices, dialPlacementService.setReasonChoice).
// The page types in only chrome (headings, button verbs); every customer word
// comes from the API (G4.2).
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_9_PERSONAL_REASONS.md
import { useEffect, useState } from 'react';
import type { ApiFetch } from '../../lib/catalogWrites';
import { getSaidBack, setSaidBack, searchMapCustomers, getReasons, getReasonChoices, setReasonChoice,
  type SaidBackFact, type MapCustomerHit, type ReasonChoice } from '../../lib/mapAdmin';
import type { MapSteps } from '../../lib/mapCustomer';

const CARD = 'border border-stone-200 rounded-xl bg-white';
const INPUT = 'w-full border border-stone-300 rounded px-2 py-1 text-sm';
const BTN_PRIMARY = 'px-3 py-1.5 rounded text-sm bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50';
const LINK = 'text-sm text-[#b5523b] hover:underline';

export function SaidBackTable({ apiFetch, moves }: { apiFetch: ApiFetch; moves: Array<{ code: string; label: string; is_customer_move: boolean }> }) {
  const [rows, setRows] = useState<SaidBackFact[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState('');
  const [showBrands, setShowBrands] = useState(false);
  const load = async () => { try { setRows(await getSaidBack(apiFetch)); } catch (err) { setMsg(err instanceof Error ? err.message : 'Failed to load'); } };
  useEffect(() => { void load(); }, [apiFetch]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = (r: SaidBackFact) => `${r.source_code}:${r.fact_code}`;
  async function save(r: SaidBackFact) {
    setMsg('');
    try {
      const res = await setSaidBack(apiFetch, { source: r.source_code, fact: r.fact_code, saysBack: draft.trim() || null });
      setMsg(res.unchanged ? 'Unchanged.' : 'Saved. It shows on the next read of the page.');
      setEditing(null);
      await load();
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Save failed'); }
  }
  async function setNeverQuote(r: SaidBackFact, never: boolean) {
    setMsg('');
    try {
      const res = await setSaidBack(apiFetch, { source: r.source_code, fact: r.fact_code, saysBack: r.says_back, isQuoted: !never });
      setMsg(res.unchanged ? 'Unchanged.' : never ? 'Saved. It is never quoted now.' : 'Saved. It is quoted again on the next read of the page.');
      await load();
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Save failed'); }
  }
  async function setDirection(r: SaidBackFact, move: string) {
    setMsg('');
    try {
      const res = await setSaidBack(apiFetch, { source: r.source_code, fact: r.fact_code, saysBack: r.says_back, move: move || null });
      setMsg(res.unchanged ? 'Unchanged.' : 'Saved. It shows on the next read of the page.');
      await load();
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Save failed'); }
  }
  const directions = moves.filter(m => m.is_customer_move);
  const visible = rows.filter(r => showBrands || r.source_code !== 'cupboard_coffee');
  let lastGroup = '';
  return (
    <section className={`${CARD} p-4`} data-testid="said-back-table">
      <h2 className="text-sm font-medium text-stone-800">3. What we say back</h2>
      <p className="text-xs text-stone-500 mt-1">Each phrase completes the sentence the customer reads (“You told us …”, “You asked for …”, “You have … in your kitchen.”). Empty means never quoted. “Never quote” keeps the phrase and leaves it off the page.</p>
      <label className="text-xs text-stone-600 flex items-center gap-1 mt-2">
        <input type="checkbox" checked={showBrands} onChange={e => setShowBrands(e.target.checked)} data-testid="said-back-show-brands" /> Show kitchen brands
      </label>
      <table className="w-full text-sm mt-2">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
            <th className="py-1 font-normal">Answer</th><th className="py-1 font-normal">We say back</th><th className="py-1 font-normal">Argues for</th><th className="py-1 font-normal">Never quote</th><th />
          </tr>
        </thead>
        <tbody>
          {visible.map(r => {
            const group = `${r.source_code}:${r.context_group ?? ''}:${r.q_number ?? ''}`;
            const head = group !== lastGroup;
            lastGroup = group;
            const isEditing = editing === key(r);
            return (
              <tr key={key(r)} className={`${head ? 'border-t border-stone-200' : ''} align-top`} data-testid="said-back-row" data-fact={r.fact_code}>
                <td className="py-1.5 pr-2">
                  {head && r.context && <p className="text-xs text-stone-500">{r.context}</p>}
                  <span className={r.is_quotable ? '' : 'text-stone-400'}>{r.fact_label}</span>
                </td>
                <td className="py-1.5 pr-2 text-stone-700">
                  {isEditing
                    ? <input className={INPUT} value={draft} onChange={e => setDraft(e.target.value)} data-testid="said-back-edit" />
                    : <span data-testid="said-back-phrase" className={r.is_quoted === false ? 'text-stone-400 line-through' : ''}>{r.says_back ?? '–'}</span>}
                </td>
                <td className="py-1.5 pr-2">
                  {r.source_code !== 'cupboard_coffee' && (
                    <select className="border border-stone-300 rounded px-1 py-0.5 text-xs" value={r.move_code ?? ''} disabled={!r.says_back}
                      onChange={e => void setDirection(r, e.target.value)} data-testid="said-back-direction">
                      <option value="">None</option>
                      {directions.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
                    </select>
                  )}
                </td>
                <td className="py-1.5 pr-2">
                  <input type="checkbox" aria-label="Never quote" data-testid="said-back-never-quote"
                    disabled={!r.says_back} checked={r.is_quoted === false} onChange={e => void setNeverQuote(r, e.target.checked)} />
                </td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  {isEditing
                    ? <span className="flex flex-col gap-1 items-end">
                        <button className={BTN_PRIMARY} onClick={() => save(r)} data-testid="said-back-save">Save</button>
                        <button className={LINK} onClick={() => setEditing(null)}>Cancel</button>
                      </span>
                    : <button className={LINK} onClick={() => { setEditing(key(r)); setDraft(r.says_back ?? ''); }} data-testid="said-back-change">Change</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {msg && <p className="text-xs text-stone-700 mt-2" data-testid="said-back-msg">{msg}</p>}
    </section>
  );
}

export function ReadItAs({ apiFetch }: { apiFetch: ApiFetch }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<MapCustomerHit[]>([]);
  const [picked, setPicked] = useState<MapCustomerHit | null>(null);
  const [page, setPage] = useState<MapSteps | null>(null);
  const [msg, setMsg] = useState('');
  async function search() {
    setMsg('');
    try { setHits(await searchMapCustomers(apiFetch, q.trim())); } catch (err) { setMsg(err instanceof Error ? err.message : 'Search failed'); }
  }
  async function read(h: MapCustomerHit) {
    setMsg(''); setPicked(h);
    try { setPage(await getReasons(apiFetch, h.profile_id)); } catch (err) { setMsg(err instanceof Error ? err.message : 'Read failed'); }
  }
  const basisLine = (b?: { ruleId?: number | null; stepId?: number; copyCodes: string[]; factCodes: string[]; choice?: string | null }) =>
    b ? [b.choice ? `chosen by ${b.choice}` : null, b.ruleId ? `rule ${b.ruleId}` : null, b.stepId ? `step ${b.stepId}` : null, b.copyCodes.length ? `copy ${b.copyCodes.join(', ')}` : null,
         b.factCodes.length ? `facts ${b.factCodes.join(', ')}` : null].filter(Boolean).join(' · ') : '';
  return (
    <section className={`${CARD} p-4`} data-testid="read-it-as">
      <h2 className="text-sm font-medium text-stone-800">4. Read it as</h2>
      <p className="text-xs text-stone-500 mt-1">A customer's page text as it reads now, with the rows each line used. Nothing is written.</p>
      <div className="flex gap-2 mt-2">
        <input className={INPUT} value={q} onChange={e => setQ(e.target.value)} placeholder="Email contains…" data-testid="read-it-as-q"
          onKeyDown={e => { if (e.key === 'Enter' && q.trim().length >= 3) void search(); }} />
        <button className={BTN_PRIMARY} disabled={q.trim().length < 3} onClick={search} data-testid="read-it-as-search">Search</button>
      </div>
      {hits.length > 0 && (
        <ul className="text-sm mt-2 space-y-1" data-testid="read-it-as-hits">
          {hits.map(h => (
            <li key={h.profile_id}>
              <button className={LINK} onClick={() => read(h)} data-testid="read-it-as-hit">{h.email}</button>
              <span className="text-xs text-stone-500"> {h.has_quiz ? 'quiz' : 'no quiz'} · {h.has_position ? 'on the map' : 'no position'}</span>
            </li>
          ))}
        </ul>
      )}
      {picked && page && (
        <div className="mt-3 border-t border-stone-200 pt-3 text-sm" data-testid="read-it-as-page">
          <p className="text-xs text-stone-500">{picked.email}{page.readAs ? ' · no decision yet: read from the start rule' : ''}</p>
          {!page.position && <p className="text-stone-600 mt-1">No position and no quiz to read: the page is empty for this customer.</p>}
          {page.position && (
            <>
              <p className="mt-1 font-medium">{page.position.name}{page.firstBag?.labelCode ? ` · ${page.copy[page.firstBag.labelCode] ?? page.firstBag.labelCode}` : ''}</p>
              {page.firstBag && <p className="text-stone-700" data-testid="read-it-as-first">{page.firstBag.text ?? page.firstBag.reason}</p>}
              {page.firstBag?.basis && <p className="text-xs text-stone-400">{basisLine(page.firstBag.basis)}</p>}
              <ul className="mt-2 space-y-2">
                {page.steps.map(s => (
                  <li key={s.stepId} data-testid="read-it-as-step" data-lead={s.isLead ? '1' : '0'}>
                    <p className="text-xs text-stone-500">{s.isLead ? page.copy.lead_title : page.copy.others_title}</p>
                    <p><strong>{s.name}</strong>: {s.text}</p>
                    {s.basis && <p className="text-xs text-stone-400">{basisLine(s.basis)}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {msg && <p className="text-xs text-stone-700 mt-2">{msg}</p>}
    </section>
  );
}

/**
 * Ella map 10 (C2): "How a card is chosen": the ordered, switchable choices per
 * kind, as rows (dial_reason_choice). Up and down swap two rows' order; the
 * switch turns a choice on or off. Each change supersedes and inserts; the
 * next read of /map and "Read it as" follow it.
 */
export function ReasonChoicesCard({ apiFetch }: { apiFetch: ApiFetch }) {
  const [rows, setRows] = useState<ReasonChoice[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => { try { setRows(await getReasonChoices(apiFetch)); } catch (err) { setMsg(err instanceof Error ? err.message : 'Failed to load'); } };
  useEffect(() => { void load(); }, [apiFetch]); // eslint-disable-line react-hooks/exhaustive-deps
  const kinds = [...new Map(rows.map(r => [r.kind_code, { code: r.kind_code, label: r.kind_label, order: r.kind_order }])).values()]
    .sort((a, b) => a.order - b.order);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setMsg('');
    try { await fn(); setMsg('Saved. It applies on the next read of the page.'); await load(); }
    catch (err) { setMsg(err instanceof Error ? err.message : 'Save failed'); }
    finally { setBusy(false); }
  }
  const swap = (a: ReasonChoice, b: ReasonChoice) => run(async () => {
    await setReasonChoice(apiFetch, { kind: a.kind_code, code: a.code, sortOrder: b.sort_order });
    await setReasonChoice(apiFetch, { kind: b.kind_code, code: b.code, sortOrder: a.sort_order });
  });
  return (
    <section className={`${CARD} p-4`} data-testid="reason-choices">
      <h2 className="text-sm font-medium text-stone-800">5. How a card is chosen</h2>
      <p className="text-xs text-stone-500 mt-1">Each list is tried from the top; a choice switched off is skipped.</p>
      {kinds.map(k => {
        const list = rows.filter(r => r.kind_code === k.code).sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
        return (
          <div key={k.code} className="mt-3" data-testid="reason-kind" data-kind={k.code}>
            <p className="text-xs uppercase tracking-wide text-stone-500">{k.label}</p>
            <ol className="mt-1 space-y-1">
              {list.map((r, i) => (
                <li key={r.code} className="flex items-center gap-2 text-sm" data-testid="reason-choice" data-code={r.code} data-active={r.is_active ? '1' : '0'}>
                  <span className="w-5 text-stone-400">{i + 1}.</span>
                  <span className={`flex-1 ${r.is_active ? 'text-stone-800' : 'text-stone-400 line-through'}`}>{r.label}</span>
                  <button className={LINK} disabled={busy || i === 0} onClick={() => swap(r, list[i - 1])} data-testid="reason-up">Up</button>
                  <button className={LINK} disabled={busy || i === list.length - 1} onClick={() => swap(r, list[i + 1])} data-testid="reason-down">Down</button>
                  <label className="text-xs flex items-center gap-1">
                    <input type="checkbox" checked={r.is_active} disabled={busy}
                      onChange={e => run(() => setReasonChoice(apiFetch, { kind: r.kind_code, code: r.code, isActive: e.target.checked }))} data-testid="reason-on" /> On
                  </label>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
      {rows.length === 0 && <p className="text-xs text-stone-500 mt-2">No choices yet.</p>}
      {msg && <p className="text-xs text-stone-700 mt-2" data-testid="reason-msg">{msg}</p>}
    </section>
  );
}
