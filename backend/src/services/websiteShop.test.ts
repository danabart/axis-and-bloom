// Website 4 (2026-11-05), Part C (backend) — OT-70: a category coffee's
// customer-facing name lives on its category role
// (coffee_category_assignment.customer_name), written only by
// catalogService.setCategoryCustomerName; the raw coffees.name is never shown,
// and a category coffee with no customer name is not listed.
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_4_SHOP_ALL.md
// Runs on the test DB. The fixture is a Vitest decaf coffee with no slot,
// removed in afterAll.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import coffeesRouter from '../routes/coffees.js';
import { db } from '../db/client.js';
import { createCoffee, updateCoffee, setCategoryCustomerName, CatalogError } from './catalogService.js';

const ACTOR = { actor: 'vitest' };
const RAW_NAME = 'Vitest Website4 Raw Roaster Name';
let server: Server;
let base: string;
let coffeeId: number;

async function getJson(path: string) {
  const res = await fetch(`${base}${path}`);
  expect(res.status).toBe(200);
  return res.json();
}
const otherCard = async () => (await getJson('/coffees/cards')).other.cards.find((c: { coffeeId: number }) => c.coffeeId === coffeeId) ?? null;
const otherCategory = async () => (await getJson('/coffees/other-categories')).find((c: { coffeeId: number }) => c.coffeeId === coffeeId) ?? null;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/coffees', coffeesRouter);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api`;

  const roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Website4 Roastery', true) RETURNING id`)).rows[0];
  const { result } = await createCoffee({ roasterId: roaster.id, name: RAW_NAME, categoryCodes: ['decaf'] }, ACTOR);
  coffeeId = result.coffeeId;
}, 30000);

afterAll(async () => {
  await db.query(`DELETE FROM coffee_category_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest Website4%')`);
  await db.query(`DELETE FROM coffees WHERE name LIKE 'Vitest Website4%'`);
  await db.query(`DELETE FROM roaster WHERE name LIKE 'Vitest Website4%'`);
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('OT-70: a category coffee name', () => {
  it('without a customer name the coffee is not listed, and its raw name never appears', async () => {
    expect(await otherCard()).toBeNull();
    expect(await otherCategory()).toBeNull();
    expect(JSON.stringify(await getJson('/coffees/cards'))).not.toContain(RAW_NAME);
    expect(JSON.stringify(await getJson('/coffees/other-categories'))).not.toContain(RAW_NAME);
  });

  it('setCategoryCustomerName writes the role name; both reads show it', async () => {
    const first = await setCategoryCustomerName({ coffeeId, categoryCode: 'decaf', customerName: '  Quiet Night  ' }, ACTOR);
    expect(first.result).toMatchObject({ customerName: 'Quiet Night', unchanged: false });
    expect((await otherCard())?.platformName).toBe('Quiet Night');
    expect((await otherCategory())?.displayName).toBe('Quiet Night');
    const log = (await db.query(`SELECT COUNT(*)::int AS n FROM catalog_change WHERE entity = 'coffee_category_assignment' AND entity_id = $1::text AND action = 'setCategoryCustomerName'`, [coffeeId])).rows[0];
    expect(log.n).toBe(1);
  });

  it('is idempotent: the same name again changes nothing', async () => {
    const again = await setCategoryCustomerName({ coffeeId, categoryCode: 'decaf', customerName: 'Quiet Night' }, ACTOR);
    expect(again.result.unchanged).toBe(true);
    const log = (await db.query(`SELECT COUNT(*)::int AS n FROM catalog_change WHERE entity = 'coffee_category_assignment' AND entity_id = $1::text`, [coffeeId])).rows[0];
    expect(log.n).toBe(1);
  });

  it('keeps the name when the coffee is re-saved with the same categories', async () => {
    await updateCoffee({ coffeeId, categoryCodes: ['decaf'] }, ACTOR);
    expect((await otherCard())?.platformName).toBe('Quiet Night');
  });

  it('refuses a category the coffee does not carry', async () => {
    await expect(setCategoryCustomerName({ coffeeId, categoryCode: 'flavored', customerName: 'x' }, ACTOR)).rejects.toBeInstanceOf(CatalogError);
  });

  it('blank clears it, and the coffee leaves the lists again', async () => {
    await setCategoryCustomerName({ coffeeId, categoryCode: 'decaf', customerName: '' }, ACTOR);
    expect(await otherCard()).toBeNull();
    expect(await otherCategory()).toBeNull();
  });

  it('is declared as a writer of coffee_category_assignment', () => {
    const comments = readFileSync(fileURLToPath(new URL('../db/comments.sql', import.meta.url)), 'utf8');
    const line = comments.split('\n').find(l => l.startsWith('COMMENT ON TABLE coffee_category_assignment IS'));
    expect(line).toMatch(/catalogService\.setCategoryCustomerName/);
  });
});
