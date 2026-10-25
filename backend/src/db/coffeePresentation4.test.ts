// Coffee presentation brief 4 (2026-10-24), the database half: the brew
// labels come from the lookup (a fixture value is honoured), the card's tags
// (award, best brew, neither), GET /:id/content returns them, the voice masks
// instead of withholding (coffee 2914 by id, never "latest"), Blossom's
// confidence rule and loader, and the regeneration loader's --fields. Fixtures
// live inside rolled-back transactions (withRollback). The Anthropic SDK and
// the spend guard are mocked.
import 'dotenv/config';
import { describe, it, expect, vi, afterAll } from 'vitest';
import type pg from 'pg';
import express from 'express';
import type { Server } from 'node:http';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: async () => ({ content: [{ type: 'text', text: 'A stub reply.' }] }) };
  },
}));
vi.mock('../services/anthropicGuard.js', () => ({
  guardClaudeCall: (_feature: string, _model: string, fn: () => unknown) => fn(),
  isClaudeGuardBlocked: (err: unknown) => (err as { blocked?: boolean })?.blocked === true,
}));

const { db } = await import('./client.js');
const { withRollback } = await import('../test/withRollback.js');
const { getBrewLabels, getCardTags, getRoasterVoice } = await import('../services/roasterVoiceReads.js');
const { setMatchArchetypeInTx } = await import('../services/catalogService.js');
const { runMatch } = await import('../features/coffee_presentation/load/setMatch2917.js');
const blossom = await import('../features/coffee_presentation/load/setMatch2916.js');
const { parseFields } = await import('../features/coffee_presentation/load/regenerateStories.js');
const coffees = await import('../routes/coffees.js');

afterAll(async () => { await db.end(); });

// Coffee 2914 (Coado, Tiger Stripe on the catalog) carries the award remark
// brief 1 recorded and the general remark that names it.
const AWARD_COFFEE = 2914;
let n = 0;

