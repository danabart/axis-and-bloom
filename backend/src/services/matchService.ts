// Ella's Bloom Map 3 (2026-11-12), B1 — the one door for a match decision
// (G2.6): a quiz result's first match, a button tap on /map, a dial-in email
// tap and (brief 4) Liam's accepted pick all come through decide(), which
// writes customer_match_decision and its candidates through
// customerFacts.record.matchDecision. Position and trail are derived from that
// log (v_customer_match_current / _trail); there is no current-state table.
//
// The map's reads come from dialReads (the active version, dial_hop_rows_from,
// the phrases and the customer copy); the customer's filters are applied here,
// on top, never inside a view (CTO call 5). Nothing here reads a slot or
// coffee_hop, and no label, phrase or threshold is typed in: words come from
// dial_hop_phrase and dial_customer_copy, numbers from the active version's
// parameter snapshot.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_3_MATCH_AND_CUSTOMER.md
import { db, withTransaction, type Tx } from '../db/client.js';

type Runner = Tx | typeof db;
import * as dialReads from './dialReads.js';
import { record, type MatchSource } from './customerFacts.js';
import {
  getMatchCurrent, getMatchTrail, getMatchDecisionBySource, getMatchQuizContext, getCurrentQuizSessionId,
  getBrewDecafByProfile, getMatchTrailLines, getCupboardCoffee, getCoffeeFeeling, type MatchCurrentRow,
} from './customerReads.js';
import { getParameters } from './evidenceReads.js';
import { getCardPresentations } from './coffeeCardReads.js';
import { compareCoffee } from './compatibilityReads.js';
import { archetypeLabel } from './catalogReads.js';

export class MatchError extends Error {
  constructor(public status: 400 | 403 | 404 | 409, public code: string, message: string) {
    super(message);
    this.name = 'MatchError';
  }
}

export type HopMove = 'bolder' | 'gentler' | 'different';
export type CustomerMove = 'stay' | HopMove;
export const HOP_MOVES: readonly HopMove[] = ['bolder', 'gentler', 'different'];
export const CUSTOMER_MOVES: readonly CustomerMove[] = ['stay', 'bolder', 'gentler', 'different'];

// The category tag a decaf customer opts into (R3.6). It is the category's
// code (coffee_category), compared like any other code, not customer copy.
const DECAF_TAG = 'decaf';

// Ella map 7 (2026-11-17), B2: the first bag is a row of dial_start_rule
// (v_dial_start); when no row wins, the center family's row with this
// condition code (the brief: Balanced's "always" row). A code, like DECAF_TAG.
const FALLBACK_CONDITION = 'always';

// ── The customer's context ────────────────────────────────────────────────────

export interface CustomerContext {
  quizSessionId: string | null;
  matchArchetypeCode: string | null;
  matchArchetypeName: string | null;
  secondaryArchetypeCode: string | null;
  intensityLean: string | null;
  decaf: boolean;
  /** decision 1: brew_profile first, the quiz flag second */
  decafSource: 'brew_profile' | 'quiz' | 'none';
}

export async function customerContext(profileId: string, quizSessionId?: string | null, runner: Runner = db): Promise<CustomerContext> {
  const sessionId = quizSessionId ?? await getCurrentQuizSessionId(profileId, runner);
  const q = sessionId ? await getMatchQuizContext(sessionId, runner) : null;
  const brew = await getBrewDecafByProfile(profileId, runner);
  const decaf = brew !== null ? brew : (q?.quizDecaf ?? false);
  const decafSource = brew !== null ? 'brew_profile' : q?.quizDecaf ? 'quiz' : 'none';
  return {
    quizSessionId: sessionId ?? null,
    matchArchetypeCode: q?.matchArchetypeCode ?? null, matchArchetypeName: q?.matchArchetypeName ?? null,
    secondaryArchetypeCode: q?.secondaryArchetypeCode ?? null, intensityLean: q?.intensityLean ?? null,
    decaf, decafSource,
  };
}

/** R3.6: a tagged coffee is a target only under the matching filter; a decaf customer sees decaf-tagged coffees only. */
export function passesTagFilter(categoryCodes: string[] | null | undefined, decaf: boolean): boolean {
  const tags = categoryCodes ?? [];
  return decaf ? tags.includes(DECAF_TAG) : tags.length === 0;
}

// ── First bag (Ella map 7, B2) ────────────────────────────────────────────────

interface PlacementRow {
  coffee_id: number; coffee_name: string; archetype_code: string; is_center: boolean; ring: number; lane_code: string;
  grade_rank: number; is_sellable: boolean; in_stock: boolean; category_codes: string[] | null;
}

export interface FirstMatchResult {
  coffeeId: number;
  coffeeName: string;
  /** start_rule: the session's winning dial_start_rule row; start_fallback: the center's always row */
  rule: 'start_rule' | 'start_fallback';
  ruleId: number;
  reason: string;
  familyRead: string | null;
  scores: Record<string, number> | null;
  conditions: Record<string, boolean> | null;
  candidates: Array<{ coffeeId: number; rank: number }>;
}

/**
 * The first bag for a quiz result (Ella map 7): the session's winning row in
 * v_dial_start, else the center family's always row. The coffee must be placed
 * on the active map, in stock, at or above the grade floor and pass the
 * customer's tag filter (decaf as today, OT-126); sellability is not required
 * (Dana 2026-11-17: no price until brief 8). Null when neither row qualifies.
 */
export async function firstMatchFor(ctx: CustomerContext, runner: Runner = db): Promise<FirstMatchResult | null> {
  const start = ctx.quizSessionId ? await dialReads.startForSession(ctx.quizSessionId, runner) : null;
  const fallback = await dialReads.startFallback(FALLBACK_CONDITION, runner);
  const params = await dialReads.parametersInForce('active', runner);
  const floor = Number(params.dial_min_grade_rank_first_match);
  const placements = (await dialReads.placementActive(runner)) as PlacementRow[];
  const eligible = (coffeeId: number) => {
    const p = placements.find(x => x.coffee_id === coffeeId);
    return !!p && p.in_stock && Number(p.grade_rank) >= floor && passesTagFilter(p.category_codes, ctx.decaf);
  };
  const options: Array<{ rule: FirstMatchResult['rule']; ruleId: number; coffeeId: number; coffeeName: string; reason: string }> = [];
  if (start?.rule_id) options.push({ rule: 'start_rule', ruleId: start.rule_id, coffeeId: start.coffee_id, coffeeName: start.coffee_name, reason: start.customer_reason });
  if (fallback && !options.some(o => o.ruleId === fallback.id)) {
    options.push({ rule: 'start_fallback', ruleId: fallback.id, coffeeId: fallback.coffee_id, coffeeName: fallback.coffee_name, reason: fallback.customer_reason });
  }
  const chosen = options.find(o => eligible(o.coffeeId));
  if (!chosen) return null;
  const candidates = [chosen, ...options.filter(o => o !== chosen && o.coffeeId !== chosen.coffeeId && eligible(o.coffeeId))]
    .map((o, i) => ({ coffeeId: o.coffeeId, rank: i + 1 }));
  return {
    coffeeId: chosen.coffeeId, coffeeName: chosen.coffeeName, rule: chosen.rule, ruleId: chosen.ruleId, reason: chosen.reason,
    familyRead: start?.family_read ?? null, scores: start?.scores ?? null, conditions: start?.conditions ?? null, candidates,
  };
}

