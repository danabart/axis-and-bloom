import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAdminLookups } from '../../hooks/useAdminLookups';

interface Coffee {
  id: number;
  name: string;
  roaster: string | null;
  origin: string | null;
  blend_or_single: string | null;
  process: string | null;
  roast_level: string | null;
  flavor_descriptors_roaster: string[] | null;
  archetype: string | null;
  confidence: number | null;
}

const EMPTY_FORM = {
  name: '',
  roaster: '',
  origin: '',
  blend_or_single: '',
  process: '',
  roast_level: '',
  flavor_descriptors_roaster: '',
};

function LookupSelect({
  category,
  value,
  onChange,
  lookups,
}: {
  category: string;
  value: string;
  onChange: (v: string) => void;
  lookups: Record<string, { value: string; label: string }[]>;
}) {
  const options = lookups[category] ?? [];
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
    >
      <option value="">— select —</option>
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export default function AdminCoffees() {
  const { user } = useAuth();
  const { lookups } = useAdminLookups();
  const [coffees, setCoffees]     = useState<Coffee[]>([]);
  const [error, setError]         = useState('');
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState('');

  async function load() {
    try {
      const token = await user!.getIdToken();
      const res   = await fetch('/api/admin/coffees', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setCoffees(await res.json());
    } catch {
      setError('Failed to load coffees');
    }
  }

  useEffect(() => { load(); }, [user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    try {
      const token = await user!.getIdToken();
      const res   = await fetch('/api/admin/coffees', {
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

  const field = (key: keyof typeof EMPTY_FORM) => (v: string) =>
    setForm(f => ({ ...f, [key]: v }));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-stone-800">Coffees</h1>
        <button
          onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 rounded text-sm font-medium text-white transition-opacity hover:opacity-80"
          style={{ backgroundColor: '#b05642' }}
        >
          {showForm ? 'Cancel' : '+ Add Coffee'}
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
              onChange={e => field('name')(e.target.value)}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
              placeholder="e.g. Yirgacheffe Natural"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Roaster</label>
            <input
              value={form.roaster}
              onChange={e => field('roaster')(e.target.value)}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
              placeholder="e.g. Path Coffee Roasters"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Origin</label>
            <input
              value={form.origin}
              onChange={e => field('origin')(e.target.value)}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
              placeholder="e.g. Ethiopia"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Blend or Single</label>
            <LookupSelect category="blend_or_single" value={form.blend_or_single} onChange={field('blend_or_single')} lookups={lookups} />
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Process</label>
            <LookupSelect category="process" value={form.process} onChange={field('process')} lookups={lookups} />
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Roast Level</label>
            <LookupSelect category="roast_level" value={form.roast_level} onChange={field('roast_level')} lookups={lookups} />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-stone-500 mb-1">
              Roaster Flavor Descriptors <span className="opacity-60">(comma-separated)</span>
            </label>
            <input
              value={form.flavor_descriptors_roaster}
              onChange={e => field('flavor_descriptors_roaster')(e.target.value)}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
              placeholder="e.g. blueberry, dark chocolate, jasmine"
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
              {saving ? 'Saving…' : 'Save Coffee'}
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
              <th className="pb-3 pr-4">Roaster</th>
              <th className="pb-3 pr-4">Origin</th>
              <th className="pb-3 pr-4">Process</th>
              <th className="pb-3 pr-4">Roast</th>
              <th className="pb-3 pr-4">Archetype</th>
              <th className="pb-3">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {coffees.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-stone-400">No coffees yet</td></tr>
            )}
            {coffees.map(c => {
              const roastLabel = lookups.roast_level?.find(o => o.value === c.roast_level)?.label ?? c.roast_level ?? '—';
              const processLabel = lookups.process?.find(o => o.value === c.process)?.label ?? c.process ?? '—';
              return (
                <tr key={c.id} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="py-3 pr-4 font-medium text-stone-800">{c.name}</td>
                  <td className="py-3 pr-4 text-stone-500">{c.roaster ?? '—'}</td>
                  <td className="py-3 pr-4 text-stone-500">{c.origin ?? '—'}</td>
                  <td className="py-3 pr-4 text-stone-500">{processLabel}</td>
                  <td className="py-3 pr-4 text-stone-500">{roastLabel}</td>
                  <td className="py-3 pr-4">
                    {c.archetype
                      ? <span className="px-2 py-0.5 rounded-full text-xs text-white" style={{ backgroundColor: '#b05642' }}>{c.archetype}</span>
                      : <span className="text-stone-300">—</span>}
                  </td>
                  <td className="py-3 text-stone-400">
                    {c.confidence != null ? `${(Number(c.confidence) * 100).toFixed(0)}%` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
