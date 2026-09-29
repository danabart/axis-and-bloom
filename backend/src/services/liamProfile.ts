import { db } from '../db/client.js';
import type { Tx } from '../db/client.js';
import { getAliases } from './sommelierRag.js';
import { archetypeCode } from './catalogReads.js';
import { formatBrewProfileSummary, type BrewProfileDoc } from './brewProfile.js';
import {
  getQuizCurrent, getBrewProfileCurrent, getFeedbackCurrent, getPalateEvidence, getSharedTraits,
  getDominantDimensions, getArchetypeSpread, getThreads, getSlotCandidates, getTimeline,
  type QuizCurrentRow, type BrewProfileFieldEntry, type FeedbackCurrentRow, type TimelineEntry,
} from './customerReads.js';

// ── Liam L1, Part A (2026-09-28) — the profile line: facts, rebuilt every
// turn, never estimated. See backend/src/features/ai_agent_liam/recommendation/
// CLAUDE_CODE_PROMPT_LIAM_1_PROFILE_LINE_AND_RAG.md.
//
// Task 0 found six of the ten customerReads.ts reads this depends on
// (getPalateEvidence/getSharedTraits/getDominantDimensions/getArchetypeSpread/
// getThreads/getSlotCandidates) are untyped `SELECT *` passthroughs
// (Record<string, unknown>) — no interface exists on customerReads.ts itself.
// The row shapes below mirror the live view columns exactly (cross-checked
// against customerIntegrity.ts's own EXPECTED_PALATE_VIEW_COLUMNS manifest,
// the same source of truth that check 18 enforces at boot) rather than
// retrofitting customerReads.ts, which is out of this brief's stated scope.
// pg returns every bigint/numeric column as a string, never a number — every
// field below that is bigint/numeric in schema.sql is typed `string` here for
// honesty, and Number()'d wherever it's used numerically.

interface SharedTraitRow {
  kind: 'dimension' | 'descriptor';
  trait_key: string;
  trait_label: string;
  value_min: string | null;
  value_max: string | null;
  overlaps: boolean | null;
  n_coffees: string;
}
interface DominantDimensionRow {
  dimension_id: number;
  dimension_name: string;
  mean_midpoint: string;
  n_coffees: string;
  liked_mean_midpoint: string | null;
  n_liked: string;
  disliked_mean_midpoint: string | null;
  n_disliked: string;
}
interface PalateEvidenceRow {
  n_attributed_lines: string;
  has_quiz: boolean;
}
interface SlotCandidateRow {
  slot_id: number;
  coffee_id: number;
  coffee_name: string;
  already_bought: boolean;
  last_rating: number | null;
}
interface ThreadRow {
  occurred_at: string;
  archetype_code: string | null;
  reply: string | null;
  status: 'asked' | 'answered';
  // Liam L3, Part D — so the line can say "asked on turn n (session s)"
  // instead of a bare date.
  session_id: number;
  turn: number;
}

export interface ProfileReads {
  quizCurrent: QuizCurrentRow | null;
  brewProfile: Record<string, BrewProfileFieldEntry>;
  feedbackCurrent: FeedbackCurrentRow[];
  evidence: PalateEvidenceRow | null;
  sharedTraits: SharedTraitRow[];
  dominantDimensions: DominantDimensionRow[];
  // archetypeSpread isn't rendered by any line in this brief's target shape —
  // carried for a later brief's use (L2 addenda), not read here.
  archetypeSpread: unknown[];
  threads: ThreadRow[];
  slotCandidates: SlotCandidateRow[];
  // The source for "Had before": v_customer_timeline's own 'order_line' kind
  // includes every bag-attribution row keyed by whoever v_customer_bag_
  // attribution resolves as drinker_user_id, INCLUDING 'unattributed' ones
  // (schema.sql's own UNION arm has no attribution filter) — filtered to
  // detail.attribution !== 'unattributed' below, per rule 47's "household-
  // unattributed lines are not mentioned."
  timeline: TimelineEntry[];
  // Pre-resolved by loadProfileReads() below so buildProfileLine() itself can
  // stay synchronous and pure, per the brief's own signature
  // (buildProfileLine(reads: ProfileReads): string) — getAliases()/
  // archetypeCode() are both async (DB reads), so they can't live inside a
  // pure function; loadProfileReads() is the one place that gathers everything,
  // in parallel, before calling the pure line-builder.
  aliasByCoffee: Map<number, string>;
  exploreArchetypeCode: string | null;
}

