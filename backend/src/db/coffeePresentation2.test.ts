// Coffee presentation brief 2 (2026-10-24): v_archetype_dimension_profile,
// compatibilityReads (leave-one-out, the minimum, the customer_bags kind,
// thresholds from param(), the three sentence shapes against the old frontend
// getDimensionComparison), the parameter pair check, GET /:id/compatibility
// (roaster-blind over the real catalog), the backfill's candidates and
// refresh-content writing the story fields only, and the Fabricator loader.
// Fixtures live inside rolled-back transactions (withRollback), except
// refresh-content's, which goes through the pool and is removed afterwards.
// The fixture archetype is experimental with its existing current
// assignments superseded inside the transaction, so the profile holds the
// fixture coffees alone. The Anthropic SDK and the spend guard are mocked.
import 'dotenv/config';
import { describe, it, expect, vi, afterAll } from 'vitest';
import type pg from 'pg';
import express from 'express';
import type { Server } from 'node:http';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: async () => ({ content: [{ type: 'text', text: 'A stub reply for the description.' }] }) };
  },
}));
vi.mock('../services/anthropicGuard.js', () => ({
  guardClaudeCall: (_feature: string, _model: string, fn: () => unknown) => fn(),
  isClaudeGuardBlocked: (err: unknown) => (err as { blocked?: boolean })?.blocked === true,
}));

const { db } = await import('./client.js');
const { withRollback } = await import('../test/withRollback.js');
const { setParameterInTx } = await import('../services/evidenceParameterService.js');
const { compareCoffee, getReferenceProfile } = await import('../services/compatibilityReads.js');
const { setMatchArchetypeInTx } = await import('../services/catalogService.js');
const { runMatch } = await import('../features/coffee_presentation/load/setMatch2917.js');
const coffees = await import('../routes/coffees.js');

afterAll(async () => { await db.end(); });

const ARCH = 'experimental';
let n = 0;

async function numericDims(c: pg.PoolClient): Promise<Array<{ id: number; name: string }>> {
  return (await c.query(`SELECT id, name FROM coffee_dimensions WHERE is_numeric ORDER BY display_order LIMIT 2`)).rows;
}
async function isolateArchetype(c: pg.PoolClient) {
  await c.query(`UPDATE coffee_archetype_assignment SET superseded_at = now() WHERE archetype = $1 AND superseded_at IS NULL`, [ARCH]);
}
/** A coffee matched to `archetype`, cupped once (a merged row) with `values` per dimension id: [min, max]. */
async function cupped(c: pg.PoolClient, archetype: string | null, values: Record<number, [number, number]>, active = true) {
  const tag = `${Date.now()}-${++n}`;
  const roasterId = (await c.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ($1, true) RETURNING id`, [`Zzz Compat Roastery ${tag}`])).rows[0].id;
  const coffeeId = (await c.query<{ id: number }>(`INSERT INTO coffees (name, roaster_id, is_active, origin) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`Zzz Compat Coffee ${tag}`, roasterId, active, `Zzz Origin ${tag}`])).rows[0].id;
  if (archetype) await c.query(`INSERT INTO coffee_archetype_assignment (coffee_id, archetype, confidence) VALUES ($1, $2, 'high')`, [coffeeId, archetype]);
  const sessionId = (await c.query<{ id: number }>(`INSERT INTO cupping_sessions (session_date, record_source) VALUES ('2001-01-01', 'test:coffeePresentation2') RETURNING id`)).rows[0].id;
  const scId = (await c.query<{ id: number }>(`INSERT INTO cupping_session_coffees (session_id, coffee_id) VALUES ($1, $2) RETURNING id`, [sessionId, coffeeId])).rows[0].id;
  const merged = (await c.query<{ id: number }>(`INSERT INTO cupping_scores (session_coffee_id, is_merged, scale_code, merge_rule) VALUES ($1, true, 'ab_0_15', 'union_v1') RETURNING id`, [scId])).rows[0].id;
  for (const [dim, [lo, hi]] of Object.entries(values)) {
    await c.query(`INSERT INTO cupping_score_values (cupping_score_id, dimension_id, value_min, value_max, raw_value) VALUES ($1, $2, $3, $4, $5)`,
      [merged, Number(dim), lo, hi, `${lo}-${hi}`]);
  }
  return coffeeId;
}

