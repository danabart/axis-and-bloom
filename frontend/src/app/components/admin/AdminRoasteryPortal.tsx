import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { reportError } from '../../lib/errorReporter';
import LookupSelect from './LookupSelect';
import { useArchetypes } from './useArchetypes';

// Roastery Portal (2026-10-05) — admin page, "Roastery Feedback". Create and
// revoke the private link each partner roastery gets, manage its lineup, watch
// progress, read what they submitted. Read-only on answers by design: there is
// no accept, promote or edit-on-behalf action here (part 2, after the first
// real submissions exist). Brief:
// backend/src/features/roastery_portal/CLAUDE_CODE_PROMPT_ROASTERY_PORTAL_1.md

interface Option { value: string; label: string }
interface Vocabulary {
  process: Option[]; roastLevel: Option[]; blendOrSingle: Option[]; brewMethods: Option[];
  availability: Option[]; notice: Option[]; similar: Option[]; takesIt: Option[];
  dimensions: { dimensionId: number; label: string; lowLabel: string; highLabel: string }[];
}
interface RoasterySummary {
  roasterId: string; name: string; isActive: boolean; activeLinkCount: number; lastLinkOpenedAt: string | null;
  coffeesTotal: number; coffeesSubmitted: number; lastActivityAt: string | null;
}
interface LinkRow {
  id: string; token: string; contactName: string | null; contactEmail: string | null;
  createdAt: string; lastOpenedAt: string | null; revokedAt: string | null;
}
interface LineupRow {
  portalCoffeeId: string; name: string; coffeeId: number | null; origin: string | null; processValues: string[];
  roastLevel: string | null; blendOrSingle: string | null; isDecaf: boolean | null; prefillSource: string | null;
  addedBy: string; isActive: boolean; state: 'not_started' | 'in_progress' | 'submitted'; hasOpenDraft: boolean;
  sectionsAnswered: number; lastSavedAt: string | null; lastSavedByName: string | null; submittedAt: string | null;
  submittedByName: string | null; submittedVersionCount: number; hasUnmappedNotes: boolean;
}
interface LineupResponse {
  id: string; version: number; status: string; typicalNotice: string | null; similarWhenOut: string | null;
  lastSavedByName: string | null; submittedByName: string | null; updatedAt: string; submittedAt: string | null;
}
interface RoasteryDetail {
  roaster: { id: string; name: string; isActive: boolean };
  links: LinkRow[]; lineup: LineupRow[]; lineupResponse: LineupResponse | null; lineupVersions: LineupResponse[];
  catalogCoffees: { id: number; name: string; isActive: boolean }[];
}
interface ResponseView {
  id: string; version: number; status: 'draft' | 'submitted'; origin: string | null; processValues: string[];
  roastLevel: string | null; blendOrSingle: string | null; isDecaf: boolean | null; proposedArchetype: string | null;
  dominantDimensionId: number | null; takesIt: string | null; brewNotes: string | null; availability: string | null;
  typicalNotice: string | null; expectedAvailability: string | null; similarWhenOut: string | null;
  closestCousinPortalCoffeeId: string | null; whatChanges: string | null; anythingElse: string | null;
  lastSavedByName: string | null; submittedByName: string | null; updatedAt: string; submittedAt: string | null;
  notes: { rank: number; roasterWords: string; cuppingNoteId: string | null; descriptor: string | null; wheelCategory: string | null }[];
  dimensions: Record<string, number>; bestBrew: string | null; alsoGoodBrews: string[];
}
interface VersionSummary { id: string; version: number; status: string; submittedAt: string | null; submittedByName: string | null; updatedAt: string }

const ACCENT = '#a33726';
const INPUT = 'border border-stone-200 rounded px-2 py-1.5 text-sm w-full bg-transparent';
const BTN = 'px-3 py-1.5 rounded text-xs uppercase tracking-wide border border-stone-300 text-stone-600 hover:bg-stone-50 disabled:opacity-40';
const BTN_PRIMARY = 'px-4 py-2 rounded text-sm disabled:opacity-50 text-[#f2f1ea]';

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
const labelOf = (opts: Option[] | undefined, value: string | null) => (value ? opts?.find(o => o.value === value)?.label ?? value : '—');

