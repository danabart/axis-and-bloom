import { Router } from 'express';
import { db } from '../db/client.js';
import { getCoffeeThreeVoiceStory } from '../services/claude.js';
import { resolveBlendForSlot, resolveCoffeeBlend, COLLECTION_DISCOUNT, COLLECTION_MIN_MEMBERS } from '../services/blendResolver.js';
import { generateCoffeeStoryWithRetry, checkStorySpecificityViolations } from '../services/storyLayer.js';
import { looksLikeRefusal, bannedTokensFor, generateWithLeakGuard, styleViolation } from '../services/contentGuard.js';
import { voiceHasRoasterMaterial } from '../services/claude.js';
import { isClaudeGuardBlocked } from '../services/anthropicGuard.js';
import {
  getArchetypes, archetypeLabel, getCoffee, getCoffees, getHomeSlot, getSlots, getSellableSlots, getHops, getSizes, getAnchorSize,
  getCategoryCoffees, getCoffeeRetailPrices,
} from '../services/catalogReads.js';
import { getCustomerDescriptors } from '../services/cuppingReads.js';
// Cupping evidence brief 1 (2026-10-18): the numeric dimensions of a coffee's
// pooled range in the row shape the dimension readers here have always
// returned. Coffee presentation brief 1 (2026-10-23): moved to
// roasterVoiceReads, which every content prompt now reads.
import { getRoasterVoice, getAwardRemarks, numericDimensionRows } from '../services/roasterVoiceReads.js';
import { compareCoffee } from '../services/compatibilityReads.js';

// Coffee presentation brief 1, decision 9: generated texts the leak guard
// rejected (both attempts counted), for the backfill's report.
let leakRejectCount = 0;

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
  const [coffee, displayName, voice, awardRemarks, roasterBlendResult] = await Promise.all([
    getCoffee(Number(coffeeId)),
    resolveDisplayName(coffeeId),
    // Coffee presentation brief 1 (2026-10-23), Part C: the roaster's voice
    // (customer-voice descriptors split signature / accent, the roaster's
    // remarks and portal answers, an award count, the pooled dimensions) is
    // the one read; this function no longer reads descriptors or dimensions
    // on its own.
    getRoasterVoice(Number(coffeeId)),
    // the award text, for the leak guard only (never a prompt)
    getAwardRemarks(Number(coffeeId)),
    db.query(
      `SELECT DISTINCT r.name FROM coffee_sku rb
       JOIN roaster r ON r.id = rb.roaster_id
       WHERE rb.coffee_id = $1 AND r.name IS NOT NULL`,
      [coffeeId]
    ),
  ]);

  if (!coffee) throw new Error('Coffee not found');
  // Cupping evidence brief 6, ruling 7 (2026-10-21): our cuppers' overall
  // notes are no longer read here; nothing of ours reaches a customer prompt.

  const roasterNames = [
    ...new Set([
      coffee.roaster_name,
      ...roasterBlendResult.rows.map((r: { name: string }) => r.name),
    ].filter((n): n is string => !!n)),
  ];

  return {
    coffee: { name: coffee.name, origin: coffee.origin, process: coffee.process, archetype: coffee.match_archetype },
    displayName,
    voice,
    dimensions:   voice.dimensions,
    descriptors:  voice.descriptors,
    roasterNames,
    // decision 9: built per coffee from the data at generation time
    leakTokens:   bannedTokensFor(awardRemarks, roasterNames, coffee.name ?? null),
    // Dana's prod-go rules: archetype names (from the database) never name a category
    archetypeLabels: (await getArchetypes()).map(a => a.label),
  };
}

