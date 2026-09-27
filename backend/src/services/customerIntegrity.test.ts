// Customer Blueprint · brief C1, Part F — runs the report against
// axisandbloom_test. Asserts checks 1, 4, 8, 9 pass and 2/3 are informational
// when not connected as ab_app (which is the case for every environment
// before the Part G cutover). Checks 10-12 (brief C2, Part C) always run too
// — the report has 12 checks now, not 9.
//
// Explicit timeout: checks 10-12 each do a live Firestore collection-group
// scan (feedback_events/metadata/dial_events); the Admin SDK's first
// connection in a fresh test process routinely pushes this test just over
// vitest's 5000ms default (a real regression caught running the full suite,
// not in this file alone — passed standalone before the timeout was added).
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { runCustomerIntegrityChecks } from './customerIntegrity.js';

describe('runCustomerIntegrityChecks', () => {
  it('checks 1, 4, 8, 9 pass; 2 and 3 are informational (not ab_app in this environment); 10-12 present', async () => {
    const report = await runCustomerIntegrityChecks();
    const byId = new Map(report.checks.map(c => [c.id, c]));

    for (const id of [1, 4, 8, 9]) {
      const check = byId.get(id)!;
      expect(check, `check ${id} missing`).toBeDefined();
      expect(check.pass, `check ${id} (${check.name}) failed: ${check.actual}\n${(check.details ?? []).join('\n')}`).toBe(true);
    }

    for (const id of [2, 3, 10, 11, 12]) {
      const check = byId.get(id)!;
      expect(check.severity, `check ${id} should be informational`).toBe('info');
    }

    expect(report.checks).toHaveLength(12);
    expect(report.checks.map(c => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  }, 20000);
});