// ── Moves (CTO calls 5 and 6) ─────────────────────────────────────────────────

export interface MoveCard {
  coffeeId: number;
  name: string;
  moveLine: string | null;
  notes: string[];
  compatibility: string | null;
  rank: number;
  distance: number | null;
}
export interface MoveOption {
  move: CustomerMove;
  label: string;
  edge: boolean;
  edgePhrase: string | null;
  cards: MoveCard[];
}
export interface MovesResult {
  position: null | {
    coffeeId: number; name: string; archetypeCode: string | null; isCenter: boolean; available: boolean;
    notes: string[]; compatibility: string | null; sentence: string | null;
    substitute: { coffeeId: number; name: string } | null;
  };
  moves: MoveOption[];
  copy: Record<string, string>;
  versionLabel: string | null;
}

interface HopRow {
  from_coffee_id: number; to_coffee_id: number; from_archetype: string; to_archetype: string; relation: string; rank: number;
  distance: number | null; adjacency_rank: number | null; to_in_stock: boolean; to_category_codes: string[] | null;
  from_coffee_name: string; to_coffee_name: string; deltas: Record<string, number | null>;
}

const fill = (text: string | undefined, vars: Record<string, string>) =>
  text === undefined ? null : Object.entries(vars).reduce((t, [k, v]) => t.replaceAll(`{${k}}`, v), text);

/** The candidates per move after the customer's filters (in stock, tags), with the center's quiz-secondary reorder (R3.8) and the cap. */
export function rankMoves(hops: HopRow[], opts: { decaf: boolean; isCenter: boolean; secondaryArchetypeCode: string | null; capDifferent: number }) {
  const ok = hops.filter(h => h.to_in_stock && passesTagFilter(h.to_category_codes, opts.decaf));
  const by = (rel: string) => ok.filter(h => h.relation === rel);
  const order = (a: HopRow, b: HopRow) => (Number(a.distance ?? 0) - Number(b.distance ?? 0)) || a.to_coffee_id - b.to_coffee_id;
  const adj = (h: HopRow) => (opts.isCenter && opts.secondaryArchetypeCode && h.to_archetype === opts.secondaryArchetypeCode) ? 0 : (h.adjacency_rank ?? 0);
  const rerank = (rows: HopRow[]) => rows.map((h, i) => ({ ...h, rank: i + 1 }));
  return {
    bolder: rerank(by('bolder').sort(order)).slice(0, 1),
    gentler: rerank(by('gentler').sort(order)).slice(0, 1),
    different: rerank(by('different').sort((a, b) => (adj(a) - adj(b)) || order(a, b))).slice(0, opts.capDifferent),
    sibling: rerank(by('sibling').sort(order)),
    sameFamily: [...by('bolder'), ...by('gentler')].filter(h => h.to_archetype === h.from_archetype).sort(order),
  };
}

async function presentation(coffeeIds: number[], archetypeForCompat: string | null, runner: Runner) {
  const pres = coffeeIds.length ? await getCardPresentations(coffeeIds) : new Map();
  const compat = new Map<number, string | null>();
  if (archetypeForCompat) {
    for (const id of new Set(coffeeIds)) compat.set(id, (await compareCoffee(id, { kind: 'archetype', archetype: archetypeForCompat }, runner)).sentence);
  }
  return { notes: (id: number) => pres.get(id)?.signatureNotes ?? [], compat: (id: number) => compat.get(id) ?? null };
}

/** The position and its four moves with their cards, for one profile (GET /api/map/moves). */
export async function moves(profileId: string, runner: Runner = db): Promise<MovesResult> {
  const copy = await dialReads.customerCopy(runner);
  const version = await dialReads.activeVersion(runner);
  const pos = await getMatchCurrent(profileId, runner);
  if (!pos || !version) return { position: null, moves: [], copy, versionLabel: version?.label ?? null };
  const { position, moves: options } = await computeMoves(profileId, pos, runner);
  return { position, moves: options, copy, versionLabel: version.label };
}

async function computeMoves(profileId: string, pos: MatchCurrentRow, runner: Runner) {
  const ctx = await customerContext(profileId, null, runner);
  const params = await dialReads.parametersInForce('active', runner);
  const hops = (await dialReads.hopsFromCoffee(pos.coffeeId, runner)) as unknown as HopRow[];
  const ranked = rankMoves(hops, {
    decaf: ctx.decaf, isCenter: pos.isCenter === true, secondaryArchetypeCode: ctx.secondaryArchetypeCode,
    capDifferent: Number(params.dial_cap_different),
  });
  const family = pos.archetypeCode ?? '';
  const resolved = (await dialReads.phrases(runner)).resolved.filter((r: { archetype_code: string }) => r.archetype_code === family);
  const phraseOf = (move: string) => resolved.find((r: { move_code: string }) => r.move_code === move);
  const lineCtx = await dialReads.moveLineContext(runner);
  const copy = await dialReads.customerCopy(runner);

  const available = pos.isInActiveVersion && pos.isSellable && pos.inStock;
  const sub = available ? null : (ranked.sibling[0] ?? ranked.sameFamily[0] ?? null);
  const ids = [pos.coffeeId, ...HOP_MOVES.flatMap(m => ranked[m].map(h => h.to_coffee_id)), ...(sub ? [sub.to_coffee_id] : [])];
  const pres = await presentation(ids, ctx.matchArchetypeCode ?? pos.archetypeCode, runner);

  const options: MoveOption[] = CUSTOMER_MOVES.map(move => {
    const ph = phraseOf(move);
    if (move === 'stay') return { move, label: ph?.button_label ?? '', edge: false, edgePhrase: null, cards: [] };
    const rows = ranked[move];
    return {
      move, label: ph?.button_label ?? '', edge: rows.length === 0, edgePhrase: rows.length === 0 ? (ph?.edge_phrase ?? null) : null,
      cards: rows.map(h => ({
        coffeeId: h.to_coffee_id, name: h.to_coffee_name, rank: h.rank, distance: h.distance === null ? null : Number(h.distance),
        moveLine: dialReads.composeMoveLine(lineCtx, { fromArchetype: family, relation: move, fromName: pos.coffeeName, toName: h.to_coffee_name, deltas: h.deltas })?.text ?? null,
        notes: pres.notes(h.to_coffee_id), compatibility: pres.compat(h.to_coffee_id),
      })),
    };
  });

  const sentence = available ? null : fill(copy.no_longer_available, { coffee: pos.coffeeName, substitute: sub?.to_coffee_name ?? '' });
  return {
    position: {
      coffeeId: pos.coffeeId, name: pos.coffeeName, archetypeCode: pos.archetypeCode, isCenter: pos.isCenter === true, available,
      notes: pres.notes(pos.coffeeId), compatibility: pres.compat(pos.coffeeId), sentence,
      substitute: sub ? { coffeeId: sub.to_coffee_id, name: sub.to_coffee_name } : null,
    },
    moves: options,
    ctx, ranked,
  };
}

