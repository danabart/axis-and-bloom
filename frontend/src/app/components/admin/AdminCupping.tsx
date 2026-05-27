import { useEffect, useState, useCallback } from 'react';
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
  const [sessions, setSessions]       = useState<Session[]>([]);
  const [dimensions, setDimensions]   = useState<Dimension[]>([]);
  const [cuppingNotes, setCuppingNotes] = useState<CuppingNote[]>([]);

  // Selection
  const [sessionId, setSessionId]     = useState('');
  const [scCoffees, setScCoffees]     = useState<SessionCoffee[]>([]);
  const [scId, setScId]               = useState('');

  // Form
  const [tasterName, setTasterName]   = useState('');
  const [isMerged, setIsMerged]       = useState(false);
  const [overallNotes, setOverallNotes] = useState('');
  const [dimValues, setDimValues]     = useState<Record<number, DimValue>>({});
  const [selectedDesc, setSelectedDesc] = useState<Record<string, DescriptorEntry>>({});

  // UI state
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const [saving, setSaving]           = useState(false);
  const [saveMsg, setSaveMsg]         = useState('');
  const [error, setError]             = useState('');

  // ── Load reference data ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    (async () => {
      const token = await user.getIdToken();
      const headers = { Authorization: `Bearer ${token}` };
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

  // ── Load coffees when session changes ─────────────────────────────────────
  useEffect(() => {
    setScId(''); setScCoffees([]);
    if (!sessionId || !user) return;
    (async () => {
      const token = await user.getIdToken();
      const res = await fetch(`/api/admin/sessions/${sessionId}/coffees`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setScCoffees(await res.json());
    })();
  }, [sessionId, user]);

  // ── Load existing scores when session_coffee changes ─────────────────────
  const resetForm = useCallback(() => {
    setTasterName(''); setIsMerged(false); setOverallNotes('');
    setDimValues({}); setSelectedDesc({});
  }, []);

  useEffect(() => {
    resetForm();
    setSaveMsg('');
    if (!scId || !user) return;
    (async () => {
      const token = await user.getIdToken();
      const res = await fetch(`/api/admin/scores/session-coffee/${scId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.scores?.length) return;

      // Pre-load the first score (most recent / merged)
      const score = data.scores[data.scores.length - 1];
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
    })();
  }, [scId, user, resetForm]);

  // ── Save ────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!scId || !tasterName.trim()) { setError('Select a coffee and enter a taster name'); return; }
    setSaving(true); setError(''); setSaveMsg('');
    try {
      const token = await user!.getIdToken();
      const res = await fetch('/api/admin/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
      setSaveMsg('Saved ✓');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(false); }
  }

  // ── Descriptor helpers ───────────────────────────────────────────────────
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

  // ── Dimension helpers ─────────────────────────────────────────────────────
  function setNumeric(dimId: number, field: 'value_min' | 'value_max', v: string) {
    setDimValues(prev => ({ ...prev, [dimId]: { ...prev[dimId], [field]: v === '' ? undefined : Number(v) } }));
  }
  function setDimNotes(dimId: number, notes: string) {
    setDimValues(prev => ({ ...prev, [dimId]: { ...prev[dimId], notes } }));
  }

  const numericDims = dimensions.filter(d => d.is_numeric);
  const textDims    = dimensions.filter(d => !d.is_numeric);
  const selectedCount = Object.keys(selectedDesc).length;

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-stone-800 mb-6">Cupping Score Entry</h1>

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
            <p className="text-xs text-stone-400 mt-1">No coffees linked to this session yet — add them in Sessions.</p>
          )}
        </div>
      </div>

      {scId && (
        <>
          {/* ── Taster ── */}
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

          {/* ── Numeric dimensions ── */}
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

          {/* ── Free-text dimensions ── */}
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

          {/* ── SCA Descriptor picker ── */}
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
                              className={`rounded border p-2 cursor-pointer transition-colors ${
                                isSelected ? 'border-stone-400 bg-stone-100' : 'border-stone-200 hover:border-stone-300'
                              }`}
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

          {/* ── Overall notes + save ── */}
          <section className="mb-8">
            <label className="block text-xs text-stone-500 mb-1">Overall Notes</label>
            <textarea rows={3} value={overallNotes} onChange={e => setOverallNotes(e.target.value)}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm resize-none mb-4"
              placeholder="General impressions, context, anything that doesn't fit a dimension…" />

            {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
            {saveMsg && <p className="text-green-600 text-sm mb-3">{saveMsg}</p>}

            <button onClick={handleSave} disabled={saving || !tasterName.trim()}
              className="px-6 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: '#b05642' }}>
              {saving ? 'Saving…' : 'Save Score'}
            </button>
          </section>
        </>
      )}

      {!scId && sessionId && scCoffees.length > 0 && (
        <p className="text-stone-400 text-sm">Select a coffee above to start entering scores.</p>
      )}
      {!sessionId && (
        <p className="text-stone-400 text-sm">Select a session to begin.</p>
      )}
    </div>
  );
}
