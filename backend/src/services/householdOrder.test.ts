// Family Household 3, Part D (2026-11-07) — order for the house, against the
// test database: per-line recipients and the household on orders, recipient
// subscription items, renewal per drinker (decision 1: the box ships what
// resolves), D24 attribution, member mail, cancel-on-leave and the handover
// offer, Build the house box, the numbers view. Stripe, Resend and Firebase
// Auth are mocked as in the commerce tests; prices and slots are the test
// database's own (a family with sellable 12 oz slots is found at start).
// backend/src/features/household/CLAUDE_CODE_PROMPT_HOUSEHOLD_3_ORDER_FOR_THE_HOUSE.md
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.setConfig({ testTimeout: 120000 });

let seq = 0;
const fakeStripe = {
  customers: { update: vi.fn(async () => ({})) },
  checkout: {
    sessions: {
      create: vi.fn(async () => ({ id: `cs_test_hh3_${Date.now()}_${++seq}`, client_secret: `cs_secret_${seq}`, status: 'open' })),
      retrieve: vi.fn(async (id: string) => ({ id, status: 'open', client_secret: 'cs_secret_reused' })),
    },
  },
  paymentIntents: { retrieve: vi.fn(async () => ({ latest_charge: { balance_transaction: { fee: 82 } }, payment_method: 'pm_hh3' })) },
  invoices: { retrieve: vi.fn(async (id: string) => ({ id, status: 'paid' })) },
};
vi.mock('./stripe.js', () => ({ STRIPE_ENABLED: true, stripe: () => fakeStripe, getOrCreateStripeCustomer: async () => 'cus_hh3' }));
const sent: Array<{ to: string; subject: string }> = [];
vi.mock('../features/marketing/resendEmail.js', () => ({
  sendResendEmail: async (e: { to: string; subject: string }) => { sent.push({ to: e.to, subject: e.subject }); return { ok: true, id: `re_${sent.length}` }; },
}));
vi.mock('./firebase-admin.js', () => ({
  default: { auth: () => ({ getUser: async (uid: string) => ({ email: `${uid}@example.com` }) }) },
  firestoreDb: {},
}));
vi.mock('./userLifecycle.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./userLifecycle.js')>();
  return { ...real, refreshLifecycleState: async () => null };
});

const { db } = await import('../db/client.js');
const hs = await import('./householdService.js');
const reads = await import('./householdReads.js');
const { resolveIntendedFor, fingerprint, createCheckoutSession, completeCheckoutSession, quoteCart } = await import('./checkoutService.js');
const { addItem, removeItem } = await import('./subscriptionService.js');
const { resolveSubscriptionShipment } = await import('./subscriptionShipment.js');
const { resolveBlendForSlot } = await import('./blendResolver.js');
const { saveQuizSession } = await import('./quizSession.js');
const { savePosition } = await import('./dialPositionService.js');
const { sendHouseholdBagOrderedEmails, sendHouseholdBagShippedEmails } = await import('./householdEmails.js');
const { invalidateCommerceParameterCache } = await import('./commerceParameters.js');
const { invalidateHouseholdParameterCache } = await import('./householdParameters.js');

const RUN = `vitest-hh3-${Date.now()}`;
const created: string[] = [];
let A = { code: '', name: '', slots: [] as Array<{ sortOrder: number; slotId: number; price: number; name: string }> };

async function profile(tag: string, firstName = tag, withAddress = false): Promise<{ id: string; uid: string }> {
  const uid = `${RUN}-${tag}`;
  const id = (await db.query<{ id: string }>(`INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, $2) RETURNING id`, [uid, firstName])).rows[0].id;
  created.push(id);
  if (withAddress) {
    await db.query(`INSERT INTO address (user_id, address_type, street, city, state, postal_code, country, is_default) VALUES ($1, 'shipping', '1 Test St', 'Hoboken', 'NJ', '07030', 'US', true)`, [id]);
  }
  return { id, uid };
}
const quiz = (userId: string, takenBy: string | null = null) =>
  saveQuizSession(userId, A.name, { archetype: A.name, scores: {}, answers: {} }, null, takenBy);
