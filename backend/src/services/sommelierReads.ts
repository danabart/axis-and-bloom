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
