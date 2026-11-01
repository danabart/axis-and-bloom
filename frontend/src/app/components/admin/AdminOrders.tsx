import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';

// Commerce 3, C3 (2026-10-31) — /admin/orders: every order with its customer,
// filters and search, and a detail drawer (/admin/orders/:orderId opens it;
// the admin new-order email links there). The drawer shows the lines with the
// resolved roaster coffee (internal), ships-to, shipments, the order_event
// trail and Stripe Dashboard links, and the three actions: retry fulfillment,
// mark shipped (emails the customer), refund (full or partial). Options and
// labels come from /api/admin/commerce/lookups; nothing is typed in. A refund
// only asks Stripe: the order changes when Stripe confirms (charge.refunded).

interface Lookup { code: string; label: string }
interface Lookups {
  carriers: Array<Lookup & { has_tracking_link: boolean }>; refundReasons: Lookup[];
  paymentStatuses: Lookup[]; fulfillmentStatuses: Lookup[]; refundWindowDays: number;
}
interface OrderRow {
  orderId: string; paidAt: string; totalCents: number; bags: number; isSubscription: boolean;
  customer: { name: string | null; email: string | null };
  paymentLabel: string | null; fulfillmentStatus: string | null; fulfillmentLabel: string | null; amountRefundedCents: number; tracking: string | null;
}
interface OrderDetail {
  orderId: string; createdAt: string; paidAt: string | null;
  customer: { name: string | null; email: string | null };
  totals: { subtotalCents: number; shippingCents: number; taxCents: number; totalCents: number; refundedCents: number };
  status: { paymentStatus: string | null; fulfillmentStatus: string | null; fulfillmentLabel: string | null; paymentLabel: string | null; customerLabel: string | null };
  pastRefundWindow: boolean; isSubscription: boolean; subscriptionId: string | null;
  shipsTo: { street: string | null; city: string | null; state: string | null; postalCode: string | null; country: string | null };
  lines: Array<{ displayName: string | null; weightOz: number | null; quantity: number; unitPriceCents: number; roasterCoffee: string | null; roasterName: string | null; roasterSku: string | null }>;
  shipments: Array<{ id: string; carrier_label: string | null; tracking_number: string; status: string; shipped_at: string | null; roaster_name: string | null; tracking_url: string | null }>;
  events: Array<{ id: number; created_at: string; kind_label: string; note: string | null; source: string; amount_refunded_cents: number | null; refund_reason_label: string | null; stripe_ref: string | null }>;
  stripe: { paymentIntentId: string | null; paymentUrl: string | null; invoiceId: string | null; invoiceUrl: string | null; customerUrl: string | null };
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const input = 'border border-stone-300 rounded px-2 py-1 text-sm';
const btn = 'px-3 py-1.5 rounded text-sm font-normal text-white hover:opacity-80 disabled:opacity-40';
const RETRYABLE = ['needs_attention', 'awaiting_manual'];
// Mark shipped: anything paid and not closed (a second parcel on a shipped order too).
const SHIPPABLE = ['needs_attention', 'awaiting_manual', 'placed', 'shipped'];

export default function AdminOrders() {
  const { user } = useAuth();
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ paymentStatus: '', fulfillmentStatus: '', q: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const authed = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user!.getIdToken()}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
    return data;
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
      const data = await authed(`/api/admin/orders?${qs}`);
      setRows(data.orders); setTotal(data.total); setError('');
    } catch (err) { reportError('[AdminOrders/load]', err); setError(err instanceof Error ? err.message : 'Failed to load orders'); }
    finally { setLoading(false); }
  }, [authed, page, filters]);

  useEffect(() => { if (user) authed('/api/admin/commerce/lookups').then(setLookups).catch(err => reportError('[AdminOrders/lookups]', err)); }, [user, authed]);
  useEffect(() => { if (user) load(); }, [user, load]);

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-xl font-normal text-stone-800 mb-6">Orders</h1>
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <input className={`${input} w-72`} placeholder="Search email, name or order id" value={filters.q}
          onChange={e => { setPage(1); setFilters(f => ({ ...f, q: e.target.value })); }} data-testid="orders-search" />
        <select className={input} value={filters.paymentStatus} onChange={e => { setPage(1); setFilters(f => ({ ...f, paymentStatus: e.target.value })); }}>
          <option value="">Any payment</option>
          {lookups?.paymentStatuses.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
        <select className={input} value={filters.fulfillmentStatus} onChange={e => { setPage(1); setFilters(f => ({ ...f, fulfillmentStatus: e.target.value })); }}>
          <option value="">Any fulfillment</option>
          {lookups?.fulfillmentStatuses.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
        <span className="text-xs text-stone-500 ml-auto">{total} order{total === 1 ? '' : 's'}</span>
      </div>
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      <div className="border border-stone-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm" data-testid="orders-table">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2 font-normal">Paid</th><th className="text-left px-3 py-2 font-normal">Customer</th>
              <th className="text-right px-3 py-2 font-normal">Total</th><th className="text-left px-3 py-2 font-normal">Payment</th>
              <th className="text-left px-3 py-2 font-normal">Fulfillment</th><th className="text-left px-3 py-2 font-normal">Sub</th>
              <th className="text-left px-3 py-2 font-normal">Tracking</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.orderId} onClick={() => navigate(`/admin/orders/${r.orderId}`)}
                className={`border-t border-stone-100 cursor-pointer hover:bg-stone-50 ${r.orderId === orderId ? 'bg-amber-50' : ''}`}>
                <td className="px-3 py-2 text-stone-600 whitespace-nowrap">{when(r.paidAt)}</td>
                <td className="px-3 py-2"><div className="text-stone-800">{r.customer.name ?? '—'}</div><div className="text-xs text-stone-500">{r.customer.email ?? 'no email'}</div></td>
                <td className="px-3 py-2 text-right text-stone-800">{money(r.totalCents)}{r.amountRefundedCents > 0 && <div className="text-xs text-stone-500">−{money(r.amountRefundedCents)}</div>}</td>
                <td className="px-3 py-2 text-stone-600">{r.paymentLabel ?? '—'}</td>
                <td className="px-3 py-2 text-stone-600">{r.fulfillmentLabel ?? '—'}</td>
                <td className="px-3 py-2 text-stone-600">{r.isSubscription ? 'Yes' : ''}</td>
                <td className="px-3 py-2 text-xs text-stone-500">{r.tracking ?? ''}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-stone-400">No orders match.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex gap-3 mt-3 text-sm">
        <button className="text-stone-500 disabled:opacity-30" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Newer</button>
        <button className="text-stone-500 disabled:opacity-30" disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}>Older →</button>
      </div>

      {orderId && lookups && (
        <OrderDrawer orderId={orderId} lookups={lookups} authed={authed} onClose={() => navigate('/admin/orders')} onChanged={load} />
      )}
    </div>
  );
}

