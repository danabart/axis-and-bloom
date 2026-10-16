// Data catalog · brief 1 (2026-10-16) — the "what is still undescribed"
// query. Brief 1's test asserts it returns nothing after comments.sql is
// applied; brief 2's boot check (dataCatalogIntegrity.ts) reuses it as-is.
// Scope matches the brief: every table, every view, every TABLE column in
// schema public. View columns are deliberately not required (decision 4).
//
// Brief 2 (2026-10-16) adds the shared pieces the boot check, the
// CATALOG.md generator and the System Health card all use, so the three
// can never disagree: the comment parser, the catalog rows, the
// order-independent catalog hash and the CATALOG.md footer reader.
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import type pg from 'pg';

export interface UncommentedObject {
  kind: 'table' | 'view' | 'column';
  object_name: string;
}

export const UNCOMMENTED_OBJECTS_SQL = `
  SELECT CASE c.relkind WHEN 'v' THEN 'view' ELSE 'table' END AS kind, c.relname AS object_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v')
     AND obj_description(c.oid, 'pg_class') IS NULL
  UNION ALL
  SELECT 'column', c.relname || '.' || a.attname
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
     AND col_description(c.oid, a.attnum) IS NULL
  ORDER BY 1, 2`;

export async function findUncommentedObjects(runner: pg.Pool | pg.PoolClient): Promise<UncommentedObject[]> {
  return (await runner.query<UncommentedObject>(UNCOMMENTED_OBJECTS_SQL)).rows;
}

// ── Comment parser (brief 2) ───────────────────────────────────────────────

export const CATALOG_CLASSES = ['master', 'fact', 'operating', 'snapshot', 'view', 'deprecated'] as const;
const RELATION_FIELDS = ['Purpose', 'Class', 'Writer', 'Readers', 'Since'] as const;

export interface ParsedRelationComment {
  unverified: boolean;
  purpose: string | null;
  class: string | null;
  writer: string | null;
  readers: string | null;
  since: string | null;
  // true only when the five fields are all present, in order, non-empty,
  // and Class is one of CATALOG_CLASSES (check 3).
  wellFormed: boolean;
}

// Splits a table/view comment ("[UNVERIFIED: why | ]Purpose: … | Class: … |
// Writer: … | Readers: … | Since: …") into its fields. Never throws: a
// malformed comment comes back with wellFormed = false and whatever fields
// could be read.
export function parseRelationComment(comment: string): ParsedRelationComment {
  let parts = comment.split(' | ').map(p => p.trim());
  const unverified = parts[0]?.startsWith('UNVERIFIED') ?? false;
  if (unverified) parts = parts.slice(1);
  const fields = parts.map(p => {
    const at = p.indexOf(': ');
    return at < 0 ? { key: p, value: '' } : { key: p.slice(0, at), value: p.slice(at + 2).trim() };
  });
  const get = (key: string) => fields.find(f => f.key === key)?.value || null;
  const cls = get('Class');
  const wellFormed =
    fields.length === RELATION_FIELDS.length &&
    fields.every((f, i) => f.key === RELATION_FIELDS[i] && f.value !== '') &&
    (CATALOG_CLASSES as readonly string[]).includes(cls ?? '');
  return {
    unverified,
    purpose: get('Purpose'),
    class: cls,
    writer: get('Writer'),
    readers: get('Readers'),
    since: get('Since'),
    wellFormed,
  };
}

// ── Catalog rows (from v_data_catalog) ─────────────────────────────────────

export interface CatalogRow {
  object_type: 'table' | 'view' | 'column';
  table_name: string;
  column_name: string | null;
  data_type: string | null;
  is_nullable: boolean | null;
  comment: string | null;
  purpose: string | null;
  class: string | null;
  writer: string | null;
  readers: string | null;
  since: string | null;
  is_unverified: boolean;
  ordinal_position: number;
}

export async function fetchCatalogRows(runner: pg.Pool | pg.PoolClient): Promise<CatalogRow[]> {
  return (await runner.query<CatalogRow>(
    `SELECT * FROM v_data_catalog ORDER BY table_name, ordinal_position`,
  )).rows;
}

export interface ViewDependency {
  view_name: string;
  depends_on: string;
  depends_on_type: 'table' | 'view';
}

export async function fetchViewDependencies(runner: pg.Pool | pg.PoolClient): Promise<ViewDependency[]> {
  return (await runner.query<ViewDependency>(
    `SELECT view_name, depends_on, depends_on_type FROM v_data_view_dependency ORDER BY view_name, depends_on`,
  )).rows;
}

