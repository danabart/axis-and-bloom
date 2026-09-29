import { db, type Tx } from '../db/client.js';
import { record } from './customerFacts.js';
import { firestoreDb, FieldValue } from './firebase-admin.js';

type Runner = Tx | typeof db;

// ── Liam L3, Part B (2026-09-28) — what Liam recommends and asks becomes a
// fact. See backend/src/features/ai_agent_liam/recommendation/
// CLAUDE_CODE_PROMPT_LIAM_3_WRITE_BACK.md.
//
// Every customer_liam_* table, and customerFacts.record.liam*(), already
// existed (Customer Blueprint C1) — this file is the resolver: it decides
// *whether* a fact gets written, record.*() decides *how*. Idempotency is
// already enforced by insertFact()'s ON CONFLICT (source, source_id) DO
// NOTHING (customerFacts.ts) — every sourceId below is deterministic per
// session/turn/marker, so a retried turn writes nothing twice.

export interface AliasCandidate {
  coffeeId: number;
  alias: string;
}

async function resolveProfileId(uid: string, runner: Runner = db): Promise<string | null> {
  const result = await runner.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [uid]);
  return result.rows[0]?.id ?? null;
}

// Part B — exact match on the alias (case-insensitive, trimmed). No fuzzy
// matching: a near-miss is an unresolved marker, never a guess.
export function resolveAlias(alias: string, candidates: AliasCandidate[]): number | null {
  const normalized = alias.trim().toLowerCase();
  if (!normalized) return null;
  const match = candidates.find(c => c.alias.trim().toLowerCase() === normalized);
  return match?.coffeeId ?? null;
}

// Part B — every candidate alias present in the reply text as a whole word,
// case-insensitive, in order of appearance. Used only when no marker
// resolved (a marked pick is authoritative; detection is the fallback net).
export function detectAliases(text: string, candidates: AliasCandidate[]): number[] {
  const found: Array<{ coffeeId: number; index: number }> = [];
  const seen = new Set<number>();
  for (const c of candidates) {
    const alias = c.alias.trim();
    if (!alias || seen.has(c.coffeeId)) continue;
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`\\b${escaped}\\b`, 'i').exec(text);
    if (match) {
      found.push({ coffeeId: c.coffeeId, index: match.index });
      seen.add(c.coffeeId);
    }
  }
  return found.sort((a, b) => a.index - b.index).map(f => f.coffeeId);
}

// Part B — the last sentence ending in "?", else the whole reply trimmed to
// 300 chars. A model judgment ("leaned in / declined") is never stored —
// only this verbatim question text and, later, the customer's verbatim reply.
export function extractQuestion(reply: string): string {
  const sentences = reply.match(/[^.!?]*\?/g);
  if (sentences && sentences.length) {
    return sentences[sentences.length - 1].trim();
  }
  return reply.trim().slice(0, 300);
}

