import { db, whoAmI } from '../db/client.js';
import type { Tx } from '../db/client.js';
import { firestoreDb } from './firebase-admin.js';

// ── Customer Blueprint · brief C1, Part F (2026-09-27) ────────────────────────
// Clone of catalogIntegrity.ts's shape. Read-only — this service never writes
// or repairs anything. Boot hook in index.ts (non-fatal, console.warn), admin
// route GET /api/admin/customer/integrity, panel AdminCustomerIntegrity.tsx,
// vitest customerIntegrity.test.ts. See backend/src/features/
// customer_blueprint/CLAUDE_CODE_PROMPT_CUSTOMER_1_ROLES_NAMING_DOOR.md, Part F.

export interface CustomerIntegrityCheck {
  id: number;
  name: string;
  pass: boolean;
  expected: string;
  actual: string;
  details?: string[];
  severity?: 'info' | 'fail';
}

export interface CustomerIntegrityReport {
  ranAt: string;
  allPass: boolean;
  checks: CustomerIntegrityCheck[];
}

export interface CheckScope {
  tx?: Tx;
}

const NAMED_FACT_TABLES = ['quiz_session', 'quiz_session_interpretation', 'order', 'order_line_item'];
// Customer Blueprint C3, Part C — user_recommendation_log, user_feedback_event
// and chat_message were dropped (confirmed empty in prod, 2026-09-27).
// sommelier_messages is NOT dropped — it has 9 real legacy rows in prod, still
// read as GET /api/sommelier/:sessionId/messages's pre-Firestore fallback.
const DEAD_TABLES = ['sommelier_messages'];

async function customerFactTables(runner: Tx | typeof db): Promise<string[]> {
  const result = await runner.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'customer\\_%' ESCAPE '\\' AND tablename <> 'customer_order_kind'`
  );
  return result.rows.map(r => r.tablename);
}

// ── 1. Grant coverage, extended per Dana's go-ahead (2026-09-27): also fails
// at boot if ANY view lacks ab_app SELECT, or any customer_*/fact table has
// UPDATE/DELETE granted — not just the originally-spec'd fact list. This is
// the actual enforcement behind schema.sql's closing comment ("keep this
// grant block LAST") — a table/view created below that block after some
// future edit is caught here on the very next boot, not just discouraged by
// a comment. ─────────────────────────────────────────────────────────────────
export async function checkGrantCoverage(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const factTables = [...(await customerFactTables(runner)), 'catalog_change', ...NAMED_FACT_TABLES];
  const details: string[] = [];

  for (const t of factTables) {
    const priv = await runner.query<{ ins: boolean; upd: boolean; del: boolean }>(
      `SELECT has_table_privilege('ab_app', $1, 'INSERT') AS ins,
              has_table_privilege('ab_app', $1, 'UPDATE') AS upd,
              has_table_privilege('ab_app', $1, 'DELETE') AS del`,
      [t]
    );
    const row = priv.rows[0];
    if (!row?.ins) details.push(`${t}: ab_app lacks table-level INSERT`);
    // Table-level UPDATE, not column-level — quiz_session_interpretation's
    // GRANT UPDATE (valid_to, is_current) is a column-level ACL entry and
    // does not make has_table_privilege(..., 'UPDATE') true, so this holds
    // for every fact table with no exception.
    if (row?.upd) details.push(`${t}: ab_app has table-level UPDATE (facts are append-only, D3/D17)`);
    if (row?.del) details.push(`${t}: ab_app has DELETE (facts are append-only, D3/D17)`);
  }

  // The one sanctioned column-level UPDATE (D11) — present on exactly these
  // two columns, absent everywhere else on this table.
  const colPriv = await runner.query<{ valid_to: boolean; is_current: boolean; other: boolean }>(
    `SELECT has_column_privilege('ab_app', 'quiz_session_interpretation', 'valid_to', 'UPDATE') AS valid_to,
            has_column_privilege('ab_app', 'quiz_session_interpretation', 'is_current', 'UPDATE') AS is_current,
            has_column_privilege('ab_app', 'quiz_session_interpretation', 'quiz_session_id', 'UPDATE') AS other`
  );
  const cols = colPriv.rows[0];
  if (!cols?.valid_to || !cols?.is_current) details.push(`quiz_session_interpretation: ab_app missing the sanctioned column-level UPDATE on (valid_to, is_current)`);
  if (cols?.other) details.push(`quiz_session_interpretation: ab_app has UPDATE on quiz_session_id (should only be valid_to, is_current)`);

  // Every view: ab_app must have SELECT. Catches a view created below
  // schema.sql's grant block on some future edit.
  const views = await runner.query<{ viewname: string }>(`SELECT viewname FROM pg_views WHERE schemaname = 'public'`);
  for (const v of views.rows) {
    const sel = await runner.query<{ ok: boolean }>(`SELECT has_table_privilege('ab_app', $1, 'SELECT') AS ok`, [v.viewname]);
    if (!sel.rows[0]?.ok) details.push(`view ${v.viewname}: ab_app lacks SELECT`);
  }

  return {
    id: 1,
    name: 'Grant coverage: every fact table INSERT-only for ab_app, every view SELECT-able',
    pass: details.length === 0,
    expected: 'facts: INSERT true, UPDATE/DELETE false (except the sanctioned valid_to/is_current column grant); every view: SELECT true',
    actual: details.length === 0 ? 'all correct' : `${details.length} problem(s)`,
    details: details.length ? details : undefined,
  };
}

// ── 2. Request pool identity ──────────────────────────────────────────────
export async function checkRequestPoolIdentity(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const currentUser = await whoAmI(runner);
  const isProd = process.env.NODE_ENV === 'production';
  const pass = currentUser === 'ab_app';
  return {
    id: 2,
    name: 'Request pool connects as ab_app',
    pass: isProd ? pass : true,
    expected: 'ab_app',
    actual: currentUser,
    severity: isProd ? 'fail' : 'info',
  };
}

// ── 3. Live immutability probe — always rolled back. Unlike the other
// checks, this one issues its own BEGIN/ROLLBACK, so `scope.tx` must never be
// an outer transaction still in use by its caller (boot and the admin route
// both call runCustomerIntegrityChecks() with no scope, which is the only
// way this check is invoked in this brief). ─────────────────────────────────
export async function checkLiveImmutability(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const currentUser = await whoAmI(runner);
  if (currentUser !== 'ab_app') {
    return {
      id: 3,
      name: 'A no-op UPDATE on quiz_session raises permission denied as ab_app',
      pass: true,
      expected: 'permission denied error',
      actual: `skipped — connected as ${currentUser}, not ab_app`,
      severity: 'info',
    };
  }
  const usingOwnConnection = !scope.tx;
  const client: Tx = scope.tx ?? await db.connect();
  try {
    await client.query('BEGIN');
    let raised = false;
    try {
      // lineage: probe, not a write
      await client.query('UPDATE quiz_session SET id = id WHERE false');
    } catch {
      raised = true;
    }
    await client.query('ROLLBACK');
    return {
      id: 3,
      name: 'A no-op UPDATE on quiz_session raises permission denied as ab_app',
      pass: raised,
      expected: 'permission denied error',
      actual: raised ? 'raised permission denied' : 'succeeded (should have been denied)',
    };
  } finally {
    if (usingOwnConnection) client.release();
  }
}

// ── 4. Common columns and idempotency key ─────────────────────────────────
export async function checkCommonColumns(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const tables = await customerFactTables(runner);
  const details: string[] = [];
  const REQUIRED_COLUMNS = ['occurred_at', 'recorded_at', 'source', 'source_id'];

  for (const t of tables) {
    const colResult = await runner.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
      [t]
    );
    const cols = new Set(colResult.rows.map(r => r.column_name));
    for (const c of REQUIRED_COLUMNS) if (!cols.has(c)) details.push(`${t}: missing column ${c}`);

    const uniqueResult = await runner.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         WHERE rel.relname = $1 AND con.contype = 'u'
           AND con.conkey = (
             SELECT array_agg(attnum ORDER BY attnum) FROM pg_attribute
             WHERE attrelid = rel.oid AND attname IN ('source', 'source_id')
           )
       ) AS exists`,
      [t]
    );
    if (!uniqueResult.rows[0]?.exists) details.push(`${t}: missing UNIQUE (source, source_id)`);

    if (cols.has('user_id')) {
      const idxResult = await runner.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE tablename = $1`, [t]);
      const hasIndex = idxResult.rows.some(r => r.indexdef.includes('(user_id, occurred_at)'));
      if (!hasIndex) details.push(`${t}: missing index on (user_id, occurred_at)`);
    }
  }

  return {
    id: 4,
    name: 'Every customer_* table has the common columns, UNIQUE (source, source_id), and a (user_id, occurred_at) index where user_id exists',
    pass: details.length === 0,
    expected: 'no missing columns, constraints or indexes',
    actual: details.length === 0 ? 'all correct' : `${details.length} problem(s)`,
    details: details.length ? details : undefined,
  };
}

// ── 5. No future facts ─────────────────────────────────────────────────────
export async function checkNoFutureFacts(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const tables = await customerFactTables(runner);
  let total = 0;
  const details: string[] = [];
  for (const t of tables) {
    const result = await runner.query<{ n: string }>(
      `SELECT COUNT(*)::int AS n FROM ${t} WHERE occurred_at > now() + interval '5 minutes'`
    );
    const n = Number(result.rows[0].n);
    if (n > 0) { total += n; details.push(`${t}: ${n} row(s)`); }
  }
  return {
    id: 5,
    name: 'No fact rows with occurred_at more than 5 minutes in the future',
    pass: total === 0,
    expected: '0 rows across all fact tables',
    actual: `${total} row(s)`,
    details: details.length ? details : undefined,
  };
}

// ── 6. catalog_change coverage — informational (Part D) ───────────────────
export async function checkCatalogChangeCoverage(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const earliestResult = await runner.query<{ earliest: string | null }>(`SELECT MIN(occurred_at)::text AS earliest FROM catalog_change`);
  const earliest = earliestResult.rows[0]?.earliest;
  if (!earliest) {
    return {
      id: 6,
      name: 'catalog_change rows >= api_event catalog admin writes since cutover (informational)',
      pass: true,
      expected: 'n/a — measures whether any catalogService.ts verb was missed',
      actual: 'no catalog_change rows yet',
      severity: 'info',
    };
  }
  const changeCountResult = await runner.query<{ n: string }>(`SELECT COUNT(*)::int AS n FROM catalog_change WHERE occurred_at >= $1`, [earliest]);
  const eventCountResult = await runner.query<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM api_event
     WHERE occurred_at >= $1 AND path LIKE '/api/admin/catalog/%'
       AND method IN ('POST', 'PATCH', 'PUT', 'DELETE') AND response_status < 400`,
    [earliest]
  );
  const changeCount = Number(changeCountResult.rows[0].n);
  const eventCount = Number(eventCountResult.rows[0].n);
  return {
    id: 6,
    name: 'catalog_change rows >= api_event catalog admin writes since cutover (informational)',
    pass: true,
    expected: 'n/a — measures whether any catalogService.ts verb was missed',
    actual: `${changeCount} catalog_change row(s) vs ${eventCount} successful catalog admin write(s) since ${earliest}${changeCount < eventCount ? ' — fewer catalog_change rows than admin writes, a verb may be missing its log call' : ''}`,
    severity: 'info',
  };
}

