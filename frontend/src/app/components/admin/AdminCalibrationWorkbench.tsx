import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { reportError } from '../../lib/errorReporter';
import { useArchetypes } from './useArchetypes';
import { DimensionsTab, DescriptorsTab, ArchetypeTab, BasisText } from './EvidencePanel';
import {
  setMatch, previewPlacement, placeCoffee, moveCoffee, certifyPlacement, getAcceptancePreview, acceptResponse,
  type ApiFetch, type CatalogWarning,
} from '../../lib/catalogWrites';
import { composeBasis, finalizeBasis, ruleRequired, bandCheck, type BasisInput, type BasisPlacement } from '../../lib/evidenceBasis';

// Cupping evidence brief 4 (2026-10-18): the Calibration workbench, under
// Roastery Feedback (?roastery=<id>&view=workbench). One roastery at a time:
// the queue, the brief 3 evidence tabs (reused, not reimplemented), three
// decision cards. The page never computes or suggests a decision: the only
// default is the current catalog value. Every write goes through an existing
// endpoint (lib/catalogWrites.ts); archetype and placement writes carry the
// basis composed from the rows on screen (lib/evidenceBasis.ts) as text
// (notes / placement_note) and JSON (basis). Cupper labels come from the rows;
// no cupper is named in this file.
// Brief 4b (2026-10-21): readability only. The layout follows the workbench's
// own measured width (not the window): >= 1440 px three panes (queue 260,
// evidence >= 560, decisions 380); 1024 to 1440 the queue becomes a strip of
// chips above evidence | decisions (360); below 1024 one column. Body text-sm,
// labels text-xs uppercase, numbers tabular. Same reads, same writes.

type Row = Record<string, any>;
interface QueueRow {
  coffee_id: number; coffee_name: string; is_placed: boolean; catalog_archetype: string | null; catalog_confidence: string | null;
  catalog_home_slot_name: string | null; assignment_basis_present: boolean | null; evidence_newer_than_decision: boolean | null;
  flag_unreconciled: boolean; n_sources: number; last_cupped: string | null;
}
interface Bundle {
  coffee: Row; dimensions: Row[]; descriptors: Row[]; archetype: Row | null; calls: Row[];
  sessions: Row[]; roasterResponse: Row | null; websiteDescriptors: Row[]; accepted: Row[];
  consensus?: Row[]; history?: Row[]; // brief 6: display only
  customerVoice?: Row[]; // coffee presentation brief 1: every customer-voice row with customer_sees
}
interface Slot {
  id: number; archetype: string; sort_order: number; name: string | null; position_label: string; dimension_id: number | null;
  spec_band_lo: number | null; spec_band_hi: number | null; is_active: boolean;
  occupants: { coffee_id: number; role: string; priority: number }[];
}

const BTN = 'px-3 py-1.5 rounded text-xs uppercase tracking-wide border border-stone-300 text-stone-600 hover:bg-stone-50 disabled:opacity-50';
const BTN_PRIMARY = 'px-4 py-1.5 rounded text-xs uppercase tracking-wide text-white disabled:opacity-50';
const ACCENT = '#a33726';
const EYEBROW = 'text-xs uppercase tracking-wide text-stone-400';
const INPUT = 'border border-stone-300 rounded px-2 py-1.5 text-sm w-full bg-white';
const LABEL = 'block text-xs uppercase tracking-wide text-stone-500 mb-1';
const CARD = 'border border-stone-200 rounded p-4 bg-white text-sm text-stone-700';
const CHIP = 'inline-block rounded px-2 py-0.5 text-xs whitespace-nowrap';
const FLAG_COLOR = '#b7791f';
const NO_BASIS_COLOR = '#b05642';

function dot(color: string, title: string) {
  return <span title={title} aria-label={title} className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />;
}
function warningText(w: CatalogWarning): string {
  return w.kind.replace(/_/g, ' ') + (typeof w.dimension === 'string' ? ` (${w.dimension})` : '');
}
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** The workbench's own width, so the layout follows the content area, not the window. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setWidth(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref as React.RefObject<T>, width];
}

