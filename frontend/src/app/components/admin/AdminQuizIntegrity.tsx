import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

// Quiz Content Drift Prevention — a card on the admin dashboard for
// GET /api/admin/quiz/integrity. Reuses AdminAIOps.tsx's card conventions
// (RUST/CARD/LABEL, fetch-on-mount, a manual re-run button) rather than
// inventing a new card system. Read-only display — this page never writes
// anything; repair is the re-asserting seed's job on deploy.

interface QuizIntegrityCheck {
  id: number;
  name: string;
  pass: boolean;
  expected: string;
  actual: string;
  details?: string[];
}

interface QuizIntegrityReport {
  ranAt: string;
  allPass: boolean;
  checks: QuizIntegrityCheck[];
}

const RUST = '#b05642';
const CARD = 'border rounded-lg p-4 bg-white';
const LABEL = 'text-xs text-stone-400 tracking-widest uppercase mb-1';

export default function AdminQuizIntegrity() {
  const { user } = useAuth();
  const [report, setReport] = useState<QuizIntegrityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadReport() {
    setLoading(true);
    setError('');
    try {
      const token = await user!.getIdToken();
      const res = await fetch('/api/admin/quiz/integrity', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error();
      setReport((await res.json()) as QuizIntegrityReport);
    } catch {
      setError('Failed to load quiz integrity report');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadReport(); }, []);

  const passCount = report ? report.checks.filter(c => c.pass).length : 0;
  const totalCount = report ? report.checks.length : 0;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <p className={LABEL}>Quiz Content Integrity</p>
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
              {report.checks.map((check) => (
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
          </>
        ) : null}
      </div>
    </div>
  );
}
