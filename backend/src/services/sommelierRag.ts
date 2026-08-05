import { db } from '../db/client.js';
import { getSommelierConfig } from './sommelierConfig.js';

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
  archetype: string;
  ai_summary: string | null;
  surprise_note: string | null;
}

// Converts archetype display name or any casing to archetype_enum value
function toEnum(name: string): string {
  const map: Record<string, string> = {
    'Floral': 'floral',
    'Fruity': 'fruity',
    'Balanced & Sweet': 'balanced_sweet',
    'Chocolate & Nutty': 'chocolate_nutty',
    'Earthy': 'earthy',
    'Experimental': 'experimental',
  };
  return map[name] ?? name.toLowerCase().replace(/ & /g, '_').replace(/ /g, '_');
}

const BASE_COFFEE_SQL = `
  SELECT DISTINCT ON (c.id)
    c.id,
    c.name,
    aa.archetype::text AS archetype,
    c.ai_summary,
    c.surprise_note
  FROM coffees c
  JOIN archetype_assignments aa ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
`;

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

// Axis & Bloom alias per coffee — the only customer-facing identity Liam's catalog
// context may use (never the roaster's raw internal name). Priority 1 preferred.
// Bloom Dial Base Data Part 3 (#94/#95): a dial coffee's name is now the SLOT's
// name (dial_slot_alias), never the possibly-stale per-row coffee_alias.platform_name
// — this was a real bug found post-deploy (Liam was still citing old/duplicate
// per-coffee names like "Deep Cocoa" for two different coffees after the admin/public
// site had already moved to the deduplicated slot model). A category-tagged coffee
// (Decaf/Half-Caf/Flavored/Experimental) has no dial slot, so it keeps its own
// coffee_alias.platform_name as a legitimate per-coffee identity — same fallback
// the public /api/coffees/other-categories endpoint uses. Falls back to the
// archetype label (caller-side) if a coffee has no alias row at all.
export async function getAliases(coffeeIds: number[]): Promise<Map<number, string>> {
  if (!coffeeIds.length) return new Map();
  const result = await db.query(
    `SELECT DISTINCT ON (ca.coffee_id) ca.coffee_id,
            COALESCE(dsa.platform_name, ca.platform_name) AS platform_name
     FROM coffee_alias ca
     LEFT JOIN dial_archetype_positions dap ON dap.coffee_id = ca.coffee_id AND dap.is_guest = false
     LEFT JOIN dial_position_vocabulary dpv ON dpv.id = dap.vocabulary_id
     LEFT JOIN archetype_assignments aa ON aa.coffee_id = ca.coffee_id AND aa.superseded_at IS NULL
     LEFT JOIN dial_slot_alias dsa
       ON dsa.archetype = COALESCE(aa.archetype, ca.archetype)
       AND dsa.dial_sort_order = COALESCE(dpv.sort_order, ca.dial_sort_order)
       AND NOT EXISTS (
         SELECT 1 FROM coffee_category_assignment cca
         JOIN coffee_category cc ON cc.id = cca.category_id
         WHERE cca.coffee_id = ca.coffee_id AND cc.code IN ('decaf', 'half_caf', 'flavored', 'experimental')
       )
     WHERE ca.coffee_id = ANY($1::int[]) AND ca.is_active = true
     ORDER BY ca.coffee_id, ca.priority ASC`,
    [coffeeIds]
  );
  const map = new Map<number, string>();
  for (const row of result.rows) map.set(row.coffee_id, row.platform_name);
  return map;
}

// Hardcoded fallback adjacency, keyed by display name — used whenever the
// real graph has nothing to say (a thrown query error, or a genuinely empty
// result). Both cases are equally "no real data," never distinguished before
// this fix (HOME_TASK_9B) — an empty result from `v_archetype_adjacency`
// silently degraded `archetype_range`/`alternatives` to single-archetype RAG
// for as long as this project has had any adjacency data at all, since the
// old `archetype_relationship` table (0 rows in prod, dead — see schema.sql's
// own DEPRECATED comment) never threw on an empty SELECT, it just returned
// nothing, and nothing here ever checked for that (S88's own finding).
const FALLBACK_ADJACENCY: Record<string, string[]> = {
  'Floral': ['Fruity', 'Experimental'],
  'Fruity': ['Floral', 'Balanced & Sweet'],
  'Balanced & Sweet': ['Fruity', 'Chocolate & Nutty'],
  'Chocolate & Nutty': ['Balanced & Sweet', 'Earthy'],
  'Earthy': ['Chocolate & Nutty', 'Experimental'],
  'Experimental': ['Floral', 'Earthy'],
};

