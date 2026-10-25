// Liam brand answers, prices and a quiet session cutoff (Rev 3, 2026-10-24),
// Part A3 — the only file that SELECTs sommelier_answer (lint:customer rule 8).
// backend/src/features/ai_agent_liam/brand_prices_cart_cutoff/CLAUDE_CODE_PROMPT_LIAM_BRAND_PRICES_CART_CUTOFF.md
//
// The current rows are cached in memory: refreshed when getAnswersVersion()
// changes, checked at most once per brandFacts.cacheSeconds (config), and
// cleared by the write door (sommelierAnswerService) in this process. Another
// Cloud Run instance sees an edit within cacheSeconds through the version.
// Brief 2 adds the ledger readers to this file.
import { db } from '../db/client.js';
import type { Tx } from '../db/client.js';
import { getSommelierConfig } from './sommelierConfig.js';

type Runner = Tx | typeof db;

export interface SommelierAnswerRow {
  id: number;
  key: string;
  kind: string;      // lookup_value.value in sommelier_answer_kind
  delivery: string;  // lookup_value.value in sommelier_answer_delivery
  answer_text: string;
  sort_order: number;
  since: Date;
  superseded_at: Date | null;
  note: string | null;
  created_by: string;
}

const SELECT_ANSWER = `
  SELECT a.id, a.key, k.value AS kind, d.value AS delivery, a.answer_text, a.sort_order,
         a.since, a.superseded_at, a.note, a.created_by
    FROM sommelier_answer a
    JOIN lookup_value k ON k.id = a.kind_id
    JOIN lookup_value d ON d.id = a.delivery_id`;

let cache: { version: string; rows: SommelierAnswerRow[]; checkedAt: number } | null = null;

/** Drops the in-memory copy; the write door calls it after a commit. */
export function clearAnswersCache(): void { cache = null; }

/**
 * Changes whenever a row is written or retired. The brief names MAX(id); a
 * retire inserts no row, so the latest superseded_at is part of it too.
 */
export async function getAnswersVersion(runner: Runner = db): Promise<string> {
  const r = await runner.query<{ max_id: number | null; max_closed: Date | null }>(
    `SELECT MAX(id) AS max_id, MAX(superseded_at) AS max_closed FROM sommelier_answer`
  );
  const row = r.rows[0];
  return `${row?.max_id ?? 0}:${row?.max_closed ? new Date(row.max_closed).toISOString() : ''}`;
}

async function loadCurrent(runner: Runner): Promise<SommelierAnswerRow[]> {
  const r = await runner.query<SommelierAnswerRow>(
    `${SELECT_ANSWER} WHERE a.superseded_at IS NULL ORDER BY a.sort_order, a.key`
  );
  return r.rows;
}

/** Current rows (superseded_at IS NULL), ORDER BY sort_order, key. Cached; a `runner` (a test's transaction) bypasses the cache. */
export async function getCurrentAnswers(runner?: Runner): Promise<SommelierAnswerRow[]> {
  if (runner) return loadCurrent(runner);
  const ttlMs = (getSommelierConfig()?.brandFacts?.cacheSeconds ?? 60) * 1000;
  const now = Date.now();
  if (cache && now - cache.checkedAt < ttlMs) return cache.rows;
  const version = await getAnswersVersion();
  if (cache && cache.version === version) {
    cache.checkedAt = now;
    return cache.rows;
  }
  const rows = await loadCurrent(db);
  cache = { version, rows, checkedAt: now };
  return rows;
}

/** The current row for one key, or null when the key has no current row. */
export async function getAnswer(key: string, runner?: Runner): Promise<SommelierAnswerRow | null> {
  const rows = await getCurrentAnswers(runner);
  return rows.find(r => r.key === key) ?? null;
}

/** Every row, newest first per key (admin card history). Not cached. */
export async function getAnswerHistory(runner: Runner = db): Promise<SommelierAnswerRow[]> {
  const r = await runner.query<SommelierAnswerRow>(`${SELECT_ANSWER} ORDER BY a.key, a.since DESC, a.id DESC`);
  return r.rows;
}

/** True when the table has any row at all, current or not (the seed's guard). */
export async function hasAnyAnswer(runner: Runner = db): Promise<boolean> {
  const r = await runner.query(`SELECT 1 FROM sommelier_answer LIMIT 1`);
  return r.rows.length > 0;
}

