import { db } from '../db/client.js';
import type { Tx } from '../db/client.js';
import { getSommelierConfig } from './sommelierConfig.js';
import { getRoasterVoice, signatureWords } from './roasterVoiceReads.js';
import {
  archetypeCode, archetypeLabel, getCoffees, getSellableSlots, getSlotsForCoffees, getHops,
  getArchetypes, getCategoryCoffees, getCoffeeRetailPrices, getSizes, getCatalogVersion,
} from './catalogReads.js';
import { resolveCoffeeBlend } from './blendResolver.js';

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
  // Liam sees everything brief Rev 2, A3 — the brew profile's
  // decaf_constraint: the pool becomes the Decaf-category coffees and the
  // FIT block leads with catalogBlock.decafHeader.
  decafOnly?: boolean;
}

export interface RagResult {
  // Rev 2: the session-tier FIT FOR THIS CUSTOMER block (renderFitBlock).
  // The coffees themselves are the shared catalog block (getCatalogBlock).
  fitText: string;
  // Every coffee in the shared catalog block: what Liam may name, and so the
  // write-back's candidate set (was the 6-coffee slice).
  coffeeIds: number[];
  // Why each coffee is in the catalog — L3's later write-back detection reads
  // this; 'had' is the palate slice's own already-bought coffees (kept
  // distinct from a not-yet-tried 'palate' pick, both rendered with the same
  // "[palate match]" label text plus a "[had before, rated n]" suffix for
  // 'had' specifically — see renderFitBlock).
  slices: Array<{ coffeeId: number; slice: CoffeeSlice }>;
}

interface CoffeeRow {
  id: number;
  name: string;
  archetype: string; // match_archetype
  three_voice_story: string | null;
}

// Editorial-completeness first (has its description, three_voice_story, since
// coffee presentation brief 2; was ai_summary and/or surprise_note),
// lowest id as the deterministic tiebreak — exact_match's own sort, reused
// unchanged by the new thread slice (Part B: "id order, editorial-
// completeness first as exact_match does").
function editorialSort(a: CoffeeRow, b: CoffeeRow): number {
  const score = (c: CoffeeRow) => (c.three_voice_story != null ? 1 : 0);
  return score(b) - score(a) || a.id - b.id;
}

