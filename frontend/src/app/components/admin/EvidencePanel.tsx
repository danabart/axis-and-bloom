import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { reportError } from '../../lib/errorReporter';

// Cupping evidence brief 3, B1 (2026-10-18): the per-coffee evidence panel on
// the Coffees page. Read-only: it reads GET /api/admin/evidence/coffee/:id
// (v_evidence_dimension, _descriptor, _archetype, _archetype_call through
// evidenceReads) and writes nothing. "Decide" opens the page's existing Set
// match / Place dialogs; the decision and its basis go through the catalog
// doors as before. One column per cupper is built from the rows, never named
// in code.

type Row = Record<string, any>;
interface CoffeeEvidence { dimensions: Row[]; descriptors: Row[]; archetype: Row | null; calls: Row[] }

const TAB = 'px-3 py-1 text-xs uppercase tracking-wide border-b-2';
const FLAG_STYLE: Record<string, string> = {
  none: 'text-stone-400', one_source: 'text-stone-400',
  cuppers_disagree: 'text-amber-700', roaster_disagrees: 'text-amber-700', both: 'text-red-700',
  no_basis: 'text-amber-700', out_of_band: 'text-red-700', stale_decision: 'text-amber-700',
};

function num(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : String(v);
}
function range(lo: unknown, hi: unknown): string {
  if (lo === null || lo === undefined) return '—';
  return num(lo) === num(hi) ? num(lo) : `${num(lo)}–${num(hi)}`;
}
function flagLabel(flag: string | null | undefined): string {
  return flag ? flag.replace(/_/g, ' ') : '—';
}

