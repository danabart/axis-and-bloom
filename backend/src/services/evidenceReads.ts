// Cupping evidence brief 3, Part B (2026-10-18): the read door over the
// reconciliation views (v_evidence_*, schema.sql). The only TypeScript reader
// of those views (lint:cupping rule 4). Read-only: nothing here writes, and no
// view writes the catalog; Dana decides through the existing catalog doors.
// backend/src/features/cupping_evidence/CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_3_RECONCILIATION.md
import { db } from '../db/client.js';

type Row = Record<string, unknown>;

/** A1 + A2 + A3 for one coffee: the Coffees page evidence panel. */
export async function getCoffeeEvidence(coffeeId: number): Promise<{
  dimensions: Row[]; descriptors: Row[]; archetype: Row | null; calls: Row[];
}> {
  const [dimensions, descriptors, archetype, calls] = await Promise.all([
    db.query(`SELECT * FROM v_evidence_dimension WHERE coffee_id = $1 ORDER BY dimension_id, cupper_name`, [coffeeId]),
    db.query(`SELECT * FROM v_evidence_descriptor WHERE coffee_id = $1 ORDER BY n_sources DESC, family`, [coffeeId]),
    db.query(`SELECT * FROM v_evidence_archetype WHERE coffee_id = $1`, [coffeeId]),
    db.query(`SELECT * FROM v_evidence_archetype_call WHERE coffee_id = $1 ORDER BY cupper_name`, [coffeeId]),
  ]);
  return { dimensions: dimensions.rows, descriptors: descriptors.rows, archetype: archetype.rows[0] ?? null, calls: calls.rows };
}

/** A4 + A5 + A6 for one roastery, and its stale decisions from A3: the Calibration tab. */
export async function getRoasteryEvidence(roasterId: string): Promise<{
  calibration: Row[]; cuppers: Row[]; coverage: Row[]; staleDecisions: number;
}> {
  const [calibration, cuppers, coverage, stale] = await Promise.all([
    db.query(`SELECT * FROM v_evidence_roastery_calibration WHERE roaster_id = $1 ORDER BY dimension_id`, [roasterId]),
    // A5 is per cupper, across every roastery the cupper has scored
    db.query(`SELECT * FROM v_evidence_cupper_calibration ORDER BY cupper_name, dimension_id, is_blind`),
    db.query(`SELECT * FROM v_evidence_coverage WHERE roaster_id = $1 ORDER BY coffee_name`, [roasterId]),
    db.query<{ n: string }>(`SELECT count(*) AS n FROM v_evidence_archetype WHERE roaster_id = $1 AND evidence_newer_than_decision`, [roasterId]),
  ]);
  return { calibration: calibration.rows, cuppers: cuppers.rows, coverage: coverage.rows, staleDecisions: Number(stale.rows[0]?.n ?? 0) };
}

export interface EvidenceSummary {
  activeCoffees: number;
  coffeesWithTwoOrMoreSources: number;
  coffeesUnreconciled: number;
  placedWithoutCupping: number;
  assignmentsWithoutBasis: number;
  unmappedWords: number;
}

/** B3: the System Health card's numbers (A6 + A7). */
export async function getEvidenceSummary(): Promise<EvidenceSummary> {
  const [coverage, words] = await Promise.all([
    db.query<{ active: string; two: string; unrec: string; placed_uncupped: string; no_basis: string }>(
      `SELECT count(*) AS active,
              count(*) FILTER (WHERE n_sources >= 2) AS two,
              count(*) FILTER (WHERE flag_unreconciled) AS unrec,
              count(*) FILTER (WHERE is_placed AND n_cuppers = 0) AS placed_uncupped,
              count(*) FILTER (WHERE assignment_basis_present IS FALSE) AS no_basis
         FROM v_evidence_coverage`
    ),
    db.query<{ n: string }>(`SELECT count(*) AS n FROM v_evidence_unmapped_words`),
  ]);
  const c = coverage.rows[0];
  return {
    activeCoffees: Number(c.active),
    coffeesWithTwoOrMoreSources: Number(c.two),
    coffeesUnreconciled: Number(c.unrec),
    placedWithoutCupping: Number(c.placed_uncupped),
    assignmentsWithoutBasis: Number(c.no_basis),
    unmappedWords: Number(words.rows[0]?.n ?? 0),
  };
}

/** A7: the mapping queue. */
export async function getUnmappedWords(): Promise<Row[]> {
  return (await db.query(`SELECT * FROM v_evidence_unmapped_words ORDER BY source, n_coffees DESC, word`)).rows;
}

/**
 * B0: the SCA families a coffee's evidence names (by us or by the roaster),
 * most-named first. Read by catalogService's D6 descriptor_off_family warning,
 * which compares the top three against the slot's families. A flag, never a gate.
 */
export async function getFamilies(coffeeId: number): Promise<string[]> {
  const r = await db.query<{ family: string }>(
    `SELECT family FROM v_evidence_descriptor
      WHERE coffee_id = $1 AND (named_by_ab OR named_by_roaster)
      ORDER BY n_sources DESC, family`,
    [coffeeId]
  );
  return r.rows.map(x => x.family);
}
