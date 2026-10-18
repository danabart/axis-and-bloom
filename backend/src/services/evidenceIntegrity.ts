// Cupping evidence brief 3, B00 (2026-10-18): the evidence layer's integrity
// checks, the fourth piece of the blueprint pattern (door, reads, lint,
// integrity). Report-only: run at boot (logged, never blocks) and on demand
// from the System Health card. Nothing here writes or repairs.
// Reads through views and cuppingReads (lint:cupping keeps cupping base tables
// to cuppingService / cuppingReads); thresholds come from param().
import { db } from '../db/client.js';
import { getSupersededWithoutTarget } from './cuppingReads.js';

export interface EvidenceIntegrityCheck {
  id: number;
  name: string;
  ok: boolean;
  count: number;
  sample: string[];
}

export interface EvidenceIntegrityReport {
  ranAt: string;
  allOk: boolean;
  checks: EvidenceIntegrityCheck[];
}

const SAMPLE = 10;

function check(id: number, name: string, items: string[]): EvidenceIntegrityCheck {
  return { id, name, ok: items.length === 0, count: items.length, sample: items.slice(0, SAMPLE) };
}

// The evidence tables and the module their Writer: field must name.
const EVIDENCE_WRITERS: Array<[string, string]> = [
  ['cupping_sessions', 'cuppingService'],
  ['cupping_session_coffees', 'cuppingService'],
  ['cupping_brew_params', 'cuppingService'],
  ['cupping_scores', 'cuppingService'],
  ['cupping_score_values', 'cuppingService'],
  ['cupping_score_descriptors', 'cuppingService'],
  ['roastery_remark', 'roasteryRemarkService'],
];

// 1. Every evidence table carries a Writer: naming its service (comments.sql, as applied).
async function checkWriters(): Promise<EvidenceIntegrityCheck> {
  const r = await db.query<{ relname: string; comment: string | null }>(
    `SELECT c.relname, obj_description(c.oid, 'pg_class') AS comment
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r' AND c.relname = ANY($1::text[])`,
    [EVIDENCE_WRITERS.map(([t]) => t)]
  );
  const byTable = new Map(r.rows.map(x => [x.relname, x.comment ?? '']));
  const bad = EVIDENCE_WRITERS.filter(([table, service]) => {
    const writer = /\|\s*Writer:\s*([^|]*)/.exec(byTable.get(table) ?? '')?.[1] ?? '';
    return !writer.includes(`${service}.`);
  }).map(([table, service]) => `${table}: Writer: does not name ${service}`);
  return check(1, 'Every cupping evidence table and roastery_remark has a Writer: naming its service', bad);
}

// 2. No current merged row on a sample without a current cupper row.
async function checkMergedHasCuppers(): Promise<EvidenceIntegrityCheck> {
  const r = await db.query<{ id: number; session_coffee_id: number; coffee_id: number }>(
    `SELECT m.id, m.session_coffee_id, m.coffee_id FROM v_cupping_score m
      WHERE m.is_merged
        AND NOT EXISTS (SELECT 1 FROM v_cupping_score c WHERE c.session_coffee_id = m.session_coffee_id AND NOT c.is_merged)
      ORDER BY m.id`
  );
  return check(2, 'No current merged row without a current cupper row on the same sample',
    r.rows.map(x => `score ${x.id} (sample ${x.session_coffee_id}, coffee ${x.coffee_id})`));
}

// 3. No superseded score row whose replacement is missing or itself gone.
async function checkSupersededTargets(): Promise<EvidenceIntegrityCheck> {
  const rows = await getSupersededWithoutTarget();
  return check(3, 'No superseded cupping_scores row without a live superseded_by_id target',
    rows.map(x => `score ${x.id} → ${x.superseded_by_id ?? 'null'}`));
}

// 4. No descriptor on a current score row at an inactive SCA node.
async function checkDescriptorNodes(): Promise<EvidenceIntegrityCheck> {
  const r = await db.query<{ id: number; descriptor: string; coffee_id: number }>(
    `SELECT d.id, d.descriptor, d.coffee_id FROM v_cupping_score_descriptor d
       JOIN v_cupping_note_family f ON f.cupping_note_id = d.cupping_note_id
      WHERE NOT f.is_active ORDER BY d.id`
  );
  return check(4, 'No cupping_score_descriptors row on an inactive SCA node',
    r.rows.map(x => `descriptor ${x.id} (${x.descriptor}, coffee ${x.coffee_id})`));
}

