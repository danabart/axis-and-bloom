import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../context/AuthContext';

interface Session { id: number; session_date: string; location: string | null; }
interface SessionCoffee { session_coffee_id: number; coffee_id: number; name: string; roaster: string | null; }
interface Dimension {
  id: number; name: string; description: string | null;
  scale_min_label: string | null; scale_max_label: string | null;
  scale_min: number; scale_max: number; is_numeric: boolean; display_order: number;
}
interface CuppingNote { id: string; wheel_category: string; wheel_subcategory: string | null; descriptor: string; }

type DimValue = { value_min?: number; value_max?: number; notes?: string };
type DescriptorEntry = { cupping_note_id: string; intensity?: number };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AdminCupping() {
  const { user } = useAuth();

  // Reference data (loaded once)
  const [sessions, setSessions]         = useState<Session[]>([]);
  const [dimensions, setDimensions]     = useState<Dimension[]>([]);
  const [cuppingNotes, setCuppingNotes] = useState<CuppingNote[]>([]);

  // Selection
  const [sessionId, setSessionId]       = useState('');
  const [scCoffees, setScCoffees]       = useState<SessionCoffee[]>([]);
  const [scId, setScId]                 = useState('');

  // View vs Edit mode
  const [mode, setMode]                 = useState<'view' | 'edit'>('view');

  // Form
  const [tasterName, setTasterName]     = useState('');
  const [isMerged, setIsMerged]         = useState(false);
  const [overallNotes, setOverallNotes] = useState('');
  const [dimValues, setDimValues]       = useState<Record<number, DimValue>>({});
  const [selectedDesc, setSelectedDesc] = useState<Record<string, DescriptorEntry>>({});

  // For view mode snapshot (we keep a stable copy to display read-only)
  const [existingScoreId, setExistingScoreId] = useState<number | null>(null);

  // UI state
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const [saving, setSaving]             = useState(false);
  const [saveMsg, setSaveMsg]           = useState('');
  const [error, setError]               = useState('');

  async function getToken() { return user!.getIdToken(); }

  // ── Load reference data ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    (async () => {
      const headers = { Authorization: `Bearer ${await getToken()}` };
      const [sessRes, dimRes, notesRes] = await Promise.all([
        fetch('/api/admin/sessions', { headers }),
        fetch('/api/admin/dimensions', { headers }),
        fetch('/api/admin/cupping-notes', { headers }),
      ]);
      setSessions(await sessRes.json());
      setDimensions(await dimRes.json());
      setCuppingNotes(await notesRes.json());
    })();
  }, [user]);

  // ── Load coffees when session changes ────────────────────────────────────────
  useEffect(() => {
    setScId(''); setScCoffees([]);
    if (!sessionId || !user) return;
    (async () => {
      const res = await fetch(`/api/admin/sessions/${sessionId}/coffees`, {
        headers: { Authorization: `Bearer ${await getToken()}` },
      });
      setScCoffees(await res.json());
    })();
  }, [sessionId, user]);

  // ── Load existing score when session_coffee changes ──────────────────────────
  const resetForm = useCallback(() => {
    setTasterName(''); setIsMerged(false); setOverallNotes('');
    setDimValues({}); setSelectedDesc({}); setExistingScoreId(null);
  }, []);

  useEffect(() => {
    resetForm(); setSaveMsg(''); setMode('view');
    if (!scId || !user) return;
    (async () => {
      const res = await fetch(`/api/admin/scores/session-coffee/${scId}`, {
        headers: { Authorization: `Bearer ${await getToken()}` },
      });
      const data = await res.json();
      if (!data.scores?.length) {
        // No existing score — go straight to edit mode for new entry
        setMode('edit');
        return;
      }

      // Pre-load the most recent / merged score
      const score = data.scores[data.scores.length - 1];
      setExistingScoreId(score.id);
      setTasterName(score.taster_name);
      setIsMerged(score.is_merged);
      setOverallNotes(score.overall_notes ?? '');

      const dvMap: Record<number, DimValue> = {};
      for (const v of data.values.filter((v: { cupping_score_id: number }) => v.cupping_score_id === score.id)) {
        dvMap[v.dimension_id] = { value_min: v.value_min, value_max: v.value_max, notes: v.notes };
      }
      setDimValues(dvMap);

      const descMap: Record<string, DescriptorEntry> = {};
      for (const d of data.descriptors.filter((d: { cupping_score_id: number }) => d.cupping_score_id === score.id)) {
        descMap[d.cupping_note_id] = { cupping_note_id: d.cupping_note_id, intensity: d.intensity };
      }
      setSelectedDesc(descMap);

      // Existing score → start in read-only view
      setMode('view');
    })();
  }, [scId, user, resetForm]);

  // ── Save ─────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!scId || !tasterName.trim()) { setError('Select a coffee and enter a taster name'); return; }
    setSaving(true); setError(''); setSaveMsg('');
    try {
      const res = await fetch('/api/admin/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken()}` },
        body: JSON.stringify({
          session_coffee_id: Number(scId),
          taster_name: tasterName.trim(),
          is_merged: isMerged,
          overall_notes: overallNotes || null,
          values: dimValues,
          descriptors: Object.values(selectedDesc),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Unknown error');
      const saved = await res.json();
      setExistingScoreId(saved.id);
      setSaveMsg('Saved ✓');
      setMode('view');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(false); }
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

  // ── Read-only summary ────────────────────────────────────────────────────────
  function ViewCard() {
    const filledNumeric = numericDims.filter(d => dimValues[d.id]?.value_min != null || dimValues[d.id]?.value_max != null);
    const filledText    = textDims.filter(d => dimValues[d.id]?.notes);
    const descriptorList = Object.values(selectedDesc);

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-stone-800">
              {tasterName}
              {isMerged && <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-stone-100 text-stone-500">merged</span>}
            </p>
            {overallNotes && <p className="text-sm text-stone-500 mt-1">{overallNotes}</p>}
          </div>
          <button onClick={() => setMode('edit')}
            className="px-4 py-1.5 rounded text-sm font-medium border border-stone-300 text-stone-600 hover:bg-stone-50">
            ✏️ Edit
          </button>
        </div>

        {filledNumeric.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-2">Numeric Scores</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {filledNumeric.map(dim => {
                const val = dimValues[dim.id];
                return (
                  <div key={dim.id} className="border border-stone-200 rounded-lg px-3 py-2">
                    <p className="text-xs text-stone-400 mb-0.5">{dim.name}</p>
                    <p className="text-sm font-semibold text-stone-800">
                      {val?.value_min ?? '—'} – {val?.value_max ?? '—'}
                    </p>
                    {val?.notes && <p className="text-xs text-stone-400 mt-0.5 truncate">{val.notes}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {filledText.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-2">Free-Text Notes</p>
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
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-2">Flavor Descriptors</p>
            <div className="flex flex-wrap gap-2">
              {descriptorList.map(d => {
                const note = cuppingNotes.find(n => n.id === d.cupping_note_id);
                return (
                  <span key={d.cupping_note_id}
                    className="px-3 py-1 rounded-full text-xs font-medium border border-stone-200 text-stone-700">
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
        <h1 className="text-xl font-semibold text-stone-800">Cupping Score Entry</h1>
        <Link to="/admin/sessions"
          className="text-sm text-stone-400 hover:text-stone-700 underline">
          + New Session
        </Link>
      </div>

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
          {sessions.length === 0 && (
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
      {!sessionId && (
        <p className="text-stone-400 text-sm">Select a session to begin.</p>
      )}
      {sessionId && !scId && scCoffees.length > 0 && (
        <p className="text-stone-400 text-sm">Select a coffee above to see its scores.</p>
      )}

      {/* ── Score area ── */}
      {scId && (
        <>
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
                  <p className="text-sm text-stone-500">Editing existing score</p>
                  <button onClick={() => setMode('view')}
                    className="text-sm text-stone-400 hover:text-stone-700 underline">
                    Cancel edit
                  </button>
                </div>
              )}

              {/* Taster */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 pb-8 border-b border-stone-100">
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Taster name *</label>
                  <input value={tasterName} onChange={e => setTasterName(e.target.value)}
                    className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
                    placeholder="e.g. Dana or session_merged" />
                </div>
                <div className="flex items-end gap-3">
                  <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer mb-2">
                    <input type="checkbox" checked={isMerged} onChange={e => setIsMerged(e.target.checked)}
                      className="w-4 h-4 rounded" />
                    Merged score <span className="text-stone-400 text-xs">(combined from multiple tasters)</span>
                  </label>
                </div>
              </div>

              {/* Numeric dimensions */}
              <section className="mb-8 pb-8 border-b border-stone-100">
                <h2 className="text-sm font-semibold text-stone-700 mb-4">Numeric Scores <span className="text-stone-400 font-normal">(0–15 scale)</span></h2>
                <div className="space-y-3">
                  {numericDims.map(dim => {
                    const val = dimValues[dim.id] ?? {};
                    return (
                      <div key={dim.id} className="flex items-center gap-4">
                        <div className="w-36 shrink-0">
                          <p className="text-sm font-medium text-stone-700">{dim.name}</p>
                          {(dim.scale_min_label || dim.scale_max_label) && (
                            <p className="text-xs text-stone-400 leading-tight">
                              {dim.scale_min_label} → {dim.scale_max_label}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-1">
                          <input type="number" min={dim.scale_min} max={dim.scale_max} step="0.5"
                            value={val.value_min ?? ''}
                            onChange={e => setNumeric(dim.id, 'value_min', e.target.value)}
                            placeholder="min"
                            className="w-20 border border-stone-300 rounded px-2 py-1.5 text-sm text-center" />
                          <span className="text-stone-300 text-xs">–</span>
                          <input type="number" min={dim.scale_min} max={dim.scale_max} step="0.5"
                            value={val.value_max ?? ''}
                            onChange={e => setNumeric(dim.id, 'value_max', e.target.value)}
                            placeholder="max"
                            className="w-20 border border-stone-300 rounded px-2 py-1.5 text-sm text-center" />
                          <input value={val.notes ?? ''}
                            onChange={e => setDimNotes(dim.id, e.target.value)}
                            placeholder="notes (optional)"
                            className="flex-1 border border-stone-300 rounded px-3 py-1.5 text-sm" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Free-text dimensions */}
              <section className="mb-8 pb-8 border-b border-stone-100">
                <h2 className="text-sm font-semibold text-stone-700 mb-4">Free-Text Notes</h2>
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
                  <h2 className="text-sm font-semibold text-stone-700">
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
                          <span className="font-medium text-stone-700">{cat}</span>
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
                                  <p className={`text-xs font-medium ${isSelected ? 'text-stone-800' : 'text-stone-600'}`}>
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
                  <button onClick={handleSave} disabled={saving || !tasterName.trim()}
                    className="px-6 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
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
