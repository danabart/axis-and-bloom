import React, { useState, useEffect, useCallback } from 'react';
import { Users, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface Member {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  is_household_admin: boolean;
}

interface PendingInvite {
  id: string;
  invited_email: string;
  expires_at: string;
}

interface Household {
  id: string;
  name: string | null;
  createdAt: string;
  isAdmin: boolean;
  members: Member[];
  pendingInvites: PendingInvite[];
}

const inputClass = "w-full text-left text-base tracking-wide transition-all duration-300 py-2.5 rounded-none border-b border-[#a33726]/30 bg-transparent focus:outline-none focus:border-[#ee5974] text-[#a33726] placeholder-[#a33726]/40";
const labelClass = "block text-[10px] uppercase tracking-[0.2em] text-[#a33726]/60 mb-1.5 font-normal";

export default function FamilyTab() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [household, setHousehold] = useState<Household | null>(null);

  const [hhName, setHhName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');

  const [actionError, setActionError] = useState('');

  const refresh = useCallback(async () => {
    if (!user) return;
    const token = await user.getIdToken();
    const r = await fetch('/api/household/mine', { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setHousehold(await r.json());
  }, [user]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [user, refresh]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      const token = await user!.getIdToken();
      const r = await fetch('/api/household/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ householdName: hhName.trim() || undefined }),
      });
      if (!r.ok) { setCreateError((await r.json()).error ?? 'Failed to create'); return; }
      await refresh();
    } catch { setCreateError('Failed to create household'); }
    finally { setCreating(false); }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteError('');
    setInviteSuccess('');
    try {
      const token = await user!.getIdToken();
      const r = await fetch('/api/household/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: inviteEmail }),
      });
      if (!r.ok) { setInviteError((await r.json()).error ?? 'Failed to invite'); return; }
      setInviteSuccess(`Invitation sent to ${inviteEmail}`);
      setInviteEmail('');
      await refresh();
    } catch { setInviteError('Failed to send invitation'); }
    finally { setInviting(false); }
  }

  async function handleRemoveMember(memberId: string) {
    setActionError('');
    try {
      const token = await user!.getIdToken();
      const r = await fetch(`/api/household/members/${memberId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) { setActionError((await r.json()).error ?? 'Failed'); return; }
      await refresh();
    } catch { setActionError('Failed to remove member'); }
  }

  async function handleCancelInvite(inviteId: string) {
    setActionError('');
    try {
      const token = await user!.getIdToken();
      await fetch(`/api/household/invitations/${inviteId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      await refresh();
    } catch { setActionError('Failed to cancel invite'); }
  }

  async function handleLeave() {
    if (!window.confirm(
      household?.isAdmin && household.members.length === 1
        ? 'Dissolve this household? This cannot be undone.'
        : 'Leave this household?'
    )) return;
    setActionError('');
    try {
      const token = await user!.getIdToken();
      const r = await fetch('/api/household/leave', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) { setActionError((await r.json()).error ?? 'Failed'); return; }
      await refresh();
    } catch { setActionError('Failed to leave household'); }
  }

  if (loading) {
    return <p className="text-[#a33726]/50 text-sm uppercase tracking-widest py-8">Loading…</p>;
  }

  if (!household) {
    return (
      <div className="flex flex-col gap-8 py-4">
        <div className="flex flex-col gap-3">
          <Users size={32} className="text-[#a33726]/30" strokeWidth={1} />
          <p className="text-lg text-[#a33726]/70 font-sans tracking-wide font-light leading-relaxed">
            A Family Bundle lets everyone in your household get coffee matched to their own palate, delivered together.
          </p>
        </div>
        <form onSubmit={handleCreate} className="flex flex-col gap-6">
          <div>
            <label className={labelClass}>Household name <span className="opacity-50 normal-case tracking-normal">— optional</span></label>
            <input
              value={hhName}
              onChange={e => setHhName(e.target.value)}
              placeholder="e.g. The Garcias"
              className={inputClass}
            />
          </div>
          {createError && <p className="text-xs text-red-600">{createError}</p>}
          <button
            type="submit"
            disabled={creating}
            className="text-[10px] uppercase tracking-[0.3em] text-[#a33726] border-b border-[#a33726]/40 pb-1 hover:border-[#ee5974] hover:text-[#ee5974] transition-colors disabled:opacity-30 w-fit"
          >
            {creating ? 'Creating…' : 'Create Household'}
          </button>
        </form>
      </div>
    );
  }

  const myId = household.members.find(m => m.email === user?.email)?.id;
  const canLeave = !(household.isAdmin && household.members.length > 1);

  return (
    <div className="flex flex-col gap-10 font-sans">

      <div>
        <p className={labelClass}>Household</p>
        <h2 className="text-xl text-[#a33726] font-normal">{household.name ?? 'My Household'}</h2>
      </div>

      <div className="flex flex-col gap-2">
        <p className={labelClass}>Members</p>
        {household.members.map(m => (
          <div key={m.id} className="flex items-center justify-between py-3 border-b border-[#a33726]/10">
            <div>
              <p className="text-sm text-[#a33726]">
                {m.first_name ? `${m.first_name}${m.last_name ? ' ' + m.last_name : ''}` : m.email}
                {m.is_household_admin && (
                  <span className="ml-2 text-[9px] uppercase tracking-widest text-[#a33726]/50">Admin</span>
                )}
              </p>
              {m.first_name && <p className="text-xs text-[#a33726]/50 mt-0.5">{m.email}</p>}
            </div>
            {household.isAdmin && !m.is_household_admin && m.id !== myId && (
              <button
                onClick={() => handleRemoveMember(m.id)}
                className="text-[9px] uppercase tracking-[0.2em] text-[#a33726]/30 hover:text-[#a33726] transition-colors ml-4 shrink-0"
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      {household.pendingInvites.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className={labelClass}>Pending Invitations</p>
          {household.pendingInvites.map(inv => (
            <div key={inv.id} className="flex items-center justify-between py-2.5 border-b border-[#a33726]/10">
              <div>
                <p className="text-sm text-[#a33726]/70">{inv.invited_email}</p>
                <p className="text-xs text-[#a33726]/40 mt-0.5">
                  Expires {new Date(inv.expires_at).toLocaleDateString()}
                </p>
              </div>
              {household.isAdmin && (
                <button
                  onClick={() => handleCancelInvite(inv.id)}
                  className="text-[9px] uppercase tracking-[0.2em] text-[#a33726]/30 hover:text-[#a33726] transition-colors ml-4 shrink-0"
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {household.isAdmin && (
        <form onSubmit={handleInvite} className="flex flex-col gap-4 border-t border-[#a33726]/10 pt-8">
          <p className={labelClass}>Invite a member</p>
          <div>
            <label className={labelClass}>Email address</label>
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="their@email.com"
              className={inputClass}
              required
            />
          </div>
          {inviteError && <p className="text-xs text-red-600">{inviteError}</p>}
          {inviteSuccess && <p className="text-xs text-green-700">{inviteSuccess}</p>}
          <button
            type="submit"
            disabled={inviting || !inviteEmail}
            className="text-[10px] uppercase tracking-[0.3em] text-[#a33726] border-b border-[#a33726]/40 pb-1 hover:border-[#ee5974] hover:text-[#ee5974] transition-colors disabled:opacity-30 w-fit"
          >
            {inviting ? 'Sending…' : 'Send Invitation'}
          </button>
        </form>
      )}

      {actionError && <p className="text-xs text-red-600">{actionError}</p>}

      <div className="border-t border-[#a33726]/10 pt-8">
        <button
          onClick={handleLeave}
          disabled={!canLeave}
          className="flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-[#a33726]/60 hover:text-[#a33726] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <LogOut size={14} />
          {household.isAdmin && household.members.length === 1 ? 'Dissolve Household' : 'Leave Household'}
        </button>
        {!canLeave && (
          <p className="text-xs text-[#a33726]/40 mt-2">Remove all members before leaving as admin.</p>
        )}
      </div>

    </div>
  );
}