// HOME_TASK_9B (S89) — migrated off the dead `archetype_relationship` table
// (0 rows in prod, superseded by the Bloom Dial framework — confirmed by
// Dana, `axis.ts`'s own comment agrees) onto `v_archetype_adjacency`, the
// same real, actively-curated hop-derived view `GET /api/axis/adjacency`
// and the admin Bloom Dial page already read. `v_archetype_adjacency` is
// archetype_enum-keyed (e.g. 'chocolate_nutty'), not display-name-keyed
// (e.g. 'Chocolate & Nutty') — `toEnum()` is idempotent on an already-enum
// string (lowercase, no spaces, falls through its own else branch
// unchanged), so round-tripping through it here and again in every caller
// is safe and requires no caller-side change.
async function getAdjacentArchetypes(archetypeName: string): Promise<string[]> {
  const enumValue = toEnum(archetypeName);
  try {
    const result = await db.query(
      `SELECT
         CASE WHEN archetype_a = $1 THEN archetype_b ELSE archetype_a END AS adjacent
       FROM v_archetype_adjacency
       WHERE archetype_a = $1 OR archetype_b = $1
       ORDER BY hop_count DESC
       LIMIT 5`,
      [enumValue]
    );
    if (result.rows.length > 0) {
      return result.rows.map((r: { adjacent: string }) => r.adjacent);
    }
    // Empty is not an error — but it's exactly as "no real data" as one, and
    // the pre-fix code only fell back on a throw. Unmissable-log-tag pattern
    // from 7d/S85: a distinct, greppable tag with real context attached, not
    // a warn nobody reads.
    console.error('[sommelierRag:ADJACENCY_EMPTY_FALLBACK] v_archetype_adjacency returned zero rows for', enumValue, '— using hardcoded fallback adjacency');
    return FALLBACK_ADJACENCY[archetypeName] ?? [];
  } catch (err) {
    console.error('[sommelierRag:ADJACENCY_QUERY_FAILED] v_archetype_adjacency query failed for', enumValue, '— using hardcoded fallback adjacency', err);
    return FALLBACK_ADJACENCY[archetypeName] ?? [];
  }
}

async function fetchCoffeesByArchetypes(enumValues: string[], limit: number): Promise<CoffeeRow[]> {
  const result = await db.query(
    `${BASE_COFFEE_SQL}
     WHERE aa.archetype = ANY($1::archetype_enum[])
     ORDER BY c.id, aa.archetype
     LIMIT $2`,
    [enumValues, limit]
  );
  return result.rows;
}

function buildCatalogText(coffees: CoffeeRow[], descriptors: Map<number, string[]>, aliases: Map<number, string>): string {
  if (!coffees.length) return 'YOUR CURRENT CATALOG — no coffees available at this time.';

  const lines: string[] = ['YOUR CURRENT CATALOG — Liam may only recommend coffees from this list:'];
  for (const c of coffees) {
    const archetypeLabel = c.archetype
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase());
    const descs = descriptors.get(c.id) ?? [];
    // Alias only — never the roaster name or the coffee's raw internal name (see
    // SOMMELIER_TASK_6_VOICE.md Step 2b; this previously leaked both directly
    // into every Liam session's system prompt context).
    const displayName = aliases.get(c.id) ?? archetypeLabel;
    lines.push('---');
    lines.push(`${displayName} — ${archetypeLabel}`);
    lines.push(`Tasting note: ${c.ai_summary ?? 'Not yet available'}`);
    lines.push(`What's unexpected: ${c.surprise_note ?? 'Not yet available'}`);
    lines.push(`Key flavors: ${descs.length ? descs.join(', ') : 'Not yet available'}`);
  }
  lines.push('---');
  return lines.join('\n');
}