export default function AdminRoasteryPortal() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const roasterId = params.get('roastery');
  const coffeeId = params.get('coffee');

  const apiFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const token = await user!.getIdToken();
    return fetch(url, {
      cache: 'no-store', ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) },
    });
  }, [user]);

  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  useEffect(() => {
    if (!user) return;
    (async () => {
      try { setVocab(await (await apiFetch('/api/admin/roastery-portal/vocabulary')).json()); }
      catch (err) { reportError('[AdminRoasteryPortal/vocabulary]', err); }
    })();
  }, [user, apiFetch]);

  const go = (next: { roastery?: string | null; coffee?: string | null }) => {
    const p = new URLSearchParams();
    if (next.roastery) p.set('roastery', next.roastery);
    if (next.coffee) p.set('coffee', next.coffee);
    setParams(p);
  };

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-xl mb-1">Roastery Feedback</h1>
      <p className="text-sm text-stone-500 mb-6">
        The private page each partner roastery fills in to describe its own coffees. What they submit lands here as evidence; nothing reaches the catalog from this page.
      </p>
      {!roasterId && <RoasteryList apiFetch={apiFetch} onOpen={id => go({ roastery: id })} />}
      {roasterId && !coffeeId && vocab && (
        <RoasteryDetailView key={roasterId} roasterId={roasterId} apiFetch={apiFetch} vocab={vocab}
          onBack={() => go({})} onOpenCoffee={id => go({ roastery: roasterId, coffee: id })} />
      )}
      {roasterId && coffeeId && vocab && (
        <CoffeeResponsePanel key={coffeeId} roasterId={roasterId} coffeeId={coffeeId} apiFetch={apiFetch} vocab={vocab}
          onBack={() => go({ roastery: roasterId })} />
      )}
    </div>
  );
}

