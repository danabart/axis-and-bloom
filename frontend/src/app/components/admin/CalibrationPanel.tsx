import { useEffect, useMemo, useState } from 'react';
import { reportError } from '../../lib/errorReporter';

// Cupping evidence brief 3, B2 (2026-10-18): the Calibration tab under
// Roastery Feedback, per roastery. Read-only: GET /api/admin/evidence/roastery/:id
// (v_evidence_roastery_calibration, v_evidence_cupper_calibration,
// v_evidence_coverage, the stale-decision count from v_evidence_archetype,
// through evidenceReads). Nothing here writes.

type Row = Record<string, any>;
interface RoasteryEvidence { calibration: Row[]; cuppers: Row[]; coverage: Row[]; staleDecisions: number }

function num(v: unknown, digits = 2): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits).replace(/\.?0+$/, '') : String(v);
}
const TH = 'py-1 pr-3 font-normal text-left';
const TD = 'py-1 pr-3';

export default function CalibrationPanel({ roasterId, roasterName, apiFetch, onBack }: {
  roasterId: string; roasterName: string | null;
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>;
  onBack: () => void;
}) {
  const [data, setData] = useState<RoasteryEvidence | null>(null);
  const [error, setError] = useState('');
  const [blind, setBlind] = useState<'all' | 'blind' | 'not_blind'>('all');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`/api/admin/evidence/roastery/${roasterId}`);
        if (!res.ok) throw new Error('Failed to load calibration');
        setData(await res.json());
      } catch (err) {
        reportError('[CalibrationPanel/load]', err);
        setError('Failed to load calibration');
      }
    })();
  }, [apiFetch, roasterId]);

  const cuppers = useMemo(() => (data?.cuppers ?? []).filter(r =>
    blind === 'all' || (blind === 'blind' ? r.is_blind === true : r.is_blind === false)), [data, blind]);

  if (!data) return <p className="text-sm text-stone-400">{error || 'Loading…'}</p>;
  const name: string | null = roasterName ?? data.coverage[0]?.roaster_name ?? data.calibration[0]?.roaster_name ?? null;
  const first = data.calibration[0];
  const crosstab: Record<string, Record<string, number>> = first?.archetype_crosstab ?? {};
  const theirs = [...new Set(Object.values(crosstab).flatMap(r => Object.keys(r)))].sort();

  return (
    <div className="space-y-8 text-sm">
      <div>
        <button className="text-xs uppercase tracking-wide text-stone-500 mb-2" onClick={onBack}>← Back to {name ?? 'the roastery'}</button>
        <h2 className="text-lg">Calibration{name ? `: ${name}` : ''}</h2>
        <p className="text-xs text-stone-500">
          Read-only. How our cupping lines up with what this roastery says. Ranks, never values: their 1 to 5 is relative to their own lineup.
          Native-scale (A&amp;B 0 to 15) sessions only. Stale decisions (newer evidence than the decision): <strong>{data.staleDecisions}</strong>.
        </p>
      </div>

      <section>
        <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Rank agreement by dimension</p>
        {data.calibration.length === 0 ? <p className="text-xs text-stone-400">No dimension scored on both sides yet.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="text-stone-400"><th className={TH}>Dimension</th><th className={TH}>n</th><th className={TH}>Rank correlation</th><th className={TH}>Mean rank gap</th><th className={TH}>Inverted</th><th className={TH}>Note</th></tr></thead>
            <tbody>
              {data.calibration.map(r => (
                <tr key={r.dimension_id} className="border-t border-stone-100">
                  <td className={TD}>{r.dimension_name}</td><td className={TD}>{r.n}</td>
                  <td className={TD}>{num(r.rank_corr, 3)}</td><td className={TD}>{num(r.mean_rank_gap)}</td>
                  <td className={`${TD} ${r.inverted ? 'text-red-700' : ''}`}>{r.inverted === null ? '—' : r.inverted ? 'yes' : 'no'}</td>
                  <td className={`${TD} text-stone-400`}>{r.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Archetype: our merged call × their form proposal</p>
          {Object.keys(crosstab).length === 0 ? <p className="text-xs text-stone-400">No calls or proposals yet.</p> : (
            <table className="text-xs">
              <thead><tr className="text-stone-400"><th className={TH}>Ours ↓ / theirs →</th>{theirs.map(t => <th key={t} className={TH}>{t.replace(/_/g, ' ')}</th>)}</tr></thead>
              <tbody>
                {Object.entries(crosstab).map(([ours, cells]) => (
                  <tr key={ours} className="border-t border-stone-100">
                    <td className={TD}>{ours.replace(/_/g, ' ')}</td>
                    {theirs.map(t => <td key={t} className={`${TD} ${ours === t ? 'font-medium text-green-700' : ''}`}>{cells[t] ?? ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Descriptor families, all coffees</p>
          {first ? (
            <p className="text-xs">hit (we and the roaster) <strong>{first.descriptor_hit}</strong> · miss (roaster only) <strong>{first.descriptor_miss}</strong> · extra (we only) <strong>{first.descriptor_extra}</strong></p>
          ) : <p className="text-xs text-stone-400">—</p>}
        </div>
      </section>

      <section>
        <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Coffees</p>
        <table className="w-full text-xs">
          <thead><tr className="text-stone-400"><th className={TH}>Coffee</th><th className={TH}>Placed</th><th className={TH}>Cuppers</th><th className={TH}>Sessions</th><th className={TH}>Portal</th><th className={TH}>Remarks (table / website)</th><th className={TH}>Sources</th><th className={TH}>Catalog</th><th className={TH}>Basis</th><th className={TH}>Unreconciled</th></tr></thead>
          <tbody>
            {data.coverage.map(r => (
              <tr key={r.coffee_id} className="border-t border-stone-100">
                <td className={TD}>{r.coffee_name}</td>
                <td className={TD}>{r.is_placed ? 'yes' : '—'}</td>
                <td className={TD}>{(r.cuppers_with_rows ?? []).join(', ') || '—'}</td>
                <td className={TD}>{r.n_sessions}</td>
                <td className={TD}>{r.has_portal_submitted ? `v${r.portal_version}` : '—'}</td>
                <td className={TD}>{r.has_remark_table ? 'yes' : '—'} / {r.has_remark_website ? 'yes' : '—'}</td>
                <td className={TD}>{r.n_sources}</td>
                <td className={TD}>{r.catalog_archetype ? `${r.catalog_archetype} · ${r.catalog_confidence ?? ''}` : '—'}</td>
                <td className={TD}>{r.assignment_basis_present === null ? '—' : r.assignment_basis_present ? 'yes' : <span className="text-amber-700">missing</span>}</td>
                <td className={`${TD} ${r.flag_unreconciled ? 'text-amber-700' : 'text-stone-400'}`}>{r.flag_unreconciled ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <div className="flex items-center gap-3 mb-1">
          <p className="text-xs text-stone-400 uppercase tracking-wide">Cuppers (all roasteries, native scale)</p>
          {(['all', 'blind', 'not_blind'] as const).map(b => (
            <button key={b} onClick={() => setBlind(b)}
              className={`text-xs ${blind === b ? 'text-stone-800 underline' : 'text-stone-400 hover:text-stone-700'}`}>
              {b === 'all' ? 'all' : b === 'blind' ? 'blind' : 'not blind'}
            </button>
          ))}
        </div>
        <table className="w-full text-xs">
          <thead><tr className="text-stone-400">
            <th className={TH}>Cupper</th><th className={TH}>Dimension</th><th className={TH}>Blind</th><th className={TH}>n</th><th className={TH}>Range width</th>
            <th className={TH}>Gap to other cuppers</th><th className={TH}>Disagreements</th><th className={TH}>Mean |rank gap| to roaster</th><th className={TH}>Rank corr to roaster</th>
            <th className={TH}>Controls (gap to catalog)</th><th className={TH}>Repeats (repeatability)</th>
          </tr></thead>
          <tbody>
            {cuppers.map(r => (
              <tr key={`${r.cupper_id}-${r.dimension_id}-${r.is_blind}`} className="border-t border-stone-100">
                <td className={TD}>{r.cupper_name}</td><td className={TD}>{r.dimension_name}</td>
                <td className={TD}>{r.is_blind === null ? '—' : r.is_blind ? 'yes' : 'no'}</td>
                <td className={TD}>{r.n}</td><td className={TD}>{num(r.mean_range_width)}</td>
                <td className={TD}>{num(r.mean_signed_gap_to_other)} <span className="text-stone-400">(n {r.n_with_other_cupper})</span></td>
                <td className={TD}>{r.n_disagreements}</td>
                <td className={TD}>{num(r.mean_abs_gap_to_roaster_rank)} <span className="text-stone-400">(n {r.n_with_roaster})</span></td>
                <td className={TD}>{num(r.rank_corr_to_roaster, 3)}</td>
                <td className={TD}>{r.n_control} {r.n_control > 0 && <span className="text-stone-400">({num(r.mean_signed_gap_to_catalog)})</span>}</td>
                <td className={TD}>{r.n_repeat} {r.n_repeat > 0 && <span className="text-stone-400">({num(r.repeatability)})</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
