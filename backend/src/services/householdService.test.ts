// Family Household 1, Part D (2026-11-07) — the household rules against the
// real test database (axisandbloom_test, schema applied twice by
// globalSetup). householdService commits its own transactions, so every
// fixture carries the run's prefix and afterAll removes exactly those rows
// (test hygiene on the test database only; production code never deletes).
// backend/src/features/household/CLAUDE_CODE_PROMPT_HOUSEHOLD_1_FOUNDATION_AND_JOIN_LINKS.md
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const { db } = await import('../db/client.js');
const hs = await import('./householdService.js');
const reads = await import('./householdReads.js');
const params = await import('./householdParameters.js');
const { hasLiamAccess } = await import('./liamAccess.js');
const { resolveIntendedFor } = await import('./checkoutService.js');

const RUN = `vitest-hh1-${Date.now()}`;
const fixtureProfiles: string[] = [];
const fixtureHouseholds: string[] = [];

async function profile(tag: string, firstName = tag): Promise<{ id: string; uid: string }> {
  const uid = `${RUN}-${tag}`;
  const r = await db.query<{ id: string }>(
    `INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, $2) RETURNING id`, [uid, firstName]
  );
  fixtureProfiles.push(r.rows[0].id);
  return { id: r.rows[0].id, uid };
}

async function newHousehold(tag: string): Promise<{ adminId: string; householdId: string; memberId: string }> {
  const admin = await profile(`${tag}-admin`, `${tag}Admin`);
  const h = await hs.create(admin.id, `${RUN} ${tag}`);
  fixtureHouseholds.push(h.householdId);
  return { adminId: admin.id, ...h };
}

const member = async (memberId: string) =>
  (await db.query(`SELECT * FROM v_household_member WHERE member_id = $1`, [memberId])).rows[0];
const eventKinds = async (householdId: string) =>
  (await db.query<{ kind_code: string }>(`SELECT kind_code FROM v_household_event WHERE household_id = $1 ORDER BY created_at`, [householdId])).rows.map(r => r.kind_code);
const linkStatus = async (invitationId: string) =>
  (await db.query<{ status_code: string }>(`SELECT status_code FROM v_household_invitation WHERE invitation_id = $1`, [invitationId])).rows[0]?.status_code;

async function expectHouseholdError(p: Promise<unknown>, status: number, code: string): Promise<void> {
  await expect(p).rejects.toMatchObject({ name: 'HouseholdError', status, code });
}

afterAll(async () => {
  const hh = await db.query<{ id: string }>(
    `SELECT DISTINCT household_id AS id FROM household_member WHERE user_id = ANY($1::uuid[])
     UNION SELECT id FROM household WHERE id = ANY($2::uuid[]) OR household_name LIKE $3`,
    [fixtureProfiles, fixtureHouseholds, `${RUN}%`]
  );
  const hhIds = hh.rows.map(r => r.id);
  const members = await db.query<{ user_id: string }>(`SELECT user_id FROM household_member WHERE household_id = ANY($1::uuid[])`, [hhIds]);
  const profiles = [...new Set([...fixtureProfiles, ...members.rows.map(r => r.user_id)])];
  const managed = await db.query<{ id: string }>(
    `SELECT from_user_id AS id FROM customer_identity_link WHERE to_user_id = ANY($1::uuid[]) OR from_user_id = ANY($1::uuid[])`, [profiles]
  );
  const allProfiles = [...new Set([...profiles, ...managed.rows.map(r => r.id)])];
  await db.query(`DELETE FROM customer_identity_unlink WHERE link_id IN (SELECT id FROM customer_identity_link WHERE from_user_id = ANY($1::uuid[]) OR to_user_id = ANY($1::uuid[]))`, [allProfiles]);
  await db.query(`DELETE FROM customer_identity_link WHERE from_user_id = ANY($1::uuid[]) OR to_user_id = ANY($1::uuid[])`, [allProfiles]);
  await db.query(`DELETE FROM household_event WHERE household_id = ANY($1::uuid[])`, [hhIds]);
  await db.query(`DELETE FROM household_invitation WHERE household_id = ANY($1::uuid[])`, [hhIds]);
  await db.query(`DELETE FROM household_member_role WHERE member_id IN (SELECT id FROM household_member WHERE household_id = ANY($1::uuid[]))`, [hhIds]);
  await db.query(`DELETE FROM household_member WHERE household_id = ANY($1::uuid[])`, [hhIds]);
  await db.query(`UPDATE user_profile SET household_id = NULL WHERE id = ANY($1::uuid[])`, [allProfiles]);
  await db.query(`DELETE FROM subscription WHERE household_id = ANY($1::uuid[])`, [hhIds]);
  await db.query(`DELETE FROM household WHERE id = ANY($1::uuid[])`, [hhIds]);
  await db.query(`DELETE FROM user_profile WHERE id = ANY($1::uuid[])`, [allProfiles]);
}, 60000);