// Informational-only counter for admin/liam/outcomes (Part E) — an
// unresolved <<recommend:...>> marker leaves no row anywhere else to count
// from (it's a console.log, not a fact), so it gets the same lightweight
// Firestore-counter treatment brewProfile.ts's admin_stats/brew_profile
// already uses. Never throws: a counter failing to increment must never be
// the reason a customer-facing turn fails.
async function incrementUnresolvedRecommendCounter(): Promise<void> {
  try {
    await firestoreDb.doc('admin_stats/liam_writeback').set(
      { recommendUnresolved: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  } catch (err) {
    console.error('[liamWriteBack] failed to increment recommendUnresolved counter', err);
  }
}

export async function getLiamWriteBackCounters(): Promise<{ recommendUnresolved: number }> {
  try {
    const snap = await firestoreDb.doc('admin_stats/liam_writeback').get();
    const data = snap.exists ? snap.data() : null;
    return { recommendUnresolved: Number(data?.recommendUnresolved ?? 0) };
  } catch {
    return { recommendUnresolved: 0 };
  }
}

async function recordRecommendation(params: {
  profileId: string;
  sessionId: number;
  turn: number;
  assistantMessageId: string;
  recommendAlias: string | null;
  reply: string;
  candidates: AliasCandidate[];
  candidateCoffeeIds: number[];
  runner: Runner;
}): Promise<void> {
  const { profileId, sessionId, turn, assistantMessageId, recommendAlias, reply, candidates, candidateCoffeeIds, runner } = params;
  try {
    if (recommendAlias) {
      const coffeeId = resolveAlias(recommendAlias, candidates);
      if (coffeeId === null) {
        console.log(`[liam:RECOMMEND_UNRESOLVED] session=${sessionId} turn=${turn} alias="${recommendAlias}"`);
        await incrementUnresolvedRecommendCounter();
        return;
      }
      await record.liamRecommendation({
        userId: profileId,
        source: 'liam',
        sourceId: `${sessionId}:${turn}:recommend`,
        sessionId,
        turn,
        messageId: assistantMessageId,
        coffeeId,
        candidateCoffeeIds,
        palateReadVersion: 'v1',
        detected: false,
      }, runner as Tx);
      return;
    }

    // No marker — fall back to detection so a real pick is never lost, just
    // flagged lower-grade (detected:true).
    const detectedIds = detectAliases(reply, candidates);
    if (!detectedIds.length) return;
    console.log(`[liam:RECOMMEND_UNMARKED] session=${sessionId} turn=${turn} coffeeIds=${detectedIds.join(',')}`);
    for (const coffeeId of detectedIds) {
      await record.liamRecommendation({
        userId: profileId,
        source: 'liam',
        sourceId: `${sessionId}:${turn}:detected:${coffeeId}`,
        sessionId,
        turn,
        messageId: assistantMessageId,
        coffeeId,
        candidateCoffeeIds,
        palateReadVersion: 'v1',
        detected: true,
      }, runner as Tx);
    }
  } catch (err) {
    console.error('[liamWriteBack] recordRecommendation failed', err);
  }
}

async function recordQuestion(params: {
  profileId: string;
  sessionId: number;
  turn: number;
  assistantMessageId: string;
  askKind: 'thread' | 'palate' | 'brew' | null;
  reply: string;
  exploreArchetypeCode: string | null;
  runner: Runner;
}): Promise<{ openQuestionId: string; openQuestionTurn: number } | null> {
  const { profileId, sessionId, turn, assistantMessageId, askKind, reply, exploreArchetypeCode, runner } = params;
  if (!askKind) return null;
  try {
    const result = await record.liamQuestion({
      userId: profileId,
      source: 'liam',
      sourceId: `${sessionId}:${turn}:ask`,
      sessionId,
      turn,
      messageId: assistantMessageId,
      kind: askKind,
      archetypeCode: askKind === 'thread' ? exploreArchetypeCode : null,
      question: extractQuestion(reply),
    }, runner as Tx);
    if (!result.id) return null; // idempotent no-op retry — nothing new to open
    return { openQuestionId: result.id, openQuestionTurn: turn };
  } catch (err) {
    console.error('[liamWriteBack] recordQuestion failed', err);
    return null;
  }
}

// Part B — called after the assistant message's Firestore add() resolves,
// since the recommendation/question rows key on that message's own id.
// Recommendation and question are independent (both may fire the same
// turn: a pick with a follow-up question). Returns the new open-question
// state only when a question was actually recorded this turn — `null` means
// "no change," never "clear the existing one": a turn with no <<ask>> must
// leave whatever question is already open alone (it's still awaiting a
// reply), only a fresh <<ask>> replaces it (D-brief's "a new <<ask>> while
// one is open closes the old one unanswered" — the old one simply stops
// being the one context_data points to).
export async function recordTurn(params: {
  uid: string;
  sessionId: number;
  turn: number;
  assistantMessageId: string;
  reply: string;
  recommendAlias: string | null;
  askKind: 'thread' | 'palate' | 'brew' | null;
  candidates: AliasCandidate[];
  candidateCoffeeIds: number[];
  exploreArchetypeCode: string | null;
}, runner: Runner = db): Promise<{ openQuestionId: string; openQuestionTurn: number } | null> {
  const profileId = await resolveProfileId(params.uid, runner).catch(() => null);
  if (!profileId) return null;

  await recordRecommendation({
    profileId,
    sessionId: params.sessionId,
    turn: params.turn,
    assistantMessageId: params.assistantMessageId,
    recommendAlias: params.recommendAlias,
    reply: params.reply,
    candidates: params.candidates,
    candidateCoffeeIds: params.candidateCoffeeIds,
    runner,
  });

  return recordQuestion({
    profileId,
    sessionId: params.sessionId,
    turn: params.turn,
    assistantMessageId: params.assistantMessageId,
    askKind: params.askKind,
    reply: params.reply,
    exploreArchetypeCode: params.exploreArchetypeCode,
    runner,
  });
}

// Part B, step 3 — called at the very start of the next /message, before
// anything else, using the customer's incoming message as the reply to
// whatever question is still open. Returns whether the caller should clear
// openQuestionId from context_data: true on success (inserted or an
// idempotent duplicate — either way the fact is/was recorded), false on a
// genuine write failure, so a transient error gets one more attempt on the
// following turn rather than silently losing the reply forever.
export async function recordReplyForOpenQuestion(params: {
  uid: string;
  sessionId: number;
  openQuestionId: string | null;
  openQuestionTurn: number | null;
  message: string;
  userMessageId: string;
}, runner: Runner = db): Promise<boolean> {
  if (!params.openQuestionId) return false;
  try {
    const profileId = await resolveProfileId(params.uid, runner);
    if (!profileId) return false;
    await record.liamReply({
      userId: profileId,
      source: 'liam',
      sourceId: `${params.sessionId}:${params.openQuestionTurn}:reply`,
      questionId: params.openQuestionId,
      reply: params.message.trim().slice(0, 2000),
      messageId: params.userMessageId,
    }, runner as Tx);
    return true;
  } catch (err) {
    console.error('[liamWriteBack] recordReplyForOpenQuestion failed', err);
    return false;
  }
}
