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
// Brief 4b (2026-10-21): readability. Body text-sm, labels text-xs uppercase,
// numbers tabular; the Archetype & slot tab is one column of two definition
// blocks; flags are chips. The workbench reuses these tabs and may pass extra
// display props (roaster form, website notes, home priority); nothing here
// reads or writes anything new.

type Row = Record<string, any>;
interface CoffeeEvidence { dimensions: Row[]; descriptors: Row[]; archetype: Row | null; calls: Row[] }

const TAB = 'px-3 py-1.5 text-xs uppercase tracking-wide border-b-2';
const EYEBROW = 'text-xs uppercase tracking-wide text-stone-400';
const CHIP = 'inline-block rounded px-2 py-0.5 text-xs whitespace-nowrap';
const FLAG_CHIP: Record<string, string> = {
  none: 'bg-stone-100 text-stone-500', one_source: 'bg-stone-100 text-stone-500',
  cuppers_disagree: 'bg-amber-100 text-amber-800', roaster_disagrees: 'bg-amber-100 text-amber-800',
  no_basis: 'bg-amber-100 text-amber-800', stale_decision: 'bg-amber-100 text-amber-800',
  both: 'bg-red-100 text-red-800', out_of_band: 'bg-red-100 text-red-800',
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
export function FlagChip({ flag }: { flag: string | null | undefined }) {
  if (!flag) return <span className="text-stone-400">—</span>;
  return <span className={`${CHIP} ${FLAG_CHIP[flag] ?? 'bg-stone-100 text-stone-600'}`}>{flag.replace(/_/g, ' ')}</span>;
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

  if (!data) return <p className="text-sm text-stone-400 py-2">{error || 'Loading evidence…'}</p>;

  return (
    <div className="bg-stone-50 border border-stone-200 rounded p-4 my-1 text-sm text-stone-700">
      <div className="flex flex-wrap items-center gap-1 mb-3">
        {(['dimensions', 'descriptors', 'archetype'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`${TAB} ${tab === t ? 'border-stone-700 text-stone-800' : 'border-transparent text-stone-400 hover:text-stone-700'}`}>
            {t === 'archetype' ? 'Archetype & slot' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
        <span className="ml-auto text-xs text-stone-400">Read-only. Decisions go through the existing dialogs.</span>
      </div>
      {tab === 'dimensions' && <DimensionsTab rows={data.dimensions} />}
      {tab === 'descriptors' && <DescriptorsTab rows={data.descriptors} />}
      {tab === 'archetype' && (
        <ArchetypeTab archetype={data.archetype} calls={data.calls} onDecideMatch={onDecideMatch} onDecidePlace={onDecidePlace} />
      )}
    </div>
  );
}

// ── Dimensions ─────────────────────────────────────────────────────────────
export function DimensionsTab({ rows }: { rows: Row[] }) {
  if (!rows.length) return <p className="text-stone-400">No numeric cupping rows for this coffee.</p>;
  const cuppers = [...new Map(rows.map(r => [r.cupper_id, r.cupper_name])).entries()];
  const dims = [...new Map(rows.map(r => [r.dimension_id, r])).values()];
  const cell = (dimensionId: number, cupperId: number) => rows.find(r => r.dimension_id === dimensionId && r.cupper_id === cupperId);
  const TH = 'py-1.5 pr-4 font-normal text-xs uppercase tracking-wide text-stone-400 align-bottom';
  const TD = 'py-1.5 pr-4 align-top';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-left">
            <th className={TH}>Dimension</th>
            {cuppers.map(([id, name]) => <th key={id} className={`${TH} min-w-[56px]`}>{name}</th>)}
            <th className={`${TH} min-w-[56px]`}>Merged</th>
            <th className={`${TH} min-w-[56px]`}>Roaster 1–5</th>
            <th className={TH}>Rank (ours / theirs) of n</th>
            <th className={TH}>Flag</th>
          </tr>
        </thead>
        <tbody>
          {dims.map(d => (
            <tr key={d.dimension_id} className="border-t border-stone-200">
              <td className={`${TD} whitespace-nowrap`}>{d.dimension_name}</td>
              {cuppers.map(([id]) => {
                const c = cell(d.dimension_id, id);
                return (
                  <td key={id} className={`${TD} whitespace-nowrap`}>
                    {c ? range(c.cupper_min, c.cupper_max) : '—'}
                    {c && c.cupper_scale_code !== 'ab_0_15' && <span className="block text-xs text-stone-400">{c.cupper_scale_code}</span>}
                  </td>
                );
              })}
              <td className={`${TD} whitespace-nowrap`}>
                {range(d.merged_min, d.merged_max)}
                {d.merged_session_id && (
                  <Link to="/admin/cupping" className="block text-xs text-stone-400 underline">s{d.merged_session_id}{d.all_ab_scale === false ? ' · converted' : ''}</Link>
                )}
              </td>
              <td className={TD}>{num(d.roaster_value_1_5)}</td>
              <td className={`${TD} whitespace-nowrap`}>
                {d.rank_gap === null || d.rank_gap === undefined ? '—' : `${num(d.ab_rank_in_lineup)} / ${num(d.roaster_rank_in_lineup)} of ${d.lineup_n}`}
              </td>
              <td className={TD}><FlagChip flag={d.flag} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-stone-500">Rank: among this roastery's coffees scored by both sides; a gap of 2 or more flags. Values on the 0 to 15 line; the roaster's 1 to 5 is relative to its own lineup.</p>
    </div>
  );
}

// ── Descriptors ────────────────────────────────────────────────────────────
export interface WebsiteNote { id: string | number; remark: string; node: string | null }
export function DescriptorsTab({ rows, website, websiteSource }: {
  rows: Row[]; website?: WebsiteNote[]; websiteSource?: string | null;
}) {
  const style = (r: Row) => r.hit ? 'bg-green-100 text-green-800' : r.miss ? 'bg-amber-100 text-amber-800' : r.extra ? 'bg-stone-200 text-stone-700' : 'bg-white text-stone-500 border border-stone-200';
  const kind = (r: Row) => r.hit ? 'hit' : r.miss ? 'miss' : r.extra ? 'extra' : 'other';
  const yes = (v: unknown) => (v ? <span className="text-stone-800">yes</span> : <span className="text-stone-300">—</span>);
  const TH = 'py-1.5 pr-4 font-normal text-xs uppercase tracking-wide text-stone-400 text-left';
  return (
    <div className="space-y-4">
      {!rows.length ? <p className="text-stone-400">No family named by anyone yet.</p> : (
        <>
          <div className="flex flex-wrap gap-2">
            {rows.map(r => (
              <span key={r.family_id} className={`rounded px-2 py-1 text-sm ${style(r)}`}>
                {r.family} <span className="opacity-70">· {kind(r)}</span>
              </span>
            ))}
          </div>
          <div>
            <p className={`${EYEBROW} mb-1`}>Who named it</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr>
                  <th className={TH}>Family</th><th className={TH}>Cuppers</th><th className={TH}>Roaster form</th>
                  <th className={TH}>Roaster remark</th><th className={TH}>Roaster website</th><th className={TH}>Customer</th><th className={TH}>Accepted</th>
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.family_id} className="border-t border-stone-200">
                      <td className="py-1.5 pr-4 whitespace-nowrap">{r.family}</td>
                      <td className="py-1.5 pr-4">{(r.named_by_cuppers ?? []).length ? r.named_by_cuppers.join(', ') : <span className="text-stone-300">—</span>}</td>
                      <td className="py-1.5 pr-4">{yes(r.named_by_roaster_form)}</td>
                      <td className="py-1.5 pr-4">{yes(r.named_by_roaster_remark)}</td>
                      <td className="py-1.5 pr-4">{yes(r.named_by_roaster_website)}</td>
                      <td className="py-1.5 pr-4">{yes(r.named_by_customer)}</td>
                      <td className="py-1.5 pr-4">{yes(r.accepted_in_catalog)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-stone-500">hit: we and the roaster · miss: roaster only · extra: we only. Families by the SCA tree.</p>
          </div>
        </>
      )}
      {website && website.length > 0 && (
        <div>
          <p className={`${EYEBROW} mb-1`}>Website, latest capture{websiteSource ? ` (${websiteSource})` : ''}</p>
          <ul className="space-y-0.5">
            {website.map(w => (
              <li key={w.id}>
                {w.remark} {w.node ? <span className="text-stone-500">→ {w.node}</span> : <span className="text-stone-400">· unmapped</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Archetype & slot ───────────────────────────────────────────────────────
// Cupping evidence brief 4: the three tabs are exported so the Calibration
// workbench reuses them as its centre column; there the decision cards sit
// beside them, so the Decide links are optional. Brief 4b: one column, two
// blocks; a long value takes its own full-width row under its label.

function Def({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  if (wide) {
    return (
      <div className="col-span-2 py-1">
        <dt className="text-stone-500">{label}</dt>
        <dd className="mt-0.5 break-words">{children ?? '—'}</dd>
      </div>
    );
  }
  return (
    <>
      <dt className="py-1 text-stone-500">{label}</dt>
      <dd className="py-1 break-words min-w-0">{children ?? '—'}</dd>
    </>
  );
}
const DL = 'grid gap-x-4 text-sm';
const DL_COLS = { gridTemplateColumns: '11rem minmax(0, 1fr)' };
const yesNo = (v: boolean | null | undefined) => (v === null || v === undefined ? '—' : v ? 'yes' : 'no');

/** The basis line with its `rule:` part on its own bold line. */
export function BasisText({ text }: { text: string }) {
  const i = text.lastIndexOf('; rule: ');
  const composed = i >= 0 ? text.slice(0, i) : text;
  const rule = i >= 0 ? text.slice(i + 2) : null;
  return (
    <div className="border border-stone-200 bg-white rounded px-3 py-2 text-sm text-stone-700 break-words" style={{ lineHeight: 1.6 }}>
      {composed}
      {rule && <div className="font-semibold text-stone-800">{rule}</div>}
    </div>
  );
}

export function ArchetypeTab({ archetype: a, calls, onDecideMatch, onDecidePlace, roasterForm, website, homePriority }: {
  archetype: Row | null; calls: Row[]; onDecideMatch?: () => void; onDecidePlace?: () => void;
  /** display only (the workbench has them): the submitted form's version and respondent, the latest website capture, the home priority */
  roasterForm?: { version: number | null; respondent: string | null } | null;
  website?: string[];
  homePriority?: number | null;
}) {
  if (!a) return <p className="text-stone-400">No row for this coffee.</p>;
  const formLine = a.roaster_form_proposal || roasterForm
    ? <>{a.roaster_form_proposal ?? 'no proposal'}{roasterForm && <span className="text-stone-500"> · v{roasterForm.version ?? '?'}{roasterForm.respondent ? `, ${roasterForm.respondent}` : ''}</span>}</>
    : null;
  return (
    <div className="space-y-5">
      <section>
        <p className={`${EYEBROW} mb-1`}>What the sources say</p>
        <dl className={DL} style={DL_COLS}>
          {calls.length === 0 && <Def label="Cuppers">no Axis &amp; Bloom cupping</Def>}
          {calls.map(c => (
            <Def key={c.cupper_id} label={`${c.cupper_name} (s${c.session_id}, ${c.is_blind ? 'blind' : 'not blind'})`}>
              <span className="font-semibold">{c.archetype_call ?? 'no call'}</span>
              {c.position_call && <span> · {c.position_call}</span>}
              {c.call_note && <span className="block text-stone-500">{c.call_note}</span>}
            </Def>
          ))}
          <Def label="Cuppers agree">{yesNo(a.cupper_calls_agree)}</Def>
          <Def label="Merged call">{a.merged_call ?? 'none'}</Def>
          <Def label="Roaster form proposal">{formLine}</Def>
          <Def label="Roaster remark proposals">{a.roaster_remark_proposals?.length ? a.roaster_remark_proposals.join(', ') : null}</Def>
          {website !== undefined && <Def label="Website">{website.length ? website.slice(0, 3).join(', ') : 'none'}</Def>}
          <Def label="Latest session">
            {a.latest_session_id ? <Link to="/admin/cupping" className="underline">s{a.latest_session_id} · {String(a.latest_session_date).slice(0, 10)}</Link> : null}
          </Def>
          <Def label="Blind / roaster present">{`${a.is_blind ? 'blind' : 'not blind'} · ${a.roaster_present ? 'roaster present' : 'roaster not present'}`}</Def>
        </dl>
      </section>
      <section>
        <p className={`${EYEBROW} mb-1`}>What the catalog says</p>
        <dl className={DL} style={DL_COLS}>
          <Def label="Archetype">{a.catalog_archetype ? `${a.catalog_archetype} · ${a.catalog_confidence ?? '—'} · ${a.catalog_source ?? '—'}` : null}</Def>
          <Def label="Assigned from session">{a.assigned_from_session_id ? `s${a.assigned_from_session_id}` : null}</Def>
          <Def label="Basis" wide>{a.basis ? <BasisText text={a.basis} /> : <span className="text-stone-400">no basis</span>}</Def>
          <Def label="Home slot">{a.catalog_home_slot_name ? `${a.catalog_home_slot_name}${homePriority ? ` · priority ${homePriority}` : ''}` : 'not placed'}</Def>
          {a.placement_note ? <Def label="Placement note" wide>{a.placement_note}</Def> : <Def label="Placement note">{null}</Def>}
          <Def label="Band check">{a.slot_spec_check ? String(a.slot_spec_check).replace(/_/g, ' ') : null}</Def>
          <Def label="Dial signal basis">{a.dial_signal_basis}</Def>
          <Def label="Newer evidence than decision">{yesNo(a.evidence_newer_than_decision)}</Def>
          <Def label="Roaster agrees with catalog">{yesNo(a.roaster_agrees_with_catalog)}</Def>
          <Def label="Flag"><FlagChip flag={a.flag} /></Def>
        </dl>
        {(onDecideMatch || onDecidePlace) && (
          <div className="flex gap-4 mt-3">
            {onDecideMatch && <button onClick={onDecideMatch} className="underline text-stone-600 hover:text-stone-900">Decide archetype…</button>}
            {onDecidePlace && <button onClick={onDecidePlace} className="underline text-stone-600 hover:text-stone-900">Decide placement…</button>}
          </div>
        )}
      </section>
    </div>
  );
}
