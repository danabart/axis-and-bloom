import { db } from '../db/client.js';
import type { Tx } from '../db/client.js';
import { getSommelierConfig } from './sommelierConfig.js';
import {
  archetypeCode, archetypeLabel, getCoffees, getSellableSlots, getSlotsForCoffees, getHops, getAnchorSize,
} from './catalogReads.js';

// Catalog Blueprint · brief 3 (2026-09-14) — Liam's candidate pool is now
// D2's rule: every ragFocus draws from v_coffee_sellable_slot at 12oz, joined
// to v_coffee for match_archetype (reasoning) — never archetype_assignments
// or coffees directly. The alias text still names the SLOT (placement),
// never the coffee's raw internal name or roaster. getDescriptors is
// unchanged (cupping tables, not a placement question).

// Liam L1, Part B (2026-09-28) — the getSlotCandidates() row shape this file
// needs (a subset of v_palate_slot_candidates' real columns — see
// liamProfile.ts's own SlotCandidateRow for the full list and the Task 0 note
// on why these six customerReads.ts reads are untyped Record<string,
// unknown> passthroughs).
export interface SlotCandidate {
  coffee_id: number;
  already_bought: boolean;
  last_rating: number | null;
}

export type CoffeeSlice = 'palate' | 'primary' | 'secondary' | 'thread' | 'focus' | 'had';

export interface RagParams {
  ragFocus: string;
  userArchetype: string | null;
  previousArchetype?: string | null;
  excludeCoffeeIds?: number[];
  // Names, like userArchetype/previousArchetype above — converted to codes
  // internally via archetypeCode(), same convention (Task 0 confirmed
  // v_customer_quiz_current.explore_archetype has no paired _code column the
  // way secondary_archetype/secondary_archetype_code does, so this must be a
  // name, resolved here, not assumed to already be a code).
  secondaryArchetype?: string | null;
  exploreArchetype?: string | null;
  // Already ordered by v_palate_slot_candidates' own v1 rules (Dana's
  // review) — this file never re-sorts them.
  slotCandidates?: SlotCandidate[];
  dislikedCoffeeIds?: number[];
}

export interface RagResult {
  catalogText: string;
  coffeeIds: number[];
  // Why each coffee is in the catalog — L3's later write-back detection reads
  // this; 'had' is the palate slice's own already-bought coffees (kept
  // distinct from a not-yet-tried 'palate' pick, both rendered with the same
  // "[palate match]" label text plus a "[had before, rated n]" suffix for
  // 'had' specifically — see buildCatalogText below).
  slices: Array<{ coffeeId: number; slice: CoffeeSlice }>;
}

interface CoffeeRow {
  id: number;
  name: string;
  archetype: string; // match_archetype
  ai_summary: string | null;
  surprise_note: string | null;
}

// Editorial-completeness first (has an ai_summary and/or surprise_note),
// lowest id as the deterministic tiebreak — exact_match's own sort, reused
// unchanged by the new thread slice (Part B: "id order, editorial-
// completeness first as exact_match does").
function editorialSort(a: CoffeeRow, b: CoffeeRow): number {
  const score = (c: CoffeeRow) => (c.ai_summary != null ? 1 : 0) + (c.surprise_note != null ? 1 : 0);
  return score(b) - score(a) || a.id - b.id;
}

async function getDescriptors(coffeeIds: number[]): Promise<Map<number, string[]>> {
  if (!coffeeIds.length) return new Map();
  const result = await db.query(
    `SELECT coffee_id, descriptor
     FROM v_collaborative_flavor_wheel
     WHERE coffee_id = ANY($1::int[])
     GROUP BY coffee_id, descriptor
     ORDER BY coffee_id, COUNT(*) DESC`,
    [coffeeIds]
  );
  const map = new Map<number, string[]>();
  for (const row of result.rows) {
    const existing = map.get(row.coffee_id) ?? [];
    if (existing.length < 4) {
      existing.push(row.descriptor);
      map.set(row.coffee_id, existing);
    }
  }
  return map;
}