// ── The door (CTO calls 6 and 7) ──────────────────────────────────────────────

export type DecideTrigger = 'quiz_result' | 'hop' | 'liam';
/** Ella map 7: the dial_move code of a decided step taken on /map */
export const STEP_MOVE = 'step';
export interface DecideInput {
  userId: string;
  actorUserId?: string | null;
  trigger: DecideTrigger;
  /** dial_move code: quiz_result for the quiz; stay, bolder, gentler, different for a hop; step for a decided step (Ella map 7); liam */
  move: string;
  pickedCoffeeId?: number | null;
  /** beat (decision 5): the server picks the move set's top-ranked coffee at click time */
  pickTopRanked?: boolean;
  source: MatchSource;
  sourceId: string;
  quizSessionId?: string | null;
  inputs?: Record<string, unknown>;
}
export interface DecideResult { decisionId: string; created: boolean; move: string; pickedCoffeeId: number; pickedCoffeeName: string | null }

export async function decide(input: DecideInput, runner: Runner = db): Promise<DecideResult> {
  const prior = await getMatchDecisionBySource(input.source, input.sourceId, runner);
  if (prior) return { decisionId: prior.decision_id, created: false, move: prior.move_code, pickedCoffeeId: prior.picked_coffee_id, pickedCoffeeName: prior.picked_coffee_name };

  const version = await dialReads.activeVersion(runner);
  if (!version) throw new MatchError(409, 'NO_ACTIVE_VERSION', 'The map has no active version.');
  const moveIds = await dialReads.moveIds(runner);
  const moveId = moveIds[input.move];
  if (moveId === undefined) throw new MatchError(400, 'UNKNOWN_MOVE', `unknown move ${input.move}`);

  let picked: number;
  let pickedName: string | null = null;
  let fromCoffeeId: number | null = null;
  let candidates: Array<{ coffeeId: number; moveId: number; rank: number; distance: number | null }> = [];
  let ctx: CustomerContext;
  const extra: Record<string, unknown> = {};

  if (input.trigger === 'quiz_result') {
    if (input.move !== 'quiz_result') throw new MatchError(400, 'BAD_MOVE', 'a quiz result decides with move quiz_result');
    ctx = await customerContext(input.userId, input.quizSessionId ?? null, runner);
    const fm = await firstMatchFor(ctx, runner);
    if (!fm) throw new MatchError(409, 'NO_FIRST_MATCH', 'No coffee qualifies as a first match on the active map.');
    picked = fm.coffeeId; pickedName = fm.coffeeName;
    candidates = fm.candidates.map(c => ({ coffeeId: c.coffeeId, moveId, rank: c.rank, distance: null }));
    // Ella map 7 (B2): the rule row and the facts it read
    extra.rule = fm.rule; extra.rule_id = fm.ruleId; extra.family_read = fm.familyRead;
    extra.scores = fm.scores; extra.conditions = fm.conditions;
  } else {
    const pos = await getMatchCurrent(input.userId, runner);
    if (input.trigger === 'liam') {
      // Liam's accepted pick (wired in brief 4) names its coffee and may be the first decision
      if (input.move !== 'liam' || !input.pickedCoffeeId) throw new MatchError(400, 'BAD_MOVE', "Liam's pick names the coffee with move liam");
      ctx = await customerContext(input.userId, null, runner);
      fromCoffeeId = pos?.coffeeId ?? null;
      picked = input.pickedCoffeeId;
    } else if (!pos) {
      throw new MatchError(409, 'NO_POSITION', 'There is no position yet: the first match comes from the quiz.');
    } else if (input.move === STEP_MOVE) {
      // Ella map 7 (B3): a published, shown step leaving the position (v_dial_step)
      fromCoffeeId = pos.coffeeId;
      ctx = await customerContext(input.userId, null, runner);
      const offered = await offeredSteps(pos.coffeeId, ctx.decaf, runner);
      const choice = offered.find(x => x.to_coffee_id === input.pickedCoffeeId);
      if (!choice) {
        throw new MatchError(409, offered.length ? 'NOT_A_STEP' : 'EDGE', offered.length
          ? `That coffee is not one step from ${pos.coffeeName}.`
          : `There is no step from ${pos.coffeeName}.`);
      }
      picked = choice.to_coffee_id; pickedName = choice.to_coffee_name;
      candidates = offered.map((x, i) => ({ coffeeId: x.to_coffee_id, moveId, rank: i + 1, distance: null }));
      extra.step_id = choice.id; extra.step_word = choice.button_word;
    } else if (input.move === 'stay') {
      fromCoffeeId = pos.coffeeId;
      ctx = await customerContext(input.userId, null, runner);
      picked = pos.coffeeId; pickedName = pos.coffeeName;
    } else if ((HOP_MOVES as readonly string[]).includes(input.move)) {
      fromCoffeeId = pos.coffeeId;
      const computed = await computeMoves(input.userId, pos, runner);
      ctx = computed.ctx;
      const set = computed.ranked[input.move as HopMove];
      const choice = input.pickTopRanked ? set[0] : set.find(h => h.to_coffee_id === input.pickedCoffeeId);
      if (!choice) {
        throw new MatchError(409, set.length ? 'NOT_IN_MOVE_SET' : 'EDGE', set.length
          ? `That coffee is not in the ${input.move} set from ${pos.coffeeName}.`
          : `There is no ${input.move} step from ${pos.coffeeName}.`);
      }
      picked = choice.to_coffee_id; pickedName = choice.to_coffee_name;
      candidates = set.map(h => ({ coffeeId: h.to_coffee_id, moveId, rank: h.rank, distance: h.distance === null ? null : Number(h.distance) }));
      if (input.pickTopRanked) extra.picked_by = 'top_ranked_at_click';
    } else {
      throw new MatchError(400, 'BAD_MOVE', `move ${input.move} is not a customer move`);
    }
  }

  const inputs = {
    ...input.inputs,
    ...extra,
    trigger: input.trigger,
    quiz: { session_id: ctx.quizSessionId, match_archetype: ctx.matchArchetypeCode, secondary_archetype: ctx.secondaryArchetypeCode, intensity_lean: ctx.intensityLean },
    decaf: ctx.decaf, decaf_source: ctx.decafSource,
    filters: { in_stock: true, tags: ctx.decaf ? [DECAF_TAG] : [] },
    candidate_count: candidates.length,
  };
  const write = <T>(fn: (tx: Tx) => Promise<T>) => (runner === db ? withTransaction(fn) : fn(runner as Tx));
  const written = await write(tx => record.matchDecision({
    userId: input.userId, actorUserId: input.actorUserId ?? null, versionId: version.id, moveId,
    fromCoffeeId, pickedCoffeeId: picked, source: input.source, sourceId: input.sourceId, inputs, candidates,
  }, tx));
  if (!written.inserted || !written.id) {
    const again = await getMatchDecisionBySource(input.source, input.sourceId, runner);
    if (!again) throw new Error(`match decision ${input.source}:${input.sourceId} neither inserted nor found`);
    return { decisionId: again.decision_id, created: false, move: again.move_code, pickedCoffeeId: again.picked_coffee_id, pickedCoffeeName: again.picked_coffee_name };
  }
  return { decisionId: written.id, created: true, move: input.move, pickedCoffeeId: picked, pickedCoffeeName: pickedName };
}

