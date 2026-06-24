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
  roaster: string;
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
    c.roaster,
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

async function getAdjacentArchetypes(archetypeName: string): Promise<string[]> {
  try {
    const result = await db.query(
      `SELECT ar2.name
       FROM archetype ar1
       JOIN archetype_relationship rel ON rel.from_archetype_id = ar1.id
       JOIN archetype ar2 ON ar2.id = rel.to_archetype_id
       WHERE ar1.name = $1
       LIMIT 5`,
      [archetypeName]
    );
    return result.rows.map((r: { name: string }) => r.name);
  } catch {
    // Fallback hardcoded adjacency
    const adj: Record<string, string[]> = {
      'Floral': ['Fruity', 'Experimental'],
      'Fruity': ['Floral', 'Balanced & Sweet'],
      'Balanced & Sweet': ['Fruity', 'Chocolate & Nutty'],
      'Chocolate & Nutty': ['Balanced & Sweet', 'Earthy'],
      'Earthy': ['Chocolate & Nutty', 'Experimental'],
      'Experimental': ['Floral', 'Earthy'],
    };
    return adj[archetypeName] ?? [];
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

function buildCatalogText(coffees: CoffeeRow[], descriptors: Map<number, string[]>): string {
  if (!coffees.length) return 'YOUR CURRENT CATALOG — no coffees available at this time.';

  const lines: string[] = ['YOUR CURRENT CATALOG — Liam may only recommend coffees from this list:'];
  for (const c of coffees) {
    const archetypeLabel = c.archetype
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase());
    const descs = descriptors.get(c.id) ?? [];
    lines.push('---');
    lines.push(`${c.name} — ${c.roaster} — ${archetypeLabel}`);
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
               c.id, c.name, c.roaster, aa.archetype::text AS archetype,
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
             SELECT c.id, c.name, c.roaster, aa.archetype::text AS archetype,
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

      // Bloom Dial: lighter alternatives via hop direction = 'less'
      let dialAlternativeIds: number[] = [];
      if (excludeCoffeeIds.length > 0) {
        try {
          const dialResult = await db.query(
            `SELECT DISTINCT vdn.to_coffee_id AS id
             FROM v_dial_navigation vdn
             WHERE vdn.from_coffee_id = ANY($1::int[])
               AND vdn.direction = 'less'
               AND vdn.is_recommended = true
             LIMIT 2`,
            [excludeCoffeeIds]
          );
          dialAlternativeIds = dialResult.rows.map((r: { id: number }) => r.id);
        } catch {
          console.warn('[sommelierRag] Bloom Dial query failed — using archetype-only RAG');
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
           SELECT c.id, c.name, c.roaster, aa.archetype::text AS archetype,
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
      // Experimental archetype first
      const expResult = await db.query(
        `${BASE_COFFEE_SQL}
         WHERE aa.archetype = 'experimental'::archetype_enum
         ORDER BY c.ai_summary IS NOT NULL DESC, c.id
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
            const dialResult = await db.query(
              `SELECT DISTINCT vdn.to_coffee_id AS id
               FROM v_dial_navigation vdn
               WHERE vdn.from_coffee_id = ANY($1::int[])
                 AND vdn.hop_type = 'bridge_archetype'
                 AND vdn.is_recommended = true
                 AND vdn.to_coffee_id != ALL($2::int[])
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
        } catch {
          console.warn('[sommelierRag] Bloom Dial query failed — using archetype-only RAG');
        }
      }

      // Fill remainder with lowest-affinity archetypes
      const existingIds = coffees.map((c) => c.id);
      const lowAffinityResult = await db.query(
        `SELECT * FROM (
           SELECT c.id, c.name, c.roaster, aa.archetype::text AS archetype,
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
      const result = await db.query(
        `${BASE_COFFEE_SQL}
         WHERE aa.archetype = $1::archetype_enum
         ORDER BY (c.ai_summary IS NOT NULL) DESC, (c.surprise_note IS NOT NULL) DESC, c.id
         LIMIT 5`,
        [userEnum ?? 'balanced_sweet']
      );
      coffees = result.rows;

    } else {
      // curated_mix: 1 per archetype with most complete editorial data
      const result = await db.query(
        `SELECT DISTINCT ON (aa.archetype)
           c.id, c.name, c.roaster, aa.archetype::text AS archetype,
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
  const descriptors = await getDescriptors(coffeeIds);
  const catalogText = buildCatalogText(coffees, descriptors);

  return { catalogText, coffeeIds };
}