// Axis & Bloom alias per coffee — the only customer-facing identity Liam's
// catalog context may use (never the roaster's raw internal name). Catalog
// Blueprint brief 3: name = the coffee's current active home slot's name;
// fallback to any active guest slot name (v_coffee_slot, home-first order);
// else the coffee's own name. No coffee_alias, no three-table DISTINCT ON.
// Liam L1 (2026-09-28) — runner param added so a caller inside an owner
// transaction (liamProfile.test.ts, loadProfileReads()) can pass its own `tx`
// through to the two catalogReads.ts queries below; every existing caller
// (routes/*, services/beatEngine.ts, etc.) is unaffected — default is
// unchanged (`db`).
export async function getAliases(coffeeIds: number[], runner: Tx | typeof db = db): Promise<Map<number, string>> {
  if (!coffeeIds.length) return new Map();
  const map = new Map<number, string>();
  const slots = await getSlotsForCoffees(coffeeIds, runner);
  for (const slot of slots) {
    if (map.has(slot.coffee_id)) continue; // already have this coffee's best slot (home, else first guest by priority)
    if (slot.slot_name) map.set(slot.coffee_id, slot.slot_name);
  }
  const unresolved = coffeeIds.filter(id => !map.has(id));
  if (unresolved.length) {
    const coffees = await getCoffees({ ids: unresolved }, runner);
    for (const c of coffees) map.set(c.id, c.name);
  }
  return map;
}

// Hardcoded fallback adjacency, keyed by archetype CODE (brief 3 — was
// display name) — used whenever the real graph has nothing to say (a thrown
// query error, or a genuinely empty result). Both cases are equally "no real
// data," never distinguished before HOME_TASK_9B's fix.
const FALLBACK_ADJACENCY: Record<string, string[]> = {
  floral: ['fruity', 'experimental'],
  fruity: ['floral', 'balanced_sweet'],
  balanced_sweet: ['fruity', 'chocolate_nutty'],
  chocolate_nutty: ['balanced_sweet', 'earthy'],
  earthy: ['chocolate_nutty', 'experimental'],
  experimental: ['floral', 'earthy'],
};

// HOME_TASK_9B (S89) — reads v_coffee_archetype_adjacency, the same real,
// actively-curated hop-derived view GET /api/axis/adjacency and the admin
// Bloom Dial page already read (brief 3: now derived from v_coffee_hop —
// see schema.sql). Already archetype_enum-keyed, so no toEnum round-trip is
// needed here anymore — callers pass a code, this expects one.
async function getAdjacentArchetypes(archetypeCodeValue: string): Promise<string[]> {
  try {
    const result = await db.query(
      `SELECT
         CASE WHEN archetype_a = $1 THEN archetype_b ELSE archetype_a END AS adjacent
       FROM v_coffee_archetype_adjacency
       WHERE archetype_a = $1 OR archetype_b = $1
       ORDER BY hop_count DESC
       LIMIT 5`,
      [archetypeCodeValue]
    );
    if (result.rows.length > 0) {
      return result.rows.map((r: { adjacent: string }) => r.adjacent);
    }
    // Empty is not an error — but it's exactly as "no real data" as one, and
    // the pre-fix code only fell back on a throw. Unmissable-log-tag pattern
    // from 7d/S85: a distinct, greppable tag with real context attached, not
    // a warn nobody reads.
    console.error('[sommelierRag:ADJACENCY_EMPTY_FALLBACK] v_coffee_archetype_adjacency returned zero rows for', archetypeCodeValue, '— using hardcoded fallback adjacency');
    return FALLBACK_ADJACENCY[archetypeCodeValue] ?? [];
  } catch (err) {
    console.error('[sommelierRag:ADJACENCY_QUERY_FAILED] v_coffee_archetype_adjacency query failed for', archetypeCodeValue, '— using hardcoded fallback adjacency', err);
    return FALLBACK_ADJACENCY[archetypeCodeValue] ?? [];
  }
}

