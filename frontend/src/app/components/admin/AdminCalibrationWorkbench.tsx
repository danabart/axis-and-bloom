import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { reportError } from '../../lib/errorReporter';
import { useArchetypes } from './useArchetypes';
import { DimensionsTab, DescriptorsTab, ArchetypeTab } from './EvidencePanel';
import {
  setMatch, previewPlacement, placeCoffee, moveCoffee, certifyPlacement, getAcceptancePreview, acceptResponse,
  type ApiFetch, type CatalogWarning,
} from '../../lib/catalogWrites';
import { composeBasis, finalizeBasis, ruleRequired, bandCheck, type BasisInput, type BasisPlacement } from '../../lib/evidenceBasis';

// Cupping evidence brief 4 (2026-10-18): the Calibration workbench, under
// Roastery Feedback (?roastery=<id>&view=workbench). One roastery at a time:
// the queue on the left, the brief 3 evidence tabs in the centre (reused, not
// reimplemented), three decision cards on the right. The page never computes
// or suggests a decision: the only default is the current catalog value. Every
// write goes through an existing endpoint (lib/catalogWrites.ts); archetype and
// placement writes carry the basis composed from the rows on screen
// (lib/evidenceBasis.ts) as text (notes / placement_note) and JSON (basis).
// Cupper labels come from the rows; no cupper is named in this file.

type Row = Record<string, any>;
interface QueueRow {
  coffee_id: number; coffee_name: string; is_placed: boolean; catalog_archetype: string | null; catalog_confidence: string | null;
  catalog_home_slot_name: string | null; assignment_basis_present: boolean | null; evidence_newer_than_decision: boolean | null;
  flag_unreconciled: boolean; n_sources: number; last_cupped: string | null;
}
interface Bundle {
  coffee: Row; dimensions: Row[]; descriptors: Row[]; archetype: Row | null; calls: Row[];
  sessions: Row[]; roasterResponse: Row | null; websiteDescriptors: Row[]; accepted: Row[];
}
interface Slot {
  id: number; archetype: string; sort_order: number; name: string | null; position_label: string; dimension_id: number | null;
  spec_band_lo: number | null; spec_band_hi: number | null; is_active: boolean;
  occupants: { coffee_id: number; role: string; priority: number }[];
}

const BTN = 'px-3 py-1.5 rounded text-xs uppercase tracking-wide border border-stone-300 text-stone-600 hover:bg-stone-50 disabled:opacity-40';
const BTN_PRIMARY = 'px-3 py-1.5 rounded text-xs uppercase tracking-wide text-white disabled:opacity-40';
const ACCENT = '#a33726';
const INPUT = 'border border-stone-200 rounded px-2 py-1 text-xs w-full bg-transparent';
const CARD = 'border border-stone-200 rounded p-3 bg-white';

