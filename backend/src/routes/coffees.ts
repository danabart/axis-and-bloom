import { Router } from 'express';
import { db } from '../db/client.js';
import { getCoffeeSummary, getCoffeeSurpriseNote, getCoffeeThreeVoiceStory } from '../services/claude.js';
import { resolveBlendForSlot, resolveCoffeeBlend } from '../services/blendResolver.js';
import { generateCoffeeStoryWithRetry, checkStorySpecificityViolations } from '../services/storyLayer.js';

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
//
// HOME_TASK_5: the alias query below now resolves the *live dial slot name*
// first (falling back to coffee_alias.platform_name only for category coffees
// with no dial slot), copied from sommelierRag.ts's getAliases() rather than
// reinvented — S44's exact lesson: the old coffee_alias-only query here would
// have gone stale the same way Liam's catalog context once did. origin/process/
// roasterNames are new — feeding HOME_TASK_5's story generator; roasterNames
// covers both the legacy `coffees.roaster` column and any roaster linked via
// roaster_blend, since either could appear in the raw source material.
// Resolves a coffee's live dial slot name first, falling back to
// coffee_alias.platform_name only for category coffees with no dial slot —
// copied from sommelierRag.ts's getAliases() rather than reinvented (S44's
// exact lesson: a coffee_alias-only query here would go stale the same way
// Liam's catalog context once did). Shared by fetchCoffeeDataForContent
// (content generation) and GET /:id/story (the public story page).
async function resolveDisplayName(coffeeId: string | number): Promise<string | null> {
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
     WHERE ca.coffee_id = $1 AND ca.is_active = true
     ORDER BY ca.coffee_id, ca.priority ASC`,
    [coffeeId]
  );
  return result.rows[0]?.platform_name ?? null;
}

export async function fetchCoffeeDataForContent(coffeeId: string | number) {
  const [coffeeResult, displayName, dimsResult, descriptorResult, roasterBlendResult] = await Promise.all([
    db.query(
      `SELECT c.name, c.roaster, c.origin, c.process, aa.archetype
       FROM coffees c
       LEFT JOIN archetype_assignments aa ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
       WHERE c.id = $1`,
      [coffeeId]
    ),
    resolveDisplayName(coffeeId),
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
    db.query(
      `SELECT DISTINCT r.name FROM roaster_blend rb
       JOIN roaster r ON r.id = rb.roaster_id
       WHERE rb.coffee_id = $1 AND r.name IS NOT NULL`,
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

  const roasterNames = [
    ...new Set([
      coffeeResult.rows[0]?.roaster,
      ...roasterBlendResult.rows.map((r: { name: string }) => r.name),
    ].filter((n): n is string => !!n)),
  ];

  return {
    coffee:       coffeeResult.rows[0],
    displayName,
    dimensions:   dimsResult.rows,
    descriptors:  descriptorResult.rows,
    overallNotes: notesResult.rows[0]?.overall_notes ?? null,
    roasterNames,
  };
}

// ── Generate and store all three AI content fields (+ HOME_TASK_5's story) ────
// force=false: only generate fields that are currently null in the DB
// force=true:  regenerate all (admin refresh) — EXCEPT story when
//              story_admin_edited is true, which bulk regenerate always skips.
export async function generateAndStoreAllContent(
  coffeeId: string | number,
  options: { force?: boolean } = {}
): Promise<{
  aiSummary: string;
  surpriseNote: string | null;
  threeVoiceStory: string | null;
  story: string | null;
  storyPublished: boolean;
}> {
  const { force = false } = options;

  // Check what is already cached
  const cachedResult = await db.query(
    `SELECT ai_summary, surprise_note, three_voice_story, story, story_published, story_admin_edited
     FROM coffees WHERE id = $1`,
    [coffeeId]
  );
  const cached = cachedResult.rows[0] ?? {};

  const needsSummary  = force || !cached.ai_summary;
  const needsSurprise = force || !cached.surprise_note;
  const needsStory    = force || !cached.three_voice_story;
  // Admin-edited story content is never auto-regenerated over (spec item 3) —
  // this is the one field `force` does not override.
  const needsStoryText = !cached.story_admin_edited && (force || !cached.story);

  if (!needsSummary && !needsSurprise && !needsStory && !needsStoryText) {
    return {
      aiSummary:      cached.ai_summary,
      surpriseNote:   cached.surprise_note,
      threeVoiceStory: cached.three_voice_story,
      story:           cached.story,
      storyPublished:  cached.story_published ?? false,
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

  // HOME_TASK_5 — skip gracefully when there's truly no usable signal (the
  // coffee-16 "Chocolate" case from S38: no archetype, no cupping data). No
  // data, no story, no error — same spirit as three_voice_story's own
  // sourceData.length >= 2 guard just above.
  const hasEnoughDataForStory = archetypeLabel !== null || dimensionParams.length > 0 || topDescriptors.length > 0;

  // Run only what is needed, in parallel
  const [newSummary, newSurprise, newStory, storyResult] = await Promise.all([
    needsSummary
      ? getCoffeeSummary({ coffeeName: safeName, archetype: archetypeLabel, dimensions: dimensionParams, topDescriptors, overallNotes: data.overallNotes })
      : Promise.resolve<string | null>(null),
    needsSurprise
      ? getCoffeeSurpriseNote({ coffeeName: safeName, archetype: archetypeLabel, dimensions: dimensionParams, topDescriptors, overallNotes: data.overallNotes })
      : Promise.resolve<string | null>(null),
    needsStory && sourceData.length >= 2
      ? getCoffeeThreeVoiceStory({ coffeeName: safeName, sourceData })
      : Promise.resolve<string | null>(null),
    needsStoryText && hasEnoughDataForStory
      ? generateCoffeeStoryWithRetry(
          { displayName: safeName, archetype: archetypeLabel, origin: data.coffee.origin ?? null, process: data.coffee.process ?? null, dimensions: dimensionParams, topDescriptors },
          { rawCoffeeName: data.coffee.name ?? null, roasterNames: data.roasterNames }
        )
      : Promise.resolve(null),
  ]);

  const aiSummary      = newSummary      ?? cached.ai_summary      ?? '';
  const surpriseNote   = newSurprise     ?? cached.surprise_note   ?? null;
  const threeVoiceStory = newStory       ?? cached.three_voice_story ?? null;
  // "Generate, scan, THEN mark live" — story_draft always gets the latest
  // attempt (even a failed one, for admin visibility); `story` (the only
  // field anything customer-facing reads) and story_published only advance
  // when that attempt actually passed the specificity check.
  const story          = storyResult?.passed ? storyResult.text : (cached.story ?? null);
  const storyPublished = storyResult ? storyResult.passed : (cached.story_published ?? false);

  // Persist to Cloud SQL — only update fields that were regenerated
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (newSummary  !== null) { updates.push(`ai_summary = $${idx++}`);       values.push(newSummary); }
  if (newSurprise !== null) { updates.push(`surprise_note = $${idx++}`);    values.push(newSurprise); }
  // For three_voice_story: if force=true and story is null (not enough sources), explicitly clear it
  if (needsStory)           { updates.push(`three_voice_story = $${idx++}`); values.push(newStory); }
  if (storyResult) {
    updates.push(`story_draft = $${idx++}`);       values.push(storyResult.text);
    updates.push(`story_generated_at = NOW()`);
    if (storyResult.passed) {
      updates.push(`story = $${idx++}`);           values.push(storyResult.text);
      updates.push(`story_published = true`);
    } else {
      console.warn(`[generateAndStoreAllContent] story for coffee ${coffeeId} failed specificity check after ${storyResult.attempts} attempt(s): ${storyResult.violations.join('; ')} — left unpublished, see story_draft`);
    }
  }

  if (updates.length) {
    values.push(coffeeId);
    await db.query(`UPDATE coffees SET ${updates.join(', ')} WHERE id = $${idx}`, values);
  }

  return { aiSummary, surpriseNote, threeVoiceStory, story, storyPublished };
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
// No hardcoded fallback price. A weight with no explicit dial_slot_price/
// coffee_retail_price row is omitted from `prices` entirely rather than guessed —
// the frontend renders that as "Unpriced" (PositionCard.tsx/OtherCategoryCard.tsx),
// the same deliberate-gap treatment already used for "no coffee resolved" (Pricing
// update, 2026-07-24 — see backend/src/db/migrations/pricing_update_2026_07_24.sql).

// Shared per-archetype slot builder — used by both /archetypes (the 5 real
// archetypes) and /experimental (Bloom Dial Base Data Part 4, §B2/C1). Resolves
// each of an archetype's dial_position_vocabulary rows to a Slot via the same
// stock-aware resolveBlendForSlot() every consumer already trusts.
async function buildSlotsForArchetype(
  archetype: string,
  vocabRows: { sort_order: number; label: string; description: string | null }[],
  slotAliasMap: Map<string, string>,
  priceMap: Map<string, number>,
) {
  const slots = [];
  for (const v of vocabRows) {
    const resolved = await resolveBlendForSlot(archetype, v.sort_order, BLOOM_CANONICAL_WEIGHT_OZ);

    if (!resolved) {
      slots.push({
        dialSortOrder: v.sort_order,
        positionLabel:  v.label,
        description:    v.description ?? null,
        isActive:       false,
        platformName:   null,
        isDefault:      false,
        prices:         [],
        coffeeId:       null,
      });
      continue;
    }

    // isDefault (Part 1 Decision #8) is joined off dap.archetype = $2 (this slot's
    // archetype) explicitly, not just ca.coffee_id — dial_archetype_positions.is_default
    // is keyed by (coffee_id, archetype), and the same coffee_id can carry is_default
    // rows under more than one archetype context, so an unfiltered join could pick up
    // the wrong one.
    const defaultResult = await db.query(
      `SELECT ca.coffee_id, dap.is_default
       FROM coffee_alias ca
       LEFT JOIN dial_archetype_positions dap ON dap.coffee_id = ca.coffee_id AND dap.archetype = $2
       LEFT JOIN dial_position_vocabulary dpv ON dpv.id = dap.vocabulary_id
       LEFT JOIN archetype_assignments aa
         ON aa.coffee_id = ca.coffee_id AND aa.superseded_at IS NULL
       WHERE ca.coffee_id = $1 AND ca.is_active = true
         AND COALESCE(aa.archetype, ca.archetype) = $2
         AND COALESCE(dpv.sort_order, ca.dial_sort_order) = $3
       LIMIT 1`,
      [resolved.coffee_id, archetype, v.sort_order]
    );

    const prices: { weightOz: number; retailPriceCents: number }[] = [];
    for (const weightOz of BLOOM_WEIGHTS_OZ) {
      const cents = priceMap.get(`${archetype}|${v.sort_order}|${weightOz}`);
      if (cents !== undefined) prices.push({ weightOz, retailPriceCents: cents });
    }

    slots.push({
      dialSortOrder: v.sort_order,
      positionLabel:  v.label,
      description:    v.description ?? null,
      isActive:       true,
      platformName:   slotAliasMap.get(`${archetype}|${v.sort_order}`) ?? null,
      isDefault:      defaultResult.rows[0]?.is_default ?? false,
      prices,
      coffeeId:       resolved.coffee_id,
    });
  }
  return slots;
}

router.get('/archetypes', async (_req, res) => {
  try {
    const [archetypeResult, vocabResult, priceResult, slotAliasResult] = await Promise.all([
      // dominant_dimension_id -> coffee_dimensions for the dial's DIMENSION: ___ label
      // (The Bloom Part 3, Phase B) — the same column dialSuggestion.ts already reads
      // for "which dimension does this archetype's dial travel on", not re-derived
      // from dial_position_vocabulary's per-row dimension_id.
      // is_archetype = true (Bloom Dial Base Data Part 3) — 'experimental' is a
      // category, not a peer flavor dial; it's presented separately (see
      // GET /experimental, Bloom Dial Base Data Part 4), not looped here
      // alongside the 5 real archetypes.
      db.query(
        `SELECT dac.archetype, cd.name AS dimension_name,
                COALESCE(cd.platform_name, cd.name) AS dimension_platform_name
         FROM dial_archetype_config dac
         LEFT JOIN coffee_dimensions cd ON cd.id = dac.dominant_dimension_id
         WHERE dac.is_archetype = true
         ORDER BY dac.archetype`
      ),
      db.query(`SELECT archetype, sort_order, label, description FROM dial_position_vocabulary ORDER BY archetype, sort_order`),
      db.query(
        `SELECT archetype, dial_sort_order, weight_oz, retail_price_cents
         FROM dial_slot_price
         WHERE weight_oz = ANY($1::numeric[])`,
        [BLOOM_WEIGHTS_OZ]
      ),
      db.query(`SELECT archetype, dial_sort_order, platform_name FROM dial_slot_alias`),
    ]);

    const priceMap = new Map<string, number>();
    for (const row of priceResult.rows) {
      priceMap.set(`${row.archetype}|${row.dial_sort_order}|${Number(row.weight_oz)}`, row.retail_price_cents);
    }

    // Bloom Dial Base Data Part 3: a slot's display name is a property of the slot
    // (archetype, dial_sort_order), never the coffee occupying it — see dial_slot_alias.
    const slotAliasMap = new Map<string, string>();
    for (const row of slotAliasResult.rows) {
      slotAliasMap.set(`${row.archetype}|${row.dial_sort_order}`, row.platform_name);
    }

    const archetypes = [];
    for (const { archetype, dimension_name, dimension_platform_name } of archetypeResult.rows) {
      const slotsVocab = vocabResult.rows.filter((v: any) => v.archetype === archetype);
      const slots = await buildSlotsForArchetype(archetype, slotsVocab, slotAliasMap, priceMap);

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

// GET /api/coffees/experimental ────────────────────────────────────────────────
// Public, roaster-blind. Bloom Dial Base Data Part 4, §B2/C1: Experimental gets
// its own archetype-style box on both The Bloom and Flavor Intelligence — same
// shape as one entry from GET /archetypes above (reuses buildSlotsForArchetype),
// titled "Experimental" (the family name), NOT "The Unexpected" (that's just the
// slot-2 alias — a coffee inside this box, e.g. Kopi Safari, shows its own slot
// alias as usual). Sourced from the experimental dial_archetype_positions/
// dial_position_vocabulary rows, which still exist and were never removed — only
// excluded from the main /archetypes loop (is_archetype=false). A coffee's
// archetype_assignments match (e.g. Kopi Safari -> earthy) is unrelated and
// untouched by this endpoint; this is presentation only.
router.get('/experimental', async (_req, res) => {
  try {
    const [vocabResult, priceResult, slotAliasResult, dimensionResult] = await Promise.all([
      db.query(`SELECT sort_order, label, description FROM dial_position_vocabulary WHERE archetype = 'experimental' ORDER BY sort_order`),
      db.query(
        `SELECT archetype, dial_sort_order, weight_oz, retail_price_cents
         FROM dial_slot_price WHERE archetype = 'experimental' AND weight_oz = ANY($1::numeric[])`,
        [BLOOM_WEIGHTS_OZ]
      ),
      db.query(`SELECT archetype, dial_sort_order, platform_name FROM dial_slot_alias WHERE archetype = 'experimental'`),
      // dial_archetype_config.dominant_dimension_id is NULL for 'experimental'
      // (is_archetype=false, not a peer flavor family with its own calibrated
      // dimension) — resolve the dial's dimension from its own vocabulary rows
      // instead, same dimension_id (9, Savory/Depth) on all 4 by construction.
      db.query(
        `SELECT cd.name AS dimension_name, COALESCE(cd.platform_name, cd.name) AS dimension_platform_name
         FROM dial_position_vocabulary dpv
         JOIN coffee_dimensions cd ON cd.id = dpv.dimension_id
         WHERE dpv.archetype = 'experimental'
         LIMIT 1`
      ),
    ]);

    const priceMap = new Map<string, number>();
    for (const row of priceResult.rows) {
      priceMap.set(`${row.archetype}|${row.dial_sort_order}|${Number(row.weight_oz)}`, row.retail_price_cents);
    }
    const slotAliasMap = new Map<string, string>();
    for (const row of slotAliasResult.rows) {
      slotAliasMap.set(`${row.archetype}|${row.dial_sort_order}`, row.platform_name);
    }

    const slots = await buildSlotsForArchetype('experimental', vocabResult.rows, slotAliasMap, priceMap);

    res.json({
      archetype: 'experimental',
      archetypeLabel: ARCHETYPE_LABEL['experimental'] ?? 'Experimental',
      dimensionName: dimensionResult.rows[0]?.dimension_name ?? null,
      dimensionPlatformName: dimensionResult.rows[0]?.dimension_platform_name ?? null,
      slots,
    });
  } catch (err) {
    console.error('[coffees/experimental]', err);
    res.status(500).json({ error: 'Failed to fetch experimental' });
  }
});

// GET /api/coffees/archetype-order?archetype= ─────────────────────────────────
// Public. Bloom Dial Base Data Part 4, §B3: The Bloom's archetype boxes are
// ordered by the customer's match, nearest neighbor first — computed here, not
// hard-coded in the frontend. With a valid, real (is_archetype=true) archetype
// match: that archetype first, then the other 4 by ascending Euclidean distance
// over v_archetype_vectors' ideal_score (per shared dimension). No match (missing/
// invalid param — pre-quiz guest) falls back to a fixed default order, the same
// 5-archetype order the frontend previously hard-coded in bloomVisuals.ts.
// Experimental is deliberately excluded from this array — it's placed after the
// flavor archetypes as a fixed position by the frontend, not personalized.
const DEFAULT_ARCHETYPE_ORDER = ['floral', 'fruity', 'balanced_sweet', 'chocolate_nutty', 'earthy'];

router.get('/archetype-order', async (req, res) => {
  try {
    const requested = typeof req.query.archetype === 'string' ? req.query.archetype : '';

    // Validate against the known 5 real archetypes in JS before ever touching the
    // DB — archetype is an enum-typed column, and querying it with an arbitrary
    // string (garbage input, or a valid-but-non-flavor enum value like
    // 'experimental') throws a Postgres cast error rather than matching zero
    // rows. DEFAULT_ARCHETYPE_ORDER doubles as the exact "real, is_archetype=true"
    // allow-list, so membership here is sufficient — no separate DB check needed.
    if (!DEFAULT_ARCHETYPE_ORDER.includes(requested)) {
      res.json({ order: DEFAULT_ARCHETYPE_ORDER });
      return;
    }

    const vectorsResult = await db.query(`SELECT archetype, dimension, ideal_score FROM v_archetype_vectors`);
    const byDisplayName = new Map<string, Map<string, number>>();
    for (const row of vectorsResult.rows) {
      if (!byDisplayName.has(row.archetype)) byDisplayName.set(row.archetype, new Map());
      byDisplayName.get(row.archetype)!.set(row.dimension, Number(row.ideal_score));
    }

    const matchedVec = byDisplayName.get(ARCHETYPE_LABEL[requested] ?? '');
    if (!matchedVec) {
      res.json({ order: DEFAULT_ARCHETYPE_ORDER });
      return;
    }

    const others = DEFAULT_ARCHETYPE_ORDER.filter(a => a !== requested);
    const withDistance = others.map(enumValue => {
      const vec = byDisplayName.get(ARCHETYPE_LABEL[enumValue] ?? '');
      let sumSquares = 0;
      if (vec) {
        for (const [dimension, idealScore] of matchedVec) {
          if (vec.has(dimension)) sumSquares += (idealScore - vec.get(dimension)!) ** 2;
        }
      }
      return { enumValue, distance: Math.sqrt(sumSquares) };
    });
    withDistance.sort((a, b) => a.distance - b.distance);

    res.json({ order: [requested, ...withDistance.map(d => d.enumValue)] });
  } catch (err) {
    console.error('[coffees/archetype-order]', err);
    res.status(500).json({ error: 'Failed to compute archetype order' });
  }
});

// GET /api/coffees/other-categories ───────────────────────────────────────────
// Public, roaster-blind. Bloom Dial Base Data Part 3, Phase 6: coffees tagged
// Decaf/Half-Caf/Flavored/Experimental never get a flavor-dial slot (see
// /archetypes above and blendResolver.ts's category exclusion), but are still
// matched to an archetype (Liam/quiz) and still shoppable where a real SKU
// exists. This is their presentation surface — grouped by category tag on the
// frontend (Other Categories = decaf/half_caf/flavored, The Unexpected =
// experimental), not by dial slot. displayName falls back from coffee_alias
// (legacy per-coffee name, still meaningful here since these coffees never
// share a slot) to the coffee's raw name when no alias row exists.
router.get('/other-categories', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT c.id AS coffee_id, c.name AS coffee_name,
             ca.platform_name,
             aa.archetype,
             cc.code AS category_code, cc.label AS category_label, cc.sort_order AS category_sort_order
      FROM coffee_category_assignment cca
      JOIN coffee_category cc ON cc.id = cca.category_id
      JOIN coffees c ON c.id = cca.coffee_id
      LEFT JOIN archetype_assignments aa ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
      LEFT JOIN coffee_alias ca ON ca.coffee_id = c.id AND ca.is_active = true
      WHERE cc.code IN ('decaf', 'half_caf', 'flavored', 'experimental')
      ORDER BY cc.sort_order, c.name
    `);

    // Group by coffee first — a coffee can carry more than one category tag
    // (e.g. a flavored decaf) and must appear once per tag on the frontend,
    // but price/blend resolution only needs to happen once per coffee.
    const byCoffee = new Map<number, {
      coffee_name: string; platform_name: string | null; archetype: string | null;
      categories: { code: string; label: string; sortOrder: number }[];
    }>();
    for (const row of result.rows) {
      if (!byCoffee.has(row.coffee_id)) {
        byCoffee.set(row.coffee_id, {
          coffee_name: row.coffee_name, platform_name: row.platform_name, archetype: row.archetype, categories: [],
        });
      }
      byCoffee.get(row.coffee_id)!.categories.push({ code: row.category_code, label: row.category_label, sortOrder: row.category_sort_order });
    }

    const priceRows = await db.query(
      `SELECT coffee_id, weight_oz, retail_price_cents FROM coffee_retail_price WHERE weight_oz = ANY($1::numeric[])`,
      [BLOOM_WEIGHTS_OZ]
    );
    const priceMap = new Map<string, number>();
    for (const r of priceRows.rows) priceMap.set(`${r.coffee_id}|${Number(r.weight_oz)}`, r.retail_price_cents);

    const coffees = [];
    for (const [coffeeId, info] of byCoffee) {
      const prices = [];
      for (const weightOz of BLOOM_WEIGHTS_OZ) {
        const cents = priceMap.get(`${coffeeId}|${weightOz}`);
        if (cents === undefined) continue; // unpriced — omit rather than guess
        const blend = await resolveCoffeeBlend(coffeeId, weightOz);
        prices.push({ weightOz, retailPriceCents: cents, isActive: !!blend });
      }
      coffees.push({
        coffeeId,
        displayName: info.platform_name ?? info.coffee_name,
        archetype: info.archetype,
        archetypeLabel: info.archetype ? (ARCHETYPE_LABEL[info.archetype] ?? info.archetype) : null,
        categories: info.categories.sort((a, b) => a.sortOrder - b.sortOrder),
        prices,
        effectivelyActive: prices.some(p => p.isActive),
        isUnpriced: prices.length === 0,
      });
    }

    res.json(coffees);
  } catch (err) {
    console.error('[coffees/other-categories]', err);
    res.status(500).json({ error: 'Failed to fetch other-category coffees' });
  }
});

