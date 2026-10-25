// Liam answer layer (2026-10-25) — the brief's Testing 2 to 6.
// backend/src/features/ai_agent_liam/answer_layer/CLAUDE_CODE_PROMPT_LIAM_ANSWER_LAYER.md
// Every DB test runs inside withRollback; the seed goes in inside the same
// transaction when the test database has no rules yet. Haiku is a stub: no
// model is called.
import { describe, it, expect } from 'vitest';
import { withRollback } from '../test/withRollback.js';
import { DEFAULT_SOMMELIER_CONFIG } from '../db/seeds/sommelier_config_seed.js';
import { seedGateRules } from '../db/seeds/sommelier_gate_rule_seed.js';
import { seedSommelierAnswers } from '../db/seeds/sommelier_answer_seed.js';
import { setRuleInTx, retireRuleInTx } from './sommelierGateRuleService.js';
import {
  tryGate, exampleFailures, gatedRuleFor, matchCandidate, parseConfirm, resolveRule, runGateOffline, namesRoaster, buildConfirmPrompt,
  type HaikuCaller, type HaikuCall,
} from './sommelierGate.js';
import { getActiveRules, getExamples, getCurrentAnswers, getTurnsForSession, getUnlabelledModelTurns, type GateRuleRow } from './sommelierReads.js';
import { recordTurn as recordLedgerTurn } from './sommelierTurnService.js';
import { recordTurn as recordWriteBack } from './liamWriteBack.js';
import { getLastRecommendation } from './customerReads.js';
import { record } from './customerFacts.js';
import { getCatalogCoffees, type CatalogCoffee } from './sommelierRag.js';
import { runGateChecks, reconcileLedger, type GateCheckInput } from './sommelierIntegrity.js';
import type { SommelierConfig } from './sommelierConfig.js';
import type pg from 'pg';

const SUPPORT = 'hello@vitest.example';
function config(overrides: { enabled?: boolean; closingTurns?: number } = {}): SommelierConfig {
  const c = structuredClone(DEFAULT_SOMMELIER_CONFIG) as unknown as SommelierConfig;
  c.gate!.enabled = overrides.enabled ?? true;
  c.brandFacts = { ...(c.brandFacts ?? { enabled: true, cacheSeconds: 60, rules: [] }), supportContact: SUPPORT };
  c.sessionLimits = { ...c.sessionLimits, closingTurns: overrides.closingTurns ?? 2 };
  return c;
}

/** A Haiku stub: confirm/label calls answer from `confirm`, phrase calls from `phrase`; every call is kept. */
function haikuStub(confirm: (prompt: string) => object, phrase: (prompt: string) => string = () => 'Fine.') {
  const calls: Array<{ purpose: string; prompt: string }> = [];
  const fn: HaikuCaller = async ({ model, prompt, purpose }) => {
    calls.push({ purpose, prompt });
    const text = purpose === 'phrase' ? phrase(prompt) : JSON.stringify(confirm(prompt));
    return { text, model, usdMicros: purpose === 'phrase' ? 400 : 250, usage: { input_tokens: 300, output_tokens: 20 } } satisfies HaikuCall;
  };
  return { fn, calls };
}

// The answers seed first: a test database cloned before Brief 1 has none (a no-op otherwise).
async function seeded(client: pg.PoolClient): Promise<GateRuleRow[]> {
  await seedSommelierAnswers(client);
  await seedGateRules(client);
  return getActiveRules(client);
}

async function sessionFixture(client: pg.PoolClient, ctx: object = {}, turnCount = 3): Promise<number> {
  return (await client.query<{ id: number }>(
    `INSERT INTO sommelier_sessions (uid, intent, turn_count, context_data) VALUES ('vitest-gate-uid', 'EXPLORATION', $1, $2) RETURNING id`,
    [turnCount, JSON.stringify(ctx)]
  )).rows[0].id;
}

const coffeeFixture = (id: number, alias: string, sizes = [{ label: '12 oz', cents: 1800 }, { label: '2 lb', cents: 4200 }]): CatalogCoffee => ({
  id, alias, archetype: 'fruity', archetypeLabel: 'Fruity', categories: [], dialPosition: null, sizes,
  tastingNote: null, keyFlavors: [], story: null,
} as unknown as CatalogCoffee);

