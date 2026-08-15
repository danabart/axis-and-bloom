import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';

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

interface AdjacencyRow {
  archetype_a: string;
  archetype_b: string;
  hop_count: number;
  more_count: number;
  less_count: number;
  avg_confidence: number | null;
}

interface DimensionConfigRow {
  archetype: string;
  dimension_name: string | null;
  dimension_platform_name: string | null;
  scale_min_label: string | null;
  scale_max_label: string | null;
}

interface HopSuggestion {
  from_coffee_id: number;
  from_coffee_name: string;
  to_coffee_id: number;
  to_coffee_name: string;
  dimension_id: number;
  dimension_name: string;
  direction: 'more';
  delta: number;
  archetype: string;
}

const ARCHETYPE_LABEL: Record<string, string> = {
  chocolate_nutty: 'Chocolate & Nutty',
  balanced_sweet:  'Balanced & Sweet',
  fruity:          'Fruity',
  earthy:          'Earthy',
  floral:          'Floral',
  experimental:    'Experimental',
};

function confidenceLabel(avg: number | null) {
  if (avg === null) return 'unknown confidence';
  if (avg >= 2.5) return 'high confidence';
  if (avg >= 1.5) return 'medium confidence';
  return 'low confidence';
}

const EMPTY_HOP = {
  from_coffee_id: '', to_coffee_id: '', dimension_id: '',
  direction: 'more' as const, hop_type: 'bridge_archetype' as const,
  delta: '', is_recommended: false, confidence: 'medium', notes: '',
};

