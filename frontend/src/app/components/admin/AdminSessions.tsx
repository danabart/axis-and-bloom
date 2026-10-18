import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { useAdminLookups } from '../../hooks/useAdminLookups';
import { reportError } from '../../lib/errorReporter';

// Cupping evidence brief 1 (2026-10-18): a session records whether the cuppers
// were blind, whether a roaster's person was at the table, which printed sheet
// was used, and its brew protocol (brew_defaults, 8.5 g / 150 g standard),
// which every coffee added to it inherits as its brew params. Each sample
// carries roast date, blind code, a sample note and the control flag. A sample
// with scores is evidence and can no longer be removed.
interface Session {
  id: number;
  session_date: string;
  session_date_precision: string;
  location: string | null;
  brew_method: string | null;
  brew_device: string | null;
  session_notes: string | null;
  coffee_count: string;
  sheet_format: string | null;
  is_blind: boolean | null;
  roaster_present: boolean | null;
  record_source: string;
}

interface SessionCoffee {
  session_coffee_id: number;
  display_order: number | null;
  coffee_id: number;
  name: string;
  roaster: string | null;
  origin: string | null;
  process: string | null;
  roast_level: string | null;
  roast_date: string | null;
  blind_code: string | null;
  sample_note: string | null;
  is_control: boolean;
  has_scores: boolean;
  dose_grams: string | null;
  water_grams: string | null;
}

interface SheetFormat { code: string; label: string; }
type SampleEdit = { roast_date: string; blind_code: string; sample_note: string; is_control: boolean };
const triState = (v: string) => (v === '' ? null : v === 'yes');

interface Coffee { id: number; name: string; roaster: string | null; is_active?: boolean; }
interface RoasterOption { id: string; name: string; }

// v_coffee-shaped row from GET /api/admin/catalog/coffees, mapped to the
// Coffee shape this component uses (roaster_name -> roaster).
function toCoffee(c: { id: number; name: string; roaster_name: string | null; is_active?: boolean }): Coffee {
  return { id: c.id, name: c.name, roaster: c.roaster_name, is_active: c.is_active };
}

const EMPTY_FORM = {
  session_date: '', session_date_precision: 'exact', location: '', session_notes: '',
  sheet_format: 'score_entry', is_blind: '', roaster_present: '',
  brew_device: '', dose_grams: '8.5', water_grams: '150',
};