export default function AdminCalibrationWorkbench({ roasterId, apiFetch, onBack, onOpenAcceptance }: {
  roasterId: string; apiFetch: ApiFetch; onBack: () => void; onOpenAcceptance: (portalCoffeeId: string) => void;
}) {
  const { archetypes } = useArchetypes();
  const [queue, setQueue] = useState<QueueRow[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [tab, setTab] = useState<'dimensions' | 'descriptors' | 'archetype'>('archetype');
  const [error, setError] = useState('');
  const [rootRef, width] = useWidth<HTMLDivElement>();
  const mode: 'wide' | 'mid' | 'narrow' = width >= 1440 ? 'wide' : width >= 1024 ? 'mid' : 'narrow';

  const loadQueue = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/admin/evidence/workbench/${roasterId}`);
      if (!res.ok) throw new Error('Failed to load the queue');
      const rows: QueueRow[] = await res.json();
      setQueue(rows);
      setSelected(s => s ?? rows[0]?.coffee_id ?? null);
    } catch (err) { reportError('[Workbench/queue]', err); setError('Failed to load the queue'); }
  }, [apiFetch, roasterId]);

  const loadCoffee = useCallback(async (coffeeId: number) => {
    try {
      const [b, s] = await Promise.all([
        apiFetch(`/api/admin/evidence/workbench/coffee/${coffeeId}`),
        apiFetch('/api/admin/catalog/slots'),
      ]);
      if (!b.ok || !s.ok) throw new Error('Failed to load the coffee');
      setBundle(await b.json());
      setSlots(await s.json());
    } catch (err) { reportError('[Workbench/coffee]', err); setError('Failed to load the coffee'); }
  }, [apiFetch]);

  useEffect(() => { void loadQueue(); }, [loadQueue]);
  useEffect(() => { if (selected) { setBundle(null); void loadCoffee(selected); } }, [selected, loadCoffee]);

  const refresh = useCallback(async () => {
    await loadQueue();
    if (selected) await loadCoffee(selected);
  }, [loadQueue, loadCoffee, selected]);

  const counters = useMemo(() => ({
    flagged: (queue ?? []).filter(q => q.flag_unreconciled).length,
    noBasis: (queue ?? []).filter(q => q.assignment_basis_present === false).length,
    placedUncupped: (queue ?? []).filter(q => q.is_placed && !q.last_cupped).length,
  }), [queue]);

  const roasterName = bundle?.coffee?.roaster_name ?? '';
  const explanation = 'Evidence beside the decision. Nothing here suggests an answer: each form starts from the current catalog value, and every archetype or placement write carries a basis composed from the rows on screen. The writes are the catalog\'s own.';

  const counterLine = (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600">
      <span className="inline-flex items-center gap-1.5">{dot(FLAG_COLOR, 'flagged to reconcile')}flagged <strong className="tabular-nums">{counters.flagged}</strong></span>
      <span className="inline-flex items-center gap-1.5">{dot(NO_BASIS_COLOR, 'no basis')}no basis <strong className="tabular-nums">{counters.noBasis}</strong></span>
      <span>placed, uncupped <strong className="tabular-nums">{counters.placedUncupped}</strong></span>
    </div>
  );
  const dots = (q: QueueRow) => (
    <>
      {dot(q.flag_unreconciled ? FLAG_COLOR : '#d6d3d1', q.flag_unreconciled ? 'flagged to reconcile' : 'no flag')}
      {dot(q.assignment_basis_present === true ? '#15803d' : q.assignment_basis_present === false ? NO_BASIS_COLOR : '#d6d3d1',
        q.assignment_basis_present === true ? 'basis present' : q.assignment_basis_present === false ? 'no basis' : 'no assignment')}
    </>
  );
  const subLine = (q: QueueRow) =>
    `${q.catalog_archetype ?? 'no archetype'}${q.catalog_confidence ? ` · ${q.catalog_confidence}` : ''} · ${q.catalog_home_slot_name ?? 'not placed'} · ${q.n_sources} sources`;

  // ── queue: a list (wide) or a strip of chips (mid, narrow) ──
  const queueList = queue && (
    <div className="space-y-3">
      {counterLine}
      <ul className="border border-stone-200 rounded bg-white divide-y divide-stone-100">
        {queue.map(q => (
          <li key={q.coffee_id}>
            <button onClick={() => setSelected(q.coffee_id)}
              className={`w-full text-left pl-3 pr-2 py-2 border-l-4 hover:bg-stone-50 ${selected === q.coffee_id ? 'bg-stone-50' : 'border-transparent'}`}
              style={selected === q.coffee_id ? { borderLeftColor: ACCENT } : undefined}>
              <div className="flex items-center gap-1.5">{dots(q)}<span className="text-sm font-medium text-stone-800">{q.coffee_name}</span></div>
              <div className="text-xs text-stone-500 mt-0.5 ml-[26px]">
                {subLine(q)}{q.evidence_newer_than_decision && <span style={{ color: FLAG_COLOR }}> · newer evidence</span>}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
  const queueStrip = queue && (
    <div className="flex items-start gap-4">
      <div className="shrink-0 pt-2 w-36">{counterLine}</div>
      <div className="flex gap-2 overflow-x-auto pb-2 min-w-0">
        {queue.map(q => (
          <button key={q.coffee_id} onClick={() => setSelected(q.coffee_id)}
            className="shrink-0 text-left border border-stone-200 rounded bg-white px-3 py-2 border-l-4 hover:bg-stone-50"
            style={{ borderLeftColor: selected === q.coffee_id ? ACCENT : '#e7e5e4', width: '15rem' }}>
            <div className="flex items-center gap-1.5">{dots(q)}<span className="text-sm font-medium text-stone-800 truncate" title={q.coffee_name}>{q.coffee_name}</span></div>
            <div className="text-xs text-stone-500 mt-0.5 truncate" title={subLine(q)}>{subLine(q)}</div>
          </button>
        ))}
      </div>
    </div>
  );

  const homeSlot = bundle ? slots.find(s => s.occupants.some(o => o.coffee_id === Number(bundle.coffee.id) && o.role === 'home')) : undefined;
  const homePriority = bundle && homeSlot ? homeSlot.occupants.find(o => o.coffee_id === Number(bundle.coffee.id))?.priority ?? null : null;
  const websiteRows = bundle?.websiteDescriptors ?? [];

  const evidence = (
    <div className="min-w-0">
      {!bundle ? <p className="text-sm text-stone-400">Loading…</p> : (
        <div className="bg-stone-50 border border-stone-200 rounded p-4 text-sm text-stone-700">
          <div className="flex flex-wrap items-baseline gap-1 mb-4">
            <span className="text-base text-stone-800 mr-3">{bundle.coffee.name}</span>
            {(['archetype', 'dimensions', 'descriptors'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs uppercase tracking-wide border-b-2 ${tab === t ? 'border-stone-700 text-stone-800' : 'border-transparent text-stone-400 hover:text-stone-700'}`}>
                {t === 'archetype' ? 'Archetype & slot' : t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          {tab === 'dimensions' && <DimensionsTab rows={bundle.dimensions} history={bundle.history} />}
          {tab === 'descriptors' && (
            <DescriptorsTab rows={bundle.descriptors} consensus={bundle.consensus} customerVoice={bundle.customerVoice}
              website={websiteRows.map(w => ({ id: w.id, remark: String(w.remark), node: w.cupping_note_descriptor ?? null }))}
              websiteSource={websiteRows.length ? `${websiteRows[0].said_by}, ${String(websiteRows[0].said_on).slice(0, 10)}` : null} />
          )}
          {tab === 'archetype' && (
            <ArchetypeTab archetype={bundle.archetype} calls={bundle.calls} homePriority={homePriority}
              roasterForm={bundle.roasterResponse ? { version: num(bundle.roasterResponse.version), respondent: bundle.roasterResponse.respondent_name ?? null } : null}
              website={websiteRows.map(w => String(w.remark))} />
          )}
        </div>
      )}
    </div>
  );

  const decisions = (
    <div className="space-y-4 min-w-0">
      {bundle && bundle.archetype && (
        <>
          <ArchetypeCard key={`a-${bundle.coffee.id}`} bundle={bundle} archetypes={archetypes} apiFetch={apiFetch} onWritten={refresh} />
          <SlotCard key={`s-${bundle.coffee.id}`} bundle={bundle} slots={slots} archetypes={archetypes} apiFetch={apiFetch} onWritten={refresh} />
          <DescriptorCard key={`d-${bundle.coffee.id}`} bundle={bundle} apiFetch={apiFetch} onWritten={refresh} onOpenAcceptance={onOpenAcceptance} />
        </>
      )}
    </div>
  );

  return (
    <div ref={rootRef} className="space-y-4" data-workbench-mode={mode}>
      <div>
        <button className="text-xs uppercase tracking-wide text-stone-500 mb-1" onClick={onBack}>← Back to the roastery</button>
        <h2 className="text-lg flex items-center gap-2">
          Calibration workbench{roasterName ? `: ${roasterName}` : ''}
          <span title={explanation} aria-label={explanation}
            className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-stone-300 text-xs text-stone-500 cursor-help">i</span>
        </h2>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!queue ? <p className="text-sm text-stone-400">{error || 'Loading…'}</p> : mode === 'wide' ? (
        <div className="grid items-start" style={{ gridTemplateColumns: '260px minmax(560px, 1fr) 380px', gap: 24 }}>
          {queueList}{evidence}{decisions}
        </div>
      ) : mode === 'mid' ? (
        <div className="space-y-4">
          {queueStrip}
          <div className="grid items-start" style={{ gridTemplateColumns: 'minmax(560px, 1fr) 360px', gap: 24 }}>
            {evidence}{decisions}
          </div>
        </div>
      ) : (
        <div className="space-y-4">{queueStrip}{evidence}{decisions}</div>
      )}
    </div>
  );
}

