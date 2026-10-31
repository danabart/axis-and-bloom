// Commerce 1, Part D (2026-10-31) — dispatchFulfillment: a paid order is never
// lost. The manual adapter's success is a fulfillment_dispatched event
// (awaiting_manual); its failure is a fulfillment_failed event, the order goes
// to needs_attention and Dana gets the attention email, and nothing ever
// touches the payment status. checkoutService / orderEmails / db are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const events: any[] = [];
const order = { orderId: 'order-9', fulfillmentRoasterId: null, lines: [] };
vi.mock('../checkoutService.js', () => ({
  getOrderSummary: async () => order,
  recordOrderEvent: async (e: any) => { events.push(e); return events.length; },
}));
const newOrderEmail = vi.fn(async () => ({ status: 'sent', id: 'resend-1' }));
const attentionEmail = vi.fn(async () => ({ status: 'sent', id: 'resend-2' }));
vi.mock('../orderEmails.js', () => ({
  sendAdminNewOrderEmail: (...a: unknown[]) => newOrderEmail(...(a as [])),
  sendAdminFulfillmentAttentionEmail: (...a: unknown[]) => attentionEmail(...(a as [])),
}));
vi.mock('../../db/client.js', () => ({
  db: { query: async () => ({ rows: [{ n: String(events.filter(e => e.kind === 'fulfillment_failed').length) }] }) },
}));

const { dispatchFulfillment, adapterFor } = await import('./index.js');

beforeEach(() => { events.length = 0; newOrderEmail.mockClear(); attentionEmail.mockClear(); });

describe('dispatchFulfillment', () => {
  it('NULL roaster and any roaster both use the manual adapter until roaster adapters exist', () => {
    expect(adapterFor(order as any).name).toBe('manual');
    expect(adapterFor({ ...order, fulfillmentRoasterId: 'roaster-uuid' } as any).name).toBe('manual');
  });

  it('manual success: the admin email is sent and the order is dispatched (awaiting_manual)', async () => {
    const r = await dispatchFulfillment('order-9');
    expect(r).toMatchObject({ ok: true, adapter: 'manual' });
    expect(newOrderEmail).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ orderId: 'order-9', kind: 'fulfillment_dispatched', fulfillmentStatus: 'awaiting_manual', note: 'manual: resend-1', source: 'finalizer' }]);
  });

  it('a failure keeps the payment untouched, counts the attempt, sets needs_attention and alerts', async () => {
    newOrderEmail.mockResolvedValue({ status: 'failed', id: null } as any);
    const first = await dispatchFulfillment('order-9');
    const second = await dispatchFulfillment('order-9');
    expect(first).toMatchObject({ ok: false, attempts: 1 });
    expect(second).toMatchObject({ ok: false, attempts: 2 });
    expect(events.map(e => e.kind)).toEqual(['fulfillment_failed', 'fulfillment_needs_attention', 'fulfillment_failed', 'fulfillment_needs_attention']);
    expect(events.filter(e => e.kind === 'fulfillment_needs_attention').every(e => e.fulfillmentStatus === 'needs_attention')).toBe(true);
    expect(events.some(e => e.paymentStatus !== undefined)).toBe(false); // payment stays paid: no event touches it
    expect(attentionEmail).toHaveBeenCalledWith('order-9', 'admin new-order email could not be sent', 1);
    newOrderEmail.mockResolvedValue({ status: 'sent', id: 'resend-1' });
  });
});
