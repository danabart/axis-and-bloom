import { db } from '../db/client.js';
import type { Tx } from '../db/client.js';
import { getNotSellable } from './catalogReads.js';

// ── Catalog Blueprint · brief 1 — integrity check service ────────────────────
// Clone of quizIntegrity.ts's shape. Read-only — this service never writes or
// repairs anything. Every check is a real query against the live schema
// (archetype, coffee_dial_slot, coffee_slot_assignment, and the five
// v_coffee_* views). See backend/src/features/catalog_blueprint/
// CLAUDE_CODE_PROMPT_CATALOG_1_SCHEMA_VIEWS_INTEGRITY.md, Part D, for the
// numbered spec each check below implements.
//
// Brief 2 (2026-09-14, Part A3) refactored each check into its own function
// taking an optional CheckScope so catalogService.ts's verbs can re-run just
// checks 4/5/6/8 for the coffee/slot they touched, inside the same write
// transaction (via `tx`), instead of re-running all 13 globally after every
// write. runCatalogIntegrityChecks() composes all 13 unscoped, unchanged in
// output shape from brief 1.

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

// coffeeId/slotId narrow checks 4/5/6/8 to the row(s) a write just touched;
// ignored by checks with no natural coffee/slot scope (1,2,3,7,9,10,11,12,13),
// which always run globally but still honor `tx` so they see the write's own
// uncommitted state when called from inside a verb's transaction.
export interface CheckScope {
  coffeeId?: number;
  slotId?: number;
  tx?: Tx;
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

// ── 1. Every archetype row has code, sort_order, and (if is_archetype) a dominant_dimension_id ──
export async function checkArchetypeIdentity(scope: CheckScope = {}): Promise<CatalogIntegrityCheck> {
  const runner = scope.tx ?? db;
  const archetypeResult = await runner.query<{
    name: string; code: string | null; sort_order: number | null;
    is_archetype: boolean; dominant_dimension_id: number | null;
  }>(`SELECT name, code, sort_order, is_archetype, dominant_dimension_id FROM archetype`);
  const details: string[] = [];
  for (const row of archetypeResult.rows) {
    if (!row.code) details.push(`"${row.name}": code is null`);
    if (row.sort_order == null) details.push(`"${row.name}": sort_order is null`);
    if (row.is_archetype && row.dominant_dimension_id == null) details.push(`"${row.name}": is_archetype=true but dominant_dimension_id is null`);
  }
  return {
    id: 1,
    name: 'Every archetype row has code, sort_order, and a dominant_dimension_id when is_archetype',
    pass: details.length === 0,
    expected: 'no missing code / sort_order / dominant_dimension_id',
    actual: details.length === 0 ? 'all rows complete' : `${details.length} problem(s)`,
    details: details.length ? details : undefined,
  };
}

// ── 2. coffee_dial_slot: exactly 4 active rows + 1 landing default per archetype ──
export async function checkDialSlotCounts(scope: CheckScope = {}): Promise<CatalogIntegrityCheck> {
  const runner = scope.tx ?? db;
  const slotCountResult = await runner.query<{ archetype: string; active_count: string; default_count: string }>(
    `SELECT archetype,
            COUNT(*) FILTER (WHERE is_active)          AS active_count,
            COUNT(*) FILTER (WHERE is_landing_default)  AS default_count
     FROM coffee_dial_slot
     GROUP BY archetype`
  );
  const details: string[] = [];
  for (const row of slotCountResult.rows) {
    if (Number(row.active_count) !== 4) details.push(`${row.archetype}: ${row.active_count} active slot(s) (expected 4)`);
    if (Number(row.default_count) !== 1) details.push(`${row.archetype}: ${row.default_count} landing-default slot(s) (expected 1)`);
  }
  return {
    id: 2,
    name: 'coffee_dial_slot has exactly 4 active rows and 1 landing default per archetype',
    pass: details.length === 0,
    expected: '4 active sort_order 1-4 rows + exactly 1 is_landing_default per archetype',
    actual: details.length === 0 ? 'all archetypes correct' : `${details.length} problem(s)`,
    details: details.length ? details : undefined,
  };
}

// ── 3. Every required index exists ────────────────────────────────────────
export async function checkRequiredIndexes(scope: CheckScope = {}): Promise<CatalogIntegrityCheck> {
  const runner = scope.tx ?? db;
  const indexResult = await runner.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE indexname = ANY($1::text[])`,
    [REQUIRED_INDEXES]
  );
  const foundIndexes = new Set(indexResult.rows.map(r => r.indexname));
  const missingIndexes = REQUIRED_INDEXES.filter(name => !foundIndexes.has(name));
  return {
    id: 3,
    name: 'Every required index exists',
    pass: missingIndexes.length === 0,
    expected: REQUIRED_INDEXES.join(', '),
    actual: missingIndexes.length === 0 ? 'all present' : `missing: ${missingIndexes.join(', ')}`,
    details: missingIndexes.length ? missingIndexes : undefined,
  };
}

// ── 4. Every active coffee_slot_assignment points at an active coffee and slot ──
export async function checkActiveAssignmentsValid(scope: CheckScope = {}): Promise<CatalogIntegrityCheck> {
  const runner = scope.tx ?? db;
  const badAssignmentResult = await runner.query<{ id: number; coffee_id: number; slot_id: number }>(
    `SELECT csa.id, csa.coffee_id, csa.slot_id
     FROM coffee_slot_assignment csa
     JOIN coffees c ON c.id = csa.coffee_id
     JOIN coffee_dial_slot s ON s.id = csa.slot_id
     WHERE csa.is_active = true AND (c.is_active = false OR s.is_active = false)
       AND ($1::int IS NULL OR csa.coffee_id = $1)
       AND ($2::int IS NULL OR csa.slot_id = $2)`,
    [scope.coffeeId ?? null, scope.slotId ?? null]
  );
  const details = badAssignmentResult.rows.map(r => `assignment ${r.id} (coffee ${r.coffee_id}, slot ${r.slot_id})`);
  return {
    id: 4,
    name: 'Every active coffee_slot_assignment points at an active coffee and an active slot',
    pass: details.length === 0,
    expected: 'zero active assignments on an inactive coffee or slot',
    actual: details.length === 0 ? 'all active assignments valid' : `${details.length} invalid assignment(s)`,
    details: details.length ? details : undefined,
  };
}

// ── 5. Every active coffee with an active assignment has exactly one active home ──
export async function checkOneActiveHome(scope: CheckScope = {}): Promise<CatalogIntegrityCheck> {
  const runner = scope.tx ?? db;
  // A coffee with both an active home AND an active guest row previously
  // double-counted the home here — the old query joined "any active
  // assignment" separately from "the home row," so a coffee with 1 home + 1
  // guest produced a cross-joined home_count of 2. Found by
  // catalogImport.test.ts (brief 2): the first fixture ever to give one
  // coffee both roles at once. Fixed by counting roles within one join.
  const homeCountResult = await runner.query<{ coffee_id: number; home_count: string }>(
    `SELECT c.id AS coffee_id, COUNT(*) FILTER (WHERE csa.role = 'home') AS home_count
     FROM coffees c
     JOIN coffee_slot_assignment csa ON csa.coffee_id = c.id AND csa.is_active = true
     WHERE c.is_active = true
       AND ($1::int IS NULL OR c.id = $1)
     GROUP BY c.id
     HAVING COUNT(*) FILTER (WHERE csa.role = 'home') <> 1`,
    [scope.coffeeId ?? null]
  );
  const details = homeCountResult.rows.map(r => `coffee ${r.coffee_id}: ${r.home_count} active home assignment(s) (expected exactly 1)`);
  return {
    id: 5,
    name: 'Every active coffee with an active assignment has exactly one active home',
    pass: details.length === 0,
    expected: 'exactly 1 active home assignment per active-and-assigned coffee',
    actual: details.length === 0 ? 'all correct' : `${details.length} problem(s)`,
    details: details.length ? details : undefined,
  };
}

// ── 6. Every active coffee has a current match archetype and a roaster_id ────
export async function checkActiveCoffeeMatchAndRoaster(scope: CheckScope = {}): Promise<CatalogIntegrityCheck> {
  const runner = scope.tx ?? db;
  const missingMatchResult = await runner.query<{ id: number; name: string; missing_match: boolean; missing_roaster: boolean }>(
    `SELECT c.id, c.name,
            NOT EXISTS (SELECT 1 FROM archetype_assignments aa WHERE aa.coffee_id = c.id AND aa.superseded_at IS NULL) AS missing_match,
            c.roaster_id IS NULL AS missing_roaster
     FROM coffees c
     WHERE c.is_active = true
       AND ($1::int IS NULL OR c.id = $1)
       AND (NOT EXISTS (SELECT 1 FROM archetype_assignments aa WHERE aa.coffee_id = c.id AND aa.superseded_at IS NULL) OR c.roaster_id IS NULL)`,
    [scope.coffeeId ?? null]
  );
  const details = missingMatchResult.rows.map(r => {
    const problems = [r.missing_match && 'no current archetype_assignments row', r.missing_roaster && 'no roaster_id'].filter(Boolean);
    return `coffee ${r.id} "${r.name}": ${problems.join(', ')}`;
  });
  return {
    id: 6,
    name: 'Every active coffee has a current match archetype and a roaster_id',
    pass: details.length === 0,
    expected: 'every active coffee has a non-superseded archetype_assignments row and roaster_id',
    actual: details.length === 0 ? 'all active coffees complete' : `${details.length} coffee(s) missing one or both`,
    details: details.length ? details : undefined,
  };
}

// ── 7. v_coffee_slot: placement vs. match divergence — informational (D1) ──
export async function checkPlacementDivergence(scope: CheckScope = {}): Promise<CatalogIntegrityCheck> {
  const runner = scope.tx ?? db;
  const divergenceResult = await runner.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM v_coffee_slot WHERE placement_matches_match = false`
  );
  return {
    id: 7,
    name: 'Placement vs. match archetype divergence (informational, not a failure)',
    pass: true,
    expected: 'n/a — divergence is a legitimate state (D1)',
    actual: `${divergenceResult.rows[0].count} row(s) where placement_archetype <> match_archetype`,
    severity: 'info',
  };
}

