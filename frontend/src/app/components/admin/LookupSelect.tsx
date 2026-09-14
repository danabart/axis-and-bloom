import { useState } from 'react';
import { reportError } from '../../lib/errorReporter';

// Extracted out of AdminCoffees.tsx verbatim (Catalog Blueprint brief 4, Part
// B — "carried over as extracted components, not rewritten"). Optional inline
// "+ Add new value" affordance (Flavor Intelligence Part 1 Decision #9) —
// pass apiFetch + onAdded to enable it; omit either to render a plain
// read-only dropdown (existing call sites that don't need the add path).
export default function LookupSelect({ category, value, onChange, lookups, apiFetch, onAdded }: {
  category: string; value: string;
  onChange: (v: string) => void;
  lookups: Record<string, { value: string; label: string }[]>;
  apiFetch?: (url: string, options?: RequestInit) => Promise<Response>;
  onAdded?: () => void | Promise<void>;
}) {
  const options = lookups[category] ?? [];
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleAdd() {
    const label = newLabel.trim();
    if (!label) { setErr('Label is required'); return; }
    const slug = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!slug) { setErr('Label must contain at least one letter or number'); return; }
    setSaving(true); setErr('');
    try {
      const res = await apiFetch!('/api/admin/lookups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, value: slug, label }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to add value');
      await onAdded?.();
      onChange(slug);
      setAdding(false); setNewLabel('');
    } catch (e: unknown) {
      reportError('[LookupSelect/add-lookup-value]', e);
      setErr(e instanceof Error ? e.message : 'Failed to add value');
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <select value={value} onChange={e => onChange(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
          <option value="">— select —</option>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {apiFetch && (
          <button type="button" onClick={() => { setAdding(v => !v); setErr(''); }}
            className="shrink-0 px-2 py-2 rounded border border-dashed border-stone-300 text-xs text-stone-400 hover:border-stone-400 hover:text-stone-600"
            title={`Add a new ${category} value`}>
            +
          </button>
        )}
      </div>
      {adding && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
            placeholder="New value label"
            className="flex-1 border border-stone-300 rounded px-2 py-1 text-xs" autoFocus />
          <button type="button" onClick={handleAdd} disabled={saving}
            className="px-2 py-1 rounded text-xs text-white disabled:opacity-50"
            style={{ backgroundColor: '#b05642' }}>
            {saving ? '…' : 'Add'}
          </button>
          <button type="button" onClick={() => { setAdding(false); setErr(''); }}
            className="text-xs text-stone-400 hover:text-stone-600">Cancel</button>
        </div>
      )}
      {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
    </div>
  );
}
