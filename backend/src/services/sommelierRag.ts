import { db } from '../db/client.js';
import { getSommelierConfig } from './sommelierConfig.js';
import {
  archetypeCode, archetypeLabel, getCoffees, getSellableSlots, getSlotsForCoffees, getHops,
} from './catalogReads.js';

// Catalog Blueprint · brief 3 (2026-09-14) — Liam's candidate pool is now
// D2's rule: every ragFocus draws from v_coffee_sellable_slot at 12oz, joined
// to v_coffee for match_archetype (reasoning) — never archetype_assignments
// or coffees directly. The alias text still names the SLOT (placement),
// never the coffee's raw internal name or roaster. getDescriptors is
// unchanged (cupping tables, not a placement question).

export interface RagParams {
  ragFocus: string;
  userArchetype: string | null;
  previousArchetype?: string | null;
  excludeCoffeeIds?: number[];
}

export interface RagResult {
  catalogText: string;
  coffeeIds: number[];
}

interface CoffeeRow {
  id: number;
  name: string;
  archetype: string; // match_archetype
  ai_summary: string | null;
  surprise_note: string | null;
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
export async function getAliases(coffeeIds: number[]): Promise<Map<number, string>> {
  if (!coffeeIds.length) return new Map();
  const map = new Map<number, string>();
  const slots = await getSlotsForCoffees(coffeeIds);
  for (const slot of slots) {
    if (map.has(slot.coffee_id)) continue; // already have this coffee's best slot (home, else first guest by priority)
    if (slot.slot_name) map.set(slot.coffee_id, slot.slot_name);
  }
  const unresolved = coffeeIds.filter(id => !map.has(id));
  if (unresolved.length) {
    const coffees = await getCoffees({ ids: unresolved });
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

// HOME_TASK_9B (S89) — reads v_archetype_adjacency, the same real,
// actively-curated hop-derived view GET /api/axis/adjacency and the admin
// Bloom Dial page already read (brief 3: now derived from v_coffee_hop —
// see schema.sql). Already archetype_enum-keyed, so no toEnum round-trip is
// needed here anymore — callers pass a code, this expects one.
async function getAdjacentArchetypes(archetypeCodeValue: string): Promise<string[]> {
  try {
    const result = await db.query(
      `SELECT
         CASE WHEN archetype_a = $1 THEN archetype_b ELSE archetype_a END AS adjacent
       FROM v_archetype_adjacency
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
    console.error('[sommelierRag:ADJACENCY_EMPTY_FALLBACK] v_archetype_adjacency returned zero rows for', archetypeCodeValue, '— using hardcoded fallback adjacency');
    return FALLBACK_ADJACENCY[archetypeCodeValue] ?? [];
  } catch (err) {
    console.error('[sommelierRag:ADJACENCY_QUERY_FAILED] v_archetype_adjacency query failed for', archetypeCodeValue, '— using hardcoded fallback adjacency', err);
    return FALLBACK_ADJACENCY[archetypeCodeValue] ?? [];
  }
}

async function buildCatalogText(coffees: CoffeeRow[], descriptors: Map<number, string[]>, aliases: Map<number, string>): Promise<string> {
  if (!coffees.length) return 'YOUR CURRENT CATALOG — no coffees available at this time.';

  const lines: string[] = ['YOUR CURRENT CATALOG — Liam may only recommend coffees from this list:'];
  for (const c of coffees) {
    const archetypeLabelStr = await archetypeLabel(c.archetype);
    const descs = descriptors.get(c.id) ?? [];
    // Alias only — never the roaster name or the coffee's raw internal name (see
    // SOMMELIER_TASK_6_VOICE.md Step 2b; this previously leaked both directly
    // into every Liam session's system prompt context).
    const displayName = aliases.get(c.id) ?? archetypeLabelStr;
    lines.push('---');
    lines.push(`${displayName} — ${archetypeLabelStr}`);
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
  const sellable = await getSellableSlots({ weightOz: 12 });
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
  const { ragFocus, userArchetype, previousArchetype, excludeCoffeeIds = [] } = params;
  const userCode = userArchetype ? await archetypeCode(userArchetype) : null;

  let coffees: CoffeeRow[] = [];

  try {
    const pool = await getCandidatePool();

    if (ragFocus === 'archetype_range') {
      if (userCode) {
        const adjacent = await getAdjacentArchetypes(userCode);
        const nearestThree = adjacent.slice(0, 2);
        coffees = pickPerArchetype(pool, [userCode, ...nearestThree], 2, maxCoffees);
      } else {
        // No archetype: 2 from the 3 most populated archetypes in the pool.
        const counts = new Map<string, number>();
        for (const c of pool) counts.set(c.archetype, (counts.get(c.archetype) ?? 0) + 1);
        const topThree = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a);
        coffees = pickPerArchetype(pool, topThree, 2, maxCoffees);
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
        .slice(0, maxCoffees - dialAlternativeIds.length);

      const dialCoffees = dialAlternativeIds.length
        ? pool.filter(c => dialAlternativeIds.includes(c.id)).sort((a, b) => a.id - b.id)
        : [];
      coffees = [...dialCoffees, ...archetypeCoffees];

    } else if (ragFocus === 'evolution_bridge') {
      const codes: string[] = [];
      if (previousArchetype) { const c = await archetypeCode(previousArchetype); if (c) codes.push(c); }
      if (userCode) codes.push(userCode);
      coffees = pickPerArchetype(pool, codes, 3, maxCoffees);

    } else if (ragFocus === 'discovery') {
      // Experimental archetype first.
      coffees = pool.filter(c => c.archetype === 'experimental')
        .sort((a, b) => (a.ai_summary != null ? 0 : 1) - (b.ai_summary != null ? 0 : 1) || a.id - b.id)
        .slice(0, Math.floor(maxCoffees / 2));

      // Supplement with bridge_archetype hops from the user's current sellable coffees.
      if (userCode) {
        try {
          const currentIds = pool.filter(c => c.archetype === userCode).sort((a, b) => a.id - b.id).slice(0, 5).map(c => c.id);
          if (currentIds.length > 0) {
            const hops = await getHops({ fromCoffeeId: currentIds, recommendedOnly: true });
            const poolIds = new Set(pool.map(c => c.id));
            const existingIds = new Set(coffees.map(c => c.id));
            const bridgeIds = [...new Set(
              hops.filter(h => h.hop_type_derived === 'bridge_archetype' && poolIds.has(h.to_coffee_id) && !existingIds.has(h.to_coffee_id))
                .map(h => h.to_coffee_id)
            )].slice(0, maxCoffees - coffees.length);
            if (bridgeIds.length) {
              coffees = [...coffees, ...pool.filter(c => bridgeIds.includes(c.id)).sort((a, b) => a.id - b.id)];
            }
          }
        } catch (err) {
          console.error('[sommelierRag:DIAL_QUERY_FAILED] discovery bridge-hop query failed — degrading to archetype-only RAG', err);
        }
      }

      // Fill remainder with lowest-affinity archetypes (1 per non-experimental archetype).
      const existingIds = new Set(coffees.map(c => c.id));
      const remainingArchetypes = [...new Set(pool.filter(c => c.archetype !== 'experimental').map(c => c.archetype))];
      const lowAffinity = pickPerArchetype(pool.filter(c => !existingIds.has(c.id)), remainingArchetypes, 1, maxCoffees - coffees.length);
      coffees = [...coffees, ...lowAffinity];

    } else if (ragFocus === 'exact_match') {
      const targetCode = userCode ?? 'balanced_sweet';
      coffees = pool.filter(c => c.archetype === targetCode)
        .sort((a, b) => {
          const score = (c: CoffeeRow) => (c.ai_summary != null ? 1 : 0) + (c.surprise_note != null ? 1 : 0);
          return score(b) - score(a) || a.id - b.id;
        })
        .slice(0, 5);

    } else {
      // curated_mix: 1 per archetype with most complete editorial data.
      const archetypesInPool = [...new Set(pool.map(c => c.archetype))];
      const byArchetype = new Map<string, CoffeeRow[]>();
      for (const c of pool) {
        if (!byArchetype.has(c.archetype)) byArchetype.set(c.archetype, []);
        byArchetype.get(c.archetype)!.push(c);
      }
      const score = (c: CoffeeRow) => (c.ai_summary != null ? 1 : 0) + (c.surprise_note != null ? 1 : 0);
      coffees = archetypesInPool
        .map(a => byArchetype.get(a)!.sort((x, y) => score(y) - score(x) || x.id - y.id)[0])
        .slice(0, maxCoffees);
    }
  } catch (err) {
    console.error('[sommelierRag] Query error:', err);
    coffees = [];
  }

  const coffeeIds = coffees.map((c) => c.id);
  const [descriptors, aliases] = await Promise.all([getDescriptors(coffeeIds), getAliases(coffeeIds)]);
  const catalogText = await buildCatalogText(coffees, descriptors, aliases);

  return { catalogText, coffeeIds };
}
