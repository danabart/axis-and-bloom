// Family Household 1, B4 (2026-11-07) — /api/household, rewritten from the
// 2026-05 handlers (which held SQL, wrote user_profile and sent invitation
// email through a direct Resend call whose result was never read). Every
// route validates with zod, resolves the caller's profile, and calls one
// householdService / householdReads function (G3.1); the service checks the
// caller's rights inside its transaction. No email is sent from here (D31).
//
// Signed in, never anonymous:
//   POST   /                          create {name}
//   GET    /mine                      the caller's household (null when none)
//   GET    /lookups                   roles, account states and quiz states with their words (Household 2; replaced /roles)
//   GET    /me/log                    dial turns others made for me (Household 2, D27)
//   POST   /me/log/:dialEventId/undo  undo one of them (a move back, never a delete)
//   POST   /members/:memberId/unlink  undo a claim (D25)
//   POST   /members {firstName}       add a member by first name → join link
//   POST   /members/:memberId/link    a new join link (when none is open)
//   DELETE /links/:invitationId       close a join link
//   POST   /links/:token/accept       join (claims the managed profile)
//   POST   /members/:memberId/roles {roleCode}     grant a role
//   DELETE /members/:memberId/roles/:roleCode       revoke a role
//   POST   /transfer {toMemberId}     hand the admin role over (D21)
//   POST   /leave                     leave the household
//   DELETE /members/:memberId         remove a member
//   POST   /dissolve                  close the household (only member left)
// Public (whoever holds the link, D14):
//   GET    /links/:token              what the join page shows
//   POST   /links/:token/decline      decline
// The 2026-05 paths answer 410 for one release so a stale tab fails loudly.
import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, blockAnonymousAuth, optionalAuth, type AuthRequest } from '../middleware/auth.js';
import {
  create, addMember, createLink, revokeLink, accept, decline, grantRole, revokeRole, transferAdmin,
  leave, removeMember, dissolve, undoDialTurn, unlinkMember, HouseholdError,
} from '../services/householdService.js';
import { mine, lookups, myLog, peekLink, profileIdForUid } from '../services/householdReads.js';

const router = Router();
const signedIn = [requireAuth, blockAnonymousAuth];

function fail(res: Response, err: unknown, where: string): void {
  if (err instanceof HouseholdError) { res.status(err.status).json({ error: err.code, message: err.message, ...err.extra }); return; }
  console.error(`[household] ${where}`, err);
  res.status(500).json({ error: 'household_failed', message: 'That did not go through. Please try again in a moment.' });
}

const badBody = (res: Response, message: string) => res.status(400).json({ error: 'invalid_request', message });

/** The caller's profile id; answers 404 itself when the account has no profile yet. */
async function caller(req: AuthRequest, res: Response): Promise<string | null> {
  const id = await profileIdForUid(req.uid!);
  if (!id) res.status(404).json({ error: 'profile_not_found', message: 'Finish setting up your account first.' });
  return id;
}

const Uuid = z.string().uuid();
const Token = z.string().regex(/^[0-9a-f]{64}$/);
const CreateBody = z.object({ name: z.string().trim().min(1).max(80) });
const AddMemberBody = z.object({ firstName: z.string().trim().min(1).max(40) });
const RoleBody = z.object({ roleCode: z.string().trim().min(1).max(40) });
const TransferBody = z.object({ toMemberId: Uuid });

// ── retired 2026-05 paths ────────────────────────────────────────────────────
const gone = (_req: unknown, res: Response) => res.status(410).json({ error: 'household_api_changed', message: 'This page has been updated. Please refresh.' });
router.post('/create', gone);
router.post('/invite', gone);
router.delete('/leave', gone);
router.get('/invite/:token', gone);
router.post('/join/:token', gone);
router.delete('/invitations/:invitationId', gone);

// ── reads ────────────────────────────────────────────────────────────────────
router.get('/mine', ...signedIn, async (req: AuthRequest, res) => {
  try {
    const me = await profileIdForUid(req.uid!);
    res.json(me ? await mine(me) : null);
  } catch (err) { fail(res, err, 'mine'); }
});

router.get('/lookups', ...signedIn, async (_req, res) => {
  try { res.json(await lookups()); } catch (err) { fail(res, err, 'lookups'); }
});

router.get('/me/log', ...signedIn, async (req: AuthRequest, res) => {
  try {
    const me = await caller(req, res); if (!me) return;
    res.json(await myLog(me));
  } catch (err) { fail(res, err, 'my-log'); }
});

router.post('/me/log/:dialEventId/undo', ...signedIn, async (req: AuthRequest, res) => {
  try {
    const id = Uuid.safeParse(req.params.dialEventId);
    if (!id.success) return badBody(res, 'Unknown dial turn.');
    const me = await caller(req, res); if (!me) return;
    res.json(await undoDialTurn(me, id.data));
  } catch (err) { fail(res, err, 'undo-dial'); }
});

router.post('/members/:memberId/unlink', ...signedIn, async (req: AuthRequest, res) => {
  try {
    const id = Uuid.safeParse(req.params.memberId);
    if (!id.success) return badBody(res, 'Unknown member.');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 200) || null : null;
    const me = await caller(req, res); if (!me) return;
    res.json(await unlinkMember(me, id.data, reason));
  } catch (err) { fail(res, err, 'unlink'); }
});

