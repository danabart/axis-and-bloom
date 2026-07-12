import { Router } from 'express';
import { db } from '../db/client.js';
import { getCoffeeSummary, getCoffeeSurpriseNote, getCoffeeThreeVoiceStory } from '../services/claude.js';
import { resolveBlendForSlot } from '../services/blendResolver.js';

const router = Router();

const ARCHETYPE_LABEL: Record<string, string> = {
  chocolate_nutty: 'Chocolate & Nutty', balanced_sweet: 'Balanced & Sweet',
  fruity: 'Fruity', earthy: 'Earthy', floral: 'Floral', experimental: 'Experimental',
};

// ── Fetch all data needed for AI content generation ───────────────────────────
// displayName is the Axis & Bloom alias (never the coffee's raw internal name) —
// per SOMMELIER_TASK_6_VOICE.md Step 2b: getCoffeeSummary/getCoffeeSurpriseNote/
// getCoffeeThreeVoiceStory (claude.ts) build their prompt around whatever string
// is passed as coffeeName, so the generated text can and does echo it verbatim
// (confirmed: a cached surprise_note named the coffee's real internal name). The
// fix lives here, at the call site — claude.ts's functions/prompts are unchanged.
async function fetchCoffeeDataForContent(coffeeId: string | number) {
  const [coffeeResult, aliasResult, dimsResult, descriptorResult] = await Promise.all([
    db.query(
      `SELECT c.name, aa.archetype
       FROM coffees c
       LEFT JOIN archetype_assignments aa ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
       WHERE c.id = $1`,
      [coffeeId]
    ),
    db.query(
      `SELECT platform_name FROM coffee_alias
       WHERE coffee_id = $1 AND is_active = true
       ORDER BY priority ASC LIMIT 1`,
      [coffeeId]
    ),
    db.query(
      `SELECT d.name AS dimension, d.scale_min_label, d.scale_max_label,
              ROUND(AVG(csv.value_min)::numeric, 1) AS avg_min,
              ROUND(AVG(csv.value_max)::numeric, 1) AS avg_max
       FROM cupping_score_values csv
       JOIN cupping_scores cs  ON cs.id = csv.cupping_score_id
       JOIN cupping_session_coffees sc ON sc.id = cs.session_coffee_id
       JOIN coffee_dimensions d       ON d.id  = csv.dimension_id
       WHERE sc.coffee_id = $1 AND d.is_numeric = true AND csv.value_min IS NOT NULL
       GROUP BY d.id, d.name, d.scale_min_label, d.scale_max_label, d.display_order
       ORDER BY d.display_order`,
      [coffeeId]
    ),
    db.query(
      `SELECT descriptor, source, COUNT(*) AS mentions
       FROM v_collaborative_flavor_wheel
       WHERE coffee_id = $1
       GROUP BY descriptor, source
       ORDER BY mentions DESC`,
      [coffeeId]
    ),
  ]);

  if (!coffeeResult.rows.length) throw new Error('Coffee not found');

  const notesResult = await db.query(
    `SELECT cs.overall_notes FROM cupping_scores cs
     JOIN cupping_session_coffees sc ON sc.id = cs.session_coffee_id
     WHERE sc.coffee_id = $1 AND cs.overall_notes IS NOT NULL
     ORDER BY cs.id DESC LIMIT 1`,
    [coffeeId]
  );

  return {
    coffee:       coffeeResult.rows[0],
    displayName:  aliasResult.rows[0]?.platform_name ?? null,
    dimensions:   dimsResult.rows,
    descriptors:  descriptorResult.rows,
    overallNotes: notesResult.rows[0]?.overall_notes ?? null,
  };
}

