import { useEffect, useState } from 'react';
import { Link } from 'react-router';
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
  clientClosed: number;
  neverFinished: number;
}

interface ClientErrorSignatureRow {
  signature: string | null;
  count: number;
  lastSeen: string;
}

// Data catalog brief 2, Part D (2026-10-16) — the boot check's findings,
// report only (no mode: nothing here ever fails the boot).
interface DataCatalogCheckRow {
  id: number;
  name: string;
  pass: boolean;
  actual: string;
  objects: string[];
}

// Data catalog brief 3, Part D (2026-10-16) — lineage from lineage.json.
interface DataCatalogLineage {
  available: boolean;
  generatedAt: string | null;
  multiWriter: { table: string; modules: string[] }[];
  undeclared: { table: string; module: string; file: string; line: number }[];
  deadDoors: { table: string; module: string }[];
  deadCandidates: { table: string; static: boolean; observed: boolean }[];
  probes: number;
  statsReset: string | null;
}

interface DataCatalogData {
  ranAt?: string;
  counts?: { tables: number; views: number; columns: number; unverified: number };
  catalogMdStale?: boolean;
  checks?: DataCatalogCheckRow[];
  lineage?: DataCatalogLineage;
  error?: string;
}

const AMBER = '#b7791f';

// Cupping evidence brief 3, B3 (2026-10-18): v_evidence_coverage / _unmapped_words
// numbers and the evidenceIntegrity checks. Report only.
interface CuppingEvidenceData {
  summary?: {
    activeCoffees: number; coffeesWithTwoOrMoreSources: number; coffeesUnreconciled: number;
    placedWithoutCupping: number; assignmentsWithoutBasis: number; unmappedWords: number;
  };
  integrity?: { id: number; name: string; ok: boolean; count: number; sample: string[] }[];
  error?: string;
}

