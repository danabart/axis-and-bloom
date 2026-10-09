import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, blockAnonymousAuth, requireLiamAccess, type AuthRequest } from '../middleware/auth.js';
import { getRealClientIp } from '../middleware/clientIp.js';
import { db } from '../db/client.js';
import { firestoreDb, FieldValue } from '../services/firebase-admin.js';
import { computeBehavioralConfidence } from '../services/behavioralConfidence.js';
import { evaluateSommelier } from '../services/sommelierEvaluator.js';
import { fetchSommelierCoffees, getAliases, type SlotCandidate, type RagResult } from '../services/sommelierRag.js';
import { loadProfileReads, buildProfileLine } from '../services/liamProfile.js';
import { getCoffees, archetypeLabel, archetypeCode, getCatalogVersion } from '../services/catalogReads.js';
import { getTokenBalance, spendToken, logUsage } from '../services/tokenService.js';
import { checkDailyCap, checkMonthlySpendAndAlert } from '../services/sommelierGuards.js';
import { writeOutcome, checkReturnedToSommelier } from '../services/outcomeTracker.js';
import { chatWithSommelier } from '../services/claude.js';
import { isClaudeGuardBlocked } from '../services/anthropicGuard.js';
import { getSommelierConfig } from '../services/sommelierConfig.js';
import { routeTopic } from '../services/topicRouter.js';
import { record } from '../services/customerFacts.js';
import { recordTurn, recordReplyForOpenQuestion, type AliasCandidate } from '../services/liamWriteBack.js';
import { getPreviousQuizArchetype, getFeedbackCurrent, getBrewProfileCurrent, getSlotCandidates, getFactsWatermark, distinctSecondary } from '../services/customerReads.js';
import {
  getBrewProfileFieldsConfig,
  validateSingleValue,
  incrementBrewProfileCounter,
  formatBrewProfileSummary,
  getStaleFieldNudge,
  normalizeFieldName,
  type BrewProfileDoc,
} from '../services/brewProfile.js';
import {
  generateCard,
  adjustCard,
  getMostRecentCard,
  getCardByMethod,
  resolveDefaultMethod,
  type BrewCardRow,
} from '../services/brewCard.js';

// HOME_TASK_3 (§4.8) — per-IP and per-account rate limiting on the two turn-
// generating endpoints. Thresholds read live config per request (the `max`
// option accepts a function in express-rate-limit v7), same no-deploy-tuning
// pattern as the rest of config/sommelier; `windowMs` itself is fixed at 1
// minute. Cloud Run runs multiple instances, so this is a per-instance limit,
// not a global one — acceptable at this scale per the task spec; a shared
// store (e.g. Redis) would be the upgrade if that ever stops being true.
// C17 — keyed on the real visitor IP (see middleware/clientIp.ts); req.ip
// alone collapses behind Cloudflare -> Firebase Hosting -> Cloud Run.
const sommelierIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: (_req) => getSommelierConfig()?.guards?.rateLimits?.perIpPerMinute ?? 30,
  keyGenerator: getRealClientIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests — please slow down.' },
});
const sommelierAccountLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: (_req) => getSommelierConfig()?.guards?.rateLimits?.perAccountPerMinute ?? 15,
  keyGenerator: (req: AuthRequest) => req.uid ?? getRealClientIp(req),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests — please slow down.' },
});

// HOME_TASK_3 — a hard rule, not a model decision (S33: "hard rules belong in
// code, not the prompt"), so the daily-cap close is a fixed line in Liam's
// established voice rather than a live model call. Never mentions the words
// "cap"/"limit" — reads as a natural, warm pause, per S32-S34's voice rules.
const DAILY_CAP_CLOSE_MESSAGE = "That's a good amount of ground for today — let's pick this back up tomorrow.";

// C2 Part 1 — customer-facing text for a guard block (global kill-switch
// off, or the daily spend ceiling reached). Distinct, honest surface from
// DAILY_CAP_CLOSE_MESSAGE above (a per-customer cap on a session that's
// otherwise working) — this means Liam himself is unavailable right now.
const LIAM_UNAVAILABLE_MESSAGE = 'Liam is temporarily unavailable — please try again shortly.';

// Liam L1, Part D smoke — gated debug visibility into the profile line for
// exactly one designated test account, so its contents can be confirmed
// against real production data without logging any real customer's facts.
// Never fires for anyone else; safe to leave in permanently (see OPEN_TASKS.md).
const PROFILE_LINE_DEBUG_UID = process.env.LIAM_PROFILE_LINE_DEBUG_UID ?? null;
function logProfileLineDebug(uid: string, where: string, profileLine: string): void {
  if (PROFILE_LINE_DEBUG_UID && uid === PROFILE_LINE_DEBUG_UID) {
    console.log(`[liam:PROFILE_LINE_DEBUG] ${where} uid=${uid}\n${profileLine}`);
  }
}

// Was a hand-typed label→enum-key map (ARCHETYPE_NAME_TO_KEY), matching
// users.ts's own copy. Catalog Blueprint brief 3: quiz/session data still
// carries the display name (`archetype.name`), but the key lookup itself now
// goes through catalogReads.archetypeCode() (backed by v_coffee_archetype),
// the one place this mapping lives.

// HOME_TASK_5b (Defect 1 fix) — a session's RAG-selected coffees, each
// carrying the S44-correct alias display name alongside its published story
// (null when the coffee has none). The alias is what makes name-matching
// against the customer's own message possible; `story: null` is a distinct,
// meaningful state from "no candidate at all" — a coffee can be a legitimate
// match target (Liam knows it's on the strip) without having story content.
export interface StoryCandidate {
  coffeeId: number;
  alias: string;
  story: string | null;
}

// HOME_TASK_5b (Defect 1) — resolves which of the session's story candidates
// the customer's message is actually asking about, by case-insensitive,
// whole-word match against each candidate's alias. Exported for testability,
// same pattern as resolveRemember()/assembleSystemPrompt(). Longest matching
// alias wins on ties (so "classic decaf" beats "decaf" when both are
// candidates and the message names the longer one).
export function resolveStoryForMessage(
  message: string,
  candidates: StoryCandidate[]
): StoryCandidate | null {
  let best: StoryCandidate | null = null;
  for (const candidate of candidates) {
    if (!candidate.alias || candidate.alias.trim().length === 0) continue;
    const escaped = candidate.alias.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(message) && (!best || candidate.alias.length > best.alias.length)) {
      best = candidate;
    }
  }
  return best;
}

// Catalog Blueprint brief 3 (2026-09-14) — catalogText/storyCandidates were
// only ever built once, at session start (assembly-time only, no re-query —
// see the /start handler's own comment); a placement change mid-session (a
// coffee retired, a slot re-priced) never reached an already-open
// conversation. getCatalogVersion() is cheap (five MAX() reads); a mismatch
// rebuilds both via the exact same functions/inputs session start used
// (persisted alongside catalogText for this reason), then writes the
// refreshed snapshot back so this only happens once per actual catalog
// change, not once per turn. Mutates `ctx` in place so every read downstream
// (storyCandidates, chatWithSommelier's catalogContext, and
// updatedContextData's `...ctx` spread) picks it up with no other change
// needed. Extracted out of the per-turn handler (rather than inlined) so this
// branch is unit-testable on its own, mocking fetchSommelierCoffees/getAliases
// without a live DB.
// Liam L1, Part C.3 — RagInputs is the stable, rarely-changing half of a
// session's RAG configuration (which focus, which archetypes), stored once at
// /start as context_data.ragInputs. dislikedCoffeeIds/slotCandidateIds are
// recorded as a snapshot of what /start actually used, but both a catalog-
// version refresh (here) and a facts-watermark refresh (/message) re-read the
// live equivalents rather than reusing these — a stale disliked/slot list
// would defeat the whole point of refreshing.
export interface RagInputs {
  ragFocus: string;
  userArchetype: string | null;
  previousArchetype: string | null;
  excludeCoffeeIds: number[];
  secondaryArchetype: string | null;
  exploreArchetype: string | null;
  dislikedCoffeeIds: number[];
  slotCandidateIds: number[];
}