const dial = (userId: string, slotId: number) => savePosition(db, { userId, archetype: A.code, slotId, savedItem: false });
const dialItem = (k: number, intendedForUserId?: string) => ({
  archetype: A.code, dialSortOrder: A.slots[k].sortOrder, weightOz: 12, quantity: 1, priceCents: A.slots[k].price,
  ...(intendedForUserId ? { intendedForUserId } : {}),
});
const expectErr = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });
const kinds = async (householdId: string) =>
  (await db.query<{ kind_code: string }>(`SELECT kind_code FROM v_household_event WHERE household_id = $1 ORDER BY created_at`, [householdId])).rows.map(r => r.kind_code);

/** Admin (own quiz, address), Tom (claimed account, own quiz, dial), Ella (managed, proxy quiz). */
async function family(tag: string) {
  const admin = await profile(`${tag}-admin`, `${tag}Admin`, true);
  const h = await hs.create(admin.id, `${RUN} ${tag}`);
  await quiz(admin.id);
  const tomAcc = await profile(`${tag}-tom`, 'Tom', true);
  const tom = await hs.addMember(admin.id, 'Tom');
  await hs.accept(tom.token, tomAcc.id);
  await quiz(tomAcc.id);
  await dial(tomAcc.id, A.slots[1].slotId);
  const ella = await hs.addMember(admin.id, 'Ella');
  await quiz(ella.userId, admin.id);
  return { admin, h, tomAcc, tom, ella };
}

/** Run a subscription checkout through createCheckoutSession and completeCheckoutSession (the webhook's call). */
async function checkout(uid: string, items: any[], subscription: { frequencyWeeks: number } | null) {
  const r = await createCheckoutSession({ uid, email: `${uid}@example.com`, items, shippingAddressId: null, subscription });
  const cs = (await db.query(`SELECT id, stripe_checkout_session_id, subtotal_cents, handover_offer_event_id FROM checkout_session WHERE id = $1`, [r.checkoutSessionId])).rows[0];
  const done = await completeCheckoutSession({
    id: cs.stripe_checkout_session_id, payment_intent: `pi_${cs.id}`, metadata: { checkout_session_id: cs.id },
    amount_total: cs.subtotal_cents, total_details: { amount_shipping: 0, amount_tax: 0 }, currency: 'usd',
  } as any);
  return { ...done, checkoutSession: cs };
}

beforeAll(async () => {
  invalidateCommerceParameterCache();
  invalidateHouseholdParameterCache();
  const fams = (await db.query<{ code: string; name: string }>(
    `SELECT DISTINCT ca.code::text AS code, ca.name FROM coffee_archetype ca JOIN coffee_dial_slot s ON s.archetype = ca.code ORDER BY 1`
  )).rows;
  for (const f of fams) {
    const slots: typeof A.slots = [];
    const rows = (await db.query<{ id: number; sort_order: number }>(`SELECT id, sort_order FROM coffee_dial_slot WHERE archetype = $1 ORDER BY sort_order`, [f.code])).rows;
    for (const s of rows) {
      const r = await resolveBlendForSlot(f.code, s.sort_order, 12);
      if (r) slots.push({ sortOrder: s.sort_order, slotId: s.id, price: r.retail_price_cents, name: r.slot_name ?? 'Coffee' });
    }
    if (slots.length >= 3) { A = { code: f.code, name: f.name, slots }; break; }
  }
  if (!A.code) throw new Error('test fixture needs one family with three sellable 12 oz slots');
}, 120000);

afterAll(async () => {
  // Test hygiene on the test database: no subscription left counting.
  await db.query(`UPDATE subscription SET status = 'canceled' WHERE user_id = ANY($1::uuid[]) AND status <> 'canceled'`, [created]);
});

