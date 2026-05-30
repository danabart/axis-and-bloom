import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { useAdminLookups } from '../../hooks/useAdminLookups';

interface Session {
  id: number;
  session_date: string;
  location: string | null;
  brew_method: string | null;
  session_notes: string | null;
  coffee_count: string;
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
}

interface Coffee { id: number; name: string; roaster: string | null; }
interface RoasterOption { id: string; name: string; }

const EMPTY_FORM = { session_date: '', brew_method: '', location: '', session_notes: '' };

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

  // Expand panel state
  const [expandedId, setExpandedId]     = useState<number | null>(null);
  const [sessionCoffees, setSessionCoffees] = useState<SessionCoffee[]>([]);
  const [addingCoffeeId, setAddingCoffeeId] = useState('');
  const [linking, setLinking]           = useState(false);
  const [removing, setRemoving]         = useState<number | null>(null);

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
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    }
  }

  async function loadAllCoffees() {
    if (allCoffees.length > 0) return;
    try {
      const res = await apiFetch('/api/admin/coffees');
      if (res.ok) setAllCoffees(await res.json());
    } catch { /* non-critical */ }
  }

  async function loadRoasters() {
    if (roasterOptions.length > 0) return;
    try {
      const res = await apiFetch('/api/admin/roasters');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setRoasterOptions(data.filter((r: { is_active: boolean }) => r.is_active));
    } catch { /* non-critical */ }
  }

  async function loadSessionCoffees(sessionId: number) {
    try {
      const res = await apiFetch(`/api/admin/sessions/${sessionId}/coffees`);
      if (res.ok) setSessionCoffees(await res.json());
      else setSessionCoffees([]);
    } catch { setSessionCoffees([]); }
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
      const res = await apiFetch('/api/admin/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to create session');
      const session = await res.json();

      // 2. Link pre-selected coffees
      for (const c of pendingCoffees) {
        await apiFetch(`/api/admin/sessions/${session.id}/coffees`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coffee_id: c.id }),
        });
      }

      // 3. Reset + auto-expand the new session
      setForm(EMPTY_FORM); setPendingCoffees([]); setPendingCoffeeId('');
      setShowForm(false);
      await load();
      setExpandedId(session.id);
      await Promise.all([loadSessionCoffees(session.id), loadAllCoffees()]);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(false); }
  }

  async function handleAddCoffee() {
    if (!addingCoffeeId || !expandedId) return;
    setLinking(true);
    try {
      await apiFetch(`/api/admin/sessions/${expandedId}/coffees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coffee_id: Number(addingCoffeeId) }),
      });
      setAddingCoffeeId('');
      await Promise.all([loadSessionCoffees(expandedId), load()]);
    } catch { setError('Failed to add coffee'); }
    finally { setLinking(false); }
  }

  async function handleRemoveCoffee(scId: number, sessionId: number) {
    setRemoving(scId);
    try {
      await apiFetch(`/api/admin/sessions/${sessionId}/coffees/${scId}`, { method: 'DELETE' });
      await Promise.all([loadSessionCoffees(sessionId), load()]);
    } catch { setError('Failed to remove coffee'); }
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
          <h1 className="text-xl font-semibold text-stone-800">Cupping Sessions</h1>
          <button onClick={handleRefresh} disabled={refreshing}
            title="Refresh from database"
            className="text-stone-400 hover:text-stone-700 disabled:opacity-40 transition-colors text-base leading-none"
            style={{ fontSize: '1.1rem' }}>
            {refreshing ? '…' : '↻'}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/admin/cupping"
            className="px-4 py-2 rounded text-sm font-medium text-stone-600 border border-stone-200 hover:bg-stone-50">
            Score Entry →
          </Link>
          <button onClick={() => { setShowForm(v => !v); if (!showForm) { loadAllCoffees(); loadRoasters(); } }}
            className="px-4 py-2 rounded text-sm font-medium text-white hover:opacity-80"
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
              <label className="block text-xs text-stone-500 mb-1">Brew Method</label>
              <select value={form.brew_method}
                onChange={e => setForm(f => ({ ...f, brew_method: e.target.value }))}
                className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
                <option value="">— select —</option>
                {brewMethods.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
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
                  <option key={c.id} value={c.id}>{c.name}{c.roaster ? ` · ${c.roaster}` : ''}</option>
                ))}
              </select>
              <button type="button" onClick={addPendingCoffee} disabled={!pendingCoffeeId}
                className="px-3 py-1.5 rounded text-sm font-medium border border-stone-300 text-stone-600 hover:bg-stone-100 disabled:opacity-40">
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
              className="px-5 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
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
                  <td className="py-3 pr-4 font-medium text-stone-800 flex items-center gap-2">
                    <span className={`text-stone-300 text-xs transition-transform inline-block ${expandedId === s.id ? 'rotate-90' : ''}`}>▶</span>
                    {formatDate(s.session_date)}
                  </td>
                  <td className="py-3 pr-4 text-stone-500">{s.location ?? '—'}</td>
                  <td className="py-3 pr-4 text-stone-500">{brewLabel(s.brew_method)}</td>
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
                            {sessionCoffees.map((sc, i) => (
                              <li key={sc.session_coffee_id} className="flex items-center justify-between gap-4 text-sm text-stone-700">
                                <span>
                                  <span className="text-stone-400 text-xs mr-2">#{i + 1}</span>
                                  <span className="font-medium">{sc.name}</span>
                                  {sc.roaster && <span className="text-stone-400 ml-1">· {sc.roaster}</span>}
                                </span>
                                <button
                                  onClick={e => { e.stopPropagation(); handleRemoveCoffee(sc.session_coffee_id, s.id); }}
                                  disabled={removing === sc.session_coffee_id}
                                  className="text-stone-300 hover:text-red-400 text-xs transition-colors disabled:opacity-40">
                                  {removing === sc.session_coffee_id ? '…' : '✕ remove'}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )
                      }
                      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        <select value={addingCoffeeId}
                          onChange={e => setAddingCoffeeId(e.target.value)}
                          className="border border-stone-300 rounded px-3 py-1.5 text-sm flex-1 max-w-xs">
                          <option value="">— add a coffee —</option>
                          {availableForSession.map(c => (
                            <option key={c.id} value={c.id}>{c.name}{c.roaster ? ` · ${c.roaster}` : ''}</option>
                          ))}
                        </select>
                        <button onClick={handleAddCoffee} disabled={!addingCoffeeId || linking}
                          className="px-4 py-1.5 rounded text-sm font-medium text-white disabled:opacity-40"
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
