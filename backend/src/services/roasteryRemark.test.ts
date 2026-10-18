// Cupping evidence brief 1 (2026-10-18), C2 — roastery_remark: insert-only,
// ownership guard, topic/column consistency, the supersedes chain and
// is_current; roasteryRemarkService validation. Trigger and guard checks run
// inside rolled-back transactions; the service's own happy path commits
// remarks (insert-only, never deletable) under the marked fixture roastery
// 'Zzz Cupping Test Roastery', never one of the real roasteries.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { db } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import { recordRemarks, RemarkError, type RemarkInput } from './roasteryRemarkService.js';
import { listRemarks } from './roasteryRemarkReads.js';

const RUN = Date.now().toString(36);
let roasterId: string;
let coffeeId: number;
let otherRoasterId: string;
let otherCoffeeId: number;

async function findOrCreate(name: string): Promise<{ roaster: string; coffee: number }> {
  let r = (await db.query<{ id: string }>(`SELECT id FROM roaster WHERE name = $1`, [name])).rows[0];
  if (!r) r = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ($1, false) RETURNING id`, [name])).rows[0];
  const coffeeName = name.replace('Roastery', 'Coffee');
  let c = (await db.query<{ id: number }>(`SELECT id FROM coffees WHERE name = $1 AND roaster_id = $2`, [coffeeName, r.id])).rows[0];
  if (!c) c = (await db.query<{ id: number }>(`INSERT INTO coffees (name, roaster_id, is_active) VALUES ($1, $2, false) RETURNING id`, [coffeeName, r.id])).rows[0];
  return { roaster: r.id, coffee: c.id };
}

beforeAll(async () => {
  ({ roaster: roasterId, coffee: coffeeId } = await findOrCreate('Zzz Cupping Test Roastery'));
  ({ roaster: otherRoasterId, coffee: otherCoffeeId } = await findOrCreate('Zzz Cupping Other Roastery'));
});
afterAll(async () => { await db.end(); });

const base = (over: Partial<RemarkInput> = {}): RemarkInput => ({
  roasterId, coffeeId, saidBy: 'Zzz Test Roaster (fixture)', saidOn: '2026-10-18', channel: 'cupping_table',
  topic: 'general', remark: `fixture remark ${RUN}`, recordedBy: 'cupping evidence tests', recordSource: 'test', ...over,
});

async function insertRaw(c: pg.PoolClient, over: Record<string, unknown> = {}) {
  const v = { roaster_id: roasterId, coffee_id: coffeeId, said_by: 'x', said_on: '2026-10-18', channel: 'email', topic: 'general',
    remark: 'x', recorded_by: 'x', record_source: 'test', ...over };
  const cols = Object.keys(v);
  return (await c.query<{ id: string }>(
    `INSERT INTO roastery_remark (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    Object.values(v))).rows[0].id;
}