describe('B1 per-line recipients', () => {
  it('buyer + members pass; a non-member, a left member and a member outside the box are refused; recipients change the fingerprint', async () => {
    const f = await family('b1');
    const r = await resolveIntendedFor(f.admin.id, [{}, { intendedForUserId: f.tomAcc.id }, { intendedForUserId: f.ella.userId }]);
    expect(r).toEqual({ perItem: [f.admin.id, f.tomAcc.id, f.ella.userId], householdId: f.h.householdId });
    const stranger = await profile('b1-stranger');
    await expectErr(resolveIntendedFor(f.admin.id, [{ intendedForUserId: stranger.id }]), 'invalid_recipient');
    // Sam: own plan only (out of the box).
    const samAcc = await profile('b1-sam', 'Sam');
    const sam = await hs.addMember(f.admin.id, 'Sam');
    await hs.accept(sam.token, samAcc.id);
    await hs.grantRole(samAcc.id, sam.memberId, 'own_plan');
    await hs.revokeRole(f.admin.id, sam.memberId, 'household');
    await expectErr(resolveIntendedFor(f.admin.id, [{ intendedForUserId: samAcc.id }]), 'invalid_recipient');
    await hs.leave(f.tomAcc.id);
    await expectErr(resolveIntendedFor(f.admin.id, [{ intendedForUserId: f.tomAcc.id }]), 'invalid_recipient');
    const cart = { lines: [{ coffeeSkuId: 'x', quantity: 1, unitPriceCents: 1, discountCents: 0, source: 'dial', archetype: 'a', dialSortOrder: 1, itemIndex: 0 }], subtotalCents: 1, bagCount: 1, shippingCents: 0 } as any;
    const ship = { id: 's', street: '', city: '', state: '', postal_code: '', country: '' };
    expect(fingerprint(cart, ship, [f.admin.id], null)).not.toBe(fingerprint(cart, ship, [f.ella.userId], null));
  });
});

describe('orders and the house subscription', () => {
  it('a house subscription checkout: household on order and subscription, recipients per line, recipient items store no archetype', async () => {
    const f = await family('order');
    const done = await checkout(f.admin.uid, [dialItem(0), dialItem(0, f.tomAcc.id), dialItem(2, f.ella.userId)], { frequencyWeeks: 4 });
    const order = (await db.query(`SELECT household_id, subscription_id FROM "order" WHERE id = $1`, [done.orderId])).rows[0];
    expect(order.household_id).toBe(f.h.householdId);
    const lines = (await db.query(`SELECT intended_for_user_id FROM order_line_item WHERE order_id = $1 ORDER BY id`, [done.orderId])).rows.map(r => r.intended_for_user_id).sort();
    expect(lines).toEqual([f.admin.id, f.tomAcc.id, f.ella.userId].sort());
    const sub = (await db.query(`SELECT household_id FROM subscription WHERE id = $1`, [order.subscription_id])).rows[0];
    expect(sub.household_id).toBe(f.h.householdId);
    const items = (await db.query(`SELECT archetype::text, intended_for_user_id FROM subscription_item WHERE subscription_id = $1`, [order.subscription_id])).rows;
    expect(items.filter(i => i.intended_for_user_id)).toHaveLength(2);
    expect(items.filter(i => i.intended_for_user_id).every(i => i.archetype === null)).toBe(true);
    expect(items.filter(i => !i.intended_for_user_id).map(i => i.archetype)).toEqual([A.code]);
    expect((await reads.mine(f.admin.id))!.houseSubscription?.id).toBe(order.subscription_id);

    // A member's own plan (no bag for anyone else) stays personal (decision 2) though the order counts for the house.
    const own = await checkout(f.tomAcc.uid, [dialItem(1)], { frequencyWeeks: 4 });
    const ownOrder = (await db.query(`SELECT household_id, subscription_id FROM "order" WHERE id = $1`, [own.orderId])).rows[0];
    expect(ownOrder.household_id).toBe(f.h.householdId);
    expect((await db.query(`SELECT household_id FROM subscription WHERE id = $1`, [ownOrder.subscription_id])).rows[0].household_id).toBeNull();

    // A solo buyer: no household, the line is theirs.
    const solo = await profile('order-solo', 'Solo', true);
    const one = await checkout(solo.uid, [dialItem(0)], null);
    expect((await db.query(`SELECT household_id FROM "order" WHERE id = $1`, [one.orderId])).rows[0].household_id).toBeNull();
    expect((await db.query(`SELECT intended_for_user_id FROM order_line_item WHERE order_id = $1`, [one.orderId])).rows[0].intended_for_user_id).toBe(solo.id);

    // D24: a claim by another member beats the line's recipient; an unclaimed line is intended; a solo order is the buyer's.
    const tomLine = (await db.query(`SELECT oli.id, s.coffee_id FROM order_line_item oli JOIN coffee_sku s ON s.id = oli.blend_id WHERE oli.order_id = $1 AND oli.intended_for_user_id = $2`, [done.orderId, f.tomAcc.id])).rows[0];
    const attr = async (lineId: string) => (await db.query(`SELECT attribution, drinker_user_id FROM v_customer_bag_attribution WHERE order_line_item_id = $1`, [lineId])).rows[0];
    expect(await attr(tomLine.id)).toEqual({ attribution: 'intended', drinker_user_id: f.tomAcc.id });
    const soloLine = (await db.query(`SELECT id FROM order_line_item WHERE order_id = $1`, [one.orderId])).rows[0].id;
    expect(await attr(soloLine)).toEqual({ attribution: 'buyer', drinker_user_id: solo.id });
    await db.query(`INSERT INTO customer_bag_claim (user_id, source, source_id, coffee_id) VALUES ($1, 'qr', $2, $3)`, [f.admin.id, `${RUN}:claim`, tomLine.coffee_id]);
    expect((await attr(tomLine.id)).attribution).toBe('claim');

    // B4: Tom (sign-in) hears his bag is ordered and shipped; Ella (managed) and the buyer do not; twice → once.
    sent.length = 0;
    await sendHouseholdBagOrderedEmails(done.orderId);
    await sendHouseholdBagOrderedEmails(done.orderId);
    expect(sent.map(s => s.to)).toEqual([`${f.tomAcc.uid}@example.com`]);
    sent.length = 0;
    await sendHouseholdBagShippedEmails(done.orderId);
    expect(sent.map(s => s.to)).toEqual([`${f.tomAcc.uid}@example.com`]);
  });
});

