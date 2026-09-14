import { Fragment, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';
import { useArchetypes } from './useArchetypes';

// Catalog Blueprint brief 4, Part C — trimmed to SKU-only. The old alias
// matrix (archetype → dial position → alias rank) moved to the Coffees page
// (AdminCatalog.tsx's Slots & pricing region shows occupant order; "Manage
// SKUs" on a coffee row is where a SKU is created/edited now). A SKU is
// always created from its coffee (Place-a-coffee or "Manage SKUs") — there is
// no more "unlinked blend" state to reconcile here, so that whole section is
// gone. Nav label stays "Blends & SKUs".

interface Sku {
  id: string; coffee_id: number; blend_name: string; weight_oz: number;
  roaster_sku: string | null; shopify_variant_id: string | null;
  cost_to_us: string | null; quantity_available: number; safety_stock_buffer: number;
  inventory_status: string; is_active: boolean;
}
interface Coffee {
  id: number; name: string; roaster_name: string | null; is_active: boolean;
  match_archetype: string | null; skus: Sku[];
}

export default function AdminInventory() {
  const { user } = useAuth();
  const { archetypes } = useArchetypes();

  const [coffees, setCoffees] = useState<Coffee[]>([]);
  const [error, setError] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [editSkuId, setEditSkuId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ roasterSku: '', shopifyVariantId: '', costToUs: '', quantityAvailable: '', safetyStockBuffer: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [restockingId, setRestockingId] = useState<string | null>(null);
  const [restockAmount, setRestockAmount] = useState('');

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
      const res = await apiFetch(`/api/admin/catalog/coffees${qs}`);
      if (!res.ok) throw new Error('Failed to fetch coffees');
      setCoffees(await res.json());
      setError('');
    } catch (err) { reportError('[AdminInventory/load]', err); setError('Failed to load data'); }
  }

  useEffect(() => { if (user) load(); }, [user, showInactive]);

  function archetypeLabel(code: string | null): string {
    if (!code) return '—';
    return archetypes.find(a => a.code === code)?.label ?? code;
  }

  async function handleToggle(coffeeId: number, sku: Sku) {
    setTogglingId(sku.id);
    try {
      const res = await apiFetch(`/api/admin/catalog/coffees/${coffeeId}/skus`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weightOz: sku.weight_oz, isActive: !sku.is_active }),
      });
      if (!res.ok) { const body = await res.json().catch(() => ({})); alert(body.message ?? body.error ?? 'Failed to update SKU'); return; }
      await load();
    } catch (err) { reportError('[AdminInventory/toggle]', err); } finally { setTogglingId(null); }
  }

  function openEdit(sku: Sku) {
    setEditSkuId(sku.id);
    setEditForm({
      roasterSku: sku.roaster_sku ?? '', shopifyVariantId: sku.shopify_variant_id ?? '',
      costToUs: sku.cost_to_us ?? '', quantityAvailable: String(sku.quantity_available),
      safetyStockBuffer: String(sku.safety_stock_buffer),
    });
    setEditErr('');
  }

  async function handleEditSave(coffeeId: number, sku: Sku) {
    setEditSaving(true); setEditErr('');
    try {
      const res = await apiFetch(`/api/admin/catalog/coffees/${coffeeId}/skus`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weightOz: sku.weight_oz,
          roasterSku: editForm.roasterSku || null,
          shopifyVariantId: editForm.shopifyVariantId || null,
          costToUs: editForm.costToUs ? Number(editForm.costToUs) : null,
          quantityAvailable: Number(editForm.quantityAvailable),
          safetyStockBuffer: Number(editForm.safetyStockBuffer),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? 'Failed to save');
      setEditSkuId(null); await load();
    } catch (err) {
      reportError('[AdminInventory/save-edit]', err);
      setEditErr(err instanceof Error ? err.message : 'Failed');
    } finally { setEditSaving(false); }
  }

  async function handleRestock(sku: Sku) {
    const quantity = Number(restockAmount);
    if (!Number.isFinite(quantity) || quantity <= 0) { alert('Enter a positive quantity to restock'); return; }
    setRestockingId(sku.id);
    try {
      const res = await apiFetch(`/api/admin/catalog/skus/${sku.id}/restock`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity }),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? 'Failed to restock');
      setRestockAmount(''); await load();
    } catch (err) { reportError('[AdminInventory/restock]', err); alert(err instanceof Error ? err.message : 'Failed to restock'); }
    finally { setRestockingId(null); }
  }

  const rows = coffees.flatMap(c => c.skus.map(sku => ({ coffee: c, sku })))
    .sort((a, b) => {
      const statusRank = (s: string) => (s === 'out_of_stock' ? 0 : s === 'low_stock' ? 1 : 2);
      const rankDiff = statusRank(a.sku.inventory_status) - statusRank(b.sku.inventory_status);
      if (rankDiff !== 0) return rankDiff;
      return a.coffee.name.localeCompare(b.coffee.name) || a.sku.weight_oz - b.sku.weight_oz;
    });

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
        Every SKU across every coffee, worst stock status first. A SKU is created from its coffee — Place a coffee or "Manage SKUs" on the Coffees page — never orphaned. Drop-ship model; quantities/buffers are informational, not gating.
      </p>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <table className="w-full text-sm border border-stone-100 rounded-lg overflow-hidden">
        <thead>
          <tr className="text-xs text-stone-300 uppercase tracking-wide border-b border-stone-100 bg-stone-50">
            <th className="py-2 px-4 text-left font-normal">Coffee</th>
            <th className="py-2 px-3 text-left font-normal">Match</th>
            <th className="py-2 px-3 text-left font-normal">Weight</th>
            <th className="py-2 px-3 text-left font-normal">Roaster SKU</th>
            <th className="py-2 px-3 text-left font-normal">Shopify Variant</th>
            <th className="py-2 px-3 text-left font-normal">Qty / Buffer</th>
            <th className="py-2 px-3 text-left font-normal">Status</th>
            <th className="py-2 px-3 text-left font-normal w-40"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ coffee, sku }) => {
            const isEditing = editSkuId === sku.id;
            const isToggling = togglingId === sku.id;
            const isRestocking = restockingId === sku.id;
            const coffeeInactive = !coffee.is_active;
            return (
              <Fragment key={sku.id}>
                <tr className={`border-b border-stone-50 hover:bg-stone-50/60 ${coffeeInactive ? 'opacity-50' : ''}`}>
                  <td className="py-2 px-4">
                    <div className="text-stone-700">{coffee.name}</div>
                    <div className="text-xs text-stone-400">{coffee.roaster_name ?? '—'}</div>
                  </td>
                  <td className="py-2 px-3 text-xs text-stone-500">{archetypeLabel(coffee.match_archetype)}</td>
                  <td className="py-2 px-3 text-stone-500 text-xs">{sku.weight_oz} oz</td>
                  <td className="py-2 px-3 text-stone-400 text-xs font-mono">{sku.roaster_sku ?? <span className="text-stone-200">—</span>}</td>
                  <td className="py-2 px-3 text-stone-400 text-xs font-mono">{sku.shopify_variant_id ?? <span className="text-stone-200">—</span>}</td>
                  <td className="py-2 px-3 text-xs text-stone-500">{sku.quantity_available} / {sku.safety_stock_buffer}</td>
                  <td className="py-2 px-3">
                    {coffeeInactive ? (
                      <span className="px-2 py-0.5 rounded text-xs bg-stone-100 text-stone-400 border border-stone-200">Coffee inactive</span>
                    ) : (
                      <button
                        onClick={() => handleToggle(coffee.id, sku)}
                        disabled={isToggling}
                        className={`px-2 py-0.5 rounded border text-xs transition-colors disabled:opacity-40 ${
                          sku.is_active
                            ? 'bg-green-50 text-green-700 border-green-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200'
                            : 'bg-stone-100 text-stone-400 border-stone-200 hover:bg-green-50 hover:text-green-700 hover:border-green-200'
                        }`}
                      >
                        {isToggling ? '…' : sku.is_active ? sku.inventory_status.replace('_', ' ') : 'Inactive'}
                      </button>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <button
                      onClick={() => isEditing ? setEditSkuId(null) : openEdit(sku)}
                      disabled={coffeeInactive}
                      className="text-xs px-2 py-0.5 rounded border border-stone-200 text-stone-400 hover:text-stone-700 hover:border-stone-300 disabled:opacity-40"
                    >
                      {isEditing ? 'Cancel' : 'Edit'}
                    </button>
                  </td>
                </tr>
                {isEditing && (
                  <tr className="border-b border-stone-100 bg-stone-50">
                    <td colSpan={8} className="px-4 py-3">
                      <div className="flex flex-wrap items-end gap-3">
                        <div>
                          <label className="block text-xs text-stone-400 mb-1">Roaster SKU</label>
                          <input value={editForm.roasterSku} onChange={e => setEditForm(f => ({ ...f, roasterSku: e.target.value }))}
                            className="border border-stone-300 rounded px-3 py-1.5 text-sm w-36 font-mono" />
                        </div>
                        <div>
                          <label className="block text-xs text-stone-400 mb-1">Shopify Variant ID</label>
                          <input value={editForm.shopifyVariantId} onChange={e => setEditForm(f => ({ ...f, shopifyVariantId: e.target.value }))}
                            className="border border-stone-300 rounded px-3 py-1.5 text-sm w-44 font-mono" />
                        </div>
                        <div>
                          <label className="block text-xs text-stone-400 mb-1">Cost to us ($)</label>
                          <input type="number" step="0.01" value={editForm.costToUs} onChange={e => setEditForm(f => ({ ...f, costToUs: e.target.value }))}
                            className="border border-stone-300 rounded px-3 py-1.5 text-sm w-24" />
                        </div>
                        <div>
                          <label className="block text-xs text-stone-400 mb-1">Quantity</label>
                          <input type="number" value={editForm.quantityAvailable} onChange={e => setEditForm(f => ({ ...f, quantityAvailable: e.target.value }))}
                            className="border border-stone-300 rounded px-3 py-1.5 text-sm w-20" />
                        </div>
                        <div>
                          <label className="block text-xs text-stone-400 mb-1">Safety buffer</label>
                          <input type="number" value={editForm.safetyStockBuffer} onChange={e => setEditForm(f => ({ ...f, safetyStockBuffer: e.target.value }))}
                            className="border border-stone-300 rounded px-3 py-1.5 text-sm w-20" />
                        </div>
                        <div className="flex gap-2 pb-0.5">
                          <button onClick={() => handleEditSave(coffee.id, sku)} disabled={editSaving}
                            className="px-4 py-1.5 rounded text-sm text-white disabled:opacity-50" style={{ backgroundColor: '#b05642' }}>
                            {editSaving ? 'Saving…' : 'Save'}
                          </button>
                          <button onClick={() => setEditSkuId(null)}
                            className="px-4 py-1.5 rounded text-sm text-stone-500 hover:text-stone-800 border border-stone-200">
                            Cancel
                          </button>
                        </div>
                        <div className="flex gap-2 items-end pb-0.5 ml-4 border-l border-stone-200 pl-4">
                          <div>
                            <label className="block text-xs text-stone-400 mb-1">Restock qty</label>
                            <input type="number" value={restockAmount} onChange={e => setRestockAmount(e.target.value)}
                              className="border border-stone-300 rounded px-3 py-1.5 text-sm w-24" />
                          </div>
                          <button onClick={() => handleRestock(sku)} disabled={isRestocking}
                            className="px-3 py-1.5 rounded text-sm border border-stone-300 text-stone-600 hover:bg-stone-50 disabled:opacity-50">
                            {isRestocking ? 'Restocking…' : 'Restock'}
                          </button>
                        </div>
                        {editErr && <span className="text-red-500 text-xs">{editErr}</span>}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={8} className="py-8 text-center text-xs text-stone-300">No SKUs yet — place a coffee and add one from the Coffees page.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