export default function EvidencePanel({ coffeeId, apiFetch, onDecideMatch, onDecidePlace }: {
  coffeeId: number;
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>;
  onDecideMatch: () => void;
  onDecidePlace: () => void;
}) {
  const [data, setData] = useState<CoffeeEvidence | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'dimensions' | 'descriptors' | 'archetype'>('dimensions');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`/api/admin/evidence/coffee/${coffeeId}`);
        if (!res.ok) throw new Error('Failed to load evidence');
        setData(await res.json());
      } catch (err) {
        reportError('[EvidencePanel/load]', err);
        setError('Failed to load evidence');
      }
    })();
  }, [apiFetch, coffeeId]);

  if (!data) return <p className="text-xs text-stone-400 py-2">{error || 'Loading evidence…'}</p>;

  return (
    <div className="bg-stone-50 border border-stone-200 rounded p-4 my-1 text-xs text-stone-700">
      <div className="flex items-center gap-1 mb-3">
        {(['dimensions', 'descriptors', 'archetype'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`${TAB} ${tab === t ? 'border-stone-700 text-stone-800' : 'border-transparent text-stone-400 hover:text-stone-700'}`}>
            {t === 'archetype' ? 'Archetype & slot' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
        <span className="ml-auto text-stone-400">Read-only. Decisions go through the existing dialogs.</span>
      </div>
      {tab === 'dimensions' && <DimensionsTab rows={data.dimensions} />}
      {tab === 'descriptors' && <DescriptorsTab rows={data.descriptors} />}
      {tab === 'archetype' && (
        <ArchetypeTab archetype={data.archetype} calls={data.calls} onDecideMatch={onDecideMatch} onDecidePlace={onDecidePlace} />
      )}
    </div>
  );
}

export function DimensionsTab({ rows }: { rows: Row[] }) {
  if (!rows.length) return <p className="text-stone-400">No numeric cupping rows for this coffee.</p>;
  const cuppers = [...new Map(rows.map(r => [r.cupper_id, r.cupper_name])).entries()];
  const dims = [...new Map(rows.map(r => [r.dimension_id, r])).values()];
  const cell = (dimensionId: number, cupperId: number) => rows.find(r => r.dimension_id === dimensionId && r.cupper_id === cupperId);
  return (
    <table className="w-full">
      <thead>
        <tr className="text-stone-400 text-left">
          <th className="py-1 pr-3 font-normal">Dimension</th>
          {cuppers.map(([id, name]) => <th key={id} className="py-1 pr-3 font-normal">{name}</th>)}
          <th className="py-1 pr-3 font-normal">Merged (latest session)</th>
          <th className="py-1 pr-3 font-normal">Roaster 1–5</th>
          <th className="py-1 pr-3 font-normal">Rank ours / theirs</th>
          <th className="py-1 pr-3 font-normal">Flag</th>
        </tr>
      </thead>
      <tbody>
        {dims.map(d => (
          <tr key={d.dimension_id} className="border-t border-stone-200">
            <td className="py-1 pr-3">{d.dimension_name}</td>
            {cuppers.map(([id]) => {
              const c = cell(d.dimension_id, id);
              return (
                <td key={id} className="py-1 pr-3">
                  {c ? <>{range(c.cupper_min, c.cupper_max)}{c.cupper_scale_code !== 'ab_0_15' && <span className="text-stone-400"> ({c.cupper_scale_code})</span>}</> : '—'}
                </td>
              );
            })}
            <td className="py-1 pr-3">
              {range(d.merged_min, d.merged_max)}
              {d.merged_session_id && <Link to="/admin/cupping" className="ml-1 text-stone-400 underline">s{d.merged_session_id}</Link>}
              {d.all_ab_scale === false && <span className="text-stone-400"> · converted</span>}
            </td>
            <td className="py-1 pr-3">{num(d.roaster_value_1_5)}</td>
            <td className="py-1 pr-3">
              {d.rank_gap === null || d.rank_gap === undefined ? '—' : `${num(d.ab_rank_in_lineup)} / ${num(d.roaster_rank_in_lineup)} of ${d.lineup_n}`}
            </td>
            <td className={`py-1 pr-3 ${FLAG_STYLE[d.flag] ?? ''}`}>{flagLabel(d.flag)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DescriptorsTab({ rows }: { rows: Row[] }) {
  if (!rows.length) return <p className="text-stone-400">No family named by anyone yet.</p>;
  const who = (r: Row) => [
    ...(r.named_by_cuppers ?? []),
    r.named_by_roaster_form && 'roaster form',
    r.named_by_roaster_remark && 'roaster remark',
    r.named_by_roaster_website && 'roaster website',
    r.named_by_customer && 'customers',
    r.accepted_in_catalog && 'accepted in catalog',
  ].filter(Boolean).join(', ');
  const style = (r: Row) => r.hit ? 'bg-green-100 text-green-800' : r.miss ? 'bg-amber-100 text-amber-800' : r.extra ? 'bg-stone-200 text-stone-700' : 'bg-white text-stone-500 border border-stone-200';
  const kind = (r: Row) => r.hit ? 'hit' : r.miss ? 'miss' : r.extra ? 'extra' : 'other';
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {rows.map(r => (
          <span key={r.family_id} className={`rounded px-2 py-1 ${style(r)}`} title={who(r)}>
            {r.family} <span className="opacity-60">· {kind(r)}</span>
          </span>
        ))}
      </div>
      <ul className="mt-3 space-y-0.5 text-stone-500">
        {rows.map(r => <li key={r.family_id}><span className="text-stone-700">{r.family}</span>: {who(r) || '—'}</li>)}
      </ul>
      <p className="mt-2 text-stone-400">hit: we and the roaster · miss: roaster only · extra: we only. Families by SCA tree (tier-1 ancestor).</p>
    </div>
  );
}

// Cupping evidence brief 4: the three tabs are exported so the Calibration
// workbench reuses them as its centre column; there the decision cards sit
// beside them, so the Decide links are optional.
export function ArchetypeTab({ archetype: a, calls, onDecideMatch, onDecidePlace }: {
  archetype: Row | null; calls: Row[]; onDecideMatch?: () => void; onDecidePlace?: () => void;
}) {
  if (!a) return <p className="text-stone-400">No row for this coffee.</p>;
  const line = (k: string, v: React.ReactNode) => (
    <div className="flex gap-3 py-0.5"><span className="w-48 text-stone-400 shrink-0">{k}</span><span>{v ?? '—'}</span></div>
  );
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <p className="text-stone-400 uppercase tracking-wide mb-1">Evidence</p>
        {calls.length === 0 && <p className="text-stone-400">No cupper row.</p>}
        {calls.map(c => line(`${c.cupper_name} (s${c.session_id}${c.is_blind ? ', blind' : ''})`,
          <>{c.archetype_call ?? 'no call'}{c.position_call && ` · ${c.position_call}`}{c.call_note && <span className="text-stone-400"> · {c.call_note}</span>}</>))}
        {line('Cuppers agree', a.cupper_calls_agree === null ? '—' : a.cupper_calls_agree ? 'yes' : 'no')}
        {line('Merged call', a.merged_call ?? 'none')}
        {line('Roaster form proposal', a.roaster_form_proposal)}
        {line('Roaster remark proposals', a.roaster_remark_proposals?.length ? a.roaster_remark_proposals.join(', ') : null)}
        {line('Latest session', a.latest_session_id ? <Link to="/admin/cupping" className="underline">s{a.latest_session_id} · {String(a.latest_session_date).slice(0, 10)}</Link> : null)}
        {line('Blind / roaster present', `${a.is_blind ? 'blind' : 'not blind'} · ${a.roaster_present ? 'roaster present' : 'roaster not present'}`)}
      </div>
      <div>
        <p className="text-stone-400 uppercase tracking-wide mb-1">Catalog (decision)</p>
        {line('Archetype', a.catalog_archetype ? `${a.catalog_archetype} · ${a.catalog_confidence ?? ''} · ${a.catalog_source ?? ''}` : null)}
        {line('Basis', a.basis)}
        {line('Assigned from session', a.assigned_from_session_id ? `s${a.assigned_from_session_id}` : null)}
        {line('Home slot', a.catalog_home_slot_name)}
        {line('Placement note', a.placement_note)}
        {line('Band check', a.slot_spec_check)}
        {line('Dial signal basis', a.dial_signal_basis)}
        {line('Newer evidence than decision', a.evidence_newer_than_decision === null ? '—' : a.evidence_newer_than_decision ? 'yes' : 'no')}
        {line('Roaster agrees with catalog', a.roaster_agrees_with_catalog === null ? '—' : a.roaster_agrees_with_catalog ? 'yes' : 'no')}
        {line('Flag', <span className={FLAG_STYLE[a.flag] ?? ''}>{flagLabel(a.flag)}</span>)}
        {(onDecideMatch || onDecidePlace) && (
          <div className="flex gap-3 mt-3">
            {onDecideMatch && <button onClick={onDecideMatch} className="underline text-stone-600 hover:text-stone-900">Decide archetype…</button>}
            {onDecidePlace && <button onClick={onDecidePlace} className="underline text-stone-600 hover:text-stone-900">Decide placement…</button>}
          </div>
        )}
      </div>
    </div>
  );
}
