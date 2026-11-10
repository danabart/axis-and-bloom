// Ella's Bloom Map 2 (2026-11-10), C2 — /admin/map, the workbench where Dana
// runs the acceptance gate (Rev 3 section 9): the map placed by the current
// rules beside its evidence and flags, lean decisions, the map's parameters,
// hops and the graph check, first matches, phrases, and the version cut.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_2_WORKBENCH.md
//
// Reads come from brief 1's API (dialReads); writes go to dialPlacementService
// (cut, activate, first match, phrases), catalogService.setLean (the lean) and
// evidenceParameterService (parameters). The page types in only chrome
// (button verbs, section headings): every label, status word, lane, size,
// ring, grade and flag comes from GET /api/admin/map/vocabulary.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import EllaMapFace from '../bloom/map/EllaMapFace';
import EllaMapLegend from '../bloom/map/EllaMapLegend';
import EvidenceParametersCard from './EvidenceParametersCard';
import { setLean, type ApiFetch } from '../../lib/catalogWrites';
import {
  getPlacements, getHops, getGraphCheck, getVersions, getWedges, getFirstMatches, getPhrases, getVocabulary, getLeanHistory,
  cutVersion, activateVersion, setFirstMatch, setPhrase,
  type MapMode, type MapRow, type HopRow, type GraphCheck, type Version, type Wedge, type Seam, type FirstMatch,
  type PhraseResolved, type PhraseRow, type Vocabulary, type LeanHistoryRow,
} from '../../lib/mapAdmin';

