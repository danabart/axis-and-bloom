// Family Household 1, B2 (2026-11-07) — the one writer of household,
// household_member, household_member_role, household_invitation and
// household_event (G2.5, G2.6). Every function runs in one transaction, locks
// the household row first (so member counts and "last admin" checks cannot
// race), checks the actor's rights from v_household_member, and writes one
// household_event per state change through recordEvent. Nothing here ever
// DELETEs a row (T5): dissolve is dissolved_at, leave/remove end the member
// row, revoke closes the link. Identity links go through
// customerFacts.identityLink, never a direct INSERT.
// backend/src/features/household/CLAUDE_CODE_PROMPT_HOUSEHOLD_1_FOUNDATION_AND_JOIN_LINKS.md
// backend/src/features/household/DESIGN_HOUSEHOLD.md
import { randomBytes, randomUUID } from 'crypto';
import { withTransaction, type Tx } from '../db/client.js';
import { record } from './customerFacts.js';
import { householdParam } from './householdParameters.js';

import { MANAGED_UID_PREFIX } from './householdManaged.js';
export { MANAGED_UID_PREFIX };

export class HouseholdError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'HouseholdError';
  }
}

type EventKind =
  | 'created' | 'member_added' | 'link_created' | 'link_revoked' | 'link_accepted' | 'link_declined'
  | 'member_claimed' | 'role_granted' | 'role_revoked' | 'admin_transferred' | 'member_left'
  | 'member_removed' | 'dissolved';
type EventSource = 'customer' | 'admin' | 'system' | 'cron';

/** The one INSERT into household_event. An unknown code fails loudly on the NOT NULL kind/source. */
export async function recordEvent(tx: Tx, e: {
  householdId: string; memberId?: string | null; kind: EventKind; source: EventSource;
  actorUserId?: string | null; detail?: Record<string, unknown>;
}): Promise<void> {
  await tx.query(
    `INSERT INTO household_event (household_id, member_id, kind_id, source_id, actor_user_id, detail)
     VALUES ($1, $2, (SELECT id FROM household_event_kind WHERE code = $3),
             (SELECT id FROM household_event_source WHERE code = $4), $5, $6::jsonb)`,
    [e.householdId, e.memberId ?? null, e.kind, e.source, e.actorUserId ?? null, JSON.stringify(e.detail ?? {})]
  );
}

// ── shared reads inside the transaction ──────────────────────────────────────

interface MemberRow {
  member_id: string; household_id: string; user_id: string; first_name: string | null; status_code: string;
  role_codes: string[]; can_administer: boolean; account_state: 'login' | 'managed';
}
const MEMBER_COLS = `member_id, household_id, user_id, first_name, status_code, role_codes, can_administer, account_state`;

async function activeMemberOf(tx: Tx, userId: string): Promise<MemberRow | null> {
  const r = await tx.query<MemberRow>(
    `SELECT ${MEMBER_COLS} FROM v_household_member WHERE user_id = $1 AND status_code = 'active'`, [userId]
  );
  return r.rows[0] ?? null;
}

async function memberById(tx: Tx, memberId: string): Promise<MemberRow | null> {
  const r = await tx.query<MemberRow>(`SELECT ${MEMBER_COLS} FROM v_household_member WHERE member_id = $1`, [memberId]);
  return r.rows[0] ?? null;
}

interface HouseholdRow { id: string; household_name: string | null; dissolved_at: Date | null; primary_billing_user_id: string | null }
async function lockHousehold(tx: Tx, householdId: string): Promise<HouseholdRow> {
  const r = await tx.query<HouseholdRow>(
    `SELECT id, household_name, dissolved_at, primary_billing_user_id FROM household WHERE id = $1 FOR UPDATE`, [householdId]
  );
  if (!r.rows[0]) throw new HouseholdError(404, 'household_not_found', 'We could not find that household.');
  return r.rows[0];
}

