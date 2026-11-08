// Family Household 1, B3 (2026-11-07) — every household read, from the
// v_household_* views only (G2.5). Join-link tokens leave this module only
// for a member who administers the household (the tab's Share / Copy).
// backend/src/features/household/CLAUDE_CODE_PROMPT_HOUSEHOLD_1_FOUNDATION_AND_JOIN_LINKS.md
import { db } from '../db/client.js';
import { householdParam } from './householdParameters.js';
import { getDialTurnsByOthers } from './customerReads.js';
import { resolveDrinkerLine } from './subscriptionShipment.js';
import { commerceParam } from './commerceParameters.js';

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

interface StateLabel { code: string; label: string; customer_label: string }

/**
 * Family Household 2 (OT-104): every word the tab shows for a role or a state.
 * `{actor}` in a quiz-state customer_label is filled by `mine` with the first
 * name of whoever answered.
 */
export async function lookups(): Promise<{ roles: HouseholdRoleView[]; accountStates: StateLabel[]; quizStates: StateLabel[] }> {
  const [roleRows, accountStates, quizStates] = await Promise.all([
    roles(),
    db.query<StateLabel>(`SELECT code, label, customer_label FROM household_account_state ORDER BY id`),
    db.query<StateLabel>(`SELECT code, label, customer_label FROM household_quiz_state ORDER BY id`),
  ]);
  return { roles: roleRows, accountStates: accountStates.rows, quizStates: quizStates.rows };
}

interface MemberView {
  member_id: string; user_id: string; first_name: string | null; status_code: string; status_label: string;
  role_codes: string[]; can_administer: boolean; in_house_box: boolean; self_manages_cycle: boolean;
  may_turn_dials: boolean; account_state: 'login' | 'managed'; archetype_name: string | null; archetype_code: string | null;
  quiz_state: 'none' | 'by_admin' | 'own'; quiz_taken_by_first_name: string | null;
  dial_slot_id: number | null; dial_sort_order: number | null; dial_slot_name: string | null; claim_link_id: string | null;
  in_house_subscription: boolean; own_plan_active: boolean;
  open_link_id: string | null; open_link_token: string | null;
  open_link_created_at: string | null; joined_at: string; ended_at: string | null;
}

const MEMBER_SELECT = `vm.member_id, vm.user_id, vm.first_name, vm.status_code, vm.status_label, vm.role_codes, vm.can_administer,
  vm.in_house_box, vm.self_manages_cycle, vm.may_turn_dials, vm.account_state, vm.archetype_name, vm.archetype_code,
  vm.quiz_state, vm.quiz_taken_by_first_name, vm.dial_slot_id, cds.sort_order AS dial_sort_order, cds.name AS dial_slot_name,
  vm.claim_link_id, vm.open_link_id, vm.open_link_token, vm.open_link_created_at, vm.joined_at, vm.ended_at,
  vm.in_house_subscription, vm.own_plan_active`;

const fill = (label: string, actor: string | null) => label.replace('{actor}', actor ?? 'another member');