// The old frontend sentence (useCompatibility.getDimensionComparison before brief 2), verbatim.
function oldSentence(dimensions: Array<{ dimension: string; avg_min: string; avg_max: string }>, label: string, typical: Record<string, [number, number]>): string {
  const divergences: { dim: string; delta: number; dir: string }[] = [];
  for (const row of dimensions) {
    const range = typical[row.dimension];
    if (!range) continue;
    const delta = (Number(row.avg_min) + Number(row.avg_max)) / 2 - (range[0] + range[1]) / 2;
    if (Math.abs(delta) < 1.5) continue;
    const dir = delta > 4 ? 'significantly more' : delta > 1.5 ? 'slightly more' : delta < -4 ? 'significantly less' : 'slightly less';
    divergences.push({ dim: row.dimension.toLowerCase(), delta: Math.abs(delta), dir });
  }
  if (!divergences.length) return `This coffee's profile sits close to your usual ${label} preference.`;
  divergences.sort((a, b) => b.delta - a.delta);
  const top = divergences.slice(0, 2);
  if (top.length === 1) return `This coffee has ${top[0].dir} ${top[0].dim} than your typical ${label} profile.`;
  return `This coffee has ${top[0].dir} ${top[0].dim} and ${top[1].dir} ${top[1].dim} than your usual ${label} profile.`;
}

describe('v_archetype_dimension_profile (A1)', () => {
  it('three active cupped coffees: coffee_count 3, avg_midpoint the mean of the three; an inactive coffee and a superseded assignment are left out', async () => {
    await withRollback(async ({ client: c }) => {
      await isolateArchetype(c);
      const [d1] = await numericDims(c);
      const ids = [
        await cupped(c, ARCH, { [d1.id]: [4, 6] }),
        await cupped(c, ARCH, { [d1.id]: [6, 8] }),
        await cupped(c, ARCH, { [d1.id]: [8, 11] }),
      ];
      await cupped(c, ARCH, { [d1.id]: [14, 15] }, false);                    // inactive
      const moved = await cupped(c, ARCH, { [d1.id]: [0, 1] });                 // superseded below
      await c.query(`UPDATE coffee_archetype_assignment SET superseded_at = now() WHERE coffee_id = $1`, [moved]);
      await c.query(`INSERT INTO coffee_archetype_assignment (coffee_id, archetype, confidence) VALUES ($1, 'fruity', 'high')`, [moved]);

      const row = (await c.query(`SELECT * FROM v_archetype_dimension_profile WHERE archetype = $1 AND dimension_id = $2`, [ARCH, d1.id])).rows[0];
      expect(Number(row.coffee_count)).toBe(3);
      expect(Number(row.avg_midpoint)).toBeCloseTo((5 + 7 + 9.5) / 3, 2);
      expect(Number(row.min_midpoint)).toBe(5);
      expect(Number(row.max_midpoint)).toBe(9.5);
      expect([...row.coffee_ids].map(Number).sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b));
    });
  });
});

