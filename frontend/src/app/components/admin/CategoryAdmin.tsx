import { useState } from 'react';
import { reportError } from '../../lib/errorReporter';

// Extracted out of AdminCoffees.tsx (Catalog Blueprint brief 4, Part B —
// "carried over as extracted components, not rewritten"). Still reads/writes
// /api/admin/categories* and /api/admin/coffee-categories* — untouched by
// this brief (Task 0's "keep" list; categories are cross-cutting tags
// orthogonal to archetype/placement, D1 never touches them). The old
// "categories that still carry their own dial position/alias system" table
// (the retired coffee_alias/dial_archetype_positions-based experimental
// section) is dropped — the new Slots & pricing region (AdminCatalog.tsx,
// Part B3) already covers every archetype including experimental.

export interface CategoryOption {
  id: number; code: string; label: string; sort_order: number; is_active: boolean; is_hoppable: boolean;
}

export default function CategoryAdmin({ categories, apiFetch, onChanged }: {
  categories: CategoryOption[];
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>;
  onChanged: () => void | Promise<void>;
}) {
  const [newCategoryLabel, setNewCategoryLabel] = useState('');
  const [categoryCreateSaving, setCategoryCreateSaving] = useState(false);
  const [categoryCreateErr, setCategoryCreateErr] = useState('');
  const [togglingCategoryId, setTogglingCategoryId] = useState<number | null>(null);
  const [categoryDeletingId, setCategoryDeletingId] = useState<number | null>(null);

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
      setNewCategoryLabel(''); await onChanged();
    } catch (err: unknown) {
      reportError('[CategoryAdmin/create]', err);
      setCategoryCreateErr(err instanceof Error ? err.message : 'Failed');
    } finally { setCategoryCreateSaving(false); }
  }

  async function handleToggleActive(cat: CategoryOption) {
    setTogglingCategoryId(cat.id);
    try {
      const res = await apiFetch(`/api/admin/categories/${cat.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !cat.is_active }),
      });
      if (!res.ok) { const body = await res.json().catch(() => ({})); alert(body.error ?? 'Failed to update category'); return; }
      await onChanged();
    } catch (err) { reportError('[CategoryAdmin/toggle-active]', err); } finally { setTogglingCategoryId(null); }
  }

  async function handleDelete(cat: CategoryOption) {
    if (!confirm(`Remove "${cat.label}" entirely? This also removes it from every coffee currently tagged with it.`)) return;
    setCategoryDeletingId(cat.id);
    try {
      const res = await apiFetch(`/api/admin/categories/${cat.id}`, { method: 'DELETE' });
      if (!res.ok) { const body = await res.json(); alert(body.error ?? 'Failed to delete category'); return; }
      await onChanged();
    } catch (err) { reportError('[CategoryAdmin/delete]', err); } finally { setCategoryDeletingId(null); }
  }

  return (
    <div className="mt-10 pt-6 border-t border-stone-200">
      <h2 className="text-xs font-normal text-stone-400 uppercase tracking-widest mb-2">Categories</h2>
      <p className="text-xs text-stone-400 mb-3">
        Cross-cutting tags independent of archetype and dial position — a coffee can carry any number of these regardless of its archetype (or none yet).
      </p>
      <div className="border border-stone-100 rounded-lg p-4 space-y-3">
        <div className="space-y-1.5">
          {categories.map(cat => (
            <div key={cat.id} className="flex items-center gap-2">
              <span className="text-sm text-stone-700 min-w-[120px]">{cat.label}</span>
              <button
                onClick={() => handleToggleActive(cat)}
                disabled={togglingCategoryId === cat.id}
                className={`px-2 py-0.5 rounded text-xs border transition-colors disabled:opacity-40 ${
                  cat.is_active
                    ? 'bg-green-50 text-green-700 border-green-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200'
                    : 'bg-stone-100 text-stone-400 border-stone-200 hover:bg-green-50 hover:text-green-700 hover:border-green-200'
                }`}
              >
                {togglingCategoryId === cat.id ? '…' : cat.is_active ? 'Active' : 'Inactive'}
              </button>
              <button
                onClick={() => handleDelete(cat)}
                disabled={categoryDeletingId === cat.id}
                className="text-xs text-stone-300 hover:text-red-400 transition-colors disabled:opacity-40"
              >
                {categoryDeletingId === cat.id ? 'Removing…' : 'Remove'}
              </button>
            </div>
          ))}
          {categories.length === 0 && <p className="text-xs text-stone-300">No categories yet.</p>}
        </div>
        <div className="flex items-end gap-2 pt-2 border-t border-stone-100">
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
    </div>
  );
}

// Toggle a single coffee↔category tag — used inline on a coffee row, kept as
// a standalone function (not a component) since callers already manage their
// own coffeeCategories list and loading state.
export async function toggleCoffeeCategory(
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>,
  coffeeId: number,
  categoryId: number,
  existingId: number | undefined
): Promise<boolean> {
  try {
    const res = existingId
      ? await apiFetch(`/api/admin/coffee-categories/${existingId}`, { method: 'DELETE' })
      : await apiFetch('/api/admin/coffee-categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coffee_id: coffeeId, category_id: categoryId }),
        });
    if (!res.ok) { const body = await res.json().catch(() => ({})); alert(body.error ?? 'Failed to update category tag'); return false; }
    return true;
  } catch (err) { reportError('[CategoryAdmin/toggle-coffee-category]', err); return false; }
}
