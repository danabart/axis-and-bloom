// Roastery portal part 5 (2026-10-06) — admin preview of a roastery's form. Test database.
// Covers: both preview endpoints require an admin; they return exactly the shapes the public endpoints do;
// another roastery's coffee id is a plain 404; previewing changes no row in any roastery_portal_* table (nor
// transactional_email_log); and the browser-side preview client never issues a request to /api/roastery-portal.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { db } from '../db/client.js';
import {
  createLink, upsertRespondent, addLineupCoffee, saveDraft, deactivateLineupCoffee, revokeLink,
} from './roasteryPortalService.js';

// requireAdmin verifies a Firebase ID token; the test mints none. The token string IS the uid here.
vi.mock('./firebase-admin.js', () => ({
  default: { auth: () => ({ verifyIdToken: async (t: string) => {
    if (t === 'bad') throw new Error('invalid');
    return { uid: t, email: `${t}@example.com`, firebase: { sign_in_provider: 'password' } };
  } }) },
}));

import publicRouter from '../routes/roasteryPortal.js';
import adminRouter from '../routes/roasteryPortalAdmin.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const ADMIN_UID = `vitest-preview-admin-${RUN}`;
// links are created by a uid with NO user_profile row (created_by stays null), so nothing references the admin
// profile rows below and afterAll can delete them (a leftover 'vitest-%' profile would break other files' cleanups)
const NO_PROFILE_UID = 'vitest-no-such-admin';
const CUSTOMER_UID = `vitest-preview-customer-${RUN}`;
let server: Server; let base: string;
let roasterA: string; let roasterB: string;
let coffeeA: string; let coffeeA2: string; let coffeeB: string;
let linkId: string; let token: string;

async function standingRoaster(name: string): Promise<string> {
  const found = await db.query(`SELECT id FROM roaster WHERE name = $1`, [name]);
  if (found.rows[0]) return found.rows[0].id;
  return (await db.query(`INSERT INTO roaster (name, is_active) VALUES ($1, true) RETURNING id`, [name])).rows[0].id;
}

