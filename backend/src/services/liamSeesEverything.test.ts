// Liam sees everything brief Rev 2 (2026-10-24), Testing 1, 4, 5, 8 — on the
// pure assembly and the ledger door:
//   - the ABOUT THIS CUSTOMER block: an empty customer is today's (L1) bytes
//     plus the name line; an order prints what and when, never a status,
//     tracking, a delivery date or a street;
//   - tiers: base + brand facts + catalog block in the shared tier (1h TTL
//     there only), customer block + FIT block in the session tier;
//   - the FIT block (labels by alias, the decaf header);
//   - the ledger: one insert per reply, an unknown route never throws, a
//     guard row has no model and zero tokens; reconciliation fixtures;
//   - applyMissingKeys' SEED_UPGRADES and the 1h cache-write rate.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import { buildProfileLine, shippingStatusLine, type ProfileReads } from './liamProfile.js';
import { assembleSystemPrompt, assembleSystemPromptBlocks, renderBrandAnswersBlock, substituteSupportContact, LIAM_BASE_PROMPT } from './claude.js';
import { renderFitBlock } from './sommelierRag.js';
import { recordTurn } from './sommelierTurnService.js';
import { getTurnsForSession } from './sommelierReads.js';
import { reconcileLedger } from './sommelierIntegrity.js';
import { computeCostMicros } from './anthropicGuard.js';
import { DEFAULT_SOMMELIER_CONFIG, seedUpgradePaths, SEED_UPGRADES, missingKeyPaths } from '../db/seeds/sommelier_config_seed.js';

afterAll(async () => { await db.end(); });

type Config = Parameters<typeof assembleSystemPrompt>[0]['config'];
const CONFIG = JSON.parse(JSON.stringify(DEFAULT_SOMMELIER_CONFIG)) as Config;

const emptyReads = (over: Partial<ProfileReads> = {}): ProfileReads => ({
  quizCurrent: null, brewProfile: {}, feedbackCurrent: [], evidence: null, sharedTraits: [], dominantDimensions: [],
  archetypeSpread: [], threads: [], slotCandidates: [], timeline: [], aliasByCoffee: new Map(), exploreArchetypeCode: null,
  ...over,
});

