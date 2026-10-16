// Data catalog · brief 1 (2026-10-16) — parser and applier for
// db/comments.sql, the single home of every COMMENT ON in the database
// (backend/src/features/data_catalog/CLAUDE_CODE_PROMPT_DATA_CATALOG_1_DICTIONARY.md).
// Shared by the boot step in index.ts, `npm run db:comments` and the tests,
// so all three read the file exactly the same way.
//
// The file is one statement per line:
//   COMMENT ON TABLE|VIEW <rel> IS $c$...$c$;
//   COMMENT ON COLUMN <rel>.<col> IS $c$...$c$;
// Blank lines and `--` lines are ignored; anything else is a parse error.
import type pg from 'pg';

export type CommentKind = 'TABLE' | 'VIEW' | 'COLUMN';

export interface CommentStatement {
  kind: CommentKind;
  relation: string;
  column?: string;
  text: string;
  sql: string;
  line: number;
}

const IDENT = '("[^"]+"|[a-z_][a-z0-9_]*)';
const STATEMENT = new RegExp(`^COMMENT ON (TABLE|VIEW|COLUMN) ${IDENT}(?:\\.${IDENT})? IS \\$c\\$(.*)\\$c\\$;$`);

const unquote = (ident: string) => ident.startsWith('"') ? ident.slice(1, -1) : ident;

export function parseCommentsSql(sql: string): CommentStatement[] {
  const statements: CommentStatement[] = [];
  sql.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('--')) return;
    const m = STATEMENT.exec(line);
    if (!m) throw new Error(`comments.sql line ${i + 1} is not a one-line COMMENT ON statement: ${line.slice(0, 120)}`);
    const [, kind, relation, column, text] = m;
    if ((kind === 'COLUMN') !== (column !== undefined)) {
      throw new Error(`comments.sql line ${i + 1}: COLUMN needs <rel>.<col>, TABLE/VIEW must not have one`);
    }
    if (text.includes('$c$')) throw new Error(`comments.sql line ${i + 1}: text contains $c$`);
    statements.push({
      kind: kind as CommentKind,
      relation: unquote(relation),
      column: column === undefined ? undefined : unquote(column),
      text,
      sql: line,
      line: i + 1,
    });
  });
  return statements;
}

// Applies every statement whose target exists in the connected database, in
// one round trip (a multi-statement query is one implicit transaction: all or
// nothing). Statements for objects this database does not have (e.g. a
// prod-only table on a fresh database) are skipped and reported, never sent,
// so one missing object cannot fail the whole file.
export async function applyCommentsSql(
  runner: pg.Pool | pg.PoolClient,
  sql: string,
): Promise<{ applied: number; skipped: string[] }> {
  const statements = parseCommentsSql(sql);
  const { rows } = await runner.query<{ relname: string; attname: string | null }>(`
    SELECT c.relname, NULL::text AS attname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v')
    UNION ALL
    SELECT c.relname, a.attname
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped`);
  const present = new Set(rows.map(r => r.attname === null ? r.relname : `${r.relname}.${r.attname}`));

  const toApply: CommentStatement[] = [];
  const skipped: string[] = [];
  for (const s of statements) {
    const target = s.column === undefined ? s.relation : `${s.relation}.${s.column}`;
    if (present.has(target)) toApply.push(s);
    else skipped.push(target);
  }
  if (toApply.length > 0) await runner.query(toApply.map(s => s.sql).join('\n'));
  return { applied: toApply.length, skipped };
}
