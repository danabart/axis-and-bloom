import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';

// Catalog Blueprint · brief 1 — a card on the admin dashboard for
// GET /api/admin/catalog/integrity. Cloned from AdminQuizIntegrity.tsx (same
// fetch pattern, same pass/fail rendering); 'info' severity checks render in
// a neutral style with their details expanded, since they are never a
// failure (D1: some divergence is legitimate) — see catalogIntegrity.ts.
// Read-only display — this page never writes anything.

interface CatalogIntegrityCheck {
  id: number;
  name: string;
  pass: boolean;
  expected: string;
  actual: string;
  details?: string[];
  severity?: 'info' | 'fail';
}

interface CatalogIntegrityReport {
  ranAt: string;
  allPass: boolean;
  checks: CatalogIntegrityCheck[];
}

// Catalog Blueprint brief 4, Part C — two new diagnostic panels under the
// checks: GET /catalog/not-sellable and GET /catalog/changes.
interface NotSellableRow {
  slot_id: number; archetype: string; sort_order: number; slot_name: string | null;
  coffee_id: number; coffee_name: string;
  reasons: Array<'no_active_12oz_sku' | 'no_price_12oz' | 'coffee_inactive' | 'category_excluded'>;
}
interface ChangeRow {
  at: string; actor: string | null; verb: string; method: string; path: string;
  status: number | null; coffee_id: number | null; slot_id: number | null; error: unknown;
}
const REASON_TEXT: Record<NotSellableRow['reasons'][number], string> = {
  no_active_12oz_sku: 'no active 12oz SKU', no_price_12oz: 'no price at 12oz',
  coffee_inactive: 'coffee inactive', category_excluded: 'category excluded',
};

const RUST = '#b05642';
const NEUTRAL = '#8a8378';
const CARD = 'border rounded-lg p-4 bg-white';
const LABEL = 'text-xs text-stone-400 tracking-widest uppercase mb-1';