export function objectName(row: Pick<CatalogRow, 'table_name' | 'column_name'>): string {
  return row.column_name === null ? row.table_name : `${row.table_name}.${row.column_name}`;
}

// ── Catalog hash (decision 4) ──────────────────────────────────────────────
// sha256 of the sorted object list: one line per object, its type, table,
// column and comment. Sorted before hashing, so row order never matters;
// any added/removed object, renamed column or edited comment changes it.
export function computeCatalogHash(
  rows: Pick<CatalogRow, 'object_type' | 'table_name' | 'column_name' | 'comment'>[],
): string {
  const lines = rows
    .map(r => [r.object_type, r.table_name, r.column_name ?? '', r.comment ?? ''].join('\t'))
    .sort();
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

export const CATALOG_HASH_FOOTER = /^catalog-hash: ([0-9a-f]{64})\s*$/m;

// The hash in a CATALOG.md footer, or null when the file or footer is absent.
export function readCatalogMdHash(path: string): string | null {
  if (!existsSync(path)) return null;
  return CATALOG_HASH_FOOTER.exec(readFileSync(path, 'utf8'))?.[1] ?? null;
}

// ── Lineage (brief 3) ──────────────────────────────────────────────────────
// TS twin of declaredModules() in backend/scripts/lineage-scan.mjs (the CI
// rule). Writer field format: `module.function` entries separated by
// commas, groups by semicolons, split only outside parentheses; the module
// is the part before the first dot/space/paren; `seed...` is `seed`.
// dataCatalogQueries.test.ts checks the two agree on every table.
export function declaredWriterModules(field: string | null): string[] {
  if (!field || /^none\b/i.test(field.trim())) return [];
  const entries: string[] = [];
  let depth = 0, cur = '';
  for (const ch of field) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || ch === ';')) { entries.push(cur); cur = ''; } else cur += ch;
  }
  entries.push(cur);
  const mods = entries.map(e => e.trim()).filter(Boolean).map(e => (/^seed\b/.test(e) ? 'seed' : e.split(/[.\s(]/)[0]));
  return [...new Set(mods)].sort();
}

export interface LineageWriter { module: string; file: string; verbs: string[]; lines: number[] }
export interface LineageReader { file: string; via_view?: string }
export interface LineageTable {
  declared: { field: string; modules: string[] };
  writers: LineageWriter[];
  readers: LineageReader[];
  view_readers: string[];
}
export interface LineageJson {
  generated_at: string;
  summary: { tables: number; multi_writer_tables: string[]; undeclared_writers: number; dead_doors: number; dead_candidates: number; probes: number };
  tables: Record<string, LineageTable>;
  probes: { file: string; line: number; table: string; verb: string }[];
  findings: { dead_candidates: string[] };
}

export function readLineageJson(path: string | null): LineageJson | null {
  if (!path || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as LineageJson;
}

// Module set of a table's static writers that are app code (not seed or a
// backfill script): more than one is a multi-writer table.
export const appWriterModules = (t: LineageTable) =>
  [...new Set(t.writers.map(w => w.module))].filter(m => m !== 'seed' && !m.startsWith('backfill:')).sort();

export interface TableActivity {
  table_name: string;
  n_tup_ins: string; n_tup_upd: string; n_tup_del: string; seq_scan: string; idx_scan: string | null;
  last_autoanalyze: Date | null;
  stats_reset: Date | null;
  is_dead_candidate: boolean;
}

export async function fetchTableActivity(runner: pg.Pool | pg.PoolClient): Promise<TableActivity[]> {
  return (await runner.query<TableActivity>(`SELECT * FROM v_data_table_activity ORDER BY table_name`)).rows;
}

// Observed lineage needs the pg_stat_statements extension; null when the view is absent.
export async function fetchObservedLineage(runner: pg.Pool | pg.PoolClient): Promise<
  { table_name: string; verb: string; application_name_or_role: string; calls: string; stats_reset: Date | null }[] | null
> {
  const exists = (await runner.query(`SELECT to_regclass('public.v_data_lineage_observed') IS NOT NULL AS ok`)).rows[0].ok;
  if (!exists) return null;
  return (await runner.query(`SELECT * FROM v_data_lineage_observed ORDER BY table_name, verb, application_name_or_role`)).rows;
}