// Cupping evidence brief 6, C3 (2026-10-21): Liam hears what a customer may
// hear, the customer voice, never our cupping words. Coffee presentation
// brief 1 (2026-10-23): through the roaster's voice read
// (roasterVoiceReads.getRoasterVoice), the signature notes per coffee, which
// the read already caps at param('customer_voice_signature_max') (was the
// first four words, a literal).
async function getDescriptors(coffeeIds: number[]): Promise<Map<number, string[]>> {
  if (!coffeeIds.length) return new Map();
  const map = new Map<number, string[]>();
  const voices = await Promise.all(coffeeIds.map(id => getRoasterVoice(id, undefined, { descriptorsOnly: true })));
  coffeeIds.forEach((id, i) => {
    const words = signatureWords(voices[i]);
    if (words.length) map.set(id, words);
  });
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

// Liam sees everything brief Rev 2, A2 (2026-10-24) — the fit labels, as their
// own session-tier block: one line per labelled coffee, by alias, in
// composition order. The coffees themselves are in the shared catalog block;
// this says which of them fit this customer and why. The decaf header (A3)
// leads it when the customer drinks decaf only. Empty when nothing is labelled
// and no header applies.
export function renderFitBlock(
  composed: Array<{ id: number }>, aliases: Map<number, string>, labelText: Map<number, string>,
  opts: { header: string; decafHeader?: string | null }
): string {
  const lines = composed.filter(c => labelText.has(c.id)).map(c => `- ${aliases.get(c.id) ?? 'a catalog coffee'} ${labelText.get(c.id)}`);
  if (!lines.length && !opts.decafHeader) return '';
  return [opts.header, ...(opts.decafHeader ? [opts.decafHeader] : []), ...lines].join('\n');
}

// The candidate pool every ragFocus draws from (Rev 2, A1): every coffee the
// shared catalog block lists (getCatalogBlock), never a slice of it. The dial
// coffees for a customer without a decaf constraint; the Decaf-category
// coffees for a decaf-only customer (A3). A coffee only appears once, keyed by
// coffee id; it needs a match archetype to be composed (an unmatched coffee
// stays in the catalog block, it just carries no fit label).
async function getCandidatePool(decafOnly = false): Promise<CoffeeRow[]> {
  const { coffees } = await getCatalogPool();
  return coffees
    .filter(c => (decafOnly ? c.categories.some(x => x.code === 'decaf') : c.dialPosition !== null))
    .filter((c): c is typeof c & { archetype: string } => c.archetype !== null)
    .map(c => ({ id: c.id, name: c.alias, archetype: c.archetype, three_voice_story: c.tastingNote }));
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
  // Rev 2, A2: no slice. ragLimits.maxCoffees is retired (left in config,
  // ignored): every step below composes over the whole catalog pool, so the
  // fit labels land on every coffee they apply to.
  const {
    ragFocus, userArchetype, previousArchetype, excludeCoffeeIds = [],
    secondaryArchetype, exploreArchetype, slotCandidates = [], dislikedCoffeeIds = [], decafOnly = false,
  } = params;
  let maxCoffees = Number.MAX_SAFE_INTEGER;
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
    const poolFull = await getCandidatePool(decafOnly);
    const dislikedSet = new Set(dislikedCoffeeIds);
    const pool = poolFull.filter(c => !dislikedSet.has(c.id));
    maxCoffees = pool.length;

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
        .sort((a, b) => (a.three_voice_story != null ? 0 : 1) - (b.three_voice_story != null ? 0 : 1) || a.id - b.id)
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
      const score = (c: CoffeeRow) => (c.three_voice_story != null ? 1 : 0);
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

  // A3: a decaf-only customer whose archetype has no decaf gets the decaf of
  // the nearest archetype that has one (v_coffee_archetype_adjacency order).
  if (decafOnly && userCode && !composed.some(c => c.archetype === userCode)) {
    try {
      const pool = (await getCandidatePool(true)).filter(c => !dislikedCoffeeIds.includes(c.id));
      for (const code of await getAdjacentArchetypes(userCode)) {
        const nearest = pool.filter(c => c.archetype === code).sort(editorialSort)[0];
        if (nearest) {
          if (!composed.some(c => c.id === nearest.id)) composed.push(nearest);
          sliceByCoffee.set(nearest.id, 'primary');
          labelText.set(nearest.id, `[nearest decaf to their match: ${await archetypeLabel(code)}]`);
          break;
        }
      }
    } catch (err) {
      console.error('[sommelierRag] nearest-decaf lookup failed:', err);
    }
  }

  const pool = await getCatalogPool();
  const aliases = new Map(pool.coffees.map(c => [c.id, c.alias]));
  const cfg = catalogBlockConfig();
  const fitText = renderFitBlock(composed, aliases, labelText, { header: cfg.fitHeader, decafHeader: decafOnly ? cfg.decafHeader : null });
  const slices = composed.map(c => ({ coffeeId: c.id, slice: sliceByCoffee.get(c.id)! }));

  return { fitText, coffeeIds: pool.coffees.map(c => c.id), slices };
}

// ── Liam sees everything brief Rev 2, Part A (2026-10-24) — the full catalog
// block, shared cache tier ─────────────────────────────────────────────────
// Every coffee a customer can see on the site: the Bloom Dial's visible
// coffees (a winner at some active size in v_coffee_sellable_slot, the
// winner side of v_coffee_visibility) and every active category coffee
// (decaf, half_caf, flavored, experimental: the /other-categories surface,
// unpriced ones included, shown "not yet available" as the site does).
// Every active size with its price. Customer-neutral and byte-stable: one
// render per catalog version, shared by every session (no fit labels, no
// decaf header here; those are the session-tier FIT block).
//
// Roaster identity is never selected into a row: CatalogCoffee is built field
// by field from the view rows, never spread from them (v_coffee carries
// roaster_name and the internal name). The alias is the slot name, else the
// name the site shows; an alias that contains a roaster name is replaced by
// "<category> <archetype>" so an internal name can never carry it in.

export const CATEGORY_CODES = ['decaf', 'half_caf', 'flavored', 'experimental'];

export interface CatalogCoffee {
  id: number;
  alias: string;
  archetype: string | null;        // match archetype code
  archetypeLabel: string | null;
  categories: Array<{ code: string; label: string }>;
  dialPosition: string | null;     // the slot's position label, dial coffees only
  sizes: Array<{ label: string; cents: number }>;
  tastingNote: string | null;
  keyFlavors: string[];
  story: string | null;            // the published story
}

type CatalogBlockConfig = NonNullable<NonNullable<ReturnType<typeof getSommelierConfig>>['catalogBlock']>;

const DEFAULT_CATALOG_BLOCK: CatalogBlockConfig = {
  header: 'YOUR CATALOG — every coffee we sell. Recommend only from here. The FIT FOR THIS CUSTOMER block says which of these fit this customer and why; never read a label aloud.',
  template: ['{alias} — {archetype}{categories}{dial}', 'Sizes: {sizes}', 'Tasting note: {tastingNote}', 'Key flavors: {keyFlavors}', 'Story: {story}'],
  sizesForm: 'whole bean',
  notYetAvailable: 'not yet available',
  storySentences: 2,
  maxTokens: 14000,
  fitHeader: 'FIT FOR THIS CUSTOMER (why these catalog coffees fit them; never read a label aloud):',
  decafHeader: 'This customer drinks decaf only. Recommend only coffees marked Decaf; mention Half-caf only if they ask.',
};

export function catalogBlockConfig(): CatalogBlockConfig {
  return { ...DEFAULT_CATALOG_BLOCK, ...(getSommelierConfig()?.catalogBlock ?? {}) };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function roasterPattern(name: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(name.trim())}(?=$|[^\\p{L}\\p{N}])`, 'giu');
}
function mentionsRoaster(text: string, roasterNames: string[]): boolean {
  return roasterNames.some(n => n.trim() && roasterPattern(n).test(text));
}
// Belt and braces for prose (story, tasting note): the story layer's banned
// terms already keep roaster names out, but the catalog block guarantees it
// itself, longest name first so a name never survives as a fragment.
function scrubRoasters(text: string | null, roasterNames: string[]): string | null {
  if (!text) return text;
  let out = text;
  for (const n of [...roasterNames].filter(x => x.trim()).sort((a, b) => b.length - a.length)) {
    out = out.replace(roasterPattern(n), (_m, lead: string) => `${lead}the roaster`);
  }
  return out;
}

/** Every customer-visible coffee, in catalog order: dial coffees by archetype (dial order) and dial position, then category coffees, then id. */
// `withFlavors: false` skips the roaster-voice read (Key flavors, one read per
// coffee): the composition pool (fetchSommelierCoffees) needs only ids,
// archetypes and aliases, and the voice read is the slow part of a build.
export async function getCatalogCoffees(runner: Tx | typeof db = db, opts: { withFlavors?: boolean } = {}): Promise<CatalogCoffee[]> {
  const [sellable, categoryRows, archetypes, sizes, retail, roasters] = await Promise.all([
    getSellableSlots({}, runner),
    getCategoryCoffees(CATEGORY_CODES, runner),
    getArchetypes(runner),
    getSizes(runner),
    getCoffeeRetailPrices({}, runner),
    runner.query<{ name: string }>(`SELECT name FROM roaster WHERE name IS NOT NULL`),
  ]);
  const roasterNames = roasters.rows.map(r => r.name);
  const archetypeOrder = new Map<string, number>(archetypes.map(a => [a.code as string, a.sort_order]));
  const archetypeLabels = new Map<string, string>(archetypes.map(a => [a.code as string, a.label]));
  const sizeLabel = new Map<number, string>(sizes.map(s => [s.weight_oz, s.label]));
  const sizeOrder = new Map<number, number>(sizes.map(s => [s.weight_oz, s.sort_order]));

  // Dial coffees: the first winning slot (home before guest), its price per size.
  const dial = new Map<number, { slotArchetype: string; sortOrder: number; position: string; sizes: Map<number, number> }>();
  const sortedSellable = [...sellable].sort((a, b) =>
    (a.role === 'home' ? 0 : 1) - (b.role === 'home' ? 0 : 1) || a.priority - b.priority || a.slot_id - b.slot_id);
  for (const s of sortedSellable) {
    const w = Number(s.weight_oz);
    let d = dial.get(s.coffee_id);
    if (!d) { d = { slotArchetype: s.archetype, sortOrder: s.sort_order, position: s.position_label, sizes: new Map() }; dial.set(s.coffee_id, d); }
    if (!d.sizes.has(w)) d.sizes.set(w, Number(s.retail_price_cents));
  }

  const categoriesByCoffee = new Map<number, Array<{ code: string; label: string; order: number }>>();
  for (const r of categoryRows) {
    const list = categoriesByCoffee.get(r.coffee_id) ?? [];
    if (!list.some(c => c.code === r.category_code)) list.push({ code: r.category_code, label: r.category_label, order: r.category_sort_order });
    categoriesByCoffee.set(r.coffee_id, list);
  }

  const ids = [...new Set([...dial.keys(), ...categoriesByCoffee.keys()])];
  if (!ids.length) return [];
  const coffees = await getCoffees({ ids, active: true }, runner);
  const activeIds = coffees.map(c => c.id);
  const [aliases, descriptors] = await Promise.all([
    getAliases(activeIds, runner),
    opts.withFlavors === false ? Promise.resolve(new Map<number, string[]>()) : getDescriptors(activeIds),
  ]);

  const retailByCoffee = new Map<number, Map<number, number>>();
  for (const r of retail) {
    const m = retailByCoffee.get(r.coffee_id) ?? new Map<number, number>();
    m.set(Number(r.weight_oz), r.retail_price_cents);
    retailByCoffee.set(r.coffee_id, m);
  }

  const out: Array<{ coffee: CatalogCoffee; sortKey: number[] }> = [];
  for (const c of coffees) {
    const d = dial.get(c.id);
    const cats = (categoriesByCoffee.get(c.id) ?? []).sort((a, b) => a.order - b.order);
    // Sizes: a dial coffee's winning-slot prices; a category coffee's own
    // retail prices where an active SKU sells that size (the site's rule).
    const sizeCents = new Map<number, number>(d ? d.sizes : []);
    if (!d) {
      for (const [w, cents] of retailByCoffee.get(c.id) ?? []) {
        if (sizeLabel.has(w) && await resolveCoffeeBlend(c.id, w)) sizeCents.set(w, cents);
      }
    }
    const archetype: string | null = c.match_archetype ?? d?.slotArchetype ?? null;
    const archLabel = archetype ? archetypeLabels.get(archetype) ?? null : null;
    let alias = aliases.get(c.id) ?? c.name;
    if (mentionsRoaster(alias, roasterNames)) alias = [cats[0]?.label, archLabel].filter(Boolean).join(' ') || 'This coffee';
    out.push({
      coffee: {
        id: c.id, alias, archetype, archetypeLabel: archLabel,
        categories: cats.map(({ code, label }) => ({ code, label })),
        dialPosition: d?.position ?? null,
        sizes: [...sizeCents.entries()].filter(([w]) => sizeLabel.has(w))
          .sort((a, b) => (sizeOrder.get(a[0]) ?? 0) - (sizeOrder.get(b[0]) ?? 0))
          .map(([w, cents]) => ({ label: sizeLabel.get(w)!, cents })),
        tastingNote: scrubRoasters(c.three_voice_story ?? null, roasterNames),
        keyFlavors: descriptors.get(c.id) ?? [],
        story: c.story_published ? scrubRoasters(c.story ?? null, roasterNames) : null,
      },
      sortKey: [d ? 0 : 1, archetype ? archetypeOrder.get(archetype) ?? 99 : 99, d ? d.sortOrder : cats[0]?.order ?? 99, c.id],
    });
  }
  out.sort((a, b) => {
    for (let i = 0; i < a.sortKey.length; i++) if (a.sortKey[i] !== b.sortKey[i]) return a.sortKey[i] - b.sortKey[i];
    return 0;
  });
  return out.map(o => o.coffee);
}

function firstSentences(text: string, n: number): string {
  if (n <= 0) return '';
  return text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).slice(0, n).join(' ');
}

/** Rough token estimate for the guard (about 3.6 characters per token for this prose); the ledger reports the real count. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

/** Pure render. `storySentences` overrides the config (the token guard's trim levels). */
export function renderCatalogBlock(coffees: CatalogCoffee[], cfg: CatalogBlockConfig, storySentences = cfg.storySentences): string {
  if (!coffees.length) return `${cfg.header}\n---\n(no coffees are visible to customers right now)`;
  const lines = [cfg.header];
  for (const c of coffees) {
    const values: Record<string, string> = {
      alias: c.alias,
      archetype: c.archetypeLabel ?? '',
      categories: c.categories.length ? `, ${c.categories.map(x => x.label).join(' / ')}` : '',
      dial: c.dialPosition ? ` · dial: ${c.dialPosition.toLowerCase()}` : '',
      sizes: c.sizes.length
        ? `${c.sizes.map(s => `${s.label} $${(s.cents / 100).toFixed(2)}`).join(' · ')}${cfg.sizesForm ? ` (${cfg.sizesForm})` : ''}`
        : cfg.notYetAvailable,
      tastingNote: c.tastingNote ?? '',
      keyFlavors: c.keyFlavors.join(', '),
      story: c.story ? firstSentences(c.story, storySentences) : '',
    };
    lines.push('---');
    for (const tpl of cfg.template) {
      const names = [...tpl.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
      if (names.length && names.every(n => !values[n])) continue; // every placeholder empty: drop the line
      lines.push(tpl.replace(/\{(\w+)\}/g, (_m, n: string) => values[n] ?? ''));
    }
  }
  lines.push('---');
  return lines.join('\n');
}

export interface CatalogBlock {
  text: string;
  version: string;
  coffeeIds: number[];
  coffees: CatalogCoffee[];
  tokensEstimate: number;
  trimLevel: 0 | 1 | 2;   // 0 = stories at storySentences, 1 = one sentence, 2 = none
  builtAt: string;
}

let catalogBlockCache: { block: CatalogBlock; checkedAt: number } | null = null;
let catalogPoolCache: { version: string; coffees: CatalogCoffee[] } | null = null;

/** The same coffees as the catalog block, without the flavor read; cached per catalog version. */
export async function getCatalogPool(): Promise<{ version: string; coffees: CatalogCoffee[] }> {
  const version = await getCatalogVersion();
  if (catalogBlockCache?.block.version === version) return { version, coffees: catalogBlockCache.block.coffees };
  if (catalogPoolCache?.version === version) return catalogPoolCache;
  catalogPoolCache = { version, coffees: await getCatalogCoffees(db, { withFlavors: false }) };
  return catalogPoolCache;
}
const CATALOG_BLOCK_RECHECK_MS = 10 * 60_000;

/**
 * The shared catalog block, rebuilt when getCatalogVersion() changes (as the
 * per-session snapshot was) and re-rendered at most every 10 minutes so a
 * story edit lands without a catalog change; an unchanged catalog renders the
 * same bytes, so the shared cache entry survives a re-render. Token guard:
 * over catalogBlock.maxTokens, stories go to one sentence, then none, and
 * [liam:CATALOG_BLOCK_TRIMMED] is logged; a coffee is never dropped.
 */
export async function getCatalogBlock(opts: { force?: boolean } = {}): Promise<CatalogBlock> {
  const version = await getCatalogVersion();
  if (!opts.force && catalogBlockCache && catalogBlockCache.block.version === version
      && Date.now() - catalogBlockCache.checkedAt < CATALOG_BLOCK_RECHECK_MS) {
    return catalogBlockCache.block;
  }
  const cfg = catalogBlockConfig();
  const coffees = await getCatalogCoffees();
  let trimLevel: 0 | 1 | 2 = 0;
  let text = renderCatalogBlock(coffees, cfg);
  if (estimateTokens(text) > cfg.maxTokens) { trimLevel = 1; text = renderCatalogBlock(coffees, cfg, Math.min(1, cfg.storySentences)); }
  if (estimateTokens(text) > cfg.maxTokens) { trimLevel = 2; text = renderCatalogBlock(coffees, cfg, 0); }
  if (trimLevel) console.warn(`[liam:CATALOG_BLOCK_TRIMMED] tokens=${estimateTokens(text)} level=${trimLevel}`);
  const block: CatalogBlock = {
    text, version, coffees, coffeeIds: coffees.map(c => c.id),
    tokensEstimate: estimateTokens(text), trimLevel, builtAt: new Date().toISOString(),
  };
  if (!catalogBlockCache || catalogBlockCache.block.text !== text) {
    console.log(`[liam:CATALOG_BLOCK_BUILT] coffees=${block.coffeeIds.length} tokens~${block.tokensEstimate} level=${trimLevel} version=${version}`);
  }
  catalogBlockCache = { block, checkedAt: Date.now() };
  return block;
}

/** The last built block's numbers, for the System Health card (never triggers a build). */
export function getCatalogBlockStatus(): { tokensEstimate: number; trimLevel: number; builtAt: string; version: string; coffeeCount: number } | null {
  if (!catalogBlockCache) return null;
  const b = catalogBlockCache.block;
  return { tokensEstimate: b.tokensEstimate, trimLevel: b.trimLevel, builtAt: b.builtAt, version: b.version, coffeeCount: b.coffeeIds.length };
}
