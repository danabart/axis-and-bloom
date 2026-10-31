// Commerce 1, Part D (2026-10-31) — finalizePaidOrder: every side effect of
// the old POST /api/orders runs once per order (the finalized order_event is
// the idempotency key), a throwing step never stops the next, and Liam's
// order-placed line is stored as the finalized event's note. Every step's
// module is mocked: this file proves the orchestration only. The fulfillment
// failure path (payment stays paid, needs_attention) is fulfillment.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const finalized = new Set<string>();
const events: any[] = [];
const summary = {
  orderId: 'order-1', userId: 'profile-1', firebaseUid: 'uid-1', createdAt: '2026-10-31T10:00:00Z', paidAt: '2026-10-31T10:00:05Z',
  lines: [{ blendId: 'sku-1', coffeeId: 42, displayName: 'Petal Hour', weightOz: 12, quantity: 1, unitPriceCents: 1800 }],
};
vi.mock('../db/client.js', () => ({
  withTransaction: async (fn: (tx: unknown) => unknown) => fn({ query: async () => ({ rows: [] }) }),
}));
vi.mock('./checkoutService.js', () => ({
  isFinalized: async (id: string) => finalized.has(id),
  getOrderSummary: async () => summary,
  recordOrderEvent: async (e: any) => { events.push(e); if (e.kind === 'finalized') finalized.add(e.orderId); return events.length; },
}));
const steps = {
  grantTokens: vi.fn(async () => 20),
  updateOrderOutcomes: vi.fn(async () => undefined),
  refreshLifecycleState: vi.fn(async () => null),
  dispatchOrderPlacedBeat: vi.fn(async () => 'Petal Hour is on its way to the roaster.'),
  dispatchDelayedBeats: vi.fn(async () => ({})),
  getBrewProfile: vi.fn(async () => null),
  dispatchFulfillment: vi.fn(async () => ({ ok: true })),
  sendOrderConfirmationEmail: vi.fn(async () => ({ status: 'sent' })),
};
vi.mock('./sommelierConfig.js', () => ({ getSommelierConfig: () => ({ tokenEconomy: { orderBonus: 15 } }) }));
vi.mock('./tokenService.js', () => ({ grantTokens: (...a: unknown[]) => steps.grantTokens(...(a as [])) }));
vi.mock('./outcomeTracker.js', () => ({ updateOrderOutcomes: (...a: unknown[]) => steps.updateOrderOutcomes(...(a as [])) }));
vi.mock('./userLifecycle.js', () => ({ refreshLifecycleState: (...a: unknown[]) => steps.refreshLifecycleState(...(a as [])) }));
vi.mock('./beatEngine.js', () => ({
  dispatchOrderPlacedBeat: (...a: unknown[]) => steps.dispatchOrderPlacedBeat(...(a as [])),
  dispatchDelayedBeats: (...a: unknown[]) => steps.dispatchDelayedBeats(...(a as [])),
}));
vi.mock('../routes/sommelier.js', () => ({ getBrewProfile: (...a: unknown[]) => steps.getBrewProfile(...(a as [])) }));
vi.mock('./fulfillment/index.js', () => ({ dispatchFulfillment: (...a: unknown[]) => steps.dispatchFulfillment(...(a as [])) }));
vi.mock('./orderEmails.js', () => ({ sendOrderConfirmationEmail: (...a: unknown[]) => steps.sendOrderConfirmationEmail(...(a as [])) }));

const { finalizePaidOrder } = await import('./orderFinalizer.js');

beforeEach(() => {
  finalized.clear(); events.length = 0;
  for (const fn of Object.values(steps)) fn.mockClear();
});

describe('finalizePaidOrder', () => {
  it('runs every side effect of the old POST once, with the ids they always took', async () => {
    const r = await finalizePaidOrder('order-1');
    expect(r).toMatchObject({ alreadyFinalized: false, failedSteps: [], orderPlacedLine: 'Petal Hour is on its way to the roaster.' });
    expect(steps.dispatchOrderPlacedBeat).toHaveBeenCalledWith('profile-1', 'order-1', 42);
    expect(steps.grantTokens).toHaveBeenCalledWith('uid-1', 15, 'order_bonus', 'order-1');
    expect(steps.updateOrderOutcomes).toHaveBeenCalledWith('uid-1', new Date('2026-10-31T10:00:05Z'));
    expect(steps.dispatchDelayedBeats).toHaveBeenCalledWith({ userId: 'profile-1', orderId: 'order-1', coffeeId: 42, brewProfile: null });
    expect(steps.refreshLifecycleState).toHaveBeenCalledWith('uid-1');
    expect(steps.dispatchFulfillment).toHaveBeenCalledWith('order-1');
    expect(steps.sendOrderConfirmationEmail).toHaveBeenCalledWith('order-1');
    expect(events).toEqual([{ orderId: 'order-1', kind: 'finalized', note: 'Petal Hour is on its way to the roaster.', source: 'finalizer' }]);
  });

  it('a second call has no side effects at all', async () => {
    await finalizePaidOrder('order-1');
    for (const fn of Object.values(steps)) fn.mockClear();
    const again = await finalizePaidOrder('order-1');
    expect(again.alreadyFinalized).toBe(true);
    for (const [name, fn] of Object.entries(steps)) expect(fn, name).not.toHaveBeenCalled();
    expect(events.filter(e => e.kind === 'finalized')).toHaveLength(1);
  });

  it('a throwing step does not stop the next ones', async () => {
    steps.grantTokens.mockRejectedValueOnce(new Error('tokens down'));
    steps.dispatchFulfillment.mockRejectedValueOnce(new Error('adapter down'));
    const r = await finalizePaidOrder('order-1');
    expect(r.failedSteps).toEqual(['order_bonus_tokens', 'fulfillment']);
    expect(steps.updateOrderOutcomes).toHaveBeenCalled();
    expect(steps.dispatchDelayedBeats).toHaveBeenCalled();
    expect(steps.refreshLifecycleState).toHaveBeenCalled();
    expect(steps.sendOrderConfirmationEmail).toHaveBeenCalled();
  });

  it('a failed order-placed line still finalizes (note null, the page falls back)', async () => {
    steps.dispatchOrderPlacedBeat.mockRejectedValueOnce(new Error('haiku down'));
    const r = await finalizePaidOrder('order-1');
    expect(r.orderPlacedLine).toBeNull();
    expect(events[0]).toMatchObject({ kind: 'finalized', note: null });
  });
});