describe('compatibilityReads (A2)', () => {
  it('leave-one-out: the coffee compared to its own archetype sees one coffee fewer and an average without itself', async () => {
    await withRollback(async ({ client: c }) => {
      await isolateArchetype(c);
      const [d1] = await numericDims(c);
      const a = await cupped(c, ARCH, { [d1.id]: [4, 5] });
      await cupped(c, ARCH, { [d1.id]: [6, 8] });
      await cupped(c, ARCH, { [d1.id]: [8, 10] });
      const all = await getReferenceProfile({ kind: 'archetype', archetype: ARCH }, {}, c);
      const without = await getReferenceProfile({ kind: 'archetype', archetype: ARCH }, { excludeCoffeeId: a }, c);
      expect(all!.coffee_count).toBe(3);
      expect(without!.coffee_count).toBe(2);
      expect(without!.dimensions[d1.id].midpoint).toBeCloseTo(8, 5);
    });
  });

  it('below_min_coffees under the param, ok at the param; customer_bags is not_built', async () => {
    await withRollback(async ({ client: c }) => {
      await isolateArchetype(c);
      const [d1] = await numericDims(c);
      const a = await cupped(c, ARCH, { [d1.id]: [4, 5] });
      await cupped(c, ARCH, { [d1.id]: [6, 8] });
      await cupped(c, ARCH, { [d1.id]: [8, 10] });
      const seeded = Number((await c.query(`SELECT param('archetype_profile_min_coffees') AS v`)).rows[0].v);
      expect(seeded).toBe(4);
      expect(await compareCoffee(a, { kind: 'archetype', archetype: ARCH }, c)).toMatchObject({ sentence: null, reason: 'below_min_coffees', coffee_count: 2 });
      await setParameterInTx(c, { key: 'archetype_profile_min_coffees', value: 2, note: 'vitest, rolled back' });
      const ok = await compareCoffee(a, { kind: 'archetype', archetype: ARCH }, c);
      expect(ok.reason).toBe('ok');
      expect(ok.sentence).toMatch(/^This coffee has /);
      expect(await compareCoffee(a, { kind: 'customer_bags', canonicalUserId: '00000000-0000-0000-0000-000000000000' }, c))
        .toEqual({ sentence: null, reason: 'not_built', coffee_count: 0, divergences: [] });
      expect((await compareCoffee(a, { kind: 'archetype', archetype: 'not_an_archetype' }, c)).reason).toBe('no_reference');
    });
  });

  it('thresholds come from param(): delta 3.5 is "slightly" at 4 and "significantly" at 3', async () => {
    await withRollback(async ({ client: c }) => {
      await isolateArchetype(c);
      const [d1] = await numericDims(c);
      const a = await cupped(c, ARCH, { [d1.id]: [4, 5] });       // 4.5 vs reference 8: delta -3.5
      await cupped(c, ARCH, { [d1.id]: [6, 8] });
      await cupped(c, ARCH, { [d1.id]: [8, 10] });
      await setParameterInTx(c, { key: 'archetype_profile_min_coffees', value: 2, note: 'vitest, rolled back' });
      const at4 = await compareCoffee(a, { kind: 'archetype', archetype: ARCH }, c);
      expect(at4.divergences).toEqual([{ dimension: d1.name.toLowerCase(), delta: -3.5, direction: 'slightly less' }]);
      await setParameterInTx(c, { key: 'dimension_delta_significant', value: 3, note: 'vitest, rolled back' });
      const at3 = await compareCoffee(a, { kind: 'archetype', archetype: ARCH }, c);
      expect(at3.divergences[0].direction).toBe('significantly less');
    });
  });

  it('the three sentence shapes match the old getDimensionComparison for the same inputs', async () => {
    await withRollback(async ({ client: c }) => {
      await isolateArchetype(c);
      const [d1, d2] = await numericDims(c);
      await setParameterInTx(c, { key: 'archetype_profile_min_coffees', value: 2, note: 'vitest, rolled back' });
      // reference (two coffees): d1 midpoint 8, d2 midpoint 6
      await cupped(c, ARCH, { [d1.id]: [7, 9], [d2.id]: [5, 7] });
      await cupped(c, ARCH, { [d1.id]: [7, 9], [d2.id]: [5, 7] });
      const label = (await c.query(`SELECT label FROM v_coffee_archetype WHERE code = $1`, [ARCH])).rows[0].label;
      const typical = { [d1.name]: [8, 8] as [number, number], [d2.name]: [6, 6] as [number, number] };
      const cases: Array<Record<number, [number, number]>> = [
        { [d1.id]: [7.5, 8.5], [d2.id]: [5.5, 6.5] },   // close
        { [d1.id]: [12, 14], [d2.id]: [5.5, 6.5] },     // one: significantly more d1
        { [d1.id]: [12, 14], [d2.id]: [3, 4] },         // two: significantly more d1, slightly less d2
      ];
      const sentences: string[] = [];
      for (const values of cases) {
        const id = await cupped(c, null, values);
        const got = await compareCoffee(id, { kind: 'archetype', archetype: ARCH }, c);
        const rows = Object.entries(values).map(([dim, [lo, hi]]) => ({
          dimension: Number(dim) === d1.id ? d1.name : d2.name, avg_min: lo.toFixed(1), avg_max: hi.toFixed(1),
        }));
        expect(got.sentence).toBe(oldSentence(rows, label, typical));
        sentences.push(got.sentence!);
      }
      expect(sentences[0]).toMatch(/sits close to your usual/);
      expect(sentences[1]).toMatch(/than your typical/);
      expect(sentences[2]).toMatch(/ and .* than your usual/);
    });
  });
});

