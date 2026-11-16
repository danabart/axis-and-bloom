// Ella's Bloom Map 5 (2026-11-16), C2 — /admin/map, the decided map: one map
// and two tables (map5_mockup_admin.png). The map says what was decided,
// not what was calculated: family, lean and ring are decisions, steps are
// decided rows, dot size is the roaster's own Sweetness rating.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_5_DECIDED_MAP_AND_ADMIN.md
//
// Reads: GET /api/admin/map/decided (dialReads.decidedMap), /vocabulary,
// /wedges, /first-match, /ring/:id/history. Writes: PATCH /lean/:id
// (catalogService.setLean), PATCH /ring/:id (catalogService.setRing), PUT
// /steps (dialPlacementService.setStep), PUT /first-match, POST /publish
// (cut and activate in one call). The face shows the ACTIVE version; a
// decision reaches it only through Publish. The page types in only chrome
// (headings, button verbs): every family, lane, ring, size, basis and flag
// word comes from the API (G4.2). The old workbench is /admin/map/advanced.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import EllaMapFace from '../bloom/map/EllaMapFace';
import EllaMapLegend from '../bloom/map/EllaMapLegend';
import { setLean, type ApiFetch } from '../../lib/catalogWrites';
import {
  getDecidedMap, getVocabulary, getWedges, getFirstMatches, getRingHistory, setStep, setRing, publishMap, setFirstMatch,
  type DecidedMap, type DecisionNow, type StepRow, type Vocabulary, type Wedge, type Seam, type FirstMatch, type RingHistoryRow,
} from '../../lib/mapAdmin';

const CARD = 'border border-stone-200 rounded-xl bg-white';
const INPUT = 'w-full border border-stone-300 rounded px-2 py-1 text-sm';
const BTN = 'px-3 py-1.5 rounded text-sm border border-stone-300 hover:bg-stone-50 disabled:opacity-50';
const BTN_PRIMARY = 'px-3 py-1.5 rounded text-sm bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50';
const LINK = 'text-sm text-[#b5523b] hover:underline';
const CHIP: Record<string, string> = {
  solid: 'border-[#b5523b] text-[#b5523b]', dashed: 'border-stone-500 text-stone-600', dotted: 'border-sky-700 text-sky-800',
};

type Labels = {
  family: (c: string) => string;
  lane: (c: string | null | undefined, archetype: string) => string;
  ring: (c: number | null | undefined) => string;
  flag: (c: string) => string;
};

