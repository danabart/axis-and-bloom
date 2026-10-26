import { db, withTransaction, type Tx } from '../client.js';
import { getAnswer, hasAnyGateRule, clearAnswersCache, clearGateRulesCache } from '../../services/sommelierReads.js';
import { setAnswerInTx } from '../../services/sommelierAnswerService.js';
import { setRuleInTx, assertRuleTests, type SetRuleInput } from '../../services/sommelierGateRuleService.js';

// Liam answer layer (2026-10-25), Part A6 — the first gate rules, data rows
// Dana edits later. Runs only when sommelier_gate_rule is empty (once any row
// exists, even a retired one, this never writes again), and goes through the
// write doors: the order_status_unavailable answer through
// sommelierAnswerService.setAnswerInTx, every rule and its examples through
// sommelierGateRuleService.setRuleInTx, so the rule tests run on the seed
// itself and one failing example rolls the whole seed back.
//
// Keywords are the first version, not the last. Two deviations from the
// brief's table, both so integrity check 9 (no rule keyword equals an
// expertise topic's keyword) holds on the live config: the decaf rule uses
// phrases ("any decaf", "decaf options", ...) because "decaf" and
// "decaffeinated" are keywords of the caffeine_decaf expertise topic.
// which_roastery also gets every roaster name from the roaster table at seed
// time, lower-cased (test roasteries named "Zzz ..." skipped).
// shipping and returns get no rule: no answer row exists for them (shipping
// since follow-up 3, 2026-10-26: answer row and rule, below).
// Follow-up (2026-10-25, OT-45): one compound per rule shape on price and
// do_you_roast; on prod they were added through gate:rules:apply (the seed
// only writes into an empty table).
// Answer evals follow-up (2026-10-25, OT-50): order_status moved from resolver
// answer to customer_orders (what was ordered and when, then the same answer
// text), so its must_match label is customer_orders; on prod through
// gate:rules:apply.
// Answer evals follow-up 2 (2026-10-26, OT-50): order_status gains "any
// news", "has my order shipped", "shipped yet"; new rule what_did_i_order
// (resolver customer_orders). Must_match examples are eval phrasings; the
// compounds stay must_not_match. On prod through gate:rules:apply.
// Answer evals follow-up 3 (2026-10-26): the shipping answer (kind policy,
// delivery both) and rule, and a what_we_are rule (none existed; Dana's two
// keywords). On prod through the answer service and gate:rules:apply.

// Answer evals follow-up 3 (2026-10-26): shipping is decided, Dana's words.
export const SHIPPING_ANSWER = {
  key: 'shipping',
  kind: 'policy',
  delivery: 'both',
  sortOrder: 8,
  text: 'We currently ship within the US only.',
};

export const ORDER_STATUS_ANSWER = {
  key: 'order_status_unavailable',
  kind: 'deflection',
  delivery: 'both',
  sortOrder: 7,
  text: "I can't see shipping details from here. A person can check for you: {supportContact}.",
};

type SeedRule = Omit<SetRuleInput, 'createdBy'>;

const mm = (message: string, expectedLabel: string) => ({ message, expectation: 'must_match' as const, expectedLabel });
const mn = (message: string, expectedLabel = 'judgment') => ({ message, expectation: 'must_not_match' as const, expectedLabel });