// ── 8. Placed but not sellable at 12 oz — informational ───────────────────
// Catalog Blueprint brief 4, Part D — extracted into catalogReads.getNotSellable()
// so GET /api/admin/catalog/not-sellable and this check share one query and
// can never drift apart. Reason strings kept human-readable here; the
// endpoint returns the same underlying reason codes as a machine-readable array.
export async function checkPlacedNotSellable(scope: CheckScope = {}): Promise<CatalogIntegrityCheck> {
  const runner = scope.tx ?? db;
  const notSellable = await getNotSellable({ slotId: scope.slotId }, runner);
  const REASON_TEXT: Record<string, string> = {
    coffee_inactive: 'coffee inactive', category_excluded: 'category excluded',
    no_active_12oz_sku: 'no active 12 oz SKU', no_price_12oz: 'no price',
  };
  return {
    id: 8,
    name: 'Placed but not sellable at 12 oz (informational)',
    pass: true,
    expected: 'n/a — listed so Dana can see what still needs a SKU/price',
    actual: `${notSellable.length} slot(s) placed but not sellable at 12 oz`,
    details: notSellable.length
      ? notSellable.map(r => `slot ${r.slot_id} "${r.slot_name}" (${r.coffee_name}): ${r.reasons.map(reason => REASON_TEXT[reason]).join(', ')}`)
      : undefined,
    severity: 'info',
  };
}