// ── 7. Dead tables are empty — informational ──────────────────────────────
// user_recommendation_log/user_feedback_event/chat_message already dropped
// (Part C); sommelier_messages is the one remaining candidate, non-empty
// today (9 legacy rows) — this check watches for it to reach zero so that
// future drop is provably safe, per the guardrail.
export async function checkDeadTablesEmpty(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const details: string[] = [];
  for (const t of DEAD_TABLES) {
    const result = await runner.query<{ n: string }>(`SELECT COUNT(*)::int AS n FROM ${t}`);
    const n = Number(result.rows[0].n);
    if (n > 0) details.push(`${t}: ${n} row(s)`);
  }
  return {
    id: 7,
    name: 'Dead tables (sommelier_messages) are empty',
    pass: true,
    expected: 'n/a — informational; dropped only once confirmed empty',
    actual: details.length === 0 ? 'all empty' : `${details.length} table(s) non-empty`,
    details: details.length ? details : undefined,
    severity: 'info',
  };
}

// ── 8. order_kind populated ─────────────────────────────────────────────
export async function checkOrderKindPopulated(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const result = await runner.query<{ n: string }>(`SELECT COUNT(*)::int AS n FROM order_line_item WHERE order_kind IS NULL`);
  const n = Number(result.rows[0].n);
  return {
    id: 8,
    name: 'Every order_line_item has a non-null order_kind',
    pass: n === 0,
    expected: '0 rows with order_kind IS NULL',
    actual: `${n} row(s)`,
  };
}

// ── 9. Names follow the convention ─────────────────────────────────────
export async function checkNamingConvention(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const details: string[] = [];
  const factTables = await customerFactTables(runner);
  const grantedResult = await runner.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
       AND (tablename LIKE 'customer\\_%' ESCAPE '\\' OR tablename IN ('quiz_session', 'quiz_session_interpretation', 'order', 'order_line_item'))
       AND tablename <> 'customer_order_kind'`
  );
  const granted = new Set(grantedResult.rows.map(r => r.tablename));
  for (const t of factTables) if (!granted.has(t)) details.push(`${t}: named customer_* but not in the fact grant loop's result`);

  const viewResult = await runner.query<{ viewname: string }>(`SELECT viewname FROM pg_views WHERE schemaname = 'public' AND viewname LIKE 'customer\\_%' ESCAPE '\\'`);
  for (const v of viewResult.rows) details.push(`view ${v.viewname}: starts with customer_ — views should be v_customer_*`);

  return {
    id: 9,
    name: 'Every customer_* table is a covered fact (except customer_order_kind); no view starts with customer_',
    pass: details.length === 0,
    expected: 'naming convention holds',
    actual: details.length === 0 ? 'all correct' : `${details.length} problem(s)`,
    details: details.length ? details : undefined,
  };
}

