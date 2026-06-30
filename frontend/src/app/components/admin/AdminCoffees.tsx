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
  confidence: string | null;
  dial_position_id: number | null;
  dial_vocab_id: number | null;
  dial_is_default: boolean | null;
  dial_position_sort: number | null;
  dial_label: string | null;
}

interface VocabOption {
  id: number;
  archetype: string;
  sort_order: number;
  label: string;
  dimension: string;
}

interface RoasterOption { id: string; name: string; }

const ARCHETYPE_OPTIONS = [
  { value: 'chocolate_nutty', label: 'Chocolate & Nutty' },
  { value: 'balanced_sweet',  label: 'Balanced & Sweet'  },
  { value: 'fruity',          label: 'Fruity'            },
  { value: 'earthy',          label: 'Earthy'            },
  { value: 'floral',          label: 'Floral'            },
  { value: 'experimental',    label: 'Experimental'      },
];

const CONFIDENCE_OPTIONS = [
  { value: 'low',    label: 'Low'    },
  { value: 'medium', label: 'Medium' },
  { value: 'high',   label: 'High'   },
];

const ARCHETYPE_LABEL: Record<string, string> = Object.fromEntries(
  ARCHETYPE_OPTIONS.map(o => [o.value, o.label])
);

const EMPTY_FORM = {
  name: '', roaster: '', origin: '',
  blend_or_single: '', process: '', roast_level: '',
  flavor_descriptors_roaster: '',
};

const EMPTY_ARCH = {
  archetype: '', confidence: 'medium', notes: '',
  vocab_id: '', dial_is_default: false,
};

