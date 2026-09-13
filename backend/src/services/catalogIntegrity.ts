import { db } from '../db/client.js';

// ── Catalog Blueprint · brief 1 — integrity check service ────────────────────
// Clone of quizIntegrity.ts's shape. Read-only — this service never writes or
// repairs anything; brief 2's service is the only writer for anything checked
// here. Every check is a real query against the live schema (archetype,
// coffee_dial_slot, coffee_slot_assignment, and the five v_coffee_* views).
// See backend/src/features/catalog_blueprint/
// CLAUDE_CODE_PROMPT_CATALOG_1_SCHEMA_VIEWS_INTEGRITY.md, Part D, for the
// numbered spec each check below implements.

export interface CatalogIntegrityCheck {
  id: number;
  name: string;
  pass: boolean;
  expected: string;
  actual: string;
  details?: string[];
  // 'info' checks are surfaced but never fail the boot/allPass roll-up — D1
  // says some divergence (match vs. placement) is legitimate, not a bug, and
  // check 13 (legacy rows for active coffees) is only a failure from brief 5
  // onward. Defaults to 'fail' when omitted.
  severity?: 'info' | 'fail';
}

export interface CatalogIntegrityReport {
  ranAt: string;
  allPass: boolean;
  checks: CatalogIntegrityCheck[];
}

const REQUIRED_INDEXES = [
  'archetype_code_key',
  'coffee_dial_slot_one_landing_default',
  'coffee_slot_assignment_one_active_home',
  'coffee_slot_assignment_one_active_per_priority',
  'archetype_assignments_one_current',
  'roaster_blend_one_active_per_weight',
  'dial_slot_price_slot_weight_key',
  'coffees_active_natural_key',
];