interface RoleRow { id: number; code: string; customer_label: string; can_administer: boolean; admin_may_set: boolean; member_may_self_set: boolean }
async function roleByCode(tx: Tx, code: string): Promise<RoleRow> {
  const r = await tx.query<RoleRow>(
    `SELECT id, code, customer_label, can_administer, admin_may_set, member_may_self_set FROM household_role WHERE code = $1`, [code]
  );
  if (!r.rows[0]) throw new HouseholdError(404, 'unknown_role', 'We could not find that role.');
  return r.rows[0];
}

async function activeCount(tx: Tx, householdId: string): Promise<number> {
  const r = await tx.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM household_member hm
     JOIN household_member_status s ON s.id = hm.status_id AND s.code = 'active'
     WHERE hm.household_id = $1`, [householdId]
  );
  return r.rows[0].n;
}

/** Active members of the household, other than `exceptMemberId`, holding a role that administers. */
async function otherAdmins(tx: Tx, householdId: string, exceptMemberId: string): Promise<MemberRow[]> {
  const r = await tx.query<MemberRow>(
    `SELECT ${MEMBER_COLS} FROM v_household_member
     WHERE household_id = $1 AND status_code = 'active' AND can_administer AND member_id <> $2
     ORDER BY joined_at`, [householdId, exceptMemberId]
  );
  return r.rows;
}

async function hasActiveHouseSubscription(tx: Tx, householdId: string): Promise<boolean> {
  const r = await tx.query(
    `SELECT 1 FROM subscription s
     JOIN subscription_status st ON st.code = s.status AND st.counts_as_subscriber
     WHERE s.household_id = $1 LIMIT 1`, [householdId]
  );
  return r.rows.length > 0;
}

const notInHousehold = () => new HouseholdError(404, 'not_in_household', 'You are not in a Family Household yet.');
const notAdmin = () => new HouseholdError(403, 'not_household_admin', 'Only the household admin can do that.');
const memberNotFound = () => new HouseholdError(404, 'member_not_found', 'We could not find that member.');
const transferFirst = () => new HouseholdError(409, 'transfer_first', 'Hand the admin role to another member before you leave the household.');
const subscriptionActive = () => new HouseholdError(409, 'subscription_active', 'The house subscription is still active. Cancel it first, then you can leave or close the household.');

/** The actor's active membership, locked household and all. Throws when the actor is in no household. */
async function actorContext(tx: Tx, actorUserId: string): Promise<{ me: MemberRow; household: HouseholdRow }> {
  const pre = await activeMemberOf(tx, actorUserId);
  if (!pre) throw notInHousehold();
  const household = await lockHousehold(tx, pre.household_id);
  const me = await activeMemberOf(tx, actorUserId); // re-read under the household lock
  if (!me || me.household_id !== household.id) throw notInHousehold();
  return { me, household };
}

/** The target member, active and in the actor's household. */
async function targetIn(tx: Tx, memberId: string, householdId: string): Promise<MemberRow> {
  const t = await memberById(tx, memberId);
  if (!t || t.household_id !== householdId || t.status_code !== 'active') throw memberNotFound();
  return t;
}

/** Map a unique-index race (two taps, two tabs) to a clear 409. */
async function run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await withTransaction(fn);
  } catch (err: any) {
    if (err?.code === '23505') throw new HouseholdError(409, 'conflict', 'That just changed. Please refresh and try again.');
    throw err;
  }
}

async function insertMember(tx: Tx, householdId: string, userId: string): Promise<string> {
  const r = await tx.query<{ id: string }>(
    `INSERT INTO household_member (household_id, user_id, status_id)
     VALUES ($1, $2, (SELECT id FROM household_member_status WHERE code = 'active')) RETURNING id`,
    [householdId, userId]
  );
  return r.rows[0].id;
}

async function grantRoleRow(tx: Tx, memberId: string, roleCode: string, grantedBy: string | null): Promise<boolean> {
  const r = await tx.query(
    `INSERT INTO household_member_role (member_id, role_id, granted_by_user_id)
     VALUES ($1, (SELECT id FROM household_role WHERE code = $2), $3)
     ON CONFLICT (member_id, role_id) WHERE revoked_at IS NULL DO NOTHING`,
    [memberId, roleCode, grantedBy]
  );
  return (r.rowCount ?? 0) > 0;
}

async function revokeRoleRow(tx: Tx, memberId: string, roleCode: string): Promise<boolean> {
  const r = await tx.query(
    `UPDATE household_member_role SET revoked_at = timezone('utc', now())
     WHERE member_id = $1 AND role_id = (SELECT id FROM household_role WHERE code = $2) AND revoked_at IS NULL`,
    [memberId, roleCode]
  );
  return (r.rowCount ?? 0) > 0;
}

async function endMember(tx: Tx, memberId: string, statusCode: 'left' | 'removed'): Promise<void> {
  await tx.query(
    `UPDATE household_member SET status_id = (SELECT id FROM household_member_status WHERE code = $2),
            ended_at = timezone('utc', now()), updated_at = timezone('utc', now())
     WHERE id = $1`, [memberId, statusCode]
  );
}

async function insertOpenLink(tx: Tx, householdId: string, memberId: string, invitedBy: string): Promise<{ invitationId: string; token: string }> {
  const token = randomBytes(32).toString('hex');
  const r = await tx.query<{ id: string }>(
    `INSERT INTO household_invitation (household_id, member_id, invited_by_id, token, status_id, invited_email, expires_at)
     VALUES ($1, $2, $3, $4, (SELECT id FROM household_invitation_status WHERE code = 'open'), NULL, NULL)
     RETURNING id`,
    [householdId, memberId, invitedBy, token]
  );
  return { invitationId: r.rows[0].id, token };
}

/** Close the member's open link, if any. Returns the closed invitation id. */
async function closeOpenLink(tx: Tx, memberId: string): Promise<string | null> {
  const r = await tx.query<{ id: string }>(
    `UPDATE household_invitation SET status_id = (SELECT id FROM household_invitation_status WHERE code = 'revoked'),
            revoked_at = timezone('utc', now())
     WHERE member_id = $1 AND status_id = (SELECT id FROM household_invitation_status WHERE code = 'open')
     RETURNING id`, [memberId]
  );
  return r.rows[0]?.id ?? null;
}

// ── create ───────────────────────────────────────────────────────────────────

export async function create(actorUserId: string, name: string): Promise<{ householdId: string; memberId: string }> {
  const householdName = String(name ?? '').trim();
  if (!householdName) throw new HouseholdError(400, 'name_required', 'Give your household a name.');
  return run(async tx => {
    if (await activeMemberOf(tx, actorUserId)) throw new HouseholdError(409, 'already_in_household', 'You are already in a Family Household.');
    const h = await tx.query<{ id: string }>(
      `INSERT INTO household (household_name, primary_billing_user_id) VALUES ($1, $2) RETURNING id`,
      [householdName, actorUserId]
    );
    const householdId = h.rows[0].id;
    const memberId = await insertMember(tx, householdId, actorUserId);
    await grantRoleRow(tx, memberId, 'admin', actorUserId);
    await grantRoleRow(tx, memberId, 'household', actorUserId);
    await recordEvent(tx, { householdId, memberId, kind: 'created', source: 'customer', actorUserId, detail: { name: householdName } });
    return { householdId, memberId };
  });
}

// ── add a member by first name (D31, D34) ────────────────────────────────────

export interface AddMemberResult { memberId: string; userId: string; invitationId: string; token: string }

export async function addMember(actorUserId: string, firstName: string): Promise<AddMemberResult> {
  const name = String(firstName ?? '').trim();
  if (!name) throw new HouseholdError(400, 'first_name_required', 'Add their first name.');
  return run(async tx => {
    const { me, household } = await actorContext(tx, actorUserId);
    if (!me.can_administer) throw notAdmin();
    const max = await householdParam('max_members');
    if ((await activeCount(tx, household.id)) >= max) {
      throw new HouseholdError(409, 'household_full', `A Family Household holds up to ${max} people.`, { maxMembers: max });
    }
    const p = await tx.query<{ id: string }>(
      `INSERT INTO user_profile (firebase_uid, first_name, user_type_id)
       VALUES ($1, $2, (SELECT id FROM user_type WHERE name = 'household_managed')) RETURNING id`,
      [`${MANAGED_UID_PREFIX}${randomUUID()}`, name]
    );
    const userId = p.rows[0].id;
    const memberId = await insertMember(tx, household.id, userId);
    await grantRoleRow(tx, memberId, 'household', actorUserId);
    const link = await insertOpenLink(tx, household.id, memberId, actorUserId);
    await recordEvent(tx, { householdId: household.id, memberId, kind: 'member_added', source: 'customer', actorUserId, detail: { first_name: name } });
    await recordEvent(tx, { householdId: household.id, memberId, kind: 'link_created', source: 'customer', actorUserId, detail: { invitation_id: link.invitationId } });
    return { memberId, userId, ...link };
  });
}

// ── join links ───────────────────────────────────────────────────────────────

export async function createLink(actorUserId: string, memberId: string): Promise<{ invitationId: string; token: string }> {
  return run(async tx => {
    const { me, household } = await actorContext(tx, actorUserId);
    if (!me.can_administer) throw notAdmin();
    const target = await targetIn(tx, memberId, household.id);
    if (target.account_state !== 'managed') {
      throw new HouseholdError(409, 'member_has_login', `${target.first_name ?? 'This member'} signs in with their own account already.`);
    }
    const open = await tx.query(
      `SELECT 1 FROM v_household_invitation WHERE member_id = $1 AND status_code = 'open'`, [memberId]
    );
    if (open.rows.length) throw new HouseholdError(409, 'link_open', 'This member already has a join link to share.');
    const link = await insertOpenLink(tx, household.id, memberId, actorUserId);
    await recordEvent(tx, { householdId: household.id, memberId, kind: 'link_created', source: 'customer', actorUserId, detail: { invitation_id: link.invitationId } });
    return link;
  });
}

export async function revokeLink(actorUserId: string, invitationId: string): Promise<void> {
  return run(async tx => {
    const { me, household } = await actorContext(tx, actorUserId);
    if (!me.can_administer) throw notAdmin();
    const inv = await tx.query<{ household_id: string; member_id: string | null; status_code: string | null }>(
      `SELECT household_id, member_id, status_code FROM v_household_invitation WHERE invitation_id = $1`, [invitationId]
    );
    const row = inv.rows[0];
    if (!row || row.household_id !== household.id) throw new HouseholdError(404, 'link_not_found', 'We could not find that join link.');
    if (row.status_code !== 'open') return; // already closed: nothing to do, same answer twice
    await tx.query(
      `UPDATE household_invitation SET status_id = (SELECT id FROM household_invitation_status WHERE code = 'revoked'),
              revoked_at = timezone('utc', now())
       WHERE id = $1`, [invitationId]
    );
    await recordEvent(tx, { householdId: household.id, memberId: row.member_id, kind: 'link_revoked', source: 'customer', actorUserId, detail: { invitation_id: invitationId } });
  });
}

interface LockedLink {
  id: string; household_id: string; member_id: string | null; status_code: string | null;
  status_customer_label: string | null; accepted_by_user_id: string | null;
}
async function lockLink(tx: Tx, token: string): Promise<LockedLink> {
  const r = await tx.query<LockedLink>(
    `SELECT hi.id, hi.household_id, hi.member_id, s.code AS status_code, s.customer_label AS status_customer_label, hi.accepted_by_user_id
     FROM household_invitation hi
     LEFT JOIN household_invitation_status s ON s.id = hi.status_id
     WHERE hi.token = $1 FOR UPDATE OF hi`, [token]
  );
  if (!r.rows[0]) throw new HouseholdError(404, 'link_not_found', 'We could not find that join link.');
  return r.rows[0];
}
const linkClosed = (l: LockedLink) => new HouseholdError(410, 'link_closed', 'This join link can no longer be used. Ask your household admin for a new one.', { statusLabel: l.status_customer_label });

/**
 * End `member`'s membership (status left). An admin may leave only when another
 * admin stays or nobody else does; a house subscription that is still active
 * blocks it (cancel-on-leave arrives with household brief 3). The last member
 * out closes the household.
 */
async function leaveInTx(tx: Tx, member: MemberRow, actorUserId: string, detail: Record<string, unknown> = {}): Promise<void> {
  const others = (await activeCount(tx, member.household_id)) - 1;
  const remainingAdmins = await otherAdmins(tx, member.household_id, member.member_id);
  if (member.can_administer && others > 0 && remainingAdmins.length === 0) throw transferFirst();
  if (await hasActiveHouseSubscription(tx, member.household_id)) throw subscriptionActive();
  await endMember(tx, member.member_id, 'left');
  await recordEvent(tx, { householdId: member.household_id, memberId: member.member_id, kind: 'member_left', source: 'customer', actorUserId, detail });
  if (others === 0) {
    await tx.query(`UPDATE household SET dissolved_at = timezone('utc', now()), updated_at = timezone('utc', now()) WHERE id = $1`, [member.household_id]);
    await recordEvent(tx, { householdId: member.household_id, kind: 'dissolved', source: 'customer', actorUserId, detail: { reason: 'last_member_left' } });
  } else if (member.can_administer) {
    // The leaver paid; the household's pay pointer follows the admin who stays (D21: it moves with the admin role).
    await tx.query(
      `UPDATE household SET primary_billing_user_id = $2, updated_at = timezone('utc', now())
       WHERE id = $1 AND primary_billing_user_id = $3`,
      [member.household_id, remainingAdmins[0].user_id, member.user_id]
    );
  }
}

export interface AcceptResult { householdId: string; memberId: string; claimed: boolean; leftHouseholdId: string | null }

/**
 * Accept a join link (D14: the holder may accept). Idempotent: the same token
 * and account twice returns the same result. A managed member is claimed: the
 * managed profile is linked to the accepting account (customerFacts, how =
 * household_claim) and the member row moves to that account, roles unchanged.
 * An acceptor in another household leaves it first (D23).
 */
export async function accept(token: string, acceptingUserId: string): Promise<AcceptResult> {
  return run(async tx => {
    const link = await lockLink(tx, token);
    if (link.status_code === 'accepted' && link.accepted_by_user_id === acceptingUserId) {
      const m = link.member_id ? await memberById(tx, link.member_id) : await activeMemberOf(tx, acceptingUserId);
      return { householdId: link.household_id, memberId: m?.member_id ?? '', claimed: Boolean(link.member_id), leftHouseholdId: null };
    }
    if (link.status_code !== 'open') throw linkClosed(link);
    const household = await lockHousehold(tx, link.household_id);
    if (household.dissolved_at) throw linkClosed(link);

    const current = await activeMemberOf(tx, acceptingUserId);
    if (current?.household_id === household.id) {
      throw new HouseholdError(409, 'already_member', 'You are already in this household.');
    }
    let leftHouseholdId: string | null = null;
    if (current) {
      await lockHousehold(tx, current.household_id);
      await leaveInTx(tx, current, acceptingUserId, { reason: 'joined_another_household', joined_household_id: household.id });
      leftHouseholdId = current.household_id;
    }

    let memberId: string;
    let claimed = false;
    if (link.member_id) {
      const target = await memberById(tx, link.member_id);
      if (!target || target.status_code !== 'active' || target.account_state !== 'managed') throw linkClosed(link);
      await record.identityLink({
        userId: target.user_id, fromUserId: target.user_id, toUserId: acceptingUserId, how: 'household_claim',
        source: 'onsite', sourceId: `household_invitation:${link.id}`,
      }, tx);
      await tx.query(
        `UPDATE household_member SET user_id = $2, updated_at = timezone('utc', now()) WHERE id = $1`,
        [target.member_id, acceptingUserId]
      );
      memberId = target.member_id;
      claimed = true;
    } else {
      memberId = await insertMember(tx, household.id, acceptingUserId);
      await grantRoleRow(tx, memberId, 'household', null);
    }
    await tx.query(
      `UPDATE household_invitation SET status_id = (SELECT id FROM household_invitation_status WHERE code = 'accepted'),
              accepted_by_user_id = $2
       WHERE id = $1`, [link.id, acceptingUserId]
    );
    await recordEvent(tx, { householdId: household.id, memberId, kind: 'link_accepted', source: 'customer', actorUserId: acceptingUserId, detail: { invitation_id: link.id } });
    if (claimed) {
      await recordEvent(tx, { householdId: household.id, memberId, kind: 'member_claimed', source: 'customer', actorUserId: acceptingUserId, detail: { invitation_id: link.id } });
    }
    return { householdId: household.id, memberId, claimed, leftHouseholdId };
  });
}

/** Decline on the join page (public: the holder may decline). The member stays for the admin to order for (D34). */
export async function decline(token: string): Promise<void> {
  return run(async tx => {
    const link = await lockLink(tx, token);
    if (link.status_code === 'declined') return;
    if (link.status_code !== 'open') throw linkClosed(link);
    await tx.query(
      `UPDATE household_invitation SET status_id = (SELECT id FROM household_invitation_status WHERE code = 'declined'),
              declined_at = timezone('utc', now())
       WHERE id = $1`, [link.id]
    );
    await recordEvent(tx, { householdId: link.household_id, memberId: link.member_id, kind: 'link_declined', source: 'customer', detail: { invitation_id: link.id } });
  });
}

// ── roles ────────────────────────────────────────────────────────────────────

/** Whether the actor may set `role` on `target`: their own role where member_may_self_set, another's where they administer and admin_may_set. */
function maySet(me: MemberRow, target: MemberRow, role: RoleRow): boolean {
  if (target.member_id === me.member_id && role.member_may_self_set) return true;
  return me.can_administer && role.admin_may_set;
}

export async function grantRole(actorUserId: string, memberId: string, roleCode: string): Promise<{ changed: boolean }> {
  return run(async tx => {
    const { me, household } = await actorContext(tx, actorUserId);
    const target = await targetIn(tx, memberId, household.id);
    const role = await roleByCode(tx, roleCode);
    if (!maySet(me, target, role)) throw new HouseholdError(403, 'role_not_allowed', `You cannot change ${role.customer_label} for this member.`);
    const changed = await grantRoleRow(tx, memberId, role.code, actorUserId);
    if (changed) await recordEvent(tx, { householdId: household.id, memberId, kind: 'role_granted', source: 'customer', actorUserId, detail: { role: role.code } });
    return { changed };
  });
}

export async function revokeRole(actorUserId: string, memberId: string, roleCode: string): Promise<{ changed: boolean }> {
  return run(async tx => {
    const { me, household } = await actorContext(tx, actorUserId);
    const target = await targetIn(tx, memberId, household.id);
    const role = await roleByCode(tx, roleCode);
    if (!maySet(me, target, role)) throw new HouseholdError(403, 'role_not_allowed', `You cannot change ${role.customer_label} for this member.`);
    if (!target.role_codes.includes(role.code)) return { changed: false };
    if (target.role_codes.length <= 1) throw new HouseholdError(409, 'last_role', 'Every member keeps at least one role.');
    if (role.can_administer) {
      const stillAdministers = await tx.query(
        `SELECT 1 FROM household_member hm
         JOIN household_member_status s ON s.id = hm.status_id AND s.code = 'active'
         JOIN household_member_role mr ON mr.member_id = hm.id AND mr.revoked_at IS NULL
         JOIN household_role hr ON hr.id = mr.role_id AND hr.can_administer
         WHERE hm.household_id = $1 AND NOT (hm.id = $2 AND hr.id = $3) LIMIT 1`,
        [household.id, memberId, role.id]
      );
      if (!stillAdministers.rows.length) throw new HouseholdError(409, 'last_admin', `Every household keeps a ${role.customer_label}.`);
    }
    const changed = await revokeRoleRow(tx, memberId, role.code);
    if (changed) await recordEvent(tx, { householdId: household.id, memberId, kind: 'role_revoked', source: 'customer', actorUserId, detail: { role: role.code } });
    return { changed };
  });
}

/** D21: the admin role moves, and the household's pay pointer with it; nothing else moves. */
export async function transferAdmin(actorUserId: string, toMemberId: string): Promise<{ paysUserId: string; paysFirstName: string | null }> {
  return run(async tx => {
    const { me, household } = await actorContext(tx, actorUserId);
    if (!me.role_codes.includes('admin')) throw notAdmin();
    const target = await targetIn(tx, toMemberId, household.id);
    if (target.member_id === me.member_id) throw new HouseholdError(400, 'transfer_to_self', 'Choose another member to hand the admin role to.');
    await grantRoleRow(tx, target.member_id, 'admin', actorUserId);
    await revokeRoleRow(tx, me.member_id, 'admin');
    // Every member keeps at least one role: an admin-only actor stays in the box.
    if (me.role_codes.length === 1) await grantRoleRow(tx, me.member_id, 'household', actorUserId);
    await tx.query(
      `UPDATE household SET primary_billing_user_id = $2, updated_at = timezone('utc', now()) WHERE id = $1`,
      [household.id, target.user_id]
    );
    await recordEvent(tx, {
      householdId: household.id, memberId: target.member_id, kind: 'admin_transferred', source: 'customer', actorUserId,
      detail: { from_member_id: me.member_id, to_member_id: target.member_id },
    });
    return { paysUserId: target.user_id, paysFirstName: target.first_name };
  });
}

// ── leave, remove, dissolve ──────────────────────────────────────────────────

export async function leave(actorUserId: string): Promise<void> {
  return run(async tx => {
    const { me } = await actorContext(tx, actorUserId);
    await leaveInTx(tx, me, actorUserId);
  });
}

export async function removeMember(actorUserId: string, memberId: string): Promise<void> {
  return run(async tx => {
    const { me, household } = await actorContext(tx, actorUserId);
    if (!me.can_administer) throw notAdmin();
    const target = await targetIn(tx, memberId, household.id);
    if (target.member_id === me.member_id) throw new HouseholdError(400, 'remove_self', 'Use Leave to step out of the household yourself.');
    await endMember(tx, target.member_id, 'removed');
    const closed = await closeOpenLink(tx, target.member_id);
    if (closed) await recordEvent(tx, { householdId: household.id, memberId: target.member_id, kind: 'link_revoked', source: 'customer', actorUserId, detail: { invitation_id: closed, reason: 'member_removed' } });
    await recordEvent(tx, { householdId: household.id, memberId: target.member_id, kind: 'member_removed', source: 'customer', actorUserId });
    // The removed member paid (an admin removing another admin): the pointer stays with the actor.
    if (household.primary_billing_user_id === target.user_id) {
      await tx.query(`UPDATE household SET primary_billing_user_id = $2, updated_at = timezone('utc', now()) WHERE id = $1`, [household.id, me.user_id]);
    }
  });
}

export async function dissolve(actorUserId: string): Promise<void> {
  return run(async tx => {
    const { me, household } = await actorContext(tx, actorUserId);
    if (!me.can_administer) throw notAdmin();
    if ((await activeCount(tx, household.id)) > 1) {
      throw new HouseholdError(409, 'members_remain', 'Close the household once you are its only member.');
    }
    if (await hasActiveHouseSubscription(tx, household.id)) throw subscriptionActive();
    await endMember(tx, me.member_id, 'left');
    await tx.query(`UPDATE household SET dissolved_at = timezone('utc', now()), updated_at = timezone('utc', now()) WHERE id = $1`, [household.id]);
    await recordEvent(tx, { householdId: household.id, memberId: me.member_id, kind: 'dissolved', source: 'customer', actorUserId });
  });
}