export default function AdminEllaMap() {
  const { user } = useAuth();
  const apiFetch: ApiFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const token = await user!.getIdToken();
    return fetch(url, {
      cache: 'no-store', ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) },
    });
  }, [user]);

  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [wedges, setWedges] = useState<{ wedges: Wedge[]; seams: Seam[] } | null>(null);
  const [map, setMap] = useState<DecidedMap | null>(null);
  const [firstMatches, setFirstMatchRows] = useState<FirstMatch[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [openStep, setOpenStep] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const [m, fm] = await Promise.all([getDecidedMap(apiFetch), getFirstMatches(apiFetch)]);
      setMap(m); setFirstMatchRows(fm);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load the map'); }
  }, [apiFetch]);
  useEffect(() => {
    if (!user) return;
    Promise.all([getVocabulary(apiFetch), getWedges(apiFetch)])
      .then(([v, w]) => { setVocab(v); setWedges(w); })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load'));
    void load();
  }, [user, apiFetch, load]);

  const label: Labels = useMemo(() => ({
    family: (c: string) => wedges?.wedges.find(w => w.archetype_code === c)?.archetype_name ?? c,
    lane: (c, archetype) => vocab?.laneWords.find(l => l.archetype_code === archetype && l.lane_code === c)?.label ?? c ?? '–',
    ring: c => (c === null || c === undefined ? '–' : vocab?.rings.find(r => r.code === c)?.label ?? String(c)),
    flag: c => vocab?.flags.find(f => f.code === c)?.label ?? c,
  }), [vocab, wedges]);

  if (!vocab || !wedges || !map) return <div className="p-6 text-sm text-stone-500">{error || 'Loading…'}</div>;

  const decision = (id: number) => map.decisions.find(d => d.coffee_id === id) ?? null;
  const facePlacements = map.placements.map(p => ({ ...p, coffee_name: p.coffee_name }));
  const faceSteps = map.activeSteps.map(s => ({ from_coffee_id: s.from_coffee_id, to_coffee_id: s.to_coffee_id, line_style: s.line_style }));
  const selectedDecision = selected === null ? null : decision(selected);

  return (
    <div className="p-6 max-w-[1500px]" data-testid="admin-ella-map-decided">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="text-lg font-medium text-stone-900">Ella's Bloom Map</h1>
        <Link to="/admin/map/advanced" className="text-xs text-stone-500 hover:underline" data-testid="advanced-link">Advanced</Link>
      </div>
      <p className="text-sm text-stone-500 mb-4" data-testid="active-version-line">
        {map.version
          ? <>{map.version.label} · published {new Date(map.version.activated_at).toLocaleDateString()}</>
          : 'No version is published yet.'}
      </p>
      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* The map */}
        <section className={`${CARD} p-4`}>
          <h2 className="text-sm font-medium text-stone-800 mb-2">The map: every coffee, every step</h2>
          <EllaMapFace
            placements={facePlacements} wedges={wedges.wedges} seams={wedges.seams} size="full"
            steps={faceSteps} dotStyle="size" highlightCoffeeId={selected} onTapCoffee={id => setSelected(id)} />
          <div className="mt-3">
            <EllaMapLegend
              sizes={vocab.sizes} families={wedges.wedges}
              lines={vocab.stepBases.map(b => ({ code: b.code, label: b.label, line_style: b.line_style }))}
              noSizeLabel={label.flag('no_roaster_sweetness')} />
          </div>
          {selectedDecision && (
            <CoffeeCard key={selectedDecision.coffee_id} d={selectedDecision} map={map} vocab={vocab} label={label} apiFetch={apiFetch}
              onClose={() => setSelected(null)} onChanged={load} onOpenStep={id => setOpenStep(id)} />
          )}
          <PublishBox map={map} apiFetch={apiFetch} onPublished={load} />
        </section>

        <div className="space-y-6">
          <FirstMatchTable rows={firstMatches} map={map} label={label} apiFetch={apiFetch} onChanged={load} />
          <StepsTable steps={map.steps} vocab={vocab} openId={openStep} setOpenId={setOpenStep} apiFetch={apiFetch} onChanged={load} />
        </div>
      </div>
    </div>
  );
}