const HEADER = 'ABOUT THIS CUSTOMER (facts; rebuilt every turn)';

// UTC explicitly — every fact timestamp this renders is stored (and
// rendered elsewhere in this codebase) as a UTC instant; without this, a
// server/test runner in a negative-UTC-offset timezone shows the wrong
// calendar day (a real bug caught by liamProfile.test.ts: a fixture row at
// midnight UTC rendered as the previous evening in Pacific time).
function shortDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function buildMatchLine(quiz: QuizCurrentRow | null): string | null {
  if (!quiz?.archetypeName) return null;
  let line = `Match: ${quiz.archetypeName}`;
  if (quiz.secondaryArchetype) {
    line += `; second: ${quiz.secondaryArchetype}`;
    if (quiz.interpretationSource === 'table' && quiz.pairConfidence) {
      line += ` (pair confidence: ${quiz.pairConfidence}; interpretation ${quiz.interpretationVersion})`;
    }
  }
  return line;
}

// Liam L3, Part D — "asked on turn n (session s)" / "answered: '...' (turn n)",
// now that v_palate_threads exposes session_id/turn (added this brief).
// L1's disclosed deviation (short-date rendering, no writer existed yet) is
// resolved: recordTurn() in liamWriteBack.ts is the real writer now.
function buildOpenThreadLine(quiz: QuizCurrentRow | null, threads: ThreadRow[], exploreArchetypeCode: string | null): string | null {
  if (quiz?.interpretationSource !== 'table' || !quiz.exploreArchetype) return null;
  let line = `Open thread: ${quiz.exploreArchetype}`;
  if (quiz.exploreReason) line += ` (${quiz.exploreReason})`;

  const thread = exploreArchetypeCode ? threads.find(t => t.archetype_code === exploreArchetypeCode) : undefined;
  if (thread?.status === 'answered' && thread.reply) {
    const trimmedReply = thread.reply.length > 80 ? `${thread.reply.slice(0, 80).trim()}…` : thread.reply;
    line += ` — answered: "${trimmedReply}" (turn ${thread.turn})`;
  } else if (thread) {
    line += ` — asked on turn ${thread.turn} (session ${thread.session_id})`;
  } else {
    line += ' — not yet asked';
  }
  return line;
}

