// Liam sees everything brief Rev 2, Part C3 (2026-10-24) — the one writer of
// sommelier_turn, the per-reply ledger. One INSERT per assistant reply, after
// the reply is in Firestore: the opening turn (/start, turn 0), every
// /:sessionId/message reply (route model), the daily-cap close (route guard,
// no model, zero tokens). Insert-only: no UPDATE, no DELETE, ever
// (lint:customer rule 9). Liam never reads it; it is measurement.
//
// A failed ledger write is logged [liam:LEDGER_FAILED] and never fails the
// turn: recordTurn() never throws. The route value is checked against the
// sommelier_turn_route lookup category (a CHECK would hard-code it).
// backend/src/features/ai_agent_liam/full_context/CLAUDE_CODE_PROMPT_LIAM_SEES_EVERYTHING.md
import { db } from '../db/client.js';
import type { Tx } from '../db/client.js';

type Runner = Tx | typeof db;

export interface TurnUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface RecordTurnInput {
  sessionId: number;
  turn: number;
  userMessageId: string | null;
  assistantMessageId: string;
  route: string;                 // lookup_value sommelier_turn_route: model | guard | gate | gate_haiku
  model?: string | null;         // NULL for guard and gate
  answersVersion?: number | null;
  topic?: string | null;
  matchedKeyword?: string | null;
  sticky?: boolean | null;
  mode?: string | null;
  usage?: TurnUsage | null;
  usdMicros?: number;
  latencyMs?: number | null;
  // Liam answer layer (2026-10-25): the gate's columns. Set on gate and
  // gate_haiku rows, and on a model row whose candidate rule the
  // confirmation turned down.
  ruleId?: number | null;
  confirmLabel?: string | null;
  confirmConfidence?: number | null;
  coffeeId?: number | null;
  answerId?: number | null;
}

let routeCache: { at: number; values: Set<string> } | null = null;
async function knownRoutes(runner: Runner): Promise<Set<string>> {
  if (routeCache && Date.now() - routeCache.at < 300_000) return routeCache.values;
  const r = await runner.query<{ value: string }>(`SELECT value FROM lookup_value WHERE category = 'sommelier_turn_route'`);
  routeCache = { at: Date.now(), values: new Set(r.rows.map(x => x.value)) };
  return routeCache.values;
}

/** Inserts the ledger row and returns its id, or null on any failure (logged, never thrown). */
export async function recordTurn(input: RecordTurnInput, runner: Runner = db): Promise<number | null> {
  try {
    if (!(await knownRoutes(runner)).has(input.route)) {
      throw new Error(`unknown sommelier_turn_route '${input.route}'`);
    }
    const u = input.usage ?? {};
    const r = await runner.query<{ id: number }>(
      `INSERT INTO sommelier_turn
         (session_id, turn, user_message_id, assistant_message_id, route, model, answers_version,
          topic, matched_keyword, sticky, mode,
          input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, usd_micros, latency_ms,
          rule_id, confirm_label, confirm_confidence, coffee_id, answer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       RETURNING id`,
      [
        input.sessionId, input.turn, input.userMessageId, input.assistantMessageId, input.route,
        input.model ?? null, input.answersVersion ?? null,
        input.topic ?? null, input.matchedKeyword ?? null, input.sticky ?? null, input.mode ?? null,
        u.input_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0, u.output_tokens ?? 0,
        Math.max(0, Math.round(input.usdMicros ?? 0)), input.latencyMs ?? null,
        input.ruleId ?? null, input.confirmLabel ?? null, input.confirmConfidence ?? null, input.coffeeId ?? null, input.answerId ?? null,
      ]
    );
    return r.rows[0]?.id ?? null;
  } catch (err) {
    console.error(`[liam:LEDGER_FAILED] session=${input.sessionId} turn=${input.turn} route=${input.route}`, err);
    return null;
  }
}

// Liam answer layer (2026-10-25), Part A5 — the only INSERTs into
// sommelier_turn_label and sommelier_gate_rule_replay (lint:customer rule
// 10). Insert-only facts; the nightly labeller (sommelierGate.runGateOffline)
// is the caller. Both return the new id, or null on a failure (logged).
export async function recordLabel(input: { turnId: number; label: string; labelerModel: string }, runner: Runner = db): Promise<number | null> {
  try {
    const r = await runner.query<{ id: number }>(
      `INSERT INTO sommelier_turn_label (turn_id, label, labeler_model) VALUES ($1, $2, $3) RETURNING id`,
      [input.turnId, input.label, input.labelerModel]
    );
    return r.rows[0]?.id ?? null;
  } catch (err) {
    console.error(`[liam:OFFLINE] label write failed turn=${input.turnId}`, err);
    return null;
  }
}

export async function recordReplay(input: { exampleId: number; label: string; agreed: boolean; labelerModel: string }, runner: Runner = db): Promise<number | null> {
  try {
    const r = await runner.query<{ id: number }>(
      `INSERT INTO sommelier_gate_rule_replay (example_id, label, agreed, labeler_model) VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.exampleId, input.label, input.agreed, input.labelerModel]
    );
    return r.rows[0]?.id ?? null;
  } catch (err) {
    console.error(`[liam:OFFLINE] replay write failed example=${input.exampleId}`, err);
    return null;
  }
}
