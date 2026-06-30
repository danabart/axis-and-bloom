import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

interface DialHop {
  id: number;
  from_coffee_id: number;
  from_coffee: string;
  to_coffee_id: number;
  to_coffee: string;
  dimension_id: number;
  dimension: string;
  direction: 'more' | 'less';
  hop_type: 'within_archetype' | 'bridge_archetype';
  delta: number | null;
  is_recommended: boolean;
  confidence: string;
  notes: string | null;
}

interface CoffeeOption { id: number; name: string; archetype: string | null; }
interface DimOption    { id: number; name: string; }

const EMPTY_HOP = {
  from_coffee_id: '', to_coffee_id: '', dimension_id: '',
  direction: 'more' as const, hop_type: 'bridge_archetype' as const,
  delta: '', is_recommended: false, confidence: 'medium', notes: '',
};

export default function AdminDial() {
  const { user } = useAuth();

  const [hops, setHops]       = useState<DialHop[]>([]);
  const [coffees, setCoffees] = useState<CoffeeOption[]>([]);
  const [dims, setDims]       = useState<DimOption[]>([]);
  const [error, setError]     = useState('');

  const [showHopForm, setShowHopForm] = useState(false);
  const [hopForm, setHopForm]         = useState(EMPTY_HOP);
  const [hopSaving, setHopSaving]     = useState(false);
  const [hopError, setHopError]       = useState('');

  async function apiFetch(url: string, options: RequestInit = {}) {
    const token = await user!.getIdToken();
    return fetch(url, {
      cache: 'no-store',
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    });
  }

  async function loadAll() {
    try {
      const [hopRes, coffeeRes, dimRes] = await Promise.all([
        apiFetch('/api/admin/dial/navigation'),
        apiFetch('/api/admin/coffees'),
        apiFetch('/api/admin/dimensions'),
      ]);
      setHops(await hopRes.json());
      setCoffees(await coffeeRes.json());
      setDims(await dimRes.json());
    } catch {
      setError('Failed to load navigation hops');
    }
  }

  useEffect(() => { if (user) loadAll(); }, [user]);

  async function handleAddHop(e: React.FormEvent) {
    e.preventDefault();
    if (!hopForm.from_coffee_id || !hopForm.to_coffee_id || !hopForm.dimension_id) {
      setHopError('From coffee, to coffee, and dimension are required'); return;
    }
    setHopSaving(true); setHopError('');
    try {
      const res = await apiFetch('/api/admin/dial/relationships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_coffee_id: Number(hopForm.from_coffee_id),
          to_coffee_id:   Number(hopForm.to_coffee_id),
          dimension_id:   Number(hopForm.dimension_id),
          direction:      hopForm.direction,
          hop_type:       hopForm.hop_type,
          delta:          hopForm.delta ? Number(hopForm.delta) : null,
          is_recommended: hopForm.is_recommended,
          confidence:     hopForm.confidence,
          notes:          hopForm.notes || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Unknown error');
      setHopForm(EMPTY_HOP); setShowHopForm(false);
      await loadAll();
    } catch (err: unknown) {
      setHopError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setHopSaving(false); }
  }

  async function handleDeleteHop(id: number) {
    if (!confirm('Remove this hop relationship?')) return;
    try {
      await apiFetch(`/api/admin/dial/relationships/${id}`, { method: 'DELETE' });
      await loadAll();
    } catch { /* non-critical */ }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-normal text-stone-800">Navigation Hops</h1>
        <button
          onClick={() => { setShowHopForm(v => !v); setHopError(''); }}
          className="px-4 py-2 rounded text-sm font-normal text-white hover:opacity-80"
          style={{ backgroundColor: '#b05642' }}
        >
          {showHopForm ? 'Cancel' : '+ Add Hop'}
        </button>
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {showHopForm && (
        <form onSubmit={handleAddHop}
          className="border border-stone-200 rounded-lg p-5 mb-6 bg-stone-50 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-stone-500 mb-1">From Coffee *</label>
            <select value={hopForm.from_coffee_id}
              onChange={e => setHopForm(f => ({ ...f, from_coffee_id: e.target.value }))}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
              <option value="">— select —</option>
              {coffees.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">To Coffee *</label>
            <select value={hopForm.to_coffee_id}
              onChange={e => setHopForm(f => ({ ...f, to_coffee_id: e.target.value }))}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
              <option value="">— select —</option>
              {coffees.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Dimension *</label>
            <select value={hopForm.dimension_id}
              onChange={e => setHopForm(f => ({ ...f, dimension_id: e.target.value }))}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
              <option value="">— select —</option>
              {dims.filter(d => [5,6,7,9].includes(d.id)).map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Direction *</label>
            <select value={hopForm.direction}
              onChange={e => setHopForm(f => ({ ...f, direction: e.target.value as 'more' | 'less' }))}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
              <option value="more">More</option>
              <option value="less">Less</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Hop Type *</label>
            <select value={hopForm.hop_type}
              onChange={e => setHopForm(f => ({ ...f, hop_type: e.target.value as 'within_archetype' | 'bridge_archetype' }))}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
              <option value="within_archetype">Within Archetype</option>
              <option value="bridge_archetype">Bridge Archetype</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Confidence</label>
            <select value={hopForm.confidence}
              onChange={e => setHopForm(f => ({ ...f, confidence: e.target.value }))}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Delta <span className="opacity-60">(optional)</span></label>
            <input type="number" step="0.1" value={hopForm.delta}
              onChange={e => setHopForm(f => ({ ...f, delta: e.target.value }))}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
              placeholder="e.g. 2" />
          </div>
          <div className="flex items-center gap-2 pt-5">
            <input type="checkbox" id="hop-recommended" checked={hopForm.is_recommended}
              onChange={e => setHopForm(f => ({ ...f, is_recommended: e.target.checked }))}
              className="accent-stone-600" />
            <label htmlFor="hop-recommended" className="text-sm text-stone-600">Recommended</label>
          </div>
          <div className="col-span-2 md:col-span-4">
            <label className="block text-xs text-stone-500 mb-1">Notes <span className="opacity-60">(optional)</span></label>
            <input value={hopForm.notes}
              onChange={e => setHopForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
              placeholder="e.g. Brighter acidity → Fruity archetype" />
          </div>
          {hopError && <p className="col-span-2 md:col-span-4 text-red-500 text-xs">{hopError}</p>}
          <div className="col-span-2 md:col-span-4 flex justify-end">
            <button type="submit" disabled={hopSaving}
              className="px-5 py-2 rounded text-sm font-normal text-white disabled:opacity-50"
              style={{ backgroundColor: '#b05642' }}>
              {hopSaving ? 'Saving…' : 'Save Hop'}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-stone-200 text-xs text-stone-400 uppercase tracking-wide">
              <th className="pb-3 pr-4">From</th>
              <th className="pb-3 pr-2 text-center">→</th>
              <th className="pb-3 pr-4">To</th>
              <th className="pb-3 pr-4">Dimension</th>
              <th className="pb-3 pr-4">Direction</th>
              <th className="pb-3 pr-4">Type</th>
              <th className="pb-3 pr-4">Confidence</th>
              <th className="pb-3 pr-4">Notes</th>
              <th className="pb-3"></th>
            </tr>
          </thead>
          <tbody>
            {hops.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-stone-400">No hops yet — add them once cupping data is available</td>
              </tr>
            )}
            {hops.map(hop => (
              <tr key={hop.id} className="border-b border-stone-100 hover:bg-stone-50">
                <td className="py-3 pr-4 text-stone-800">{hop.from_coffee}</td>
                <td className="py-3 pr-2 text-stone-300 text-center">→</td>
                <td className="py-3 pr-4 text-stone-800">{hop.to_coffee}</td>
                <td className="py-3 pr-4 text-stone-500">{hop.dimension}</td>
                <td className="py-3 pr-4">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    hop.direction === 'more' ? 'bg-stone-100 text-stone-700' : 'bg-stone-50 text-stone-500'
                  }`}>
                    {hop.direction}
                  </span>
                </td>
                <td className="py-3 pr-4 text-stone-400 text-xs">
                  {hop.hop_type === 'bridge_archetype' ? 'bridge' : 'within'}
                </td>
                <td className="py-3 pr-4 text-stone-400 text-xs capitalize">{hop.confidence}</td>
                <td className="py-3 pr-4 text-stone-400 text-xs max-w-[200px] truncate">{hop.notes ?? '—'}</td>
                <td className="py-3">
                  <button onClick={() => handleDeleteHop(hop.id)}
                    className="text-xs text-stone-300 hover:text-red-400 transition-colors">
                    Remove
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