// ── Generate and store all three AI content fields ────────────────────────────
// force=false: only generate fields that are currently null in the DB
// force=true:  regenerate all three (admin refresh)
export async function generateAndStoreAllContent(
  coffeeId: string | number,
  options: { force?: boolean } = {}
): Promise<{ aiSummary: string; surpriseNote: string | null; threeVoiceStory: string | null }> {
  const { force = false } = options;

  // Check what is already cached
  const cachedResult = await db.query(
    `SELECT ai_summary, surprise_note, three_voice_story FROM coffees WHERE id = $1`,
    [coffeeId]
  );
  const cached = cachedResult.rows[0] ?? {};

  const needsSummary  = force || !cached.ai_summary;
  const needsSurprise = force || !cached.surprise_note;
  const needsStory    = force || !cached.three_voice_story;

  if (!needsSummary && !needsSurprise && !needsStory) {
    return {
      aiSummary:      cached.ai_summary,
      surpriseNote:   cached.surprise_note,
      threeVoiceStory: cached.three_voice_story,
    };
  }

  const data = await fetchCoffeeDataForContent(coffeeId);
  const archetypeLabel = data.coffee.archetype
    ? (ARCHETYPE_LABEL[data.coffee.archetype] ?? data.coffee.archetype)
    : null;
  // Never the coffee's raw internal name — see fetchCoffeeDataForContent comment above.
  const safeName = data.displayName ?? archetypeLabel ?? 'This coffee';

  const dimensionParams = data.dimensions.map((r: any) => ({
    dimension:       r.dimension,
    avg_min:         Number(r.avg_min),
    avg_max:         Number(r.avg_max),
    scale_min_label: r.scale_min_label,
    scale_max_label: r.scale_max_label,
  }));

  const topDescriptors = [...new Set(data.descriptors.map((r: any) => r.descriptor as string))].slice(0, 8);

  // Build per-source descriptor lists for three-voice story
  const sourceMap: Record<string, string[]> = {};
  for (const row of data.descriptors) {
    if (!sourceMap[row.source]) sourceMap[row.source] = [];
    if (sourceMap[row.source].length < 5) sourceMap[row.source].push(row.descriptor);
  }
  const sourceData = Object.entries(sourceMap).map(([source, descriptors]) => ({
    source: source as 'internal' | 'roastery' | 'client',
    descriptors,
  }));

  // Run only what is needed, in parallel
  const [newSummary, newSurprise, newStory] = await Promise.all([
    needsSummary
      ? getCoffeeSummary({ coffeeName: safeName, archetype: archetypeLabel, dimensions: dimensionParams, topDescriptors, overallNotes: data.overallNotes })
      : Promise.resolve<string | null>(null),
    needsSurprise
      ? getCoffeeSurpriseNote({ coffeeName: safeName, archetype: archetypeLabel, dimensions: dimensionParams, topDescriptors, overallNotes: data.overallNotes })
      : Promise.resolve<string | null>(null),
    needsStory && sourceData.length >= 2
      ? getCoffeeThreeVoiceStory({ coffeeName: safeName, sourceData })
      : Promise.resolve<string | null>(null),
  ]);

  const aiSummary      = newSummary      ?? cached.ai_summary      ?? '';
  const surpriseNote   = newSurprise     ?? cached.surprise_note   ?? null;
  const threeVoiceStory = newStory       ?? cached.three_voice_story ?? null;

  // Persist to Cloud SQL — only update fields that were regenerated
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (newSummary  !== null) { updates.push(`ai_summary = $${idx++}`);       values.push(newSummary); }
  if (newSurprise !== null) { updates.push(`surprise_note = $${idx++}`);    values.push(newSurprise); }
  // For three_voice_story: if force=true and story is null (not enough sources), explicitly clear it
  if (needsStory)           { updates.push(`three_voice_story = $${idx++}`); values.push(newStory); }

  if (updates.length) {
    values.push(coffeeId);
    await db.query(`UPDATE coffees SET ${updates.join(', ')} WHERE id = $${idx}`, values);
  }

  return { aiSummary, surpriseNote, threeVoiceStory };
}

// ── Backward-compat wrapper — still used by admin refresh-summary endpoint ────
export async function generateAndStoreSummary(coffeeId: string | number): Promise<string> {
  const data = await fetchCoffeeDataForContent(coffeeId);
  const archetypeLabel = data.coffee.archetype
    ? (ARCHETYPE_LABEL[data.coffee.archetype] ?? data.coffee.archetype)
    : null;
  const safeName = data.displayName ?? archetypeLabel ?? 'This coffee';

  const summary = await getCoffeeSummary({
    coffeeName:      safeName,
    archetype:       archetypeLabel,
    dimensions:      data.dimensions.map((r: any) => ({
      dimension:       r.dimension,
      avg_min:         Number(r.avg_min),
      avg_max:         Number(r.avg_max),
      scale_min_label: r.scale_min_label,
      scale_max_label: r.scale_max_label,
    })),
    topDescriptors:  [...new Set(data.descriptors.map((r: any) => r.descriptor as string))].slice(0, 8),
    overallNotes:    data.overallNotes,
  });

  await db.query(`UPDATE coffees SET ai_summary = $1 WHERE id = $2`, [summary, coffeeId]);
  return summary;
}