// ── 9. Sellable slot count per archetype at 12 oz — informational ────────
export async function checkSellableCounts(scope: CheckScope = {}): Promise<CatalogIntegrityCheck> {
  const runner = scope.tx ?? db;
  const sellableCountResult = await runner.query<{ archetype: string; count: string }>(
    `SELECT archetype, COUNT(DISTINCT slot_id) AS count FROM v_coffee_sellable_slot WHERE weight_oz = 12 GROUP BY archetype ORDER BY archetype`
  );
  return {
    id: 9,
    name: 'Sellable slots per archetype at 12 oz (informational)',
    pass: true,
    expected: 'n/a',
    actual: sellableCountResult.rows.length
      ? sellableCountResult.rows.map(r => `${r.archetype}: ${r.count}`).join(', ')
      : 'no sellable slots at 12 oz',
    severity: 'info',
  };
}

// ── 10. v_coffee_hop: a stale hop — scoped to hops between active coffees
// only (CTO review round, 2026-09-13). A hop whose endpoint coffee is
// inactive is inert history (N3 keeps Path/Temecula coffees as inactive
// rows, not something to flag), not a stale hop — only a hop between two
// currently-active coffees missing a home assignment is a real gap worth
// failing on. Catalog Blueprint brief 5a dropped the stored-vs-derived
// hop_type half of this check along with the stored column itself (D3) —
// hop_type_derived is the only hop type now, nothing to diff it against. ──
export async function checkHopConsistency(scope: CheckScope = {}): Promise<CatalogIntegrityCheck> {
  const runner = scope.tx ?? db;
  const badHopResult = await runner.query<{ id: number }>(
    `SELECT id FROM v_coffee_hop
     WHERE from_coffee_is_active = true AND to_coffee_is_active = true
       AND (from_slot_id IS NULL OR to_slot_id IS NULL)`
  );
  const details = badHopResult.rows.map(r => `hop ${r.id}`);
  return {
    id: 10,
    name: 'v_coffee_hop: among hops between active coffees, both ends have an active home',
    pass: details.length === 0,
    expected: 'zero stale hops among hops between active coffees',
    actual: details.length === 0 ? 'all hops between active coffees are current' : `${details.length} stale hop(s) among hops between active coffees`,
    details: details.length ? details : undefined,
  };
}