describe('evidence parameters (Part 0)', () => {
  it('seeded 4 / 1.5 / 4, editable (numeric range parses), and slight must stay below significant', async () => {
    await withRollback(async ({ client: c }) => {
      const r = (await c.query(`SELECT param('archetype_profile_min_coffees') a, param('dimension_delta_slight') s, param('dimension_delta_significant') g`)).rows[0];
      expect([Number(r.a), Number(r.s), Number(r.g)]).toEqual([4, 1.5, 4]);
      await expect(setParameterInTx(c, { key: 'dimension_delta_slight', value: 4 })).rejects.toThrow(/must stay below/);
      await expect(setParameterInTx(c, { key: 'dimension_delta_significant', value: 1 })).rejects.toThrow(/must stay below/);
      await expect(setParameterInTx(c, { key: 'dimension_delta_significant', value: 16 })).rejects.toThrow(/outside the sane range/);
      expect((await setParameterInTx(c, { key: 'dimension_delta_slight', value: 2, note: 'vitest, rolled back' })).value).toBe(2);
    });
  });
});

describe('GET /api/coffees/:id/compatibility (A3)', () => {
  it('never returns a coffee name, roaster or origin, over every active coffee and archetype', async () => {
    const app = express();
    app.use('/api/coffees', coffees.default);
    const server: Server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
    try {
      const port = (server.address() as { port: number }).port;
      const active = (await db.query(`SELECT id, name, roaster_name, origin FROM v_coffee WHERE is_active`)).rows;
      const banned = [...new Set(active.flatMap(r => [r.name, r.roaster_name, r.origin]).filter((s): s is string => !!s && s.trim().length > 3))];
      const archetypes = (await db.query(`SELECT code FROM v_coffee_archetype WHERE is_archetype`)).rows.map(r => r.code);
      let sentences = 0;
      for (const coffee of active) {
        for (const code of archetypes) {
          const body = await (await fetch(`http://127.0.0.1:${port}/api/coffees/${coffee.id}/compatibility?userArchetype=${code}`)).text();
          for (const b of banned) expect(body.toLowerCase().includes(b.toLowerCase()), `${coffee.id}/${code} carries "${b}"`).toBe(false);
          if (JSON.parse(body).sentence) sentences++;
        }
      }
      expect(active.length).toBeGreaterThan(0);
      console.log(`[compatibility] ${active.length} coffees x ${archetypes.length} archetypes, ${sentences} sentences rendered`);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 120000);
});

describe('one description (B3)', () => {
  it('a coffee with null ai_summary and a present three_voice_story is not a backfill candidate', async () => {
    await withRollback(async ({ client: c }) => {
      const done = await cupped(c, null, {});
      await c.query(`UPDATE coffees SET ai_summary = NULL, surprise_note = NULL, three_voice_story = 'told', story = 'told' WHERE id = $1`, [done]);
      const missing = await cupped(c, null, {});
      await c.query(`UPDATE coffees SET ai_summary = 'old', surprise_note = 'old', three_voice_story = NULL, story = 'told' WHERE id = $1`, [missing]);
      const ids = await coffees.contentBackfillCandidates(c);
      expect(ids).not.toContain(done);
      expect(ids).toContain(missing);
    });
  });

  it('refresh-content (generateAndStoreAllContent force) writes the story fields only', async () => {
    const tag = `${Date.now()}`;
    const roasterId = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ($1, true) RETURNING id`, [`Zzz Compat Refresh Roastery ${tag}`])).rows[0].id;
    const coffeeId = (await db.query<{ id: number }>(
      `INSERT INTO coffees (name, roaster_id, is_active, ai_summary, surprise_note, ai_summary_generation_failed, surprise_note_generation_failed)
       VALUES ($1, $2, true, 'OLD SUMMARY', 'OLD SURPRISE', false, true) RETURNING id`, [`Zzz Compat Refresh Coffee ${tag}`, roasterId])).rows[0].id;
    try {
      const node = (await db.query<{ id: string }>(`SELECT id FROM cupping_note WHERE descriptor = 'Chocolate' AND is_active ORDER BY tier LIMIT 1`)).rows[0].id;
      await db.query(`INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id) VALUES ($1, $2)`, [coffeeId, node]);
      const out = await coffees.generateAndStoreAllContent(coffeeId, { force: true });
      // coffee presentation brief 3 adds storyRun (the story attempt, for the regeneration loader)
      // and brief 4 descriptionRun (the description's guard outcome)
      expect(Object.keys(out).sort()).toEqual(['descriptionRun', 'story', 'storyPublished', 'storyRun', 'threeVoiceStory']);
      expect(out.threeVoiceStory).toBe('A stub reply for the description.');
      const row = (await db.query(`SELECT ai_summary, surprise_note, ai_summary_generation_failed, surprise_note_generation_failed, three_voice_story, story_draft FROM coffees WHERE id = $1`, [coffeeId])).rows[0];
      expect(row).toMatchObject({ ai_summary: 'OLD SUMMARY', surprise_note: 'OLD SURPRISE', ai_summary_generation_failed: false, surprise_note_generation_failed: true, three_voice_story: 'A stub reply for the description.' });
      expect(row.story_draft).not.toBeNull();
    } finally {
      await db.query(`DELETE FROM roastery_coffee_descriptors WHERE coffee_id = $1`, [coffeeId]);
      await db.query(`DELETE FROM coffees WHERE id = $1`, [coffeeId]);
      await db.query(`DELETE FROM roaster WHERE id = $1`, [roasterId]);
    }
  }, 60000);
});

describe('the Fabricator loader (Part C)', () => {
  it('dry run writes nothing; the real run supersedes the assignment and keeps the old row; a second run skips', async () => {
    await withRollback(async ({ client: c }) => {
      const [d1] = await numericDims(c);
      const coffeeId = await cupped(c, 'fruity', { [d1.id]: [4, 6] });
      await c.query(`INSERT INTO cupping_sessions (session_date, record_source) VALUES ('2001-02-03', 'test:coffeePresentation2')`);
      const params = { coffeeId, archetype: 'chocolate_nutty', confidence: 'medium', sessionDate: '2001-02-03', notes: 'vitest: the rule' };
      const regenerated: number[] = [];
      const deps = {
        runner: c,
        setMatch: (input: Parameters<typeof setMatchArchetypeInTx>[1]) => setMatchArchetypeInTx(c, input),
        regenerate: async (id: number) => { regenerated.push(id); },
        log: () => {},
      };
      const rows = async () => (await c.query(`SELECT archetype, confidence, source, assigned_from_session_id, superseded_at, notes, basis FROM coffee_archetype_assignment WHERE coffee_id = $1 ORDER BY id`, [coffeeId])).rows;

      const dry = await runMatch({ ...params, dryRun: true }, deps);
      expect(dry.wrote).toBe(false);
      expect(await rows()).toHaveLength(1);

      const real = await runMatch({ ...params, dryRun: false }, deps);
      expect(real.wrote).toBe(true);
      const after = await rows();
      expect(after).toHaveLength(2);
      expect(after[0]).toMatchObject({ archetype: 'fruity' });
      expect(after[0].superseded_at).not.toBeNull();
      expect(after[1]).toMatchObject({ archetype: 'chocolate_nutty', confidence: 'medium', source: 'cupping', superseded_at: null, notes: 'vitest: the rule' });
      expect(after[1].assigned_from_session_id).toBe(real.plan.session.id);
      expect(after[1].basis.rule).toBe('vitest: the rule');
      expect(after[1].basis.sessions).toEqual([real.plan.session.id]);
      expect(regenerated).toEqual([coffeeId]);

      const again = await runMatch({ ...params, dryRun: false }, deps);
      expect(again).toMatchObject({ wrote: false, plan: { skip: true } });
      expect(await rows()).toHaveLength(2);
      expect(regenerated).toEqual([coffeeId]);
    });
  });
});