export async function refreshCatalogSnapshotIfStale(
  uid: string,
  ctx: {
    catalogVersion?: string; ragInputs?: RagInputs;
    catalogText?: string; coffeeIds?: number[]; storyCandidates?: StoryCandidate[]; slices?: RagResult['slices'];
  },
  sessionId: number
): Promise<void> {
  try {
    const currentCatalogVersion = await getCatalogVersion();
    if (ctx.catalogVersion === currentCatalogVersion) return;

    const ragInputs = ctx.ragInputs;
    const [slotCandidates, negativeRows] = await Promise.all([
      getSlotCandidates(uid),
      getFeedbackCurrent(uid, { sentiment: 'negative' }),
    ]);
    const refreshed = await fetchSommelierCoffees({
      ragFocus: ragInputs?.ragFocus ?? 'curated_mix',
      userArchetype: ragInputs?.userArchetype ?? null,
      previousArchetype: ragInputs?.previousArchetype ?? null,
      excludeCoffeeIds: ragInputs?.excludeCoffeeIds ?? [],
      secondaryArchetype: ragInputs?.secondaryArchetype ?? null,
      exploreArchetype: ragInputs?.exploreArchetype ?? null,
      slotCandidates: slotCandidates as unknown as SlotCandidate[],
      dislikedCoffeeIds: negativeRows.map(r => r.coffeeId),
    });
    let refreshedStoryCandidates: StoryCandidate[] = [];
    if (refreshed.coffeeIds.length) {
      const [storyResult, aliasMap] = await Promise.all([
        db.query(`SELECT id, story, story_published FROM coffees WHERE id = ANY($1::int[])`, [refreshed.coffeeIds]),
        getAliases(refreshed.coffeeIds),
      ]);
      refreshedStoryCandidates = storyResult.rows.map((r: { id: number; story: string | null; story_published: boolean }) => ({
        coffeeId: r.id,
        alias: aliasMap.get(r.id) ?? '',
        story: r.story_published ? r.story : null,
      }));
    }
    console.log('[sommelier] catalog snapshot refreshed', { sessionId, from: ctx.catalogVersion ?? null, to: currentCatalogVersion });
    ctx.catalogText = refreshed.catalogText;
    ctx.coffeeIds = refreshed.coffeeIds;
    ctx.storyCandidates = refreshedStoryCandidates;
    ctx.slices = refreshed.slices;
    ctx.catalogVersion = currentCatalogVersion;
  } catch (err) {
    console.error('[sommelier] catalog snapshot refresh failed — using the stale snapshot for this turn:', err);
  }
}

// Liam L1, Part C.3 — the customer's-own-facts counterpart to
// refreshCatalogSnapshotIfStale above (that one triggers on the *catalog*
// changing; this one triggers on the *customer's facts* changing — a new
// order, rating, bag claim, brew-profile change, etc. — anything
// getFactsWatermark tracks). Extracted the same way, for the same reason:
// directly unit-testable without a live DB or a full route/supertest setup.
// profileReads/factsWatermark are passed in rather than re-fetched here
// because the caller (/message) already needed both for the profile line
// itself — no duplicate query.
export async function refreshSliceIfFactsChanged(
  ctx: {
    factsWatermark?: string; ragInputs?: RagInputs;
    catalogText?: string; coffeeIds?: number[]; storyCandidates?: StoryCandidate[]; slices?: RagResult['slices'];
  },
  sessionId: number,
  turnCount: number,
  profileReads: { feedbackCurrent: Array<{ coffeeId: number; sentiment: string }>; slotCandidates: unknown[] },
  factsWatermark: Date | null
): Promise<void> {
  const storedWatermark = ctx.factsWatermark ? new Date(ctx.factsWatermark) : null;
  if (!factsWatermark || (storedWatermark && factsWatermark <= storedWatermark)) return;

  try {
    const ragInputs = ctx.ragInputs;
    const dislikedCoffeeIds = profileReads.feedbackCurrent.filter(f => f.sentiment === 'negative').map(f => f.coffeeId);
    const refreshed = await fetchSommelierCoffees({
      ragFocus: ragInputs?.ragFocus ?? 'curated_mix',
      userArchetype: ragInputs?.userArchetype ?? null,
      previousArchetype: ragInputs?.previousArchetype ?? null,
      excludeCoffeeIds: ragInputs?.excludeCoffeeIds ?? [],
      secondaryArchetype: ragInputs?.secondaryArchetype ?? null,
      exploreArchetype: ragInputs?.exploreArchetype ?? null,
      slotCandidates: profileReads.slotCandidates as unknown as SlotCandidate[],
      dislikedCoffeeIds,
    });
    ctx.catalogText = refreshed.catalogText;
    ctx.coffeeIds = refreshed.coffeeIds;
    ctx.slices = refreshed.slices;
    if (refreshed.coffeeIds.length) {
      const [storyResult, aliasMap] = await Promise.all([
        db.query(`SELECT id, story, story_published FROM coffees WHERE id = ANY($1::int[])`, [refreshed.coffeeIds]),
        getAliases(refreshed.coffeeIds),
      ]);
      ctx.storyCandidates = storyResult.rows.map((r: { id: number; story: string | null; story_published: boolean }) => ({
        coffeeId: r.id,
        alias: aliasMap.get(r.id) ?? '',
        story: r.story_published ? r.story : null,
      }));
    } else {
      ctx.storyCandidates = [];
    }
    ctx.factsWatermark = factsWatermark.toISOString();
    console.log(`[liam:SLICE_REFRESHED] session=${sessionId} turn=${turnCount} reason=facts`);
  } catch (err) {
    console.error('[sommelier/message] facts-watermark slice refresh failed — using the stale slice for this turn:', err);
  }
}

// HOME_TASK_5c — the coffee-strip display names shown above the first message
// (`/start` and `/:sessionId/messages`, both below) previously selected
// coffees.name directly — the raw internal name, the same S38/S44 violation
// class already fixed in buildCatalogText() and getAliases() itself. Resolves
// through getAliases() (sommelierRag.ts, S44-correct dial_slot_alias join) —
// not reinvented here — falling back to the archetype label, never the raw
// name, for any coffee with no alias at all (identical rule to
// buildCatalogText()'s own fallback). `/:sessionId/messages` calls this at
// read time from a session's stored coffeeIds, so a pre-fix historical
// session's strip heals itself on next load with no data migration.
async function resolveCoffeeDisplayNames(coffeeIds: number[]): Promise<string[]> {
  if (!coffeeIds.length) return [];
  const [aliasMap, coffees] = await Promise.all([
    getAliases(coffeeIds),
    getCoffees({ ids: coffeeIds }),
  ]);
  const archetypeLabelMap = new Map<number, string>();
  for (const c of coffees) {
    if (c.match_archetype) archetypeLabelMap.set(c.id, await archetypeLabel(c.match_archetype));
  }
  return coffeeIds
    .map((id) => aliasMap.get(id) || archetypeLabelMap.get(id) || 'Coffee')
    .sort((a, b) => a.localeCompare(b));
}

// HOME_TASK_6 — resolves a firebase uid to its user_profile.id. Small, shared
// helper for the new brew-card code paths below; resolveActions() has its own
// inline copy of this same query for an unrelated purpose, left as-is.
async function resolveProfileId(uid: string): Promise<string | null> {
  const result = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [uid]);
  return result.rows[0]?.id ?? null;
}

const METHOD_LABEL: Record<string, string> = {
  v60: 'V60', french_press: 'French press', espresso: 'Espresso', moka: 'Moka pot',
  aeropress: 'Aeropress', cold_brew: 'Cold brew', drip: 'Drip', other: 'your usual method',
};

// HOME_TASK_6 (§3.1, §3.2) — resolves S71's deferred "current coffee" concept:
// "that coffee's card + story join the context assembly." Alias via
// getAliases() (S44/S77 discipline, not reinvented) — never the raw
// coffees.name. The story contribution is intentionally just the published
// story's first sentence, not the full 120-200 word text — this runs every
// turn of a bag/card-anchored session (the card can change mid-conversation
// via <<card:adjust>>), so it stays a light, session-wide grounding line
// rather than duplicating the full my_coffee-topic story injection above.
async function buildCurrentCoffeeContext(coffeeId: number, method: string, card: BrewCardRow): Promise<string> {
  const aliasMap = await getAliases([coffeeId]);
  const alias = aliasMap.get(coffeeId) ?? 'This coffee';
  const methodLabel = METHOD_LABEL[method] ?? method;
  const tempPart = card.params.tempC != null ? `, ${card.params.tempC}°C` : '';
  const notesPart = card.params.notes ? ` ${card.params.notes}` : '';
  let storyPart = '';
  try {
    const storyResult = await db.query(`SELECT story, story_published FROM coffees WHERE id = $1`, [coffeeId]);
    const row = storyResult.rows[0];
    if (row?.story_published && row.story) {
      const firstSentence = String(row.story).split(/(?<=[.!?])\s/)[0];
      if (firstSentence) storyPart = ` ${firstSentence}`;
    }
  } catch { /* story unavailable — card-only context is still useful */ }
  return `${alias} — ${methodLabel}, ${card.params.ratio}, ${card.params.grindLabel}${tempPart}.${notesPart}${storyPart}`;
}

