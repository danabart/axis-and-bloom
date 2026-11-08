// Family Household 1, C3 (2026-11-07) — the Family Household tab on the
// website handoff tokens. Reads GET /api/household/mine and /lookups; every role
// name and state word comes from the API (G4.2; badge words since Household 2,
// OT-104). The admin adds a member by first name and shares that member's join
// link through their own channel (Share where the browser has a share sheet,
// else Copy); Axis & Bloom sends no email (D31).
// Family Household 2 (2026-11-07): Take the quiz for (D9), Open their dial
// (D27: saved with Save, logged with the actor), Unlink (D25), My log with Undo.
// Family Household 3 (2026-11-07): Build the house box (B7), the house
// subscription with Add a bag / Drop (D12), the handover offer (D22), and
// Leave / Close asking first when it would cancel the house subscription.
import React, { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { reportError } from '../lib/errorReporter';
import { shareOrCopy, copyLink } from '../lib/share';
import { getArchetypes, getDialPosition, setDialPosition } from '../lib/api';
import { BloomDialWidget } from './BloomDialWidget';
import { computeDefaultSortOrder } from './bloom/ArchetypeSection';
import { fieldLook } from './bloom/dial/archetypeConfig';
import type { ArchetypeData } from './bloom/types';

interface RoleView {
  code: string; customer_label: string; sort_order: number;
  can_administer: boolean; admin_may_set: boolean; member_may_self_set: boolean;
}
interface Word { code: string; label: string }
interface MemberView {
  memberId: string; firstName: string | null; isMe: boolean; roleCodes: string[];
  accountState: Word; quizState: Word; archetypeName: string | null; archetypeCode: string | null;
  dial: { slotId: number; sortOrder: number | null; name: string | null } | null;
  joinedAt: string; mayQuizFor: boolean; mayTurnDialFor: boolean; mayUnlink: boolean; unlinkConfirm: string | null;
  inHouseBox?: boolean; inHouseSubscription?: boolean; ownPlanActive?: boolean;
  openLink?: { invitationId: string; token: string; createdAt: string } | null;
}
interface EventView { event_id: string; kind_code: string; kind_label: string; actor_first_name: string | null; member_first_name: string | null; created_at: string }
interface Mine {
  household: { household_id: string; household_name: string | null; pays_first_name: string | null; active_member_count: number };
  me: { memberId: string; roleCodes: string[]; canAdminister: boolean; mayTurnDials: boolean };
  members: MemberView[];
  events: EventView[];
  limits: { maxMembers: number };
  houseSubscription: {
    id: string; paysFirstName: string | null; statusLabel: string | null; frequencyWeeks: number | null; nextDeliveryDate: string | null;
    bagCount: number; canEdit: boolean; weightOz: number;
    items: Array<{ itemId: string; name: string | null; weightOz: number; quantity: number; forFirstName: string | null; followsMember: boolean }>;
    addableFor: Array<{ userId: string; firstName: string | null }>;
  } | null;
  handoverOffer: { pct: number; expiresAt: string; line: string } | null;
}
interface HouseBoxMember {
  memberId: string; userId: string; firstName: string | null; isMe: boolean; needsQuiz: boolean; ownPlanActive: boolean; unavailable: string | null;
  line: { kind: 'dial'; archetype: string; archetypeLabel: string; dialSortOrder: number; weightOz: number; platformName: string; retailPriceCents: number; qty: number; intendedForUserId: string; intendedForName: string | null } | null;
}
interface LogView { entries: Array<{ dialEventId: string; occurredAt: string; line: string; undone: boolean; undoable: boolean }>; emptyText: string }

const caps = 'text-[10px] uppercase tracking-[var(--ab-caps)] text-[var(--ab-ink)]';
const linkBtn = `${caps} border-b border-[var(--ab-ink-hairline)] pb-0.5 hover:text-[var(--ab-mark-b)] hover:border-[var(--ab-mark-b)] transition-colors disabled:opacity-30 w-fit`;
const quietBtn = 'text-[9px] uppercase tracking-[var(--ab-caps)] text-[var(--ab-ink)]/50 hover:text-[var(--ab-ink)] transition-colors disabled:opacity-30';
const inputClass = 'w-full text-base tracking-wide py-2.5 rounded-none border-b border-[var(--ab-ink-hairline)] bg-transparent focus:outline-none focus:border-[var(--ab-mark-b)] text-[var(--ab-ink)] placeholder-[var(--ab-ink)]/40';
const label = 'block text-[10px] uppercase tracking-[var(--ab-caps)] text-[var(--ab-ink)]/60 mb-1.5';

const joinUrl = (token: string) => `${window.location.origin}/join-household?token=${token}`;

class ApiError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

/** D27: a member's dial, turned and saved by another member. The same BloomDialWidget The Bloom uses; Save is the only write. */
function MemberDial({ member, onSaved }: { member: MemberView; onSaved: (note: string) => void }) {
  const [data, setData] = useState<ArchetypeData | null>(null);
  const [sortOrder, setSortOrder] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const all = await getArchetypes();
        const d = all.find(a => a.archetype === member.archetypeCode) ?? null;
        const pos = d ? await getDialPosition(d.archetype, member.memberId) : null;
        if (!live) return;
        setData(d);
        setSortOrder(pos?.dialSortOrder ?? (d ? computeDefaultSortOrder(d) : null));
      } catch (err) { reportError('[FamilyTab/member-dial-load]', err); if (live) setError('We could not load the dial.'); }
    })();
    return () => { live = false; };
  }, [member.memberId, member.archetypeCode]);

  if (error) return <p className="text-xs text-[var(--ab-mark-a)]">{error}</p>;
  if (!data || sortOrder === null) return <p className={`${caps} opacity-50`}>Loading…</p>;
  const slot = data.slots.find(s => s.dialSortOrder === sortOrder) ?? null;
  async function save() {
    if (!data || sortOrder === null) return;
    setSaving(true); setError('');
    try {
      await setDialPosition(data.archetype, sortOrder, { trigger: 'explicit_save', source: 'profile', coffeeId: slot?.coffeeId ?? null, platformName: slot?.platformName ?? null }, member.memberId);
      onSaved(`${member.firstName}'s dial is set to ${slot?.positionLabel ?? 'the new position'}.`);
    } catch (err) { reportError('[FamilyTab/member-dial-save]', err); setError('That did not go through. Please try again in a moment.'); }
    finally { setSaving(false); }
  }
  return (
    <div className="flex flex-col items-start gap-3 pt-2" data-testid="member-dial">
      <div className="w-full max-w-[320px]">
        <BloomDialWidget
          color={fieldLook(data.archetype)?.color ?? 'var(--ab-ink)'}
          archetypeLabel={data.archetypeLabel}
          positions={data.slots.map(s => ({ dialSortOrder: s.dialSortOrder, label: s.positionLabel, description: s.description, isActive: s.isActive }))}
          dimensionLabel={data.dimensionPlatformName ?? data.dimensionName}
          defaultSortOrder={computeDefaultSortOrder(data)}
          initialSortOrder={sortOrder}
          onSelect={setSortOrder}
        />
      </div>
      <p className="text-xs text-[var(--ab-ink)]/70">{slot?.positionLabel}</p>
      <button type="button" className={linkBtn} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
    </div>
  );
}

