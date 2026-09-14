// Catalog Blueprint · brief 2 (2026-09-14). Same pattern as admin.roasters.test.ts:
// requireAdmin mocked to a passthrough, a real HTTP server wrapping the real
// router, real DB. Requires DATABASE_URL.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../middleware/auth.js', () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

const { default: adminRouter } = await import('./admin.js');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/admin`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('retired placement endpoints', () => {
  const retired: Array<[string, string]> = [
    ['POST', '/coffees'],
    ['PATCH', '/coffees/1'],
    ['DELETE', '/coffees/1'],
    ['POST', '/coffees/1/archetype'],
    ['POST', '/coffee-alias'],
    ['PATCH', '/coffee-alias/slot'],
    ['PATCH', '/coffee-alias/1'],
    ['PATCH', '/slot-prices'],
    ['PATCH', '/dial/vocabulary/1'],
    ['POST', '/dial/positions'],
    ['PATCH', '/dial/positions/1'],
    ['DELETE', '/dial/positions/1'],
    ['POST', '/dial/positions/guest'],
    ['DELETE', '/dial/positions/guest/1'],
    ['POST', '/dial/relationships'],
    ['DELETE', '/dial/relationships/1'],
    ['PATCH', '/inventory/1'],
    ['POST', '/inventory/1/restock'],
  ];

  for (const [method, path] of retired) {
    it(`${method} ${path} returns 410`, async () => {
      const res = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.error).toBe('RETIRED');
    });
  }
});

describe('POST /catalog/coffees', () => {
  it('returns 400 INVALID_INPUT without roasterId', async () => {
    const res = await fetch(`${baseUrl}/catalog/coffees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Vitest Route Test Coffee' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('INVALID_INPUT');
  });
});