// GET /api/coffees/archetype-stats?archetype= ─────────────────────────────────
// Public, no auth, roaster-blind — archetype-level aggregate only, never touches
// coffee identity. Flavor Intelligence Part 1 Decision #3. Backed by
// v_archetype_dimension_comparison, which already bridges archetype_enum ->
// archetype.name internally (via CASE) — don't re-derive that mapping here,
// just look the view up by the human label.
router.get('/archetype-stats', async (req, res) => {
  const archetype = String(req.query.archetype ?? '');
  const archetypeLabel = ARCHETYPE_LABEL[archetype];
  if (!archetypeLabel) {
    res.status(400).json({ error: 'Unknown or missing archetype' });
    return;
  }
  try {
    const result = await db.query(
      `SELECT dimension, display_order, target_min, target_ideal, target_max,
              avg_actual, coffee_count
       FROM v_archetype_dimension_comparison
       WHERE archetype = $1
       ORDER BY display_order`,
      [archetypeLabel]
    );
    res.json({
      archetype,
      archetypeLabel,
      dimensions: result.rows.map(r => ({
        dimension:    r.dimension,
        displayOrder: r.display_order,
        targetMin:    r.target_min,
        targetIdeal:  r.target_ideal,
        targetMax:    r.target_max,
        avgActual:    r.avg_actual,
        coffeeCount:  Number(r.coffee_count),
      })),
    });
  } catch (err) {
    console.error('[coffees/archetype-stats]', err);
    res.status(500).json({ error: 'Failed to fetch archetype stats' });
  }
});