export async function fetchSommelierCoffees(params: RagParams): Promise<RagResult> {
  const config = getSommelierConfig();
  const maxCoffees = config?.ragLimits?.maxCoffees ?? 12;
  const { ragFocus, userArchetype, previousArchetype, excludeCoffeeIds = [] } = params;
  const userEnum = userArchetype ? toEnum(userArchetype) : null;

  let coffees: CoffeeRow[] = [];

  try {
    if (ragFocus === 'archetype_range') {
      if (userArchetype) {
        const adjacent = await getAdjacentArchetypes(userArchetype);
        const nearestThree = adjacent.slice(0, 2);
        const allEnums = [userEnum!, ...nearestThree.map(toEnum)].filter(Boolean);
        // 2 coffees per archetype — fetch ordered by archetype so we can pick evenly
        const result = await db.query(
          `SELECT * FROM (
             SELECT DISTINCT ON (c.id, aa.archetype)
               c.id, c.name, aa.archetype::text AS archetype,
               c.ai_summary, c.surprise_note,
               ROW_NUMBER() OVER (PARTITION BY aa.archetype ORDER BY c.id) AS rn
             FROM coffees c
             JOIN archetype_assignments aa ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
             WHERE aa.archetype = ANY($1::archetype_enum[])
           ) sub
           WHERE rn <= 2
           LIMIT $2`,
          [allEnums, maxCoffees]
        );
        coffees = result.rows;
      } else {
        // No archetype: 2 from the 3 most populated archetypes
        const result = await db.query(
          `SELECT * FROM (
             SELECT c.id, c.name, aa.archetype::text AS archetype,
               c.ai_summary, c.surprise_note,
               ROW_NUMBER() OVER (PARTITION BY aa.archetype ORDER BY c.id) AS rn
             FROM coffees c
             JOIN archetype_assignments aa ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
             WHERE aa.archetype IN (
               SELECT archetype FROM archetype_assignments
               WHERE superseded_at IS NULL
               GROUP BY archetype ORDER BY COUNT(*) DESC LIMIT 3
             )
           ) sub WHERE rn <= 2 LIMIT $1`,
          [maxCoffees]
        );
        coffees = result.rows;
      }

    } else if (ragFocus === 'alternatives') {
      const enums = userEnum ? [userEnum] : [];
      if (userArchetype) {
        const adjacent = await getAdjacentArchetypes(userArchetype);
        if (adjacent[0]) enums.push(toEnum(adjacent[0]));
      }

      // Bloom Dial: lighter alternatives via hop direction = 'less'. Queries
      // dial_coffee_relationships directly by id (HOME_TASK_7D/S84/S43) —
      // v_dial_navigation exposes from_coffee/to_coffee as names only, never
      // ids, in either schema.sql or production; this query selected
      // vdn.from_coffee_id/to_coffee_id for three weeks and silently failed
      // every time, caught by the catch below. Direct-table pattern mirrors
      // qrDoor.ts's getNearestHopCoffeeId() (S82) for the identical reason.
      let dialAlternativeIds: number[] = [];
      if (excludeCoffeeIds.length > 0) {
        try {
          const dialResult = await db.query(
            `SELECT DISTINCT dcr.to_coffee_id AS id
             FROM dial_coffee_relationships dcr
             WHERE dcr.from_coffee_id = ANY($1::int[])
               AND dcr.to_coffee_id IS NOT NULL
               AND dcr.direction = 'less'
               AND dcr.is_recommended = true
             LIMIT 2`,
            [excludeCoffeeIds]
          );
          dialAlternativeIds = dialResult.rows.map((r: { id: number }) => r.id);
        } catch (err) {
          console.error('[sommelierRag:DIAL_QUERY_FAILED] alternatives dial-navigation query failed — degrading to archetype-only RAG', err);
        }
      }

      const excludeAll = [...excludeCoffeeIds, ...dialAlternativeIds];
      const result = await db.query(
        `${BASE_COFFEE_SQL}
         WHERE aa.archetype = ANY($1::archetype_enum[])
           AND c.id != ALL($2::int[])
         ORDER BY c.id
         LIMIT $3`,
        [enums, excludeAll.length ? excludeAll : [0], maxCoffees - dialAlternativeIds.length]
      );
      const archetypeCoffees: CoffeeRow[] = result.rows;

      if (dialAlternativeIds.length > 0) {
        const dialResult = await db.query(
          `${BASE_COFFEE_SQL}
           WHERE c.id = ANY($1::int[])
           ORDER BY c.id`,
          [dialAlternativeIds]
        );
        coffees = [...dialResult.rows, ...archetypeCoffees];
      } else {
        coffees = archetypeCoffees;
      }

    } else if (ragFocus === 'evolution_bridge') {
      const enums: string[] = [];
      if (previousArchetype) enums.push(toEnum(previousArchetype));
      if (userEnum) enums.push(userEnum);

      // 3 from each archetype
      const result = await db.query(
        `SELECT * FROM (
           SELECT c.id, c.name, aa.archetype::text AS archetype,
             c.ai_summary, c.surprise_note,
             ROW_NUMBER() OVER (PARTITION BY aa.archetype ORDER BY c.id) AS rn
           FROM coffees c
           JOIN archetype_assignments aa ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
           WHERE aa.archetype = ANY($1::archetype_enum[])
         ) sub WHERE rn <= 3 LIMIT $2`,
        [enums, maxCoffees]
      );
      coffees = result.rows;

    } else if (ragFocus === 'discovery') {
      // Experimental archetype first. Found live while verifying HOME_TASK_7D
      // (a real, separate bug, not the dial-navigation one this task targets):
      // BASE_COFFEE_SQL is `SELECT DISTINCT ON (c.id)`, and Postgres requires
      // ORDER BY's leading expression(s) to match the DISTINCT ON list — c.id
      // must come first. This always threw (42P10), caught by the outer
      // try/catch, meaning the entire discovery focus returned zero coffees,
      // not just the (also-broken, separately fixed) bridge-hop supplement.
      const expResult = await db.query(
        `${BASE_COFFEE_SQL}
         WHERE aa.archetype = 'experimental'::archetype_enum
         ORDER BY c.id, c.ai_summary IS NOT NULL DESC
         LIMIT $1`,
        [Math.floor(maxCoffees / 2)]
      );
      coffees = expResult.rows;

      // Supplement with bridge_archetype hops from user's current coffees
      if (userEnum) {
        try {
          const currentCoffees = await db.query(
            `${BASE_COFFEE_SQL}
             WHERE aa.archetype = $1::archetype_enum
             ORDER BY c.id LIMIT 5`,
            [userEnum]
          );
          const currentIds = currentCoffees.rows.map((r: CoffeeRow) => r.id);
          if (currentIds.length > 0) {
            // Direct dial_coffee_relationships read by id (HOME_TASK_7D/S84/S43)
            // — same fix and same reasoning as the alternatives-focus query
            // above; this one selected vdn.to_coffee_id off v_dial_navigation
            // and had never once returned a row in production.
            const dialResult = await db.query(
              `SELECT DISTINCT dcr.to_coffee_id AS id
               FROM dial_coffee_relationships dcr
               WHERE dcr.from_coffee_id = ANY($1::int[])
                 AND dcr.to_coffee_id IS NOT NULL
                 AND dcr.hop_type = 'bridge_archetype'
                 AND dcr.is_recommended = true
                 AND dcr.to_coffee_id != ALL($2::int[])
               LIMIT $3`,
              [currentIds, coffees.map((c) => c.id), maxCoffees - coffees.length]
            );
            if (dialResult.rows.length > 0) {
              const bridgeIds = dialResult.rows.map((r: { id: number }) => r.id);
              const bridgeCoffees = await db.query(
                `${BASE_COFFEE_SQL}
                 WHERE c.id = ANY($1::int[])
                 ORDER BY c.id`,
                [bridgeIds]
              );
              coffees = [...coffees, ...bridgeCoffees.rows];
            }
          }
        } catch (err) {
          console.error('[sommelierRag:DIAL_QUERY_FAILED] discovery bridge-hop query failed — degrading to archetype-only RAG', err);
        }
      }

      // Fill remainder with lowest-affinity archetypes
      const existingIds = coffees.map((c) => c.id);
      const lowAffinityResult = await db.query(
        `SELECT * FROM (
           SELECT c.id, c.name, aa.archetype::text AS archetype,
             c.ai_summary, c.surprise_note,
             ROW_NUMBER() OVER (PARTITION BY aa.archetype ORDER BY c.id) AS rn
           FROM coffees c
           JOIN archetype_assignments aa ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
           WHERE aa.archetype != 'experimental'::archetype_enum
             AND c.id != ALL($1::int[])
         ) sub WHERE rn <= 1 LIMIT $2`,
        [existingIds.length ? existingIds : [0], maxCoffees - coffees.length]
      );
      coffees = [...coffees, ...lowAffinityResult.rows];

    } else if (ragFocus === 'exact_match') {
      // Same DISTINCT ON / ORDER BY bug class as the discovery focus above,
      // found while verifying HOME_TASK_7D — CONVERSION's RAG focus has
      // always thrown here too (42P10), returning zero coffees.
      const result = await db.query(
        `${BASE_COFFEE_SQL}
         WHERE aa.archetype = $1::archetype_enum
         ORDER BY c.id, (c.ai_summary IS NOT NULL) DESC, (c.surprise_note IS NOT NULL) DESC
         LIMIT 5`,
        [userEnum ?? 'balanced_sweet']
      );
      coffees = result.rows;

    } else {
      // curated_mix: 1 per archetype with most complete editorial data
      const result = await db.query(
        `SELECT DISTINCT ON (aa.archetype)
           c.id, c.name, aa.archetype::text AS archetype,
           c.ai_summary, c.surprise_note
         FROM coffees c
         JOIN archetype_assignments aa ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
         ORDER BY aa.archetype,
           (c.ai_summary IS NOT NULL)::int +
           (c.surprise_note IS NOT NULL)::int DESC,
           c.id
         LIMIT $1`,
        [maxCoffees]
      );
      coffees = result.rows;
    }
  } catch (err) {
    console.error('[sommelierRag] Query error:', err);
    coffees = [];
  }

  const coffeeIds = coffees.map((c) => c.id);
  const [descriptors, aliases] = await Promise.all([getDescriptors(coffeeIds), getAliases(coffeeIds)]);
  const catalogText = buildCatalogText(coffees, descriptors, aliases);

  return { catalogText, coffeeIds };
}
