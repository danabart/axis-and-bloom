import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

// Catalog Blueprint brief 4, Part C — every admin component that shows an
// archetype name fetches labels from GET /api/admin/catalog/archetypes
// (v_coffee_archetype) through this hook, instead of importing the public
// frontend's hardcoded archetype-label map (a separate thread owns the
// "Balanced" rename for that file — this hook is the admin-only equivalent,
// always live). Module-scope cache: one fetch per page load, shared across
// every component instance that mounts this hook, matching
// catalogReads.getArchetypes()'s own 60s-cache posture on the backend.

export interface AdminArchetype {
  code: string;
  label: string;
  description: string | null;
  sort_order: number;
  has_bloom_dial: boolean;
  is_archetype: boolean;
  dominant_dimension_id: number | null;
  dominant_dimension_name: string | null;
  descriptor_families: string[];
}

let cache: AdminArchetype[] | null = null;
let inflight: Promise<AdminArchetype[]> | null = null;

async function fetchArchetypes(idToken: string): Promise<AdminArchetype[]> {
  const res = await fetch('/api/admin/catalog/archetypes', {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) throw new Error('Failed to fetch archetypes');
  return res.json();
}

export function useArchetypes(): { archetypes: AdminArchetype[]; loading: boolean; error: string } {
  const { user } = useAuth();
  const [archetypes, setArchetypes] = useState<AdminArchetype[]>(cache ?? []);
  const [loading, setLoading] = useState(cache == null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (cache) { setArchetypes(cache); setLoading(false); return; }
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        inflight ??= fetchArchetypes(idToken);
        const rows = await inflight;
        cache = rows;
        if (!cancelled) { setArchetypes(rows); setError(''); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to fetch archetypes');
      } finally {
        inflight = null;
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  return { archetypes, loading, error };
}

// A single label lookup, for a component that just needs "code -> label" and
// doesn't want to re-derive it from the full archetype list every render.
export function useArchetypeLabel(code: string | null | undefined): string {
  const { archetypes } = useArchetypes();
  if (!code) return '';
  return archetypes.find(a => a.code === code)?.label ?? code;
}