/** The household the user is an active member of, with members, my roles, recent events and the limits the UI needs; null when none. */
export async function mine(userId: string) {
  const meRow = await db.query<{ member_id: string; household_id: string }>(
    `SELECT member_id, household_id FROM v_household_membership WHERE user_id = $1 AND status_code = 'active'`, [userId]
  );
  const mine = meRow.rows[0];
  if (!mine) return null;
  const [household, members, events, maxMembers, quizForEnabled, words] = await Promise.all([
    db.query(`SELECT household_id, household_name, admin_user_id, admin_first_name, pays_user_id, pays_first_name,
                     active_member_count, created_at
              FROM v_household WHERE household_id = $1`, [mine.household_id]),
    db.query<MemberView>(
      `SELECT ${MEMBER_SELECT} FROM v_household_member vm
       LEFT JOIN coffee_dial_slot cds ON cds.id = vm.dial_slot_id
       WHERE vm.household_id = $1 AND vm.status_code = 'active' ORDER BY vm.can_administer DESC, vm.joined_at`, [mine.household_id]
    ),
    db.query(`SELECT event_id, kind_code, kind_label, actor_first_name, member_first_name, created_at
              FROM v_household_event WHERE household_id = $1 ORDER BY created_at DESC LIMIT 30`, [mine.household_id]),
    householdParam('max_members'),
    householdParam('quiz_for_member_enabled'),
    lookups(),
  ]);
  const me = members.rows.find(m => m.member_id === mine.member_id)!;
  const isAdmin = Boolean(me?.can_administer);
  const accountWord = new Map(words.accountStates.map(w => [w.code, w.customer_label]));
  const quizWord = new Map(words.quizStates.map(w => [w.code, w.customer_label]));
  return {
    household: household.rows[0],
    me: { memberId: me.member_id, roleCodes: me.role_codes, canAdminister: isAdmin, mayTurnDials: me.may_turn_dials },
    // D10: members see each other's first name and archetype name, nothing deeper.
    members: members.rows.map(m => {
      const isMe = m.member_id === mine.member_id;
      const mayQuizFor = isAdmin && !isMe && quizForEnabled === 1 && m.quiz_state !== 'own';
      const mayTurnDialFor = Boolean(me.may_turn_dials) && !isMe && Boolean(m.archetype_code);
      const name = m.first_name ?? '';
      return {
        memberId: m.member_id,
        firstName: m.first_name,
        isMe,
        roleCodes: m.role_codes,
        accountState: { code: m.account_state, label: accountWord.get(m.account_state) ?? m.account_state },
        archetypeName: m.archetype_name,
        archetypeCode: m.archetype_code,
        quizState: { code: m.quiz_state, label: fill(quizWord.get(m.quiz_state) ?? m.quiz_state, m.quiz_taken_by_first_name) },
        dial: m.dial_slot_id ? { slotId: m.dial_slot_id, sortOrder: m.dial_sort_order, name: m.dial_slot_name } : null,
        joinedAt: m.joined_at,
        inHouseBox: m.in_house_box,
        inHouseSubscription: m.in_house_subscription,
        ownPlanActive: m.own_plan_active,
        mayQuizFor,
        mayTurnDialFor,
        // D25: the member themselves or an administrator; never a member who administers (transfer first).
        mayUnlink: Boolean(m.claim_link_id) && (isAdmin || isMe) && !m.can_administer,
        unlinkConfirm: m.claim_link_id
          ? `Unlink ${name}'s sign-in? ${name} goes back to a profile you set up, with the quiz and dial it had; their own account leaves the household.`
          : null,
        ...(mayQuizFor ? {
          proxyQuiz: {
            header: `Profiling ${name}`,
            shareLine: `Send ${name} the link so they can see their result and take over their profile.`,
            joinToken: m.open_link_token,
          },
        } : {}),
        ...(isAdmin ? {
          openLink: m.open_link_id ? { invitationId: m.open_link_id, token: m.open_link_token, createdAt: m.open_link_created_at } : null,
        } : {}),
      };
    }),
    events: events.rows,
    limits: { maxMembers },
    // Family Household 3: the house subscription (who pays, what ships next, for whom) and my open handover offer.
    houseSubscription: await houseSubscriptionView(mine.household_id, userId, isAdmin, members.rows),
    handoverOffer: await handoverOfferView(userId),
  };
}

/**
 * D27: the signed-in member's log of dial turns made by someone else, across
 * their linked profiles, newest first. `undoable` is true on the turn that is
 * still the member's current position and has not been undone.
 */
