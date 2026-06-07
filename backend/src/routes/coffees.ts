import { Router } from 'express';
import { db } from '../db/client.js';
import { getCoffeeSummary, getCoffeeSurpriseNote, getCoffeeThreeVoiceStory } from '../services/claude.js';
import admin from '../services/firebase-admin.js';

const router = Router();

const ARCHETYPE_LABEL: Record<string, string> = {
  chocolate_nutty: 'Chocolate & Nutty', balanced_sweet: 'Balanced & Sweet',
  fruity: 'Fruity', earthy: 'Earthy', floral: 'Floral', experimental: 'Experimental',
};

// ── Fetch all data needed for AI content generation ───────────────────────────
async function fetchCoffeeDataForContent(coffeeId: string | number) {
  const [coffeeResult, dimsResult, descriptorResult] = await Promise.all([
    db.query(
      `SELECT c.name, aa.archetype
       FROM coffees c
       LEFT JOIN archetype_assignments aa ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
       WHERE c.id = $1`,
      [coffeeId]
    ),
    db.query(
      `SELECT d.name AS dimension, d.scale_min_label, d.scale_max_label,
              ROUND(AVG(csv.value_min)::numeric, 1) AS avg_min,
              ROUND(AVG(csv.value_max)::numeric, 1) AS avg_max
       FROM cupping_score_values csv
       JOIN cupping_scores cs  ON cs.id = csv.cupping_score_id
       JOIN session_coffees sc ON sc.id = cs.session_coffee_id
       JOIN dimensions d       ON d.id  = csv.dimension_id
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
     JOIN session_coffees sc ON sc.id = cs.session_coffee_id
     WHERE sc.coffee_id = $1 AND cs.overall_notes IS NOT NULL
     ORDER BY cs.id DESC LIMIT 1`,
    [coffeeId]
  );

  return {
    coffee:       coffeeResult.rows[0],
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
      ? getCoffeeSummary({ coffeeName: data.coffee.name, archetype: archetypeLabel, dimensions: dimensionParams, topDescriptors, overallNotes: data.overallNotes })
      : Promise.resolve<string | null>(null),
    needsSurprise
      ? getCoffeeSurpriseNote({ coffeeName: data.coffee.name, archetype: archetypeLabel, dimensions: dimensionParams, topDescriptors, overallNotes: data.overallNotes })
      : Promise.resolve<string | null>(null),
    needsStory && sourceData.length >= 2
      ? getCoffeeThreeVoiceStory({ coffeeName: data.coffee.name, sourceData })
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

  // Write to Firestore — non-blocking, Cloud SQL is source of truth
  admin.firestore().collection('coffees').doc(String(coffeeId)).set({
    aiSummary,
    surpriseNote,
    threeVoiceNarrative: threeVoiceStory,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }).catch((err: unknown) => {
    console.error('[coffees/firestore-write]', err);
  });

  return { aiSummary, surpriseNote, threeVoiceStory };
}

// ── Backward-compat wrapper — still used by admin refresh-summary endpoint ────
export async function generateAndStoreSummary(coffeeId: string | number): Promise<string> {
  const data = await fetchCoffeeDataForContent(coffeeId);
  const archetypeLabel = data.coffee.archetype
    ? (ARCHETYPE_LABEL[data.coffee.archetype] ?? data.coffee.archetype)
    : null;

  const summary = await getCoffeeSummary({
    coffeeName:      data.coffee.name,
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

// GET /api/coffees/:id/flavor-wheel ───────────────────────────────────────────
router.get('/:id/flavor-wheel', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT coffee_name, wheel_category, wheel_subcategory, descriptor, source,
              COUNT(*) AS mentions, AVG(intensity) AS avg_intensity
       FROM v_collaborative_flavor_wheel
       WHERE coffee_id = $1
       GROUP BY coffee_name, wheel_category, wheel_subcategory, descriptor, source
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
         JOIN session_coffees sc   ON sc.id  = cs.session_coffee_id
         JOIN dimensions d         ON d.id   = csv.dimension_id
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
         JOIN session_coffees sc   ON sc.id  = cs.session_coffee_id
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
