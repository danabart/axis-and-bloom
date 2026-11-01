import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';
import { formatCalendarDate } from '../../lib/calendarDate';

// Commerce 3, C4 (2026-10-31) — /admin/subscriptions: every paid subscription
// with its customer, status, frequency, the real next date (past a pending
// skip or pause), what ships next (house names, dial-aware) and the last
// order; filter by status (options from /api/admin/commerce/lookups); Cancel
// with a confirm (subscriptionService.cancel, source admin: no further
// charges, an open renewal invoice voided). Same patterns as AdminCompanyGifts.

interface Lookup { code: string; label: string }
interface SubRow {
  subscriptionId: string; status: string; statusLabel: string;
  customer: { name: string | null; email: string | null };
  frequencyWeeks: number | null; bags: number; nextDeliveryDate: string | null;
  pausedUntil: string | null; skipNextUntil: string | null; canceledOn: string | null;
  failedAttempts: number; hasPaymentMethod: boolean; lastOrderId: string | null; lastOrderAt: string | null; nextCoffee: string[];
}

export default function AdminSubscriptions() {
  const { user } = useAuth();
  const [statuses, setStatuses] = useState<Lookup[]>([]);
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<SubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const authed = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user!.getIdToken()}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
    return data;
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await authed(`/api/admin/subscriptions${status ? `?status=${encodeURIComponent(status)}` : ''}`);
      setRows(data.subscriptions); setError('');
    } catch (err) { reportError('[AdminSubscriptions/load]', err); setError(err instanceof Error ? err.message : 'Failed to load subscriptions'); }
    finally { setLoading(false); }
  }, [authed, status]);

  useEffect(() => { if (user) authed('/api/admin/commerce/lookups').then(d => setStatuses(d.subscriptionStatuses)).catch(err => reportError('[AdminSubscriptions/lookups]', err)); }, [user, authed]);
  useEffect(() => { if (user) load(); }, [user, load]);

  async function cancel(id: string) {
    try {
      const r = await authed(`/api/admin/subscriptions/${id}/cancel`, { method: 'POST', body: '{}' });
      setMessage(r.changed ? 'Canceled. No further charges; the customer got the confirmation email.' : 'It was already ended.');
      await load();
    } catch (err) { setMessage(`Cancel failed: ${err instanceof Error ? err.message : err}`); }
    finally { setConfirmId(null); }
  }

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-xl font-normal text-stone-800 mb-6">Subscriptions</h1>
      <div className="flex gap-3 mb-4 items-center">
        <select className="border border-stone-300 rounded px-2 py-1 text-sm" value={status} onChange={e => setStatus(e.target.value)} data-testid="subscriptions-status">
          <option value="">Any status</option>
          {statuses.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
        <span className="text-xs text-stone-500 ml-auto">{rows.length} subscription{rows.length === 1 ? '' : 's'}</span>
      </div>
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      {message && <p className="text-sm bg-stone-50 border border-stone-200 rounded p-2 mb-4">{message}</p>}
      <div className="border border-stone-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm" data-testid="subscriptions-table">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2 font-normal">Customer</th><th className="text-left px-3 py-2 font-normal">Status</th>
              <th className="text-left px-3 py-2 font-normal">Every</th><th className="text-left px-3 py-2 font-normal">Next</th>
              <th className="text-left px-3 py-2 font-normal">Ships next</th><th className="text-left px-3 py-2 font-normal">Last order</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const ended = r.status === 'canceled' || r.status === 'lapsed';
              return (
                <tr key={r.subscriptionId} className="border-t border-stone-100 align-top">
                  <td className="px-3 py-2"><div className="text-stone-800">{r.customer.name ?? '—'}</div><div className="text-xs text-stone-500">{r.customer.email ?? 'no email'}</div></td>
                  <td className="px-3 py-2 text-stone-700">
                    {r.statusLabel}
                    {r.failedAttempts > 0 && !ended && <div className="text-xs text-amber-700">{r.failedAttempts} failed attempt{r.failedAttempts === 1 ? '' : 's'}</div>}
                    {!r.hasPaymentMethod && !ended && <div className="text-xs text-amber-700">no card on file</div>}
                    {r.canceledOn && <div className="text-xs text-stone-500">ended {formatCalendarDate(r.canceledOn)}</div>}
                  </td>
                  <td className="px-3 py-2 text-stone-600">{r.frequencyWeeks ? `${r.frequencyWeeks} wk` : '—'} · {r.bags} bag{r.bags === 1 ? '' : 's'}</td>
                  <td className="px-3 py-2 text-stone-600 whitespace-nowrap">
                    {r.nextDeliveryDate ? formatCalendarDate(r.nextDeliveryDate) : '—'}
                    {r.pausedUntil && <div className="text-xs text-stone-500">paused through {formatCalendarDate(r.pausedUntil)}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-stone-600">{r.nextCoffee.map((c, i) => <div key={i}>{c}</div>)}</td>
                  <td className="px-3 py-2 text-xs">{r.lastOrderId ? <Link className="underline text-stone-700" to={`/admin/orders/${r.lastOrderId}`}>{r.lastOrderAt ? new Date(r.lastOrderAt).toLocaleDateString() : 'open'}</Link> : '—'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {!ended && (confirmId === r.subscriptionId ? (
                      <span className="flex gap-2 justify-end">
                        <button className="px-2 py-1 rounded text-xs text-white" style={{ backgroundColor: '#b05642' }} onClick={() => cancel(r.subscriptionId)} data-testid="subscription-admin-cancel-confirm">Yes, cancel</button>
                        <button className="text-xs text-stone-500" onClick={() => setConfirmId(null)}>Keep</button>
                      </span>
                    ) : (
                      <button className="text-xs text-stone-500 hover:text-stone-800 underline" onClick={() => setConfirmId(r.subscriptionId)} data-testid="subscription-admin-cancel">Cancel</button>
                    ))}
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-stone-400">No subscriptions.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
