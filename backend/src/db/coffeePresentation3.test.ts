// Coffee presentation brief 3 (2026-10-24), decision 1: the Bloom's box
// order by adjacency. getArchetypeOrder runs its own SQL against a fixture
// adjacency: a runner that swaps v_coffee_archetype_adjacency for a VALUES
// list (both columns used, as the symmetric view does) and sends everything
// else to the pool, so nothing is created or written. Then the route over the
// real catalog, and the route file holds no archetype_vector reference.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import express from 'express';
import type { Server } from 'node:http';
import { db } from './client.js';
import { getArchetypes, getArchetypeOrder } from '../services/catalogReads.js';
import coffeesRouter from '../routes/coffees.js';

afterAll(async () => { await db.end(); });

type Pair = [a: string, b: string, hops: number, confidence: number | null];
function fixtureRunner(pairs: Pair[]) {
  const values = pairs
    .map(([a, b, hops, c]) => `('${a}', '${b}', ${hops}::bigint, ${c === null ? 'NULL' : c}::numeric)`)
    .join(', ');
  return {
    query: (sql: string, params?: unknown[]) => db.query(
      sql.replace('FROM v_coffee_archetype_adjacency', `FROM (VALUES ${values}) AS adj(archetype_a, archetype_b, hop_count, avg_confidence)`),
      params,
    ),
  } as unknown as typeof db;
}

async function real() {
  return (await getArchetypes()).filter(a => a.is_archetype).sort((a, b) => a.sort_order - b.sort_order).map(a => a.code as string);
}

describe('getArchetypeOrder (decision 1)', () => {
  it('matched: own first, then adjacent by hop_count desc, avg_confidence desc, sort_order; then the rest by sort_order', async () => {
    const r = await real();
    expect(r.length).toBeGreaterThanOrEqual(5);
    const [a0, a1, a2, a3, a4] = r;
    // a2 is matched; read from either column. a0 has the most hops; a3 and a4
    // tie on hops and confidence (sort_order decides); a1 is not adjacent.
    const order = await getArchetypeOrder(a2, fixtureRunner([
      [a4, a2, 2, 2.5],
      [a2, a0, 5, 1],
      [a3, a2, 2, 2.5],
      [a0, a1, 9, 3], // not touching a2: ignored
    ]));
    expect(order.slice(0, 5)).toEqual([a2, a0, a3, a4, a1]);
    expect(order).toEqual([a2, a0, a3, a4, a1, ...r.slice(5)]);
  });

  it('confidence breaks a hop tie, null confidence last', async () => {
    const [a0, a1, a2, a3] = await real();
    const order = await getArchetypeOrder(a0, fixtureRunner([[a0, a1, 3, null], [a0, a2, 3, 1.5], [a3, a0, 3, 2]]));
    expect(order.slice(0, 4)).toEqual([a0, a3, a2, a1]);
  });

  it('no adjacency at all: own first, then sort_order', async () => {
    const r = await real();
    expect(await getArchetypeOrder(r[3], fixtureRunner([[r[0], r[1], 4, 2]]))).toEqual([r[3], ...r.filter(c => c !== r[3])]);
  });

  it('unmatched, unknown or non-flavor: sort_order', async () => {
    const r = await real();
    const nonFlavor = (await getArchetypes()).find(a => !a.is_archetype)?.code ?? 'experimental';
    for (const m of [null, '', 'not_a_real_archetype', nonFlavor]) {
      expect(await getArchetypeOrder(m, fixtureRunner([[r[0], r[1], 4, 2]]))).toEqual(r);
    }
  });
});

describe('GET /api/coffees/archetype-order', () => {
  let server: Server | undefined;
  let base = '';
  afterAll(() => new Promise<void>(res => { if (server) server.close(() => res()); else res(); }));
  async function get(qs: string) {
    if (!server) {
      const app = express();
      app.use('/api/coffees', coffeesRouter);
      const s: Server = await new Promise(res => { const l = app.listen(0, () => res(l)); });
      server = s;
      const addr = s.address();
      base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/api/coffees`;
    }
    return (await fetch(`${base}/archetype-order${qs}`)).json() as Promise<{ order: string[] }>;
  }

  it('matched: the real adjacency, as getArchetypeOrder reads it', async () => {
    const r = await real();
    for (const code of r) expect((await get(`?archetype=${code}`)).order).toEqual(await getArchetypeOrder(code));
  });

  it('unmatched or garbage: sort_order', async () => {
    const r = await real();
    expect((await get('')).order).toEqual(r);
    expect((await get('?archetype=%27%3B%20drop')).order).toEqual(r);
  });

  it('archetype-stats is gone, and the admin hop gap is param(\'hop_suggestion_gap\') (Dana\'s go)', async () => {
    const coffeesSrc = readFileSync(new URL('../routes/coffees.ts', import.meta.url), 'utf8');
    expect(coffeesSrc).not.toMatch(/router\.get\('\/archetype-stats'/);
    const adminSrc = readFileSync(new URL('../routes/admin.ts', import.meta.url), 'utf8');
    expect(adminSrc).toMatch(/param\('hop_suggestion_gap'\)/);
    expect(adminSrc).not.toMatch(/getArchetypeBucketWidth|v_archetype_dimension_comparison|v_archetype_vectors/);
    const { rows: [p] } = await db.query(`SELECT param('hop_suggestion_gap')::float AS v, note FROM evidence_parameter WHERE key = 'hop_suggestion_gap' AND superseded_at IS NULL`);
    expect(p.v).toBe(0.5);
    expect(p.note).toMatch(/Range: numeric 0 < value <= 15\.$/);
  });

  it('the route file holds no archetype_vector reference', () => {
    const src = readFileSync(new URL('../routes/coffees.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/archetype_vector/);
    expect(src).not.toMatch(/Euclidean|ideal_score/);
  });
});