// GET /api/coffees ─────────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT c.id, c.name, c.roaster, c.origin, c.process, c.roast_level,
              aa.archetype, aa.confidence
       FROM coffees c
       LEFT JOIN archetype_assignments aa
             ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
       ORDER BY c.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[coffees]', err);
    res.status(500).json({ error: 'Failed to fetch coffees' });
  }
});

// GET /api/coffees/archetypes ─────────────────────────────────────────────────
// Public, roaster-blind — The Bloom Part 1 Phase 1a. Every archetype with every
// position in its dial vocabulary (not just currently-occupied ones), so the
// frontend can render a "Temporarily unavailable" card for an empty position
// (Decision #3). coffeeId is resolved via resolveBlendForSlot — the same
// stock-aware, priority-ordered fallback that governs real fulfillment — never
// statically pinned to the priority-1 alias row (Decision #6). Never includes
// roaster or a raw coffee name anywhere in the response.
const BLOOM_WEIGHTS_OZ = [12, 80] as const;
const BLOOM_CANONICAL_WEIGHT_OZ = 12;
const BLOOM_DEFAULT_PRICE_CENTS: Record<number, number> = { 12: 3800, 80: 19900 };

router.get('/archetypes', async (_req, res) => {
  try {
    const [archetypeResult, vocabResult, priceResult] = await Promise.all([
      // dominant_dimension_id -> coffee_dimensions for the dial's DIMENSION: ___ label
      // (The Bloom Part 3, Phase B) — the same column dialSuggestion.ts already reads
      // for "which dimension does this archetype's dial travel on", not re-derived
      // from dial_position_vocabulary's per-row dimension_id.
      db.query(
        `SELECT dac.archetype, cd.name AS dimension_name,
                COALESCE(cd.platform_name, cd.name) AS dimension_platform_name
         FROM dial_archetype_config dac
         LEFT JOIN coffee_dimensions cd ON cd.id = dac.dominant_dimension_id
         ORDER BY dac.archetype`
      ),
      db.query(`SELECT archetype, sort_order, label, description FROM dial_position_vocabulary ORDER BY archetype, sort_order`),
      db.query(
        `SELECT archetype, dial_sort_order, weight_oz, retail_price_cents
         FROM dial_slot_price
         WHERE weight_oz = ANY($1::numeric[])`,
        [BLOOM_WEIGHTS_OZ]
      ),
    ]);

    const priceMap = new Map<string, number>();
    for (const row of priceResult.rows) {
      priceMap.set(`${row.archetype}|${row.dial_sort_order}|${Number(row.weight_oz)}`, row.retail_price_cents);
    }

    const archetypes = [];
    for (const { archetype, dimension_name, dimension_platform_name } of archetypeResult.rows) {
      const slotsVocab = vocabResult.rows.filter((v: any) => v.archetype === archetype);
      const slots = [];

      for (const v of slotsVocab) {
        const resolved = await resolveBlendForSlot(archetype, v.sort_order, BLOOM_CANONICAL_WEIGHT_OZ);

        if (!resolved) {
          slots.push({
            dialSortOrder: v.sort_order,
            positionLabel:  v.label,
            description:    v.description ?? null,
            isActive:       false,
            platformName:   null,
            prices:         [],
            coffeeId:       null,
          });
          continue;
        }

        const aliasResult = await db.query(
          `SELECT ca.platform_name
           FROM coffee_alias ca
           LEFT JOIN dial_archetype_positions dap ON dap.coffee_id = ca.coffee_id
           LEFT JOIN dial_position_vocabulary dpv ON dpv.id = dap.vocabulary_id
           LEFT JOIN archetype_assignments aa
             ON aa.coffee_id = ca.coffee_id AND aa.superseded_at IS NULL
           WHERE ca.coffee_id = $1 AND ca.is_active = true
             AND COALESCE(aa.archetype, ca.archetype) = $2
             AND COALESCE(dpv.sort_order, ca.dial_sort_order) = $3
           LIMIT 1`,
          [resolved.coffee_id, archetype, v.sort_order]
        );

        const prices = BLOOM_WEIGHTS_OZ.map(weightOz => ({
          weightOz,
          retailPriceCents: priceMap.get(`${archetype}|${v.sort_order}|${weightOz}`) ?? BLOOM_DEFAULT_PRICE_CENTS[weightOz],
        }));

        slots.push({
          dialSortOrder: v.sort_order,
          positionLabel:  v.label,
          description:    v.description ?? null,
          isActive:       true,
          platformName:   aliasResult.rows[0]?.platform_name ?? null,
          prices,
          coffeeId:       resolved.coffee_id,
        });
      }

      archetypes.push({
        archetype,
        archetypeLabel: ARCHETYPE_LABEL[archetype] ?? archetype,
        dimensionName: dimension_name ?? null,
        dimensionPlatformName: dimension_platform_name ?? null,
        slots,
      });
    }

    res.json(archetypes);
  } catch (err) {
    console.error('[coffees/archetypes]', err);
    res.status(500).json({ error: 'Failed to fetch archetypes' });
  }
});