export function seedRules(roasterNames: string[]): SeedRule[] {
  const roasterKeywords = roasterNames
    .map(n => n.trim().toLowerCase())
    .filter(n => n && !n.startsWith('zzz'));
  return [
    {
      key: 'which_roastery', priority: 10, resolver: 'answer', answerKey: 'partner_privacy', topicKey: 'other',
      keywords: ['which roaster', 'which roastery', 'who roasts', 'roasted by', 'is it joe', 'is it path', 'is it utopian', ...roasterKeywords],
      examples: [
        mm('Which roaster is it from?', 'partner_privacy'),
        mm('Is it Joe Coffee?', 'partner_privacy'),
        mm('Is this roasted by Path?', 'partner_privacy'),
        mm('Who roasts the Coado?', 'partner_privacy'),
        mm('is it utopian?', 'partner_privacy'),
        mn('Which roastery style suits a French press best?'),
        mn('Which roaster would you pick for espresso, and why?'),
      ],
    },
    {
      key: 'do_you_roast', priority: 20, resolver: 'answer', answerKey: 'sourcing', topicKey: 'other',
      keywords: ['do you roast', 'roast it yourself', 'roast yourselves', 'your roastery'],
      examples: [
        mm('Do you roast the coffee?', 'sourcing'),
        mm('Do you roast it yourself?', 'sourcing'),
        mm('Do you guys roast yourselves?', 'sourcing'),
        mm('Where is your roastery?', 'sourcing'),
        mn('Do you roast darker for espresso, and would that suit me?'),
        mn('Do you roast anything that tastes like blueberries?'),
        mn('Do you roast it yourself, and how dark should I go for espresso?'),
      ],
    },
    {
      key: 'what_you_get', priority: 30, resolver: 'answer', answerKey: 'what_you_get', topicKey: 'other',
      keywords: ['whole bean or ground', 'is it ground', 'what size', 'how big is the bag', 'how many ounces'],
      examples: [
        mm('Is it whole bean or ground?', 'what_you_get'),
        mm('Is it ground already?', 'what_you_get'),
        mm('What size are the bags?', 'what_you_get'),
        mm('How big is the bag?', 'what_you_get'),
        mm('How many ounces in a bag?', 'what_you_get'),
        mn('What size grind should I use for a V60?'),
        mn('Is it ground fine enough for espresso, or should I grind it myself?'),
      ],
    },
    {
      key: 'order_status', priority: 40, resolver: 'customer_orders', answerKey: 'order_status_unavailable', topicKey: 'other',
      keywords: ['where is my order', "where's my order", 'has it shipped', 'tracking', 'when will it arrive', 'delivery date', 'any news', 'has my order shipped', 'shipped yet'],
      examples: [
        mm('Where is my order?', 'customer_orders'),
        mm('Has it shipped yet?', 'customer_orders'),
        mm('Do you have a tracking number for me?', 'customer_orders'),
        mm('When will it arrive?', 'customer_orders'),
        mm("What's my delivery date?", 'customer_orders'),
        mm("It's been a few days since I ordered. Any news?", 'customer_orders'),
        mm('Sam here, has my order shipped?', 'customer_orders'),
        mn('Any news on new coffees this month?'),
        mn('When will it arrive, and should I rest it before brewing?'),
        mn("Where's my order? Also, which coffee should I try next?"),
      ],
    },
    {
      // Answer evals follow-up 2 (2026-10-26, OT-50): what was ordered and
      // when, through the same resolver and answer as order_status. Priority
      // after order_status, so "has my last order shipped?" stays a status question.
      key: 'what_did_i_order', priority: 45, resolver: 'customer_orders', answerKey: 'order_status_unavailable', topicKey: 'other',
      keywords: ['what did i order', 'what did i get', 'bought so far', 'my last order', 'what have i bought', 'i have purchased'],
      examples: [
        mm('what did I order before?', 'customer_orders'),
        mm('Could you remind me which coffees I have purchased?', 'customer_orders'),
        mm('Sam here, what have I bought so far?', 'customer_orders'),
        mm('What was in my last order?', 'customer_orders'),
        mn('Can you recommend something like my last order?'),
        mn('What did I order before, and what should I try next?'),
      ],
    },
    {
      key: 'price', priority: 50, resolver: 'catalog_price', topicKey: 'matching',
      keywords: ['how much', 'price', 'cost', 'what does it cost', 'how much is'],
      examples: [
        mm('How much is the Coado?', 'catalog_price'),
        mm('How much is it?', 'catalog_price'),
        mm("What's the price of Clean Fruit?", 'catalog_price'),
        mm('What does it cost?', 'catalog_price'),
        mn('how much is it, and would it suit me for espresso?'),
        mn('How much coffee should I use per cup?'),
        mn('Tell me about the Costa Rica'),
        mn('How much is the Coado, and is it good for cold brew?'),
      ],
    },
    {
      // Answer evals follow-up 3 (2026-10-26): shipping is decided (US only).
      // After price, so "what's the shipping price?" is the price rule's to refuse.
      key: 'shipping', priority: 55, resolver: 'answer', answerKey: SHIPPING_ANSWER.key, topicKey: 'other',
      keywords: ['ship to', 'do you ship', 'shipping', 'international'],
      examples: [
        mm('Do you ship to Canada?', 'shipping'),
        mm('Do you ship internationally?', 'shipping'),
        mm('Where do you ship?', 'shipping'),
        mm('Can you ship to the UK?', 'shipping'),
        mn('How long does shipping take?'),
        mn('Is shipping free?'),
        mn("What's the shipping status of my order?"),
        mn('Do you ship to Canada, and which coffee travels best?'),
      ],
    },
    {
      key: 'decaf', priority: 60, resolver: 'catalog_category', topicKey: 'caffeine_decaf',
      keywords: ['any decaf', 'decaf options', 'which decaf', 'do you have decaf', 'decaf coffees', 'half caf', 'half-caf', 'caffeine free'],
      examples: [
        mm('Do you have any decaf?', 'catalog_category'),
        mm('What are my decaf options?', 'catalog_category'),
        mm('Which decaf coffees do you sell?', 'catalog_category'),
        mm('Do you have half caf?', 'catalog_category'),
        mn('Is decaf safe during pregnancy? Do you have any decaf?'),
        mn('Which decaf would you recommend for me?'),
        mn('How much is the decaf?', 'catalog_price'),
      ],
    },
    {
      key: 'subscription_status', priority: 70, resolver: 'customer_subscription', topicKey: 'other',
      keywords: ['am i subscribed', 'my subscription', 'is my subscription active'],
      examples: [
        mm('Am I subscribed?', 'customer_subscription'),
        mm('Is my subscription active?', 'customer_subscription'),
        mm("What's the status of my subscription?", 'customer_subscription'),
        mn('Can I pause my subscription and switch coffees?'),
        mn('Which coffee should go in my subscription next?'),
      ],
    },
    {
      // Answer evals follow-up 3 (2026-10-26): the what_we_are answer said
      // verbatim. Last, so a more specific rule always matches first.
      key: 'what_we_are', priority: 80, resolver: 'answer', answerKey: 'what_we_are', topicKey: 'other',
      keywords: ['what do you do', 'what is this'],
      examples: [
        mm("Hi, I'm Theo, new here. What do you do?", 'what_we_are'),
        mm('What do you do?', 'what_we_are'),
        mm('What is this?', 'what_we_are'),
        mn('What is this coffee like?'),
        mn('What do you do differently from a roaster, and which coffee should I start with?'),
      ],
    },
  ];
}