// HOME_TASK_6 (§3.2) — <<card:save>> / <<card:adjust=KEY>> resolution. Same
// discipline as resolveActions()/resolveRemember(): the model only signals
// intent; the coffee, method, and (for adjust) the target card are all
// resolved from session context server-side, never trusted from the marker
// beyond the whitelisted adjustment key. Scoped to bag/card-anchored sessions
// only (entryCoffeeId set at /start) — a general "which coffee are we talking
// about" resolver for every session is out of this task's scope; a marker
// with nothing to attach to is silently dropped and logged, same as
// open_dial's own no-archetype-known no-op.
async function resolveCard(
  cardMarker: { type: 'save' } | { type: 'adjust'; adjustment: string } | undefined,
  uid: string,
  entryCoffeeId: number | null,
  entryMethod: string | null,
  brewProfile: BrewProfileDoc | null,
  customerMessage: string
): Promise<void> {
  if (!cardMarker || !entryCoffeeId) return;
  const userId = await resolveProfileId(uid);
  if (!userId) return;

  if (cardMarker.type === 'save') {
    const method = entryMethod ?? (await resolveDefaultMethod(entryCoffeeId, brewProfile));
    await generateCard(userId, entryCoffeeId, method, 'conversation', brewProfile);
  } else {
    const card = entryMethod
      ? await getCardByMethod(userId, entryCoffeeId, entryMethod)
      : await getMostRecentCard(userId, entryCoffeeId);
    if (!card) {
      console.warn('[resolveCard] <<card:adjust>> with no resolvable current card — dropped');
      return;
    }
    const reason = customerMessage.trim().slice(0, 200);
    await adjustCard(card.id, cardMarker.adjustment, reason);
  }
}

type SommelierAction =
  | { type: 'retake_quiz' }
  | { type: 'open_dial'; archetype: string; slot?: number }
  // Profile Part 7 Task 5 — the LLM only marks that an offer is appropriate;
  // the actual write is a separate, validated endpoint the LLM never touches.
  // Profile Part 7B — `title` is the model-supplied, server-sanitized short
  // title (display text only, never an id); absent for a bare legacy marker.
  | { type: 'save_recipe'; title?: string };

// Liam action links, Phase B — resolve <<action:...>> markers into real, server-
// verified payloads. Never trusts the LLM for ids: retake_quiz needs nothing, and
// open_dial's archetype comes from session context (already resolved from the
// user's own quiz record), with the slot looked up from their saved dial position
// if any — omitted (not guessed) when they have none.
async function resolveActions(
  actionTypes: string[],
  uid: string,
  archetypeKey: string | null,
  saveRecipeTitle?: string
): Promise<SommelierAction[]> {
  const actions: SommelierAction[] = [];
  for (const type of actionTypes) {
    if (type === 'retake_quiz') {
      actions.push({ type: 'retake_quiz' });
    } else if (type === 'open_dial' && archetypeKey) {
      let slot: number | undefined;
      try {
        const profileResult = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [uid]);
        const profileId = profileResult.rows[0]?.id;
        if (profileId) {
          // Catalog Blueprint brief 5a dropped dial_sort_order from this
          // table — slot_id is joined back to coffee_dial_slot for its sort_order.
          const posResult = await db.query(
            `SELECT cds.sort_order AS dial_sort_order
             FROM user_bloom_dial_current_position u
             JOIN coffee_dial_slot cds ON cds.id = u.slot_id
             WHERE u.user_id = $1 AND u.archetype = $2`,
            [profileId, archetypeKey]
          );
          slot = posResult.rows[0]?.dial_sort_order ?? undefined;
        }
      } catch { /* no saved position — link still works, just lands on the default slot */ }
      actions.push(slot != null ? { type: 'open_dial', archetype: archetypeKey, slot } : { type: 'open_dial', archetype: archetypeKey });
    } else if (type === 'save_recipe') {
      actions.push(saveRecipeTitle ? { type: 'save_recipe', title: saveRecipeTitle } : { type: 'save_recipe' });
    }
    // open_dial with no known archetype: nothing sensible to link to — omitted.
  }
  return actions;
}

// HOME_TASK_4 (§4.5) — one Firestore read of the brew profile, shared by both
// the summary-for-the-prompt path and resolveRemember()'s existing-array read.
// Not cached in context_data (unlike catalogText) because a fact captured
// earlier in *this same* conversation must be reflected on the very next turn.
// Customer Blueprint C3, Part B2 — v_customer_brew_profile via customerReads,
// not the Firestore users/{uid}/metadata/brew_profile doc. Same BrewProfileDoc
// shape (getBrewProfileCurrent maps FactSource -> 'conversation'/'profile_page'),
// so formatBrewProfileSummary()/getStaleFieldNudge() are untouched.
export async function getBrewProfile(uid: string): Promise<BrewProfileDoc | null> {
  try {
    const doc = await getBrewProfileCurrent(uid);
    return Object.keys(doc).length ? (doc as unknown as BrewProfileDoc) : null;
  } catch (err) {
    console.error('[brewProfile] read failed', err);
    return null;
  }
}

// Liam memory, Phase 1 (§4.5) — resolves <<remember:...>> markers into a
// validated, whitelisted Firestore write. Never trusts the model's field or
// value text directly (same discipline as resolveActions()): an unknown
// field or a value outside the whitelist is dropped and logged, not written.
// Write rule 3: every attempt — success or failure — increments an
// admin-visible counter, never a silent fire-and-forget.
// Customer Blueprint C3, Part C — the Firestore users/{uid}/metadata/
// brew_profile doc write is retired; record.brewProfileChange() (C2) is the
// only writer now. The "already known" dedup check reads the current value
// through v_customer_brew_profile (customerReads.getBrewProfileCurrent)
// instead of the doc this used to read back.
export async function resolveRemember(
  uid: string,
  rememberOps: Array<{ field: string; rawValue: string }>,
  sessionId: number,
  turn: number
): Promise<void> {
  if (!rememberOps.length) return;
  const fieldsCfg = getBrewProfileFieldsConfig();

  let current: BrewProfileDoc = {};
  try {
    current = (await getBrewProfileCurrent(uid)) as unknown as BrewProfileDoc;
  } catch (err) {
    console.error('[resolveRemember] read failed', err);
  }

  // One accepted op per field (at most one per field per call regardless,
  // since a field can only be validated once per rememberOps batch below).
  // Ops dropped by validation never reach this list — they never became a fact.
  const accepted: Array<{ field: string; op: 'add' | 'set'; value: unknown }> = [];

  for (const rawOp of rememberOps) {
    // Defense-in-depth: a plausible singular/plural near-miss (e.g. the model
    // saying "brew_method" for "brew_methods") is normalized before whitelist
    // lookup — see normalizeFieldName()'s own comment for why this exists.
    const field = normalizeFieldName(rawOp.field);
    const fieldCfg = fieldsCfg[field];
    if (!fieldCfg) {
      console.warn(`[resolveRemember] unknown field "${rawOp.field}" dropped for uid=${uid}`);
      await incrementBrewProfileCounter('failures');
      continue;
    }
    const validated = validateSingleValue(fieldCfg, rawOp.rawValue);
    if (validated === null) {
      console.warn(`[resolveRemember] invalid value for "${field}": "${rawOp.rawValue}" dropped for uid=${uid}`);
      await incrementBrewProfileCounter('failures');
      continue;
    }

    if (fieldCfg.type === 'array' || fieldCfg.type === 'array_freeform') {
      const existingArr = Array.isArray(current[field]?.value) ? (current[field]!.value as string[]) : [];
      if (existingArr.includes(validated as string)) continue; // already known — nothing new to write
      accepted.push({ field, op: 'add', value: validated });
    } else {
      // Liam L2, Part 0 — a re-affirmed fact is not a new fact (D14): the
      // model sometimes re-emits a <<remember:...>> marker for a scalar field
      // on a turn where the customer didn't restate it (the exact "two
      // takes_it=milk rows" case the L1 smoke surfaced). Arrays already skip
      // known items above; scalars had no equivalent guard.
      if (current[field]?.value === validated) {
        console.log(`[resolveRemember] unchanged, skipped field="${field}" uid=${uid}`);
        await incrementBrewProfileCounter('noop');
        continue;
      }
      accepted.push({ field, op: 'set', value: validated });
    }
  }

  if (!accepted.length) return;

  try {
    const profileResult = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [uid]);
    const profileId = profileResult.rows[0]?.id;
    if (profileId) {
      for (const op of accepted) {
        const sourceId = `${sessionId}:${turn}:${op.field}:${op.value}`;
        await record.brewProfileChange({
          userId: profileId, source: 'liam', sourceId, sessionId,
          field: op.field as any, op: op.op, value: JSON.stringify(op.value),
        });
      }
      await incrementBrewProfileCounter('writes');
    }
  } catch (err) {
    console.error('[customerFacts:brew-profile]', err);
    await incrementBrewProfileCounter('failures');
  }
}