describe('renewal per drinker (B3, decision 1)', () => {
  it('each drinker by their own quiz and dial; the subscriber dial never leaks; no quiz or left → skipped, the rest ships at its own tier', async () => {
    const f = await family('renew');
    await dial(f.admin.id, A.slots[2].slotId); // the subscriber's own dial, a different stop from Tom's
    const done = await checkout(f.admin.uid, [dialItem(0), dialItem(0, f.tomAcc.id), dialItem(0, f.ella.userId)], { frequencyWeeks: 4 });
    const subId = (await db.query(`SELECT subscription_id FROM "order" WHERE id = $1`, [done.orderId])).rows[0].subscription_id;
    const s1 = await resolveSubscriptionShipment(subId);
    expect(s1.status).toBe('resolved');
    if (s1.status !== 'resolved') return;
    const by = (u: string | null) => s1.lines.find(l => l.intendedForUserId === u)!;
    expect(by(null)).toMatchObject({ slotId: A.slots[2].slotId, basis: 'dial' });
    expect(by(f.tomAcc.id)).toMatchObject({ slotId: A.slots[1].slotId, basis: 'dial' });
    expect(by(f.ella.userId)).toMatchObject({ slotId: A.slots[0].slotId, basis: 'signup_slot' });
    expect(s1.skipped).toEqual([]);

    // A bag for Kid (no quiz yet) is skipped; the other three ship.
    const kid = await hs.addMember(f.admin.id, 'Kid');
    const added = await addItem(subId, { intendedForUserId: kid.userId, weightOz: 12, quantity: 1 });
    const s2 = await resolveSubscriptionShipment(subId);
    expect(s2.status).toBe('resolved');
    if (s2.status === 'resolved') {
      expect(s2.lines).toHaveLength(3);
      expect(s2.skipped.map(u => u.reason)).toEqual(['Kid: no quiz yet']);
      expect(s2.bagCount).toBe(3);
    }
    // Ella leaves the box (removed): her bag is skipped by name.
    await removeItem(subId, added.itemId);
    await hs.removeMember(f.admin.id, f.ella.memberId);
    const s3 = await resolveSubscriptionShipment(subId);
    if (s3.status === 'resolved') expect(s3.skipped.map(u => u.reason)).toEqual(['Ella is no longer in the household box']);
    else throw new Error('expected resolved');

    // Nothing resolvable at all → today's unresolved path.
    const g = await family('renew2');
    const d2 = await checkout(g.admin.uid, [dialItem(0, g.ella.userId)], { frequencyWeeks: 4 });
    const sub2 = (await db.query(`SELECT subscription_id FROM "order" WHERE id = $1`, [d2.orderId])).rows[0].subscription_id;
    await hs.removeMember(g.admin.id, g.ella.memberId);
    expect((await resolveSubscriptionShipment(sub2)).status).toBe('unresolved');
  });

  it('addItem / removeItem: events, ended_at retires, reads filter it; the last bag stays', async () => {
    const f = await family('items');
    const done = await checkout(f.admin.uid, [dialItem(0)], { frequencyWeeks: 4 });
    const subId = (await db.query(`SELECT subscription_id FROM "order" WHERE id = $1`, [done.orderId])).rows[0].subscription_id;
    expect((await db.query(`SELECT household_id FROM subscription WHERE id = $1`, [subId])).rows[0].household_id).toBeNull();
    const a = await addItem(subId, { intendedForUserId: f.ella.userId, weightOz: 12, quantity: 1 });
    expect((await db.query(`SELECT household_id FROM subscription WHERE id = $1`, [subId])).rows[0].household_id).toBe(f.h.householdId);
    expect((await db.query(`SELECT bag_count FROM v_subscription_status WHERE subscription_id = $1`, [subId])).rows[0].bag_count).toBe('2');
    await expect(addItem(subId, { intendedForUserId: f.admin.id, weightOz: 12, quantity: 1 })).rejects.toMatchObject({ code: 'for_subscriber' });
    await expect(addItem(subId, { intendedForUserId: f.ella.userId, weightOz: 7, quantity: 1 })).rejects.toMatchObject({ code: 'invalid_weight' });
    expect(await removeItem(subId, a.itemId)).toMatchObject({ changed: true });
    expect(await removeItem(subId, a.itemId)).toMatchObject({ changed: false });
    expect((await db.query(`SELECT ended_at IS NOT NULL AS ended FROM subscription_item WHERE id = $1`, [a.itemId])).rows[0].ended).toBe(true);
    expect((await db.query(`SELECT bag_count, household_id FROM v_subscription_status WHERE subscription_id = $1`, [subId])).rows[0]).toEqual({ bag_count: '1', household_id: null });
    const own = (await db.query(`SELECT id FROM subscription_item WHERE subscription_id = $1 AND ended_at IS NULL`, [subId])).rows[0].id;
    await expect(removeItem(subId, own)).rejects.toMatchObject({ code: 'last_item' });
    const ev = (await db.query(`SELECT event_kind FROM subscription_event WHERE subscription_id = $1 ORDER BY id`, [subId])).rows.map(r => r.event_kind);
    expect(ev).toEqual(expect.arrayContaining(['item_added', 'item_removed']));
  });
});

