// Catalog Blueprint brief 3, Part D — spawns backend/scripts/lint-catalog.mjs
// so a local `npm test` catches a catalog-lint violation too, not only CI's
// dedicated `npm run lint:catalog` step. No DB, no fixtures: the script only
// greps source files.
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
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
});
