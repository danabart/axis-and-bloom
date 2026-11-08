// Family Household 2, B2 (2026-11-07) — the dial door's writes, moved out of
// routes/users.ts (G3.1) so the customer's own dial, a member turning another
// member's dial (D27) and the member's undo all go through one function. The
// one writer of user_bloom_dial_current_position and of user_saved_item's
// dial_slot rows; the dial fact itself stays customerFacts.dialEvent.
// backend/src/features/household/CLAUDE_CODE_PROMPT_HOUSEHOLD_2_QUIZ_AND_DIAL_BY_PROXY.md
import { randomUUID } from 'node:crypto';
import { db, type Tx } from '../db/client.js';
import { record } from './customerFacts.js';

type Runner = Tx | typeof db;

export const DIAL_EVENT_TRIGGERS = ['explicit_save', 'add_to_cart'] as const;
export type DialTrigger = typeof DIAL_EVENT_TRIGGERS[number];

/** (archetype, dialSortOrder) → coffee_dial_slot.id, or null when the pair is unknown. */
export async function resolveSlot(runner: Runner, archetype: string, dialSortOrder: number): Promise<number | null> {
  const r = await runner.query<{ id: number }>(
    `SELECT id FROM coffee_dial_slot WHERE archetype = $1 AND sort_order = $2`, [archetype, dialSortOrder]
  );
  return r.rows[0]?.id ?? null;
}

/** One profile's own saved position for an archetype (the customer's own dial). */
export async function ownSortOrder(profileId: string, archetype: string): Promise<number | null> {
  const r = await db.query<{ dial_sort_order: number }>(
    `SELECT cds.sort_order AS dial_sort_order
     FROM user_bloom_dial_current_position u
     JOIN coffee_dial_slot cds ON cds.id = u.slot_id
     WHERE u.user_id = $1 AND u.archetype = $2`,
    [profileId, archetype]
  );
  return r.rows[0]?.dial_sort_order ?? null;
}

/** A person's current position for an archetype across their linked profiles (v_customer_dial_current, T3). */
export async function currentSlot(runner: Runner, userId: string, archetype: string): Promise<{ slotId: number | null; sortOrder: number | null }> {
  const r = await runner.query<{ slot_id: number | null; sort_order: number | null }>(
    `SELECT dc.slot_id, cds.sort_order
     FROM v_customer_dial_current dc
     JOIN v_customer_identity vci ON vci.canonical_user_id = dc.canonical_user_id
     LEFT JOIN coffee_dial_slot cds ON cds.id = dc.slot_id
     WHERE vci.user_id = $1 AND dc.archetype = $2`,
    [userId, archetype]
  );
  return { slotId: r.rows[0]?.slot_id ?? null, sortOrder: r.rows[0]?.sort_order ?? null };
}

export interface SavePositionInput {
  userId: string;            // the profile whose dial moves
  archetype: string;
  slotId: number | null;     // null only for an undo back to "no position"
  trigger?: DialTrigger;     // absent: the silent auto-save (no fact)
  source?: string | null;
  coffeeId?: number | null;
  platformName?: string | null;
  dialSortOrder?: number | null;
  actorUserId?: string | null; // D27: who turned it, when not the person themselves
  savedItem: boolean;          // explicit_save also lands in the saved list (the person's own saves only)
}

/**
 * Move a dial and, when a trigger is given, record the fact. `strict` runs inside
 * a caller's transaction and lets a failed fact fail the move (the household
 * paths, where the log is the point); otherwise the fact and the saved item are
 * best-effort, exactly as the customer's own dial behaved before (a logging
 * failure never fails the turn). Returns the dial event's id when one was written.
 */
export async function savePosition(runner: Runner, input: SavePositionInput, strict = false): Promise<{ dialEventId: string | null }> {
  await runner.query(
    `INSERT INTO user_bloom_dial_current_position (user_id, archetype, slot_id, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, archetype)
     DO UPDATE SET slot_id = $3, updated_at = NOW()`,
    [input.userId, input.archetype, input.slotId]
  );
  if (!input.trigger) return { dialEventId: null };

  let dialEventId: string | null = null;
  const fact = async () => {
    const res = await record.dialEvent({
      userId: input.userId, source: 'onsite', sourceId: randomUUID(),
      eventType: input.trigger!, slotId: input.slotId, coffeeId: input.coffeeId ?? null,
      archetypeCode: input.archetype, actorUserId: input.actorUserId ?? null,
    }, strict ? runner as Tx : undefined);
    dialEventId = res.id;
  };
  if (strict) await fact();
  else {
    try { await fact(); } catch (err) { console.error('[customerFacts:dial-event]', err); }
  }

  // Customer Blueprint C3, Part B4 — explicit_save additionally records current
  // *state* (the saved list); add_to_cart is never a saved-list entry.
  if (input.trigger === 'explicit_save' && input.savedItem) {
    const save = () => runner.query(
      `INSERT INTO user_saved_item (user_id, kind, ref_id, title, payload)
       VALUES ($1, 'dial_slot', $2, $3, $4)`,
      [input.userId, `${input.archetype}:${input.dialSortOrder}`, input.platformName ?? null,
       JSON.stringify({ archetype: input.archetype, dialSortOrder: input.dialSortOrder, coffeeId: input.coffeeId ?? null, platformName: input.platformName ?? null })]
    );
    if (strict) await save();
    else {
      try { await save(); } catch (err) { console.error('[user_saved_item:dial_slot]', err); }
    }
  }
  return { dialEventId };
}