const get = (path: string, bearer?: string) =>
  fetch(`${base}${path}`, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
const preview = (roasterId: string, bearer?: string) => get(`/api/admin/roastery-portal/roasteries/${roasterId}/preview`, bearer);
const previewCoffee = (roasterId: string, id: string, bearer?: string) =>
  get(`/api/admin/roastery-portal/roasteries/${roasterId}/preview/coffees/${id}`, bearer);

/** Row count + checksum of every roastery_portal_* table, plus the email log. */
async function snapshot(): Promise<Record<string, string>> {
  const tables = (await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name LIKE 'roastery\\_portal\\_%' ORDER BY 1`
  )).rows.map(r => r.table_name as string).concat('transactional_email_log');
  const out: Record<string, string> = {};
  for (const t of tables) {
    const r = await db.query(`SELECT count(*)::int n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) h FROM ${t} x`);
    out[t] = `${r.rows[0].n}:${r.rows[0].h}`;
  }
  return out;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/roastery-portal', publicRouter);
  app.use('/api/admin/roastery-portal', adminRouter);
  server = await new Promise<Server>(res => { const s = app.listen(0, () => res(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.query(
    `INSERT INTO user_profile (firebase_uid, user_type_id) VALUES ($1, (SELECT id FROM user_type WHERE name = 'admin')), ($2, (SELECT id FROM user_type WHERE name = 'customer'))`,
    [ADMIN_UID, CUSTOMER_UID]
  );

  roasterA = await standingRoaster('Portal Test Roastery A');
  roasterB = await standingRoaster('Portal Test Roastery B');
  await db.query(`UPDATE roaster SET is_active = true WHERE id = ANY($1::uuid[])`, [[roasterA, roasterB]]);
  coffeeA = (await addLineupCoffee({ roasterId: roasterA, name: `PT P5 one ${RUN}`, addedBy: 'admin' })).id;
  coffeeA2 = (await addLineupCoffee({ roasterId: roasterA, name: `PT P5 two ${RUN}`, addedBy: 'admin' })).id;
  coffeeB = (await addLineupCoffee({ roasterId: roasterB, name: `PT P5 other ${RUN}`, addedBy: 'admin' })).id;
  const link = await createLink({ roasterId: roasterA, contactName: 'Pia Preview', contactEmail: 'pia@example.com', adminFirebaseUid: NO_PROFILE_UID });
  linkId = link.id; token = link.token;
  const who = await upsertRespondent({ roasterId: roasterA, linkId, name: 'Pia', email: 'pia@example.com' });
  // a draft, so the preview has real state to show and any stray write would show up in the checksums
  await saveDraft({ roasterId: roasterA, portalCoffeeId: coffeeA, respondentId: who.id, doc: { origin: 'Ethiopia', processValues: ['washed'] } });
});

afterAll(async () => {
  await new Promise(res => server.close(res));
  for (const [r, id] of [[roasterA, coffeeA], [roasterA, coffeeA2], [roasterB, coffeeB]] as const) {
    await deactivateLineupCoffee({ roasterId: r, portalCoffeeId: id }).catch(() => undefined);
  }
  await revokeLink(linkId).catch(() => undefined);
  await db.query(`DELETE FROM user_profile WHERE firebase_uid = ANY($1::text[])`, [[ADMIN_UID, CUSTOMER_UID]]).catch(() => undefined);
});

describe('admin preview endpoints', () => {
  it('require an admin: no token 401, invalid token 401, non-admin 403 (both endpoints)', async () => {
    for (const call of [
      (b?: string) => preview(roasterA, b),
      (b?: string) => previewCoffee(roasterA, coffeeA, b),
    ]) {
      expect((await call()).status).toBe(401);
      expect((await call('bad')).status).toBe(401);
      expect((await call(CUSTOMER_UID)).status).toBe(403);
      expect((await call(ADMIN_UID)).status).toBe(200);
    }
  });

  it('return exactly the shapes of the public landing and coffee endpoints', async () => {
    const pv = await (await preview(roasterA, ADMIN_UID)).json();
    const pc = await (await previewCoffee(roasterA, coffeeA, ADMIN_UID)).json();
    const pub = await (await get(`/api/roastery-portal/${token}`)).json();
    const pubCoffee = await (await get(`/api/roastery-portal/${token}/coffees/${coffeeA}`)).json();
    expect(Object.keys(pv).sort()).toEqual(['contact', 'counts', 'lineup', 'lineupResponse', 'roastery', 'vocabulary']);
    expect(pv).toEqual(pub);              // same reads, same bytes (contact prefilled from the link)
    expect(pc).toEqual(pubCoffee);
    expect(Object.keys(pc).sort()).toEqual(['coffee', 'response']);
    expect(pc.response?.status).toBe('draft');
    expect(pv.contact).toEqual({ name: 'Pia Preview', email: 'pia@example.com' });
  });

  it('work with no link at all (contact is null) and with a revoked link', async () => {
    const noLink = await (await preview(roasterB, ADMIN_UID)).json();
    expect(noLink.contact).toEqual({ name: null, email: null });
    expect(noLink.lineup.some((c: any) => c.portalCoffeeId === coffeeB)).toBe(true);
    const revoked = await createLink({ roasterId: roasterB, adminFirebaseUid: NO_PROFILE_UID });
    await revokeLink(revoked.id);
    expect((await preview(roasterB, ADMIN_UID)).status).toBe(200);
  });

  it("another roastery's coffee id, an unknown id and a malformed id are all a plain 404", async () => {
    for (const id of [coffeeB, '00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
      const r = await previewCoffee(roasterA, id, ADMIN_UID);
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: 'not_found' });
    }
    expect((await preview('00000000-0000-4000-8000-000000000000', ADMIN_UID)).status).toBe(404);
    expect((await preview('nope', ADMIN_UID)).status).toBe(404);
  });

  it('previewing changes no row: every roastery_portal_* table and the email log are identical before and after', async () => {
    const before = await snapshot();
    for (let i = 0; i < 3; i++) {
      await preview(roasterA, ADMIN_UID); await preview(roasterB, ADMIN_UID);
      await previewCoffee(roasterA, coffeeA, ADMIN_UID); await previewCoffee(roasterA, coffeeA2, ADMIN_UID);
      await previewCoffee(roasterA, coffeeB, ADMIN_UID);
    }
    expect(await snapshot()).toEqual(before);
    expect(Object.keys(before).length).toBeGreaterThan(8);
  });
});

describe('the browser preview client', () => {
  const PREVIEW_API = fileURLToPath(new URL('../../../frontend/src/app/components/roastery-portal/previewApi.ts', import.meta.url));

  it('never imports the public client and names no /api/roastery-portal URL in code', () => {
    const code = readFileSync(PREVIEW_API, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/from\s+['"]\.\/api['"]/);
    expect(code).not.toMatch(/portalApi/);
    expect(code).not.toMatch(/\/api\/roastery-portal/);
  });

  it('issues no request on any of its six write actions, and only admin preview GETs for its two reads', async () => {
    const mod: any = await import(/* @vite-ignore */ PREVIEW_API);
    const calls: { url: string; method: string; auth: string | null }[] = [];
    const fake = (async (url: any, init: any) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', auth: init?.headers?.Authorization ?? null });
      const u = String(url);
      const body = u.endsWith('/preview')
        ? { roastery: { name: 'R' }, contact: { name: null, email: null }, vocabulary: {}, counts: { total: 1, submitted: 0 }, lineupResponse: null,
            lineup: [{ portalCoffeeId: 'c1', name: 'One', state: 'not_started', isActive: true }] }
        : { coffee: { portalCoffeeId: 'c1', name: 'One', state: 'not_started', isActive: true }, response: null };
      return { ok: true, status: 200, json: async () => body } as any;
    }) as typeof fetch;
    // any stray use of the global fetch (the public client's transport) fails the test loudly
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error('preview used the global fetch'); }) as any;
    try {
      const c = mod.createPreviewClient('roaster-1', async () => 'admin-token', fake);
      await c.landing('roaster-1');
      await c.getCoffee('roaster-1', 'c1');
      const readsOnly = calls.length;
      expect(readsOnly).toBe(2);

      const who = await c.registerRespondent('roaster-1', 'Ann', 'ann@example.com');
      const added = await c.addCoffee('roaster-1', 'A coffee not listed', who.respondentId);
      await c.saveDraft('roaster-1', 'c1', who.respondentId, { origin: 'Kenya', notes: [{ words: 'plum', cuppingNoteId: null }] });
      await c.saveDraft('roaster-1', 'c1', who.respondentId, { origin: 'Kenya' }, true);
      await c.submit('roaster-1', 'c1', who.respondentId);
      await c.saveLineup('roaster-1', who.respondentId, { typicalNotice: 'weeks', similarWhenOut: null, bestSellers: ['c1'] });
      await c.submitLineup('roaster-1', who.respondentId);
      expect(calls.length).toBe(readsOnly);            // the writes made no request at all

      // ...yet they behaved: the local state shows up in the next reads
      const l = await c.landing('roaster-1');
      expect(l.lineup.find((r: any) => r.portalCoffeeId === 'c1').state).toBe('submitted');
      expect(l.lineup.some((r: any) => r.portalCoffeeId === added.id)).toBe(true);
      expect(l.lineupResponse.status).toBe('submitted');
      expect((await c.getCoffee('roaster-1', added.id)).coffee.name).toBe('A coffee not listed');
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.method).toBe('GET');
      expect(call.url).toMatch(/^\/api\/admin\/roastery-portal\/roasteries\/roaster-1\/preview/);
      expect(call.url).not.toContain('/api/roastery-portal');
      expect(call.auth).toBe('Bearer admin-token');
    }
  });
});
