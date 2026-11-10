// Ella's Bloom Map 1 (2026-11-10), B4 — the map admin routes on the test DB:
// every GET answers, the evidence parameters list filters by prefix, bad
// input is refused before any service runs. requireAdmin mocked to a
// passthrough (the evidenceAdmin.test.ts pattern). No write is sent.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../middleware/auth.js', () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));
vi.setConfig({ testTimeout: 60_000 });

const { default: evidenceRouter } = await import('./evidenceAdmin.js');
const { default: adminRouter } = await import('./admin.js');
const { DIAL_PARAMETER_KEYS } = await import('../services/dataCatalogIntegrity.js');

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/evidence', evidenceRouter);
  app.use('/api/admin', adminRouter);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/admin`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('GET /api/admin/map/*', () => {
  it('every read answers 200 with its shape', async () => {
    for (const path of ['preview', 'placement', 'edges?mode=preview', 'edges?mode=active', 'hops?mode=preview', 'face', 'versions', 'first-match']) {
      const res = await fetch(`${base}/map/${path}`);
      expect(res.status, path).toBe(200);
      expect(Array.isArray(await res.json()), path).toBe(true);
    }
    const wedges = await (await fetch(`${base}/map/wedges`)).json();
    expect(wedges.wedges.map((w: any) => w.archetype_code)).toEqual(['balanced_sweet', 'chocolate_nutty', 'fruity', 'earthy', 'floral']);
    expect(wedges.seams.length).toBe(4);
    const phrases = await (await fetch(`${base}/map/phrases`)).json();
    const fruityBolder = phrases.resolved.find((p: any) => p.archetype_code === 'fruity' && p.move_code === 'bolder');
    expect(fruityBolder.button_label).toBe('Brighter');
    expect(fruityBolder.move_line_template).toBe('Bolder than {from}: {deltas}'); // override falls back to the default's line
    const gc = await (await fetch(`${base}/map/graph-check?mode=preview`)).json();
    expect(gc.mode).toBe('preview');
    expect(Array.isArray(gc.reachable)).toBe(true);
    expect(gc.parameters.dial_ring_cut_1).toBeTypeOf('number');
  });

  it('vocabulary and lean history answer (Ella map 2)', async () => {
    const v = await (await fetch(`${base}/map/vocabulary`)).json();
    expect(Object.keys(v)).toEqual(['lanes', 'laneWords', 'grades', 'moves', 'versionStatuses', 'firstMatchStatuses', 'sizes', 'rings', 'flags', 'readings', 'deltaPhrases']);
    const h = await fetch(`${base}/map/lean/2905/history`);
    expect(h.status).toBe(200);
    expect(Array.isArray(await h.json())).toBe(true);
    expect((await fetch(`${base}/map/lean/x/history`)).status).toBe(400);
  });

  it('refuses a bad mode, a bad coffee id and a bad lane', async () => {
    expect((await fetch(`${base}/map/edges?mode=nope`)).status).toBe(400);
    expect((await fetch(`${base}/map/hops?mode=preview&coffeeId=x`)).status).toBe(400);
    const res = await fetch(`${base}/map/lean/1`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lane: 'sideways' }) });
    expect(res.status).toBe(400);
  });

  it('GET /evidence/parameters?prefix=dial_ lists exactly the map keys', async () => {
    const rows = await (await fetch(`${base}/evidence/parameters?prefix=dial_`)).json();
    expect(rows.map((r: any) => r.key).sort()).toEqual([...DIAL_PARAMETER_KEYS].sort());
    const all = await (await fetch(`${base}/evidence/parameters`)).json();
    expect(all.length).toBeGreaterThan(rows.length);
    expect((await fetch(`${base}/evidence/parameters?prefix=DROP;`)).status).toBe(400);
  });
});
