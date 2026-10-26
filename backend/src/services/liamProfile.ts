import { db } from '../db/client.js';
import type { Tx } from '../db/client.js';
import { getAliases, type CatalogBlock, type RagParams } from './sommelierRag.js';
import { archetypeCode, archetypeLabel, getSellableSlots } from './catalogReads.js';
import { getSommelierConfig } from './sommelierConfig.js';
import { formatBrewProfileSummary, getStaleFieldNudge, type BrewProfileDoc } from './brewProfile.js';
import type { SommelierConfig } from './sommelierConfig.js';
import {
  getQuizCurrent, getBrewProfileCurrent, getFeedbackCurrent, getPalateEvidence, getSharedTraits,
  getDominantDimensions, getArchetypeSpread, getThreads, getSlotCandidates, getTimeline,
  distinctSecondary, type QuizCurrentRow, type BrewProfileFieldEntry, type FeedbackCurrentRow, type TimelineEntry,
  getCustomerIdentity, getQuizHistory, getRecentOrders, getSubscriptionCurrent, getShipsTo, getSavedCoffees,
  getBrewCardsCurrent, getLiamHistory,
  type CustomerIdentity, type QuizHistoryEntry, type RecentOrders, type SubscriptionCurrent, type SavedDialItem,
  type BrewCardCurrent, type LiamSessionHistory,
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
  // Liam sees everything brief Rev 2, Part B (2026-10-24). All optional so a
  // caller (or a fixture) without them renders exactly the L1 lines.
  identity?: CustomerIdentity | null;
  quizHistory?: QuizHistoryEntry[];
  orders?: RecentOrders;
  subscription?: SubscriptionCurrent | null;
  shipsTo?: { city: string | null; state: string | null } | null;
  saved?: SavedDialItem[];
  savedSlotAlias?: Map<string, string>;   // 'archetype:sortOrder' -> current slot alias
  brewCards?: BrewCardCurrent[];
  liamHistory?: LiamSessionHistory[];
  archetypeLabels?: Map<string, string>;  // code -> label (older-orders line)
  counts?: { feedbackCount: number };
  // Answer evals follow-up 2 (2026-10-26, OT-50): the line printed under the
  // orders lines (customerBlock.shippingStatusLine, {supportContact} filled),
  // so Sonnet has the sentence to say instead of guessing a status.
  shippingStatusLine?: string | null;
}

const HEADER = 'ABOUT THIS CUSTOMER (facts; rebuilt every turn)';

