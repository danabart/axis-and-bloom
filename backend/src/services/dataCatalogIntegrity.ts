// Data catalog · brief 2, Part B (2026-10-16) — the boot check that keeps
// the data dictionary honest
// (backend/src/features/data_catalog/CLAUDE_CODE_PROMPT_DATA_CATALOG_2_LINT_AND_CATALOG_MD.md).
//
// Report only (Dana, 2026-10-16, replacing the brief's report/strict switch):
// every check is severity 'info', findings go to the boot log and the System
// Health card, and nothing here ever stops the boot. There is no
// CATALOG_LINT_MODE. Same report shape as catalogIntegrity.ts.
//
// Brief 3 (2026-10-16) adds check 5 (one writer, the same finding CI's
// lint:lineage fails on, from the lineage.json shipped in the image) and
// check 6 (dead table candidates, static and observed), both 'info', plus
// the `lineage` section System Health shows.
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import type pg from 'pg';
import { db } from '../db/client.js';
import type { CatalogIntegrityCheck, CatalogIntegrityReport } from './catalogIntegrity.js';
import {
  appWriterModules,
  computeCatalogHash,
  declaredWriterModules,
  fetchCatalogRows,
  fetchTableActivity,
  readLineageJson,
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

export interface DataCatalogLineage {
  available: boolean;           // lineage.json found on this image
  generatedAt: string | null;
  multiWriter: { table: string; modules: string[] }[];       // declared, candidates to consolidate
  undeclared: { table: string; module: string; file: string; line: number }[];
  deadDoors: { table: string; module: string }[];            // declared, no write in code
  deadCandidates: { table: string; static: boolean; observed: boolean }[];
  probes: number;
  statsReset: string | null;    // pg_stat_database, for v_data_table_activity
}

export interface DataCatalogReport extends CatalogIntegrityReport {
  lineage: DataCatalogLineage;
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
// lineage.json (npm run lint:lineage) sits next to package.json: /app in the
// image, backend/ locally. ../../lineage.json from both dist/services and src/services.
export function defaultLineagePath(): string | null {
  const p = fileURLToPath(new URL('../../lineage.json', import.meta.url));
  return existsSync(p) ? p : null;
}

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
  opts: { runner?: pg.Pool | pg.PoolClient; catalogMdPath?: string | null; lineagePath?: string | null } = {},
): Promise<DataCatalogReport> {
  const runner = opts.runner ?? db;
  const catalogMdPath = opts.catalogMdPath === undefined ? defaultCatalogMdPath() : opts.catalogMdPath;

  const lineagePath = opts.lineagePath === undefined ? defaultLineagePath() : opts.lineagePath;
  const [uncommented, rows, activity] = await Promise.all([
    findUncommentedObjects(runner), fetchCatalogRows(runner), fetchTableActivity(runner).catch(() => []),
  ]);
  const lineageJson = readLineageJson(lineagePath);
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

  // 5. One writer (brief 3): the same comparison CI makes (lint:lineage),
  // from the lineage.json shipped in the image against the live Writer fields.
  const declaredByTable = new Map(rows.filter(r => r.object_type === 'table').map(r => [r.table_name, declaredWriterModules(r.writer)]));
  const undeclared: DataCatalogLineage['undeclared'] = [];
  const deadDoors: DataCatalogLineage['deadDoors'] = [];
  const multiWriter: DataCatalogLineage['multiWriter'] = [];
  for (const [table, t] of Object.entries(lineageJson?.tables ?? {})) {
    const declared = declaredByTable.get(table) ?? [];
    const staticMods = [...new Set(t.writers.map(w => w.module))];
    for (const w of t.writers) if (!declared.includes(w.module)) undeclared.push({ table, module: w.module, file: w.file, line: w.lines[0] });
    for (const d of declared) if (!staticMods.includes(d) && !d.startsWith('manual:')) deadDoors.push({ table, module: d });
    const app = appWriterModules(t);
    if (app.length > 1) multiWriter.push({ table, modules: app });
  }
  const C5_NAME = "Every table's writers in code are its declared Writer set (one-writer rule)";
  const c5: CatalogIntegrityCheck = lineageJson
    ? check(5, C5_NAME,
        undeclared.map(u => `${u.table}: ${u.module} (${u.file}:${u.line})`), '0 undeclared writers', n => `${n} undeclared writer(s)`)
    : { id: 5, name: C5_NAME, pass: true, expected: '0 undeclared writers',
        actual: 'skipped: lineage.json is not present on this image', details: [], severity: 'info' };

  // 6. Dead table candidates: no reader in code and no view (static,
  // lineage.json) or nothing touched it in 30+ days (observed, v_data_table_activity).
  const staticDead = new Set(lineageJson?.findings.dead_candidates ?? []);
  const observedDead = new Set(activity.filter(a => a.is_dead_candidate).map(a => a.table_name));
  const deadCandidates = [...new Set([...staticDead, ...observedDead])].sort()
    .map(table => ({ table, static: staticDead.has(table), observed: observedDead.has(table) }));
  const c6 = check(6, 'No dead table candidates (no reader in code, or untouched for 30+ days)',
    deadCandidates.map(d => `${d.table} (${[d.static ? 'static' : null, d.observed ? 'observed' : null].filter(Boolean).join(', ')})`),
    '0 dead candidates', n => `${n} dead candidate(s)`);

  const checks = [c1, c2, c3, c4, c5, c6];
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
    lineage: {
      available: lineageJson !== null,
      generatedAt: lineageJson?.generated_at ?? null,
      multiWriter: multiWriter.sort((a, b) => a.table.localeCompare(b.table)),
      undeclared,
      deadDoors,
      deadCandidates,
      probes: lineageJson?.probes.length ?? 0,
      statsReset: activity[0]?.stats_reset ? new Date(activity[0].stats_reset).toISOString() : null,
    },
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
