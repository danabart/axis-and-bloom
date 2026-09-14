import { db } from '../db/client.js';
import { getCoffee, getArchetypes } from './catalogReads.js';

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

  // Catalog Blueprint brief 3: archetype via getCoffee().match_archetype (D1's
  // flavor identity) instead of a raw archetype_assignments query; dominant
  // dimension via getArchetypes() (v_coffee_archetype), which already joins it,
  // instead of a raw dial_archetype_config query.
  const coffee = await getCoffee(coffeeId);
  const archetype = coffee?.match_archetype ?? undefined;
  if (!archetype) return;

  const archetypes = await getArchetypes();
  const dimensionId = archetypes.find((a) => a.code === archetype)?.dominant_dimension_id ?? undefined;
  if (!dimensionId) return;

  await db.query(
    `INSERT INTO dial_position_signal
       (coffee_id, archetype, dimension_id, source, direction, sample_size, confidence, notes)
     VALUES ($1, $2, $3, $4, $5, 1, 'medium', $6)`,
    [coffeeId, archetype, dimensionId, source, expectation === 'lighter' ? 'less' : 'more', notes]
  );
}
