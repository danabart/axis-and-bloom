// Data catalog · brief 1, Part C (2026-10-16) — format lint for
// db/comments.sql. Reads the file only; no query is sent to any database.
// Decisions 2, 3, 5 and 8 of
// backend/src/features/data_catalog/CLAUDE_CODE_PROMPT_DATA_CATALOG_1_DICTIONARY.md.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { parseCommentsSql } from './commentsFile.js';

const sql = readFileSync(fileURLToPath(new URL('./comments.sql', import.meta.url)), 'utf8');
const schema = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');
const statements = parseCommentsSql(sql);

const CLASSES = ['master', 'fact', 'operating', 'snapshot', 'view', 'deprecated'];
const RELATION_FIELDS = ['Purpose', 'Class', 'Writer', 'Readers', 'Since'];

// Optional leading "UNVERIFIED: <why> | " (decision 5), then the fields.
function splitUnverified(text: string): { unverified: boolean; rest: string[] } {
  const parts = text.split(' | ');
  if (parts[0].startsWith('UNVERIFIED')) {
    return { unverified: true, rest: parts.slice(1) };
  }
  return { unverified: false, rest: parts };
}

describe('comments.sql format', () => {
  it('parses, and every statement is a one-line COMMENT ON', () => {
    expect(statements.length).toBeGreaterThan(0);
  });

  it('no object is commented twice', () => {
    const keys = statements.map(s => `${s.kind === 'COLUMN' ? 'COLUMN' : 'REL'}:${s.relation}.${s.column ?? ''}`);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });

  it('table and view comments follow Purpose | Class | Writer | Readers | Since, no empty field', () => {
    const bad: string[] = [];
    for (const s of statements.filter(s => s.kind !== 'COLUMN')) {
      const { unverified, rest } = splitUnverified(s.text);
      if (unverified && rest.length === 0) { bad.push(`${s.relation}: UNVERIFIED with nothing after it`); continue; }
      const fields = rest.map(f => {
        const at = f.indexOf(': ');
        return at < 0 ? { key: f, value: '' } : { key: f.slice(0, at), value: f.slice(at + 2).trim() };
      });
      const keys = fields.map(f => f.key);
      if (JSON.stringify(keys) !== JSON.stringify(RELATION_FIELDS)) bad.push(`${s.relation}: fields ${keys.join(',')}`);
      for (const f of fields) if (f.value === '') bad.push(`${s.relation}: empty ${f.key}`);
      const cls = fields.find(f => f.key === 'Class')?.value;
      if (cls && !CLASSES.includes(cls)) bad.push(`${s.relation}: Class '${cls}'`);
      if (s.kind === 'VIEW' && cls !== 'view') bad.push(`${s.relation}: a view must be Class: view`);
    }
    expect(bad).toEqual([]);
  });

  it('column comments are a sentence, optionally "Class: deprecated | " first and "| Writer: x" last', () => {
    const bad: string[] = [];
    for (const s of statements.filter(s => s.kind === 'COLUMN')) {
      const target = `${s.relation}.${s.column}`;
      const { rest } = splitUnverified(s.text);
      let parts = rest;
      if (parts[0] === 'Class: deprecated') parts = parts.slice(1);
      else if (parts[0]?.startsWith('Class:')) bad.push(`${target}: only 'Class: deprecated' is allowed on a column`);
      if (parts.length > 0 && parts[parts.length - 1].startsWith('Writer:')) {
        if (parts[parts.length - 1].slice('Writer:'.length).trim() === '') bad.push(`${target}: empty Writer`);
        parts = parts.slice(0, -1);
      }
      if (parts.length !== 1 || parts[0].trim() === '') bad.push(`${target}: expected one sentence, got ${parts.length} part(s)`);
      else if (/^(Purpose|Class|Readers|Since|Writer):/.test(parts[0])) bad.push(`${target}: stray field ${parts[0].split(':')[0]}`);
    }
    expect(bad).toEqual([]);
  });

  it('view columns are not commented (decision 4)', () => {
    const views = new Set(statements.filter(s => s.kind === 'VIEW').map(s => s.relation));
    expect(statements.filter(s => s.kind === 'COLUMN' && views.has(s.relation)).map(s => `${s.relation}.${s.column}`)).toEqual([]);
  });

  it('every commented column has its table commented', () => {
    const rels = new Set(statements.filter(s => s.kind !== 'COLUMN').map(s => s.relation));
    expect([...new Set(statements.filter(s => s.kind === 'COLUMN' && !rels.has(s.relation)).map(s => s.relation))]).toEqual([]);
  });

  it('every table comment for an object not created in schema.sql starts UNVERIFIED: not in schema.sql', () => {
    const created = new Set([...schema.toLowerCase().matchAll(
      /create\s+(?:table|(?:or\s+replace\s+)?view)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)/g,
    )].map(m => m[1]));
    const bad = statements
      .filter(s => s.kind !== 'COLUMN' && !created.has(s.relation) && !s.text.startsWith('UNVERIFIED: not in schema.sql'))
      .map(s => s.relation);
    expect(bad).toEqual([]);
  });

  it('schema.sql carries no COMMENT ON (comments.sql is the only place comments live)', () => {
    expect(schema.split(/\r?\n/).filter(l => /^\s*COMMENT ON /i.test(l))).toEqual([]);
  });

  it('a table comment stays one short line (aim < 300 chars; hard stop at 600)', () => {
    expect(statements.filter(s => s.kind !== 'COLUMN' && s.text.length > 600).map(s => `${s.relation} (${s.text.length})`)).toEqual([]);
  });
});
