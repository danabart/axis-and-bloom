import { db } from '../db/client.js';
import type { Tx } from '../db/client.js';

// ── Customer Blueprint · brief C1, Part C (2026-09-27); first reads added by
// brief C2, Part A1 (2026-09-27) ──────────────────────────────────────────────
// The only place a customer_* table (or catalog_change) may be SELECTed from
// (lint rule 4 in backend/scripts/lint-customer.mjs enforces this) until C3
// ships its v_customer_*/v_palate_* views. See backend/src/features/
// customer_blueprint/README.md and the two CLAUDE_CODE_PROMPT files.

type Runner = Tx | typeof db;

// The most recent customer_feedback_event row for an order, by occurred_at —
// used only to find what a revision supersedes. Deliberately ignores whether
// that row is itself already superseded (resolving supersede chains properly
// is C3's job, via a view); this is a narrow "what's the latest thing said
// about this order" lookup for the door's own supersedesId field.
export async function latestFeedbackEventForOrder(userId: string, orderId: string, runner: Runner = db): Promise<string | null> {
  const result = await runner.query<{ id: string }>(
    `SELECT cfe.id FROM customer_feedback_event cfe
     JOIN order_line_item li ON li.id = cfe.order_line_item_id
     WHERE cfe.user_id = $1 AND li.order_id = $2
     ORDER BY cfe.occurred_at DESC LIMIT 1`,
    [userId, orderId]
  );
  return result.rows[0]?.id ?? null;
}

// The order's line item id when it has exactly one line, else null (multi-
// line orders leave feedback's coffee attribution ambiguous — Part A1's own
// "multi-line order, line unattributed" warning covers that case).
export async function orderLineForOrder(orderId: string, runner: Runner = db): Promise<string | null> {
  const result = await runner.query<{ id: string }>(`SELECT id FROM order_line_item WHERE order_id = $1`, [orderId]);
  return result.rows.length === 1 ? result.rows[0].id : null;
}
