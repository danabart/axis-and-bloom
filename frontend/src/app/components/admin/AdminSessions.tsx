import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

interface Session {
  id: number;
  session_date: string;
  location: string | null;
  brew_method: string | null;
  session_notes: string | null;
  coffee_count: string;
}

const BREW_METHODS = ['filter', 'espresso', 'cupping', 'pour-over', 'french press', 'aeropress', 'other'];

const EMPTY_FORM = {
  session_date: '',
  brew_method: 'cupping',
  location: '',
  session_notes: '',
};

export default function AdminSessions() {
  const { user } = useAuth();
  const [sessions, setSessions]   = useState<Session[]>([]);
  const [error, setError]         = useState('');
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState('');

  async function load() {
    try {
      const token = await user!.getIdToken();
      const res   = await fetch('/api/admin/sessions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSessions(await res.json());
    } catch {
      setError('Failed to load sessions');
    }
  }

  useEffect(() => { load(); }, [user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    try {
      const token = await user!.getIdToken();
      const res   = await fetch('/api/admin/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Unknown error');
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-stone-800">Cupping Sessions</h1>
        <button
          onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 rounded text-sm font-medium text-white transition-opacity hover:opacity-80"
          style={{ backgroundColor: '#b05642' }}
        >
          {showForm ? 'Cancel' : '+ New Session'}
        </button>
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {/* Add form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="border border-stone-200 rounded-lg p-6 mb-6 bg-stone-50 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-stone-500 mb-1">Date *</label>
            <input
              required
              type="date"
              value={form.session_date}
              onChange={e => setForm(f => ({ ...f, session_date: e.target.value }))}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Brew Method</label>
            <select
              value={form.brew_method}
              onChange={e => setForm(f => ({ ...f, brew_method: e.target.value }))}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
            >
              {BREW_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Location</label>
            <input
              value={form.location}
              onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
              placeholder="e.g. HQ Brew Bar"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Notes</label>
            <input
              value={form.session_notes}
              onChange={e => setForm(f => ({ ...f, session_notes: e.target.value }))}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
              placeholder="e.g. Ethiopian naturals batch"
            />
          </div>
          {saveError && <p className="md:col-span-2 text-red-500 text-sm">{saveError}</p>}
          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: '#b05642' }}
            >
              {saving ? 'Saving…' : 'Create Session'}
            </button>
          </div>
        </form>
      )}

      {/* Table */}
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
              <tr key={s.id} className="border-b border-stone-100 hover:bg-stone-50">
                <td className="py-3 pr-4 font-medium text-stone-800">{formatDate(s.session_date)}</td>
                <td className="py-3 pr-4 text-stone-500">{s.location ?? '—'}</td>
                <td className="py-3 pr-4 text-stone-500">{s.brew_method ?? '—'}</td>
                <td className="py-3 pr-4 text-stone-500">{Number(s.coffee_count)}</td>
                <td className="py-3 text-stone-400 max-w-xs truncate">{s.session_notes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
