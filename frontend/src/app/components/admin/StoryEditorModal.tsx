import { useState } from 'react';
import { reportError } from '../../lib/errorReporter';

// Extracted out of AdminCoffees.tsx verbatim (Catalog Blueprint brief 4, Part
// B — "carried over as extracted components, not rewritten"). Still reads/
// writes PATCH /api/admin/coffees/:id/story and POST .../refresh-content —
// content endpoints, untouched by this brief (Task 0's "keep" list).
export interface StoryEditorCoffee {
  id: number; name: string;
  story: string | null; story_draft: string | null;
  story_published: boolean; story_admin_edited: boolean;
}

export default function StoryEditorModal({ coffee, apiFetch, onClose, onSaved }: {
  coffee: StoryEditorCoffee;
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [storyDraft, setStoryDraft] = useState(coffee.story ?? coffee.story_draft ?? '');
  const [storySaving, setStorySaving] = useState(false);
  const [storyViolations, setStoryViolations] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  async function handleSave(force = false) {
    setStorySaving(true);
    setStoryViolations([]);
    try {
      const res = await apiFetch(`/api/admin/coffees/${coffee.id}/story`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ story: storyDraft, force }),
      });
      const j = await res.json();
      if (res.status === 409) { setStoryViolations(j.violations ?? []); return; }
      if (!res.ok) throw new Error(j.error ?? 'Failed to save');
      await onSaved();
      onClose();
    } catch (err: unknown) {
      reportError('[StoryEditorModal/save]', err);
      setStoryViolations([err instanceof Error ? err.message : 'Failed to save']);
    } finally {
      setStorySaving(false);
    }
  }

  async function handleRefreshContent() {
    setRefreshing(true);
    try {
      const res = await apiFetch(`/api/admin/coffees/${coffee.id}/refresh-content`, { method: 'POST' });
      if (!res.ok) { const body = await res.json().catch(() => ({})); alert(body.error ?? 'Failed to refresh content'); return; }
      await onSaved();
    }
    catch (err) { reportError('[StoryEditorModal/refresh-content]', err); } finally { setRefreshing(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-xl w-full p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-normal text-stone-800">Story — {coffee.name}</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full ${coffee.story_published ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
            {coffee.story_published ? 'Published' : 'Unpublished draft'}
          </span>
        </div>
        {coffee.story_admin_edited && (
          <p className="text-xs text-stone-400 mb-2">Admin-edited — bulk regenerate will not overwrite this.</p>
        )}
        <textarea
          value={storyDraft}
          onChange={e => setStoryDraft(e.target.value)}
          rows={8}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          placeholder="120–200 words. Region and process only — never a farm, co-op, lot, estate, importer, or roaster name."
        />
        {storyViolations.length > 0 && (
          <div className="mt-2 text-xs text-red-500">
            <p>Specificity check failed:</p>
            <ul className="list-disc list-inside">{storyViolations.map((v, i) => <li key={i}>{v}</li>)}</ul>
          </div>
        )}
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={handleRefreshContent}
            disabled={refreshing}
            className="text-xs text-stone-400 hover:text-stone-600 disabled:opacity-50"
          >
            {refreshing ? 'Regenerating…' : 'Regenerate'}
          </button>
          <div className="flex gap-3">
            {storyViolations.length > 0 && (
              <button
                onClick={() => handleSave(true)}
                disabled={storySaving}
                className="px-3 py-1.5 text-xs text-amber-700 border border-amber-300 rounded hover:bg-amber-50 disabled:opacity-50"
              >
                Save anyway
              </button>
            )}
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-700">
              Cancel
            </button>
            <button
              onClick={() => handleSave(false)}
              disabled={storySaving || !storyDraft.trim()}
              className="px-4 py-1.5 text-xs text-white rounded disabled:opacity-50"
              style={{ backgroundColor: '#b05642' }}
            >
              {storySaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