async function seedInTx(tx: Tx): Promise<{ rules: number; examples: number; answerAdded: boolean }> {
  let answerAdded = false;
  if (!(await getAnswer(ORDER_STATUS_ANSWER.key, tx))) {
    await setAnswerInTx(tx, {
      key: ORDER_STATUS_ANSWER.key, kind: ORDER_STATUS_ANSWER.kind, delivery: ORDER_STATUS_ANSWER.delivery,
      sortOrder: ORDER_STATUS_ANSWER.sortOrder, answerText: ORDER_STATUS_ANSWER.text,
      note: 'seed: Liam answer layer A6 (2026-10-25), the order_status rule says this verbatim', createdBy: 'seed', expect: 'new',
    });
    answerAdded = true;
  }
  if (!(await getAnswer(SHIPPING_ANSWER.key, tx))) {
    await setAnswerInTx(tx, {
      key: SHIPPING_ANSWER.key, kind: SHIPPING_ANSWER.kind, delivery: SHIPPING_ANSWER.delivery,
      sortOrder: SHIPPING_ANSWER.sortOrder, answerText: SHIPPING_ANSWER.text,
      note: 'seed: answer evals follow-up 3 (2026-10-26), shipping decided: US only', createdBy: 'seed', expect: 'new',
    });
    answerAdded = true;
  }
  const roasters = await tx.query<{ name: string }>(`SELECT name FROM roaster WHERE name IS NOT NULL ORDER BY name`);
  let rules = 0;
  let examples = 0;
  for (const rule of seedRules(roasters.rows.map(r => r.name))) {
    const r = await setRuleInTx(tx, { ...rule, note: 'seed: Liam answer layer A6 (2026-10-25), first version', createdBy: 'seed', expect: 'new' }, { deferTests: true });
    rules++;
    examples += r.examples;
  }
  await assertRuleTests(tx);
  return { rules, examples, answerAdded };
}

/** Writes the seed rules when sommelier_gate_rule is empty; returns what it wrote (zeros when it did nothing). */
export async function seedGateRules(runner?: Tx): Promise<{ rules: number; examples: number; answerAdded: boolean }> {
  if (await hasAnyGateRule(runner ?? db)) return { rules: 0, examples: 0, answerAdded: false };
  if (runner) return seedInTx(runner);
  try {
    return await withTransaction(seedInTx);
  } finally {
    clearAnswersCache();
    clearGateRulesCache();
  }
}
