import { useCallback, useEffect, useMemo, useState } from 'react';
import { reportError } from '../../lib/errorReporter';

// Cupping evidence brief 3, B2 (2026-10-18): the Calibration tab under
// Roastery Feedback, per roastery. Read-only: GET /api/admin/evidence/roastery/:id
// (v_evidence_roastery_calibration, v_evidence_cupper_calibration,
// v_evidence_coverage, the stale-decision count from v_evidence_archetype,
// through evidenceReads). Nothing here writes, except the one switch below.
// Ella map 13 (2026-11-26): the "On /map" column, a switch per portal
// dimension that holds the roaster's ratings on it back from the /map panel
// (POST /api/admin/roastery-portal/roasteries/:id/dimension-holds,
// roasteryPortalService.setDimensionHold; a reason each way). The roaster's
// answers never change. Read through v_roastery_portal_dimension_hold.

type Row = Record<string, any>;
interface RoasteryEvidence { calibration: Row[]; cuppers: Row[]; coverage: Row[]; staleDecisions: number }
interface DimensionHold { id: number; dimensionId: number; reason: string; createdAt: string; withdrawnAt: string | null; isOpen: boolean }
type ApiFetch = (url: string, options?: RequestInit) => Promise<Response>;

/** Ella map 13: one row's "On /map" switch. Holding or showing again asks for a reason first. */
function HoldSwitch({ roasterId, dimensionId, label, hold, apiFetch, onChanged }: {
  roasterId: string; dimensionId: number; label: string; hold: DimensionHold | null; apiFetch: ApiFetch; onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const held = !!hold;
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const res = await apiFetch(`/api/admin/roastery-portal/roasteries/${roasterId}/dimension-holds`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dimensionId, hold: !held, reason }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Failed to save');
      setEditing(false); setReason(''); onChanged();
    } catch (e) {
      reportError('[CalibrationPanel/hold]', e);
      setErr(e instanceof Error ? e.message : 'Failed to save');
    } finally { setBusy(false); }
  };
  return (
    <div data-testid={`hold-${dimensionId}`}>
      <span className={held ? 'text-amber-700' : ''}>{held ? `hidden (${label})` : 'shown'}</span>
      {held && <span className="block text-stone-400">{hold!.reason}</span>}
      {!editing ? (
        <button type="button" className="ml-2 underline text-stone-500 hover:text-stone-800" onClick={() => setEditing(true)} data-testid="hold-toggle">
          {held ? 'Show on /map' : 'Hide on /map'}
        </button>
      ) : (
        <span className="flex gap-2 mt-1">
          <input className="border border-stone-300 px-1 py-0.5 text-xs flex-1 min-w-[12rem]" placeholder="Reason" value={reason}
            onChange={e => setReason(e.target.value)} data-testid="hold-reason" />
          <button type="button" disabled={busy || !reason.trim()} className="underline disabled:opacity-40" onClick={save} data-testid="hold-save">Save</button>
          <button type="button" className="text-stone-400" onClick={() => { setEditing(false); setErr(''); }}>Cancel</button>
        </span>
      )}
      {err && <span className="block text-red-700">{err}</span>}
    </div>
  );
}

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
  // Ella map 13: the portal's dimensions (label by id) and this roaster's holds
  const [portalDims, setPortalDims] = useState<Map<number, string> | null>(null);
  const [holds, setHolds] = useState<DimensionHold[]>([]);
  const loadHolds = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/admin/roastery-portal/roasteries/${roasterId}/dimension-holds`);
      if (res.ok) setHolds(await res.json());
    } catch (err) { reportError('[CalibrationPanel/holds]', err); }
  }, [apiFetch, roasterId]);
  useEffect(() => {
    void loadHolds();
    (async () => {
      try {
        const res = await apiFetch('/api/admin/roastery-portal/vocabulary');
        if (!res.ok) return;
        const v = await res.json();
        setPortalDims(new Map((v.dimensions ?? []).map((d: { dimensionId: number; label: string }) => [d.dimensionId, d.label])));
      } catch (err) { reportError('[CalibrationPanel/vocabulary]', err); }
    })();
  }, [apiFetch, loadHolds]);

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
          How our cupping lines up with what this roastery says; the only switch is "On /map", which holds the roaster's ratings on a dimension back from the /map panel (their answers never change). Ranks, never values: their 1 to 5 is relative to their own lineup.
          Native-scale (A&amp;B 0 to 15) sessions only. Stale decisions (newer evidence than the decision): <strong>{data.staleDecisions}</strong>.
        </p>
      </div>

      <section>
        <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Rank agreement by dimension</p>
        {data.calibration.length === 0 ? <p className="text-xs text-stone-400">No dimension scored on both sides yet.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="text-stone-400"><th className={TH}>Dimension</th><th className={TH}>n</th><th className={TH}>Rank correlation</th><th className={TH}>Mean rank gap</th><th className={TH}>Inverted</th><th className={TH}>Note</th><th className={TH}>On /map</th></tr></thead>
            <tbody>
              {data.calibration.map(r => (
                <tr key={r.dimension_id} className="border-t border-stone-100">
                  <td className={TD}>{r.dimension_name}</td><td className={TD}>{r.n}</td>
                  <td className={TD}>{num(r.rank_corr, 3)}</td><td className={TD}>{num(r.mean_rank_gap)}</td>
                  <td className={`${TD} ${r.inverted ? 'text-red-700' : ''}`}>{r.inverted === null ? '—' : r.inverted ? 'yes' : 'no'}</td>
                  <td className={`${TD} text-stone-400`}>{r.note ?? ''}</td>
                  <td className={TD}>
                    {portalDims?.has(r.dimension_id) ? (
                      <HoldSwitch roasterId={roasterId} dimensionId={r.dimension_id} label={portalDims.get(r.dimension_id)!}
                        hold={holds.find(h => h.dimensionId === r.dimension_id && h.isOpen) ?? null} apiFetch={apiFetch} onChanged={() => void loadHolds()} />
                    ) : <span className="text-stone-300">—</span>}
                  </td>
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
