import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { useAdminLookups } from '../../hooks/useAdminLookups';
import { reportError } from '../../lib/errorReporter';
import { useArchetypes } from './useArchetypes';
import LookupSelect from './LookupSelect';
import StoryEditorModal from './StoryEditorModal';
import CategoryAdmin, { toggleCoffeeCategory, type CategoryOption } from './CategoryAdmin';

// ─────────────────────────────────────────────────────────────────────────────
// Catalog Blueprint brief 4, Part B — AdminCoffees.tsx (1602 lines, mostly
// alias-row/vocabulary/slot-price editing with no counterpart in the new
// model) rebuilt as AdminCatalog.tsx at the same /admin/coffees route. The
// story editor, category admin, and LookupSelect are carried over as
// extracted components (see the imports above) — everything else here is new,
// built directly on GET/POST/PUT/DELETE /api/admin/catalog/*.
// ─────────────────────────────────────────────────────────────────────────────

const BRAND = '#b05642';

// ── Types (mirror the /api/admin/catalog/* response shapes) ──────────────────

interface Placement {
  assignment_id: number; slot_id: number; placement_archetype: string; sort_order: number;
  slot_name: string | null; role: 'home' | 'guest'; priority: number; assignment_is_active: boolean;
}
interface Sku {
  id: string; weight_oz: number; roaster_sku: string | null; shopify_variant_id: string | null;
  cost_to_us: string | null; quantity_available: number; safety_stock_buffer: number;
  inventory_status: string; is_active: boolean;
}
interface Coffee {
  id: number; name: string; origin: string | null; blend_or_single: string | null; process: string | null;
  roast_level: string | null; roast_shade: string | null; flavor_descriptors_roaster: string[] | null;
  roaster_id: string | null; roaster_name: string | null;
  match_archetype: string | null; match_confidence: string | null; match_source: string | null;
  category_codes: string[];
  story: string | null; story_draft: string | null; story_published: boolean; story_admin_edited: boolean;
  is_active: boolean; deactivated_at: string | null; deactivation_reason: string | null;
  placements: Placement[]; skus: Sku[];
}
interface Roaster { id: string; name: string; is_active: boolean; }
interface SlotOccupant {
  coffee_id: number; coffee_name: string; roaster_name: string | null; role: 'home' | 'guest'; priority: number;
  certified_at: string | null; placement_note: string | null;
}
interface Slot {
  id: number; archetype: string; sort_order: number; name: string | null; position_label: string;
  position_description: string | null; dimension_id: number | null; is_landing_default: boolean;
  spec_band_lo: number | null; spec_band_hi: number | null; spec_descriptor_families: string[];
  is_active: boolean; occupants: SlotOccupant[];
  sellable_12oz: boolean; sellable_12oz_coffee_id: number | null; prices: Array<{ weight_oz: number; retail_price_cents: number }>;
}
interface CoffeeCategoryRow { id: number; coffee_id: number; category_id: number; }
interface WarningLike { kind: string; [k: string]: unknown }
interface NotSellableRow {
  slot_id: number; archetype: string; sort_order: number; slot_name: string | null;
  coffee_id: number; coffee_name: string;
  reasons: Array<'no_active_12oz_sku' | 'no_price_12oz' | 'coffee_inactive' | 'category_excluded'>;
}
const NOT_SELLABLE_REASON_SHORT: Record<NotSellableRow['reasons'][number], string> = {
  no_active_12oz_sku: 'no SKU', no_price_12oz: 'no price',
  coffee_inactive: 'coffee inactive', category_excluded: 'category excluded',
};

function warningsSummary(warnings: WarningLike[] | undefined): string {
  if (!warnings || !warnings.length) return '';
  return `Saved with warnings: ${warnings.map(w => w.kind).join(', ')}`;
}

function sellableSummary(coffeeId: number, placement: Placement, slots: Slot[], notSellable: NotSellableRow[]): string {
  const slot = slots.find(s => s.id === placement.slot_id);
  if (!slot) return 'Placed';
  if (slot.sellable_12oz_coffee_id === coffeeId) return `Sellable on ${slot.archetype}/${slot.sort_order}`;
  const row = notSellable.find(r => r.slot_id === placement.slot_id && r.coffee_id === coffeeId);
  const reason = row?.reasons.map(r => NOT_SELLABLE_REASON_SHORT[r]).join(', ') ?? 'not resolved';
  return `Placed, not sellable: ${reason}`;
}

type Tab = 'list' | 'place' | 'slots';

