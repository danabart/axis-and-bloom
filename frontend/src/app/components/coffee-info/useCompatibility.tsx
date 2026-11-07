import { useEffect, useState } from 'react';
import { ARCHETYPE_LABEL, ARCHETYPE_COLOR } from './archetypeConstants';
import { reportError } from '../../lib/errorReporter';
import { useArchetypeRelationships, useRelationshipKinds } from '../../lib/useArchetypeRelationships';
import type { RelationshipKind } from '../../lib/api';

export { ARCHETYPE_LABEL, ARCHETYPE_COLOR };

export type CompatLevel = 'wheelhouse' | 'exploring' | 'stretch';

/** Website 5 (2026-11-05): The Bloom's comfort-zone pill, from GET /:id/compatibility's `zone`. */
export type ComfortZone = 'in' | 'edge' | 'outside';

// Website 9 (2026-11-06, Dana's Q1 = C, Q2): the family level is the server's
// relationship (archetypeRelationshipReads: hops, else the cupped-profile
// distance), not a second read of the adjacency; every word (the pill, the
// badge) is a column of coffee_archetype_relationship_kind. Nothing typed.

/** The pill for a coffee: the server's per-coffee zone when it has one, else the family level's zone. */
export function comfortZoneOf(compat: CompatLevel | null, zone: ComfortZone | null, kinds: RelationshipKind[]): ComfortZone | null {
  if (zone) return zone;
  if (!compat) return null;
  return (kinds.find(k => k.badgeCode === compat)?.zoneCode as ComfortZone | undefined) ?? null;
}

/** The pill's words for a zone, from the lookup. */
export function zoneLabelOf(zone: ComfortZone | null, kinds: RelationshipKind[]): string | null {
  return zone ? kinds.find(k => k.zoneCode === zone)?.zoneLabel ?? null : null;
}

// Part 13/15: the one pill styling for CompatibilityBadge (Website 9: on the tokens).
const BADGE_STYLE: Record<CompatLevel, { bg: string; text: string; border: string }> = {
  wheelhouse: { bg: 'var(--ab-ink)', text: 'var(--ab-page)', border: 'transparent' },
  exploring: { bg: 'transparent', text: 'var(--ab-ink)', border: 'var(--ab-ink)' },
  stretch: { bg: 'transparent', text: 'var(--ab-ink)', border: 'var(--ab-ink-hairline)' },
};
const BADGE_PILL_CLASS = 'self-start text-[10.5px] uppercase tracking-[.16em] px-4 py-[7px] rounded-full border font-normal whitespace-nowrap';

/**
 * Compatibility level + the dimension sentence for a coffee, given the
 * customer's family. The level is the coffee's family's relationship to hers
 * (own → wheelhouse, adjacent → exploring, distant → stretch, through the
 * lookup's badge_code); null for a guest, for a family with no evidence and for
 * a non-flavor family (Experimental, the categories). Coffee presentation
 * brief 2: the sentence and the per-coffee zone come from
 * GET /api/coffees/:id/compatibility; pass a null coffeeId to skip them.
 */
export function useCompatibility(coffeeArchetype: string | null, userArchetype: string | null, coffeeId: number | null) {
  const rel = useArchetypeRelationships(userArchetype, !!userArchetype);
  const code = coffeeArchetype && userArchetype ? rel.codeOf(coffeeArchetype) : null;
  const compat = (code ? rel.kinds.find(k => k.code === code)?.badgeCode as CompatLevel | undefined : undefined) ?? null;
  const [dimCompText, setDimCompText] = useState<string | null>(null);
  const [zone, setZone] = useState<ComfortZone | null>(null);
  const wanted = !!(coffeeArchetype && userArchetype && coffeeId);
  useEffect(() => {
    setDimCompText(null);
    setZone(null);
    if (!wanted) return;
    let alive = true;
    fetch(`/api/coffees/${coffeeId}/compatibility?userArchetype=${encodeURIComponent(userArchetype!)}`)
      .then(r => r.json())
      .then((data: { sentence?: string | null; zone?: ComfortZone | null }) => {
        if (!alive) return;
        setDimCompText(data.sentence ?? null);
        setZone(data.zone ?? null);
      })
      .catch(err => reportError('[useCompatibility/compatibility]', err));
    return () => { alive = false; };
  }, [wanted, coffeeId, userArchetype]);
  const comfortZone = comfortZoneOf(compat, zone, rel.kinds);
  return { compat, dimCompText, zone, comfortZone, comfortZoneLabel: zoneLabelOf(comfortZone, rel.kinds) };
}

/**
 * The compatibility pill (reveal panel Row 1, Flavor Intelligence), its words
 * from the lookup's badge_label. Website 9: the old stretch-tier apology line
 * is gone (G4.4: an honest state label, no apologetic follow-up).
 */
export function CompatibilityBadge({ level }: { level: CompatLevel; userArchetype?: string; variant?: 'default' | 'reveal' }) {
  const kinds = useRelationshipKinds();
  const label = kinds.find(k => k.badgeCode === level)?.badgeLabel;
  if (!label) return null;
  const c = BADGE_STYLE[level];
  return (
    <span className={BADGE_PILL_CLASS} style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }} data-testid="compat-badge">
      {label}
    </span>
  );
}
