// Customer Blueprint brief C1, Part E — spawns backend/scripts/lint-customer.mjs
// so a local `npm test` catches a customer-lint violation too, not only CI's
// dedicated `npm run lint:customer` step. No DB, no fixtures: the script only
// greps source files (and parses schema.sql for the live fact table list).
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, '..', '..', 'scripts', 'lint-customer.mjs');

describe('lint:customer', () => {
  it('passes with no violations', async () => {
    try {
      await execFileAsync('node', [SCRIPT_PATH]);
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? String(err);
      throw new Error(`lint-customer.mjs reported violations:\n${stderr}`);
    }
  });
});