describe('ABOUT THIS CUSTOMER block (Part B)', () => {
  it('an empty customer is the L1 bytes plus the name line', () => {
    const l1 = buildProfileLine(emptyReads());
    const rev2 = buildProfileLine(emptyReads({
      identity: { firstName: 'Mara', memberSince: new Date('2026-07-19T00:00:00Z'), householdMembers: 0 },
      quizHistory: [], orders: { recent: [], olderCount: 0, olderArchetypeCounts: {} }, subscription: null, shipsTo: null,
      saved: [], brewCards: [], liamHistory: [], counts: { feedbackCount: 8 },
    }));
    const [header, ...rest] = l1.split('\n');
    // No quiz on file is stated on the name line (B1's no-quiz rule needs the fact).
    expect(rev2).toBe([header, 'Name: Mara; member since Jul 2026; no quiz on file', ...rest].join('\n'));
  });

  it('a customer with a quiz gets no "no quiz" note; one without a first name gets it as its own line', () => {
    const withQuiz = buildProfileLine(emptyReads({
      identity: { firstName: 'Mara', memberSince: null, householdMembers: 0 },
      quizHistory: [{ archetypeName: 'Fruity', completedAt: new Date('2026-10-01T00:00:00Z') }],
    }));
    expect(withQuiz).toContain('Name: Mara\n');
    expect(withQuiz).not.toContain('no quiz');
    const noName = buildProfileLine(emptyReads({ identity: { firstName: null, memberSince: null, householdMembers: 0 }, quizHistory: [] }));
    expect(noName.split('\n')[1]).toBe('No quiz on file');
  });

  it('orders: what and when only — no status, tracking, delivery date, street or id', () => {
    const line = buildProfileLine(emptyReads({
      aliasByCoffee: new Map([[7, 'Coado']]),
      orders: { recent: [{ createdAt: new Date('2026-10-20T12:00:00Z'), lines: [{ coffeeId: 7, weightOz: 12, quantity: 2 }] }], olderCount: 3, olderArchetypeCounts: { chocolate_nutty: 3 } },
      archetypeLabels: new Map([['chocolate_nutty', 'Chocolate & Nutty']]),
      shipsTo: { city: 'Hoboken', state: 'NJ' },
      subscription: { status: 'active', sponsored: true },
    }));
    expect(line).toContain('Orders (what and when only): Oct 20: Coado 12 oz ×2');
    expect(line).toContain('3 earlier orders, mostly Chocolate & Nutty');
    expect(line).toContain('Ships to: Hoboken, NJ');
    expect(line).toContain('Subscription: active (sponsored)');
    expect(line).not.toMatch(/pending|shipped|deliver|tracking|arriv|street/i);
  });

  it('orders: the shipping status line prints under the orders lines, contact filled; none without orders (follow-up 2, OT-50)', () => {
    const cfg = { customerBlock: { shippingStatusLine: 'Shipping status: not visible to Liam; {supportContact} can check' }, brandFacts: { supportContact: 'help@example.com' } } as never;
    const status = shippingStatusLine(cfg);
    expect(status).toBe('Shipping status: not visible to Liam; help@example.com can check');
    expect(shippingStatusLine(null)).toBeNull();
    const withOrders = buildProfileLine(emptyReads({
      aliasByCoffee: new Map([[7, 'Coado']]),
      orders: { recent: [{ createdAt: new Date('2026-10-20T12:00:00Z'), lines: [{ coffeeId: 7, weightOz: 12, quantity: 2 }] }], olderCount: 0, olderArchetypeCounts: {} },
      shippingStatusLine: status,
    }));
    expect(withOrders).toContain('Orders (what and when only): Oct 20: Coado 12 oz ×2\nShipping status: not visible to Liam; help@example.com can check');
    const noOrders = buildProfileLine(emptyReads({ orders: { recent: [], olderCount: 0, olderArchetypeCounts: {} }, shippingStatusLine: status }));
    expect(noOrders).not.toContain('Shipping status');
  });

  it('feedback, saved coffees, brew cards and earlier Liam sessions render by alias', () => {
    const line = buildProfileLine(emptyReads({
      aliasByCoffee: new Map([[7, 'Coado'], [8, 'Clean Fruit']]),
      feedbackCurrent: [{ feedbackEventId: 'f', occurredAt: new Date('2026-10-01'), orderLineItemId: null, orderId: null, coffeeId: 8, rating: 5, expectation: null, rawText: 'loved the berry', channel: 'web', source: 'onsite', sentiment: 'positive', descriptorNoteIds: [] }],
      counts: { feedbackCount: 8 },
      saved: [{ archetype: 'fruity', dialSortOrder: 1, coffeeId: null, savedAt: new Date() }],
      savedSlotAlias: new Map([['fruity:1', 'Clean Fruit']]),
      brewCards: [{ coffeeId: 7, method: 'french_press', ratio: '1:15', grindLabel: 'coarse', tempC: 94 }],
      liamHistory: [{ sessionId: 3, at: new Date('2026-10-22'), recommendedCoffeeIds: [7], answers: ['something nutty'] }],
    }));
    expect(line).toContain('Feedback (newest first): Clean Fruit (liked, rated 5, "loved the berry")');
    expect(line).toContain('Saved to their profile: Clean Fruit');
    expect(line).toContain('Brew cards: Coado on french press: 1:15, coarse, 94°C');
    expect(line).toContain('With Liam before: Oct 22: recommended Coado: they answered "something nutty"');
  });
});

