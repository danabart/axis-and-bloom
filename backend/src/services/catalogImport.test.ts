// Catalog Blueprint · brief 2 (2026-09-14). Requires DATABASE_URL. Uses the
// EXAMPLE_manifest.json fixture directly (its roaster and both coffees are
// 'Vitest'-prefixed by design — see the manifest's own _comment) against a
// real Vitest roaster this test creates and tears down.
import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../db/client.js';
import { importCatalog, type Manifest } from './catalogImport.js';

// Resolved from process.cwd() (always `backend/`, whether vitest picked up
// this file from src/ or the compiled dist/ copy), not import.meta.url —
// tsc doesn't copy .json assets into dist/, so a dist-relative path would
// 404 for the compiled test even though the source file it mirrors is fine.
const manifest: Manifest = JSON.parse(
  readFileSync(join(process.cwd(), 'src/features/catalog_blueprint/manifests/EXAMPLE_manifest.json'), 'utf8')
);
const ROASTER_NAME = manifest.roaster.name; // "Vitest Import Roastery"

afterAll(async () => {
  await db.query(`DELETE FROM dial_coffee_relationships WHERE from_coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%') OR to_coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM archetype_assignments WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM roaster_blend WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffees WHERE name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM roaster WHERE name = $1`, [ROASTER_NAME]);
  await db.query(`DELETE FROM dial_slot_price WHERE slot_id IN (SELECT id FROM coffee_dial_slot WHERE archetype = 'floral' AND sort_order IN (3, 4))`);
});

async function countManifestRows() {
  const coffees = await db.query(`SELECT COUNT(*) AS c FROM coffees WHERE name LIKE 'Vitest Import%'`);
  const assignments = await db.query(`SELECT COUNT(*) AS c FROM coffee_slot_assignment csa JOIN coffees c ON c.id = csa.coffee_id WHERE c.name LIKE 'Vitest Import%'`);
  return { coffees: Number(coffees.rows[0].c), assignments: Number(assignments.rows[0].c) };
}

describe('importCatalog — EXAMPLE_manifest.json', () => {
  let roaster: { id: string } | undefined;

  it('sets up the Vitest roaster the manifest references', async () => {
    roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ($1, true) RETURNING id`, [ROASTER_NAME])).rows[0];
    expect(roaster.id).toBeTruthy();
  });

  it('dry run writes nothing and reports both coffees with their expected shape', async () => {
    const before = await countManifestRows();
    const report = await importCatalog(manifest, { dryRun: true, actor: 'vitest' });
    const after = await countManifestRows();

    expect(after).toEqual(before);
    expect(report.dryRun).toBe(true);
    expect(report.coffees.length).toBe(2);
    expect(report.coffees.every(c => c.status === 'created')).toBe(true);
    expect(report.coffees.every(c => c.errors.length === 0)).toBe(true);
    if (!report.integrity?.allPass) console.log('integrity failures:', JSON.stringify(report.integrity?.checks.filter(c => !c.pass), null, 2));
    expect(report.integrity?.allPass).toBe(true);
  }, 30000);

  it('apply writes everything; the unscoped integrity report is allPass', async () => {
    const report = await importCatalog(manifest, { dryRun: false, actor: 'vitest' });
    expect(report.dryRun).toBe(false);
    expect(report.coffees.every(c => c.status === 'created' && c.coffeeId)).toBe(true);
    expect(report.slotPrices.every(p => p.status === 'set')).toBe(true);
    if (!report.integrity?.allPass) console.log('integrity failures:', JSON.stringify(report.integrity?.checks.filter(c => !c.pass), null, 2));
    expect(report.integrity?.allPass).toBe(true);

    const after = await countManifestRows();
    expect(after.coffees).toBe(2);
    expect(after.assignments).toBeGreaterThan(0);
  }, 30000);

  it('a second apply reports COFFEE_EXISTS for both and writes nothing further', async () => {
    const before = await countManifestRows();
    const report = await importCatalog(manifest, { dryRun: false, actor: 'vitest' });
    const after = await countManifestRows();

    expect(after).toEqual(before);
    expect(report.coffees.every(c => c.status === 'error' && c.errors.includes('COFFEE_EXISTS'))).toBe(true);
  });

  it('skip_existing mode reports both as skipped', async () => {
    const report = await importCatalog(manifest, { dryRun: true, actor: 'vitest', mode: 'skip_existing' });
    expect(report.coffees.every(c => c.status === 'skipped')).toBe(true);
  });
});
