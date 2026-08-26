import { db } from '../db/client.js';

// Roastery lifecycle (2026-08-25) — the single definition of "this coffee is
// part of the live catalogue". Every browse / recommend / resolve read
// composes this; nothing re-derives it independently.
//
// Roaster-level state (`roaster.is_active`) is deliberately NOT consulted at
// read time anywhere — the deactivate/reactivate cascade in routes/admin.ts
// is what keeps `coffees.is_active` truthful, and that's the only column any
// read path should ever check. If you find yourself writing
// `JOIN roaster r ... r.is_active` in a read path, stop: that's the wrong
// layer — see CLAUDE_CODE_PROMPT_ROASTERY_SOFT_DEACTIVATION.md Decision 2.
export const ACTIVE_COFFEE_SQL = (alias = 'c') => `${alias}.is_active = true`;

export async function isCoffeeActive(coffeeId: number): Promise<boolean> {
  const result = await db.query(
    `SELECT is_active FROM coffees WHERE id = $1`,
    [coffeeId]
  );
  return result.rows[0]?.is_active === true;
}

// For the few in-memory filters (RAG candidate trimming, door-map hop walks)
// where pulling a Set once is cheaper than a per-row SQL predicate.
export async function getActiveCoffeeIds(): Promise<Set<number>> {
  const result = await db.query(`SELECT id FROM coffees WHERE is_active = true`);
  return new Set(result.rows.map((r: { id: number }) => r.id));
}