describe('rule tests (Testing 2)', () => {
  it('the seed rules load and every example passes steps 2 and 3 with the confirmation stubbed', async () => {
    await withRollback(async ({ client }) => {
      const rules = await seeded(client);
      expect(rules.map(r => r.key).sort()).toEqual(['decaf', 'do_you_roast', 'order_status', 'price', 'subscription_status', 'what_you_get', 'which_roastery']);
      const examples = await getExamples(null, client);
      expect(exampleFailures(rules, examples, 160)).toEqual([]);
      for (const r of rules) {
        const mine = examples.filter(e => e.rule_key === r.key);
        expect(mine.filter(e => e.expectation === 'must_match').length, r.key).toBeGreaterThanOrEqual(3);
        expect(mine.filter(e => e.expectation === 'must_not_match').length, r.key).toBeGreaterThanOrEqual(2);
      }
      expect(examples.some(e => e.message === 'how much is it, and would it suit me for espresso?' && e.expected_label === 'judgment')).toBe(true);
      // The new deflection answer went in through the answer door.
      expect((await getCurrentAnswers(client)).find(a => a.key === 'order_status_unavailable')?.answer_text).toContain('{supportContact}');
    });
  }, 60000);

  it('a deliberately wrong example is rejected by setRuleInTx, naming the message', async () => {
    await withRollback(async ({ client, savepoint }) => {
      await seeded(client);
      await expect(savepoint(() => setRuleInTx(client, {
        key: 'price', priority: 50, resolver: 'catalog_price', topicKey: 'matching', keywords: ['how much', 'price'], createdBy: 'vitest',
        examples: [{ message: 'Do you roast the coffee?', expectation: 'must_match', expectedLabel: 'catalog_price' }],
      }))).rejects.toThrow(/Do you roast the coffee\?.*rule do_you_roast/);
      await expect(savepoint(() => setRuleInTx(client, {
        key: 'vitest_rule', priority: 1, resolver: 'answer', answerKey: 'no_such_answer', topicKey: 'other', keywords: ['x'], createdBy: 'vitest',
      }))).rejects.toThrow(/no current sommelier_answer row/);
      await expect(savepoint(() => setRuleInTx(client, {
        key: 'vitest_rule', priority: 1, resolver: 'teleport', topicKey: 'other', keywords: ['x'], createdBy: 'vitest',
      }))).rejects.toThrow(/not in the code registry/);
      await expect(savepoint(() => setRuleInTx(client, {
        key: 'vitest_rule', priority: 1, resolver: 'catalog_price', topicKey: 'no_topic', keywords: ['x'], createdBy: 'vitest',
      }))).rejects.toThrow(/not a config topic/);
    });
  }, 60000);

  it('an edit supersedes the row and carries the examples over; a retire leaves the others passing', async () => {
    await withRollback(async ({ client }) => {
      const before = (await seeded(client)).find(r => r.key === 'price')!;
      const n = (await getExamples(before.id, client)).length;
      const edited = await setRuleInTx(client, {
        key: 'price', priority: 50, resolver: 'catalog_price', topicKey: 'matching', keywords: [...before.keywords, 'how pricey'], createdBy: 'vitest', expect: 'edit',
      });
      expect(edited.supersededId).toBe(before.id);
      expect(edited.examples).toBe(n);
      expect((await getExamples(before.id, client)).length).toBe(0); // old row's examples are superseded with it
      await retireRuleInTx(client, { key: 'subscription_status', createdBy: 'vitest' });
      expect((await getActiveRules(client)).some(r => r.key === 'subscription_status')).toBe(false);
    });
  }, 60000);
});

