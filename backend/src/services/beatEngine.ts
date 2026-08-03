import { db } from '../db/client.js';
import { getSommelierConfig, type SommelierConfig } from './sommelierConfig.js';
import { getAliases } from './sommelierRag.js';
import { generateOrderPlacedLine } from './storyLayer.js';
import { createArrivalCard, getBagNumberForCoffee, getMostRecentCard, adjustCard } from './brewCard.js';
import { writeDialPositionSignal } from './dialPositionSignal.js';
import type { BrewProfileDoc } from './brewProfile.js';

// HOME_TASK_8 (§3.1) — the bag cycle's first three beats: order-placed line,
// arrival note dispatch, first-brew dial-in. Lifecycle-aware selection reads
// config/sommelier.beats — no hard-coded cases here. The empty-bag reorder
// beat is explicitly NOT this task's (Phase 4, confidence-gated).

const FALLBACK_BEATS: NonNullable<SommelierConfig['beats']> = {
  smsEnabled: false,
  types: {
    order_placed: { active: true },
    arrival_note: { active: true },
    dial_in: { active: true, timingOffsetDays: 3, skipIfRepeatCoffee: true },
  },
  degradeOnSilence: { windowSize: 5, minResponseRate: 0.2 },
};

function getBeatsConfig(): NonNullable<SommelierConfig['beats']> {
  return getSommelierConfig()?.beats ?? FALLBACK_BEATS;
}

export interface BeatDecision {
  active: boolean;
  channel: 'sms' | 'email' | 'inline' | null;
  skipReason: string | null;
}

export interface BeatSelection {
  orderPlaced: BeatDecision;
  arrivalNote: BeatDecision;
  dialIn: BeatDecision & { scheduledFor: Date };
  bagNumber: number;
}

// Degrade-on-silence (§3.1) — a trailing window over this user's most
// recently *sent* beats (any type), responded/sent ratio. Fewer than
// windowSize sent beats in history → not enough data to judge, never
// degrade a new user on thin evidence.
async function isDegradedBySilence(userId: string): Promise<boolean> {
  const { windowSize, minResponseRate } = getBeatsConfig().degradeOnSilence;
  const result = await db.query(
    `SELECT responded_at FROM beat_event
     WHERE user_id = $1 AND sent_at IS NOT NULL
     ORDER BY sent_at DESC LIMIT $2`,
    [userId, windowSize]
  );
  if (result.rows.length < windowSize) return false;
  const responded = result.rows.filter((r: { responded_at: Date | null }) => r.responded_at !== null).length;
  return responded / result.rows.length < minResponseRate;
}

// Channel priority: sms only when the master gate is on AND this user's
// phone carries the *extended* beat consent (spec item 6 — legacy
// sms_opt_in alone is never sufficient here). Otherwise email — the only
// live channel this pass regardless of what an individual beat would prefer.
async function selectChannel(userId: string): Promise<'sms' | 'email'> {
  if (!getBeatsConfig().smsEnabled) return 'email';
  const phone = await db.query(
    `SELECT phone_number FROM user_phone WHERE user_id = $1 AND sms_beats_opt_in = true LIMIT 1`,
    [userId]
  );
  return phone.rows.length ? 'sms' : 'email';
}

export async function selectBeats(userId: string, coffeeId: number): Promise<BeatSelection> {
  const config = getBeatsConfig();
  const [bagNumber, degraded, channel] = await Promise.all([
    getBagNumberForCoffee(userId, coffeeId),
    isDegradedBySilence(userId),
    selectChannel(userId),
  ]);
  const isRepeatCoffee = bagNumber > 1;

  const orderPlaced: BeatDecision = config.types.order_placed.active
    ? { active: true, channel: 'inline', skipReason: null }
    : { active: false, channel: null, skipReason: 'inactive_config' };

  // Arrival note is the floor of the minimal set (§3.1) — never dropped by
  // degrade-on-silence, only by its own active flag.
  const arrivalNote: BeatDecision = config.types.arrival_note.active
    ? { active: true, channel, skipReason: null }
    : { active: false, channel: null, skipReason: 'inactive_config' };

  let dialIn: BeatDecision & { scheduledFor: Date };
  const dialInOffsetDays = config.types.dial_in.timingOffsetDays;
  const scheduledFor = new Date(Date.now() + dialInOffsetDays * 86_400_000);
  if (!config.types.dial_in.active) {
    dialIn = { active: false, channel: null, skipReason: 'inactive_config', scheduledFor };
  } else if (config.types.dial_in.skipIfRepeatCoffee && isRepeatCoffee) {
    dialIn = { active: false, channel: null, skipReason: 'repeat_coffee', scheduledFor };
  } else if (degraded) {
    dialIn = { active: false, channel: null, skipReason: 'degraded_silence', scheduledFor };
  } else {
    dialIn = { active: true, channel, skipReason: null, scheduledFor };
  }

  return { orderPlaced, arrivalNote, dialIn, bagNumber };
}

