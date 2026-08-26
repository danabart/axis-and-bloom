import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';

interface Roaster {
  id: string;
  name: string;
  api_endpoint: string | null;
  is_active: boolean;
  avg_fulfillment_hours: number | null;
  roaster_notes: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  contact_person: string | null;
  website: string | null;
  created_at: string;
  // Roastery lifecycle (2026-08-25)
  deactivated_at: string | null;
  deactivation_note: string | null;
  coffees: number;
  active_coffees: number;
  blends: number;
  active_blends: number;
}

// Roastery lifecycle (2026-08-25) — response shapes from
// GET /api/admin/roasters/:id/deactivation-preview (both directions) and the
// POST .../deactivate / .../reactivate confirm actions.
interface ArchetypeLabelable { archetype: string; dialSortOrder: number; platformName: string }
interface DeactivationPreview {
  roaster: { id: string; name: string; isActive: boolean };
  coffees: Array<{ id: number; name: string; isActive: boolean; homeArchetype: string | null; isDefault: boolean; guestPositions: number }>;
  blends: { total: number; active: number };
  aliases: { total: number; active: number };
  slotsGoingEmpty: ArchetypeLabelable[];
  archetypesLosingDefault: string[];
  hopsGoingDark: number;
  openOrderLines: number;
  activeSubscribersOnTheseSlots: number;
  alreadyManuallyInactive: { coffees: number; blends: number; aliases: number };
  applied?: { coffees: number; blends: number; aliases: number };
}
interface ReactivationPreview {
  roaster: { id: string; name: string; isActive: boolean };
  coffees: Array<{ id: number; name: string }>;
  blends: { toRestore: number };
  aliases: { toRestore: number };
  restored?: { coffees: number; blends: number; aliases: number };
}