// ── Roastery list ───────────────────────────────────────────────────────────
function RoasteryList({ apiFetch, onOpen }: { apiFetch: (u: string, o?: RequestInit) => Promise<Response>; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<RoasterySummary[] | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/admin/roastery-portal/roasteries${showInactive ? '?includeInactive=1' : ''}`);
        if (!res.ok) throw new Error('Failed to load roasteries');
        const data = await res.json();
        if (!cancelled) setRows(data);
      } catch (err) { reportError('[AdminRoasteryPortal/list]', err); if (!cancelled) setError('Failed to load roasteries'); }
    })();
    return () => { cancelled = true; };
  }, [apiFetch, showInactive]);

  return (
    <>
      <label className="flex items-center gap-2 text-sm text-stone-600 mb-4">
        <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
        Show inactive roasteries
      </label>
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      {!rows ? <p className="text-sm text-stone-400">Loading…</p> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
              <th className="py-2 pr-4 font-normal">Roastery</th>
              <th className="py-2 pr-4 font-normal">Link</th>
              <th className="py-2 pr-4 font-normal">Coffees submitted</th>
              <th className="py-2 pr-4 font-normal">Last activity</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.roasterId} className="border-b border-stone-100">
                <td className="py-3 pr-4">{r.name}{!r.isActive && <span className="ml-2 text-xs text-stone-400">inactive</span>}</td>
                <td className="py-3 pr-4 text-stone-600">
                  {r.activeLinkCount > 0 ? `Active${r.lastLinkOpenedAt ? `, opened ${fmt(r.lastLinkOpenedAt)}` : ', not opened yet'}` : 'No active link'}
                </td>
                <td className="py-3 pr-4 text-stone-600">{r.coffeesSubmitted} of {r.coffeesTotal}</td>
                <td className="py-3 pr-4 text-stone-600">{fmt(r.lastActivityAt)}</td>
                <td className="py-3 text-right"><button className={BTN} onClick={() => onOpen(r.roasterId)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

// ── One roastery: links, lineup, progress, lineup answers ───────────────────
function RoasteryDetailView({ roasterId, apiFetch, vocab, onBack, onOpenCoffee }: {
  roasterId: string; apiFetch: (u: string, o?: RequestInit) => Promise<Response>; vocab: Vocabulary;
  onBack: () => void; onOpenCoffee: (id: string) => void;
}) {
  const [data, setData] = useState<RoasteryDetail | null>(null);
  const [error, setError] = useState('');
  const base = `/api/admin/roastery-portal/roasteries/${roasterId}`;

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(base);
      if (!res.ok) throw new Error('Failed to load roastery');
      setData(await res.json());
    } catch (err) { reportError('[AdminRoasteryPortal/detail]', err); setError('Failed to load roastery'); }
  }, [apiFetch, base]);
  useEffect(() => { void load(); }, [load]);

  async function post(path: string, body?: unknown, method = 'POST'): Promise<boolean> {
    setError('');
    try {
      const res = await apiFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Request failed');
      await load();
      return true;
    } catch (err) {
      reportError('[AdminRoasteryPortal/action]', err);
      setError(err instanceof Error ? err.message : 'Request failed');
      return false;
    }
  }

  if (!data) return <p className="text-sm text-stone-400">{error || 'Loading…'}</p>;
  const { roaster, links, lineup, lineupResponse, catalogCoffees } = data;
  const activeLineup = lineup.filter(c => c.isActive);

  return (
    <div className="space-y-10">
      <div>
        <button className="text-xs uppercase tracking-wide text-stone-500 mb-2" onClick={onBack}>← All roasteries</button>
        <h2 className="text-lg">{roaster.name}{!roaster.isActive && <span className="ml-2 text-xs text-stone-400">inactive</span>}</h2>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <LinksPanel links={links} onCreate={(contactName, contactEmail) => post(`${base}/links`, { contactName, contactEmail })}
        onRevoke={id => post(`/api/admin/roastery-portal/links/${id}/revoke`)} />

      <LineupAnswers response={lineupResponse} vocab={vocab} versions={data.lineupVersions} />

      <section>
        <h3 className="text-sm uppercase tracking-[0.15em] text-stone-500 mb-3">Progress</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
              <th className="py-2 pr-4 font-normal">Coffee</th>
              <th className="py-2 pr-4 font-normal">State</th>
              <th className="py-2 pr-4 font-normal">Last saved</th>
              <th className="py-2 pr-4 font-normal">Submitted</th>
              <th className="py-2 pr-4 font-normal">Versions</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {activeLineup.map(c => (
              <tr key={c.portalCoffeeId} className="border-b border-stone-100 align-top">
                <td className="py-3 pr-4">{c.name}</td>
                <td className="py-3 pr-4 text-stone-600">
                  {c.state === 'submitted' ? 'Submitted' : c.state === 'in_progress' ? `In progress, ${c.sectionsAnswered} of 6` : 'Not started'}
                  {c.hasOpenDraft && c.state === 'submitted' && <span className="ml-1 text-stone-400">(edit in progress)</span>}
                  {c.hasUnmappedNotes && <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#a337261a', color: ACCENT }}>needs mapping</span>}
                </td>
                <td className="py-3 pr-4 text-stone-600">{c.lastSavedAt ? `${fmt(c.lastSavedAt)}${c.lastSavedByName ? `, ${c.lastSavedByName}` : ''}` : '—'}</td>
                <td className="py-3 pr-4 text-stone-600">{c.submittedAt ? `${fmt(c.submittedAt)}${c.submittedByName ? `, ${c.submittedByName}` : ''}` : '—'}</td>
                <td className="py-3 pr-4 text-stone-600">{c.submittedVersionCount}</td>
                <td className="py-3 text-right">
                  {c.state !== 'not_started' && <button className={BTN} onClick={() => onOpenCoffee(c.portalCoffeeId)}>Read answers</button>}
                </td>
              </tr>
            ))}
            {activeLineup.length === 0 && <tr><td colSpan={6} className="py-4 text-stone-400">No coffees in this lineup yet.</td></tr>}
          </tbody>
        </table>
      </section>

      <LineupEditor lineup={lineup} catalogCoffees={catalogCoffees} vocab={vocab} base={base} post={post} />
    </div>
  );
}

// ── Links ───────────────────────────────────────────────────────────────────
function LinksPanel({ links, onCreate, onRevoke }: {
  links: LinkRow[]; onCreate: (name: string, email: string) => Promise<boolean>; onRevoke: (id: string) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const urlFor = (token: string) => `${window.location.origin}/roastery/${token}`;

  function copy(id: string, url: string) {
    navigator.clipboard.writeText(url).then(() => { setCopied(id); setTimeout(() => setCopied(null), 1500); });
  }

  return (
    <section>
      <h3 className="text-sm uppercase tracking-[0.15em] text-stone-500 mb-3">Links</h3>
      <form className="flex flex-wrap items-end gap-3 mb-4" onSubmit={async e => {
        e.preventDefault();
        if (await onCreate(name, email)) { setName(''); setEmail(''); }
      }}>
        <label className="text-xs text-stone-500">Contact name (optional)
          <input className={`${INPUT} mt-1 w-56`} value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label className="text-xs text-stone-500">Contact email (optional)
          <input className={`${INPUT} mt-1 w-64`} type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <button type="submit" className={BTN_PRIMARY} style={{ backgroundColor: ACCENT }}>Create link</button>
      </form>
      {links.length === 0 ? <p className="text-sm text-stone-400">No link yet.</p> : (
        <ul className="space-y-3">
          {links.map(l => (
            <li key={l.id} className="border border-stone-200 rounded p-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`text-xs uppercase tracking-wide ${l.revokedAt ? 'text-stone-400' : ''}`} style={l.revokedAt ? undefined : { color: ACCENT }}>
                  {l.revokedAt ? `Revoked ${fmt(l.revokedAt)}` : 'Active'}
                </span>
                <span className="text-stone-500">
                  {l.contactName || l.contactEmail ? `For ${[l.contactName, l.contactEmail].filter(Boolean).join(', ')}. ` : ''}
                  Created {fmt(l.createdAt)}. {l.lastOpenedAt ? `Last opened ${fmt(l.lastOpenedAt)}.` : 'Not opened yet.'}
                </span>
              </div>
              {!l.revokedAt && (
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  <span className="font-mono text-xs text-stone-700 break-all">{urlFor(l.token)}</span>
                  <button className={BTN} onClick={() => copy(l.id, urlFor(l.token))}>{copied === l.id ? 'Copied' : 'Copy link'}</button>
                  <button className={BTN} onClick={() => { if (window.confirm('Revoke this link? The page stops working for whoever has it.')) void onRevoke(l.id); }}>Revoke</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Lineup answers (asked once per roastery) ────────────────────────────────
function LineupAnswers({ response, versions, vocab }: { response: LineupResponse | null; versions: LineupResponse[]; vocab: Vocabulary }) {
  return (
    <section>
      <h3 className="text-sm uppercase tracking-[0.15em] text-stone-500 mb-3">Answers about the whole lineup</h3>
      {!response ? <p className="text-sm text-stone-400">Not answered yet.</p> : (
        <div className="text-sm text-stone-700 space-y-1">
          <p>Typical notice before a coffee becomes unavailable: <b className="font-normal">{labelOf(vocab.notice, response.typicalNotice)}</b></p>
          <p>When one runs out, a similar profile: <b className="font-normal">{labelOf(vocab.similar, response.similarWhenOut)}</b></p>
          <p className="text-xs text-stone-400">
            Version {response.version}, {response.status === 'submitted' ? `submitted ${fmt(response.submittedAt)}${response.submittedByName ? ` by ${response.submittedByName}` : ''}` : `draft saved ${fmt(response.updatedAt)}${response.lastSavedByName ? ` by ${response.lastSavedByName}` : ''}`}.
            {versions.length > 1 ? ` ${versions.filter(v => v.status === 'submitted').length} submitted versions kept.` : ''}
          </p>
        </div>
      )}
    </section>
  );
}

// ── Lineup editor ───────────────────────────────────────────────────────────
function LineupEditor({ lineup, catalogCoffees, vocab, base, post }: {
  lineup: LineupRow[]; catalogCoffees: { id: number; name: string; isActive: boolean }[]; vocab: Vocabulary;
  base: string; post: (path: string, body?: unknown, method?: string) => Promise<boolean>;
}) {
  const [newName, setNewName] = useState('');
  const [bulk, setBulk] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const active = lineup.filter(c => c.isActive);
  const lookups = useMemo(() => ({ process: vocab.process, roast_level: vocab.roastLevel, blend_or_single: vocab.blendOrSingle }), [vocab]);

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= active.length) return;
    const ids = active.map(c => c.portalCoffeeId);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void post(`${base}/lineup/order`, { ids }, 'PUT');
  }

  return (
    <section>
      <h3 className="text-sm uppercase tracking-[0.15em] text-stone-500 mb-3">Lineup</h3>
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <form className="flex items-end gap-3" onSubmit={async e => { e.preventDefault(); if (await post(`${base}/lineup`, { name: newName })) setNewName(''); }}>
          <label className="text-xs text-stone-500 flex-1">Add a coffee
            <input className={`${INPUT} mt-1`} value={newName} onChange={e => setNewName(e.target.value)} />
          </label>
          <button type="submit" disabled={!newName.trim()} className={BTN_PRIMARY} style={{ backgroundColor: ACCENT }}>Add</button>
        </form>
        <form onSubmit={async e => { e.preventDefault(); if (await post(`${base}/lineup/bulk`, { text: bulk })) setBulk(''); }}>
          <label className="text-xs text-stone-500">Paste several names, one per line
            <textarea className={`${INPUT} mt-1 h-20`} value={bulk} onChange={e => setBulk(e.target.value)} />
          </label>
          <button type="submit" disabled={!bulk.trim()} className={`${BTN} mt-2`}>Add all</button>
        </form>
      </div>

      <ul className="space-y-2">
        {active.map((c, i) => (
          <li key={c.portalCoffeeId} className="border border-stone-200 rounded">
            <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <span className="flex gap-1">
                <button className={BTN} disabled={i === 0} aria-label={`Move ${c.name} up`} onClick={() => move(i, -1)}>↑</button>
                <button className={BTN} disabled={i === active.length - 1} aria-label={`Move ${c.name} down`} onClick={() => move(i, 1)}>↓</button>
              </span>
              <span className="flex-1 min-w-[10rem]">
                {c.name}
                <span className="block text-xs text-stone-400">
                  {[c.origin, c.processValues.map(p => labelOf(vocab.process, p)).join(' + '), labelOf(vocab.roastLevel, c.roastLevel) !== '—' ? labelOf(vocab.roastLevel, c.roastLevel) : '']
                    .filter(Boolean).join(' · ') || 'No prefill'}
                  {c.prefillSource ? ` (${c.prefillSource === 'roaster_site' ? "from the roaster's site" : 'from the catalog'})` : ''}
                  {c.addedBy === 'roaster' ? ' · added by the roaster' : ''}
                </span>
              </span>
              <label className="text-xs text-stone-500">Catalog coffee
                <select className="ml-2 border border-stone-200 rounded px-2 py-1 text-sm bg-transparent" value={c.coffeeId ?? ''}
                  onChange={e => void post(`${base}/lineup/${c.portalCoffeeId}/link-catalog`, { coffeeId: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">Not linked</option>
                  {catalogCoffees.map(cc => <option key={cc.id} value={cc.id}>{cc.name}{cc.isActive ? '' : ' (inactive)'}</option>)}
                </select>
              </label>
              <button className={BTN} onClick={() => setEditing(editing === c.portalCoffeeId ? null : c.portalCoffeeId)}>{editing === c.portalCoffeeId ? 'Close' : 'Edit prefills'}</button>
              <button className={BTN} onClick={() => { if (window.confirm(`Deactivate ${c.name}? It leaves the roastery's page; its answers are kept.`)) void post(`${base}/lineup/${c.portalCoffeeId}/deactivate`); }}>Deactivate</button>
            </div>
            {editing === c.portalCoffeeId && (
              <PrefillForm coffee={c} lookups={lookups}
                onSave={async patch => { if (await post(`${base}/lineup/${c.portalCoffeeId}`, patch, 'PATCH')) setEditing(null); }} />
            )}
          </li>
        ))}
        {active.length === 0 && <li className="text-sm text-stone-400">No coffees yet.</li>}
      </ul>
    </section>
  );
}

