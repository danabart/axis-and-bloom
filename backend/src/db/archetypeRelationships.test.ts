// Website 9 (2026-11-06, D16; Dana's Q1 = C, Q2): the family relationship.
// getArchetypeRelationships runs its own SQL against fixture hops and fixture
// cupped-family profiles (a runner that swaps the two views for VALUES lists,
// everything else to the test DB, nothing written), then the route over the
// real test catalog, then the lookup seed.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import express from 'express';
import type { Server } from 'node:http';
import { db } from './client.js';
import { getArchetypes, getArchetypeOrder, archetypeCustomerWords } from '../services/catalogReads.js';
import { getArchetypeRelationships, getRelationshipKinds, profileDistance } from '../services/archetypeRelationshipReads.js';
import coffeesRouter from '../routes/coffees.js';

afterAll(async () => { await db.end(); });

type Pair = [a: string, b: string, hops: number, confidence: number | null];
type Prof = [archetype: string, dimension: number, midpoint: number, coffeeIds: number[]];
function fixtureRunner(pairs: Pair[], profiles: Prof[]) {
  const adj = pairs.length
    ? `(VALUES ${pairs.map(([a, b, h, c]) => `('${a}', '${b}', ${h}::bigint, ${c === null ? 'NULL' : c}::numeric)`).join(', ')}) AS adj(archetype_a, archetype_b, hop_count, avg_confidence)`
    : '(SELECT NULL::text AS archetype_a, NULL::text AS archetype_b, NULL::bigint AS hop_count, NULL::numeric AS avg_confidence WHERE false) AS adj';
  const prof = profiles.length
    ? `(VALUES ${profiles.map(([a, d, m, ids]) => `('${a}', ${d}, ${m}::numeric, ARRAY[${ids.join(',')}]::int[])`).join(', ')}) AS prof(archetype, dimension_id, avg_midpoint, coffee_ids)`
    : '(SELECT NULL::text AS archetype, NULL::int AS dimension_id, NULL::numeric AS avg_midpoint, NULL::int[] AS coffee_ids WHERE false) AS prof';
  return {
    query: (sql: string, params?: unknown[]) => db.query(
      sql.replace('FROM v_coffee_archetype_adjacency', `FROM ${adj}`).replace('FROM v_archetype_dimension_profile', `FROM ${prof}`),
      params,
    ),
  } as unknown as typeof db;
}

async function real() {
  return (await getArchetypes()).filter(a => a.is_archetype).sort((a, b) => a.sort_order - b.sort_order).map(a => a.code as string);
}
async function params() {
  const r = (await db.query<{ min: string; sig: string }>(
    `SELECT param('archetype_profile_min_coffees') AS min, param('dimension_delta_significant') AS sig`
  )).rows[0];
  return { min: Number(r.min), sig: Number(r.sig) };
}
/** enough distinct cupped coffees for a family to count, offset so families never share ids */
const ids = (n: number, offset: number) => Array.from({ length: Math.max(1, n) }, (_, i) => offset + i + 1);

describe('profileDistance', () => {
  it('is the largest difference over shared dimensions, null with none shared', () => {
    expect(profileDistance(new Map([[1, 5], [2, 7]]), new Map([[1, 6], [2, 4], [3, 9]]))).toBe(3);
    expect(profileDistance(new Map([[1, 5]]), new Map([[2, 5]]))).toBeNull();
  });
});