// Idempotent per (user, order, beat type) in both functions below —
// beat_event's own UNIQUE constraint is the guarantee; every insert is ON
// CONFLICT DO NOTHING and only does the associated work (line generation,
// card creation, scheduling) when the insert actually happened. Re-calling
// either function for the same order is always safe — the second call is a
// no-op, proving the idempotency the task's own verification asks for.

// Synchronous half — called *before* orders.ts responds, since the line is
// injected into the order-confirmation response itself (spec item 2: "one
// line in the confirmation flow... generated at order time, no conversation
// attached"). A single Haiku call, same latency shape as any other one-off
// content generation in this codebase.
export async function dispatchOrderPlacedBeat(userId: string, orderId: string, coffeeId: number): Promise<string | null> {
  const config = getBeatsConfig();
  const active = config.types.order_placed.active;

  const inserted = await db.query(
    active
      ? `INSERT INTO beat_event (user_id, order_id, coffee_id, beat_type, channel, sent_at)
         VALUES ($1, $2, $3, 'order_placed', 'inline', NOW())
         ON CONFLICT (user_id, order_id, beat_type) DO NOTHING RETURNING id`
      : `INSERT INTO beat_event (user_id, order_id, coffee_id, beat_type, channel, skip_reason)
         VALUES ($1, $2, $3, 'order_placed', NULL, 'inactive_config')
         ON CONFLICT (user_id, order_id, beat_type) DO NOTHING RETURNING id`,
    [userId, orderId, coffeeId]
  );
  if (!active || !inserted.rows.length) return null;

  try {
    const [aliasMap, archResult, descriptorResult, rawResult] = await Promise.all([
      getAliases([coffeeId]),
      db.query(`SELECT aa.archetype::text AS archetype FROM archetype_assignments aa WHERE aa.coffee_id = $1 AND aa.superseded_at IS NULL LIMIT 1`, [coffeeId]),
      db.query(`SELECT descriptor FROM v_collaborative_flavor_wheel WHERE coffee_id = $1 GROUP BY descriptor ORDER BY COUNT(*) DESC LIMIT 4`, [coffeeId]),
      db.query(`SELECT name, roaster FROM coffees WHERE id = $1`, [coffeeId]),
    ]);
    const alias = aliasMap.get(coffeeId) ?? 'This coffee';
    return await generateOrderPlacedLine(
      { displayName: alias, archetype: archResult.rows[0]?.archetype ?? null, topDescriptors: descriptorResult.rows.map((r: { descriptor: string }) => r.descriptor) },
      { rawCoffeeName: rawResult.rows[0]?.name ?? null, roasterNames: rawResult.rows[0]?.roaster ? [rawResult.rows[0].roaster] : [] }
    );
  } catch (err) {
    console.error('[beatEngine] order_placed line generation failed:', err);
    return null;
  }
}

// Async half — fire-and-forget from orders.ts, same trigger point Task 6's
// arrival-card hook and the (now-superseded, see orders.ts) legacy SMS
// scheduling already used. Owns arrival_note + dial_in: whether each fires,
// on which channel, and — for dial_in — records its scheduled_at for the
// cron to pick up later. Returns the full selection so the caller can log
// or assert on it (verification, tests).
export async function dispatchDelayedBeats(params: {
  userId: string;
  orderId: string;
  coffeeId: number;
  brewProfile: BrewProfileDoc | null;
}): Promise<BeatSelection> {
  const { userId, orderId, coffeeId, brewProfile } = params;
  const selection = await selectBeats(userId, coffeeId);

  // ── arrival_note ──────────────────────────────────────────────────────
  if (selection.arrivalNote.active) {
    const inserted = await db.query(
      `INSERT INTO beat_event (user_id, order_id, coffee_id, beat_type, channel, scheduled_at)
       VALUES ($1, $2, $3, 'arrival_note', $4, NOW())
       ON CONFLICT (user_id, order_id, beat_type) DO NOTHING
       RETURNING id`,
      [userId, orderId, coffeeId, selection.arrivalNote.channel]
    );
    // Task 6's own createArrivalCard() is independently idempotent per
    // (user, coffee, method) — only called when this order's beat_event row
    // is genuinely new, so a re-fire never even reaches it a second time.
    if (inserted.rows.length) {
      try {
        await createArrivalCard(userId, coffeeId, brewProfile);
      } catch (err) {
        console.error('[beatEngine] arrival_note card creation failed:', err);
      }
    }
  } else {
    await db.query(
      `INSERT INTO beat_event (user_id, order_id, coffee_id, beat_type, channel, skip_reason)
       VALUES ($1, $2, $3, 'arrival_note', NULL, $4)
       ON CONFLICT (user_id, order_id, beat_type) DO NOTHING`,
      [userId, orderId, coffeeId, selection.arrivalNote.skipReason]
    );
  }

  // ── dial_in ───────────────────────────────────────────────────────────
  if (selection.dialIn.active) {
    await db.query(
      `INSERT INTO beat_event (user_id, order_id, coffee_id, beat_type, channel, scheduled_at)
       VALUES ($1, $2, $3, 'dial_in', $4, $5)
       ON CONFLICT (user_id, order_id, beat_type) DO NOTHING`,
      [userId, orderId, coffeeId, selection.dialIn.channel, selection.dialIn.scheduledFor]
    );
  } else {
    await db.query(
      `INSERT INTO beat_event (user_id, order_id, coffee_id, beat_type, channel, scheduled_at, skip_reason)
       VALUES ($1, $2, $3, 'dial_in', NULL, $4, $5)
       ON CONFLICT (user_id, order_id, beat_type) DO NOTHING`,
      [userId, orderId, coffeeId, selection.dialIn.scheduledFor, selection.dialIn.skipReason]
    );
  }

  return selection;
}

