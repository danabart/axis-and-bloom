// Family Household 1, B3 (2026-11-07) — every household read, from the
// v_household_* views only (G2.5). Join-link tokens leave this module only
// for a member who administers the household (the tab's Share / Copy).
// backend/src/features/household/CLAUDE_CODE_PROMPT_HOUSEHOLD_1_FOUNDATION_AND_JOIN_LINKS.md
import { db } from '../db/client.js';
import { householdParam } from './householdParameters.js';

/** The profile id behind a Firebase uid, or null (no /sync yet). */
export async function profileIdForUid(uid: string): Promise<string | null> {
  const r = await db.query<{ id: string }>(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [uid]);
  return r.rows[0]?.id ?? null;
}

export interface HouseholdRoleView {
  code: string; label: string; customer_label: string; sort_order: number;
  can_administer: boolean; in_house_box: boolean; self_manages_cycle: boolean; may_turn_dials: boolean;
  admin_may_set: boolean; member_may_self_set: boolean;
}

/** The role lookup with labels and flags, for the UI (G4.2). */
export async function roles(): Promise<HouseholdRoleView[]> {
  const r = await db.query<HouseholdRoleView>(
    `SELECT code, label, customer_label, sort_order, can_administer, in_house_box, self_manages_cycle,
            may_turn_dials, admin_may_set, member_may_self_set
     FROM household_role ORDER BY sort_order`
  );
  return r.rows;
}

interface MemberView {
  member_id: string; user_id: string; first_name: string | null; status_code: string; status_label: string;
  role_codes: string[]; can_administer: boolean; in_house_box: boolean; self_manages_cycle: boolean;
  may_turn_dials: boolean; account_state: 'login' | 'managed'; archetype_name: string | null;
  quiz_state: 'none' | 'own'; open_link_id: string | null; open_link_token: string | null;
  open_link_created_at: string | null; joined_at: string; ended_at: string | null;
}

const MEMBER_SELECT = `member_id, user_id, first_name, status_code, status_label, role_codes, can_administer,
  in_house_box, self_manages_cycle, may_turn_dials, account_state, archetype_name, quiz_state,
  open_link_id, open_link_token, open_link_created_at, joined_at, ended_at`;

/** The household the user is an active member of, with members, my roles, recent events and the limits the UI needs; null when none. */
export async function mine(userId: string) {
  const meRow = await db.query<{ member_id: string; household_id: string }>(
    `SELECT member_id, household_id FROM v_household_member WHERE user_id = $1 AND status_code = 'active'`, [userId]
  );
  const mine = meRow.rows[0];
  if (!mine) return null;
  const [household, members, events, maxMembers] = await Promise.all([
    db.query(`SELECT household_id, household_name, admin_user_id, admin_first_name, pays_user_id, pays_first_name,
                     active_member_count, created_at
              FROM v_household WHERE household_id = $1`, [mine.household_id]),
    db.query<MemberView>(
      `SELECT ${MEMBER_SELECT} FROM v_household_member
       WHERE household_id = $1 AND status_code = 'active' ORDER BY can_administer DESC, joined_at`, [mine.household_id]
    ),
    db.query(`SELECT event_id, kind_code, kind_label, actor_first_name, member_first_name, created_at
              FROM v_household_event WHERE household_id = $1 ORDER BY created_at DESC LIMIT 30`, [mine.household_id]),
    householdParam('max_members'),
  ]);
  const me = members.rows.find(m => m.member_id === mine.member_id)!;
  const isAdmin = Boolean(me?.can_administer);
  return {
    household: household.rows[0],
    me: { memberId: me.member_id, roleCodes: me.role_codes, canAdminister: isAdmin },
    // D10: members see each other's first name and archetype name, nothing deeper.
    members: members.rows.map(m => ({
      memberId: m.member_id,
      firstName: m.first_name,
      isMe: m.member_id === mine.member_id,
      roleCodes: m.role_codes,
      accountState: m.account_state,
      archetypeName: m.archetype_name,
      quizState: m.quiz_state,
      joinedAt: m.joined_at,
      ...(isAdmin ? {
        openLink: m.open_link_id ? { invitationId: m.open_link_id, token: m.open_link_token, createdAt: m.open_link_created_at } : null,
      } : {}),
    })),
    events: events.rows,
    limits: { maxMembers },
  };
}

/** What the join page shows for a token (public). viewerUserId adds the D23 "you will leave <name>" line. */
export async function peekLink(token: string, viewerUserId: string | null) {
  const r = await db.query<{
    invitation_id: string; household_id: string; household_name: string | null; member_first_name: string | null;
    status_code: string | null; status_customer_label: string | null; dissolved: boolean;
  }>(
    `SELECT vi.invitation_id, vi.household_id, vi.household_name, vi.member_first_name, vi.status_code, vi.status_customer_label,
            (vh.dissolved_at IS NOT NULL) AS dissolved
     FROM v_household_invitation vi
     JOIN v_household vh ON vh.household_id = vi.household_id
     WHERE vi.token = $1`, [token]
  );
  const link = r.rows[0];
  if (!link) return null;
  let viewer: { alreadyMember: boolean; leavesHousehold: string | null } | null = null;
  if (viewerUserId) {
    const cur = await db.query<{ household_id: string; household_name: string | null }>(
      `SELECT vm.household_id, vh.household_name FROM v_household_member vm
       JOIN v_household vh ON vh.household_id = vm.household_id
       WHERE vm.user_id = $1 AND vm.status_code = 'active'`, [viewerUserId]
    );
    const c = cur.rows[0];
    viewer = {
      alreadyMember: c?.household_id === link.household_id,
      leavesHousehold: c && c.household_id !== link.household_id ? (c.household_name ?? '') : null,
    };
  }
  return {
    householdName: link.household_name,
    memberFirstName: link.member_first_name,
    statusCode: link.status_code,
    statusLabel: link.status_customer_label,
    open: link.status_code === 'open' && !link.dissolved,
    viewer,
  };
}

// ── admin portal (D17) ───────────────────────────────────────────────────────

export async function listHouseholds() {
  const r = await db.query(
    `SELECT household_id, household_name, admin_first_name, pays_first_name, active_member_count, dissolved_at, created_at
     FROM v_household ORDER BY created_at DESC`
  );
  return r.rows;
}

export async function household(householdId: string) {
  const [h, members, links, events] = await Promise.all([
    db.query(`SELECT * FROM v_household WHERE household_id = $1`, [householdId]),
    db.query(
      `SELECT member_id, user_id, first_name, status_code, status_label, role_codes, account_state, archetype_name,
              quiz_state, joined_at, ended_at
       FROM v_household_member WHERE household_id = $1 ORDER BY ended_at NULLS FIRST, joined_at`, [householdId]
    ),
    db.query(
      `SELECT invitation_id, member_id, member_first_name, status_code, status_label, created_at, accepted_by_user_id, declined_at, revoked_at
       FROM v_household_invitation WHERE household_id = $1 ORDER BY created_at DESC`, [householdId]
    ),
    db.query(
      `SELECT event_id, kind_code, kind_label, source_code, source_label, actor_first_name, member_first_name, detail, created_at
       FROM v_household_event WHERE household_id = $1 ORDER BY created_at DESC LIMIT 200`, [householdId]
    ),
  ]);
  if (!h.rows[0]) return null;
  return { household: h.rows[0], members: members.rows, links: links.rows, events: events.rows };
}
