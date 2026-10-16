// Data catalog brief 3, Part A (2026-10-16) — spawns
// backend/scripts/lineage-scan.mjs so a local `npm test` catches a
// one-writer violation too, not only CI's `npm run lint:lineage` step. No
// DB: the scanner only reads source files and comments.sql. Every run
// writes its lineage.json to a temp path (LINEAGE_OUT), never backend/.
import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, '..', '..', 'scripts', 'lineage-scan.mjs');
const dir = mkdtempSync(path.join(tmpdir(), 'lineage-'));
const OUT = path.join(dir, 'lineage.json');
const run = () => execFileAsync('node', [SCRIPT_PATH], { env: { ...process.env, LINEAGE_OUT: OUT } });

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('lint:lineage', () => {
  it('passes: every table\'s writers in code match its declared Writer set', async () => {
    try {
      await run();
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? String(err);
      throw new Error(`lineage-scan.mjs reported violations:\n${stderr}`);
    }
    const out = JSON.parse(readFileSync(OUT, 'utf8'));
    expect(out.summary.undeclared_writers).toBe(0);
    // the one probe (customerIntegrity grant check) is listed, not hidden
    expect(out.probes).toEqual([expect.objectContaining({ file: 'backend/src/services/customerIntegrity.ts', table: 'quiz_session' })]);
    // customer_* facts are written only by customerFacts (through insertFact)
    expect(out.tables.customer_feedback_event.writers.map((w: { module: string }) => w.module)).toEqual(['customerFacts']);
  });

  it('fails on a second, undeclared writer', async () => {
    const planted = path.resolve(__dirname, '..', 'services', '_plantedSecondWriter.ts');
    writeFileSync(planted, "export const q = 'UPDATE roastery_portal_link SET contact_name = $1 WHERE id = $2';\n");
    try {
      await expect(run()).rejects.toMatchObject({
        stderr: expect.stringContaining("roastery_portal_link: writer '_plantedSecondWriter' (UPDATE) is not in the declared Writer set"),
      });
    } finally {
      rmSync(planted, { force: true });
    }
  });

  it('a probe marker on the line above suppresses that one write and is reported', async () => {
    const planted = path.resolve(__dirname, '..', 'services', '_plantedProbe.ts');
    writeFileSync(planted, "// lineage: probe, not a write\nexport const q = 'UPDATE roastery_portal_link SET id = id WHERE false';\n");
    try {
      await run();
      const out = JSON.parse(readFileSync(OUT, 'utf8'));
      expect(out.probes).toContainEqual({ file: 'backend/src/services/_plantedProbe.ts', line: 2, table: 'roastery_portal_link', verb: 'UPDATE' });
    } finally {
      rmSync(planted, { force: true });
    }
  });

  it('a /* or // inside a string does not hide code from the scanner', async () => {
    const planted = path.resolve(__dirname, '..', 'services', '_plantedComment.ts');
    writeFileSync(planted, "const glob = 'coffees/*';\nexport const q = 'UPDATE roastery_portal_link SET contact_name = $1';\nconst end = '*/';\n");
    try {
      await expect(run()).rejects.toMatchObject({ stderr: expect.stringContaining("writer '_plantedComment'") });
    } finally {
      rmSync(planted, { force: true });
    }
  });
});