export default function AdminSessions() {
  const { user } = useAuth();
  const { lookups } = useAdminLookups();
  const [sessions, setSessions]         = useState<Session[]>([]);
  const [error, setError]               = useState('');
  const [showForm, setShowForm]         = useState(false);
  const [form, setForm]                 = useState(EMPTY_FORM);
  const [saving, setSaving]             = useState(false);
  const [saveError, setSaveError]       = useState('');

  // Coffees to pre-link when creating a session
  const [allCoffees, setAllCoffees]     = useState<Coffee[]>([]);
  const [pendingCoffeeId, setPendingCoffeeId] = useState('');
  const [pendingCoffees, setPendingCoffees]   = useState<Coffee[]>([]);

  // Roaster dropdown for session form
  const [roasterOptions, setRoasterOptions] = useState<RoasterOption[]>([]);

  // Roastery lifecycle (2026-08-25) — "Show inactive" toggle for the coffee
  // picker (an admin may want to cup/prep an inactive coffee before
  // reactivating). Component state only, same pattern as every other admin
  // list this task touches.
  const [showInactive, setShowInactive] = useState(false);

  // Expand panel state
  const [expandedId, setExpandedId]     = useState<number | null>(null);
  const [sessionCoffees, setSessionCoffees] = useState<SessionCoffee[]>([]);
  const [addingCoffeeId, setAddingCoffeeId] = useState('');
  const [linking, setLinking]           = useState(false);
  const [removing, setRemoving]         = useState<number | null>(null);
  const [sheetFormats, setSheetFormats] = useState<SheetFormat[]>([]);
  const [sampleEdits, setSampleEdits]   = useState<Record<number, SampleEdit>>({});

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

  async function load() {
    if (!user) return;
    try {
      const res = await apiFetch('/api/admin/sessions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSessions(await res.json());
      setError('');
    } catch (err: unknown) {
      reportError('[AdminSessions/load]', err);
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    }
  }

  // GET /api/admin/coffees was retired (410, Catalog Blueprint brief 4) —
  // this cupping session coffee picker was missed at the time and kept
  // silently 410ing until caught as a hotfix; repointed to
  // /catalog/coffees (v_coffee-backed), mapped via toCoffee().
  async function loadAllCoffees(force = false) {
    if (allCoffees.length > 0 && !force) return;
    try {
      const res = await apiFetch(`/api/admin/catalog/coffees${showInactive ? '?include_inactive=true' : ''}`);
      if (res.ok) setAllCoffees((await res.json()).map(toCoffee));
    } catch (err) { reportError('[AdminSessions/load-all-coffees]', err); }
  }

  // The toggle only ever matters once the picker's been opened at least once
  // (loadAllCoffees is otherwise lazy) — force a re-fetch on flip rather than
  // eagerly loading coffees before the admin has opened any picker.
  function handleShowInactiveChange(next: boolean) {
    setShowInactive(next);
    if (allCoffees.length > 0) {
      apiFetch(`/api/admin/catalog/coffees${next ? '?include_inactive=true' : ''}`)
        .then(res => res.ok && res.json())
        .then(data => data && setAllCoffees(data.map(toCoffee)))
        .catch(err => reportError('[AdminSessions/load-all-coffees]', err));
    }
  }

  async function loadRoasters() {
    if (roasterOptions.length > 0) return;
    try {
      const res = await apiFetch('/api/admin/roasters');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setRoasterOptions(data.filter((r: { is_active: boolean }) => r.is_active));
    } catch (err) { reportError('[AdminSessions/load-roaster-options]', err); }
  }

  async function loadSessionCoffees(sessionId: number) {
    try {
      const res = await apiFetch(`/api/admin/sessions/${sessionId}/coffees`);
      const rows: SessionCoffee[] = res.ok ? await res.json() : [];
      setSessionCoffees(rows);
      setSampleEdits(Object.fromEntries(rows.map(r => [r.session_coffee_id, {
        roast_date: r.roast_date ? r.roast_date.slice(0, 10) : '', blind_code: r.blind_code ?? '',
        sample_note: r.sample_note ?? '', is_control: r.is_control,
      }])));
    } catch (err) { reportError('[AdminSessions/load-session-coffees]', err); setSessionCoffees([]); }
  }

  async function loadSheetFormats() {
    if (sheetFormats.length > 0) return;
    try {
      const res = await apiFetch('/api/admin/sheet-formats');
      if (res.ok) setSheetFormats(await res.json());
    } catch (err) { reportError('[AdminSessions/load-sheet-formats]', err); }
  }

  async function saveSample(sc: SessionCoffee, sessionId: number) {
    const edit = sampleEdits[sc.session_coffee_id];
    if (!edit) return;
    try {
      const res = await apiFetch(`/api/admin/sessions/${sessionId}/coffees/${sc.session_coffee_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roast_date: edit.roast_date || null, blind_code: edit.blind_code, sample_note: edit.sample_note, is_control: edit.is_control }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setError(e.message ?? e.error ?? 'Failed to save sample'); return; }
      await loadSessionCoffees(sessionId);
    } catch (err) { reportError('[AdminSessions/save-sample]', err); setError('Failed to save sample'); }
  }

  useEffect(() => { load(); }, [user]);

  async function toggleExpand(session: Session) {
    if (expandedId === session.id) {
      setExpandedId(null); setSessionCoffees([]); return;
    }
    setExpandedId(session.id);
    setAddingCoffeeId('');
    await Promise.all([loadSessionCoffees(session.id), loadAllCoffees()]);
  }

  function addPendingCoffee() {
    if (!pendingCoffeeId) return;
    const c = allCoffees.find(c => String(c.id) === pendingCoffeeId);
    if (!c || pendingCoffees.find(p => p.id === c.id)) return;
    setPendingCoffees(prev => [...prev, c]);
    setPendingCoffeeId('');
  }

  function removePendingCoffee(id: number) {
    setPendingCoffees(prev => prev.filter(c => c.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setSaveError('');
    try {
      // 1. Create session
      const dose = form.dose_grams ? Number(form.dose_grams) : null;
      const water = form.water_grams ? Number(form.water_grams) : null;
      const res = await apiFetch('/api/admin/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_date: form.session_date, session_date_precision: form.session_date_precision,
          location: form.location, session_notes: form.session_notes, sheet_format: form.sheet_format,
          is_blind: triState(form.is_blind), roaster_present: triState(form.roaster_present),
          brew_defaults: {
            dose_grams: dose, water_grams: water,
            ratio: dose && water ? Math.round((water / dose) * 100) / 100 : null,
            brew_device: form.brew_device || null,
          },
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message ?? e.error ?? 'Failed to create session'); }
      const session = await res.json();

      // 2. Link pre-selected coffees. Best-effort per item, matching the
      // existing behavior (a partial-link failure doesn't roll back the
      // session already created above) — previously entirely unrecorded.
      for (const c of pendingCoffees) {
        const linkRes = await apiFetch(`/api/admin/sessions/${session.id}/coffees`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coffee_id: c.id }),
        });
        if (!linkRes.ok) reportError('[AdminSessions/link-pending-coffee]', new Error(`HTTP ${linkRes.status}`), { coffeeId: c.id });
      }

      // 3. Reset + auto-expand the new session
      setForm(EMPTY_FORM); setPendingCoffees([]); setPendingCoffeeId('');
      setShowForm(false);
      await load();
      setExpandedId(session.id);
      await Promise.all([loadSessionCoffees(session.id), loadAllCoffees()]);
    } catch (err: unknown) {
      reportError('[AdminSessions/save]', err);
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(false); }
  }

  async function handleAddCoffee() {
    if (!addingCoffeeId || !expandedId) return;
    setLinking(true);
    try {
      const res = await apiFetch(`/api/admin/sessions/${expandedId}/coffees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coffee_id: Number(addingCoffeeId) }),
      });
      // Fake-success fix (Observability Foundation Part D) — apiFetch
      // never checks res.ok itself, so a failed link used to refresh the
      // list (showing nothing added) with no error.
      if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Failed to add coffee'); return; }
      setAddingCoffeeId('');
      await Promise.all([loadSessionCoffees(expandedId), load()]);
    } catch (err) { reportError('[AdminSessions/add-coffee]', err); setError('Failed to add coffee'); }
    finally { setLinking(false); }
  }

  async function handleRemoveCoffee(scId: number, sessionId: number) {
    setRemoving(scId);
    try {
      const res = await apiFetch(`/api/admin/sessions/${sessionId}/coffees/${scId}`, { method: 'DELETE' });
      // Fake-success fix (Observability Foundation Part D) — same gap as
      // handleAddCoffee above.
      if (!res.ok) { const e = await res.json().catch(() => ({})); setError(e.message ?? e.error ?? 'Failed to remove coffee'); return; }
      await Promise.all([loadSessionCoffees(sessionId), load()]);
    } catch (err) { reportError('[AdminSessions/remove-coffee]', err); setError('Failed to remove coffee'); }
    finally { setRemoving(null); }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  const brewMethods = lookups.brew_method ?? [];
  const brewLabel = (v: string | null) => brewMethods.find(o => o.value === v)?.label ?? v ?? '—';

  const linkedCoffeeIds = new Set(sessionCoffees.map(sc => sc.coffee_id));
  const pendingIds = new Set(pendingCoffees.map(c => c.id));
  const availableForSession = allCoffees.filter(c => !linkedCoffeeIds.has(c.id));
  const availableForPending = allCoffees.filter(c => !pendingIds.has(c.id));

  const [refreshing, setRefreshing] = useState(false);
  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-normal text-stone-800">Cupping Sessions</h1>
          <button onClick={handleRefresh} disabled={refreshing}
            title="Refresh from database"
            className="text-stone-400 hover:text-stone-700 disabled:opacity-40 transition-colors text-base leading-none"
            style={{ fontSize: '1.1rem' }}>
            {refreshing ? '…' : '↻'}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-stone-500">
            <input type="checkbox" checked={showInactive} onChange={e => handleShowInactiveChange(e.target.checked)}
              className="accent-stone-700" />
            Show inactive
          </label>
          <Link to="/admin/cupping"
            className="px-4 py-2 rounded text-sm font-normal text-stone-600 border border-stone-200 hover:bg-stone-50">
            Score Entry →
          </Link>
          <button onClick={() => { setShowForm(v => !v); if (!showForm) { loadAllCoffees(); loadRoasters(); loadSheetFormats(); } }}
            className="px-4 py-2 rounded text-sm font-normal text-white hover:opacity-80"
            style={{ backgroundColor: '#b05642' }}>
            {showForm ? 'Cancel' : '+ New Session'}
          </button>
        </div>
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {showForm && (
        <form onSubmit={handleSubmit} className="border border-stone-200 rounded-lg p-6 mb-6 bg-stone-50 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-stone-500 mb-1">Date *</label>
              <input required type="date" value={form.session_date}
                onChange={e => setForm(f => ({ ...f, session_date: e.target.value }))}
                className="w-full border border-stone-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">Date precision</label>
              <select value={form.session_date_precision}
                onChange={e => setForm(f => ({ ...f, session_date_precision: e.target.value }))}
                className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
                <option value="exact">exact</option>
                <option value="estimated">estimated</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">Sheet format</label>
              <select value={form.sheet_format}
                onChange={e => setForm(f => ({ ...f, sheet_format: e.target.value }))}
                className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
                {sheetFormats.length === 0 && <option value="score_entry">Score Entry (admin)</option>}
                {sheetFormats.map(sf => <option key={sf.code} value={sf.code}>{sf.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-stone-500 mb-1">Blind</label>
                <select value={form.is_blind} onChange={e => setForm(f => ({ ...f, is_blind: e.target.value }))}
                  className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
                  <option value="">—</option><option value="yes">yes</option><option value="no">no</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">Roaster present</label>
                <select value={form.roaster_present} onChange={e => setForm(f => ({ ...f, roaster_present: e.target.value }))}
                  className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
                  <option value="">—</option><option value="yes">yes</option><option value="no">no</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-stone-500 mb-1">Dose (g)</label>
                <input type="number" step="0.1" value={form.dose_grams}
                  onChange={e => setForm(f => ({ ...f, dose_grams: e.target.value }))}
                  className="w-full border border-stone-300 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">Water (g)</label>
                <input type="number" step="1" value={form.water_grams}
                  onChange={e => setForm(f => ({ ...f, water_grams: e.target.value }))}
                  className="w-full border border-stone-300 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">Brew device</label>
                <select value={form.brew_device}
                  onChange={e => setForm(f => ({ ...f, brew_device: e.target.value }))}
                  className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
                  <option value="">— select —</option>
                  {brewMethods.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">Roastery</label>
              {roasterOptions.length > 0
                ? <select
                    value={form.location}
                    onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                    className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
                    <option value="">— select roastery —</option>
                    {roasterOptions.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                  </select>
                : <input
                    value={form.location}
                    onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                    className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
                    placeholder="e.g. Path Coffee Roasters" />
              }
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">Notes</label>
              <input value={form.session_notes}
                onChange={e => setForm(f => ({ ...f, session_notes: e.target.value }))}
                className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
                placeholder="e.g. Ethiopian naturals batch" />
            </div>
          </div>

          {/* Coffee pre-selection */}
          <div>
            <label className="block text-xs text-stone-500 mb-2">Add Coffees <span className="opacity-60">(optional — can also add later)</span></label>
            <div className="flex items-center gap-2 mb-2">
              <select value={pendingCoffeeId}
                onChange={e => setPendingCoffeeId(e.target.value)}
                className="border border-stone-300 rounded px-3 py-1.5 text-sm flex-1 max-w-xs">
                <option value="">— pick a coffee —</option>
                {availableForPending.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.roaster ? ` · ${c.roaster}` : ''}{c.is_active === false ? ' (inactive)' : ''}</option>
                ))}
              </select>
              <button type="button" onClick={addPendingCoffee} disabled={!pendingCoffeeId}
                className="px-3 py-1.5 rounded text-sm font-normal border border-stone-300 text-stone-600 hover:bg-stone-100 disabled:opacity-40">
                Add
              </button>
            </div>
            {pendingCoffees.length > 0 && (
              <ul className="space-y-1">
                {pendingCoffees.map((c, i) => (
                  <li key={c.id} className="flex items-center justify-between text-sm text-stone-700 bg-white border border-stone-200 rounded px-3 py-1.5">
                    <span><span className="text-stone-400 text-xs mr-2">#{i + 1}</span>{c.name}{c.roaster ? ` · ${c.roaster}` : ''}</span>
                    <button type="button" onClick={() => removePendingCoffee(c.id)}
                      className="text-stone-300 hover:text-red-400 text-xs">✕</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {saveError && <p className="text-red-500 text-sm">{saveError}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={saving}
              className="px-5 py-2 rounded text-sm font-normal text-white disabled:opacity-50"
              style={{ backgroundColor: '#b05642' }}>
              {saving ? 'Saving…' : 'Create Session'}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-stone-200 text-xs text-stone-400 uppercase tracking-wide">
              <th className="pb-3 pr-4">Date</th>
              <th className="pb-3 pr-4">Roastery</th>
              <th className="pb-3 pr-4">Brew Method</th>
              <th className="pb-3 pr-4">Coffees</th>
              <th className="pb-3">Notes</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 && (
              <tr><td colSpan={5} className="py-8 text-center text-stone-400">No sessions yet — create one above</td></tr>
            )}
            {sessions.map(s => (
              <>
                <tr key={s.id}
                  className={`border-b border-stone-100 cursor-pointer transition-colors ${expandedId === s.id ? 'bg-stone-50' : 'hover:bg-stone-50'}`}
                  onClick={() => toggleExpand(s)}>
                  <td className="py-3 pr-4 font-normal text-stone-800 flex items-center gap-2">
                    <span className={`text-stone-300 text-xs transition-transform inline-block ${expandedId === s.id ? 'rotate-90' : ''}`}>▶</span>
                    {formatDate(s.session_date)}
                  </td>
                  <td className="py-3 pr-4 text-stone-500">{s.location ?? '—'}</td>
                  <td className="py-3 pr-4 text-stone-500">
                    {s.brew_device ? brewLabel(s.brew_device) : brewLabel(s.brew_method)}
                    {s.is_blind && <span className="ml-1 text-xs text-stone-400">· blind</span>}
                    {s.roaster_present && <span className="ml-1 text-xs text-stone-400">· roaster present</span>}
                  </td>
                  <td className="py-3 pr-4 text-stone-500">{Number(s.coffee_count)}</td>
                  <td className="py-3 text-stone-400 max-w-xs truncate">{s.session_notes ?? '—'}</td>
                </tr>

                {expandedId === s.id && (
                  <tr key={`expand-${s.id}`} className="border-b border-stone-200 bg-stone-50">
                    <td colSpan={5} className="px-6 py-4">
                      {sessionCoffees.length === 0
                        ? <p className="text-stone-400 text-xs mb-3">No coffees in this session yet.</p>
                        : (
                          <ul className="mb-3 space-y-1.5">
                            {sessionCoffees.map((sc, i) => {
                              const edit = sampleEdits[sc.session_coffee_id];
                              const setEdit = (patch: Partial<SampleEdit>) =>
                                setSampleEdits(prev => ({ ...prev, [sc.session_coffee_id]: { ...prev[sc.session_coffee_id], ...patch } }));
                              return (
                              <li key={sc.session_coffee_id} className="text-sm text-stone-700" onClick={e => e.stopPropagation()}>
                                <div className="flex items-center justify-between gap-4">
                                  <span>
                                    <span className="text-stone-400 text-xs mr-2">#{i + 1}</span>
                                    <span className="font-normal">{sc.name}</span>
                                    {sc.roaster && <span className="text-stone-400 ml-1">· {sc.roaster}</span>}
                                    {sc.dose_grams && <span className="text-stone-400 text-xs ml-2">{Number(sc.dose_grams)} g / {Number(sc.water_grams)} g</span>}
                                    {sc.has_scores && <span className="text-stone-400 text-xs ml-2">· scored</span>}
                                  </span>
                                  {!sc.has_scores && (
                                    <button
                                      onClick={() => handleRemoveCoffee(sc.session_coffee_id, s.id)}
                                      disabled={removing === sc.session_coffee_id}
                                      className="text-stone-300 hover:text-red-400 text-xs transition-colors disabled:opacity-40">
                                      {removing === sc.session_coffee_id ? '…' : '✕ remove'}
                                    </button>
                                  )}
                                </div>
                                {edit && (
                                  <div className="flex items-center gap-2 mt-1 ml-6 text-xs">
                                    <input type="date" value={edit.roast_date} onChange={e => setEdit({ roast_date: e.target.value })}
                                      title="Roast date" className="border border-stone-300 rounded px-2 py-1" />
                                    <input value={edit.blind_code} onChange={e => setEdit({ blind_code: e.target.value })}
                                      placeholder="blind code" className="border border-stone-300 rounded px-2 py-1 w-28" />
                                    <input value={edit.sample_note} onChange={e => setEdit({ sample_note: e.target.value })}
                                      placeholder="sample note" className="border border-stone-300 rounded px-2 py-1 flex-1" />
                                    <label className="flex items-center gap-1 text-stone-500">
                                      <input type="checkbox" checked={edit.is_control} onChange={e => setEdit({ is_control: e.target.checked })} />
                                      control
                                    </label>
                                    <button onClick={() => saveSample(sc, s.id)}
                                      className="px-2 py-1 rounded border border-stone-300 text-stone-600 hover:bg-stone-100">save</button>
                                  </div>
                                )}
                              </li>
                              );
                            })}
                          </ul>
                        )
                      }
                      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        <select value={addingCoffeeId}
                          onChange={e => setAddingCoffeeId(e.target.value)}
                          className="border border-stone-300 rounded px-3 py-1.5 text-sm flex-1 max-w-xs">
                          <option value="">— add a coffee —</option>
                          {availableForSession.map(c => (
                            <option key={c.id} value={c.id}>{c.name}{c.roaster ? ` · ${c.roaster}` : ''}{c.is_active === false ? ' (inactive)' : ''}</option>
                          ))}
                        </select>
                        <button onClick={handleAddCoffee} disabled={!addingCoffeeId || linking}
                          className="px-4 py-1.5 rounded text-sm font-normal text-white disabled:opacity-40"
                          style={{ backgroundColor: '#b05642' }}>
                          {linking ? 'Adding…' : 'Add'}
                        </button>
                        <Link to="/admin/cupping" onClick={e => e.stopPropagation()}
                          className="ml-2 text-xs text-stone-400 hover:text-stone-700 underline">
                          Enter scores →
                        </Link>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
