import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';

// ── Types ─────────────────────────────────────────────────────────────────────

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
  // Roastery lifecycle (2026-08-25)
  coffee_is_active?: boolean;
  coffee_deactivation_reason?: string | null;
}

interface Blend {
  id: string;
  blend_name: string;
  coffee_id: number | null;
  coffee_name: string | null;
  roaster: string | null;
  weight_oz: number;
  roaster_sku: string | null;
  shopify_variant_id: string | null;
  is_active: boolean;
  // Roastery lifecycle (2026-08-25)
  deactivation_reason?: string | null;
  coffee_is_active?: boolean;
  coffee_deactivation_reason?: string | null;
}

interface CoffeeLookup { id: number; name: string; roaster: string | null; is_active?: boolean; }

// ── Constants ─────────────────────────────────────────────────────────────────

const ARCHETYPES = [
  { value: 'chocolate_nutty', label: 'Chocolate & Nutty' },
  { value: 'balanced_sweet',  label: 'Balanced & Sweet'  },
  { value: 'fruity',          label: 'Fruity'            },
  { value: 'earthy',          label: 'Earthy'            },
  { value: 'floral',          label: 'Floral'            },
  { value: 'experimental',    label: 'Experimental'      },
];

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminInventory() {
  const { user } = useAuth();

  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [blends, setBlends]   = useState<Blend[]>([]);
  const [coffees, setCoffees] = useState<CoffeeLookup[]>([]);
  const [error, setError]     = useState('');

  // blend editing
  const [editBlendId, setEditBlendId]     = useState<string | null>(null);
  const [editSku, setEditSku]             = useState('');
  const [editShopify, setEditShopify]     = useState('');
  const [editCoffee, setEditCoffee]       = useState('');
  const [editSaving, setEditSaving]       = useState(false);
  const [editErr, setEditErr]             = useState('');
  const [togglingId, setTogglingId]       = useState<string | null>(null);
  // Roastery lifecycle (2026-08-25) — "Show inactive" toggle, component state
  // only, same pattern as every other admin list this task touches.
  const [showInactive, setShowInactive]   = useState(false);

  async function apiFetch(url: string, options: RequestInit = {}) {
    const token = await user!.getIdToken();
    return fetch(url, {
      cache: 'no-store', ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    });
  }

  async function load() {
    try {
      const qs = showInactive ? '?include_inactive=true' : '';
      const [aRes, bRes, cRes] = await Promise.all([
        apiFetch(`/api/admin/coffee-alias${qs}`),
        apiFetch(`/api/admin/inventory${qs}`),
        apiFetch(`/api/admin/inventory/coffees-lookup${qs}`),
      ]);
      setAliases(await aRes.json());
      setBlends(await bRes.json());
      setCoffees(await cRes.json());
    } catch (err) { reportError('[AdminInventory/load]', err); setError('Failed to load data'); }
  }

  useEffect(() => { if (user) load(); }, [user, showInactive]);

  // ── Derived data ─────────────────────────────────────────────────────────────

  // blend lookup by coffee_id
  const blendsByCoffee = new Map<number, Blend[]>();
  for (const b of blends) {
    if (b.coffee_id == null) continue;
    const arr = blendsByCoffee.get(b.coffee_id) ?? [];
    arr.push(b);
    blendsByCoffee.set(b.coffee_id, arr);
  }

  // coffee_ids that appear in at least one active alias
  const aliasedCoffeeIds = new Set(aliases.map(a => a.coffee_id));

  // matrix: archetype → sortOrder → { platform_name, entries[] }
  type Entry = { aliasRow: AliasRow; blends: Blend[] };
  type Position = { sort: number; platform_name: string; entries: Entry[] };
  const matrix = new Map<string, Map<number, Position>>();

  for (const a of aliases) {
    if (!a.archetype || a.dial_sort_order == null) continue;
    if (!matrix.has(a.archetype)) matrix.set(a.archetype, new Map());
    const posMap = matrix.get(a.archetype)!;
    if (!posMap.has(a.dial_sort_order)) {
      posMap.set(a.dial_sort_order, { sort: a.dial_sort_order, platform_name: a.platform_name, entries: [] });
    }
    posMap.get(a.dial_sort_order)!.entries.push({
      aliasRow: a,
      blends: (blendsByCoffee.get(a.coffee_id) ?? []).sort((x, y) => x.weight_oz - y.weight_oz),
    });
  }

  // Sort entries within each position by priority
  for (const posMap of matrix.values()) {
    for (const pos of posMap.values()) {
      pos.entries.sort((a, b) => a.aliasRow.priority - b.aliasRow.priority);
    }
  }

  // Unaliased: blends whose coffee is not in any alias (or has no coffee_id)
  const unaliasedBlends = blends.filter(
    b => b.coffee_id == null || !aliasedCoffeeIds.has(b.coffee_id)
  );

  // ── Handlers ─────────────────────────────────────────────────────────────────

  async function handleToggle(b: Blend) {
    setTogglingId(b.id);
    try {
      const res = await apiFetch(`/api/admin/inventory/${b.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !b.is_active }),
      });
      // Fake-success fix (Observability Foundation Part D) — apiFetch never
      // checks res.ok itself, so a failed PATCH used to fall straight
      // through to load() with no error shown, same gap as AdminCoffees.tsx.
      if (!res.ok) { const body = await res.json().catch(() => ({})); alert(body.error ?? 'Failed to update blend'); return; }
      await load();
    } catch (err) { reportError('[AdminInventory/toggle]', err); } finally { setTogglingId(null); }
  }

  async function handleEditSave(blendId: string, coffeeId: number | null) {
    setEditSaving(true); setEditErr('');
    try {
      const body: Record<string, unknown> = {
        roaster_sku:        editSku || null,
        shopify_variant_id: editShopify || null,
      };
      if (editCoffee && coffeeId == null) body.coffee_id = Number(editCoffee);
      const res = await apiFetch(`/api/admin/inventory/${blendId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      setEditBlendId(null); await load();
    } catch (err: unknown) {
      reportError('[AdminInventory/save-edit]', err);
      setEditErr(err instanceof Error ? err.message : 'Failed');
    } finally { setEditSaving(false); }
  }

  function openEdit(b: Blend) {
    setEditBlendId(b.id);
    setEditSku(b.roaster_sku ?? '');
    setEditShopify(b.shopify_variant_id ?? '');
    setEditCoffee('');
    setEditErr('');
  }

  // ── Sub-components ────────────────────────────────────────────────────────────

  function BlendRow({ b, unlinked = false }: { b: Blend; unlinked?: boolean }) {
    const isEditing  = editBlendId === b.id;
    const isToggling = togglingId === b.id;
    // Roastery lifecycle (2026-08-25) — a blend whose coffee's roastery went
    // inactive comes back only via Reactivate on the Roasteries page, not
    // this row's own toggle.
    const coffeeInactive = b.coffee_is_active === false;
    return (
      <>
        <tr className={`border-b border-stone-50 hover:bg-stone-50/60 ${coffeeInactive ? 'opacity-50' : ''}`}>
          <td className="py-2 pl-10 pr-3 text-stone-500 text-xs">{b.weight_oz} oz</td>
          <td className="py-2 px-3 text-stone-400 text-xs font-mono">{b.roaster_sku ?? <span className="text-stone-200">—</span>}</td>
          <td className="py-2 px-3 text-stone-400 text-xs font-mono">{b.shopify_variant_id ?? <span className="text-stone-200">—</span>}</td>
          <td className="py-2 px-3">
            {coffeeInactive ? (
              <span className="px-2 py-0.5 rounded text-xs bg-stone-100 text-stone-400 border border-stone-200">
                Inactive · {b.roaster}
              </span>
            ) : (
              <button
                onClick={() => handleToggle(b)}
                disabled={isToggling}
                className={`px-2 py-0.5 rounded border text-xs transition-colors disabled:opacity-40 ${
                  b.is_active
                    ? 'bg-green-50 text-green-700 border-green-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200'
                    : 'bg-stone-100 text-stone-400 border-stone-200 hover:bg-green-50 hover:text-green-700 hover:border-green-200'
                }`}
              >
                {isToggling ? '…' : b.is_active ? 'Active' : 'Inactive'}
              </button>
            )}
          </td>
          <td className="py-2 px-3">
            <button
              onClick={() => isEditing ? setEditBlendId(null) : openEdit(b)}
              disabled={coffeeInactive}
              className="text-xs px-2 py-0.5 rounded border border-stone-200 text-stone-400 hover:text-stone-700 hover:border-stone-300 disabled:opacity-40 disabled:hover:text-stone-400 disabled:hover:border-stone-200"
            >
              {isEditing ? 'Cancel' : 'Edit'}
            </button>
          </td>
        </tr>
        {isEditing && (
          <tr className="border-b border-stone-100 bg-stone-50">
            <td colSpan={5} className="px-4 py-3">
              <div className="flex flex-wrap items-end gap-3">
                {unlinked && (
                  <div>
                    <label className="block text-xs text-stone-400 mb-1">Link to Coffee</label>
                    <select value={editCoffee} onChange={e => setEditCoffee(e.target.value)}
                      className="border border-stone-300 rounded px-3 py-1.5 text-sm min-w-[200px]">
                      <option value="">— unlinked —</option>
                      {coffees.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name}{c.roaster ? ` (${c.roaster})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-xs text-stone-400 mb-1">Roaster SKU</label>
                  <input value={editSku} onChange={e => setEditSku(e.target.value)}
                    className="border border-stone-300 rounded px-3 py-1.5 text-sm w-36 font-mono"
                    placeholder="e.g. PATH-COL-12" />
                </div>
                <div>
                  <label className="block text-xs text-stone-400 mb-1">Shopify Variant ID</label>
                  <input value={editShopify} onChange={e => setEditShopify(e.target.value)}
                    className="border border-stone-300 rounded px-3 py-1.5 text-sm w-44 font-mono"
                    placeholder="e.g. 45678901234" />
                </div>
                <div className="flex gap-2 pb-0.5">
                  <button onClick={() => handleEditSave(b.id, b.coffee_id)} disabled={editSaving}
                    className="px-4 py-1.5 rounded text-sm text-white disabled:opacity-50"
                    style={{ backgroundColor: '#b05642' }}>
                    {editSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditBlendId(null)}
                    className="px-4 py-1.5 rounded text-sm text-stone-500 hover:text-stone-800 border border-stone-200">
                    Cancel
                  </button>
                </div>
                {editErr && <span className="text-red-500 text-xs">{editErr}</span>}
              </div>
            </td>
          </tr>
        )}
      </>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-normal text-stone-800">Blends &amp; SKUs</h1>
        <label className="flex items-center gap-1.5 text-sm text-stone-500">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)}
            className="accent-stone-700" />
          Show inactive
        </label>
      </div>
      <p className="text-xs text-stone-400 mb-6">
        Organized by archetype → dial position → alias slot. Each slot lists its fulfillment choices in order — 1st is tried first, 2nd is the fallback. Choices, rank, and dial position are set on the Coffees page; this page reflects roastery fulfillment status only (SKU, Shopify variant, active/inactive). Drop-ship model; no inventory quantities tracked.
      </p>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <div className="space-y-8">
        {ARCHETYPES.map(({ value: archValue, label: archLabel }) => {
          const posMap = matrix.get(archValue);
          if (!posMap || posMap.size === 0) return null;
          const positions = [...posMap.values()].sort((a, b) => a.sort - b.sort);

          return (
            <div key={archValue}>
              <h2 className="text-xs font-normal text-stone-400 uppercase tracking-widest mb-2">
                {archLabel}
              </h2>

              <div className="space-y-2">
                {positions.map(pos => (
                  <div key={pos.sort} className="border border-stone-100 rounded-lg overflow-hidden">

                    {/* Position header */}
                    <div className="bg-stone-50 border-b border-stone-100 px-4 py-2 flex items-center gap-3">
                      <span className="text-stone-400 text-xs">{posIcon(pos.sort)}</span>
                      <span className="text-xs text-stone-600 font-medium">{pos.platform_name}</span>
                      <span className="text-xs text-stone-300">{pos.entries.length} choice{pos.entries.length !== 1 ? 's' : ''}</span>
                    </div>

                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-stone-300 uppercase tracking-wide border-b border-stone-50">
                          <th className="py-1.5 px-4 text-left font-normal w-32">Rank · Coffee</th>
                          <th className="py-1.5 px-3 text-left font-normal">Roaster SKU</th>
                          <th className="py-1.5 px-3 text-left font-normal">Shopify Variant ID</th>
                          <th className="py-1.5 px-3 text-left font-normal w-24">Status</th>
                          <th className="py-1.5 px-3 text-left font-normal w-16"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pos.entries.map(({ aliasRow, blends: entryBlends }) => {
                          return (
                            <>
                              {/* Coffee entry row */}
                              <tr key={`alias-${aliasRow.id}`} className={`border-b border-stone-100 bg-stone-50/30 ${aliasRow.coffee_is_active === false ? 'opacity-50' : ''}`}>
                                <td className="py-2 px-4" colSpan={5}>
                                  <div className="flex items-center gap-3">
                                    {/* Rank badge — read-only; set on the Coffees page */}
                                    <span
                                      className={`px-2 py-0.5 rounded text-xs border ${
                                        aliasRow.priority === 1
                                          ? 'text-white border-transparent'
                                          : 'text-stone-500 border-stone-200'
                                      }`}
                                      style={aliasRow.priority === 1 ? { backgroundColor: '#b05642' } : {}}
                                    >
                                      {ordinal(aliasRow.priority)} choice{aliasRow.priority === 1 ? ' ★' : ''}
                                    </span>
                                    <span className="text-sm text-stone-700">{aliasRow.coffee_name}</span>
                                    <span className="text-xs text-stone-400">{aliasRow.roaster}</span>
                                    {/* Roastery lifecycle (2026-08-25) — the coffee's own inactive state
                                        (its roastery deactivated) takes precedence over the alias row's
                                        own toggle, which the cascade also flips but for a different reason. */}
                                    {aliasRow.coffee_is_active === false ? (
                                      <span className="px-2 py-0.5 rounded text-xs bg-stone-100 text-stone-400 border border-stone-200">
                                        Inactive · {aliasRow.roaster}
                                      </span>
                                    ) : !aliasRow.is_active && (
                                      <span className="px-2 py-0.5 rounded text-xs bg-stone-100 text-stone-400 border border-stone-200">
                                        Inactive
                                      </span>
                                    )}
                                  </div>
                                </td>
                              </tr>

                              {/* Blend rows for this coffee */}
                              {entryBlends.length > 0
                                ? entryBlends.map(b => <BlendRow key={b.id} b={b} />)
                                : (
                                  <tr className="border-b border-stone-50">
                                    <td colSpan={5} className="py-2 pl-10 text-xs text-stone-300 italic">No blend variants found for this coffee</td>
                                  </tr>
                                )
                              }
                            </>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Unaliased blends */}
        {unaliasedBlends.length > 0 && (
          <div>
            <h2 className="text-xs font-normal text-stone-400 uppercase tracking-widest mb-2">
              No Alias Assigned
            </h2>
            <div className="border border-amber-200 rounded-lg overflow-hidden">
              <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
                <span className="text-xs text-amber-600">These blends are not part of any alias slot — link them to a coffee and assign an alias via the Coffees page.</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-stone-300 uppercase tracking-wide border-b border-stone-50">
                    <th className="py-1.5 px-4 text-left font-normal">Coffee / Blend</th>
                    <th className="py-1.5 px-3 text-left font-normal">Roaster SKU</th>
                    <th className="py-1.5 px-3 text-left font-normal">Shopify Variant ID</th>
                    <th className="py-1.5 px-3 text-left font-normal w-24">Status</th>
                    <th className="py-1.5 px-3 text-left font-normal w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {unaliasedBlends.map(b => <BlendRow key={b.id} b={b} unlinked={b.coffee_id == null} />)}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