// The composed basis input for this coffee: the rows on screen, the session the decision rests on.
function basisInput(bundle: Bundle, sessionId: number | null, placement?: BasisPlacement | null): BasisInput {
  const a = bundle.archetype!;
  return {
    archetype: {
      assigned_from_session_id: num(a.assigned_from_session_id), latest_session_id: num(a.latest_session_id),
      is_blind: a.is_blind ?? null, roaster_present: a.roaster_present ?? null,
      roaster_form_proposal: a.roaster_form_proposal ?? null, roaster_remark_proposals: a.roaster_remark_proposals ?? null,
    },
    calls: bundle.calls.map(c => ({ cupper_id: Number(c.cupper_id), cupper_name: String(c.cupper_name), session_id: num(c.session_id), archetype_call: c.archetype_call ?? null })),
    sessionId,
    roasterForm: bundle.roasterResponse ? { version: num(bundle.roasterResponse.version), respondent: bundle.roasterResponse.respondent_name ?? null } : null,
    website: bundle.websiteDescriptors.map(w => String(w.remark)),
    placement: placement ?? null,
  };
}

function SessionSelect({ bundle, value, onChange }: { bundle: Bundle; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <select className={INPUT} value={value ?? ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">no session (manual)</option>
      {bundle.sessions.map(s => (
        <option key={s.session_id} value={s.session_id}>s{s.session_id} · {String(s.session_date).slice(0, 10)}{s.is_blind ? ' · blind' : ''}</option>
      ))}
    </select>
  );
}

function CardTitle({ title, current }: { title: string; current: React.ReactNode }) {
  return (
    <p className="mb-3 leading-snug">
      <span className={EYEBROW}>{title}</span>
      <span className="text-stone-300"> · </span>
      <span className="text-sm text-stone-800">{current}</span>
    </p>
  );
}

/** Amber band above the rule input when the decision is not what every source said. */
function RuleInput({ rule, setRule, needed }: { rule: string; setRule: (v: string) => void; needed: boolean }) {
  return (
    <div className="mt-3">
      {needed && !rule.trim() && (
        <p className="mb-1.5 rounded px-2 py-1 text-sm bg-amber-50 text-amber-800 border border-amber-200">
          A rule is required: the decision is not what every source said.
        </p>
      )}
      <label className={LABEL}>Rule (your words)</label>
      <input className={INPUT} value={rule} onChange={e => setRule(e.target.value)} placeholder={needed ? 'required' : 'optional: empty means "confirmed"'} />
    </div>
  );
}

function Warnings({ warnings, message }: { warnings: CatalogWarning[]; message: string }) {
  if (!warnings.length && !message) return null;
  return (
    <div className="mt-2 text-sm">
      {message && <p className="text-red-700">{message}</p>}
      {warnings.length > 0 && <p className="text-amber-800">Warnings: {warnings.map(warningText).join(', ')}</p>}
    </div>
  );
}

function SubmitRow({ reason, children }: { reason: string | null; children: React.ReactNode }) {
  return (
    <div className="mt-3 flex items-center justify-end gap-3 flex-wrap">
      {reason && <span className="text-sm text-stone-500">{reason}</span>}
      {children}
    </div>
  );
}

function ArchetypeCard({ bundle, archetypes, apiFetch, onWritten }: {
  bundle: Bundle; archetypes: ReturnType<typeof useArchetypes>['archetypes']; apiFetch: ApiFetch; onWritten: () => Promise<void>;
}) {
  const a = bundle.archetype!;
  const current: string = a.catalog_archetype ?? '';
  const [archetype, setArchetype] = useState(current);
  const [confidence, setConfidence] = useState<string>(a.catalog_confidence ?? 'low');
  const [sessionId, setSessionId] = useState<number | null>(num(bundle.sessions[0]?.session_id));
  const [rule, setRule] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [warnings, setWarnings] = useState<CatalogWarning[]>([]);

  const input = basisInput(bundle, sessionId);
  const composed = composeBasis(input);
  const needed = ruleRequired(input, archetype || null);
  const final = finalizeBasis(composed, rule);
  const source = sessionId ? 'cupping' : 'manual';
  const label = (code: string | null) => (code ? archetypes.find(x => x.code === code)?.label ?? code : '—');
  const reason = !archetype ? 'pick an archetype' : needed && !rule.trim() ? 'type a rule' : null;

  async function submit() {
    setSaving(true); setMessage(''); setWarnings([]);
    try {
      const res = await setMatch(apiFetch, Number(bundle.coffee.id), { archetype, confidence, source, sessionId, notes: final.note, basis: final.json as unknown as Record<string, unknown> });
      setWarnings(res.warnings ?? []);
      await onWritten();
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Failed'); } finally { setSaving(false); }
  }

  return (
    <div className={CARD}>
      <CardTitle title="Archetype" current={<>
        {label(current || null)}{a.catalog_confidence ? ` · ${a.catalog_confidence}` : ''}{a.catalog_source ? ` · ${a.catalog_source}` : ''}
        {a.assigned_from_session_id ? ` · s${a.assigned_from_session_id}` : ''}
      </>} />
      {bundle.calls.length === 0 && <p className="mb-2" style={{ color: ACCENT }}>No Axis &amp; Bloom cupping; assignment is a guess until cupped.</p>}
      {a.evidence_newer_than_decision && <p className="mb-2 text-amber-800">Newer evidence since this decision (s{a.latest_session_id}).</p>}
      <div className="grid grid-cols-2" style={{ gap: 12 }}>
        <label className="min-w-0"><span className={LABEL}>Archetype</span>
          <select className={INPUT} value={archetype} onChange={e => setArchetype(e.target.value)}>
            <option value="">— select —</option>
            {archetypes.map(x => <option key={x.code} value={x.code}>{x.label}</option>)}
          </select>
        </label>
        <label className="min-w-0"><span className={LABEL}>Confidence</span>
          <select className={INPUT} value={confidence} onChange={e => setConfidence(e.target.value)}>
            <option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
          </select>
        </label>
        <label className="min-w-0"><span className={LABEL}>Session</span><SessionSelect bundle={bundle} value={sessionId} onChange={setSessionId} /></label>
        <div className="min-w-0"><span className={LABEL}>Source</span><p className="py-1.5 text-stone-700">{source}</p></div>
      </div>
      <RuleInput rule={rule} setRule={setRule} needed={needed} />
      <div className="mt-3"><p className={`${EYEBROW} mb-1`}>Basis</p><BasisText text={final.note} /></div>
      <SubmitRow reason={reason}>
        <button className={BTN_PRIMARY} style={{ backgroundColor: ACCENT }} disabled={saving || !!reason} onClick={submit}>
          {saving ? '…' : archetype === current ? 'Confirm' : 'Change'}
        </button>
      </SubmitRow>
      <Warnings warnings={warnings} message={message} />
    </div>
  );
}

function SlotCard({ bundle, slots, archetypes, apiFetch, onWritten }: {
  bundle: Bundle; slots: Slot[]; archetypes: ReturnType<typeof useArchetypes>['archetypes']; apiFetch: ApiFetch; onWritten: () => Promise<void>;
}) {
  const coffeeId = Number(bundle.coffee.id);
  const a = bundle.archetype!;
  const decaf = (bundle.coffee.category_codes ?? []).includes('decaf');
  const home = slots.find(s => s.occupants.some(o => o.coffee_id === coffeeId && o.role === 'home'));
  const homePriority = home?.occupants.find(o => o.coffee_id === coffeeId)?.priority ?? null;
  const archetype: string | null = a.catalog_archetype ?? null;
  const choices = slots.filter(s => s.is_active && s.archetype === archetype).sort((x, y) => x.sort_order - y.sort_order);
  const [slotId, setSlotId] = useState<number | null>(home?.id ?? null);
  const [priority, setPriority] = useState('');
  const [sessionId, setSessionId] = useState<number | null>(num(bundle.sessions[0]?.session_id));
  const [rule, setRule] = useState('');
  const [certifiedBy, setCertifiedBy] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [warnings, setWarnings] = useState<CatalogWarning[]>([]);
  const [previewed, setPreviewed] = useState<CatalogWarning[] | null>(null);

  const dominant = archetypes.find(x => x.code === archetype);
  const placementFor = (slot: Slot | undefined): BasisPlacement | null => {
    if (!slot) return null;
    const dimId = slot.dimension_id ?? dominant?.dominant_dimension_id ?? null;
    const d = bundle.dimensions.find(r => Number(r.dimension_id) === dimId);
    return {
      slotId: slot.id, dimensionId: dimId, dimensionName: d?.dimension_name ?? dominant?.dominant_dimension_name ?? null,
      mergedMin: num(d?.merged_min), mergedMax: num(d?.merged_max), mergedSessionId: num(d?.merged_session_id),
      bandLo: num(slot.spec_band_lo), bandHi: num(slot.spec_band_hi),
    };
  };
  const chosen = choices.find(s => s.id === slotId);
  const placement = placementFor(chosen);
  const input = basisInput(bundle, sessionId, placement);
  const composed = composeBasis(input);
  const check = placement ? bandCheck(placement.mergedMin, placement.mergedMax, placement.bandLo, placement.bandHi) : null;
  const needed = ruleRequired(input, archetype, check);
  const final = finalizeBasis(composed, rule);
  const reason = !slotId ? 'pick a slot' : home?.id === slotId ? 'already its home' : needed && !rule.trim() ? 'type a rule' : null;

  async function run(fn: () => Promise<{ warnings?: CatalogWarning[] } | unknown>) {
    setSaving(true); setMessage(''); setWarnings([]);
    try {
      const res = await fn() as { warnings?: CatalogWarning[] };
      setWarnings(res?.warnings ?? []);
      await onWritten();
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Failed'); } finally { setSaving(false); }
  }
  async function preview() {
    if (!slotId) return;
    setMessage('');
    try { setPreviewed((await previewPlacement(apiFetch, coffeeId, slotId, 'home')).warnings ?? []); }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Preview failed'); }
  }
  const body = {
    priority: priority ? Number(priority) : undefined, placementNote: final.note,
    basis: final.json as unknown as Record<string, unknown>, placedFromSessionId: sessionId,
  };
  const checkChip = (c: string) => (
    <span className={`${CHIP} ${c === 'out_of_band' ? 'bg-red-100 text-red-800' : c === 'in_band' ? 'bg-green-100 text-green-800' : 'bg-stone-100 text-stone-500'}`}>
      {c.replace(/_/g, ' ')}
    </span>
  );

  return (
    <div className={CARD}>
      <CardTitle title="Dial slot" current={home ? `${home.name ?? home.position_label} (${home.archetype}/${home.sort_order})${homePriority ? ` · priority ${homePriority}` : ''}` : 'not placed'} />
      {decaf ? (
        <p className="text-stone-500">Decaf: decaf coffees are left out of the dial's sellable slots by the category rule, so this card is closed.</p>
      ) : !archetype ? (
        <p className="text-stone-500">Set the archetype first; the slots are that archetype's.</p>
      ) : (
        <>
          <div className="space-y-1">
            {choices.map(s => {
              const p = placementFor(s)!;
              const c = bandCheck(p.mergedMin, p.mergedMax, p.bandLo, p.bandHi);
              const slotName = `${s.sort_order} · ${s.name ?? s.position_label}`;
              const noBand = p.bandLo === null && p.bandHi === null;
              return (
                // radio · name (never wraps: truncated with a title, and it is the column that gives way) ·
                // band and merged on one line at their natural width, the check as a chip when there is a band
                <label key={s.id} className="grid items-center gap-2 py-0.5 cursor-pointer" style={{ gridTemplateColumns: '1.5rem minmax(0, 12rem) auto' }}>
                  <input type="radio" name={`slot-${coffeeId}`} checked={slotId === s.id} onChange={() => { setSlotId(s.id); setPreviewed(null); }} />
                  <span className="truncate" title={slotName}>{slotName}</span>
                  <span className="flex items-center gap-1.5 tabular-nums whitespace-nowrap justify-self-end">
                    <span className={noBand ? 'text-stone-400' : ''}>{noBand ? 'no band' : `band ${num(p.bandLo) ?? '—'}–${num(p.bandHi) ?? '—'}`}</span>
                    <span className="text-stone-500">· merged {p.mergedMin ?? '—'}–{p.mergedMax ?? '—'}</span>
                    {!noBand && checkChip(c)}
                  </span>
                </label>
              );
            })}
            {choices.length > 0 && <p className="text-xs text-stone-500">Band and merged range on {placementFor(choices[0])?.dimensionName ?? 'the slot\'s dimension'}.</p>}
          </div>
          <div className="grid grid-cols-2 mt-3" style={{ gap: 12 }}>
            <label className="min-w-0"><span className={LABEL}>Session</span><SessionSelect bundle={bundle} value={sessionId} onChange={setSessionId} /></label>
            <label className="min-w-0"><span className={LABEL}>Priority</span><input className={INPUT} value={priority} onChange={e => setPriority(e.target.value.replace(/\D/g, ''))} placeholder="next free" /></label>
          </div>
          <RuleInput rule={rule} setRule={setRule} needed={needed} />
          <div className="mt-3"><p className={`${EYEBROW} mb-1`}>Placement basis</p><BasisText text={final.note} /></div>
          {previewed && <p className="mt-2 text-stone-500">Preview: {previewed.length ? previewed.map(warningText).join(', ') : 'no warnings'}</p>}
          <SubmitRow reason={reason}>
            <button className={BTN} disabled={!slotId} onClick={preview}>Preview</button>
            <button className={BTN_PRIMARY} style={{ backgroundColor: ACCENT }} disabled={saving || !!reason}
              onClick={() => run(() => home
                ? moveCoffee(apiFetch, coffeeId, { toSlotId: slotId!, ...body })
                : placeCoffee(apiFetch, coffeeId, { slotId: slotId!, role: 'home', ...body }))}>
              {saving ? '…' : home ? 'Move' : 'Place'}
            </button>
          </SubmitRow>
          {home && (
            <div className="mt-3 flex items-center gap-2">
              <input className={INPUT} value={certifiedBy} onChange={e => setCertifiedBy(e.target.value)} placeholder="certified by" />
              <button className={BTN} disabled={saving || !certifiedBy.trim()}
                onClick={() => run(() => certifyPlacement(apiFetch, coffeeId, home.id, { by: certifiedBy.trim(), note: final.note }))}>Certify</button>
            </div>
          )}
        </>
      )}
      <Warnings warnings={warnings} message={message} />
    </div>
  );
}

interface PreviewNote {
  rank: number; roasterWords: string;
  roasterPick: { cuppingNoteId: string; descriptor: string; wheelCategory: string } | null;
  suggestion: { cuppingNoteId: string; descriptor: string; wheelCategory: string } | null;
  defaultCuppingNoteId: string | null; alreadyActive: boolean;
}
interface AcceptancePreview {
  response: { id: string; portalCoffeeId: string; version: number };
  basics: { field: string }[];
  notes: PreviewNote[];
}

function DescriptorCard({ bundle, apiFetch, onWritten, onOpenAcceptance }: {
  bundle: Bundle; apiFetch: ApiFetch; onWritten: () => Promise<void>; onOpenAcceptance: (portalCoffeeId: string) => void;
}) {
  const responseId: string | null = bundle.roasterResponse?.response_id ?? null;
  const [preview, setPreview] = useState<AcceptancePreview | null>(null);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    if (!responseId) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await getAcceptancePreview<AcceptancePreview>(apiFetch, responseId);
        if (!cancelled) { setPreview(p); setChecked(Object.fromEntries(p.notes.map(n => [n.rank, n.alreadyActive]))); }
      } catch (err) { if (!cancelled) setMessage(err instanceof Error ? err.message : 'Failed to load the roaster notes'); }
    })();
    return () => { cancelled = true; };
  }, [apiFetch, responseId]);

  const familyOf = (category: string | undefined) => bundle.descriptors.find(d => d.family === category);
  const ours = bundle.descriptors.filter(d => d.extra);
  const kindChip = (kind: string) => (
    <span className={`${CHIP} ${kind === 'hit' ? 'bg-green-100 text-green-800' : kind === 'miss' ? 'bg-amber-100 text-amber-800' : 'bg-stone-200 text-stone-700'}`}>{kind}</span>
  );

  async function accept() {
    if (!preview) return;
    setSaving(true); setMessage(''); setDone('');
    try {
      // Same items the existing acceptance view sends: no basics; every already-active note
      // stays included (so nothing is retired), the ticked ones are added at their term.
      await acceptResponse(apiFetch, preview.response.id, {
        basics: Object.fromEntries(preview.basics.map(b => [b.field, { include: false }])),
        notes: preview.notes.map(n => ({
          rank: n.rank, include: !!n.defaultCuppingNoteId && (n.alreadyActive || !!checked[n.rank]),
          cuppingNoteId: n.defaultCuppingNoteId, remember: false,
        })),
      });
      setDone('Accepted.');
      await onWritten();
      setPreview(await getAcceptancePreview<AcceptancePreview>(apiFetch, preview.response.id));
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Failed'); } finally { setSaving(false); }
  }

  return (
    <div className={CARD}>
      <CardTitle title="Descriptors" current={preview ? `the roaster's, response v${preview.response.version}` : 'the roaster\'s, accepted into the catalog'} />
      {!responseId ? <p className="text-stone-500">No submitted response from the roaster for this coffee.</p> : !preview ? (
        <p className="text-stone-400">{message || 'Loading…'}</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {preview.notes.map(n => {
              const term = n.roasterPick ?? n.suggestion;
              const fam = familyOf(term?.wheelCategory);
              const kind = fam ? (fam.hit ? 'hit' : fam.miss ? 'miss' : fam.extra ? 'extra' : '') : '';
              return (
                <li key={n.rank} className="grid items-start gap-2" style={{ gridTemplateColumns: '1.25rem minmax(0, 1fr) auto' }}>
                  {n.defaultCuppingNoteId ? (
                    <input type="checkbox" className="mt-1" checked={!!checked[n.rank]} disabled={n.alreadyActive}
                      title={n.alreadyActive ? 'already accepted' : 'accept'}
                      onChange={e => setChecked(c => ({ ...c, [n.rank]: e.target.checked }))} />
                  ) : <span />}
                  <span className="min-w-0 break-words">
                    <span className={n.alreadyActive ? 'text-stone-400' : 'text-stone-800'}>{n.roasterWords}</span>{' '}
                    {term ? <span className="text-stone-500">→ {term.descriptor} ({term.wheelCategory})</span> : (
                      <span className="text-stone-400">unmapped · <button className="underline text-stone-600" onClick={() => onOpenAcceptance(preview.response.portalCoffeeId)}>map</button></span>
                    )}
                  </span>
                  <span>{kind && kindChip(kind)}</span>
                </li>
              );
            })}
          </ul>
          <SubmitRow reason={null}>
            {done && <span className="text-green-700">{done}</span>}
            <Link className="text-sm underline text-stone-500" to={`/admin/roastery-portal?roastery=${bundle.coffee.roaster_id}&accept=${preview.response.portalCoffeeId}`}>full acceptance view</Link>
            <button className={BTN_PRIMARY} style={{ backgroundColor: ACCENT }} disabled={saving} onClick={accept}>{saving ? '…' : 'Accept'}</button>
          </SubmitRow>
          {ours.length > 0 && (
            <p className="mt-3 text-xs text-stone-500">Ours only (evidence, never accepted from here): {ours.map(d => d.family).join(', ')}</p>
          )}
        </>
      )}
      {message && preview && <p className="mt-2 text-red-700">{message}</p>}
    </div>
  );
}
