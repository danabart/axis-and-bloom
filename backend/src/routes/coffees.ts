import { Router } from 'express';
import { db } from '../db/client.js';
import { getCoffeeSummary, getCoffeeSurpriseNote, getCoffeeThreeVoiceStory } from '../services/claude.js';
import { resolveBlendForSlot, resolveCoffeeBlend, COLLECTION_DISCOUNT, COLLECTION_MIN_MEMBERS } from '../services/blendResolver.js';
import { generateCoffeeStoryWithRetry, checkStorySpecificityViolations } from '../services/storyLayer.js';
import { looksLikeRefusal } from '../services/contentGuard.js';
import { isClaudeGuardBlocked } from '../services/anthropicGuard.js';

// C2 Part 1 — a blocked generation call (global kill-switch / daily ceiling)
// must degrade to "nothing new, keep whatever's cached" — never to "write
// NULL over good cached content," which is what would happen if a blocked
// call were indistinguishable from a genuine empty/refused generation.
// Resolves to null on a guard block (caller already treats null as "no new
// content this pass"); any other error still rejects normally.
async function toNullIfBlocked<T>(promise: Promise<T | null>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (isClaudeGuardBlocked(err)) return null;
    throw err;
  }
}

// Part 17 §D2 — serving-time validation ("belt and braces"). Part 16 §D2's
// guardGenerated() only ever protected a FRESH generation call; anything
// already sitting in a content column — from before the guard existed, from
// a refusal phrasing REFUSAL_PATTERNS didn't happen to cover yet (the exact
// way the live bug this section fixes reached production: a real regeneration
// AFTER the Part 16 cleanup, caught by neither gate), or from any future write
// path — was served to customers with zero revalidation. Every read of a
// content column now goes through this first: a stored value matching the
// same patterns is treated as null in the response AND nulled in the DB in
// passing, so cached garbage is structurally unable to reach a customer twice,
// regardless of how it got into the column. Shared by GET /:id/content (the
// route Dana's spec names directly) and generateAndStoreAllContent's own
// cache-passthrough paths (admin refresh, cron backfill) — one definition,
// same as contentGuard.ts's own reasoning for staying a single shared module.
async function sanitizeStoredField(
  coffeeId: string | number,
  column: 'ai_summary' | 'surprise_note' | 'three_voice_story',
  value: string | null | undefined
): Promise<string | null> {
  if (!value || !looksLikeRefusal(value)) return value ?? null;
  console.warn(`[coffees/content] serving-time guard caught a stored ${column} for coffee ${coffeeId} that looks like a refusal/meta reply — nulling in the response and the DB: ${JSON.stringify(value.slice(0, 120))}`);
  await db.query(`UPDATE coffees SET ${column} = NULL WHERE id = $1`, [coffeeId]).catch(err => {
    console.error(`[coffees/content] failed to null ${column} for coffee ${coffeeId} after a serving-time guard catch:`, err);
  });
  return null;
}

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
    `SELECT ai_summary, surprise_note, three_voice_story, story, story_published, story_admin_edited,
            ai_summary_generation_failed, surprise_note_generation_failed,
            three_voice_story_generation_failed, story_generation_failed
     FROM coffees WHERE id = $1`,
    [coffeeId]
  );
  const cached = cachedResult.rows[0] ?? {};

  // C3 — a field marked "generation_failed" (a real, non-blocked attempt
  // that came back refusal-like, or a story that exhausted its retry loop
  // without passing specificity) is terminal for the automatic path: never
  // retried again by the cron backfill, so a permanently-refusing coffee
  // doesn't burn Claude spend every run. `force=true` (the admin manual
  // refresh) ignores these flags and always retries — see the flag-write
  // logic further down, which resets a flag to false on a successful
  // forced retry.
  const needsSummary  = force || (!cached.ai_summary && !cached.ai_summary_generation_failed);
  const needsSurprise = force || (!cached.surprise_note && !cached.surprise_note_generation_failed);
  const needsStory    = force || (!cached.three_voice_story && !cached.three_voice_story_generation_failed);
  // Admin-edited story content is never auto-regenerated over (spec item 3) —
  // this is the one field `force` does not override.
  const needsStoryText = !cached.story_admin_edited && (force || (!cached.story && !cached.story_generation_failed));

  if (!needsSummary && !needsSurprise && !needsStory && !needsStoryText) {
    const [sanitizedSummary, sanitizedSurprise, sanitizedStory] = await Promise.all([
      sanitizeStoredField(coffeeId, 'ai_summary', cached.ai_summary),
      sanitizeStoredField(coffeeId, 'surprise_note', cached.surprise_note),
      sanitizeStoredField(coffeeId, 'three_voice_story', cached.three_voice_story),
    ]);
    return {
      aiSummary:      sanitizedSummary ?? '',
      surpriseNote:   sanitizedSurprise,
      threeVoiceStory: sanitizedStory,
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

  // Part 16 §D1 — input gate: getCoffeeSummary/getCoffeeSurpriseNote both
  // consume the same three inputs (dimensions, topDescriptors, overallNotes);
  // with all three empty there's nothing to write a real note from, and asking
  // anyway is exactly how the live bug happened (a coffee with no cupping data
  // got Claude's refusal text stored verbatim as its surprise_note). Skip the
  // call entirely rather than let the model improvise or apologize.
  // getCoffeeThreeVoiceStory already has its own sufficiency gate
  // (sourceData.length >= 2, below) — this just adds the warning log for it.
  //
  // Part 17 §D1 — diagnosis: this OR-based gate let ai_summary AND surprise_note
  // both through on overallNotes alone (no dimensions, no descriptors) — real
  // repro, coffee "There's No Place Like Home": overallNotes present, both
  // structured signals empty, and the live refusal text it got back explicitly
  // named the thing actually missing ("the cupping notes, origin, processing
  // method, or roast level"), not overallNotes. getCoffeeSummary's plain
  // tasting-note framing can honestly work from cupper's prose alone, but
  // getCoffeeSurpriseNote's ask (claude.ts: "a contradiction... something that
  // defies the archetype") has nothing to contrast without a real number or
  // descriptor to point at — overallNotes alone was never actually sufficient
  // for THIS field, the shared gate just didn't know that. hasSufficientData
  // (ai_summary, unchanged) stays OR-based; surprise_note gets its own,
  // stricter bar — dimensions or descriptors only, per Dana's literal spec
  // ("no descriptors AND no cupping dimensions... regardless of other fields").
  const hasSufficientData = dimensionParams.length > 0 || topDescriptors.length > 0 || !!data.overallNotes;
  const hasSufficientSurpriseData = dimensionParams.length > 0 || topDescriptors.length > 0;
  const hasSufficientVoices = sourceData.length >= 2;
  if (needsSummary && !hasSufficientData) {
    console.warn(`[coffees/content] insufficient data to generate ai_summary for coffee ${coffeeId}`);
  }
  if (needsSurprise && !hasSufficientSurpriseData) {
    console.warn(`[coffees/content] insufficient data to generate surprise_note for coffee ${coffeeId}`);
  }
  if (needsStory && !hasSufficientVoices) {
    console.warn(`[coffees/content] insufficient data to generate three_voice_story for coffee ${coffeeId}`);
  }

  // Part 16 §D2 — output validation: even with sufficient inputs, reject a
  // result that reads like Claude declining/talking about missing data (the
  // REFUSAL_PATTERNS list, or the literal INSUFFICIENT_DATA token the prompts
  // now instruct the model to return in that case) rather than store it.
  function guardGenerated(field: string, text: string): string | null {
    if (looksLikeRefusal(text)) {
      console.warn(`[coffees/content] rejected generated ${field} for coffee ${coffeeId} — looks like a refusal/meta reply, not content: ${JSON.stringify(text.slice(0, 120))}`);
      return null;
    }
    return text;
  }

  // C2 Part 1 — a blocked call (global kill-switch / daily ceiling) must
  // resolve to null via toNullIfBlocked (below) just like a skipped/refused
  // generation does, but must NOT be treated as "generation ran and came up
  // empty" when it comes time to persist — see the blocked-flag gating on
  // the `updates` array further down. Any other error still rejects the
  // whole Promise.all normally (unchanged from before this task).
  let summaryBlocked = false, surpriseBlocked = false, storyVoiceBlocked = false;

  // Run only what is needed, in parallel
  const [newSummary, newSurprise, newStory, storyResult] = await Promise.all([
    needsSummary && hasSufficientData
      ? toNullIfBlocked(getCoffeeSummary({ coffeeName: safeName, archetype: archetypeLabel, dimensions: dimensionParams, topDescriptors, overallNotes: data.overallNotes }).then(text => guardGenerated('ai_summary', text)))
          .then(text => { if (text === null) summaryBlocked = true; return text; })
      : Promise.resolve<string | null>(null),
    needsSurprise && hasSufficientSurpriseData
      ? toNullIfBlocked(getCoffeeSurpriseNote({ coffeeName: safeName, archetype: archetypeLabel, dimensions: dimensionParams, topDescriptors, overallNotes: data.overallNotes }).then(text => guardGenerated('surprise_note', text)))
          .then(text => { if (text === null) surpriseBlocked = true; return text; })
      : Promise.resolve<string | null>(null),
    needsStory && hasSufficientVoices
      ? toNullIfBlocked(getCoffeeThreeVoiceStory({ coffeeName: safeName, sourceData }).then(text => text === null ? null : guardGenerated('three_voice_story', text)))
          .then(text => { if (text === null) storyVoiceBlocked = true; return text; })
      : Promise.resolve<string | null>(null),
    needsStoryText && hasEnoughDataForStory
      ? toNullIfBlocked(generateCoffeeStoryWithRetry(
          { displayName: safeName, archetype: archetypeLabel, origin: data.coffee.origin ?? null, process: data.coffee.process ?? null, dimensions: dimensionParams, topDescriptors },
          { rawCoffeeName: data.coffee.name ?? null, roasterNames: data.roasterNames }
        ))
      : Promise.resolve(null),
  ]);

  // C3 — a "refused" field is one that was genuinely attempted (needed,
  // had sufficient data, not blocked) and still came back null — the only
  // way guardGenerated() (or a truly-empty model response) produces null
  // once blocking is ruled out. Distinct from "skipped" (insufficient data
  // — not terminal, worth retrying once real data exists) and "blocked"
  // (not an attempt at all). Drives the terminal-flag writes below.
  const summaryRefused    = needsSummary  && hasSufficientData         && !summaryBlocked    && newSummary  === null;
  const surpriseRefused   = needsSurprise && hasSufficientSurpriseData && !surpriseBlocked   && newSurprise === null;
  const storyVoiceRefused = needsStory    && hasSufficientVoices       && !storyVoiceBlocked && newStory    === null;

  const aiSummary      = newSummary      ?? cached.ai_summary      ?? '';
  const surpriseNote   = newSurprise     ?? cached.surprise_note   ?? null;
  const threeVoiceStory = newStory       ?? cached.three_voice_story ?? null;
  // "Generate, scan, THEN mark live" — story_draft always gets the latest
  // attempt (even a failed one, for admin visibility); `story` (the only
  // field anything customer-facing reads) and story_published only advance
  // when that attempt actually passed the specificity check. A blocked call
  // resolves storyResult to null (toNullIfBlocked above) — indistinguishable
  // here from "nothing needed," which is exactly right: `if (storyResult)`
  // below already skips every story-related write in that case, so a block
  // never touches story/story_draft/story_published.
  const story          = storyResult?.passed ? storyResult.text : (cached.story ?? null);
  const storyPublished = storyResult ? storyResult.passed : (cached.story_published ?? false);

  // Persist to Cloud SQL — only touch fields that were actually requested this
  // pass (needsX) AND not blocked, but touch them unconditionally once
  // requested-and-not-blocked (including explicitly writing NULL when
  // generation was skipped/rejected — a genuine attempt that came back
  // empty) — "null is the correct state" per §D1, not "leave whatever was
  // there before." A blocked call is a *no* attempt, not an empty one: it
  // must leave the existing cached value alone, never overwrite it with
  // NULL, or a global kill-switch flip (or hitting the daily ceiling) would
  // silently wipe every coffee's content the next time anyone requests it.
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  // C3 — the terminal-failure flag is written alongside its content field
  // every time that field is actually attempted (same gating as the content
  // write itself): true on a genuine refusal, false on real success — the
  // false case is what resets a previously-failed flag after an admin's
  // force=true retry succeeds. Never touched when the field wasn't
  // attempted at all (skipped for insufficient data, or blocked).
  if (needsSummary  && !summaryBlocked)     { updates.push(`ai_summary = $${idx++}`);       values.push(newSummary); updates.push(`ai_summary_generation_failed = $${idx++}`); values.push(summaryRefused); }
  if (needsSurprise && !surpriseBlocked)    { updates.push(`surprise_note = $${idx++}`);    values.push(newSurprise); updates.push(`surprise_note_generation_failed = $${idx++}`); values.push(surpriseRefused); }
  if (needsStory    && !storyVoiceBlocked)  { updates.push(`three_voice_story = $${idx++}`); values.push(newStory); updates.push(`three_voice_story_generation_failed = $${idx++}`); values.push(storyVoiceRefused); }
  if (storyResult) {
    updates.push(`story_draft = $${idx++}`);       values.push(storyResult.text);
    updates.push(`story_generated_at = NOW()`);
    if (storyResult.passed) {
      updates.push(`story = $${idx++}`);           values.push(storyResult.text);
      updates.push(`story_published = true`);
      updates.push(`story_generation_failed = $${idx++}`); values.push(false);
    } else {
      console.warn(`[generateAndStoreAllContent] story for coffee ${coffeeId} failed specificity check after ${storyResult.attempts} attempt(s): ${storyResult.violations.join('; ')} — left unpublished, see story_draft`);
      updates.push(`story_generation_failed = $${idx++}`); values.push(true);
    }
  }

  if (updates.length) {
    values.push(coffeeId);
    await db.query(`UPDATE coffees SET ${updates.join(', ')} WHERE id = $${idx}`, values);
  }

  // Part 17 §D2 — a field NOT touched this pass (needsX was false) still
  // falls through to `cached.x` above; sanitize on the way out regardless of
  // freshness. A field that WAS just generated this pass already passed
  // guardGenerated, so this is a harmless no-op for it — no double DB write.
  const [sanitizedSummary, sanitizedSurprise, sanitizedStory] = await Promise.all([
    sanitizeStoredField(coffeeId, 'ai_summary', aiSummary),
    sanitizeStoredField(coffeeId, 'surprise_note', surpriseNote),
    sanitizeStoredField(coffeeId, 'three_voice_story', threeVoiceStory),
  ]);

  return { aiSummary: sanitizedSummary ?? '', surpriseNote: sanitizedSurprise, threeVoiceStory: sanitizedStory, story, storyPublished };
}

export interface ContentBackfillResult {
  candidateCount: number;
  processed: number;
  succeeded: number;
  /** True when a call was blocked by the C2 guard (kill-switch / daily
   *  ceiling) and the run stopped early — every remaining candidate would
   *  just block too, so there's no point burning the round-trips. The
   *  unprocessed candidates are picked up again on the next cron run. */
  blocked: boolean;
  errors: Array<{ coffeeId: number; error: string }>;
}

// ── Out-of-band content generation — C3 (M2 fix) ───────────────────────────
// The only place generateAndStoreAllContent() is called with force=false
// (i.e. respecting the terminal-failure flags) now that the public routes
// above are pure reads. Driven by GET /api/cron/coffee-content-backfill
// (requireCronSecret, cron.ts) — an admin's explicit force=true refresh
// (POST /api/admin/coffees/:id/refresh-content, requireAdmin) is the other
// authenticated trigger and is unaffected by this function.
//
// Finds every coffee still missing at least one content field that hasn't
// been marked permanently refused (the WHERE clause mirrors
// generateAndStoreAllContent's own needsX logic), then generates for each,
// sequentially — not in parallel, so this doesn't burst Anthropic with N
// concurrent requests for what's a low-frequency nightly job, and so the C2
// daily-ceiling check between each call is actually meaningful. Stops the
// moment a call is blocked (kill-switch / ceiling): every subsequent
// candidate would block too, so the run ends early and picks back up next
// time rather than looping through the rest of the list for nothing.
export async function backfillCoffeeContent(): Promise<ContentBackfillResult> {
  const candidates = await db.query<{ id: number }>(
    `SELECT id FROM coffees
     WHERE is_active = true
       AND (
            (ai_summary IS NULL AND NOT ai_summary_generation_failed)
        OR (surprise_note IS NULL AND NOT surprise_note_generation_failed)
        OR (three_voice_story IS NULL AND NOT three_voice_story_generation_failed)
        OR (story IS NULL AND NOT story_admin_edited AND NOT story_generation_failed)
       )
     ORDER BY id`
  );

  let processed = 0;
  let succeeded = 0;
  let blocked = false;
  const errors: Array<{ coffeeId: number; error: string }> = [];

  for (const row of candidates.rows) {
    if (blocked) break;
    processed++;
    try {
      await generateAndStoreAllContent(row.id, { force: false });
      succeeded++;
    } catch (err) {
      if (isClaudeGuardBlocked(err)) {
        blocked = true;
        console.warn(`[coffee-content-backfill] guard blocked at coffee ${row.id} — stopping run early, ${candidates.rows.length - processed} candidate(s) left for the next run`);
        break;
      }
      console.error(`[coffee-content-backfill] coffee ${row.id} failed:`, err);
      errors.push({ coffeeId: row.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { candidateCount: candidates.rows.length, processed, succeeded, blocked, errors };
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

// Part 19 §C — cheap DISPLAY-only version of blendResolver's computeCollectionOffer:
// reuses the slots array GET /archetypes and GET /experimental already fetched
// (isActive + prices per position), no extra queries. This is a preview only —
// order-time verification (orders.ts) always calls the DB-fresh version in
// blendResolver.ts instead, which independently re-resolves everything; the two
// are expected to usually agree but are never assumed to, which is the whole
// point of §C's server-side enforcement requirement. Same COLLECTION_DISCOUNT/
// COLLECTION_MIN_MEMBERS constants as the authoritative version — imported, not
// redeclared, so there is exactly one number a discount-rate change would ever
// need to touch.
function computeCollectionOfferFromSlots(slots: Array<{ dialSortOrder: number; isActive: boolean; prices: { weightOz: number; retailPriceCents: number }[] }>) {
  const members: { dialSortOrder: number; weightOz: number; priceCents: number }[] = [];
  for (const s of slots) {
    if (!s.isActive || !s.prices.length) continue;
    const chosen = s.prices.find(p => p.weightOz === 12) ?? s.prices[0];
    members.push({ dialSortOrder: s.dialSortOrder, weightOz: chosen.weightOz, priceCents: chosen.retailPriceCents });
  }
  if (members.length < COLLECTION_MIN_MEMBERS) return null;
  const sumCents = members.reduce((sum, m) => sum + m.priceCents, 0);
  const discountedCents = Math.round(sumCents * (1 - COLLECTION_DISCOUNT));
  return { memberCount: members.length, sumCents, discountedCents };
}

// Part 19 §A — canonical archetype order: mirrors the frontend's FIXED nav-strip
// numbering (ARCHETYPE_VISUALS.num in bloomVisuals.ts — 01 Floral through 06
// Experimental), not the personalized /archetype-order used for page display
// order. A stable ordering every customer sees the same way, unlike the
// personalized one.
const CANONICAL_ARCHETYPE_ORDER = ['floral', 'fruity', 'balanced_sweet', 'chocolate_nutty', 'earthy', 'experimental'];

export interface DoorTarget { archetype: string; archetypeLabel: string; rule: 'chain'; }

// Part 19 §A, revised — the door map is ONE canonical symmetric chain around
// CANONICAL_ARCHETYPE_ORDER, wrapping: Floral <-> Fruity <-> Balanced & Sweet
// <-> Chocolate & Nutty <-> Earthy <-> Experimental <-> Floral. Left door =
// previous in the chain, right door = next. Deliberately not per-archetype
// bridge-hop-derived anymore (that was the original design) — a bridge hop
// is a "this coffee is similar to that one" signal, not a "these two
// archetypes are each other's canonical neighbor" one, and using it for
// doors produced two live defects: Floral and Fruity each had the SAME
// archetype on both edges (both edges' hop search found the same best
// match), and the seams weren't walkable both ways (Fruity's right door
// went to Balanced & Sweet via a hop, but Balanced & Sweet's left door
// went to Fruity only via the fallback path, which is a coincidence, not
// a guarantee — Chocolate & Nutty's left door already had no such
// coincidence, since its hop neighbor there was Balanced & Sweet, not
// matched by Balanced & Sweet's own right-hop pick of Floral). A fixed
// chain makes both properties structural instead of incidental — see
// assertDoorMapInvariants below, which is asserted once at module load so
// the app refuses to start if this chain (or the invariant check itself)
// is ever edited into something broken.
function buildDoorMap(): Record<string, { left: DoorTarget; right: DoorTarget }> {
  const n = CANONICAL_ARCHETYPE_ORDER.length;
  const doorMap: Record<string, { left: DoorTarget; right: DoorTarget }> = {};
  CANONICAL_ARCHETYPE_ORDER.forEach((archetype, i) => {
    const leftArchetype = CANONICAL_ARCHETYPE_ORDER[(i - 1 + n) % n];
    const rightArchetype = CANONICAL_ARCHETYPE_ORDER[(i + 1) % n];
    doorMap[archetype] = {
      left: { archetype: leftArchetype, archetypeLabel: ARCHETYPE_LABEL[leftArchetype] ?? leftArchetype, rule: 'chain' },
      right: { archetype: rightArchetype, archetypeLabel: ARCHETYPE_LABEL[rightArchetype] ?? rightArchetype, rule: 'chain' },
    };
  });
  return doorMap;
}

// Startup invariant, exported so the test suite asserts it too (not just at
// import time): every archetype's two doors must differ from each other, and
// the map must be symmetric — if A's right door is B, B's left door must be
// A (equivalently, if A's left door is B, B's right door must be A). Throws
// on the first violation rather than collecting all of them — this is meant
// to fail loudly and immediately, not report a survey.
export function assertDoorMapInvariants(doorMap: Record<string, { left: DoorTarget; right: DoorTarget }>): void {
  for (const archetype of Object.keys(doorMap)) {
    const { left, right } = doorMap[archetype];
    if (left.archetype === right.archetype) {
      throw new Error(`Door map invariant violated: ${archetype}'s left and right doors are both ${left.archetype}`);
    }
    const rightNeighbor = doorMap[right.archetype];
    if (!rightNeighbor || rightNeighbor.left.archetype !== archetype) {
      throw new Error(
        `Door map invariant violated: ${archetype}'s right door is ${right.archetype}, but ${right.archetype}'s left door is ${rightNeighbor?.left.archetype ?? '(missing)'}, not ${archetype}`
      );
    }
    const leftNeighbor = doorMap[left.archetype];
    if (!leftNeighbor || leftNeighbor.right.archetype !== archetype) {
      throw new Error(
        `Door map invariant violated: ${archetype}'s left door is ${left.archetype}, but ${left.archetype}'s right door is ${leftNeighbor?.right.archetype ?? '(missing)'}, not ${archetype}`
      );
    }
  }
}

// Built and validated once at module load, not per-request — the chain is a
// static array, so recomputing it per-request bought nothing but a wasted
// DB round trip (the original bridge-hop version genuinely needed one; this
// one no longer does). computeDoorMap() keeps its async signature/name
// purely so its two call sites below don't need to change.
const DOOR_MAP = buildDoorMap();
assertDoorMapInvariants(DOOR_MAP);

export async function computeDoorMap(): Promise<Record<string, { left: DoorTarget; right: DoorTarget }>> {
  return DOOR_MAP;
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
                COALESCE(cd.platform_name, cd.name) AS dimension_platform_name,
                cd.scale_min_label, cd.scale_max_label
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

    // Part 19 §A — computed once up front, not per archetype (it's a single
    // cross-archetype graph pass, not a per-archetype query).
    const doorMap = await computeDoorMap();

    const archetypes = [];
    for (const { archetype, dimension_name, dimension_platform_name, scale_min_label, scale_max_label } of archetypeResult.rows) {
      const slotsVocab = vocabResult.rows.filter((v: any) => v.archetype === archetype);
      const slots = await buildSlotsForArchetype(archetype, slotsVocab, slotAliasMap, priceMap);

      // Part 14: the Bloom Dial ruler falls back to Delicate/Pronounced when
      // these are null — a customer-facing safety net, not an accepted state.
      // Every archetype is supposed to have a dial dimension with both scale
      // labels set; surface the gap here rather than let it pass silently.
      if (!dimension_name) {
        console.warn(`[bloom/archetypes] no dial dimension configured for '${archetype}'`);
      } else if (!scale_min_label || !scale_max_label) {
        console.warn(`[bloom/archetypes] dial dimension '${dimension_name}' for '${archetype}' is missing scale_min_label/scale_max_label`);
      }

      archetypes.push({
        archetype,
        archetypeLabel: ARCHETYPE_LABEL[archetype] ?? archetype,
        dimensionName: dimension_name ?? null,
        dimensionPlatformName: dimension_platform_name ?? null,
        dimensionScaleMinLabel: scale_min_label ?? null,
        dimensionScaleMaxLabel: scale_max_label ?? null,
        slots,
        // Part 19 §A — the edge-door targets, pre-resolved so the frontend never
        // has to know about the hop graph/canonical order itself.
        doors: doorMap[archetype] ?? null,
        // Part 19 §C — display-only preview (see computeCollectionOfferFromSlots's
        // own comment); null when fewer than COLLECTION_MIN_MEMBERS positions are
        // currently purchasable, which is also how the frontend decides whether to
        // render the collection CTA at all.
        collectionOffer: computeCollectionOfferFromSlots(slots),
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
        `SELECT cd.name AS dimension_name, COALESCE(cd.platform_name, cd.name) AS dimension_platform_name,
                cd.scale_min_label, cd.scale_max_label
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

    // Part 14 — same gap-surfacing as GET /archetypes above.
    const dimRow = dimensionResult.rows[0];
    if (!dimRow?.dimension_name) {
      console.warn(`[bloom/archetypes] no dial dimension configured for 'experimental'`);
    } else if (!dimRow.scale_min_label || !dimRow.scale_max_label) {
      console.warn(`[bloom/archetypes] dial dimension '${dimRow.dimension_name}' for 'experimental' is missing scale_min_label/scale_max_label`);
    }

    // Part 19 §A — same door map GET /archetypes computes; experimental is one
    // of the 6 CANONICAL_ARCHETYPE_ORDER entries, so it's already resolved here.
    const doorMap = await computeDoorMap();

    res.json({
      archetype: 'experimental',
      archetypeLabel: ARCHETYPE_LABEL['experimental'] ?? 'Experimental',
      dimensionName: dimRow?.dimension_name ?? null,
      dimensionPlatformName: dimRow?.dimension_platform_name ?? null,
      dimensionScaleMinLabel: dimRow?.scale_min_label ?? null,
      dimensionScaleMaxLabel: dimRow?.scale_max_label ?? null,
      slots,
      doors: doorMap['experimental'] ?? null,
      collectionOffer: computeCollectionOfferFromSlots(slots),
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
        AND c.is_active = true
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
       JOIN coffees c ON c.id = aa.coffee_id
       JOIN dial_archetype_positions dap ON dap.coffee_id = aa.coffee_id AND dap.archetype = aa.archetype
       JOIN dial_position_vocabulary dpv ON dpv.id = dap.vocabulary_id
       WHERE aa.coffee_id = $1 AND aa.superseded_at IS NULL AND c.is_active = true
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
       -- Roastery lifecycle (2026-08-25): filter the hop's own to_coffee_id to
       -- active coffees here, before the 3-hop cap below — resolveBlendForSlot's
       -- own is_active check further down would still catch a dead slot, but
       -- doing it here too means an inactive to_coffee_id never even reaches
       -- (and consumes) that check via some other coffee's fallback occupying
       -- the same slot.
       JOIN coffees tc ON tc.id = dcr.to_coffee_id AND tc.is_active = true
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
// C3 (M2 fix) — pure read, NEVER calls Claude. Returns whatever's already
// cached; a coffee with no generated content yet (or one that's been
// terminally marked as refused — see the *_generation_failed columns)
// simply comes back with null/empty fields, same as any other cache-miss.
// The frontend already renders that state gracefully (TastingNotes.tsx:
// "Not enough data to generate a summary yet." / nothing, for the reveal
// variant) — no frontend change needed. Generation now only happens
// out-of-band, via the authenticated cron backfill (see
// backfillCoffeeContent() + GET /api/cron/coffee-content-backfill in
// cron.ts) or an admin's explicit force-refresh (POST
// /api/admin/coffees/:id/refresh-content, requireAdmin) — both call
// generateAndStoreAllContent() directly, never this route.
//
// Also returns (Flavor Intelligence Part 1 Decision #7) process/roastLevel/
// originRegion — generic flavor vocabulary and a broad geographic bucket,
// safe to show publicly. Never the raw `origin` column or `roaster` — those
// stay server-side only. originRegion is null if the coffee hasn't been
// backfilled yet.
router.get('/:id/content', async (req, res) => {
  const { id } = req.params;
  try {
    const [contentResult, extraResult] = await Promise.all([
      db.query(`SELECT ai_summary, surprise_note, three_voice_story FROM coffees WHERE id = $1`, [id]),
      db.query(
        `SELECT c.process, c.roast_level, lv.label AS origin_region
         FROM coffees c
         LEFT JOIN lookup_value lv ON lv.id = c.origin_region_id
         WHERE c.id = $1`,
        [id]
      ),
    ]);
    const content = contentResult.rows[0] ?? {};
    const extra = extraResult.rows[0] ?? {};
    // Part 17 §D2 — even a pure cache read is re-validated on the way out (see
    // sanitizeStoredField above) — this is the exact route the live "There's
    // No Place Like Home" bug reached customers through, and it now has zero
    // path from a bad stored value to a response.
    const [aiSummary, surpriseNote, threeVoiceStory] = await Promise.all([
      sanitizeStoredField(id, 'ai_summary', content.ai_summary),
      sanitizeStoredField(id, 'surprise_note', content.surprise_note),
      sanitizeStoredField(id, 'three_voice_story', content.three_voice_story),
    ]);
    res.json({
      aiSummary:       aiSummary ?? '',
      surpriseNote,
      threeVoiceStory,
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
// C3 (M2 fix) — pure read, NEVER calls Claude, same discipline as /content
// above. A cache-miss returns `summary: null` (200), not a generation
// attempt — the frontend has no live caller of this legacy route today, but
// the contract stays graceful for anything that does hit it.
router.get('/:id/ai-summary', async (req, res) => {
  const { id } = req.params;
  try {
    const cached = await db.query(`SELECT ai_summary FROM coffees WHERE id = $1`, [id]);
    res.json({ summary: cached.rows[0]?.ai_summary ?? null });
  } catch (err) {
    console.error('[coffees/ai-summary]', err);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

export default router;