// UTC explicitly — every fact timestamp this renders is stored (and
// rendered elsewhere in this codebase) as a UTC instant; without this, a
// server/test runner in a negative-UTC-offset timezone shows the wrong
// calendar day (a real bug caught by liamProfile.test.ts: a fixture row at
// midnight UTC rendered as the previous evening in Pacific time).
export function shortDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function buildMatchLine(quiz: QuizCurrentRow | null): string | null {
  if (!quiz?.archetypeName) return null;
  let line = `Match: ${quiz.archetypeName}`;
  const second = distinctSecondary(quiz.archetypeName, quiz.secondaryArchetype);
  if (second) {
    line += `; second: ${second}`;
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

// ── Liam sees everything brief Rev 2, Part B — the new lines. Each renders only
// when its read is non-empty. No status, tracking or delivery date (nothing
// writes them), no street, no payment data, no internal id.
function monthYear(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// "no quiz on file" is stated as a fact (B1's no-quiz rule needs something to
// act on: a missing Match line alone let Liam guess an archetype, found in the
// live eval). It rides on the name line so an empty customer stays the L1
// bytes plus that one line; without a first name it is its own line.
function buildNameLine(identity: CustomerIdentity | null | undefined, noQuiz: boolean): string | null {
  if (!identity?.firstName) return noQuiz && identity ? 'No quiz on file' : null;
  const parts = [`Name: ${identity.firstName}`];
  if (identity.memberSince) parts.push(`member since ${monthYear(identity.memberSince)}`);
  if (identity.householdMembers > 0) parts.push(`shares a household account with ${identity.householdMembers} other${identity.householdMembers === 1 ? '' : 's'}`);
  if (noQuiz) parts.push('no quiz on file');
  return parts.join('; ');
}

function buildQuizHistoryLine(history: QuizHistoryEntry[] | undefined): string | null {
  if (!history?.length) return null;
  const [current, ...earlier] = history;
  let line = `Quiz: ${current.archetypeName} (${shortDate(current.completedAt)})`;
  if (earlier.length) line += `; before that: ${earlier.map(h => `${h.archetypeName} (${monthYear(h.completedAt)})`).join(', ')}`;
  return line;
}

function buildFeedbackLine(feedback: FeedbackCurrentRow[], aliasByCoffee: Map<number, string>, limit: number): string | null {
  const rows = [...feedback].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()).slice(0, limit);
  if (!rows.length) return null;
  const clauses = rows.map(f => {
    const alias = aliasByCoffee.get(f.coffeeId) ?? 'a coffee';
    const feel = f.sentiment === 'positive' ? 'liked' : f.sentiment === 'negative' ? 'disliked' : 'mixed';
    const rating = f.rating !== null ? `, rated ${f.rating}` : '';
    const words = f.rawText ? `, "${f.rawText.length > 120 ? `${f.rawText.slice(0, 120).trim()}…` : f.rawText}"` : '';
    return `${alias} (${feel}${rating}${words})`;
  });
  return `Feedback (newest first): ${clauses.join('; ')}`;
}

/** customerBlock.shippingStatusLine with {supportContact} filled in; null when not configured. */
export function shippingStatusLine(cfg: SommelierConfig | null | undefined): string | null {
  const line = cfg?.customerBlock?.shippingStatusLine?.trim();
  if (!line) return null;
  const contact = cfg?.brandFacts?.supportContact;
  return contact ? line.replace(/\{supportContact\}/g, contact) : line;
}

function buildOrdersLines(orders: RecentOrders | undefined, aliasByCoffee: Map<number, string>, archetypeLabels: Map<string, string>, statusLine?: string | null): string[] {
  if (!orders || (!orders.recent.length && !orders.olderCount)) return [];
  const lines: string[] = [];
  if (orders.recent.length) {
    const clauses = orders.recent.map(o => {
      const items = o.lines.map(l => {
        const alias = l.coffeeId !== null ? aliasByCoffee.get(l.coffeeId) ?? 'a coffee' : 'a coffee';
        const size = l.weightOz !== null ? ` ${l.weightOz} oz` : '';
        return `${alias}${size} ×${l.quantity}`;
      });
      return `${shortDate(o.createdAt)}: ${items.length ? items.join(', ') : 'an order'}`;
    });
    lines.push(`Orders (what and when only): ${clauses.join('; ')}`);
  }
  if (orders.olderCount) {
    const top = Object.entries(orders.olderArchetypeCounts).sort((a, b) => b[1] - a[1])[0];
    lines.push(`${orders.olderCount} earlier order${orders.olderCount === 1 ? '' : 's'}${top ? `, mostly ${archetypeLabels.get(top[0]) ?? top[0]}` : ''}`);
  }
  if (statusLine) lines.push(statusLine);
  return lines;
}

function buildSavedLine(saved: SavedDialItem[] | undefined, aliasByCoffee: Map<number, string>, savedSlotAlias: Map<string, string> | undefined): string | null {
  if (!saved?.length) return null;
  const names = [...new Set(saved.map(s =>
    (s.coffeeId !== null ? aliasByCoffee.get(s.coffeeId) : undefined)
    ?? (s.archetype && s.dialSortOrder !== null ? savedSlotAlias?.get(`${s.archetype}:${s.dialSortOrder}`) : undefined)
  ).filter((n): n is string => !!n))];
  return names.length ? `Saved to their profile: ${names.join(', ')}` : null;
}

function buildBrewCardsLine(cards: BrewCardCurrent[] | undefined, aliasByCoffee: Map<number, string>): string | null {
  if (!cards?.length) return null;
  const clauses = cards.map(c => {
    const params = [c.ratio, c.grindLabel, c.tempC !== null ? `${c.tempC}°C` : null].filter(Boolean).join(', ');
    return `${aliasByCoffee.get(c.coffeeId) ?? 'a coffee'} on ${c.method.replace(/_/g, ' ')}${params ? `: ${params}` : ''}`;
  });
  return `Brew cards: ${clauses.join('; ')}`;
}

function buildSubscriptionLine(sub: SubscriptionCurrent | null | undefined): string | null {
  if (!sub) return null;
  return `Subscription: ${sub.status}${sub.sponsored ? ' (sponsored)' : ''}`;
}

function buildShipsToLine(shipsTo: { city: string | null; state: string | null } | null | undefined): string | null {
  if (!shipsTo) return null;
  const place = [shipsTo.city, shipsTo.state].filter(Boolean).join(', ');
  return place ? `Ships to: ${place}` : null;
}

function buildLiamHistoryLine(history: LiamSessionHistory[] | undefined, aliasByCoffee: Map<number, string>): string | null {
  if (!history?.length) return null;
  const clauses = history.map(h => {
    const parts = [shortDate(h.at)];
    const recs = h.recommendedCoffeeIds.map(id => aliasByCoffee.get(id)).filter((n): n is string => !!n);
    if (recs.length) parts.push(`recommended ${recs.join(', ')}`);
    if (h.answers.length) parts.push(`they answered ${h.answers.map(a => `"${a.length > 80 ? `${a.slice(0, 80).trim()}…` : a}"`).join(', ')}`);
    return parts.join(': ');
  });
  return `With Liam before: ${clauses.join('; ')}`;
}

// Pure — no I/O, no model call, deterministic. Every async lookup this line
// needs (coffee aliases, the explore archetype's code) is resolved ahead of
// time by loadProfileReads() below and carried on `reads` itself.
export function buildProfileLine(reads: ProfileReads): string {
  const { quizCurrent, brewProfile, feedbackCurrent, evidence, sharedTraits, dominantDimensions, threads, slotCandidates, timeline, aliasByCoffee, exploreArchetypeCode } = reads;

  const lines = [
    HEADER,
    buildNameLine(reads.identity, !quizCurrent?.archetypeName && !(reads.quizHistory?.length)),
    buildMatchLine(quizCurrent),
    buildQuizHistoryLine(reads.quizHistory),
    buildOpenThreadLine(quizCurrent, threads, exploreArchetypeCode),
    buildBagsLine(evidence, feedbackCurrent, sharedTraits),
    buildLeansLine(dominantDimensions),
    buildDislikedLine(feedbackCurrent, aliasByCoffee),
    buildHadBeforeLine(timeline, feedbackCurrent, aliasByCoffee),
    reads.counts ? buildFeedbackLine(feedbackCurrent, aliasByCoffee, reads.counts.feedbackCount) : null,
    ...buildOrdersLines(reads.orders, aliasByCoffee, reads.archetypeLabels ?? new Map(), reads.shippingStatusLine),
    buildSavedLine(reads.saved, aliasByCoffee, reads.savedSlotAlias),
    brewProfile && Object.keys(brewProfile).length
      ? `Setup: ${formatBrewProfileSummary(brewProfile as unknown as BrewProfileDoc)}`
      : null,
    buildBrewCardsLine(reads.brewCards, aliasByCoffee),
    buildSubscriptionLine(reads.subscription),
    buildShipsToLine(reads.shipsTo),
    buildLiamHistoryLine(reads.liamHistory, aliasByCoffee),
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
export async function loadProfileReads(uid: string, runner: Tx | typeof db = db, opts: { sessionId?: number | null } = {}): Promise<ProfileReads> {
  // Rev 2, Part B — the counts live in config (customerBlock.*).
  const cfg = getSommelierConfig();
  const cb = cfg?.customerBlock;
  const counts = {
    quizHistory: cb?.quizHistoryCount ?? 3, orders: cb?.ordersFullCount ?? 5,
    feedback: cb?.feedbackCount ?? 8, sessions: cb?.sessionsCount ?? 3,
  };
  const [identity, quizHistory, orders, subscription, shipsTo, saved, brewCards, liamHistory] = await Promise.all([
    getCustomerIdentity(uid, runner),
    getQuizHistory(uid, counts.quizHistory + 1, runner),
    getRecentOrders(uid, counts.orders, runner),
    getSubscriptionCurrent(uid, runner),
    getShipsTo(uid, runner),
    getSavedCoffees(uid, runner),
    getBrewCardsCurrent(uid, runner),
    getLiamHistory(uid, counts.sessions, opts.sessionId ?? null, runner),
  ]);
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
    ...orders.recent.flatMap(o => o.lines.map(l => l.coffeeId)).filter((id): id is number => id !== null),
    ...saved.map(s => s.coffeeId).filter((id): id is number => id !== null),
    ...brewCards.map(c => c.coffeeId),
    ...liamHistory.flatMap(h => h.recommendedCoffeeIds),
  ])];
  const savedSlotKeys = saved.filter(s => s.coffeeId === null && s.archetype && s.dialSortOrder !== null);
  const olderArchetypes = Object.keys(orders.olderArchetypeCounts);
  const [aliasByCoffee, exploreArchetypeCode, savedSlotAlias, archetypeLabels] = await Promise.all([
    getAliases(coffeeIds, runner),
    quizCurrent?.exploreArchetype ? archetypeCode(quizCurrent.exploreArchetype, runner) : Promise.resolve(null),
    savedSlotKeys.length
      ? getSellableSlots({}, runner).then(rows => {
          const m = new Map<string, string>();
          for (const r of rows) if (r.slot_name && !m.has(`${r.archetype}:${r.sort_order}`)) m.set(`${r.archetype}:${r.sort_order}`, r.slot_name);
          return m;
        })
      : Promise.resolve(new Map<string, string>()),
    Promise.all(olderArchetypes.map(async code => [code, await archetypeLabel(code, runner)] as const)).then(e => new Map(e)),
  ]);

  return {
    quizCurrent, brewProfile, feedbackCurrent, evidence, sharedTraits, dominantDimensions,
    archetypeSpread, threads, slotCandidates, timeline, aliasByCoffee, exploreArchetypeCode,
    identity, quizHistory, orders, subscription, shipsTo, saved, savedSlotAlias, brewCards, liamHistory, archetypeLabels,
    counts: { feedbackCount: counts.feedback },
    shippingStatusLine: shippingStatusLine(cfg),
  };
}

// ── Liam answer evals (2026-10-25), Part C1 — the session and turn context as
// pure functions, so /start, /message and the eval runner
// (sommelierEval.ts) build the prompt the same way from the same reads.
// StoryCandidate, resolveStoryForMessage, storyCandidatesFromBlock and
// isDecafOnly moved here from routes/sommelier.ts unchanged (the route
// re-exports them); sessionRagFromReads and messageTurnContext are the
// route's own lines, lifted out without changing a value.

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

// Liam sees everything brief Rev 2 (2026-10-24) — every coffee in the shared
// catalog block is a story / alias candidate now (was the 6-coffee slice):
// Liam may name any of them, so the write-back resolves against all of them.
export function storyCandidatesFromBlock(block: Pick<CatalogBlock, 'coffees'>): StoryCandidate[] {
  return block.coffees.map(c => ({ coffeeId: c.id, alias: c.alias, story: c.story }));
}

// Rev 2, A3 — the brew profile's decaf_constraint, read live (it can be
// stated mid-conversation and lands through the facts watermark).
export function isDecafOnly(brewProfile: Record<string, { value: unknown }> | null | undefined): boolean {
  const v = brewProfile?.decaf_constraint?.value;
  return v === true || v === 'true';
}

/** What /start derives from the reads for the FIT block (fetchSommelierCoffees) and context_data.ragInputs. */
export interface SessionRag {
  userArchetype: string | null;
  secondaryArchetype: string | null;
  exploreArchetype: string | null;
  previousArchetypeForRag: string | null;
  dislikedCoffeeIds: number[];
  excludeCoffeeIds: number[];
  ragFocus: string;
  decafOnly: boolean;
  ragParams: RagParams;
}

export function sessionRagFromReads(
  reads: ProfileReads, intent: string, config: SommelierConfig | null, previousArchetype: string | null
): SessionRag {
  const quizCurrent = reads.quizCurrent;
  const userArchetype = quizCurrent?.archetypeName ?? null;
  // interpretationSource-gated the same way the old pair-confidence/thread
  // prose was — a pre-v2.1 interpretation has no meaningful explore concept.
  // Interpretation v2.2 (Prompt 4B): a secondary equal to the shown archetype (branch-match) pairs nothing.
  const secondaryArchetype = distinctSecondary(userArchetype, quizCurrent?.secondaryArchetype);
  const exploreArchetype = quizCurrent?.interpretationSource === 'table' ? quizCurrent.exploreArchetype : null;
  // The blanket "never show a disliked coffee" rule (rule 1 of Dana's fixture
  // review), from the same read loadProfileReads() already did.
  const dislikedCoffeeIds = reads.feedbackCurrent.filter(f => f.sentiment === 'negative').map(f => f.coffeeId);
  // RECOMMENDATION_MISS's narrower hop exclusion, capped the same way the old
  // direct getFeedbackCurrent(uid, {sentiment:'negative'}) call was.
  const excludeCoffeeIds: number[] = intent === 'RECOMMENDATION_MISS' ? dislikedCoffeeIds.slice(0, 10) : [];
  const ragFocus = config?.intents?.[intent]?.ragFocus ?? 'curated_mix';
  const previousArchetypeForRag = intent === 'TASTE_EVOLUTION' ? previousArchetype : null;
  const decafOnly = isDecafOnly(reads.brewProfile);
  return {
    userArchetype, secondaryArchetype, exploreArchetype, previousArchetypeForRag, dislikedCoffeeIds, excludeCoffeeIds, ragFocus, decafOnly,
    ragParams: {
      ragFocus, userArchetype, previousArchetype: previousArchetypeForRag, excludeCoffeeIds,
      secondaryArchetype, exploreArchetype, slotCandidates: reads.slotCandidates, dislikedCoffeeIds, decafOnly,
    },
  };
}

/** /message's per-turn context: the brew line with the stale nudge, and the story of the coffee the message names. */
export function messageTurnContext(args: {
  message: string; topic: string | null; brewProfile: BrewProfileDoc | null; storyCandidates: StoryCandidate[]; staleNudgeSent: boolean;
}): { brewProfileContext: string; staleNudge: string | null; storyContext: string | undefined; selectedStoryCoffeeId: number | null; storySelection: string | null } {
  // Brew profile (§4.5, §3.5) plus the stale-re-confirm nudge (write rule 5):
  // at most once per session, only when relevant to this turn's topic.
  const staleNudge = getStaleFieldNudge(args.brewProfile, args.topic, args.staleNudgeSent);
  const brewProfileContext = [formatBrewProfileSummary(args.brewProfile), staleNudge].filter(Boolean).join(' ');
  // Story layer (§4.4, HOME_TASK_5/5b) — only on the two topics that ask
  // about the customer's own coffee; the coffee the customer named, else the
  // first candidate with a story; a named coffee without a story gets none.
  const isMyCoffeeTopic = args.topic === 'my_coffee' || args.topic === 'origins_process';
  let storyContext: string | undefined;
  let selectedStoryCoffeeId: number | null = null;
  let storySelection: string | null = null;
  if (isMyCoffeeTopic && args.storyCandidates.length > 0) {
    const matched = resolveStoryForMessage(args.message, args.storyCandidates);
    const fallback = matched ? null : args.storyCandidates.find(c => c.story) ?? null;
    const selected = matched ?? fallback;
    storyContext = selected?.story ?? undefined;
    selectedStoryCoffeeId = selected?.coffeeId ?? null;
    storySelection = matched ? 'named match' : fallback ? 'fallback' : 'no candidate story';
  }
  return { brewProfileContext, staleNudge, storyContext, selectedStoryCoffeeId, storySelection };
}
