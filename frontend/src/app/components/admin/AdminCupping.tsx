import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';

// Cupping evidence brief 1 (2026-10-18): a score row belongs to a cupper (a
// row in `cupper`, picked from /api/admin/cuppers) and records the scale the
// cupper used (/api/admin/scales) and her calls. Values are entered as
// written on that scale; raw_value is what is on the paper. Saving the same
// cupper again supersedes her current row (nothing is overwritten); the
// merged row is made by "Merge by rule" or, by hand, with a reason.
interface Session { id: number; session_date: string; location: string | null; }
interface SessionCoffee { session_coffee_id: number; coffee_id: number; name: string; roaster: string | null; merged_score_id: number | null; blind_code: string | null; is_control: boolean; }
interface Dimension {
  id: number; name: string; description: string | null;
  scale_min_label: string | null; scale_max_label: string | null;
  scale_min: number; scale_max: number; is_numeric: boolean; display_order: number;
}
interface CuppingNote { id: string; wheel_category: string; wheel_subcategory: string | null; descriptor: string; }
interface ScoreHeader {
  id: number; cupper_id: number | null; cupper_name: string; is_merged: boolean; overall_notes: string | null;
  scale_code: string; archetype_call: string | null; archetype_call_secondary: string | null;
  position_call: string | null; slot_call_id: number | null; call_note: string | null;
  merge_rule: string | null; merge_note: string | null;
}
interface ScoreValue { cupping_score_id: number; dimension_id: number; value_min: number | null; value_max: number | null; raw_value: string | null; notes: string | null; }
interface ScoreDescriptor { cupping_score_id: number; cupping_note_id: string; intensity: number | null; custom_notes: string | null; }
interface Cupper { id: number; name: string; is_active: boolean; }
interface Scale { code: string; label: string; kind: 'numeric' | 'ordinal'; scale_min: number | null; scale_max: number | null; steps: { raw_label: string }[]; }
interface Archetype { code: string; label: string; }
interface Slot { id: number; archetype: string; name: string; is_active: boolean; }