// ── Position and trail (CTO call 3) ───────────────────────────────────────────

/** GET /api/map/me: the position, its start or "no longer available" sentence, the first-bag reason before any bag, the trail on the active version. */
export async function me(profileId: string, runner: Runner = db) {
  const copy = await dialReads.customerCopy(runner);
  const version = await dialReads.activeVersion(runner);
  const pos = await getMatchCurrent(profileId, runner);
  const trailRows = await getMatchTrail(profileId, runner);
  const phrases = (await dialReads.phrases(runner)).resolved as Array<{ archetype_code: string; move_code: string; button_label: string }>;
  const placed = await dialReads.placementActive(runner) as PlacementRow[];
  const familyOf = new Map(placed.map(p => [p.coffee_id, p.archetype_code]));
  const stepWords = await dialReads.activeStepWords(runner);
  const lines = await getMatchTrailLines(profileId, runner);
  // Ella map 7 (B4): the word of the published step that joins two consecutive
  // choices; the start word for the quiz; a calculated hop keeps its phrase.
  const moveWord = (row: { move_code: string; from_coffee_id: number | null; picked_coffee_id: number }, prevPicked: number | null) => {
    if (row.move_code === 'quiz_result') return copy.trail_start ?? null;
    if (prevPicked !== null) {
      const w = stepWords.get(`${prevPicked}>${row.picked_coffee_id}`);
      if (w) return w;
    }
    if (row.move_code === STEP_MOVE) return null;
    const fam = row.from_coffee_id ? familyOf.get(row.from_coffee_id) : undefined;
    return phrases.find(p => p.archetype_code === fam && p.move_code === row.move_code)?.button_label
      ?? phrases.find(p => p.move_code === row.move_code)?.button_label ?? null;
  };
  const names = await dialReads.mapCoffees([...new Set([...trailRows.map(t => t.picked_coffee_id), ...(pos ? [pos.coffeeId] : [])])], runner);
  const nameOf = (id: number, fallback: string) => names.get(id)?.map_name ?? fallback;
  const trail = trailRows.map((t, i) => ({
    step: t.step, occurredAt: t.occurred_at, move: t.move_code,
    moveWord: moveWord(t, i > 0 ? trailRows[i - 1].picked_coffee_id : null),
    coffeeId: t.picked_coffee_id, name: nameOf(t.picked_coffee_id, t.picked_coffee_name), byOther: t.actor_user_id !== null,
    // the customer's own words about this coffee, when they left some (v_customer_feedback_current)
    line: lines.get(t.picked_coffee_id) ?? null,
    // drawn on the active version (R3.9): the face places the dot; no ring, lane or cell goes to the customer
    onActiveMap: t.active_archetype_code !== null,
  }));
  if (!pos) return { position: null, firstBag: null, trail, versionLabel: version?.label ?? null, copy };
  const available = pos.isInActiveVersion && pos.isSellable && pos.inStock;
  let sentence: string | null;
  if (!available) {
    const hops = (await dialReads.hopsFromCoffee(pos.coffeeId, runner)) as unknown as HopRow[];
    const ctx = await customerContext(profileId, null, runner);
    const params = await dialReads.parametersInForce('active', runner);
    const r = rankMoves(hops, { decaf: ctx.decaf, isCenter: pos.isCenter === true, secondaryArchetypeCode: ctx.secondaryArchetypeCode, capDifferent: Number(params.dial_cap_different) });
    const sub = r.sibling[0] ?? r.sameFamily[0] ?? null;
    sentence = fill(copy.no_longer_available, { coffee: pos.coffeeName, substitute: sub?.to_coffee_name ?? '' });
  } else {
    sentence = pos.isCenter ? (copy.start_at_base ?? null) : fill(copy.start_here, { coffee: pos.coffeeName });
  }
  return {
    position: {
      coffeeId: pos.coffeeId, name: nameOf(pos.coffeeId, pos.coffeeName), archetypeCode: pos.archetypeCode, isCenter: pos.isCenter === true,
      isInActiveVersion: pos.isInActiveVersion, available, sentence, move: pos.moveCode, occurredAt: pos.occurredAt,
      byOther: pos.actorUserId !== null,
    },
    firstBag: await firstBagReason(profileId, pos, runner),
    trail, versionLabel: version?.label ?? null, copy,
  };
}

