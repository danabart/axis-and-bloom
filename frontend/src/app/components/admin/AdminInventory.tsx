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
  is_active: boolean;
  quantity_available: number;
  safety_stock_buffer: number;
  inventory_status: string;
  inventory_last_synced_at: string | null;
  last_restocked_at: string | null;
}

interface CoffeeLookup { id: number; name: string; roaster: string | null; }

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    in_stock:    'bg-green-50 text-green-700 border-green-200',
    low_stock:   'bg-amber-50 text-amber-700 border-amber-200',
    out_of_stock:'bg-red-50 text-red-600 border-red-200',
    pending:     'bg-stone-100 text-stone-500 border-stone-200',
  };
  const label: Record<string, string> = {
    in_stock: 'In Stock', low_stock: 'Low Stock',
    out_of_stock: 'Out of Stock', pending: 'Pending',
  };
  return (
    <span className={`px-2 py-0.5 rounded border text-xs ${cfg[status] ?? 'bg-stone-100 text-stone-400 border-stone-200'}`}>
      {label[status] ?? status}
    </span>
  );
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AdminInventory() {
  const { user } = useAuth();

  const [blends, setBlends]   = useState<Blend[]>([]);
  const [coffees, setCoffees] = useState<CoffeeLookup[]>([]);
  const [error, setError]     = useState('');

  // per-row editing state
  const [restockId, setRestockId]     = useState<string | null>(null);
  const [restockAmt, setRestockAmt]   = useState('');
  const [restocking, setRestocking]   = useState(false);
  const [restockErr, setRestockErr]   = useState('');

  const [editId, setEditId]           = useState<string | null>(null);
  const [editQty, setEditQty]         = useState('');
  const [editBuffer, setEditBuffer]   = useState('');
  const [editCoffee, setEditCoffee]   = useState('');
  const [editSaving, setEditSaving]   = useState(false);
  const [editErr, setEditErr]         = useState('');

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
    } catch { setError('Failed to load inventory'); }
  }

  useEffect(() => { if (user) load(); }, [user]);

  function openEdit(b: Blend) {
    setEditId(b.id);
    setEditQty(String(b.quantity_available));
    setEditBuffer(String(b.safety_stock_buffer));
    setEditCoffee(b.coffee_id ? String(b.coffee_id) : '');
    setEditErr('');
    setRestockId(null);
  }

  function openRestock(id: string) {
    setRestockId(id);
    setRestockAmt('');
    setRestockErr('');
    setEditId(null);
  }

  async function handleRestock(id: string) {
    const amt = Number(restockAmt);
    if (!Number.isFinite(amt) || amt <= 0) { setRestockErr('Enter a positive number'); return; }
    setRestocking(true); setRestockErr('');
    try {
      const res = await apiFetch(`/api/admin/inventory/${id}/restock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      setRestockId(null); await load();
    } catch (err: unknown) {
      setRestockErr(err instanceof Error ? err.message : 'Failed');
    } finally { setRestocking(false); }
  }

  async function handleEdit(id: string) {
    setEditSaving(true); setEditErr('');
    try {
      const body: Record<string, unknown> = {
        quantity_available:  Number(editQty),
        safety_stock_buffer: Number(editBuffer),
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

  // Group by coffee_name (or blend_name for unlinked), unlinked first (API already orders this)
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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-normal text-stone-800">Supply &amp; Inventory</h1>
        <p className="text-xs text-stone-400">Stock is tracked per package size (blend variant)</p>
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <div className="space-y-6">
        {groups.map(group => (
          <div key={group.key} className={`border rounded-lg overflow-hidden ${group.unlinked ? 'border-amber-200' : 'border-stone-100'}`}>
            {/* Group header */}
            <div className={`px-4 py-2.5 flex items-center gap-2 ${group.unlinked ? 'bg-amber-50' : 'bg-stone-50'} border-b ${group.unlinked ? 'border-amber-200' : 'border-stone-100'}`}>
              <span className="text-sm font-normal text-stone-800">{group.label}</span>
              {group.roaster && <span className="text-xs text-stone-400">{group.roaster}</span>}
              {group.unlinked && (
                <span className="ml-auto px-2 py-0.5 rounded border border-amber-300 bg-amber-100 text-amber-700 text-xs">
                  Unlinked — needs coffee assignment
                </span>
              )}
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-stone-400 uppercase tracking-wide border-b border-stone-100">
                  <th className="py-2 px-4 text-left font-normal">Package</th>
                  <th className="py-2 px-4 text-left font-normal">SKU</th>
                  <th className="py-2 px-4 text-left font-normal">On Hand</th>
                  <th className="py-2 px-4 text-left font-normal">Reorder At</th>
                  <th className="py-2 px-4 text-left font-normal">Status</th>
                  <th className="py-2 px-4 text-left font-normal">Last Restocked</th>
                  <th className="py-2 px-4 text-left font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map(b => {
                  const isRestocking = restockId === b.id;
                  const isEditing    = editId === b.id;
                  return (
                    <>
                      <tr key={b.id} className="border-b border-stone-50 hover:bg-stone-50">
                        <td className="py-3 px-4 text-stone-700">{b.weight_oz} oz</td>
                        <td className="py-3 px-4 text-stone-400 text-xs font-mono">{b.roaster_sku ?? '—'}</td>
                        <td className="py-3 px-4 text-stone-800 font-normal">{b.quantity_available}</td>
                        <td className="py-3 px-4 text-stone-500">{b.safety_stock_buffer}</td>
                        <td className="py-3 px-4"><StatusBadge status={b.inventory_status} /></td>
                        <td className="py-3 px-4 text-stone-400 text-xs">{fmtDate(b.last_restocked_at)}</td>
                        <td className="py-3 px-4">
                          <div className="flex gap-2">
                            <button
                              onClick={() => isRestocking ? setRestockId(null) : openRestock(b.id)}
                              className="text-xs px-2.5 py-1 rounded border border-stone-200 text-stone-500 hover:text-stone-800 hover:border-stone-300 transition-colors"
                            >
                              {isRestocking ? 'Cancel' : 'Restock'}
                            </button>
                            <button
                              onClick={() => isEditing ? setEditId(null) : openEdit(b)}
                              className="text-xs px-2.5 py-1 rounded border border-stone-200 text-stone-500 hover:text-stone-800 hover:border-stone-300 transition-colors"
                            >
                              {isEditing ? 'Cancel' : 'Edit'}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Restock inline form */}
                      {isRestocking && (
                        <tr key={`restock-${b.id}`} className="border-b border-stone-100 bg-stone-50">
                          <td colSpan={7} className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <label className="text-xs text-stone-500">Add units:</label>
                              <input
                                type="number" min="1" value={restockAmt}
                                onChange={e => setRestockAmt(e.target.value)}
                                className="w-24 border border-stone-300 rounded px-3 py-1.5 text-sm"
                                placeholder="e.g. 24"
                                autoFocus
                              />
                              <button
                                onClick={() => handleRestock(b.id)}
                                disabled={restocking}
                                className="px-4 py-1.5 rounded text-sm text-white disabled:opacity-50"
                                style={{ backgroundColor: '#b05642' }}
                              >
                                {restocking ? 'Saving…' : 'Confirm Restock'}
                              </button>
                              {restockErr && <span className="text-red-500 text-xs">{restockErr}</span>}
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Edit inline form */}
                      {isEditing && (
                        <tr key={`edit-${b.id}`} className="border-b border-stone-100 bg-stone-50">
                          <td colSpan={7} className="px-4 py-3">
                            <div className="flex flex-wrap items-end gap-4">
                              <div>
                                <label className="block text-xs text-stone-400 mb-1">On Hand</label>
                                <input type="number" min="0" value={editQty}
                                  onChange={e => setEditQty(e.target.value)}
                                  className="w-24 border border-stone-300 rounded px-3 py-1.5 text-sm" />
                              </div>
                              <div>
                                <label className="block text-xs text-stone-400 mb-1">Reorder Buffer</label>
                                <input type="number" min="0" value={editBuffer}
                                  onChange={e => setEditBuffer(e.target.value)}
                                  className="w-24 border border-stone-300 rounded px-3 py-1.5 text-sm" />
                              </div>
                              {(b.coffee_id === null || group.unlinked) && (
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
