// Data catalog · brief 1 (2026-10-16) — the "what is still undescribed"
// query. Brief 1's test asserts it returns nothing after comments.sql is
// applied; brief 2's boot lint (dataCatalogIntegrity.ts) reuses it as-is.
// Scope matches the brief: every table, every view, every TABLE column in
// schema public. View columns are deliberately not required (decision 4).
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
