// Liam answer evals (2026-10-25) — the brief's Testing 2 to 4, plus the
// integrity checks 11-15, the customer-phrasing copy and the pure split.
// backend/src/features/ai_agent_liam/answer_evals/CLAUDE_CODE_PROMPT_LIAM_ANSWER_EVALS.md
// DB tests run inside withRollback; Sonnet and Haiku are stubs: no model is called.
import { describe, it, expect } from 'vitest';
import type pg from 'pg';
import { withRollback } from '../test/withRollback.js';
import { DEFAULT_SOMMELIER_CONFIG } from '../db/seeds/sommelier_config_seed.js';
import { seedSommelierAnswers } from '../db/seeds/sommelier_answer_seed.js';
import { seedGateRules } from '../db/seeds/sommelier_gate_rule_seed.js';
import { seedEvals, GLOBAL_CHECKS } from '../db/seeds/sommelier_eval_seed.js';
import { runCheck, globalFlags, dollarAmountsCents, type CheckContext } from './sommelierReplyCheck.js';
import { runEvals, addCustomerPhrasings, parseJudge, fixtureReads, fixtureCustomerReads, compactCatalog } from './sommelierEval.js';
import { getCurrentCases, getPhrasings, getChecks, getAllCurrentChecks, getRunResults, getActiveRules, type ReplyCheckRow, type SommelierAnswerRow } from './sommelierReads.js';
import { recordTurn } from './sommelierTurnService.js';
import { runEvalChecks, type EvalCheckInput } from './sommelierIntegrity.js';
import { getCatalogCoffees, type CatalogBlock, type CatalogCoffee } from './sommelierRag.js';
import { assembleSystemPromptBlocks, sharedTierText } from './claude.js';
import { buildProfileLine } from './liamProfile.js';
import { FIXTURES, FIXTURE_KEYS } from '../fixtures/liam_eval/index.js';
import type { HaikuCaller } from './sommelierGate.js';
import type { SommelierConfig } from './sommelierConfig.js';

const coffee = (id: number, alias: string, sizes: Array<[string, number]>, categories: Array<[string, string]> = []): CatalogCoffee => ({
  id, alias, archetype: 'fruity', archetypeLabel: 'Fruity', categories: categories.map(([code, label]) => ({ code, label })),
  dialPosition: categories.length ? null : 'Mellow', sizes: sizes.map(([label, cents]) => ({ label, cents })), tastingNote: null, keyFlavors: [], story: null,
} as unknown as CatalogCoffee);

const answer = (key: string, text: string): SommelierAnswerRow => ({
  id: 1, key, kind: 'brand', delivery: 'both', answer_text: text, sort_order: 1, since: new Date(), superseded_at: null, note: null, created_by: 'vitest',
});

const CTX: CheckContext = {
  roasterNames: ['Utopian', 'Path Coffee Roasters'],
  catalog: [coffee(1, 'Clean Fruit', [['12 oz', 2900], ['2 lb', 6800]]), coffee(2, 'Nightcap Decaf', [], [['decaf', 'Decaf']])],
  answers: [answer('sourcing', 'We do not roast. Our bags, their roasting.'), answer('order_status_unavailable', 'A person can check for you: {supportContact}.')],
  supportContact: 'help@vitest.example',
};
const chk = (kind: string, value: string | null = null) => ({ kind, value });

