// Customer Blueprint · brief C1, Part F — runs the report against
// axisandbloom_test. Asserts checks 1, 4, 8, 9 pass and 2/3 are informational
// when not connected as ab_app (which is the case for every environment
// before the Part G cutover).
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { runCustomerIntegrityChecks } from './customerIntegrity.js';

describe('runCustomerIntegrityChecks', () => {
  it('checks 1, 4, 8, 9 pass; 2 and 3 are informational (not ab_app in this environment)', async () => {
    const report = await runCustomerIntegrityChecks();
    const byId = new Map(report.checks.map(c => [c.id, c]));

    for (const id of [1, 4, 8, 9]) {
      const check = byId.get(id)!;
      expect(check, `check ${id} missing`).toBeDefined();
      expect(check.pass, `check ${id} (${check.name}) failed: ${check.actual}\n${(check.details ?? []).join('\n')}`).toBe(true);
    }

    for (const id of [2, 3]) {
      const check = byId.get(id)!;
      expect(check.severity, `check ${id} should be informational when not ab_app`).toBe('info');
    }

    expect(report.checks).toHaveLength(9);
    expect(report.checks.map(c => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
