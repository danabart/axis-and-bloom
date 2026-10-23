// Cupping evidence brief 6 (2026-10-21): the pooled range (Part A), the
// cupping-note consensus (Part B), remarks resolved through the mapping table
// and the customer voice (Part C), the parameter service (Part E). Every
// fixture lives inside a rolled-back transaction (withRollback): evidence rows
// are immutable once committed. Expected numbers are computed here from the
// formula and the current parameter rows, never typed from the brief.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import type pg from 'pg';
import { db } from './client.js';
import { withRollback } from '../test/withRollback.js';
import { setParameterInTx, parseSaneRange } from '../services/evidenceParameterService.js';
import { setNoteMappingInTx, retireNoteMappingInTx } from '../services/noteMappingService.js';
import { getCustomerDescriptors } from '../services/cuppingReads.js';

afterAll(async () => { await db.end(); });

const ACIDITY = 5;

interface Base { roasterId: string; coffeeId: number; cupperA: number; cupperB: number }
async function base(c: pg.PoolClient, tag: string): Promise<Base> {
  const roasterId = (await c.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ($1, true) RETURNING id`, [`Zzz Pooled Roastery ${tag}`])).rows[0].id;
  const coffeeId = (await c.query<{ id: number }>(`INSERT INTO coffees (name, roaster_id, is_active) VALUES ($1, $2, true) RETURNING id`, [`Zzz Pooled Coffee ${tag}`, roasterId])).rows[0].id;
  const cupperA = (await c.query<{ id: number }>(`INSERT INTO cupper (name) VALUES ($1) RETURNING id`, [`Zzz Cupper A ${tag}`])).rows[0].id;
  const cupperB = (await c.query<{ id: number }>(`INSERT INTO cupper (name) VALUES ($1) RETURNING id`, [`Zzz Cupper B ${tag}`])).rows[0].id;
  return { roasterId, coffeeId, cupperA, cupperB };
}
const nodeId = async (c: pg.PoolClient, descriptor: string, tier?: number) =>
  (await c.query<{ id: string }>(`SELECT id FROM cupping_note WHERE descriptor = $1 AND is_active ${tier ? 'AND tier = $2' : ''} ORDER BY tier LIMIT 1`,
    tier ? [descriptor, tier] : [descriptor])).rows[0].id;

/** One session on `date`: a cupper row and a merged row with the same Acidity range, and the cupper's descriptors. */
async function session(c: pg.PoolClient, b: Base, date: string, lo: number, hi: number, notes: string[] = [], cupper = b.cupperA): Promise<number> {
  const sessionId = (await c.query<{ id: number }>(`INSERT INTO cupping_sessions (session_date, record_source) VALUES ($1, 'test:evidencePooled') RETURNING id`, [date])).rows[0].id;
  const scId = (await c.query<{ id: number }>(`INSERT INTO cupping_session_coffees (session_id, coffee_id) VALUES ($1, $2) RETURNING id`, [sessionId, b.coffeeId])).rows[0].id;
  const cupperRow = (await c.query<{ id: number }>(`INSERT INTO cupping_scores (session_coffee_id, cupper_id, is_merged, scale_code) VALUES ($1, $2, false, 'ab_0_15') RETURNING id`, [scId, cupper])).rows[0].id;
  const mergedRow = (await c.query<{ id: number }>(`INSERT INTO cupping_scores (session_coffee_id, is_merged, scale_code, merge_rule) VALUES ($1, true, 'ab_0_15', 'union_v1') RETURNING id`, [scId])).rows[0].id;
  for (const row of [cupperRow, mergedRow]) {
    await c.query(`INSERT INTO cupping_score_values (cupping_score_id, dimension_id, value_min, value_max, raw_value) VALUES ($1, $2, $3, $4, $5)`,
      [row, ACIDITY, lo, hi, lo === hi ? `${lo}` : `${lo}-${hi}`]);
  }
  for (const n of notes) {
    await c.query(`INSERT INTO cupping_score_descriptors (cupping_score_id, cupping_note_id, custom_notes) VALUES ($1, $2, $3)`, [cupperRow, await nodeId(c, n), n.toLowerCase()]);
  }
  return sessionId;
}

const param = async (c: pg.PoolClient, key: string) => Number((await c.query<{ v: string }>(`SELECT param($1) AS v`, [key])).rows[0].v);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
/** The weights decision 1 gives sessions on `dates` (latest last in the array), normalised, latest first. */
async function expectedWeights(c: pg.PoolClient, dates: string[]): Promise<number[]> {
  const ratio = await param(c, 'session_rank_ratio');
  const halfLife = await param(c, 'session_half_life_days');
  const latest = dates[dates.length - 1];
  const raw = [...dates].reverse().map((d, rank) => Math.pow(ratio, rank) * Math.pow(0.5, daysBetween(d, latest) / halfLife));
  const total = raw.reduce((s, w) => s + w, 0);
  return raw.map(w => w / total);
}
async function rangeRow(c: pg.PoolClient, coffeeId: number) {
  return (await c.query(`SELECT * FROM v_coffee_dimension_range WHERE coffee_id = $1 AND dimension_id = $2`, [coffeeId, ACIDITY])).rows[0];
}

describe('v_coffee_dimension_range: pooled across sessions (A1)', () => {
  it('two sessions one day apart: 60 / 40 by rank, pooled min / max / midpoint the weighted averages', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await base(c, 'two');
      const s1 = await session(c, b, '2026-01-01', 2, 4);
      const s2 = await session(c, b, '2026-01-02', 6, 8);
      const [w2, w1] = await expectedWeights(c, ['2026-01-01', '2026-01-02']);
      const r = await rangeRow(c, b.coffeeId);
      expect(Number(w2.toFixed(2))).toBe(0.6);
      expect(Number(r.value_min)).toBeCloseTo(w2 * 6 + w1 * 2, 2);
      expect(Number(r.value_max)).toBeCloseTo(w2 * 8 + w1 * 4, 2);
      expect(Number(r.midpoint)).toBeCloseTo((w2 * 7 + w1 * 3), 2);
      expect(Number(Number(r.weight_latest_share).toFixed(2))).toBe(0.6);
      expect(r.n_sessions_pooled).toBe(2);
      expect(r.session_id).toBe(s2);
      expect(r.session_weights.map((x: any) => x.session_id)).toEqual([s2, s1]);
      expect(r.session_weights.map((x: any) => Number(x.weight).toFixed(2))).toEqual(['0.60', '0.40']);
    });
  });

  it('the same two sessions 365 days apart: rank and half-life multiply, 0.75 / 0.25', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await base(c, 'year');
      await session(c, b, '2025-01-02', 2, 4);
      await session(c, b, '2026-01-02', 6, 8);
      const r = await rangeRow(c, b.coffeeId);
      expect(r.session_weights.map((x: any) => Number(x.weight).toFixed(2))).toEqual(['0.75', '0.25']);
      expect(Number(Number(r.weight_latest_share).toFixed(2))).toBe(0.75);
    });
  });

  it('three sessions a day apart: 0.47 / 0.32 / 0.21', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await base(c, 'three');
      const dates = ['2026-01-01', '2026-01-02', '2026-01-03'];
      for (const d of dates) await session(c, b, d, 4, 6);
      const r = await rangeRow(c, b.coffeeId);
      const expected = (await expectedWeights(c, dates)).map(w => w.toFixed(2));
      expect(expected).toEqual(['0.47', '0.32', '0.21']);
      expect(r.session_weights.map((x: any) => Number(x.weight).toFixed(2))).toEqual(expected);
    });
  });

  it("sessions_disagree is true when two sessions' midpoints differ by more than session_gap, false at the gap", async () => {
    const gap = Number((await db.query<{ v: string }>(`SELECT param('session_gap') AS v`)).rows[0].v);
    await withRollback(async ({ client: c }) => {
      const b = await base(c, 'over');
      await session(c, b, '2026-01-01', 2, 4);                 // midpoint 3
      await session(c, b, '2026-01-02', 2 + gap + 1, 4 + gap + 1); // midpoint 3 + gap + 1
      expect((await rangeRow(c, b.coffeeId)).sessions_disagree).toBe(true);
    });
    await withRollback(async ({ client: c }) => {
      const b = await base(c, 'at');
      await session(c, b, '2026-01-01', 2, 4);
      await session(c, b, '2026-01-02', 2 + gap, 4 + gap);     // exactly the gap
      expect((await rangeRow(c, b.coffeeId)).sessions_disagree).toBe(false);
    });
  });

  it('one session: the pooled range equals that session, share 1', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await base(c, 'one');
      const s = await session(c, b, '2026-01-01', 3, 5);
      const r = await rangeRow(c, b.coffeeId);
      expect([Number(r.value_min), Number(r.value_max), Number(r.midpoint), Number(r.weight_latest_share), r.n_sessions_pooled, r.sessions_disagree])
        .toEqual([3, 5, 4, 1, 1, false]);
      expect(r.session_id).toBe(s);
    });
  });

  it('setParameter(session_rank_ratio, 0.5) in the same transaction re-weights to 0.667 / 0.333, nothing else changes', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await base(c, 'ratio');
      await session(c, b, '2026-01-01', 2, 4);
      await session(c, b, '2026-01-02', 6, 8);
      const before = await rangeRow(c, b.coffeeId);
      await setParameterInTx(c, { key: 'session_rank_ratio', value: 0.5, note: 'vitest, rolled back', adminId: 'vitest' });
      const after = await rangeRow(c, b.coffeeId);
      expect(after.session_weights.map((x: any) => Number(x.weight).toFixed(3))).toEqual(['0.667', '0.333']);
      expect(Number(after.rank_ratio)).toBe(0.5);
      expect([after.session_id, after.n_sessions_pooled, after.n_sessions, after.half_life_days]).toEqual([before.session_id, before.n_sessions_pooled, before.n_sessions, before.half_life_days]);
    });
  });
});

describe('v_evidence_descriptor_consensus (B1)', () => {
  it('two sessions, Cocoa named in both and Honey in one: 2 of 2 and 1 of 2, one row per node', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await base(c, 'consensus');
      await session(c, b, '2026-01-01', 4, 6, ['Cocoa', 'Honey']);
      await session(c, b, '2026-01-02', 4, 6, ['Cocoa']);
      const r = (await c.query(`SELECT descriptor, sessions_named, sessions_total, share::float AS share, cuppers, words
                                  FROM v_evidence_descriptor_consensus WHERE coffee_id = $1 ORDER BY share DESC, descriptor`, [b.coffeeId])).rows;
      expect(r.map(x => [x.descriptor, x.sessions_named, x.sessions_total, x.share])).toEqual([['Cocoa', 2, 2, 1], ['Honey', 1, 2, 0.5]]);
      expect(r[0].cuppers).toEqual([`Zzz Cupper A consensus`]);
      expect(r[0].words).toEqual(['cocoa']);
    });
  });
});

/** A current website descriptor remark (said_on fixed, so one capture). */
async function website(c: pg.PoolClient, b: Base, remark: string, node: string | null) {
  await c.query(
    `INSERT INTO roastery_remark (roaster_id, coffee_id, said_by, said_on, channel, topic, remark, cupping_note_id, recorded_by, record_source)
     VALUES ($1, $2, 'Zzz roaster site', '2026-01-05', 'website', 'descriptor', $3, $4, 'vitest', 'test:evidencePooled')`,
    [b.roasterId, b.coffeeId, remark, node ? await nodeId(c, node) : null]);
}
async function voice(c: pg.PoolClient, coffeeId: number) {
  return (await c.query(`SELECT descriptor, voice, rank, confirmed_by_cupping, cupping_sessions_named, cupping_sessions_total
                           FROM v_coffee_customer_descriptor WHERE coffee_id = $1 ORDER BY display_order`, [coffeeId])).rows;
}

describe('v_roastery_remark resolves a remark through the current mapping (C0)', () => {
  it('no node until its words are mapped; mapped → node_source mapping; mapping superseded → gone again', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await base(c, 'c0');
      const words = 'zzz graham cracker c0';
      await website(c, b, 'Zzz  Graham Cracker C0', null);
      const read = async () => (await c.query(`SELECT cupping_note_id, cupping_note_descriptor, node_source, stored_cupping_note_id
                                                 FROM v_roastery_remark WHERE coffee_id = $1`, [b.coffeeId])).rows[0];
      expect(await read()).toMatchObject({ cupping_note_id: null, node_source: null });
      expect(await voice(c, b.coffeeId)).toEqual([]);
      await setNoteMappingInTx(c, { normalizedWords: words, cuppingNoteId: await nodeId(c, 'Brown Sugar'), sourceKind: 'roaster', note: 'vitest' });
      expect(await read()).toMatchObject({ cupping_note_descriptor: 'Brown Sugar', node_source: 'mapping', stored_cupping_note_id: null });
      expect((await voice(c, b.coffeeId)).map(x => x.descriptor)).toEqual(['Brown Sugar']);
      const mappingId = (await c.query(`SELECT id FROM v_note_mapping_current WHERE normalized_words = $1 AND source_kind = 'roaster'`, [words])).rows[0].id;
      await retireNoteMappingInTx(c, mappingId);
      expect(await read()).toMatchObject({ cupping_note_id: null, node_source: null });
    });
  });
});

describe('v_coffee_customer_descriptor: the roaster leads, our cupping confirms (C1)', () => {
  it('(a) roaster Citrus Fruit + our Orange under it: one row, Citrus Fruit, confirmed; no Orange row', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await base(c, 'a');
      await website(c, b, 'citrus', 'Citrus Fruit');
      await session(c, b, '2026-01-01', 4, 6, ['Orange']);
      expect(await voice(c, b.coffeeId)).toEqual([{ descriptor: 'Citrus Fruit', voice: 'roaster_website', rank: 2, confirmed_by_cupping: true, cupping_sessions_named: 1, cupping_sessions_total: 1 }]);
    });
  });

  it('(b) roaster Orange + our Citrus Fruit above it: Orange confirmed (ancestor hit)', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await base(c, 'b');
      await website(c, b, 'orange', 'Orange');
      await session(c, b, '2026-01-01', 4, 6, ['Citrus Fruit']);
      expect((await voice(c, b.coffeeId)).map(x => [x.descriptor, x.confirmed_by_cupping])).toEqual([['Orange', true]]);
    });
  });

  it('(c) roaster Citrus Fruit + our Citrus Fruit: confirmed', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await base(c, 'c');
      await website(c, b, 'citrus', 'Citrus Fruit');
      await session(c, b, '2026-01-01', 4, 6, ['Citrus Fruit']);
      expect((await voice(c, b.coffeeId)).map(x => [x.descriptor, x.confirmed_by_cupping])).toEqual([['Citrus Fruit', true]]);
    });
  });

  it('(d) our Cocoa, roaster never near it: no Cocoa row anywhere, the roaster word unconfirmed', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await base(c, 'd');
      await website(c, b, 'citrus', 'Citrus Fruit');
      await session(c, b, '2026-01-01', 4, 6, ['Cocoa']);
      expect((await voice(c, b.coffeeId)).map(x => [x.descriptor, x.confirmed_by_cupping])).toEqual([['Citrus Fruit', false]]);
    });
  });

  it('(e) no roaster rows and no customer rows: nothing for that coffee, whatever we cupped', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await base(c, 'e');
      await session(c, b, '2026-01-01', 4, 6, ['Cocoa', 'Honey']);
      expect(await voice(c, b.coffeeId)).toEqual([]);
    });
  });

  it('(f) both say Fruity only: not a hit below customer_voice_hit_tier; Fruity once, roaster, unconfirmed', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await base(c, 'f');
      expect(await param(c, 'customer_voice_hit_tier')).toBeGreaterThan(1);
      await website(c, b, 'fruity', 'Fruity');
      await session(c, b, '2026-01-01', 4, 6, ['Fruity']);
      expect((await voice(c, b.coffeeId)).map(x => [x.descriptor, x.voice, x.confirmed_by_cupping])).toEqual([['Fruity', 'roaster_website', false]]);
    });
  });

  // Coffee presentation brief 1 (2026-10-23): customer_voice_max_words is
  // replaced by the signature and accent caps; (g) checks the two caps. The
  // fixture coffee has no match archetype, so every row is signature.
  it('(g) the caps are applied by the read (getCustomerDescriptors), not the view', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await base(c, 'g');
      for (const [w, n] of [['citrus', 'Citrus Fruit'], ['cinnamon', 'Cinnamon'], ['hazelnut', 'Hazelnut']] as const) await website(c, b, w, n);
      expect((await voice(c, b.coffeeId)).length).toBe(3);
      await setParameterInTx(c, { key: 'customer_voice_signature_max', value: 2, note: 'vitest, rolled back' });
      const read = await getCustomerDescriptors(b.coffeeId, c);
      expect(read.length).toBe(2);
      expect(read.every(r => r.voice === 'roaster_website' && r.is_signature)).toBe(true);
      // the accent cap does not touch signature rows
      await setParameterInTx(c, { key: 'customer_voice_accent_max', value: 1, note: 'vitest, rolled back' });
      expect((await getCustomerDescriptors(b.coffeeId, c)).length).toBe(2);
      // the old key is closed: nothing current, param() is null
      expect((await c.query(`SELECT param('customer_voice_max_words') AS v`)).rows[0].v).toBeNull();
    });
  });
});

describe('evidenceParameterService (E1)', () => {
  it('supersedes the current row with a new one; param() returns the new value in the same transaction', async () => {
    await withRollback(async ({ client: c }) => {
      const old = (await c.query(`SELECT id, value FROM evidence_parameter WHERE key = 'session_gap' AND superseded_at IS NULL`)).rows[0];
      const r = await setParameterInTx(c, { key: 'session_gap', value: 3, note: 'vitest', adminId: 'vitest-admin' });
      expect(r).toMatchObject({ key: 'session_gap', value: 3, previousValue: Number(old.value), unchanged: false });
      const rows = (await c.query(`SELECT id, value, superseded_at, note FROM evidence_parameter WHERE key = 'session_gap' ORDER BY since`)).rows;
      expect(rows.find(x => x.id === old.id)!.superseded_at).not.toBeNull();
      const current = rows.filter(x => x.superseded_at === null);
      expect(current.length).toBe(1);
      expect(Number(current[0].value)).toBe(3);
      expect(current[0].note).toMatch(/Range: .* \| changed \d{4}-\d{2}-\d{2} by vitest-admin: vitest$/);
      expect(parseSaneRange(current[0].note)).not.toBeNull(); // the range survives a change
      expect(await param(c, 'session_gap')).toBe(3);
    });
  });

  it('refuses an unknown key, a non-numeric value, a value outside the sane range and a key with no range', async () => {
    await withRollback(async ({ client: c, savepoint }) => {
      await expect(savepoint(() => setParameterInTx(c, { key: 'no_such_key', value: 1 }))).rejects.toMatchObject({ code: 'EVIDENCE_PARAMETER_UNKNOWN' });
      await expect(savepoint(() => setParameterInTx(c, { key: 'session_gap', value: 'abc' }))).rejects.toMatchObject({ code: 'EVIDENCE_PARAMETER_INVALID' });
      await expect(savepoint(() => setParameterInTx(c, { key: 'session_rank_ratio', value: 0 }))).rejects.toMatchObject({ code: 'EVIDENCE_PARAMETER_INVALID' });
      await expect(savepoint(() => setParameterInTx(c, { key: 'session_rank_ratio', value: 1.5 }))).rejects.toMatchObject({ code: 'EVIDENCE_PARAMETER_INVALID' });
      await expect(savepoint(() => setParameterInTx(c, { key: 'customer_voice_hit_tier', value: 2.5 }))).rejects.toMatchObject({ code: 'EVIDENCE_PARAMETER_INVALID' });
      await expect(savepoint(() => setParameterInTx(c, { key: 'session_half_life_days', value: 0 }))).rejects.toMatchObject({ code: 'EVIDENCE_PARAMETER_INVALID' });
      await expect(savepoint(() => setParameterInTx(c, { key: 'cupper_gap', value: 3 }))).rejects.toMatchObject({ code: 'EVIDENCE_PARAMETER_INVALID' });
      const n = (await c.query(`SELECT count(*)::int AS n FROM evidence_parameter WHERE superseded_at IS NOT NULL AND key IN ('session_gap','session_rank_ratio','customer_voice_hit_tier','session_half_life_days','cupper_gap')`)).rows[0].n;
      const before = (await db.query(`SELECT count(*)::int AS n FROM evidence_parameter WHERE superseded_at IS NOT NULL AND key IN ('session_gap','session_rank_ratio','customer_voice_hit_tier','session_half_life_days','cupper_gap')`)).rows[0].n;
      expect(n).toBe(before);
    });
  });
});