// GET /api/coffees/:coffeeId/hops — Bloom Dial hop navigation ─────────────────
// Public, roaster-blind wrapper over dial_coffee_relationships — The Bloom Part 1
// Phase 1e. Derives the target's LIVE slot (its current archetype/position may
// have moved since the hop was recorded — never trust the stored to_coffee
// association alone). Only is_recommended hops; drops any hop whose derived
// target slot isn't currently active (a dead end otherwise); ordered by
// confidence high→medium→low; capped at 3. Never includes to_coffee's id, name,
// or roaster.
router.get('/:coffeeId/hops', async (req, res) => {
  const { coffeeId } = req.params;
  try {
    const hopsResult = await db.query(
      `SELECT cd.name AS dimension_name, dcr.direction, dcr.hop_type, dcr.confidence,
              aa.archetype   AS target_archetype,
              dpv.sort_order AS target_sort_order,
              dpv.label      AS target_position_label
       FROM dial_coffee_relationships dcr
       JOIN coffee_dimensions cd ON cd.id = dcr.dimension_id
       LEFT JOIN archetype_assignments aa
         ON aa.coffee_id = dcr.to_coffee_id AND aa.superseded_at IS NULL
       LEFT JOIN dial_archetype_positions dap
         ON dap.coffee_id = dcr.to_coffee_id AND dap.archetype = aa.archetype
       LEFT JOIN dial_position_vocabulary dpv ON dpv.id = dap.vocabulary_id
       WHERE dcr.from_coffee_id = $1
         AND dcr.is_recommended = true
         AND dcr.to_coffee_id IS NOT NULL
       ORDER BY CASE dcr.confidence WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
      [coffeeId]
    );

    const hops: Array<{
      dimensionName: string; direction: string; hopType: string; confidence: string;
      target: { archetype: string; archetypeLabel: string; dialSortOrder: number; positionLabel: string; platformName: string | null };
    }> = [];

    for (const row of hopsResult.rows) {
      if (hops.length >= 3) break;
      if (!row.target_archetype || row.target_sort_order == null) continue;

      const resolved = await resolveBlendForSlot(row.target_archetype, row.target_sort_order, BLOOM_CANONICAL_WEIGHT_OZ);
      if (!resolved) continue; // target slot isn't currently active — a dead end, not a feature

      const aliasResult = await db.query(
        `SELECT ca.platform_name
         FROM coffee_alias ca
         LEFT JOIN dial_archetype_positions dap ON dap.coffee_id = ca.coffee_id
         LEFT JOIN dial_position_vocabulary dpv ON dpv.id = dap.vocabulary_id
         LEFT JOIN archetype_assignments aa
           ON aa.coffee_id = ca.coffee_id AND aa.superseded_at IS NULL
         WHERE ca.coffee_id = $1 AND ca.is_active = true
           AND COALESCE(aa.archetype, ca.archetype) = $2
           AND COALESCE(dpv.sort_order, ca.dial_sort_order) = $3
         LIMIT 1`,
        [resolved.coffee_id, row.target_archetype, row.target_sort_order]
      );

      hops.push({
        dimensionName: row.dimension_name,
        direction:     row.direction,
        hopType:       row.hop_type,
        confidence:    row.confidence,
        target: {
          archetype:      row.target_archetype,
          archetypeLabel: ARCHETYPE_LABEL[row.target_archetype] ?? row.target_archetype,
          dialSortOrder:  row.target_sort_order,
          positionLabel:  row.target_position_label,
          platformName:   aliasResult.rows[0]?.platform_name ?? null,
        },
      });
    }

    res.json(hops);
  } catch (err) {
    console.error('[coffees/hops]', err);
    res.status(500).json({ error: 'Failed to fetch hop navigation' });
  }
});

// GET /api/coffees/:id/flavor-wheel ───────────────────────────────────────────
// coffee_name dropped from the query (The Bloom Part 1 Phase 1c) — the bubble
// cloud only ever renders wheel_category/wheel_subcategory/descriptor/source/
// mentions/avg_intensity, and this endpoint is shared with the roaster-blind
// Bloom page, so it must never echo the raw coffee name.
router.get('/:id/flavor-wheel', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT wheel_category, wheel_subcategory, descriptor, source,
              COUNT(*) AS mentions, AVG(intensity) AS avg_intensity
       FROM v_collaborative_flavor_wheel
       WHERE coffee_id = $1
       GROUP BY wheel_category, wheel_subcategory, descriptor, source
       ORDER BY wheel_category, mentions DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[coffees/flavor-wheel]', err);
    res.status(500).json({ error: 'Failed to fetch flavor wheel' });
  }
});

// GET /api/coffees/:id/dimensions ─────────────────────────────────────────────
router.get('/:id/dimensions', async (req, res) => {
  const { id } = req.params;
  try {
    const [dimsResult, notesResult] = await Promise.all([
      db.query(
        `SELECT d.name AS dimension,
                d.scale_min_label,
                d.scale_max_label,
                d.display_order,
                ROUND(AVG(csv.value_min)::numeric, 1) AS avg_min,
                ROUND(AVG(csv.value_max)::numeric, 1) AS avg_max,
                COUNT(DISTINCT cs.id) AS session_count
         FROM cupping_score_values csv
         JOIN cupping_scores cs    ON cs.id  = csv.cupping_score_id
         JOIN cupping_session_coffees sc   ON sc.id  = cs.session_coffee_id
         JOIN coffee_dimensions d         ON d.id   = csv.dimension_id
         WHERE sc.coffee_id = $1
           AND d.is_numeric = true
           AND csv.value_min IS NOT NULL
         GROUP BY d.id, d.name, d.scale_min_label, d.scale_max_label, d.display_order
         ORDER BY d.display_order`,
        [id]
      ),
      db.query(
        `SELECT cs.overall_notes, css.session_date
         FROM cupping_scores cs
         JOIN cupping_session_coffees sc   ON sc.id  = cs.session_coffee_id
         JOIN cupping_sessions css ON css.id = sc.session_id
         WHERE sc.coffee_id = $1
           AND cs.overall_notes IS NOT NULL
         ORDER BY css.session_date DESC`,
        [id]
      ),
    ]);
    res.json({ dimensions: dimsResult.rows, notes: notesResult.rows });
  } catch (err) {
    console.error('[coffees/dimensions]', err);
    res.status(500).json({ error: 'Failed to fetch dimension data' });
  }
});

// GET /api/coffees/:id/content ────────────────────────────────────────────────
// Returns all three AI content fields. Generates missing ones on first request.
router.get('/:id/content', async (req, res) => {
  const { id } = req.params;
  try {
    const content = await generateAndStoreAllContent(id, { force: false });
    res.json({
      aiSummary:       content.aiSummary,
      surpriseNote:    content.surpriseNote,
      threeVoiceStory: content.threeVoiceStory,
    });
  } catch (err) {
    console.error('[coffees/content]', err);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

// GET /api/coffees/:id/ai-summary ─────────────────────────────────────────────
// Kept for backward compatibility. New code should use /content.
router.get('/:id/ai-summary', async (req, res) => {
  const { id } = req.params;
  try {
    const cached = await db.query(`SELECT ai_summary FROM coffees WHERE id = $1`, [id]);
    if (cached.rows[0]?.ai_summary) {
      res.json({ summary: cached.rows[0].ai_summary });
      return;
    }
    const summary = await generateAndStoreSummary(id);
    res.json({ summary });
  } catch (err) {
    console.error('[coffees/ai-summary]', err);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

export default router;
