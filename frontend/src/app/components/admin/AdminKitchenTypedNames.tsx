// Usual Drink 4 (2026-11-26, C1/C2) — the typed kitchen names on the admin
// brew-profile block, most common first (names already matching an entry left
// out), with the promote form: the entry's label, its kind or its brand (a
// product), from the stats payload (getBrewProfileFieldCounts). Promote: POST
// /api/admin/brew-profile/kitchen/promote; retire: POST
// /api/admin/brew-profile/kitchen/:code/retire (brewKitchenList, the one writer).
// A new entry reaches the autocomplete at the next field-list refresh.
import { useState } from 'react';
import type { User } from 'firebase/auth';
import { reportError } from '../../lib/errorReporter';

export interface KitchenAdminData {
  typedKitchenNames: Array<{ words: string; customers: number }>;
  kitchenKinds: Array<{ code: string; label: string }>;
  kitchenEntries: Array<{ code: string; label: string; parentCode: string | null; isActive: boolean; fixed: boolean }>;
}

const CARD = 'bg-white rounded-xl border p-4';
const INPUT = 'border border-stone-300 rounded px-2 py-1 text-sm';

async function post(user: User, path: string, body?: unknown) {
  const res = await fetch(`/api/admin/brew-profile/kitchen/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

function PromoteRow({ words, customers, data, user, onDone }: { words: string; customers: number; data: KitchenAdminData; user: User; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(words);
  const [kind, setKind] = useState(data.kitchenKinds[0]?.code ?? '');
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const brands = data.kitchenEntries.filter(e => e.isActive && !e.fixed && !e.parentCode);
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const r = await post(user, 'promote', { typed: words, label, kindCode: parent ? null : kind, parentCode: parent || null });
      onDone(r.created ? `Added "${label}" (${r.code})` : `"${words}" is already ${r.code}`);
    } catch (e) {
      reportError('[AdminKitchenTypedNames/promote]', e);
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  };
  return (
    <li className="py-1" data-testid="typed-name">
      <div className="flex justify-between gap-3">
        <span>{words}</span>
        <span className="flex items-center gap-3">
          <span className="tabular-nums text-stone-500" data-testid="typed-name-count">{customers}</span>
          <button type="button" className="text-xs underline text-stone-600" onClick={() => setOpen(o => !o)} data-testid="typed-name-open">Add to the list</button>
        </span>
      </div>
      {open && (
        <div className="flex flex-wrap items-center gap-2 mt-2" data-testid="promote-form">
          <input className={INPUT} value={label} onChange={e => setLabel(e.target.value)} aria-label="Label" data-testid="promote-label" />
          <select className={INPUT} value={parent} onChange={e => setParent(e.target.value)} aria-label="Brand (for a product)" data-testid="promote-parent">
            <option value="">A brand of its own</option>
            {brands.map(b => <option key={b.code} value={b.code}>Product of {b.label}</option>)}
          </select>
          {!parent && (
            <select className={INPUT} value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind" data-testid="promote-kind">
              {data.kitchenKinds.map(k => <option key={k.code} value={k.code}>{k.label}</option>)}
            </select>
          )}
          <button type="button" disabled={busy || !label.trim()} onClick={submit} className="text-sm px-3 py-1 rounded bg-stone-800 text-white disabled:opacity-50" data-testid="promote-submit">Add</button>
          {err && <span className="text-xs text-red-600">{err}</span>}
        </div>
      )}
    </li>
  );
}

export default function AdminKitchenTypedNames({ data, user, onChanged }: { data: KitchenAdminData; user: User; onChanged: () => void }) {
  const [msg, setMsg] = useState('');
  const [retireCode, setRetireCode] = useState('');
  const retirable = data.kitchenEntries.filter(e => e.isActive && !e.fixed);
  const done = (m: string) => { setMsg(`${m}. It reaches the autocomplete at the next field-list refresh.`); onChanged(); };
  const retire = async () => {
    if (!retireCode) return;
    try {
      const r = await post(user, `${encodeURIComponent(retireCode)}/retire`);
      done(r.retired ? `Retired ${retireCode}` : `${retireCode} was already retired`);
      setRetireCode('');
    } catch (e) {
      reportError('[AdminKitchenTypedNames/retire]', e);
      setMsg(e instanceof Error ? e.message : 'Failed');
    }
  };
  return (
    <div className={`${CARD} border-stone-200`} data-testid="typed-kitchen-names">
      <p className="text-sm font-medium text-stone-700 mb-2">Kitchen names customers typed, most common first</p>
      {data.typedKitchenNames.length === 0 ? <p className="text-xs text-stone-400">None yet</p> : (
        <ul className="text-sm text-stone-700 divide-y divide-stone-100">
          {data.typedKitchenNames.map(t => <PromoteRow key={t.words} words={t.words} customers={t.customers} data={data} user={user} onDone={done} />)}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-stone-100">
        <select className={INPUT} value={retireCode} onChange={e => setRetireCode(e.target.value)} aria-label="Entry to retire" data-testid="retire-entry">
          <option value="">Retire an entry…</option>
          {retirable.map(e => <option key={e.code} value={e.code}>{e.label}</option>)}
        </select>
        <button type="button" disabled={!retireCode} onClick={retire} className="text-sm px-3 py-1 rounded border border-stone-300 disabled:opacity-50" data-testid="retire-submit">Retire</button>
      </div>
      {msg && <p className="text-xs text-stone-600 mt-2" data-testid="kitchen-msg">{msg}</p>}
    </div>
  );
}