function PrefillForm({ coffee, lookups, onSave }: {
  coffee: LineupRow; lookups: Record<string, Option[]>; onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(coffee.name);
  const [origin, setOrigin] = useState(coffee.origin ?? '');
  const [processValues, setProcessValues] = useState<string[]>(coffee.processValues);
  const [roast, setRoast] = useState(coffee.roastLevel ?? '');
  const [blend, setBlend] = useState(coffee.blendOrSingle ?? '');
  const [decaf, setDecaf] = useState(coffee.isDecaf === null ? '' : coffee.isDecaf ? 'yes' : 'no');
  const [source, setSource] = useState(coffee.prefillSource ?? '');

  return (
    <form className="border-t border-stone-200 px-3 py-4 bg-stone-50 grid md:grid-cols-2 gap-4 text-sm" onSubmit={e => {
      e.preventDefault();
      void onSave({
        name, origin, processValues, roastLevel: roast || null, blendOrSingle: blend || null,
        isDecaf: decaf === '' ? null : decaf === 'yes', prefillSource: source || null,
      });
    }}>
      <label className="text-xs text-stone-500">Name<input className={`${INPUT} mt-1`} value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="text-xs text-stone-500">Origin<input className={`${INPUT} mt-1`} value={origin} onChange={e => setOrigin(e.target.value)} /></label>
      <fieldset>
        <legend className="text-xs text-stone-500 mb-1">Process</legend>
        <div className="flex flex-wrap gap-3">
          {lookups.process.map(o => (
            <label key={o.value} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={processValues.includes(o.value)}
                onChange={e => setProcessValues(e.target.checked ? [...processValues, o.value] : processValues.filter(v => v !== o.value))} />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <div><p className="text-xs text-stone-500 mb-1">Roast level</p><LookupSelect category="roast_level" value={roast} onChange={setRoast} lookups={lookups} /></div>
        <div><p className="text-xs text-stone-500 mb-1">Single origin or blend</p><LookupSelect category="blend_or_single" value={blend} onChange={setBlend} lookups={lookups} /></div>
      </div>
      <label className="text-xs text-stone-500">Decaf
        <select className={`${INPUT} mt-1`} value={decaf} onChange={e => setDecaf(e.target.value)}>
          <option value="">Not set</option><option value="yes">Yes</option><option value="no">No</option>
        </select>
      </label>
      <label className="text-xs text-stone-500">Where the prefill came from
        <select className={`${INPUT} mt-1`} value={source} onChange={e => setSource(e.target.value)}>
          <option value="">Not set</option><option value="roaster_site">The roaster's site</option><option value="catalog">Our catalog</option>
        </select>
      </label>
      <div className="md:col-span-2 flex justify-end">
        <button type="submit" className={BTN_PRIMARY} style={{ backgroundColor: ACCENT }}>Save prefills</button>
      </div>
    </form>
  );
}

// ── One coffee's answers (read-only) with a version switcher ────────────────
function CoffeeResponsePanel({ roasterId, coffeeId, apiFetch, vocab, onBack }: {
  roasterId: string; coffeeId: string; apiFetch: (u: string, o?: RequestInit) => Promise<Response>; vocab: Vocabulary; onBack: () => void;
}) {
  const [data, setData] = useState<{ coffee: LineupRow; response: ResponseView | null; versions: VersionSummary[] } | null>(null);
  const [cousinNames, setCousinNames] = useState<Record<string, string>>({});
  const [wanted, setWanted] = useState<string | null>(null);
  const [error, setError] = useState('');
  const { archetypes } = useArchetypes();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = wanted ? `?responseId=${wanted}` : '';
        const res = await apiFetch(`/api/admin/roastery-portal/roasteries/${roasterId}/lineup/${coffeeId}/response${qs}`);
        if (!res.ok) throw new Error('Failed to load answers');
        const body = await res.json();
        if (cancelled) return;
        setData(body);
        const cousin = body.response?.closestCousinPortalCoffeeId;
        if (cousin && !cousinNames[cousin]) {
          const detail = await (await apiFetch(`/api/admin/roastery-portal/roasteries/${roasterId}`)).json();
          if (!cancelled) setCousinNames(Object.fromEntries(detail.lineup.map((c: LineupRow) => [c.portalCoffeeId, c.name])));
        }
      } catch (err) { reportError('[AdminRoasteryPortal/response]', err); if (!cancelled) setError('Failed to load answers'); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch, roasterId, coffeeId, wanted]);

  if (!data) return <p className="text-sm text-stone-400">{error || 'Loading…'}</p>;
  const { coffee, response: r, versions } = data;

  return (
    <div className="space-y-6">
      <div>
        <button className="text-xs uppercase tracking-wide text-stone-500 mb-2" onClick={onBack}>← Back to the roastery</button>
        <h2 className="text-lg">{coffee.name}</h2>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {versions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs uppercase tracking-wide text-stone-400">Version</span>
          {versions.map(v => (
            <button key={v.id} onClick={() => setWanted(v.id)}
              className={`px-3 py-1 rounded-full border text-xs ${(r?.id === v.id) ? 'text-[#f2f1ea]' : 'border-stone-300 text-stone-600'}`}
              style={r?.id === v.id ? { backgroundColor: ACCENT, borderColor: ACCENT } : undefined}>
              v{v.version} {v.status === 'draft' ? '(draft)' : ''}
            </button>
          ))}
        </div>
      )}
      {!r ? <p className="text-sm text-stone-400">Nothing saved yet.</p> : (
        <>
          <p className="text-sm text-stone-500">
            {r.status === 'submitted'
              ? `Submitted ${fmt(r.submittedAt)}${r.submittedByName ? ` by ${r.submittedByName}` : ''}.`
              : `Draft last saved ${fmt(r.updatedAt)}${r.lastSavedByName ? ` by ${r.lastSavedByName}` : ''}.`}
          </p>

          <Block title="The coffee">
            <Line k="Origin" v={r.origin} />
            <Line k="Process" v={r.processValues.map(p => labelOf(vocab.process, p)).join(', ') || null} />
            <Line k="Single origin or blend" v={r.blendOrSingle ? labelOf(vocab.blendOrSingle, r.blendOrSingle) : null} />
            <Line k="Decaf" v={r.isDecaf === null ? null : r.isDecaf ? 'Yes' : 'No'} />
            <Line k="Roast level" v={r.roastLevel ? labelOf(vocab.roastLevel, r.roastLevel) : null} />
          </Block>

          <Block title="Tasting notes">
            {r.notes.length === 0 ? <p className="text-stone-400">None.</p> : (
              <table className="text-sm w-full">
                <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-400"><th className="py-1 pr-4 font-normal">#</th><th className="py-1 pr-4 font-normal">Their words</th><th className="py-1 font-normal">Flavor wheel term</th></tr></thead>
                <tbody>
                  {r.notes.map(n => (
                    <tr key={n.rank} className="border-t border-stone-100">
                      <td className="py-1.5 pr-4 text-stone-400">{n.rank}</td>
                      <td className="py-1.5 pr-4">{n.roasterWords}</td>
                      <td className="py-1.5">
                        {n.descriptor ? `${n.descriptor} (${n.wheelCategory})` : (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#a337261a', color: ACCENT }}>needs mapping</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Line k="Proposed family" v={r.proposedArchetype ? archetypes.find(a => a.code === r.proposedArchetype)?.label ?? r.proposedArchetype : null} />
          </Block>

          <Block title="Dimensions (1 to 5, relative to their own lineup)">
            {vocab.dimensions.map(d => (
              <Line key={d.dimensionId} k={d.label} v={r.dimensions[String(d.dimensionId)] !== undefined ? `${r.dimensions[String(d.dimensionId)]} of 5 (${d.lowLabel} to ${d.highLabel})` : null} />
            ))}
            <Line k="Most dominant" v={r.dominantDimensionId ? vocab.dimensions.find(d => d.dimensionId === r.dominantDimensionId)?.label ?? null : null} />
          </Block>

          <Block title="How to drink it">
            <Line k="Best brewing method" v={r.bestBrew ? labelOf(vocab.brewMethods, r.bestBrew) : null} />
            <Line k="Also good as" v={r.alsoGoodBrews.map(m => labelOf(vocab.brewMethods, m)).join(', ') || null} />
            <Line k="Best enjoyed" v={r.takesIt ? labelOf(vocab.takesIt, r.takesIt) : null} />
            <Line k="Brewing notes" v={r.brewNotes} />
          </Block>

          <Block title="Availability">
            <Line k="In their lineup" v={r.availability ? labelOf(vocab.availability, r.availability) : null} />
            <Line k="Typical notice" v={r.typicalNotice ? labelOf(vocab.notice, r.typicalNotice) : 'Same as the lineup answer'} />
            <Line k="Expected availability" v={r.expectedAvailability} />
            <Line k="Similar profile when out" v={r.similarWhenOut ? labelOf(vocab.similar, r.similarWhenOut) : 'Same as the lineup answer'} />
            <Line k="Closest cousin" v={r.closestCousinPortalCoffeeId ? cousinNames[r.closestCousinPortalCoffeeId] ?? '…' : null} />
            <Line k="What changes between them" v={r.whatChanges} />
          </Block>

          <Block title="Anything else"><p className="whitespace-pre-wrap">{r.anythingElse || <span className="text-stone-400">Nothing added.</span>}</p></Block>
        </>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-stone-200 rounded p-4 text-sm text-stone-700 space-y-1">
      <h3 className="text-xs uppercase tracking-[0.15em] text-stone-500 mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Line({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <p className="flex gap-3"><span className="w-56 shrink-0 text-stone-400">{k}</span><span className="whitespace-pre-wrap">{v || <span className="text-stone-400">—</span>}</span></p>
  );
}
