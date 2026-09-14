import { Router } from 'express';
import { db } from '../db/client.js';
import { getCoffeeSummary, getCoffeeSurpriseNote, getCoffeeThreeVoiceStory } from '../services/claude.js';
import { resolveBlendForSlot, resolveCoffeeBlend, COLLECTION_DISCOUNT, COLLECTION_MIN_MEMBERS } from '../services/blendResolver.js';
import { generateCoffeeStoryWithRetry, checkStorySpecificityViolations } from '../services/storyLayer.js';
import { looksLikeRefusal } from '../services/contentGuard.js';
import { isClaudeGuardBlocked } from '../services/anthropicGuard.js';
import {
  getArchetypes, archetypeLabel, getCoffee, getCoffees, getHomeSlot, getSlots, getSellableSlots, getHops,
} from '../services/catalogReads.js';

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

// Catalog Blueprint brief 3 (2026-09-14) — ARCHETYPE_LABEL (the hand-typed
// code -> display-name map) is gone; every label now comes from
// archetypeLabel() (catalogReads.ts), backed by v_coffee_archetype.

// ── Fetch all data needed for AI content generation ───────────────────────────
// displayName is the Axis & Bloom alias (never the coffee's raw internal name) —
// per SOMMELIER_TASK_6_VOICE.md Step 2b: getCoffeeSummary/getCoffeeSurpriseNote/
// getCoffeeThreeVoiceStory (claude.ts) build their prompt around whatever string
// is passed as coffeeName, so the generated text can and does echo it verbatim
// (confirmed: a cached surprise_note named the coffee's real internal name). The
// fix lives here, at the call site — claude.ts's functions/prompts are unchanged.
//
// Catalog Blueprint brief 3 — resolveDisplayName is now just the coffee's
// current active home slot's name (v_coffee_slot, via getHomeSlot), replacing
// the coffee_alias/dial_archetype_positions/dial_slot_alias chain this used to
// walk (D1: a coffee's display name is a placement fact, not a match fact).
// A coffee with no active home (true for every coffee today, N3 — the catalog
// starts empty) simply has no display name yet; callers already fall back to
// the archetype label or a generic string, same as before.
async function resolveDisplayName(coffeeId: string | number): Promise<string | null> {
  const homeSlot = await getHomeSlot(Number(coffeeId));
  return homeSlot?.slot_name ?? null;
}