describe('roastery_remark at the database level', () => {
  it('is insert-only: UPDATE and DELETE raise', async () => {
    await withRollback(async ({ client, savepoint }) => {
      const id = await insertRaw(client);
      await expect(savepoint(() => client.query(`UPDATE roastery_remark SET remark = 'changed' WHERE id = $1`, [id]))).rejects.toMatchObject({ code: '23000' });
      await expect(savepoint(() => client.query(`DELETE FROM roastery_remark WHERE id = $1`, [id]))).rejects.toMatchObject({ code: '23000' });
    });
  });

  it('the guard refuses references that belong to another roaster', async () => {
    await withRollback(async ({ client, savepoint }) => {
      await expect(savepoint(() => insertRaw(client, { coffee_id: otherCoffeeId }))).rejects.toMatchObject({ code: '23000' });
      const theirs = await insertRaw(client, { roaster_id: otherRoasterId, coffee_id: otherCoffeeId });
      await expect(savepoint(() => insertRaw(client, { supersedes_id: theirs }))).rejects.toMatchObject({ code: '23000' });
      const pc = (await client.query<{ id: string }>(`INSERT INTO roastery_portal_coffee (roaster_id, name) VALUES ($1, 'Zzz lineup') RETURNING id`, [otherRoasterId])).rows[0].id;
      await expect(savepoint(() => insertRaw(client, { portal_coffee_id: pc }))).rejects.toMatchObject({ code: '23000' });
      const session = (await client.query<{ id: number }>(`INSERT INTO cupping_sessions (session_date, record_source) VALUES ('2026-10-18', 'test') RETURNING id`)).rows[0].id;
      const otherSc = (await client.query<{ id: number }>(`INSERT INTO cupping_session_coffees (session_id, coffee_id) VALUES ($1, $2) RETURNING id`, [session, otherCoffeeId])).rows[0].id;
      await expect(savepoint(() => insertRaw(client, { cupping_session_coffee_id: otherSc }))).rejects.toMatchObject({ code: '23000' });
    });
  });

  it('a wheel pick needs a descriptor remark; a proposed archetype needs a classification remark', async () => {
    const note = (await db.query<{ id: string }>(`SELECT id FROM cupping_note WHERE descriptor = 'Honey'`)).rows[0].id;
    await withRollback(async ({ client, savepoint }) => {
      await expect(savepoint(() => insertRaw(client, { cupping_note_id: note, topic: 'general' }))).rejects.toMatchObject({ code: '23514' });
      await expect(savepoint(() => insertRaw(client, { proposed_archetype: 'earthy', topic: 'general' }))).rejects.toMatchObject({ code: '23514' });
      await savepoint(() => insertRaw(client, { cupping_note_id: note, topic: 'descriptor' }));
      await savepoint(() => insertRaw(client, { proposed_archetype: 'earthy', topic: 'classification' }));
    });
  });

  it('a correction points at the old row, which stays and is no longer current', async () => {
    await withRollback(async ({ client }) => {
      const first = await insertRaw(client, { remark: 'Honeycomb' });
      const fix = await insertRaw(client, { remark: 'Honeycomb, caramel', supersedes_id: first });
      const rows = (await client.query(`SELECT id, is_current FROM v_roastery_remark WHERE id = ANY($1::uuid[])`, [[first, fix]])).rows;
      expect(Object.fromEntries(rows.map(r => [r.id, r.is_current]))).toEqual({ [first]: false, [fix]: true });
    });
  });
});

describe('roasteryRemarkService', () => {
  it('validates channel, topic, dates, ownership and the archetype before writing anything', async () => {
    await expect(recordRemarks([base({ channel: 'fax' as never })])).rejects.toBeInstanceOf(RemarkError);
    await expect(recordRemarks([base({ topic: 'price' as never })])).rejects.toBeInstanceOf(RemarkError);
    await expect(recordRemarks([base({ saidOn: 'Oct 18' })])).rejects.toBeInstanceOf(RemarkError);
    await expect(recordRemarks([base({ coffeeId: otherCoffeeId })])).rejects.toMatchObject({ code: 'REMARK_INVALID' });
    await expect(recordRemarks([base({ topic: 'classification', proposedArchetype: 'not an archetype' })])).rejects.toBeInstanceOf(RemarkError);
    await expect(recordRemarks([base({ topic: 'general', proposedArchetype: 'earthy' })])).rejects.toBeInstanceOf(RemarkError);
    // all or nothing: one bad remark in a batch writes none of them
    const remark = `batch ${RUN}`;
    await expect(recordRemarks([base({ remark }), base({ remark, channel: 'fax' as never })])).rejects.toBeInstanceOf(RemarkError);
    expect((await listRemarks({ roasterId })).filter(r => r.remark === remark)).toEqual([]);
  });

  it('records a batch in one transaction and lists it, current only by default', async () => {
    const [first] = await recordRemarks([base({ topic: 'classification', proposedArchetype: 'earthy', remark: `this one is earthy ${RUN}` })], { actor: 'vitest' });
    const [fix] = await recordRemarks([base({ topic: 'classification', proposedArchetype: 'chocolate_nutty', remark: `chocolate and nutty, actually ${RUN}`, supersedesId: first.id })]);
    const current = (await listRemarks({ roasterId, coffeeId })).map(r => r.id);
    expect(current).toContain(fix.id);
    expect(current).not.toContain(first.id);
    const all = await listRemarks({ roasterId, coffeeId, currentOnly: false });
    expect(all.find(r => r.id === first.id)).toMatchObject({ is_current: false, proposed_archetype: 'earthy', roaster_name: 'Zzz Cupping Test Roastery' });
  });
});
