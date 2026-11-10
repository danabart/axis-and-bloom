// Cupping evidence brief 9 (2026-11-09), Part D — disputes: a cupper value or
// a whole cupper row marked not to be trusted, the sheet untouched, the rule
// merge re-run without it; withdraw restores; idempotency; immutability; the
// manual-merge exception; the last-row rule; the routes.
//
// Fixtures follow cupping.test.ts: everything lives under the inactive 'Zzz
// Cupping Test Roastery' with the 'Zzz Cupper A/B' cuppers, and each run makes
// its own session and its own coffees (evidence is immutable, so a shared
// coffee would pool every past run). Nothing touches sessions 35 to 42 or any
// real coffee; no slot is used. The coffee of the pooled-range case is active
// only while that case runs (v_coffee_dimension_range reads active coffees).
// The dial signal is mocked (no dial_position_signal row is written).
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('./dialSuggestion.js', () => ({ recordCuppingSignal: vi.fn(async () => {}) }));
vi.mock('../middleware/auth.js', () => ({
  requireAdmin: (req: any, _res: any, next: any) => { req.uid = 'zzz-test-admin'; next(); },
}));

const { db } = await import('../db/client.js');
const { recordCuppingSignal } = await import('./dialSuggestion.js');
const cs = await import('./cuppingService.js');
const { getCoffeeEvidence } = await import('./evidenceReads.js');
const { default: evidenceRouter } = await import('../routes/evidenceAdmin.js');

vi.setConfig({ testTimeout: 60_000 }); // many round trips to Cloud SQL per case

const RUN = Date.now().toString(36);
const BODY = 7, ACIDITY = 5;
const UID = 'zzz-test-admin';
let roasterId: string;
let cupperA: number, cupperB: number;
let nameA: string;
let sessionId: number;
let notes: string[];

async function findOrCreateCupper(name: string): Promise<number> {
  const found = await db.query<{ id: number }>(`SELECT id FROM cupper WHERE name = $1`, [name]);
  return found.rows[0]?.id ?? (await cs.addCupper(name, { note: 'test fixture (cupping evidence brief 1 tests)' })).id;
}
async function newCoffee(tag: string): Promise<number> {
  return (await db.query<{ id: number }>(
    `INSERT INTO coffees (name, roaster_id, is_active) VALUES ($1, $2, false) RETURNING id`, [`Zzz Dispute ${tag} ${RUN}`, roasterId]
  )).rows[0].id;
}
/** A sample with two cupper rows: A (Body 8-10, Acidity 9, note 0, call fruity), B (Body 7, Acidity 8, note 1, call fruity). */
async function sample(coffeeId: number) {
  const scId = await cs.addSessionCoffee(sessionId, coffeeId);
  const a = await cs.saveCupperScore({
    sessionCoffeeId: scId, cupperId: cupperA, archetypeCall: 'fruity',
    values: [{ dimensionId: BODY, valueMin: 8, valueMax: 10, rawValue: '8-10' }, { dimensionId: ACIDITY, valueMin: 9, valueMax: 9 }],
    descriptors: [{ cuppingNoteId: notes[0], customNotes: 'A words' }],
  });
  const b = await cs.saveCupperScore({
    sessionCoffeeId: scId, cupperId: cupperB, archetypeCall: 'fruity',
    values: [{ dimensionId: BODY, valueMin: 7, valueMax: 7 }, { dimensionId: ACIDITY, valueMin: 8, valueMax: 8 }],
    descriptors: [{ cuppingNoteId: notes[1], customNotes: 'B words' }],
  });
  await cs.mergeByRule(scId, { n: 2 }); // as the loaders do
  return { scId, a, b };
}
async function currentMerged(scId: number) {
  return (await db.query<{ id: number; merge_rule: string; merge_note: string; archetype_call: string | null }>(
    `SELECT id, merge_rule, merge_note, archetype_call FROM v_cupping_score WHERE session_coffee_id = $1 AND is_merged`, [scId]
  )).rows[0];
}
async function mergedValues(scoreId: number) {
  return (await db.query<{ dimension_id: number; value_min: string | null; value_max: string | null; raw_value: string | null }>(
    `SELECT dimension_id, value_min, value_max, raw_value FROM v_cupping_scores_readable WHERE score_id = $1 ORDER BY dimension_id`, [scoreId]
  )).rows;
}
async function mergedDescriptors(scoreId: number) {
  return (await db.query<{ cupping_note_id: string; custom_notes: string | null }>(
    `SELECT cupping_note_id, custom_notes FROM v_cupping_score_descriptor WHERE cupping_score_id = $1 ORDER BY cupping_note_id`, [scoreId]
  )).rows;
}
async function supersede(scoreId: number) {
  return (await db.query<{ superseded_by_id: number | null; supersede_reason: string | null }>(
    `SELECT superseded_by_id, supersede_reason FROM cupping_scores WHERE id = $1`, [scoreId]
  )).rows[0];
}
const openCount = async (scoreId: number) =>
  Number((await db.query<{ n: string }>(`SELECT count(*) n FROM v_cupping_score_dispute WHERE cupping_score_id = $1 AND is_open`, [scoreId])).rows[0].n);

