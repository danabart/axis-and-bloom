import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

interface Roaster {
  id: string;
  name: string;
  api_endpoint: string | null;
  is_active: boolean;
  avg_fulfillment_hours: number | null;
  roaster_notes: string | null;
  created_at: string;
}

const EMPTY_FORM = {
  name: '',
  api_endpoint: '',
  avg_fulfillment_hours: '',
  roaster_notes: '',
};

export default function AdminRoasters() {
  const { user } = useAuth();
  const [roasters, setRoasters]   = useState<Roaster[]>([]);
  const [error, setError]         = useState('');
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState('');
  const [toggling, setToggling]   = useState<string | null>(null);

  async function load() {
    try {
      const token = await user!.getIdToken();
      const res   = await fetch('/api/admin/roasters', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRoasters(await res.json());
    } catch {
      setError('Failed to load roasters');
    }
  }

  useEffect(() => { load(); }, [user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    try {
      const token = await user!.getIdToken();
      const res   = await fetch('/api/admin/roasters', {
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

  async function toggleActive(id: string) {
    setToggling(id);
    try {
      const token = await user!.getIdToken();
      await fetch(`/api/admin/roasters/${id}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      await load();
    } catch {
      setError('Failed to update roaster');
    } finally {
      setToggling(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-stone-800">Roasteries</h1>
        <button
          onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 rounded text-sm font-medium text-white transition-opacity hover:opacity-80"
          style={{ backgroundColor: '#b05642' }}
        >
          {showForm ? 'Cancel' : '+ Add Roastery'}
        </button>
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {/* Add form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="border border-stone-200 rounded-lg p-6 mb-6 bg-stone-50 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs text-stone-500 mb-1">Name *</label>
            <input
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
              placeholder="e.g. Path Coffee Roasters"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">
              Avg Fulfillment Hours
            </label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={form.avg_fulfillment_hours}
              onChange={e => setForm(f => ({ ...f, avg_fulfillment_hours: e.target.value }))}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
              placeholder="e.g. 48"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">
              API Endpoint <span className="opacity-60">(optional — for future integration)</span>
            </label>
            <input
              value={form.api_endpoint}
              onChange={e => setForm(f => ({ ...f, api_endpoint: e.target.value }))}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
              placeholder="https://api.roastery.com/v1"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-stone-500 mb-1">Notes</label>
            <textarea
              rows={2}
              value={form.roaster_notes}
              onChange={e => setForm(f => ({ ...f, roaster_notes: e.target.value }))}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm resize-none"
              placeholder="e.g. Ships Mon–Fri, contact: orders@pathcoffee.com"
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
              {saving ? 'Saving…' : 'Add Roastery'}
            </button>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-stone-200 text-xs text-stone-400 uppercase tracking-wide">
              <th className="pb-3 pr-4">Name</th>
              <th className="pb-3 pr-4">Fulfillment</th>
              <th className="pb-3 pr-4">API</th>
              <th className="pb-3 pr-4">Notes</th>
              <th className="pb-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {roasters.length === 0 && (
              <tr><td colSpan={5} className="py-8 text-center text-stone-400">No roasteries yet</td></tr>
            )}
            {roasters.map(r => (
              <tr key={r.id} className="border-b border-stone-100 hover:bg-stone-50">
                <td className="py-3 pr-4 font-medium text-stone-800">{r.name}</td>
                <td className="py-3 pr-4 text-stone-500">
                  {r.avg_fulfillment_hours != null ? `${r.avg_fulfillment_hours}h` : '—'}
                </td>
                <td className="py-3 pr-4 text-stone-400 text-xs max-w-[180px] truncate">
                  {r.api_endpoint ?? '—'}
                </td>
                <td className="py-3 pr-4 text-stone-400 max-w-xs truncate">
                  {r.roaster_notes ?? '—'}
                </td>
                <td className="py-3">
                  <button
                    onClick={() => toggleActive(r.id)}
                    disabled={toggling === r.id}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-opacity hover:opacity-70 disabled:opacity-40 ${
                      r.is_active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-stone-100 text-stone-400'
                    }`}
                  >
                    {toggling === r.id ? '…' : r.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