const router = Router();

// Liam access & cost brief (2026-10-01) — every customer route below carries
// requireLiamAccess (subscribers and admins only, 403 liam_not_included
// otherwise), right after requireAuth + blockAnonymousAuth so a refused user
// never reaches the per-account limiter, the daily cap or a model call. The
// per-IP limiter stays first on /start and /message: it guards Firebase token
// verification from unauthenticated floods, before anyone is known.

// ─── POST /api/sommelier/evaluate ────────────────────────────────────────────
router.post('/evaluate', requireAuth, blockAnonymousAuth, requireLiamAccess, async (req: AuthRequest, res) => {
  const { quizTie, tiedArchetypes, userInitiated } = req.body;
  try {
    await computeBehavioralConfidence(req.uid!);
    const result = await evaluateSommelier(req.uid!, {
      quizTie: quizTie ?? false,
      tiedArchetypes: tiedArchetypes ?? [],
      userInitiated: userInitiated ?? false,
    });
    res.json({
      needsSommelier: result.needsSommelier,
      intent: result.intent,
      openingContext: result.openingContext,
      evaluationId: result.evaluationId,
    });
  } catch (err) {
    console.error('[sommelier/evaluate]', err);
    res.status(500).json({ error: 'Evaluation failed' });
  }
});

// ─── POST /api/sommelier/start ────────────────────────────────────────────────
router.post('/start', sommelierIpLimiter, requireAuth, blockAnonymousAuth, requireLiamAccess, sommelierAccountLimiter, async (req: AuthRequest, res) => {
  // HOME_TASK_6 (§3.1, §3.2) — entry/coffeeId arrive from a bag/card link
  // (this task's own arrival-note/home-surface links today; Task 7's QR
  // redirect later, per the entry=bag param contract this task defines —
  // see spec item 6 and the "Out of scope" note). Ownership is established by
  // whichever entry point produced the link, not re-checked here; every
  // user_brew_card row this resolves is scoped to req.uid's own user_profile.id
  // regardless, so a forged coffeeId can only ever touch this customer's own
  // card, never leak anyone else's.
  const { intent, openingContext, evaluationId, tiedArchetypes, entry, coffeeId } = req.body;
  if (!intent) { res.status(400).json({ error: 'intent required' }); return; }

  const config = getSommelierConfig();
  const gatingEnabled = config?.tokenEconomy?.gatingEnabled ?? false;
  const costPerTurn = config?.tokenEconomy?.costPerTurn ?? 1;
  const maxTurns = config?.intents?.[intent]?.maxTurns ?? config?.sessionLimits?.maxTurns ?? 8;
  const resumeWindowHours = config?.timeWindows?.sessionResumeWindowHours ?? 24;

  try {
    // Token check — only when the meter is gating (§5: off by default; the
    // schema/rollback lever stays, nothing customer-facing depends on it).
    if (gatingEnabled) {
      const balance = await getTokenBalance(req.uid!);
      if (balance < costPerTurn) {
        res.status(402).json({
          error: 'insufficient_tokens',
          balance,
          message: 'You need at least 1 token to start a conversation with Liam.',
        });
        return;
      }
    }

    // Daily turn cap (§4.8) — checked before starting a new session so a
    // capped-out customer doesn't spend a real model call just to be told no.
    const capCheck = await checkDailyCap(req.uid!);
    if (capCheck.hit) {
      res.status(429).json({
        error: 'daily_cap_reached',
        message: DAILY_CAP_CLOSE_MESSAGE,
      });
      return;
    }

    // Resumable session check
    const resumeResult = await db.query(
      `SELECT id, intent, turn_count FROM sommelier_sessions
       WHERE uid = $1
         AND is_closed = false
         AND last_active_at > NOW() - INTERVAL '${resumeWindowHours} hours'
       ORDER BY last_active_at DESC
       LIMIT 1`,
      [req.uid]
    );
    if (resumeResult.rows.length) {
      const s = resumeResult.rows[0];
      res.json({
        resumableSession: {
          sessionId: s.id,
          intent: s.intent,
          turnCount: s.turn_count,
          turnsRemaining: maxTurns - s.turn_count,
        },
      });
      return;
    }

    // Liam L1, Part C — every C3 fact this customer has, gathered once, in
    // parallel (services/liamProfile.ts's loadProfileReads()). Replaces the
    // old prose-string enrichedOpeningContext build (pair confidence, loose
    // thread, recent dial activity all folded into one turn-0-only string) —
    // those facts now live in the structured profile line instead, rebuilt
    // every turn (see /message below), not just at session start.
    const reads = await loadProfileReads(req.uid!);
    const quizCurrent = reads.quizCurrent;
    const userArchetype = quizCurrent?.archetypeName ?? null;
    const previousArchetype = await getPreviousQuizArchetype(req.uid!);
    const archetypeKey = userArchetype ? await archetypeCode(userArchetype) : null;
    // interpretationSource-gated the same way the old pair-confidence/thread
    // prose was — a pre-v2.1 interpretation has no meaningful explore concept.
    // Interpretation v2.2 (Prompt 4B): a secondary equal to the shown archetype (branch-match) pairs nothing.
    // The match fields ride on quizCurrent untouched; nothing here acts on them yet (Part G).
    const secondaryArchetype = distinctSecondary(userArchetype, quizCurrent?.secondaryArchetype);
    const exploreArchetype = quizCurrent?.interpretationSource === 'table' ? quizCurrent.exploreArchetype : null;

    // Liam L2, Part D — openingContext is now the register-based tone
    // sentence sommelierEvaluator.ts's Stage 2 produces (a lookup, not a
    // Haiku call), which already reads generation off the same date_of_birth
    // this route used to fetch separately just to append a redundant
    // "Customer generation: X" line — one of the two, not both, per the
    // brief; the register sentence is the more specific one, so it's what stays.
    const enrichedOpeningContext = openingContext ?? '';

    const profileLine = buildProfileLine(reads);
    logProfileLineDebug(req.uid!, '/start', profileLine);

    // Reused from the same read loadProfileReads() already did — no second
    // query. Distinct from excludeCoffeeIds below (a pre-existing, narrower
    // TASTE_EVOLUTION/RECOMMENDATION_MISS-specific hop exclusion inside the
    // 'alternatives' focus branch): dislikedCoffeeIds is the blanket "never
    // show a disliked coffee" rule (rule 1 of Dana's fixture review).
    const dislikedCoffeeIds = reads.feedbackCurrent.filter(f => f.sentiment === 'negative').map(f => f.coffeeId);

    // Determine excludeCoffeeIds for RECOMMENDATION_MISS — same values
    // dislikedCoffeeIds already carries, capped the same way the old direct
    // getFeedbackCurrent(uid, {sentiment:'negative'}) call was.
    const excludeCoffeeIds: number[] = intent === 'RECOMMENDATION_MISS' ? dislikedCoffeeIds.slice(0, 10) : [];

    const ragFocus = config?.intents?.[intent]?.ragFocus ?? 'curated_mix';
    // Catalog Blueprint brief 3 — resolved once here and persisted below
    // (previousArchetypeForRag, excludeCoffeeIds) so the snapshot-refresh
    // check on later turns can call fetchSommelierCoffees with the exact
    // same inputs, not just the same ragFocus/archetype.
    const previousArchetypeForRag = intent === 'TASTE_EVOLUTION' ? previousArchetype : null;
    // Part C.2 — stored in context_data as ragInputs (the brief's own list,
    // plus excludeCoffeeIds: refreshCatalogSnapshotIfStale's catalog-version
    // refresh needs it too, to keep calling fetchSommelierCoffees with
    // identical inputs). slotCandidateIds/dislikedCoffeeIds here are a record
    // of what /start actually used — the facts-watermark refresh path
    // (/message, Part C.3) re-reads both live rather than reusing these.
    const ragInputs = {
      ragFocus, userArchetype, previousArchetype: previousArchetypeForRag, excludeCoffeeIds,
      secondaryArchetype, exploreArchetype, dislikedCoffeeIds,
      slotCandidateIds: reads.slotCandidates.map(c => c.coffee_id),
    };
    const ragResult = await fetchSommelierCoffees({
      ragFocus, userArchetype, previousArchetype: previousArchetypeForRag, excludeCoffeeIds,
      secondaryArchetype, exploreArchetype, slotCandidates: reads.slotCandidates, dislikedCoffeeIds,
    });
    const catalogVersion = await getCatalogVersion();
    const factsWatermark = await getFactsWatermark(req.uid!);

    // Brew profile (§4.5, §3.5) — moved ahead of its original spot (just
    // before the opening chatWithSommelier call) so HOME_TASK_6's entry-coffee
    // resolution below can reuse the same live read rather than fetching it
    // twice. Still a live read every turn's worth of logic needs it in, not
    // cached — see getBrewProfile()'s own comment.
    const brewProfile = await getBrewProfile(req.uid!);

    // HOME_TASK_5 (§4.4), extended by HOME_TASK_5b (Defect 1) — every one of
    // this session's RAG-selected coffees is a candidate now, not just the
    // ones with a published story: a coffee still needs to be a valid
    // name-match target even when it has no story to inject (matched-but-
    // no-story is a distinct, correct outcome from no-match — see
    // resolveStoryForMessage()'s own comment). Alias comes from the same
    // S44-correct join sommelierRag.ts already uses for catalogText, not
    // reinvented here. Cached at session start, same "assembly-time only, no
    // re-query" principle Task 2 established for catalogText.
    let storyCandidates: StoryCandidate[] = [];
    if (ragResult.coffeeIds.length) {
      try {
        const [storyResult, aliasMap] = await Promise.all([
          db.query(
            `SELECT id, story, story_published FROM coffees WHERE id = ANY($1::int[])`,
            [ragResult.coffeeIds]
          ),
          getAliases(ragResult.coffeeIds),
        ]);
        storyCandidates = storyResult.rows.map((r: { id: number; story: string | null; story_published: boolean }) => ({
          coffeeId: r.id,
          alias: aliasMap.get(r.id) ?? '',
          story: r.story_published ? r.story : null,
        }));
      } catch { /* RAG catalog/alias lookup failed — no candidates, fine */ }
    }

    // HOME_TASK_6 (§3.1, §3.2) — resolves S71's deferred "current coffee"
    // concept. entry=bag|card + coffeeId anchors this whole session to one
    // coffee: fetch (or, on a first-ever entry=card visit with no card yet,
    // generate) that coffee's brew card, and build the context line
    // chatWithSommelier() injects on every turn via assembleSystemPrompt()'s
    // new currentCoffeeContext param. Every other session leaves both
    // undefined — no behavior change outside this entry path.
    let entryCoffeeId: number | null = null;
    let entryMethod: string | null = null;
    let currentCoffeeContext: string | undefined;
    if ((entry === 'bag' || entry === 'card') && Number.isInteger(coffeeId)) {
      try {
        const userId = await resolveProfileId(req.uid!);
        if (userId) {
          let card = await getMostRecentCard(userId, coffeeId);
          if (!card) {
            const method = await resolveDefaultMethod(coffeeId, brewProfile);
            card = await generateCard(userId, coffeeId, method, 'conversation', brewProfile);
          }
          entryCoffeeId = coffeeId;
          entryMethod = card.method;
          currentCoffeeContext = await buildCurrentCoffeeContext(coffeeId, card.method, card);
        }
      } catch (err) {
        console.error('[sommelier/start] entry coffee resolution failed:', err);
      }
    }

    // Insert session
    const sessionResult = await db.query(
      `INSERT INTO sommelier_sessions (uid, intent, context_data)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [
        req.uid,
        intent,
        JSON.stringify({
          intent,
          archetype: userArchetype,
          archetypeKey,
          tiedArchetypes: tiedArchetypes ?? [],
          openingContext: enrichedOpeningContext,
          ragInputs,
          factsWatermark,
          coffeeIds: ragResult.coffeeIds,
          catalogText: ragResult.catalogText,
          catalogVersion,
          slices: ragResult.slices,
          storyCandidates,
          evaluationId: evaluationId ?? null,
          entryCoffeeId,
          entryMethod,
        }),
      ]
    );
    const newSessionId: number = sessionResult.rows[0].id;

    // Update Firestore evaluation
    if (evaluationId) {
      // Customer Blueprint C3, Part B6 — sommelier_evaluation (SQL), not the
      // Firestore users/{uid}/sommelier_evaluations doc.
      db.query(
        `UPDATE sommelier_evaluation SET session_started = true, started_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [evaluationId]
      ).catch((err: unknown) => console.error('[sommelier/start] eval update:', err));

      checkReturnedToSommelier(req.uid!, evaluationId).catch(err => console.error('[sommelier/start] checkReturnedToSommelier failed:', err));
    }

    // Spend 1 token for the opening turn — only when gating is on. Ungated,
    // this is a real turn that still needs to count toward the guard layer's
    // accounting, just without a balance gate or a rollback path (nothing was
    // spent, so there's nothing to roll back if something downstream fails).
    let newBalance: number | null = null;
    if (gatingEnabled) {
      const spendResult = await spendToken(req.uid!, 'sommelier_turn', String(newSessionId));
      if (!spendResult.success) {
        // Delete the session since we can't pay for it
        await db.query('DELETE FROM sommelier_sessions WHERE id = $1', [newSessionId]);
        res.status(402).json({
          error: 'insufficient_tokens',
          balance: spendResult.newBalance,
          message: 'You need at least 1 token to start a conversation with Liam.',
        });
        return;
      }
      newBalance = spendResult.newBalance;
    }

    // Brew profile context (§4.5, §3.5) — compact customer-context line built
    // from the live-read brewProfile fetched earlier (now shared with
    // HOME_TASK_6's entry-coffee resolution above, not fetched twice).
    const brewProfileContext = formatBrewProfileSummary(brewProfile);

    // Generate opening message (turn 0)
    let openingMessage = "Hi, I'm Liam — Axis & Bloom's coffee sommelier. What brings you here today?";
    let modelUsed = 'fallback';
    let openingActionTypes: string[] = [];
    let openingRememberOps: Array<{ field: string; rawValue: string }> = [];
    let openingSaveRecipeTitle: string | undefined;
    let openingCardMarker: { type: 'save' } | { type: 'adjust'; adjustment: string } | undefined;
    let openingRecommendAlias: string | null = null;
    let openingAskKind: 'thread' | 'palate' | 'brew' | null = null;
    try {
      const chatResult = await chatWithSommelier({
        message: null,
        session: { intent, turnCount: 0, openingContext: enrichedOpeningContext },
        catalogContext: ragResult.catalogText,
        history: [],
        brewProfileContext,
        currentCoffeeContext,
        profileLine,
      });
      openingMessage = chatResult.reply;
      modelUsed = chatResult.modelUsed;
      openingActionTypes = chatResult.actionTypes;
      openingSaveRecipeTitle = chatResult.saveRecipeTitle;
      openingRememberOps = chatResult.rememberOps;
      openingCardMarker = chatResult.cardMarker;
      openingRecommendAlias = chatResult.recommendAlias;
      openingAskKind = chatResult.askKind;
    } catch (claudeErr) {
      // C2 Part 1 — a guard block (kill-switch / daily ceiling) means Liam
      // genuinely can't respond right now. Silently creating a session with
      // a canned opening line would be dishonest (the customer would then
      // send real messages into a session that will keep failing) — roll
      // back the session just inserted above (same rollback pattern the
      // insufficient-tokens path below already uses) and say so plainly,
      // rather than a bare 500. Any other/unexpected Anthropic error keeps
      // today's existing behavior: log it, fall through to the canned
      // opening message, session proceeds normally.
      if (isClaudeGuardBlocked(claudeErr)) {
        await db.query('DELETE FROM sommelier_sessions WHERE id = $1', [newSessionId]);
        res.status(503).json({ error: 'liam_unavailable', message: LIAM_UNAVAILABLE_MESSAGE });
        return;
      }
      console.error('[sommelier/start] chatWithSommelier failed, using fallback:', claudeErr);
    }

    if (!gatingEnabled) {
      logUsage(req.uid!, String(newSessionId), modelUsed).catch(err => console.error('[sommelier/start] logUsage failed:', err));
      checkMonthlySpendAndAlert(req.uid!).catch(err => console.error('[sommelier/start] checkMonthlySpendAndAlert failed:', err));
    }
    // The prompt instructs Liam never to use a marker on the opening turn, but
    // resolve defensively anyway rather than assuming the instruction always holds.
    const openingActions = await resolveActions(openingActionTypes, req.uid!, archetypeKey, openingSaveRecipeTitle);
    await resolveRemember(req.uid!, openingRememberOps, newSessionId, 0);
    await resolveCard(openingCardMarker, req.uid!, entryCoffeeId, entryMethod, brewProfile, 'Begin the conversation.');

    // Save opening message to Firestore
    const openingMsgRef = await firestoreDb
      .collection(`users/${req.uid}/sommelier_sessions/${newSessionId}/messages`)
      .add({
        role: 'assistant',
        content: openingMessage,
        modelUsed,
        seq: 0,
        actions: openingActions,
        createdAt: FieldValue.serverTimestamp(),
      });

    // Liam L3, Part B — recommend/ask markers become facts once the opening
    // message's own doc id exists. MATCHED and CONVERSION are the two
    // intents that open with a pick (see claude.ts's opening-turn exception).
    const openingCandidates: AliasCandidate[] = storyCandidates.map(c => ({ coffeeId: c.coffeeId, alias: c.alias }));
    const openingWriteBack = await recordTurn({
      uid: req.uid!,
      sessionId: newSessionId,
      turn: 0,
      assistantMessageId: openingMsgRef.id,
      reply: openingMessage,
      recommendAlias: openingRecommendAlias,
      askKind: openingAskKind,
      candidates: openingCandidates,
      candidateCoffeeIds: ragResult.coffeeIds,
      exploreArchetypeCode: reads.exploreArchetypeCode,
    });

    // Update session turn_count + last_active_at (+ any open question just recorded)
    await db.query(
      `UPDATE sommelier_sessions
       SET turn_count = 1, last_active_at = NOW(), context_data = context_data || $2::jsonb
       WHERE id = $1`,
      [
        newSessionId,
        JSON.stringify(
          openingWriteBack
            ? { openQuestionId: openingWriteBack.openQuestionId, openQuestionTurn: openingWriteBack.openQuestionTurn }
            : {}
        ),
      ]
    );

    // Coffee names for the frontend display — aliases only, see
    // resolveCoffeeDisplayNames() above (HOME_TASK_5c).
    const coffeeNames = await resolveCoffeeDisplayNames(ragResult.coffeeIds);

    res.json({
      sessionId: newSessionId,
      openingMessage,
      // Liam L3, Part C — the opening message's own Firestore doc id, so an
      // action-link click on the very first turn can call POST
      // /:sessionId/action with the right messageId (previously unavailable
      // anywhere in the response — see Task 0's disclosed deviation).
      openingMessageId: openingMsgRef.id,
      openingActions,
      coffeeNames,
      // Kept for API back-compat (nothing customer-facing reads this — see
      // Sommelier.tsx, which no longer requests or renders a balance); null
      // when ungated rather than a real number that suggests spend happened.
      tokenBalance: newBalance,
      turnsRemaining: maxTurns - 1,
    });
  } catch (err) {
    console.error('[sommelier/start]', err);
    res.status(500).json({ error: 'Failed to start sommelier session' });
  }
});

