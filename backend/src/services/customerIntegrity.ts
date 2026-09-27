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
const DEAD_TABLES = ['user_recommendation_log', 'user_feedback_event', 'chat_message', 'sommelier_messages'];

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

// ── 7. Dead tables are empty — informational (C3 drops them) ─────────────
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
    name: 'Dead tables (user_recommendation_log, user_feedback_event, chat_message, sommelier_messages) are empty',
    pass: true,
    expected: 'n/a — informational; C3 drops these after confirming they stay empty',
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

// ── Customer Blueprint · brief C2, Part C (2026-09-27) — coexistence
// comparison. Checks 10-12 are always informational: dual-write means the
// two stores are expected to agree once the backfill has run, but a
// disagreement here is a signal for the daily comparison, never a boot
// failure. Each cross-references live Firestore against the fact tables, so
// unlike checks 1-9 these are genuinely slow-ish (collection-group scans) —
// acceptable at today's volumes (Task 0, 2026-09-27: 0 feedback_events, 1
// brew_profile, 28 dial_events); C3 revisits if volume grows. ────────────────

async function profileIdsByFirebaseUid(runner: Tx | typeof db, uids: string[]): Promise<Map<string, string>> {
  if (!uids.length) return new Map();
  const result = await runner.query<{ id: string; firebase_uid: string }>(
    `SELECT id, firebase_uid FROM user_profile WHERE firebase_uid = ANY($1::text[])`,
    [uids]
  );
  return new Map(result.rows.map(r => [r.firebase_uid, r.id]));
}

// ── 10. Feedback parity ────────────────────────────────────────────────────
export async function checkFeedbackParity(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const feedbackSnap = await firestoreDb.collectionGroup('feedback_events').get();
  const fsCountByUid = new Map<string, number>();
  for (const doc of feedbackSnap.docs) {
    if (doc.data().supersededAt != null) continue;
    const uid = doc.ref.parent.parent!.id;
    fsCountByUid.set(uid, (fsCountByUid.get(uid) ?? 0) + 1);
  }
  const uidToProfile = await profileIdsByFirebaseUid(runner, [...fsCountByUid.keys()]);

  const sqlResult = await runner.query<{ user_id: string; n: string }>(
    `SELECT cfe.user_id, COUNT(*)::int AS n
     FROM customer_feedback_event cfe
     WHERE NOT EXISTS (SELECT 1 FROM customer_feedback_event y WHERE y.supersedes_id = cfe.id)
     GROUP BY cfe.user_id`
  );
  const sqlCountByProfile = new Map(sqlResult.rows.map(r => [r.user_id, Number(r.n)]));

  const profileIds = new Set([...uidToProfile.values(), ...sqlCountByProfile.keys()]);
  const details: string[] = [];
  for (const profileId of profileIds) {
    const uid = [...uidToProfile.entries()].find(([, p]) => p === profileId)?.[0];
    const fsCount = uid ? (fsCountByUid.get(uid) ?? 0) : 0;
    const sqlCount = sqlCountByProfile.get(profileId) ?? 0;
    if (fsCount !== sqlCount) details.push(`profile ${profileId}: Firestore ${fsCount} vs SQL ${sqlCount}`);
  }
  return {
    id: 10,
    name: 'Feedback parity: Firestore feedback_events (non-superseded) vs customer_feedback_event (informational)',
    pass: true,
    expected: 'n/a — coexistence comparison; zero disagreements expected once the backfill has run',
    actual: details.length === 0 ? 'no disagreements' : `${details.length} profile(s) disagree`,
    details: details.length ? details.slice(0, 10) : undefined,
    severity: 'info',
  };
}

// Replays every customer_brew_profile_change row for one (profile, field) in
// occurred_at order to reconstruct "what SQL thinks the field's current value
// is" — a single 'set'/'clear' replaces it outright; 'add'/'remove' build an
// array. Needed because the fact table only ever records the delta ('add'
// stores the one item just appended, not the resulting array), while
// Firestore's brew_profile doc always holds the current, cumulative value —
// comparing the latest row's raw value against the doc's value (as brief C2's
// own literal spec describes) works for scalar fields but is always false for
// array fields. Found by running the Part E smoke test against real
// production, not by review.
function reconstructBrewProfileValue(rows: Array<{ op: string; value: string | null }>): unknown {
  let scalarValue: unknown;
  let arrayValue: unknown[] | undefined;
  for (const row of rows) {
    const v = row.value != null ? JSON.parse(row.value) : null;
    if (row.op === 'clear') { scalarValue = undefined; arrayValue = undefined; continue; }
    if (row.op === 'add') { arrayValue = [...(arrayValue ?? []), v].filter((x, i, arr) => arr.indexOf(x) === i); continue; }
    if (row.op === 'remove') { arrayValue = (arrayValue ?? []).filter(x => x !== v); continue; }
    if (row.op === 'set') { if (Array.isArray(v)) arrayValue = v; else scalarValue = v; continue; }
  }
  return arrayValue !== undefined ? arrayValue : scalarValue;
}