// ── Customer Blueprint · brief C3, Part C (2026-09-27) — checks 10-12
// (Firestore-vs-fact coexistence parity, C2) are retired: there is no second
// store left to compare once the Part C writers are removed. Replaced by
// checks 13-17 below. ──────────────────────────────────────────────────────

// ── 13. Identity-link cycles = 0 ───────────────────────────────────────────
// Independent of v_customer_identity's own cycle-safe walk (schema.sql) —
// this re-derives the same graph from customer_identity_link directly so a
// bug in the view's own cycle detection would still be caught here.
export async function checkIdentityLinkCycles(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const result = await runner.query<{ start_id: string }>(
    `WITH RECURSIVE walk(start_id, current_id, path, is_cycle) AS (
       SELECT from_user_id, to_user_id, ARRAY[from_user_id, to_user_id], false FROM customer_identity_link
       UNION ALL
       SELECT w.start_id, cil.to_user_id, w.path || cil.to_user_id, cil.to_user_id = ANY(w.path)
       FROM walk w
       JOIN customer_identity_link cil ON cil.from_user_id = w.current_id
       WHERE NOT w.is_cycle AND array_length(w.path, 1) < 8
     )
     SELECT DISTINCT start_id FROM walk WHERE is_cycle`
  );
  const n = result.rows.length;
  return {
    id: 13,
    name: 'customer_identity_link graph has no cycles',
    pass: n === 0,
    expected: '0 profiles on a cyclic identity chain',
    actual: `${n} profile(s)`,
    details: n ? result.rows.map(r => `profile ${r.start_id} is on a cycle`).slice(0, 10) : undefined,
  };
}

// ── 14. Claimed sessions without a link = 0 ────────────────────────────────
// routes/auth.ts's synthetic claimed quiz_session is retired (Part C), but
// existing rows with context_data.claimedFrom = 'newsletter_subscriber' stay
// (facts) — each one should have a matching customer_identity_link pointing
// at its own user_id, from when it was claimed. A row without one means the
// account can no longer see the original quiz it claimed.
export async function checkClaimedSessionsHaveLinks(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const result = await runner.query<{ id: string }>(
    `SELECT qs.id
     FROM quiz_session qs
     WHERE qs.context_data ->> 'claimedFrom' = 'newsletter_subscriber'
       AND NOT EXISTS (SELECT 1 FROM customer_identity_link cil WHERE cil.to_user_id = qs.user_id)`
  );
  const n = result.rows.length;
  return {
    id: 14,
    name: 'Every claimed quiz_session (claimedFrom = newsletter_subscriber) has a customer_identity_link',
    pass: n === 0,
    expected: '0 claimed sessions without a link',
    actual: `${n} session(s)`,
    details: n ? result.rows.map(r => `quiz_session ${r.id} has no identity link`).slice(0, 10) : undefined,
  };
}

