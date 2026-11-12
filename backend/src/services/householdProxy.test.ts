// Family Household 2, Part D (2026-11-07) — quiz and dial by proxy, undo,
// unlink, against the test database. The quiz and dial doors are mounted for
// real (auth mocked to a switchable uid; the lifecycle refresh spied). Every
// fixture carries the run's prefix and afterAll removes exactly those rows
// (test hygiene on the test database only).
// backend/src/features/household/CLAUDE_CODE_PROMPT_HOUSEHOLD_2_QUIZ_AND_DIAL_BY_PROXY.md
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

// Several cases walk v_customer_identity many times on a prod-sized test DB.
vi.setConfig({ testTimeout: 60000 });

let currentUid = '';
vi.mock('../middleware/auth.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../middleware/auth.js')>();
  return {
    ...real,
    requireAuth: (req: any, _res: any, next: any) => { req.uid = currentUid; req.isAnonymous = false; next(); },
    blockAnonymousAuth: (_req: any, _res: any, next: any) => next(),
  };
});
const lifecycleCalls: string[] = [];
vi.mock('./userLifecycle.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./userLifecycle.js')>();
  return { ...real, refreshLifecycleState: async (uid: string) => { lifecycleCalls.push(uid); return null; } };
});

const { db } = await import('../db/client.js');
const hs = await import('./householdService.js');
const reads = await import('./householdReads.js');
const params = await import('./householdParameters.js');
const { saveQuizSession, getLatestQuizResult } = await import('./quizSession.js');
const { savePosition, resolveSlot } = await import('./dialPositionService.js');
const { default: quizRouter } = await import('../routes/quiz.js');
const { default: usersRouter } = await import('../routes/users.js');

const RUN = `vitest-hh2-${Date.now()}`;
const fixtureProfiles: string[] = [];
const fixtureHouseholds: string[] = [];
let server: Server;
let base = '';
let archetypeName = '';
let archetypeCode = '';
let sortOrders: number[] = [];

async function profile(tag: string, firstName = tag): Promise<{ id: string; uid: string }> {
  const uid = `${RUN}-${tag}`;
  const r = await db.query<{ id: string }>(`INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, $2) RETURNING id`, [uid, firstName]);
  fixtureProfiles.push(r.rows[0].id);
  return { id: r.rows[0].id, uid };
}
async function newHousehold(tag: string) {
  const admin = await profile(`${tag}-admin`, `${tag}Admin`);
  const h = await hs.create(admin.id, `${RUN} ${tag}`);
  fixtureHouseholds.push(h.householdId);
  return { admin, ...h };
}
const member = async (memberId: string) => (await db.query(`SELECT * FROM v_household_member WHERE member_id = $1`, [memberId])).rows[0];
const kinds = async (householdId: string) =>
  (await db.query<{ kind_code: string }>(`SELECT kind_code FROM v_household_event WHERE household_id = $1 ORDER BY created_at`, [householdId])).rows.map(r => r.kind_code);