function LookupSelect({
  category, value, onChange, lookups,
}: {
  category: string; value: string;
  onChange: (v: string) => void;
  lookups: Record<string, { value: string; label: string }[]>;
}) {
  const options = lookups[category] ?? [];
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
      <option value="">— select —</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export default function AdminCoffees() {
  const { user } = useAuth();
  const { lookups } = useAdminLookups();
  const [coffees, setCoffees]               = useState<Coffee[]>([]);
  const [vocab, setVocab]                   = useState<VocabOption[]>([]);
  const [error, setError]                   = useState('');
  const [showForm, setShowForm]             = useState(false);
  const [form, setForm]                     = useState(EMPTY_FORM);
  const [saving, setSaving]                 = useState(false);
  const [saveError, setSaveError]           = useState('');
  const [roasterOptions, setRoasterOptions] = useState<RoasterOption[]>([]);

  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [archForm, setArchForm]       = useState(EMPTY_ARCH);
  const [archSaving, setArchSaving]   = useState(false);
  const [archError, setArchError]     = useState('');

  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [movingId, setMovingId]         = useState<number | null>(null);

  async function apiFetch(url: string, options: RequestInit = {}) {
    const token = await user!.getIdToken();
    return fetch(url, {
      cache: 'no-store',
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    });
  }

  async function load() {
    try {
      const [coffeeRes, vocabRes, roasterRes] = await Promise.all([
        apiFetch('/api/admin/coffees'),
        apiFetch('/api/admin/dial/vocabulary'),
        apiFetch('/api/admin/roasters'),
      ]);
      setCoffees(await coffeeRes.json());
      setVocab(await vocabRes.json());
      const roasters = await roasterRes.json();
      if (Array.isArray(roasters)) setRoasterOptions(roasters.filter((r: { is_active: boolean }) => r.is_active));
    } catch { setError('Failed to load coffees'); }
  }

  useEffect(() => { if (user) load(); }, [user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setSaveError('');
    try {
      const res = await apiFetch('/api/admin/coffees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Unknown error');
      setForm(EMPTY_FORM); setShowForm(false); await load();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(false); }
  }

  async function handleArchetypeAssign(coffeeId: number) {
    if (!archForm.archetype || !archForm.confidence) {
      setArchError('Select an archetype and confidence level'); return;
    }
    setArchSaving(true); setArchError('');
    try {
      const res = await apiFetch(`/api/admin/coffees/${coffeeId}/archetype`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archetype: archForm.archetype,
          confidence: archForm.confidence,
          notes: archForm.notes || null,
          vocabulary_id: archForm.vocab_id ? Number(archForm.vocab_id) : undefined,
          dial_is_default: archForm.dial_is_default,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Unknown error');
      setAssigningId(null);
      setArchForm(EMPTY_ARCH);
      await load();
    } catch (err: unknown) {
      setArchError(err instanceof Error ? err.message : 'Failed to assign');
    } finally { setArchSaving(false); }
  }

  async function handleMovePosition(coffee: Coffee, vocabId: number) {
    if (!coffee.archetype) return;
    setMovingId(coffee.id);
    try {
      await apiFetch(`/api/admin/dial/positions/${coffee.dial_position_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabulary_id: vocabId }),
      });
      await load();
    } catch { /* non-critical */ } finally { setMovingId(null); }
  }

  async function handleRefreshContent(coffeeId: number) {
    setRefreshingId(coffeeId);
    try {
      await apiFetch(`/api/admin/coffees/${coffeeId}/refresh-content`, { method: 'POST' });
    } catch { /* non-critical */ } finally { setRefreshingId(null); }
  }

  function openAssign(coffee: Coffee) {
    setAssigningId(coffee.id);
    setArchForm({
      archetype:      coffee.archetype ?? '',
      confidence:     coffee.confidence ?? 'medium',
      notes:          '',
      vocab_id:       coffee.dial_vocab_id ? String(coffee.dial_vocab_id) : '',
      dial_is_default: coffee.dial_is_default ?? false,
    });
    setArchError('');
  }

  const field = (key: keyof typeof EMPTY_FORM) => (v: string) => setForm(f => ({ ...f, [key]: v }));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-normal text-stone-800">Coffees</h1>
        <button onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 rounded text-sm font-normal text-white hover:opacity-80"
          style={{ backgroundColor: '#b05642' }}>
          {showForm ? 'Cancel' : '+ Add Coffee'}
        </button>
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {showForm && (
        <form onSubmit={handleSubmit} className="border border-stone-200 rounded-lg p-6 mb-6 bg-stone-50 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs text-stone-500 mb-1">Name *</label>
            <input required value={form.name} onChange={e => field('name')(e.target.value)}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
              placeholder="e.g. Yirgacheffe Natural" />
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Roaster</label>
            <input list="coffee-roaster-list" value={form.roaster}
              onChange={e => field('roaster')(e.target.value)}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
              placeholder="e.g. Path Coffee Roasters" />
            <datalist id="coffee-roaster-list">
              {roasterOptions.map(r => <option key={r.id} value={r.name} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Origin</label>
            <input value={form.origin} onChange={e => field('origin')(e.target.value)}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
              placeholder="e.g. Ethiopia" />
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
            <label className="block text-xs text-stone-500 mb-1">Roaster Flavor Descriptors <span className="opacity-60">(comma-separated)</span></label>
            <input value={form.flavor_descriptors_roaster} onChange={e => field('flavor_descriptors_roaster')(e.target.value)}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
              placeholder="e.g. blueberry, dark chocolate, jasmine" />
          </div>
          {saveError && <p className="md:col-span-2 text-red-500 text-sm">{saveError}</p>}
          <div className="md:col-span-2 flex justify-end">
            <button type="submit" disabled={saving}
              className="px-5 py-2 rounded text-sm font-normal text-white disabled:opacity-50"
              style={{ backgroundColor: '#b05642' }}>
              {saving ? 'Saving…' : 'Save Coffee'}
            </button>
          </div>
        </form>
      )}

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
              <th className="pb-3 pr-4">Dial Position</th>
              <th className="pb-3 pr-4">Confidence</th>
              <th className="pb-3">AI Summary</th>
            </tr>
          </thead>
          <tbody>
            {coffees.length === 0 && (
              <tr><td colSpan={9} className="py-8 text-center text-stone-400">No coffees yet</td></tr>
            )}
            {coffees.map(c => {
              const isAssigning = assigningId === c.id;
              const roastLabel   = lookups.roast_level?.find(o => o.value === c.roast_level)?.label ?? c.roast_level ?? '—';
              const processLabel = lookups.process?.find(o => o.value === c.process)?.label ?? c.process ?? '—';

              const archetypeVocab = vocab
                .filter(v => v.archetype === c.archetype)
                .sort((a, b) => a.sort_order - b.sort_order);
              const currentVocabIdx = archetypeVocab.findIndex(v => v.id === c.dial_vocab_id);
              const prevVocab = archetypeVocab[currentVocabIdx - 1];
              const nextVocab = archetypeVocab[currentVocabIdx + 1];
              const isMoving  = movingId === c.id;

              const formVocabOptions = vocab
                .filter(v => v.archetype === archForm.archetype)
                .sort((a, b) => a.sort_order - b.sort_order);

              return (
                <>
                  <tr key={c.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="py-3 pr-4 font-normal text-stone-800">{c.name}</td>
                    <td className="py-3 pr-4 text-stone-500">{c.roaster ?? '—'}</td>
                    <td className="py-3 pr-4 text-stone-500">{c.origin ?? '—'}</td>
                    <td className="py-3 pr-4 text-stone-500">{processLabel}</td>
                    <td className="py-3 pr-4 text-stone-500">{roastLabel}</td>
                    <td className="py-3 pr-4">
                      <button onClick={() => isAssigning ? setAssigningId(null) : openAssign(c)}
                        className="flex items-center gap-1.5 group">
                        {c.archetype
                          ? <>
                              <span className="px-2 py-0.5 rounded-full text-xs text-white" style={{ backgroundColor: '#b05642' }}>
                                {ARCHETYPE_LABEL[c.archetype] ?? c.archetype}
                              </span>
                              <span className="text-stone-300 text-xs opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
                            </>
                          : <span className="px-2 py-0.5 rounded border border-dashed border-stone-300 text-xs text-stone-400 hover:border-stone-400 hover:text-stone-600">
                              + Assign
                            </span>}
                      </button>
                    </td>
                    <td className="py-3 pr-4">
                      {c.dial_label ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => prevVocab && !isMoving && handleMovePosition(c, prevVocab.id)}
                            disabled={!prevVocab || isMoving}
                            className="text-stone-300 hover:text-stone-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors leading-none px-0.5"
                            title={prevVocab ? `Move to ${prevVocab.label}` : undefined}
                          >←</button>
                          <span className="text-xs text-stone-600">
                            {c.dial_position_sort}. {c.dial_label}
                            {c.dial_is_default && <span className="ml-1 text-stone-400">★</span>}
                          </span>
                          <button
                            onClick={() => nextVocab && !isMoving && handleMovePosition(c, nextVocab.id)}
                            disabled={!nextVocab || isMoving}
                            className="text-stone-300 hover:text-stone-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors leading-none px-0.5"
                            title={nextVocab ? `Move to ${nextVocab.label}` : undefined}
                          >→</button>
                        </div>
                      ) : (
                        <span className="text-xs text-stone-300">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-stone-400 capitalize text-xs">{c.confidence ?? '—'}</td>
                    <td className="py-3">
                      <button onClick={() => handleRefreshContent(c.id)} disabled={refreshingId === c.id}
                        className="text-xs px-2 py-1 rounded border border-stone-200 text-stone-400 hover:text-stone-600 hover:border-stone-400 disabled:opacity-40 transition-colors"
                        title="Regenerate AI content">
                        {refreshingId === c.id ? '…' : '↺ Refresh'}
                      </button>
                    </td>
                  </tr>

                  {isAssigning && (
                    <tr key={`assign-${c.id}`} className="border-b border-stone-200 bg-stone-50">
                      <td colSpan={9} className="px-4 py-4">
                        <div className="flex flex-wrap items-end gap-3">
                          <div>
                            <label className="block text-xs text-stone-500 mb-1">Archetype *</label>
                            <select value={archForm.archetype}
                              onChange={e => setArchForm(f => ({ ...f, archetype: e.target.value, vocab_id: '', dial_is_default: false }))}
                              className="border border-stone-300 rounded px-3 py-1.5 text-sm">
                              <option value="">— select —</option>
                              {ARCHETYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-stone-500 mb-1">Confidence *</label>
                            <select value={archForm.confidence}
                              onChange={e => setArchForm(f => ({ ...f, confidence: e.target.value }))}
                              className="border border-stone-300 rounded px-3 py-1.5 text-sm">
                              {CONFIDENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-stone-500 mb-1">Dial Position</label>
                            <select value={archForm.vocab_id}
                              onChange={e => setArchForm(f => ({ ...f, vocab_id: e.target.value }))}
                              disabled={!archForm.archetype}
                              className="border border-stone-300 rounded px-3 py-1.5 text-sm min-w-[160px] disabled:opacity-40">
                              <option value="">— none —</option>
                              {formVocabOptions.map(v => (
                                <option key={v.id} value={v.id}>
                                  {v.sort_order}. {v.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          {archForm.vocab_id && (
                            <div className="flex items-center gap-2 pb-1.5">
                              <input type="checkbox" id={`default-${c.id}`}
                                checked={archForm.dial_is_default}
                                onChange={e => setArchForm(f => ({ ...f, dial_is_default: e.target.checked }))}
                                className="accent-stone-600" />
                              <label htmlFor={`default-${c.id}`} className="text-sm text-stone-600">Set as default</label>
                            </div>
                          )}
                          <div className="flex-1 min-w-[180px]">
                            <label className="block text-xs text-stone-500 mb-1">Notes <span className="opacity-60">(optional)</span></label>
                            <input value={archForm.notes}
                              onChange={e => setArchForm(f => ({ ...f, notes: e.target.value }))}
                              className="w-full border border-stone-300 rounded px-3 py-1.5 text-sm"
                              placeholder="e.g. assigned after session 002" />
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => handleArchetypeAssign(c.id)} disabled={archSaving}
                              className="px-4 py-1.5 rounded text-sm font-normal text-white disabled:opacity-50"
                              style={{ backgroundColor: '#b05642' }}>
                              {archSaving ? 'Saving…' : 'Save'}
                            </button>
                            <button onClick={() => setAssigningId(null)}
                              className="px-4 py-1.5 rounded text-sm text-stone-500 hover:text-stone-800 border border-stone-200">
                              Cancel
                            </button>
                          </div>
                          {archError && <p className="w-full text-red-500 text-xs">{archError}</p>}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