// ── 15. No Firestore doc created in a retired collection after cutover ────
// Informational, time-boxed: remove this check (and its Firestore reads)
// CUTOVER_REMOVE_AFTER, once every writer has had 30 days to prove itself
// fully retired (OPEN_TASKS.md). A hit here means an un-retired writer (or a
// new one) is still landing in Firestore.
// Real deploy moment (Cloud Run revision axis-bloom-backend-00699-krp
// creationTimestamp, 2026-09-27T22:23:28Z), not deploy-day midnight — a
// calendar-day cutoff would permanently count the old code's entirely
// legitimate Firestore writes from earlier the same day as "post-cutover",
// masking a real future regression for this check's whole 30-day life.
// Confirmed live in prod on first boot: with a midnight cutoff, this check
// reported 5 sources with "post-cutover" writes, all from before this exact
// deploy went out.
const C3_CUTOVER_AT = new Date('2026-09-27T22:23:28Z');
const C3_CUTOVER_REMOVE_AFTER = new Date('2026-10-27T00:00:00Z');
const RETIRED_FIRESTORE_SOURCES: Array<{ label: string; collectionGroup: string; docId?: string; timestampField: string }> = [
  { label: 'feedback_events', collectionGroup: 'feedback_events', timestampField: 'createdAt' },
  { label: 'dial_events', collectionGroup: 'dial_events', timestampField: 'createdAt' },
  { label: 'metadata/brew_profile', collectionGroup: 'metadata', docId: 'brew_profile', timestampField: 'updatedAt' },
  { label: 'metadata/taste_journey', collectionGroup: 'metadata', docId: 'taste_journey', timestampField: 'lastUpdated' },
  { label: 'metadata/confidence_profile', collectionGroup: 'metadata', docId: 'confidence_profile', timestampField: 'computedAt' },
  { label: 'quiz_sessions', collectionGroup: 'quiz_sessions', timestampField: 'completedAt' },
  { label: 'liam_saves', collectionGroup: 'liam_saves', timestampField: 'createdAt' },
  { label: 'sommelier_evaluations', collectionGroup: 'sommelier_evaluations', timestampField: 'createdAt' },
];
export async function checkNoNewFirestoreWritesToRetiredStores(_scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  if (new Date() > C3_CUTOVER_REMOVE_AFTER) {
    return {
      id: 15,
      name: 'No new Firestore documents in a retired collection since cutover',
      pass: true,
      expected: 'n/a — 30-day window elapsed; remove this check (OPEN_TASKS.md)',
      actual: 'window elapsed',
      severity: 'info',
    };
  }
  const details: string[] = [];
  for (const src of RETIRED_FIRESTORE_SOURCES) {
    try {
      const snap = await firestoreDb.collectionGroup(src.collectionGroup).get();
      let hits = 0;
      for (const doc of snap.docs) {
        if (src.docId && doc.id !== src.docId) continue;
        const ts = doc.data()[src.timestampField]?.toDate?.() as Date | undefined;
        if (ts && ts >= C3_CUTOVER_AT) hits++;
      }
      if (hits) details.push(`${src.label}: ${hits} doc(s) written since cutover`);
    } catch (err) {
      details.push(`${src.label}: read failed (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  return {
    id: 15,
    name: 'No new Firestore documents in a retired collection since cutover',
    pass: true,
    expected: `n/a — informational until ${C3_CUTOVER_REMOVE_AFTER.toISOString().slice(0, 10)}, then remove`,
    actual: details.length === 0 ? 'none found' : `${details.length} source(s) with post-cutover writes`,
    details: details.length ? details : undefined,
    severity: 'info',
  };
}

// ── 16. Every active coffee has a dimension-range row (informational) ─────
// Feeds the future Cupping Blueprint, not a hard requirement today — an
// uncupped active coffee is a real, expected state (Task 0, 2026-09-27: prod
// has exactly 1 active coffee with 0 merged/unmerged cupping rows).
export async function checkActiveCoffeesHaveDimensionRange(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const result = await runner.query<{ id: number }>(
    `SELECT c.id FROM coffees c
     WHERE c.is_active = true
       AND NOT EXISTS (SELECT 1 FROM v_coffee_dimension_range cdr WHERE cdr.coffee_id = c.id)`
  );
  const n = result.rows.length;
  return {
    id: 16,
    name: 'Every active coffee has at least one v_coffee_dimension_range row',
    pass: true,
    expected: 'n/a — informational; feeds the Cupping Blueprint',
    actual: n === 0 ? 'all active coffees have a range' : `${n} active coffee(s) with no range`,
    details: n ? result.rows.map(r => `coffee ${r.id}: no merged or unmerged cupping rows`).slice(0, 10) : undefined,
    severity: 'info',
  };
}

// ── 17. Brew profile replay hits no unknown op ─────────────────────────────
// customer_brew_profile_change.op has a CHECK constraint limiting it to
// set/add/remove/clear, so this should structurally never fail — verifies
// the constraint holds rather than trusting it silently.
export async function checkBrewProfileReplayKnownOps(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  // Usual Drink 1 (2026-11-12): the known ops are the brew_profile_op rows
  // (declined included), no longer a list typed here.
  const runner = scope.tx ?? db;
  const result = await runner.query<{ op: string }>(
    `SELECT DISTINCT c.op FROM customer_brew_profile_change c
     WHERE NOT EXISTS (SELECT 1 FROM brew_profile_op o WHERE o.code = c.op)`
  );
  const n = result.rows.length;
  return {
    id: 17,
    name: 'customer_brew_profile_change.op is always a brew_profile_op code',
    pass: n === 0,
    expected: '0 distinct unknown ops',
    actual: n === 0 ? 'all rows use a known op' : `${n} unknown op(s): ${result.rows.map(r => r.op).join(', ')}`,
  };
}

// ── 18. Every v_customer_*/v_palate_* view the palate fixture exercises has
// exactly the column list backend/src/services/palateReads.test.ts and
// palate_read_fixture_v1.xlsx expect it to have ────────────────────────────
// Dana, 2026-09-27, the same day v_palate_slot_candidates deployed with a
// stale column list live in production (CREATE OR REPLACE VIEW silently
// couldn't reorder its columns — see schema.sql's own comment on that view,
// and lint-customer.mjs Rule 7, which now blocks CREATE OR REPLACE under the
// whole C3 block so this exact failure mode can't recur). That bug was only
// caught by an ad-hoc prod smoke query, after the fact — this check makes
// the same class of failure fail *boot*, not smoke, the next time.
//
// Deviation from the literal instruction, disclosed: this does NOT read
// backend/src/fixtures/palate/expected.json's row keys directly and diff
// them against information_schema.columns. expected.json's row keys are
// test-fixture shorthand, not always the view's real column names —
// concretely, v_palate_slot_candidates' fixture rows key the slot's
// archetype as `slot_archetype` (the view's real column is `archetype`) and
// `coffee_id` in the fixture is the coffee's *name* (a string), while the
// view's real `coffee_id` is an integer — palateReads.test.ts itself has to
// translate both before comparing. A literal key-diff against
// information_schema.columns would therefore permanently fail on
// `slot_archetype` alone, every boot, which is not what "fails boot on a
// real regression" means. Instead, each view's full real column list is
// captured here directly (sourced from the exact columns
// backend/src/db/schema.sql's C3 block defines, cross-checked against
// palateReads.test.ts's own property accesses and expected.json's row
// shapes at the time this check was written) — an exact two-way diff catches
// both a missing column (this deploy's real bug) and an unexpected extra or
// renamed one.
const EXPECTED_PALATE_VIEW_COLUMNS: Record<string, string[]> = {
  v_customer_bag_attribution: ['order_line_item_id', 'order_id', 'coffee_id', 'order_kind', 'drinker_user_id', 'attribution'],
  v_palate_evidence: [
    'canonical_user_id', 'read_version', 'n_attributed_lines', 'n_distinct_coffees', 'n_feedback_positive',
    'n_feedback_negative', 'n_feedback_total', 'n_questions_asked', 'n_questions_answered', 'n_recommendations',
    'n_brew_fields_known', 'first_order_at', 'last_order_at', 'has_quiz',
  ],
  v_palate_shared_traits: ['canonical_user_id', 'kind', 'trait_key', 'trait_label', 'value_min', 'value_max', 'overlaps', 'n_coffees'],
  v_palate_dominant_dimensions: [
    'canonical_user_id', 'dimension_id', 'dimension_name', 'mean_midpoint', 'n_coffees',
    'liked_mean_midpoint', 'n_liked', 'disliked_mean_midpoint', 'n_disliked',
  ],
  v_palate_archetype_spread: ['canonical_user_id', 'match_archetype', 'n_coffees', 'n_positive', 'n_negative'],
  // Liam L3, Part D — session_id/turn added (buildOpenThreadLine's "asked on
  // turn n" rendering).
  v_palate_threads: [
    'canonical_user_id', 'question_id', 'occurred_at', 'kind', 'archetype_code', 'question',
    'session_id', 'turn', 'reply', 'replied_at', 'status',
  ],
  // Liam L3, Part B/E — detected passthrough (marked vs. detected split on
  // the outcomes page).
  v_palate_recommendation_outcome: [
    'canonical_user_id', 'recommendation_id', 'recommended_at', 'coffee_id', 'slot_id', 'detected',
    'followed_order_line_item_id', 'ordered_at', 'days_to_order', 'feedback_rating',
  ],
  v_palate_slot_candidates: [
    'canonical_user_id', 'slot_id', 'archetype', 'sort_order', 'slot_name', 'position_label', 'coffee_id',
    'coffee_name', 'blend_id', 'roaster_sku', 'shopify_variant_id', 'retail_price_cents', 'n_dims_overlapping',
    'n_dims_compared', 'n_dims_disliked_overlap', 'in_pair', 'already_bought', 'last_rating',
  ],
  // Liam L3, Part E — the calibration export surface (new this brief).
  v_customer_calibration: [
    'canonical_user_id', 'email', 'primary_archetype', 'secondary_archetype', 'recommendation_mode',
    'food_signal_alignment', 'experimental', 'quiz_result_json', 'quiz_completed_at', 'quiz_session_id',
    'first_recommendation_coffee', 'first_recommendation_at', 'first_recommendation_detected',
    'first_attributed_order_coffee', 'first_attributed_order_at', 'days_recommendation_to_order',
    'first_order_feedback_rating', 'thread_status', 'thread_reply',
    // Prompt 4B (interpretation v2.2, 2026-10-09) — appended.
    'match_archetype', 'intensity_lean',
  ],
};
export async function checkPalateViewColumnsMatchFixture(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const details: string[] = [];
  for (const [view, expectedCols] of Object.entries(EXPECTED_PALATE_VIEW_COLUMNS)) {
    const result = await runner.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [view]
    );
    const liveCols = result.rows.map(r => r.column_name);
    const liveSet = new Set(liveCols);
    const expectedSet = new Set(expectedCols);
    const missing = expectedCols.filter(c => !liveSet.has(c));
    const extra = liveCols.filter(c => !expectedSet.has(c));
    if (missing.length) details.push(`${view}: missing ${missing.join(', ')} (deployed with stale columns?)`);
    if (extra.length) details.push(`${view}: unexpected column(s) ${extra.join(', ')} (fixture/this manifest needs updating)`);
    if (liveCols.length === 0) details.push(`${view}: view does not exist`);
  }
  return {
    id: 18,
    name: 'Every palate-fixture view has exactly the column list the fixture/test expect',
    pass: details.length === 0,
    expected: 'live column list exactly matches EXPECTED_PALATE_VIEW_COLUMNS for all 9 views',
    actual: details.length === 0 ? 'all correct' : `${details.length} view(s) with a column mismatch`,
    details: details.length ? details : undefined,
  };
}

// ── 19. quiz_session_interpretation is a clean SCD Type 2 ──────────────────
// Exactly one is_current row per session that has rows, and no current row with valid_to set. The partial unique
// index already forbids two current rows; this also catches zero (a close without a successor) and a half-closed
// row, now that the backfill really flips rows (Prompt 4B, Part E).
export async function checkInterpretationScd2(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const r = await runner.query<{ quiz_session_id: string; current: number; half_closed: number }>(
    `SELECT quiz_session_id,
            COUNT(*) FILTER (WHERE is_current)::int AS current,
            COUNT(*) FILTER (WHERE is_current AND valid_to IS NOT NULL)::int AS half_closed
     FROM quiz_session_interpretation
     GROUP BY quiz_session_id
     HAVING COUNT(*) FILTER (WHERE is_current) <> 1 OR COUNT(*) FILTER (WHERE is_current AND valid_to IS NOT NULL) > 0`
  );
  const n = r.rows.length;
  return {
    id: 19,
    name: 'quiz_session_interpretation: exactly one current row per session, none current with valid_to set',
    pass: n === 0,
    expected: '0 sessions with zero/several current rows or a current row with valid_to',
    actual: n === 0 ? 'all sessions clean' : `${n} session(s)`,
    details: n ? r.rows.slice(0, 10).map(x => `session ${x.quiz_session_id}: ${x.current} current, ${x.half_closed} current with valid_to`) : undefined,
  };
}

// ── 20. v2.2 rows carry the match; the lean only on a delicate lane ───────
export async function checkInterpretationMatchFields(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const r = await runner.query<{ id: string; interpretation_version: string; match_archetype: string | null; intensity_lean: string | null }>(
    // The delicate lanes are matched by archetype code (stable), not by display label.
    `SELECT i.id, i.interpretation_version, i.match_archetype, i.intensity_lean
     FROM quiz_session_interpretation i
     LEFT JOIN coffee_archetype ca ON ca.name = i.match_archetype
     WHERE (i.interpretation_version = 'v2.2' AND i.match_archetype IS NULL)
        OR (i.intensity_lean IS NOT NULL AND (ca.code IS NULL OR ca.code::text NOT IN ('fruity', 'floral')))`
  );
  const n = r.rows.length;
  return {
    id: 20,
    name: "Every v2.2 interpretation has match_archetype; intensity_lean only where the match is Fruity or Floral",
    pass: n === 0,
    expected: '0 rows',
    actual: n === 0 ? 'all rows correct' : `${n} row(s)`,
    details: n ? r.rows.slice(0, 10).map(x => `${x.id} (${x.interpretation_version}): match ${x.match_archetype ?? 'null'}, lean ${x.intensity_lean ?? 'null'}`) : undefined,
  };
}

// ── 21. quiz_session.branch_answer_id points at a branch-quiz answer ──────
export async function checkBranchAnswerIsBranch(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const r = await runner.query<{ id: string }>(
    `SELECT qs.id
     FROM quiz_session qs
     LEFT JOIN quiz_answer a   ON a.id = qs.branch_answer_id
     LEFT JOIN quiz_question q ON q.id = a.question_id
     LEFT JOIN quiz bq         ON bq.id = q.quiz_id
     WHERE qs.branch_answer_id IS NOT NULL AND bq.parent_quiz_id IS NULL`
  );
  const n = r.rows.length;
  return {
    id: 21,
    name: 'Every non-null quiz_session.branch_answer_id is an answer of a branch quiz',
    pass: n === 0,
    expected: '0 sessions',
    actual: n === 0 ? 'all correct' : `${n} session(s)`,
    details: n ? r.rows.slice(0, 10).map(x => `session ${x.id}`) : undefined,
  };
}

export async function runCustomerIntegrityChecks(scope: CheckScope = {}): Promise<CustomerIntegrityReport> {
  const checks = [
    await checkGrantCoverage(scope),
    await checkRequestPoolIdentity(scope),
    await checkLiveImmutability(scope),
    await checkCommonColumns(scope),
    await checkNoFutureFacts(scope),
    await checkCatalogChangeCoverage(scope),
    await checkDeadTablesEmpty(scope),
    await checkOrderKindPopulated(scope),
    await checkNamingConvention(scope),
    await checkIdentityLinkCycles(scope),
    await checkClaimedSessionsHaveLinks(scope),
    await checkNoNewFirestoreWritesToRetiredStores(scope),
    await checkActiveCoffeesHaveDimensionRange(scope),
    await checkBrewProfileReplayKnownOps(scope),
    await checkPalateViewColumnsMatchFixture(scope),
    await checkInterpretationScd2(scope),
    await checkInterpretationMatchFields(scope),
    await checkBranchAnswerIsBranch(scope),
    await checkBrewProfileFactsResolve(scope),
    await checkBrewProfileValueRows(scope),
    await checkBrewProfileValuesResolve(scope),
    await checkBrewDecompositions(scope),
    await checkUsualDrinkSeedCoverage(scope),
    await checkBrewProfileForeignKeys(scope),
    await checkBrewFieldsRetiredFromFirestore(scope),
    await checkBrewReferenceGrants(scope),
    await checkGuestsKeptForFacts(scope),
    await checkTakesItVsUsualDrink(scope),
    await checkBrewProfileRowShape(scope),
  ];
  return {
    ranAt: new Date().toISOString(),
    allPass: checks.filter(c => (c.severity ?? 'fail') === 'fail').every(c => c.pass),
    checks,
  };
}

// ── Usual Drink 1 (2026-11-12), Part D: checks 22–32 ──────────────────────────
// All informational (G2.18): they report on the admin panel with detail rows
// and never block. Ids 22–32 because 1–21 are taken (Task 0 deviation 2).
// backend/src/features/usual_drink/CLAUDE_CODE_PROMPT_USUAL_DRINK_1_CAPTURE.md

const UD_INFO = 'info' as const;
function udCheck(id: number, name: string, problems: string[], expected: string, okText: string): CustomerIntegrityCheck {
  return {
    id, name, pass: problems.length === 0, expected,
    actual: problems.length === 0 ? okText : `${problems.length} finding(s)`,
    details: problems.length ? problems.slice(0, 25) : undefined,
    severity: UD_INFO,
  };
}

// The codes the Usual Drink 1 seed inserts (check 26 detects a seed that failed
// at boot; rows in the DB beyond these are allowed). Mirrors the seed in
// schema.sql's USUAL DRINK 1 block, the same way dataCatalogIntegrity lists
// the dial seed codes.
export const USUAL_DRINK_SEED_CODES: Record<string, string[]> = {
  brew_profile_value_kind: ['enum', 'array', 'bool', 'array_freeform'],
  brew_profile_picker: ['select', 'multi_select', 'typeahead', 'toggle', 'freeform_list', 'chips'],
  brew_profile_op: ['set', 'add', 'remove', 'clear', 'declined'],
  brew_profile_field: ['brew_methods', 'grinder', 'takes_it', 'decaf_constraint', 'aversions', 'usual_drink', 'cupboard_coffee', 'coffee_feeling'],
  brew_drink_base_method: ['espresso', 'filter', 'immersion', 'cold_brew', 'stovetop', 'pod', 'none'],
  brew_drink_dilution: ['none', 'water', 'ice'],
  brew_drink_milk: ['none', 'cold', 'steamed'],
  brew_cupboard_brand_kind: ['chain', 'mass_market', 'specialty', 'unknown', 'none'],
  quiz_funnel_event_type: ['quiz_start', 'quiz_complete', 'email_submitted', 'quiz_final', 'post_result_shown', 'post_result_saved', 'post_result_skipped'],
};
export const USUAL_DRINK_SEED_VALUE_COUNTS: Record<string, number> = {
  brew_methods: 8, grinder: 5, takes_it: 4, decaf_constraint: 2, usual_drink: 16, cupboard_coffee: 59, coffee_feeling: 4,
};
const UD_REFERENCE_TABLES = [
  'brew_profile_value_kind', 'brew_profile_picker', 'brew_profile_op', 'brew_profile_field', 'brew_profile_field_value',
  'brew_drink', 'brew_drink_base_method', 'brew_drink_dilution', 'brew_drink_milk', 'brew_cupboard_brand',
  'brew_cupboard_brand_kind', 'brew_cupboard_brand_alias', 'brew_coffee_feeling', 'quiz_funnel_event_type',
];

/** 22 — every fact's field and op is a lookup row; inactive fields still carrying facts are listed (allowed). */
export async function checkBrewProfileFactsResolve(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const r = await runner.query<{ kind: string; code: string; n: number }>(
    `SELECT 'unknown field' AS kind, c.field AS code, count(*)::int AS n FROM customer_brew_profile_change c
       WHERE NOT EXISTS (SELECT 1 FROM brew_profile_field f WHERE f.code = c.field) GROUP BY c.field
     UNION ALL
     SELECT 'unknown op', c.op, count(*)::int FROM customer_brew_profile_change c
       WHERE NOT EXISTS (SELECT 1 FROM brew_profile_op o WHERE o.code = c.op) GROUP BY c.op
     UNION ALL
     SELECT 'inactive field with facts (allowed)', f.code, count(*)::int FROM customer_brew_profile_change c
       JOIN brew_profile_field f ON f.code = c.field WHERE NOT f.is_active GROUP BY f.code`
  );
  const problems = r.rows.filter(x => !x.kind.endsWith('(allowed)')).map(x => `${x.kind}: ${x.code} (${x.n} rows)`);
  const check = udCheck(22, 'customer_brew_profile_change.field / .op resolve to brew_profile_field / brew_profile_op', problems, '0 unresolved rows', 'every row resolves');
  const allowed = r.rows.filter(x => x.kind.endsWith('(allowed)')).map(x => `${x.kind}: ${x.code} (${x.n} rows)`);
  if (allowed.length) check.details = [...(check.details ?? []), ...allowed];
  return check;
}

/** 23 — value rows fit the field's kind and picker. */
export async function checkBrewProfileValueRows(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const r = await runner.query<{ code: string; kind: string; picker: string; active_values: number; all_values: number; pinned: number; codes: string[] }>(
    `SELECT f.code, k.code AS kind, p.code AS picker,
            count(v.id) FILTER (WHERE v.is_active)::int AS active_values, count(v.id)::int AS all_values,
            count(v.id) FILTER (WHERE v.is_active AND v.pinned)::int AS pinned,
            COALESCE(array_agg(v.code ORDER BY v.code) FILTER (WHERE v.id IS NOT NULL), ARRAY[]::text[]) AS codes
     FROM brew_profile_field f JOIN brew_profile_value_kind k ON k.id = f.value_kind_id JOIN brew_profile_picker p ON p.id = f.picker_id
     LEFT JOIN brew_profile_field_value v ON v.field_id = f.id
     WHERE f.is_active GROUP BY f.code, k.code, p.code ORDER BY f.code`
  );
  const problems: string[] = [];
  for (const f of r.rows) {
    if ((f.kind === 'enum' || f.kind === 'array') && f.active_values === 0) problems.push(`${f.code}: no active value`);
    if (f.kind === 'array_freeform' && f.all_values > 0) problems.push(`${f.code}: array_freeform field has value rows`);
    if (f.kind === 'bool' && f.codes.join(',') !== 'false,true') problems.push(`${f.code}: a bool field has exactly the two values true and false (has ${f.codes.join(', ') || 'none'})`);
    if (f.picker === 'typeahead' && f.pinned === 0) problems.push(`${f.code}: typeahead field has no pinned value`);
  }
  return udCheck(23, 'brew-profile value rows fit each field (enum/array ≥1 active, bool exactly true/false, freeform none, typeahead ≥1 pinned)', problems, '0 findings', 'every field fits');
}

/** 24 — every set/add/remove value resolves to a value row of its field (active or not; array: every element). */
export async function checkBrewProfileValuesResolve(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const r = await runner.query<{ id: string; field: string; item: string }>(
    `WITH rows AS (
       SELECT c.id, c.field, c.op, c.value::jsonb AS v FROM customer_brew_profile_change c
       JOIN brew_profile_field f ON f.code = c.field JOIN brew_profile_value_kind k ON k.id = f.value_kind_id
       WHERE c.op IN ('set', 'add', 'remove') AND c.value IS NOT NULL AND k.code IN ('enum', 'array', 'bool')
     ), items AS (
       SELECT id, field, CASE WHEN jsonb_typeof(v) = 'array' THEN e.item ELSE v #>> '{}' END AS item
       FROM rows LEFT JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(v) = 'array' THEN v ELSE '[]'::jsonb END) AS e(item) ON true
       WHERE jsonb_typeof(v) <> 'array' OR e.item IS NOT NULL
     )
     SELECT i.id::text, i.field, i.item FROM items i
     WHERE NOT EXISTS (SELECT 1 FROM brew_profile_field f JOIN brew_profile_field_value fv ON fv.field_id = f.id
                       WHERE f.code = i.field AND fv.code = i.item)
     ORDER BY i.field, i.item LIMIT 50`
  );
  return udCheck(24, 'brew-profile values resolve to a value row of their field', r.rows.map(x => `${x.field}=${x.item} (row ${x.id})`), '0 drift rows', 'every value resolves');
}

/** 25 — decompositions are one-to-one and point back at the right field. */
export async function checkBrewDecompositions(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const r = await runner.query<{ problem: string }>(
    `SELECT 'usual_drink value without brew_drink: ' || fv.code AS problem FROM brew_profile_field_value fv JOIN brew_profile_field f ON f.id = fv.field_id
       WHERE f.code = 'usual_drink' AND NOT EXISTS (SELECT 1 FROM brew_drink d WHERE d.field_value_id = fv.id)
     UNION ALL SELECT 'cupboard_coffee value without brew_cupboard_brand: ' || fv.code FROM brew_profile_field_value fv JOIN brew_profile_field f ON f.id = fv.field_id
       WHERE f.code = 'cupboard_coffee' AND NOT EXISTS (SELECT 1 FROM brew_cupboard_brand b WHERE b.field_value_id = fv.id)
     UNION ALL SELECT 'coffee_feeling value without brew_coffee_feeling: ' || fv.code FROM brew_profile_field_value fv JOIN brew_profile_field f ON f.id = fv.field_id
       WHERE f.code = 'coffee_feeling' AND NOT EXISTS (SELECT 1 FROM brew_coffee_feeling x WHERE x.field_value_id = fv.id)
     UNION ALL SELECT 'brew_drink on a non-usual_drink value: ' || fv.code FROM brew_drink d JOIN brew_profile_field_value fv ON fv.id = d.field_value_id
       JOIN brew_profile_field f ON f.id = fv.field_id WHERE f.code <> 'usual_drink'
     UNION ALL SELECT 'brew_cupboard_brand on a non-cupboard_coffee value: ' || fv.code FROM brew_cupboard_brand b JOIN brew_profile_field_value fv ON fv.id = b.field_value_id
       JOIN brew_profile_field f ON f.id = fv.field_id WHERE f.code <> 'cupboard_coffee'
     UNION ALL SELECT 'brew_coffee_feeling on a non-coffee_feeling value: ' || fv.code FROM brew_coffee_feeling x JOIN brew_profile_field_value fv ON fv.id = x.field_value_id
       JOIN brew_profile_field f ON f.id = fv.field_id WHERE f.code <> 'coffee_feeling'
     UNION ALL SELECT 'brand roaster missing: ' || b.roaster_id::text FROM brew_cupboard_brand b
       WHERE b.roaster_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM roaster r WHERE r.id = b.roaster_id)
     UNION ALL SELECT 'feeling mapped to a non-customer move: ' || m.code FROM brew_coffee_feeling x JOIN dial_move m ON m.id = x.move_id
       WHERE NOT m.is_customer_move`
  );
  return udCheck(25, 'drink, brand and feeling decompositions are one-to-one (feelings map to customer moves)', r.rows.map(x => x.problem), '0 findings', 'all one-to-one');
}

/** 26 — seed coverage: every code the Usual Drink 1 seed inserts exists. */
export async function checkUsualDrinkSeedCoverage(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const problems: string[] = [];
  for (const [table, codes] of Object.entries(USUAL_DRINK_SEED_CODES)) {
    // table is a key of the constant above, never external input (G3.2 allow-list)
    const r = await runner.query<{ code: string }>(`SELECT code FROM ${table} WHERE code = ANY($1::text[])`, [codes]);
    const have = new Set(r.rows.map(x => x.code));
    for (const c of codes) if (!have.has(c)) problems.push(`${table}.${c} missing`);
  }
  const v = await runner.query<{ code: string; n: number }>(
    `SELECT f.code, count(fv.id)::int AS n FROM brew_profile_field f LEFT JOIN brew_profile_field_value fv ON fv.field_id = f.id GROUP BY f.code`
  );
  const counts = new Map(v.rows.map(x => [x.code, x.n]));
  for (const [field, n] of Object.entries(USUAL_DRINK_SEED_VALUE_COUNTS)) {
    if ((counts.get(field) ?? 0) < n) problems.push(`${field}: ${counts.get(field) ?? 0} value rows, the seed has ${n}`);
  }
  return udCheck(26, 'Usual Drink 1 seed rows are all present', problems, 'every seed code present', 'all present');
}

/** 27 — the three FKs from A3a/A3b exist; a skipped one lists its violating rows. */
export async function checkBrewProfileForeignKeys(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const want = [
    { name: 'customer_brew_profile_change_field_fkey', violators: `SELECT DISTINCT field AS code FROM customer_brew_profile_change c WHERE NOT EXISTS (SELECT 1 FROM brew_profile_field f WHERE f.code = c.field)` },
    { name: 'customer_brew_profile_change_op_fkey', violators: `SELECT DISTINCT op AS code FROM customer_brew_profile_change c WHERE NOT EXISTS (SELECT 1 FROM brew_profile_op o WHERE o.code = c.op)` },
    { name: 'quiz_funnel_event_event_fkey', violators: `SELECT DISTINCT event AS code FROM quiz_funnel_event e WHERE NOT EXISTS (SELECT 1 FROM quiz_funnel_event_type t WHERE t.code = e.event)` },
  ];
  const have = new Set((await runner.query<{ conname: string }>(
    `SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])`, [want.map(w => w.name)])).rows.map(r => r.conname));
  const problems: string[] = [];
  for (const w of want) {
    if (have.has(w.name)) continue;
    const v = await runner.query<{ code: string }>(w.violators);
    problems.push(`${w.name} missing; violating codes: ${v.rows.map(x => x.code).join(', ') || 'none (re-applied next boot)'}`);
  }
  return udCheck(27, 'brew-profile field/op and funnel event FKs exist', problems, '3 FKs present', 'all 3 present');
}

/** 28 — the Firestore sommelier_config doc no longer carries brewProfile.fields (retired by Usual Drink 1). */
export async function checkBrewFieldsRetiredFromFirestore(_scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  let problems: string[] = [];
  try {
    const snap = await firestoreDb.doc('config/sommelier').get();
    const data = snap.exists ? snap.data() as { brewProfile?: { fields?: unknown } } : undefined;
    if (data?.brewProfile && 'fields' in data.brewProfile) problems = ['config/sommelier brewProfile.fields is still present'];
  } catch (err) {
    problems = [`could not read config/sommelier: ${err instanceof Error ? err.message : String(err)}`];
  }
  return udCheck(28, 'Firestore config/sommelier has no brewProfile.fields key', problems, 'key absent', 'key absent');
}

/** 29 — ab_app only reads the brew-profile reference tables; brew_card_view_event keeps its INSERT. */
export async function checkBrewReferenceGrants(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const r = await runner.query<{ t: string; ins: boolean; upd: boolean; del: boolean }>(
    `SELECT t,
            has_table_privilege('ab_app', t, 'INSERT') AS ins,
            has_table_privilege('ab_app', t, 'UPDATE') AS upd,
            has_table_privilege('ab_app', t, 'DELETE') AS del
     FROM unnest($1::text[]) AS t WHERE to_regclass(t) IS NOT NULL`, [[...UD_REFERENCE_TABLES, 'brew_card_view_event']]
  );
  const problems: string[] = [];
  for (const row of r.rows) {
    if (row.t === 'brew_card_view_event') { if (!row.ins) problems.push('brew_card_view_event lost its INSERT'); continue; }
    const extra = [row.ins && 'INSERT', row.upd && 'UPDATE', row.del && 'DELETE'].filter(Boolean);
    if (extra.length) problems.push(`${row.t}: ab_app holds ${extra.join(', ')}`);
  }
  return udCheck(29, 'ab_app holds SELECT only on the brew-profile reference tables', problems, 'SELECT only', 'SELECT only');
}

/** 30 — purge guard (D13): guests the empty-guest rule keeps because they hold brew-profile facts. */
export async function checkGuestsKeptForFacts(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const r = await runner.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM user_profile up
     WHERE NOT EXISTS (SELECT 1 FROM quiz_session qs WHERE qs.user_id = up.id)
       AND NOT EXISTS (SELECT 1 FROM "order" o WHERE o.user_id = up.id)
       AND NOT EXISTS (SELECT 1 FROM user_email ue WHERE ue.user_id = up.id AND ue.is_verified = true)
       AND EXISTS (SELECT 1 FROM customer_brew_profile_change c WHERE c.user_id = up.id)`
  );
  const n = r.rows[0]?.n ?? 0;
  return { id: 30, name: 'Guests without a quiz kept by the purge because they hold brew-profile facts', pass: true, expected: 'a count (informational)', actual: `${n} guest(s)`, severity: UD_INFO };
}