// ── 11. Active coffees without a roaster_id — guaranteed by the NOT NULL
// constraint (Catalog Blueprint brief 5a) but kept as a cheap assertion; the
// free-text roaster_name fallback and roaster_name_is_fallback flag this
// check used to count are gone along with coffees.roaster itself. ──────────
export async function checkRoasterFallback(scope: CheckScope = {}): Promise<CatalogIntegrityCheck> {
  const runner = scope.tx ?? db;
  const fallbackResult = await runner.query<{ id: number; name: string }>(
    `SELECT id, name FROM v_coffee WHERE is_active = true AND roaster_id IS NULL`
  );
  const details = fallbackResult.rows.map(r => `coffee ${r.id} "${r.name}"`);
  return {
    id: 11,
    name: 'Every active coffee has a roaster_id',
    pass: details.length === 0,
    expected: 'zero active coffees with roaster_id IS NULL',
    actual: details.length === 0 ? 'all active coffees have roaster_id' : `${details.length} coffee(s) missing roaster_id`,
    details: details.length ? details : undefined,
  };
}

// ── 12. dial_slot_price / user_bloom_dial_current_position rows missing slot_id ──
export async function checkSlotIdBackfill(scope: CheckScope = {}): Promise<CatalogIntegrityCheck> {
  const runner = scope.tx ?? db;
  const nullSlotPriceResult = await runner.query<{ count: string }>(`SELECT COUNT(*) AS count FROM dial_slot_price WHERE slot_id IS NULL`);
  const nullSlotPositionResult = await runner.query<{ count: string }>(`SELECT COUNT(*) AS count FROM user_bloom_dial_current_position WHERE slot_id IS NULL`);
  const nullPriceCount = Number(nullSlotPriceResult.rows[0].count);
  const nullPositionCount = Number(nullSlotPositionResult.rows[0].count);
  const details: string[] = [];
  if (nullPriceCount > 0) details.push(`dial_slot_price: ${nullPriceCount} row(s) with slot_id IS NULL`);
  if (nullPositionCount > 0) details.push(`user_bloom_dial_current_position: ${nullPositionCount} row(s) with slot_id IS NULL`);
  return {
    id: 12,
    name: 'dial_slot_price and user_bloom_dial_current_position have no un-backfilled slot_id',
    pass: details.length === 0,
    expected: 'zero rows with slot_id IS NULL in either table',
    actual: details.length === 0 ? 'fully backfilled' : `${details.length} table(s) with gaps`,
    details: details.length ? details : undefined,
  };
}