/** MAX(sommelier_answer.id): the answers version a turn's prefix rendered (sommelier_turn.answers_version). */
export async function getAnswersMaxId(runner: Runner = db): Promise<number | null> {
  const r = await runner.query<{ max_id: number | null }>(`SELECT MAX(id) AS max_id FROM sommelier_answer`);
  return r.rows[0]?.max_id ?? null;
}

// ── Liam sees everything brief Rev 2, Part C3 (2026-10-24) — the turn ledger.
// The only file that SELECTs sommelier_turn (lint:customer rule 9).

export interface TurnRow {
  id: number;
  session_id: number;
  turn: number;
  user_message_id: string | null;
  assistant_message_id: string;
  route: string;
  model: string | null;
  answers_version: number | null;
  mode: string | null;
  input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  usd_micros: string; // BIGINT
  latency_ms: number | null;
  created_at: Date;
}

/** Every ledger row of one session, by turn (the reconciliation check, the smoke). */
export async function getTurnsForSession(sessionId: number, runner: Runner = db): Promise<TurnRow[]> {
  const r = await runner.query<TurnRow>(
    `SELECT id, session_id, turn, user_message_id, assistant_message_id, route, model, answers_version, mode,
            input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, usd_micros, latency_ms, created_at
       FROM sommelier_turn WHERE session_id = $1 ORDER BY turn`,
    [sessionId]
  );
  return r.rows;
}

export interface TurnStats {
  turns: number;
  usdMicros: number;
  medianUsdMicros: number | null;
  cacheHitRate: number | null; // cache_read / (cache_read + input)
  byRoute: Record<string, number>;
}

/** The System Health "Liam context" numbers over the last `sinceHours`. */
export async function getTurnStats({ sinceHours }: { sinceHours: number }, runner: Runner = db): Promise<TurnStats> {
  const r = await runner.query<{ turns: string; usd: string | null; median: string | null; cache_read: string | null; input: string | null }>(
    `SELECT COUNT(*) AS turns, SUM(usd_micros) AS usd,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY usd_micros) FILTER (WHERE route = 'model') AS median,
            SUM(cache_read_tokens) AS cache_read, SUM(input_tokens) AS input
       FROM sommelier_turn WHERE created_at >= now() - make_interval(hours => $1)`,
    [sinceHours]
  );
  const routes = await runner.query<{ route: string; n: string }>(
    `SELECT route, COUNT(*) AS n FROM sommelier_turn WHERE created_at >= now() - make_interval(hours => $1) GROUP BY route`,
    [sinceHours]
  );
  const row = r.rows[0];
  const cacheRead = Number(row?.cache_read ?? 0);
  const input = Number(row?.input ?? 0);
  return {
    turns: Number(row?.turns ?? 0),
    usdMicros: Number(row?.usd ?? 0),
    medianUsdMicros: row?.median === null || row?.median === undefined ? null : Math.round(Number(row.median)),
    cacheHitRate: cacheRead + input > 0 ? cacheRead / (cacheRead + input) : null,
    byRoute: Object.fromEntries(routes.rows.map(x => [x.route, Number(x.n)])),
  };
}

// ── Liam answer layer (2026-10-25) — the gate's rules, examples, labels and
// replays. This file is the only one that SELECTs sommelier_gate_rule,
// sommelier_gate_rule_example, sommelier_turn_label and
// sommelier_gate_rule_replay (lint:customer rule 10).
// backend/src/features/ai_agent_liam/answer_layer/CLAUDE_CODE_PROMPT_LIAM_ANSWER_LAYER.md

export interface GateRuleRow {
  id: number;
  key: string;
  priority: number;
  resolver: string; // lookup_value.value in sommelier_gate_resolver
  answer_key: string | null;
  topic_key: string | null;
  keywords: string[];
  max_message_chars: number | null;
  since: Date;
  superseded_at: Date | null;
  note: string | null;
  created_by: string;
}

export interface GateExampleRow {
  id: number;
  rule_id: number;
  rule_key: string;
  message: string;
  expectation: string; // lookup_value.value in sommelier_gate_expectation: must_match | must_not_match
  expected_label: string | null;
  since: Date;
  superseded_at: Date | null;
  note: string | null;
}