// HOME_TASK_8 (§3.1, spec item 2) — "the reply... adjusts the brew card
// (Task 6's adjust path) and writes the feedback event via
// dialPositionSignal.ts." Shared by both reply paths the spec names: the
// on-site card-door endpoint (routes/beats.ts) and the SMS inbound webhook
// (cron.ts, once beats.smsEnabled is ever flipped on) — one implementation,
// not two. `source` reflects which path actually produced this reply, since
// dial_position_signal's own CHECK constraint only allows
// 'sms_feedback'/'onsite_feedback' (no new source value invented). Idempotent:
// a beat_event that already has responded_at is left alone, returns false —
// a customer can't double-adjust the same card by clicking a stale link twice.
export async function respondToDialInBeat(
  beatEventId: number,
  expectation: 'lighter' | 'as_expected' | 'bolder',
  source: 'sms_feedback' | 'onsite_feedback'
): Promise<boolean> {
  const result = await db.query(
    `SELECT * FROM beat_event WHERE id = $1 AND beat_type = 'dial_in'`,
    [beatEventId]
  );
  const beat = result.rows[0];
  if (!beat || beat.responded_at) return false;

  await writeDialPositionSignal({
    coffeeId: beat.coffee_id,
    expectation,
    source,
    notes: `dial-in beat for order ${beat.order_id}`,
  });

  // bolder-than-expected → next time, less extraction (coarser); lighter →
  // more extraction (finer). as_expected → the card is right, no adjustment.
  const adjustmentKey = expectation === 'bolder' ? 'grind_coarser' : expectation === 'lighter' ? 'grind_finer' : null;
  if (adjustmentKey) {
    const card = await getMostRecentCard(beat.user_id, beat.coffee_id);
    if (card) {
      await adjustCard(card.id, adjustmentKey, `first cup came out ${expectation} than expected`);
    }
  }

  await db.query(`UPDATE beat_event SET responded_at = NOW() WHERE id = $1`, [beatEventId]);
  return true;
}

const DIAL_IN_METHOD_LABEL: Record<string, string> = {
  v60: 'V60', french_press: 'French press', espresso: 'Espresso', moka: 'Moka pot',
  aeropress: 'Aeropress', cold_brew: 'Cold brew', drip: 'Drip', other: 'your usual method',
};

// HOME_TASK_8 — composes the dial-in beat's SMS body (used once smsEnabled
// is flipped on) — kept here beside the rest of the beat-composition logic;
// cron.ts owns the actual outbound scheduling (reuses sommelier_sms_feedback
// + the existing processPendingMessages() cron, per the task's own "reuse,
// don't duplicate" instruction) and the email render (Resend already lives
// there, see processArrivalNotes()). Length-checked the same way S15/S53
// checked the legacy SMS bodies.
export function buildDialInSmsBody(coffeeAlias: string, method: string): { primary: string; fallback: string } {
  const methodLabel = DIAL_IN_METHOD_LABEL[method] ?? method;
  const primary = `Hey! It's Liam — how's the first cup of ${coffeeAlias} on your ${methodLabel}? Lighter or bolder than you expected? 🌸`;
  const fallback = `Hi, it's Liam — first cup of ${coffeeAlias}? Lighter or bolder than expected?`;
  return { primary: primary.length <= 160 ? primary : fallback, fallback };
}
