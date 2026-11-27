// Usual Drink 4 (2026-11-26), C2 — the kitchen routes sit behind requireAdmin (the
// DB role, G3.6): a signed-in non-admin gets 403 and nothing is written; a bad
// body or code is refused before the writer runs. The token check is mocked
// (same pattern as sommelier.access.test.ts); the role lookup is the real one.
// backend/src/features/usual_drink/CLAUDE_CODE_PROMPT_USUAL_DRINK_4_PAGE_FIXES_AND_KITCHEN_LIST.md
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

const verifyIdToken = vi.fn();
vi.mock('../services/firebase-admin.js', () => ({
  default: { auth: () => ({ verifyIdToken }) },
}));
const promoteTypedName = vi.fn(async () => ({ created: true, code: 'x' }));
const retireKitchenEntry = vi.fn(async () => ({ retired: true }));
vi.mock('../services/brewKitchenList.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/brewKitchenList.js')>();
  return { ...actual, promoteTypedName, retireKitchenEntry };
});

const { db } = await import('../db/client.js');
const { default: router } = await import('./brewProfileAdmin.js');

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/brew-profile', router);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/api/admin/brew-profile`;
});
afterAll(async () => { server.close(); await db.end(); });

const call = (path: string, body?: unknown) => fetch(`${base}/kitchen/${path}`, {
  method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});

describe('kitchen admin routes', () => {
  it('a signed-in customer who is not an admin gets 403, and the writer never runs', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'vitest-ud4-not-an-admin', email: 'x@example.com', firebase: { sign_in_provider: 'password' } });
    expect((await call('promote', { typed: 'x', label: 'X', kindCode: 'chain' })).status).toBe(403);
    expect((await call('starbucks/retire')).status).toBe(403);
    expect((await fetch(`${base}/kitchen/promote`, { method: 'POST' })).status).toBe(401);
    expect(promoteTypedName).not.toHaveBeenCalled();
    expect(retireKitchenEntry).not.toHaveBeenCalled();
  });

  it('an admin: a body without a kind or a brand, or a bad code, is refused before the writer runs', async () => {
    const admin = (await db.query<{ firebase_uid: string }>(
      `SELECT up.firebase_uid FROM user_profile up JOIN user_type ut ON ut.id = up.user_type_id
       WHERE ut.name = 'admin' AND up.firebase_uid NOT LIKE 'managed:%' LIMIT 1`)).rows[0];
    if (!admin) return; // the test DB has no admin row: nothing to check here
    verifyIdToken.mockResolvedValue({ uid: admin.firebase_uid, email: 'a@example.com', firebase: { sign_in_provider: 'password' } });
    expect((await call('promote', { typed: 'x', label: 'X' })).status).toBe(400);
    expect((await call('promote', { typed: ' ', label: 'X', kindCode: 'chain' })).status).toBe(400);
    expect((await call('Bad%20Code/retire')).status).toBe(400);
    expect(promoteTypedName).not.toHaveBeenCalled();
    const ok = await call('promote', { typed: 'zzz', label: 'Zzz', kindCode: 'chain' });
    expect(ok.status).toBe(201);
    expect(promoteTypedName).toHaveBeenCalledWith({ typed: 'zzz', label: 'Zzz', kindCode: 'chain' });
  });
});