// 5. No current word mapping pointing at an inactive SCA node.
async function checkMappingNodes(): Promise<EvidenceIntegrityCheck> {
  const r = await db.query<{ normalized_words: string; source_kind: string; descriptor: string }>(
    `SELECT m.normalized_words, m.source_kind, f.descriptor FROM v_note_mapping_current m
       JOIN v_cupping_note_family f ON f.cupping_note_id = m.cupping_note_id
      WHERE NOT f.is_active ORDER BY m.normalized_words`
  );
  return check(5, 'No current word mapping (roaster or cupper) pointing at an inactive SCA node',
    r.rows.map(x => `'${x.normalized_words}' (${x.source_kind}) → ${x.descriptor}`));
}

// 6. No home-placed coffee whose archetype assignment states no basis.
async function checkPlacedHasBasis(): Promise<EvidenceIntegrityCheck> {
  const r = await db.query<{ coffee_id: number; coffee_name: string }>(
    `SELECT DISTINCT s.coffee_id, s.coffee_name FROM v_coffee_slot s
       JOIN v_coffee vc ON vc.id = s.coffee_id
      WHERE s.role = 'home' AND s.assignment_is_active
        AND vc.match_basis IS NULL AND COALESCE(vc.match_notes, '') NOT LIKE 'basis:%'
      ORDER BY s.coffee_id`
  );
  return check(6, 'No coffee with a home placement and an assignment without a basis',
    r.rows.map(x => `${x.coffee_name} (${x.coffee_id})`));
}

// 7. No estimated session date older than param('estimated_date_review_days') without a note.
async function checkEstimatedDates(): Promise<EvidenceIntegrityCheck> {
  const r = await db.query<{ id: number; session_date: string }>(
    `SELECT s.id, s.session_date::text FROM v_cupping_session s
      WHERE s.session_date_precision = 'estimated'
        AND s.session_date < current_date - param('estimated_date_review_days')::int
        AND COALESCE(btrim(s.session_notes), '') = ''
      ORDER BY s.id`
  );
  return check(7, "No estimated session date older than param('estimated_date_review_days') without a note",
    r.rows.map(x => `session ${x.id} (${x.session_date}, estimated)`));
}

// 8. No roaster x coffee website capture older than param('website_recapture_days').
async function checkWebsiteCaptures(): Promise<EvidenceIntegrityCheck> {
  const r = await db.query<{ roaster_name: string; coffee_name: string; said_on: string }>(
    `SELECT roaster_name, coffee_name, max(said_on)::text AS said_on FROM v_roastery_remark
      WHERE channel = 'website' AND is_current AND coffee_id IS NOT NULL
      GROUP BY roaster_name, coffee_name
     HAVING max(said_on) < current_date - param('website_recapture_days')::int
      ORDER BY roaster_name, coffee_name`
  );
  return check(8, "No website capture older than param('website_recapture_days') for a roaster x coffee",
    r.rows.map(x => `${x.roaster_name} / ${x.coffee_name} (captured ${x.said_on})`));
}

export async function runEvidenceIntegrityChecks(): Promise<EvidenceIntegrityReport> {
  const checks: EvidenceIntegrityCheck[] = [];
  // Sequential: eight small reads, no need to hold eight connections.
  for (const run of [checkWriters, checkMergedHasCuppers, checkSupersededTargets, checkDescriptorNodes,
    checkMappingNodes, checkPlacedHasBasis, checkEstimatedDates, checkWebsiteCaptures]) {
    checks.push(await run());
  }
  return { ranAt: new Date().toISOString(), allOk: checks.every(c => c.ok), checks };
}

export function formatEvidenceIntegrityLog(report: EvidenceIntegrityReport): string[] {
  return report.checks.filter(c => !c.ok)
    .map(c => `[evidence-integrity] check #${c.id} — ${c.name}: ${c.count} (e.g. ${c.sample.slice(0, 3).join('; ')})`);
}
