import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';

// Observability Foundation Part E — read-only. No configuration controls of
// any kind here by policy (see OBSERVABILITY_POLICY.md) — alert thresholds
// and routing live in GCP Cloud Logging, not this portal. Reuses the
// AdminAIOps card visual pattern (RUST/CARD/LABEL, fetch-on-mount, a manual
// Refresh button) rather than inventing a new one.

interface CallTypeRow {
  callType: string;
  total: number;
  failed: number;
  neverFinished: number;
}

interface ClientErrorSignatureRow {
  signature: string | null;
  count: number;
  lastSeen: string;
}

interface SystemHealthData {
  callTypes: CallTypeRow[];
  clientErrorSignatures: ClientErrorSignatureRow[];
  retention: { totalRows: number; oldestRowAt: string | null };
}

const RUST = '#b05642';
const CARD = 'border rounded-lg p-4 bg-white';
const LABEL = 'text-xs text-stone-400 tracking-widest uppercase mb-1';

function daysAgo(iso: string | null): string {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function AdminSystemHealth() {
  const { user } = useAuth();
  const [data, setData] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function getToken() { return user!.getIdToken(); }

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/system-health', { headers: { Authorization: `Bearer ${await getToken()}` } });
      if (!res.ok) throw new Error();
      setData((await res.json()) as SystemHealthData);
    } catch (err) {
      reportError('[AdminSystemHealth/load]', err);
      setError('Failed to load system health data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  if (loading) return <div className="text-stone-400 text-sm">Loading…</div>;
  if (!data) return <div className="text-red-500 text-sm">{error || 'Failed to load'}</div>;

  const totalFailed = data.callTypes.reduce((s, r) => s + r.failed, 0);
  const totalNeverFinished = data.callTypes.reduce((s, r) => s + r.neverFinished, 0);

  return (
    <div className="pb-16 max-w-4xl">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-xl font-normal text-stone-800">System Health</h1>
          <p className="text-sm text-stone-400">Last 7 days, from the api_event capture-first log. Read-only — no controls live here by design.</p>
        </div>
        <button onClick={loadData} className="px-4 py-2 text-sm border border-stone-200 rounded text-stone-600 hover:bg-stone-50">
          Refresh
        </button>
      </div>
      <p className="text-xs text-stone-400 mb-6">
        Alerting itself lives in Cloud Logging (severity-based, see OBSERVABILITY_POLICY.md) — this page is the weekly-review surface for WARNING-level signal, not a live paging tool.
      </p>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {/* ── Retention ── */}
      <div className="mb-8">
        <p className={LABEL}>Retention</p>
        <div className={`${CARD} border-stone-300 flex items-center gap-8`}>
          <div>
            <p className="text-2xl font-normal text-stone-800">{data.retention.totalRows.toLocaleString()}</p>
            <p className="text-xs text-stone-400">total rows</p>
          </div>
          <div>
            <p className="text-2xl font-normal text-stone-800">{daysAgo(data.retention.oldestRowAt)}</p>
            <p className="text-xs text-stone-400">oldest row (90-day retention)</p>
          </div>
          {totalFailed > 0 && (
            <div>
              <p className="text-2xl font-normal" style={{ color: RUST }}>{totalFailed.toLocaleString()}</p>
              <p className="text-xs text-stone-400">failed requests (7d)</p>
            </div>
          )}
          {totalNeverFinished > 0 && (
            <div>
              <p className="text-2xl font-normal" style={{ color: RUST }}>{totalNeverFinished.toLocaleString()}</p>
              <p className="text-xs text-stone-400">never finished (7d)</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Call types ── */}
      <div className="mb-8">
        <p className={LABEL}>API Event Counts by Call Type</p>
        <div className={`${CARD} border-stone-200 overflow-x-auto`}>
          {data.callTypes.length === 0 ? (
            <p className="text-xs text-stone-400">No mutating API calls captured in the last 7 days.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-stone-400 uppercase tracking-widest">
                  <th className="pb-2 pr-4 font-normal">Call type</th>
                  <th className="pb-2 pr-4 font-normal text-right">Total</th>
                  <th className="pb-2 pr-4 font-normal text-right">Failed (≥400)</th>
                  <th className="pb-2 font-normal text-right">Never finished</th>
                </tr>
              </thead>
              <tbody>
                {data.callTypes.map(row => (
                  <tr key={row.callType} className="border-t border-stone-100">
                    <td className="py-2 pr-4 text-stone-700 font-mono">{row.callType}</td>
                    <td className="py-2 pr-4 text-right text-stone-600">{row.total.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-right" style={{ color: row.failed > 0 ? RUST : undefined }}>{row.failed.toLocaleString()}</td>
                    <td className="py-2 text-right" style={{ color: row.neverFinished > 0 ? RUST : undefined }}>{row.neverFinished.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Client-error signatures ── */}
      <div>
        <p className={LABEL}>Top Client-Error Signatures</p>
        <div className={`${CARD} border-stone-200`}>
          {data.clientErrorSignatures.length === 0 ? (
            <p className="text-xs text-stone-400">No client errors reported in the last 7 days.</p>
          ) : (
            <div className="space-y-2">
              {data.clientErrorSignatures.map((row, i) => (
                <div key={i} className="flex items-center justify-between text-xs border-b border-stone-100 last:border-b-0 pb-2 last:pb-0">
                  <span className="text-stone-700 font-mono truncate mr-4">{row.signature ?? '(no signature)'}</span>
                  <span className="text-stone-400 whitespace-nowrap">{row.count}× · last {daysAgo(row.lastSeen)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