export default function AdminCatalogIntegrity() {
  const { user } = useAuth();
  const [report, setReport] = useState<CatalogIntegrityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [notSellable, setNotSellable] = useState<NotSellableRow[]>([]);
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [changesCoffeeId, setChangesCoffeeId] = useState('');

  async function loadReport() {
    setLoading(true);
    setError('');
    try {
      const token = await user!.getIdToken();
      const res = await fetch('/api/admin/catalog/integrity', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error();
      setReport((await res.json()) as CatalogIntegrityReport);
    } catch (err) {
      reportError('[AdminCatalogIntegrity/load]', err);
      setError('Failed to load catalog integrity report');
    } finally {
      setLoading(false);
    }
  }

  async function loadNotSellable() {
    try {
      const token = await user!.getIdToken();
      const res = await fetch('/api/admin/catalog/not-sellable', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error();
      setNotSellable(await res.json());
    } catch (err) { reportError('[AdminCatalogIntegrity/not-sellable]', err); }
  }

  async function loadChanges() {
    try {
      const token = await user!.getIdToken();
      const qs = changesCoffeeId ? `?coffee_id=${changesCoffeeId}&limit=50` : '?limit=50';
      const res = await fetch(`/api/admin/catalog/changes${qs}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error();
      setChanges(await res.json());
    } catch (err) { reportError('[AdminCatalogIntegrity/changes]', err); }
  }

  useEffect(() => { loadReport(); loadNotSellable(); loadChanges(); }, []);
  useEffect(() => { loadChanges(); }, [changesCoffeeId]);

  const failChecks = report ? report.checks.filter(c => (c.severity ?? 'fail') === 'fail') : [];
  const passCount = failChecks.filter(c => c.pass).length;
  const totalCount = failChecks.length;
  const infoChecks = report ? report.checks.filter(c => c.severity === 'info') : [];

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <p className={LABEL}>Catalog Integrity</p>
        <button onClick={loadReport} disabled={loading} className="text-xs text-stone-400 hover:text-stone-600 disabled:opacity-50">
          {loading ? 'Checking…' : 'Re-run'}
        </button>
      </div>
      <div className={`${CARD} ${report && !report.allPass ? '' : 'border-stone-200'}`} style={report && !report.allPass ? { borderColor: RUST } : undefined}>
        {loading && !report ? (
          <p className="text-sm text-stone-400">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-500">{error}</p>
        ) : report ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-stone-700">
                {passCount} of {totalCount} checks passing
              </p>
              <p className="text-xs text-stone-400">
                Last run {new Date(report.ranAt).toLocaleString()}
              </p>
            </div>
            <div className="space-y-2">
              {failChecks.map((check) => (
                <div key={check.id} className="text-xs border-b border-stone-100 last:border-b-0 pb-2 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-stone-600">
                      <span className={check.pass ? 'text-green-600' : ''} style={!check.pass ? { color: RUST } : undefined}>
                        {check.pass ? '✓' : '✗'}
                      </span>
                      {' '}{check.name}
                    </span>
                  </div>
                  {!check.pass && (
                    <div className="mt-1 ml-4 text-stone-500">
                      <p>Expected: {check.expected}</p>
                      <p>Actual: {check.actual}</p>
                      {check.details && check.details.length > 0 && (
                        <ul className="list-disc list-inside mt-1">
                          {check.details.map((d, i) => <li key={i}>{d}</li>)}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {infoChecks.length > 0 && (
              <div className="mt-4 pt-3 border-t border-stone-100 space-y-2">
                <p className={LABEL}>Informational</p>
                {infoChecks.map((check) => (
                  <div key={check.id} className="text-xs pb-2 last:pb-0" style={{ color: NEUTRAL }}>
                    <p>{check.name}</p>
                    <p className="mt-1 ml-4">Actual: {check.actual}</p>
                    {check.details && check.details.length > 0 && (
                      <ul className="list-disc list-inside mt-1 ml-4">
                        {check.details.map((d, i) => <li key={i}>{d}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* Catalog Blueprint brief 4, Part C — placed-not-sellable panel */}
      <div className="mt-4">
        <p className={LABEL}>Placed, not yet sellable</p>
        <div className={`${CARD} border-stone-200`}>
          {notSellable.length === 0 ? (
            <p className="text-sm text-stone-400">Every placed slot is sellable at 12oz.</p>
          ) : (
            <div className="space-y-1.5">
              {notSellable.map((row) => (
                <div key={row.slot_id} className="text-xs flex items-center justify-between gap-3 border-b border-stone-50 last:border-b-0 pb-1.5 last:pb-0">
                  <span className="text-stone-600">
                    <Link to={`/admin/coffees?q=${encodeURIComponent(row.coffee_name)}`} className="underline hover:text-stone-800">
                      {row.coffee_name}
                    </Link>
                    {' '}on {row.archetype} · slot {row.sort_order}
                    {row.slot_name ? ` (${row.slot_name})` : ''}
                  </span>
                  <span className="text-stone-400 shrink-0">{row.reasons.map(r => REASON_TEXT[r]).join(', ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Catalog Blueprint brief 4, Part C — catalog changes feed */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-1">
          <p className={LABEL}>Catalog changes</p>
          <input
            type="number" value={changesCoffeeId} onChange={e => setChangesCoffeeId(e.target.value)}
            placeholder="Filter by coffee id"
            className="text-xs border border-stone-200 rounded px-2 py-1 w-40"
          />
        </div>
        <div className={`${CARD} border-stone-200`}>
          {changes.length === 0 ? (
            <p className="text-sm text-stone-400">No catalog writes yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {changes.map((c, i) => (
                <div key={i} className="text-xs flex items-start justify-between gap-3 border-b border-stone-50 last:border-b-0 pb-1.5 last:pb-0">
                  <span className="text-stone-600">
                    <span className="text-stone-400">{new Date(c.at).toLocaleString()}</span>
                    {' · '}{c.actor ?? 'unknown'}{' · '}{c.verb}
                    {c.coffee_id != null && ` · coffee #${c.coffee_id}`}
                    {c.slot_id != null && ` · slot #${c.slot_id}`}
                  </span>
                  <span className={c.status && c.status >= 400 ? 'shrink-0' : 'text-green-600 shrink-0'} style={c.status && c.status >= 400 ? { color: RUST } : undefined}>
                    {c.status ?? '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