const EYEBROW = 'text-xs uppercase tracking-wide text-stone-500';
const CARD = 'border border-stone-200 rounded-lg bg-white';
const INPUT = 'w-full border border-stone-300 rounded px-2 py-1 text-sm';
const BTN = 'px-3 py-1.5 rounded text-sm border border-stone-300 hover:bg-stone-50 disabled:opacity-50';
const BTN_PRIMARY = 'px-3 py-1.5 rounded text-sm bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50';
const num = (v: unknown, d = 2) => (v === null || v === undefined || v === '' ? '–' : Number(Number(v).toFixed(d)).toString());
const signed = (v: unknown) => (v === null || v === undefined ? '–' : `${Number(v) > 0 ? '+' : ''}${num(v)}`);
const MOVE_ORDER = ['bolder', 'gentler', 'different', 'sibling'];

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
        <h2 className="text-sm font-medium text-stone-800">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function AdminEllaMap() {
  const { user } = useAuth();
  const apiFetch: ApiFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const token = await user!.getIdToken();
    return fetch(url, {
      cache: 'no-store', ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) },
    });
  }, [user]);

  const [mode, setMode] = useState<MapMode>('preview');
  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [wedges, setWedges] = useState<{ wedges: Wedge[]; seams: Seam[] } | null>(null);
  const [rows, setRows] = useState<MapRow[]>([]);
  const [graph, setGraph] = useState<GraphCheck | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [firstMatches, setFirstMatches] = useState<FirstMatch[]>([]);
  const [phrases, setPhrases] = useState<{ rows: PhraseRow[]; resolved: PhraseResolved[] } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hops, setHops] = useState<HopRow[]>([]);
  const [allHops, setAllHops] = useState<HopRow[]>([]);
  const [error, setError] = useState('');

  const loadStatic = useCallback(async () => {
    const [v, w] = await Promise.all([getVocabulary(apiFetch), getWedges(apiFetch)]);
    setVocab(v); setWedges(w);
  }, [apiFetch]);
  const loadMode = useCallback(async () => {
    try {
      setError('');
      const [r, g, vs, fm, ph, ah] = await Promise.all([
        getPlacements(apiFetch, mode), getGraphCheck(apiFetch, mode), getVersions(apiFetch),
        getFirstMatches(apiFetch), getPhrases(apiFetch), getHops(apiFetch, mode),
      ]);
      setRows(r); setGraph(g); setVersions(vs); setFirstMatches(fm); setPhrases(ph); setAllHops(ah);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load the map'); }
  }, [apiFetch, mode]);

  useEffect(() => { if (user) loadStatic().catch(err => setError(err instanceof Error ? err.message : 'Failed to load')); }, [user, loadStatic]);
  useEffect(() => { if (user) void loadMode(); }, [user, loadMode]);
  useEffect(() => {
    if (!user || selected === null) { setHops([]); return; }
    getHops(apiFetch, mode, selected).then(setHops).catch(() => setHops([]));
  }, [user, apiFetch, mode, selected, rows]);

  const label = useMemo(() => ({
    // OT-123: the lane's words for this family (dial_lane's {side} template resolved by the API)
    lane: (c: string | null | undefined, archetype: string) => vocab?.laneWords.find(l => l.archetype_code === archetype && l.lane_code === c)?.label ?? c ?? '–',
    ring: (c?: number | null) => vocab?.rings.find(r => r.code === c)?.label ?? (c ?? '–'),
    size: (c?: number | null) => vocab?.sizes.find(s => s.code === c)?.label ?? (c ?? '–'),
    grade: (c?: string | null) => vocab?.grades.find(g => g.code === c),
    gradeByRank: (r: number) => vocab?.grades.find(g => g.rank === r)?.code ?? String(r),
    flag: (c: string) => vocab?.flags.find(f => f.code === c),
    status: (c: string) => vocab?.versionStatuses.find(s => s.code === c)?.label ?? c,
    fmStatus: (c: string) => vocab?.firstMatchStatuses.find(s => s.code === c)?.label ?? c,
    move: (c: string) => vocab?.moves.find(m => m.code === c)?.label ?? c,
    family: (c: string) => wedges?.wedges.find(w => w.archetype_code === c)?.archetype_name ?? c,
  }), [vocab, wedges]);

  const activeVersion = versions.find(v => v.status === 'active') ?? null;
  const placeable = rows.filter(r => r.is_placeable !== false && r.ring !== null);
  const selectedRow = rows.find(r => r.coffee_id === selected) ?? null;
  const faceHops = hops.filter(h => h.in_hop_set).map(h => ({ to_coffee_id: h.to_coffee_id, relation: h.relation }));

  function tapCoffee(id: number) {
    setSelected(id);
    requestAnimationFrame(() => document.getElementById(`map-row-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  if (!vocab || !wedges) return <div className="p-6 text-sm text-stone-500">{error || 'Loading…'}</div>;

  return (
    <div className="p-6 max-w-[1500px]" data-testid="admin-ella-map">
      <h1 className="text-lg font-medium text-stone-900 mb-1">Ella's Bloom Map</h1>
      <p className="text-sm text-stone-500 mb-4">
        The map placed by the current rules beside its evidence. Leans, parameters, first matches and phrases are decisions; rings, sizes and grades come from the rules. A version is cut from the preview and changes only when it is activated.
      </p>
      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}

      {/* mode toggle */}
      <div className="flex items-center gap-2 mb-6">
        {(['preview', 'active'] as MapMode[]).map(m => (
          <button key={m} className={mode === m ? BTN_PRIMARY : BTN} onClick={() => { setMode(m); setSelected(null); }} data-testid={`mode-${m}`}>
            {m === 'preview' ? 'Preview' : 'Active version'}
          </button>
        ))}
        {mode === 'active' && !activeVersion && <span className="text-sm text-stone-500">No version is active.</span>}
      </div>
      {mode === 'active' && activeVersion && (
        <div className={`${CARD} p-3 mb-6 text-sm`}>
          <p><span className={EYEBROW}>Active version</span> <strong>{activeVersion.label}</strong> · cut {new Date(activeVersion.cut_at).toLocaleString()} · {activeVersion.n_placements} placements</p>
          {activeVersion.reason && <p className="text-stone-600 mt-1">{activeVersion.reason}</p>}
          <details className="mt-1"><summary className="cursor-pointer text-stone-500">Parameter snapshot</summary>
            <pre className="text-xs mt-1 whitespace-pre-wrap">{JSON.stringify(activeVersion.parameters, null, 2)}</pre></details>
        </div>
      )}

      {/* face */}
      <Section title="Face">
        <div className="flex flex-wrap gap-6 items-start">
          <div className="flex-1 min-w-[320px] max-w-[760px]">
            <EllaMapFace placements={placeable} wedges={wedges.wedges} seams={wedges.seams} size="full" showGrades
              highlightCoffeeId={selected} hops={faceHops} onTapCoffee={tapCoffee} />
            <div className="mt-3"><EllaMapLegend sizes={vocab.sizes} families={wedges.wedges} /></div>
          </div>
          <div className="w-[360px] max-w-full">
            {selectedRow ? <HopsPanel row={selectedRow} hops={hops} phrases={phrases?.resolved ?? []} label={label}
                thumb={<EllaMapFace placements={placeable} wedges={wedges.wedges} size="thumb" highlightCoffeeId={selected} />} /> :
              <p className="text-sm text-stone-500">Tap a coffee to see its hops.</p>}
          </div>
        </div>
      </Section>

      <PlacementTable rows={rows} mode={mode} vocab={vocab} label={label} selected={selected} onSelect={tapCoffee}
        apiFetch={apiFetch} onChanged={loadMode} />

      {mode === 'preview' && (
        <EvidenceParametersCard title="Map parameters" prefix="dial_" testId="map-parameters" onSaved={() => void loadMode()}
          intro="The map's cuts, weights, caps and grade thresholds. A save writes a new row; the preview, the edges and the graph check follow at once. An active version keeps its own snapshot."
          footer="A cut copies these values into the version; nothing else reads them for the active map." />
      )}

      {graph && <GraphPanel graph={graph} rows={rows} label={label} />}

      <FirstMatchPanel firstMatches={firstMatches} rows={rows} vocab={vocab} wedges={wedges.wedges} label={label} apiFetch={apiFetch} onChanged={loadMode} />

      {phrases && <PhrasePanel phrases={phrases} wedges={wedges.wedges} vocab={vocab} hops={allHops} label={label} apiFetch={apiFetch} onChanged={loadMode} />}

      <VersionPanel versions={versions} mode={mode} activeVersion={activeVersion} label={label} apiFetch={apiFetch}
        onChanged={async () => { await loadMode(); }} />
    </div>
  );
}

type Labels = {
  lane: (c: string | null | undefined, archetype: string) => string; ring: (c?: number | null) => string | number; size: (c?: number | null) => string | number;
  grade: (c?: string | null) => { code: string; label: string; rank: number; description: string } | undefined;
  gradeByRank: (r: number) => string; flag: (c: string) => { code: string; label: string; description: string } | undefined;
  status: (c: string) => string; fmStatus: (c: string) => string; move: (c: string) => string; family: (c: string) => string;
};

function FlagChips({ flags, label }: { flags: string[]; label: Labels }) {
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map(f => {
        const v = label.flag(f);
        return <span key={f} title={v?.description ?? f} className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs">{v?.label ?? f}</span>;
      })}
    </span>
  );
}

// ── placement table ──────────────────────────────────────────────────────────
function PlacementTable({ rows, mode, vocab, label, selected, onSelect, apiFetch, onChanged }: {
  rows: MapRow[]; mode: MapMode; vocab: Vocabulary; label: Labels; selected: number | null; onSelect: (id: number) => void;
  apiFetch: ApiFetch; onChanged: () => Promise<void>;
}) {
  const [family, setFamily] = useState('');
  const [flag, setFlag] = useState('');
  const [grade, setGrade] = useState('');
  const [sellable, setSellable] = useState('');
  const [sort, setSort] = useState<'family' | 'name' | 'ring' | 'grade'>('family');
  const families = [...new Set(rows.map(r => r.archetype_code))];
  const shown = rows
    .filter(r => !family || r.archetype_code === family)
    .filter(r => !flag || r.flags.includes(flag))
    .filter(r => !grade || r.grade_code === grade)
    .filter(r => !sellable || String(r.is_sellable) === sellable)
    .sort((a, b) => sort === 'name' ? a.coffee_name.localeCompare(b.coffee_name)
      : sort === 'ring' ? (a.ring ?? 9) - (b.ring ?? 9)
      : sort === 'grade' ? b.grade_rank - a.grade_rank
      : a.archetype_code.localeCompare(b.archetype_code) || (a.ring ?? 9) - (b.ring ?? 9));
  const placed = shown.filter(r => r.is_placeable !== false && r.ring !== null);
  const notPlaced = shown.filter(r => !(r.is_placeable !== false && r.ring !== null));
  const sel = 'border border-stone-300 rounded px-2 py-1 text-sm';

  return (
    <Section title={`Placements (${rows.length})`} right={
      <span className="flex flex-wrap gap-2">
        <select className={sel} value={family} onChange={e => setFamily(e.target.value)} aria-label="Family">
          <option value="">All families</option>{families.map(f => <option key={f} value={f}>{label.family(f)}</option>)}
        </select>
        <select className={sel} value={flag} onChange={e => setFlag(e.target.value)} aria-label="Flag">
          <option value="">Any flag</option>{vocab.flags.map(f => <option key={f.code} value={f.code}>{f.label}</option>)}
        </select>
        <select className={sel} value={grade} onChange={e => setGrade(e.target.value)} aria-label="Grade">
          <option value="">Any grade</option>{vocab.grades.map(g => <option key={g.code} value={g.code}>{g.label}</option>)}
        </select>
        <select className={sel} value={sellable} onChange={e => setSellable(e.target.value)} aria-label="Sellable">
          <option value="">Sellable or not</option><option value="true">Sellable</option><option value="false">Not sellable</option>
        </select>
        <select className={sel} value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="Sort">
          <option value="family">Sort: family</option><option value="name">Sort: name</option><option value="ring">Sort: ring</option><option value="grade">Sort: grade</option>
        </select>
      </span>}>
      <div className={`${CARD} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left">
            <tr className="text-stone-600">
              <th className="p-2">Coffee</th><th className="p-2">Family</th><th className="p-2">Ruler</th><th className="p-2">Ring</th>
              <th className="p-2">Lean</th><th className="p-2">Size</th><th className="p-2">Grade</th><th className="p-2">Sellable</th><th className="p-2">Flags</th>
            </tr>
          </thead>
          <tbody>
            {placed.map(r => <PlacementRow key={r.coffee_id} r={r} mode={mode} vocab={vocab} label={label}
              selected={selected === r.coffee_id} onSelect={onSelect} apiFetch={apiFetch} onChanged={onChanged} />)}
            {notPlaced.length > 0 && <tr><td colSpan={9} className={`p-2 pt-4 ${EYEBROW}`}>Not placeable</td></tr>}
            {notPlaced.map(r => <PlacementRow key={r.coffee_id} r={r} mode={mode} vocab={vocab} label={label}
              selected={selected === r.coffee_id} onSelect={onSelect} apiFetch={apiFetch} onChanged={onChanged} />)}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function PlacementRow({ r, mode, vocab, label, selected, onSelect, apiFetch, onChanged }: {
  r: MapRow; mode: MapMode; vocab: Vocabulary; label: Labels; selected: boolean; onSelect: (id: number) => void;
  apiFetch: ApiFetch; onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const g = label.grade(r.grade_code);
  const ss = r.suggested_scores ?? {};
  const workbench = `/admin/roastery-portal?roastery=${r.roaster_id}&view=workbench&coffee=${r.coffee_id}`;
  return (
    <>
      <tr id={`map-row-${r.coffee_id}`} className={`border-t border-stone-100 align-top ${selected ? 'bg-amber-50' : ''}`}>
        <td className="p-2">
          <button className="text-left font-medium text-stone-900 hover:underline" onClick={() => onSelect(r.coffee_id)}>{r.coffee_name}</button>
          <div className="text-xs text-stone-500">{r.roaster_name}</div>
          <button className="text-xs text-stone-500 underline mt-1" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show'} inputs and history</button>
        </td>
        <td className="p-2"><a className="underline" href={workbench}>{label.family(r.archetype_code)}</a></td>
        <td className="p-2 tabular-nums">{r.is_center ? '–' : num(r.ruler_value)}</td>
        <td className="p-2">{r.ring === null ? '–' : <>{r.ring} · <span className="text-stone-500">{label.ring(r.ring)}</span></>}</td>
        <td className="p-2 min-w-[260px]">
          <div>{label.lane(r.lane_code, r.archetype_code)}{r.decided_lane_code ? '' : mode === 'preview' ? ' · no decision' : ''}</div>
          {r.suggested_lane_code !== undefined && (
            <div className="text-xs text-stone-500 mt-0.5">
              Suggests {label.lane(r.suggested_lane_code, r.archetype_code)} · A {label.family(ss.side_a?.archetype ?? '')} {num(ss.side_a?.score)} / B {label.family(ss.side_b?.archetype ?? '')} {num(ss.side_b?.score)}
            </div>
          )}
          {mode === 'preview' && r.is_placeable !== false && <LeanControl r={r} vocab={vocab} label={label} apiFetch={apiFetch} onChanged={onChanged} />}
        </td>
        <td className="p-2">{r.size === null ? '–' : <>{r.size} · <span className="text-stone-500">{label.size(r.size)}</span></>}<div className="text-xs text-stone-500 tabular-nums">{num(r.sweetness)}</div></td>
        <td className="p-2" title={g?.description}><strong>{r.grade_code}</strong><div className="text-xs text-stone-500 tabular-nums">{r.n_sessions} · {num(r.n_cuppers, 1)}</div></td>
        <td className="p-2">{r.is_sellable ? 'yes' : 'no'}</td>
        <td className="p-2"><FlagChips flags={r.flags} label={label} /></td>
      </tr>
      {open && (
        <tr className="bg-stone-50">
          <td colSpan={9} className="p-3">
            <LeanHistory coffeeId={r.coffee_id} archetype={r.archetype_code} apiFetch={apiFetch} label={label} />
            <pre className="text-xs mt-2 whitespace-pre-wrap">{JSON.stringify(r.inputs_used, null, 2)}</pre>
          </td>
        </tr>
      )}
    </>
  );
}

function LeanControl({ r, vocab, label, apiFetch, onChanged }: { r: MapRow; vocab: Vocabulary; label: Labels; apiFetch: ApiFetch; onChanged: () => Promise<void> }) {
  const [lane, setLaneDraft] = useState<string>(r.decided_lane_code ?? '');
  const [basis, setBasis] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const reason = !lane ? 'Choose a lane' : !basis.trim() ? 'A basis is required' : null;
  async function save() {
    setBusy(true); setMsg('');
    try {
      const res = await setLean(apiFetch, r.coffee_id, {
        lane, notes: basis.trim(),
        basis: { text: basis.trim(), suggested_lane: r.suggested_lane_code ?? null, suggested_scores: r.suggested_scores ?? null, decided_on: new Date().toISOString().slice(0, 10) },
      });
      setMsg(res.result.unchanged ? 'Unchanged.' : 'Saved.');
      setBasis('');
      await onChanged();
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Save failed'); }
    finally { setBusy(false); }
  }
  return (
    <div className="mt-2 p-2 rounded border border-stone-200 bg-stone-50" data-testid={`lean-${r.coffee_id}`}>
      <div className="flex flex-wrap gap-1">
        {vocab.lanes.map(l => (
          <button key={l.code} className={lane === l.code ? BTN_PRIMARY : BTN} onClick={() => setLaneDraft(l.code)} title={label.lane(l.code, r.archetype_code)}>
            {label.lane(l.code, r.archetype_code)}{r.suggested_lane_code === l.code ? ' ★' : ''}
          </button>
        ))}
      </div>
      <input className={`${INPUT} mt-1`} placeholder="Basis (required)" value={basis} onChange={e => setBasis(e.target.value)} />
      <div className="mt-1 flex items-center justify-end gap-2">
        {(msg || reason) && <span className="text-xs text-stone-500">{msg || reason}</span>}
        <button className={BTN_PRIMARY} disabled={!!reason || busy} onClick={save}>Save lean</button>
      </div>
    </div>
  );
}

function LeanHistory({ coffeeId, archetype, apiFetch, label }: { coffeeId: number; archetype: string; apiFetch: ApiFetch; label: Labels }) {
  const [rows, setRows] = useState<LeanHistoryRow[] | null>(null);
  useEffect(() => { getLeanHistory(apiFetch, coffeeId).then(setRows).catch(() => setRows([])); }, [apiFetch, coffeeId]);
  if (!rows) return null;
  if (!rows.length) return <p className="text-xs text-stone-500">No lean decision yet.</p>;
  return (
    <table className="text-xs">
      <tbody>
        {rows.map(h => (
          <tr key={h.id} className={h.is_current ? '' : 'text-stone-400 line-through'}>
            <td className="pr-3">{new Date(h.created_at).toLocaleString()}</td>
            <td className="pr-3">{label.lane(h.lane_code, archetype)}</td>
            <td className="pr-3">{h.notes}</td>
            <td>{h.decided_by}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── hops ─────────────────────────────────────────────────────────────────────
function HopsPanel({ row, hops, phrases, label, thumb }: { row: MapRow; hops: HopRow[]; phrases: PhraseResolved[]; label: Labels; thumb?: React.ReactNode }) {
  return (
    <div className={`${CARD} p-3 text-sm`} data-testid="hops-panel">
      {thumb && <div className="mb-2" data-testid="face-thumb">{thumb}</div>}
      <p className="font-medium text-stone-900">{row.coffee_name}</p>
      <p className="text-xs text-stone-500 mb-2">{label.family(row.archetype_code)} · {label.ring(row.ring)} · {label.lane(row.lane_code, row.archetype_code)}</p>
      {MOVE_ORDER.map(move => {
        const set = hops.filter(h => h.relation === move && h.in_hop_set).sort((a, b) => a.rank - b.rank);
        const phrase = phrases.find(p => p.archetype_code === row.archetype_code && p.move_code === move);
        return (
          <div key={move} className="mb-2">
            <p className={EYEBROW}>{phrase?.button_label ?? label.move(move)}</p>
            {set.length === 0
              ? <p className="text-stone-500 italic">{phrase?.edge_phrase ?? '–'}</p>
              : set.map(h => (
                <div key={h.to_coffee_id} className="mt-0.5">
                  <span className="font-medium">{h.to_coffee_name}</span>
                  <span className="text-xs text-stone-500 tabular-nums"> · d {num(h.distance)}{h.adjacency_rank !== null ? ` · adj ${h.adjacency_rank}` : ''} · ring {signed(h.delta_ring)} · body {signed(h.delta_body)} · sweet {signed(h.delta_sweetness)} · acid {signed(h.delta_acidity)} · bitter {signed(h.delta_bitterness)}</span>
                  {h.move_line && <div className="text-xs text-stone-700 italic">{h.move_line}</div>}
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}

// ── graph check ─────────────────────────────────────────────────────────────
function GraphPanel({ graph, rows, label }: { graph: GraphCheck; rows: MapRow[]; label: Labels }) {
  const floor = graph.parameters.dial_min_grade_rank_hop_target;
  const unreachableEligible = graph.unreachableSellable.filter(n => (rows.find(r => r.coffee_name === n)?.grade_rank ?? 0) >= floor);
  const red = unreachableEligible.length > 0;
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : '–');
  return (
    <Section title="Graph check">
      <div className={`${CARD} p-3 text-sm ${red ? 'border-red-400 bg-red-50' : ''}`} data-testid="graph-check">
        <p className={red ? 'text-red-800 font-medium' : 'text-stone-800'}>
          {graph.reachable.length} of {graph.sellable} sellable reachable from {list(graph.centers)}
          {red ? ` · unreachable at grade ${label.gradeByRank(floor)} or better: ${list(unreachableEligible)}` : ''}
        </p>
        <p className="mt-1"><span className={EYEBROW}>Unreachable sellable</span> {list(graph.unreachableSellable)}</p>
        <p><span className={EYEBROW}>No {label.move('bolder').toLowerCase()}</span> {list(graph.noBolder)}</p>
        <p><span className={EYEBROW}>No {label.move('gentler').toLowerCase()}</span> {list(graph.noGentler)}</p>
        <p><span className={EYEBROW}>No {label.move('different').toLowerCase()}</span> {list(graph.noDifferent)}</p>
        <p><span className={EYEBROW}>Reachable without tagged coffees</span> {list(graph.reachableWithoutTagged)}</p>
        <table className="mt-2 text-sm">
          <thead><tr className={EYEBROW}><th className="pr-4 text-left">Roaster cousins</th><th className="pr-4 text-left">→</th><th className="pr-4 text-left">←</th><th className="text-left">Reproduced</th></tr></thead>
          <tbody>
            {graph.cousins.map(c => (
              <tr key={`${c.a}-${c.b}`}>
                <td className="pr-4">{c.a} · {c.b}</td>
                <td className="pr-4">{c.aToB ? label.move(c.aToB) : '–'}</td>
                <td className="pr-4">{c.bToA ? label.move(c.bToA) : '–'}</td>
                <td>{c.reproduced ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ── first match ─────────────────────────────────────────────────────────────
function FirstMatchPanel({ firstMatches, rows, vocab, wedges, label, apiFetch, onChanged }: {
  firstMatches: FirstMatch[]; rows: MapRow[]; vocab: Vocabulary; wedges: Wedge[]; label: Labels; apiFetch: ApiFetch; onChanged: () => Promise<void>;
}) {
  const [archetype, setArchetype] = useState(wedges[0]?.archetype_code ?? '');
  const [lane, setLaneSel] = useState(vocab.lanes[0]?.code ?? '');
  const [coffeeId, setCoffeeId] = useState<number | ''>('');
  const [status, setStatus] = useState(vocab.firstMatchStatuses[0]?.code ?? '');
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setMsg('');
    try {
      const r = await setFirstMatch(apiFetch, { archetype, lane, coffeeId: Number(coffeeId), status, notes: notes.trim() || null });
      setMsg(r.unchanged ? 'Unchanged.' : 'Saved.');
      await onChanged();
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Save failed'); }
    finally { setBusy(false); }
  }
  const sel = 'border border-stone-300 rounded px-2 py-1 text-sm';
  return (
    <Section title="First match">
      <div className={`${CARD} p-3`}>
        <table className="w-full text-sm mb-3">
          <thead><tr className={`${EYEBROW} text-left`}><th>Family</th><th>Lane</th><th>Coffee</th><th>Status</th><th>Grade</th><th>Notes</th></tr></thead>
          <tbody>
            {firstMatches.map(f => (
              <tr key={f.id} className="border-t border-stone-100">
                <td>{label.family(f.archetype_code)}</td><td>{label.lane(f.lane_code, f.archetype_code)}</td><td>{f.coffee_name}</td><td>{label.fmStatus(f.status)}</td>
                <td>
                  {f.preview_grade ?? '–'}
                  {f.meets_grade_floor_preview === false && (
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-800 text-xs">below {label.gradeByRank(f.min_grade_rank)}</span>
                  )}
                </td>
                <td>{f.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-2 items-center" data-testid="first-match-form">
          <select className={sel} value={archetype} onChange={e => setArchetype(e.target.value)} aria-label="Family">
            {wedges.map(w => <option key={w.archetype_code} value={w.archetype_code}>{w.archetype_name}</option>)}
          </select>
          <select className={sel} value={lane} onChange={e => setLaneSel(e.target.value)} aria-label="Lane">
            {vocab.lanes.map(l => <option key={l.code} value={l.code}>{label.lane(l.code, archetype)}</option>)}
          </select>
          <select className={sel} value={coffeeId} onChange={e => setCoffeeId(e.target.value ? Number(e.target.value) : '')} aria-label="Coffee">
            <option value="">Coffee…</option>
            {rows.map(r => <option key={r.coffee_id} value={r.coffee_id}>{r.coffee_name} ({r.grade_code})</option>)}
          </select>
          <select className={sel} value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
            {vocab.firstMatchStatuses.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
          <input className={`${INPUT} max-w-[260px]`} placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
          <button className={BTN_PRIMARY} disabled={busy || !coffeeId} onClick={save}>Save first match</button>
          {msg && <span className="text-sm text-stone-600" data-testid="first-match-msg">{msg}</span>}
        </div>
      </div>
    </Section>
  );
}

// ── phrases ─────────────────────────────────────────────────────────────────
function PhrasePanel({ phrases, wedges, vocab, hops, label, apiFetch, onChanged }: {
  phrases: { rows: PhraseRow[]; resolved: PhraseResolved[] }; wedges: Wedge[]; vocab: Vocabulary; hops: HopRow[]; label: Labels;
  apiFetch: ApiFetch; onChanged: () => Promise<void>;
}) {
  const moves = vocab.moves.filter(m => m.is_customer_move).map(m => m.code);
  const example = hops.find(h => h.in_hop_set && h.move_line && h.deltas_mentioned.length >= 2) ?? hops.find(h => h.in_hop_set && h.move_line);
  const targets: Array<{ archetype: string | null; name: string }> = [{ archetype: null, name: 'Default' }, ...wedges.map(w => ({ archetype: w.archetype_code, name: w.archetype_name }))];
  return (
    <Section title="Phrases">
      <div className={`${CARD} p-3`}>
        {example && <p className="text-sm mb-3"><span className={EYEBROW}>Live example</span> <em>{example.move_line}</em></p>}
        <table className="w-full text-sm">
          <thead><tr className={`${EYEBROW} text-left`}><th>Family</th><th>Move</th><th>Button</th><th>Move line</th><th>Edge</th><th /></tr></thead>
          <tbody>
            {targets.flatMap(t => moves.map(m => {
              const own = phrases.rows.find(r => (r.archetype_code ?? null) === t.archetype && r.move_code === m) ?? null;
              const resolved = t.archetype ? phrases.resolved.find(r => r.archetype_code === t.archetype && r.move_code === m) : null;
              return <PhraseRowEdit key={`${t.archetype ?? 'default'}-${m}`} target={t} move={m} own={own} resolved={resolved ?? null}
                label={label} apiFetch={apiFetch} onChanged={onChanged} />;
            }))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function PhraseRowEdit({ target, move, own, resolved, label, apiFetch, onChanged }: {
  target: { archetype: string | null; name: string }; move: string; own: PhraseRow | null; resolved: PhraseResolved | null;
  label: Labels; apiFetch: ApiFetch; onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [button, setButton] = useState(own?.button_label ?? resolved?.button_label ?? '');
  const [line, setLine] = useState(own?.move_line_template ?? '');
  const [edge, setEdge] = useState(own?.edge_phrase ?? '');
  const [msg, setMsg] = useState('');
  async function save() {
    try {
      await setPhrase(apiFetch, { archetype: target.archetype, move, buttonLabel: button.trim(), moveLineTemplate: line.trim() || null, edgePhrase: edge.trim() || null });
      setEditing(false); setMsg('');
      await onChanged();
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Save failed'); }
  }
  const shown = own ?? resolved;
  if (!target.archetype && !own) return null;
  return (
    <tr className="border-t border-stone-100 align-top">
      <td className="py-1">{target.name}</td>
      <td>{label.move(move)}</td>
      {editing ? (
        <>
          <td><input className={INPUT} value={button} onChange={e => setButton(e.target.value)} /></td>
          <td><input className={INPUT} value={line} onChange={e => setLine(e.target.value)} placeholder={resolved?.move_line_template ?? ''} /></td>
          <td><input className={INPUT} value={edge} onChange={e => setEdge(e.target.value)} placeholder={resolved?.edge_phrase ?? ''} /></td>
          <td className="whitespace-nowrap"><button className={BTN_PRIMARY} disabled={!button.trim()} onClick={save}>Save</button> <button className={BTN} onClick={() => setEditing(false)}>Cancel</button>{msg && <div className="text-xs text-red-700">{msg}</div>}</td>
        </>
      ) : (
        <>
          <td>{shown?.button_label ?? '–'}{resolved && !resolved.is_override && target.archetype ? <span className="text-xs text-stone-400"> (default)</span> : null}</td>
          <td className="text-stone-600">{shown?.move_line_template ?? '–'}</td>
          <td className="text-stone-600">{shown?.edge_phrase ?? '–'}</td>
          <td><button className={BTN} onClick={() => setEditing(true)}>Edit</button></td>
        </>
      )}
    </tr>
  );
}

// ── versions ────────────────────────────────────────────────────────────────
function VersionPanel({ versions, mode, activeVersion, label, apiFetch, onChanged }: {
  versions: Version[]; mode: MapMode; activeVersion: Version | null; label: Labels; apiFetch: ApiFetch; onChanged: () => Promise<void>;
}) {
  const [vLabel, setVLabel] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function cut() {
    setBusy(true); setMsg('');
    try {
      const r = await cutVersion(apiFetch, { label: vLabel.trim(), reason: reason.trim() });
      setMsg(r.created ? `Cut ${r.label}: ${r.placements} placements, a draft.` : `${r.label} exists; nothing written.`);
      setVLabel(''); setReason('');
      await onChanged();
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Cut failed'); }
    finally { setBusy(false); }
  }
  async function activate(id: number) {
    setBusy(true); setMsg('');
    try {
      const r = await activateVersion(apiFetch, id);
      setMsg(r.retiredVersionId ? `Activated; version ${r.retiredVersionId} retired.` : 'Activated.');
      setConfirm(null);
      await onChanged();
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Activate failed'); }
    finally { setBusy(false); }
  }
  return (
    <Section title="Versions">
      <div className={`${CARD} p-3`} data-testid="versions">
        <table className="w-full text-sm mb-3">
          <thead><tr className={`${EYEBROW} text-left`}><th>Label</th><th>Status</th><th>Cut</th><th>Placements</th><th>Reason</th><th /></tr></thead>
          <tbody>
            {versions.map(v => (
              <tr key={v.id} className="border-t border-stone-100 align-top">
                <td className="py-1 font-medium">{v.label}</td><td>{label.status(v.status)}</td>
                <td>{new Date(v.cut_at).toLocaleString()}</td><td>{v.n_placements}</td><td className="text-stone-600">{v.reason}</td>
                <td className="whitespace-nowrap">
                  {v.status === 'draft' && confirm !== v.id && <button className={BTN} onClick={() => setConfirm(v.id)}>Activate</button>}
                  {confirm === v.id && (
                    <span className="inline-flex flex-col gap-1">
                      <span className="text-xs text-stone-700">{activeVersion ? `${v.label} becomes active; ${activeVersion.label} is retired.` : `${v.label} becomes the active version.`}</span>
                      <span><button className={BTN_PRIMARY} disabled={busy} onClick={() => activate(v.id)}>Confirm activate</button> <button className={BTN} onClick={() => setConfirm(null)}>Cancel</button></span>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {mode === 'preview' && (
          <div className="flex flex-wrap gap-2 items-center" data-testid="cut-form">
            <input className={`${INPUT} max-w-[200px]`} placeholder="Label (required)" value={vLabel} onChange={e => setVLabel(e.target.value)} />
            <input className={`${INPUT} max-w-[420px]`} placeholder="Reason (required)" value={reason} onChange={e => setReason(e.target.value)} />
            <button className={BTN_PRIMARY} disabled={busy || !vLabel.trim() || !reason.trim()} onClick={cut}>Cut version</button>
          </div>
        )}
        {msg && <p className="text-sm text-stone-600 mt-2" data-testid="version-msg">{msg}</p>}
      </div>
    </Section>
  );
}
