import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

interface DialPosition {
  id: number;
  archetype: string;
  coffee_id: number;
  coffee: string;
  dimension: string;
  vocabulary_id: number;
  position_sort: number;
  dial_label: string;
  is_default: boolean;
  is_computed: boolean;
}

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

interface VocabOption {
  id: number;
  archetype: string;
  sort_order: number;
  label: string;
  dimension_id: number;
  dimension: string;
}

interface CoffeeOption { id: number; name: string; archetype: string | null; }
interface DimOption    { id: number; name: string; }

const ARCHETYPE_OPTIONS = [
  { value: 'chocolate_nutty', label: 'Chocolate & Nutty' },
  { value: 'balanced_sweet',  label: 'Balanced & Sweet'  },
  { value: 'fruity',          label: 'Fruity'            },
  { value: 'earthy',          label: 'Earthy'            },
  { value: 'floral',          label: 'Floral'            },
  { value: 'experimental',    label: 'Experimental'      },
];
const ARCHETYPE_LABEL: Record<string, string> = Object.fromEntries(
  ARCHETYPE_OPTIONS.map(o => [o.value, o.label])
);

const EMPTY_POS = { coffee_id: '', archetype: '', vocabulary_id: '', is_default: false };
const EMPTY_HOP = {
  from_coffee_id: '', to_coffee_id: '', dimension_id: '',
  direction: 'more' as const, hop_type: 'bridge_archetype' as const,
  delta: '', is_recommended: false, confidence: 'medium', notes: '',
};