export default function AdminDial() {
  const { user } = useAuth();

  const [hops, setHops]                 = useState<DialHop[]>([]);
  const [coffees, setCoffees]           = useState<CoffeeOption[]>([]);
  const [dims, setDims]                 = useState<DimOption[]>([]);
  const [adjacency, setAdjacency]       = useState<AdjacencyRow[]>([]);
  const [hopSuggestions, setHopSuggestions] = useState<HopSuggestion[]>([]);
  const [dimensionConfig, setDimensionConfig] = useState<DimensionConfigRow[]>([]);
  const [acceptingKey, setAcceptingKey] = useState<string | null>(null);
  const [error, setError]               = useState('');

  const [showHopForm, setShowHopForm] = useState(false);
  const [hopForm, setHopForm]         = useState(EMPTY_HOP);
  const [hopSaving, setHopSaving]     = useState(false);
  const [hopError, setHopError]       = useState('');
  const [hopWarning, setHopWarning]   = useState('');

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
      const [hopRes, coffeeRes, dimRes, adjRes, suggRes, dimConfigRes] = await Promise.all([
        apiFetch('/api/admin/dial/navigation'),
        apiFetch('/api/admin/coffees'),
        apiFetch('/api/admin/dimensions'),
        apiFetch('/api/admin/dial/archetype-adjacency'),
        apiFetch('/api/admin/dial/hop-suggestions'),
        apiFetch('/api/admin/dial/dimension-config'),
      ]);
      setHops(await hopRes.json());
      setCoffees(await coffeeRes.json());
      setDims(await dimRes.json());
      setAdjacency(await adjRes.json());
      setHopSuggestions(await suggRes.json());
      setDimensionConfig(await dimConfigRes.json());
    } catch (err) {
      reportError('[AdminDial/load]', err);
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
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Unknown error');
      setHopForm(EMPTY_HOP); setShowHopForm(false);
      if (body.warning) setHopWarning(body.warning);
      await loadAll();
    } catch (err: unknown) {
      reportError('[AdminDial/save-hop]', err);
      setHopError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setHopSaving(false); }
  }

  async function handleDeleteHop(id: number) {
    if (!confirm('Remove this hop relationship?')) return;
    try {
      await apiFetch(`/api/admin/dial/relationships/${id}`, { method: 'DELETE' });
      await loadAll();
    } catch (err) {
      // Genuinely silent before this — a failed delete left the hop still in
      // the list (loadAll() is skipped), but nothing told the admin why.
      reportError('[AdminDial/delete-hop]', err);
    }
  }

  async function handleAcceptSuggestion(s: HopSuggestion) {
    const key = `${s.from_coffee_id}-${s.to_coffee_id}-${s.dimension_id}`;
    setAcceptingKey(key);
    try {
      const res = await apiFetch('/api/admin/dial/relationships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_coffee_id: s.from_coffee_id,
          to_coffee_id:   s.to_coffee_id,
          dimension_id:   s.dimension_id,
          direction:      s.direction,
          hop_type:       'within_archetype',
          confidence:     'medium',
          notes:          `Suggested from cupping data — ${s.delta} pt difference on ${s.dimension_name}`,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Unknown error');
      if (body.warning) setHopWarning(body.warning);
      await loadAll();
    } catch (err) {
      reportError('[AdminDial/accept-hop-suggestion]', err);
    } finally { setAcceptingKey(null); }
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

      {hopWarning && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <span>{hopWarning}</span>
          <button onClick={() => setHopWarning('')} className="text-sm text-amber-400 hover:text-amber-700 shrink-0">✕</button>
        </div>
      )}

      {/* ── Dial dimension configuration (Part 14) — read-only. The Bloom Dial ruler's
          end labels (e.g. "DELICATE"/"PRONOUNCED") are now pulled from each
          archetype's dial dimension row; an archetype with no dimension set, or a
          dimension missing a min/max scale label, silently falls back to
          Delicate/Pronounced on the customer-facing dial instead of its real
          labels. Flagged here since there's no admin UI yet to edit
          dominant_dimension_id or coffee_dimensions.scale_*_label — this table
          only surfaces the gap; fixing it is still a direct-SQL change for now,
          same as coffee_dimensions.platform_name. ── */}
      <div className="mb-6 border border-stone-100 rounded-lg p-4 bg-stone-50/60">
        <h2 className="text-xs font-normal text-stone-400 uppercase tracking-widest mb-2">
          Dial Dimension Configuration
        </h2>
        {dimensionConfig.length === 0 ? (
          <p className="text-sm text-stone-400">Loading…</p>
        ) : (
          <ul className="space-y-1.5">
            {dimensionConfig.map(row => {
              const missingDimension = !row.dimension_name;
              const missingLabels = !missingDimension && (!row.scale_min_label || !row.scale_max_label);
              const gap = missingDimension || missingLabels;
              return (
                <li key={row.archetype} className="text-sm text-stone-700">
                  {ARCHETYPE_LABEL[row.archetype] ?? row.archetype}
                  {' — '}
                  {missingDimension ? (
                    <span className="text-stone-500">no dimension</span>
                  ) : (
                    <span className="text-stone-500">
                      {row.dimension_platform_name ?? row.dimension_name}
                      {' ('}{row.scale_min_label ?? '—'} ↔ {row.scale_max_label ?? '—'}{')'}
                    </span>
                  )}
                  {gap && (
                    <span className="ml-2 inline-block rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                      {missingDimension
                        ? 'No dial dimension configured — dial shows default labels'
                        : 'Missing min/max scale label — dial shows default labels'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Archetype adjacency summary — read-only, derived from bridge hops ──── */}
      <div className="mb-6 border border-stone-100 rounded-lg p-4 bg-stone-50/60">
        <h2 className="text-xs font-normal text-stone-400 uppercase tracking-widest mb-2">
          Cross-Archetype Connections
        </h2>
        {adjacency.length === 0 ? (
          <p className="text-sm text-stone-400">No cross-archetype connections recorded yet.</p>
        ) : (
          <ul className="space-y-1">
            {adjacency.map(a => (
              <li key={`${a.archetype_a}-${a.archetype_b}`} className="text-sm text-stone-700">
                {ARCHETYPE_LABEL[a.archetype_a] ?? a.archetype_a} ↔ {ARCHETYPE_LABEL[a.archetype_b] ?? a.archetype_b}
                {' — '}
                <span className="text-stone-500">
                  {a.hop_count} hop{a.hop_count === 1 ? '' : 's'}, {confidenceLabel(a.avg_confidence)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Suggested Dial Turns — computed from cupping data, never auto-created ── */}
      <div className="mb-6 border border-stone-100 rounded-lg p-4 bg-stone-50/60">
        <h2 className="text-xs font-normal text-stone-400 uppercase tracking-widest mb-2">
          Suggested Dial Turns (from cupping data)
        </h2>
        {hopSuggestions.length === 0 ? (
          <p className="text-sm text-stone-400">No suggestions yet — needs at least two cupped coffees in the same archetype with a meaningful score difference.</p>
        ) : (
          <ul className="space-y-1.5">
            {hopSuggestions.map(s => {
              const key = `${s.from_coffee_id}-${s.to_coffee_id}-${s.dimension_id}`;
              return (
                <li key={key} className="flex items-center justify-between gap-3 text-sm text-stone-700">
                  <span>
                    {s.from_coffee_name} → {s.to_coffee_name}
                    {' '}
                    <span className="text-stone-500">
                      ({ARCHETYPE_LABEL[s.archetype] ?? s.archetype}, {s.delta} pt on {s.dimension_name})
                    </span>
                  </span>
                  <button
                    onClick={() => handleAcceptSuggestion(s)}
                    disabled={acceptingKey === key}
                    className="shrink-0 px-3 py-0.5 rounded text-xs text-white disabled:opacity-50"
                    style={{ backgroundColor: '#b05642' }}
                  >
                    {acceptingKey === key ? '…' : 'Add'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
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
              <option value="within_archetype">Dial Turn</option>
              <option value="bridge_archetype">Hop</option>
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
