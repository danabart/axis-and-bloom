import { useEffect, useState } from 'react';
import type { ArchetypeOrderPayload, RelationshipCode, RelationshipKind } from './api';
import { reportError } from './errorReporter';

// Website 9 (2026-11-06, D16): the one client of GET /api/coffees/archetype-order.
// The Bloom tabs, the Shop sections, the comfort-zone pill and the
// compatibility badge all read the family order, each family's relationship
// and every relationship word from this payload (one reader path), cached per
// customer family for the page's life.
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_9_REVIEW_FIXES.md

const cache = new Map<string, Promise<ArchetypeOrderPayload>>();

/** GET /api/coffees/archetype-order?archetype= (archetypeRelationshipReads.getArchetypeOrderPayload). */
async function getArchetypeOrderPayload(archetype: string | null): Promise<ArchetypeOrderPayload> {
  const qs = archetype ? `?archetype=${encodeURIComponent(archetype)}` : '';
  const res = await fetch(`/api/coffees/archetype-order${qs}`);
  if (res.ok === false) throw new Error('Failed to load archetype order');
  const body = await res.json();
  return { order: body.order ?? [], relationships: body.relationships, kinds: body.kinds ?? [] };
}

function load(archetype: string | null): Promise<ArchetypeOrderPayload> {
  const key = archetype ?? '';
  let p = cache.get(key);
  if (!p) {
    p = getArchetypeOrderPayload(archetype).catch(err => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, p);
  }
  return p;
}

/** Test hook: forget every cached payload. */
export function resetArchetypeRelationshipsCache() { cache.clear(); }

export interface ArchetypeRelationships {
  /** the family order (the customer's first); null until settled or on error */
  order: string[] | null;
  /** a family's relationship code; null for a guest, a family with no evidence, or a non-flavor family */
  codeOf: (archetype: string) => RelationshipCode | null;
  /** the customer-facing word beside a family ("Your family", …); null when there is none */
  labelOf: (archetype: string) => string | null;
  kinds: RelationshipKind[];
  /** true once the payload answered (or failed) */
  settled: boolean;
}

/**
 * The relationships for a customer family (null = a guest: the order and the
 * words, no relationships). `enabled` false waits (e.g. while the customer's
 * family is still loading).
 */
export function useArchetypeRelationships(archetype: string | null, enabled = true): ArchetypeRelationships {
  const [payload, setPayload] = useState<ArchetypeOrderPayload | null>(null);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setSettled(false);
    load(archetype)
      .then(p => { if (alive) setPayload(p); })
      .catch(err => { reportError('[useArchetypeRelationships]', err); if (alive) setPayload(null); })
      .finally(() => { if (alive) setSettled(true); });
    return () => { alive = false; };
  }, [archetype, enabled]);
  const rel = new Map((payload?.relationships ?? []).map(r => [r.archetype, r]));
  return {
    order: payload?.order ?? null,
    codeOf: a => rel.get(a)?.code ?? null,
    labelOf: a => rel.get(a)?.customerLabel ?? null,
    kinds: payload?.kinds ?? [],
    settled,
  };
}

/** The relationship words alone (the pill and the badge), from the guest payload. */
export function useRelationshipKinds(): RelationshipKind[] {
  return useArchetypeRelationships(null).kinds;
}
