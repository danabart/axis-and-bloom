// Usual Drink 1 (2026-11-12), Part D — the brew-profile fields row on the Liam
// flow page: per field, customers with a value, declines and the card's
// coverage (set / (set + declined) over quiz rows); the drinks by drink and by
// base method, the kitchen by brand and by kind, the feelings, the card's
// funnel events and the newest "other" answers with the customer's words. One
// read: GET /api/admin/brew-profile/stats (customerReads.getBrewProfileFieldCounts).
// Below it, the brew_parameter card (the field-list refresh interval and the
// card's words), written through brewParameters.setParameter.
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';
import EvidenceParametersCard from './EvidenceParametersCard';

interface Stats {
  fields: Array<{ field: string; customersWithValue: number; declinedRows: number; declinedCustomers: number; quizSet: number; quizDeclined: number; coverage: number | null }>;
  drinks: Array<{ code: string; label: string; customers: number }>;
  baseMethods: Array<{ code: string; customers: number }>;
  brands: Array<{ code: string; label: string; customers: number }>;
  brandKinds: Array<{ code: string; customers: number }>;
  feelings: Array<{ code: string; label: string; moveCode: string; customers: number }>;
  otherWords: Array<{ field: string; words: string; occurredAt: string; source: string }>;
  cardEvents: Array<{ event: string; n: number }>;
}

const LABEL = 'text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2';
const CARD = 'bg-white rounded-xl border p-4';

function Dist({ title, rows, testId }: { title: string; rows: Array<{ key: string; label: string; n: number }>; testId: string }) {
  return (
    <div className={`${CARD} border-stone-200`} data-testid={testId}>
      <p className="text-sm font-medium text-stone-700 mb-2">{title}</p>
      {rows.length === 0 ? <p className="text-xs text-stone-400">No answers yet</p> : (
        <ul className="text-sm text-stone-700 space-y-0.5">
          {rows.map(r => <li key={r.key} className="flex justify-between gap-3"><span>{r.label}</span><span className="tabular-nums text-stone-500">{r.n}</span></li>)}
        </ul>
      )}
    </div>
  );
}

export default function AdminBrewProfileStats() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await fetch('/api/admin/brew-profile/stats', { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setStats(await res.json());
      } catch (err) {
        reportError('[AdminBrewProfileStats/load]', err);
        setError('Failed to load the brew-profile fields');
      }
    })();
  }, [user]);

  return (
    <div className="flex flex-col gap-4" data-testid="brew-profile-fields">
      <p className={LABEL}>Brew Profile Fields</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {stats && (
        <>
          <div className={`${CARD} border-stone-200 overflow-x-auto`}>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-stone-500 text-xs">
                <th className="py-1 font-normal">Field</th><th className="py-1 font-normal">Customers with a value</th>
                <th className="py-1 font-normal">Declined (rows / customers)</th><th className="py-1 font-normal">Card coverage</th>
              </tr></thead>
              <tbody>
                {stats.fields.map(f => (
                  <tr key={f.field} className="border-t border-stone-100">
                    <td className="py-1 font-mono text-xs">{f.field}</td>
                    <td className="py-1 tabular-nums">{f.customersWithValue}</td>
                    <td className="py-1 tabular-nums">{f.declinedRows} / {f.declinedCustomers}</td>
                    <td className="py-1 tabular-nums">{f.coverage === null ? '—' : `${Math.round(f.coverage * 100)}% (${f.quizSet} of ${f.quizSet + f.quizDeclined})`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Dist title="Drinks" testId="dist-drinks" rows={stats.drinks.map(r => ({ key: r.code, label: r.label, n: r.customers }))} />
            <Dist title="Drinks by base method" testId="dist-methods" rows={stats.baseMethods.map(r => ({ key: r.code, label: r.code, n: r.customers }))} />
            <Dist title="Feeling about their coffee" testId="dist-feelings" rows={stats.feelings.map(r => ({ key: r.code, label: `${r.label} (${r.moveCode})`, n: r.customers }))} />
            <Dist title="Kitchen brand" testId="dist-brands" rows={stats.brands.map(r => ({ key: r.code, label: r.label, n: r.customers }))} />
            <Dist title="Kitchen by brand kind" testId="dist-kinds" rows={stats.brandKinds.map(r => ({ key: r.code, label: r.code, n: r.customers }))} />
            <Dist title="Card events" testId="dist-card" rows={stats.cardEvents.map(r => ({ key: r.event, label: r.event, n: r.n }))} />
          </div>
          <div className={`${CARD} border-stone-200`} data-testid="other-words">
            <p className="text-sm font-medium text-stone-700 mb-2">"Something else" answers, newest first</p>
            {stats.otherWords.length === 0 ? <p className="text-xs text-stone-400">None yet</p> : (
              <ul className="text-sm text-stone-700 space-y-0.5">
                {stats.otherWords.map((w, i) => (
                  <li key={i}><span className="font-mono text-xs text-stone-500">{w.field}</span> · {w.words} <span className="text-xs text-stone-400">({w.source}, {new Date(w.occurredAt).toLocaleDateString()})</span></li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      <EvidenceParametersCard
        title="Brew-profile parameters"
        endpoint="/api/admin/brew-profile/parameters"
        intro="How often each server re-reads the brew-profile field list, and the words on the quiz post-result card. A save writes a new row that supersedes the current one."
        footer="A field-list interval change applies at each server's next refresh; the card's words on the next page load."
        testId="brew-parameters"
      />
    </div>
  );
}