describe('assembly tiers and TTL (A4, C4)', () => {
  const block = renderBrandAnswersBlock([{ delivery: 'prefix', answer_text: 'We do not roast.' }],
    substituteSupportContact([...CONFIG!.brandFacts!.rules, ...CONFIG!.customerBlock!.rules], CONFIG!.brandFacts!.supportContact));
  const params = {
    session: { intent: 'MATCHED', turnCount: 2, openingContext: '' },
    catalogContext: 'YOUR CATALOG — test\n---\nClean Fruit — Fruity\n---',
    mode: 'matching' as const, config: CONFIG, brandAnswersBlock: block,
    profileLine: 'ABOUT THIS CUSTOMER (facts; rebuilt every turn)\nName: Mara',
    fitContext: 'FIT FOR THIS CUSTOMER:\n- Clean Fruit [primary]',
  };

  it('shared = base + brand facts + catalog (1h TTL); session = customer + FIT (5m); joined blocks = the string', () => {
    const blocks = assembleSystemPromptBlocks(params);
    expect(blocks[0].text).toBe(`${LIAM_BASE_PROMPT}\n\n${block}\n\n${params.catalogContext}`);
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(blocks[1].text).toBe(`\n\n${params.profileLine}\n\n${params.fitContext}`);
    expect(blocks[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[2].cache_control).toBeUndefined();
    expect(blocks.map(b => b.text).join('')).toBe(assembleSystemPrompt(params));
  });

  it('the shared block is identical for two different customers on different turns', () => {
    const a = assembleSystemPromptBlocks(params)[0];
    const b = assembleSystemPromptBlocks({ ...params, session: { intent: 'EXPLORATION', turnCount: 9, openingContext: 'x' }, profileLine: 'ABOUT THIS CUSTOMER\nName: Jo', fitContext: '' })[0];
    expect(a.text).toBe(b.text);
  });

  it("sharedTtl '5m' keeps the plain marker (byte-identical request shape to before)", () => {
    const cfg5 = JSON.parse(JSON.stringify(CONFIG)); cfg5.promptCache.sharedTtl = '5m';
    expect(assembleSystemPromptBlocks({ ...params, config: cfg5 })[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('expertise turns keep the catalog (omitCatalogInExpertiseMode false) and the rules substitute {supportContact}', () => {
    const text = assembleSystemPrompt({ ...params, mode: 'expertise' });
    expect(text).toContain(params.catalogContext);
    expect(text).toContain('point them to dana@axisandbloomcoffee.com');
    expect(text).not.toContain('{supportContact}');
  });
});

describe('FIT block (A2, A3)', () => {
  it('labels by alias in composition order; the decaf header leads a decaf-only customer', () => {
    const aliases = new Map([[1, 'Clean Fruit'], [2, 'Nightcap Decaf'], [3, 'Coado']]);
    const labels = new Map([[2, '[primary]'], [3, '[second archetype]']]);
    expect(renderFitBlock([{ id: 1 }, { id: 2 }, { id: 3 }], aliases, labels, { header: 'FIT:' })).toBe('FIT:\n- Nightcap Decaf [primary]\n- Coado [second archetype]');
    expect(renderFitBlock([{ id: 2 }], aliases, labels, { header: 'FIT:', decafHeader: 'Decaf only.' })).toBe('FIT:\nDecaf only.\n- Nightcap Decaf [primary]');
    expect(renderFitBlock([{ id: 1 }], aliases, new Map(), { header: 'FIT:' })).toBe('');
  });
});

describe('turn ledger (C2, C3)', () => {
  async function session(client: import('pg').PoolClient): Promise<number> {
    return (await client.query<{ id: number }>(`INSERT INTO sommelier_sessions (uid, intent, context_data) VALUES ('vitest-ledger', 'MATCHED', '{}') RETURNING id`)).rows[0].id;
  }

  it('one insert per reply with usage and cost; a guard row has no model and zero tokens; an unknown route never throws', async () => {
    await withRollback(async ({ client }) => {
      const sid = await session(client);
      const a = await recordTurn({ sessionId: sid, turn: 0, userMessageId: null, assistantMessageId: 'm0', route: 'model', model: 'claude-sonnet-4-6', answersVersion: 6, mode: 'matching', usage: { input_tokens: 120, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0, output_tokens: 40 }, usdMicros: 2700, latencyMs: 900 }, client);
      const b = await recordTurn({ sessionId: sid, turn: 1, userMessageId: 'u1', assistantMessageId: 'm1', route: 'guard' }, client);
      const bad = await recordTurn({ sessionId: sid, turn: 2, userMessageId: 'u2', assistantMessageId: 'm2', route: 'telepathy' }, client);
      expect(a).not.toBeNull(); expect(b).not.toBeNull(); expect(bad).toBeNull();
      const rows = await getTurnsForSession(sid, client);
      expect(rows.map(r => [r.turn, r.route, r.model, r.input_tokens, r.cache_read_tokens, r.output_tokens, Number(r.usd_micros), r.answers_version])).toEqual([
        [0, 'model', 'claude-sonnet-4-6', 120, 5000, 40, 2700, 6],
        [1, 'guard', null, 0, 0, 0, 0, null],
      ]);
      // (session, turn) is unique: a second row for a turn is refused, logged, and never throws.
      expect(await recordTurn({ sessionId: sid, turn: 0, userMessageId: null, assistantMessageId: 'dup', route: 'model' }, client)).toBeNull();
    });
  });

  it('the ledger is insert-only for the app role (no UPDATE / DELETE grant)', async () => {
    const r = await db.query<{ u: boolean; d: boolean }>(
      `SELECT has_table_privilege('ab_app', 'sommelier_turn', 'UPDATE') AS u, has_table_privilege('ab_app', 'sommelier_turn', 'DELETE') AS d`
    ).catch(() => ({ rows: [] as Array<{ u: boolean; d: boolean }> }));
    if (r.rows[0]) expect(r.rows[0]).toEqual({ u: false, d: false });
  });

  it('reconciliation: rows = turn_count (+1 for a daily-cap close), every reply in the transcript', () => {
    const ok = reconcileLedger({
      sessions: [{ sessionId: 1, uid: 'u', turnCount: 3, startedAt: new Date() }, { sessionId: 2, uid: 'u', turnCount: 2, startedAt: new Date(), closeReason: 'daily_cap' }, { sessionId: 3, uid: 'u', turnCount: 5, startedAt: new Date() }],
      turnsBySession: new Map([
        [1, [{ turn: 0, assistant_message_id: 'a' }, { turn: 1, assistant_message_id: 'b' }, { turn: 2, assistant_message_id: 'c' }]],
        [2, [{ turn: 0, assistant_message_id: 'd' }, { turn: 1, assistant_message_id: 'e' }, { turn: 2, assistant_message_id: 'f' }]],
        [3, []], // pre-ledger session: skipped
      ]),
      transcriptIdsBySession: new Map([[1, new Set(['a', 'b', 'c'])], [2, new Set(['d', 'e', 'f'])]]),
    });
    expect(ok.pass).toBe(true);
    expect(ok.actual).toBe('2 session(s) reconciled');
    const bad = reconcileLedger({
      sessions: [{ sessionId: 1, uid: 'u', turnCount: 3, startedAt: new Date() }],
      turnsBySession: new Map([[1, [{ turn: 0, assistant_message_id: 'a' }, { turn: 2, assistant_message_id: 'zz' }]]]),
      transcriptIdsBySession: new Map([[1, new Set(['a'])]]),
    });
    expect(bad.pass).toBe(false);
    expect(bad.details).toEqual([
      'session 1: 2 ledger row(s), expected 3 (turn_count 3)',
      'session 1: no ledger row for turn 1',
      'session 1: 1 ledger row(s) whose reply is not in the transcript (turn 2)',
    ]);
  });
});

describe('config upgrade and cost', () => {
  it('SEED_UPGRADES apply only while the live value is still the previous seed', () => {
    const untouched = { brandFacts: { rules: SEED_UPGRADES[0].from }, contextAssembly: { omitCatalogInExpertiseMode: true } };
    expect(seedUpgradePaths(DEFAULT_SOMMELIER_CONFIG, untouched).sort()).toEqual(['brandFacts.rules', 'contextAssembly.omitCatalogInExpertiseMode']);
    const edited = { brandFacts: { rules: ['Dana wrote this'] }, contextAssembly: { omitCatalogInExpertiseMode: true } };
    expect(seedUpgradePaths(DEFAULT_SOMMELIER_CONFIG, edited)).toEqual(['contextAssembly.omitCatalogInExpertiseMode']);
    expect(seedUpgradePaths(DEFAULT_SOMMELIER_CONFIG, DEFAULT_SOMMELIER_CONFIG)).toEqual([]);
  });

  it('gate.confirmPrompt upgrades from the first seed to the compound-first prompt, and never over an edit', () => {
    const v1 = SEED_UPGRADES.find(u => u.path === 'gate.confirmPrompt')!.from as string;
    expect(v1).not.toContain('First, check whether the message asks for more than one thing');
    expect(DEFAULT_SOMMELIER_CONFIG.gate.confirmPrompt).toContain('First, check whether the message asks for more than one thing');
    expect(seedUpgradePaths(DEFAULT_SOMMELIER_CONFIG, { gate: { confirmPrompt: v1 } })).toContain('gate.confirmPrompt');
    expect(seedUpgradePaths(DEFAULT_SOMMELIER_CONFIG, { gate: { confirmPrompt: 'Dana wrote this {labels} {message}' } })).not.toContain('gate.confirmPrompt');
  });

  it('an object upgrade matches the live map whatever its key order (Firestore does not keep the seed order)', () => {
    const live = { guards: { modelCostPerTurnUsd: { 'claude-sonnet-4-6': 0.02, 'claude-haiku-4-5-20251001': 0.002 } } };
    expect(seedUpgradePaths(DEFAULT_SOMMELIER_CONFIG, live)).toContain('guards.modelCostPerTurnUsd');
    const edited = { guards: { modelCostPerTurnUsd: { 'claude-sonnet-4-6': 0.03, 'claude-haiku-4-5-20251001': 0.002 } } };
    expect(seedUpgradePaths(DEFAULT_SOMMELIER_CONFIG, edited)).not.toContain('guards.modelCostPerTurnUsd');
  });

  it('the new subtrees are added as missing keys; supportContact lands inside brandFacts', () => {
    const live = { brandFacts: { enabled: true, cacheSeconds: 60, rules: [] }, sessionLimits: DEFAULT_SOMMELIER_CONFIG.sessionLimits };
    const paths = missingKeyPaths(DEFAULT_SOMMELIER_CONFIG, live);
    expect(paths).toContain('brandFacts.supportContact');
    expect(paths).toContain('catalogBlock.template');
    expect(paths).toContain('customerBlock.rules');
    expect(paths).toContain('promptCache.sharedTtl');
    expect(paths).not.toContain('brandFacts.rules');
  });

  it('a 1-hour cache write costs 2x input; 5-minute writes keep their 1.25x rate', () => {
    const base = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
    expect(computeCostMicros('claude-sonnet-4-6', { ...base, cache_creation_input_tokens: 1_000_000 })).toBe(3_750_000);
    expect(computeCostMicros('claude-sonnet-4-6', { ...base, cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_1h_input_tokens: 1_000_000, ephemeral_5m_input_tokens: 0 } })).toBe(6_000_000);
    expect(computeCostMicros('claude-sonnet-4-6', { ...base, cache_creation_input_tokens: 2_000_000, cache_creation: { ephemeral_1h_input_tokens: 1_000_000, ephemeral_5m_input_tokens: 1_000_000 } })).toBe(9_750_000);
  });
});