export default function AdminCatalog() {
  const { user } = useAuth();
  const { lookups, refresh: refreshLookups } = useAdminLookups();
  const { archetypes } = useArchetypes();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState<Tab>('list');
  const [coffees, setCoffees] = useState<Coffee[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [roasters, setRoasters] = useState<Roaster[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [coffeeCategories, setCoffeeCategories] = useState<CoffeeCategoryRow[]>([]);
  const [notSellable, setNotSellable] = useState<NotSellableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // B1 filters
  const [filterRoaster, setFilterRoaster] = useState('all');
  const [filterArchetype, setFilterArchetype] = useState('all');
  const [filterActive, setFilterActive] = useState<'active' | 'inactive' | 'all'>('active');
  const [filterText, setFilterText] = useState(searchParams.get('q') ?? '');

  async function apiFetch(url: string, options: RequestInit = {}) {
    const token = await user!.getIdToken();
    return fetch(url, {
      cache: 'no-store', ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    });
  }

  const load = useCallback(async () => {
    try {
      const [coffeesRes, slotsRes, roastersRes, categoriesRes, coffeeCategoriesRes, notSellableRes] = await Promise.all([
        apiFetch('/api/admin/catalog/coffees?include_inactive=true'),
        apiFetch('/api/admin/catalog/slots'),
        apiFetch('/api/admin/roasters'),
        apiFetch('/api/admin/categories'),
        apiFetch('/api/admin/coffee-categories'),
        apiFetch('/api/admin/catalog/not-sellable'),
      ]);
      if (!coffeesRes.ok || !slotsRes.ok) throw new Error('Failed to load catalog');
      setCoffees(await coffeesRes.json());
      setSlots(await slotsRes.json());
      setRoasters(await roastersRes.json().catch(() => []));
      setCategories(await categoriesRes.json().catch(() => []));
      setCoffeeCategories(await coffeeCategoriesRes.json().catch(() => []));
      setNotSellable(await notSellableRes.json().catch(() => []));
      setError('');
    } catch (err) {
      reportError('[AdminCatalog/load]', err);
      setError('Failed to load the catalog.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => { if (user) load(); }, [user, load]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (filterText) next.set('q', filterText); else next.delete('q');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterText]);

  function archetypeLabel(code: string | null): string {
    if (!code) return '—';
    return archetypes.find(a => a.code === code)?.label ?? code;
  }

  const filteredCoffees = useMemo(() => coffees.filter(c => {
    if (filterActive === 'active' && !c.is_active) return false;
    if (filterActive === 'inactive' && c.is_active) return false;
    if (filterRoaster !== 'all' && c.roaster_id !== filterRoaster) return false;
    if (filterArchetype !== 'all' && c.match_archetype !== filterArchetype) return false;
    if (filterText && !c.name.toLowerCase().includes(filterText.toLowerCase())) return false;
    return true;
  }), [coffees, filterActive, filterRoaster, filterArchetype, filterText]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-normal text-stone-800">Coffees</h1>
        <div className="flex rounded-lg border border-stone-200 overflow-hidden shrink-0">
          {(['list', 'place', 'slots'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-sm ${tab === t ? 'text-white' : 'text-stone-500 hover:bg-stone-50'}`}
              style={tab === t ? { backgroundColor: '#1c1c1c' } : {}}>
              {t === 'list' ? 'Coffees' : t === 'place' ? 'Place a coffee' : 'Slots & pricing'}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      {toast && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <span>{toast}</span>
          <button onClick={() => setToast('')} className="text-sm text-amber-400 hover:text-amber-700 shrink-0">✕</button>
        </div>
      )}
      {loading && <p className="text-stone-400 text-sm py-12 text-center">Loading…</p>}

      {!loading && tab === 'list' && (
        <CoffeeList
          coffees={filteredCoffees} allCoffees={coffees} slots={slots} roasters={roasters} notSellable={notSellable}
          archetypes={archetypes} categories={categories} coffeeCategories={coffeeCategories}
          filterRoaster={filterRoaster} setFilterRoaster={setFilterRoaster}
          filterArchetype={filterArchetype} setFilterArchetype={setFilterArchetype}
          filterActive={filterActive} setFilterActive={setFilterActive}
          filterText={filterText} setFilterText={setFilterText}
          apiFetch={apiFetch} onReload={load} setToast={setToast}
          lookups={lookups} refreshLookups={refreshLookups}
        />
      )}
      {!loading && tab === 'place' && (
        <PlaceACoffee
          roasters={roasters.filter(r => r.is_active)} archetypes={archetypes} slots={slots}
          categories={categories} lookups={lookups} refreshLookups={refreshLookups}
          apiFetch={apiFetch} onPlaced={() => { load(); setTab('list'); }}
        />
      )}
      {!loading && tab === 'slots' && (
        <SlotsAndPricing
          slots={slots} archetypes={archetypes} apiFetch={apiFetch} onReload={load}
        />
      )}

      {!loading && !error && coffees.length === 0 && (
        <div className="py-12 text-center text-stone-400">
          <p className="text-lg mb-1">No coffees yet</p>
          <p className="text-sm">Click "Place a coffee" to place your first one through the door.</p>
        </div>
      )}
    </div>
  );
}

// ── B1: Coffee list ───────────────────────────────────────────────────────────

function CoffeeList(props: {
  coffees: Coffee[]; allCoffees: Coffee[]; slots: Slot[]; roasters: Roaster[]; notSellable: NotSellableRow[];
  archetypes: ReturnType<typeof useArchetypes>['archetypes'];
  categories: CategoryOption[]; coffeeCategories: CoffeeCategoryRow[];
  filterRoaster: string; setFilterRoaster: (v: string) => void;
  filterArchetype: string; setFilterArchetype: (v: string) => void;
  filterActive: 'active' | 'inactive' | 'all'; setFilterActive: (v: 'active' | 'inactive' | 'all') => void;
  filterText: string; setFilterText: (v: string) => void;
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>;
  onReload: () => void | Promise<void>; setToast: (v: string) => void;
  lookups: Record<string, { value: string; label: string }[]>; refreshLookups: () => void | Promise<void>;
}) {
  const {
    coffees, slots, roasters, notSellable, archetypes, categories, coffeeCategories,
    filterRoaster, setFilterRoaster, filterArchetype, setFilterArchetype,
    filterActive, setFilterActive, filterText, setFilterText,
    apiFetch, onReload, setToast, lookups, refreshLookups,
  } = props;

  const [expandedGuestsId, setExpandedGuestsId] = useState<number | null>(null);
  const [editMetaId, setEditMetaId] = useState<number | null>(null);
  const [matchModalId, setMatchModalId] = useState<number | null>(null);
  const [placeModal, setPlaceModal] = useState<{ coffeeId: number; role: 'home' | 'guest' } | null>(null);
  const [skuModalId, setSkuModalId] = useState<number | null>(null);
  const [storyCoffeeId, setStoryCoffeeId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  function archetypeLabel(code: string | null): string {
    if (!code) return '—';
    return archetypes.find(a => a.code === code)?.label ?? code;
  }

  async function handleRetireRestore(coffee: Coffee) {
    const verb = coffee.is_active ? 'retire' : 'restore';
    if (!confirm(`${verb === 'retire' ? 'Retire' : 'Restore'} "${coffee.name}"?`)) return;
    setBusyId(coffee.id);
    try {
      const res = await apiFetch(`/api/admin/catalog/coffees/${coffee.id}/${verb}`, { method: 'POST' });
      if (!res.ok) { const body = await res.json().catch(() => ({})); alert(body.message ?? body.error ?? `Failed to ${verb}`); return; }
      await onReload();
    } catch (err) { reportError(`[AdminCatalog/${verb}]`, err); } finally { setBusyId(null); }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={filterRoaster} onChange={e => setFilterRoaster(e.target.value)}
          className="border border-stone-300 rounded px-2 py-1.5 text-sm">
          <option value="all">All roasteries</option>
          {roasters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select value={filterArchetype} onChange={e => setFilterArchetype(e.target.value)}
          className="border border-stone-300 rounded px-2 py-1.5 text-sm">
          <option value="all">All matches</option>
          {archetypes.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
        </select>
        <select value={filterActive} onChange={e => setFilterActive(e.target.value as 'active' | 'inactive' | 'all')}
          className="border border-stone-300 rounded px-2 py-1.5 text-sm">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        <input value={filterText} onChange={e => setFilterText(e.target.value)} placeholder="Search coffees…"
          className="border border-stone-300 rounded px-3 py-1.5 text-sm flex-1 min-w-[160px]" />
      </div>

      <table className="w-full text-sm border border-stone-100 rounded-lg overflow-hidden">
        <thead>
          <tr className="text-xs text-stone-300 uppercase tracking-wide border-b border-stone-100 bg-stone-50">
            <th className="py-2 px-3 text-left font-normal">Name</th>
            <th className="py-2 px-3 text-left font-normal">Roastery</th>
            <th className="py-2 px-3 text-left font-normal">Match</th>
            <th className="py-2 px-3 text-left font-normal">Home slot</th>
            <th className="py-2 px-3 text-left font-normal">Guests</th>
            <th className="py-2 px-3 text-left font-normal">12oz SKU</th>
            <th className="py-2 px-3 text-left font-normal">Sellable</th>
            <th className="py-2 px-3 text-left font-normal">Categories</th>
            <th className="py-2 px-3 text-left font-normal">Story</th>
            <th className="py-2 px-3 text-left font-normal"></th>
          </tr>
        </thead>
        <tbody>
          {coffees.map(coffee => {
            const home = coffee.placements.find(p => p.role === 'home' && p.assignment_is_active);
            const guests = coffee.placements.filter(p => p.role === 'guest' && p.assignment_is_active);
            const sku12 = coffee.skus.find(s => Number(s.weight_oz) === 12);
            const guestsExpanded = expandedGuestsId === coffee.id;
            const isBusy = busyId === coffee.id;
            return (
              <tr key={coffee.id} className={`border-b border-stone-50 hover:bg-stone-50/60 align-top ${!coffee.is_active ? 'opacity-50' : ''}`}>
                <td className="py-2 px-3 text-stone-700">{coffee.name}</td>
                <td className="py-2 px-3 text-xs text-stone-500">{coffee.roaster_name ?? '—'}</td>
                <td className="py-2 px-3 text-xs text-stone-500">
                  {archetypeLabel(coffee.match_archetype)}
                  {coffee.match_confidence && <span className="text-stone-300"> · {coffee.match_confidence}</span>}
                </td>
                <td className="py-2 px-3 text-xs text-stone-500">
                  {home ? `${archetypeLabel(home.placement_archetype)} · ${home.slot_name ?? `slot ${home.sort_order}`}` : 'not placed'}
                </td>
                <td className="py-2 px-3 text-xs text-stone-500">
                  {guests.length === 0 ? '—' : (
                    <button onClick={() => setExpandedGuestsId(guestsExpanded ? null : coffee.id)} className="underline hover:text-stone-800">
                      {guests.length} guest{guests.length === 1 ? '' : 's'}
                    </button>
                  )}
                  {guestsExpanded && guests.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {guests.map(g => (
                        <li key={g.assignment_id}>{archetypeLabel(g.placement_archetype)} · {g.slot_name ?? `slot ${g.sort_order}`}</li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="py-2 px-3 text-xs">
                  {sku12 ? <span className={sku12.is_active ? 'text-green-600' : 'text-stone-400'}>{sku12.is_active ? 'Active' : 'Inactive'}</span> : <span className="text-stone-300">Absent</span>}
                </td>
                <td className="py-2 px-3 text-xs text-stone-500">
                  {home ? sellableSummary(coffee.id, home, slots, notSellable) : 'Not placed'}
                </td>
                <td className="py-2 px-3 text-xs text-stone-500">
                  {coffee.category_codes.length ? coffee.category_codes.join(', ') : '—'}
                </td>
                <td className="py-2 px-3 text-xs">
                  <button onClick={() => setStoryCoffeeId(coffee.id)}
                    className={coffee.story_published ? 'text-green-600 hover:underline' : coffee.story_draft ? 'text-amber-600 hover:underline' : 'text-stone-300 hover:underline'}>
                    {coffee.story_published ? 'Published' : coffee.story_draft ? 'Draft' : 'None'}
                  </button>
                </td>
                <td className="py-2 px-3">
                  <div className="flex flex-wrap gap-1.5 justify-end">
                    <button onClick={() => setEditMetaId(coffee.id)} className="text-xs text-stone-400 hover:text-stone-700">Edit</button>
                    <button onClick={() => setMatchModalId(coffee.id)} className="text-xs text-stone-400 hover:text-stone-700">Set match</button>
                    <button onClick={() => setPlaceModal({ coffeeId: coffee.id, role: home ? 'guest' : 'home' })} className="text-xs text-stone-400 hover:text-stone-700">
                      {home ? 'Add guest' : 'Place'}
                    </button>
                    <button onClick={() => setSkuModalId(coffee.id)} className="text-xs text-stone-400 hover:text-stone-700">SKUs</button>
                    <button onClick={() => handleRetireRestore(coffee)} disabled={isBusy} className="text-xs text-stone-400 hover:text-red-500 disabled:opacity-40">
                      {isBusy ? '…' : coffee.is_active ? 'Retire' : 'Restore'}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {coffees.length === 0 && (
            <tr><td colSpan={10} className="py-8 text-center text-xs text-stone-300">No coffees match these filters.</td></tr>
          )}
        </tbody>
      </table>

      {editMetaId != null && (
        <EditMetadataModal coffee={coffees.find(c => c.id === editMetaId)!} lookups={lookups} refreshLookups={refreshLookups}
          apiFetch={apiFetch} onClose={() => setEditMetaId(null)} onSaved={onReload} />
      )}
      {matchModalId != null && (
        <SetMatchModal coffee={coffees.find(c => c.id === matchModalId)!} archetypes={archetypes}
          apiFetch={apiFetch} onClose={() => setMatchModalId(null)}
          onSaved={(warnings) => { onReload(); const s = warningsSummary(warnings); if (s) setToast(s); }} />
      )}
      {placeModal != null && (
        <PlaceModal coffeeId={placeModal.coffeeId} role={placeModal.role} archetypes={archetypes} slots={slots}
          apiFetch={apiFetch} onClose={() => setPlaceModal(null)}
          onSaved={(warnings) => { onReload(); const s = warningsSummary(warnings); if (s) setToast(s); }} />
      )}
      {skuModalId != null && (
        <ManageSkusModal coffee={coffees.find(c => c.id === skuModalId)!}
          apiFetch={apiFetch} onClose={() => setSkuModalId(null)} onSaved={onReload} />
      )}
      {storyCoffeeId != null && (() => {
        const coffee = coffees.find(c => c.id === storyCoffeeId);
        if (!coffee) return null;
        return <StoryEditorModal coffee={coffee} apiFetch={apiFetch} onClose={() => setStoryCoffeeId(null)} onSaved={onReload} />;
      })()}

      <CategoryAdmin categories={categories} apiFetch={apiFetch} onChanged={onReload} />

      {/* Per-coffee category tags — small strip under the table, same pattern
          as the old page's inline checkboxes, now against the new coffee list. */}
      {coffees.length > 0 && categories.length > 0 && (
        <div className="mt-6 pt-4 border-t border-stone-100">
          <h2 className="text-xs font-normal text-stone-400 uppercase tracking-widest mb-2">Coffee category tags</h2>
          <div className="space-y-1.5">
            {coffees.map(coffee => (
              <div key={coffee.id} className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-stone-600 min-w-[160px]">{coffee.name}</span>
                {categories.map(cat => {
                  const existing = coffeeCategories.find(cc => cc.coffee_id === coffee.id && cc.category_id === cat.id);
                  return (
                    <label key={cat.id} className="flex items-center gap-1 text-stone-500">
                      <input type="checkbox" checked={!!existing}
                        onChange={async () => { await toggleCoffeeCategory(apiFetch, coffee.id, cat.id, existing?.id); await onReload(); }} />
                      {cat.label}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small modal shell ─────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg p-5 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm text-stone-700">{title}</h3>
          <button onClick={onClose} className="text-stone-300 hover:text-stone-600">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EditMetadataModal({ coffee, lookups, refreshLookups, apiFetch, onClose, onSaved }: {
  coffee: Coffee; lookups: Record<string, { value: string; label: string }[]>; refreshLookups: () => void | Promise<void>;
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>; onClose: () => void; onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState({
    name: coffee.name, origin: coffee.origin ?? '', blendOrSingle: coffee.blend_or_single ?? '',
    process: coffee.process ?? '', roastLevel: coffee.roast_level ?? '', roastShade: coffee.roast_shade ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const field = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    setSaving(true); setErr('');
    try {
      const res = await apiFetch(`/api/admin/catalog/coffees/${coffee.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? 'Failed to save');
      await onSaved(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to save'); } finally { setSaving(false); }
  }

  return (
    <Modal title={`Edit — ${coffee.name}`} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-stone-400 mb-1">Name</label>
          <input value={form.name} onChange={e => field('name')(e.target.value)} className="w-full border border-stone-300 rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-stone-400 mb-1">Origin</label>
          <input value={form.origin} onChange={e => field('origin')(e.target.value)} className="w-full border border-stone-300 rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-stone-400 mb-1">Process</label>
          <LookupSelect category="process" value={form.process} onChange={field('process')} lookups={lookups} apiFetch={apiFetch} onAdded={refreshLookups} />
        </div>
        <div>
          <label className="block text-xs text-stone-400 mb-1">Roast level</label>
          <LookupSelect category="roast_level" value={form.roastLevel} onChange={field('roastLevel')} lookups={lookups} apiFetch={apiFetch} onAdded={refreshLookups} />
        </div>
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-sm text-stone-500 px-3 py-1.5">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="text-sm text-white px-4 py-1.5 rounded disabled:opacity-50" style={{ backgroundColor: BRAND }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SetMatchModal({ coffee, archetypes, apiFetch, onClose, onSaved }: {
  coffee: Coffee; archetypes: ReturnType<typeof useArchetypes>['archetypes'];
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>; onClose: () => void;
  onSaved: (warnings: WarningLike[]) => void;
}) {
  const [archetype, setArchetype] = useState(coffee.match_archetype ?? '');
  const [confidence, setConfidence] = useState(coffee.match_confidence ?? 'manual');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSave() {
    if (!archetype) { setErr('Match archetype is required'); return; }
    setSaving(true); setErr('');
    try {
      const res = await apiFetch(`/api/admin/catalog/coffees/${coffee.id}/match`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archetype, confidence, source: 'manual' }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? 'Failed to save');
      onSaved(body.warnings ?? []); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to save'); } finally { setSaving(false); }
  }

  return (
    <Modal title={`Set match — ${coffee.name}`} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-stone-400 mb-1">Archetype</label>
          <select value={archetype} onChange={e => setArchetype(e.target.value)} className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
            <option value="">— select —</option>
            {archetypes.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-stone-400 mb-1">Confidence</label>
          <select value={confidence} onChange={e => setConfidence(e.target.value)} className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
        </div>
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-sm text-stone-500 px-3 py-1.5">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="text-sm text-white px-4 py-1.5 rounded disabled:opacity-50" style={{ backgroundColor: BRAND }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// D6 — preview then confirm, note required on an out-of-spec placement.
function PlaceModal({ coffeeId, role, archetypes, slots, apiFetch, onClose, onSaved }: {
  coffeeId: number; role: 'home' | 'guest'; archetypes: ReturnType<typeof useArchetypes>['archetypes']; slots: Slot[];
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>; onClose: () => void;
  onSaved: (warnings: WarningLike[]) => void;
}) {
  const [archetype, setArchetype] = useState('');
  const [slotId, setSlotId] = useState('');
  const [preview, setPreview] = useState<{ warnings: WarningLike[] } | null>(null);
  const [note, setNote] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const archetypeSlots = slots.filter(s => s.archetype === archetype);
  const blocking = (preview?.warnings ?? []).some(w => w.kind === 'band_out_of_spec' || w.kind === 'descriptor_off_family');

  async function handlePreview() {
    if (!slotId) { setErr('Pick a slot first'); return; }
    setPreviewing(true); setErr('');
    try {
      const res = await apiFetch(`/api/admin/catalog/placement-preview?coffeeId=${coffeeId}&slotId=${slotId}&role=${role}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? 'Preview failed');
      setPreview(body);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Preview failed'); } finally { setPreviewing(false); }
  }

  async function handleConfirm() {
    if (blocking && !note.trim()) { setErr('A placement note is required for this warning'); return; }
    setSaving(true); setErr('');
    try {
      const res = await apiFetch(`/api/admin/catalog/coffees/${coffeeId}/placements`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: Number(slotId), role, placementNote: note || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? 'Failed to place');
      onSaved(body.warnings ?? []); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to place'); } finally { setSaving(false); }
  }

  return (
    <Modal title={role === 'home' ? 'Place a coffee — home slot' : 'Add guest'} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-stone-400 mb-1">Archetype</label>
          <select value={archetype} onChange={e => { setArchetype(e.target.value); setSlotId(''); setPreview(null); }} className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
            <option value="">— select —</option>
            {archetypes.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
          </select>
        </div>
        {archetype && (
          <div>
            <label className="block text-xs text-stone-400 mb-1">Slot</label>
            <select value={slotId} onChange={e => { setSlotId(e.target.value); setPreview(null); }} className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
              <option value="">— select —</option>
              {archetypeSlots.map(s => (
                <option key={s.id} value={s.id}>
                  {s.sort_order} · {s.name ?? s.position_label} ({s.occupants.length} occupant{s.occupants.length === 1 ? '' : 's'})
                </option>
              ))}
            </select>
          </div>
        )}
        {slotId && !preview && (
          <button onClick={handlePreview} disabled={previewing} className="text-sm text-stone-600 border border-stone-300 rounded px-3 py-1.5 disabled:opacity-50">
            {previewing ? 'Checking…' : 'Preview placement'}
          </button>
        )}
        {preview && (
          <div className="text-xs text-stone-500 border border-stone-100 rounded p-2 bg-stone-50">
            {preview.warnings.length === 0 ? 'No warnings.' : preview.warnings.map((w, i) => <div key={i}>⚠ {w.kind}</div>)}
          </div>
        )}
        {preview && blocking && (
          <div>
            <label className="block text-xs text-stone-400 mb-1">Placement note (required)</label>
            <input value={note} onChange={e => setNote(e.target.value)} className="w-full border border-stone-300 rounded px-3 py-2 text-sm" />
          </div>
        )}
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-sm text-stone-500 px-3 py-1.5">Cancel</button>
          <button onClick={handleConfirm} disabled={saving || !preview} className="text-sm text-white px-4 py-1.5 rounded disabled:opacity-50" style={{ backgroundColor: BRAND }}>
            {saving ? 'Placing…' : 'Confirm'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ManageSkusModal({ coffee, apiFetch, onClose, onSaved }: {
  coffee: Coffee; apiFetch: (url: string, options?: RequestInit) => Promise<Response>; onClose: () => void; onSaved: () => void | Promise<void>;
}) {
  const [weightOz, setWeightOz] = useState('12');
  const [roasterSku, setRoasterSku] = useState('');
  const [shopifyVariantId, setShopifyVariantId] = useState('');
  const [quantityAvailable, setQuantityAvailable] = useState('0');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleAdd() {
    setSaving(true); setErr('');
    try {
      const res = await apiFetch(`/api/admin/catalog/coffees/${coffee.id}/skus`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weightOz: Number(weightOz), roasterSku: roasterSku || undefined, shopifyVariantId: shopifyVariantId || undefined,
          quantityAvailable: Number(quantityAvailable) || 0,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? 'Failed to save SKU');
      setRoasterSku(''); setShopifyVariantId(''); await onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to save SKU'); } finally { setSaving(false); }
  }

  return (
    <Modal title={`Manage SKUs — ${coffee.name}`} onClose={onClose}>
      <div className="space-y-3">
        {coffee.skus.length > 0 && (
          <table className="w-full text-xs mb-3">
            <thead><tr className="text-stone-300 uppercase"><th className="text-left py-1">Weight</th><th className="text-left py-1">SKU</th><th className="text-left py-1">Qty</th><th className="text-left py-1">Status</th></tr></thead>
            <tbody>
              {coffee.skus.map(s => (
                <tr key={s.id} className="border-t border-stone-50">
                  <td className="py-1">{s.weight_oz} oz</td>
                  <td className="py-1 font-mono">{s.roaster_sku ?? '—'}</td>
                  <td className="py-1">{s.quantity_available}</td>
                  <td className="py-1">{s.is_active ? s.inventory_status : 'inactive'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-stone-400 mb-1">Weight (oz)</label>
            <select value={weightOz} onChange={e => setWeightOz(e.target.value)} className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
              <option value="12">12</option><option value="80">80 (5 lb)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">Quantity</label>
            <input type="number" value={quantityAvailable} onChange={e => setQuantityAvailable(e.target.value)} className="w-full border border-stone-300 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">Roaster SKU</label>
            <input value={roasterSku} onChange={e => setRoasterSku(e.target.value)} className="w-full border border-stone-300 rounded px-3 py-2 text-sm font-mono" />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">Shopify Variant ID</label>
            <input value={shopifyVariantId} onChange={e => setShopifyVariantId(e.target.value)} className="w-full border border-stone-300 rounded px-3 py-2 text-sm font-mono" />
          </div>
        </div>
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-sm text-stone-500 px-3 py-1.5">Close</button>
          <button onClick={handleAdd} disabled={saving} className="text-sm text-white px-4 py-1.5 rounded disabled:opacity-50" style={{ backgroundColor: BRAND }}>
            {saving ? 'Saving…' : 'Save SKU'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── B2: Place a coffee (the door) ─────────────────────────────────────────────

function PlaceACoffee(props: {
  roasters: Roaster[]; archetypes: ReturnType<typeof useArchetypes>['archetypes']; slots: Slot[];
  categories: CategoryOption[]; lookups: Record<string, { value: string; label: string }[]>; refreshLookups: () => void | Promise<void>;
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>; onPlaced: () => void;
}) {
  const { roasters, archetypes, slots, lookups, refreshLookups, apiFetch, onPlaced } = props;

  const [step, setStep] = useState(1);
  const [roasterName, setRoasterName] = useState('');
  const [coffeeForm, setCoffeeForm] = useState({ name: '', origin: '', process: '', roastLevel: '' });
  const [archetype, setArchetype] = useState('');
  const [confidence, setConfidence] = useState('manual');
  const [homeSlot, setHomeSlot] = useState('');
  const [homeWeightOz, setHomeWeightOz] = useState('12');
  const [homeSku, setHomeSku] = useState({ roasterSku: '', costToUs: '' });
  const [guestSlots, setGuestSlots] = useState<string[]>([]);

  const [preview, setPreview] = useState<{ warnings: WarningLike[] } | null>(null);
  const [placementNote, setPlacementNote] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [report, setReport] = useState<{ coffees: Array<{ name: string; status: string; coffeeId?: number; warnings: WarningLike[]; errors: string[] }> } | null>(null);

  const archetypeSlots = slots.filter(s => s.archetype === archetype);
  const blocking = (preview?.warnings ?? []).some(w => w.kind === 'band_out_of_spec' || w.kind === 'descriptor_off_family');

  function buildManifest(dryRun: boolean) {
    return {
      roaster: { name: roasterName },
      coffees: [{
        name: coffeeForm.name, origin: coffeeForm.origin || undefined,
        process: coffeeForm.process || undefined, roastLevel: coffeeForm.roastLevel || undefined,
        match: { archetype, confidence, source: 'manual' as const },
        home: homeSlot ? { slot: homeSlot, placementNote: placementNote || undefined } : undefined,
        guests: guestSlots.filter(Boolean).map(slot => ({ slot })),
        skus: homeSlot ? [{ weightOz: Number(homeWeightOz), roasterSku: homeSku.roasterSku || undefined, costToUs: homeSku.costToUs ? Number(homeSku.costToUs) : undefined }] : undefined,
      }],
    };
    void dryRun;
  }

  async function handlePreview() {
    if (!homeSlot) { setErr('Pick a home slot to preview'); return; }
    setPreviewing(true); setErr('');
    try {
      // previewPlacement needs a real coffeeId, which doesn't exist until
      // import runs — the importer itself computes/returns warnings per
      // coffee (ImportCoffeeReport.warnings), so "preview" here is a dry-run
      // import instead of GET /catalog/placement-preview.
      const res = await apiFetch('/api/admin/catalog/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildManifest(true)),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? 'Preview failed');
      const coffeeReport = body.coffees?.[0];
      if (coffeeReport?.status === 'error') throw new Error(coffeeReport.errors?.join(', ') ?? 'Preview failed');
      setPreview({ warnings: coffeeReport?.warnings ?? [] });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Preview failed'); } finally { setPreviewing(false); }
  }

  async function handleConfirm() {
    if (blocking && !placementNote.trim()) { setErr('A placement note is required for this warning'); return; }
    setSubmitting(true); setErr('');
    try {
      const res = await apiFetch('/api/admin/catalog/import?apply=true', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildManifest(false)),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? 'Import failed');
      setReport(body);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Import failed'); } finally { setSubmitting(false); }
  }

  if (report) {
    const coffeeReport = report.coffees[0];
    return (
      <div className="max-w-xl">
        <h2 className="text-sm text-stone-700 mb-2">
          {coffeeReport.status === 'created' ? 'Placed.' : coffeeReport.status === 'skipped' ? 'Already exists — skipped.' : 'Failed.'}
        </h2>
        {coffeeReport.warnings.length > 0 && (
          <p className="text-xs text-amber-600 mb-2">Warnings: {coffeeReport.warnings.map(w => w.kind).join(', ')}</p>
        )}
        {coffeeReport.errors.length > 0 && <p className="text-xs text-red-500 mb-2">{coffeeReport.errors.join(', ')}</p>}
        <button onClick={onPlaced} className="text-sm text-white px-4 py-1.5 rounded" style={{ backgroundColor: BRAND }}>
          Back to Coffees
        </button>
      </div>
    );
  }

  const steps = ['Roastery & metadata', 'Match', 'Home slot', '12oz SKU', 'Guests', 'Preview', 'Confirm'];

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 mb-4 text-xs text-stone-400">
        {steps.map((s, i) => (
          <span key={s} className={i + 1 === step ? 'text-stone-800 font-medium' : ''}>{i + 1}. {s}{i < steps.length - 1 ? ' →' : ''}</span>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-stone-400 mb-1">Roastery *</label>
            <select value={roasterName} onChange={e => setRoasterName(e.target.value)} className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
              <option value="">— select an active roastery —</option>
              {roasters.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">Coffee name *</label>
            <input value={coffeeForm.name} onChange={e => setCoffeeForm(f => ({ ...f, name: e.target.value }))} className="w-full border border-stone-300 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">Origin</label>
            <input value={coffeeForm.origin} onChange={e => setCoffeeForm(f => ({ ...f, origin: e.target.value }))} className="w-full border border-stone-300 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">Process</label>
            <LookupSelect category="process" value={coffeeForm.process} onChange={v => setCoffeeForm(f => ({ ...f, process: v }))} lookups={lookups} apiFetch={apiFetch} onAdded={refreshLookups} />
          </div>
          <div className="flex justify-end">
            <button onClick={() => setStep(2)} disabled={!roasterName || !coffeeForm.name} className="text-sm text-white px-4 py-1.5 rounded disabled:opacity-50" style={{ backgroundColor: BRAND }}>Next</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-stone-400 mb-1">Match archetype *</label>
            <select value={archetype} onChange={e => { setArchetype(e.target.value); setHomeSlot(''); }} className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
              <option value="">— select —</option>
              {archetypes.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">Confidence</label>
            <select value={confidence} onChange={e => setConfidence(e.target.value)} className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </div>
          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="text-sm text-stone-500 px-3 py-1.5">Back</button>
            <button onClick={() => setStep(3)} disabled={!archetype} className="text-sm text-white px-4 py-1.5 rounded disabled:opacity-50" style={{ backgroundColor: BRAND }}>Next</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <p className="text-xs text-stone-400">Every slot for {archetypes.find(a => a.code === archetype)?.label ?? archetype}:</p>
          <div className="grid grid-cols-2 gap-2">
            {archetypeSlots.map(s => (
              <button key={s.id} onClick={() => setHomeSlot(`${archetype}/${s.sort_order}`)}
                className={`text-left border rounded p-3 text-xs ${homeSlot === `${archetype}/${s.sort_order}` ? 'border-stone-800' : 'border-stone-200'}`}>
                <div className="text-stone-700">{s.sort_order} · {s.name ?? s.position_label}</div>
                <div className="text-stone-400 mt-1">{s.occupants.length} current occupant{s.occupants.length === 1 ? '' : 's'} · {s.sellable_12oz ? 'sellable now' : 'not sellable'}</div>
                {(s.spec_band_lo != null || s.spec_band_hi != null) && <div className="text-stone-300 mt-0.5">spec: {s.spec_band_lo ?? '–'} to {s.spec_band_hi ?? '–'}</div>}
              </button>
            ))}
          </div>
          <div className="flex justify-between">
            <button onClick={() => setStep(2)} className="text-sm text-stone-500 px-3 py-1.5">Back</button>
            <button onClick={() => setStep(4)} disabled={!homeSlot} className="text-sm text-white px-4 py-1.5 rounded disabled:opacity-50" style={{ backgroundColor: BRAND }}>Next</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-stone-400 mb-1">Weight (oz)</label>
              <select value={homeWeightOz} onChange={e => setHomeWeightOz(e.target.value)} className="w-full border border-stone-300 rounded px-3 py-2 text-sm">
                <option value="12">12</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">Roaster SKU</label>
              <input value={homeSku.roasterSku} onChange={e => setHomeSku(f => ({ ...f, roasterSku: e.target.value }))} className="w-full border border-stone-300 rounded px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">Cost to us ($)</label>
              <input type="number" step="0.01" value={homeSku.costToUs} onChange={e => setHomeSku(f => ({ ...f, costToUs: e.target.value }))} className="w-full border border-stone-300 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex justify-between">
            <button onClick={() => setStep(3)} className="text-sm text-stone-500 px-3 py-1.5">Back</button>
            <button onClick={() => setStep(5)} className="text-sm text-white px-4 py-1.5 rounded" style={{ backgroundColor: BRAND }}>Next</button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-3">
          <p className="text-xs text-stone-400">Optional — other archetype/slot combinations this coffee also fulfils as a guest.</p>
          {guestSlots.map((g, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={g} onChange={e => setGuestSlots(gs => gs.map((x, j) => j === i ? e.target.value : x))}
                placeholder="e.g. fruity/2" className="border border-stone-300 rounded px-3 py-1.5 text-sm flex-1" />
              <button onClick={() => setGuestSlots(gs => gs.filter((_, j) => j !== i))} className="text-xs text-stone-400 hover:text-red-500">Remove</button>
            </div>
          ))}
          <button onClick={() => setGuestSlots(gs => [...gs, ''])} className="text-xs text-stone-500 border border-dashed border-stone-300 rounded px-3 py-1.5">+ Add guest slot</button>
          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(4)} className="text-sm text-stone-500 px-3 py-1.5">Back</button>
            <button onClick={() => { setStep(6); handlePreview(); }} className="text-sm text-white px-4 py-1.5 rounded" style={{ backgroundColor: BRAND }}>Preview</button>
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="space-y-3">
          {previewing && <p className="text-sm text-stone-400">Checking placement…</p>}
          {preview && (
            <div className="text-sm text-stone-600 border border-stone-100 rounded p-3 bg-stone-50">
              <p className="mb-1">Placing "{coffeeForm.name}" at {homeSlot}, on {roasterName}.</p>
              {preview.warnings.length === 0 ? (
                <p className="text-stone-400">No warnings — this dry-run created no rows.</p>
              ) : (
                <ul className="list-disc list-inside text-amber-600">
                  {preview.warnings.map((w, i) => <li key={i}>{w.kind}</li>)}
                </ul>
              )}
            </div>
          )}
          {blocking && (
            <div>
              <label className="block text-xs text-stone-400 mb-1">Placement note (required)</label>
              <input value={placementNote} onChange={e => setPlacementNote(e.target.value)} className="w-full border border-stone-300 rounded px-3 py-2 text-sm" />
            </div>
          )}
          {err && <p className="text-xs text-red-500">{err}</p>}
          <div className="flex justify-between">
            <button onClick={() => setStep(5)} className="text-sm text-stone-500 px-3 py-1.5">Back</button>
            <button onClick={handleConfirm} disabled={submitting || previewing || !preview} className="text-sm text-white px-4 py-1.5 rounded disabled:opacity-50" style={{ backgroundColor: BRAND }}>
              {submitting ? 'Placing…' : 'Confirm & place'}
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-stone-300 mt-8">
        Bulk import: use the CLI (<code>npm run catalog:import</code>) with a manifest JSON for more than one coffee at a time.
      </p>
    </div>
  );
}

// ── B3: Slots & pricing ────────────────────────────────────────────────────────

function SlotsAndPricing({ slots, archetypes, apiFetch, onReload }: {
  slots: Slot[]; archetypes: ReturnType<typeof useArchetypes>['archetypes'];
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>; onReload: () => void | Promise<void>;
}) {
  const [activeArchetype, setActiveArchetype] = useState(archetypes[0]?.code ?? '');
  useEffect(() => { if (!activeArchetype && archetypes.length) setActiveArchetype(archetypes[0].code); }, [archetypes, activeArchetype]);

  const [descriptorFamiliesDraft, setDescriptorFamiliesDraft] = useState('');
  const [savingFamilies, setSavingFamilies] = useState(false);

  const archetypeRow = archetypes.find(a => a.code === activeArchetype);
  const archetypeSlots = slots.filter(s => s.archetype === activeArchetype).sort((a, b) => a.sort_order - b.sort_order);

  useEffect(() => { setDescriptorFamiliesDraft((archetypeRow?.descriptor_families ?? []).join(', ')); }, [archetypeRow]);

  async function handleSaveFamilies() {
    setSavingFamilies(true);
    try {
      const families = descriptorFamiliesDraft.split(',').map(s => s.trim()).filter(Boolean);
      const res = await apiFetch(`/api/admin/catalog/archetypes/${activeArchetype}/descriptor-families`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ families }),
      });
      if (!res.ok) { const body = await res.json().catch(() => ({})); alert(body.message ?? 'Failed to save families'); return; }
      await onReload();
    } catch (err) { reportError('[SlotsAndPricing/save-families]', err); } finally { setSavingFamilies(false); }
  }

  async function handleSetLandingDefault(slotId: number) {
    try {
      const res = await apiFetch(`/api/admin/catalog/slots/${slotId}/landing-default`, { method: 'POST' });
      if (!res.ok) { const body = await res.json().catch(() => ({})); alert(body.message ?? 'Failed'); return; }
      await onReload();
    } catch (err) { reportError('[SlotsAndPricing/landing-default]', err); }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {archetypes.map(a => (
          <button key={a.code} onClick={() => setActiveArchetype(a.code)}
            className={`px-3 py-1 rounded-full text-xs border ${activeArchetype === a.code ? 'border-stone-800 text-stone-800' : 'border-stone-200 text-stone-500'}`}>
            {a.label}
          </button>
        ))}
      </div>

      {archetypeRow && (
        <div className="mb-4 flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-xs text-stone-400 mb-1">Descriptor families (comma-separated, from the SCA wheel)</label>
            <input value={descriptorFamiliesDraft} onChange={e => setDescriptorFamiliesDraft(e.target.value)} className="w-full border border-stone-300 rounded px-3 py-1.5 text-sm" />
          </div>
          <button onClick={handleSaveFamilies} disabled={savingFamilies} className="text-sm text-white px-3 py-1.5 rounded disabled:opacity-50 shrink-0" style={{ backgroundColor: BRAND }}>
            {savingFamilies ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {archetypeSlots.map(slot => (
          <SlotCard key={slot.id} slot={slot} apiFetch={apiFetch} onReload={onReload} onSetDefault={() => handleSetLandingDefault(slot.id)} />
        ))}
      </div>
    </div>
  );
}

function SlotCard({ slot, apiFetch, onReload, onSetDefault }: {
  slot: Slot; apiFetch: (url: string, options?: RequestInit) => Promise<Response>; onReload: () => void | Promise<void>;
  onSetDefault: () => void;
}) {
  const [nameDraft, setNameDraft] = useState(slot.name ?? '');
  const [editingName, setEditingName] = useState(false);
  const [price12, setPrice12] = useState(String((slot.prices.find(p => Number(p.weight_oz) === 12)?.retail_price_cents ?? 0) / 100));
  const [price80, setPrice80] = useState(String((slot.prices.find(p => Number(p.weight_oz) === 80)?.retail_price_cents ?? 0) / 100));
  const [savingPrice, setSavingPrice] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [certifyBy, setCertifyBy] = useState<{ coffeeId: number } | null>(null);
  const [certifyName, setCertifyName] = useState('');

  async function handleSaveName() {
    setSavingName(true);
    try {
      const res = await apiFetch(`/api/admin/catalog/slots/${slot.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameDraft }),
      });
      if (!res.ok) { const body = await res.json().catch(() => ({})); alert(body.message ?? 'Failed'); return; }
      setEditingName(false); await onReload();
    } catch (err) { reportError('[SlotCard/save-name]', err); } finally { setSavingName(false); }
  }

  async function handleSavePrice(weightOz: 12 | 80, value: string) {
    setSavingPrice(true);
    try {
      const cents = Math.round(Number(value) * 100);
      const res = await apiFetch(`/api/admin/catalog/slots/${slot.id}/prices`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weightOz, retailPriceCents: cents }),
      });
      if (!res.ok) { const body = await res.json().catch(() => ({})); alert(body.message ?? 'Failed'); return; }
      await onReload();
    } catch (err) { reportError('[SlotCard/save-price]', err); } finally { setSavingPrice(false); }
  }

  async function handleReorder(coffeeId: number, direction: -1 | 1) {
    const ordered = [...slot.occupants].sort((a, b) => a.priority - b.priority).map(o => o.coffee_id);
    const idx = ordered.indexOf(coffeeId);
    const swapWith = idx + direction;
    if (swapWith < 0 || swapWith >= ordered.length) return;
    [ordered[idx], ordered[swapWith]] = [ordered[swapWith], ordered[idx]];
    try {
      const res = await apiFetch(`/api/admin/catalog/slots/${slot.id}/priorities`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ordered }),
      });
      if (!res.ok) { const body = await res.json().catch(() => ({})); alert(body.message ?? 'Failed'); return; }
      await onReload();
    } catch (err) { reportError('[SlotCard/reorder]', err); }
  }

  async function handleCertify() {
    if (!certifyBy || !certifyName.trim()) return;
    try {
      const res = await apiFetch(`/api/admin/catalog/coffees/${certifyBy.coffeeId}/placements/${slot.id}/certify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ by: certifyName.trim() }),
      });
      if (!res.ok) { const body = await res.json().catch(() => ({})); alert(body.message ?? 'Failed'); return; }
      setCertifyBy(null); setCertifyName(''); await onReload();
    } catch (err) { reportError('[SlotCard/certify]', err); }
  }

  const occupantsSorted = [...slot.occupants].sort((a, b) => (a.role === b.role ? a.priority - b.priority : a.role === 'home' ? -1 : 1));

  return (
    <div className="border border-stone-100 rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        {editingName ? (
          <div className="flex items-center gap-1.5 flex-1">
            <input value={nameDraft} onChange={e => setNameDraft(e.target.value)} className="border border-stone-300 rounded px-2 py-1 text-sm flex-1" />
            <button onClick={handleSaveName} disabled={savingName} className="text-xs text-white px-2 py-1 rounded" style={{ backgroundColor: BRAND }}>Save</button>
          </div>
        ) : (
          <button onClick={() => setEditingName(true)} className="text-sm text-stone-700 hover:underline text-left">
            {slot.sort_order} · {slot.name ?? slot.position_label}
          </button>
        )}
        <button onClick={onSetDefault} className={slot.is_landing_default ? 'text-amber-500' : 'text-stone-200 hover:text-amber-400'} title="Landing default">★</button>
      </div>
      <p className="text-xs text-stone-400 mb-2">{slot.position_label}</p>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="block text-[10px] text-stone-400">12oz price ($)</label>
          <div className="flex gap-1">
            <input type="number" step="0.01" value={price12} onChange={e => setPrice12(e.target.value)} className="border border-stone-300 rounded px-2 py-1 text-xs w-full" />
            <button onClick={() => handleSavePrice(12, price12)} disabled={savingPrice} className="text-[10px] text-stone-500 border border-stone-200 rounded px-1.5">Save</button>
          </div>
        </div>
        <div>
          <label className="block text-[10px] text-stone-400">5lb price ($)</label>
          <div className="flex gap-1">
            <input type="number" step="0.01" value={price80} onChange={e => setPrice80(e.target.value)} className="border border-stone-300 rounded px-2 py-1 text-xs w-full" />
            <button onClick={() => handleSavePrice(80, price80)} disabled={savingPrice} className="text-[10px] text-stone-500 border border-stone-200 rounded px-1.5">Save</button>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        {occupantsSorted.map((o, i) => (
          <div key={o.coffee_id} className="flex items-center gap-1.5 text-xs">
            {o.role === 'home' ? <span className="text-stone-300">home</span> : (
              <>
                <button onClick={() => handleReorder(o.coffee_id, -1)} disabled={i === 0} className="text-stone-200 hover:text-stone-500 disabled:opacity-0">↑</button>
                <button onClick={() => handleReorder(o.coffee_id, 1)} disabled={i === occupantsSorted.length - 1} className="text-stone-200 hover:text-stone-500 disabled:opacity-0">↓</button>
              </>
            )}
            <span className="text-stone-600">{o.coffee_name}</span>
            <span className="text-stone-300">{o.roaster_name}</span>
            {o.certified_at ? <span className="text-green-500" title={`Certified ${new Date(o.certified_at).toLocaleDateString()}`}>✓</span> : (
              certifyBy?.coffeeId === o.coffee_id ? (
                <span className="flex items-center gap-1">
                  <input value={certifyName} onChange={e => setCertifyName(e.target.value)} placeholder="Your name" className="border border-stone-300 rounded px-1 py-0.5 text-[10px] w-20" />
                  <button onClick={handleCertify} className="text-[10px] text-stone-500">Save</button>
                </span>
              ) : (
                <button onClick={() => setCertifyBy({ coffeeId: o.coffee_id })} className="text-stone-300 hover:text-stone-600">certify</button>
              )
            )}
          </div>
        ))}
        {occupantsSorted.length === 0 && <p className="text-xs text-stone-300">Open.</p>}
      </div>
      <p className="text-[10px] text-stone-300 mt-2">{slot.sellable_12oz ? 'Sellable at 12oz' : 'Not sellable at 12oz'}</p>
    </div>
  );
}
