// Data catalog · brief 2, Part B (2026-10-16) — the boot check that keeps
// the data dictionary honest
// (backend/src/features/data_catalog/CLAUDE_CODE_PROMPT_DATA_CATALOG_2_LINT_AND_CATALOG_MD.md).
//
// Report only (Dana, 2026-10-16, replacing the brief's report/strict switch):
// every check is severity 'info', findings go to the boot log and the System
// Health card, and nothing here ever stops the boot. There is no
// CATALOG_LINT_MODE. Same report shape as catalogIntegrity.ts.
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import type pg from 'pg';
import { db } from '../db/client.js';
import type { CatalogIntegrityCheck, CatalogIntegrityReport } from './catalogIntegrity.js';
import {
  computeCatalogHash,
  fetchCatalogRows,
  findUncommentedObjects,
  objectName,
  parseRelationComment,
  readCatalogMdHash,
  type CatalogRow,
} from './dataCatalogQueries.js';

export interface DataCatalogCounts {
  tables: number;
  views: number;
  columns: number;
  unverified: number;
}

export interface DataCatalogReport extends CatalogIntegrityReport {
  counts: DataCatalogCounts;
  liveHash: string;
  catalogMdHash: string | null;
  catalogMdPath: string | null;
  // true only when a CATALOG.md was found and its hash differs from the live one
  catalogMdStale: boolean;
}

// CATALOG.md sits at the repo root and is copied into the image root
// (/app/CATALOG.md, next to dist/) by the Dockerfile. From dist/services/
// that is ../../CATALOG.md; from src/services/ in local dev it is
// ../../../CATALOG.md (backend/ has none of its own).
export function defaultCatalogMdPath(): string | null {
  for (const rel of ['../../CATALOG.md', '../../../CATALOG.md']) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(p)) return p;
  }
  return null;
}

function check(id: number, name: string, findings: string[], expected: string, actualIfAny: (n: number) => string): CatalogIntegrityCheck {
  return {
    id,
    name,
    pass: findings.length === 0,
    expected,
    actual: findings.length === 0 ? expected : actualIfAny(findings.length),
    details: findings,
    severity: 'info',
  };
}

export async function runDataCatalogIntegrityChecks(
  opts: { runner?: pg.Pool | pg.PoolClient; catalogMdPath?: string | null } = {},
): Promise<DataCatalogReport> {
  const runner = opts.runner ?? db;
  const catalogMdPath = opts.catalogMdPath === undefined ? defaultCatalogMdPath() : opts.catalogMdPath;

  const [uncommented, rows] = await Promise.all([findUncommentedObjects(runner), fetchCatalogRows(runner)]);
  const relations = rows.filter((r): r is CatalogRow & { comment: string } => r.object_type !== 'column' && r.comment !== null);

  // 1. Every table, view and table column has a comment.
  const c1 = check(1, 'Every table, view and table column has a comment',
    uncommented.map(u => u.object_name), '0 uncommented', n => `${n} uncommented`);

  // 2. No comment starts with UNVERIFIED.
  const c2 = check(2, 'No comment is UNVERIFIED',
    rows.filter(r => r.is_unverified).map(objectName), '0 UNVERIFIED', n => `${n} UNVERIFIED`);

  // 3. Every table and view comment parses into the five fields, allowed Class.
  const c3 = check(3, 'Every table and view comment has Purpose | Class | Writer | Readers | Since with an allowed Class',
    relations.filter(r => !parseRelationComment(r.comment).wellFormed).map(r => r.table_name),
    '0 malformed', n => `${n} malformed`);

  // 4. CATALOG.md matches the live database (decision 4).
  const liveHash = computeCatalogHash(rows);
  const catalogMdHash = catalogMdPath ? readCatalogMdHash(catalogMdPath) : null;
  let c4: CatalogIntegrityCheck;
  if (!catalogMdPath) {
    c4 = { id: 4, name: 'CATALOG.md matches the live database', pass: true, expected: 'hash match',
      actual: 'skipped: CATALOG.md is not present on this image', details: [], severity: 'info' };
  } else if (catalogMdHash === null) {
    c4 = { id: 4, name: 'CATALOG.md matches the live database', pass: false, expected: 'hash match',
      actual: 'CATALOG.md has no catalog-hash footer', details: [catalogMdPath], severity: 'info' };
  } else {
    const match = catalogMdHash === liveHash;
    c4 = { id: 4, name: 'CATALOG.md matches the live database', pass: match, expected: 'hash match',
      actual: match ? 'hash match' : 'CATALOG.md stale',
      details: match ? [] : [`file ${catalogMdHash}`, `live ${liveHash}`], severity: 'info' };
  }

  const checks = [c1, c2, c3, c4];
  return {
    ranAt: new Date().toISOString(),
    allPass: checks.every(c => c.pass),
    checks,
    counts: {
      tables: rows.filter(r => r.object_type === 'table').length,
      views: rows.filter(r => r.object_type === 'view').length,
      columns: rows.filter(r => r.object_type === 'column').length,
      unverified: c2.details!.length,
    },
    liveHash,
    catalogMdHash,
    catalogMdPath,
    catalogMdStale: catalogMdHash !== null && catalogMdHash !== liveHash,
  };
}

// Boot log lines: one summary line, then one line per check with findings,
// naming at most LOG_CAP objects (the full list is in System Health).
export const LOG_CAP = 50;
export function formatDataCatalogLog(report: DataCatalogReport): string[] {
  const c = report.counts;
  const lines = [`[data-catalog] report only: ${c.tables} tables, ${c.views} views, ${c.columns} columns; ` +
    `${report.checks.filter(k => !k.pass).length} of ${report.checks.length} checks with findings`];
  for (const k of report.checks) {
    if (k.pass && !k.actual.startsWith('skipped')) continue;
    const d = k.details ?? [];
    const shown = d.slice(0, LOG_CAP).join(', ');
    lines.push(`[data-catalog] check #${k.id} ${k.name}: ${k.actual}${d.length ? ` — ${shown}${d.length > LOG_CAP ? ` (+${d.length - LOG_CAP} more)` : ''}` : ''}`);
  }
  return lines;
}