/** 31 — takes_it vs usual_drink, and an empty kitchen with no buy_out (informational). */
export async function checkTakesItVsUsualDrink(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const r = await runner.query<{ canonical_user_id: string; note: string }>(
    `WITH t AS (SELECT canonical_user_id, value_jsonb #>> '{}' AS takes_it FROM v_customer_brew_profile WHERE field = 'takes_it'),
          d AS (SELECT canonical_user_id, bool_or(milk <> 'none') AS any_milk, bool_and(milk <> 'none') AS all_milk,
                       bool_or(code = 'buy_out') AS buys_out FROM v_customer_usual_drink GROUP BY canonical_user_id)
     SELECT t.canonical_user_id::text, 'takes it ' || t.takes_it || ' but no drink has milk' AS note FROM t JOIN d USING (canonical_user_id)
       WHERE t.takes_it IN ('milk', 'milk_and_sugar') AND NOT d.any_milk
     UNION ALL
     SELECT t.canonical_user_id::text, 'takes it black but every drink has milk' FROM t JOIN d USING (canonical_user_id)
       WHERE t.takes_it = 'black' AND d.all_milk
     UNION ALL
     SELECT k.canonical_user_id::text, 'nothing in the kitchen and buy_out not among the drinks' FROM v_customer_cupboard_coffee k
       LEFT JOIN d USING (canonical_user_id) WHERE k.code = 'nothing' AND COALESCE(d.buys_out, false) = false`
  );
  return udCheck(31, 'takes_it agrees with the drinks; an empty kitchen goes with buy_out (informational)', r.rows.map(x => `${x.canonical_user_id}: ${x.note}`), '0 findings (a finding is a fact to look at, not an error)', 'all agree');
}

