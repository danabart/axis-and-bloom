import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

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
  inventory_status: string;
}

interface CoffeeLookup { id: number; name: string; roaster: string | null; }

export default function AdminInventory() {
  const { user } = useAuth();

  const [blends, setBlends]   = useState<Blend[]>([]);
  const [coffees, setCoffees] = useState<CoffeeLookup[]>([]);
  const [error, setError]     = useState('');

  const [editId, setEditId]             = useState<string | null>(null);
  const [editCoffee, setEditCoffee]     = useState('');
  const [editSku, setEditSku]           = useState('');
  const [editShopify, setEditShopify]   = useState('');
  const [editSaving, setEditSaving]     = useState(false);
  const [editErr, setEditErr]           = useState('');
  const [togglingId, setTogglingId]     = useState<string | null>(null);

  async function apiFetch(url: string, options: RequestInit = {}) {
    const token = await user!.getIdToken();
    return fetch(url, {
      cache: 'no-store', ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    });
  }

  async function load() {
    try {
      const [bRes, cRes] = await Promise.all([
        apiFetch('/api/admin/inventory'),
        apiFetch('/api/admin/inventory/coffees-lookup'),
      ]);
      setBlends(await bRes.json());
      setCoffees(await cRes.json());
    } catch { setError('Failed to load blends'); }
  }

  useEffect(() => { if (user) load(); }, [user]);

  function openEdit(b: Blend) {
    setEditId(b.id);
    setEditCoffee(b.coffee_id ? String(b.coffee_id) : '');
    setEditSku(b.roaster_sku ?? '');
    setEditShopify(b.shopify_variant_id ?? '');
    setEditErr('');
  }

  async function handleToggleActive(b: Blend) {
    setTogglingId(b.id);
    try {
      await apiFetch(`/api/admin/inventory/${b.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !b.is_active }),
      });
      await load();
    } catch { /* non-critical */ } finally { setTogglingId(null); }
  }

  async function handleEdit(id: string) {
    setEditSaving(true); setEditErr('');
    try {
      const body: Record<string, unknown> = {
        roaster_sku:        editSku || null,
        shopify_variant_id: editShopify || null,
      };
      if (editCoffee) body.coffee_id = Number(editCoffee);
      const res = await apiFetch(`/api/admin/inventory/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      setEditId(null); await load();
    } catch (err: unknown) {
      setEditErr(err instanceof Error ? err.message : 'Failed');
    } finally { setEditSaving(false); }
  }

  // Group by coffee (unlinked first — API already orders this)
  type Group = { key: string; label: string; roaster: string | null; unlinked: boolean; rows: Blend[] };
  const groups: Group[] = [];
  for (const b of blends) {
    const key   = b.coffee_id ? `coffee_${b.coffee_id}` : `unlinked_${b.id}`;
    const label = b.coffee_name ?? b.blend_name;
    const last  = groups[groups.length - 1];
    if (last?.key === key) { last.rows.push(b); }
    else groups.push({ key, label, roaster: b.roaster, unlinked: !b.coffee_id, rows: [b] });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-normal text-stone-800">Blends &amp; SKUs</h1>
      </div>
      <p className="text-xs text-stone-400 mb-6">
        Each coffee has two sellable package sizes (12 oz / 5 lb). Manage Shopify variant IDs, roaster SKUs, and active status here. Inventory quantities are not tracked — this is a drop-ship model.
      </p>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <div className="space-y-5">
        {groups.map(group => (
          <div key={group.key} className={`border rounded-lg overflow-hidden ${group.unlinked ? 'border-amber-200' : 'border-stone-100'}`}>
            {/* Group header */}
            <div className={`px-4 py-2.5 flex items-center gap-3 border-b ${group.unlinked ? 'bg-amber-50 border-amber-200' : 'bg-stone-50 border-stone-100'}`}>
              <span className="text-sm font-normal text-stone-800">{group.label}</span>
              {group.roaster && <span className="text-xs text-stone-400">{group.roaster}</span>}
              {group.unlinked && (
                <span className="ml-auto px-2 py-0.5 rounded border border-amber-300 bg-amber-100 text-amber-700 text-xs">
                  Unlinked — assign a coffee
                </span>
              )}
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-stone-400 uppercase tracking-wide border-b border-stone-100">
                  <th className="py-2 px-4 text-left font-normal w-20">Package</th>
                  <th className="py-2 px-4 text-left font-normal">Roaster SKU</th>
                  <th className="py-2 px-4 text-left font-normal">Shopify Variant ID</th>
                  <th className="py-2 px-4 text-left font-normal w-24">Status</th>
                  <th className="py-2 px-4 text-left font-normal w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map(b => {
                  const isEditing  = editId === b.id;
                  const isToggling = togglingId === b.id;
                  return (
                    <>
                      <tr key={b.id} className="border-b border-stone-50 hover:bg-stone-50">
                        <td className="py-3 px-4 text-stone-700">{b.weight_oz} oz</td>
                        <td className="py-3 px-4 text-stone-500 text-xs font-mono">
                          {b.roaster_sku ?? <span className="text-stone-300">—</span>}
                        </td>
                        <td className="py-3 px-4 text-stone-500 text-xs font-mono">
                          {b.shopify_variant_id ?? <span className="text-stone-300">—</span>}
                        </td>
                        <td className="py-3 px-4">
                          <button
                            onClick={() => handleToggleActive(b)}
                            disabled={isToggling}
                            className={`px-2.5 py-0.5 rounded border text-xs transition-colors disabled:opacity-40 ${
                              b.is_active
                                ? 'bg-green-50 text-green-700 border-green-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200'
                                : 'bg-stone-100 text-stone-400 border-stone-200 hover:bg-green-50 hover:text-green-700 hover:border-green-200'
                            }`}
                            title={b.is_active ? 'Click to deactivate' : 'Click to activate'}
                          >
                            {isToggling ? '…' : b.is_active ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="py-3 px-4">
                          <button
                            onClick={() => isEditing ? setEditId(null) : openEdit(b)}
                            className="text-xs px-2.5 py-1 rounded border border-stone-200 text-stone-500 hover:text-stone-800 hover:border-stone-300 transition-colors"
                          >
                            {isEditing ? 'Cancel' : 'Edit'}
                          </button>
                        </td>
                      </tr>

                      {isEditing && (
                        <tr key={`edit-${b.id}`} className="border-b border-stone-100 bg-stone-50">
                          <td colSpan={5} className="px-4 py-3">
                            <div className="flex flex-wrap items-end gap-4">
                              {group.unlinked && (
                                <div>
                                  <label className="block text-xs text-stone-400 mb-1">Link to Coffee</label>
                                  <select value={editCoffee} onChange={e => setEditCoffee(e.target.value)}
                                    className="border border-stone-300 rounded px-3 py-1.5 text-sm min-w-[220px]">
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
                                  className="border border-stone-300 rounded px-3 py-1.5 text-sm w-40 font-mono"
                                  placeholder="e.g. PATH-COL-12" />
                              </div>
                              <div>
                                <label className="block text-xs text-stone-400 mb-1">Shopify Variant ID</label>
                                <input value={editShopify} onChange={e => setEditShopify(e.target.value)}
                                  className="border border-stone-300 rounded px-3 py-1.5 text-sm w-48 font-mono"
                                  placeholder="e.g. 45678901234" />
                              </div>
                              <div className="flex gap-2 pb-0.5">
                                <button onClick={() => handleEdit(b.id)} disabled={editSaving}
                                  className="px-4 py-1.5 rounded text-sm text-white disabled:opacity-50"
                                  style={{ backgroundColor: '#b05642' }}>
                                  {editSaving ? 'Saving…' : 'Save'}
                                </button>
                                <button onClick={() => setEditId(null)}
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
                })}
              </tbody>
            </table>
          </div>
        ))}

        {blends.length === 0 && !error && (
          <p className="text-stone-400 text-sm py-8 text-center">No blend variants found.</p>
        )}
      </div>
    </div>
  );
}
