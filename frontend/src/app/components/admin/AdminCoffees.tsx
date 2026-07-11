import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAdminLookups } from '../../hooks/useAdminLookups';

interface HopConflict {
  conflicting_coffee: string;
  note: string;
}

interface DialSuggestion {
  suggested_vocabulary_id: number;
  suggested_label: string;
  suggested_sort_order: number;
  avg_score: number;
  session_count: number;
  is_outlier: boolean;
  dimension_name: string;
  hop_conflict?: HopConflict;
}

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
  dial_suggestion: DialSuggestion | null;
}

interface VocabOption {
  id: number;
  archetype: string;
  sort_order: number;
  label: string;
  dimension: string;
}

interface AliasRow {
  id: number;
  platform_name: string;
  archetype: string | null;
  dial_sort_order: number | null;
  coffee_id: number;
  priority: number;
  is_active: boolean;
  coffee_name: string;
  roaster: string;
}

interface RoasterOption { id: string; name: string; }

interface CategoryOption {
  id: number;
  code: string;
  label: string;
  sort_order: number;
  is_active: boolean;
  is_hoppable: boolean;
}

interface CoffeeCategoryRow {
  id: number;
  coffee_id: number;
  category_id: number;
  coffee_name: string;
  category_code: string;
  category_label: string;
}

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

const PATH   = 'Path Coffee Roasters';
const TCR    = 'Temecula Coffee Roasters';

const EMPTY_FORM = {
  name: '', roaster: '', origin: '',
  blend_or_single: '', process: '', roast_level: '',
  flavor_descriptors_roaster: '',
};

const EMPTY_ARCH = {
  archetype: '', confidence: 'medium', notes: '',
  vocab_id: '', dial_is_default: false,
};

function posIcon(sort: number) {
  if (sort === 1) return '←';
  if (sort === 2) return '◉';
  if (sort === 3) return '→';
  return '⟶';
}