/** The first bag's rule row as the composition needs it (Ella map 9: the personal line and the lead; Ella map 10: the condition families). */
interface FirstBagRule {
  coffeeId: number; ruleId: number | null; reason: string;
  coffeeLine: string | null; leadToCoffeeId: number | null; leadLine: string | null;
  /** Ella map 10 (A4): the families the rule's conditions are about, condition first */
  conditionFamilies: string[];
}
type RuleLike = {
  id?: number | null; rule_id?: number | null; coffee_id: number; customer_reason: string; coffee_line?: string | null;
  lead_to_coffee_id?: number | null; lead_line?: string | null;
  condition_family_code?: string | null; also_condition_family_code?: string | null;
};
const ruleOf = (r: RuleLike): FirstBagRule => ({
  coffeeId: r.coffee_id, ruleId: r.id ?? r.rule_id ?? null, reason: r.customer_reason,
  coffeeLine: r.coffee_line ?? null, leadToCoffeeId: r.lead_to_coffee_id ?? null, leadLine: r.lead_line ?? null,
  conditionFamilies: [r.condition_family_code, r.also_condition_family_code].filter((f): f is string => !!f),
});

/** One decision of the customer's trail (v_customer_match_trail, through getMatchTrail). */
interface TrailDecision { decision_id: string; move_code: string; picked_coffee_id: number; inputs: unknown }

/**
 * Ella map 10 (Task 0 item 2, Dana 2026-11-24): the position is a first match
 * when its coffee is the coffee of the customer's latest quiz-result decision
 * and no decision since then picked another coffee ("Same again" keeps it).
 * Returns that quiz-result decision, else null.
 */
function firstMatchDecision(trail: TrailDecision[], coffeeId: number): TrailDecision | null {
  let i = trail.length - 1;
  while (i >= 0 && trail[i].move_code !== 'quiz_result') i--;
  if (i < 0) return null;
  return trail.slice(i).every(t => t.picked_coffee_id === coffeeId) ? trail[i] : null;
}

/**
 * The rule row behind a first match: the rule row the quiz decision recorded,
 * read as its (family, priority)'s current row when that still names the same
 * coffee (so an edited sentence shows at once), else the recorded row; for a
 * decision with no rule recorded (one made before the start rules), the
 * session's live winning row when it names the coffee. Null when no rule
 * names this coffee.
 */
async function ruleForDecision(decision: TrailDecision, coffeeId: number, runner: Runner): Promise<FirstBagRule | null> {
  const inputs = (decision.inputs ?? {}) as { rule_id?: number; quiz?: { session_id?: string | null } };
  const rows = inputs.rule_id ? await dialReads.startRules({ history: true }, runner) : [];
  const recorded = rows.find(r => r.id === inputs.rule_id);
  const current = recorded ? rows.find(r => r.is_current && r.family_code === recorded.family_code && r.priority === recorded.priority) : undefined;
  const live = !recorded && inputs.quiz?.session_id ? await dialReads.startForSession(inputs.quiz.session_id, runner) : null;
  const options = [current, recorded, live?.rule_id ? live : null].filter(Boolean).map(r => ruleOf(r as RuleLike));
  return options.find(o => o.coffeeId === coffeeId) ?? null;
}

/** The one reason under the first bag (me(): the trail page keeps its shape; before any bag only). */
async function firstBagReason(profileId: string, pos: MatchCurrentRow, runner: Runner): Promise<{ coffeeId: number; reason: string } | null> {
  if (pos.moveCode !== 'quiz_result') return null;
  const trail = await getMatchTrail(profileId, runner) as TrailDecision[];
  const decision = trail.find(t => t.decision_id === pos.decisionId);
  const r = decision ? await ruleForDecision(decision, pos.coffeeId, runner) : null;
  return r ? { coffeeId: r.coffeeId, reason: r.reason } : null;
}

// ── Steps (Ella map 7, B3) ────────────────────────────────────────────────────

/** The published, shown steps leaving a coffee that pass the customer's tag filter (decaf as today), in basis order then word. */
async function offeredSteps(coffeeId: number, decaf: boolean, runner: Runner) {
  const steps = await dialReads.stepsFrom(coffeeId, runner);
  const placed = await dialReads.placementActive(runner) as PlacementRow[];
  const tags = new Map(placed.map(p => [p.coffee_id, p.category_codes]));
  return steps.filter(x => tags.has(x.to_coffee_id) && passesTagFilter(tags.get(x.to_coffee_id), decaf));
}

/**
 * Ella map 8 (B1): per coffee on the map, what /map shows and what useCart needs
 * for a direct line, from v_dial_coffee_availability (coffee, SKU and price at
 * the anchor size): the map name, the family label, the roaster's words, and a
 * price only when the coffee is buyable. Ella map 10: the coffee's map_line and
 * its families (the placement's family and the family its quiz branch comes from).
 */
async function mapFacts(coffeeIds: number[], runner: Runner) {
  const rows = await dialReads.mapCoffees(coffeeIds, runner);
  const labels = new Map<string, string>();
  for (const r of rows.values()) if (r.family_code && !labels.has(r.family_code)) labels.set(r.family_code, await archetypeLabel(r.family_code, runner));
  return {
    name: (id: number, fallback: string) => rows.get(id)?.map_name ?? fallback,
    familyLabel: (id: number) => { const f = rows.get(id)?.family_code; return f ? labels.get(f) ?? null : null; },
    /** Ella map 10: the families whose answers count as this coffee's own */
    families: (id: number) => new Set([rows.get(id)?.family_code, rows.get(id)?.family_branches_from_code].filter((f): f is string => !!f)),
    mapLine: (id: number) => rows.get(id)?.map_line ?? null,
    roasterWords: (id: number) => rows.get(id)?.roaster_words ?? [],
    price: (id: number): MapPrice | null => {
      const r = rows.get(id);
      return r && r.is_sellable && r.price_cents !== null && r.weight_oz !== null
        ? { cents: r.price_cents, sizeLabel: r.size_label ?? '', weightOz: r.weight_oz } : null;
    },
  };
}

/** A buyable coffee's anchor-size price: what the price chip shows and the cart line carries. */
export interface MapPrice { cents: number; sizeLabel: string; weightOz: number }

/** Ella map 9 (B2, admins only): the rows and facts a composed text used; Ella map 10: the reason choice that picked it. */
export interface TextBasis { ruleId?: number | null; stepId?: number; copyCodes: string[]; saidBackIds: number[]; factCodes: string[]; choice?: string | null }