export default function AdminDial() {
  const { user } = useAuth();

  const [tab, setTab]             = useState<'positions' | 'navigation'>('positions');
  const [positions, setPositions] = useState<DialPosition[]>([]);
  const [hops, setHops]           = useState<DialHop[]>([]);
  const [vocab, setVocab]         = useState<VocabOption[]>([]);
  const [coffees, setCoffees]     = useState<CoffeeOption[]>([]);
  const [dims, setDims]           = useState<DimOption[]>([]);
  const [error, setError]         = useState('');

  const [showPosForm, setShowPosForm] = useState(false);
  const [posForm, setPosForm]         = useState(EMPTY_POS);
  const [posSaving, setPosSaving]     = useState(false);
  const [posError, setPosError]       = useState('');

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
      const [posRes, hopRes, vocabRes, coffeeRes, dimRes] = await Promise.all([
        apiFetch('/api/admin/dial/positions'),
        apiFetch('/api/admin/dial/navigation'),
        apiFetch('/api/admin/dial/vocabulary'),
        apiFetch('/api/admin/coffees'),
        apiFetch('/api/admin/dimensions'),
      ]);
      setPositions(await posRes.json());
      setHops(await hopRes.json());
      setVocab(await vocabRes.json());
      setCoffees(await coffeeRes.json());
      setDims(await dimRes.json());
    } catch {
      setError('Failed to load dial data');
    }
  }

  useEffect(() => { if (user) loadAll(); }, [user]);

  // ── Positions ──────────────────────────────────────────────────────────────

  async function handleAddPosition(e: React.FormEvent) {
    e.preventDefault();
    if (!posForm.coffee_id || !posForm.archetype || !posForm.vocabulary_id) {
      setPosError('Coffee, archetype, and position are required'); return;
    }
    setPosSaving(true); setPosError('');
    try {
      const res = await apiFetch('/api/admin/dial/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coffee_id: Number(posForm.coffee_id),
          archetype: posForm.archetype,
          vocabulary_id: Number(posForm.vocabulary_id),
          is_default: posForm.is_default,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Unknown error');
      setPosForm(EMPTY_POS); setShowPosForm(false);
      await loadAll();
    } catch (err: unknown) {
      setPosError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setPosSaving(false); }
  }

  async function handleSetDefault(pos: DialPosition) {
    try {
      await apiFetch(`/api/admin/dial/positions/${pos.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_default: true }),
      });
      await loadAll();
    } catch { /* non-critical */ }
  }

  async function handleMovePosition(id: number, vocabulary_id: number) {
    try {
      await apiFetch(`/api/admin/dial/positions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabulary_id }),
      });
      await loadAll();
    } catch { /* non-critical */ }
  }

  async function handleDeletePosition(id: number) {
    if (!confirm('Remove this coffee from the dial?')) return;
    try {
      await apiFetch(`/api/admin/dial/positions/${id}`, { method: 'DELETE' });
      await loadAll();
    } catch { /* non-critical */ }
  }

  // ── Hops ───────────────────────────────────────────────────────────────────

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
          to_coffee_id: Number(hopForm.to_coffee_id),
          dimension_id: Number(hopForm.dimension_id),
          direction: hopForm.direction,
          hop_type: hopForm.hop_type,
          delta: hopForm.delta ? Number(hopForm.delta) : null,
          is_recommended: hopForm.is_recommended,
          confidence: hopForm.confidence,
          notes: hopForm.notes || null,
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

  // ── Derived ────────────────────────────────────────────────────────────────

  const filteredVocab = posForm.archetype
    ? vocab.filter(v => v.archetype === posForm.archetype)
    : [];

  // Group positions by archetype for display
  const byArchetype = ARCHETYPE_OPTIONS.reduce<Record<string, DialPosition[]>>((acc, o) => {
    acc[o.value] = positions.filter(p => p.archetype === o.value);
    return acc;
  }, {});

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-normal text-stone-800">Bloom Dial</h1>
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {/* Tabs */}
      <div className="flex gap-4 border-b border-stone-200 mb-6">
        {(['positions', 'navigation'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-3 text-sm capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-stone-800 text-stone-800 font-normal'
                : 'border-transparent text-stone-400 hover:text-stone-600'
            }`}
          >
            {t === 'positions' ? 'Dial Positions' : 'Navigation Hops'}
          </button>
        ))}
      </div>

      {/* ── POSITIONS TAB ─────────────────────────────────────────────────── */}
      {tab === 'positions' && (
        <div>
          <div className="flex justify-end mb-4">
            <button
              onClick={() => { setShowPosForm(v => !v); setPosError(''); }}
              className="px-4 py-2 rounded text-sm font-normal text-white hover:opacity-80"
              style={{ backgroundColor: '#b05642' }}
            >
              {showPosForm ? 'Cancel' : '+ Add Position'}
            </button>
          </div>

          {showPosForm && (
            <form onSubmit={handleAddPosition}
              className="border border-stone-200 rounded-lg p-5 mb-6 bg-stone-50 flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs text-stone-500 mb-1">Coffee *</label>
                <select value={posForm.coffee_id}
                  onChange={e => setPosForm(f => ({ ...f, coffee_id: e.target.value }))}
                  className="border border-stone-300 rounded px-3 py-2 text-sm min-w-[180px]">
                  <option value="">— select —</option>
                  {coffees.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">Archetype *</label>
                <select value={posForm.archetype}
                  onChange={e => setPosForm(f => ({ ...f, archetype: e.target.value, vocabulary_id: '' }))}
                  className="border border-stone-300 rounded px-3 py-2 text-sm">
                  <option value="">— select —</option>
                  {ARCHETYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">Dial Position *</label>
                <select value={posForm.vocabulary_id}
                  onChange={e => setPosForm(f => ({ ...f, vocabulary_id: e.target.value }))}
                  disabled={!posForm.archetype}
                  className="border border-stone-300 rounded px-3 py-2 text-sm min-w-[160px] disabled:opacity-40">
                  <option value="">— select archetype first —</option>
                  {filteredVocab.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.sort_order}. {v.label} ({v.dimension})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 pb-2">
                <input type="checkbox" id="pos-default" checked={posForm.is_default}
                  onChange={e => setPosForm(f => ({ ...f, is_default: e.target.checked }))}
                  className="accent-stone-600" />
                <label htmlFor="pos-default" className="text-sm text-stone-600">Default for archetype</label>
              </div>
              {posError && <p className="w-full text-red-500 text-xs">{posError}</p>}
              <button type="submit" disabled={posSaving}
                className="px-5 py-2 rounded text-sm font-normal text-white disabled:opacity-50"
                style={{ backgroundColor: '#b05642' }}>
                {posSaving ? 'Saving…' : 'Save Position'}
              </button>
            </form>
          )}

          {/* Positions grouped by archetype */}
          {ARCHETYPE_OPTIONS.map(({ value, label }) => {
            const rows = byArchetype[value] ?? [];
            return (
              <div key={value} className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <h2 className="text-sm font-normal text-stone-500 uppercase tracking-wide">{label}</h2>
                  <span className="text-xs text-stone-300">{rows.length} {rows.length === 1 ? 'coffee' : 'coffees'}</span>
                </div>
                {rows.length === 0 ? (
                  <p className="text-xs text-stone-300 pl-1">No coffees on this dial yet</p>
                ) : (
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-stone-100 text-xs text-stone-400 uppercase tracking-wide">
                        <th className="pb-2 pr-6">Coffee</th>
                        <th className="pb-2 pr-6">Dimension</th>
                        <th className="pb-2 pr-6">Position</th>
                        <th className="pb-2 pr-6">Default</th>
                        <th className="pb-2 pr-6">Source</th>
                        <th className="pb-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(pos => {
                        const archetypeVocab = vocab
                          .filter(v => v.archetype === pos.archetype)
                          .sort((a, b) => a.sort_order - b.sort_order);
                        const currentIdx = archetypeVocab.findIndex(v => v.id === pos.vocabulary_id);
                        const prevVocab = archetypeVocab[currentIdx - 1];
                        const nextVocab = archetypeVocab[currentIdx + 1];
                        return (
                        <tr key={pos.id} className="border-b border-stone-50 hover:bg-stone-50">
                          <td className="py-2 pr-6 text-stone-800">{pos.coffee}</td>
                          <td className="py-2 pr-6 text-stone-500">{pos.dimension}</td>
                          <td className="py-2 pr-6">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => prevVocab && handleMovePosition(pos.id, prevVocab.id)}
                                disabled={!prevVocab}
                                className="text-stone-300 hover:text-stone-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors text-base leading-none px-0.5"
                                title={prevVocab ? `Move to ${prevVocab.label}` : 'Already at leftmost position'}
                              >←</button>
                              <span className="px-2 py-0.5 rounded-full text-xs text-white"
                                style={{ backgroundColor: '#b05642' }}>
                                {pos.position_sort}. {pos.dial_label}
                              </span>
                              <button
                                onClick={() => nextVocab && handleMovePosition(pos.id, nextVocab.id)}
                                disabled={!nextVocab}
                                className="text-stone-300 hover:text-stone-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors text-base leading-none px-0.5"
                                title={nextVocab ? `Move to ${nextVocab.label}` : 'Already at rightmost position'}
                              >→</button>
                            </div>
                          </td>
                          <td className="py-2 pr-6">
                            {pos.is_default ? (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-stone-700 text-white">
                                ★ Default
                              </span>
                            ) : (
                              <button
                                onClick={() => handleSetDefault(pos)}
                                className="text-xs px-2 py-0.5 rounded text-white transition-opacity hover:opacity-80"
                                style={{ backgroundColor: '#b05642' }}
                              >
                                Set Default
                              </button>
                            )}
                          </td>
                          <td className="py-2 pr-6 text-stone-400 text-xs capitalize">
                            {pos.is_computed ? 'computed' : 'manual'}
                          </td>
                          <td className="py-2">
                            <button onClick={() => handleDeletePosition(pos.id)}
                              className="text-xs text-stone-300 hover:text-red-400 transition-colors">
                              Remove
                            </button>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── NAVIGATION TAB ───────────────────────────────────────────────── */}
      {tab === 'navigation' && (
        <div>
          <div className="flex justify-end mb-4">
            <button
              onClick={() => { setShowHopForm(v => !v); setHopError(''); }}
              className="px-4 py-2 rounded text-sm font-normal text-white hover:opacity-80"
              style={{ backgroundColor: '#b05642' }}
            >
              {showHopForm ? 'Cancel' : '+ Add Hop'}
            </button>
          </div>

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
                    <td colSpan={9} className="py-8 text-center text-stone-400">No hops yet</td>
                  </tr>
                )}
                {hops.map(hop => (
                  <tr key={hop.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="py-3 pr-4 text-stone-800">{hop.from_coffee}</td>
                    <td className="py-3 pr-2 text-stone-300 text-center">→</td>
                    <td className="py-3 pr-4 text-stone-800">{hop.to_coffee}</td>
                    <td className="py-3 pr-4 text-stone-500">{hop.dimension}</td>
                    <td className="py-3 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-normal ${
                        hop.direction === 'more'
                          ? 'bg-stone-100 text-stone-700'
                          : 'bg-stone-50 text-stone-500'
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
      )}
    </div>
  );
}
