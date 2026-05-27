import { useEffect, useState } from 'react';
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

  // Expand panel state
  const [expandedId, setExpandedId]     = useState<number | null>(null);
  const [sessionCoffees, setSessionCoffees] = useState<SessionCoffee[]>([]);
  const [allCoffees, setAllCoffees]     = useState<Coffee[]>([]);
  const [addingCoffeeId, setAddingCoffeeId] = useState('');
  const [linking, setLinking]           = useState(false);
  const [removing, setRemoving]         = useState<number | null>(null);

  async function load() {
    try {
      const token = await user!.getIdToken();
      const res = await fetch('/api/admin/sessions', { headers: { Authorization: `Bearer ${token}` } });
      setSessions(await res.json());
    } catch { setError('Failed to load sessions'); }
  }

  async function loadAllCoffees() {
    if (allCoffees.length > 0) return;
    try {
      const token = await user!.getIdToken();
      const res = await fetch('/api/admin/coffees', { headers: { Authorization: `Bearer ${token}` } });
      setAllCoffees(await res.json());
    } catch { /* non-critical */ }
  }

  async function loadSessionCoffees(sessionId: number) {
    try {
      const token = await user!.getIdToken();
      const res = await fetch(`/api/admin/sessions/${sessionId}/coffees`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSessionCoffees(await res.json());
    } catch { setSessionCoffees([]); }
  }

  useEffect(() => { load(); }, [user]);

  async function toggleExpand(session: Session) {
    if (expandedId === session.id) {
      setExpandedId(null);
      setSessionCoffees([]);
      return;
    }
    setExpandedId(session.id);
    setAddingCoffeeId('');
    await Promise.all([loadSessionCoffees(session.id), loadAllCoffees()]);
  }

  async function handleAddCoffee() {
    if (!addingCoffeeId || !expandedId) return;
    setLinking(true);
    try {
      const token = await user!.getIdToken();
      await fetch(`/api/admin/sessions/${expandedId}/coffees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
      const token = await user!.getIdToken();
      await fetch(`/api/admin/sessions/${sessionId}/coffees/${scId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      await Promise.all([loadSessionCoffees(sessionId), load()]);
    } catch { setError('Failed to remove coffee'); }
    finally { setRemoving(null); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setSaveError('');
    try {
      const token = await user!.getIdToken();
      const res = await fetch('/api/admin/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Unknown error');
      setForm(EMPTY_FORM); setShowForm(false); await load();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(false); }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  const brewMethods = lookups.brew_method ?? [];
  const brewLabel = (v: string | null) => brewMethods.find(o => o.value === v)?.label ?? v ?? '—';

  // Coffees not yet in this session
  const linkedCoffeeIds = new Set(sessionCoffees.map(sc => sc.coffee_id));
  const available = allCoffees.filter(c => !linkedCoffeeIds.has(c.id));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-stone-800">Cupping Sessions</h1>
        <button onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 rounded text-sm font-medium text-white hover:opacity-80"
          style={{ backgroundColor: '#b05642' }}>
          {showForm ? 'Cancel' : '+ New Session'}
        </button>
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {showForm && (
        <form onSubmit={handleSubmit} className="border border-stone-200 rounded-lg p-6 mb-6 bg-stone-50 grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <label className="block text-xs text-stone-500 mb-1">Location</label>
            <input value={form.location}
              onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
              placeholder="e.g. HQ Brew Bar" />
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Notes</label>
            <input value={form.session_notes}
              onChange={e => setForm(f => ({ ...f, session_notes: e.target.value }))}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
              placeholder="e.g. Ethiopian naturals batch" />
          </div>
          {saveError && <p className="md:col-span-2 text-red-500 text-sm">{saveError}</p>}
          <div className="md:col-span-2 flex justify-end">
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
              <th className="pb-3 pr-4">Location</th>
              <th className="pb-3 pr-4">Brew Method</th>
              <th className="pb-3 pr-4">Coffees</th>
              <th className="pb-3">Notes</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 && (
              <tr><td colSpan={5} className="py-8 text-center text-stone-400">No sessions yet</td></tr>
            )}
            {sessions.map(s => (
              <>
                <tr key={s.id}
                  className={`border-b border-stone-100 cursor-pointer transition-colors ${expandedId === s.id ? 'bg-stone-50' : 'hover:bg-stone-50'}`}
                  onClick={() => toggleExpand(s)}>
                  <td className="py-3 pr-4 font-medium text-stone-800 flex items-center gap-2">
                    <span className={`text-stone-300 text-xs transition-transform ${expandedId === s.id ? 'rotate-90' : ''}`}>▶</span>
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
                      {/* Linked coffees */}
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

                      {/* Add coffee row */}
                      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        <select value={addingCoffeeId}
                          onChange={e => setAddingCoffeeId(e.target.value)}
                          className="border border-stone-300 rounded px-3 py-1.5 text-sm flex-1 max-w-xs">
                          <option value="">— add a coffee —</option>
                          {available.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.name}{c.roaster ? ` · ${c.roaster}` : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={handleAddCoffee}
                          disabled={!addingCoffeeId || linking}
                          className="px-4 py-1.5 rounded text-sm font-medium text-white disabled:opacity-40"
                          style={{ backgroundColor: '#b05642' }}>
                          {linking ? 'Adding…' : 'Add'}
                        </button>
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