const SELECT_RULE = `
  SELECT r.id, r.key, r.priority, rv.value AS resolver, r.answer_key, r.topic_key, r.keywords,
         r.max_message_chars, r.since, r.superseded_at, r.note, r.created_by
    FROM sommelier_gate_rule r
    JOIN lookup_value rv ON rv.id = r.resolver_id`;

let rulesCache: { version: string; rows: GateRuleRow[]; checkedAt: number } | null = null;

/** Drops the in-memory copy; the write door calls it after a commit. */
export function clearGateRulesCache(): void { rulesCache = null; }

/** Changes whenever a rule or an example is written or superseded. */
export async function getGateRulesVersion(runner: Runner = db): Promise<string> {
  const r = await runner.query<{ rule_id: number | null; rule_closed: Date | null; ex_id: number | null; ex_closed: Date | null }>(
    `SELECT (SELECT MAX(id) FROM sommelier_gate_rule) AS rule_id,
            (SELECT MAX(superseded_at) FROM sommelier_gate_rule) AS rule_closed,
            (SELECT MAX(id) FROM sommelier_gate_rule_example) AS ex_id,
            (SELECT MAX(superseded_at) FROM sommelier_gate_rule_example) AS ex_closed`
  );
  const row = r.rows[0];
  const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : '');
  return `${row?.rule_id ?? 0}:${iso(row?.rule_closed)}:${row?.ex_id ?? 0}:${iso(row?.ex_closed)}`;
}

async function loadActiveRules(runner: Runner): Promise<GateRuleRow[]> {
  const r = await runner.query<GateRuleRow>(`${SELECT_RULE} WHERE r.superseded_at IS NULL ORDER BY r.priority, r.key`);
  return r.rows;
}

/** Active rules (superseded_at IS NULL), ORDER BY priority, key. Cached like the answers; a `runner` bypasses the cache. */
export async function getActiveRules(runner?: Runner): Promise<GateRuleRow[]> {
  if (runner) return loadActiveRules(runner);
  const ttlMs = (getSommelierConfig()?.brandFacts?.cacheSeconds ?? 60) * 1000;
  const now = Date.now();
  if (rulesCache && now - rulesCache.checkedAt < ttlMs) return rulesCache.rows;
  const version = await getGateRulesVersion();
  if (rulesCache && rulesCache.version === version) {
    rulesCache.checkedAt = now;
    return rulesCache.rows;
  }
  const rows = await loadActiveRules(db);
  rulesCache = { version, rows, checkedAt: now };
  return rows;
}

/** True when the rule table has any row at all, current or not (the seed's guard). */
export async function hasAnyGateRule(runner: Runner = db): Promise<boolean> {
  const r = await runner.query(`SELECT 1 FROM sommelier_gate_rule LIMIT 1`);
  return r.rows.length > 0;
}

/** Current examples of current rule rows (of one rule row when ruleId is given), by rule priority then id. */
export async function getExamples(ruleId: number | null = null, runner: Runner = db): Promise<GateExampleRow[]> {
  const r = await runner.query<GateExampleRow>(
    `SELECT e.id, e.rule_id, r.key AS rule_key, e.message, ev.value AS expectation, e.expected_label,
            e.since, e.superseded_at, e.note
       FROM sommelier_gate_rule_example e
       JOIN sommelier_gate_rule r ON r.id = e.rule_id
       JOIN lookup_value ev ON ev.id = e.expectation_id
      WHERE e.superseded_at IS NULL AND r.superseded_at IS NULL AND ($1::int IS NULL OR e.rule_id = $1)
      ORDER BY r.priority, r.key, e.id`,
    [ruleId]
  );
  return r.rows;
}

/** The ledger's model turns in [from, to) with no label from `labelerModel` (the nightly labeller's work list). */
export async function getUnlabelledModelTurns(
  args: { from: Date; to: Date; labelerModel: string }, runner: Runner = db
): Promise<Array<{ id: number; session_id: number; turn: number; user_message_id: string; uid: string }>> {
  const r = await runner.query<{ id: number; session_id: number; turn: number; user_message_id: string; uid: string }>(
    `SELECT t.id, t.session_id, t.turn, t.user_message_id, s.uid
       FROM sommelier_turn t
       JOIN sommelier_sessions s ON s.id = t.session_id
      WHERE t.route = 'model' AND t.user_message_id IS NOT NULL
        AND t.created_at >= $1 AND t.created_at < $2
        AND NOT EXISTS (SELECT 1 FROM sommelier_turn_label l WHERE l.turn_id = t.id AND l.labeler_model = $3)
      ORDER BY t.id`,
    [args.from, args.to, args.labelerModel]
  );
  return r.rows;
}

