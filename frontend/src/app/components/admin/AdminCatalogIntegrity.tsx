import { useEffect, useState } from 'react';
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

const RUST = '#b05642';
const NEUTRAL = '#8a8378';
const CARD = 'border rounded-lg p-4 bg-white';
const LABEL = 'text-xs text-stone-400 tracking-widest uppercase mb-1';

export default function AdminCatalogIntegrity() {
  const { user } = useAuth();
  const [report, setReport] = useState<CatalogIntegrityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  useEffect(() => { loadReport(); }, []);

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
    </div>
  );
}