export async function fetchCoffeeDataForContent(coffeeId: string | number) {
  const [coffee, displayName, dimsResult, descriptorResult, roasterBlendResult] = await Promise.all([
    getCoffee(Number(coffeeId)),
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

  if (!coffee) throw new Error('Coffee not found');

  const notesResult = await db.query(
    `SELECT cs.overall_notes FROM cupping_scores cs
     JOIN cupping_session_coffees sc ON sc.id = cs.session_coffee_id
     WHERE sc.coffee_id = $1 AND cs.overall_notes IS NOT NULL
     ORDER BY cs.id DESC LIMIT 1`,
    [coffeeId]
  );

  const roasterNames = [
    ...new Set([
      coffee.roaster_name,
      ...roasterBlendResult.rows.map((r: { name: string }) => r.name),
    ].filter((n): n is string => !!n)),
  ];

  return {
    coffee: { name: coffee.name, origin: coffee.origin, process: coffee.process, archetype: coffee.match_archetype },
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
  const archetypeLabelStr = data.coffee.archetype ? await archetypeLabel(data.coffee.archetype) : null;
  // Never the coffee's raw internal name — see fetchCoffeeDataForContent comment above.
  const safeName = data.displayName ?? archetypeLabelStr ?? 'This coffee';

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
  const hasEnoughDataForStory = archetypeLabelStr !== null || dimensionParams.length > 0 || topDescriptors.length > 0;

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
      ? toNullIfBlocked(getCoffeeSummary({ coffeeName: safeName, archetype: archetypeLabelStr, dimensions: dimensionParams, topDescriptors, overallNotes: data.overallNotes }).then(text => guardGenerated('ai_summary', text)))
          .then(text => { if (text === null) summaryBlocked = true; return text; })
      : Promise.resolve<string | null>(null),
    needsSurprise && hasSufficientSurpriseData
      ? toNullIfBlocked(getCoffeeSurpriseNote({ coffeeName: safeName, archetype: archetypeLabelStr, dimensions: dimensionParams, topDescriptors, overallNotes: data.overallNotes }).then(text => guardGenerated('surprise_note', text)))
          .then(text => { if (text === null) surpriseBlocked = true; return text; })
      : Promise.resolve<string | null>(null),
    needsStory && hasSufficientVoices
      ? toNullIfBlocked(getCoffeeThreeVoiceStory({ coffeeName: safeName, sourceData }).then(text => text === null ? null : guardGenerated('three_voice_story', text)))
          .then(text => { if (text === null) storyVoiceBlocked = true; return text; })
      : Promise.resolve<string | null>(null),
    needsStoryText && hasEnoughDataForStory
      ? toNullIfBlocked(generateCoffeeStoryWithRetry(
          { displayName: safeName, archetype: archetypeLabelStr, origin: data.coffee.origin ?? null, process: data.coffee.process ?? null, dimensions: dimensionParams, topDescriptors },
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
  const archetypeLabelStr = data.coffee.archetype ? await archetypeLabel(data.coffee.archetype) : null;
  const safeName = data.displayName ?? archetypeLabelStr ?? 'This coffee';

  const summary = await getCoffeeSummary({
    coffeeName:      safeName,
    archetype:       archetypeLabelStr,
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
// (Decision #3). Never includes roaster or a raw coffee name anywhere in the
// response.
//
// Catalog Blueprint brief 3 (2026-09-14) — every field now comes from the
// v_coffee_* views via catalogReads.ts, not dial_archetype_positions/
// coffee_alias/archetype_assignments/dial_archetype_config. Slot `isActive`/
// `coffeeId`/`prices` come from v_coffee_sellable_slot (D5: a guest now
// resolves once every home candidate is gone — the old coffee_alias priority
// chain never did that). `isDefault` is now `coffee_dial_slot.is_landing_default`
// — a SLOT property, no longer tied to which coffee currently occupies it
// (visible behavior change, see WHAT_WE_BUILT.md).
const BLOOM_WEIGHTS_OZ = [12, 80] as const;
const BLOOM_CANONICAL_WEIGHT_OZ = 12;
// No hardcoded fallback price. A weight with no explicit dial_slot_price/
// coffee_retail_price row is omitted from `prices` entirely rather than guessed —
// the frontend renders that as "Unpriced" (PositionCard.tsx/OtherCategoryCard.tsx),
// the same deliberate-gap treatment already used for "no coffee resolved" (Pricing
// update, 2026-07-24 — see backend/src/db/migrations/pricing_update_2026_07_24.sql).

interface Slot {
  dialSortOrder: number;
  positionLabel: string;
  description: string | null;
  isActive: boolean;
  platformName: string | null;
  isDefault: boolean;
  prices: { weightOz: number; retailPriceCents: number }[];
  coffeeId: number | null;
}

// Shared per-archetype slot builder — used by both /archetypes (the 5 real
// archetypes) and /experimental. One row per coffee_dial_slot (always 4,
// sort_order 1-4); sellability/price/coffeeId come from v_coffee_sellable_slot
// at each of BLOOM_WEIGHTS_OZ, independently per weight (a slot can be
// sellable at 12oz only, 80oz only, both, or neither).
async function buildSlotsForArchetype(archetype: string): Promise<Slot[]> {
  const [slots, sellable12, sellable80] = await Promise.all([
    getSlots(archetype),
    getSellableSlots({ archetype, weightOz: 12 }),
    getSellableSlots({ archetype, weightOz: 80 }),
  ]);
  const by12 = new Map(sellable12.map(r => [r.slot_id, r]));
  const by80 = new Map(sellable80.map(r => [r.slot_id, r]));

  return slots.map(s => {
    const winner12 = by12.get(s.id);
    const winner80 = by80.get(s.id);
    const winner = winner12 ?? winner80; // prefer the 12oz winner for isActive/coffeeId, same precedence the canonical weight always had
    const prices: { weightOz: number; retailPriceCents: number }[] = [];
    if (winner12) prices.push({ weightOz: 12, retailPriceCents: winner12.retail_price_cents });
    if (winner80) prices.push({ weightOz: 80, retailPriceCents: winner80.retail_price_cents });
    return {
      dialSortOrder: s.sort_order,
      positionLabel: s.position_label,
      description:   s.position_description ?? null,
      isActive:      !!winner,
      platformName:  s.name ?? null,
      isDefault:     s.is_landing_default,
      prices,
      coffeeId:      winner?.coffee_id ?? null,
    };
  });
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
function computeCollectionOfferFromSlots(slots: Slot[]) {
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

export interface DoorTarget { archetype: string; archetypeLabel: string; rule: 'chain'; }

// Part 19 §A, revised — the door map is ONE canonical symmetric chain around
// the archetype order (v_coffee_archetype.sort_order, seeded in brief 1 to
// match the frontend's fixed nav-strip numbering — floral through
// experimental), wrapping: Floral <-> Fruity <-> Balanced & Sweet <-> Chocolate
// & Nutty <-> Earthy <-> Experimental <-> Floral. Left door = previous in the
// chain, right door = next. Deliberately not per-archetype bridge-hop-derived
// (see the original design's two live defects, still relevant context: doors
// duplicating a target, and non-reciprocal seams) — a fixed chain makes both
// properties structural instead of incidental, asserted once via
// assertDoorMapInvariants below.
function buildDoorMapFromOrder(
  order: string[],
  labels: Map<string, string>
): Record<string, { left: DoorTarget; right: DoorTarget }> {
  const n = order.length;
  const doorMap: Record<string, { left: DoorTarget; right: DoorTarget }> = {};
  order.forEach((archetype, i) => {
    const leftArchetype = order[(i - 1 + n) % n];
    const rightArchetype = order[(i + 1) % n];
    doorMap[archetype] = {
      left: { archetype: leftArchetype, archetypeLabel: labels.get(leftArchetype) ?? leftArchetype, rule: 'chain' },
      right: { archetype: rightArchetype, archetypeLabel: labels.get(rightArchetype) ?? rightArchetype, rule: 'chain' },
    };
  });
  return doorMap;
}

// Exported so the test suite asserts it too (not just at import time): every
// archetype's two doors must differ from each other, and the map must be
// symmetric — if A's right door is B, B's left door must be A (equivalently,
// if A's left door is B, B's right door must be A). Throws on the first
// violation rather than collecting all of them — this is meant to fail loudly
// and immediately, not report a survey.
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

// Computed once, lazily, and cached forever (not per-request) — same intent
// as the old synchronous module-load computation, adapted for an async,
// DB-backed archetype order (brief 3: the order used to be a hardcoded JS
// array; now it's v_coffee_archetype.sort_order, which brief 1 seeded to the
// exact same values). Labels change "once a quarter" per catalogReads.ts's
// own cache comment, so re-deriving this on every cold cache-miss is cheap
// and correctness-preserving.
let doorMapCache: Record<string, { left: DoorTarget; right: DoorTarget }> | null = null;
export async function computeDoorMap(): Promise<Record<string, { left: DoorTarget; right: DoorTarget }>> {
  if (doorMapCache) return doorMapCache;
  const archetypes = await getArchetypes();
  const order = [...archetypes].sort((a, b) => a.sort_order - b.sort_order).map(a => a.code);
  const labels = new Map(archetypes.map(a => [a.code, a.label]));
  const doorMap = buildDoorMapFromOrder(order, labels);
  assertDoorMapInvariants(doorMap);
  doorMapCache = doorMap;
  return doorMap;
}

// coffee_dimensions is reference/cupping data (not a catalog placement table)
// — reading it directly is fine; cached in-process like archetype labels
// since it changes even less often than those.
let dimensionCache: Map<number, { name: string; platform_name: string | null; scale_min_label: string | null; scale_max_label: string | null }> | null = null;
async function getDimensionInfo(dimensionId: number | null) {
  if (dimensionId == null) return null;
  if (!dimensionCache) {
    const result = await db.query<{ id: number; name: string; platform_name: string | null; scale_min_label: string | null; scale_max_label: string | null }>(
      `SELECT id, name, platform_name, scale_min_label, scale_max_label FROM coffee_dimensions`
    );
    dimensionCache = new Map(result.rows.map(r => [r.id, r]));
  }
  return dimensionCache.get(dimensionId) ?? null;
}

router.get('/archetypes', async (_req, res) => {
  try {
    const archetypes = await getArchetypes();
    const realArchetypes = archetypes.filter(a => a.is_archetype);
    const doorMap = await computeDoorMap();

    const result = [];
    for (const a of realArchetypes) {
      const slots = await buildSlotsForArchetype(a.code);
      const dim = await getDimensionInfo(a.dominant_dimension_id);

      // Part 14: the Bloom Dial ruler falls back to Delicate/Pronounced when
      // these are null — a customer-facing safety net, not an accepted state.
      // Every archetype is supposed to have a dial dimension with both scale
      // labels set; surface the gap here rather than let it pass silently.
      if (!dim) {
        console.warn(`[bloom/archetypes] no dial dimension configured for '${a.code}'`);
      } else if (!dim.scale_min_label || !dim.scale_max_label) {
        console.warn(`[bloom/archetypes] dial dimension '${dim.name}' for '${a.code}' is missing scale_min_label/scale_max_label`);
      }

      result.push({
        archetype: a.code,
        archetypeLabel: a.label,
        dimensionName: dim?.name ?? null,
        dimensionPlatformName: dim?.platform_name ?? dim?.name ?? null,
        dimensionScaleMinLabel: dim?.scale_min_label ?? null,
        dimensionScaleMaxLabel: dim?.scale_max_label ?? null,
        slots,
        // Part 19 §A — the edge-door targets, pre-resolved so the frontend never
        // has to know about the hop graph/canonical order itself.
        doors: doorMap[a.code] ?? null,
        // Part 19 §C — display-only preview (see computeCollectionOfferFromSlots's
        // own comment); null when fewer than COLLECTION_MIN_MEMBERS positions are
        // currently purchasable, which is also how the frontend decides whether to
        // render the collection CTA at all.
        collectionOffer: computeCollectionOfferFromSlots(slots),
      });
    }

    res.json(result);
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
// slot-2 name — a coffee inside this box shows its own slot name as usual).
router.get('/experimental', async (_req, res) => {
  try {
    const slots = await buildSlotsForArchetype('experimental');
    const experimentalSlots = await getSlots('experimental');
    // dominant_dimension_id is NULL on the archetype row for 'experimental'
    // (is_archetype=false, not a peer flavor family with its own calibrated
    // dimension) — every one of its 4 slots shares the same dimension_id by
    // construction (brief 1's backfill), so any one of them tells us which.
    const dim = await getDimensionInfo(experimentalSlots[0]?.dimension_id ?? null);

    // Part 14 — same gap-surfacing as GET /archetypes above.
    if (!dim) {
      console.warn(`[bloom/archetypes] no dial dimension configured for 'experimental'`);
    } else if (!dim.scale_min_label || !dim.scale_max_label) {
      console.warn(`[bloom/archetypes] dial dimension '${dim.name}' for 'experimental' is missing scale_min_label/scale_max_label`);
    }

    // Part 19 §A — same door map GET /archetypes computes; experimental is one
    // of the 6 archetype-order entries, so it's already resolved here.
    const doorMap = await computeDoorMap();

    res.json({
      archetype: 'experimental',
      archetypeLabel: await archetypeLabel('experimental'),
      dimensionName: dim?.name ?? null,
      dimensionPlatformName: dim?.platform_name ?? dim?.name ?? null,
      dimensionScaleMinLabel: dim?.scale_min_label ?? null,
      dimensionScaleMaxLabel: dim?.scale_max_label ?? null,
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
router.get('/archetype-order', async (req, res) => {
  try {
    const requested = typeof req.query.archetype === 'string' ? req.query.archetype : '';

    const archetypes = await getArchetypes();
    const defaultOrder = archetypes.filter(a => a.is_archetype).sort((a, b) => a.sort_order - b.sort_order).map(a => a.code);

    // Validate against the known real archetypes before ever touching
    // v_archetype_vectors — archetype is an enum-typed column there too, and
    // an arbitrary string (garbage input, or a valid-but-non-flavor enum
    // value like 'experimental') would throw a Postgres cast error rather
    // than matching zero rows. defaultOrder doubles as the exact "real,
    // is_archetype=true" allow-list, so membership here is sufficient.
    if (!(defaultOrder as string[]).includes(requested)) {
      res.json({ order: defaultOrder });
      return;
    }

    const vectorsResult = await db.query(`SELECT archetype, dimension, ideal_score FROM v_archetype_vectors`);
    const byDisplayName = new Map<string, Map<string, number>>();
    for (const row of vectorsResult.rows) {
      if (!byDisplayName.has(row.archetype)) byDisplayName.set(row.archetype, new Map());
      byDisplayName.get(row.archetype)!.set(row.dimension, Number(row.ideal_score));
    }

    const matchedVec = byDisplayName.get(await archetypeLabel(requested));
    if (!matchedVec) {
      res.json({ order: defaultOrder });
      return;
    }

    const others = defaultOrder.filter(a => a !== requested);
    const withDistance = [];
    for (const enumValue of others) {
      const vec = byDisplayName.get(await archetypeLabel(enumValue));
      let sumSquares = 0;
      if (vec) {
        for (const [dimension, idealScore] of matchedVec) {
          if (vec.has(dimension)) sumSquares += (idealScore - vec.get(dimension)!) ** 2;
        }
      }
      withDistance.push({ enumValue, distance: Math.sqrt(sumSquares) });
    }
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
// experimental), not by dial slot. displayName falls back from the coffee's
// current active home slot name (a category coffee can still have one — e.g.
// an experimental-tagged coffee placed on the experimental dial) to the
// coffee's raw name when it has none, same fallback shape as before (Catalog
// Blueprint brief 3 — coffee_alias is no longer a trusted read).
router.get('/other-categories', async (_req, res) => {
  try {
    const catResult = await db.query<{ coffee_id: number; category_code: string; category_label: string; category_sort_order: number }>(`
      SELECT cca.coffee_id, cc.code AS category_code, cc.label AS category_label, cc.sort_order AS category_sort_order
      FROM coffee_category_assignment cca
      JOIN coffee_category cc ON cc.id = cca.category_id
      WHERE cc.code IN ('decaf', 'half_caf', 'flavored', 'experimental')
      ORDER BY cc.sort_order
    `);
    const coffeeIds = [...new Set(catResult.rows.map(r => r.coffee_id))];
    const coffees = coffeeIds.length ? await getCoffees({ ids: coffeeIds, active: true }) : [];
    const coffeeMap = new Map(coffees.map(c => [c.id, c]));

    const byCoffee = new Map<number, { categories: { code: string; label: string; sortOrder: number }[] }>();
    for (const row of catResult.rows) {
      if (!coffeeMap.has(row.coffee_id)) continue; // inactive (or not found) — excluded, same as the old c.is_active filter
      if (!byCoffee.has(row.coffee_id)) byCoffee.set(row.coffee_id, { categories: [] });
      byCoffee.get(row.coffee_id)!.categories.push({ code: row.category_code, label: row.category_label, sortOrder: row.category_sort_order });
    }

    const priceRows = await db.query(
      `SELECT coffee_id, weight_oz, retail_price_cents FROM coffee_retail_price WHERE weight_oz = ANY($1::numeric[])`,
      [BLOOM_WEIGHTS_OZ]
    );
    const priceMap = new Map<string, number>();
    for (const r of priceRows.rows) priceMap.set(`${r.coffee_id}|${Number(r.weight_oz)}`, r.retail_price_cents);

    const result = [];
    for (const [coffeeId, info] of byCoffee) {
      const coffee = coffeeMap.get(coffeeId)!;
      const homeSlot = await getHomeSlot(coffeeId);
      const prices = [];
      for (const weightOz of BLOOM_WEIGHTS_OZ) {
        const cents = priceMap.get(`${coffeeId}|${weightOz}`);
        if (cents === undefined) continue; // unpriced — omit rather than guess
        const blend = await resolveCoffeeBlend(coffeeId, weightOz);
        prices.push({ weightOz, retailPriceCents: cents, isActive: !!blend });
      }
      result.push({
        coffeeId,
        displayName: homeSlot?.slot_name ?? coffee.name,
        archetype: coffee.match_archetype,
        archetypeLabel: coffee.match_archetype ? await archetypeLabel(coffee.match_archetype) : null,
        categories: info.categories.sort((a, b) => a.sortOrder - b.sortOrder),
        prices,
        effectivelyActive: prices.some(p => p.isActive),
        isUnpriced: prices.length === 0,
      });
    }

    res.json(result);
  } catch (err) {
    console.error('[coffees/other-categories]', err);
    res.status(500).json({ error: 'Failed to fetch other-category coffees' });
  }
});

// GET /api/coffees/archetype-stats?archetype= ─────────────────────────────────
// Public, no auth, roaster-blind — archetype-level aggregate only, never touches
// coffee identity. Flavor Intelligence Part 1 Decision #3. Backed by
// v_archetype_dimension_comparison (unchanged this brief — it's target-vs-actual
// dimension data, not a placement question), keyed by the human label.
router.get('/archetype-stats', async (req, res) => {
  try {
    const archetype = String(req.query.archetype ?? '');
    const archetypes = await getArchetypes();
    const found = archetypes.find(a => a.code === archetype);
    if (!found) { res.status(400).json({ error: 'Unknown or missing archetype' }); return; }

    const result = await db.query(
      `SELECT dimension, display_order, target_min, target_ideal, target_max, avg_actual, coffee_count
       FROM v_archetype_dimension_comparison
       WHERE archetype = $1
       ORDER BY display_order`,
      [found.label]
    );
    res.json({
      archetype,
      archetypeLabel: found.label,
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
// location. 404 if the coffee has no active home placement (nothing to
// redirect to) — Catalog Blueprint brief 3: this is now a placement fact
// (v_coffee_slot via getHomeSlot), not a match-archetype join.
router.get('/:id/legacy-slot', async (req, res) => {
  const { id } = req.params;
  try {
    const homeSlot = await getHomeSlot(Number(id));
    if (!homeSlot) {
      res.status(404).json({ error: 'No current slot found for this coffee' });
      return;
    }
    res.json({ archetype: homeSlot.placement_archetype, dialSortOrder: homeSlot.sort_order });
  } catch (err) {
    console.error('[coffees/legacy-slot]', err);
    res.status(500).json({ error: 'Failed to resolve legacy coffee link' });
  }
});

// GET /api/coffees/:coffeeId/hops — Bloom Dial hop navigation ─────────────────
// Public, roaster-blind wrapper over v_coffee_hop — The Bloom Part 1 Phase 1e.
// Derives the target's LIVE home slot (v_coffee_hop.to_slot_id/to_archetype —
// its current position may have moved since the hop was recorded; D3: hop type
// is always hop_type_derived, the stored column is never read). Only
// is_recommended hops; drops any hop whose target has no active home, or whose
// target slot isn't currently sellable at the canonical weight (a dead end
// otherwise); ordered by confidence high→medium→low; capped at 3. Never
// includes to_coffee's id, name, or roaster. dimensionName uses
// COALESCE(platform_name, name) (The Bloom Part 3 follow-up) so hop link copy
// ("less intensity") matches the consumer-facing word the dial itself shows
// ("DIMENSION: INTENSITY"), not the raw SCA term.
const CONFIDENCE_ORDER: Record<string, number> = { high: 1, medium: 2, low: 3 };

router.get('/:coffeeId/hops', async (req, res) => {
  const { coffeeId } = req.params;
  try {
    const allHops = await getHops({ fromCoffeeId: Number(coffeeId), recommendedOnly: true });
    const sorted = [...allHops].sort((a, b) => (CONFIDENCE_ORDER[a.confidence] ?? 4) - (CONFIDENCE_ORDER[b.confidence] ?? 4));
    const allSlots = await getSlots();
    const slotById = new Map(allSlots.map(s => [s.id, s]));

    const hops: Array<{
      dimensionName: string; direction: string; hopType: string; confidence: string;
      target: { archetype: string; archetypeLabel: string; dialSortOrder: number; positionLabel: string; platformName: string | null };
    }> = [];

    for (const h of sorted) {
      if (hops.length >= 3) break;
      if (!h.to_archetype || h.to_slot_id == null) continue; // target has no active home — a dead end, not a feature
      const targetSlot = slotById.get(h.to_slot_id);
      if (!targetSlot) continue;

      const sellable = await getSellableSlots({ slotId: h.to_slot_id, weightOz: BLOOM_CANONICAL_WEIGHT_OZ });
      if (!sellable.length) continue; // target slot isn't currently sellable — a dead end

      const dim = await getDimensionInfo(h.dimension_id);

      hops.push({
        dimensionName: dim?.platform_name ?? dim?.name ?? '',
        direction: h.direction,
        hopType: h.hop_type_derived ?? h.hop_type_stored,
        confidence: h.confidence,
        target: {
          archetype: h.to_archetype,
          archetypeLabel: await archetypeLabel(h.to_archetype),
          dialSortOrder: targetSlot.sort_order,
          positionLabel: targetSlot.position_label,
          platformName: targetSlot.name,
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
// Unchanged this brief — cupping data, not a placement question (D2).
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
// Unchanged this brief — cupping data, not a placement question (D2).
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
// backfilled yet. Catalog Blueprint brief 3: coffee state (process,
// roastLevel) now comes from getCoffee (v_coffee) — origin_region stays a
// direct lookup_value join, unrelated to placement/archetype.
router.get('/:id/content', async (req, res) => {
  const { id } = req.params;
  try {
    const [coffee, originRegionResult] = await Promise.all([
      getCoffee(Number(id)),
      db.query<{ origin_region: string | null }>(
        `SELECT lv.label AS origin_region FROM coffees c LEFT JOIN lookup_value lv ON lv.id = c.origin_region_id WHERE c.id = $1`,
        [id]
      ),
    ]);
    // Part 17 §D2 — even a pure cache read is re-validated on the way out (see
    // sanitizeStoredField above) — this is the exact route the live "There's
    // No Place Like Home" bug reached customers through, and it now has zero
    // path from a bad stored value to a response.
    const [aiSummary, surpriseNote, threeVoiceStory] = await Promise.all([
      sanitizeStoredField(id, 'ai_summary', coffee?.ai_summary),
      sanitizeStoredField(id, 'surprise_note', coffee?.surprise_note),
      sanitizeStoredField(id, 'three_voice_story', coffee?.three_voice_story),
    ]);
    res.json({
      aiSummary:       aiSummary ?? '',
      surpriseNote,
      threeVoiceStory,
      process:         coffee?.process ?? null,
      roastLevel:      coffee?.roast_level ?? null,
      originRegion:    originRegionResult.rows[0]?.origin_region ?? null,
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
//
// Catalog Blueprint brief 3 — `archetype`/`archetypeLabel` are the coffee's
// match archetype (getCoffee, D2: this is an owned-coffee identity surface).
// `dialPosition` is its current home slot's position, shown only when that
// slot's own archetype agrees with the match — same as the old behavior,
// which only ever found a dial position under the coffee's own match
// archetype in the first place (never a diverged one).
router.get('/:id/story', async (req, res) => {
  const { id } = req.params;
  try {
    const [coffee, displayName, homeSlot] = await Promise.all([
      getCoffee(Number(id)),
      resolveDisplayName(id),
      getHomeSlot(Number(id)),
    ]);
    if (!coffee) { res.status(404).json({ error: 'Coffee not found' }); return; }

    const archetypeKey = coffee.match_archetype;
    const archetypeLabelStr = archetypeKey ? await archetypeLabel(archetypeKey) : null;
    const dialPosition = (homeSlot && homeSlot.placement_archetype === archetypeKey)
      ? { label: homeSlot.position_label, sortOrder: homeSlot.sort_order }
      : null;

    res.json({
      displayName: displayName ?? archetypeLabelStr ?? 'This coffee',
      story: coffee.story_published ? coffee.story : null,
      archetype: archetypeKey,
      archetypeLabel: archetypeLabelStr,
      dialPosition,
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