export default function FamilyTab() {
  const { user } = useAuth();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Mine | null>(null);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [log, setLog] = useState<LogView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<string>(() => (location.state as { notice?: string } | null)?.notice ?? '');
  const [hhName, setHhName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [dialFor, setDialFor] = useState<string | null>(null);
  const [houseBox, setHouseBox] = useState<HouseBoxMember[] | null>(null);
  const [addFor, setAddFor] = useState('');
  const { addToCart } = useCart();

  const api = useCallback(async (method: string, path: string, body?: unknown) => {
    const token = await user!.getIdToken();
    const r = await fetch(`/api/household${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError(json?.message ?? 'That did not go through. Please try again in a moment.', json?.error);
    return json;
  }, [user]);

  // Family Household 3: the subscription item doors live under /api/subscriptions (subscriptionService is their writer).
  const subsApi = useCallback(async (method: string, path: string, body?: unknown) => {
    const token = await user!.getIdToken();
    const r = await fetch(`/api/subscriptions${path}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError(json?.message ?? 'That did not go through. Please try again in a moment.', json?.error);
    return json;
  }, [user]);

  const refresh = useCallback(async () => {
    const [mine, words] = await Promise.all([api('GET', '/mine'), api('GET', '/lookups')]);
    setData(mine);
    setRoles(words.roles);
    setLog(mine ? await api('GET', '/me/log') : null);
  }, [api]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    refresh().catch(err => { reportError('[FamilyTab/load]', err); setError('We could not load your household.'); })
      .finally(() => setLoading(false));
  }, [user, refresh]);

  async function act(where: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await fn();
      await refresh();
      if (done) setNotice(done);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else { reportError(`[FamilyTab/${where}]`, err); setError('That did not go through. Please try again in a moment.'); }
    } finally { setBusy(false); }
  }

  async function share(m: MemberView) {
    if (!m.openLink) return;
    const outcome = await shareOrCopy(joinUrl(m.openLink.token), `Join ${data?.household.household_name ?? 'our Family Household'}`,
      `${m.firstName ?? ''}, here is your link to join our Family Household on Axis & Bloom.`.trim());
    if (outcome === 'copied') setNotice(`Link for ${m.firstName} copied.`);
  }
  async function copy(m: MemberView) {
    if (!m.openLink) return;
    const outcome = await copyLink(joinUrl(m.openLink.token));
    setNotice(outcome === 'copied' ? `Link for ${m.firstName} copied.` : 'Copy is not available in this browser.');
  }

  const roleLabel = (code: string) => roles.find(r => r.code === code)?.customer_label ?? code;

  /** D22: Leave / Close; when it would cancel the house subscription, the API's sentence asks first. */
  async function leaveOrClose(path: '/leave' | '/dissolve', firstQuestion: string) {
    if (!window.confirm(firstQuestion)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      try {
        await api('POST', path, {});
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== 'confirm_cancel') throw err;
        if (!window.confirm(err.message)) return;
        await api('POST', path, { confirm: true });
      }
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else { reportError(`[FamilyTab${path}]`, err); setError('That did not go through. Please try again in a moment.'); }
    } finally { setBusy(false); }
  }

  async function buildHouseBox() {
    await act('house-box', async () => {
      const r = await api('GET', '/house-box');
      const members = r.members as HouseBoxMember[];
      for (const m of members) if (m.line) addToCart(m.line);
      setHouseBox(members);
    });
  }

  if (loading) return <p className={`${caps} opacity-50 py-8`}>Loading…</p>;

  if (!data) {
    return (
      <div className="flex flex-col gap-8 py-4" data-testid="family-household-create">
        <p className="text-lg text-[var(--ab-ink)]/80 font-light leading-relaxed">
          A Family Household brings several palates into one box. Everyone keeps their own taste profile, one person pays, and the bags arrive together.
        </p>
        <form onSubmit={e => { e.preventDefault(); act('create', () => api('POST', '/', { name: hhName.trim() })); }} className="flex flex-col gap-6">
          <div>
            <label className={label} htmlFor="hh-name">Household name</label>
            <input id="hh-name" value={hhName} onChange={e => setHhName(e.target.value)} placeholder="The Garcias" className={inputClass} maxLength={80} />
          </div>
          {error && <p className="text-xs text-[var(--ab-mark-a)]">{error}</p>}
          <button type="submit" disabled={busy || !hhName.trim()} className={linkBtn}>{busy ? 'Creating…' : 'Create Family Household'}</button>
        </form>
      </div>
    );
  }

  const { household, me, members, events, limits } = data;
  const isAdmin = me.canAdminister;
  const myRoles = new Set(me.roleCodes);
  const selfRoles = roles.filter(r => r.member_may_self_set);
  const alone = members.length === 1;
  const full = members.length >= limits.maxMembers;

  return (
    <div className="flex flex-col gap-10" data-testid="family-household">
      <div>
        <p className={label}>Family Household</p>
        <h2 className="text-xl text-[var(--ab-ink)] font-normal">{household.household_name}</h2>
        {household.pays_first_name && (
          <p className="text-sm text-[var(--ab-ink)]/60 mt-1">{household.pays_first_name} pays for the house box.</p>
        )}
      </div>

      <div className="flex flex-col">
        <p className={label}>Members</p>
        {members.map(m => (
          <div key={m.memberId} className="py-4 border-b border-[var(--ab-ink-hairline)] flex flex-col gap-2" data-testid="household-member">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-base text-[var(--ab-ink)]">
                {m.firstName}{m.isMe && <span className="text-[var(--ab-ink)]/50"> (you)</span>}
              </p>
              <span className="text-[9px] uppercase tracking-[var(--ab-caps)] text-[var(--ab-ink)]/50" data-testid="account-state">
                {m.accountState.label}
              </span>
            </div>
            <p className="text-xs text-[var(--ab-ink)]/60" data-testid="member-line">
              {[m.roleCodes.map(roleLabel).join(' · '), m.archetypeName, m.dial?.name, m.quizState.label].filter(Boolean).join(' · ')}
            </p>

            <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
              {m.mayQuizFor && (
                <Link to={`/find-my-flavor?for=${m.memberId}`} className={quietBtn} data-testid="quiz-for">Take the quiz for {m.firstName}</Link>
              )}
              {m.mayTurnDialFor && (
                <button type="button" className={quietBtn} disabled={busy} data-testid="open-dial"
                  onClick={() => setDialFor(dialFor === m.memberId ? null : m.memberId)}>
                  {dialFor === m.memberId ? 'Close their dial' : 'Open their dial'}
                </button>
              )}
              {isAdmin && !m.isMe && m.accountState.code === 'managed' && m.openLink && (
                <>
                  <button type="button" className={quietBtn} disabled={busy} onClick={() => share(m)}>Share link</button>
                  <button type="button" className={quietBtn} disabled={busy} onClick={() => copy(m)}>Copy link</button>
                  <button type="button" className={quietBtn} disabled={busy}
                    onClick={() => act('revoke-link', () => api('DELETE', `/links/${m.openLink!.invitationId}`), `${m.firstName}'s link is closed.`)}>
                    Revoke link
                  </button>
                </>
              )}
              {isAdmin && !m.isMe && m.accountState.code === 'managed' && !m.openLink && (
                <button type="button" className={quietBtn} disabled={busy}
                  onClick={() => act('create-link', () => api('POST', `/members/${m.memberId}/link`), `A new link for ${m.firstName} is ready.`)}>
                  New join link
                </button>
              )}
              {isAdmin && !m.isMe && m.accountState.code === 'login' && !m.roleCodes.includes('admin') && myRoles.has('admin') && (
                <button type="button" className={quietBtn} disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Hand the ${roleLabel('admin')} role to ${m.firstName}? ${m.firstName} will manage the household and pay for the house box.`)) return;
                    act('transfer', () => api('POST', '/transfer', { toMemberId: m.memberId }), `${m.firstName} is the ${roleLabel('admin')} now.`);
                  }}>
                  Make admin
                </button>
              )}
              {m.mayUnlink && m.unlinkConfirm && (
                <button type="button" className={quietBtn} disabled={busy} data-testid="unlink"
                  onClick={() => {
                    if (!window.confirm(m.unlinkConfirm!)) return;
                    act('unlink', () => api('POST', `/members/${m.memberId}/unlink`, {}), `${m.firstName}'s sign-in is unlinked.`);
                  }}>
                  Unlink
                </button>
              )}
              {isAdmin && !m.isMe && (
                <button type="button" className={quietBtn} disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Remove ${m.firstName} from the household?`)) return;
                    act('remove', () => api('DELETE', `/members/${m.memberId}`), `${m.firstName} is out of the household.`);
                  }}>
                  Remove
                </button>
              )}
            </div>
            {dialFor === m.memberId && (
              <MemberDial member={m} onSaved={note => { setDialFor(null); refresh().catch(err => reportError('[FamilyTab/refresh]', err)); setNotice(note); }} />
            )}
          </div>
        ))}
      </div>

      {data.handoverOffer && (
        <div className="flex flex-col gap-2 p-4 border border-[var(--ab-ink-hairline)]" data-testid="household-handover-offer">
          <p className="text-sm text-[var(--ab-ink)]">{data.handoverOffer.line}</p>
          <Link to="/bloom" className={linkBtn}>Choose your coffee</Link>
        </div>
      )}

      {isAdmin && (
        <div className="flex flex-col gap-3" data-testid="household-house-box">
          <p className={label}>The house box</p>
          <button type="button" className={linkBtn} disabled={busy} onClick={buildHouseBox} data-testid="build-house-box">Build the house box</button>
          {houseBox && (
            <div className="flex flex-col gap-1.5">
              {houseBox.map(m => (
                <p key={m.memberId} className="text-xs text-[var(--ab-ink)]/80" data-testid="house-box-member">
                  <span className="text-[var(--ab-ink)]">{m.firstName}</span>{': '}
                  {m.line ? `${m.line.qty} × ${m.line.platformName} · ${m.line.archetypeLabel}` : m.unavailable ?? ''}
                  {m.needsQuiz && (
                    <> <Link to={`/find-my-flavor?for=${m.memberId}`} className={quietBtn}>Take the quiz for {m.firstName}</Link></>
                  )}
                  {m.ownPlanActive && <span className="text-[var(--ab-ink)]/50"> · {roleLabel('own_plan')}</span>}
                </p>
              ))}
              <Link to="/cart" className={linkBtn}>Go to cart</Link>
            </div>
          )}
        </div>
      )}

      {data.houseSubscription && (
        <div className="flex flex-col gap-2" data-testid="household-house-subscription">
          <p className={label}>House subscription</p>
          <p className="text-sm text-[var(--ab-ink)]/80">
            {[data.houseSubscription.statusLabel, data.houseSubscription.frequencyWeeks ? `every ${data.houseSubscription.frequencyWeeks} weeks` : null,
              data.houseSubscription.nextDeliveryDate ? `next ${new Date(data.houseSubscription.nextDeliveryDate + 'T12:00:00').toLocaleDateString()}` : null,
              data.houseSubscription.paysFirstName ? `${data.houseSubscription.paysFirstName} pays` : null].filter(Boolean).join(' · ')}
          </p>
          {data.houseSubscription.items.map(i => (
            <div key={i.itemId} className="flex items-baseline justify-between gap-4" data-testid="house-subscription-item">
              <p className="text-xs text-[var(--ab-ink)]/80">
                {i.quantity} × {i.followsMember ? `${i.weightOz} oz, matched to ${i.forFirstName}` : `${i.name ?? 'Coffee'} · ${i.weightOz} oz`}
                {i.forFirstName && !i.followsMember ? ` · for ${i.forFirstName}` : ''}
              </p>
              {data.houseSubscription!.canEdit && data.houseSubscription!.items.length > 1 && (
                <button type="button" className={quietBtn} disabled={busy}
                  onClick={() => act('drop-item', () => subsApi('DELETE', `/${data.houseSubscription!.id}/items/${i.itemId}`), 'Dropped from the next delivery.')}>
                  Drop
                </button>
              )}
            </div>
          ))}
          {data.houseSubscription.canEdit && data.houseSubscription.addableFor.length > 0 && (
            <div className="flex items-center gap-3 pt-1">
              <select value={addFor} onChange={e => setAddFor(e.target.value)} className="bg-transparent border-b text-xs text-[var(--ab-ink)] border-[var(--ab-ink-hairline)]" data-testid="add-bag-for">
                <option value="">Add a bag for…</option>
                {data.houseSubscription.addableFor.map(m => <option key={m.userId} value={m.userId}>{m.firstName}</option>)}
              </select>
              <button type="button" className={quietBtn} disabled={busy || !addFor}
                onClick={() => act('add-item', async () => {
                  await subsApi('POST', `/${data.houseSubscription!.id}/items`, { intendedForUserId: addFor, weightOz: data.houseSubscription!.weightOz, quantity: 1 });
                  setAddFor('');
                }, 'Added from the next delivery.')}>
                Add
              </button>
            </div>
          )}
        </div>
      )}

      {selfRoles.length > 0 && (
        <div className="flex flex-col gap-3" data-testid="household-my-plan">
          <p className={label}>My plan</p>
          {selfRoles.map(r => {
            const on = myRoles.has(r.code);
            return (
              <label key={r.code} className="flex items-center gap-3 text-sm text-[var(--ab-ink)] cursor-pointer">
                <input type="checkbox" checked={on} disabled={busy} className="accent-[var(--ab-mark-b)]"
                  onChange={() => act('self-role', () => on
                    ? api('DELETE', `/members/${me.memberId}/roles/${r.code}`)
                    : api('POST', `/members/${me.memberId}/roles`, { roleCode: r.code }))} />
                {r.customer_label}
              </label>
            );
          })}
        </div>
      )}

      {log && (
        <div className="flex flex-col gap-2" data-testid="household-my-log">
          <p className={label}>My log</p>
          {log.entries.length === 0 ? (
            <p className="text-xs text-[var(--ab-ink)]/60">{log.emptyText}</p>
          ) : log.entries.map(e => (
            <div key={e.dialEventId} className="flex items-baseline justify-between gap-4">
              <p className={`text-xs text-[var(--ab-ink)]/70 ${e.undone ? 'line-through opacity-60' : ''}`}>
                <span className="text-[var(--ab-ink)]/40">{new Date(e.occurredAt).toLocaleDateString()}</span>{'  '}{e.line}
              </p>
              {e.undoable && (
                <button type="button" className={quietBtn} disabled={busy} data-testid="undo-dial"
                  onClick={() => act('undo-dial', () => api('POST', `/me/log/${e.dialEventId}/undo`, {}), 'Your dial is back where it was.')}>
                  Undo
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {isAdmin && !full && (
        <form className="flex flex-col gap-4 border-t border-[var(--ab-ink-hairline)] pt-8" data-testid="household-add-member"
          onSubmit={e => {
            e.preventDefault();
            const name = firstName.trim();
            act('add-member', async () => { await api('POST', '/members', { firstName: name }); setFirstName(''); },
              `${name} is in the household. Share their link when you are ready.`);
          }}>
          <p className={label}>Add a member</p>
          <div>
            <label className={label} htmlFor="hh-first-name">First name</label>
            <input id="hh-first-name" value={firstName} onChange={e => setFirstName(e.target.value)} className={inputClass} maxLength={40} />
          </div>
          <p className="text-xs text-[var(--ab-ink)]/50">
            Up to {limits.maxMembers} people. You get a join link to send them yourself; they sign up with their own email when they open it.
          </p>
          <button type="submit" disabled={busy || !firstName.trim()} className={linkBtn}>Add</button>
        </form>
      )}

      {(error || notice) && (
        <p className={`text-xs ${error ? 'text-[var(--ab-mark-a)]' : 'text-[var(--ab-ink)]/70'}`} role="status">{error || notice}</p>
      )}

      {events.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="household-activity">
          <p className={label}>Activity</p>
          {events.slice(0, 12).map(e => (
            <p key={e.event_id} className="text-xs text-[var(--ab-ink)]/60">
              <span className="text-[var(--ab-ink)]/40">{new Date(e.created_at).toLocaleDateString()}</span>{'  '}
              {e.kind_label}{e.member_first_name ? `: ${e.member_first_name}` : ''}{e.actor_first_name ? ` (${e.actor_first_name})` : ''}
            </p>
          ))}
        </div>
      )}

      <div className="border-t border-[var(--ab-ink-hairline)] pt-8">
        {isAdmin && alone ? (
          <button type="button" className={linkBtn} disabled={busy}
            onClick={() => leaveOrClose('/dissolve', 'Close this Family Household?')}>
            Close household
          </button>
        ) : (
          <button type="button" className={linkBtn} disabled={busy}
            onClick={() => leaveOrClose('/leave', 'Leave this Family Household?')}>
            Leave household
          </button>
        )}
      </div>
    </div>
  );
}
