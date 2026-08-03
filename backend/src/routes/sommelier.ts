import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, blockAnonymousAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { firestoreDb, FieldValue } from '../services/firebase-admin.js';
import { computeBehavioralConfidence } from '../services/behavioralConfidence.js';
import { evaluateSommelier } from '../services/sommelierEvaluator.js';
import { fetchSommelierCoffees, getAliases } from '../services/sommelierRag.js';
import { getTokenBalance, spendToken, logUsage } from '../services/tokenService.js';
import { checkDailyCap, checkMonthlySpendAndAlert } from '../services/sommelierGuards.js';
import { writeOutcome, checkReturnedToSommelier } from '../services/outcomeTracker.js';
import { chatWithSommelier } from '../services/claude.js';
import { getSommelierConfig } from '../services/sommelierConfig.js';
import { routeTopic } from '../services/topicRouter.js';
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
const sommelierIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: (_req) => getSommelierConfig()?.guards?.rateLimits?.perIpPerMinute ?? 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests — please slow down.' },
});
const sommelierAccountLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: (_req) => getSommelierConfig()?.guards?.rateLimits?.perAccountPerMinute ?? 15,
  keyGenerator: (req: AuthRequest) => req.uid ?? req.ip ?? 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests — please slow down.' },
});

// HOME_TASK_3 — a hard rule, not a model decision (S33: "hard rules belong in
// code, not the prompt"), so the daily-cap close is a fixed line in Liam's
// established voice rather than a live model call. Never mentions the words
// "cap"/"limit" — reads as a natural, warm pause, per S32-S34's voice rules.
const DAILY_CAP_CLOSE_MESSAGE = "That's a good amount of ground for today — let's pick this back up tomorrow.";

function getGeneration(dateOfBirth: string | Date | null | undefined): string {
  if (!dateOfBirth) return 'Millennial';
  const year = new Date(dateOfBirth).getFullYear();
  if (year >= 1997) return 'Gen Z';
  if (year >= 1981) return 'Millennial';
  if (year >= 1965) return 'Gen X';
  return 'Boomer';
}

// Matches users.ts's ARCHETYPE_NAME_TO_KEY — quiz/session data carries the display
// name (`archetype.name`), but action links and the dial-position table both key
// off archetype_enum. Duplicated locally per this codebase's existing per-route
// lookup-map convention (see users.ts's own ARCHETYPES/ARCHETYPE_NAME_TO_KEY).
const ARCHETYPE_NAME_TO_KEY: Record<string, string> = {
  'Chocolate & Nutty': 'chocolate_nutty',
  'Balanced & Sweet':  'balanced_sweet',
  'Fruity':            'fruity',
  'Earthy':            'earthy',
  'Floral':            'floral',
  'Experimental':      'experimental',
};