router.get('/links/:token', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const t = Token.safeParse(req.params.token);
    if (!t.success) { res.status(404).json({ error: 'link_not_found', message: 'We could not find that join link.' }); return; }
    const viewer = req.uid && !req.isAnonymous ? await profileIdForUid(req.uid) : null;
    const peek = await peekLink(t.data, viewer);
    if (!peek) { res.status(404).json({ error: 'link_not_found', message: 'We could not find that join link.' }); return; }
    res.json(peek);
  } catch (err) { fail(res, err, 'peek'); }
});

// ── writes ───────────────────────────────────────────────────────────────────
router.post('/', ...signedIn, async (req: AuthRequest, res) => {
  try {
    const body = CreateBody.safeParse(req.body ?? {});
    if (!body.success) return badBody(res, 'Give your household a name.');
    const me = await caller(req, res); if (!me) return;
    res.status(201).json(await create(me, body.data.name));
  } catch (err) { fail(res, err, 'create'); }
});

router.post('/members', ...signedIn, async (req: AuthRequest, res) => {
  try {
    const body = AddMemberBody.safeParse(req.body ?? {});
    if (!body.success) return badBody(res, 'Add their first name.');
    const me = await caller(req, res); if (!me) return;
    const added = await addMember(me, body.data.firstName);
    res.status(201).json({ memberId: added.memberId, invitationId: added.invitationId, token: added.token });
  } catch (err) { fail(res, err, 'add-member'); }
});

router.post('/members/:memberId/link', ...signedIn, async (req: AuthRequest, res) => {
  try {
    const id = Uuid.safeParse(req.params.memberId);
    if (!id.success) return badBody(res, 'Unknown member.');
    const me = await caller(req, res); if (!me) return;
    res.status(201).json(await createLink(me, id.data));
  } catch (err) { fail(res, err, 'create-link'); }
});

router.delete('/links/:invitationId', ...signedIn, async (req: AuthRequest, res) => {
  try {
    const id = Uuid.safeParse(req.params.invitationId);
    if (!id.success) return badBody(res, 'Unknown join link.');
    const me = await caller(req, res); if (!me) return;
    await revokeLink(me, id.data);
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'revoke-link'); }
});

router.post('/links/:token/accept', ...signedIn, async (req: AuthRequest, res) => {
  try {
    const t = Token.safeParse(req.params.token);
    if (!t.success) { res.status(404).json({ error: 'link_not_found', message: 'We could not find that join link.' }); return; }
    const me = await caller(req, res); if (!me) return;
    res.json(await accept(t.data, me));
  } catch (err) { fail(res, err, 'accept'); }
});

router.post('/links/:token/decline', async (req, res) => {
  try {
    const t = Token.safeParse(req.params.token);
    if (!t.success) { res.status(404).json({ error: 'link_not_found', message: 'We could not find that join link.' }); return; }
    await decline(t.data);
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'decline'); }
});

router.post('/members/:memberId/roles', ...signedIn, async (req: AuthRequest, res) => {
  try {
    const id = Uuid.safeParse(req.params.memberId);
    const body = RoleBody.safeParse(req.body ?? {});
    if (!id.success || !body.success) return badBody(res, 'Unknown member or role.');
    const me = await caller(req, res); if (!me) return;
    res.json(await grantRole(me, id.data, body.data.roleCode));
  } catch (err) { fail(res, err, 'grant-role'); }
});

router.delete('/members/:memberId/roles/:roleCode', ...signedIn, async (req: AuthRequest, res) => {
  try {
    const id = Uuid.safeParse(req.params.memberId);
    if (!id.success) return badBody(res, 'Unknown member.');
    const me = await caller(req, res); if (!me) return;
    res.json(await revokeRole(me, id.data, String(req.params.roleCode)));
  } catch (err) { fail(res, err, 'revoke-role'); }
});

router.post('/transfer', ...signedIn, async (req: AuthRequest, res) => {
  try {
    const body = TransferBody.safeParse(req.body ?? {});
    if (!body.success) return badBody(res, 'Choose a member.');
    const me = await caller(req, res); if (!me) return;
    res.json(await transferAdmin(me, body.data.toMemberId));
  } catch (err) { fail(res, err, 'transfer'); }
});

router.post('/leave', ...signedIn, async (req: AuthRequest, res) => {
  try {
    const me = await caller(req, res); if (!me) return;
    await leave(me);
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'leave'); }
});

router.delete('/members/:memberId', ...signedIn, async (req: AuthRequest, res) => {
  try {
    const id = Uuid.safeParse(req.params.memberId);
    if (!id.success) return badBody(res, 'Unknown member.');
    const me = await caller(req, res); if (!me) return;
    await removeMember(me, id.data);
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'remove-member'); }
});

router.post('/dissolve', ...signedIn, async (req: AuthRequest, res) => {
  try {
    const me = await caller(req, res); if (!me) return;
    await dissolve(me);
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'dissolve'); }
});

export default router;