// ─── POST /api/sommelier/:sessionId/message ───────────────────────────────────
router.post('/:sessionId/message', sommelierIpLimiter, requireAuth, blockAnonymousAuth, requireLiamAccess, sommelierAccountLimiter, async (req: AuthRequest, res) => {
  const sessionId = Number(req.params.sessionId);
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message required' });
    return;
  }

  const config = getSommelierConfig();
  const gatingEnabled = config?.tokenEconomy?.gatingEnabled ?? false;
  const costPerTurn = config?.tokenEconomy?.costPerTurn ?? 1;

  try {
    // Fetch session
    const sessionResult = await db.query(
      'SELECT * FROM sommelier_sessions WHERE id = $1 AND uid = $2',
      [sessionId, req.uid]
    );
    if (!sessionResult.rows.length) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const session = sessionResult.rows[0];

    if (session.is_closed) {
      res.status(409).json({ error: 'session_closed', message: 'This session has ended.' });
      return;
    }

    const maxTurns =
      config?.intents?.[session.intent]?.maxTurns ??
      config?.sessionLimits?.maxTurns ??
      8;

    if (session.turn_count >= maxTurns) {
      res.status(409).json({ error: 'turn_limit_reached' });
      return;
    }

    // Token check — only when the meter is gating (§5).
    if (gatingEnabled) {
      const balance = await getTokenBalance(req.uid!);
      if (balance < costPerTurn) {
        res.status(402).json({ error: 'insufficient_tokens', balance });
        return;
      }
    }

    // Daily turn cap (§4.8). Checked before generating a reply so a capped-out
    // turn never reaches the model — this is the "Liam-voiced session close"
    // the spec asks for, not a bare error: the user's message is still saved
    // (they did send it), Liam's fixed closing line is saved as the reply, and
    // the session ends the same way a normal turn-limit close would.
    const capCheck = await checkDailyCap(req.uid!);
    if (capCheck.hit) {
      const messagesColForClose = firestoreDb.collection(`users/${req.uid}/sommelier_sessions/${sessionId}/messages`);
      await messagesColForClose.doc().set({
        role: 'user',
        content: message,
        seq: session.turn_count * 2 - 1,
        createdAt: FieldValue.serverTimestamp(),
      });
      await messagesColForClose.add({
        role: 'assistant',
        content: DAILY_CAP_CLOSE_MESSAGE,
        modelUsed: 'guard',
        seq: session.turn_count * 2,
        actions: [],
        createdAt: FieldValue.serverTimestamp(),
      });
      await db.query(
        `UPDATE sommelier_sessions SET is_closed = true, close_reason = 'daily_cap', last_active_at = NOW() WHERE id = $1`,
        [sessionId]
      );
      res.json({
        reply: DAILY_CAP_CLOSE_MESSAGE,
        actions: [],
        turnCount: session.turn_count,
        sessionClosed: true,
        turnsRemaining: 0,
        tokenBalance: null,
        modelUsed: 'guard',
      });
      return;
    }

    // Save user message to Firestore (keep ref for rollback on token fail)
    const messagesCol = firestoreDb.collection(`users/${req.uid}/sommelier_sessions/${sessionId}/messages`);
    const userMsgRef = messagesCol.doc();
    await userMsgRef.set({
      role: 'user',
      content: message,
      seq: session.turn_count * 2 - 1,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Fetch conversation history from Firestore for Claude context
    const historySnap = await messagesCol.orderBy('seq').get();
    const history = historySnap.docs
      .slice(0, -1) // exclude the user message just inserted
      .map(d => ({
        role: d.data().role as 'user' | 'assistant',
        content: d.data().content as string,
      }));

    // Spend token — only when gating is on. Ungated, there's no balance to
    // check and therefore no rollback path: the user message just saved stays,
    // same as a normal turn.
    let newBalance: number | null = null;
    if (gatingEnabled) {
      const spendResult = await spendToken(req.uid!, 'sommelier_turn', String(sessionId));
      if (!spendResult.success) {
        await userMsgRef.delete();
        res.status(402).json({ error: 'insufficient_tokens', balance: spendResult.newBalance });
        return;
      }
      newBalance = spendResult.newBalance;
    }

    // Generate reply
    const ctx = session.context_data ?? {};

    // Liam L3, Part B, step 3 — record the reply to whatever question is
    // still open from an earlier turn, using this turn's incoming message
    // verbatim, before anything else about this turn happens. Only cleared
    // from context_data on a confirmed write (inserted or an idempotent
    // duplicate) — a genuine failure leaves it open for one more attempt on
    // the next turn rather than silently losing the reply.
    let openQuestionId: string | null = ctx.openQuestionId ?? null;
    let openQuestionTurn: number | null = ctx.openQuestionTurn ?? null;
    if (openQuestionId) {
      const cleared = await recordReplyForOpenQuestion({
        uid: req.uid!, sessionId, openQuestionId, openQuestionTurn,
        message, userMessageId: userMsgRef.id,
      });
      if (cleared) { openQuestionId = null; openQuestionTurn = null; }
    }

    await refreshCatalogSnapshotIfStale(req.uid!, ctx, sessionId);

    // Liam L1, Part C.3 — the profile line is rebuilt every turn (the reads
    // are cheap; this is the point — a fact captured earlier in *this same*
    // conversation must show up on the very next turn, same reasoning as the
    // brew-profile/current-coffee live reads elsewhere in this handler).
    const profileReads = await loadProfileReads(req.uid!);
    const profileLine = buildProfileLine(profileReads);
    logProfileLineDebug(req.uid!, '/message', profileLine);
    const factsWatermark = await getFactsWatermark(req.uid!);
    await refreshSliceIfFactsChanged(ctx, sessionId, session.turn_count, profileReads, factsWatermark);

    // Turn-level topic routing (§4.1, HOME_TASK_2) — classifies this message,
    // carrying the previous turn's topic forward (stickiness) until it decays.
    const topicResult = routeTopic(message, {
      currentTopic: ctx.currentTopic ?? null,
      turnsSinceMatch: ctx.currentTopicTurnsSinceMatch ?? 0,
    });
    const topicLogEntry = {
      turn: session.turn_count,
      topic: topicResult.topic,
      confidence: topicResult.confidence,
      matchedKeyword: topicResult.matchedKeyword,
      sticky: topicResult.sticky,
    };
    const topicLog = Array.isArray(ctx.topicLog) ? [...ctx.topicLog, topicLogEntry] : [topicLogEntry];

    // Brew profile (§4.5, §3.5) — live read every turn (see getBrewProfile()'s
    // comment), plus the stale-re-confirm nudge (write rule 5): at most once
    // per session (ctx.staleNudgeSent), only when relevant to this turn's topic.
    const brewProfile = await getBrewProfile(req.uid!);
    const staleNudge = getStaleFieldNudge(brewProfile, topicResult.topic, ctx.staleNudgeSent === true);
    const brewProfileContext = [formatBrewProfileSummary(brewProfile), staleNudge].filter(Boolean).join(' ');

    // Story layer (§4.4, HOME_TASK_5), extended by HOME_TASK_5b (Defect 1) —
    // only on the two topics that ask about the customer's own coffee. Uses
    // whatever was cached in context_data at session start (see the /start
    // handler's own comment); no re-query, no "current coffee" concept
    // invented here (that's HOME_TASK_6's job). Selection now resolves the
    // coffee the customer actually named against the session's alias-carrying
    // candidates, rather than always taking the first candidate with a story —
    // the exact Kenya bug: the strip had Kenya, the customer named Kenya, but
    // selection ignored the name and picked whichever candidate happened to
    // be first/have a story.
    const isMyCoffeeTopic = topicResult.topic === 'my_coffee' || topicResult.topic === 'origins_process';
    const storyCandidates: StoryCandidate[] = Array.isArray(ctx.storyCandidates) ? ctx.storyCandidates : [];
    let storyContext: string | undefined;
    let selectedStoryCoffeeId: number | null = null;
    if (isMyCoffeeTopic && storyCandidates.length > 0) {
      const matched = resolveStoryForMessage(message, storyCandidates);
      // Matched a named coffee: inject its story if it has one; if it doesn't,
      // no story at all — never substitute a different candidate's story for
      // the one the customer actually asked about.
      const fallback = matched ? null : storyCandidates.find(c => c.story) ?? null;
      const selected = matched ?? fallback;
      storyContext = selected?.story ?? undefined;
      selectedStoryCoffeeId = selected?.coffeeId ?? null;
      console.log(`[storyLayer] turn selected coffeeId=${selectedStoryCoffeeId ?? 'none'} (${matched ? 'named match' : fallback ? 'fallback' : 'no candidate story'}) for session=${sessionId}`);
    }

    // HOME_TASK_6 (§3.1, §3.2) — rebuilt live every turn, not cached at
    // session start: the card can change mid-conversation via <<card:adjust>>,
    // and the very next turn needs to reflect that (same "this same
    // conversation" reasoning as the brew profile's own live-every-turn read).
    const entryCoffeeId: number | null = ctx.entryCoffeeId ?? null;
    const entryMethod: string | null = ctx.entryMethod ?? null;
    let currentCoffeeContext: string | undefined;
    if (entryCoffeeId && entryMethod) {
      try {
        const userId = await resolveProfileId(req.uid!);
        const card = userId ? await getCardByMethod(userId, entryCoffeeId, entryMethod) : null;
        if (card) currentCoffeeContext = await buildCurrentCoffeeContext(entryCoffeeId, entryMethod, card);
      } catch (err) {
        console.error('[sommelier/message] current-coffee context rebuild failed:', err);
      }
    }

    // C2 Part 1 — a guard block (kill-switch / daily ceiling) must not 500 an
    // otherwise-successful turn. Roll back the user message just saved above
    // (same rollback discipline the insufficient-tokens path a few lines up
    // already uses) and respond gracefully instead of letting this throw
    // reach the route's outer catch (which would 500).
    let chatResult: Awaited<ReturnType<typeof chatWithSommelier>>;
    try {
      chatResult = await chatWithSommelier({
        message,
        session: {
          intent: session.intent,
          turnCount: session.turn_count,
          openingContext: ctx.openingContext ?? '',
        },
        catalogContext: ctx.catalogText ?? '',
        history,
        mode: topicResult.mode,
        brewProfileContext,
        storyContext,
        currentCoffeeContext,
        profileLine,
      });
    } catch (claudeErr) {
      if (isClaudeGuardBlocked(claudeErr)) {
        await userMsgRef.delete();
        res.status(503).json({ error: 'liam_unavailable', message: LIAM_UNAVAILABLE_MESSAGE });
        return;
      }
      throw claudeErr; // unexpected error — preserve existing behavior (outer catch, 500)
    }
    const { reply, modelUsed, actionTypes, saveRecipeTitle, rememberOps, cardMarker, recommendAlias, askKind } = chatResult;
    const actions = await resolveActions(actionTypes, req.uid!, ctx.archetypeKey ?? null, saveRecipeTitle);
    await resolveRemember(req.uid!, rememberOps, sessionId, session.turn_count);
    await resolveCard(cardMarker, req.uid!, entryCoffeeId, entryMethod, brewProfile, message);

    if (!gatingEnabled) {
      logUsage(req.uid!, String(sessionId), modelUsed).catch(err => console.error('[sommelier/message] logUsage failed:', err));
      checkMonthlySpendAndAlert(req.uid!).catch(err => console.error('[sommelier/message] checkMonthlySpendAndAlert failed:', err));
    }

    const newTurnCount = session.turn_count + 1;
    const shouldClose = newTurnCount >= maxTurns;

    // Save assistant reply to Firestore first — Liam L3, Part B's
    // recommendation/question rows key on this message's own doc id, so it
    // must exist before recordTurn() runs (moved ahead of the session
    // UPDATE below, which now also needs recordTurn()'s result).
    const assistantMsgRef = await messagesCol.add({
      role: 'assistant',
      content: reply,
      modelUsed,
      seq: session.turn_count * 2,
      actions,
      createdAt: FieldValue.serverTimestamp(),
    });

    const messageCandidates: AliasCandidate[] = (Array.isArray(ctx.storyCandidates) ? ctx.storyCandidates : [])
      .map((c: StoryCandidate) => ({ coffeeId: c.coffeeId, alias: c.alias }));
    const writeBackResult = await recordTurn({
      uid: req.uid!,
      sessionId,
      turn: session.turn_count,
      assistantMessageId: assistantMsgRef.id,
      reply,
      recommendAlias,
      askKind,
      candidates: messageCandidates,
      candidateCoffeeIds: Array.isArray(ctx.coffeeIds) ? ctx.coffeeIds : [],
      exploreArchetypeCode: profileReads.exploreArchetypeCode,
    });

    // Updated context_data — carries the topic router's state forward so the
    // next turn's stickiness/decay is correct, and keeps the topic log (the
    // §4.10 ML dataset / §7 topic-distribution metric) growing across turns.
    // staleNudgeSent (write rule 5) latches true the first time a nudge is
    // used and never resets within the session — at most one per session.
    // openQuestionId/openQuestionTurn: writeBackResult only overrides these
    // when a fresh <<ask>> fired this turn; otherwise the step-3 reply
    // recording above already resolved the right carry-forward value
    // (cleared on a recorded reply, unchanged if none was open).
    const updatedContextData = {
      ...ctx,
      currentTopic: topicResult.topic,
      currentTopicTurnsSinceMatch: topicResult.turnsSinceMatch,
      topicLog,
      staleNudgeSent: ctx.staleNudgeSent === true || !!staleNudge,
      openQuestionId: writeBackResult ? writeBackResult.openQuestionId : openQuestionId,
      openQuestionTurn: writeBackResult ? writeBackResult.openQuestionTurn : openQuestionTurn,
    };

    // Update session
    await db.query(
      `UPDATE sommelier_sessions
       SET turn_count = $2, last_active_at = NOW(),
           is_closed = $3, close_reason = $4, context_data = $5
       WHERE id = $1`,
      [sessionId, newTurnCount, shouldClose, shouldClose ? 'turn_limit' : null, JSON.stringify(updatedContextData)]
    );

    // Outcome on close
    if (shouldClose && ctx.evaluationId) {
      const tokensRow = await db.query(
        `SELECT COALESCE(SUM(ABS(delta)), 0) AS total
         FROM token_events
         WHERE uid = $1 AND reference_id = $2 AND delta < 0`,
        [req.uid, String(sessionId)]
      );
      const tokensSpent = Number(tokensRow.rows[0]?.total ?? 0);
      writeOutcome(req.uid!, ctx.evaluationId, {
        sessionCompleted: true,
        turnsUsed: newTurnCount,
        tokensSpent,
      }).catch(err => console.error('[sommelier/message] writeOutcome failed:', err));
    }

    res.json({
      reply,
      // Liam L3, Part C — the assistant reply's own Firestore doc id, so an
      // action-link click can call POST /:sessionId/action with the right
      // messageId (see Task 0's disclosed deviation: no response exposed this before).
      messageId: assistantMsgRef.id,
      actions,
      turnCount: newTurnCount,
      sessionClosed: shouldClose,
      turnsRemaining: maxTurns - newTurnCount,
      // Kept for API back-compat — see the matching note in /start. null when
      // ungated; nothing customer-facing reads this anymore (Sommelier.tsx).
      tokenBalance: newBalance,
      modelUsed,
    });
  } catch (err) {
    console.error('[sommelier/message]', err);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// ─── POST /api/sommelier/:sessionId/action ───────────────────────────────────
// Liam L3, Part C — records that the customer actually clicked one of
// Liam's action links (retake_quiz / open_dial / save_recipe), previously
// only ever stored as *offered* on the assistant message, never as a click.
// Idempotent the same way every other Liam fact is: sourceId is deterministic
// per session/message/actionType, so two clicks on the same link write one row.
router.post('/:sessionId/action', requireAuth, blockAnonymousAuth, requireLiamAccess, async (req: AuthRequest, res) => {
  const sessionId = Number(req.params.sessionId);
  const { messageId, actionType } = req.body;
  if (!messageId || typeof messageId !== 'string' ||
      !['open_dial', 'retake_quiz', 'save_recipe'].includes(actionType)) {
    res.status(400).json({ error: 'messageId and a known actionType are required' });
    return;
  }
  try {
    const sessionResult = await db.query('SELECT id FROM sommelier_sessions WHERE id = $1 AND uid = $2', [sessionId, req.uid]);
    if (!sessionResult.rows.length) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const profileId = await resolveProfileId(req.uid!);
    if (profileId) {
      await record.liamAction({
        userId: profileId,
        source: 'liam',
        sourceId: `${sessionId}:${messageId}:${actionType}`,
        sessionId,
        messageId,
        actionType,
      });
    }
    res.status(204).end();
  } catch (err) {
    console.error('[sommelier/action]', err);
    res.status(500).json({ error: 'Failed to record action' });
  }
});

// ─── GET /api/sommelier/sessions ─────────────────────────────────────────────
router.get('/sessions', requireAuth, blockAnonymousAuth, requireLiamAccess, async (req: AuthRequest, res) => {
  try {
    const result = await db.query(
      `SELECT id, intent, started_at, turn_count, is_closed, close_reason
       FROM sommelier_sessions
       WHERE uid = $1
       ORDER BY started_at DESC
       LIMIT 5`,
      [req.uid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[sommelier/sessions]', err);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// ─── GET /api/sommelier/:sessionId/messages ──────────────────────────────────
router.get('/:sessionId/messages', requireAuth, blockAnonymousAuth, requireLiamAccess, async (req: AuthRequest, res) => {
  const sessionId = Number(req.params.sessionId);
  try {
    const sessionResult = await db.query(
      'SELECT context_data FROM sommelier_sessions WHERE id = $1 AND uid = $2',
      [sessionId, req.uid]
    );
    if (!sessionResult.rows.length) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const ctx = sessionResult.rows[0].context_data ?? {};

    // Read messages from Firestore; fall back to SQL for sessions predating this migration.
    // coffeeNames resolved via resolveCoffeeDisplayNames() (HOME_TASK_5c) — aliases only,
    // resolved at read time so a pre-fix historical session's strip heals itself.
    const [firestoreSnap, coffeeNames] = await Promise.all([
      firestoreDb
        .collection(`users/${req.uid}/sommelier_sessions/${sessionId}/messages`)
        .orderBy('seq')
        .get(),
      resolveCoffeeDisplayNames(ctx.coffeeIds ?? []),
    ]);

    let messages: { role: string; content: string; actions?: SommelierAction[]; messageId?: string }[];
    if (!firestoreSnap.empty) {
      messages = firestoreSnap.docs.map(d => ({
        role: d.data().role as string,
        content: d.data().content as string,
        actions: d.data().actions ?? undefined,
        // Liam L3, Part C — the Firestore doc id, so a past session's action
        // links can still call POST /:sessionId/action (a pre-migration
        // SQL-only session has no doc id at all: messageId stays undefined).
        messageId: d.id,
      }));
    } else {
      const sql = await db.query(
        `SELECT role, content FROM sommelier_messages WHERE session_id = $1 ORDER BY created_at ASC`,
        [sessionId]
      );
      messages = sql.rows;
    }

    res.json({
      messages,
      coffeeNames,
    });
  } catch (err) {
    console.error('[sommelier/messages]', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ─── POST /api/sommelier/:sessionId/close ────────────────────────────────────
router.post('/:sessionId/close', requireAuth, blockAnonymousAuth, requireLiamAccess, async (req: AuthRequest, res) => {
  const sessionId = Number(req.params.sessionId);
  try {
    const sessionResult = await db.query(
      'SELECT * FROM sommelier_sessions WHERE id = $1 AND uid = $2',
      [sessionId, req.uid]
    );
    if (!sessionResult.rows.length) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const session = sessionResult.rows[0];

    if (session.is_closed) {
      res.json({ closed: true });
      return;
    }

    await db.query(
      `UPDATE sommelier_sessions
       SET is_closed = true, close_reason = 'user_closed'
       WHERE id = $1`,
      [sessionId]
    );

    const ctx = session.context_data ?? {};
    if (ctx.evaluationId) {
      writeOutcome(req.uid!, ctx.evaluationId, {
        sessionCompleted: false,
        turnsUsed: session.turn_count,
      }).catch(err => console.error('[sommelier/close] writeOutcome failed:', err));
    }

    res.json({ closed: true });
  } catch (err) {
    console.error('[sommelier/close]', err);
    res.status(500).json({ error: 'Failed to close session' });
  }
});

export default router;