function valuesMatch(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
  }
  return a === b;
}

// ── 11. Brew profile parity ────────────────────────────────────────────────
export async function checkBrewProfileParity(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const metadataSnap = await firestoreDb.collectionGroup('metadata').get();
  const brewProfileDocs = metadataSnap.docs.filter(d => d.id === 'brew_profile');
  const uids = brewProfileDocs.map(d => d.ref.parent.parent!.id);
  const uidToProfile = await profileIdsByFirebaseUid(runner, uids);

  const details: string[] = [];
  for (const doc of brewProfileDocs) {
    const uid = doc.ref.parent.parent!.id;
    const profileId = uidToProfile.get(uid);
    if (!profileId) { details.push(`uid ${uid}: brew_profile doc exists, no user_profile row`); continue; }

    const data = doc.data();
    const fields = Object.keys(data).filter(f => f !== 'updatedAt');
    const allRows = await runner.query<{ field: string; op: string; value: string | null }>(
      `SELECT field, op, value FROM customer_brew_profile_change WHERE user_id = $1 ORDER BY occurred_at ASC`,
      [profileId]
    );
    const rowsByField = new Map<string, Array<{ op: string; value: string | null }>>();
    for (const r of allRows.rows) {
      if (!rowsByField.has(r.field)) rowsByField.set(r.field, []);
      rowsByField.get(r.field)!.push({ op: r.op, value: r.value });
    }

    for (const field of fields) {
      const fsValue = (data[field] as { value?: unknown })?.value ?? null;
      const fieldRows = rowsByField.get(field);
      if (!fieldRows) { details.push(`profile ${profileId}: field '${field}' in Firestore, no change row`); continue; }
      const reconstructed = reconstructBrewProfileValue(fieldRows);
      if (!valuesMatch(reconstructed, fsValue)) {
        details.push(`profile ${profileId}: field '${field}' Firestore=${JSON.stringify(fsValue)} vs reconstructed from changes=${JSON.stringify(reconstructed)}`);
      }
      rowsByField.delete(field);
    }
    for (const field of rowsByField.keys()) details.push(`profile ${profileId}: field '${field}' has a change row, not in Firestore doc`);
  }

  return {
    id: 11,
    name: 'Brew profile parity: Firestore brew_profile doc vs latest customer_brew_profile_change per field (informational)',
    pass: true,
    expected: 'n/a — coexistence comparison; zero disagreements expected once the backfill has run',
    actual: details.length === 0 ? 'no disagreements' : `${details.length} disagreement(s)`,
    details: details.length ? details.slice(0, 10) : undefined,
    severity: 'info',
  };
}

// ── 12. Dial parity ─────────────────────────────────────────────────────────
export async function checkDialParity(scope: CheckScope = {}): Promise<CustomerIntegrityCheck> {
  const runner = scope.tx ?? db;
  const dialSnap = await firestoreDb.collectionGroup('dial_events').get();
  const fsCountByUid = new Map<string, number>();
  for (const doc of dialSnap.docs) {
    const uid = doc.ref.parent.parent!.id;
    fsCountByUid.set(uid, (fsCountByUid.get(uid) ?? 0) + 1);
  }
  const uidToProfile = await profileIdsByFirebaseUid(runner, [...fsCountByUid.keys()]);

  const sqlResult = await runner.query<{ user_id: string; n: string }>(
    `SELECT user_id, COUNT(*)::int AS n FROM customer_dial_event GROUP BY user_id`
  );
  const sqlCountByProfile = new Map(sqlResult.rows.map(r => [r.user_id, Number(r.n)]));

  const profileIds = new Set([...uidToProfile.values(), ...sqlCountByProfile.keys()]);
  const details: string[] = [];
  for (const profileId of profileIds) {
    const uid = [...uidToProfile.entries()].find(([, p]) => p === profileId)?.[0];
    const fsCount = uid ? (fsCountByUid.get(uid) ?? 0) : 0;
    const sqlCount = sqlCountByProfile.get(profileId) ?? 0;
    if (fsCount !== sqlCount) details.push(`profile ${profileId}: Firestore ${fsCount} vs SQL ${sqlCount}`);
  }
  return {
    id: 12,
    name: 'Dial parity: Firestore dial_events count vs customer_dial_event count per profile (informational)',
    pass: true,
    expected: 'n/a — coexistence comparison; zero disagreements expected once the backfill has run',
    actual: details.length === 0 ? 'no disagreements' : `${details.length} profile(s) disagree`,
    details: details.length ? details.slice(0, 10) : undefined,
    severity: 'info',
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
    await checkFeedbackParity(scope),
    await checkBrewProfileParity(scope),
    await checkDialParity(scope),
  ];
  return {
    ranAt: new Date().toISOString(),
    allPass: checks.filter(c => (c.severity ?? 'fail') === 'fail').every(c => c.pass),
    checks,
  };
}