// Liam L1, Part B — labelText is pre-computed per coffee during composition
// (fetchSommelierCoffees) from its slice + slot-candidate rating, never
// derived here; this function only prints whatever it's given, after the
// archetype label on the coffee's first line, exactly like the existing
// alias/archetype-label rendering it sits beside.
async function buildCatalogText(
  coffees: CoffeeRow[], descriptors: Map<number, string[]>, aliases: Map<number, string>, labelText: Map<number, string> = new Map()
): Promise<string> {
  if (!coffees.length) return 'YOUR CURRENT CATALOG — no coffees available at this time.';

  const lines: string[] = [
    'YOUR CURRENT CATALOG — Liam may only recommend coffees from this list. Labels say why each is here; never read a label aloud.',
  ];
  for (const c of coffees) {
    const archetypeLabelStr = await archetypeLabel(c.archetype);
    const descs = descriptors.get(c.id) ?? [];
    // Alias only — never the roaster name or the coffee's raw internal name (see
    // SOMMELIER_TASK_6_VOICE.md Step 2b; this previously leaked both directly
    // into every Liam session's system prompt context).
    const displayName = aliases.get(c.id) ?? archetypeLabelStr;
    const label = labelText.get(c.id);
    lines.push('---');
    lines.push(`${displayName} — ${archetypeLabelStr}${label ? ` ${label}` : ''}`);
    lines.push(`Tasting note: ${c.ai_summary ?? 'Not yet available'}`);
    lines.push(`What's unexpected: ${c.surprise_note ?? 'Not yet available'}`);
    lines.push(`Key flavors: ${descs.length ? descs.join(', ') : 'Not yet available'}`);
  }
  lines.push('---');
  return lines.join('\n');
}

// D2 — the one candidate pool every ragFocus draws from: coffees currently
// sellable at 12oz (v_coffee_sellable_slot), joined to v_coffee for
// match_archetype/name/summary. A coffee occupying two sellable slots (a
// guest fulfilling its own slot plus someone else's) only ever appears once
// here, keyed by coffee id, which is what every focus below actually wants —
// "is this coffee a real recommendation candidate," not "how many slots."
async function getCandidatePool(): Promise<CoffeeRow[]> {
  const sellable = await getSellableSlots({ weightOz: (await getAnchorSize()).weight_oz }); // D2/S2: anchor size only
  const coffeeIds = [...new Set(sellable.map(s => s.coffee_id))];
  if (!coffeeIds.length) return [];
  const coffees = await getCoffees({ ids: coffeeIds, active: true });
  return coffees
    .filter((c): c is typeof c & { match_archetype: string } => c.match_archetype != null)
    .map(c => ({ id: c.id, name: c.name, archetype: c.match_archetype, ai_summary: c.ai_summary, surprise_note: c.surprise_note }));
}

// Groups the pool by archetype and takes up to `perArchetype` from each
// (lowest coffee id first, stable/deterministic), across `archetypes` in the
// order given, capped at `limit` total.
function pickPerArchetype(pool: CoffeeRow[], archetypes: string[], perArchetype: number, limit: number): CoffeeRow[] {
  const byArchetype = new Map<string, CoffeeRow[]>();
  for (const c of pool) {
    if (!byArchetype.has(c.archetype)) byArchetype.set(c.archetype, []);
    byArchetype.get(c.archetype)!.push(c);
  }
  const picked: CoffeeRow[] = [];
  for (const archetype of archetypes) {
    const rows = (byArchetype.get(archetype) ?? []).sort((a, b) => a.id - b.id).slice(0, perArchetype);
    picked.push(...rows);
    if (picked.length >= limit) break;
  }
  return picked.slice(0, limit);
}