export async function myLog(userId: string) {
  const rows = await getDialTurnsByOthers(userId);
  return {
    entries: rows.map(e => ({
      dialEventId: e.dial_event_id,
      occurredAt: e.occurred_at,
      line: `${e.actor_first_name ?? 'A household member'} turned the wheel for you and saved ${e.slot_name ?? 'a position'}.`,
      undone: e.undone,
      undoable: e.is_current && !e.undone,
    })),
    emptyText: 'When someone in your household turns your dial for you, it shows here, with Undo.',
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
      `SELECT vm.household_id, vh.household_name FROM v_household_membership vm
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
    `SELECT household_id, household_name, admin_first_name, pays_first_name, active_member_count, proxy_quiz_count, dissolved_at, created_at
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
  // Family Household 3 (C4): the house subscription and its live items.
  const houseItems = h.rows[0].house_subscription_id ? (await db.query(
    `SELECT item_id, signup_name, weight_oz, quantity, drinker_first_name, intended_for_user_id, created_at
     FROM v_subscription_item WHERE subscription_id = $1 AND ended_at IS NULL ORDER BY created_at, item_id`, [h.rows[0].house_subscription_id]
  )).rows : [];
  return { household: h.rows[0], members: members.rows, links: links.rows, events: events.rows, houseItems };
}

// ── Family Household 3 (2026-11-07) ──────────────────────────────────────────

type Q = { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> };

/** The household the profile is an active member of (CTO call 1: an order carries it), or null. */
export async function activeHouseholdOf(userId: string, runner: Q = db): Promise<string | null> {
  const r = await runner.query(
    `SELECT household_id FROM v_household_membership WHERE user_id = $1 AND status_code = 'active'`, [userId]
  );
  return r.rows[0]?.household_id ?? null;
}

/** D22: an open handover offer for this profile (inside the window, not yet used), with the perk. */
export async function openHandoverOffer(userId: string, runner: Q = db): Promise<{ eventId: string; pct: number; expiresAt: string } | null> {
  const r = await runner.query(
    `SELECT e.event_id, e.detail ->> 'expires_at' AS expires_at
     FROM v_household_event e
     WHERE e.kind_code = 'handover_offered' AND e.detail ->> 'member_user_id' = $1
       AND (e.detail ->> 'expires_at')::timestamptz > now()
       AND NOT EXISTS (SELECT 1 FROM v_household_event r
                        WHERE r.kind_code = 'handover_redeemed' AND r.detail ->> 'offer_event_id' = e.event_id::text)
     ORDER BY e.created_at DESC LIMIT 1`, [userId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return { eventId: row.event_id, pct: await householdParam('household_handover_discount_pct'), expiresAt: row.expires_at };
}

async function houseSubscriptionView(householdId: string, viewerId: string, viewerAdministers: boolean, members: MemberView[]) {
  const h = (await db.query<{ house_subscription_id: string | null; pays_user_id: string | null; pays_first_name: string | null }>(
    `SELECT house_subscription_id, pays_user_id, pays_first_name FROM v_household WHERE household_id = $1`, [householdId]
  )).rows[0];
  if (!h?.house_subscription_id) return null;
  const sub = (await db.query<{ status: string; customer_label: string | null; frequency_weeks: number | null; next_delivery_date: string | null; bag_count: string }>(
    `SELECT status, customer_label, frequency_weeks, next_delivery_date::text AS next_delivery_date, bag_count
     FROM v_subscription_status WHERE subscription_id = $1`, [h.house_subscription_id]
  )).rows[0];
  const items = (await db.query<{ item_id: string; signup_name: string | null; weight_oz: string; quantity: number; drinker_first_name: string | null; intended_for_user_id: string | null }>(
    `SELECT item_id, signup_name, weight_oz, quantity, drinker_first_name, intended_for_user_id
     FROM v_subscription_item WHERE subscription_id = $1 AND ended_at IS NULL ORDER BY created_at, item_id`, [h.house_subscription_id]
  )).rows;
  const canEdit = viewerAdministers || h.pays_user_id === viewerId;
  return {
    id: h.house_subscription_id,
    paysFirstName: h.pays_first_name,
    status: sub?.status ?? null,
    statusLabel: sub?.customer_label ?? null,
    frequencyWeeks: sub?.frequency_weeks ?? null,
    nextDeliveryDate: sub?.next_delivery_date ?? null,
    bagCount: Number(sub?.bag_count ?? 0),
    items: items.map(i => ({
      itemId: i.item_id, name: i.signup_name, weightOz: Number(i.weight_oz), quantity: i.quantity,
      // A bag for a member follows their own quiz and dial at each renewal (T2); the subscriber's bag shows its signup name.
      forFirstName: i.intended_for_user_id ? i.drinker_first_name : h.pays_first_name,
      followsMember: Boolean(i.intended_for_user_id),
    })),
    canEdit,
    // Members a bag can be added for (D12): in the household box, other than the subscriber.
    addableFor: canEdit
      ? members.filter(m => m.in_house_box && m.status_code === 'active' && m.user_id !== h.pays_user_id).map(m => ({ userId: m.user_id, firstName: m.first_name }))
      : [],
    weightOz: await householdParam('house_box_weight_oz'),
  };
}

async function handoverOfferView(userId: string) {
  const offer = await openHandoverOffer(userId);
  if (!offer) return null;
  const until = new Date(offer.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/New_York' });
  return {
    pct: offer.pct,
    expiresAt: offer.expiresAt,
    line: `Start a subscription by ${until} and your first box takes an extra ${offer.pct}% on top of the subscription price.`,
  };
}

/** The cart's "For" choices (C1): the buyer first, then the in-box members of their household; empty outside a household. */
export async function recipients(userId: string): Promise<Array<{ userId: string; firstName: string | null; isMe: boolean }>> {
  const r = await db.query<{ user_id: string; first_name: string | null }>(
    `SELECT vm.user_id, vm.first_name FROM v_household_membership vm
     JOIN v_household_membership me ON me.household_id = vm.household_id AND me.user_id = $1 AND me.status_code = 'active'
     WHERE vm.status_code = 'active' AND (vm.in_house_box OR vm.user_id = $1)
     ORDER BY (vm.user_id = $1) DESC, vm.joined_at`, [userId]
  );
  return r.rows.map(m => ({ userId: m.user_id, firstName: m.first_name, isMe: m.user_id === userId }));
}

/**
 * B7, Build the house box: for every active in-box member, house_box_bags_per_member
 * bag(s) of house_box_weight_oz at their current match, by the renewal's own rule
 * (subscriptionShipment.resolveDrinkerLine), so the cart and the renewal agree.
 * A member with no quiz gets no line and needsQuiz (the admin may still add
 * any coffee for them by hand, G2.19); ownPlanActive marks D30. Nothing is
 * ordered here.
 */
export async function houseBox(userId: string) {
  const meRow = (await db.query<{ household_id: string; can_administer: boolean }>(
    `SELECT household_id, can_administer FROM v_household_membership WHERE user_id = $1 AND status_code = 'active'`, [userId]
  )).rows[0];
  if (!meRow) return null;
  const [bags, weightOz, followDial] = await Promise.all([
    householdParam('house_box_bags_per_member'),
    householdParam('house_box_weight_oz'),
    commerceParam('subscription_ships_current_dial_position').then(v => v === 1),
  ]);
  const members = (await db.query<{ member_id: string; user_id: string; first_name: string | null; quiz_state: string; own_plan_active: boolean }>(
    `SELECT member_id, user_id, first_name, quiz_state, own_plan_active FROM v_household_member
     WHERE household_id = $1 AND status_code = 'active' AND in_house_box ORDER BY (user_id = $2) DESC, joined_at`, [meRow.household_id, userId]
  )).rows;
  const out = [];
  for (const m of members) {
    const r = m.quiz_state === 'none' ? null : await resolveDrinkerLine(m.member_id, m.user_id, meRow.household_id, weightOz, bags, followDial, null);
    const line = r && !('reason' in r) ? r : null;
    out.push({
      memberId: m.member_id,
      userId: m.user_id,
      firstName: m.first_name,
      isMe: m.user_id === userId,
      needsQuiz: m.quiz_state === 'none',
      ownPlanActive: m.own_plan_active,
      unavailable: r && 'reason' in r ? r.reason : null,
      line: line ? {
        kind: 'dial' as const, archetype: line.archetype!, archetypeLabel: line.archetypeLabel, dialSortOrder: line.dialSortOrder!,
        weightOz: line.weightOz, platformName: line.displayName, retailPriceCents: line.fullPriceCents, qty: line.quantity,
        intendedForUserId: m.user_id, intendedForName: m.first_name,
      } : null,
    });
  }
  return { canAdminister: meRow.can_administer, members: out };
}

/** D19: the admin numbers card (v_household_numbers, one row). */
export async function numbers() {
  return (await db.query(`SELECT * FROM v_household_numbers`)).rows[0];
}