interface SystemHealthData {
  callTypes: CallTypeRow[];
  clientErrorSignatures: ClientErrorSignatureRow[];
  retention: { totalRows: number; oldestRowAt: string | null };
  dataCatalog?: DataCatalogData;
  cuppingEvidence?: CuppingEvidenceData;
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
  const totalClientClosed = data.callTypes.reduce((s, r) => s + r.clientClosed, 0);
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
          {totalClientClosed > 0 && (
            <div>
              <p className="text-2xl font-normal text-stone-800">{totalClientClosed.toLocaleString()}</p>
              <p className="text-xs text-stone-400">client closed (499, 7d)</p>
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
                  <th className="pb-2 pr-4 font-normal text-right">Failed (≥400, not 499)</th>
                  <th className="pb-2 pr-4 font-normal text-right">Client closed (499)</th>
                  <th className="pb-2 font-normal text-right">Never finished</th>
                </tr>
              </thead>
              <tbody>
                {data.callTypes.map(row => (
                  <tr key={row.callType} className="border-t border-stone-100">
                    <td className="py-2 pr-4 text-stone-700 font-mono">{row.callType}</td>
                    <td className="py-2 pr-4 text-right text-stone-600">{row.total.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-right" style={{ color: row.failed > 0 ? RUST : undefined }}>{row.failed.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-right text-stone-600">{row.clientClosed.toLocaleString()}</td>
                    <td className="py-2 text-right" style={{ color: row.neverFinished > 0 ? RUST : undefined }}>{row.neverFinished.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Cupping evidence (cupping evidence brief 3, B3) ── */}
      {data.cuppingEvidence && (
        <div className="mb-8">
          <p className={LABEL}>Cupping evidence</p>
          <Link to="/admin/roastery-portal" className={`${CARD} border-stone-200 block hover:bg-stone-50`}>
            {data.cuppingEvidence.error || !data.cuppingEvidence.summary ? (
              <p className="text-xs" style={{ color: RUST }}>{data.cuppingEvidence.error ?? 'No cupping evidence report'}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-8">
                  <div>
                    <p className="text-2xl font-normal text-stone-800">
                      {data.cuppingEvidence.summary.coffeesWithTwoOrMoreSources} / {data.cuppingEvidence.summary.activeCoffees}
                    </p>
                    <p className="text-xs text-stone-400">active coffees with evidence from 2+ sources</p>
                  </div>
                  <div>
                    <p className="text-2xl font-normal" style={{ color: data.cuppingEvidence.summary.coffeesUnreconciled ? AMBER : undefined }}>{data.cuppingEvidence.summary.coffeesUnreconciled}</p>
                    <p className="text-xs text-stone-400">with a flag to reconcile</p>
                  </div>
                  <div>
                    <p className="text-2xl font-normal" style={{ color: data.cuppingEvidence.summary.placedWithoutCupping ? RUST : undefined }}>{data.cuppingEvidence.summary.placedWithoutCupping}</p>
                    <p className="text-xs text-stone-400">placed, never cupped</p>
                  </div>
                  <div>
                    <p className="text-2xl font-normal" style={{ color: data.cuppingEvidence.summary.assignmentsWithoutBasis ? AMBER : undefined }}>{data.cuppingEvidence.summary.assignmentsWithoutBasis}</p>
                    <p className="text-xs text-stone-400">assignments without a basis line</p>
                  </div>
                  <div>
                    <p className="text-2xl font-normal text-stone-800">{data.cuppingEvidence.summary.unmappedWords}</p>
                    <p className="text-xs text-stone-400">unmapped words</p>
                  </div>
                </div>
                <div className="mt-3 text-xs text-stone-500">
                  {(data.cuppingEvidence.integrity ?? []).filter(c => !c.ok).length === 0
                    ? 'Evidence integrity: all checks pass.'
                    : (data.cuppingEvidence.integrity ?? []).filter(c => !c.ok).map(c => (
                      <p key={c.id}><span style={{ color: AMBER }}>#{c.id}</span> {c.name}: {c.count}{c.sample.length ? ` (e.g. ${c.sample.slice(0, 3).join('; ')})` : ''}</p>
                    ))}
                </div>
                <p className="mt-2 text-xs text-stone-400">Report only. Open Roastery Feedback, then a roastery's Calibration.</p>
              </>
            )}
          </Link>
        </div>
      )}

      {/* ── Data catalog ── */}
      {data.dataCatalog && (
        <div className="mb-8">
          <p className={LABEL}>Data catalog</p>
          <div className={`${CARD} border-stone-200`}>
            {data.dataCatalog.error || !data.dataCatalog.counts || !data.dataCatalog.checks ? (
              <p className="text-xs" style={{ color: RUST }}>{data.dataCatalog.error ?? 'No data catalog report'}</p>
            ) : (
              <>
                <div className="flex items-center gap-8 mb-4">
                  <div>
                    <p className="text-2xl font-normal text-stone-800">{data.dataCatalog.counts.tables}</p>
                    <p className="text-xs text-stone-400">tables</p>
                  </div>
                  <div>
                    <p className="text-2xl font-normal text-stone-800">{data.dataCatalog.counts.views}</p>
                    <p className="text-xs text-stone-400">views</p>
                  </div>
                  <div>
                    <p className="text-2xl font-normal text-stone-800">{data.dataCatalog.counts.columns.toLocaleString()}</p>
                    <p className="text-xs text-stone-400">table columns</p>
                  </div>
                  <div>
                    <p className="text-2xl font-normal" style={{ color: data.dataCatalog.counts.unverified > 0 ? RUST : undefined }}>{data.dataCatalog.counts.unverified}</p>
                    <p className="text-xs text-stone-400">UNVERIFIED</p>
                  </div>
                  <span className="ml-auto text-xs border border-stone-200 rounded px-2 py-0.5 text-stone-500">report only</span>
                </div>
                <div className="space-y-2">
                  {data.dataCatalog.checks.map(check => (
                    <div key={check.id} className="text-xs border-b border-stone-100 last:border-b-0 pb-2 last:pb-0">
                      {check.objects.length > 0 ? (
                        <details>
                          <summary className="cursor-pointer flex items-center justify-between">
                            <span className="text-stone-700">#{check.id} {check.name}</span>
                            <span className="whitespace-nowrap ml-4" style={{ color: check.pass ? undefined : RUST }}>{check.actual}</span>
                          </summary>
                          <p className="mt-2 text-stone-500 font-mono break-words">{check.objects.join(', ')}</p>
                        </details>
                      ) : (
                        <div className="flex items-center justify-between">
                          <span className="text-stone-700">#{check.id} {check.name}</span>
                          <span className="text-stone-400 whitespace-nowrap ml-4">{check.actual}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {data.dataCatalog.lineage && (
                  <div className="mt-4 pt-3 border-t border-stone-100 space-y-2 text-xs">
                    {!data.dataCatalog.lineage.available ? (
                      <p className="text-stone-400">Lineage: lineage.json is not on this image.</p>
                    ) : (
                      <>
                        <details>
                          <summary className="cursor-pointer flex items-center justify-between">
                            <span className="text-stone-700">Tables with more than one writer (declared, candidates to consolidate)</span>
                            <span className="whitespace-nowrap ml-4" style={{ color: RUST }}>{data.dataCatalog.lineage.multiWriter.length}</span>
                          </summary>
                          <div className="mt-2 space-y-1 font-mono text-stone-500">
                            {data.dataCatalog.lineage.multiWriter.map(m => (
                              <p key={m.table} style={{ color: RUST }}>{m.table}: {m.modules.join(', ')}</p>
                            ))}
                          </div>
                        </details>
                        <details>
                          <summary className="cursor-pointer flex items-center justify-between">
                            <span className="text-stone-700">Declared writers with no code (dead doors)</span>
                            <span className="whitespace-nowrap ml-4" style={{ color: data.dataCatalog.lineage.deadDoors.length ? AMBER : undefined }}>{data.dataCatalog.lineage.deadDoors.length}</span>
                          </summary>
                          <div className="mt-2 space-y-1 font-mono" style={{ color: AMBER }}>
                            {data.dataCatalog.lineage.deadDoors.map(d => <p key={`${d.table}:${d.module}`}>{d.table}: {d.module}</p>)}
                          </div>
                        </details>
                        <details>
                          <summary className="cursor-pointer flex items-center justify-between">
                            <span className="text-stone-700">Dead table candidates</span>
                            <span className="text-stone-400 whitespace-nowrap ml-4">{data.dataCatalog.lineage.deadCandidates.length}</span>
                          </summary>
                          <div className="mt-2 space-y-1 font-mono text-stone-400">
                            {data.dataCatalog.lineage.deadCandidates.map(d => (
                              <p key={d.table}>{d.table} ({[d.static ? 'no reader in code' : null, d.observed ? 'untouched 30+ days' : null].filter(Boolean).join(', ')})</p>
                            ))}
                          </div>
                        </details>
                        <p className="text-stone-400">
                          Table activity since {data.dataCatalog.lineage.statsReset ? new Date(data.dataCatalog.lineage.statsReset).toLocaleDateString() : '—'} (stats_reset)
                          {' · '}lineage scanned {data.dataCatalog.lineage.generatedAt ? daysAgo(data.dataCatalog.lineage.generatedAt) : '—'}
                          {data.dataCatalog.lineage.probes > 0 && ` · ${data.dataCatalog.lineage.probes} probe marker(s)`}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

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
