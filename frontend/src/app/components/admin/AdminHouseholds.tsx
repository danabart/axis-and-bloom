import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';
import EvidenceParametersCard from './EvidenceParametersCard';

// Family Household 1, C4 (2026-11-07) — /admin/households (D17): every
// household with its admin and member count; a drawer with members, roles,
// join links and their state, and the event history; the household_parameter
// card (same component as Commerce). Reads /api/admin/household/*.

interface HouseholdRow {
  household_id: string; household_name: string | null; admin_first_name: string | null; pays_first_name: string | null;
  active_member_count: number; dissolved_at: string | null; created_at: string;
}
interface Detail {
  household: HouseholdRow;
  members: Array<{ member_id: string; first_name: string | null; status_label: string; role_codes: string[]; account_state: string; archetype_name: string | null; joined_at: string; ended_at: string | null }>;
  links: Array<{ invitation_id: string; member_first_name: string | null; status_code: string | null; status_label: string | null; created_at: string }>;
  events: Array<{ event_id: string; kind_label: string; source_label: string; actor_first_name: string | null; member_first_name: string | null; created_at: string }>;
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');

export default function AdminHouseholds() {
  const { user } = useAuth();
  const [rows, setRows] = useState<HouseholdRow[] | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');

  async function get<T>(path: string): Promise<T> {
    const r = await fetch(`/api/admin/household${path}`, { headers: { Authorization: `Bearer ${await user!.getIdToken()}` } });
    if (!r.ok) throw new Error(`${path} → ${r.status}`);
    return r.json();
  }

  useEffect(() => {
    if (!user) return;
    get<HouseholdRow[]>('/households').then(setRows).catch(err => { reportError('[AdminHouseholds/list]', err); setError('Could not load households.'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function open(id: string) {
    try { setDetail(await get<Detail>(`/households/${id}`)); }
    catch (err) { reportError('[AdminHouseholds/detail]', err); setError('Could not load that household.'); }
  }

  return (
    <div className="p-8 max-w-6xl flex flex-col gap-8">
      <h1 className="text-xl font-medium text-stone-800">Family Households</h1>
      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="bg-white border border-stone-200 rounded" data-testid="admin-households">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-stone-500 border-b border-stone-200">
            <tr><th className="p-3">Household</th><th className="p-3">Admin</th><th className="p-3">Pays</th><th className="p-3">Members</th><th className="p-3">Created</th><th className="p-3">State</th></tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr><td className="p-3 text-stone-400" colSpan={6}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="p-3 text-stone-400" colSpan={6}>No households yet.</td></tr>
            ) : rows.map(h => (
              <tr key={h.household_id} className="border-b border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => open(h.household_id)}>
                <td className="p-3 text-stone-800">{h.household_name}</td>
                <td className="p-3">{h.admin_first_name}</td>
                <td className="p-3">{h.pays_first_name}</td>
                <td className="p-3">{h.active_member_count}</td>
                <td className="p-3 text-stone-500">{fmt(h.created_at)}</td>
                <td className="p-3 text-stone-500">{h.dissolved_at ? `Closed ${fmt(h.dissolved_at)}` : 'Open'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="bg-white border border-stone-200 rounded p-5 flex flex-col gap-6" data-testid="admin-household-detail">
          <div className="flex justify-between items-baseline">
            <h2 className="text-lg text-stone-800">{detail.household.household_name}</h2>
            <button className="text-xs text-stone-500 hover:text-stone-800" onClick={() => setDetail(null)}>Close</button>
          </div>
          <section>
            <h3 className="text-xs uppercase tracking-wide text-stone-500 mb-2">Members</h3>
            {detail.members.map(m => (
              <p key={m.member_id} className="text-sm text-stone-700 py-1">
                <strong className="font-medium">{m.first_name}</strong> · {m.role_codes.join(', ')} · {m.account_state} · {m.archetype_name ?? 'no quiz'} · {m.status_label}
                <span className="text-stone-400"> · joined {fmt(m.joined_at)}{m.ended_at ? `, ended ${fmt(m.ended_at)}` : ''}</span>
              </p>
            ))}
          </section>
          <section>
            <h3 className="text-xs uppercase tracking-wide text-stone-500 mb-2">Join links</h3>
            {detail.links.length === 0 ? <p className="text-sm text-stone-400">None.</p> : detail.links.map(l => (
              <p key={l.invitation_id} className="text-sm text-stone-700 py-1">
                {l.member_first_name ?? '(legacy email invitation)'} · {l.status_label ?? l.status_code} <span className="text-stone-400">· {fmt(l.created_at)}</span>
              </p>
            ))}
          </section>
          <section>
            <h3 className="text-xs uppercase tracking-wide text-stone-500 mb-2">Events</h3>
            {detail.events.map(e => (
              <p key={e.event_id} className="text-sm text-stone-700 py-0.5">
                <span className="text-stone-400">{fmt(e.created_at)}</span> · {e.kind_label}
                {e.member_first_name ? ` · ${e.member_first_name}` : ''}{e.actor_first_name ? ` · by ${e.actor_first_name}` : ''} <span className="text-stone-400">({e.source_label})</span>
              </p>
            ))}
          </section>
        </div>
      )}

      <EvidenceParametersCard
        title="Household parameters"
        endpoint="/api/admin/household/parameters"
        intro="Family Household numbers: the member cap, the quiz-for-a-member switch, bags per member in the house box, and the handover discount and its window. A save writes a new row that supersedes the current one."
        footer="A change applies within a minute (the backend's read cache is 60 s)."
        testId="household-parameters"
      />
    </div>
  );
}
