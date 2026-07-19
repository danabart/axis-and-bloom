import { db } from '../db/client.js';

/**
 * Coffee → archetype → dominant-dimension resolution + dial_position_signal
 * insert, shared by on-site feedback (orders.ts) and Liam's SMS feedback
 * (liamSmsFeedback.ts) — extracted from orders.ts (Profile Part 2) so the two
 * channels don't duplicate this resolution logic (Liam SMS Dial Question).
 * `as_expected`/null writes nothing — a confirmation-signal design is a future
 * refinement, not built here (same rule both channels already followed).
 */
export async function writeDialPositionSignal(params: {
  coffeeId: number;
  expectation: 'lighter' | 'as_expected' | 'bolder' | null;
  source: 'onsite_feedback' | 'sms_feedback';
  notes: string;
}): Promise<void> {
  const { coffeeId, expectation, source, notes } = params;
  if (expectation !== 'lighter' && expectation !== 'bolder') return;

  const archResult = await db.query(
    `SELECT archetype FROM archetype_assignments WHERE coffee_id = $1 AND superseded_at IS NULL`,
    [coffeeId]
  );
  const archetype: string | undefined = archResult.rows[0]?.archetype;
  if (!archetype) return;

  const configResult = await db.query(
    `SELECT dominant_dimension_id FROM dial_archetype_config WHERE archetype = $1`,
    [archetype]
  );
  const dimensionId: number | undefined = configResult.rows[0]?.dominant_dimension_id;
  if (!dimensionId) return;

  await db.query(
    `INSERT INTO dial_position_signal
       (coffee_id, archetype, dimension_id, source, direction, sample_size, confidence, notes)
     VALUES ($1, $2, $3, $4, $5, 1, 'medium', $6)`,
    [coffeeId, archetype, dimensionId, source, expectation === 'lighter' ? 'less' : 'more', notes]
  );
}