// HOME_TASK_5b (Defect 1 fix) — a session's RAG-selected coffees, each
// carrying the S44-correct alias display name alongside its published story
// (null when the coffee has none). The alias is what makes name-matching
// against the customer's own message possible; `story: null` is a distinct,
// meaningful state from "no candidate at all" — a coffee can be a legitimate
// match target (Liam knows it's on the strip) without having story content.
interface StoryCandidate {
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
  const [aliasMap, archetypeResult] = await Promise.all([
    getAliases(coffeeIds),
    db.query(
      `SELECT c.id, aa.archetype::text AS archetype
       FROM coffees c
       JOIN archetype_assignments aa ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
       WHERE c.id = ANY($1::int[])`,
      [coffeeIds]
    ),
  ]);
  const archetypeLabel = new Map<number, string>();
  for (const row of archetypeResult.rows as { id: number; archetype: string }[]) {
    archetypeLabel.set(row.id, row.archetype.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()));
  }
  return coffeeIds
    .map((id) => aliasMap.get(id) || archetypeLabel.get(id) || 'Coffee')
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
          const posResult = await db.query(
            `SELECT dial_sort_order FROM user_bloom_dial_current_position WHERE user_id = $1 AND archetype = $2`,
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

// Liam Dial Event Log, Phase B — a compact, server-side summary of the customer's
// last ~30 *intentional* dial events (explicit_save / add_to_cart only — plain dial
// turns are never logged, so every event here is already meaningful). Summarized
// into a few fields per archetype, never dumped raw into the prompt.
async function getRecentDialActivitySummary(uid: string): Promise<string> {
  try {
    const snap = await firestoreDb
      .collection(`users/${uid}/dial_events`)
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get();
    if (snap.empty) return '';

    const byArchetype: Record<string, { saveCount: number; cartCount: number; latestSortOrder: number | null; latestTrigger: string }> = {};
    for (const doc of snap.docs) {
      const d = doc.data();
      const archetype = d.archetype as string;
      if (!archetype) continue;
      const entry = byArchetype[archetype] ??= { saveCount: 0, cartCount: 0, latestSortOrder: null, latestTrigger: '' };
      if (d.trigger === 'explicit_save') entry.saveCount++;
      if (d.trigger === 'add_to_cart') entry.cartCount++;
      if (entry.latestSortOrder === null) { entry.latestSortOrder = d.dialSortOrder; entry.latestTrigger = d.trigger; }
    }

    return Object.entries(byArchetype)
      .map(([archetype, e]) =>
        `${archetype}: latest position ${e.latestSortOrder} (${e.latestTrigger === 'add_to_cart' ? 'from a cart add' : 'explicitly saved'}), ${e.saveCount} save(s) and ${e.cartCount} cart add(s) recently`
      )
      .join('; ');
  } catch {
    return ''; // no dial events — normal for most users, not an error
  }
}

// HOME_TASK_4 (§4.5) — one Firestore read of the brew profile, shared by both
// the summary-for-the-prompt path and resolveRemember()'s existing-array read.
// Not cached in context_data (unlike catalogText) because a fact captured
// earlier in *this same* conversation must be reflected on the very next turn.
export async function getBrewProfile(uid: string): Promise<BrewProfileDoc | null> {
  try {
    const snap = await firestoreDb.doc(`users/${uid}/metadata/brew_profile`).get();
    return snap.exists ? (snap.data() as BrewProfileDoc) : null;
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
export async function resolveRemember(uid: string, rememberOps: Array<{ field: string; rawValue: string }>): Promise<void> {
  if (!rememberOps.length) return;
  const fieldsCfg = getBrewProfileFieldsConfig();
  const docRef = firestoreDb.doc(`users/${uid}/metadata/brew_profile`);

  let current: BrewProfileDoc = {};
  try {
    const snap = await docRef.get();
    current = snap.exists ? (snap.data() as BrewProfileDoc) : {};
  } catch (err) {
    console.error('[resolveRemember] read failed', err);
  }

  const updates: Record<string, unknown> = {};
  let anyValid = false;

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
      const maxLen = fieldCfg.maxLength ?? 10;
      const nextArr = [...existingArr, validated as string].slice(-maxLen);
      updates[field] = { value: nextArr, source: 'conversation', capturedAt: FieldValue.serverTimestamp() };
    } else {
      updates[field] = { value: validated, source: 'conversation', capturedAt: FieldValue.serverTimestamp() };
    }
    anyValid = true;
  }

  if (!anyValid) return;

  try {
    await docRef.set({ ...updates, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await incrementBrewProfileCounter('writes');
  } catch (err) {
    console.error('[resolveRemember] write failed', err);
    await incrementBrewProfileCounter('failures');
  }
}

const router = Router();

// ─── POST /api/sommelier/evaluate ────────────────────────────────────────────
router.post('/evaluate', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
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
router.post('/start', sommelierIpLimiter, requireAuth, blockAnonymousAuth, sommelierAccountLimiter, async (req: AuthRequest, res) => {
  // HOME_TASK_6 (§3.1, §3.2) — entry/coffeeId arrive from a bag/card link
  // (this task's own arrival-note/home-surface links today; Task 7's QR
  // redirect later, per the entry=bag param contract this task defines —
  // see spec item 6 and the "Out of scope" note). Ownership is established by
  // whichever entry point produced the link, not re-checked here; every
  // brew_card row this resolves is scoped to req.uid's own user_profile.id
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

    // Fetch user state from latest quiz for RAG context
    const quizResult = await db.query(
      `SELECT qs.context_data, ar.name AS archetype_name, up.date_of_birth
       FROM quiz_session qs
       JOIN user_profile up ON up.id = qs.user_id
       LEFT JOIN archetype ar ON ar.id = qs.resulting_archetype_id
       WHERE up.firebase_uid = $1
       ORDER BY qs.completed_at DESC LIMIT 2`,
      [req.uid]
    );
    const latestQuiz = quizResult.rows[0];
    const prevQuiz = quizResult.rows[1];
    const userArchetype = latestQuiz?.archetype_name ?? null;
    const previousArchetype = prevQuiz?.archetype_name ?? null;
    const archetypeKey = userArchetype ? (ARCHETYPE_NAME_TO_KEY[userArchetype] ?? null) : null;

    const generation = getGeneration(latestQuiz?.date_of_birth ?? null);
    let enrichedOpeningContext = (openingContext ?? '') +
      `\nCustomer generation: ${generation}. Adjust register accordingly (see tone guidelines in your instructions).`;

    // Liam Dial Event Log, Phase B — only for the intents where the addendum
    // actually invites Liam to reference it (PROFILE_AMBIGUOUS, EXPLORATION).
    if (intent === 'EXPLORATION' || intent === 'PROFILE_AMBIGUOUS') {
      const recentDialActivity = await getRecentDialActivitySummary(req.uid!);
      if (recentDialActivity) {
        enrichedOpeningContext += `\nRecent dial activity: ${recentDialActivity}.`;
      }
    }

    // Determine excludeCoffeeIds for RECOMMENDATION_MISS
    let excludeCoffeeIds: number[] = [];
    if (intent === 'RECOMMENDATION_MISS') {
      try {
        // No `.limit(10)` before filtering — a revised (now-superseded) negative
        // event must not keep excluding a coffee the customer no longer feels
        // negatively about (Profile Part 5).
        const feedbackSnap = await firestoreDb
          .collection(`users/${req.uid}/feedback_events`)
          .where('sentiment', '==', 'negative')
          .orderBy('createdAt', 'desc')
          .get();
        excludeCoffeeIds = feedbackSnap.docs
          .filter(d => !d.data().supersededAt)
          .slice(0, 10)
          .map((d) => d.data().coffeeId)
          .filter((id): id is number => typeof id === 'number');
      } catch { /* no feedback events */ }
    }

    const ragFocus = config?.intents?.[intent]?.ragFocus ?? 'curated_mix';
    const ragResult = await fetchSommelierCoffees({
      ragFocus,
      userArchetype,
      previousArchetype: intent === 'TASTE_EVOLUTION' ? previousArchetype : null,
      excludeCoffeeIds,
    });

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
          ragFocus,
          coffeeIds: ragResult.coffeeIds,
          catalogText: ragResult.catalogText,
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
      firestoreDb
        .doc(`users/${req.uid}/sommelier_evaluations/${evaluationId}`)
        .update({ sessionStarted: true, sessionId: newSessionId, startedAt: new Date() })
        .catch((err: unknown) => console.error('[sommelier/start] eval update:', err));

      checkReturnedToSommelier(req.uid!, evaluationId).catch(() => {});
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
    try {
      const chatResult = await chatWithSommelier({
        message: null,
        session: { intent, turnCount: 0, openingContext: enrichedOpeningContext },
        catalogContext: ragResult.catalogText,
        history: [],
        brewProfileContext,
        currentCoffeeContext,
      });
      openingMessage = chatResult.reply;
      modelUsed = chatResult.modelUsed;
      openingActionTypes = chatResult.actionTypes;
      openingSaveRecipeTitle = chatResult.saveRecipeTitle;
      openingRememberOps = chatResult.rememberOps;
      openingCardMarker = chatResult.cardMarker;
    } catch (claudeErr) {
      console.error('[sommelier/start] chatWithSommelier failed, using fallback:', claudeErr);
    }

    if (!gatingEnabled) {
      logUsage(req.uid!, String(newSessionId), modelUsed).catch(() => {});
      checkMonthlySpendAndAlert(req.uid!).catch(() => {});
    }
    // The prompt instructs Liam never to use a marker on the opening turn, but
    // resolve defensively anyway rather than assuming the instruction always holds.
    const openingActions = await resolveActions(openingActionTypes, req.uid!, archetypeKey, openingSaveRecipeTitle);
    await resolveRemember(req.uid!, openingRememberOps);
    await resolveCard(openingCardMarker, req.uid!, entryCoffeeId, entryMethod, brewProfile, 'Begin the conversation.');

    // Save opening message to Firestore
    await firestoreDb
      .collection(`users/${req.uid}/sommelier_sessions/${newSessionId}/messages`)
      .add({
        role: 'assistant',
        content: openingMessage,
        modelUsed,
        seq: 0,
        actions: openingActions,
        createdAt: FieldValue.serverTimestamp(),
      });

    // Update session turn_count + last_active_at
    await db.query(
      `UPDATE sommelier_sessions
       SET turn_count = 1, last_active_at = NOW()
       WHERE id = $1`,
      [newSessionId]
    );

    // Coffee names for the frontend display — aliases only, see
    // resolveCoffeeDisplayNames() above (HOME_TASK_5c).
    const coffeeNames = await resolveCoffeeDisplayNames(ragResult.coffeeIds);

    res.json({
      sessionId: newSessionId,
      openingMessage,
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
router.post('/:sessionId/message', sommelierIpLimiter, requireAuth, blockAnonymousAuth, sommelierAccountLimiter, async (req: AuthRequest, res) => {
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

    const { reply, modelUsed, actionTypes, saveRecipeTitle, rememberOps, cardMarker } = await chatWithSommelier({
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
    });
    const actions = await resolveActions(actionTypes, req.uid!, ctx.archetypeKey ?? null, saveRecipeTitle);
    await resolveRemember(req.uid!, rememberOps);
    await resolveCard(cardMarker, req.uid!, entryCoffeeId, entryMethod, brewProfile, message);

    if (!gatingEnabled) {
      logUsage(req.uid!, String(sessionId), modelUsed).catch(() => {});
      checkMonthlySpendAndAlert(req.uid!).catch(() => {});
    }

    const newTurnCount = session.turn_count + 1;
    const shouldClose = newTurnCount >= maxTurns;

    // Updated context_data — carries the topic router's state forward so the
    // next turn's stickiness/decay is correct, and keeps the topic log (the
    // §4.10 ML dataset / §7 topic-distribution metric) growing across turns.
    // staleNudgeSent (write rule 5) latches true the first time a nudge is
    // used and never resets within the session — at most one per session.
    const updatedContextData = {
      ...ctx,
      currentTopic: topicResult.topic,
      currentTopicTurnsSinceMatch: topicResult.turnsSinceMatch,
      topicLog,
      staleNudgeSent: ctx.staleNudgeSent === true || !!staleNudge,
    };

    // Update session
    await db.query(
      `UPDATE sommelier_sessions
       SET turn_count = $2, last_active_at = NOW(),
           is_closed = $3, close_reason = $4, context_data = $5
       WHERE id = $1`,
      [sessionId, newTurnCount, shouldClose, shouldClose ? 'turn_limit' : null, JSON.stringify(updatedContextData)]
    );

    // Save assistant reply to Firestore
    await messagesCol.add({
      role: 'assistant',
      content: reply,
      modelUsed,
      seq: session.turn_count * 2,
      actions,
      createdAt: FieldValue.serverTimestamp(),
    });

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
      }).catch(() => {});
    }

    res.json({
      reply,
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

// ─── GET /api/sommelier/sessions ─────────────────────────────────────────────
router.get('/sessions', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
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
router.get('/:sessionId/messages', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
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

    let messages: { role: string; content: string; actions?: SommelierAction[] }[];
    if (!firestoreSnap.empty) {
      messages = firestoreSnap.docs.map(d => ({
        role: d.data().role as string,
        content: d.data().content as string,
        actions: d.data().actions ?? undefined,
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
router.post('/:sessionId/close', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
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
      }).catch(() => {});
    }

    res.json({ closed: true });
  } catch (err) {
    console.error('[sommelier/close]', err);
    res.status(500).json({ error: 'Failed to close session' });
  }
});

export default router;