describe('getArchetypeRelationships (Q1 = C)', () => {
  it('own; hops make a family adjacent; else the cupped-profile distance against dimension_delta_significant; no evidence = no label', async () => {
    const [a0, a1, a2, a3, a4] = await real();
    const { min, sig } = await params();
    const rels = await getArchetypeRelationships(a0, fixtureRunner(
      [[a4, a0, 2, 1]],
      [
        [a0, 1, 5, ids(min, 0)], [a0, 2, 5, ids(min, 0)],
        [a1, 1, 5 + sig + 1, ids(min, 100)], [a1, 2, 5, ids(min, 100)],  // further than significant: distant
        [a2, 1, 5 + sig / 2, ids(min, 200)], [a2, 2, 5, ids(min, 200)],  // within: adjacent by profile
        [a3, 1, 5, ids(Math.max(0, min - 1), 300)],                         // too few cupped coffees: unlabelled
        [a4, 1, 5 + sig + 3, ids(min, 400)],                                // hops win over a far profile
      ],
    ));
    const by = Object.fromEntries(rels.map(r => [r.archetype, `${r.code}/${r.basis}`]));
    expect(by[a0]).toBe('own/own');
    expect(by[a4]).toBe('adjacent/hops');
    expect(by[a2]).toBe('adjacent/profile');
    expect(by[a1]).toBe('distant/profile');
    if (min > 1) expect(by[a3]).toBe('null/null');
    // order: own, hop-adjacent, profile-adjacent, distant, unlabelled
    expect(rels.slice(0, 4).map(r => r.archetype)).toEqual([a0, a4, a2, a1]);
  });

  it('profile-adjacent families order by distance, then sort_order', async () => {
    const [a0, a1, a2, a3] = await real();
    const { min, sig } = await params();
    const rels = await getArchetypeRelationships(a0, fixtureRunner([], [
      [a0, 1, 5, ids(min, 0)],
      [a1, 1, 5 + sig * 0.9, ids(min, 100)],
      [a2, 1, 5 + sig * 0.1, ids(min, 200)],
      [a3, 1, 5 + sig * 0.1, ids(min, 300)],
    ]));
    expect(rels.slice(0, 4).map(r => r.archetype)).toEqual([a0, a2, a3, a1]);
    expect(rels.slice(1, 4).every(r => r.code === 'adjacent')).toBe(true);
  });

  it('a guest, an unknown or a non-flavor code: sort_order and no codes', async () => {
    const r = await real();
    const nonFlavor = (await getArchetypes()).find(a => !a.is_archetype)?.code ?? 'experimental';
    for (const m of [null, '', 'nope', nonFlavor]) {
      const rels = await getArchetypeRelationships(m, fixtureRunner([], []));
      expect(rels.map(x => x.archetype)).toEqual(r);
      expect(rels.every(x => x.code === null)).toBe(true);
    }
  });

  it('getArchetypeOrder is its projection', async () => {
    const r = await real();
    for (const code of r) expect(await getArchetypeOrder(code)).toEqual((await getArchetypeRelationships(code)).map(x => x.archetype));
  });

  it('reads cupped-coffee profiles only: no archetype_vector in the service', () => {
    const src = readFileSync(new URL('../services/archetypeRelationshipReads.ts', import.meta.url), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    expect(src).not.toMatch(/archetype_vector|v_archetype_vectors/);
    expect(src).toMatch(/FROM v_archetype_dimension_profile/);
  });
});

describe('coffee_archetype_relationship_kind (Q2)', () => {
  it('seeds the three levels with every word, idempotently', async () => {
    const seed = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
      .match(/INSERT INTO coffee_archetype_relationship_kind[\s\S]*?ON CONFLICT \(code\) DO NOTHING;/)![0];
    await db.query(seed);
    await db.query(seed);
    const kinds = await getRelationshipKinds();
    expect(kinds.map(k => [k.code, k.zoneCode, k.badgeCode, k.customerLabel])).toEqual([
      ['own', 'in', 'wheelhouse', 'Your family'],
      ['adjacent', 'edge', 'exploring', 'Worth exploring'],
      ['distant', 'outside', 'stretch', 'Outside your comfort zone'],
    ]);
    expect(kinds.every(k => k.zoneLabel && k.badgeLabel)).toBe(true);
  });
});

describe('GET /api/coffees/archetype-order (Website 9 payload)', () => {
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
    return (await fetch(`${base}/archetype-order${qs}`)).json() as Promise<{ order: string[]; relationships?: Array<{ archetype: string; code: string | null; customerLabel: string | null }>; kinds: Array<{ code: string; customerLabel: string }> }>;
  }

  it('matched: one relationship per family in order, own first, labels from the lookup', async () => {
    const r = await real();
    const kinds = await getRelationshipKinds();
    const body = await get(`?archetype=${r[2]}`);
    expect(body.relationships!.map(x => x.archetype)).toEqual(body.order);
    expect(body.relationships![0]).toEqual({ archetype: r[2], code: 'own', customerLabel: kinds.find(k => k.code === 'own')!.customerLabel });
    for (const x of body.relationships!) expect(x.customerLabel).toBe(x.code ? kinds.find(k => k.code === x.code)!.customerLabel : null);
    expect(body.kinds.map(k => k.code)).toEqual(['own', 'adjacent', 'distant']);
  });

  it('a guest gets the order and the words, no relationships', async () => {
    const body = await get('');
    expect(body.order).toEqual(await real());
    expect(body.relationships).toBeUndefined();
    expect(body.kinds).toHaveLength(3);
  });
});

describe('AU8: the family features are its customer words', () => {
  it('archetypeCustomerWords reads coffee_archetype.customer_words; users.ts types no feature sentence', async () => {
    const rows = (await getArchetypes()).filter(a => a.is_archetype);
    for (const a of rows) expect(await archetypeCustomerWords(a.code)).toEqual(a.customer_words ?? []);
    expect(await archetypeCustomerWords('not_a_family')).toEqual([]);
    const src = readFileSync(new URL('../routes/users.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/features: \[\s*'/);
    expect(src).toMatch(/features: await archetypeCustomerWords\(archetypeKey\)/);
  });
});