function ordinal(n: number) {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

function LookupSelect({ category, value, onChange, lookups }: {
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
  const [aliases, setAliases]               = useState<AliasRow[]>([]);
  const [roasterOptions, setRoasterOptions] = useState<RoasterOption[]>([]);
  const [categories, setCategories]                 = useState<CategoryOption[]>([]);
  const [coffeeCategories, setCoffeeCategories]     = useState<CoffeeCategoryRow[]>([]);
  const [error, setError]                   = useState('');

  // categories panel
  const [showCategoriesPanel, setShowCategoriesPanel] = useState(false);
  const [newCategoryLabel, setNewCategoryLabel]       = useState('');
  const [categoryCreateSaving, setCategoryCreateSaving] = useState(false);
  const [categoryCreateErr, setCategoryCreateErr]       = useState('');
  const [togglingCategoryId, setTogglingCategoryId]     = useState<number | null>(null);
  const [togglingCoffeeCategoryKey, setTogglingCoffeeCategoryKey] = useState<string | null>(null);

  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState('');

  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [archForm, setArchForm]       = useState(EMPTY_ARCH);
  const [archSaving, setArchSaving]   = useState(false);
  const [archError, setArchError]     = useState('');

  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [movingId, setMovingId]         = useState<number | null>(null);
  const [deletingId, setDeletingId]     = useState<number | null>(null);

  // alias rank editing (moved here from Blends & SKUs — see Phase 2)
  const [rankAliasId, setRankAliasId] = useState<number | null>(null);
  const [rankValue, setRankValue]     = useState('');
  const [rankSaving, setRankSaving]   = useState(false);
  const [rankErr, setRankErr]         = useState('');

  // alias creation
  const [creatingAliasFor, setCreatingAliasFor] = useState<number | null>(null);
  const [newAliasName, setNewAliasName]         = useState('');
  const [newAliasPriority, setNewAliasPriority] = useState('1');
  const [aliasCreateSaving, setAliasCreateSaving] = useState(false);
  const [aliasCreateErr, setAliasCreateErr]       = useState('');

  // alias rename + active toggle (Followup 1)
  const [nameEditAliasId, setNameEditAliasId] = useState<number | null>(null);
  const [nameValue, setNameValue]             = useState('');
  const [nameSaving, setNameSaving]           = useState(false);
  const [nameErr, setNameErr]                 = useState('');
  const [togglingAliasId, setTogglingAliasId] = useState<number | null>(null);

  // slot-name rename — the "Slot Name" column in the matrix table, renames every
  // alias sharing that (archetype, position) via PATCH /coffee-alias/slot
  const [editingSlotKey, setEditingSlotKey]   = useState<string | null>(null);
  const [slotNameValue, setSlotNameValue]     = useState('');
  const [slotNameSaving, setSlotNameSaving]   = useState(false);
  const [slotNameErr, setSlotNameErr]         = useState('');

  // position name (label) — the "Position" column's title itself, e.g. "Classic",
  // edits dial_position_vocabulary.label via the same PATCH /dial/vocabulary/:id
  const [editingVocabLabelId, setEditingVocabLabelId] = useState<number | null>(null);
  const [vocabLabelValue, setVocabLabelValue]         = useState('');
  const [vocabLabelSaving, setVocabLabelSaving]       = useState(false);
  const [vocabLabelErr, setVocabLabelErr]             = useState('');

  async function apiFetch(url: string, options: RequestInit = {}) {
    const token = await user!.getIdToken();
    return fetch(url, {
      cache: 'no-store', ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    });
  }

  async function load() {
    try {
      const [coffeeRes, vocabRes, aliasRes, roasterRes, categoryRes, coffeeCategoryRes] = await Promise.all([
        apiFetch('/api/admin/coffees'),
        apiFetch('/api/admin/dial/vocabulary'),
        apiFetch('/api/admin/coffee-alias'),
        apiFetch('/api/admin/roasters'),
        apiFetch('/api/admin/categories'),
        apiFetch('/api/admin/coffee-categories'),
      ]);
      setCoffees(await coffeeRes.json());
      setVocab(await vocabRes.json());
      setAliases(await aliasRes.json());
      const roasters = await roasterRes.json();
      if (Array.isArray(roasters)) setRoasterOptions(roasters.filter((r: { is_active: boolean }) => r.is_active));
      setCategories(await categoryRes.json());
      setCoffeeCategories(await coffeeCategoryRes.json());
    } catch { setError('Failed to load coffees'); }
  }

  useEffect(() => { if (user) load(); }, [user]);

  // ── alias lookup: `archetype_sortorder` → platform_name ───────────────────
  const aliasMap: Record<string, string> = {};
  for (const a of aliases) {
    const key = `${a.archetype ?? 'null'}_${a.dial_sort_order ?? 'null'}`;
    if (!aliasMap[key]) aliasMap[key] = a.platform_name;
  }

  // ── handlers ───────────────────────────────────────────────────────────────

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
          archetype:    archForm.archetype,
          confidence:   archForm.confidence,
          notes:        archForm.notes || null,
          vocabulary_id:  archForm.vocab_id ? Number(archForm.vocab_id) : undefined,
          dial_is_default: archForm.dial_is_default,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Unknown error');
      setAssigningId(null); setArchForm(EMPTY_ARCH); await load();
    } catch (err: unknown) {
      setArchError(err instanceof Error ? err.message : 'Failed to assign');
    } finally { setArchSaving(false); }
  }

  async function handleMovePosition(coffee: Coffee, vocabId: number) {
    if (!coffee.dial_position_id) return;
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

  async function handleDelete(coffeeId: number, name: string) {
    if (!confirm(`Remove "${name}" from the catalogue? This also removes its archetype assignment, dial position, and aliases.`)) return;
    setDeletingId(coffeeId);
    try {
      await apiFetch(`/api/admin/coffees/${coffeeId}`, { method: 'DELETE' });
      setAssigningId(null);
      await load();
    } catch { /* non-critical */ } finally { setDeletingId(null); }
  }

  async function handleRefreshContent(coffeeId: number) {
    setRefreshingId(coffeeId);
    try { await apiFetch(`/api/admin/coffees/${coffeeId}/refresh-content`, { method: 'POST' }); }
    catch { /* non-critical */ } finally { setRefreshingId(null); }
  }

  async function handleRankSave(aliasId: number) {
    const rank = parseInt(rankValue);
    if (!Number.isFinite(rank) || rank < 1) { setRankErr('Enter a number ≥ 1'); return; }
    setRankSaving(true); setRankErr('');
    try {
      const res = await apiFetch(`/api/admin/coffee-alias/${aliasId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: rank }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      setRankAliasId(null); await load();
    } catch (err: unknown) {
      setRankErr(err instanceof Error ? err.message : 'Failed');
    } finally { setRankSaving(false); }
  }

  async function handleCreateAlias(coffeeId: number) {
    if (!newAliasName.trim()) { setAliasCreateErr('Platform name is required'); return; }
    const priority = parseInt(newAliasPriority);
    if (!Number.isFinite(priority) || priority < 1) { setAliasCreateErr('Enter a priority ≥ 1'); return; }
    const coffee = coffees.find(c => c.id === coffeeId);
    if (!coffee?.archetype) { setAliasCreateErr('Coffee needs an archetype and dial position first'); return; }
    setAliasCreateSaving(true); setAliasCreateErr('');
    try {
      const res = await apiFetch('/api/admin/coffee-alias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform_name: newAliasName.trim(),
          archetype: coffee.archetype,
          coffee_id: coffeeId,
          priority,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      setCreatingAliasFor(null); setNewAliasName(''); setNewAliasPriority('1'); await load();
    } catch (err: unknown) {
      setAliasCreateErr(err instanceof Error ? err.message : 'Failed');
    } finally { setAliasCreateSaving(false); }
  }

  async function handleAliasNameSave(aliasId: number) {
    if (!nameValue.trim()) { setNameErr('Platform name is required'); return; }
    setNameSaving(true); setNameErr('');
    try {
      const res = await apiFetch(`/api/admin/coffee-alias/${aliasId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform_name: nameValue.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      setNameEditAliasId(null); await load();
    } catch (err: unknown) {
      setNameErr(err instanceof Error ? err.message : 'Failed');
    } finally { setNameSaving(false); }
  }

  async function handleAliasToggleActive(alias: AliasRow) {
    setTogglingAliasId(alias.id);
    try {
      await apiFetch(`/api/admin/coffee-alias/${alias.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !alias.is_active }),
      });
      await load();
    } catch { /* non-critical */ } finally { setTogglingAliasId(null); }
  }

  async function handleSlotNameSave(archetype: string, sortOrder: number) {
    if (!slotNameValue.trim()) { setSlotNameErr('Slot name is required'); return; }
    setSlotNameSaving(true); setSlotNameErr('');
    try {
      const res = await apiFetch('/api/admin/coffee-alias/slot', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archetype,
          dial_sort_order: sortOrder,
          platform_name: slotNameValue.trim(),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      setEditingSlotKey(null); await load();
    } catch (err: unknown) {
      setSlotNameErr(err instanceof Error ? err.message : 'Failed');
    } finally { setSlotNameSaving(false); }
  }

  async function handleVocabLabelSave(vocabId: number) {
    if (!vocabLabelValue.trim()) { setVocabLabelErr('Name is required'); return; }
    setVocabLabelSaving(true); setVocabLabelErr('');
    try {
      const res = await apiFetch(`/api/admin/dial/vocabulary/${vocabId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: vocabLabelValue.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      setEditingVocabLabelId(null); await load();
    } catch (err: unknown) {
      setVocabLabelErr(err instanceof Error ? err.message : 'Failed');
    } finally { setVocabLabelSaving(false); }
  }

  async function handleCreateCategory() {
    if (!newCategoryLabel.trim()) { setCategoryCreateErr('Label is required'); return; }
    const code = newCategoryLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!code) { setCategoryCreateErr('Label must contain at least one letter or number'); return; }
    setCategoryCreateSaving(true); setCategoryCreateErr('');
    try {
      const res = await apiFetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, label: newCategoryLabel.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      setNewCategoryLabel(''); await load();
    } catch (err: unknown) {
      setCategoryCreateErr(err instanceof Error ? err.message : 'Failed');
    } finally { setCategoryCreateSaving(false); }
  }

  async function handleToggleCategoryActive(cat: CategoryOption) {
    setTogglingCategoryId(cat.id);
    try {
      await apiFetch(`/api/admin/categories/${cat.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !cat.is_active }),
      });
      await load();
    } catch { /* non-critical */ } finally { setTogglingCategoryId(null); }
  }

  async function handleToggleCoffeeCategory(coffeeId: number, categoryId: number) {
    const key = `${coffeeId}_${categoryId}`;
    const existing = coffeeCategories.find(cc => cc.coffee_id === coffeeId && cc.category_id === categoryId);
    setTogglingCoffeeCategoryKey(key);
    try {
      if (existing) {
        await apiFetch(`/api/admin/coffee-categories/${existing.id}`, { method: 'DELETE' });
      } else {
        await apiFetch('/api/admin/coffee-categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coffee_id: coffeeId, category_id: categoryId }),
        });
      }
      await load();
    } catch { /* non-critical */ } finally { setTogglingCoffeeCategoryKey(null); }
  }

  function openAssign(coffee: Coffee) {
    setAssigningId(coffee.id);
    setArchForm({
      archetype:       coffee.archetype ?? '',
      confidence:      coffee.confidence ?? 'medium',
      notes:           '',
      vocab_id:        coffee.dial_vocab_id ? String(coffee.dial_vocab_id) : '',
      dial_is_default: coffee.dial_is_default ?? false,
    });
    setArchError('');
  }

  const field = (key: keyof typeof EMPTY_FORM) => (v: string) => setForm(f => ({ ...f, [key]: v }));

  // ── coffee chip (used in matrix cells) ────────────────────────────────────

  function CoffeeChip({ coffee }: { coffee: Coffee }) {
    const archetypeVocab = vocab
      .filter(v => v.archetype === coffee.archetype)
      .sort((a, b) => a.sort_order - b.sort_order);
    const currentIdx = archetypeVocab.findIndex(v => v.id === coffee.dial_vocab_id);
    const prevVocab  = archetypeVocab[currentIdx - 1];
    const nextVocab  = archetypeVocab[currentIdx + 1];
    const isMoving   = movingId === coffee.id;
    const isEditing  = assigningId === coffee.id;
    const alias      = aliases.find(a => a.coffee_id === coffee.id);
    const coffeeCats = coffeeCategories.filter(cc => cc.coffee_id === coffee.id);

    return (
      <div className={`flex items-center gap-1 group py-0.5 ${isEditing ? 'opacity-60' : ''}`}>
        <button
          onClick={() => prevVocab && !isMoving && handleMovePosition(coffee, prevVocab.id)}
          disabled={!prevVocab || isMoving}
          className="text-stone-200 hover:text-stone-500 disabled:opacity-0 group-hover:opacity-100 transition-all text-xs px-0.5"
          title={prevVocab ? `Move to ${prevVocab.label}` : undefined}
        >←</button>
        <button
          onClick={() => isEditing ? setAssigningId(null) : openAssign(coffee)}
          className="text-sm text-stone-700 hover:text-stone-900 hover:underline text-left"
        >
          {coffee.name}
        </button>
        {coffeeCats.map(cc => (
          <span key={cc.id} className="px-1.5 py-0.5 rounded text-xs border border-stone-200 text-stone-400 bg-stone-50 leading-none">
            {cc.category_label}
          </span>
        ))}
        {alias && (
          <span
            className={`px-1.5 py-0.5 rounded text-xs border leading-none ${
              alias.priority === 1
                ? 'text-white border-transparent'
                : 'text-stone-500 border-stone-200'
            }`}
            style={alias.priority === 1 ? { backgroundColor: '#b05642' } : {}}
            title={`${ordinal(alias.priority)} choice for this slot`}
          >
            {ordinal(alias.priority)}
          </span>
        )}
        {coffee.dial_is_default && <span className="text-stone-400 text-xs">★</span>}
        <button
          onClick={() => nextVocab && !isMoving && handleMovePosition(coffee, nextVocab.id)}
          disabled={!nextVocab || isMoving}
          className="text-stone-200 hover:text-stone-500 disabled:opacity-0 group-hover:opacity-100 transition-all text-xs px-0.5"
          title={nextVocab ? `Move to ${nextVocab.label}` : undefined}
        >→</button>
        <button
          onClick={() => handleRefreshContent(coffee.id)}
          disabled={refreshingId === coffee.id}
          className="text-stone-200 hover:text-stone-400 disabled:opacity-40 transition-all text-xs opacity-0 group-hover:opacity-100"
          title="Refresh AI content"
        >{refreshingId === coffee.id ? '…' : '↺'}</button>
      </div>
    );
  }

  // ── inline edit form ───────────────────────────────────────────────────────

  function EditForm({ coffeeId }: { coffeeId: number }) {
    const coffee = coffees.find(c => c.id === coffeeId);
    const formVocabOptions = vocab
      .filter(v => v.archetype === archForm.archetype)
      .sort((a, b) => a.sort_order - b.sort_order);

    return (
      <div className="bg-stone-50 border-t border-stone-100 px-4 py-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-stone-400 mb-1">Archetype *</label>
          <select value={archForm.archetype}
            onChange={e => setArchForm(f => ({ ...f, archetype: e.target.value, vocab_id: '', dial_is_default: false }))}
            className="border border-stone-300 rounded px-3 py-1.5 text-sm">
            <option value="">— select —</option>
            {ARCHETYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-stone-400 mb-1">Confidence *</label>
          <select value={archForm.confidence}
            onChange={e => setArchForm(f => ({ ...f, confidence: e.target.value }))}
            className="border border-stone-300 rounded px-3 py-1.5 text-sm">
            {CONFIDENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-stone-400 mb-1">Dial Position</label>
          <select value={archForm.vocab_id}
            onChange={e => setArchForm(f => ({ ...f, vocab_id: e.target.value }))}
            disabled={!archForm.archetype}
            className="border border-stone-300 rounded px-3 py-1.5 text-sm min-w-[150px] disabled:opacity-40">
            <option value="">— none —</option>
            {formVocabOptions.map(v => (
              <option key={v.id} value={v.id}>{v.sort_order}. {v.label}</option>
            ))}
          </select>
          {coffee?.dial_suggestion && coffee.dial_suggestion.suggested_vocabulary_id !== coffee.dial_vocab_id && (
            coffee.dial_suggestion.is_outlier ? (
              <p className="mt-1 text-xs text-amber-600 max-w-[220px]">
                Cupping score is unusually high/low for this archetype (avg {coffee.dial_suggestion.dimension_name} {coffee.dial_suggestion.avg_score}, {coffee.dial_suggestion.session_count} session{coffee.dial_suggestion.session_count === 1 ? '' : 's'}) — worth double-checking the archetype assignment.
              </p>
            ) : (
              <p className="mt-1 text-xs text-stone-500">
                Suggested: {coffee.dial_suggestion.suggested_label} (avg {coffee.dial_suggestion.dimension_name} {coffee.dial_suggestion.avg_score}, {coffee.dial_suggestion.session_count} session{coffee.dial_suggestion.session_count === 1 ? '' : 's'})
                {' '}
                <button
                  type="button"
                  onClick={() => handleMovePosition(coffee, coffee.dial_suggestion!.suggested_vocabulary_id)}
                  className="text-xs underline hover:text-stone-800"
                >
                  Apply
                </button>
              </p>
            )
          )}
          {coffee?.dial_suggestion?.hop_conflict && (
            <p className="mt-1 text-xs text-amber-600 max-w-[220px]">
              {coffee.dial_suggestion.hop_conflict.note}
            </p>
          )}
        </div>
        {archForm.vocab_id && (
          <div className="flex items-center gap-2 pb-1.5">
            <input type="checkbox" id={`default-${coffeeId}`}
              checked={archForm.dial_is_default}
              onChange={e => setArchForm(f => ({ ...f, dial_is_default: e.target.checked }))}
              className="accent-stone-600" />
            <label htmlFor={`default-${coffeeId}`} className="text-sm text-stone-600">Set as default</label>
          </div>
        )}
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-stone-400 mb-1">Notes</label>
          <input value={archForm.notes}
            onChange={e => setArchForm(f => ({ ...f, notes: e.target.value }))}
            className="w-full border border-stone-300 rounded px-3 py-1.5 text-sm"
            placeholder="e.g. confirmed after session 002" />
        </div>
        {/* alias / priority controls — moved here from Blends & SKUs (Phase 2) */}
        <div className="w-full flex items-end gap-3 pt-2 mt-1 border-t border-stone-200">
          {(() => {
            const existingAlias = aliases.find(a => a.coffee_id === coffeeId);
            if (existingAlias) {
              const isRankEditing = rankAliasId === existingAlias.id;
              const isNameEditing = nameEditAliasId === existingAlias.id;
              return (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-400">Alias:</span>
                  {!isNameEditing ? (
                    <button
                      onClick={() => { setNameEditAliasId(existingAlias.id); setNameValue(existingAlias.platform_name); setNameErr(''); }}
                      className="flex items-center gap-1.5 group text-xs text-stone-700 hover:underline"
                      title="Click to rename"
                    >
                      {existingAlias.platform_name}
                      <span className="text-stone-300 opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input value={nameValue} onChange={e => setNameValue(e.target.value)}
                        className="border border-stone-300 rounded px-2 py-0.5 text-xs w-36"
                        autoFocus />
                      <button onClick={() => handleAliasNameSave(existingAlias.id)} disabled={nameSaving}
                        className="px-3 py-0.5 rounded text-xs text-white disabled:opacity-50"
                        style={{ backgroundColor: '#b05642' }}>
                        {nameSaving ? '…' : 'Save'}
                      </button>
                      <button onClick={() => setNameEditAliasId(null)} className="text-xs text-stone-400 hover:text-stone-600">Cancel</button>
                      {nameErr && <span className="text-red-500 text-xs">{nameErr}</span>}
                    </div>
                  )}
                  <button
                    onClick={() => handleAliasToggleActive(existingAlias)}
                    disabled={togglingAliasId === existingAlias.id}
                    className={`px-2 py-0.5 rounded border text-xs transition-colors disabled:opacity-40 ${
                      existingAlias.is_active
                        ? 'bg-green-50 text-green-700 border-green-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200'
                        : 'bg-stone-100 text-stone-400 border-stone-200 hover:bg-green-50 hover:text-green-700 hover:border-green-200'
                    }`}
                  >
                    {togglingAliasId === existingAlias.id ? '…' : existingAlias.is_active ? 'Active' : 'Inactive'}
                  </button>
                  {!isRankEditing ? (
                    <button
                      onClick={() => { setRankAliasId(existingAlias.id); setRankValue(String(existingAlias.priority)); setRankErr(''); }}
                      className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                        existingAlias.priority === 1
                          ? 'text-white border-transparent'
                          : 'text-stone-500 border-stone-200 hover:border-stone-400 hover:text-stone-700'
                      }`}
                      style={existingAlias.priority === 1 ? { backgroundColor: '#b05642' } : {}}
                      title="Click to change rank"
                    >
                      {ordinal(existingAlias.priority)} choice{existingAlias.priority === 1 ? ' ★' : ''}
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input type="number" min="1" max="9" value={rankValue}
                        onChange={e => setRankValue(e.target.value)}
                        className="w-12 border border-stone-300 rounded px-2 py-0.5 text-xs text-center"
                        autoFocus />
                      <button onClick={() => handleRankSave(existingAlias.id)} disabled={rankSaving}
                        className="px-3 py-0.5 rounded text-xs text-white disabled:opacity-50"
                        style={{ backgroundColor: '#b05642' }}>
                        {rankSaving ? '…' : 'Save'}
                      </button>
                      <button onClick={() => setRankAliasId(null)} className="text-xs text-stone-400 hover:text-stone-600">Cancel</button>
                      {rankErr && <span className="text-red-500 text-xs">{rankErr}</span>}
                    </div>
                  )}
                </div>
              );
            }
            if (coffee?.archetype && coffee?.dial_vocab_id) {
              const isCreating = creatingAliasFor === coffeeId;
              if (!isCreating) {
                return (
                  <button
                    onClick={() => { setCreatingAliasFor(coffeeId); setNewAliasName(''); setNewAliasPriority('1'); setAliasCreateErr(''); }}
                    className="px-2 py-0.5 rounded border border-dashed border-stone-300 text-xs text-stone-400 hover:border-stone-400 hover:text-stone-600"
                  >
                    + Create alias
                  </button>
                );
              }
              return (
                <div className="flex items-end gap-2">
                  <div>
                    <label className="block text-xs text-stone-400 mb-1">Platform Name</label>
                    <input value={newAliasName} onChange={e => setNewAliasName(e.target.value)}
                      className="border border-stone-300 rounded px-3 py-1.5 text-sm w-40"
                      placeholder="e.g. House Blend" />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-400 mb-1">Priority</label>
                    <input type="number" min="1" max="9" value={newAliasPriority}
                      onChange={e => setNewAliasPriority(e.target.value)}
                      className="w-16 border border-stone-300 rounded px-2 py-1.5 text-sm text-center" />
                  </div>
                  <button onClick={() => handleCreateAlias(coffeeId)} disabled={aliasCreateSaving}
                    className="px-3 py-1.5 rounded text-xs text-white disabled:opacity-50"
                    style={{ backgroundColor: '#b05642' }}>
                    {aliasCreateSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setCreatingAliasFor(null)} className="text-xs text-stone-400 hover:text-stone-600 pb-1.5">Cancel</button>
                  {aliasCreateErr && <span className="text-red-500 text-xs">{aliasCreateErr}</span>}
                </div>
              );
            }
            return null;
          })()}
        </div>
        {/* per-coffee category tags — independent of archetype/position */}
        {categories.some(c => c.is_active) && (
          <div className="w-full flex items-center flex-wrap gap-3 pt-2 mt-1 border-t border-stone-200">
            <span className="text-xs text-stone-400">Categories:</span>
            {categories.filter(c => c.is_active).map(cat => {
              const isAssigned = coffeeCategories.some(cc => cc.coffee_id === coffeeId && cc.category_id === cat.id);
              const key = `${coffeeId}_${cat.id}`;
              return (
                <label key={cat.id} className="flex items-center gap-1.5 text-xs text-stone-600">
                  <input type="checkbox" checked={isAssigned}
                    disabled={togglingCoffeeCategoryKey === key}
                    onChange={() => handleToggleCoffeeCategory(coffeeId, cat.id)}
                    className="accent-stone-600" />
                  {cat.label}
                </label>
              );
            })}
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={() => handleArchetypeAssign(coffeeId)} disabled={archSaving}
            className="px-4 py-1.5 rounded text-sm text-white disabled:opacity-50"
            style={{ backgroundColor: '#b05642' }}>
            {archSaving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setAssigningId(null)}
            className="px-4 py-1.5 rounded text-sm text-stone-500 hover:text-stone-800 border border-stone-200">
            Cancel
          </button>
          <button
            onClick={() => coffee && handleDelete(coffeeId, coffee.name)}
            disabled={deletingId === coffeeId}
            className="ml-auto px-4 py-1.5 rounded text-sm text-red-400 hover:text-red-600 hover:border-red-300 border border-stone-200 disabled:opacity-40 transition-colors"
          >
            {deletingId === coffeeId ? 'Removing…' : 'Remove coffee'}
          </button>
        </div>
        {archError && <p className="w-full text-red-500 text-xs">{archError}</p>}
      </div>
    );
  }

  // ── derived data ───────────────────────────────────────────────────────────

  const unplaced = coffees.filter(c => !c.archetype);

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-normal text-stone-800">Coffees</h1>
        <button onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 rounded text-sm font-normal text-white hover:opacity-80"
          style={{ backgroundColor: '#b05642' }}>
          {showForm ? 'Cancel' : '+ Add Coffee'}
        </button>
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {/* Add coffee form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="border border-stone-200 rounded-lg p-6 mb-8 bg-stone-50 grid grid-cols-1 md:grid-cols-2 gap-4">
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

      {/* ── Categories panel — cross-cutting tags orthogonal to archetype ────── */}
      <div className="mb-8 border border-stone-100 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowCategoriesPanel(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-stone-50 text-xs text-stone-500 hover:bg-stone-100 transition-colors"
        >
          <span className="uppercase tracking-widest">Categories</span>
          <span>{showCategoriesPanel ? '−' : '+'}</span>
        </button>
        {showCategoriesPanel && (
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => handleToggleCategoryActive(cat)}
                  disabled={togglingCategoryId === cat.id}
                  className={`px-2.5 py-1 rounded-full border text-xs transition-colors disabled:opacity-40 ${
                    cat.is_active
                      ? 'bg-green-50 text-green-700 border-green-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200'
                      : 'bg-stone-100 text-stone-400 border-stone-200 hover:bg-green-50 hover:text-green-700 hover:border-green-200'
                  }`}
                  title={cat.is_active ? 'Click to deactivate' : 'Click to reactivate'}
                >
                  {cat.label}
                  {togglingCategoryId === cat.id ? ' …' : cat.is_active ? '' : ' (inactive)'}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <div>
                <label className="block text-xs text-stone-400 mb-1">New category</label>
                <input value={newCategoryLabel}
                  onChange={e => setNewCategoryLabel(e.target.value)}
                  className="border border-stone-300 rounded px-3 py-1.5 text-sm w-44"
                  placeholder="e.g. Seasonal" />
              </div>
              <button onClick={handleCreateCategory} disabled={categoryCreateSaving}
                className="px-3 py-1.5 rounded text-xs text-white disabled:opacity-50"
                style={{ backgroundColor: '#b05642' }}>
                {categoryCreateSaving ? 'Saving…' : '+ Add category'}
              </button>
              {categoryCreateErr && <span className="text-xs text-red-500">{categoryCreateErr}</span>}
            </div>
          </div>
        )}
      </div>

      {/* ── Archetype matrix ─────────────────────────────────────────────────── */}
      <div className="space-y-10">
        {ARCHETYPE_OPTIONS.map(({ value: archValue, label: archLabel }) => {
          const archVocab = vocab
            .filter(v => v.archetype === archValue)
            .sort((a, b) => a.sort_order - b.sort_order);
          const archCoffees = coffees.filter(c => c.archetype === archValue);

          if (archCoffees.length === 0 && archVocab.length === 0) return null;

          return (
            <div key={archValue}>
              <h2 className="text-xs font-normal text-stone-400 uppercase tracking-widest mb-2">
                {archLabel}
              </h2>
              <div className="border border-stone-100 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-100 bg-stone-50 text-xs text-stone-400 uppercase tracking-wide">
                      <th className="py-2 px-4 text-left w-32">Position</th>
                      <th className="py-2 px-4 text-left w-40">Slot Name</th>
                      <th className="py-2 px-4 text-left">Path Coffee Roasters</th>
                      <th className="py-2 px-4 text-left">Temecula Coffee Roasters</th>
                    </tr>
                  </thead>
                  <tbody>
                    {archVocab.map(v => {
                      const posCoffees  = archCoffees.filter(c => c.dial_position_sort === v.sort_order);
                      const pathCoffees = posCoffees.filter(c => c.roaster === PATH);
                      const tcrCoffees  = posCoffees.filter(c => c.roaster === TCR);
                      const alias       = aliasMap[`${archValue}_${v.sort_order}`] ?? '—';
                      const isDefault   = v.sort_order === 2;
                      const editingHere = posCoffees.some(c => c.id === assigningId);

                      return (
                        <>
                          <tr
                            key={v.id}
                            className={`border-b border-stone-50 ${isDefault ? 'bg-stone-50/60' : ''}`}
                          >
                            <td className="py-2.5 px-4 text-stone-400 text-xs align-top">
                              {editingVocabLabelId === v.id ? (
                                <div className="flex items-center gap-1.5 whitespace-nowrap">
                                  <span className="mr-0.5">{posIcon(v.sort_order)}</span>
                                  <input value={vocabLabelValue}
                                    onChange={e => setVocabLabelValue(e.target.value)}
                                    className="border border-stone-300 rounded px-2 py-0.5 text-xs w-20"
                                    autoFocus />
                                  <button onClick={() => handleVocabLabelSave(v.id)} disabled={vocabLabelSaving}
                                    className="px-2 py-0.5 rounded text-xs text-white disabled:opacity-50"
                                    style={{ backgroundColor: '#b05642' }}>
                                    {vocabLabelSaving ? '…' : 'Save'}
                                  </button>
                                  <button onClick={() => setEditingVocabLabelId(null)}
                                    className="text-xs text-stone-400 hover:text-stone-600">
                                    Cancel
                                  </button>
                                  {vocabLabelErr && <span className="text-xs text-red-500">{vocabLabelErr}</span>}
                                </div>
                              ) : (
                                <button
                                  onClick={() => { setEditingVocabLabelId(v.id); setVocabLabelValue(v.label); setVocabLabelErr(''); }}
                                  className="flex items-center gap-1.5 group whitespace-nowrap text-xs hover:underline"
                                  title="Click to rename this position"
                                >
                                  <span className="mr-0.5">{posIcon(v.sort_order)}</span>
                                  {v.label}
                                  <span className="text-stone-300 opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
                                </button>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-stone-500 text-xs">
                              {(() => {
                                const slotKey = `${archValue}_${v.sort_order}`;
                                if (editingSlotKey === slotKey) {
                                  return (
                                    <div className="flex items-center gap-1.5">
                                      <input value={slotNameValue}
                                        onChange={e => setSlotNameValue(e.target.value)}
                                        className="border border-stone-300 rounded px-2 py-0.5 text-xs w-28"
                                        autoFocus />
                                      <button onClick={() => handleSlotNameSave(archValue, v.sort_order)} disabled={slotNameSaving}
                                        className="px-2 py-0.5 rounded text-xs text-white disabled:opacity-50"
                                        style={{ backgroundColor: '#b05642' }}>
                                        {slotNameSaving ? '…' : 'Save'}
                                      </button>
                                      <button onClick={() => setEditingSlotKey(null)} className="text-xs text-stone-400 hover:text-stone-600">Cancel</button>
                                      {slotNameErr && <span className="text-xs text-red-500">{slotNameErr}</span>}
                                    </div>
                                  );
                                }
                                if (alias === '—') return <span className="text-xs text-stone-200">—</span>;
                                return (
                                  <button
                                    onClick={() => { setEditingSlotKey(slotKey); setSlotNameValue(alias); setSlotNameErr(''); }}
                                    className="flex items-center gap-1.5 group text-xs hover:underline"
                                    title="Click to rename this slot"
                                  >
                                    {alias}
                                    <span className="text-stone-300 opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
                                  </button>
                                );
                              })()}
                            </td>
                            <td className="py-2.5 px-4">
                              {pathCoffees.length > 0
                                ? <div className="space-y-0.5">{pathCoffees.map(c => <CoffeeChip key={c.id} coffee={c} />)}</div>
                                : <span className="text-stone-200 text-xs">—</span>}
                            </td>
                            <td className="py-2.5 px-4">
                              {tcrCoffees.length > 0
                                ? <div className="space-y-0.5">{tcrCoffees.map(c => <CoffeeChip key={c.id} coffee={c} />)}</div>
                                : <span className="text-stone-200 text-xs">—</span>}
                            </td>
                          </tr>
                          {editingHere && (
                            <tr key={`edit-${v.id}`} className="border-b border-stone-200">
                              <td colSpan={4} className="p-0">
                                <EditForm coffeeId={assigningId!} />
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}

                    {/* Coffees with this archetype but no dial position */}
                    {(() => {
                      const noPos = archCoffees.filter(c => !c.dial_position_sort);
                      if (noPos.length === 0) return null;
                      const editingHere = noPos.some(c => c.id === assigningId);
                      return (
                        <>
                          <tr key="no-pos" className="border-b border-stone-50 bg-amber-50/40">
                            <td className="py-2.5 px-4 text-xs text-amber-400">— no position</td>
                            <td className="py-2.5 px-4 text-stone-200 text-xs">—</td>
                            <td className="py-2.5 px-4" colSpan={2}>
                              <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                                {noPos.map(c => <CoffeeChip key={c.id} coffee={c} />)}
                              </div>
                            </td>
                          </tr>
                          {editingHere && (
                            <tr key="edit-no-pos" className="border-b border-stone-200">
                              <td colSpan={4} className="p-0">
                                <EditForm coffeeId={assigningId!} />
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {/* ── Unplaced (no archetype) ─────────────────────────────────────── */}
        {unplaced.length > 0 && (
          <div>
            <h2 className="text-xs font-normal text-stone-400 uppercase tracking-widest mb-2">
              Unplaced
            </h2>
            <div className="border border-stone-100 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 bg-stone-50 text-xs text-stone-400 uppercase tracking-wide">
                    <th className="py-2 px-4 text-left">Coffee</th>
                    <th className="py-2 px-4 text-left">Roaster</th>
                    <th className="py-2 px-4 text-left">Origin</th>
                    <th className="py-2 px-4 text-left">Process / Roast</th>
                    <th className="py-2 px-4 text-left">Archetype</th>
                  </tr>
                </thead>
                <tbody>
                  {unplaced.map(c => {
                    const isAssigning = assigningId === c.id;
                    const roastLabel   = lookups.roast_level?.find(o => o.value === c.roast_level)?.label ?? c.roast_level ?? '—';
                    const processLabel = lookups.process?.find(o => o.value === c.process)?.label ?? c.process ?? '—';
                    return (
                      <>
                        <tr key={c.id} className="border-b border-stone-50 hover:bg-stone-50">
                          <td className="py-2.5 px-4 text-stone-800">
                            <div className="flex items-center gap-1.5">
                              {c.name}
                              {coffeeCategories.filter(cc => cc.coffee_id === c.id).map(cc => (
                                <span key={cc.id} className="px-1.5 py-0.5 rounded text-xs border border-stone-200 text-stone-400 bg-stone-50 leading-none">
                                  {cc.category_label}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-stone-500 text-xs">{c.roaster ?? '—'}</td>
                          <td className="py-2.5 px-4 text-stone-500 text-xs">{c.origin ?? '—'}</td>
                          <td className="py-2.5 px-4 text-stone-500 text-xs">{processLabel} · {roastLabel}</td>
                          <td className="py-2.5 px-4">
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
                        </tr>
                        {isAssigning && (
                          <tr key={`edit-${c.id}`} className="border-b border-stone-200">
                            <td colSpan={5} className="p-0">
                              <EditForm coffeeId={c.id} />
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
        )}
      </div>
    </div>
  );
}
