import { useEffect, useState } from 'react';
import { ARCHETYPE_LABEL } from './archetypeConstants';

type VectorMap = Record<string, Partial<Record<string, [number, number]>>>;

const ENUM_BY_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(ARCHETYPE_LABEL).map(([enumKey, label]) => [label, enumKey])
);

let cache: VectorMap | null = null;
let inflight: Promise<VectorMap> | null = null;

// Real, calibrated per-archetype dimension target ranges — GET /api/axis/vectors
// already existed (built for The Axis page, WHAT_WE_BUILT.md #51) and reads the
// same archetype_vector table/v_archetype_vectors view The Axis's own copy
// deck describes. Single fetch, shared across every card via this module-level
// cache rather than one request per position card.
async function loadVectors(): Promise<VectorMap> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetch('/api/axis/vectors')
      .then(r => r.json())
      .then((data: { archetypes: { name: string; dimensions: { name: string; min: number; max: number }[] }[] }) => {
        const map: VectorMap = {};
        for (const a of data.archetypes ?? []) {
          const enumKey = ENUM_BY_LABEL[a.name] ?? a.name;
          const dims: Partial<Record<string, [number, number]>> = {};
          for (const d of a.dimensions ?? []) dims[d.name] = [d.min, d.max];
          map[enumKey] = dims;
        }
        cache = map;
        return map;
      })
      .catch(() => { cache = {}; return cache; });
  }
  return inflight;
}

/** Real per-archetype dimension target ranges (min/max), keyed by archetype_enum then dimension name. */
export function useArchetypeVectors(): VectorMap {
  const [vectors, setVectors] = useState<VectorMap>(cache ?? {});
  useEffect(() => {
    let alive = true;
    loadVectors().then(v => { if (alive) setVectors(v); });
    return () => { alive = false; };
  }, []);
  return vectors;
}
