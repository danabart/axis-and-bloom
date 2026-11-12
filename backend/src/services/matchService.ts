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
  getBrewDecafByProfile, type MatchCurrentRow,
} from './customerReads.js';
import { getCardPresentations } from './coffeeCardReads.js';
import { compareCoffee } from './compatibilityReads.js';

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

// CTO call 4 (Dana 2026-11-12, decision 2): the cell a quiz result asks for.
// A delicate lean starts on the Fruity wedge's side toward Floral; otherwise
// the center and Fruity start on their side_a (the chocolate side), every
// other family in its middle lane. The family codes are the rule's own words.
const DELICATE_FAMILY = 'fruity';
const DELICATE_TOWARD = 'floral';
const SIDE_A_FAMILIES = new Set(['fruity']);

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

// ── First match (CTO call 4) ──────────────────────────────────────────────────

interface Wedge { archetype_code: string; is_center: boolean; side_a_archetype: string; side_b_archetype: string }
interface PlacementRow {
  coffee_id: number; coffee_name: string; archetype_code: string; is_center: boolean; ring: number; lane_code: string;
  grade_rank: number; is_sellable: boolean; in_stock: boolean; category_codes: string[] | null;
}

export interface FirstMatchResult {
  coffeeId: number;
  coffeeName: string;
  rule: 'founder_pick' | 'derived' | 'center_founder_pick' | 'center_derived';
  askedCell: { archetype: string; lane: string };
  candidates: Array<{ coffeeId: number; rank: number }>;
}

/** The cell a quiz result asks for (archetype, lane). */
export function firstMatchCell(ctx: Pick<CustomerContext, 'matchArchetypeCode' | 'intensityLean'>, wedges: Wedge[]): { archetype: string; lane: string } | null {
  const center = wedges.find(w => w.is_center);
  if (ctx.intensityLean === 'delicate') {
    const w = wedges.find(x => x.archetype_code === DELICATE_FAMILY);
    if (w) return { archetype: w.archetype_code, lane: w.side_a_archetype === DELICATE_TOWARD ? 'side_a' : w.side_b_archetype === DELICATE_TOWARD ? 'side_b' : 'middle' };
  }
  const w = wedges.find(x => x.archetype_code === ctx.matchArchetypeCode) ?? center;
  if (!w) return null;
  return { archetype: w.archetype_code, lane: w.is_center || SIDE_A_FAMILIES.has(w.archetype_code) ? 'side_a' : 'middle' };
}

/**
 * CTO call 4 with Dana's decisions 2 and 3: the dial_first_match row for the
 * cell when that coffee is placed, sellable, in stock, at or above the grade
 * floor and passes the customer's tag filter; else the derivable fallback
 * (that family's placed, sellable, in-stock coffees at the floor: lowest ring,
 * most hops, the asked lane first, lowest coffee id); else the center's first
 * match by the same two steps. Null when nothing qualifies.
 */
