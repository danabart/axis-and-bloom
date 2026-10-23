// Cupping evidence brief 3, Part B (2026-10-18): the read-only evidence routes,
// evidenceReads and evidenceIntegrity against the brief 2 rows on the test DB.
// requireAdmin mocked to a passthrough (the admin.catalog.test.ts pattern);
// real router, real DB, GET only.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../middleware/auth.js', () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

const { default: evidenceRouter } = await import('./evidenceAdmin.js');
const { default: adminRouter } = await import('./admin.js');
const { db } = await import('../db/client.js');
const { getFamilies } = await import('../services/evidenceReads.js');
const { runEvidenceIntegrityChecks } = await import('../services/evidenceIntegrity.js');

const JOE_COFFEE = 'f42ad179-9ef4-410a-a92e-464eae1d84ce';
const JOE_BEAN = '19098f5c-99b9-4d7c-90ef-ee33d1e896b7';
const S36 = 36, S37 = 37; // Joe Coffee and Joe Bean sessions (brief 2)
const LA_FAMILIA = 2903; // cupped only in s36
const TIGER_STRIPE = 2914; // one session (s37)
const GEOMETRIC = 2915; // two sessions (s37, then the Balance cupping of 2026-10-21)

let server: Server;
let base: string;
let benchmarkId: number;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/evidence', evidenceRouter);
  app.use('/api/admin', adminRouter);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/admin`;
  benchmarkId = (await db.query<{ id: number }>(`SELECT id FROM coffees WHERE name = 'Benchmark' AND roaster_id = $1`, [JOE_COFFEE])).rows[0].id;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('GET /api/admin/evidence/*', () => {
  it('coffee: the dimensions, descriptors, archetype row and calls for one coffee', async () => {
    const res = await fetch(`${base}/evidence/coffee/${benchmarkId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dimensions.length).toBeGreaterThan(0);
    expect(body.descriptors.map((d: any) => d.family)).toEqual(expect.arrayContaining(['Sweet', 'Nutty / Cocoa', 'Spices']));
    expect(body.archetype.catalog_archetype).toBe('balanced_sweet');
    // calls are pinned to a coffee cupped only in session 36 (Brief 5: no test reads "the latest session")
    const familia = await (await fetch(`${base}/evidence/coffee/${LA_FAMILIA}`)).json();
    expect(familia.calls.map((c: any) => [c.cupper_name, c.session_id, c.archetype_call])).toEqual([['Dana', S36, 'balanced_sweet']]);
  });

  it('roastery: calibration, cuppers, coverage and the stale-decision count', async () => {
    const res = await fetch(`${base}/evidence/roastery/${JOE_BEAN}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.calibration.length).toBeGreaterThan(0);
    expect(body.coverage.length).toBe(4);
    expect(body.cuppers.length).toBeGreaterThan(0);
    // by id: Tiger Stripe cupped once (not stale), Geometric cupped again after its decision (stale)
    const newer = (id: number) => body.coverage.find((c: any) => c.coffee_id === id)?.evidence_newer_than_decision;
    expect([newer(TIGER_STRIPE), newer(GEOMETRIC)]).toEqual([false, true]);
    expect(body.staleDecisions).toBe(body.coverage.filter((c: any) => c.evidence_newer_than_decision).length);
  });

  it('summary: the System Health numbers and the eight integrity checks', async () => {
    const res = await fetch(`${base}/evidence/summary`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.activeCoffees).toBeGreaterThanOrEqual(22);
    expect(body.summary.coffeesWithTwoOrMoreSources).toBeLessThanOrEqual(body.summary.activeCoffees);
    expect(body.integrity.map((c: any) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('unmapped words: the mapping queue', async () => {
    const res = await fetch(`${base}/evidence/unmapped-words`);
    expect(res.status).toBe(200);
    const words = (await res.json()).map((w: any) => w.word);
    expect(words).toContain('ube halo halo');
  });

  it('parameters (brief 6): every current key with its note; a bad value or an unknown key is refused, nothing written', async () => {
    const list = await (await fetch(`${base}/evidence/parameters`)).json();
    const keys = list.map((p: any) => p.key);
    for (const k of ['session_rank_ratio', 'session_half_life_days', 'session_gap', 'customer_voice_hit_tier', 'customer_voice_signature_max', 'customer_voice_accent_max', 'cupper_gap']) expect(keys).toContain(k);
    // coffee presentation brief 1: closed, no current row, so not on the card
    expect(keys).not.toContain('customer_voice_max_words');
    expect(list.find((p: any) => p.key === 'session_rank_ratio').note).toMatch(/Range: /);
    const put = (key: string, value: unknown) => fetch(`${base}/evidence/parameters/${key}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value, note: 'vitest' }) });
    expect((await put('session_rank_ratio', 2)).status).toBe(400);
    expect((await put('session_rank_ratio', 'x')).status).toBe(400);
    expect((await put('no_such_key', 1)).status).toBe(404);
    const after = await (await fetch(`${base}/evidence/parameters`)).json();
    expect(after).toEqual(list);
  });

  it('refuses a malformed id with 400', async () => {
    expect((await fetch(`${base}/evidence/coffee/abc`)).status).toBe(400);
    expect((await fetch(`${base}/evidence/roastery/not-a-uuid`)).status).toBe(400);
  });

  it('GET /api/admin/system-health carries the cupping evidence section', async () => {
    const res = await fetch(`${base}/system-health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cuppingEvidence.summary.activeCoffees).toBeGreaterThan(0);
    expect(body.cuppingEvidence.integrity.length).toBe(8);
  });
});

// Cupping evidence brief 4 (2026-10-18): the Calibration workbench reads, and a
// write from the page's helpers through the existing catalog endpoints carrying
// the new fields (basis on match and placements, placedFromSessionId). The
// write runs on a Vitest coffee on a free slot, cleaned up after; no brief 2
// coffee is touched.
describe('GET /api/admin/evidence/workbench/*', () => {
  it('queue: one row per active coffee, flagged first, then stale, then no basis, then by name', async () => {
    const res = await fetch(`${base}/evidence/workbench/${JOE_BEAN}`);
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows.map((r: any) => r.coffee_name).sort()).toEqual(['Blossom Dark Roast', 'Fabricator House Roast', 'Geometric Filter Coffee', 'Tiger Stripe Espresso']);
    const key = (r: any) => [r.flag_unreconciled ? 0 : 1, r.evidence_newer_than_decision ? 0 : 1, r.assignment_basis_present === false ? 0 : 1, r.coffee_name];
    const sorted = [...rows].sort((a: any, b: any) => {
      const ka = key(a), kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
      return 0;
    });
    expect(rows.map((r: any) => r.coffee_id)).toEqual(sorted.map((r: any) => r.coffee_id));
    expect((await fetch(`${base}/evidence/workbench/not-a-uuid`)).status).toBe(400);
  });

  it('coffee: the brief 3 bundle plus sessions, the roaster response, website descriptors and accepted descriptors', async () => {
    const blossomId = (await db.query<{ id: number }>(`SELECT id FROM coffees WHERE name = 'Blossom Dark Roast' AND roaster_id = $1`, [JOE_BEAN])).rows[0].id;
    const res = await fetch(`${base}/evidence/workbench/coffee/${blossomId}`);
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(Object.keys(b).sort()).toEqual(['accepted', 'archetype', 'calls', 'coffee', 'consensus', 'customerVoice', 'descriptors', 'dimensions', 'history', 'roasterResponse', 'sessions', 'websiteDescriptors']);
    expect(b.coffee.name).toBe('Blossom Dark Roast');
    expect(b.sessions.map((s: any) => s.session_id)).toContain(b.archetype.latest_session_id);
    expect(b.roasterResponse.response_id).toBeTruthy();
    expect(b.websiteDescriptors.length).toBeGreaterThan(0);
    expect((await fetch(`${base}/evidence/workbench/coffee/999999999`)).status).toBe(404);
  });
});

describe('a workbench write through the existing endpoints (brief 4 fields)', () => {
  it('match carries notes "basis: …", basis JSON and the session; a placement carries basis and placed_from_session_id', async () => {
    const { freeSlotsInOneArchetype } = await import('../test/freeSlots.js');
    const { createCoffee, upsertSku } = await import('../services/catalogService.js');
    const roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Workbench Roastery', true) RETURNING id`)).rows[0];
    let coffeeId: number | undefined;
    try {
      ({ result: { coffeeId } } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Workbench Coffee' }, { actor: 'vitest' }));
      await upsertSku({ coffeeId: coffeeId!, weightOz: 12 }, { actor: 'vitest' });
      const sessionId = S37; // any existing session; pinned, never "the latest" (brief 5)
      const basis = { sessions: [sessionId], calls: {}, rule: 'vitest rule' };
      const put = await fetch(`${base}/catalog/coffees/${coffeeId}/match`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archetype: 'earthy', confidence: 'low', source: 'cupping', sessionId, notes: 'basis: cupping: none; rule: vitest rule', basis }),
      });
      expect(put.status).toBe(200);
      const a = (await db.query(`SELECT notes, basis, assigned_from_session_id FROM coffee_archetype_assignment WHERE coffee_id = $1 AND superseded_at IS NULL`, [coffeeId])).rows[0];
      expect(a.notes.startsWith('basis:')).toBe(true);
      expect(a.basis).toEqual(basis);
      expect(a.assigned_from_session_id).toBe(sessionId);

      // the same archetype and confidence with a new basis writes a new row; the identical call is a no-op
      const again = { ...basis, rule: 'confirmed' };
      await fetch(`${base}/catalog/coffees/${coffeeId}/match`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archetype: 'earthy', confidence: 'low', source: 'cupping', sessionId, notes: 'basis: cupping: none; rule: confirmed', basis: again }) });
      await fetch(`${base}/catalog/coffees/${coffeeId}/match`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archetype: 'earthy', confidence: 'low', source: 'cupping', sessionId, notes: 'basis: cupping: none; rule: confirmed', basis: again }) });
      const rows = (await db.query(`SELECT basis FROM coffee_archetype_assignment WHERE coffee_id = $1 ORDER BY id`, [coffeeId])).rows;
      expect(rows.length).toBe(2);
      expect(rows[1].basis).toEqual(again);

      const bad = await fetch(`${base}/catalog/coffees/${coffeeId}/match`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archetype: 'earthy', confidence: 'low', source: 'cupping', basis: ['not', 'an', 'object'] }) });
      expect(bad.status).toBe(400);

      const [slot] = await freeSlotsInOneArchetype(1, { archetype: 'earthy' });
      const pBasis = { sessions: [sessionId], band: { slot_id: slot.id, lo: null, hi: null, check: 'no_band' }, rule: 'confirmed' };
      const post = await fetch(`${base}/catalog/coffees/${coffeeId}/placements`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: slot.id, role: 'home', placementNote: 'basis: cupping: none; rule: confirmed', basis: pBasis, placedFromSessionId: sessionId }),
      });
      expect(post.status).toBe(201);
      const p = (await db.query(`SELECT basis, placed_from_session_id FROM coffee_slot_assignment WHERE coffee_id = $1 AND is_active`, [coffeeId])).rows[0];
      expect(p.basis).toEqual(pBasis);
      expect(p.placed_from_session_id).toBe(sessionId);

      const cov = (await db.query(`SELECT assignment_basis_present FROM v_evidence_coverage WHERE coffee_id = $1`, [coffeeId])).rows[0];
      expect(cov.assignment_basis_present).toBe(true);
    } finally {
      if (coffeeId) {
        await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id = $1`, [coffeeId]);
        await db.query(`DELETE FROM coffee_archetype_assignment WHERE coffee_id = $1`, [coffeeId]);
        await db.query(`DELETE FROM coffee_sku WHERE coffee_id = $1`, [coffeeId]);
        await db.query(`DELETE FROM coffees WHERE id = $1`, [coffeeId]);
      }
      await db.query(`DELETE FROM roaster WHERE id = $1`, [roaster.id]);
    }
  }, 30000);
});

// Coffee presentation brief 1 (2026-10-23), E1: the admin wheel's roastery
// branch is the customer voice's roaster rows, so it agrees with the public
// wheel (Dana: "we should align"). Tiger Stripe's brief 2 website capture
// names Fruity (a family: never a note).
describe('GET /api/admin/flavor-wheel/:coffeeId (coffee presentation brief 1)', () => {
  it('roastery rows: what the customer sees, in the same order as the public read, plus the hidden rows tagged', async () => {
    const { getCustomerDescriptors } = await import('../services/cuppingReads.js');
    const rows = await (await fetch(`${base}/flavor-wheel/${TIGER_STRIPE}`)).json();
    const roastery = rows.filter((r: any) => r.source === 'roastery');
    const shown = roastery.filter((r: any) => r.customer_sees === 'signature' || r.customer_sees === 'accent');
    const publicRows = (await getCustomerDescriptors(TIGER_STRIPE)).filter(r => r.voice !== 'customer');
    expect(shown.map((r: any) => r.descriptor)).toEqual(publicRows.map(r => r.descriptor));
    expect(roastery.find((r: any) => r.descriptor === 'Fruity')).toMatchObject({ customer_sees: 'hidden by tier', qualifies: false });
    for (const r of roastery) expect(r.roaster_channels.length).toBeGreaterThan(0);
    expect(rows.some((r: any) => r.source === 'internal')).toBe(true); // the consensus branch is unchanged
  });
});

describe('evidenceReads.getFamilies (the D6 input)', () => {
  it('lists the families named by us or by the roaster, most sources first', async () => {
    const families = await getFamilies(benchmarkId);
    expect(families.slice(0, 3)).toEqual(expect.arrayContaining(['Sweet', 'Nutty / Cocoa', 'Spices']));
  });
});

describe('evidenceIntegrity', () => {
  it('runs eight named checks; the Writer fields name the services; every superseded row has its replacement', async () => {
    const report = await runEvidenceIntegrityChecks();
    expect(report.checks.length).toBe(8);
    const byId = new Map(report.checks.map(c => [c.id, c]));
    expect(byId.get(1)!.ok).toBe(true);
    expect(byId.get(3)!.ok).toBe(true);
    expect(byId.get(4)!.ok).toBe(true);
    expect(byId.get(5)!.ok).toBe(true);
    for (const c of report.checks) expect(c.count).toBe(c.ok ? 0 : c.count);
  });

  it('reports Flying Jewel: placed, and its assignment states no basis', async () => {
    const report = await runEvidenceIntegrityChecks();
    const placed = report.checks.find(c => c.id === 6)!;
    expect(placed.ok).toBe(false);
    expect(placed.sample.some(s => s.startsWith('Flying Jewel'))).toBe(true);
  });
});