export interface MapStepCard {
  stepId: number; word: string; coffeeId: number;
  /** the map's name (short name, else the coffee's name), the same name the cart line carries */
  name: string;
  /** the step's customer line, else the destination's map_line, else its notes */
  line: string | null;
  /** the roaster's own words, else the signature descriptors */
  notes: string[];
  /** null when the coffee is not buyable (the button then records the choice only) */
  price: MapPrice | null;
  /** the coffee's family label, the cart line's second line ("Balanced") */
  familyLabel: string | null;
  /** Ella map 9: the one step we would take the customer to next */
  isLead: boolean;
  /** the card's text: a sentence about the customer, then one about the coffee (Ella map 10) */
  text: string;
  basis?: TextBasis;
}
export interface MapStepsResult {
  position: null | { coffeeId: number; name: string; notes: string[]; price: MapPrice | null; familyLabel: string | null; hasBag: boolean };
  /** Ella map 10: the top card whenever the customer has a quiz: its label (a dial_customer_copy code) and its text */
  firstBag: { coffeeId: number; reason: string; text: string; labelCode: string; isFounderPick: boolean; basis?: TextBasis } | null;
  steps: MapStepCard[];
  copy: Record<string, string>;
  /** Ella map 9 (C8): set when the position is read from the start rule ("Read it as" a customer with no decision); nothing is written */
  readAs?: 'start_rule';
}

/** A sentence with its closing stop (a notes list has none). */
const sentenceOf = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

export interface StepsOptions {
  /** Ella map 9 (B2): add the rows and facts each text used (admins only) */
  withBasis?: boolean;
  /** Ella map 9 (C8): with no decision, read the session's winning start rule as the position (read only) */
  readAsRule?: boolean;
}

/** Ella map 10: one thing the page may say about the customer: a self-taken quiz answer or the setup feeling, through its approved sentence. */
interface Fact {
  key: string; code: string; saidId: number; text: string;
  /** the direction it argues for (dial_said_back.move_id); null = none */
  move: string | null;
  /** the family the answer scored for (the branch answer: the result's family); null for the feeling */
  family: string | null;
  weight: number; isFeeling: boolean;
}
interface Support { fact: Fact; choice: string; rank: number }
/**
 * Ella map 10: the reason-choice codes this service knows how to apply, per
 * kind (dial_reason_choice rows name them; any other code is skipped and
 * reported by data-catalog check 15). The order and switches are data.
 */
export const KNOWN_REASON_CHOICES: Record<string, readonly string[]> = {
  step_support: ['family_and_direction', 'family', 'direction'],
  lead_source: ['setup_answer', 'start_rule', 'strongest_support'],
};
/** Stronger support first: the earlier kind in row order, then the heavier quiz question; none last. */
const supportOrder = (a: Support | null, b: Support | null) =>
  a && b ? a.rank - b.rank || b.fact.weight - a.fact.weight : a ? -1 : b ? 1 : 0;

/**
 * GET /api/map/steps (Ella map 7, B3; Ella map 9, B2; Ella map 10, B2): the
 * position, its top card and the published steps leaving it, each with its
 * text and at most one marked as the lead. Every card is a sentence about the
 * customer (one of their own facts, through its approved said-back sentence)
 * then a sentence about the coffee; a step no fact supports opens with
 * no_support. How a card is chosen is data (dial_reason_choice): the step
 * cards try the active step-support choices in row order, the lead the active
 * lead sources in row order; a code the service does not know is skipped
 * (data-catalog check 15). Answers are taken in page order: the top card,
 * then the lead, then the other steps in shown order. A step card looks first
 * among the answers not yet used on the page, then (parameter
 * dial_step_reuse_answer, on by default) among those already used; it opens
 * with no_support only when no answer, used or not, supports it. Composed at read;
 * nothing is stored, no model writes a word, and no family, answer, move or
 * coffee id appears here: every comparison is between rows. No ring, lane,
 * grade, version or basis leaves this function (basis only with withBasis,
 * for admins).
 */