export async function firstMatchFor(ctx: CustomerContext, runner: Runner = db): Promise<FirstMatchResult | null> {
  const { wedges } = await dialReads.wedges(runner) as { wedges: Wedge[] };
  const cell = firstMatchCell(ctx, wedges);
  if (!cell) return null;
  const params = await dialReads.parametersInForce('active', runner);
  const floor = Number(params.dial_min_grade_rank_first_match);
  const placements = (await dialReads.placementActive(runner)) as PlacementRow[];
  const hops = await dialReads.hopCounts(runner);
  const eligible = (p: PlacementRow) => p.is_sellable && p.in_stock && Number(p.grade_rank) >= floor && passesTagFilter(p.category_codes, ctx.decaf);

  const pick = async (c: { archetype: string; lane: string }, founderRule: FirstMatchResult['rule'], derivedRule: FirstMatchResult['rule']) => {
    const ranked = placements.filter(p => p.archetype_code === c.archetype && eligible(p))
      .sort((a, b) => Number(a.ring) - Number(b.ring)
        || (hops.get(b.coffee_id) ?? 0) - (hops.get(a.coffee_id) ?? 0)
        || Number(b.lane_code === c.lane) - Number(a.lane_code === c.lane)
        || a.coffee_id - b.coffee_id);
    const candidates = ranked.map((p, i) => ({ coffeeId: p.coffee_id, rank: i + 1 }));
    const founderId = await dialReads.firstMatchFor(c.archetype, c.lane, runner);
    const founder = founderId === null ? undefined : placements.find(p => p.coffee_id === founderId && eligible(p));
    if (founder) {
      return { coffeeId: founder.coffee_id, coffeeName: founder.coffee_name, rule: founderRule, askedCell: cell, candidates: [{ coffeeId: founder.coffee_id, rank: 1 }, ...candidates.filter(x => x.coffeeId !== founder.coffee_id).map(x => ({ ...x, rank: x.rank + 1 }))] };
    }
    if (ranked[0]) return { coffeeId: ranked[0].coffee_id, coffeeName: ranked[0].coffee_name, rule: derivedRule, askedCell: cell, candidates };
    return null;
  };

  const own = await pick(cell, 'founder_pick', 'derived');
  if (own) return own;
  const center = wedges.find(w => w.is_center);
  if (!center || center.archetype_code === cell.archetype) return null;
  const centerCell = firstMatchCell({ matchArchetypeCode: center.archetype_code, intensityLean: null }, wedges)!;
  return pick(centerCell, 'center_founder_pick', 'center_derived');
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
export interface DecideInput {
  userId: string;
  actorUserId?: string | null;
  trigger: DecideTrigger;
  /** dial_move code: quiz_result for the quiz; stay, bolder, gentler, different for a hop; liam */
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
    extra.rule = fm.rule; extra.asked_cell = fm.askedCell;
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

/** GET /api/map/me: the position, its start or "no longer available" sentence, the trail on the active version. */
export async function me(profileId: string, runner: Runner = db) {
  const copy = await dialReads.customerCopy(runner);
  const version = await dialReads.activeVersion(runner);
  const pos = await getMatchCurrent(profileId, runner);
  const trailRows = await getMatchTrail(profileId, runner);
  const phrases = (await dialReads.phrases(runner)).resolved as Array<{ archetype_code: string; move_code: string; button_label: string }>;
  let familyOf = new Map<number, string>();
  const placed = await dialReads.placementActive(runner) as PlacementRow[];
  familyOf = new Map(placed.map(p => [p.coffee_id, p.archetype_code]));
  const moveWord = (row: { move_code: string; from_coffee_id: number | null }) => {
    if (row.move_code === 'quiz_result') return copy.trail_start ?? null;
    const fam = row.from_coffee_id ? familyOf.get(row.from_coffee_id) : undefined;
    return phrases.find(p => p.archetype_code === fam && p.move_code === row.move_code)?.button_label
      ?? phrases.find(p => p.move_code === row.move_code)?.button_label ?? null;
  };
  const trail = trailRows.map(t => ({
    step: t.step, occurredAt: t.occurred_at, move: t.move_code, moveWord: moveWord(t),
    coffeeId: t.picked_coffee_id, name: t.picked_coffee_name, byOther: t.actor_user_id !== null,
    // drawn on the active version (R3.9): the face places the dot; no ring, lane or cell goes to the customer
    onActiveMap: t.active_archetype_code !== null,
  }));
  if (!pos) return { position: null, trail, versionLabel: version?.label ?? null, copy };
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
      coffeeId: pos.coffeeId, name: pos.coffeeName, archetypeCode: pos.archetypeCode, isCenter: pos.isCenter === true,
      isInActiveVersion: pos.isInActiveVersion, available, sentence, move: pos.moveCode, occurredAt: pos.occurredAt,
      byOther: pos.actorUserId !== null,
    },
    trail, versionLabel: version?.label ?? null, copy,
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
  const placements = await dialReads.customerFace(runner);
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
