// Catalog Blueprint brief 3, Part D — spawns backend/scripts/lint-catalog.mjs
// so a local `npm test` catches a catalog-lint violation too, not only CI's
// dedicated `npm run lint:catalog` step. No DB, no fixtures: the script only
// greps source files.
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, '..', '..', 'scripts', 'lint-catalog.mjs');

describe('lint:catalog', () => {
  it('passes with no violations', async () => {
    try {
      await execFileAsync('node', [SCRIPT_PATH]);
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? String(err);
      throw new Error(`lint-catalog.mjs reported violations:\n${stderr}`);
    }
  });

  // Rule 6 (2026-09-30) — the deprecated stock columns must not be referenced from routes/ or services/.
  it('rule 6 flags a planted reference to a deprecated stock column', async () => {
    const planted = path.resolve(__dirname, '..', 'services', '_plantedStockRef.ts');
    writeFileSync(planted, "export const q = 'SELECT quantity_available FROM coffee_sku';\n");
    try {
      await expect(execFileAsync('node', [SCRIPT_PATH])).rejects.toMatchObject({
        stderr: expect.stringContaining("deprecated stock column 'quantity_available'"),
      });
    } finally {
      rmSync(planted, { force: true });
    }
  });
});