function dot(color: string, title: string) {
  return <span title={title} className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ backgroundColor: color }} />;
}
function warningText(w: CatalogWarning): string {
  return w.kind.replace(/_/g, ' ') + (typeof w.dimension === 'string' ? ` (${w.dimension})` : '');
}
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

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

  if (!queue) return <p className="text-sm text-stone-400">{error || 'Loading…'}</p>;
  const roasterName = bundle?.coffee?.roaster_name ?? '';

  return (
    <div className="space-y-4">
      <div>
        <button className="text-xs uppercase tracking-wide text-stone-500 mb-2" onClick={onBack}>← Back to the roastery</button>
        <h2 className="text-lg">Calibration workbench{roasterName ? `: ${roasterName}` : ''}</h2>
        <p className="text-xs text-stone-500">
          Evidence beside the decision. Nothing here suggests an answer: each form starts from the current catalog value, and
          every archetype or placement write carries a basis composed from the rows on screen. The writes are the catalog's own.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(220px, 1fr) minmax(360px, 2fr) minmax(320px, 1.4fr)' }}>
        {/* ── Left: queue ── */}
        <div>
          <div className="flex gap-3 text-xs text-stone-500 mb-2">
            <span>{dot('#b7791f', 'flagged')}flagged <strong>{counters.flagged}</strong></span>
            <span>{dot('#b05642', 'no basis')}no basis <strong>{counters.noBasis}</strong></span>
            <span>placed, uncupped <strong>{counters.placedUncupped}</strong></span>
          </div>
          <ul className="text-xs border border-stone-200 rounded divide-y divide-stone-100 bg-white">
            {queue.map(q => (
              <li key={q.coffee_id}>
                <button onClick={() => setSelected(q.coffee_id)}
                  className={`w-full text-left px-2 py-2 hover:bg-stone-50 ${selected === q.coffee_id ? 'bg-stone-100' : ''}`}>
                  <div className="flex items-center">
                    {dot(q.flag_unreconciled ? '#b7791f' : '#d6d3d1', q.flag_unreconciled ? 'flag to reconcile' : 'no flag')}
                    {dot(q.assignment_basis_present === true ? '#15803d' : q.assignment_basis_present === false ? '#b05642' : '#d6d3d1',
                      q.assignment_basis_present === true ? 'basis present' : q.assignment_basis_present === false ? 'no basis' : 'no assignment')}
                    <span className="text-stone-800">{q.coffee_name}</span>
                  </div>
                  <div className="text-stone-400 ml-5">
                    {q.catalog_archetype ?? 'no archetype'}{q.catalog_confidence ? ` · ${q.catalog_confidence}` : ''} · {q.catalog_home_slot_name ?? 'not placed'} · {q.n_sources} sources
                    {q.evidence_newer_than_decision && <span style={{ color: '#b7791f' }}> · newer evidence</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* ── Centre: the brief 3 evidence ── */}
        <div className="text-xs text-stone-700">
          {!bundle ? <p className="text-stone-400">Loading…</p> : (
            <div className="bg-stone-50 border border-stone-200 rounded p-3">
              <div className="flex gap-1 mb-3">
                {(['archetype', 'dimensions', 'descriptors'] as const).map(t => (
                  <button key={t} onClick={() => setTab(t)}
                    className={`px-3 py-1 text-xs uppercase tracking-wide border-b-2 ${tab === t ? 'border-stone-700 text-stone-800' : 'border-transparent text-stone-400'}`}>
                    {t === 'archetype' ? 'Archetype & slot' : t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              {tab === 'dimensions' && <DimensionsTab rows={bundle.dimensions} />}
              {tab === 'descriptors' && (
                <>
                  <DescriptorsTab rows={bundle.descriptors} />
                  {bundle.websiteDescriptors.length > 0 && (
                    <div className="mt-3">
                      <p className="text-stone-400 uppercase tracking-wide mb-1">Website, latest capture</p>
                      <ul className="space-y-0.5">
                        {bundle.websiteDescriptors.map(w => (
                          <li key={w.id}>{w.remark} <span className="text-stone-400">· website · {w.said_by} · {String(w.said_on).slice(0, 10)}{w.cupping_note_descriptor ? ` → ${w.cupping_note_descriptor}` : ''}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
              {tab === 'archetype' && <ArchetypeTab archetype={bundle.archetype} calls={bundle.calls} />}
            </div>
          )}
        </div>

        {/* ── Right: decisions ── */}
        <div className="space-y-3">
          {bundle && bundle.archetype && (
            <>
              <ArchetypeCard key={`a-${bundle.coffee.id}`} bundle={bundle} archetypes={archetypes} apiFetch={apiFetch} onWritten={refresh} />
              <SlotCard key={`s-${bundle.coffee.id}`} bundle={bundle} slots={slots} archetypes={archetypes} apiFetch={apiFetch} onWritten={refresh} />
              <DescriptorCard key={`d-${bundle.coffee.id}`} bundle={bundle} apiFetch={apiFetch} onWritten={refresh} onOpenAcceptance={onOpenAcceptance} />
            </>
          )}
        </div>
      </div>
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

function Basis({ note, needed, rule }: { note: string; needed: boolean; rule: string }) {
  return (
    <div className="text-[11px] text-stone-500 bg-stone-50 border border-stone-200 rounded p-2 break-words">
      <span className="text-stone-400 uppercase tracking-wide">Basis</span> {note}
      {needed && !rule.trim() && <p className="mt-1" style={{ color: ACCENT }}>A rule is required: the decision is not what every source said.</p>}
    </div>
  );
}

function Warnings({ warnings, message }: { warnings: CatalogWarning[]; message: string }) {
  if (!warnings.length && !message) return null;
  return (
    <div className="text-xs">
      {message && <p className="text-red-600">{message}</p>}
      {warnings.length > 0 && <p className="text-amber-700">Warnings: {warnings.map(warningText).join(', ')}</p>}
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
      <p className="text-xs text-stone-400 uppercase tracking-wide">Archetype</p>
      <p className="text-sm text-stone-800 mb-2">
        {label(current || null)}{a.catalog_confidence ? ` · ${a.catalog_confidence}` : ''}{a.catalog_source ? ` · ${a.catalog_source}` : ''}
        {a.assigned_from_session_id ? ` · s${a.assigned_from_session_id}` : ''}
      </p>
      {bundle.calls.length === 0 && <p className="text-xs mb-2" style={{ color: ACCENT }}>No Axis &amp; Bloom cupping; assignment is a guess until cupped.</p>}
      {a.evidence_newer_than_decision && <p className="text-xs text-amber-700 mb-2">Newer evidence since this decision (s{a.latest_session_id}).</p>}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label>Archetype
          <select className={INPUT} value={archetype} onChange={e => setArchetype(e.target.value)}>
            <option value="">— select —</option>
            {archetypes.map(x => <option key={x.code} value={x.code}>{x.label}</option>)}
          </select>
        </label>
        <label>Confidence
          <select className={INPUT} value={confidence} onChange={e => setConfidence(e.target.value)}>
            <option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
          </select>
        </label>
        <label>Session<SessionSelect bundle={bundle} value={sessionId} onChange={setSessionId} /></label>
        <div>Source<p className="py-1 text-stone-600">{source}</p></div>
      </div>
      <label className="block text-xs mt-2">Rule (your words)
        <input className={INPUT} value={rule} onChange={e => setRule(e.target.value)} placeholder={needed ? 'required' : 'optional: empty means "confirmed"'} />
      </label>
      <div className="mt-2"><Basis note={final.note} needed={needed} rule={rule} /></div>
      <div className="mt-2 flex items-center gap-2">
        <button className={BTN_PRIMARY} style={{ backgroundColor: ACCENT }} disabled={saving || !archetype || (needed && !rule.trim())} onClick={submit}>
          {saving ? '…' : archetype === current ? 'Confirm' : 'Change'}
        </button>
      </div>
      <div className="mt-2"><Warnings warnings={warnings} message={message} /></div>
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

  return (
    <div className={CARD}>
      <p className="text-xs text-stone-400 uppercase tracking-wide">Dial slot</p>
      <p className="text-sm text-stone-800 mb-2">
        {home ? `${home.name ?? home.position_label} (${home.archetype}/${home.sort_order})${homePriority ? ` · priority ${homePriority}` : ''}` : 'not placed'}
      </p>
      {decaf ? (
        <p className="text-xs text-stone-500">Decaf: decaf coffees are left out of the dial's sellable slots by the category rule, so this card is closed.</p>
      ) : !archetype ? (
        <p className="text-xs text-stone-500">Set the archetype first; the slots are that archetype's.</p>
      ) : (
        <>
          <div className="text-xs space-y-1">
            {choices.map(s => {
              const p = placementFor(s)!;
              const c = bandCheck(p.mergedMin, p.mergedMax, p.bandLo, p.bandHi);
              return (
                <label key={s.id} className="flex items-center gap-2">
                  <input type="radio" name={`slot-${coffeeId}`} checked={slotId === s.id} onChange={() => { setSlotId(s.id); setPreviewed(null); }} />
                  <span>{s.sort_order} · {s.name ?? s.position_label}</span>
                  <span className="text-stone-400">
                    {p.dimensionName ?? 'dimension'} band {p.bandLo ?? '—'}–{p.bandHi ?? '—'} · merged {p.mergedMin ?? '—'}–{p.mergedMax ?? '—'} ·{' '}
                    <span className={c === 'out_of_band' ? 'text-red-700' : c === 'in_band' ? 'text-green-700' : ''}>{c.replace(/_/g, ' ')}</span>
                    {s.occupants.length > 0 && ` · ${s.occupants.length} here`}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs mt-2">
            <label>Session<SessionSelect bundle={bundle} value={sessionId} onChange={setSessionId} /></label>
            <label>Priority<input className={INPUT} value={priority} onChange={e => setPriority(e.target.value.replace(/\D/g, ''))} placeholder="next free" /></label>
          </div>
          <label className="block text-xs mt-2">Rule (your words)
            <input className={INPUT} value={rule} onChange={e => setRule(e.target.value)} placeholder={needed ? 'required' : 'optional: empty means "confirmed"'} />
          </label>
          <div className="mt-2"><Basis note={final.note} needed={needed} rule={rule} /></div>
          {previewed && <p className="text-xs mt-1 text-stone-500">Preview: {previewed.length ? previewed.map(warningText).join(', ') : 'no warnings'}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button className={BTN} disabled={!slotId} onClick={preview}>Preview</button>
            <button className={BTN_PRIMARY} style={{ backgroundColor: ACCENT }} disabled={saving || !slotId || (needed && !rule.trim()) || (home?.id === slotId)}
              onClick={() => run(() => home
                ? moveCoffee(apiFetch, coffeeId, { toSlotId: slotId!, ...body })
                : placeCoffee(apiFetch, coffeeId, { slotId: slotId!, role: 'home', ...body }))}>
              {saving ? '…' : home ? 'Move' : 'Place'}
            </button>
          </div>
          {home && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <input className={INPUT} value={certifiedBy} onChange={e => setCertifiedBy(e.target.value)} placeholder="certified by" />
              <button className={BTN} disabled={saving || !certifiedBy.trim()}
                onClick={() => run(() => certifyPlacement(apiFetch, coffeeId, home.id, { by: certifiedBy.trim(), note: final.note }))}>Certify</button>
            </div>
          )}
        </>
      )}
      <div className="mt-2"><Warnings warnings={warnings} message={message} /></div>
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
      <p className="text-xs text-stone-400 uppercase tracking-wide">Descriptors (the roaster's, accepted into the catalog)</p>
      {!responseId ? <p className="text-xs text-stone-500 mt-1">No submitted response from the roaster for this coffee.</p> : !preview ? (
        <p className="text-xs text-stone-400 mt-1">{message || 'Loading…'}</p>
      ) : (
        <>
          <p className="text-xs text-stone-500 mb-1">Response v{preview.response.version}. Ticked and greyed are already accepted.</p>
          <ul className="text-xs space-y-1">
            {preview.notes.map(n => {
              const term = n.roasterPick ?? n.suggestion;
              const fam = familyOf(term?.wheelCategory);
              const kind = fam ? (fam.hit ? 'hit' : fam.miss ? 'miss' : fam.extra ? 'extra' : '') : '';
              return (
                <li key={n.rank} className="flex items-center gap-2">
                  {n.defaultCuppingNoteId ? (
                    <input type="checkbox" checked={!!checked[n.rank]} disabled={n.alreadyActive}
                      onChange={e => setChecked(c => ({ ...c, [n.rank]: e.target.checked }))} />
                  ) : <span className="w-3" />}
                  <span className={n.alreadyActive ? 'text-stone-400' : 'text-stone-800'}>{n.roasterWords}</span>
                  <span className="text-stone-400">
                    {term ? `→ ${term.descriptor} (${term.wheelCategory})` : '→ no mapping'}{kind ? ` · ${kind}` : ''}
                  </span>
                  {!n.defaultCuppingNoteId && (
                    <button className="underline text-stone-600" onClick={() => onOpenAcceptance(preview.response.portalCoffeeId)}>map</button>
                  )}
                </li>
              );
            })}
          </ul>
          {ours.length > 0 && (
            <p className="text-xs text-stone-400 mt-2">Ours only (evidence, never accepted from here): {ours.map(d => d.family).join(', ')}</p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button className={BTN_PRIMARY} style={{ backgroundColor: ACCENT }} disabled={saving}
              onClick={accept}>{saving ? '…' : 'Accept'}</button>
            <Link className="text-xs underline text-stone-500" to={`/admin/roastery-portal?roastery=${bundle.coffee.roaster_id}&accept=${preview.response.portalCoffeeId}`}>full acceptance view</Link>
            {done && <span className="text-xs text-green-700">{done}</span>}
          </div>
        </>
      )}
      {message && preview && <p className="text-xs text-red-600 mt-1">{message}</p>}
    </div>
  );
}