const expectErr = (p: Promise<unknown>, status: number, code: string) => expect(p).rejects.toMatchObject({ name: 'HouseholdError', status, code });
const selfQuiz = (userId: string) => saveQuizSession(userId, archetypeName, { archetype: archetypeName, scores: {}, answers: {} });
const proxyQuiz = (userId: string, actor: string) => saveQuizSession(userId, archetypeName, { archetype: archetypeName, scores: {}, answers: {} }, null, actor);
async function post(path: string, body: unknown, method = 'POST') {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

beforeAll(async () => {
  const a = await db.query<{ name: string; code: string }>(
    `SELECT ca.name, ca.code::text AS code FROM coffee_archetype ca
     WHERE (SELECT COUNT(*) FROM coffee_dial_slot s WHERE s.archetype = ca.code) >= 3 ORDER BY ca.code LIMIT 1`
  );
  archetypeName = a.rows[0].name; archetypeCode = a.rows[0].code;
  sortOrders = (await db.query<{ sort_order: number }>(`SELECT sort_order FROM coffee_dial_slot WHERE archetype = $1 ORDER BY sort_order`, [archetypeCode])).rows.map(r => r.sort_order);
  const app = express();
  app.use(express.json());
  app.use('/api/quiz', quizRouter);
  app.use('/api/users', usersRouter);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/api`;
}, 30000);

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  const hh = (await db.query<{ id: string }>(
    `SELECT DISTINCT household_id AS id FROM household_member WHERE user_id = ANY($1::uuid[]) UNION SELECT id FROM household WHERE id = ANY($2::uuid[])`,
    [fixtureProfiles, fixtureHouseholds]
  )).rows.map(r => r.id);
  const memberUsers = (await db.query<{ user_id: string }>(`SELECT user_id FROM household_member WHERE household_id = ANY($1::uuid[])`, [hh])).rows.map(r => r.user_id);
  let all = [...new Set([...fixtureProfiles, ...memberUsers])];
  const linked = (await db.query<{ a: string; b: string }>(`SELECT from_user_id a, to_user_id b FROM customer_identity_link WHERE from_user_id = ANY($1::uuid[]) OR to_user_id = ANY($1::uuid[])`, [all])).rows;
  all = [...new Set([...all, ...linked.flatMap(r => [r.a, r.b])])];
  const q = (sql: string, v: unknown[]) => db.query(sql, v);
  await q(`DELETE FROM customer_identity_unlink WHERE user_id = ANY($1::uuid[]) OR link_id IN (SELECT id FROM customer_identity_link WHERE from_user_id = ANY($1::uuid[]) OR to_user_id = ANY($1::uuid[]))`, [all]);
  await q(`DELETE FROM customer_identity_link WHERE from_user_id = ANY($1::uuid[]) OR to_user_id = ANY($1::uuid[])`, [all]);
  await q(`DELETE FROM customer_dial_event WHERE user_id = ANY($1::uuid[])`, [all]);
  await q(`DELETE FROM user_saved_item WHERE user_id = ANY($1::uuid[])`, [all]);
  await q(`DELETE FROM user_bloom_dial_current_position WHERE user_id = ANY($1::uuid[])`, [all]);
  await q(`DELETE FROM quiz_session_interpretation WHERE quiz_session_id IN (SELECT id FROM quiz_session WHERE user_id = ANY($1::uuid[]) OR taken_by_user_id = ANY($1::uuid[]))`, [all]);
  await q(`DELETE FROM quiz_session WHERE user_id = ANY($1::uuid[]) OR taken_by_user_id = ANY($1::uuid[])`, [all]);
  await q(`DELETE FROM user_lifecycle_event WHERE user_id = ANY($1::uuid[])`, [all]);
  await q(`DELETE FROM user_lifecycle_state WHERE user_id = ANY($1::uuid[])`, [all]);
  await q(`DELETE FROM household_event WHERE household_id = ANY($1::uuid[])`, [hh]);
  await q(`DELETE FROM household_invitation WHERE household_id = ANY($1::uuid[])`, [hh]);
  await q(`DELETE FROM household_member_role WHERE member_id IN (SELECT id FROM household_member WHERE household_id = ANY($1::uuid[]))`, [hh]);
  await q(`DELETE FROM household_member WHERE household_id = ANY($1::uuid[])`, [hh]);
  await q(`DELETE FROM household WHERE id = ANY($1::uuid[])`, [hh]);
  // Ella map 3 (2026-11-12): the quiz door now writes an insert-only match decision for each quiz, which no
  // cleanup may delete (guard trigger); the marked profiles those decisions reference stay on the test DB.
  await q(`DELETE FROM user_profile WHERE id = ANY($1::uuid[])
             AND NOT EXISTS (SELECT 1 FROM customer_match_decision d WHERE d.user_id = user_profile.id OR d.actor_user_id = user_profile.id)`, [all]);
}, 60000);

describe('seeds and views', () => {
  it('the two badge lookups and dial_turn_undone are seeded', async () => {
    const codes = async (t: string) => (await db.query<{ code: string }>(`SELECT code FROM ${t} ORDER BY id`)).rows.map(r => r.code);
    expect(await codes('household_account_state')).toEqual(['login', 'managed']);
    expect(await codes('household_quiz_state')).toEqual(['none', 'by_admin', 'own']);
    expect((await db.query(`SELECT 1 FROM household_event_kind WHERE code IN ('dial_turn_undone', 'quiz_taken_for_member', 'dial_turned_for_member', 'identity_unlinked')`)).rowCount).toBe(4);
  });

  it('v_customer_quiz_current ranks self-taken above a newer proxy, and a newer proxy above an older one', async () => {
    const p = await profile('rank');
    const actor = await profile('rank-actor');
    const at = (sql: string, v: unknown[]) => db.query<{ id: string }>(sql, v);
    const old = (await at(`INSERT INTO quiz_session (user_id, taken_by_user_id, completed_at) VALUES ($1, $2, now() - interval '3 days') RETURNING id`, [p.id, actor.id])).rows[0].id;
    const newer = (await at(`INSERT INTO quiz_session (user_id, taken_by_user_id, completed_at) VALUES ($1, $2, now() - interval '1 day') RETURNING id`, [p.id, actor.id])).rows[0].id;
    const current = async () => (await db.query(`SELECT qc.quiz_session_id, qc.taken_by_user_id, qc.taken_by_first_name FROM v_customer_quiz_current qc JOIN v_customer_identity v ON v.canonical_user_id = qc.canonical_user_id WHERE v.user_id = $1`, [p.id])).rows[0];
    expect((await current()).quiz_session_id).toBe(newer);
    expect((await current()).taken_by_first_name).toBe('rank-actor');
    const self = (await at(`INSERT INTO quiz_session (user_id, completed_at) VALUES ($1, now() - interval '2 days') RETURNING id`, [p.id])).rows[0].id;
    expect((await current()).quiz_session_id).toBe(self);
    expect(old).not.toBe(self);
  });
});

describe('quiz by proxy', () => {
  it('assertMayQuizFor: allowed for the admin; refused after a self-taken quiz, when switched off, and across households', async () => {
    const h = await newHousehold('quizfor');
    const tom = await hs.addMember(h.admin.id, 'Tom');
    expect(await hs.assertMayQuizFor(h.admin.id, tom.memberId)).toMatchObject({ memberId: tom.memberId, userId: tom.userId });
    expect((await member(tom.memberId)).quiz_state).toBe('none');
    await proxyQuiz(tom.userId, h.admin.id);
    expect(await member(tom.memberId)).toMatchObject({ quiz_state: 'by_admin', quiz_taken_by_first_name: 'quizforAdmin', account_state: 'managed' });
    // A second proxy quiz is still allowed (no self-taken quiz yet).
    await hs.assertMayQuizFor(h.admin.id, tom.memberId);

    const other = await newHousehold('quizfor-other');
    await expectErr(hs.assertMayQuizFor(other.admin.id, tom.memberId), 404, 'member_not_found');

    await params.setParameter('quiz_for_member_enabled', 0, 'vitest', null);
    try {
      await expectErr(hs.assertMayQuizFor(h.admin.id, tom.memberId), 409, 'quiz_for_member_off');
    } finally {
      await params.setParameter('quiz_for_member_enabled', 1, 'vitest restore', null);
    }

    // Tom claims his profile and takes his own quiz: the door closes.
    const account = await profile('quizfor-tom');
    await hs.accept(tom.token, account.id);
    expect((await member(tom.memberId)).account_state).toBe('login');
    await selfQuiz(account.id);
    expect((await member(tom.memberId)).quiz_state).toBe('own');
    await expectErr(hs.assertMayQuizFor(h.admin.id, tom.memberId), 409, 'member_took_own_quiz');
  });

  it('POST /api/quiz/results with forMemberId: the session is the member\'s, taken by the admin; only the member\'s lifecycle runs', async () => {
    const h = await newHousehold('route');
    const ella = await hs.addMember(h.admin.id, 'Ella');
    currentUid = h.admin.uid;
    lifecycleCalls.length = 0;
    const emailsBefore = Number((await db.query(`SELECT COUNT(*) FROM transactional_email_log`)).rows[0].count);
    const res = await post('/quiz/results', { archetype: archetypeName, scores: {}, answers: {}, forMemberId: ella.memberId });
    expect(res.status).toBe(200);
    expect(res.json.forMemberId).toBe(ella.memberId);
    const qs = (await db.query(`SELECT user_id, taken_by_user_id FROM quiz_session WHERE id = $1`, [res.json.id])).rows[0];
    expect(qs).toEqual({ user_id: ella.userId, taken_by_user_id: h.admin.id });
    await new Promise(r => setTimeout(r, 200));
    const ellaUid = (await db.query(`SELECT firebase_uid FROM user_profile WHERE id = $1`, [ella.userId])).rows[0].firebase_uid;
    expect(lifecycleCalls).toEqual([ellaUid]);
    expect(Number((await db.query(`SELECT COUNT(*) FROM transactional_email_log`)).rows[0].count)).toBe(emailsBefore);
    expect(await kinds(h.householdId)).toContain('quiz_taken_for_member');
    // The admin's own result is untouched.
    expect(await getLatestQuizResult(db, h.admin.uid)).toBeNull();
    // A member of another household cannot be quizzed through the door.
    const other = await newHousehold('route-other');
    currentUid = other.admin.uid;
    expect((await post('/quiz/results', { archetype: archetypeName, scores: {}, answers: {}, forMemberId: ella.memberId })).status).toBe(404);
    // proxy count on the household view
    expect((await db.query(`SELECT proxy_quiz_count FROM v_household WHERE household_id = $1`, [h.householdId])).rows[0].proxy_quiz_count).toBe(1);
  });

  it('getLatestQuizResult follows the claim: the account sees the proxy result until it takes its own', async () => {
    const h = await newHousehold('latest');
    const tom = await hs.addMember(h.admin.id, 'Tom');
    const proxySession = await proxyQuiz(tom.userId, h.admin.id);
    const account = await profile('latest-tom');
    await hs.accept(tom.token, account.id);
    expect((await getLatestQuizResult(db, account.uid))?.id).toBe(proxySession.sessionId);
    const own = await selfQuiz(account.id);
    expect((await getLatestQuizResult(db, account.uid))?.id).toBe(own.sessionId);
  });
});

describe('dial by proxy', () => {
  it('refused without may_turn_dials; allowed otherwise; the fact carries the actor; the saved list is untouched', async () => {
    const h = await newHousehold('dial');
    const spouse = await profile('dial-spouse', 'Sam');
    const sam = await hs.addMember(h.admin.id, 'Sam');
    await hs.accept(sam.token, spouse.id);
    const kid = await hs.addMember(h.admin.id, 'Kid');
    await proxyQuiz(kid.userId, h.admin.id);
    await db.query(`UPDATE household_role SET may_turn_dials = false WHERE code = 'household'`);
    try {
      await expectErr(hs.turnDialFor(spouse.id, kid.memberId, { archetype: archetypeCode, dialSortOrder: sortOrders[0] }), 403, 'may_not_turn_dials');
    } finally {
      await db.query(`UPDATE household_role SET may_turn_dials = true WHERE code = 'household'`);
    }
    const turned = await hs.turnDialFor(spouse.id, kid.memberId, { archetype: archetypeCode, dialSortOrder: sortOrders[1] });
    expect(turned.previousSlotId).toBeNull();
    const ev = (await db.query(`SELECT user_id, actor_user_id, event_type FROM customer_dial_event WHERE id = $1`, [turned.dialEventId])).rows[0];
    expect(ev).toEqual({ user_id: kid.userId, actor_user_id: spouse.id, event_type: 'explicit_save' });
    expect((await db.query(`SELECT COUNT(*)::int n FROM user_saved_item WHERE user_id = $1`, [kid.userId])).rows[0].n).toBe(0);
    expect((await member(kid.memberId)).dial_slot_id).toBe(turned.slotId);
    expect(await kinds(h.householdId)).toContain('dial_turned_for_member');
    expect(await hs.memberDialPosition(h.admin.id, kid.memberId, archetypeCode)).toBe(sortOrders[1]);
  });

  it('PATCH /api/users/dial-position with forMemberId needs an explicit save', async () => {
    const h = await newHousehold('dialroute');
    const kid = await hs.addMember(h.admin.id, 'Kid');
    currentUid = h.admin.uid;
    expect((await post('/users/dial-position', { archetype: archetypeCode, dialSortOrder: sortOrders[0], forMemberId: kid.memberId }, 'PATCH')).status).toBe(400);
    const ok = await post('/users/dial-position', { archetype: archetypeCode, dialSortOrder: sortOrders[0], trigger: 'explicit_save', forMemberId: kid.memberId }, 'PATCH');
    expect(ok.status).toBe(200);
    const pos = (await db.query(`SELECT slot_id FROM user_bloom_dial_current_position WHERE user_id = $1 AND archetype = $2`, [kid.userId, archetypeCode])).rows[0];
    expect(pos.slot_id).toBe(await resolveSlot(db, archetypeCode, sortOrders[0]));
    // The admin's own dial did not move.
    expect((await db.query(`SELECT 1 FROM user_bloom_dial_current_position WHERE user_id = $1`, [h.admin.id])).rowCount).toBe(0);
  });

  it('v_customer_dial_current resolves the latest position across two linked profiles', async () => {
    const a = await profile('dc-a');
    const b = await profile('dc-b');
    const s0 = await resolveSlot(db, archetypeCode, sortOrders[0]);
    const s1 = await resolveSlot(db, archetypeCode, sortOrders[1]);
    await db.query(`INSERT INTO user_bloom_dial_current_position (user_id, archetype, slot_id, updated_at) VALUES ($1, $2, $3, now() - interval '1 day')`, [a.id, archetypeCode, s0]);
    await db.query(`INSERT INTO user_bloom_dial_current_position (user_id, archetype, slot_id, updated_at) VALUES ($1, $2, $3, now())`, [b.id, archetypeCode, s1]);
    await db.query(`INSERT INTO customer_identity_link (user_id, source, source_id, from_user_id, to_user_id, how) VALUES ($1, 'onsite', $2, $1, $3, 'admin')`, [a.id, `${RUN}:dc`, b.id]);
    const cur = async () => (await db.query(`SELECT dc.slot_id, dc.set_by_user_id FROM v_customer_dial_current dc WHERE dc.canonical_user_id = $1 AND dc.archetype = $2`, [b.id, archetypeCode])).rows;
    expect(await cur()).toEqual([{ slot_id: s1, set_by_user_id: b.id }]);
    await db.query(`UPDATE user_bloom_dial_current_position SET updated_at = now() + interval '1 minute' WHERE user_id = $1`, [a.id]);
    expect(await cur()).toEqual([{ slot_id: s0, set_by_user_id: a.id }]);
  });

  it('undo restores the previous slot as the member\'s own move; a second undo is a no-op; no previous → cleared', async () => {
    const h = await newHousehold('undo');
    const account = await profile('undo-tom', 'Tom');
    const tom = await hs.addMember(h.admin.id, 'Tom');
    await hs.accept(tom.token, account.id);
    await selfQuiz(account.id);
    const s0 = await resolveSlot(db, archetypeCode, sortOrders[0]);
    await savePosition(db, { userId: account.id, archetype: archetypeCode, slotId: s0, savedItem: false });
    const turned = await hs.turnDialFor(h.admin.id, tom.memberId, { archetype: archetypeCode, dialSortOrder: sortOrders[2] });
    expect(turned.previousSlotId).toBe(s0);
    const log = await reads.myLog(account.id);
    expect(log.entries[0]).toMatchObject({ dialEventId: turned.dialEventId, undoable: true, undone: false });
    expect(log.entries[0].line).toContain('undoAdmin turned the wheel for you');
    // Only the member undoes.
    await expectErr(hs.undoDialTurn(h.admin.id, turned.dialEventId), 404, 'turn_not_found');
    expect(await hs.undoDialTurn(account.id, turned.dialEventId)).toEqual({ restoredSlotId: s0, alreadyUndone: false });
    expect(await hs.undoDialTurn(account.id, turned.dialEventId)).toEqual({ restoredSlotId: s0, alreadyUndone: true });
    expect((await db.query(`SELECT dc.slot_id FROM v_customer_dial_current dc WHERE dc.canonical_user_id = $1 AND dc.archetype = $2`, [account.id, archetypeCode])).rows[0].slot_id).toBe(s0);
    const undoEvents = (await db.query(`SELECT actor_user_id, event_type FROM customer_dial_event WHERE user_id = $1 AND actor_user_id IS NULL`, [account.id])).rows;
    expect(undoEvents).toEqual([{ actor_user_id: null, event_type: 'explicit_save' }]);
    expect((await kinds(h.householdId)).filter(k => k === 'dial_turn_undone')).toHaveLength(1);
    expect((await reads.myLog(account.id)).entries[0]).toMatchObject({ undone: true, undoable: false });

    // A turn onto a profile with no earlier position: undo clears it.
    const h2 = await newHousehold('undo2');
    const acc2 = await profile('undo2-ella', 'Ella');
    const ella = await hs.addMember(h2.admin.id, 'Ella');
    await hs.accept(ella.token, acc2.id);
    await selfQuiz(acc2.id);
    const t2 = await hs.turnDialFor(h2.admin.id, ella.memberId, { archetype: archetypeCode, dialSortOrder: sortOrders[1] });
    expect(await hs.undoDialTurn(acc2.id, t2.dialEventId)).toEqual({ restoredSlotId: null, alreadyUndone: false });
    expect((await db.query(`SELECT slot_id FROM user_bloom_dial_current_position WHERE user_id = $1 AND archetype = $2`, [acc2.id, archetypeCode])).rows[0].slot_id).toBeNull();
  });
});

describe('unlink (D25)', () => {
  it('reverts the canonical id and the member row, writes the event; twice → one row; an admin member is refused', async () => {
    const h = await newHousehold('unlink');
    const account = await profile('unlink-tom', 'Tom');
    const tom = await hs.addMember(h.admin.id, 'Tom');
    await proxyQuiz(tom.userId, h.admin.id);
    await hs.accept(tom.token, account.id);
    expect((await member(tom.memberId)).claim_link_id).not.toBeNull();
    const canon = async () => (await db.query(`SELECT canonical_user_id FROM v_customer_identity WHERE user_id = $1`, [tom.userId])).rows[0].canonical_user_id;
    expect(await canon()).toBe(account.id);
    expect(await hs.unlinkMember(h.admin.id, tom.memberId, 'vitest')).toEqual({ changed: true });
    expect(await hs.unlinkMember(h.admin.id, tom.memberId)).toEqual({ changed: false });
    expect(await canon()).toBe(tom.userId);
    const m = await member(tom.memberId);
    expect(m).toMatchObject({ user_id: tom.userId, account_state: 'managed', quiz_state: 'by_admin', claim_link_id: null });
    expect((await db.query(`SELECT COUNT(*)::int n FROM customer_identity_unlink u JOIN customer_identity_link l ON l.id = u.link_id WHERE l.from_user_id = $1`, [tom.userId])).rows[0].n).toBe(1);
    expect(await kinds(h.householdId)).toContain('identity_unlinked');
    expect(await reads.mine(account.id)).toBeNull();

    // An administering member cannot be unlinked.
    const h2 = await newHousehold('unlink2');
    const acc2 = await profile('unlink2-sam', 'Sam');
    const sam = await hs.addMember(h2.admin.id, 'Sam');
    await hs.accept(sam.token, acc2.id);
    await hs.transferAdmin(h2.admin.id, sam.memberId);
    await expectErr(hs.unlinkMember(acc2.id, sam.memberId), 409, 'transfer_first');
  });

  it('mine() carries the badge words from the lookups and the actor-specific rights', async () => {
    const h = await newHousehold('words');
    const kid = await hs.addMember(h.admin.id, 'Kid');
    await proxyQuiz(kid.userId, h.admin.id);
    const view = await reads.mine(h.admin.id);
    const k = view!.members.find(m => m.memberId === kid.memberId)!;
    expect(k.accountState).toEqual({ code: 'managed', label: 'Set up by the admin' });
    expect(k.quizState).toEqual({ code: 'by_admin', label: 'Quiz taken by wordsAdmin' });
    expect(k).toMatchObject({ mayQuizFor: true, mayTurnDialFor: true, mayUnlink: false });
    expect(k.proxyQuiz?.header).toBe('Profiling Kid');
    const meRow = view!.members.find(m => m.isMe)!;
    expect(meRow).toMatchObject({ mayQuizFor: false, mayTurnDialFor: false });
    expect(Object.keys(await reads.lookups())).toEqual(['roles', 'accountStates', 'quizStates']);
  });
});