describe('graders (Testing 2)', () => {
  it('must_contain / must_not_contain are case-insensitive literals', () => {
    expect(runCheck(chk('must_contain', 'HELP@vitest.example'), 'write to help@vitest.example', CTX)).toEqual({ pass: true });
    expect(runCheck(chk('must_not_contain', 'shipped'), 'It has SHIPPED', CTX)).toMatchObject({ pass: false });
    expect(runCheck(chk('must_not_contain', 'shipped'), 'I cannot see shipping details', CTX)).toEqual({ pass: true });
  });
  it('must_contain_answer passes on the literal (support contact filled in, curly quotes normalised), else asks the judge', () => {
    expect(runCheck(chk('must_contain_answer', 'order_status_unavailable'), 'Sure. A person can check for you: help@vitest.example.', CTX)).toEqual({ pass: true });
    expect(runCheck(chk('must_contain_answer', 'sourcing'), 'We don’t roast; partners do.', CTX)).toHaveProperty('judge');
    expect(runCheck(chk('must_contain_answer', 'nope'), 'x', CTX)).toMatchObject({ pass: false });
  });
  it('must_contain_answer "a|b" passes on either literal; else one judge question naming both; an unknown key fails', () => {
    const either = chk('must_contain_answer', 'sourcing|order_status_unavailable');
    expect(runCheck(either, 'We do not roast. Our bags, their roasting.', CTX)).toEqual({ pass: true });
    expect(runCheck(either, 'A person can check for you: help@vitest.example.', CTX)).toEqual({ pass: true });
    const asked = runCheck(either, 'Partners roast it.', CTX);
    expect(asked).toHaveProperty('judge');
    expect('judge' in asked && asked.judge).toMatch(/at least one of these answers, in any words, without contradicting it: "We do not roast\. Our bags, their roasting\." or "A person can check/);
    expect(runCheck(chk('must_contain_answer', 'sourcing|nope'), 'x', CTX)).toMatchObject({ pass: false, detail: "answer 'nope' has no current row" });
  });
  it('must_contain_price_of needs every size, $29 and $29.00 both count', () => {
    expect(runCheck(chk('must_contain_price_of', 'Clean Fruit'), 'It is $29 for 12 oz and $68.00 for 2 lb.', CTX)).toEqual({ pass: true });
    expect(runCheck(chk('must_contain_price_of', 'clean fruit'), 'It is $29.00 for 12 oz.', CTX)).toMatchObject({ pass: false, detail: 'missing 2 lb $68.00' });
    expect(runCheck(chk('must_contain_price_of', 'Nightcap Decaf'), 'Not yet.', CTX)).toMatchObject({ pass: false });
    expect(runCheck(chk('must_contain_price_of', 'Ethiopia'), '$29', CTX)).toMatchObject({ pass: false });
  });
  it('price_in_catalog_only: against a block with two sizes', () => {
    expect(dollarAmountsCents('$29, $68.00 and $1,200.5')).toEqual([2900, 6800, 120050]);
    expect(runCheck(chk('price_in_catalog_only'), '$29.00 or $68 for the big bag', CTX)).toEqual({ pass: true });
    expect(runCheck(chk('price_in_catalog_only'), 'about $30', CTX)).toMatchObject({ pass: false, detail: 'price not in the catalog: $30.00' });
    expect(runCheck(chk('price_in_catalog_only'), 'no prices here', CTX)).toEqual({ pass: true });
  });
  it('must_name_catalog_coffee: a whole alias', () => {
    expect(runCheck(chk('must_name_catalog_coffee'), 'Try the Nightcap Decaf.', CTX)).toEqual({ pass: true });
    expect(runCheck(chk('must_name_catalog_coffee'), 'Try something clean and fruity.', CTX)).toMatchObject({ pass: false });
  });
  it('must_not_name_roaster: a name inside another word is not a hit; the name is', () => {
    expect(runCheck(chk('must_not_name_roaster'), 'A utopianism of flavor.', CTX)).toEqual({ pass: true });
    expect(runCheck(chk('must_not_name_roaster'), 'It comes from Utopian.', CTX)).toMatchObject({ pass: false, detail: 'names roaster "utopian"' });
    expect(runCheck(chk('must_not_name_roaster'), 'path coffee roasters do it', CTX)).toMatchObject({ pass: false });
  });
  it('must_not_claim: the phrase, not its negation', () => {
    expect(runCheck(chk('must_not_claim', 'we roast'), 'We do not roast.', CTX)).toEqual({ pass: true });
    expect(runCheck(chk('must_not_claim', 'we roast'), 'Yes, we roast every bag.', CTX)).toMatchObject({ pass: false });
  });
  it('judge rows go to the judge; the judge output parses or is a fail', () => {
    expect(runCheck(chk('judge', 'Is it plain?'), 'x', CTX)).toEqual({ judge: 'Is it plain?' });
    expect(parseJudge('{"pass": true, "reason": "says so"}')).toEqual({ pass: true, reason: 'says so' });
    expect(parseJudge('{"pass": "yes"}')).toBeNull();
    expect(parseJudge('Sure thing')).toBeNull();
  });
});

describe('fixtures', () => {
  it('every fixture parses and builds a customer block; an alias the catalog lacks is named', () => {
    const catalog = [coffee(10, 'Clean Fruit', [['12 oz', 2900]]), coffee(11, 'Coado', [['12 oz', 3200]])];
    for (const key of FIXTURE_KEYS) expect(FIXTURES[key].key).toBe(key);
    const fruity = fixtureReads(FIXTURES.fruity_high_conf, catalog, null);
    expect(fruity.missingAliases).toEqual([]);
    const line = buildProfileLine(fruity.reads);
    expect(line).toContain('Name: Mara');
    expect(line).toContain('Match: Fruity');
    expect(line).toContain('Clean Fruit');
    expect(line).not.toMatch(/pending/i);
    expect(fixtureReads(FIXTURES.two_orders_pending, catalog, null).missingAliases).toEqual(['Classic Balanced']);
    expect(buildProfileLine(fixtureReads(FIXTURES.no_quiz, catalog, null).reads)).toContain('no quiz on file');
    expect(compactCatalog(catalog)).toContain('- Coado: Fruity; 12 oz $32.00');
  });
});

describe('the pure split (Testing 1)', () => {
  it('sharedTierText is the cached shared block, byte for byte', () => {
    const params = {
      session: { intent: 'MATCHED', turnCount: 1, openingContext: '' }, catalogContext: 'YOUR CATALOG\n- Clean Fruit', mode: 'matching' as const,
      config: DEFAULT_SOMMELIER_CONFIG as unknown as SommelierConfig, brandAnswersBlock: 'WHAT YOU KNOW\n- fact', profileLine: 'ABOUT THIS CUSTOMER\nName: X',
    };
    expect(sharedTierText(params)).toBe(assembleSystemPromptBlocks(params)[0].text);
  });
});

// ── DB-backed ────────────────────────────────────────────────────────────────

async function seedAll(client: pg.PoolClient) {
  await seedSommelierAnswers(client);
  await seedGateRules(client);
  await seedEvals(client);
}

const usage = { input_tokens: 100, output_tokens: 20 };
function haiku(judgePass: boolean): HaikuCaller {
  return async ({ model, purpose }) => ({
    model, usdMicros: 100, usage,
    text: purpose === 'judge' ? JSON.stringify({ pass: judgePass, reason: judgePass ? 'fine' : 'not what was asked' }) : '{"label":"judgment","alias":null,"confidence":0.9}',
  });
}
function chatStub(reply: string, usdMicros = 3000) {
  const calls: unknown[] = [];
  const fn = (async (params: unknown) => {
    calls.push(params);
    return { reply, modelUsed: 'claude-sonnet-4-6', actionTypes: [], saveRecipeTitle: undefined, rememberOps: [], cardMarker: undefined, recommendAlias: null, askKind: null, usage, usdMicros, latencyMs: 5, answersVersion: 1 };
  }) as never;
  return { fn, calls };
}

async function counts(client: pg.PoolClient): Promise<Record<string, number>> {
  const tables = (await client.query<{ t: string }>(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND (table_name LIKE 'customer\\_%' OR table_name IN ('sommelier_sessions', 'sommelier_turn', 'sommelier_turn_label', 'user_profile')) ORDER BY 1`
  )).rows.map(r => r.t);
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = Number((await client.query(`SELECT COUNT(*) AS n FROM "${t}"`)).rows[0].n);
  return out;
}

function evalCfg(over: Partial<NonNullable<SommelierConfig['evals']>> = {}): SommelierConfig {
  const c = structuredClone(DEFAULT_SOMMELIER_CONFIG) as unknown as SommelierConfig;
  c.evals = { ...c.evals!, ...over };
  c.brandFacts = { ...c.brandFacts!, supportContact: 'help@vitest.example' };
  return c;
}

async function catalogFor(client: pg.PoolClient): Promise<CatalogBlock> {
  const coffees = await getCatalogCoffees(client, { withFlavors: false });
  return { text: 'YOUR CATALOG (vitest)', version: 'vitest', coffeeIds: coffees.map(c => c.id), coffees, tokensEstimate: 10, trimLevel: 0, builtAt: new Date().toISOString() };
}

describe('the runner (Testing 3, Sonnet and Haiku stubbed)', () => {
  it('writes one result per phrasing and a run row with the counts, and nothing outside the eval tables', async () => {
    await withRollback(async ({ client }) => {
      await seedAll(client);
      const cases = await getCurrentCases(client);
      const phrasings = await getPhrasings(null, client);
      expect(cases.length).toBe(14);
      expect(phrasings.length).toBeGreaterThanOrEqual(14 * 4);
      const before = await counts(client);
      const chat = chatStub('We do not roast. We carefully select the best roasteries across the US to partner with.');
      const summary = await runEvals({ trigger: 'manual', createdBy: 'vitest' }, {
        runner: client, haiku: haiku(true), chat: chat.fn, config: evalCfg(), catalog: () => catalogFor(client),
        fit: async () => ({ fitText: '', coffeeIds: [], slices: [] } as never), roasterNames: async () => ['Utopian'],
      });
      const after = await counts(client);
      expect(after).toEqual(before);
      expect(summary.phrasings).toBe(phrasings.length);
      expect(summary.passed + summary.failed).toBe(phrasings.length);
      expect(summary.skipped).toBe(0);
      const results = await getRunResults(summary.runId, client);
      expect(results.length).toBe(phrasings.length);
      const run = (await client.query(`SELECT finished_at, phrasings, passed, failed, usd_micros FROM sommelier_eval_run WHERE id = $1`, [summary.runId])).rows[0];
      expect(run.finished_at).not.toBeNull();
      expect([run.phrasings, run.passed, run.failed]).toEqual([summary.phrasings, summary.passed, summary.failed]);
      expect(Number(run.usd_micros)).toBe(summary.usdMicros);
      // The canned reply is the sourcing answer: do_you_roast passes, a price case fails with its detail.
      expect(results.filter(r => r.case_key === 'do_you_roast').every(r => r.passed)).toBe(true);
      const price = results.find(r => r.case_key === 'price_named')!;
      expect(price.passed).toBe(false);
      expect(price.judge_notes).toMatch(/must_contain_price_of/);
      // A fixture whose alias the catalog lacks fails its phrasings with the reason, without a model call;
      // every other phrasing reached Sonnet (the stub gate said judgment).
      const fixtureFails = results.filter(r => (r.judge_notes ?? '').startsWith('fixture '));
      expect(fixtureFails.every(r => !r.passed && r.reply === '')).toBe(true);
      expect(chat.calls.length).toBe(phrasings.length - fixtureFails.length);
      expect(results.every(r => r.route === 'model')).toBe(true);
    });
  }, 120000);

  it('only: reruns just the named phrasings and says so in the run note', async () => {
    await withRollback(async ({ client }) => {
      await seedAll(client);
      const total = (await getPhrasings(null, client)).length;
      const chat = chatStub('We do not roast.');
      const only = [{ caseKey: 'do_you_roast', message: 'do you guys roast your own beans?' }, { caseKey: 'no_quiz_recommend', message: 'PICK ONE FOR ME PLS' }];
      const summary = await runEvals({ trigger: 'manual', createdBy: 'vitest', only }, {
        runner: client, haiku: haiku(true), chat: chat.fn, config: evalCfg(), catalog: () => catalogFor(client),
        fit: async () => ({ fitText: '', coffeeIds: [], slices: [] } as never), roasterNames: async () => ['Utopian'],
      });
      expect(summary.phrasings).toBe(2);
      expect((await getRunResults(summary.runId, client)).map(r => r.case_key).sort()).toEqual(['do_you_roast', 'no_quiz_recommend']);
      expect(summary.note).toContain(`partial rerun: 2 of ${total} phrasings`);
    });
  }, 120000);

  it('the gate reads the fixture orders (customer_orders), newest first, up to the limit', async () => {
    const fx = fixtureReads(FIXTURES.two_orders_pending, [coffee(1, 'Coado', [['12 oz', 2100]]), coffee(2, 'Classic Balanced', [['12 oz', 1900]])], null);
    const reads = fixtureCustomerReads(FIXTURES.two_orders_pending, fx.reads.orders);
    const one = await reads.getRecentOrders('eval:two_orders_pending', 1, null as never);
    expect(one.recent).toHaveLength(1);
    expect(one.recent[0].lines[0].coffeeId).toBe(1);
    expect((await fixtureCustomerReads(FIXTURES.no_quiz).getRecentOrders('x', 2, null as never)).recent).toEqual([]);
  });

  it('stops at evals.maxUsdPerRun and says so in the run note', async () => {
    await withRollback(async ({ client }) => {
      await seedAll(client);
      const total = (await getPhrasings(null, client)).length;
      const summary = await runEvals({ trigger: 'manual', createdBy: 'vitest' }, {
        runner: client, haiku: haiku(true), chat: chatStub('ok', 600_000).fn, config: evalCfg({ maxUsdPerRun: 1.0, concurrency: 1 }),
        catalog: () => catalogFor(client), fit: async () => ({ fitText: '', coffeeIds: [], slices: [] } as never), roasterNames: async () => [],
      });
      expect(summary.phrasings).toBeLessThan(total);
      expect(summary.phrasings + summary.skipped).toBe(total);
      expect(summary.note).toMatch(/cost cap \$1\.00/);
    });
  }, 120000);

  it('a judge that answers no fails the phrasing with its reason', async () => {
    await withRollback(async ({ client }) => {
      await seedAll(client);
      const summary = await runEvals({ trigger: 'manual', createdBy: 'vitest' }, {
        runner: client, haiku: haiku(false), chat: chatStub('I am an AI sommelier.').fn, config: evalCfg(),
        catalog: () => catalogFor(client), fit: async () => ({ fitText: '', coffeeIds: [], slices: [] } as never), roasterNames: async () => [],
      });
      const human = (await getRunResults(summary.runId, client)).filter(r => r.case_key === 'are_you_human');
      expect(human.length).toBeGreaterThan(0);
      expect(human.every(r => !r.passed && /judge: not what was asked/.test(r.judge_notes ?? ''))).toBe(true);
    });
  }, 120000);
});

describe('the production reply check (Testing 4)', () => {
  it('a reply naming a roaster gets reply_flags {roaster_name} on its ledger row; a clean one gets {}', async () => {
    await withRollback(async ({ client }) => {
      await seedAll(client);
      const globals = await getChecks(null, client);
      expect(globals.map(g => g.kind).sort()).toEqual(GLOBAL_CHECKS.map(g => g.kind).sort());
      const ctx: CheckContext = { ...CTX, roasterNames: ['Joe Coffee Company'] };
      const dirty = 'That one is from Joe Coffee Company, a lovely roaster.';
      const clean = 'That one is bright and juicy.';
      const dirtyFlags = globalFlags(dirty, globals, ctx);
      expect(dirtyFlags).toEqual(['roaster_name']);
      expect(globalFlags(clean, globals, ctx)).toEqual([]);
      expect(globalFlags('Yes, we roast it ourselves for $30.', globals, ctx).sort()).toEqual(['banned_claim', 'price_not_in_catalog']);
      const sid = (await client.query<{ id: number }>(`INSERT INTO sommelier_sessions (uid, intent, turn_count) VALUES ('vitest-eval', 'MATCHED', 2) RETURNING id`)).rows[0].id;
      await recordTurn({ sessionId: sid, turn: 0, userMessageId: null, assistantMessageId: 'a0', route: 'model', replyFlags: dirtyFlags }, client);
      await recordTurn({ sessionId: sid, turn: 1, userMessageId: 'u1', assistantMessageId: 'a1', route: 'model', replyFlags: [] }, client);
      const rows = (await client.query(`SELECT turn, reply_flags FROM sommelier_turn WHERE session_id = $1 ORDER BY turn`, [sid])).rows;
      expect(rows).toEqual([{ turn: 0, reply_flags: ['roaster_name'] }, { turn: 1, reply_flags: [] }]);
      // The check only reports: the text the customer gets is the text that was checked.
      expect(dirty).toBe('That one is from Joe Coffee Company, a lovely roaster.');
    });
  }, 60000);
});

describe('integrity checks 11 to 15', () => {
  const base = (): EvalCheckInput => ({
    cases: [{ id: 1, key: 'c', kind: 'brand', fixture_key: 'fruity_high_conf', catalog_alias: null, turn_context: null, rule_key: null, since: new Date(), superseded_at: null, note: null, created_by: 'v' }],
    phrasings: [{ id: 1, case_id: 1, case_key: 'c', message: 'm', source: 'hand', source_turn_id: null, since: new Date(), note: null }],
    checks: [
      { id: 1, case_id: 1, kind: 'must_contain_answer', value: 'sourcing', flag_code: null, since: new Date(), note: null, created_by: 'v' },
      { id: 2, case_id: null, kind: 'must_not_name_roaster', value: null, flag_code: 'roaster_name', since: new Date(), note: null, created_by: 'v' },
    ] as ReplyCheckRow[],
    answers: [answer('sourcing', 'x')],
    catalogAliases: ['Clean Fruit'],
    staleRunIds: [],
  });
  const failing = (i: EvalCheckInput) => runEvalChecks(i).filter(c => !c.pass).map(c => c.id);
  it('pass on a clean fixture', () => { expect(failing(base())).toEqual([]); });
  it('11: a case with no phrasing', () => { expect(failing({ ...base(), phrasings: [] })).toEqual([11]); });
  it('12: an answer key or alias that does not resolve', () => {
    expect(failing({ ...base(), answers: [] })).toEqual([12]);
    const b = base();
    b.cases[0].catalog_alias = 'Ethiopia';
    expect(failing(b)).toEqual([12]);
  });
  it('13: a fixture that does not exist', () => {
    const b = base();
    b.cases[0].fixture_key = 'nobody';
    expect(failing(b)).toEqual([13]);
  });
  it('14: a run left unfinished', () => { expect(failing({ ...base(), staleRunIds: [7] })).toEqual([14]); });
  it('15: the global roaster check missing', () => { expect(failing({ ...base(), checks: base().checks.slice(0, 1) })).toEqual([15]); });
  it('the seed set passes 11, 13 and 15 against the test database', async () => {
    await withRollback(async ({ client }) => {
      await seedAll(client);
      const checks = runEvalChecks({
        cases: await getCurrentCases(client), phrasings: await getPhrasings(null, client), checks: await getAllCurrentChecks(client),
        answers: (await client.query(`SELECT key FROM sommelier_answer WHERE superseded_at IS NULL`)).rows.map(r => answer(r.key, '')),
        catalogAliases: null, staleRunIds: [],
      });
      expect(checks.filter(c => [11, 13, 15].includes(c.id)).every(c => c.pass)).toBe(true);
    });
  }, 60000);
});

describe('phrasings grow from customers (C5)', () => {
  it('a gated customer turn becomes a phrasing of the case its rule names, once', async () => {
    await withRollback(async ({ client }) => {
      await seedAll(client);
      const rule = (await getActiveRules(client)).find(r => r.key === 'do_you_roast')!;
      const sid = (await client.query<{ id: number }>(`INSERT INTO sommelier_sessions (uid, intent, turn_count) VALUES ('vitest-eval', 'MATCHED', 2) RETURNING id`)).rows[0].id;
      await recordTurn({ sessionId: sid, turn: 1, userMessageId: 'u1', assistantMessageId: 'a1', route: 'gate', ruleId: rule.id }, client);
      const now = (await client.query<{ now: Date }>(`SELECT now() AS now`)).rows[0].now;
      const window = { from: now, to: new Date(now.getTime() + 1) };
      const readMessage = async () => 'ya roast these urself?';
      const first = await addCustomerPhrasings(window, { runner: client, config: evalCfg(), readMessage });
      expect(first).toMatchObject({ candidates: 1, added: 1 });
      const caseId = (await getCurrentCases(client)).find(c => c.key === 'do_you_roast')!.id;
      expect((await getPhrasings(caseId, client)).filter(p => p.source === 'customer_turn').map(p => p.message)).toEqual(['ya roast these urself?']);
      const second = await addCustomerPhrasings(window, { runner: client, config: evalCfg(), readMessage });
      expect(second).toMatchObject({ candidates: 0, added: 0 });
    });
  }, 60000);
});