describe('cancel on leave and the handover offer (D22)', () => {
  it('the subscriber leaves: 409 without confirm; with it the subscription is cancelled, Tom (sign-in) gets the offer, Ella does not; the perk applies once', async () => {
    const f = await family('leave');
    const done = await checkout(f.admin.uid, [dialItem(0), dialItem(0, f.tomAcc.id), dialItem(0, f.ella.userId)], { frequencyWeeks: 4 });
    const subId = (await db.query(`SELECT subscription_id FROM "order" WHERE id = $1`, [done.orderId])).rows[0].subscription_id;
    // Decision 3: the holder cannot be removed by another admin.
    await hs.transferAdmin(f.admin.id, f.tom.memberId);
    await expectErr(hs.removeMember(f.tomAcc.id, (await reads.mine(f.admin.id))!.me.memberId), 'holds_house_subscription');
    // A non-subscriber member leaving cancels nothing.
    const samAcc = await profile('leave-sam', 'Sam');
    const sam = await hs.addMember(f.tomAcc.id, 'Sam');
    await hs.accept(sam.token, samAcc.id);
    expect(await hs.leave(samAcc.id)).toEqual({ cancelledSubscriptionId: null, handoverOffers: 0 });

    await expectErr(hs.leave(f.admin.id), 'confirm_cancel');
    sent.length = 0;
    const res = await hs.leave(f.admin.id, { confirm: true });
    expect(res).toEqual({ cancelledSubscriptionId: subId, handoverOffers: 1 });
    expect((await db.query(`SELECT status FROM subscription WHERE id = $1`, [subId])).rows[0].status).toBe('canceled');
    expect(await kinds(f.h.householdId)).toEqual(expect.arrayContaining(['subscription_cancelled_on_leave', 'handover_offered', 'member_left']));
    expect(sent.filter(s => s.subject === 'Keep the household box coming').map(s => s.to)).toEqual([`${f.tomAcc.uid}@example.com`]);

    // Tom's quote: tier + 5 % once; signed out, no offer.
    const items = [dialItem(0), dialItem(1)];
    const q = await quoteCart(items, { frequencyWeeks: 4 }, f.tomAcc.uid);
    expect(q.subscription?.offer?.pct).toBe(5);
    expect(q.subscription?.discountPct).toBe(15);
    expect((await quoteCart(items, { frequencyWeeks: 4 }, null)).subscription?.offer).toBeUndefined();
    const t = await checkout(f.tomAcc.uid, items, { frequencyWeeks: 4 });
    expect(t.checkoutSession.handover_offer_event_id).not.toBeNull();
    expect(await kinds(f.h.householdId)).toContain('handover_redeemed');
    const again = await quoteCart(items, { frequencyWeeks: 4 }, f.tomAcc.uid);
    expect(again.subscription?.offer).toBeUndefined();
    expect(again.subscription?.discountPct).toBe(10);
  });

  it('an expired offer prices nothing; dissolve with the house subscription asks first, then cancels', async () => {
    const solo = await profile('dis-admin', 'Dis', true);
    const h = await hs.create(solo.id, `${RUN} dis`);
    await db.query(
      `INSERT INTO household_event (household_id, kind_id, source_id, detail)
       VALUES ($1, (SELECT id FROM household_event_kind WHERE code = 'handover_offered'), (SELECT id FROM household_event_source WHERE code = 'system'),
               jsonb_build_object('member_user_id', $2::text, 'expires_at', (now() - interval '1 day')::text))`, [h.householdId, solo.id]
    );
    expect((await quoteCart([dialItem(0)], { frequencyWeeks: 4 }, solo.uid)).subscription?.offer).toBeUndefined();
    const sub = (await db.query<{ id: string }>(`INSERT INTO subscription (user_id, household_id, status, kind, frequency_weeks) VALUES ($1, $2, 'active', 'paid', 4) RETURNING id`, [solo.id, h.householdId])).rows[0].id;
    await expectErr(hs.dissolve(solo.id), 'confirm_cancel');
    expect(await hs.dissolve(solo.id, { confirm: true })).toEqual({ cancelledSubscriptionId: sub, handoverOffers: 0 });
    expect((await db.query(`SELECT status FROM subscription WHERE id = $1`, [sub])).rows[0].status).toBe('canceled');
  });
});