/** Example ids already replayed by `labelerModel` since `since` (a second nightly run writes nothing new). */
export async function getReplayedExampleIds(args: { since: Date; labelerModel: string }, runner: Runner = db): Promise<Set<number>> {
  const r = await runner.query<{ example_id: number }>(
    `SELECT DISTINCT example_id FROM sommelier_gate_rule_replay WHERE replayed_at >= $1 AND labeler_model = $2`,
    [args.since, args.labelerModel]
  );
  return new Set(r.rows.map(x => x.example_id));
}

export interface GateRuleStats {
  key: string;
  hits7d: number;
  hits30d: number;
  misses7d: number;
  replayAgreed: number;   // latest replay per current example, last 48 hours
  replayTotal: number;
}

// A rule's label is its answer key (resolver answer) or its resolver name.
const RULE_LABEL_SQL = `CASE WHEN rv.value = 'answer' THEN r.answer_key ELSE rv.value END`;

/** Per active rule: gated hits (7 and 30 days, any version of the rule key), misses (labelled model turns, 7 days), replay agreement. */
export async function getRuleStats(runner: Runner = db): Promise<GateRuleStats[]> {
  const r = await runner.query<{ key: string; hits7: string; hits30: string; misses7: string; agreed: string; total: string }>(
    `WITH active AS (
       SELECT r.id, r.key, ${RULE_LABEL_SQL} AS label
         FROM sommelier_gate_rule r JOIN lookup_value rv ON rv.id = r.resolver_id
        WHERE r.superseded_at IS NULL),
     hits AS (
       SELECT r.key,
              COUNT(*) FILTER (WHERE t.created_at >= now() - interval '7 days') AS hits7,
              COUNT(*) AS hits30
         FROM sommelier_turn t JOIN sommelier_gate_rule r ON r.id = t.rule_id
        WHERE t.route IN ('gate', 'gate_haiku') AND t.created_at >= now() - interval '30 days'
        GROUP BY r.key),
     latest_label AS (
       SELECT DISTINCT ON (l.turn_id) l.turn_id, l.label
         FROM sommelier_turn_label l
         JOIN sommelier_turn t ON t.id = l.turn_id
        WHERE t.route = 'model' AND t.created_at >= now() - interval '7 days'
        ORDER BY l.turn_id, l.labeled_at DESC, l.id DESC),
     misses AS (
       SELECT a.key, COUNT(*) AS misses7 FROM latest_label ll JOIN active a ON a.label = ll.label GROUP BY a.key),
     replay AS (
       SELECT DISTINCT ON (p.example_id) p.example_id, p.agreed
         FROM sommelier_gate_rule_replay p
        WHERE p.replayed_at >= now() - interval '48 hours'
        ORDER BY p.example_id, p.replayed_at DESC, p.id DESC),
     agreement AS (
       SELECT a.key, COUNT(*) FILTER (WHERE rp.agreed) AS agreed, COUNT(rp.example_id) AS total
         FROM active a
         JOIN sommelier_gate_rule_example e ON e.rule_id = a.id AND e.superseded_at IS NULL
         LEFT JOIN replay rp ON rp.example_id = e.id
        GROUP BY a.key)
     SELECT a.key, COALESCE(h.hits7, 0) AS hits7, COALESCE(h.hits30, 0) AS hits30, COALESCE(m.misses7, 0) AS misses7,
            COALESCE(g.agreed, 0) AS agreed, COALESCE(g.total, 0) AS total
       FROM active a
       LEFT JOIN hits h ON h.key = a.key
       LEFT JOIN misses m ON m.key = a.key
       LEFT JOIN agreement g ON g.key = a.key
      ORDER BY a.key`
  );
  return r.rows.map(x => ({
    key: x.key, hits7d: Number(x.hits7), hits30d: Number(x.hits30), misses7d: Number(x.misses7),
    replayAgreed: Number(x.agreed), replayTotal: Number(x.total),
  }));
}