export async function runCatalogIntegrityChecks(): Promise<CatalogIntegrityReport> {
  const checks: CatalogIntegrityCheck[] = [];

  // ── 1. Every archetype row has code, sort_order, and (if is_archetype) a dominant_dimension_id ──
  const archetypeResult = await db.query<{
    name: string; code: string | null; sort_order: number | null;
    is_archetype: boolean; dominant_dimension_id: number | null;
  }>(`SELECT name, code, sort_order, is_archetype, dominant_dimension_id FROM archetype`);
  const check1Details: string[] = [];
  for (const row of archetypeResult.rows) {
    if (!row.code) check1Details.push(`"${row.name}": code is null`);
    if (row.sort_order == null) check1Details.push(`"${row.name}": sort_order is null`);
    if (row.is_archetype && row.dominant_dimension_id == null) check1Details.push(`"${row.name}": is_archetype=true but dominant_dimension_id is null`);
  }
  checks.push({
    id: 1,
    name: 'Every archetype row has code, sort_order, and a dominant_dimension_id when is_archetype',
    pass: check1Details.length === 0,
    expected: 'no missing code / sort_order / dominant_dimension_id',
    actual: check1Details.length === 0 ? 'all rows complete' : `${check1Details.length} problem(s)`,
    details: check1Details.length ? check1Details : undefined,
  });

  // ── 2. coffee_dial_slot: exactly 4 active rows + 1 landing default per archetype ──
  const slotCountResult = await db.query<{ archetype: string; active_count: string; default_count: string }>(
    `SELECT archetype,
            COUNT(*) FILTER (WHERE is_active)          AS active_count,
            COUNT(*) FILTER (WHERE is_landing_default)  AS default_count
     FROM coffee_dial_slot
     GROUP BY archetype`
  );
  const check2Details: string[] = [];
  for (const row of slotCountResult.rows) {
    if (Number(row.active_count) !== 4) check2Details.push(`${row.archetype}: ${row.active_count} active slot(s) (expected 4)`);
    if (Number(row.default_count) !== 1) check2Details.push(`${row.archetype}: ${row.default_count} landing-default slot(s) (expected 1)`);
  }
  checks.push({
    id: 2,
    name: 'coffee_dial_slot has exactly 4 active rows and 1 landing default per archetype',
    pass: check2Details.length === 0,
    expected: '4 active sort_order 1-4 rows + exactly 1 is_landing_default per archetype',
    actual: check2Details.length === 0 ? 'all archetypes correct' : `${check2Details.length} problem(s)`,
    details: check2Details.length ? check2Details : undefined,
  });

  // ── 3. Every required index exists ────────────────────────────────────────
  const indexResult = await db.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE indexname = ANY($1::text[])`,
    [REQUIRED_INDEXES]
  );
  const foundIndexes = new Set(indexResult.rows.map(r => r.indexname));
  const missingIndexes = REQUIRED_INDEXES.filter(name => !foundIndexes.has(name));
  checks.push({
    id: 3,
    name: 'Every required index exists',
    pass: missingIndexes.length === 0,
    expected: REQUIRED_INDEXES.join(', '),
    actual: missingIndexes.length === 0 ? 'all present' : `missing: ${missingIndexes.join(', ')}`,
    details: missingIndexes.length ? missingIndexes : undefined,
  });

  // ── 4. Every active coffee_slot_assignment points at an active coffee and slot ──
  const badAssignmentResult = await db.query<{ id: number; coffee_id: number; slot_id: number }>(
    `SELECT csa.id, csa.coffee_id, csa.slot_id
     FROM coffee_slot_assignment csa
     JOIN coffees c ON c.id = csa.coffee_id
     JOIN coffee_dial_slot s ON s.id = csa.slot_id
     WHERE csa.is_active = true AND (c.is_active = false OR s.is_active = false)`
  );
  const check4Details = badAssignmentResult.rows.map(r => `assignment ${r.id} (coffee ${r.coffee_id}, slot ${r.slot_id})`);
  checks.push({
    id: 4,
    name: 'Every active coffee_slot_assignment points at an active coffee and an active slot',
    pass: check4Details.length === 0,
    expected: 'zero active assignments on an inactive coffee or slot',
    actual: check4Details.length === 0 ? 'all active assignments valid' : `${check4Details.length} invalid assignment(s)`,
    details: check4Details.length ? check4Details : undefined,
  });

  // ── 5. Every active coffee with an active assignment has exactly one active home ──
  const homeCountResult = await db.query<{ coffee_id: number; home_count: string }>(
    `SELECT c.id AS coffee_id, COUNT(csa.id) FILTER (WHERE csa.role = 'home') AS home_count
     FROM coffees c
     JOIN coffee_slot_assignment any_csa ON any_csa.coffee_id = c.id AND any_csa.is_active = true
     LEFT JOIN coffee_slot_assignment csa ON csa.coffee_id = c.id AND csa.is_active = true AND csa.role = 'home'
     WHERE c.is_active = true
     GROUP BY c.id
     HAVING COUNT(csa.id) FILTER (WHERE csa.role = 'home') <> 1`
  );
  const check5Details = homeCountResult.rows.map(r => `coffee ${r.coffee_id}: ${r.home_count} active home assignment(s) (expected exactly 1)`);
  checks.push({
    id: 5,
    name: 'Every active coffee with an active assignment has exactly one active home',
    pass: check5Details.length === 0,
    expected: 'exactly 1 active home assignment per active-and-assigned coffee',
    actual: check5Details.length === 0 ? 'all correct' : `${check5Details.length} problem(s)`,
    details: check5Details.length ? check5Details : undefined,
  });

  // ── 6. Every active coffee has a current match archetype and a roaster_id ────
  const missingMatchResult = await db.query<{ id: number; name: string; missing_match: boolean; missing_roaster: boolean }>(
    `SELECT c.id, c.name,
            NOT EXISTS (SELECT 1 FROM archetype_assignments aa WHERE aa.coffee_id = c.id AND aa.superseded_at IS NULL) AS missing_match,
            c.roaster_id IS NULL AS missing_roaster
     FROM coffees c
     WHERE c.is_active = true
       AND (NOT EXISTS (SELECT 1 FROM archetype_assignments aa WHERE aa.coffee_id = c.id AND aa.superseded_at IS NULL) OR c.roaster_id IS NULL)`
  );
  const check6Details = missingMatchResult.rows.map(r => {
    const problems = [r.missing_match && 'no current archetype_assignments row', r.missing_roaster && 'no roaster_id'].filter(Boolean);
    return `coffee ${r.id} "${r.name}": ${problems.join(', ')}`;
  });
  checks.push({
    id: 6,
    name: 'Every active coffee has a current match archetype and a roaster_id',
    pass: check6Details.length === 0,
    expected: 'every active coffee has a non-superseded archetype_assignments row and roaster_id',
    actual: check6Details.length === 0 ? 'all active coffees complete' : `${check6Details.length} coffee(s) missing one or both`,
    details: check6Details.length ? check6Details : undefined,
  });

  // ── 7. v_coffee_slot: placement vs. match divergence — informational (D1) ──
  const divergenceResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM v_coffee_slot WHERE placement_matches_match = false`
  );
  checks.push({
    id: 7,
    name: 'Placement vs. match archetype divergence (informational, not a failure)',
    pass: true,
    expected: 'n/a — divergence is a legitimate state (D1)',
    actual: `${divergenceResult.rows[0].count} row(s) where placement_archetype <> match_archetype`,
    severity: 'info',
  });

  // ── 8. Placed but not sellable at 12 oz — informational ───────────────────
  const placedNotSellableResult = await db.query<{ slot_id: number; slot_name: string; reason: string }>(
    `SELECT DISTINCT s.id AS slot_id, s.name AS slot_name,
       CASE
         WHEN s.name IS NULL THEN 'no name'
         WHEN NOT EXISTS (
           SELECT 1 FROM coffee_slot_assignment csa2
           JOIN coffees c2 ON c2.id = csa2.coffee_id AND c2.is_active = true
           JOIN roaster_blend rb ON rb.coffee_id = c2.id AND rb.is_active = true AND rb.weight_oz = 12
           WHERE csa2.slot_id = s.id AND csa2.is_active = true
         ) THEN 'no active 12 oz SKU'
         ELSE 'no price'
       END AS reason
     FROM coffee_dial_slot s
     JOIN coffee_slot_assignment csa ON csa.slot_id = s.id AND csa.is_active = true
     WHERE s.is_active = true
       AND NOT EXISTS (SELECT 1 FROM v_coffee_sellable_slot vs WHERE vs.slot_id = s.id AND vs.weight_oz = 12)`
  );
  checks.push({
    id: 8,
    name: 'Placed but not sellable at 12 oz (informational)',
    pass: true,
    expected: 'n/a — listed so Dana can see what still needs a SKU/price',
    actual: `${placedNotSellableResult.rows.length} slot(s) placed but not sellable at 12 oz`,
    details: placedNotSellableResult.rows.length
      ? placedNotSellableResult.rows.map(r => `slot ${r.slot_id} "${r.slot_name}": ${r.reason}`)
      : undefined,
    severity: 'info',
  });

  // ── 9. Sellable slot count per archetype at 12 oz — informational ────────
  const sellableCountResult = await db.query<{ archetype: string; count: string }>(
    `SELECT archetype, COUNT(DISTINCT slot_id) AS count FROM v_coffee_sellable_slot WHERE weight_oz = 12 GROUP BY archetype ORDER BY archetype`
  );
  checks.push({
    id: 9,
    name: 'Sellable slots per archetype at 12 oz (informational)',
    pass: true,
    expected: 'n/a',
    actual: sellableCountResult.rows.length
      ? sellableCountResult.rows.map(r => `${r.archetype}: ${r.count}`).join(', ')
      : 'no sellable slots at 12 oz',
    severity: 'info',
  });

  // ── 10. v_coffee_hop: stored vs. derived hop_type disagree, or a stale hop —
  // scoped to hops between active coffees only (CTO review round, 2026-09-13).
  // A hop whose endpoint coffee is inactive is inert history (N3 keeps
  // Path/Temecula coffees as inactive rows, not something to flag), not a
  // stale hop — only a hop between two currently-active coffees missing a
  // home assignment is a real gap worth failing on. ─────────────────────────
  const badHopResult = await db.query<{ id: number }>(
    `SELECT id FROM v_coffee_hop
     WHERE from_coffee_is_active = true AND to_coffee_is_active = true
       AND (hop_type_stored IS DISTINCT FROM hop_type_derived
            OR from_slot_id IS NULL OR to_slot_id IS NULL)`
  );
  const check10Details = badHopResult.rows.map(r => `hop ${r.id}`);
  checks.push({
    id: 10,
    name: 'v_coffee_hop: among hops between active coffees, hop_type_stored matches hop_type_derived and both ends have an active home',
    pass: check10Details.length === 0,
    expected: 'zero mismatched or stale hops among hops between active coffees',
    actual: check10Details.length === 0 ? 'all hops between active coffees are current' : `${check10Details.length} mismatched/stale hop(s) among hops between active coffees`,
    details: check10Details.length ? check10Details : undefined,
  });

  // ── 11. Active coffees whose roaster_name falls back to the free-text column ──
  const fallbackResult = await db.query<{ id: number; name: string }>(
    `SELECT id, name FROM v_coffee WHERE is_active = true AND roaster_name_is_fallback = true`
  );
  const check11Details = fallbackResult.rows.map(r => `coffee ${r.id} "${r.name}"`);
  checks.push({
    id: 11,
    name: 'No active coffee falls back to the free-text roaster column',
    pass: check11Details.length === 0,
    expected: 'zero active coffees with roaster_name_is_fallback = true',
    actual: check11Details.length === 0 ? 'all active coffees have roaster_id' : `${check11Details.length} coffee(s) on the fallback`,
    details: check11Details.length ? check11Details : undefined,
  });

  // ── 12. dial_slot_price / user_bloom_dial_current_position rows missing slot_id ──
  const nullSlotPriceResult = await db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM dial_slot_price WHERE slot_id IS NULL`);
  const nullSlotPositionResult = await db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM user_bloom_dial_current_position WHERE slot_id IS NULL`);
  const nullPriceCount = Number(nullSlotPriceResult.rows[0].count);
  const nullPositionCount = Number(nullSlotPositionResult.rows[0].count);
  const check12Details: string[] = [];
  if (nullPriceCount > 0) check12Details.push(`dial_slot_price: ${nullPriceCount} row(s) with slot_id IS NULL`);
  if (nullPositionCount > 0) check12Details.push(`user_bloom_dial_current_position: ${nullPositionCount} row(s) with slot_id IS NULL`);
  checks.push({
    id: 12,
    name: 'dial_slot_price and user_bloom_dial_current_position have no un-backfilled slot_id',
    pass: check12Details.length === 0,
    expected: 'zero rows with slot_id IS NULL in either table',
    actual: check12Details.length === 0 ? 'fully backfilled' : `${check12Details.length} table(s) with gaps`,
    details: check12Details.length ? check12Details : undefined,
  });

  // ── 13. Legacy placement tables still populated for ACTIVE coffees ────────
  // Informational until brief 3 (readers still use these tables); becomes a
  // real failure in brief 5 once nothing reads them anymore.
  const legacyPositionsResult = await db.query<{ id: number; coffee_id: number }>(
    `SELECT dap.id, dap.coffee_id FROM dial_archetype_positions dap
     JOIN coffees c ON c.id = dap.coffee_id WHERE c.is_active = true`
  );
  const legacyAliasResult = await db.query<{ id: number; coffee_id: number }>(
    `SELECT ca.id, ca.coffee_id FROM coffee_alias ca
     JOIN coffees c ON c.id = ca.coffee_id WHERE c.is_active = true`
  );
  const check13Details = [
    ...legacyPositionsResult.rows.map(r => `dial_archetype_positions ${r.id} (coffee ${r.coffee_id})`),
    ...legacyAliasResult.rows.map(r => `coffee_alias ${r.id} (coffee ${r.coffee_id})`),
  ];
  checks.push({
    id: 13,
    name: 'Legacy placement tables (dial_archetype_positions, coffee_alias) have no rows for active coffees',
    pass: check13Details.length === 0,
    expected: 'zero legacy rows for active coffees (informational until brief 3; a real failure from brief 5)',
    actual: check13Details.length === 0 ? 'none found' : `${check13Details.length} legacy row(s) for active coffees`,
    details: check13Details.length ? check13Details : undefined,
    severity: 'info',
  });

  const allPass = checks.every(c => (c.severity ?? 'fail') !== 'fail' || c.pass);
  return {
    ranAt: new Date().toISOString(),
    allPass,
    checks: checks.sort((a, b) => a.id - b.id),
  };
}