type DimValue = { value_min?: number; value_max?: number; raw_value?: string; notes?: string };
type DescriptorEntry = { cupping_note_id: string; intensity?: number; custom_notes?: string };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AdminCupping() {
  const { user } = useAuth();

  // Reference data (loaded once)
  const [sessions, setSessions]         = useState<Session[]>([]);
  const [dimensions, setDimensions]     = useState<Dimension[]>([]);
  const [cuppingNotes, setCuppingNotes] = useState<CuppingNote[]>([]);
  const [cuppers, setCuppers]           = useState<Cupper[]>([]);
  const [scales, setScales]             = useState<Scale[]>([]);
  const [archetypes, setArchetypes]     = useState<Archetype[]>([]);
  const [slots, setSlots]               = useState<Slot[]>([]);
  const [loadError, setLoadError]       = useState('');

  // Selection
  const [sessionId, setSessionId]       = useState('');
  const [scCoffees, setScCoffees]       = useState<SessionCoffee[]>([]);
  const [scId, setScId]                 = useState('');

  // All scores for selected session_coffee
  const [allScores, setAllScores]           = useState<ScoreHeader[]>([]);
  const [allValues, setAllValues]           = useState<ScoreValue[]>([]);
  const [allDescriptors, setAllDescriptors] = useState<ScoreDescriptor[]>([]);

  // View vs Edit mode
  const [mode, setMode]                 = useState<'view' | 'edit'>('view');

  // Form (reflects whichever row is active)
  const [cupperId, setCupperId]         = useState('');
  const [scaleCode, setScaleCode]       = useState('ab_0_15');
  const [isMerged, setIsMerged]         = useState(false);
  const [mergeNote, setMergeNote]       = useState('');
  const [archetypeCall, setArchetypeCall]       = useState('');
  const [archetypeCall2, setArchetypeCall2]     = useState('');
  const [positionCall, setPositionCall] = useState('');
  const [slotCallId, setSlotCallId]     = useState('');
  const [callNote, setCallNote]         = useState('');
  const [overallNotes, setOverallNotes] = useState('');
  const [dimValues, setDimValues]       = useState<Record<number, DimValue>>({});
  const [selectedDesc, setSelectedDesc] = useState<Record<string, DescriptorEntry>>({});

  // The score id currently displayed / being edited
  const [existingScoreId, setExistingScoreId] = useState<number | null>(null);

  // UI state
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const [saving, setSaving]             = useState(false);
  const [saveMsg, setSaveMsg]           = useState('');
  const [error, setError]               = useState('');

  async function getToken() { return user!.getIdToken(); }

  /** Fetch helper — always bypasses browser cache */
  async function apiFetch(url: string, options: RequestInit = {}) {
    const token = await getToken();
    return fetch(url, {
      cache: 'no-store',
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers as Record<string, string> ?? {}) },
    });
  }

  // ── Load reference data ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    setLoadError('');
    (async () => {
      try {
        const [sessRes, dimRes, notesRes, cupRes, scaleRes, archRes, slotRes] = await Promise.all([
          apiFetch('/api/admin/sessions'),
          apiFetch('/api/admin/dimensions'),
          apiFetch('/api/admin/cupping-notes'),
          apiFetch('/api/admin/cuppers'),
          apiFetch('/api/admin/scales'),
          apiFetch('/api/admin/catalog/archetypes'),
          apiFetch('/api/admin/catalog/slots'),
        ]);
        if (!sessRes.ok)  throw new Error(`Sessions: HTTP ${sessRes.status}`);
        if (!dimRes.ok)   throw new Error(`Dimensions: HTTP ${dimRes.status}`);
        if (!notesRes.ok) throw new Error(`Cupping notes: HTTP ${notesRes.status}`);
        if (!cupRes.ok)   throw new Error(`Cuppers: HTTP ${cupRes.status}`);
        if (!scaleRes.ok) throw new Error(`Scales: HTTP ${scaleRes.status}`);
        setSessions(await sessRes.json());
        setDimensions(await dimRes.json());
        setCuppingNotes(await notesRes.json());
        setCuppers(await cupRes.json());
        setScales(await scaleRes.json());
        if (archRes.ok) setArchetypes(await archRes.json());
        if (slotRes.ok) setSlots(await slotRes.json());
      } catch (err: unknown) {
        reportError('[AdminCupping/load-page-data]', err);
        setLoadError(err instanceof Error ? err.message : 'Failed to load page data');
      }
    })();
  }, [user]);

  // ── Load coffees when session changes ────────────────────────────────────────
  useEffect(() => {
    setScId(''); setScCoffees([]);
    if (!sessionId || !user) return;
    (async () => {
      try {
        const res = await apiFetch(`/api/admin/sessions/${sessionId}/coffees`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setScCoffees(await res.json());
      } catch (err: unknown) {
        reportError('[AdminCupping/load-coffees]', err);
        setError(err instanceof Error ? err.message : 'Failed to load coffees');
      }
    })();
  }, [sessionId, user]);

  // ── Load all scores for a session_coffee, then activate first taster ─────────
  const resetForm = useCallback(() => {
    setCupperId(''); setScaleCode('ab_0_15'); setIsMerged(false); setMergeNote(''); setOverallNotes('');
    setArchetypeCall(''); setArchetypeCall2(''); setPositionCall(''); setSlotCallId(''); setCallNote('');
    setDimValues({}); setSelectedDesc({}); setExistingScoreId(null);
  }, []);

  /** Populate form state from a specific score id using already-loaded arrays. */
  function activateTaster(
    scoreId: number,
    scores: ScoreHeader[],
    values: ScoreValue[],
    descriptors: ScoreDescriptor[],
  ) {
    const score = scores.find(s => s.id === scoreId);
    if (!score) return;
    setExistingScoreId(score.id);
    setCupperId(score.cupper_id != null ? String(score.cupper_id) : '');
    setScaleCode(score.scale_code === 'legacy' ? 'ab_0_15' : score.scale_code);
    setIsMerged(score.is_merged);
    setMergeNote(score.merge_note ?? '');
    setArchetypeCall(score.archetype_call ?? '');
    setArchetypeCall2(score.archetype_call_secondary ?? '');
    setPositionCall(score.position_call ?? '');
    setSlotCallId(score.slot_call_id != null ? String(score.slot_call_id) : '');
    setCallNote(score.call_note ?? '');
    setOverallNotes(score.overall_notes ?? '');

    const num = (v: number | string | null) => (v == null ? undefined : Number(v));
    const dvMap: Record<number, DimValue> = {};
    for (const v of values.filter(v => v.cupping_score_id === score.id)) {
      dvMap[v.dimension_id] = {
        value_min: num(v.value_min),
        value_max: num(v.value_max),
        raw_value: v.raw_value ?? undefined,
        notes: v.notes ?? undefined,
      };
    }
    setDimValues(dvMap);

    const descMap: Record<string, DescriptorEntry> = {};
    for (const d of descriptors.filter(d => d.cupping_score_id === score.id)) {
      descMap[d.cupping_note_id] = {
        cupping_note_id: d.cupping_note_id,
        intensity: num(d.intensity),
        custom_notes: d.custom_notes ?? undefined,
      };
    }
    setSelectedDesc(descMap);
    setMode('view');
  }

  /** Fetch scores for current scId and return {scores, values, descriptors}. */
  async function fetchScores(scIdParam: string) {
    const res = await apiFetch(`/api/admin/scores/session-coffee/${scIdParam}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ scores: ScoreHeader[]; values: ScoreValue[]; descriptors: ScoreDescriptor[] }>;
  }

  useEffect(() => {
    resetForm(); setSaveMsg(''); setMode('view');
    setAllScores([]); setAllValues([]); setAllDescriptors([]);
    setError('');
    if (!scId || !user) return;
    (async () => {
      try {
        const data = await fetchScores(scId);
        setAllScores(data.scores);
        setAllValues(data.values ?? []);
        setAllDescriptors(data.descriptors ?? []);

        if (!data.scores.length) {
          // No scores yet — go straight to edit mode for first entry
          setMode('edit');
        } else {
          activateTaster(data.scores[0].id, data.scores, data.values ?? [], data.descriptors ?? []);
        }
      } catch (err: unknown) {
        reportError('[AdminCupping/load-scores]', err);
        setError(err instanceof Error ? err.message : 'Failed to load scores');
      }
    })();
  }, [scId, user, resetForm]);

  // ── Save ─────────────────────────────────────────────────────────────────────
  async function reloadScores(activateId?: number) {
    const data = await fetchScores(scId);
    setAllScores(data.scores);
    setAllValues(data.values ?? []);
    setAllDescriptors(data.descriptors ?? []);
    const target = activateId ?? data.scores[0]?.id;
    if (target != null) activateTaster(target, data.scores, data.values ?? [], data.descriptors ?? []);
  }

  async function handleSave() {
    if (!scId) { setError('Select a coffee'); return; }
    if (!isMerged && !cupperId) { setError('Choose the cupper'); return; }
    if (isMerged && !mergeNote.trim()) { setError('A hand merge needs a reason'); return; }
    setSaving(true); setError(''); setSaveMsg('');
    try {
      const res = await apiFetch('/api/admin/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_coffee_id: Number(scId),
          cupper_id: isMerged ? null : Number(cupperId),
          scale_code: isMerged ? 'ab_0_15' : scaleCode,
          is_merged: isMerged,
          merge_note: isMerged ? mergeNote.trim() : null,
          archetype_call: archetypeCall || null,
          archetype_call_secondary: archetypeCall2 || null,
          position_call: positionCall || null,
          slot_call_id: slotCallId ? Number(slotCallId) : null,
          call_note: callNote || null,
          overall_notes: overallNotes || null,
          values: dimValues,
          descriptors: Object.values(selectedDesc),
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message ?? e.error ?? 'Unknown error'); }
      const saved = await res.json();

      // Reload all scores so the tab list and data stay in sync
      await reloadScores(saved.id);
      setSaveMsg(existingScoreId != null ? 'Saved ✓ (the previous row is kept, superseded)' : 'Saved ✓');
    } catch (err: unknown) {
      reportError('[AdminCupping/save]', err);
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(false); }
  }

  async function handleMergeByRule() {
    if (!scId || !sessionId) return;
    setSaving(true); setError(''); setSaveMsg('');
    try {
      const res = await apiFetch(`/api/admin/sessions/${sessionId}/coffees/${scId}/merge`, { method: 'POST' });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message ?? e.error ?? 'Unknown error'); }
      const merged = await res.json();
      await reloadScores(merged.id);
      setSaveMsg(`Merged ✓ — ${merged.merge_note}`);
    } catch (err: unknown) {
      reportError('[AdminCupping/merge]', err);
      setError(err instanceof Error ? err.message : 'Failed to merge');
    } finally { setSaving(false); }
  }

  const activeScale = scales.find(s => s.code === scaleCode);
  const scaleMin = activeScale?.scale_min ?? 0;
  const scaleMax = activeScale?.scale_max ?? 15;
  function setRaw(dimId: number, raw: string) {
    setDimValues(prev => ({ ...prev, [dimId]: { ...prev[dimId], raw_value: raw || undefined } }));
  }

  // ── Descriptor helpers ───────────────────────────────────────────────────────
  const categories = [...new Set(cuppingNotes.map(n => n.wheel_category))].sort();
  const byCategory = (cat: string) => cuppingNotes.filter(n => n.wheel_category === cat);

  function toggleCategory(cat: string) {
    setOpenCategories(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }

  function toggleDescriptor(note: CuppingNote) {
    setSelectedDesc(prev => {
      const next = { ...prev };
      if (next[note.id]) { delete next[note.id]; }
      else { next[note.id] = { cupping_note_id: note.id }; }
      return next;
    });
  }

  function setDescIntensity(noteId: string, intensity: number) {
    setSelectedDesc(prev => ({ ...prev, [noteId]: { ...prev[noteId], intensity } }));
  }

  // ── Dimension helpers ─────────────────────────────────────────────────────────
  function setNumeric(dimId: number, field: 'value_min' | 'value_max', v: string) {
    setDimValues(prev => ({ ...prev, [dimId]: { ...prev[dimId], [field]: v === '' ? undefined : Number(v) } }));
  }
  function setDimNotes(dimId: number, notes: string) {
    setDimValues(prev => ({ ...prev, [dimId]: { ...prev[dimId], notes } }));
  }

  const numericDims = dimensions.filter(d => d.is_numeric);
  const textDims    = dimensions.filter(d => !d.is_numeric);
  const selectedCount = Object.keys(selectedDesc).length;
  const activeHeader = allScores.find(s => s.id === existingScoreId);
  const archetypeLabel = (code: string) => archetypes.find(a => a.code === code)?.label ?? code;
  const slotsForCall = slots.filter(s => s.is_active && (!archetypeCall || s.archetype === archetypeCall));
  const filledNumericFor = (d: Dimension) => dimValues[d.id]?.value_min != null || dimValues[d.id]?.raw_value;

  // ── Read-only summary ────────────────────────────────────────────────────────
  function ViewCard() {
    const filledNumeric = numericDims.filter(filledNumericFor);
    const filledText    = textDims.filter(d => dimValues[d.id]?.notes);
    const descriptorList = Object.values(selectedDesc);

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-normal text-stone-800">
              {activeHeader?.cupper_name}
              {isMerged && <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-stone-100 text-stone-500">merged{activeHeader?.merge_rule ? ` · ${activeHeader.merge_rule}` : ''}</span>}
              {activeHeader && <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-stone-100 text-stone-500">scale {activeHeader.scale_code}</span>}
            </p>
            {activeHeader?.merge_note && <p className="text-xs text-stone-400 mt-1">{activeHeader.merge_note}</p>}
            {(archetypeCall || positionCall || callNote) && (
              <p className="text-xs text-stone-500 mt-1">
                Call: {[archetypeLabel(archetypeCall), archetypeLabel(archetypeCall2), positionCall].filter(Boolean).join(' / ') || '—'}
                {callNote && <span className="text-stone-400"> · {callNote}</span>}
              </p>
            )}
            {overallNotes && <p className="text-sm text-stone-500 mt-1">{overallNotes}</p>}
          </div>
          <button onClick={() => setMode('edit')}
            className="px-4 py-1.5 rounded text-sm font-normal border border-stone-300 text-stone-600 hover:bg-stone-50">
            ✏️ Edit
          </button>
        </div>

        {filledNumeric.length > 0 && (
          <div>
            <p className="text-xs font-normal uppercase tracking-wide text-stone-400 mb-2">Numeric Scores</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {filledNumeric.map(dim => {
                const val = dimValues[dim.id];
                return (
                  <div key={dim.id} className="border border-stone-200 rounded-lg px-3 py-2">
                    <p className="text-xs text-stone-400 mb-0.5">{dim.name}</p>
                    <p className="text-sm font-normal text-stone-800">
                      {val?.value_min ?? '—'} – {val?.value_max ?? '—'}
                    </p>
                    {val?.raw_value && <p className="text-xs text-stone-400 mt-0.5 truncate">paper: {val.raw_value}</p>}
                    {val?.notes && <p className="text-xs text-stone-400 mt-0.5 truncate">{val.notes}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {filledText.length > 0 && (
          <div>
            <p className="text-xs font-normal uppercase tracking-wide text-stone-400 mb-2">Free-Text Notes</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {filledText.map(dim => (
                <div key={dim.id} className="border border-stone-200 rounded-lg px-3 py-2">
                  <p className="text-xs text-stone-400 mb-0.5">{dim.name}</p>
                  <p className="text-sm text-stone-700">{dimValues[dim.id]?.notes}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {descriptorList.length > 0 && (
          <div>
            <p className="text-xs font-normal uppercase tracking-wide text-stone-400 mb-2">Flavor Descriptors</p>
            <div className="flex flex-wrap gap-2">
              {descriptorList.map(d => {
                const note = cuppingNotes.find(n => n.id === d.cupping_note_id);
                return (
                  <span key={d.cupping_note_id}
                    className="px-3 py-1 rounded-full text-xs font-normal border border-stone-200 text-stone-700">
                    {note?.descriptor ?? d.cupping_note_id}
                    {d.intensity != null && <span className="ml-1 text-stone-400">({d.intensity})</span>}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {filledNumeric.length === 0 && filledText.length === 0 && descriptorList.length === 0 && (
          <p className="text-stone-400 text-sm">No scores entered yet. Click Edit to add scores.</p>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-normal text-stone-800">Cupping Score Entry</h1>
        <Link to="/admin/sessions"
          className="text-sm text-stone-400 hover:text-stone-700 underline">
          + New Session
        </Link>
      </div>

      {/* ── Fatal load error ── */}
      {loadError && (
        <div className="mb-6 p-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">
          <p className="font-normal mb-1">Failed to load page data</p>
          <p className="text-red-600">{loadError}</p>
          <button
            onClick={() => { setLoadError(''); window.location.reload(); }}
            className="mt-2 text-xs underline text-red-500 hover:text-red-700">
            Reload page
          </button>
        </div>
      )}

      {/* ── Session + Coffee selectors ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div>
          <label className="block text-xs text-stone-500 mb-1">Session</label>
          <select value={sessionId} onChange={e => setSessionId(e.target.value)}
            className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
            <option value="">— select session —</option>
            {sessions.map(s => (
              <option key={s.id} value={s.id}>
                {formatDate(s.session_date)}{s.location ? ` · ${s.location}` : ''}
              </option>
            ))}
          </select>
          {!loadError && sessions.length === 0 && (
            <p className="text-xs text-stone-400 mt-1">
              No sessions yet — <Link to="/admin/sessions" className="underline hover:text-stone-700">create one in Sessions</Link>
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs text-stone-500 mb-1">Coffee</label>
          <select value={scId} onChange={e => setScId(e.target.value)}
            disabled={!sessionId || scCoffees.length === 0}
            className="w-full border border-stone-300 rounded px-3 py-2 text-sm disabled:opacity-50">
            <option value="">— select coffee —</option>
            {scCoffees.map(sc => (
              <option key={sc.session_coffee_id} value={sc.session_coffee_id}>
                {sc.name}{sc.roaster ? ` · ${sc.roaster}` : ''}
              </option>
            ))}
          </select>
          {sessionId && scCoffees.length === 0 && (
            <p className="text-xs text-stone-400 mt-1">
              No coffees in this session — <Link to="/admin/sessions" className="underline hover:text-stone-700">add them in Sessions</Link>
            </p>
          )}
        </div>
      </div>

      {/* ── No selection state ── */}
      {!sessionId && !loadError && (
        <p className="text-stone-400 text-sm">Select a session to begin.</p>
      )}
      {sessionId && !scId && scCoffees.length > 0 && (
        <p className="text-stone-400 text-sm">Select a coffee above to see its scores.</p>
      )}

      {/* ── Score area ── */}
      {scId && (
        <>
          {/* ── Taster tabs ── */}
          {(allScores.length > 0 || mode === 'view') && (
            <div className="flex items-center gap-2 flex-wrap mb-5 pb-4 border-b border-stone-200">
              {allScores.map(s => (
                <button
                  key={s.id}
                  onClick={() => {
                    activateTaster(s.id, allScores, allValues, allDescriptors);
                    setSaveMsg('');
                  }}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    existingScoreId === s.id
                      ? 'bg-stone-800 text-white border-stone-800'
                      : 'border-stone-300 text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {s.cupper_name}
                  {s.is_merged && <span className="ml-1 text-xs opacity-60">(merged)</span>}
                </button>
              ))}
              <button
                onClick={() => { resetForm(); setMode('edit'); setSaveMsg(''); setError(''); }}
                className="px-3 py-1.5 text-sm rounded-full border border-dashed border-stone-300 text-stone-400 hover:text-stone-600 hover:border-stone-400 transition-colors"
              >
                + Add cupper
              </button>
              {allScores.some(s => !s.is_merged && s.cupper_id != null) && (
                <button
                  onClick={handleMergeByRule} disabled={saving}
                  className="ml-auto px-3 py-1.5 text-sm rounded-full border border-stone-300 text-stone-600 hover:bg-stone-50 disabled:opacity-50"
                  title="Union of the current cupper rows (union_v1); supersedes the current merged row"
                >
                  Merge by rule
                </button>
              )}
            </div>
          )}

          {/* ── Inline error ── */}
          {error && (
            <p className="text-red-500 text-sm mb-4">{error}</p>
          )}

          {/* ── View mode ── */}
          {mode === 'view' && existingScoreId != null && (
            <div className="border border-stone-200 rounded-lg p-6 bg-stone-50">
              <ViewCard />
              {saveMsg && <p className="text-green-600 text-sm mt-4">{saveMsg}</p>}
            </div>
          )}

          {/* ── Edit mode ── */}
          {mode === 'edit' && (
            <>
              {existingScoreId != null && (
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-stone-500">
                    Editing <strong>{activeHeader?.cupper_name}</strong>. Saving again supersedes the current row; the old one is kept.
                  </p>
                  <button onClick={() => setMode('view')}
                    className="text-sm text-stone-400 hover:text-stone-700 underline">
                    Cancel edit
                  </button>
                </div>
              )}

              {/* Cupper, scale, merged */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Cupper *</label>
                  <select value={cupperId} onChange={e => setCupperId(e.target.value)} disabled={isMerged}
                    className="w-full border border-stone-300 rounded px-3 py-2 text-sm disabled:opacity-50">
                    <option value="">— choose —</option>
                    {cuppers.filter(c => c.is_active || String(c.id) === cupperId).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Scale used</label>
                  <select value={scaleCode} onChange={e => setScaleCode(e.target.value)} disabled={isMerged}
                    className="w-full border border-stone-300 rounded px-3 py-2 text-sm disabled:opacity-50">
                    {scales.filter(s => s.code !== 'legacy').map(s => (
                      <option key={s.code} value={s.code}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer mb-2">
                    <input type="checkbox" checked={isMerged} onChange={e => setIsMerged(e.target.checked)}
                      className="w-4 h-4 rounded" />
                    Merged by hand <span className="text-stone-400 text-xs">(usually: Merge by rule)</span>
                  </label>
                </div>
              </div>
              {isMerged && (
                <div className="mb-6">
                  <label className="block text-xs text-stone-500 mb-1">Why a hand merge? *</label>
                  <input value={mergeNote} onChange={e => setMergeNote(e.target.value)}
                    className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
                    placeholder="the reason, kept as the merge note" />
                </div>
              )}

              {/* Calls, as written */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8 pb-8 border-b border-stone-100">
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Archetype call</label>
                  <select value={archetypeCall} onChange={e => setArchetypeCall(e.target.value)}
                    className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
                    <option value="">— none written —</option>
                    {archetypes.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Second call</label>
                  <select value={archetypeCall2} onChange={e => setArchetypeCall2(e.target.value)}
                    className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
                    <option value="">— none —</option>
                    {archetypes.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Position call (her words)</label>
                  <input value={positionCall} onChange={e => setPositionCall(e.target.value)}
                    className="w-full border border-stone-300 rounded px-3 py-2 text-sm" placeholder="e.g. light, med-strong" />
                </div>
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Slot call (only if unambiguous)</label>
                  <select value={slotCallId} onChange={e => setSlotCallId(e.target.value)}
                    className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
                    <option value="">— none —</option>
                    {slotsForCall.map(s => <option key={s.id} value={s.id}>{archetypeLabel(s.archetype)} · {s.name}</option>)}
                  </select>
                </div>
                <div className="md:col-span-4">
                  <label className="block text-xs text-stone-500 mb-1">Call note</label>
                  <input value={callNote} onChange={e => setCallNote(e.target.value)}
                    className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
                    placeholder="e.g. a family ticked, a call crossed out" />
                </div>
              </div>

              {/* Numeric dimensions */}
              <section className="mb-8 pb-8 border-b border-stone-100">
                <h2 className="text-sm font-normal text-stone-700 mb-4">
                  Numeric Scores <span className="text-stone-400 font-normal">
                    ({activeScale?.kind === 'ordinal' ? 'a word per dimension' : `${scaleMin}–${scaleMax}, as written`})
                  </span>
                </h2>
                <div className="space-y-3">
                  {numericDims.map(dim => {
                    const val = dimValues[dim.id] ?? {};
                    return (
                      <div key={dim.id} className="flex items-center gap-4">
                        <div className="w-36 shrink-0">
                          <p className="text-sm font-normal text-stone-700">{dim.name}</p>
                          {(dim.scale_min_label || dim.scale_max_label) && (
                            <p className="text-xs text-stone-400 leading-tight">
                              {dim.scale_min_label} → {dim.scale_max_label}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-1">
                          {activeScale?.kind === 'ordinal' && !isMerged ? (
                            <select value={val.raw_value ?? ''} onChange={e => setRaw(dim.id, e.target.value)}
                              className="w-44 border border-stone-300 rounded px-2 py-1.5 text-sm">
                              <option value="">—</option>
                              {activeScale.steps.map(st => <option key={st.raw_label} value={st.raw_label}>{st.raw_label}</option>)}
                            </select>
                          ) : (
                            <>
                              <input type="number" min={scaleMin} max={scaleMax} step="0.5"
                                value={val.value_min ?? ''}
                                onChange={e => setNumeric(dim.id, 'value_min', e.target.value)}
                                placeholder="min"
                                className="w-20 border border-stone-300 rounded px-2 py-1.5 text-sm text-center" />
                              <span className="text-stone-300 text-xs">–</span>
                              <input type="number" min={scaleMin} max={scaleMax} step="0.5"
                                value={val.value_max ?? ''}
                                onChange={e => setNumeric(dim.id, 'value_max', e.target.value)}
                                placeholder="max"
                                className="w-20 border border-stone-300 rounded px-2 py-1.5 text-sm text-center" />
                              <input value={val.raw_value ?? ''}
                                onChange={e => setRaw(dim.id, e.target.value)}
                                placeholder="on the paper (range, strikes)"
                                className="w-44 border border-stone-300 rounded px-2 py-1.5 text-xs" />
                            </>
                          )}
                          <input value={val.notes ?? ''}
                            onChange={e => setDimNotes(dim.id, e.target.value)}
                            placeholder="words (optional)"
                            className="flex-1 border border-stone-300 rounded px-3 py-1.5 text-sm" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Free-text dimensions */}
              <section className="mb-8 pb-8 border-b border-stone-100">
                <h2 className="text-sm font-normal text-stone-700 mb-4">Free-Text Notes</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {textDims.map(dim => (
                    <div key={dim.id}>
                      <label className="block text-xs text-stone-500 mb-1">{dim.name}</label>
                      <textarea rows={2}
                        value={dimValues[dim.id]?.notes ?? ''}
                        onChange={e => setDimNotes(dim.id, e.target.value)}
                        className="w-full border border-stone-300 rounded px-3 py-2 text-sm resize-none"
                        placeholder={`Describe the ${dim.name.toLowerCase()}…`} />
                    </div>
                  ))}
                </div>
              </section>

              {/* SCA Descriptor picker */}
              <section className="mb-8 pb-8 border-b border-stone-100">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-normal text-stone-700">
                    Flavor Descriptors
                    {selectedCount > 0 && (
                      <span className="ml-2 px-2 py-0.5 rounded-full text-xs text-white font-normal" style={{ backgroundColor: '#b05642' }}>
                        {selectedCount} selected
                      </span>
                    )}
                  </h2>
                  <button onClick={() => setOpenCategories(openCategories.size === 0 ? new Set(categories) : new Set())}
                    className="text-xs text-stone-400 hover:text-stone-600 underline">
                    {openCategories.size === 0 ? 'expand all' : 'collapse all'}
                  </button>
                </div>
                <div className="space-y-2">
                  {categories.map(cat => {
                    const catNotes = byCategory(cat);
                    const catSelected = catNotes.filter(n => selectedDesc[n.id]).length;
                    const isOpen = openCategories.has(cat);
                    return (
                      <div key={cat} className="border border-stone-200 rounded-lg overflow-hidden">
                        <button
                          className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-left hover:bg-stone-50"
                          onClick={() => toggleCategory(cat)}>
                          <span className="font-normal text-stone-700">{cat}</span>
                          <span className="flex items-center gap-2">
                            {catSelected > 0 && (
                              <span className="text-xs text-white px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#b05642' }}>
                                {catSelected}
                              </span>
                            )}
                            <span className="text-stone-300 text-xs">{isOpen ? '▲' : '▼'}</span>
                          </span>
                        </button>
                        {isOpen && (
                          <div className="px-4 pb-4 pt-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {catNotes.map(note => {
                              const isSelected = !!selectedDesc[note.id];
                              return (
                                <div key={note.id}
                                  className={`rounded border p-2 cursor-pointer transition-colors ${isSelected ? 'border-stone-400 bg-stone-100' : 'border-stone-200 hover:border-stone-300'}`}
                                  onClick={() => toggleDescriptor(note)}>
                                  <p className={`text-xs font-normal ${isSelected ? 'text-stone-800' : 'text-stone-600'}`}>
                                    {note.descriptor}
                                  </p>
                                  {note.wheel_subcategory && (
                                    <p className="text-xs text-stone-400">{note.wheel_subcategory}</p>
                                  )}
                                  {isSelected && (
                                    <div className="mt-1.5 flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                                      <label className="text-xs text-stone-400 shrink-0">Intensity</label>
                                      <input type="number" min="0" max="15" step="1"
                                        value={selectedDesc[note.id]?.intensity ?? ''}
                                        onChange={e => setDescIntensity(note.id, Number(e.target.value))}
                                        placeholder="0–15"
                                        className="w-16 border border-stone-300 rounded px-1.5 py-0.5 text-xs text-center" />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Overall notes + save */}
              <section className="mb-8">
                <label className="block text-xs text-stone-500 mb-1">Overall Notes</label>
                <textarea rows={3} value={overallNotes} onChange={e => setOverallNotes(e.target.value)}
                  className="w-full border border-stone-300 rounded px-3 py-2 text-sm resize-none mb-4"
                  placeholder="General impressions, context, anything that doesn't fit a dimension…" />

                {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
                {saveMsg && <p className="text-green-600 text-sm mb-3">{saveMsg}</p>}

                <div className="flex gap-3">
                  <button onClick={handleSave} disabled={saving || (!isMerged && !cupperId)}
                    className="px-6 py-2 rounded text-sm font-normal text-white disabled:opacity-50"
                    style={{ backgroundColor: '#b05642' }}>
                    {saving ? 'Saving…' : 'Save Score'}
                  </button>
                  {existingScoreId != null && (
                    <button onClick={() => setMode('view')}
                      className="px-6 py-2 rounded text-sm text-stone-500 border border-stone-200 hover:bg-stone-50">
                      Cancel
                    </button>
                  )}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
