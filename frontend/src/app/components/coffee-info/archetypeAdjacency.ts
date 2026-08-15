import { useEffect, useState } from 'react';
import { reportError } from '../../lib/errorReporter';

type AdjacencyMap = Record<string, string[]>;

let cache: AdjacencyMap | null = null;
let inflight: Promise<AdjacencyMap> | null = null;

// Real, hop-derived archetype adjacency — GET /api/axis/adjacency reads
// v_archetype_adjacency, the same view already shown on the Bloom Dial admin
// page and fed by actual authored bridge hops (dial_coffee_relationships),
// not the separate (unused, empty) archetype_relationship table.
async function loadAdjacency(): Promise<AdjacencyMap> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetch('/api/axis/adjacency')
      .then(r => r.json())
      .then((data: { adjacency?: AdjacencyMap }) => {
        cache = data.adjacency ?? {};
        return cache;
      })
      .catch(err => { reportError('[archetypeAdjacency/load]', err); cache = {}; return cache; });
  }
  return inflight;
}

/** Which archetypes count as "adjacent" to a given one, from real bridge-hop data. */
export function useArchetypeAdjacency(): AdjacencyMap {
  const [adjacency, setAdjacency] = useState<AdjacencyMap>(cache ?? {});
  useEffect(() => {
    let alive = true;
    loadAdjacency().then(a => { if (alive) setAdjacency(a); });
    return () => { alive = false; };
  }, []);
  return adjacency;
}