export async function fetchSommelierCoffees(params: RagParams): Promise<RagResult> {
  const config = getSommelierConfig();
  const maxCoffees = config?.ragLimits?.maxCoffees ?? 12;
  const {
    ragFocus, userArchetype, previousArchetype, excludeCoffeeIds = [],
    secondaryArchetype, exploreArchetype, slotCandidates = [], dislikedCoffeeIds = [],
  } = params;
  const userCode = userArchetype ? await archetypeCode(userArchetype) : null;
  // Hoisted so both the generic secondary slice (step 2) and the 'matched'
  // focus's own fill branch (step 4, Liam L2 Part C) can reuse it without a
  // second archetypeCode() lookup.
  const secondaryCode = secondaryArchetype ? await archetypeCode(secondaryArchetype) : null;

  // Liam L1, Part B — composition order: thread, secondary, palate, then
  // today's focus fill for the remainder, every focus, each coffee placed
  // once. `placedIds`/`composed`/`sliceByCoffee` accumulate across all four
  // steps; `pool` already has dislikedCoffeeIds removed before any step sees
  // it (rule 1 of Dana's fixture review), matching v_palate_slot_candidates'
  // own exclusion. Zero thread/secondary/palate input reduces this exactly to
  // today's single-branch composition, since composed.length is 0 going into
  // the fill step and the fill step's own budget is then the full maxCoffees.
  const composed: CoffeeRow[] = [];
  const placedIds = new Set<number>();
  const sliceByCoffee = new Map<number, CoffeeSlice>();
  const labelText = new Map<number, string>();

  try {
    const poolFull = await getCandidatePool();
    const dislikedSet = new Set(dislikedCoffeeIds);
    const pool = poolFull.filter(c => !dislikedSet.has(c.id));

    // 1. Thread slice.
    if (exploreArchetype) {
      const exploreCode = await archetypeCode(exploreArchetype);
      if (exploreCode) {
        const threadLabel = `[thread: ${await archetypeLabel(exploreCode)}]`;
        const threadCoffees = pool.filter(c => c.archetype === exploreCode && !placedIds.has(c.id))
          .sort(editorialSort)
          .slice(0, 2);
        for (const c of threadCoffees) {
          composed.push(c); placedIds.add(c.id); sliceByCoffee.set(c.id, 'thread'); labelText.set(c.id, threadLabel);
        }
      }
    }

    // 2. Secondary slice — skipped for 'matched' (Liam L2, Part C): that
    // focus places primary coffees before secondary ones, entirely within
    // its own fill step below, so it doesn't use this universal slice (which
    // would otherwise place secondary coffees first, ahead of the fill step).
    if (secondaryCode && ragFocus !== 'matched') {
      const secondaryCoffees = pool.filter(c => c.archetype === secondaryCode && !placedIds.has(c.id))
        .sort((a, b) => a.id - b.id)
        .slice(0, 2);
      for (const c of secondaryCoffees) {
        composed.push(c); placedIds.add(c.id); sliceByCoffee.set(c.id, 'secondary'); labelText.set(c.id, '[second archetype]');
      }
    }

    // 3. Palate slice — already ordered by v_palate_slot_candidates (Dana's
    // v1 rules); this file never re-sorts it, only filters/caps. Already-
    // bought candidates are shown, not reordered (rule 2) — just labeled.
    if (slotCandidates.length) {
      const poolById = new Map(pool.map(c => [c.id, c]));
      const palatePicks = slotCandidates
        .filter(sc => !placedIds.has(sc.coffee_id) && poolById.has(sc.coffee_id))
        .slice(0, 4);
      for (const sc of palatePicks) {
        const c = poolById.get(sc.coffee_id)!;
        composed.push(c); placedIds.add(c.id);
        sliceByCoffee.set(c.id, sc.already_bought ? 'had' : 'palate');
        labelText.set(c.id, sc.already_bought ? `[palate match] [had before, rated ${sc.last_rating}]` : '[palate match]');
      }
    }

    // 4. Focus fill — today's branch, unchanged in substance, against the
    // remaining budget (maxCoffees - composed.length so far) instead of the
    // flat maxCoffees, then filtered to drop anything already placed above.
    const fillBudget = Math.max(0, maxCoffees - composed.length);
    let fillCoffees: CoffeeRow[] = [];

    if (ragFocus === 'archetype_range') {
      if (userCode) {
        const adjacent = await getAdjacentArchetypes(userCode);
        const nearestThree = adjacent.slice(0, 2);
        fillCoffees = pickPerArchetype(pool, [userCode, ...nearestThree], 2, fillBudget);
      } else {
        // No archetype: 2 from the 3 most populated archetypes in the pool.
        const counts = new Map<string, number>();
        for (const c of pool) counts.set(c.archetype, (counts.get(c.archetype) ?? 0) + 1);
        const topThree = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a);
        fillCoffees = pickPerArchetype(pool, topThree, 2, fillBudget);
      }

    } else if (ragFocus === 'alternatives') {
      const codes: string[] = userCode ? [userCode] : [];
      if (userCode) {
        const adjacent = await getAdjacentArchetypes(userCode);
        if (adjacent[0]) codes.push(adjacent[0]);
      }

      // Bloom Dial: lighter alternatives via hop direction = 'less', targets
      // filtered to the sellable pool (D2 — never recommend an unsellable hop
      // target). v_coffee_hop, not dial_coffee_relationships directly.
      let dialAlternativeIds: number[] = [];
      if (excludeCoffeeIds.length > 0) {
        try {
          const hops = await getHops({ fromCoffeeId: excludeCoffeeIds, direction: 'less', recommendedOnly: true });
          const poolIds = new Set(pool.map(c => c.id));
          dialAlternativeIds = [...new Set(hops.map(h => h.to_coffee_id).filter(id => poolIds.has(id)))].slice(0, 2);
        } catch (err) {
          console.error('[sommelierRag:DIAL_QUERY_FAILED] alternatives hop query failed — degrading to archetype-only RAG', err);
        }
      }

      const excludeAll = new Set([...excludeCoffeeIds, ...dialAlternativeIds]);
      const archetypeCoffees = pool
        .filter(c => codes.includes(c.archetype) && !excludeAll.has(c.id))
        .sort((a, b) => a.id - b.id)
        .slice(0, fillBudget - dialAlternativeIds.length);

      const dialCoffees = dialAlternativeIds.length
        ? pool.filter(c => dialAlternativeIds.includes(c.id)).sort((a, b) => a.id - b.id)
        : [];
      fillCoffees = [...dialCoffees, ...archetypeCoffees];

    } else if (ragFocus === 'evolution_bridge') {
      const codes: string[] = [];
      if (previousArchetype) { const c = await archetypeCode(previousArchetype); if (c) codes.push(c); }
      if (userCode) codes.push(userCode);
      fillCoffees = pickPerArchetype(pool, codes, 3, fillBudget);

    } else if (ragFocus === 'discovery') {
      // Experimental archetype first.
      fillCoffees = pool.filter(c => c.archetype === 'experimental')
        .sort((a, b) => (a.ai_summary != null ? 0 : 1) - (b.ai_summary != null ? 0 : 1) || a.id - b.id)
        .slice(0, Math.floor(fillBudget / 2));

      // Supplement with bridge_archetype hops from the user's current sellable coffees.
      if (userCode) {
        try {
          const currentIds = pool.filter(c => c.archetype === userCode).sort((a, b) => a.id - b.id).slice(0, 5).map(c => c.id);
          if (currentIds.length > 0) {
            const hops = await getHops({ fromCoffeeId: currentIds, recommendedOnly: true });
            const poolIds = new Set(pool.map(c => c.id));
            const existingIds = new Set(fillCoffees.map(c => c.id));
            const bridgeIds = [...new Set(
              hops.filter(h => h.hop_type_derived === 'bridge_archetype' && poolIds.has(h.to_coffee_id) && !existingIds.has(h.to_coffee_id))
                .map(h => h.to_coffee_id)
            )].slice(0, fillBudget - fillCoffees.length);
            if (bridgeIds.length) {
              fillCoffees = [...fillCoffees, ...pool.filter(c => bridgeIds.includes(c.id)).sort((a, b) => a.id - b.id)];
            }
          }
        } catch (err) {
          console.error('[sommelierRag:DIAL_QUERY_FAILED] discovery bridge-hop query failed — degrading to archetype-only RAG', err);
        }
      }

      // Fill remainder with lowest-affinity archetypes (1 per non-experimental archetype).
      const existingIds = new Set(fillCoffees.map(c => c.id));
      const remainingArchetypes = [...new Set(pool.filter(c => c.archetype !== 'experimental').map(c => c.archetype))];
      const lowAffinity = pickPerArchetype(pool.filter(c => !existingIds.has(c.id)), remainingArchetypes, 1, fillBudget - fillCoffees.length);
      fillCoffees = [...fillCoffees, ...lowAffinity];

    } else if (ragFocus === 'exact_match') {
      const targetCode = userCode ?? 'balanced_sweet';
      fillCoffees = pool.filter(c => c.archetype === targetCode)
        .sort(editorialSort)
        .slice(0, Math.min(5, fillBudget));

    } else if (ragFocus === 'matched') {
      // Liam L2, Part C — the new default focus for any quiz taker (D5):
      // primary archetype coffees (exact_match's own editorial-first sort)
      // fill first, then the secondary if room remains. A quiz-only customer
      // with no attributed bags (no palate slice) therefore sees their
      // primary's coffees labelled [primary], then [second archetype] —
      // never the other way around, which is why this focus skips the
      // universal secondary slice (step 2) above and handles both archetypes
      // itself, in this specific order.
      const primaryCoffees = userCode ? pool.filter(c => c.archetype === userCode).sort(editorialSort) : [];
      const secondaryCoffees = secondaryCode ? pool.filter(c => c.archetype === secondaryCode).sort(editorialSort) : [];
      fillCoffees = [...primaryCoffees, ...secondaryCoffees].slice(0, fillBudget);

    } else {
      // curated_mix: 1 per archetype with most complete editorial data.
      const archetypesInPool = [...new Set(pool.map(c => c.archetype))];
      const byArchetype = new Map<string, CoffeeRow[]>();
      for (const c of pool) {
        if (!byArchetype.has(c.archetype)) byArchetype.set(c.archetype, []);
        byArchetype.get(c.archetype)!.push(c);
      }
      const score = (c: CoffeeRow) => (c.ai_summary != null ? 1 : 0) + (c.surprise_note != null ? 1 : 0);
      fillCoffees = archetypesInPool
        .map(a => byArchetype.get(a)!.sort((x, y) => score(y) - score(x) || x.id - y.id)[0])
        .slice(0, fillBudget);
    }

    fillCoffees = fillCoffees.filter(c => !placedIds.has(c.id)).slice(0, fillBudget);
    for (const c of fillCoffees) {
      composed.push(c); placedIds.add(c.id);
      if (c.archetype === userCode) {
        sliceByCoffee.set(c.id, 'primary');
        labelText.set(c.id, '[primary]');
      } else if (ragFocus === 'matched' && secondaryCode && c.archetype === secondaryCode) {
        // The 'matched' focus's own secondary-archetype fill (above) —
        // same label as the universal secondary slice would have used.
        sliceByCoffee.set(c.id, 'secondary');
        labelText.set(c.id, '[second archetype]');
      } else {
        sliceByCoffee.set(c.id, 'focus');
      }
    }
  } catch (err) {
    console.error('[sommelierRag] Query error:', err);
    // Match the pre-Part-B behavior exactly: any error anywhere in this block
    // (not just a caught-and-degraded sub-query) zeroes the result, it never
    // returns a partial composition from whichever steps happened to finish
    // before the error.
    composed.length = 0;
  }

  const coffees = composed.slice(0, maxCoffees);
  const coffeeIds = coffees.map((c) => c.id);
  const [descriptors, aliases] = await Promise.all([getDescriptors(coffeeIds), getAliases(coffeeIds)]);
  const catalogText = await buildCatalogText(coffees, descriptors, aliases, labelText);
  const slices = coffees.map(c => ({ coffeeId: c.id, slice: sliceByCoffee.get(c.id)! }));

  return { catalogText, coffeeIds, slices };
}