async function bareCoffee(c: pg.PoolClient): Promise<{ coffeeId: number; roasterId: string }> {
  const tag = `${Date.now()}-${++n}`;
  const roasterId = (await c.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ($1, true) RETURNING id`, [`Zzz Cp4 Roastery ${tag}`])).rows[0].id;
  const coffeeId = (await c.query<{ id: number }>(`INSERT INTO coffees (name, roaster_id, is_active) VALUES ($1, $2, true) RETURNING id`, [`Zzz Cp4 Coffee ${tag}`, roasterId])).rows[0].id;
  return { coffeeId, roasterId };
}

const awardLabel = async (c: pg.PoolClient | typeof db) =>
  (await c.query<{ label: string }>(`SELECT label FROM lookup_value WHERE category = 'coffee_card_tag' AND value = 'award'`)).rows[0]?.label;

describe('brew labels from the lookup (decision 4)', () => {
  it('a fixture brew method is honoured; the portal\'s "other" answer is not a method', async () => {
    await withRollback(async ({ client: c }) => {
      await c.query(`INSERT INTO lookup_value (category, value, label, sort_order) VALUES ('roastery_portal_brew_method', 'zzz_brew', 'Zzzpresso', 99)`);
      const labels = await getBrewLabels(c);
      expect(labels).toContainEqual({ value: 'zzz_brew', label: 'Zzzpresso' });
      expect(labels.map(l => l.value)).not.toContain('other');
      const all = (await c.query(`SELECT count(*)::int AS n FROM lookup_value WHERE category = 'roastery_portal_brew_method'`)).rows[0].n;
      expect(labels).toHaveLength(all - 1);
    });
  });
});

describe('card tags (decision 2)', () => {
  it('the award wording is a seeded lookup row', async () => {
    expect(await awardLabel(db)).toBeTruthy();
  });

  it('an award remark gives the award tag (lookup label); neither award nor brew gives []', async () => {
    await withRollback(async ({ client: c }) => {
      const { coffeeId, roasterId } = await bareCoffee(c);
      expect(await getCardTags(coffeeId, c)).toEqual([]);
      await c.query(
        `INSERT INTO roastery_remark (roaster_id, coffee_id, said_by, said_on, channel, topic, remark, recorded_by, record_source)
         VALUES ($1, $2, 'Zzz', '2001-01-01', 'website', 'award', 'Zzz Cup of the Year', 'vitest', 'test:coffeePresentation4')`, [roasterId, coffeeId]);
      expect(await getCardTags(coffeeId, c)).toEqual([{ kind: 'award', label: await awardLabel(c) }]);
    });
  });

  it('a best brew gives the brew tag with the lookup label, never the stored code', async () => {
    // a coffee whose current portal response names a best brew (read-only)
    const row = (await db.query(
      `SELECT pc.coffee_id, lv.label FROM v_roastery_portal_current_response cr
         JOIN roastery_portal_coffee pc ON pc.id = cr.portal_coffee_id
         JOIN roastery_portal_response_brew b ON b.response_id = cr.id AND b.role = 'best'
         JOIN lookup_value lv ON lv.category = 'roastery_portal_brew_method' AND lv.value = b.brew_method
        WHERE pc.coffee_id IS NOT NULL AND b.brew_method <> 'other' ORDER BY pc.coffee_id LIMIT 1`)).rows[0];
    if (!row) { console.log('[tags] no catalog coffee with a portal best brew on this database; brew tag covered by the voice test only'); return; }
    const tags = await getCardTags(row.coffee_id);
    expect(tags).toContainEqual({ kind: 'brew', label: row.label });
    expect(tags.at(-1)).toEqual({ kind: 'brew', label: row.label });
  });

  it('GET /api/coffees/:id/content returns tags (additive), the award tag for the award coffee', async () => {
    const app = express();
    app.use('/api/coffees', coffees.default);
    const server: Server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
    try {
      const port = (server.address() as { port: number }).port;
      const body = await (await fetch(`http://127.0.0.1:${port}/api/coffees/${AWARD_COFFEE}/content`)).json();
      expect(Object.keys(body)).toEqual(expect.arrayContaining(['aiSummary', 'surpriseNote', 'threeVoiceStory', 'process', 'roastLevel', 'originRegion', 'tags']));
      expect(body.tags[0]).toEqual({ kind: 'award', label: await awardLabel(db) });
      const none = await (await fetch(`http://127.0.0.1:${port}/api/coffees/not-a-number/content`)).json();
      expect(none.tags ?? []).toEqual([]);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

describe('the voice masks instead of withholding (decision 3)', () => {
  it(`coffee ${AWARD_COFFEE}: the espresso-blend remark reaches the voice with the award as gaps`, async () => {
    const voice = await getRoasterVoice(AWARD_COFFEE);
    const all = [...Object.values(voice.remarks).flat(), voice.portal.brewNotes, voice.portal.anythingElse].filter(Boolean).join('\n');
    expect(all).toMatch(/\[…\][^\n]*espresso blend/i);
    expect(all).not.toMatch(/golden|2023|medal/i);
    expect(voice.masked).toBeGreaterThan(0);
    expect(voice.tags[0]?.kind).toBe('award');
  });
});

describe('Blossom (decision 5)', () => {
  async function cuppedWithCalls(c: pg.PoolClient, date: string, calls: string[]) {
    const { coffeeId } = await bareCoffee(c);
    await c.query(`INSERT INTO coffee_archetype_assignment (coffee_id, archetype, confidence) VALUES ($1, 'earthy', 'medium')`, [coffeeId]);
    const sessionId = (await c.query<{ id: number }>(`INSERT INTO cupping_sessions (session_date, record_source) VALUES ($1, 'test:coffeePresentation4') RETURNING id`, [date])).rows[0].id;
    const scId = (await c.query<{ id: number }>(`INSERT INTO cupping_session_coffees (session_id, coffee_id) VALUES ($1, $2) RETURNING id`, [sessionId, coffeeId])).rows[0].id;
    const cuppers = (await c.query<{ id: number }>(`SELECT id FROM cupper ORDER BY id LIMIT $1`, [calls.length])).rows;
    for (const [i, call] of calls.entries()) {
      await c.query(`INSERT INTO cupping_scores (session_coffee_id, is_merged, scale_code, cupper_id, archetype_call) VALUES ($1, false, 'ab_0_15', $2, $3)`,
        [scId, cuppers[i].id, call]);
    }
    return { coffeeId, sessionId };
  }

  it('confidence high when both cuppers of the session call C&N, medium otherwise', async () => {
    await withRollback(async ({ client: c }) => {
      const both = await cuppedWithCalls(c, '2001-03-04', ['chocolate_nutty', 'chocolate_nutty']);
      expect(await blossom.sessionConfidence(c, both.coffeeId, 'chocolate_nutty', '2001-03-04')).toMatchObject({ confidence: 'high', sessionId: both.sessionId });
    });
    await withRollback(async ({ client: c }) => {
      const split = await cuppedWithCalls(c, '2001-03-05', ['chocolate_nutty', 'earthy']);
      expect((await blossom.sessionConfidence(c, split.coffeeId, 'chocolate_nutty', '2001-03-05')).confidence).toBe('medium');
    });
  });

  it('the loader: dry run writes nothing, the real run supersedes and keeps history, a second run skips', async () => {
    await withRollback(async ({ client: c }) => {
      const { coffeeId } = await cuppedWithCalls(c, '2001-03-06', ['chocolate_nutty', 'chocolate_nutty']);
      const conf = await blossom.sessionConfidence(c, coffeeId, blossom.TARGET, '2001-03-06');
      const params = { coffeeId, archetype: blossom.TARGET, confidence: conf.confidence, sessionDate: '2001-03-06', notes: blossom.NOTES };
      const regenerated: number[] = [];
      const deps = {
        runner: c,
        setMatch: (input: Parameters<typeof setMatchArchetypeInTx>[1]) => setMatchArchetypeInTx(c, input),
        regenerate: async (id: number) => { regenerated.push(id); },
        log: () => {},
      };
      const rows = async () => (await c.query(`SELECT archetype, confidence, source, superseded_at, notes, basis FROM coffee_archetype_assignment WHERE coffee_id = $1 ORDER BY id`, [coffeeId])).rows;

      expect((await runMatch({ ...params, dryRun: true }, deps)).wrote).toBe(false);
      expect(await rows()).toHaveLength(1);
      expect((await runMatch({ ...params, dryRun: false }, deps)).wrote).toBe(true);
      const after = await rows();
      expect(after).toHaveLength(2);
      expect(after[0].superseded_at).not.toBeNull();
      expect(after[1]).toMatchObject({ archetype: 'chocolate_nutty', confidence: 'high', source: 'cupping', superseded_at: null, notes: blossom.NOTES });
      expect(after[1].basis.rule).toBe(blossom.NOTES);
      expect((await runMatch({ ...params, dryRun: false }, deps))).toMatchObject({ wrote: false, plan: { skip: true } });
      expect(await rows()).toHaveLength(2);
      expect(regenerated).toEqual([coffeeId]);
    });
  });
});

describe('regeneration loader --fields (D1)', () => {
  it('story by default; story,description both; anything else throws', () => {
    expect(parseFields([])).toEqual(['story']);
    expect(parseFields(['--fields', 'story,description'])).toEqual(['story', 'description']);
    expect(parseFields(['--fields', 'description'])).toEqual(['description']);
    expect(() => parseFields(['--fields', 'summary'])).toThrow(/--fields/);
  });
});