let server: Server;
let base: string;

beforeAll(async () => {
  let roaster = (await db.query<{ id: string }>(`SELECT id FROM roaster WHERE name = 'Zzz Cupping Test Roastery'`)).rows[0];
  if (!roaster) roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Zzz Cupping Test Roastery', false) RETURNING id`)).rows[0];
  roasterId = roaster.id;
  cupperA = await findOrCreateCupper('Zzz Cupper A');
  cupperB = await findOrCreateCupper('Zzz Cupper B');
  nameA = 'Zzz Cupper A';
  notes = (await db.query<{ id: string }>(`SELECT id FROM cupping_note WHERE tier = 3 ORDER BY id LIMIT 2`)).rows.map(r => r.id);
  sessionId = await cs.createSession({ sessionDate: '2026-11-09', recordSource: `test:cuppingDispute.test.ts ${RUN}`, sheetFormat: 'score_entry', location: 'Zzz test' });

  const app = express();
  app.use(express.json());
  app.use('/api/admin/evidence', evidenceRouter);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/admin/evidence`;
});

afterAll(async () => {
  await db.query(`UPDATE coffees SET is_active = false WHERE roaster_id = $1 AND name LIKE $2`, [roasterId, `Zzz Dispute % ${RUN}`]);
  await new Promise<void>(resolve => server.close(() => resolve()));
  await db.end();
});
beforeEach(() => { vi.mocked(recordCuppingSignal).mockClear(); });

describe('a value dispute', () => {
  it('re-merges without that value, supersedes the old merge with the dispute, moves the pooled range, re-records the signal; withdraw restores it exactly', async () => {
    const coffeeId = await newCoffee('value');
    const { scId, a } = await sample(coffeeId);
    const before = await currentMerged(scId);
    const beforeValues = await mergedValues(before.id);
    const beforeDescriptors = await mergedDescriptors(before.id);
    expect(beforeValues.find(v => v.dimension_id === BODY)).toMatchObject({ value_min: '7', value_max: '10' });
    const sheetBefore = await db.query(`SELECT * FROM cupping_score_values WHERE cupping_score_id = $1 ORDER BY id`, [a]);

    await db.query(`UPDATE coffees SET is_active = true WHERE id = $1`, [coffeeId]);
    try {
      const pooledBody = async () => (await db.query<{ midpoint: string }>(
        `SELECT midpoint FROM v_coffee_dimension_range WHERE coffee_id = $1 AND dimension_id = $2`, [coffeeId, BODY])).rows[0]?.midpoint;
      expect(await pooledBody()).toBe('8.50');

      vi.mocked(recordCuppingSignal).mockClear();
      const r = await cs.raiseDispute({ cuppingScoreId: a, dimensionId: BODY, reason: 'scored relative to a light flight', raisedByUid: UID });
      expect(r.alreadyOpen).toBe(false);
      expect(r.manualMergeInPlace).toBe(false);
      expect(r.mergedScoreId).not.toBe(before.id);

      const after = await currentMerged(scId);
      expect(after.id).toBe(r.mergedScoreId);
      const body = (await mergedValues(after.id)).find(v => v.dimension_id === BODY);
      expect(body).toMatchObject({ value_min: '7', value_max: '7', raw_value: 'union of: Zzz Cupper B 7' });
      expect((await mergedValues(after.id)).find(v => v.dimension_id === ACIDITY)).toMatchObject({ value_min: '8', value_max: '9' });
      expect(after.merge_note).toContain(`disputed: ${nameA} Body`);
      expect(after.merge_note).toContain('one cupper: Body');
      expect(await supersede(before.id)).toEqual({ superseded_by_id: after.id, supersede_reason: `merged by rule again (dispute ${r.dispute.id} raised)` });
      expect(await pooledBody()).toBe('7.00');
      expect(vi.mocked(recordCuppingSignal)).toHaveBeenCalledWith(coffeeId); // recorded (every row ab_0_15), not retracted

      // the sheet is untouched; the readable view and the workbench cell show it, flagged
      expect((await db.query(`SELECT * FROM cupping_score_values WHERE cupping_score_id = $1 ORDER BY id`, [a])).rows).toEqual(sheetBefore.rows);
      const cell = (await db.query<{ is_disputed: boolean; dispute_reason: string; value_min: string }>(
        `SELECT is_disputed, dispute_reason, value_min FROM v_cupping_scores_readable WHERE score_id = $1 AND dimension_id = $2`, [a, BODY])).rows[0];
      expect(cell).toEqual({ is_disputed: true, dispute_reason: 'scored relative to a light flight', value_min: '8' });
      const ev = await getCoffeeEvidence(coffeeId);
      const evCell = ev.dimensions.find(d => d.dimension_id === BODY && d.cupper_id === cupperA);
      expect(evCell).toMatchObject({ is_disputed: true, cupper_score_id: a, dispute_id: r.dispute.id });
      expect(ev.dimensions.find(d => d.dimension_id === ACIDITY && d.cupper_id === cupperA)).toMatchObject({ is_disputed: false });
      expect(ev.disputes.map(d => [d.id, d.scope, d.is_open])).toEqual([[r.dispute.id, 'value', true]]);

      // idempotent raise: same dispute back, nothing re-merged
      const again = await cs.raiseDispute({ cuppingScoreId: a, dimensionId: BODY, reason: 'twice', raisedByUid: UID });
      expect(again).toMatchObject({ alreadyOpen: true, mergedScoreId: null });
      expect(again.dispute.id).toBe(r.dispute.id);
      expect(await openCount(a)).toBe(1);
      expect((await currentMerged(scId)).id).toBe(after.id);

      // withdraw: the previous union comes back exactly
      const w = await cs.withdrawDispute({ disputeId: r.dispute.id, withdrawnByUid: UID, reason: 'second look agrees with the sheet' });
      expect(w.dispute.withdrawn_at).not.toBeNull();
      const restored = await currentMerged(scId);
      expect(restored.id).toBe(w.mergedScoreId);
      expect(await mergedValues(restored.id)).toEqual(beforeValues);
      expect(await mergedDescriptors(restored.id)).toEqual(beforeDescriptors);
      expect(restored.archetype_call).toBe(before.archetype_call);
      expect(restored.merge_note).toBe(before.merge_note);
      expect((await supersede(after.id)).supersede_reason).toBe(`merged by rule again (dispute ${r.dispute.id} withdrawn)`);
      expect(await pooledBody()).toBe('8.50');

      // withdraw twice: 409
      await expect(cs.withdrawDispute({ disputeId: r.dispute.id, withdrawnByUid: UID, reason: 'again' }))
        .rejects.toMatchObject({ status: 409, code: 'CUPPING_DISPUTE_WITHDRAWN' });
    } finally {
      await db.query(`UPDATE coffees SET is_active = false WHERE id = $1`, [coffeeId]);
    }
  });
});

describe('a whole-row dispute', () => {
  it('takes the row\'s values, descriptors and calls out; the last undisputed row is refused; a value dispute still works', async () => {
    const coffeeId = await newCoffee('row');
    const { scId, a, b } = await sample(coffeeId);
    const r =await cs.raiseDispute({ cuppingScoreId: a, dimensionId: null, reason: 'whole sheet unreliable', raisedByUid: UID });
    const m = await currentMerged(scId);
    expect(m.id).toBe(r.mergedScoreId);
    expect(await mergedValues(m.id)).toEqual([
      { dimension_id: ACIDITY, value_min: '8', value_max: '8', raw_value: 'union of: Zzz Cupper B 8' },
      { dimension_id: BODY, value_min: '7', value_max: '7', raw_value: 'union of: Zzz Cupper B 7' },
    ]);
    expect(await mergedDescriptors(m.id)).toEqual([{ cupping_note_id: notes[1], custom_notes: 'Zzz Cupper B: B words' }]);
    expect(m.merge_note).toContain(`disputed row: ${nameA}`);
    expect(m.merge_note).toContain('scales: Zzz Cupper B ab_0_15');
    // views: the row is flagged where shown, out where aggregated
    const head = (await db.query(`SELECT is_disputed FROM v_cupping_score WHERE id = $1`, [a])).rows[0];
    expect(head.is_disputed).toBe(true);
    const ev = await getCoffeeEvidence(coffeeId);
    expect(ev.calls.find(c => c.cupper_id === cupperA)).toMatchObject({ is_disputed: true });
    expect(ev.descriptors.flatMap(d => d.named_by_cuppers)).not.toContain(nameA);
    expect(ev.consensus.flatMap(c => c.cuppers)).not.toContain(nameA);

    // B is now the last undisputed row
    await expect(cs.raiseDispute({ cuppingScoreId: b, dimensionId: null, reason: 'x', raisedByUid: UID }))
      .rejects.toMatchObject({ status: 409, code: 'LAST_CUPPER_ROW' });
    // a value dispute on B is always allowed; the dimension leaves the merged row
    const v = await cs.raiseDispute({ cuppingScoreId: b, dimensionId: BODY, reason: 'value only', raisedByUid: UID });
    const m2 = await currentMerged(scId);
    expect(m2.id).toBe(v.mergedScoreId);
    expect((await mergedValues(m2.id)).map(x => x.dimension_id)).toEqual([ACIDITY]);
  });
});

describe('guards', () => {
  it('a merged row cannot be disputed (400); a dimension the row lacks is refused (400); no reason is refused', async () => {
    const coffeeId = await newCoffee('guards');
    const { scId, a } = await sample(coffeeId);
    const merged = await currentMerged(scId);
    await expect(cs.raiseDispute({ cuppingScoreId: merged.id, dimensionId: BODY, reason: 'x', raisedByUid: UID }))
      .rejects.toMatchObject({ status: 400 });
    await expect(cs.raiseDispute({ cuppingScoreId: a, dimensionId: 1, reason: 'x', raisedByUid: UID }))
      .rejects.toMatchObject({ status: 400 });
    await expect(cs.raiseDispute({ cuppingScoreId: a, dimensionId: BODY, reason: '  ', raisedByUid: UID }))
      .rejects.toMatchObject({ status: 400 });
    // the database refuses a merged-row target too
    await expect(db.query(`INSERT INTO cupping_score_dispute (cupping_score_id, reason, raised_by_uid) VALUES ($1, 'x', 'u')`, [merged.id]))
      .rejects.toThrow(/not a cupper row/);
  });

  it('immutability: the reason cannot change, a dispute cannot be deleted, the withdraw happens once', async () => {
    const coffeeId = await newCoffee('immutable');
    const { a } = await sample(coffeeId);
    const r = await cs.raiseDispute({ cuppingScoreId: a, dimensionId: ACIDITY, reason: 'first', raisedByUid: UID });
    await expect(db.query(`UPDATE cupping_score_dispute SET reason = 'edited' WHERE id = $1`, [r.dispute.id])).rejects.toThrow(/immutable/);
    await expect(db.query(`DELETE FROM cupping_score_dispute WHERE id = $1`, [r.dispute.id])).rejects.toThrow(/immutable/);
    await db.query(`UPDATE cupping_score_dispute SET withdrawn_at = now(), withdrawn_by_uid = 'u', withdrawn_reason = 'once' WHERE id = $1`, [r.dispute.id]);
    await expect(db.query(`UPDATE cupping_score_dispute SET withdrawn_at = now(), withdrawn_by_uid = 'u', withdrawn_reason = 'twice' WHERE id = $1`, [r.dispute.id]))
      .rejects.toThrow(/immutable/);
    expect((await db.query(`SELECT reason, withdrawn_reason FROM cupping_score_dispute WHERE id = $1`, [r.dispute.id])).rows[0])
      .toEqual({ reason: 'first', withdrawn_reason: 'once' });
  });

  it('a manual merge in place: the dispute is recorded, nothing is re-merged', async () => {
    const coffeeId = await newCoffee('manual');
    const { scId, a } = await sample(coffeeId);
    const manualId = await cs.saveManualMerge(scId, { values: [{ dimensionId: BODY, valueMin: 8, valueMax: 8 }] }, 'hand merge for the test');
    vi.mocked(recordCuppingSignal).mockClear();
    const r = await cs.raiseDispute({ cuppingScoreId: a, dimensionId: BODY, reason: 'manual case', raisedByUid: UID });
    expect(r).toMatchObject({ alreadyOpen: false, mergedScoreId: null, manualMergeInPlace: true });
    expect(await openCount(a)).toBe(1);
    expect((await currentMerged(scId)).id).toBe(manualId);
    expect(vi.mocked(recordCuppingSignal)).not.toHaveBeenCalled();
    const w = await cs.withdrawDispute({ disputeId: r.dispute.id, withdrawnByUid: UID, reason: 'done' });
    expect(w).toMatchObject({ mergedScoreId: null, manualMergeInPlace: true });
    expect((await currentMerged(scId)).id).toBe(manualId);
  });
});

describe('POST /api/admin/evidence/disputes', () => {
  it('400 without a reason; 201 on raise, 200 alreadyOpen on a repeat; withdraw 200 then 409', async () => {
    const coffeeId = await newCoffee('route');
    const { a } = await sample(coffeeId);
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post('/disputes', { cuppingScoreId: a, dimensionId: BODY })).status).toBe(400);
    const first = await post('/disputes', { cuppingScoreId: a, dimensionId: BODY, reason: 'route' });
    expect(first.status).toBe(201);
    const body = await first.json();
    expect(body.dispute.raised_by_uid).toBe(UID);
    expect(typeof body.mergedScoreId).toBe('number');
    const repeat = await post('/disputes', { cuppingScoreId: a, dimensionId: BODY, reason: 'route' });
    expect(repeat.status).toBe(200);
    expect((await repeat.json()).alreadyOpen).toBe(true);
    expect((await post(`/disputes/${body.dispute.id}/withdraw`, {})).status).toBe(400);
    expect((await post(`/disputes/${body.dispute.id}/withdraw`, { reason: 'ok' })).status).toBe(200);
    const twice = await post(`/disputes/${body.dispute.id}/withdraw`, { reason: 'ok' });
    expect(twice.status).toBe(409);
    expect((await twice.json()).code).toBe('CUPPING_DISPUTE_WITHDRAWN');
  });
});