export interface GateStats {
  turns: number;
  gatedTurns: number;
  gatedUsdMicros: number;
  modelTurns: number;
  modelUsdMicros: number;
  medianModelUsdMicros7d: number | null;
  labelledModelTurns: number;
  missTurns: number;          // labelled model turns whose latest label is an active rule's label
  missUsdMicros: number;
}

/** The System Health gate numbers over the last `sinceHours` (the median model turn is always over 7 days). */
export async function getGateStats({ sinceHours }: { sinceHours: number }, runner: Runner = db): Promise<GateStats> {
  const r = await runner.query<Record<string, string | null>>(
    `WITH win AS (
       SELECT * FROM sommelier_turn WHERE created_at >= now() - make_interval(hours => $1)),
     labels AS (
       SELECT CASE WHEN rv.value = 'answer' THEN r.answer_key ELSE rv.value END AS label
         FROM sommelier_gate_rule r JOIN lookup_value rv ON rv.id = r.resolver_id
        WHERE r.superseded_at IS NULL),
     latest_label AS (
       SELECT DISTINCT ON (l.turn_id) l.turn_id, l.label
         FROM sommelier_turn_label l JOIN win t ON t.id = l.turn_id
        WHERE t.route = 'model'
        ORDER BY l.turn_id, l.labeled_at DESC, l.id DESC)
     SELECT (SELECT COUNT(*) FROM win) AS turns,
            (SELECT COUNT(*) FROM win WHERE route IN ('gate', 'gate_haiku')) AS gated,
            (SELECT COALESCE(SUM(usd_micros), 0) FROM win WHERE route IN ('gate', 'gate_haiku')) AS gated_usd,
            (SELECT COUNT(*) FROM win WHERE route = 'model') AS model_turns,
            (SELECT COALESCE(SUM(usd_micros), 0) FROM win WHERE route = 'model') AS model_usd,
            (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY usd_micros) FROM sommelier_turn
              WHERE route = 'model' AND created_at >= now() - interval '7 days') AS median7,
            (SELECT COUNT(*) FROM latest_label) AS labelled,
            (SELECT COUNT(*) FROM latest_label ll WHERE ll.label IN (SELECT label FROM labels)) AS misses,
            (SELECT COALESCE(SUM(t.usd_micros), 0) FROM latest_label ll JOIN win t ON t.id = ll.turn_id
              WHERE ll.label IN (SELECT label FROM labels)) AS miss_usd`,
    [sinceHours]
  );
  const x = r.rows[0] ?? {};
  const n = (v: string | null | undefined) => Number(v ?? 0);
  return {
    turns: n(x.turns), gatedTurns: n(x.gated), gatedUsdMicros: n(x.gated_usd),
    modelTurns: n(x.model_turns), modelUsdMicros: n(x.model_usd),
    medianModelUsdMicros7d: x.median7 === null || x.median7 === undefined ? null : Math.round(Number(x.median7)),
    labelledModelTurns: n(x.labelled), missTurns: n(x.misses), missUsdMicros: n(x.miss_usd),
  };
}

/** answers_version lag (model rows in the last hour rendered with an older answers version) and shared-prefix rebuilds today. */
export async function getPrefixHealth({ minWriteTokens }: { minWriteTokens: number }, runner: Runner = db): Promise<{ answersVersionLag1h: number; prefixRebuildsToday: number }> {
  const r = await runner.query<{ lag: string; rebuilds: string }>(
    `SELECT (SELECT COUNT(*) FROM sommelier_turn
              WHERE route = 'model' AND created_at >= now() - interval '1 hour'
                AND answers_version IS NOT NULL AND answers_version < (SELECT MAX(id) FROM sommelier_answer)) AS lag,
            (SELECT COUNT(*) FROM sommelier_turn
              WHERE created_at >= date_trunc('day', now()) AND cache_write_tokens >= $1) AS rebuilds`,
    [minWriteTokens]
  );
  return { answersVersionLag1h: Number(r.rows[0]?.lag ?? 0), prefixRebuildsToday: Number(r.rows[0]?.rebuilds ?? 0) };
}
