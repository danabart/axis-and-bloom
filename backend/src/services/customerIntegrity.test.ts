// Customer Blueprint · brief C1, Part F — runs the report against
// axisandbloom_test. Asserts checks 1, 4, 8, 9 pass and 2/3 are informational
// when not connected as ab_app (which is the case for every environment
// before the Part G cutover). Brief C3, Part C retired checks 10-12
// (Firestore-vs-fact parity — no second store left to compare) and added
// 13-17; the report has 14 checks now (1-9, 13-17), not 12.
//
// Explicit timeout: check 15 does a live Firestore collection-group scan per
// retired source; the Admin SDK's first connection in a fresh test process
// routinely pushes this test just over vitest's 5000ms default (a real
// regression caught running the full suite, not in this file alone — passed
// standalone before the timeout was added, brief C2). Check 18 added the same
// day v_palate_slot_candidates deployed with a stale column list live in
// production (see customerIntegrity.ts's own comment on check 18); the report
// has 15 checks now (1-9, 13-18), not 14.
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { runCustomerIntegrityChecks } from './customerIntegrity.js';

describe('runCustomerIntegrityChecks', () => {
  it('checks 1, 4, 8, 9, 13, 14, 17, 18 pass; 2, 3, 15, 16 are informational; 13-18 present', async () => {
    const report = await runCustomerIntegrityChecks();
    const byId = new Map(report.checks.map(c => [c.id, c]));

    for (const id of [1, 4, 8, 9, 13, 14, 17, 18]) {
      const check = byId.get(id)!;
      expect(check, `check ${id} missing`).toBeDefined();
      expect(check.pass, `check ${id} (${check.name}) failed: ${check.actual}\n${(check.details ?? []).join('\n')}`).toBe(true);
    }

    for (const id of [2, 3, 15, 16]) {
      const check = byId.get(id)!;
      expect(check.severity, `check ${id} should be informational`).toBe('info');
    }

    expect(report.checks).toHaveLength(15);
    expect(report.checks.map(c => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 14, 15, 16, 17, 18]);
  }, 20000);
});
