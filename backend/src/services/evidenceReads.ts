// Cupping evidence brief 3, Part B (2026-10-18): the read door over the
// reconciliation views (v_evidence_*, schema.sql). The only TypeScript reader
// of those views (lint:cupping rule 4). Read-only: nothing here writes, and no
// view writes the catalog; Dana decides through the existing catalog doors.
// backend/src/features/cupping_evidence/CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_3_RECONCILIATION.md
import { db } from '../db/client.js';
import { getCoffeeHint } from './roasteryPortalReads.js';
import { getDimensionHistory, getCustomerDescriptorsAll, type CustomerDescriptorAll } from './cuppingReads.js';

type Row = Record<string, unknown>;

/**
 * A1 + A2 + A3 for one coffee: the Coffees page evidence panel. Brief 6: plus
 * the cupping-note consensus (Descriptors tab) and each session's own merged
 * range (Dimensions tab, the pooled cell's history), both display only.
 */
export async function getCoffeeEvidence(coffeeId: number): Promise<{
  dimensions: Row[]; descriptors: Row[]; archetype: Row | null; calls: Row[]; consensus: Row[]; history: Row[];
  customerVoice: CustomerDescriptorAll[];
}> {
  const [dimensions, descriptors, archetype, calls, consensus, history, customerVoice] = await Promise.all([
    db.query(`SELECT * FROM v_evidence_dimension WHERE coffee_id = $1 ORDER BY dimension_id, cupper_name`, [coffeeId]),
    db.query(`SELECT * FROM v_evidence_descriptor WHERE coffee_id = $1 ORDER BY n_sources DESC, family`, [coffeeId]),
    db.query(`SELECT * FROM v_evidence_archetype WHERE coffee_id = $1`, [coffeeId]),
    db.query(`SELECT * FROM v_evidence_archetype_call WHERE coffee_id = $1 ORDER BY cupper_name`, [coffeeId]),
    getDescriptorConsensus(coffeeId),
    getDimensionHistory(coffeeId),
    // coffee presentation brief 1, E3: every customer-voice row with customer_sees (Descriptors tab column)
    getCustomerDescriptorsAll(coffeeId),
  ]);
  return {
    dimensions: dimensions.rows, descriptors: descriptors.rows, archetype: archetype.rows[0] ?? null, calls: calls.rows,
    consensus, history, customerVoice,
  };
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

// ── Cupping evidence brief 4, Part A (2026-10-18): the Calibration workbench ──

export interface WorkbenchQueueRow {
  coffee_id: number; coffee_name: string; is_placed: boolean;
  catalog_archetype: string | null; catalog_confidence: string | null; catalog_home_slot_name: string | null;
  assignment_basis_present: boolean | null; evidence_newer_than_decision: boolean | null;
  flag_unreconciled: boolean; n_sources: number; last_cupped: string | null;
}

/** One row per active coffee of the roastery: flagged first, then stale decisions, then no basis, then by name. */
export async function getWorkbenchQueue(roasterId: string): Promise<WorkbenchQueueRow[]> {
  const r = await db.query<WorkbenchQueueRow>(
    `SELECT c.coffee_id, c.coffee_name, c.is_placed, c.catalog_archetype, c.catalog_confidence,
            a.catalog_home_slot_name, c.assignment_basis_present, a.evidence_newer_than_decision,
            c.flag_unreconciled, c.n_sources, c.last_cupped
       FROM v_evidence_coverage c
       JOIN v_evidence_archetype a ON a.coffee_id = c.coffee_id
      WHERE c.roaster_id = $1
      ORDER BY c.flag_unreconciled DESC,
               COALESCE(a.evidence_newer_than_decision, false) DESC,
               (c.assignment_basis_present IS FALSE) DESC,
               c.coffee_name`,
    [roasterId]
  );
  return r.rows;
}

/**
 * The brief 3 per-coffee bundle plus what the three decision cards need: the
 * coffee's catalog basics (category codes for the decaf rule), its sessions
 * (for the session select), the roaster's current submitted response (id,
 * version, respondent; the descriptor card loads its notes and their mapping
 * through the existing acceptance-preview read), the latest website capture's
 * descriptor remarks, and the descriptors already accepted into the catalog.
 */
export async function getWorkbenchCoffee(coffeeId: number): Promise<{
  coffee: Row | null; dimensions: Row[]; descriptors: Row[]; archetype: Row | null; calls: Row[]; consensus: Row[]; history: Row[];
  customerVoice: CustomerDescriptorAll[]; sessions: Row[]; roasterResponse: Row | null; websiteDescriptors: Row[]; accepted: Row[];
}> {
  const [base, coffee, sessions, response, website, accepted] = await Promise.all([
    getCoffeeEvidence(coffeeId),
    db.query(`SELECT id, name, roaster_id, roaster_name, match_archetype, match_confidence, match_source, match_session_id,
                     category_codes, is_active FROM v_coffee WHERE id = $1`, [coffeeId]),
    db.query(`SELECT DISTINCT s.session_id, ss.session_date, ss.is_blind, ss.roaster_present
                FROM v_cupping_score s JOIN v_cupping_session ss ON ss.id = s.session_id
               WHERE s.coffee_id = $1 ORDER BY ss.session_date DESC, s.session_id DESC`, [coffeeId]),
    // the roaster's current submitted response, through the portal's own read door (lint:roastery-portal)
    getCoffeeHint(coffeeId),
    db.query(`SELECT r.id, r.remark, r.said_on, r.said_by, r.cupping_note_descriptor
                FROM v_roastery_remark r
               WHERE r.coffee_id = $1 AND r.channel = 'website' AND r.topic = 'descriptor' AND r.is_current
                 AND r.said_on = (SELECT max(x.said_on) FROM v_roastery_remark x
                                   WHERE x.coffee_id = r.coffee_id AND x.channel = 'website' AND x.is_current)
               ORDER BY r.load_dts, r.id`, [coffeeId]),
    db.query(`SELECT DISTINCT w.cupping_note_id, w.descriptor, w.wheel_category, w.tier
                FROM v_collaborative_flavor_wheel w WHERE w.coffee_id = $1 AND w.source = 'roastery'
               ORDER BY w.descriptor`, [coffeeId]),
  ]);
  const roasterResponse = response
    ? { response_id: response.responseId, portal_coffee_id: response.portalCoffeeId, version: response.version,
        submitted_at: response.submittedAt, respondent_name: response.respondentName, proposed_archetype: response.proposedArchetype }
    : null;
  return {
    coffee: coffee.rows[0] ?? null, ...base, sessions: sessions.rows,
    roasterResponse, websiteDescriptors: website.rows, accepted: accepted.rows,
  };
}

/**
 * Coffee presentation brief 2 (2026-10-24): the rows composeBasis
 * (evidenceBasis.ts) takes, the same as the workbench's archetype card reads
 * from getWorkbenchCoffee (archetype row, calls, the roaster's current
 * submitted response, the latest website capture's descriptor remarks), on a
 * caller's runner so a one-off loader and its test can compose a basis inside
 * a transaction. Read-only.
 */
export async function getBasisRows(coffeeId: number, runner: Pick<typeof db, 'query'> = db): Promise<{
  archetype: Row | null; calls: Row[]; roasterResponse: { version: number | null; respondent_name: string | null } | null; websiteDescriptors: Row[];
}> {
  const archetype = await runner.query(`SELECT * FROM v_evidence_archetype WHERE coffee_id = $1`, [coffeeId]);
  const calls = await runner.query(`SELECT * FROM v_evidence_archetype_call WHERE coffee_id = $1 ORDER BY cupper_name`, [coffeeId]);
  const response = await getCoffeeHint(coffeeId, {}, runner as typeof db);
  const website = await runner.query(
    `SELECT r.id, r.remark, r.said_on FROM v_roastery_remark r
      WHERE r.coffee_id = $1 AND r.channel = 'website' AND r.topic = 'descriptor' AND r.is_current
        AND r.said_on = (SELECT max(x.said_on) FROM v_roastery_remark x
                          WHERE x.coffee_id = r.coffee_id AND x.channel = 'website' AND x.is_current)
      ORDER BY r.load_dts, r.id`, [coffeeId]);
  return {
    archetype: archetype.rows[0] ?? null, calls: calls.rows,
    roasterResponse: response ? { version: response.version ?? null, respondent_name: response.respondentName ?? null } : null,
    websiteDescriptors: website.rows,
  };
}

/**
 * Brief 6, B (2026-10-21): our cupping notes per SCA node for one coffee,
 * "cocoa · 2 of 2 sessions · Dana, Camila", most shared first. The admin
 * Flavor Wheel's internal branch and the workbench Descriptors tab read this.
 */
export async function getDescriptorConsensus(coffeeId: number): Promise<Row[]> {
  return (await db.query(
    `SELECT * FROM v_evidence_descriptor_consensus WHERE coffee_id = $1
      ORDER BY share DESC, sessions_named DESC, descriptor`, [coffeeId])).rows;
}

/**
 * Brief 6, E2: the evidence parameters for the admin card: each key's current
 * value, since, note (with its sane range) and the value and date it replaced.
 */
export async function getParameters(): Promise<Array<{ key: string; value: number; since: string; note: string | null; previous_value: number | null; previous_since: string | null }>> {
  const r = await db.query(
    `SELECT cur.key, cur.value, cur.since, cur.note, prev.value AS previous_value, prev.since AS previous_since
       FROM evidence_parameter cur
       LEFT JOIN LATERAL (
         SELECT p.value, p.since FROM evidence_parameter p
          WHERE p.key = cur.key AND p.superseded_at IS NOT NULL
          ORDER BY p.superseded_at DESC LIMIT 1
       ) prev ON true
      WHERE cur.superseded_at IS NULL
      ORDER BY cur.key`);
  return r.rows.map((x: any) => ({
    key: x.key, value: Number(x.value), since: x.since, note: x.note,
    previous_value: x.previous_value === null ? null : Number(x.previous_value), previous_since: x.previous_since,
  }));
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
