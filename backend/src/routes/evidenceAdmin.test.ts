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
    expect(body.calls.length).toBe(1);
  });

  it('roastery: calibration, cuppers, coverage and the stale-decision count', async () => {
    const res = await fetch(`${base}/evidence/roastery/${JOE_BEAN}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.calibration.length).toBeGreaterThan(0);
    expect(body.coverage.length).toBe(4);
    expect(body.cuppers.length).toBeGreaterThan(0);
    expect(body.staleDecisions).toBe(0);
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