function OrderDrawer({ orderId, lookups, authed, onClose, onChanged }: {
  orderId: string; lookups: Lookups; authed: (path: string, init?: RequestInit) => Promise<any>; onClose: () => void; onChanged: () => void;
}) {
  const [o, setO] = useState<OrderDetail | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [carrier, setCarrier] = useState(lookups.carriers[0]?.code ?? '');
  const [tracking, setTracking] = useState('');
  const [refundFull, setRefundFull] = useState(true);
  const [refundDollars, setRefundDollars] = useState('');
  const [reason, setReason] = useState(lookups.refundReasons[0]?.code ?? '');
  const [confirmRefund, setConfirmRefund] = useState(false);

  const load = useCallback(() => authed(`/api/admin/orders/${orderId}`).then(d => { setO(d); setError(''); })
    .catch(err => setError(err instanceof Error ? err.message : 'Failed to load the order')), [authed, orderId]);
  useEffect(() => { setO(null); setMessage(null); setConfirmRefund(false); load(); }, [load]);

  async function run(label: string, path: string, body: object, ok: (d: any) => string) {
    setBusy(true); setMessage(null);
    try {
      const d = await authed(path, { method: 'POST', body: JSON.stringify(body) });
      setMessage(ok(d));
      await load(); onChanged();
    } catch (err) { setMessage(`${label} failed: ${err instanceof Error ? err.message : err}`); }
    finally { setBusy(false); }
  }

  const remaining = o ? o.totals.totalCents - o.totals.refundedCents : 0;
  const refundCents = refundFull ? remaining : Math.round(Number(refundDollars || 0) * 100);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={onClose}>
      <div className="w-full max-w-xl h-full overflow-y-auto bg-white shadow-xl p-6" onClick={e => e.stopPropagation()} data-testid="order-drawer">
        <div className="flex justify-between items-start mb-4">
          <div>
            <p className="text-xs text-stone-500">Order</p>
            <p className="font-mono text-xs text-stone-700 break-all">{orderId}</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-lg">×</button>
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        {!o && !error && <p className="text-stone-400 text-sm">Loading…</p>}
        {o && (
          <div className="flex flex-col gap-5 text-sm">
            <section>
              <p className="text-stone-800">{o.customer.name ?? '—'} · {o.customer.email ?? 'no email'}</p>
              <p className="text-stone-500 text-xs">Paid {when(o.paidAt)}{o.isSubscription ? ' · subscription' : ''}</p>
              <p className="mt-1 text-stone-700">{o.status.paymentLabel ?? '—'} · {o.status.fulfillmentLabel ?? '—'}</p>
            </section>

            <section>
              <p className="text-xs uppercase text-stone-400 mb-1">Lines (internal: roaster coffee)</p>
              {o.lines.map((l, i) => (
                <div key={i} className="py-1 border-b border-stone-100">
                  <div className="flex justify-between"><span>{l.quantity} × {l.displayName} {l.weightOz ? `· ${l.weightOz} oz` : ''}</span><span>{money(l.unitPriceCents * l.quantity)}</span></div>
                  <div className="text-xs text-stone-500">{l.roasterCoffee ?? '?'} ({l.roasterName ?? 'roaster unknown'}{l.roasterSku ? `, SKU ${l.roasterSku}` : ''})</div>
                </div>
              ))}
              <div className="text-xs text-stone-500 mt-1">
                Subtotal {money(o.totals.subtotalCents)} · shipping {money(o.totals.shippingCents)} · tax {money(o.totals.taxCents)} · <span className="text-stone-800">total {money(o.totals.totalCents)}</span>
                {o.totals.refundedCents > 0 && <> · refunded {money(o.totals.refundedCents)}</>}
              </div>
            </section>

            <section>
              <p className="text-xs uppercase text-stone-400 mb-1">Ships to</p>
              <p className="text-stone-700">{[o.shipsTo.street, [o.shipsTo.city, o.shipsTo.state, o.shipsTo.postalCode].filter(Boolean).join(' '), o.shipsTo.country].filter(Boolean).join(', ')}</p>
            </section>

            {o.shipments.length > 0 && (
              <section>
                <p className="text-xs uppercase text-stone-400 mb-1">Shipments</p>
                {o.shipments.map(sh => (
                  <p key={sh.id} className="text-stone-700">{sh.carrier_label} {sh.tracking_url ? <a className="underline" href={sh.tracking_url} target="_blank" rel="noreferrer">{sh.tracking_number}</a> : sh.tracking_number} · {sh.status} · {when(sh.shipped_at)}</p>
                ))}
              </section>
            )}

            <section>
              <p className="text-xs uppercase text-stone-400 mb-1">Stripe</p>
              <div className="flex flex-wrap gap-3 text-xs">
                {o.stripe.paymentUrl && <a className="underline text-stone-700" href={o.stripe.paymentUrl} target="_blank" rel="noreferrer">Payment {o.stripe.paymentIntentId}</a>}
                {o.stripe.invoiceUrl && <a className="underline text-stone-700" href={o.stripe.invoiceUrl} target="_blank" rel="noreferrer">Invoice {o.stripe.invoiceId}</a>}
                {o.stripe.customerUrl && <a className="underline text-stone-700" href={o.stripe.customerUrl} target="_blank" rel="noreferrer">Customer</a>}
              </div>
            </section>

            {message && <p className="text-sm bg-stone-50 border border-stone-200 rounded p-2" data-testid="order-message">{message}</p>}

            {/* ── actions ── */}
            {SHIPPABLE.includes(o.status.fulfillmentStatus ?? '') && o.status.paymentStatus !== 'refunded' && (
              <section className="flex flex-col gap-2">
                <p className="text-xs uppercase text-stone-400">Fulfillment</p>
                {RETRYABLE.includes(o.status.fulfillmentStatus ?? '') && <button className={`${btn} w-fit`} style={{ backgroundColor: '#78716c' }} disabled={busy} data-testid="order-retry"
                  onClick={() => run('Retry', `/api/admin/orders/${orderId}/fulfillment/retry`, {}, d => d.ok ? `Dispatched (${d.adapter}).${d.note ? ` ${d.note}` : ''}` : `Failed again: ${d.error}`)}>
                  Retry fulfillment
                </button>}
                <div className="flex flex-wrap gap-2 items-center mt-2">
                  <select className={input} value={carrier} onChange={e => setCarrier(e.target.value)} data-testid="order-carrier">
                    {lookups.carriers.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </select>
                  <input className={`${input} flex-1 min-w-40`} placeholder="Tracking number" value={tracking} onChange={e => setTracking(e.target.value)} data-testid="order-tracking" />
                  <button className={btn} style={{ backgroundColor: '#b05642' }} disabled={busy || !tracking.trim()} data-testid="order-mark-shipped"
                    onClick={() => run('Mark shipped', `/api/admin/orders/${orderId}/shipped`, { carrier, trackingNumber: tracking.trim() },
                      d => d.created ? `Marked shipped; shipping email ${d.emailStatus ?? 'not sent'}.` : 'Already marked shipped with this tracking number.')}>
                    Mark shipped
                  </button>
                </div>
              </section>
            )}

            {remaining > 0 && o.stripe.paymentIntentId && (
              <section className="flex flex-col gap-2 border-t border-stone-100 pt-4">
                <p className="text-xs uppercase text-stone-400">Refund</p>
                {o.pastRefundWindow && <p className="text-xs text-amber-700">Paid more than {lookups.refundWindowDays} days ago. You can still refund.</p>}
                <div className="flex flex-wrap gap-3 items-center">
                  <label className="flex items-center gap-1"><input type="radio" checked={refundFull} onChange={() => setRefundFull(true)} /> Full ({money(remaining)})</label>
                  <label className="flex items-center gap-1"><input type="radio" checked={!refundFull} onChange={() => setRefundFull(false)} data-testid="refund-partial" /> Partial $</label>
                  {!refundFull && <input className={`${input} w-24`} inputMode="decimal" value={refundDollars} onChange={e => setRefundDollars(e.target.value)} data-testid="refund-amount" />}
                  <select className={input} value={reason} onChange={e => setReason(e.target.value)} data-testid="refund-reason">
                    {lookups.refundReasons.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </select>
                </div>
                {!confirmRefund ? (
                  <button className={`${btn} w-fit`} style={{ backgroundColor: '#b05642' }} disabled={busy || refundCents <= 0 || refundCents > remaining}
                    onClick={() => setConfirmRefund(true)} data-testid="refund-start">Refund…</button>
                ) : (
                  <div className="flex flex-col gap-2 bg-amber-50 border border-amber-200 rounded p-3">
                    <p>Refund {money(refundCents)} to the customer's card{refundFull && RETRYABLE.includes(o.status.fulfillmentStatus ?? '') ? ' and cancel fulfillment when Stripe confirms' : ''}?</p>
                    <div className="flex gap-2">
                      <button className={btn} style={{ backgroundColor: '#b05642' }} disabled={busy} data-testid="refund-confirm"
                        onClick={() => run('Refund', `/api/admin/orders/${orderId}/refund`, { reason, ...(refundFull ? {} : { amountCents: refundCents }) },
                          d => `Refund ${d.refundId} ${d.status ?? 'requested'} for ${money(d.amountCents)}; the order updates when Stripe confirms.${d.warning ? ` ${d.warning}` : ''}`)
                          .then(() => { setConfirmRefund(false); setTimeout(load, 4000); })}>
                        Yes, refund {money(refundCents)}
                      </button>
                      <button className="text-sm text-stone-500" onClick={() => setConfirmRefund(false)}>Back</button>
                    </div>
                  </div>
                )}
              </section>
            )}

            <section className="border-t border-stone-100 pt-4">
              <p className="text-xs uppercase text-stone-400 mb-1">Events</p>
              {o.events.map(e => (
                <div key={e.id} className="text-xs text-stone-600 py-0.5">
                  <span className="text-stone-400">{when(e.created_at)}</span> · {e.kind_label}
                  {e.amount_refunded_cents != null && ` · ${money(e.amount_refunded_cents)} refunded so far`}
                  {e.refund_reason_label && ` · ${e.refund_reason_label}`}
                  {e.note && ` · ${e.note}`} <span className="text-stone-400">({e.source})</span>
                </div>
              ))}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