export async function steps(profileId: string, runner: Runner = db, opts: StepsOptions = {}): Promise<MapStepsResult> {
  const copy = await dialReads.customerCopy(runner);
  const pos = await getMatchCurrent(profileId, runner);
  const ctx = await customerContext(profileId, null, runner);
  const start = ctx.quizSessionId ? await dialReads.startForSession(ctx.quizSessionId, runner) : null;

  // The position, whether it is a first match, and the rule that names it.
  // With no decision, "Read it as" reads the start rule as a first match (C8).
  let positionCoffee: { id: number; name: string } | null = null;
  let rule: FirstBagRule | null = null;
  let hasBag = false;
  let firstMatch = false;
  let readAs: 'start_rule' | undefined;
  if (pos) {
    positionCoffee = { id: pos.coffeeId, name: pos.coffeeName };
    hasBag = pos.moveCode !== 'quiz_result';
    const decision = firstMatchDecision(await getMatchTrail(profileId, runner) as TrailDecision[], pos.coffeeId);
    firstMatch = decision !== null;
    rule = decision ? await ruleForDecision(decision, pos.coffeeId, runner) : null;
  } else if (opts.readAsRule && start) {
    const row = start.rule_id ? start : await dialReads.startFallback(FALLBACK_CONDITION, runner);
    if (row) {
      rule = ruleOf(row as RuleLike);
      positionCoffee = { id: rule.coffeeId, name: String((row as { coffee_name: string }).coffee_name) };
      firstMatch = true;
      readAs = 'start_rule';
    }
  }
  if (!positionCoffee) return { position: null, firstBag: null, steps: [], copy };
  const here = positionCoffee.id;

  const offered = await offeredSteps(here, ctx.decaf, runner);
  const ids = [here, ...offered.map(x => x.to_coffee_id)];
  const [pres, facts] = await Promise.all([getCardPresentations(ids), mapFacts(ids, runner)]);
  // Ella map 8 (B1, item 8b): the roaster's own words, else today's signature descriptors.
  const notes = (id: number) => { const w = facts.roasterWords(id); return w.length ? w : pres.get(id)?.signatureNotes ?? []; };
  /** what the coffee is: its map_line, else its notes */
  const coffeeSentence = (id: number) => facts.mapLine(id) ?? (notes(id).length ? notes(id).join(', ') : null);
  /** what changes in the cup: the step's line, else the destination's sentence */
  const stepLine = (x: { to_coffee_id: number; customer_line: string | null }) => x.customer_line ?? coffeeSentence(x.to_coffee_id);

  // The customer's facts, each said only through a current quoted said-back row.
  const said = await dialReads.saidBack(runner);
  const params = Object.fromEntries((await getParameters('dial_', runner)).map(p => [p.key, Number(p.value)]));
  const answers = ctx.quizSessionId ? await dialReads.quizAnswers(ctx.quizSessionId, runner) : [];
  // G2.19: a quiz taken by someone else is never used; the treat question (weight 0) and a fact with no quoted row never are
  const quizFacts: Fact[] = answers
    .filter(a => a.is_self_taken && a.weight > 0 && said.has(`quiz_answer:${a.answer_code}`))
    .map(a => {
      const s = said.get(`quiz_answer:${a.answer_code}`)!;
      return { key: `quiz_answer:${a.answer_code}`, code: a.answer_code, saidId: s.id, text: s.says_back, move: s.move_code, family: a.family_code, weight: a.weight, isFeeling: false };
    });
  const cupboard = await getCupboardCoffee({ profileId }, runner);
  const kitchen = cupboard ? said.get(`cupboard_coffee:${cupboard.code}`) ?? null : null;
  const feelingRow = await getCoffeeFeeling({ profileId }, runner);
  const feelingSaid = feelingRow ? said.get(`coffee_feeling:${feelingRow.code}`) ?? null : null;
  const feeling: Fact | null = feelingRow && feelingSaid
    ? { key: `coffee_feeling:${feelingRow.code}`, code: feelingRow.code, saidId: feelingSaid.id, text: feelingSaid.says_back, move: feelingSaid.move_code, family: null, weight: 0, isFeeling: true }
    : null;
  const allFacts = feeling ? [...quizFacts, feeling] : quizFacts;
  // C1: the family as read and the family the quiz branched from count as the customer's own
  const ownFamilies = new Set([start?.family_read, start?.branched_from_code].filter((f): f is string => !!f));

  // How a card is chosen (dial_reason_choice): the active rows of each kind, in row order.
  const choices = await dialReads.reasonChoices({}, runner);
  const activeCodes = (kind: string) => choices.filter(c => c.kind_code === kind && c.is_active).map(c => c.code);
  const supportKinds = activeCodes('step_support');
  const leadSources = activeCodes('lead_source');

  const used = new Set<string>();
  const free = (pool: Fact[]) => pool.filter(f => !used.has(f.key));
  /**
   * A step's support: the first active step-support choice, in row order, that
   * finds an unused fact. Family choices use quiz answers only (the feeling has
   * no family); within the family choice an answer that argues for no
   * direction is preferred. An unknown code is skipped.
   */
  const supportFor = (x: { to_coffee_id: number; move_code: string | null }, pool: Fact[], includeUsed = false): Support | null => {
    const fams = facts.families(x.to_coffee_id);
    const open = includeUsed ? pool : free(pool);
    const ofFamily = open.filter(f => !f.isFeeling && f.family !== null && fams.has(f.family));
    for (const [rank, choice] of supportKinds.entries()) {
      let f: Fact | undefined;
      if (choice === 'family_and_direction') f = x.move_code ? ofFamily.find(a => a.move === x.move_code) : undefined;
      else if (choice === 'family') f = ofFamily.find(a => a.move === null) ?? ofFamily[0];
      else if (choice === 'direction') f = x.move_code ? open.find(a => a.move === x.move_code) : undefined;
      else continue;
      if (f) return { fact: f, choice, rank };
    }
    return null;
  };

  type Part = { code?: string; text: string | null; said?: Array<{ id: number; fact_code: string }> };
  const factPart = (f: Fact): Part => ({ text: f.text, said: [{ id: f.saidId, fact_code: f.code }] });
  const compose = (parts: Array<Part | null>, base: Partial<TextBasis> = {}) => {
    const kept = parts.filter((p): p is Part & { text: string } => !!p && !!p.text);
    const basis: TextBasis = {
      ...base, copyCodes: kept.flatMap(p => (p.code ? [p.code] : [])),
      saidBackIds: kept.flatMap(p => (p.said ?? []).map(s => s.id)), factCodes: kept.flatMap(p => (p.said ?? []).map(s => s.fact_code)),
    };
    return { text: kept.map(p => sentenceOf(p.text)).join(' '), basis };
  };
  /** Take up to n unused quiz answers that pass, in answer order (branch first, heavier question, question number). */
  const take = (pass: (f: Fact) => boolean, n: number) => {
    const out: Fact[] = [];
    for (const f of quizFacts) {
      if (out.length >= n) break;
      if (!used.has(f.key) && pass(f)) { out.push(f); used.add(f.key); }
    }
    return out;
  };

  // The top card, whenever there is a quiz. First match: "Founder's pick", up to
  // dial_quote_family_answers answers for the customer's family, then the answer
  // for the family the rule's condition is about, then the rule's coffee_line
  // (else the coffee's sentence); with no usable answer and a rule that names the
  // coffee, the rule's customer_reason (Dana 2026-11-24). After a step: "You are
  // here", answers for this coffee's families, then its sentence. The kitchen
  // sentence opens it. No quiz: no top card, the notes as before.
  let firstBag: MapStepsResult['firstBag'] = null;
  if (ctx.quizSessionId) {
    const n = params.dial_quote_family_answers ?? 0;
    const parts: Part[] = [];
    if (kitchen) parts.push({ code: 'kitchen', text: fill(copy.kitchen, { brand: kitchen.says_back }), said: [kitchen] });
    let labelCode: string;
    if (firstMatch) {
      labelCode = 'founder_pick';
      const fam = take(f => f.family !== null && ownFamilies.has(f.family), n);
      const cond = rule && rule.conditionFamilies.length ? take(f => f.family !== null && rule!.conditionFamilies.includes(f.family), 1) : [];
      const told = [...fam, ...cond];
      if (!told.length && rule) parts.push({ text: rule.reason });
      else parts.push(...told.map(factPart), { text: rule?.coffeeLine ?? coffeeSentence(here) });
    } else {
      labelCode = 'here_title';
      const fams = facts.families(here);
      parts.push(...take(f => f.family !== null && fams.has(f.family), n).map(factPart), { text: coffeeSentence(here) });
    }
    const c = compose(parts, { ruleId: rule?.ruleId ?? null, choice: labelCode });
    firstBag = {
      coffeeId: here, reason: rule?.reason ?? '', text: c.text, labelCode, isFounderPick: labelCode === 'founder_pick',
      ...(opts.withBasis ? { basis: c.basis } : {}),
    };
  }

  // The lead: the first active lead source, in row order, that yields one.
  //  setup_answer: the feeling names a direction and a step goes that way; among
  //    several, the strongest quiz support (step-card order) wins, then the rule's
  //    lead, then step order (Dana 2026-11-24); the feeling's sentence, then the step's line.
  //  start_rule: on a first match, the rule's lead with the rule's lead sentence.
  //  strongest_support: the step with the strongest support; its fact, then the step's line.
  type Offered = (typeof offered)[number];
  let lead: { step: Offered; parts: Part[]; choice: string; ruleId?: number | null } | null = null;
  for (const source of leadSources) {
    if (source === 'setup_answer') {
      if (!feeling || feeling.move === null) continue;
      const ranked = offered.map((x, i) => ({ x, i, s: supportFor(x, quizFacts) })).filter(r => r.x.move_code === feeling.move);
      if (!ranked.length) continue;
      const ruleLead = (r: { x: Offered }) => Number(rule !== null && r.x.to_coffee_id === rule.leadToCoffeeId);
      ranked.sort((a, b) => supportOrder(a.s, b.s) || ruleLead(b) - ruleLead(a) || a.i - b.i);
      used.add(feeling.key);
      lead = { step: ranked[0].x, parts: [factPart(feeling), { text: stepLine(ranked[0].x) }], choice: source };
    } else if (source === 'start_rule') {
      if (!firstMatch || !rule || rule.leadToCoffeeId === null) continue;
      const x = offered.find(s => s.to_coffee_id === rule!.leadToCoffeeId);
      if (!x) continue;
      lead = { step: x, parts: [{ text: rule.leadLine ?? stepLine(x) }], choice: source, ruleId: rule.ruleId };
    } else if (source === 'strongest_support') {
      const ranked = offered.map((x, i) => ({ x, i, s: supportFor(x, allFacts) })).filter(r => r.s !== null);
      if (!ranked.length) continue;
      ranked.sort((a, b) => supportOrder(a.s, b.s) || a.i - b.i);
      const best = ranked[0];
      used.add(best.s!.fact.key);
      lead = { step: best.x, parts: [factPart(best.s!.fact), { text: stepLine(best.x) }], choice: source };
    } else continue;
    break;
  }

  // The other steps, in shown order: the first support that finds an unused fact; else, when
  // dial_step_reuse_answer is on, the first that finds any fact (a second pass over the used
  // ones); else no_support. Then the step's line.
  const mayReuse = (params.dial_step_reuse_answer ?? 0) === 1;
  const texts = new Map<number, { text: string; basis: TextBasis }>();
  if (lead) texts.set(lead.step.id, compose(lead.parts, { stepId: lead.step.id, choice: lead.choice, ...(lead.ruleId !== undefined ? { ruleId: lead.ruleId } : {}) }));
  for (const x of offered) {
    if (texts.has(x.id)) continue;
    const s = supportFor(x, allFacts) ?? (mayReuse ? supportFor(x, allFacts, true) : null);
    if (s) used.add(s.fact.key);
    texts.set(x.id, compose([
      s ? factPart(s.fact) : { code: 'no_support', text: copy.no_support ?? null },
      { text: stepLine(x) },
    ], { stepId: x.id, choice: s?.choice ?? null }));
  }

  const cards: MapStepCard[] = offered.map(x => {
    const c = texts.get(x.id)!;
    return {
      stepId: x.id, word: x.button_word, coffeeId: x.to_coffee_id, name: facts.name(x.to_coffee_id, x.to_coffee_name),
      line: stepLine(x), notes: notes(x.to_coffee_id), price: facts.price(x.to_coffee_id), familyLabel: facts.familyLabel(x.to_coffee_id),
      isLead: lead?.step.id === x.id, text: c.text, ...(opts.withBasis ? { basis: c.basis } : {}),
    };
  });
  cards.sort((a, b) => Number(b.isLead) - Number(a.isLead));

  return {
    position: {
      coffeeId: here, name: facts.name(here, positionCoffee.name), notes: notes(here),
      price: facts.price(here), familyLabel: facts.familyLabel(here), hasBag,
    },
    firstBag,
    steps: cards,
    copy,
    ...(readAs ? { readAs } : {}),
  };
}