describe('the confirmation prompt', () => {
  it('a deflection label is introduced as declining, a brand label as answering', async () => {
    await withRollback(async ({ client }) => {
      const rules = await seeded(client);
      const prompt = buildConfirmPrompt({ cfg: config(), rules, answers: await getCurrentAnswers(client), aliases: ['Coado'], previous: '', message: 'is it Joe Coffee?' });
      expect(prompt).toContain('- partner_privacy: the customer asks, or guesses by name, something this reply deliberately declines to tell them (a guessed name that is not one of the coffees listed below counts as asking)');
      expect(prompt).toMatch(/- sourcing: the customer asks something this reply fully answers: "We do not roast/);
      expect(prompt).toContain(`A person can check for you: ${SUPPORT}.`);
      expect(prompt).toContain('Customer message: is it Joe Coffee?');
    });
  }, 60000);
});

describe('matching and parsing (pure)', () => {
  const rule = (key: string, priority: number, keywords: string[], resolver = 'answer', answer_key: string | null = key) =>
    ({ id: priority, key, priority, resolver, answer_key, topic_key: 'other', keywords, max_message_chars: null } as GateRuleRow);
  it('lowest priority wins; the length cap sends a long message to the model', () => {
    const rules = [rule('b', 20, ['how much']), rule('a', 10, ['roast'])];
    expect(matchCandidate('How much to roast?', rules)?.rule.key).toBe('a');
    expect(gatedRuleFor('how much?', rules, 'b', 160)).toBe('b');
    expect(gatedRuleFor(`how much ${'x'.repeat(200)}`, rules, 'b', 160)).toBeNull();
  });
  it('parseConfirm reads the first JSON object and treats junk as unparsed', () => {
    expect(parseConfirm('{"label":"sourcing","alias":null,"confidence":0.93}')).toEqual({ label: 'sourcing', alias: null, confidence: 0.93 });
    expect(parseConfirm('Sure! {"label": "catalog_price", "alias": "Coado", "confidence": 1}')?.alias).toBe('Coado');
    expect(parseConfirm('{"label":"catalog_price","alias":"There')).toBeNull();
    expect(parseConfirm('no json')).toBeNull();
  });
});

describe('routing (Testing 3, Haiku stubbed)', () => {
  const confirmAs = (label: string, alias: string | null = null, confidence = 0.95) => () => ({ label, alias, confidence });

  it('"do you roast?" → the sourcing answer verbatim, modelUsed gate, one Haiku call, a gate ledger row, no recommendation row', async () => {
    await withRollback(async ({ client }) => {
      await seeded(client);
      const sid = await sessionFixture(client);
      const h = haikuStub(confirmAs('sourcing'));
      const out = await tryGate({ uid: 'vitest-gate-uid', sessionId: sid, message: 'do you roast?', turnCount: 3, maxTurns: 16, ctx: {}, history: [] },
        { runner: client, haiku: h.fn, config: config(), roasterNames: async () => [] });
      expect(out.gated).toBe(true);
      if (!out.gated) return;
      const sourcing = (await getCurrentAnswers(client)).find(a => a.key === 'sourcing')!;
      expect(out.reply).toBe(sourcing.answer_text);
      expect(out.modelUsed).toBe('gate');
      expect(out.route).toBe('gate');
      expect(out.answerId).toBe(sourcing.id);
      expect(h.calls.map(c => c.purpose)).toEqual(['confirm']);

      await recordLedgerTurn({ sessionId: sid, turn: 3, userMessageId: 'u3', assistantMessageId: 'a3', route: out.route, model: out.model,
        usage: out.usage, usdMicros: out.usdMicros, ruleId: out.ruleId, confirmLabel: out.confirmLabel, confirmConfidence: out.confirmConfidence,
        answerId: out.answerId, answersVersion: out.answersVersion }, client);
      const rows = await getTurnsForSession(sid, client);
      expect(rows.map(r => [r.route, r.usd_micros])).toEqual([['gate', '250']]);

      const wb = await recordWriteBack({ uid: 'vitest-gate-uid', sessionId: sid, turn: 3, assistantMessageId: 'a3', reply: out.reply,
        recommendAlias: null, askKind: null, candidates: [], candidateCoffeeIds: [], exploreArchetypeCode: null, route: 'gate' }, client);
      expect(wb).toBeNull();
      expect(await getLastRecommendation(sid, client)).toEqual([]);
    });
  }, 60000);

  it('"is it Joe Coffee?" → partner_privacy verbatim', async () => {
    await withRollback(async ({ client }) => {
      await seeded(client);
      const sid = await sessionFixture(client);
      const out = await tryGate({ uid: 'vitest-gate-uid', sessionId: sid, message: 'is it Joe Coffee?', turnCount: 2, maxTurns: 16, ctx: {}, history: [] },
        { runner: client, haiku: haikuStub(confirmAs('partner_privacy')).fn, config: config(), roasterNames: async () => [] });
      expect(out.gated && out.reply).toBe((await getCurrentAnswers(client)).find(a => a.key === 'partner_privacy')!.answer_text);
    });
  }, 60000);

  it('"where is my order?" → the deflection with the support contact filled in', async () => {
    await withRollback(async ({ client }) => {
      await seeded(client);
      const sid = await sessionFixture(client);
      const out = await tryGate({ uid: 'vitest-gate-uid', sessionId: sid, message: 'Where is my order?', turnCount: 2, maxTurns: 16, ctx: {}, history: [] },
        { runner: client, haiku: haikuStub(confirmAs('order_status_unavailable')).fn, config: config(), roasterNames: async () => [] });
      expect(out.gated && out.reply).toBe(`I can't see shipping details from here. A person can check for you: ${SUPPORT}.`);
    });
  }, 60000);

  it('"how much is the Ethiopia?" → gate_haiku naming every size and price; no recommendation row', async () => {
    await withRollback(async ({ client }) => {
      await seeded(client);
      const coffeeId = (await client.query<{ id: number }>(`SELECT id FROM coffees ORDER BY id LIMIT 1`)).rows[0].id;
      const ctx = { storyCandidates: [{ coffeeId, alias: 'Ethiopia Guji', story: null }, { coffeeId: coffeeId + 100000, alias: 'Clean Fruit', story: null }] };
      const sid = await sessionFixture(client, ctx);
      const h = haikuStub(confirmAs('catalog_price', 'Ethiopia Guji'), p => `The Ethiopia Guji is ${p.includes('$18.00') && p.includes('$42.00') ? '$18.00 for 12 oz or $42.00 for 2 lb' : 'unknown'}. Whole bean.`);
      const out = await tryGate({ uid: 'vitest-gate-uid', sessionId: sid, message: 'how much is the Ethiopia?', turnCount: 4, maxTurns: 16, ctx, history: [] },
        { runner: client, haiku: h.fn, config: config(), roasterNames: async () => [], catalogCoffees: async () => [coffeeFixture(coffeeId, 'Ethiopia Guji')] });
      expect(out.gated).toBe(true);
      if (!out.gated) return;
      expect(out.route).toBe('gate_haiku');
      expect(out.modelUsed).toBe('gate:haiku');
      expect(out.coffeeId).toBe(coffeeId);
      expect(out.usdMicros).toBe(650); // both Haiku calls
      const phrasePrompt = h.calls.find(c => c.purpose === 'phrase')!.prompt;
      expect(phrasePrompt).toContain('12 oz $18.00; 2 lb $42.00');
      expect(out.reply).toBe('The Ethiopia Guji is $18.00 for 12 oz or $42.00 for 2 lb. Whole bean.');
      expect(await getLastRecommendation(sid, client)).toEqual([]);
    });
  }, 60000);

  it('"how much is it?" after a pick → the price of the last recommendation', async () => {
    await withRollback(async ({ client }) => {
      await seeded(client);
      const coffeeId = (await client.query<{ id: number }>(`SELECT id FROM coffees ORDER BY id LIMIT 1`)).rows[0].id;
      const userId = (await client.query<{ id: string }>(`SELECT id FROM user_profile ORDER BY created_at LIMIT 1`)).rows[0].id;
      const sid = await sessionFixture(client, { storyCandidates: [{ coffeeId, alias: 'Ethiopia Guji', story: null }] });
      await record.liamRecommendation({ userId, source: 'liam', sourceId: `vitest:${sid}:2`, sessionId: sid, turn: 2, messageId: 'a2', coffeeId, candidateCoffeeIds: [coffeeId] }, client);
      const out = await tryGate({ uid: 'vitest-gate-uid', sessionId: sid, message: 'How much is it?', turnCount: 3, maxTurns: 16,
        ctx: { storyCandidates: [{ coffeeId, alias: 'Ethiopia Guji', story: null }] }, history: [] },
        { runner: client, haiku: haikuStub(confirmAs('catalog_price', null), () => 'It is $18.00 for 12 oz.').fn, config: config(), roasterNames: async () => [],
          catalogCoffees: async () => [coffeeFixture(coffeeId, 'Ethiopia Guji')] });
      expect(out.gated && out.coffeeId).toBe(coffeeId);
    });
  }, 60000);

  it('the compound message, a closing turn, the opening turn and gate.enabled = false all go to the model', async () => {
    await withRollback(async ({ client }) => {
      await seeded(client);
      const sid = await sessionFixture(client);
      const base = { uid: 'vitest-gate-uid', sessionId: sid, ctx: {}, history: [] };
      const judged = haikuStub(confirmAs('judgment'));
      const compound = await tryGate({ ...base, message: 'how much is it, and would it suit me for espresso?', turnCount: 3, maxTurns: 16 },
        { runner: client, haiku: judged.fn, config: config(), roasterNames: async () => [] });
      expect(compound).toMatchObject({ gated: false, reason: 'judgment', confirmLabel: 'judgment', usdMicros: 250 });
      expect(compound.gated === false && compound.ruleId).toBeGreaterThan(0);

      const never = haikuStub(() => { throw new Error('Haiku must not be called'); });
      const closing = await tryGate({ ...base, message: 'do you roast?', turnCount: 14, maxTurns: 16 }, { runner: client, haiku: never.fn, config: config({ closingTurns: 2 }) });
      expect(closing).toMatchObject({ gated: false, reason: 'closing_turns' });
      const opening = await tryGate({ ...base, message: 'do you roast?', turnCount: 0, maxTurns: 16 }, { runner: client, haiku: never.fn, config: config() });
      expect(opening).toMatchObject({ gated: false, reason: 'opening_turn' });
      const off = await tryGate({ ...base, message: 'do you roast?', turnCount: 3, maxTurns: 16 }, { runner: client, haiku: never.fn, config: config({ enabled: false }) });
      expect(off).toMatchObject({ gated: false, reason: 'disabled' });
      expect(never.calls).toEqual([]);

      const low = await tryGate({ ...base, message: 'do you roast?', turnCount: 3, maxTurns: 16 },
        { runner: client, haiku: haikuStub(confirmAs('sourcing', null, 0.5)).fn, config: config(), roasterNames: async () => [] });
      expect(low).toMatchObject({ gated: false, reason: 'low_confidence' });
      const junk = await tryGate({ ...base, message: 'do you roast?', turnCount: 3, maxTurns: 16 },
        { runner: client, haiku: (async ({ model }) => ({ text: 'I think so', model, usdMicros: 1, usage: null })) as HaikuCaller, config: config(), roasterNames: async () => [] });
      expect(junk).toMatchObject({ gated: false, reason: 'unparsed' });
    });
  }, 60000);
});

describe('redaction (Testing 4: three roasteries, one coffee named after its roaster)', () => {
  it('no resolver output and no gated reply carries a roaster name', async () => {
    await withRollback(async ({ client }) => {
      const stamp = Date.now().toString(36);
      const names = [`Vitest Ridgeback Roasters ${stamp}`, `Vitest Harbor Coffee Co ${stamp}`, `Vitest Lantern Roastery ${stamp}`];
      const roasterIds: string[] = [];
      for (const n of names) roasterIds.push((await client.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ($1, true) RETURNING id`, [n])).rows[0].id);
      const decaf = (await client.query<{ id: number }>(`SELECT id FROM coffee_category WHERE code = 'decaf'`)).rows[0].id;
      const ids: number[] = [];
      for (let i = 0; i < 3; i++) {
        const id = (await client.query<{ id: number }>(
          `INSERT INTO coffees (name, roaster_id, is_active, story, story_published) VALUES ($1, $2, true, $3, true) RETURNING id`,
          [i === 0 ? `${names[0]} House Decaf` : `Vitest Decaf ${i} ${stamp}`, roasterIds[i], `Roasted by ${names[i]}.`]
        )).rows[0].id;
        await client.query(`INSERT INTO coffee_category_assignment (coffee_id, category_id) VALUES ($1, $2)`, [id, decaf]);
        ids.push(id);
      }
      const rules = await seeded(client);
      const all = await getCatalogCoffees(client);
      const coffees = all.map(c => (ids.includes(c.id) ? { ...c, sizes: [{ label: '12 oz', cents: 1900 }] } : c));
      const answers = await getCurrentAnswers(client);
      const roasterNames = (await client.query<{ name: string }>(`SELECT name FROM roaster`)).rows.map(r => r.name);
      const outputs: string[] = [];
      for (const rule of rules) {
        if (rule.resolver === 'customer_subscription') continue; // a status word and a flag; no free text
        for (const coffeeId of rule.resolver === 'catalog_price' ? ids : [null]) {
          const row = await resolveRule({ rule, uid: 'vitest-gate-uid', message: 'Do you have any decaf?', coffeeId, answers, coffees: async () => coffees, cfg: config(), runner: client });
          if (row) outputs.push(row.text);
        }
      }
      expect(outputs.length).toBeGreaterThanOrEqual(7);
      for (const text of outputs) for (const n of roasterNames) expect(text.toLowerCase(), `"${text}" names ${n}`).not.toContain(n.toLowerCase());

      // A phrased reply that names a roaster is refused (the turn goes to Sonnet).
      const sid = await sessionFixture(client, { storyCandidates: coffees.filter(c => ids.includes(c.id)).map(c => ({ coffeeId: c.id, alias: c.alias, story: null })) });
      const leak = await tryGate({ uid: 'vitest-gate-uid', sessionId: sid, message: 'Do you have any decaf?', turnCount: 3, maxTurns: 16, ctx: {}, history: [] },
        { runner: client, haiku: haikuStub(() => ({ label: 'catalog_category', alias: null, confidence: 1 }), () => `Try the one from ${names[1]}.`).fn,
          config: config(), catalogCoffees: async () => coffees });
      expect(leak).toMatchObject({ gated: false, reason: 'roaster_in_reply' });
      expect(namesRoaster(`It is ${names[2]}'s.`, roasterNames)).toBe(true);
    });
  }, 60000);
});

describe('integrity checks 6 to 10 and the gated ledger rows (Testing 5)', () => {
  const r = (key: string, over: Partial<GateRuleRow> = {}) => ({
    id: 1, key, priority: 10, resolver: 'answer', answer_key: 'sourcing', topic_key: 'other', keywords: ['do you roast'],
    max_message_chars: null, since: new Date(), superseded_at: null, note: null, created_by: 'vitest', ...over,
  } as GateRuleRow);
  const answer = (key: string, id = 1) => ({ id, key, kind: 'brand', delivery: 'both', answer_text: 'x', sort_order: 1, since: new Date(), superseded_at: null, note: null, created_by: 'seed' });
  const base = (): GateCheckInput => ({
    rules: [r('do_you_roast'), r('order_status', { id: 2, priority: 40, answer_key: 'order_status_unavailable', keywords: ['where is my order'] })],
    examples: [{ id: 1, rule_id: 1, rule_key: 'do_you_roast', message: 'Do you roast it?', expectation: 'must_match', expected_label: 'sourcing', since: new Date(), superseded_at: null, note: null }],
    answers: [answer('sourcing'), answer('order_status_unavailable', 2)],
    topics: { other: { mode: 'matching', keywords: [] }, caffeine_decaf: { mode: 'expertise', keywords: ['decaf'] } },
    defaultMaxChars: 160,
    orderWriters: [{ module: 'orders', verbs: ['INSERT'] }],
  });
  const failing = (input: GateCheckInput) => runGateChecks(input).filter(c => !c.pass).map(c => c.id);

  it('pass on a clean fixture', () => { expect(failing(base())).toEqual([]); });
  it('6: an answer rule whose key has no current answer', () => {
    expect(failing({ ...base(), answers: [answer('order_status_unavailable', 2)] })).toEqual([6]);
  });
  it('7: an unknown resolver or topic', () => {
    expect(failing({ ...base(), rules: [r('do_you_roast', { topic_key: 'nope' })] })).toContain(7);
    expect(failing({ ...base(), rules: [r('do_you_roast', { resolver: 'teleport' })] })).toContain(7);
  });
  it('8: an example that no longer routes', () => {
    expect(failing({ ...base(), rules: [r('do_you_roast', { keywords: ['roast yourselves'] })] })).toContain(8);
  });
  it('9: a rule keyword shared with an expertise topic', () => {
    expect(failing({ ...base(), rules: [...base().rules, r('decaf', { id: 3, priority: 60, resolver: 'catalog_category', answer_key: null, keywords: ['decaf'] })] })).toEqual([9]);
  });
  it('10: an order writer besides the checkout insert while order_status is still an answer', () => {
    expect(failing({ ...base(), orderWriters: [{ module: 'orders', verbs: ['INSERT'] }, { module: 'roasteryPortalService', verbs: ['UPDATE'] }] })).toEqual([10]);
  });
  it('the seed rules pass 9 against the seed topics (the decaf phrases do not collide with caffeine_decaf)', async () => {
    await withRollback(async ({ client }) => {
      const rules = await seeded(client);
      const checks = runGateChecks({ ...base(), rules, examples: await getExamples(null, client), answers: await getCurrentAnswers(client),
        topics: DEFAULT_SOMMELIER_CONFIG.topics as GateCheckInput['topics'] });
      expect(checks.filter(c => !c.pass).map(c => `${c.id}: ${c.details?.join('; ')}`)).toEqual([]);
    });
  }, 60000);
  it('5: a gated ledger row whose reply is not tagged gate', () => {
    const check = reconcileLedger({
      sessions: [{ sessionId: 1, uid: 'u', turnCount: 2, startedAt: new Date() }],
      turnsBySession: new Map([[1, [{ turn: 0, assistant_message_id: 'a0', route: 'model' }, { turn: 1, assistant_message_id: 'a1', route: 'gate' }]]]),
      transcriptIdsBySession: new Map([[1, new Set(['a0', 'a1'])]]),
      transcriptModelBySession: new Map([[1, new Map([['a0', 'claude-sonnet-4-6'], ['a1', 'claude-sonnet-4-6']])]]),
    });
    expect(check.pass).toBe(false);
    expect(check.details?.[0]).toMatch(/not tagged modelUsed gate/);
  });
});

describe('the nightly labeller (Testing 6)', () => {
  it('four model turns give four labels and one replay per example; a second run the same day writes nothing new', async () => {
    await withRollback(async ({ client }) => {
      await seeded(client);
      const sid = await sessionFixture(client, {}, 5);
      for (let t = 1; t <= 4; t++) {
        await recordLedgerTurn({ sessionId: sid, turn: t, userMessageId: `u${t}`, assistantMessageId: `a${t}`, route: 'model', model: 'claude-sonnet-4-6' }, client);
      }
      const now = (await client.query<{ now: Date }>(`SELECT now() AS now`)).rows[0].now;
      const window = { from: now, to: new Date(now.getTime() + 1) };
      const messages: Record<string, string> = { u1: 'do you roast?', u2: 'which coffee suits me?', u3: 'how much is it?', u4: 'tell me about washed process' };
      const labeller = haikuStub(p => (p.includes('Customer message: do you roast?') ? { label: 'sourcing', alias: null, confidence: 0.9 }
        : p.includes('Customer message: how much is it?') ? { label: 'catalog_price', alias: null, confidence: 0.9 }
        : { label: 'judgment', alias: null, confidence: 0.9 }));
      const deps = {
        runner: client, haiku: labeller.fn, config: config(), window, replaySince: now, catalogAliases: async () => ['Coado'],
        readTranscript: async (t: { userMessageId: string }) => ({ message: messages[t.userMessageId], previous: '' }),
      };
      const examples = await getExamples(null, client);
      const first = await runGateOffline(deps);
      expect(first).toMatchObject({ turns: 4, labelled: 4, misses: 2, replayed: examples.length });
      expect(await getUnlabelledModelTurns({ ...window, labelerModel: config().gate!.offline!.model }, client)).toEqual([]);
      const second = await runGateOffline(deps);
      expect(second).toMatchObject({ turns: 0, labelled: 0, replayed: 0 });
    });
  }, 60000);
});