// ── 13. No legacy placement objects exist ──────────────────────────────────
// Was "legacy placement tables still populated for active coffees"
// (informational, since brief 3's readers no longer used them but the tables
// still existed). Catalog Blueprint brief 5a dropped all seven objects
// outright, so the check flips to asserting none of them exist at all — a
// real failure (not informational) if any comes back, since that would mean
// a rollback or a stray recreation.
const LEGACY_PLACEMENT_OBJECTS = [
  'dial_archetype_positions', 'coffee_alias', 'dial_slot_alias',
  'dial_position_vocabulary', 'dial_archetype_config', 'v_dial_positions', 'v_dial_navigation',
];
export async function checkLegacyRowsForActiveCoffees(scope: CheckScope = {}): Promise<CatalogIntegrityCheck> {
  const runner = scope.tx ?? db;
  const existsResult = await runner.query<{ name: string }>(
    `SELECT name FROM unnest($1::text[]) AS name WHERE to_regclass('public.' || name) IS NOT NULL`,
    [LEGACY_PLACEMENT_OBJECTS]
  );
  const details = existsResult.rows.map(r => `${r.name} still exists`);
  return {
    id: 13,
    name: 'No legacy placement objects exist',
    pass: details.length === 0,
    expected: 'none of the seven legacy placement tables/views exist',
    actual: details.length === 0 ? 'none found' : `${details.length} legacy object(s) still exist`,
    details: details.length ? details : undefined,
    severity: 'fail',
  };
}

const ALL_CHECKS = [
  checkArchetypeIdentity,
  checkDialSlotCounts,
  checkRequiredIndexes,
  checkActiveAssignmentsValid,
  checkOneActiveHome,
  checkActiveCoffeeMatchAndRoaster,
  checkPlacementDivergence,
  checkPlacedNotSellable,
  checkSellableCounts,
  checkHopConsistency,
  checkRoasterFallback,
  checkSlotIdBackfill,
  checkLegacyRowsForActiveCoffees,
];

// Optional `tx` (brief 2, Part B) — catalogImport.ts runs the unscoped report
// against its own open transaction so a dry run's "as if applied" report
// (rolled back at the end) and an apply's post-batch report both see the
// batch's own writes, which a separate pool connection wouldn't during an
// uncommitted transaction.
export async function runCatalogIntegrityChecks(scope: { tx?: Tx } = {}): Promise<CatalogIntegrityReport> {
  // Sequential, not Promise.all — when called with `tx` (catalogImport.ts,
  // brief 2) every check shares that one transaction's single connection, and
  // concurrent queries on one pg Client are deprecated. Harmless but
  // negligible overhead when unscoped (each check would otherwise get its own
  // pooled connection) — kept uniform for one code path either way.
  const checks: CatalogIntegrityCheck[] = [];
  for (const fn of ALL_CHECKS) checks.push(await fn(scope));
  const allPass = checks.every(c => (c.severity ?? 'fail') !== 'fail' || c.pass);
  return {
    ranAt: new Date().toISOString(),
    allPass,
    checks: checks.sort((a, b) => a.id - b.id),
  };
}