describe('seeds', () => {
  it('lookups are seeded', async () => {
    const roles = await db.query(`SELECT code, can_administer, in_house_box, self_manages_cycle, may_turn_dials, admin_may_set, member_may_self_set FROM household_role ORDER BY sort_order`);
    expect(roles.rows).toEqual([
      { code: 'admin', can_administer: true, in_house_box: false, self_manages_cycle: false, may_turn_dials: true, admin_may_set: true, member_may_self_set: false },
      { code: 'household', can_administer: false, in_house_box: true, self_manages_cycle: false, may_turn_dials: true, admin_may_set: true, member_may_self_set: false },
      { code: 'own_plan', can_administer: false, in_house_box: false, self_manages_cycle: true, may_turn_dials: true, admin_may_set: false, member_may_self_set: true },
    ]);
    const codes = async (t: string) => (await db.query<{ code: string }>(`SELECT code FROM ${t} ORDER BY id`)).rows.map(r => r.code);
    expect(await codes('household_member_status')).toEqual(['active', 'left', 'removed']);
    expect(await codes('household_invitation_status')).toEqual(['open', 'accepted', 'declined', 'revoked', 'legacy']);
    expect(await codes('household_event_source')).toEqual(['customer', 'admin', 'system', 'cron']);
    expect((await codes('household_event_kind')).length).toBe(19); // + dial_turn_undone (Household 2)
    const ut = await db.query(`SELECT 1 FROM user_type WHERE name = 'household_managed'`);
    expect(ut.rowCount).toBe(1);
  });

  it('household_parameter seeds are current, and a change supersedes the current row', async () => {
    expect(await params.householdParam('max_members')).toBe(6);
    expect(await params.householdParam('quiz_for_member_enabled')).toBe(1);
    expect(await params.householdParam('house_box_bags_per_member')).toBe(1);
    expect(await params.householdParam('household_handover_discount_pct')).toBe(5);
    expect(await params.householdParam('household_handover_window_days')).toBe(7);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const res = await params.setParameterInTx(client, 'max_members', 8, 'vitest', null);
      expect(res).toMatchObject({ previousValue: 6, value: 8, unchanged: false });
      const rows = await client.query(`SELECT value_numeric, superseded_at FROM household_parameter WHERE key = 'max_members' ORDER BY since`);
      expect(rows.rows.filter(r => r.superseded_at === null).map(r => Number(r.value_numeric))).toEqual([8]);
      await expect(params.setParameterInTx(client, 'max_members', 999, null, null)).rejects.toMatchObject({ code: 'HOUSEHOLD_PARAMETER_INVALID' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

describe('create and add a member', () => {
  it('create twice by the same user → one household, 409 the second time', async () => {
    const h = await newHousehold('create');
    await expectHouseholdError(hs.create(h.adminId, 'second'), 409, 'already_in_household');
    const m = await member(h.memberId);
    expect(m.role_codes).toEqual(['admin', 'household']);
    expect(await eventKinds(h.householdId)).toEqual(['created']);
  });

  it('addMember → managed profile, household role, one open link, events; max_members enforced', async () => {
    const h = await newHousehold('add');
    const tom = await hs.addMember(h.adminId, 'Tom');
    const p = await db.query(`SELECT up.firebase_uid, up.first_name, ut.name FROM user_profile up JOIN user_type ut ON ut.id = up.user_type_id WHERE up.id = $1`, [tom.userId]);
    expect(p.rows[0].firebase_uid.startsWith(hs.MANAGED_UID_PREFIX)).toBe(true);
    expect(p.rows[0]).toMatchObject({ first_name: 'Tom', name: 'household_managed' });
    const m = await member(tom.memberId);
    expect(m).toMatchObject({ role_codes: ['household'], account_state: 'managed', status_code: 'active', open_link_id: tom.invitationId, quiz_state: 'none' });
    expect(tom.token).toMatch(/^[0-9a-f]{64}$/);
    const inv = await db.query(`SELECT invited_email, expires_at, status FROM household_invitation WHERE id = $1`, [tom.invitationId]);
    expect(inv.rows[0]).toEqual({ invited_email: null, expires_at: null, status: null });
    expect(await eventKinds(h.householdId)).toEqual(['created', 'member_added', 'link_created']);
    await expectHouseholdError(hs.createLink(h.adminId, tom.memberId), 409, 'link_open');

    const max = await params.householdParam('max_members');
    for (let i = 2; i < max; i++) await hs.addMember(h.adminId, `Kid${i}`);
    await expectHouseholdError(hs.addMember(h.adminId, 'OneTooMany'), 409, 'household_full');
  });

  it('a non-admin member cannot add members', async () => {
    const h = await newHousehold('nonadmin');
    const spouse = await profile('nonadmin-spouse');
    const link = await hs.addMember(h.adminId, 'Spouse');
    await hs.accept(link.token, spouse.id);
    await expectHouseholdError(hs.addMember(spouse.id, 'Nope'), 403, 'not_household_admin');
  });
});

describe('join links', () => {
  it('accept twice → one claim, one identity link (household_claim), member moved, roles unchanged', async () => {
    const h = await newHousehold('accept');
    const tom = await hs.addMember(h.adminId, 'Tom');
    const account = await profile('accept-tom', '');
    const first = await hs.accept(tom.token, account.id);
    const second = await hs.accept(tom.token, account.id);
    expect(first).toMatchObject({ householdId: h.householdId, memberId: tom.memberId, claimed: true });
    expect(second).toMatchObject({ householdId: h.householdId, memberId: tom.memberId, claimed: true });
    const links = await db.query(`SELECT how, source, source_id, from_user_id, to_user_id FROM customer_identity_link WHERE from_user_id = $1`, [tom.userId]);
    expect(links.rows).toEqual([{ how: 'household_claim', source: 'onsite', source_id: `household_invitation:${tom.invitationId}`, from_user_id: tom.userId, to_user_id: account.id }]);
    const m = await member(tom.memberId);
    // The account had no first name yet: the one the admin typed stands.
    expect(m).toMatchObject({ user_id: account.id, role_codes: ['household'], account_state: 'login', first_name: 'Tom', open_link_id: null });
    const canon = await db.query(`SELECT canonical_user_id FROM v_customer_identity WHERE user_id = $1`, [tom.userId]);
    expect(canon.rows[0].canonical_user_id).toBe(account.id);
    expect(await linkStatus(tom.invitationId)).toBe('accepted');
    const kinds = await eventKinds(h.householdId);
    expect(kinds.filter(k => k === 'member_claimed')).toHaveLength(1);
    expect(kinds.filter(k => k === 'link_accepted')).toHaveLength(1);
    // A second account cannot reuse the accepted link.
    const other = await profile('accept-other');
    await expectHouseholdError(hs.accept(tom.token, other.id), 410, 'link_closed');
  });

  it('accept from a user in another household → that membership left, then joined (D23)', async () => {
    const a = await newHousehold('d23a');
    const b = await newHousehold('d23b');
    const link = await hs.addMember(b.adminId, 'Mover');
    // a's admin is a's only member: leaving closes household a.
    const res = await hs.accept(link.token, a.adminId);
    expect(res.leftHouseholdId).toBe(a.householdId);
    expect((await member(a.memberId)).status_code).toBe('left');
    expect((await member(link.memberId)).user_id).toBe(a.adminId);
    const dissolved = await db.query(`SELECT dissolved_at FROM household WHERE id = $1`, [a.householdId]);
    expect(dissolved.rows[0].dissolved_at).not.toBeNull();
    const peek = await reads.peekLink(link.token, a.adminId);
    expect(peek?.open).toBe(false);
  });

  it('accept by the sole admin of another household with other members → transfer_first, nothing changes', async () => {
    const a = await newHousehold('tfa');
    await hs.addMember(a.adminId, 'Stays');
    const b = await newHousehold('tfb');
    const link = await hs.addMember(b.adminId, 'Wanted');
    await expectHouseholdError(hs.accept(link.token, a.adminId), 409, 'transfer_first');
    expect((await member(a.memberId)).status_code).toBe('active');
    expect(await linkStatus(link.invitationId)).toBe('open');
  });

  it('accept by someone already in the same household → already_member, nothing changes', async () => {
    const h = await newHousehold('same');
    const link = await hs.addMember(h.adminId, 'Ella');
    await expectHouseholdError(hs.accept(link.token, h.adminId), 409, 'already_member');
    expect(await linkStatus(link.invitationId)).toBe('open');
  });

  it('revoked token → 410; a new link can be created; decline keeps the member active', async () => {
    const h = await newHousehold('revoke');
    const ella = await hs.addMember(h.adminId, 'Ella');
    await hs.revokeLink(h.adminId, ella.invitationId);
    expect(await linkStatus(ella.invitationId)).toBe('revoked');
    const stranger = await profile('revoke-stranger');
    await expectHouseholdError(hs.accept(ella.token, stranger.id), 410, 'link_closed');
    const fresh = await hs.createLink(h.adminId, ella.memberId);
    expect(fresh.token).not.toBe(ella.token);
    await hs.decline(fresh.token);
    await hs.decline(fresh.token); // idempotent
    expect(await linkStatus(fresh.invitationId)).toBe('declined');
    expect((await member(ella.memberId)).status_code).toBe('active');
    expect((await eventKinds(h.householdId)).filter(k => k === 'link_declined')).toHaveLength(1);
  });
});

describe('v_customer_identity honours customer_identity_unlink', () => {
  it('an unlink row reverts the canonical id', async () => {
    const from = await profile('unlink-from');
    const to = await profile('unlink-to');
    const link = await db.query<{ id: string }>(
      `INSERT INTO customer_identity_link (user_id, source, source_id, from_user_id, to_user_id, how)
       VALUES ($1, 'onsite', $2, $1, $3, 'admin') RETURNING id`, [from.id, `${RUN}:unlink`, to.id]
    );
    const canon = async () => (await db.query(`SELECT canonical_user_id FROM v_customer_identity WHERE user_id = $1`, [from.id])).rows[0].canonical_user_id;
    expect(await canon()).toBe(to.id);
    await db.query(
      `INSERT INTO customer_identity_unlink (user_id, source, source_id, link_id, reason) VALUES ($1, 'onsite', $2, $3, 'vitest')`,
      [from.id, `${RUN}:unlink`, link.rows[0].id]
    );
    expect(await canon()).toBe(from.id);
  });
});

describe('roles', () => {
  it('last admin and last role cannot be revoked; member_may_self_set respected', async () => {
    const h = await newHousehold('roles');
    await expectHouseholdError(hs.revokeRole(h.adminId, h.memberId, 'admin'), 409, 'last_admin');
    const spouse = await profile('roles-spouse');
    const link = await hs.addMember(h.adminId, 'Spouse');
    await hs.accept(link.token, spouse.id);
    await expectHouseholdError(hs.revokeRole(h.adminId, link.memberId, 'household'), 409, 'last_role');
    // own_plan is the member's to set; household is the admin's.
    expect(await hs.grantRole(spouse.id, link.memberId, 'own_plan')).toEqual({ changed: true });
    expect(await hs.grantRole(spouse.id, link.memberId, 'own_plan')).toEqual({ changed: false });
    await expectHouseholdError(hs.revokeRole(spouse.id, link.memberId, 'household'), 403, 'role_not_allowed');
    expect(await hs.revokeRole(spouse.id, link.memberId, 'own_plan')).toEqual({ changed: true });
    // The admin may not set own_plan on another member (admin_may_set false).
    await expectHouseholdError(hs.grantRole(h.adminId, link.memberId, 'own_plan'), 403, 'role_not_allowed');
    const kinds = await eventKinds(h.householdId);
    expect(kinds.filter(k => k === 'role_granted')).toHaveLength(1);
    expect(kinds.filter(k => k === 'role_revoked')).toHaveLength(1);
  });

  it('transferAdmin moves the admin role and primary_billing_user_id only', async () => {
    const h = await newHousehold('transfer');
    const tomAccount = await profile('transfer-tom');
    const tom = await hs.addMember(h.adminId, 'Tom');
    await hs.accept(tom.token, tomAccount.id);
    const res = await hs.transferAdmin(h.adminId, tom.memberId);
    expect(res.paysUserId).toBe(tomAccount.id);
    expect((await member(tom.memberId)).role_codes).toEqual(['admin', 'household']);
    expect((await member(h.memberId)).role_codes).toEqual(['household']);
    const hh = await db.query(`SELECT primary_billing_user_id, household_name FROM household WHERE id = $1`, [h.householdId]);
    expect(hh.rows[0]).toMatchObject({ primary_billing_user_id: tomAccount.id, household_name: `${RUN} transfer` });
    // And back.
    await hs.transferAdmin(tomAccount.id, h.memberId);
    expect((await member(h.memberId)).role_codes).toEqual(['admin', 'household']);
  });
});

describe('leave, remove, dissolve', () => {
  it('sole admin with other members cannot leave; remove revokes the open link; dissolve refuses with other members', async () => {
    const h = await newHousehold('leave');
    const kid = await hs.addMember(h.adminId, 'Kid');
    await expectHouseholdError(hs.leave(h.adminId), 409, 'transfer_first');
    await expectHouseholdError(hs.dissolve(h.adminId), 409, 'members_remain');
    await hs.removeMember(h.adminId, kid.memberId);
    expect((await member(kid.memberId)).status_code).toBe('removed');
    expect(await linkStatus(kid.invitationId)).toBe('revoked');
    await hs.dissolve(h.adminId);
    const row = await db.query(`SELECT dissolved_at FROM household WHERE id = $1`, [h.householdId]);
    expect(row.rows[0].dissolved_at).not.toBeNull();
    expect((await member(h.memberId)).status_code).toBe('left');
    expect(await reads.mine(h.adminId)).toBeNull();
    const kinds = await eventKinds(h.householdId);
    expect(kinds).toEqual(expect.arrayContaining(['member_removed', 'link_revoked', 'dissolved']));
  });

  it('an active house subscription blocks leave and dissolve (cancel-on-leave is brief 3)', async () => {
    const h = await newHousehold('sub');
    await db.query(`INSERT INTO subscription (user_id, household_id, status) VALUES ($1, $2, 'active')`, [h.adminId, h.householdId]);
    await expectHouseholdError(hs.dissolve(h.adminId), 409, 'subscription_active');
    await expectHouseholdError(hs.leave(h.adminId), 409, 'subscription_active');
  });
});

describe('readers moved to v_household_member', () => {
  it('resolveIntendedFor passes for an active member and refuses a left one; liamAccess follows membership', async () => {
    const h = await newHousehold('readers');
    const spouse = await profile('readers-spouse');
    const link = await hs.addMember(h.adminId, 'Spouse');
    await hs.accept(link.token, spouse.id);
    expect(await resolveIntendedFor(h.adminId, [{ intendedForUserId: spouse.id }])).toBe(spouse.id);
    await db.query(`INSERT INTO subscription (user_id, household_id, status) VALUES ($1, $2, 'active')`, [h.adminId, h.householdId]);
    expect(await hasLiamAccess(spouse.uid)).toEqual({ allowed: true, reason: 'subscriber' });
    // The spouse leaves: the household subscription no longer counts for them.
    await db.query(`DELETE FROM subscription WHERE household_id = $1`, [h.householdId]);
    await hs.leave(spouse.id);
    await db.query(`INSERT INTO subscription (user_id, household_id, status) VALUES ($1, $2, 'active')`, [h.adminId, h.householdId]);
    await expect(resolveIntendedFor(h.adminId, [{ intendedForUserId: spouse.id }])).rejects.toMatchObject({ code: 'invalid_recipient' });
    expect(await hasLiamAccess(spouse.uid)).toEqual({ allowed: false, reason: null });
  });

  it("mine() shows tokens to the admin only, and first names and archetypes to everyone", async () => {
    const h = await newHousehold('mine');
    const spouse = await profile('mine-spouse', 'Sam');
    const link = await hs.addMember(h.adminId, 'Sam');
    await hs.accept(link.token, spouse.id);
    const kid = await hs.addMember(h.adminId, 'Kid');
    const adminView = await reads.mine(h.adminId);
    const memberView = await reads.mine(spouse.id);
    expect(adminView?.members.find(m => m.memberId === kid.memberId)?.openLink?.token).toBe(kid.token);
    expect(memberView?.members.find(m => m.memberId === kid.memberId)).not.toHaveProperty('openLink');
    expect(memberView?.members.map(m => m.firstName).sort()).toEqual(['Kid', 'Sam', 'mineAdmin']);
    expect(memberView?.limits.maxMembers).toBe(6);
  });
});

describe('migration household_2026_11_07.sql', () => {
  it('migrates legacy memberships and invitations; a second run changes nothing', async () => {
    const a1 = await profile('mig-a1');
    const a2 = await profile('mig-a2');
    const b1 = await profile('mig-b1');
    const ha = await db.query<{ id: string }>(`INSERT INTO household (household_name, primary_billing_user_id) VALUES ($1, $2) RETURNING id`, [`${RUN} mig-a`, a1.id]);
    const hb = await db.query<{ id: string }>(`INSERT INTO household (household_name, primary_billing_user_id) VALUES ($1, $2) RETURNING id`, [`${RUN} mig-b`, b1.id]);
    fixtureHouseholds.push(ha.rows[0].id, hb.rows[0].id);
    await db.query(`UPDATE user_profile SET household_id = $1, is_household_admin = true WHERE id = $2`, [ha.rows[0].id, a1.id]);
    await db.query(`UPDATE user_profile SET household_id = $1, is_household_admin = false WHERE id = $2`, [ha.rows[0].id, a2.id]);
    await db.query(`UPDATE user_profile SET household_id = $1, is_household_admin = false WHERE id = $2`, [hb.rows[0].id, b1.id]);
    const inv = await db.query<{ id: string }>(
      `INSERT INTO household_invitation (household_id, invited_email, invited_by_id, token, status) VALUES ($1, 'someone@example.com', $2, $3, 'pending') RETURNING id`,
      [ha.rows[0].id, a1.id, `${RUN}-legacy-token`]
    );
    const sql = readFileSync(fileURLToPath(new URL('../db/migrations/household_2026_11_07.sql', import.meta.url)), 'utf8');
    const snapshot = async () => {
      const rows = await db.query(
        `SELECT vm.household_id, vm.user_id, vm.status_code, vm.role_codes FROM v_household_member vm
         WHERE vm.household_id = ANY($1::uuid[]) ORDER BY vm.household_id, vm.user_id`, [[ha.rows[0].id, hb.rows[0].id]]
      );
      const ev = await db.query(`SELECT COUNT(*)::int AS n FROM household_event WHERE household_id = ANY($1::uuid[])`, [[ha.rows[0].id, hb.rows[0].id]]);
      return { members: rows.rows, events: ev.rows[0].n };
    };
    await db.query(sql);
    const once = await snapshot();
    await db.query(sql);
    const twice = await snapshot();
    expect(twice).toEqual(once);
    expect(once.events).toBe(2);
    const byUser = Object.fromEntries(once.members.map(m => [m.user_id, m.role_codes]));
    expect(byUser[a1.id]).toEqual(['admin', 'household']);
    expect(byUser[a2.id]).toEqual(['household']);
    expect(byUser[b1.id]).toEqual(['admin', 'household']); // no admin flag: primary_billing_user_id becomes admin
    expect(await linkStatus(inv.rows[0].id)).toBe('legacy');
    const legacy = await db.query(`SELECT member_id, invited_email FROM household_invitation WHERE id = $1`, [inv.rows[0].id]);
    expect(legacy.rows[0]).toEqual({ member_id: null, invited_email: 'someone@example.com' });
  });
});
