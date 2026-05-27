import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

interface Roaster {
  id: string;
  name: string;
  api_endpoint: string | null;
  is_active: boolean;
  avg_fulfillment_hours: number | null;
  roaster_notes: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  contact_person: string | null;
  website: string | null;
  created_at: string;
}

type RoasterFormData = {
  name: string; api_endpoint: string; avg_fulfillment_hours: string; roaster_notes: string;
  address: string; email: string; phone: string; contact_person: string; website: string;
};

const EMPTY_FORM: RoasterFormData = {
  name: '', api_endpoint: '', avg_fulfillment_hours: '', roaster_notes: '',
  address: '', email: '', phone: '', contact_person: '', website: '',
};

function RoasterForm({
  initial, onSave, onCancel, submitLabel,
}: {
  initial: RoasterFormData;
  onSave: (data: RoasterFormData) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [form, setForm] = useState<RoasterFormData>(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const f = (k: keyof RoasterFormData) => (v: string) => setForm(prev => ({ ...prev, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setSaveError('');
    try { await onSave(form); }
    catch (err: unknown) { setSaveError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="md:col-span-2">
        <label className="block text-xs text-stone-500 mb-1">Name *</label>
        <input required value={form.name} onChange={e => f('name')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          placeholder="e.g. Path Coffee Roasters" />
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">Contact Person</label>
        <input value={form.contact_person} onChange={e => f('contact_person')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          placeholder="e.g. Jane Smith" />
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">Email</label>
        <input type="email" value={form.email} onChange={e => f('email')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          placeholder="orders@roastery.com" />
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">Phone</label>
        <input value={form.phone} onChange={e => f('phone')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          placeholder="+1 (212) 555-0100" />
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">Website</label>
        <input value={form.website} onChange={e => f('website')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          placeholder="https://roastery.com" />
      </div>
      <div className="md:col-span-2">
        <label className="block text-xs text-stone-500 mb-1">Address</label>
        <input value={form.address} onChange={e => f('address')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          placeholder="123 Roastery Ave, Brooklyn, NY 11201" />
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">Avg Fulfillment Hours</label>
        <input type="number" min="0" step="0.5" value={form.avg_fulfillment_hours}
          onChange={e => f('avg_fulfillment_hours')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          placeholder="e.g. 48" />
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">API Endpoint <span className="opacity-60">(optional)</span></label>
        <input value={form.api_endpoint} onChange={e => f('api_endpoint')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          placeholder="https://api.roastery.com/v1" />
      </div>
      <div className="md:col-span-2">
        <label className="block text-xs text-stone-500 mb-1">Notes</label>
        <textarea rows={2} value={form.roaster_notes} onChange={e => f('roaster_notes')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm resize-none"
          placeholder="Ships Mon–Fri, lead time 3–5 days…" />
      </div>
      {saveError && <p className="md:col-span-2 text-red-500 text-sm">{saveError}</p>}
      <div className="md:col-span-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 rounded text-sm border border-stone-200 text-stone-500 hover:bg-stone-50">
          Cancel
        </button>
        <button type="submit" disabled={saving}
          className="px-5 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: '#b05642' }}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

export default function AdminRoasters() {
  const { user } = useAuth();
  const [roasters, setRoasters]       = useState<Roaster[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [toggling, setToggling]       = useState<string | null>(null);

  async function getToken() { return user!.getIdToken(); }

  async function load() {
    try {
      const res = await fetch('/api/admin/roasters', {
        headers: { Authorization: `Bearer ${await getToken()}` },
      });
      const data = await res.json();
      // Guard: if API returned an error object instead of an array, show error
      if (!Array.isArray(data)) {
        setError(data?.error ?? 'Failed to load roasteries');
        setRoasters([]);
      } else {
        setRoasters(data);
        setError('');
      }
    } catch {
      setError('Failed to load roasteries');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (user) load(); }, [user]);

  async function handleAdd(data: RoasterFormData) {
    const res = await fetch('/api/admin/roasters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken()}` },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to add');
    setShowAddForm(false); await load();
  }

  async function handleEdit(id: string, data: RoasterFormData) {
    const res = await fetch(`/api/admin/roasters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken()}` },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to update');
    setEditingId(null); await load();
  }

  async function toggleActive(id: string) {
    setToggling(id);
    try {
      await fetch(`/api/admin/roasters/${id}/toggle`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${await getToken()}` },
      });
      await load();
    } catch { setError('Failed to update'); }
    finally { setToggling(null); }
  }

  function roasterToForm(r: Roaster): RoasterFormData {
    return {
      name: r.name, api_endpoint: r.api_endpoint ?? '',
      avg_fulfillment_hours: r.avg_fulfillment_hours?.toString() ?? '',
      roaster_notes: r.roaster_notes ?? '', address: r.address ?? '',
      email: r.email ?? '', phone: r.phone ?? '',
      contact_person: r.contact_person ?? '', website: r.website ?? '',
    };
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-stone-800">Roasteries</h1>
        <button onClick={() => { setShowAddForm(v => !v); setEditingId(null); }}
          className="px-4 py-2 rounded text-sm font-medium text-white hover:opacity-80"
          style={{ backgroundColor: '#b05642' }}>
          {showAddForm ? 'Cancel' : '+ Add Roastery'}
        </button>
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {showAddForm && (
        <div className="border border-stone-200 rounded-lg p-6 mb-6 bg-stone-50">
          <RoasterForm
            initial={EMPTY_FORM}
            onSave={handleAdd}
            onCancel={() => setShowAddForm(false)}
            submitLabel="Add Roastery"
          />
        </div>
      )}

      {loading && <p className="text-stone-400 text-sm py-8 text-center">Loading…</p>}

      {!loading && roasters.length === 0 && !showAddForm && (
        <div className="py-12 text-center text-stone-400">
          <p className="text-lg mb-1">No roasteries yet</p>
          <p className="text-sm">Click "+ Add Roastery" to add your first partner roastery.</p>
        </div>
      )}

      <div className="space-y-3">
        {roasters.map(r => (
          <div key={r.id} className="border border-stone-200 rounded-lg overflow-hidden">
            <div className="flex items-start justify-between px-5 py-4 hover:bg-stone-50 transition-colors">
              <div className="space-y-1 flex-1 min-w-0 pr-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-stone-800">{r.name}</p>
                  <button onClick={() => toggleActive(r.id)} disabled={toggling === r.id}
                    className={`px-2 py-0.5 rounded-full text-xs font-medium transition-opacity hover:opacity-70 disabled:opacity-40 ${
                      r.is_active ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-400'
                    }`}>
                    {toggling === r.id ? '…' : r.is_active ? 'Active' : 'Inactive'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-stone-500">
                  {r.contact_person && <span>👤 {r.contact_person}</span>}
                  {r.email          && <span>✉ {r.email}</span>}
                  {r.phone          && <span>📞 {r.phone}</span>}
                  {r.address        && <span>📍 {r.address}</span>}
                  {r.website        && (
                    <a href={r.website} target="_blank" rel="noreferrer"
                      className="underline hover:text-stone-700">
                      🔗 Website
                    </a>
                  )}
                  {r.avg_fulfillment_hours != null && (
                    <span>⏱ {r.avg_fulfillment_hours}h fulfillment</span>
                  )}
                </div>
                {r.roaster_notes && (
                  <p className="text-xs text-stone-400 truncate max-w-xl">{r.roaster_notes}</p>
                )}
              </div>
              <button
                onClick={() => setEditingId(editingId === r.id ? null : r.id)}
                className="shrink-0 px-3 py-1.5 rounded text-xs font-medium border border-stone-200 text-stone-500 hover:bg-stone-100">
                {editingId === r.id ? 'Cancel' : '✏️ Edit'}
              </button>
            </div>

            {editingId === r.id && (
              <div className="border-t border-stone-200 px-5 py-5 bg-stone-50">
                <RoasterForm
                  initial={roasterToForm(r)}
                  onSave={data => handleEdit(r.id, data)}
                  onCancel={() => setEditingId(null)}
                  submitLabel="Save Changes"
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