describe('Build the house box (B7) and the numbers (D19)', () => {
  it('one line per in-box member with a quiz × the parameter; needsQuiz and ownPlanActive flags', async () => {
    const f = await family('box');
    const kid = await hs.addMember(f.admin.id, 'Kid');
    // Tom also runs his own plan (D30).
    await checkout(f.tomAcc.uid, [dialItem(0)], { frequencyWeeks: 4 });
    const box = await reads.houseBox(f.admin.id);
    const by = (name: string) => box!.members.find(m => m.firstName === name)!;
    expect(box!.members).toHaveLength(4);
    expect(by('Tom').line).toMatchObject({ archetype: A.code, dialSortOrder: A.slots[1].sortOrder, qty: 1, weightOz: 12, intendedForUserId: f.tomAcc.id });
    expect(by('Tom').ownPlanActive).toBe(true);
    expect(by('Ella').line?.intendedForUserId).toBe(f.ella.userId);
    expect(by('Kid')).toMatchObject({ needsQuiz: true, line: null });
    expect(kid.memberId).toBe(by('Kid').memberId);
  });

  it('v_household_numbers agrees with the base tables', async () => {
    const c = await db.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const v = (await c.query(`SELECT * FROM v_household_numbers`)).rows[0];
      const direct = (await c.query(
        `SELECT (SELECT COUNT(*)::int FROM household WHERE dissolved_at IS NULL) AS households,
                (SELECT COUNT(*)::int FROM quiz_session WHERE taken_by_user_id IS NOT NULL) AS proxy_quizzes,
                (SELECT COUNT(DISTINCT o.id)::int FROM "order" o JOIN order_line_item oli ON oli.order_id = o.id WHERE o.household_id IS NOT NULL) AS house_orders`
      )).rows[0];
      expect({ households: v.households, proxy_quizzes: v.proxy_quizzes, house_orders: v.house_orders }).toEqual(direct);
      expect(v.house_orders).toBeGreaterThan(0);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