function CoffeeCard({ d, map, vocab, label, apiFetch, onClose, onChanged, onOpenStep }: {
  d: DecisionNow; map: DecidedMap; vocab: Vocabulary; label: Labels; apiFetch: ApiFetch;
  onClose: () => void; onChanged: () => Promise<void>; onOpenStep: (id: number) => void;
}) {
  const facts = map.roaster.find(r => r.coffeeId === d.coffee_id) ?? null;
  const published = map.placements.find(p => p.coffee_id === d.coffee_id) ?? null;
  const steps = map.steps.filter(s => s.from_coffee_id === d.coffee_id);
  const [lane, setLaneDraft] = useState<string>(d.decided_lane_code ?? '');
  const [ring, setRingDraft] = useState<number | null>(d.decided_ring);
  const [basis, setBasis] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [history, setHistory] = useState<RingHistoryRow[]>([]);
  useEffect(() => { getRingHistory(apiFetch, d.coffee_id).then(setHistory).catch(() => setHistory([])); }, [apiFetch, d.coffee_id, d.decided_ring]);
  const rings = vocab.rings.filter(r => (r.code === 0) === d.is_center);
  const laneChanged = !!lane && lane !== d.decided_lane_code;
  const ringChanged = ring !== null && ring !== d.decided_ring;
  const reason = !laneChanged && !ringChanged ? null : !basis.trim() ? 'A basis is required for a change' : null;
  const workbench = `/admin/roastery-portal?roastery=${d.roaster_id}&view=workbench&coffee=${d.coffee_id}`;

  async function save() {
    setBusy(true); setMsg('');
    try {
      if (laneChanged) await setLean(apiFetch, d.coffee_id, { lane, notes: basis.trim(), basis: { text: basis.trim() } });
      if (ringChanged) await setRing(apiFetch, d.coffee_id, { ring: ring!, basis: basis.trim() });
      setMsg('Saved. Publish to put it on the map.');
      setBasis('');
      await onChanged();
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Save failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-4 p-4 rounded-lg border border-stone-200 bg-stone-50" data-testid={`coffee-card-${d.coffee_id}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-stone-900">{d.coffee_name}</p>
          <p className="text-xs text-stone-500">{d.roaster_name}</p>
        </div>
        <button className="text-xs text-stone-500 hover:underline" onClick={onClose}>Close</button>
      </div>

      {facts && (
        <div className="mt-3 text-sm">
          <p className="text-stone-700">{facts.notes.map(n => n.roaster_words).join(' · ')}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600" data-testid="roaster-ratings">
            {facts.dimensions.map(x => <span key={x.dimension_id}>{x.label} <strong className="text-stone-800">{x.value}</strong>/5</span>)}
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 text-sm">
        <div>
          <span className="text-xs text-stone-500 mr-2">Family</span>
          <a className="underline" href={workbench}>{label.family(d.archetype_code)}</a>
        </div>
        <div>
          <span className="text-xs text-stone-500">Lean</span>
          <div className="mt-1 flex flex-wrap gap-1" data-testid="lean-buttons">
            {vocab.lanes.map(l => (
              <button key={l.code} className={lane === l.code ? BTN_PRIMARY : BTN} onClick={() => setLaneDraft(l.code)}>{label.lane(l.code, d.archetype_code)}</button>
            ))}
          </div>
        </div>
        <div>
          <span className="text-xs text-stone-500">Ring</span>
          <div className="mt-1 flex flex-wrap gap-1 items-center" data-testid="ring-buttons">
            {rings.map(r => (
              <button key={r.code} className={ring === r.code ? BTN_PRIMARY : BTN} onClick={() => setRingDraft(r.code)} data-ring={r.code}>{r.label}</button>
            ))}
            {d.calculated_ring !== null && <span className="text-xs text-stone-500 ml-2">calculated: {label.ring(d.calculated_ring)}</span>}
          </div>
          {published && published.ring !== d.ring && (
            <p className="text-xs text-stone-500 mt-1">On the published map: {label.ring(published.ring)}</p>
          )}
        </div>
        <input className={INPUT} placeholder="Basis for a change (required)" value={basis} onChange={e => setBasis(e.target.value)} data-testid="card-basis" />
        <div className="flex items-center justify-end gap-2">
          {(msg || reason) && <span className="text-xs text-stone-500" data-testid="card-msg">{msg || reason}</span>}
          <button className={BTN_PRIMARY} disabled={busy || !!reason || (!laneChanged && !ringChanged)} onClick={save} data-testid="card-save">Save</button>
        </div>
        {history.length > 1 && (
          <table className="text-xs" data-testid="ring-history">
            <tbody>
              {history.map(h => (
                <tr key={h.id} className={h.is_current ? '' : 'text-stone-400 line-through'}>
                  <td className="pr-3">{label.ring(h.ring)}</td>
                  <td className="pr-3">{typeof h.basis?.text === 'string' ? h.basis.text : h.notes}</td>
                  <td>{new Date(h.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {steps.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-stone-500 mb-1">Steps from here</p>
          <ul className="text-sm space-y-0.5">
            {steps.map(s => (
              <li key={s.id}>
                <button className="hover:underline text-left" onClick={() => onOpenStep(s.id)}>
                  <strong>{s.button_word}</strong> → {s.to_coffee_name}{s.is_shown ? '' : ' (hidden)'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function nextLabel(current: string | null | undefined): string {
  const m = current ? /^L(\d+)/.exec(current) : null;
  return m ? `L${Number(m[1]) + 1}` : '';
}

function PublishBox({ map, apiFetch, onPublished }: { map: DecidedMap; apiFetch: ApiFetch; onPublished: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [labelText, setLabelText] = useState(nextLabel(map.version?.label));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const u = map.unpublished;
  async function go() {
    setBusy(true); setMsg('');
    try {
      const r = await publishMap(apiFetch, { label: labelText.trim(), reason: reason.trim() });
      setMsg(`Published ${r.label}: ${r.placements} coffees.`);
      setOpen(false); setReason('');
      await onPublished();
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Publish failed'); }
    finally { setBusy(false); }
  }
  return (
    <div className="mt-6 pt-4 border-t border-stone-200" data-testid="publish-box">
      {!open
        ? <button className={BTN_PRIMARY} onClick={() => { setOpen(true); setLabelText(nextLabel(map.version?.label)); }} data-testid="publish-open">Publish this map</button>
        : (
          <div className="grid gap-2 sm:grid-cols-[8rem_1fr_auto] items-center">
            <input className={INPUT} placeholder="Label" value={labelText} onChange={e => setLabelText(e.target.value)} data-testid="publish-label" />
            <input className={INPUT} placeholder="A short reason" value={reason} onChange={e => setReason(e.target.value)} data-testid="publish-reason" />
            <div className="flex gap-2">
              <button className={BTN_PRIMARY} disabled={busy || !labelText.trim() || !reason.trim()} onClick={go} data-testid="publish-go">Publish</button>
              <button className={BTN} onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        )}
      <p className="text-xs text-stone-500 mt-2" data-testid="unpublished-line">
        {u.total === 0
          ? 'Every decision is on the published map.'
          : `${u.total} decision${u.total === 1 ? '' : 's'} not yet published: ${[
              u.family ? `${u.family} family` : null, u.lean ? `${u.lean} lean` : null, u.ring ? `${u.ring} ring` : null, u.step ? `${u.step} step` : null,
            ].filter(Boolean).join(', ')}.`}
      </p>
      {msg && <p className="text-xs text-stone-700 mt-1" data-testid="publish-msg">{msg}</p>}
    </div>
  );
}

function FirstMatchTable({ rows, map, label, apiFetch, onChanged }: {
  rows: FirstMatch[]; map: DecidedMap; label: Labels; apiFetch: ApiFetch; onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [coffeeId, setCoffeeId] = useState<string>('');
  const [msg, setMsg] = useState('');
  const options = map.decisions.filter(d => d.is_placeable).sort((a, b) => a.coffee_name.localeCompare(b.coffee_name));
  async function save(r: FirstMatch) {
    setMsg('');
    try {
      await setFirstMatch(apiFetch, { archetype: r.archetype_code, lane: r.lane_code, coffeeId: Number(coffeeId), status: 'founder_pick', notes: r.notes });
      setEditing(null);
      await onChanged();
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Save failed'); }
  }
  return (
    <section className={`${CARD} p-4`} data-testid="first-match-table">
      <h2 className="text-sm font-medium text-stone-800">1. Where each quiz result starts</h2>
      <table className="w-full text-sm mt-2">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
            <th className="py-1 font-normal">Quiz result</th><th className="py-1 font-normal">First bag</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-t border-stone-100">
              <td className="py-1.5">{label.family(r.archetype_code)}, {label.lane(r.lane_code, r.archetype_code)}</td>
              <td className="py-1.5 font-medium">
                {editing === r.id
                  ? (
                    <span className="flex gap-1">
                      <select className={INPUT} value={coffeeId} onChange={e => setCoffeeId(e.target.value)}>
                        {options.map(o => <option key={o.coffee_id} value={o.coffee_id}>{o.coffee_name}</option>)}
                      </select>
                      <button className={BTN_PRIMARY} onClick={() => save(r)}>Save</button>
                    </span>
                  )
                  : r.coffee_name}
              </td>
              <td className="py-1.5 text-right">
                {editing === r.id
                  ? <button className={LINK} onClick={() => setEditing(null)}>Cancel</button>
                  : <button className={LINK} onClick={() => { setEditing(r.id); setCoffeeId(String(r.coffee_id)); }}>Change</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {msg && <p className="text-xs text-red-700 mt-2">{msg}</p>}
    </section>
  );
}

function StepsTable({ steps, vocab, openId, setOpenId, apiFetch, onChanged }: {
  steps: StepRow[]; vocab: Vocabulary; openId: number | null; setOpenId: (id: number | null) => void; apiFetch: ApiFetch; onChanged: () => Promise<void>;
}) {
  return (
    <section className={`${CARD} p-4`} data-testid="steps-table">
      <h2 className="text-sm font-medium text-stone-800">2. Steps between coffees</h2>
      <table className="w-full text-sm mt-2">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
            <th className="py-1 font-normal">From</th><th className="py-1 font-normal">Customer says</th>
            <th className="py-1 font-normal">To</th><th className="py-1 font-normal">Based on</th><th />
          </tr>
        </thead>
        <tbody>
          {steps.map(s => (
            <StepRowView key={s.id} s={s} back={steps.find(b => b.from_coffee_id === s.to_coffee_id && b.to_coffee_id === s.from_coffee_id) ?? null}
              vocab={vocab} open={openId === s.id} onToggle={() => setOpenId(openId === s.id ? null : s.id)} apiFetch={apiFetch} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function StepRowView({ s, back, vocab, open, onToggle, apiFetch, onChanged }: {
  s: StepRow; back: StepRow | null; vocab: Vocabulary; open: boolean; onToggle: () => void; apiFetch: ApiFetch; onChanged: () => Promise<void>;
}) {
  const [word, setWord] = useState(s.button_word);
  const [line, setLine] = useState(s.customer_line ?? '');
  const [basis, setBasis] = useState(s.basis_code);
  const [shown, setShown] = useState(s.is_shown);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { setWord(s.button_word); setLine(s.customer_line ?? ''); setBasis(s.basis_code); setShown(s.is_shown); }, [s]);
  async function save() {
    setBusy(true); setMsg('');
    try {
      const r = await setStep(apiFetch, { from: s.from_coffee_id, to: s.to_coffee_id, word: word.trim(), line: line.trim() || null, basis, shown });
      setMsg(r.unchanged ? 'Unchanged.' : 'Saved. Publish to put it on the map.');
      await onChanged();
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Save failed'); }
    finally { setBusy(false); }
  }
  return (
    <>
      <tr className={`border-t border-stone-100 cursor-pointer hover:bg-stone-50 ${s.is_shown ? '' : 'text-stone-400'}`} onClick={onToggle}
        data-testid={`step-row-${s.id}`} data-shown={s.is_shown}>
        <td className="py-1.5 font-medium">{s.from_coffee_name}</td>
        <td className="py-1.5">{s.button_word}</td>
        <td className="py-1.5 font-medium">{s.to_coffee_name}</td>
        <td className="py-1.5"><span className={`inline-block border rounded-full px-2 text-xs ${CHIP[s.line_style] ?? CHIP.solid}`}>{s.basis_label}</span></td>
        <td className="py-1.5 text-right"><span className={LINK}>{open ? 'Close' : 'Change'}</span></td>
      </tr>
      {open && (
        <tr className="bg-stone-50">
          <td colSpan={5} className="p-3">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2" data-testid={`step-edit-${s.id}`}>
                <input className={INPUT} value={word} onChange={e => setWord(e.target.value)} placeholder="Customer says" />
                <textarea className={INPUT} rows={2} value={line} onChange={e => setLine(e.target.value)} placeholder="The one thing that changes (empty: the destination's notes)" />
                <div className="flex flex-wrap gap-2 items-center">
                  <select className="border border-stone-300 rounded px-2 py-1 text-sm" value={basis} onChange={e => setBasis(e.target.value)}>
                    {vocab.stepBases.map(b => <option key={b.code} value={b.code}>{b.label}</option>)}
                  </select>
                  <label className="text-sm flex items-center gap-1">
                    <input type="checkbox" checked={shown} onChange={e => setShown(e.target.checked)} data-testid={`step-shown-${s.id}`} /> Shown
                  </label>
                  <button className={BTN_PRIMARY} disabled={busy || !word.trim()} onClick={save} data-testid={`step-save-${s.id}`}>Save</button>
                </div>
                {msg && <span className="text-xs text-stone-600">{msg}</span>}
              </div>
              <div className="text-sm text-stone-600">
                {back
                  ? <>
                      <p className="text-xs text-stone-500">The step back</p>
                      <p><strong>{back.button_word}</strong> → {back.to_coffee_name}</p>
                      <p>{back.customer_line ?? ''}</p>
                    </>
                  : null}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
