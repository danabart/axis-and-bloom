// Family Household 1, C3 (2026-11-07) — the Family Household tab on the
// website handoff tokens. Reads GET /api/household/mine and /roles; every role
// name and state label comes from the API (G4.2). The admin adds a member by
// first name and shares that member's join link through their own channel
// (Share where the browser has a share sheet, else Copy); Axis & Bloom sends
// no email (D31). Take the quiz for, Open their dial and Build the house box
// arrive with household briefs 2 and 3.
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { reportError } from '../lib/errorReporter';
import { shareOrCopy, copyLink } from '../lib/share';

interface RoleView {
  code: string; customer_label: string; sort_order: number;
  can_administer: boolean; admin_may_set: boolean; member_may_self_set: boolean;
}
interface MemberView {
  memberId: string; firstName: string | null; isMe: boolean; roleCodes: string[];
  accountState: 'login' | 'managed'; archetypeName: string | null; quizState: 'none' | 'own'; joinedAt: string;
  openLink?: { invitationId: string; token: string; createdAt: string } | null;
}
interface EventView { event_id: string; kind_code: string; kind_label: string; actor_first_name: string | null; member_first_name: string | null; created_at: string }
interface Mine {
  household: { household_id: string; household_name: string | null; pays_first_name: string | null; active_member_count: number };
  me: { memberId: string; roleCodes: string[]; canAdminister: boolean };
  members: MemberView[];
  events: EventView[];
  limits: { maxMembers: number };
}

const caps = 'text-[10px] uppercase tracking-[var(--ab-caps)] text-[var(--ab-ink)]';
const linkBtn = `${caps} border-b border-[var(--ab-ink-hairline)] pb-0.5 hover:text-[var(--ab-mark-b)] hover:border-[var(--ab-mark-b)] transition-colors disabled:opacity-30 w-fit`;
const quietBtn = 'text-[9px] uppercase tracking-[var(--ab-caps)] text-[var(--ab-ink)]/50 hover:text-[var(--ab-ink)] transition-colors disabled:opacity-30';
const inputClass = 'w-full text-base tracking-wide py-2.5 rounded-none border-b border-[var(--ab-ink-hairline)] bg-transparent focus:outline-none focus:border-[var(--ab-mark-b)] text-[var(--ab-ink)] placeholder-[var(--ab-ink)]/40';
const label = 'block text-[10px] uppercase tracking-[var(--ab-caps)] text-[var(--ab-ink)]/60 mb-1.5';

const joinUrl = (token: string) => `${window.location.origin}/join-household?token=${token}`;

class ApiError extends Error {}

export default function FamilyTab() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Mine | null>(null);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [hhName, setHhName] = useState('');
  const [firstName, setFirstName] = useState('');

  const api = useCallback(async (method: string, path: string, body?: unknown) => {
    const token = await user!.getIdToken();
    const r = await fetch(`/api/household${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError(json?.message ?? 'That did not go through. Please try again in a moment.');
    return json;
  }, [user]);

  const refresh = useCallback(async () => {
    const [mine, roleList] = await Promise.all([api('GET', '/mine'), api('GET', '/roles')]);
    setData(mine);
    setRoles(roleList);
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
                {m.accountState === 'login' ? 'Has their own sign-in' : 'Set up by the admin'}
              </span>
            </div>
            <p className="text-xs text-[var(--ab-ink)]/60">
              {m.roleCodes.map(roleLabel).join(' · ')}
              {' · '}
              {m.archetypeName ?? 'No quiz yet'}
            </p>

            {isAdmin && !m.isMe && (
              <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
                {m.accountState === 'managed' && m.openLink && (
                  <>
                    <button type="button" className={quietBtn} disabled={busy} onClick={() => share(m)}>Share link</button>
                    <button type="button" className={quietBtn} disabled={busy} onClick={() => copy(m)}>Copy link</button>
                    <button type="button" className={quietBtn} disabled={busy}
                      onClick={() => act('revoke-link', () => api('DELETE', `/links/${m.openLink!.invitationId}`), `${m.firstName}'s link is closed.`)}>
                      Revoke link
                    </button>
                  </>
                )}
                {m.accountState === 'managed' && !m.openLink && (
                  <button type="button" className={quietBtn} disabled={busy}
                    onClick={() => act('create-link', () => api('POST', `/members/${m.memberId}/link`), `A new link for ${m.firstName} is ready.`)}>
                    New join link
                  </button>
                )}
                {m.accountState === 'login' && !m.roleCodes.includes('admin') && myRoles.has('admin') && (
                  <button type="button" className={quietBtn} disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Hand the ${roleLabel('admin')} role to ${m.firstName}? ${m.firstName} will manage the household and pay for the house box.`)) return;
                      act('transfer', () => api('POST', '/transfer', { toMemberId: m.memberId }), `${m.firstName} is the ${roleLabel('admin')} now.`);
                    }}>
                    Make admin
                  </button>
                )}
                <button type="button" className={quietBtn} disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Remove ${m.firstName} from the household?`)) return;
                    act('remove', () => api('DELETE', `/members/${m.memberId}`), `${m.firstName} is out of the household.`);
                  }}>
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

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
            onClick={() => { if (window.confirm('Close this Family Household?')) act('dissolve', () => api('POST', '/dissolve')); }}>
            Close household
          </button>
        ) : (
          <button type="button" className={linkBtn} disabled={busy}
            onClick={() => { if (window.confirm('Leave this Family Household?')) act('leave', () => api('POST', '/leave')); }}>
            Leave household
          </button>
        )}
      </div>
    </div>
  );
}