// ── Generate and store the coffee's description (+ HOME_TASK_5's story) ──────
// Coffee presentation brief 2 (2026-10-24), decision 6: one description per
// coffee, three_voice_story. ai_summary and surprise_note are no longer
// generated; their columns and current values stay (nothing deleted) and
// GET /:id/content still returns them for one release.
// force=false: only generate fields that are currently null in the DB
// force=true:  regenerate both (admin refresh) — EXCEPT story when
//              story_admin_edited is true, which bulk regenerate always skips.
export async function generateAndStoreAllContent(
  coffeeId: string | number,
  options: { force?: boolean } = {}
): Promise<{
  threeVoiceStory: string | null;
  story: string | null;
  storyPublished: boolean;
}> {
  const { force = false } = options;

  // Check what is already cached
  const cachedResult = await db.query(
    `SELECT three_voice_story, story, story_published, story_admin_edited,
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
  const needsStory    = force || (!cached.three_voice_story && !cached.three_voice_story_generation_failed);
  // Admin-edited story content is never auto-regenerated over (spec item 3) —
  // this is the one field `force` does not override.
  const needsStoryText = !cached.story_admin_edited && (force || (!cached.story && !cached.story_generation_failed));

  if (!needsStory && !needsStoryText) {
    return {
      threeVoiceStory: await sanitizeStoredField(coffeeId, 'three_voice_story', cached.three_voice_story),
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

  // Cupping evidence brief 6, C4 (2026-10-21): the words come from the
  // customer voice: the roaster's first, then customers'; never our cupping
  // words. Coffee presentation brief 1: signature then accent, each capped by
  // its parameter (getCustomerDescriptors); the story takes them in that order.
  const topDescriptors = data.descriptors.map(r => r.descriptor);

  // HOME_TASK_5 — skip gracefully when there's truly no usable signal (the
  // coffee-16 "Chocolate" case from S38: no archetype, no cupping data). No
  // data, no story, no error — same spirit as three_voice_story's own
  // sufficiency gate just below.
  const hasEnoughDataForStory = archetypeLabelStr !== null || dimensionParams.length > 0 || topDescriptors.length > 0;

  // Part 16 §D1 — input gate: with nothing to write from, skip the call
  // entirely rather than let the model improvise or apologize (the live bug
  // that stored Claude's refusal text verbatim). Coffee presentation brief 1,
  // D2: the three-voice story writes when there is at least one signature
  // note, one roaster remark or one portal answer (getCoffeeThreeVoiceStory).
  const hasSufficientVoices = voiceHasRoasterMaterial(data.voice);
  if (needsStory && !hasSufficientVoices) {
    console.warn(`[coffees/content] insufficient data to generate three_voice_story for coffee ${coffeeId}`);
  }

  // Part 16 §D2 — output validation: even with sufficient inputs, reject a
  // result that reads like Claude declining/talking about missing data (the
  // REFUSAL_PATTERNS list, or the literal INSUFFICIENT_DATA token the prompts
  // now instruct the model to return in that case) rather than store it.
  // Coffee presentation brief 1, decision 9 (D3): one generation attempt and
  // its guards. A text that leaks (the roaster's name, the raw coffee name or
  // an award token, per contentGuard.looksLikeLeak with this coffee's tokens)
  // is rejected and asked for once more; a second leak resolves to null, which
  // the persist step below marks *_generation_failed, with the reason logged
  // here. A refusal resolves to null at once, as before. `blocked` is the C2
  // guard (kill-switch / daily ceiling): no attempt at all, nothing written.
  // Before this brief every null here was treated as blocked, so a refused
  // field was neither stored nor flagged; refused and blocked are now apart.
  async function generateGuarded(field: string, gen: () => Promise<string | null>): Promise<{ text: string | null; blocked: boolean }> {
    const r = await generateWithLeakGuard(gen, data.leakTokens, isClaudeGuardBlocked,
      text => styleViolation(text, data.archetypeLabels, data.voice.portal.takesIt !== null));
    leakRejectCount += r.leakRejects;
    if (r.leakRejects) console.warn(`[coffees/content] leak guard rejected ${field} for coffee ${coffeeId} ${r.leakRejects} time(s)`);
    if (r.reason === 'refusal') console.warn(`[coffees/content] rejected generated ${field} for coffee ${coffeeId} — looks like a refusal/meta reply, not content`);
    if (r.styleRejects) console.warn(`[coffees/content] style check rejected ${field} for coffee ${coffeeId} ${r.styleRejects} time(s)${r.reason?.startsWith('style') ? ` (${r.reason}), marked failed` : ''}`);
    if (r.reason?.startsWith('leak')) console.warn(`[coffees/content] ${field} for coffee ${coffeeId} marked failed: leak guard rejected both attempts (${r.reason})`);
    return { text: r.text, blocked: r.blocked };
  }

  // Dana's prod-go rules (2026-10-23): the three texts never name the coffee
  // by its archetype, so they take the display name, else "this coffee" (the
  // story keeps safeName, unchanged).
  const voiceName = data.displayName ?? 'this coffee';

  // Run only what is needed, in parallel
  const skipped = Promise.resolve({ text: null as string | null, blocked: false });
  const [storyVoiceRun, storyResult] = await Promise.all([
    needsStory && hasSufficientVoices
      ? generateGuarded('three_voice_story', () => getCoffeeThreeVoiceStory({ coffeeName: voiceName, voice: data.voice }))
      : skipped,
    needsStoryText && hasEnoughDataForStory
      ? toNullIfBlocked(generateCoffeeStoryWithRetry(
          { displayName: safeName, archetype: archetypeLabelStr, origin: data.coffee.origin ?? null, process: data.coffee.process ?? null, dimensions: dimensionParams, topDescriptors },
          // D4: the same per-coffee leak tokens join the story's reject list
          { rawCoffeeName: data.coffee.name ?? null, roasterNames: data.roasterNames, leakTokens: data.leakTokens }
        ))
      : Promise.resolve(null),
  ]);
  const newStory = storyVoiceRun.text, storyVoiceBlocked = storyVoiceRun.blocked;

  // C3 — a "refused" field is one that was genuinely attempted (needed,
  // had sufficient data, not blocked) and still came back null — the only
  // way guardGenerated() (or a truly-empty model response) produces null
  // once blocking is ruled out. Distinct from "skipped" (insufficient data
  // — not terminal, worth retrying once real data exists) and "blocked"
  // (not an attempt at all). Drives the terminal-flag writes below.
  const storyVoiceRefused = needsStory && hasSufficientVoices && !storyVoiceBlocked && newStory === null;

  const threeVoiceStory = newStory ?? cached.three_voice_story ?? null;
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
  if (needsStory && !storyVoiceBlocked) { updates.push(`three_voice_story = $${idx++}`); values.push(newStory); updates.push(`three_voice_story_generation_failed = $${idx++}`); values.push(storyVoiceRefused); }
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
  const sanitizedStory = await sanitizeStoredField(coffeeId, 'three_voice_story', threeVoiceStory);

  return { threeVoiceStory: sanitizedStory, story, storyPublished };
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
  /** Coffee presentation brief 1: texts the leak guard rejected during this run (every attempt counted). */
  leakRejects: number;
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
/** The active coffees the backfill would generate for (brief 2: the description or the story missing, not refused). */
export async function contentBackfillCandidates(runner: Pick<typeof db, 'query'> = db): Promise<number[]> {
  const r = await runner.query<{ id: number }>(
    `SELECT id FROM coffees
     WHERE is_active = true
       AND (
            (three_voice_story IS NULL AND NOT three_voice_story_generation_failed)
        OR (story IS NULL AND NOT story_admin_edited AND NOT story_generation_failed)
       )
     ORDER BY id`
  );
  return r.rows.map(row => row.id);
}

export async function backfillCoffeeContent(): Promise<ContentBackfillResult> {
  const candidates = { rows: (await contentBackfillCandidates()).map(id => ({ id })) };

  let processed = 0;
  let succeeded = 0;
  let blocked = false;
  const errors: Array<{ coffeeId: number; error: string }> = [];
  const leakRejectsBefore = leakRejectCount;

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

  return { candidateCount: candidates.rows.length, processed, succeeded, blocked, errors, leakRejects: leakRejectCount - leakRejectsBefore };
}

// Coffee presentation brief 1 (2026-10-23), decision 11: after the prompts
// change, every active coffee gets one more automatic attempt. Clears the
// content *_generation_failed flag on active coffees (never the story flag:
// Dana edits stories by hand); backfillCoffeeContent then regenerates what is
// null. Brief 2: three_voice_story's flag only (the other two texts are no
// longer generated). Run by hand (features/coffee_presentation/load), not by a route.
export async function clearContentGenerationFlags(): Promise<number> {
  const r = await db.query(
    `UPDATE coffees SET three_voice_story_generation_failed = false
      WHERE is_active AND three_voice_story_generation_failed`
  );
  return r.rowCount ?? 0;
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
// Bag sizes come from coffee_size via catalogReads.getSizes() (Catalog Sizes +
// Visibility brief, 2026-09-28) — no size literals in this file (lint rule 5).
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
  prices: { weightOz: number; retailPriceCents: number; label: string; isAnchor: boolean }[];
  coffeeId: number | null;
}

// Shared per-archetype slot builder — used by both /archetypes (the 5 real
// archetypes) and /experimental. One row per coffee_dial_slot (always 4,
// sort_order 1-4); sellability/price/coffeeId come from v_coffee_sellable_slot
// at every active size (coffee_size), independently per size (a slot can be
// sellable at some sizes, all, or none). One query for the archetype, grouped
// here; rows arrive in size sort order.
async function buildSlotsForArchetype(archetype: string): Promise<Slot[]> {
  const [slots, sellable] = await Promise.all([
    getSlots(archetype),
    getSellableSlots({ archetype }),
  ]);
  const bySlot = new Map<number, typeof sellable>();
  for (const r of sellable) {
    const list = bySlot.get(r.slot_id) ?? [];
    list.push(r);
    bySlot.set(r.slot_id, list);
  }
  const anchor = await getAnchorSize();

  return slots.map(s => {
    const winners = bySlot.get(s.id) ?? [];
    // isActive = any size wins; coffeeId = the anchor-size winner, else the first size (by sort order) that has one.
    const winner = winners.find(r => Number(r.weight_oz) === anchor.weight_oz) ?? winners[0];
    const prices = winners.map(r => ({ weightOz: Number(r.weight_oz), retailPriceCents: r.retail_price_cents, label: r.size_label, isAnchor: Number(r.weight_oz) === anchor.weight_oz }));
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
function computeCollectionOfferFromSlots(slots: Slot[], anchorOz: number) {
  const members: { dialSortOrder: number; weightOz: number; priceCents: number }[] = [];
  for (const s of slots) {
    if (!s.isActive || !s.prices.length) continue;
    const chosen = s.prices.find(p => p.weightOz === anchorOz) ?? s.prices[0];
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
// experimental), wrapping: Floral <-> Fruity <-> Balanced <-> Chocolate
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
        collectionOffer: computeCollectionOfferFromSlots(slots, (await getAnchorSize()).weight_oz),
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
      collectionOffer: computeCollectionOfferFromSlots(slots, (await getAnchorSize()).weight_oz),
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
    const categoryRows = await getCategoryCoffees(['decaf', 'half_caf', 'flavored', 'experimental']);
    const coffeeIds = [...new Set(categoryRows.map(r => r.coffee_id))];
    const coffees = coffeeIds.length ? await getCoffees({ ids: coffeeIds, active: true }) : [];
    const coffeeMap = new Map(coffees.map(c => [c.id, c]));

    const byCoffee = new Map<number, { categories: { code: string; label: string; sortOrder: number }[] }>();
    for (const row of categoryRows) {
      if (!coffeeMap.has(row.coffee_id)) continue; // inactive (or not found) — excluded, same as the old c.is_active filter
      if (!byCoffee.has(row.coffee_id)) byCoffee.set(row.coffee_id, { categories: [] });
      byCoffee.get(row.coffee_id)!.categories.push({ code: row.category_code, label: row.category_label, sortOrder: row.category_sort_order });
    }

    const sizes = await getSizes();
    const priceRows = await getCoffeeRetailPrices({ includeInactive: true }); // inactive coffees are dropped via coffeeMap above
    const priceMap = new Map<string, number>();
    for (const r of priceRows) priceMap.set(`${r.coffee_id}|${Number(r.weight_oz)}`, r.retail_price_cents);

    const result = [];
    for (const [coffeeId, info] of byCoffee) {
      const coffee = coffeeMap.get(coffeeId)!;
      const homeSlot = await getHomeSlot(coffeeId);
      const prices = [];
      for (const { weight_oz: weightOz, label, is_anchor: isAnchor } of sizes) {
        const cents = priceMap.get(`${coffeeId}|${weightOz}`);
        if (cents === undefined) continue; // unpriced — omit rather than guess
        const blend = await resolveCoffeeBlend(coffeeId, weightOz);
        prices.push({ weightOz, retailPriceCents: cents, isActive: !!blend, label, isAnchor });
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
// is always hop_type_derived — the stored column this comment used to say was
// "never read" as a fallback was in fact still read below until Catalog
// Blueprint brief 5a dropped it; the fallback below now matches the comment's
// original intent). Only
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

      const sellable = await getSellableSlots({ slotId: h.to_slot_id, weightOz: (await getAnchorSize()).weight_oz });
      if (!sellable.length) continue; // target slot isn't currently sellable — a dead end

      const dim = await getDimensionInfo(h.dimension_id);

      hops.push({
        dimensionName: dim?.platform_name ?? dim?.name ?? '',
        direction: h.direction,
        // hop_type_derived is null only when the FROM coffee (this route's
        // own coffeeId) currently lacks an active home — in practice this
        // route is only ever called for a coffee a customer is looking at,
        // which is placed by definition; 'within_archetype' is the same
        // least-committal default setHop's own provisional case used before
        // brief 5a removed the stored column outright.
        hopType: h.hop_type_derived ?? 'within_archetype',
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
// Cupping evidence brief 6, C3 (2026-10-21): customer-facing (the public
// wheel, the Bloom page, the feedback chips), so it reads the customer voice
// (cuppingReads.getCustomerDescriptors): the roaster's words as wheel nodes,
// then customers'; never our cupping words. Same row shape as before: source
// is 'roastery' for the roaster's voice and 'client' for customers', one row
// per node (mentions 1, avg_intensity null); confirmed_by_cupping is added.
// Coffee presentation brief 1 (2026-10-23): the rows are what the page shows
// (qualifying, each group capped by its parameter) in display order, with
// family, is_signature and the order fields added; the page draws them in the
// order given and holds no cap or label map of its own.
router.get('/:id/flavor-wheel', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const rows = await getCustomerDescriptors(id);
    res.json(rows.map(r => ({
      cupping_note_id: r.node_id, wheel_category: r.wheel_category, wheel_subcategory: r.wheel_subcategory,
      descriptor: r.descriptor, source: r.voice === 'customer' ? 'client' : 'roastery',
      mentions: '1', avg_intensity: null, confirmed_by_cupping: r.confirmed_by_cupping,
      family: r.family, is_signature: r.is_signature, display_order: r.display_order, group_order: r.group_order,
    })));
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
    // Cupping evidence brief 1 (2026-10-18): the coffee's merged range through
    // cuppingReads (pooled since brief 6). Brief 6, ruling 7 (2026-10-21):
    // this endpoint is public, so it no longer returns our cuppers' overall
    // notes; `notes` stays in the shape, always empty (the page renders
    // nothing for an empty list).
    const coffeeId = Number(id);
    if (!Number.isInteger(coffeeId)) { res.json({ dimensions: [], notes: [] }); return; }
    const dimensions = await numericDimensionRows(coffeeId);
    res.json({ dimensions, notes: [] });
  } catch (err) {
    console.error('[coffees/dimensions]', err);
    res.status(500).json({ error: 'Failed to fetch dimension data' });
  }
});

// GET /api/coffees/:id/compatibility?userArchetype=<code> ────────────────────
// Coffee presentation brief 2 (2026-10-24), A3: the compatibility sentence,
// compared to the user's archetype's actual coffees (compatibilityReads, the
// coffee itself left out). Public and roaster-blind: the response carries
// dimension names and the archetype label only, never a coffee name, roaster
// or origin. `sentence` is null below param('archetype_profile_min_coffees')
// reference coffees; the page then shows the badge alone (the badge level
// stays client-side on v_coffee_archetype_adjacency).
router.get('/:id/compatibility', async (req, res) => {
  const coffeeId = Number(req.params.id);
  const userArchetype = typeof req.query.userArchetype === 'string' ? req.query.userArchetype : '';
  try {
    if (!Number.isInteger(coffeeId) || !userArchetype) {
      res.json({ sentence: null, reason: 'no_reference', coffee_count: 0, divergences: [] });
      return;
    }
    res.json(await compareCoffee(coffeeId, { kind: 'archetype', archetype: userArchetype }));
  } catch (err) {
    console.error('[coffees/compatibility]', err);
    res.status(500).json({ error: 'Failed to compare coffee' });
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
    // Coffee presentation brief 2 (2026-10-24): aiSummary and surpriseNote are
    // retired from customer surfaces and nothing renders them; they stay in
    // this public shape, from the columns as stored, for one release.
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