// GET /api/coffees/:id/legacy-slot — resolves a raw coffeeId (the old
// `?coffee={id}` deep-link contract) to its current {archetype, dialSortOrder}
// so the frontend can redirect to the new `?archetype=&slot=` contract (Part 1
// Decision #4). Roaster-blind — never returns coffee identity, only the slot
// location. 404 if the coffee has no live, non-superseded archetype/dial-position
// assignment (nothing to redirect to).
router.get('/:id/legacy-slot', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT aa.archetype, dpv.sort_order AS dial_sort_order
       FROM archetype_assignments aa
       JOIN dial_archetype_positions dap ON dap.coffee_id = aa.coffee_id AND dap.archetype = aa.archetype
       JOIN dial_position_vocabulary dpv ON dpv.id = dap.vocabulary_id
       WHERE aa.coffee_id = $1 AND aa.superseded_at IS NULL
       LIMIT 1`,
      [id]
    );
    if (!result.rows.length) {
      res.status(404).json({ error: 'No current slot found for this coffee' });
      return;
    }
    res.json({ archetype: result.rows[0].archetype, dialSortOrder: result.rows[0].dial_sort_order });
  } catch (err) {
    console.error('[coffees/legacy-slot]', err);
    res.status(500).json({ error: 'Failed to resolve legacy coffee link' });
  }
});

// GET /api/coffees/:coffeeId/hops — Bloom Dial hop navigation ─────────────────
// Public, roaster-blind wrapper over dial_coffee_relationships — The Bloom Part 1
// Phase 1e. Derives the target's LIVE slot (its current archetype/position may
// have moved since the hop was recorded — never trust the stored to_coffee
// association alone). Only is_recommended hops; drops any hop whose derived
// target slot isn't currently active (a dead end otherwise); ordered by
// confidence high→medium→low; capped at 3. Never includes to_coffee's id, name,
// or roaster. dimensionName uses COALESCE(platform_name, name) (The Bloom Part 3
// follow-up) so hop link copy ("less intensity") matches the consumer-facing
// word the dial itself shows ("DIMENSION: INTENSITY"), not the raw SCA term.
router.get('/:coffeeId/hops', async (req, res) => {
  const { coffeeId } = req.params;
  try {
    const hopsResult = await db.query(
      `SELECT COALESCE(cd.platform_name, cd.name) AS dimension_name, dcr.direction, dcr.hop_type, dcr.confidence,
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

      // Bloom Dial Base Data Part 3: the target's label is the SLOT's name
      // (dial_slot_alias), not a per-coffee coffee_alias.platform_name.
      const aliasResult = await db.query(
        `SELECT platform_name FROM dial_slot_alias WHERE archetype = $1 AND dial_sort_order = $2`,
        [row.target_archetype, row.target_sort_order]
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
// cupping_note_id added (Profile Part 2 §C, additive) — Profile Part 3's tasted-
// notes chips need a stable id to submit, not just the descriptor label; every
// existing consumer (the bubble cloud) already ignores unknown fields.
router.get('/:id/flavor-wheel', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT cupping_note_id, wheel_category, wheel_subcategory, descriptor, source,
              COUNT(*) AS mentions, AVG(intensity) AS avg_intensity
       FROM v_collaborative_flavor_wheel
       WHERE coffee_id = $1
       GROUP BY cupping_note_id, wheel_category, wheel_subcategory, descriptor, source
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
// Returns all three AI content fields, plus (Flavor Intelligence Part 1 Decision
// #7) process/roastLevel/originRegion — generic flavor vocabulary and a broad
// geographic bucket, safe to show publicly. Never the raw `origin` column or
// `roaster` — those stay server-side only. originRegion is null if the coffee
// hasn't been backfilled yet.
router.get('/:id/content', async (req, res) => {
  const { id } = req.params;
  try {
    const [content, extraResult] = await Promise.all([
      generateAndStoreAllContent(id, { force: false }),
      db.query(
        `SELECT c.process, c.roast_level, lv.label AS origin_region
         FROM coffees c
         LEFT JOIN lookup_value lv ON lv.id = c.origin_region_id
         WHERE c.id = $1`,
        [id]
      ),
    ]);
    const extra = extraResult.rows[0] ?? {};
    res.json({
      aiSummary:       content.aiSummary,
      surpriseNote:    content.surpriseNote,
      threeVoiceStory: content.threeVoiceStory,
      process:         extra.process ?? null,
      roastLevel:      extra.roast_level ?? null,
      originRegion:    extra.origin_region ?? null,
    });
  } catch (err) {
    console.error('[coffees/content]', err);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

// GET /api/coffees/:id/story ───────────────────────────────────────────────────
// HOME_TASK_5 (§4.4) — the public story page's data. Public, no auth: this is
// exactly the surface Task 7's QR redirect (`/b/{token}`) will send a signed-
// in-but-non-owner scan (or, pending Task 7's own retired-coffee handling, a
// retired-coffee scan) to — the route shape is built to serve both without
// change. Roaster-blind, same discipline as /:id/hops: never the raw coffee
// name or roaster, and `story` is only ever the *published* text — a draft
// stuck failing its specificity check is never reachable here.
router.get('/:id/story', async (req, res) => {
  const { id } = req.params;
  try {
    const [coffeeResult, displayName, slotResult] = await Promise.all([
      db.query(`SELECT story, story_published FROM coffees WHERE id = $1`, [id]),
      resolveDisplayName(id),
      db.query(
        `SELECT aa.archetype, dpv.label AS position_label, dpv.sort_order AS dial_sort_order
         FROM archetype_assignments aa
         JOIN dial_archetype_positions dap ON dap.coffee_id = aa.coffee_id AND dap.archetype = aa.archetype
         JOIN dial_position_vocabulary dpv ON dpv.id = dap.vocabulary_id
         WHERE aa.coffee_id = $1 AND aa.superseded_at IS NULL
         LIMIT 1`,
        [id]
      ),
    ]);
    if (!coffeeResult.rows.length) { res.status(404).json({ error: 'Coffee not found' }); return; }

    const archetypeKey = slotResult.rows[0]?.archetype ?? null;
    const archetypeLabel = archetypeKey ? (ARCHETYPE_LABEL[archetypeKey] ?? archetypeKey) : null;

    res.json({
      displayName: displayName ?? archetypeLabel ?? 'This coffee',
      story: coffeeResult.rows[0].story_published ? coffeeResult.rows[0].story : null,
      archetype: archetypeKey,
      archetypeLabel,
      dialPosition: slotResult.rows[0]
        ? { label: slotResult.rows[0].position_label, sortOrder: slotResult.rows[0].dial_sort_order }
        : null,
    });
  } catch (err) {
    console.error('[coffees/:id/story]', err);
    res.status(500).json({ error: 'Failed to fetch story' });
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
