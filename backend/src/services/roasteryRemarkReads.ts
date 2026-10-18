// Cupping evidence, brief 1 (2026-10-18), B7 — reads of roaster remarks,
// from v_roastery_remark only (names joined, is_current computed there).
import { db, type Tx } from '../db/client.js';

type Runner = Tx | typeof db;

export async function listRemarks(
  filter: { roasterId?: string; coffeeId?: number; currentOnly?: boolean } = {},
  runner: Runner = db
) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.roasterId) { params.push(filter.roasterId); clauses.push(`roaster_id = $${params.length}`); }
  if (filter.coffeeId !== undefined) { params.push(filter.coffeeId); clauses.push(`coffee_id = $${params.length}`); }
  if (filter.currentOnly ?? true) clauses.push('is_current');
  const r = await runner.query(
    `SELECT * FROM v_roastery_remark ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY said_on, coffee_id NULLS FIRST, topic, load_dts`,
    params
  );
  return r.rows;
}