function archetypeLabel(archetype: string): string {
  return archetype.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

type RoasterFormData = {
  name: string; api_endpoint: string; avg_fulfillment_hours: string; roaster_notes: string;
  address: string; email: string; phone: string; contact_person: string; website: string;
};

const EMPTY_FORM: RoasterFormData = {
  name: '', api_endpoint: '', avg_fulfillment_hours: '', roaster_notes: '',
  address: '', email: '', phone: '', contact_person: '', website: '',
};

function RoasterForm({
  initial, onSave, onCancel, submitLabel,
}: {
  initial: RoasterFormData;
  onSave: (data: RoasterFormData) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [form, setForm] = useState<RoasterFormData>(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const f = (k: keyof RoasterFormData) => (v: string) => setForm(prev => ({ ...prev, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setSaveError('');
    try { await onSave(form); }
    catch (err: unknown) { reportError('[AdminRoasters/form-save]', err); setSaveError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="md:col-span-2">
        <label className="block text-xs text-stone-500 mb-1">Name *</label>
        <input required value={form.name} onChange={e => f('name')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          placeholder="e.g. Path Coffee Roasters" />
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">Contact Person</label>
        <input value={form.contact_person} onChange={e => f('contact_person')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          placeholder="e.g. Jane Smith" />
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">Email</label>
        <input type="email" value={form.email} onChange={e => f('email')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          placeholder="orders@roastery.com" />
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">Phone</label>
        <input value={form.phone} onChange={e => f('phone')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          placeholder="+1 (212) 555-0100" />
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">Website</label>
        <input value={form.website} onChange={e => f('website')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          placeholder="https://roastery.com" />
      </div>
      <div className="md:col-span-2">
        <label className="block text-xs text-stone-500 mb-1">Address</label>
        <input value={form.address} onChange={e => f('address')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          placeholder="123 Roastery Ave, Brooklyn, NY 11201" />
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">Avg Fulfillment Hours</label>
        <input type="number" min="0" step="0.5" value={form.avg_fulfillment_hours}
          onChange={e => f('avg_fulfillment_hours')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          placeholder="e.g. 48" />
      </div>
      <div>
        <label className="block text-xs text-stone-500 mb-1">API Endpoint <span className="opacity-60">(optional)</span></label>
        <input value={form.api_endpoint} onChange={e => f('api_endpoint')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          placeholder="https://api.roastery.com/v1" />
      </div>
      <div className="md:col-span-2">
        <label className="block text-xs text-stone-500 mb-1">Notes</label>
        <textarea rows={2} value={form.roaster_notes} onChange={e => f('roaster_notes')(e.target.value)}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm resize-none"
          placeholder="Ships Mon–Fri, lead time 3–5 days…" />
      </div>
      {saveError && <p className="md:col-span-2 text-red-500 text-sm">{saveError}</p>}
      <div className="md:col-span-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 rounded text-sm border border-stone-200 text-stone-500 hover:bg-stone-50">
          Cancel
        </button>
        <button type="submit" disabled={saving}
          className="px-5 py-2 rounded text-sm font-normal text-white disabled:opacity-50"
          style={{ backgroundColor: '#b05642' }}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

// Roastery lifecycle (2026-08-25) — the Deactivate…/Reactivate confirm panel.
// Expands inline under the row (same pattern as the Edit form above), fetches
// the preview the moment it opens, and renders it as plain statements before
// letting the admin confirm. Positive/neutral register throughout — this is
// admin-only copy, but it still lives in the repo, per the prompt's own note.
function RoasterLifecycleDialog({
  roaster, direction, getToken, onDone, onCancel,
}: {
  roaster: Roaster;
  direction: 'deactivate' | 'reactivate';
  getToken: () => Promise<string>;
  onDone: (summary: { archetypesLosingDefault?: string[] }) => void;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState<DeactivationPreview | ReactivationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = direction === 'reactivate' ? '?direction=reactivate' : '';
        const res = await fetch(`/api/admin/roasters/${roaster.id}/deactivation-preview${qs}`, {
          headers: { Authorization: `Bearer ${await getToken()}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? 'Failed to load preview');
        if (!cancelled) setPreview(data);
      } catch (err) {
        if (!cancelled) { reportError('[AdminRoasters/lifecycle-preview]', err); setError('Failed to load preview'); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roaster.id, direction]);

  async function handleConfirm() {
    setSubmitting(true); setError('');
    try {
      const path = direction === 'deactivate' ? 'deactivate' : 'reactivate';
      const res = await fetch(`/api/admin/roasters/${roaster.id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken()}` },
        body: direction === 'deactivate' ? JSON.stringify({ note: note || undefined }) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Failed to ${direction}`);
      onDone(direction === 'deactivate' ? { archetypesLosingDefault: (data as DeactivationPreview).archetypesLosingDefault } : {});
    } catch (err) {
      reportError(`[AdminRoasters/${direction}]`, err);
      setError(err instanceof Error ? err.message : `Failed to ${direction}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border-t border-stone-200 px-5 py-5 bg-stone-50 space-y-4">
      <p className="text-sm font-normal text-stone-800">
        {direction === 'deactivate' ? `Deactivate ${roaster.name}?` : `Reactivate ${roaster.name}?`}
      </p>

      {loading && <p className="text-stone-400 text-sm">Loading preview…</p>}
      {error && <p className="text-red-500 text-sm">{error}</p>}

      {!loading && preview && direction === 'deactivate' && (
        <ul className="text-sm text-stone-600 space-y-1 list-disc list-inside">
          <li>
            {(preview as DeactivationPreview).coffees.filter(c => c.isActive).length} coffee(s),{' '}
            {(preview as DeactivationPreview).blends.active} blend(s), and{' '}
            {(preview as DeactivationPreview).aliases.active} slot alias(es) will be marked inactive.
          </li>
          {(preview as DeactivationPreview).slotsGoingEmpty.length > 0 && (
            <li>
              {(preview as DeactivationPreview).slotsGoingEmpty.length} dial slot(s) will have no coffee until another roastery fills them:{' '}
              {(preview as DeactivationPreview).slotsGoingEmpty.map(s => `${archetypeLabel(s.archetype)} · ${s.platformName}`).join(', ')}.
            </li>
          )}
          {(preview as DeactivationPreview).archetypesLosingDefault.length > 0 && (
            <li>
              {(preview as DeactivationPreview).archetypesLosingDefault.length} archetype(s) will need a new default:{' '}
              {(preview as DeactivationPreview).archetypesLosingDefault.map(archetypeLabel).join(', ')}.
            </li>
          )}
          {(preview as DeactivationPreview).hopsGoingDark > 0 && (
            <li>{(preview as DeactivationPreview).hopsGoingDark} hop(s) will pause.</li>
          )}
          {(preview as DeactivationPreview).openOrderLines > 0 && (
            <li>{(preview as DeactivationPreview).openOrderLines} order line(s) not yet fulfilled reference this roastery.</li>
          )}
          {(preview as DeactivationPreview).activeSubscribersOnTheseSlots > 0 && (
            <li>{(preview as DeactivationPreview).activeSubscribersOnTheseSlots} subscriber(s) currently receive a coffee from this roastery (approximate).</li>
          )}
          {((preview as DeactivationPreview).alreadyManuallyInactive.coffees > 0
            || (preview as DeactivationPreview).alreadyManuallyInactive.blends > 0
            || (preview as DeactivationPreview).alreadyManuallyInactive.aliases > 0) && (
            <li className="text-stone-400">
              Already inactive (left as-is): {(preview as DeactivationPreview).alreadyManuallyInactive.coffees} coffee(s),{' '}
              {(preview as DeactivationPreview).alreadyManuallyInactive.blends} blend(s),{' '}
              {(preview as DeactivationPreview).alreadyManuallyInactive.aliases} alias(es).
            </li>
          )}
        </ul>
      )}

      {!loading && preview && direction === 'reactivate' && (
        <ul className="text-sm text-stone-600 space-y-1 list-disc list-inside">
          <li>
            {(preview as ReactivationPreview).coffees.length} coffee(s),{' '}
            {(preview as ReactivationPreview).blends.toRestore} blend(s), and{' '}
            {(preview as ReactivationPreview).aliases.toRestore} slot alias(es) will be restored.
          </li>
          {(preview as ReactivationPreview).coffees.length > 0 && (
            <li className="text-stone-400">{(preview as ReactivationPreview).coffees.map(c => c.name).join(', ')}</li>
          )}
        </ul>
      )}

      {direction === 'deactivate' && (
        <div>
          <label className="block text-xs text-stone-500 mb-1">Note <span className="opacity-60">(optional)</span></label>
          <input value={note} onChange={e => setNote(e.target.value)}
            className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
            placeholder="e.g. pausing while we renegotiate terms" />
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={submitting}
          className="px-4 py-2 rounded text-sm border border-stone-200 text-stone-500 hover:bg-stone-50 disabled:opacity-50">
          Cancel
        </button>
        <button type="button" onClick={handleConfirm} disabled={submitting || loading}
          className="px-5 py-2 rounded text-sm font-normal text-white disabled:opacity-50"
          style={{ backgroundColor: '#b05642' }}>
          {submitting ? 'Saving…' : direction === 'deactivate' ? `Deactivate ${roaster.name}` : `Reactivate ${roaster.name}`}
        </button>
      </div>
    </div>
  );
}

export default function AdminRoasters() {
  const { user } = useAuth();
  const [roasters, setRoasters]       = useState<Roaster[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId]     = useState<string | null>(null);
  // Roastery lifecycle (2026-08-25) — which row has its Deactivate/Reactivate
  // confirm panel open, and a one-line post-success summary to show next.
  const [lifecycleFor, setLifecycleFor] = useState<{ id: string; direction: 'deactivate' | 'reactivate' } | null>(null);
  const [summary, setSummary] = useState('');

  async function getToken() { return user!.getIdToken(); }

  async function load() {
    try {
      const res = await fetch('/api/admin/roasters', {
        headers: { Authorization: `Bearer ${await getToken()}` },
      });
      const data = await res.json();
      // Guard: if API returned an error object instead of an array, show error
      if (!Array.isArray(data)) {
        setError(data?.error ?? 'Failed to load roasteries');
        setRoasters([]);
      } else {
        setRoasters(data);
        setError('');
      }
    } catch (err) {
      reportError('[AdminRoasters/load]', err);
      setError('Failed to load roasteries');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (user) load(); }, [user]);

  async function handleAdd(data: RoasterFormData) {
    const res = await fetch('/api/admin/roasters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken()}` },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to add');
    setShowAddForm(false); await load();
  }

  async function handleEdit(id: string, data: RoasterFormData) {
    const res = await fetch(`/api/admin/roasters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken()}` },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to update');
    setEditingId(null); await load();
  }

  // Roastery lifecycle (2026-08-25) — called by RoasterLifecycleDialog on a
  // successful deactivate/reactivate. Reloads the list and, on deactivate
  // with archetypes losing their default, surfaces a link to Coffees.
  async function handleLifecycleDone(roasterName: string, summaryInfo: { archetypesLosingDefault?: string[] }) {
    setLifecycleFor(null);
    await load();
    if (summaryInfo.archetypesLosingDefault?.length) {
      setSummary(`${roasterName} deactivated. Review defaults on the Coffees page →`);
    } else {
      setSummary(`${roasterName} updated.`);
    }
  }

  function roasterToForm(r: Roaster): RoasterFormData {
    return {
      name: r.name, api_endpoint: r.api_endpoint ?? '',
      avg_fulfillment_hours: r.avg_fulfillment_hours?.toString() ?? '',
      roaster_notes: r.roaster_notes ?? '', address: r.address ?? '',
      email: r.email ?? '', phone: r.phone ?? '',
      contact_person: r.contact_person ?? '', website: r.website ?? '',
    };
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-normal text-stone-800">Roasteries</h1>
        <button onClick={() => { setShowAddForm(v => !v); setEditingId(null); }}
          className="px-4 py-2 rounded text-sm font-normal text-white hover:opacity-80"
          style={{ backgroundColor: '#b05642' }}>
          {showAddForm ? 'Cancel' : '+ Add Roastery'}
        </button>
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      {summary && (
        <p className="text-sm text-stone-600 mb-4">
          {summary.includes('Coffees page →') ? (
            <>
              {summary.replace('Review defaults on the Coffees page →', '')}
              <Link to="/admin/coffees" className="underline hover:text-stone-800">Review defaults on the Coffees page →</Link>
            </>
          ) : summary}
        </p>
      )}

      {showAddForm && (
        <div className="border border-stone-200 rounded-lg p-6 mb-6 bg-stone-50">
          <RoasterForm
            initial={EMPTY_FORM}
            onSave={handleAdd}
            onCancel={() => setShowAddForm(false)}
            submitLabel="Add Roastery"
          />
        </div>
      )}

      {loading && <p className="text-stone-400 text-sm py-8 text-center">Loading…</p>}

      {!loading && roasters.length === 0 && !showAddForm && (
        <div className="py-12 text-center text-stone-400">
          <p className="text-lg mb-1">No roasteries yet</p>
          <p className="text-sm">Click "+ Add Roastery" to add your first partner roastery.</p>
        </div>
      )}

      <div className="space-y-3">
        {roasters.map(r => (
          <div key={r.id} className="border border-stone-200 rounded-lg overflow-hidden">
            <div className="flex items-start justify-between px-5 py-4 hover:bg-stone-50 transition-colors">
              <div className="space-y-1 flex-1 min-w-0 pr-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-normal text-stone-800">{r.name}</p>
                  {/* Status badge — not clickable, per Decision 4; the action lives in the button to its right. */}
                  <span
                    title={r.is_active ? undefined : (r.deactivation_note || undefined)}
                    className={`px-2 py-0.5 rounded-full text-xs font-normal ${
                      r.is_active ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-400'
                    }`}>
                    {r.is_active
                      ? 'Active'
                      : `Inactive${r.deactivated_at ? ` since ${new Date(r.deactivated_at).toLocaleDateString()}` : ''}`}
                  </span>
                  {r.coffees > 0 && (
                    <span className="text-xs text-stone-400">{r.active_coffees}/{r.coffees} coffees active</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-stone-500">
                  {r.contact_person && <span>👤 {r.contact_person}</span>}
                  {r.email          && <span>✉ {r.email}</span>}
                  {r.phone          && <span>📞 {r.phone}</span>}
                  {r.address        && <span>📍 {r.address}</span>}
                  {r.website        && (
                    <a href={r.website} target="_blank" rel="noreferrer"
                      className="underline hover:text-stone-700">
                      🔗 Website
                    </a>
                  )}
                  {r.avg_fulfillment_hours != null && (
                    <span>⏱ {r.avg_fulfillment_hours}h fulfillment</span>
                  )}
                </div>
                {r.roaster_notes && (
                  <p className="text-xs text-stone-400 truncate max-w-xl">{r.roaster_notes}</p>
                )}
              </div>
              <div className="shrink-0 flex items-center gap-2">
                <button
                  onClick={() => { setLifecycleFor({ id: r.id, direction: r.is_active ? 'deactivate' : 'reactivate' }); setEditingId(null); setSummary(''); }}
                  className="px-3 py-1.5 rounded text-xs font-normal border border-stone-200 text-stone-500 hover:bg-stone-100">
                  {r.is_active ? 'Deactivate…' : 'Reactivate'}
                </button>
                <button
                  onClick={() => setEditingId(editingId === r.id ? null : r.id)}
                  className="px-3 py-1.5 rounded text-xs font-normal border border-stone-200 text-stone-500 hover:bg-stone-100">
                  {editingId === r.id ? 'Cancel' : '✏️ Edit'}
                </button>
              </div>
            </div>

            {editingId === r.id && (
              <div className="border-t border-stone-200 px-5 py-5 bg-stone-50">
                <RoasterForm
                  initial={roasterToForm(r)}
                  onSave={data => handleEdit(r.id, data)}
                  onCancel={() => setEditingId(null)}
                  submitLabel="Save Changes"
                />
              </div>
            )}

            {lifecycleFor?.id === r.id && (
              <RoasterLifecycleDialog
                roaster={r}
                direction={lifecycleFor.direction}
                getToken={getToken}
                onDone={info => handleLifecycleDone(r.name, info)}
                onCancel={() => setLifecycleFor(null)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