// ── Access ────────────────────────────────────────────────────────────────────

/**
 * Who may read and write the map today: an admin always; a customer only when
 * one of the given surfaces renders the map (dial_surface). Returns the
 * caller's profile id. /map is admin-only until brief 4 flips customer_face.
 */
export async function mapAccess(uid: string, surfaceCodes: string[]): Promise<{ profileId: string | null; isAdmin: boolean; open: boolean }> {
  const r = await db.query<{ id: string; is_admin: boolean }>(
    `SELECT up.id, COALESCE(ut.name = 'admin', false) AS is_admin
       FROM user_profile up LEFT JOIN user_type ut ON ut.id = up.user_type_id WHERE up.firebase_uid = $1`, [uid]);
  const row = r.rows[0];
  if (!row) return { profileId: null, isAdmin: false, open: false };
  if (row.is_admin) return { profileId: row.id, isAdmin: true, open: true };
  for (const code of surfaceCodes) if (await dialReads.surfaceIsMap(code)) return { profileId: row.id, isAdmin: false, open: true };
  return { profileId: row.id, isAdmin: false, open: false };
}

/** The face for the customer API: wedges and the sellable, in-stock placements (no grade, no roaster, no seams: the customer face names none). */
export async function face(runner: Runner = db) {
  const raw = await dialReads.customerFace(runner);
  const names = await dialReads.mapCoffees(undefined, runner);
  // Ella map 8 (C2): the labels read the map's name (short name, else the coffee's name).
  const placements = raw.map((p: { coffee_id: number; coffee_name: string }) => ({ ...p, coffee_name: names.get(p.coffee_id)?.map_name ?? p.coffee_name }));
  const w = await dialReads.wedges(runner);
  const version = await dialReads.activeVersion(runner);
  return {
    versionLabel: version?.label ?? null,
    placements,
    wedges: w.wedges.map((x: Record<string, unknown>) => ({ archetype_code: x.archetype_code, archetype_name: x.archetype_name, is_center: x.is_center, angle_order: x.angle_order, side_a_archetype: x.side_a_archetype, side_b_archetype: x.side_b_archetype })),
    seams: [],
  };
}

/** code -> model code for every surface (GET /api/map/surfaces). */
export async function surfaceModels(runner: Runner = db): Promise<Record<string, string>> {
  return Object.fromEntries((await dialReads.surfaces(runner)).map((r: { code: string; model_code: string }) => [r.code, r.model_code]));
}