/** 32 — row shape of customer_brew_profile_change. */
export async function checkBrewProfileRowShape(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const r = await runner.query<{ id: string; problem: string }>(
    `SELECT c.id::text, 'quiz row without quiz_session_id' AS problem FROM customer_brew_profile_change c WHERE c.source = 'quiz' AND c.quiz_session_id IS NULL
     UNION ALL
     SELECT c.id::text, 'quiz row on a session that is not the user''s (or a proxy session)' FROM customer_brew_profile_change c
       JOIN quiz_session qs ON qs.id = c.quiz_session_id
       WHERE c.source = 'quiz' AND (qs.taken_by_user_id IS NOT NULL OR NOT EXISTS (
         SELECT 1 FROM v_customer_identity a JOIN v_customer_identity b ON a.canonical_user_id = b.canonical_user_id
         WHERE a.user_id = c.user_id AND b.user_id = qs.user_id))
     UNION ALL
     SELECT c.id::text, 'non-quiz row with quiz_session_id' FROM customer_brew_profile_change c WHERE c.source <> 'quiz' AND c.quiz_session_id IS NOT NULL
     UNION ALL
     SELECT c.id::text, 'declined row with a value' FROM customer_brew_profile_change c WHERE c.op = 'declined' AND c.value IS NOT NULL
     UNION ALL
     SELECT c.id::text, 'words on a value that does not accept them' FROM customer_brew_profile_change c
       JOIN brew_profile_field f ON f.code = c.field
       WHERE c.customer_words IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM brew_profile_field_value fv WHERE fv.field_id = f.id AND fv.accepts_words
           AND (fv.code = c.value::jsonb #>> '{}' OR (jsonb_typeof(c.value::jsonb) = 'array' AND c.value::jsonb ? fv.code)))
     UNION ALL
     SELECT c.id::text, 'array set is not a JSON array, has duplicates or is over max_items' FROM customer_brew_profile_change c
       JOIN brew_profile_field f ON f.code = c.field JOIN brew_profile_value_kind k ON k.id = f.value_kind_id
       WHERE c.op = 'set' AND k.code IN ('array', 'array_freeform') AND c.value IS NOT NULL
         AND CASE WHEN jsonb_typeof(c.value::jsonb) <> 'array' THEN true
                  ELSE (f.max_items IS NOT NULL AND jsonb_array_length(c.value::jsonb) > f.max_items)
                    OR (SELECT count(*) FROM jsonb_array_elements_text(c.value::jsonb)) <> (SELECT count(DISTINCT x) FROM jsonb_array_elements_text(c.value::jsonb) x)
             END
     LIMIT 50`
  );
  return udCheck(32, 'customer_brew_profile_change rows have the right shape (quiz session, declined, words, arrays)', r.rows.map(x => `${x.problem} (row ${x.id})`), '0 findings', 'all rows fit');
}