function buildBagsLine(evidence: PalateEvidenceRow | null, feedback: FeedbackCurrentRow[], sharedTraits: SharedTraitRow[]): string | null {
  if (!evidence) return null;
  const nAttributed = Number(evidence.n_attributed_lines);
  if (nAttributed === 0) return 'Bags: quiz only: no bags yet';

  const nLiked = feedback.filter(f => f.sentiment === 'positive').length;
  const nDisliked = feedback.filter(f => f.sentiment === 'negative').length;
  let line = `Bags: ${nAttributed} attributed, ${nLiked} liked, ${nDisliked} disliked.`;

  const dims = sharedTraits.filter(t => t.kind === 'dimension' && t.overlaps === true);
  const descriptors = sharedTraits.filter(t => t.kind === 'descriptor');
  const parts: string[] = [];
  if (dims.length) {
    parts.push(dims.map(d => `${d.trait_label.toLowerCase()} ${d.value_min}–${d.value_max}`).join(', '));
  }
  if (descriptors.length) {
    const list = descriptors.map(d => d.trait_key);
    const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}` : list[0];
    parts.push(`${joined} on every bag`);
  }
  if (parts.length) line += ` Shared: ${parts.join('; ')}`;
  return line;
}

function buildLeansLine(dominant: DominantDimensionRow[]): string | null {
  const rows = dominant.filter(d => d.liked_mean_midpoint !== null && d.disliked_mean_midpoint !== null);
  if (!rows.length) return null;
  const clauses = rows.map(d =>
    `${d.dimension_name.toLowerCase()} liked ${Number(d.liked_mean_midpoint).toFixed(1)} vs disliked ${Number(d.disliked_mean_midpoint).toFixed(1)}`
  );
  return `Leans: ${clauses.join('; ')}`;
}

function buildDislikedLine(feedback: FeedbackCurrentRow[], aliasByCoffee: Map<number, string>): string | null {
  const disliked = feedback.filter(f => f.sentiment === 'negative');
  if (!disliked.length) return null;
  const clauses = disliked.map(f => {
    const alias = aliasByCoffee.get(f.coffeeId) ?? 'a coffee';
    const ratingPart = f.rating !== null ? `rated ${f.rating}` : 'disliked';
    const textPart = f.rawText ? `, "${f.rawText}"` : '';
    return `${alias} (${ratingPart}${textPart})`;
  });
  return `Disliked: ${clauses.join('; ')}`;
}

// "Had before" = distinct attributed coffees with last rating (rule 47).
// Sourced from the timeline's own 'order_line' entries (filtered to
// attribution !== 'unattributed'), joined against feedback for each coffee's
// most recent rating — not every attributed coffee has feedback, so rating is
// shown only when one exists.
function buildHadBeforeLine(
  timeline: TimelineEntry[],
  feedback: FeedbackCurrentRow[],
  aliasByCoffee: Map<number, string>
): string | null {
  const attributedLines = timeline.filter(
    t => t.kind === 'order_line' && t.coffeeId !== null && (t.detail as { attribution?: string })?.attribution !== 'unattributed'
  );
  if (!attributedLines.length) return null;

  const lastOccurredByCoffee = new Map<number, Date>();
  for (const line of attributedLines) {
    const coffeeId = line.coffeeId!;
    const existing = lastOccurredByCoffee.get(coffeeId);
    if (!existing || line.occurredAt > existing) lastOccurredByCoffee.set(coffeeId, line.occurredAt);
  }
  const lastRatingByCoffee = new Map<number, { rating: number; occurredAt: Date }>();
  for (const f of feedback) {
    if (f.rating === null) continue;
    const existing = lastRatingByCoffee.get(f.coffeeId);
    if (!existing || f.occurredAt > existing.occurredAt) lastRatingByCoffee.set(f.coffeeId, { rating: f.rating, occurredAt: f.occurredAt });
  }

  const distinctCoffeeIds = [...lastOccurredByCoffee.keys()];
  const clauses = distinctCoffeeIds.map(coffeeId => {
    const alias = aliasByCoffee.get(coffeeId) ?? 'a coffee';
    const rating = lastRatingByCoffee.get(coffeeId);
    const lastOccurredAt = lastOccurredByCoffee.get(coffeeId)!;
    return rating
      ? `${alias} (rated ${rating.rating}, ${shortDate(lastOccurredAt)})`
      : `${alias} (${shortDate(lastOccurredAt)})`;
  });
  return `Had before: ${clauses.join('; ')}`;
}

function buildPalatePicksLine(slotCandidates: SlotCandidateRow[], aliasByCoffee: Map<number, string>): string | null {
  if (!slotCandidates.length) return null;
  const top5 = slotCandidates.slice(0, 5);
  const clauses = top5.map(c => {
    const alias = aliasByCoffee.get(c.coffee_id) ?? c.coffee_name;
    if (!c.already_bought) return alias;
    // already_bought with no rating is real (bought, never rated — e.g. a
    // subscription renewal with no feedback yet) — render "[had]", never the
    // literal string "null".
    return c.last_rating !== null ? `${alias} [had, ${c.last_rating}]` : `${alias} [had]`;
  });
  return `Palate picks (from their bags, in order): ${clauses.join(', ')}`;
}

// Pure — no I/O, no model call, deterministic. Every async lookup this line
// needs (coffee aliases, the explore archetype's code) is resolved ahead of
// time by loadProfileReads() below and carried on `reads` itself.
export function buildProfileLine(reads: ProfileReads): string {
  const { quizCurrent, brewProfile, feedbackCurrent, evidence, sharedTraits, dominantDimensions, threads, slotCandidates, timeline, aliasByCoffee, exploreArchetypeCode } = reads;

  const lines = [
    HEADER,
    buildMatchLine(quizCurrent),
    buildOpenThreadLine(quizCurrent, threads, exploreArchetypeCode),
    buildBagsLine(evidence, feedbackCurrent, sharedTraits),
    buildLeansLine(dominantDimensions),
    buildDislikedLine(feedbackCurrent, aliasByCoffee),
    buildHadBeforeLine(timeline, feedbackCurrent, aliasByCoffee),
    brewProfile && Object.keys(brewProfile).length
      ? `Setup: ${formatBrewProfileSummary(brewProfile as unknown as BrewProfileDoc)}`
      : null,
    buildPalatePicksLine(slotCandidates, aliasByCoffee),
  ].filter((l): l is string => l !== null);

  return lines.join('\n');
}

// The one place that gathers every C3 read for one customer, in parallel, plus
// the two async lookups (coffee aliases, explore archetype's code) the pure
// line-builder above needs pre-resolved. Callers (routes/sommelier.ts) use
// this instead of calling each customerReads.ts function themselves.
// `runner` defaults to the app pool like every customerReads.ts function
// itself; liamProfile.test.ts passes its own owner transaction so the whole
// read path — including getAliases(), which needed the same runner threaded
// through (see sommelierRag.ts) — sees fixture rows that are never committed.
export async function loadProfileReads(uid: string, runner: Tx | typeof db = db): Promise<ProfileReads> {
  const [quizCurrent, brewProfile, feedbackCurrent, evidence, sharedTraits, dominantDimensions, archetypeSpread, threads, slotCandidates, timeline] =
    await Promise.all([
      getQuizCurrent(uid, runner),
      getBrewProfileCurrent(uid, runner),
      getFeedbackCurrent(uid, {}, runner),
      getPalateEvidence(uid, runner) as unknown as Promise<PalateEvidenceRow | null>,
      getSharedTraits(uid, runner) as unknown as Promise<SharedTraitRow[]>,
      getDominantDimensions(uid, runner) as unknown as Promise<DominantDimensionRow[]>,
      getArchetypeSpread(uid, runner),
      getThreads(uid, runner) as unknown as Promise<ThreadRow[]>,
      getSlotCandidates(uid, runner) as unknown as Promise<SlotCandidateRow[]>,
      getTimeline(uid, runner),
    ]);

  const coffeeIds = [...new Set([
    ...feedbackCurrent.map(f => f.coffeeId),
    ...slotCandidates.map(c => c.coffee_id),
    ...timeline.filter(t => t.kind === 'order_line' && t.coffeeId !== null).map(t => t.coffeeId!),
  ])];
  const [aliasByCoffee, exploreArchetypeCode] = await Promise.all([
    getAliases(coffeeIds, runner),
    quizCurrent?.exploreArchetype ? archetypeCode(quizCurrent.exploreArchetype, runner) : Promise.resolve(null),
  ]);

  return {
    quizCurrent, brewProfile, feedbackCurrent, evidence, sharedTraits, dominantDimensions,
    archetypeSpread, threads, slotCandidates, timeline, aliasByCoffee, exploreArchetypeCode,
  };
}
