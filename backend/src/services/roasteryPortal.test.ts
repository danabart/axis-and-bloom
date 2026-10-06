// Roastery Portal (2026-10-05) — service + route coverage on the isolated test
// database (see vitest.config.ts). Covers the five behaviours the brief names:
// token isolation between two roasteries, the one-draft rule, submitted rows
// immutable, version bump on reopen, vocabulary validation — plus the brew
// vocabulary drift guard, the progress view, and the portal lint.
//
// Fixtures: two standing roasteries ("Portal Test Roastery A/B", created once,
// reused) — never named Vitest%, so the other suites' sweeps can't hit them
// (submitted responses are immutable by trigger, so nothing here is ever
// deleted; each run adds uniquely named lineup coffees and deactivates them in
// afterAll, which is exactly what "nothing is ever deleted" means in prod).
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { db } from '../db/client.js';
import {
  PortalError, createLink, revokeLink, upsertRespondent, addLineupCoffee, bulkAddLineupCoffees,
  linkLineupCoffeeToCatalog, deactivateLineupCoffee, saveDraft, submitResponse,
  saveLineupDraft, submitLineupResponse, updateLineupCoffee,
} from './roasteryPortalService.js';
import {
  getActiveLinkByToken, getVocabulary, getLineupCoffee, getCurrentResponse, getLineup,
  getCurrentLineupResponse, listResponseVersions,
} from './roasteryPortalReads.js';
import { getBrewProfileFieldsConfig } from './brewProfile.js';
import roasteryPortalRouter from '../routes/roasteryPortal.js';

// Every query crosses the Cloud SQL Auth Proxy from a dev machine; the default 5s is too tight.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const created: string[] = [];

async function standingRoaster(name: string): Promise<string> {
  const found = await db.query(`SELECT id FROM roaster WHERE name = $1`, [name]);
  if (found.rows[0]) return found.rows[0].id;
  return (await db.query(`INSERT INTO roaster (name, is_active) VALUES ($1, true) RETURNING id`, [name])).rows[0].id;
}

// Inactive on purpose: catalog integrity check #6 fails the whole suite for any ACTIVE coffee without an archetype assignment.
async function standingCatalogCoffee(roasterId: string, name: string): Promise<number> {
  const found = await db.query(`SELECT id FROM coffees WHERE name = $1 AND roaster_id = $2`, [name, roasterId]);
  if (found.rows[0]) return found.rows[0].id;
  return (await db.query(`INSERT INTO coffees (name, roaster_id, is_active) VALUES ($1, $2, false) RETURNING id`, [name, roasterId])).rows[0].id;
}

let roasterA: string; let roasterB: string;
let linkA: Awaited<ReturnType<typeof createLink>>; let linkB: Awaited<ReturnType<typeof createLink>>;
let personA: { id: string }; let personB: { id: string };
let server: Server; let baseUrl: string;

async function newCoffee(roasterId: string, label: string) {
  const c = await addLineupCoffee({ roasterId, name: `PT ${label} ${RUN}`, addedBy: 'admin' });
  created.push(c.id);
  return c;
}

beforeAll(async () => {
  roasterA = await standingRoaster('Portal Test Roastery A');
  roasterB = await standingRoaster('Portal Test Roastery B');
  linkA = await createLink({ roasterId: roasterA, adminFirebaseUid: 'vitest-no-such-admin' });
  linkB = await createLink({ roasterId: roasterB, contactName: 'Bea', contactEmail: 'Bea@Example.com', adminFirebaseUid: 'vitest-no-such-admin' });
  personA = await upsertRespondent({ roasterId: roasterA, linkId: linkA.id, name: 'Ann', email: 'ann@example.com' });
  personB = await upsertRespondent({ roasterId: roasterB, linkId: linkB.id, name: 'Bea', email: 'bea@example.com' });

  const app = express();
  app.use(express.json());
  app.use('/api/roastery-portal', roasteryPortalRouter);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/roastery-portal`;
});

afterAll(async () => {
  for (const id of created) await deactivateLineupCoffee({ roasterId: roasterA, portalCoffeeId: id }).catch(() => undefined);
  for (const id of created) await deactivateLineupCoffee({ roasterId: roasterB, portalCoffeeId: id }).catch(() => undefined);
  await revokeLink(linkA.id).catch(() => undefined);
  await revokeLink(linkB.id).catch(() => undefined);
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function expectPortalError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ name: 'PortalError', code });
}

describe('links and token isolation', () => {
  it('mints long url-safe tokens, lowercases the contact email, and resolves each to its own roastery', async () => {
    expect(linkA.token.length).toBeGreaterThanOrEqual(32);
    expect(linkA.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(linkB.contactEmail).toBe('bea@example.com');
    expect((await getActiveLinkByToken(linkA.token))?.roasterId).toBe(roasterA);
    expect((await getActiveLinkByToken(linkB.token))?.roasterId).toBe(roasterB);
    expect(await getActiveLinkByToken('x'.repeat(43))).toBeNull();
  });

  it('a revoked token resolves to null, the same as an unknown one', async () => {
    const tmp = await createLink({ roasterId: roasterA, adminFirebaseUid: 'vitest-no-such-admin' });
    expect(await getActiveLinkByToken(tmp.token)).not.toBeNull();
    expect((await revokeLink(tmp.id)).revoked).toBe(true);
    expect(await getActiveLinkByToken(tmp.token)).toBeNull();
  });

  it("never lets one roastery read, save, or link another roastery's coffee", async () => {
    const coffeeA = await newCoffee(roasterA, 'iso');
    expect(await getLineupCoffee(roasterB, coffeeA.id)).toBeNull();
    expect(await getLineupCoffee(roasterA, coffeeA.id)).not.toBeNull();
    await expectPortalError(saveDraft({ roasterId: roasterB, portalCoffeeId: coffeeA.id, respondentId: personB.id, doc: {} }), 'not_found');
    await expectPortalError(submitResponse({ roasterId: roasterB, portalCoffeeId: coffeeA.id, respondentId: personB.id }), 'not_found');
    // A respondent of A is not a respondent of B.
    const coffeeB = await newCoffee(roasterB, 'iso-b');
    await expect(saveDraft({ roasterId: roasterB, portalCoffeeId: coffeeB.id, respondentId: personA.id, doc: {} }))
      .rejects.toMatchObject({ code: 'validation' });
    // A cousin from another roastery is not allowed either.
    await expect(saveDraft({ roasterId: roasterB, portalCoffeeId: coffeeB.id, respondentId: personB.id, doc: { closestCousinPortalCoffeeId: coffeeA.id } }))
      .rejects.toMatchObject({ code: 'validation' });
    // Catalog link: only a coffee of the SAME roastery.
    const catalogOfB = await standingCatalogCoffee(roasterB, 'Portal Test Catalog Coffee B');
    await expectPortalError(linkLineupCoffeeToCatalog({ roasterId: roasterA, portalCoffeeId: coffeeA.id, coffeeId: catalogOfB }), 'wrong_roastery');
    const catalogOfA = await standingCatalogCoffee(roasterA, 'Portal Test Catalog Coffee A');
    await linkLineupCoffeeToCatalog({ roasterId: roasterA, portalCoffeeId: coffeeA.id, coffeeId: catalogOfA });
    expect((await getLineupCoffee(roasterA, coffeeA.id))?.coffeeId).toBe(catalogOfA);
  });

  it('answers a wrong token, a revoked token, and another roastery\'s coffee with the identical 404 over HTTP', async () => {
    const coffeeA = await newCoffee(roasterA, 'http-iso');
    const tmp = await createLink({ roasterId: roasterB, adminFirebaseUid: 'vitest-no-such-admin' });
    await revokeLink(tmp.id);

    const probes = [
      `${baseUrl}/${'z'.repeat(43)}`,
      `${baseUrl}/${tmp.token}`,
      `${baseUrl}/${linkB.token}/coffees/${coffeeA.id}`,
      `${baseUrl}/${linkB.token}/coffees/not-a-uuid`,
    ];
    const bodies: string[] = [];
    for (const url of probes) {
      const res = await fetch(url);
      expect(res.status).toBe(404);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);

    // Writes with the first roastery's coffee id and the second roastery's token: nothing leaks.
    const put = await fetch(`${baseUrl}/${linkB.token}/coffees/${coffeeA.id}/draft`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ respondentId: personB.id, doc: {} }),
    });
    expect(put.status).toBe(404);
    expect(await put.text()).toBe(bodies[0]);
  });

  it('the landing payload carries only this roastery, its vocabulary and its lineup', async () => {
    const coffeeB = await newCoffee(roasterB, 'landing');
    const res = await fetch(`${baseUrl}/${linkB.token}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.roastery.name).toBe('Portal Test Roastery B');
    expect(body.contact).toEqual({ name: 'Bea', email: 'bea@example.com' });
    expect(body.lineup.some((c: any) => c.portalCoffeeId === coffeeB.id)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('Portal Test Roastery A');
    expect(body.vocabulary.dimensions).toHaveLength(7);
  });
});

describe('the lineup', () => {
  it('rejects a duplicate active name (case-insensitive), skips duplicates in a bulk paste, and allows reuse after deactivation', async () => {
    const c = await newCoffee(roasterA, 'dupe');
    await expectPortalError(addLineupCoffee({ roasterId: roasterA, name: `  ${c.name.toUpperCase()} `, addedBy: 'admin' }), 'duplicate_name');
    const bulk = await bulkAddLineupCoffees({ roasterId: roasterA, names: [`PT bulk-one ${RUN}`, `pt BULK-ONE ${RUN}`, '', `PT bulk-two ${RUN}`] });
    expect(bulk.added).toHaveLength(2);
    expect(bulk.skipped).toHaveLength(1);
    created.push(...bulk.added.map(a => a.id));
    await deactivateLineupCoffee({ roasterId: roasterA, portalCoffeeId: bulk.added[0].id });
    const again = await addLineupCoffee({ roasterId: roasterA, name: bulk.added[0].name, addedBy: 'admin' });
    created.push(again.id);
  });

  it('validates prefills against the lookup vocabulary and lets the roaster add a coffee we missed', async () => {
    await expect(addLineupCoffee({ roasterId: roasterA, name: `PT bad ${RUN}`, addedBy: 'admin', roastLevel: 'burnt' })).rejects.toMatchObject({ code: 'validation' });
    await expect(addLineupCoffee({ roasterId: roasterA, name: `PT bad ${RUN}`, addedBy: 'admin', processValues: ['smoked'] })).rejects.toMatchObject({ code: 'validation' });
    const added = await addLineupCoffee({ roasterId: roasterA, name: `PT roaster-added ${RUN}`, addedBy: 'roaster', respondentId: personA.id });
    created.push(added.id);
    const row = await getLineupCoffee(roasterA, added.id);
    expect(row?.addedBy).toBe('roaster');
    await expect(addLineupCoffee({ roasterId: roasterA, name: `PT nobody ${RUN}`, addedBy: 'roaster', respondentId: personB.id })).rejects.toMatchObject({ code: 'validation' });
  });

  it("a linked coffee prefills from the catalog, but a roaster_site row keeps the roaster's own words", async () => {
    const catalogOfA = await standingCatalogCoffee(roasterA, 'Portal Test Catalog Coffee A');
    await db.query(`UPDATE coffees SET origin = NULL WHERE id = $1`, [catalogOfA]);
    const site = await addLineupCoffee({ roasterId: roasterA, name: `PT site ${RUN}`, addedBy: 'admin', origin: 'Cauca, Colombia', processValues: ['washed', 'natural'], roastLevel: 'light-medium', prefillSource: 'roaster_site' });
    created.push(site.id);
    await linkLineupCoffeeToCatalog({ roasterId: roasterA, portalCoffeeId: site.id, coffeeId: catalogOfA });
    const row = await getLineupCoffee(roasterA, site.id);
    expect(row?.origin).toBe('Cauca, Colombia');
    expect(row?.processValues).toEqual(['washed', 'natural']);
    expect(row?.prefillSource).toBe('roaster_site');
    await updateLineupCoffee({ roasterId: roasterA, portalCoffeeId: site.id, patch: { processValues: [] } });
    expect((await getLineupCoffee(roasterA, site.id))?.processValues).toEqual([]);
  });
});

describe('drafts, versions and immutability', () => {
  async function fullDoc(extra: Record<string, unknown> = {}) {
    const vocab = await getVocabulary({ fresh: true });
    const pick = vocab.wheel[0].subcategories[0].descriptors[0];
    return {
      origin: 'Test origin', processValues: ['washed'], roastLevel: 'light', blendOrSingle: 'single', isDecaf: false,
      notes: [{ words: 'Stone fruit, honey', cuppingNoteId: null }, { words: pick.descriptor, cuppingNoteId: pick.id }],
      proposedArchetype: vocab.archetypes[0].code,
      dimensions: Object.fromEntries(vocab.dimensions.map((d, i) => [String(d.dimensionId), (i % 5) + 1])),
      dominantDimensionId: vocab.dimensions[0].dimensionId,
      bestBrew: 'v60', alsoGoodBrews: ['drip', 'espresso'], takesIt: 'both', brewNotes: 'Finer than you think',
      availability: 'always_on', typicalNotice: '1_to_2_months', expectedAvailability: 'Through March', similarWhenOut: 'usually',
      whatChanges: 'Darker', anythingElse: 'Hello',
      ...extra,
    };
  }

  it('keeps exactly one open draft per coffee however many times it is saved, and refuses a second raw draft', async () => {
    const coffee = await newCoffee(roasterA, 'onedraft');
    const first = await saveDraft({ roasterId: roasterA, portalCoffeeId: coffee.id, respondentId: personA.id, doc: await fullDoc() });
    const second = await saveDraft({ roasterId: roasterA, portalCoffeeId: coffee.id, respondentId: personA.id, doc: await fullDoc({ origin: 'Changed' }) });
    expect(second.responseId).toBe(first.responseId);
    expect(second.version).toBe(1);
    const drafts = await db.query(`SELECT count(*)::int AS n FROM roastery_portal_response WHERE portal_coffee_id = $1 AND status = 'draft'`, [coffee.id]);
    expect(drafts.rows[0].n).toBe(1);
    await expect(db.query(`INSERT INTO roastery_portal_response (portal_coffee_id, version, status) VALUES ($1, 99, 'draft')`, [coffee.id]))
      .rejects.toMatchObject({ code: '23505' });
    // Two simultaneous first saves still produce a single draft.
    const racy = await newCoffee(roasterA, 'race');
    await Promise.all([1, 2, 3].map(() => saveDraft({ roasterId: roasterA, portalCoffeeId: racy.id, respondentId: personA.id, doc: {} })));
    const racyDrafts = await db.query(`SELECT count(*)::int AS n FROM roastery_portal_response WHERE portal_coffee_id = $1`, [racy.id]);
    expect(racyDrafts.rows[0].n).toBe(1);
  });

  it('full-document replace: children are replaced, not appended, and the document round-trips', async () => {
    const coffee = await newCoffee(roasterA, 'replace');
    await saveDraft({ roasterId: roasterA, portalCoffeeId: coffee.id, respondentId: personA.id, doc: await fullDoc() });
    await saveDraft({ roasterId: roasterA, portalCoffeeId: coffee.id, respondentId: personA.id, doc: await fullDoc({ notes: [{ words: 'Only one', cuppingNoteId: null }], alsoGoodBrews: ['espresso'] }) });
    const cur = await getCurrentResponse(coffee.id);
    expect(cur?.notes.map(n => n.roasterWords)).toEqual(['Only one']);
    expect(cur?.alsoGoodBrews).toEqual(['espresso']);
    expect(cur?.bestBrew).toBe('v60');
    expect(cur?.lastSavedByName).toBe('Ann');
    expect(Object.keys(cur?.dimensions ?? {})).toHaveLength(7);
  });

  it('submit makes the row and its children immutable; reopening starts version 2 as a copy and leaves version 1 untouched', async () => {
    const coffee = await newCoffee(roasterA, 'versions');
    await saveDraft({ roasterId: roasterA, portalCoffeeId: coffee.id, respondentId: personA.id, doc: await fullDoc() });
    const sub = await submitResponse({ roasterId: roasterA, portalCoffeeId: coffee.id, respondentId: personA.id });
    expect(sub.version).toBe(1);
    const v1 = (await db.query(`SELECT * FROM roastery_portal_response WHERE portal_coffee_id = $1 AND version = 1`, [coffee.id])).rows[0];
    expect(v1.status).toBe('submitted');
    expect(v1.submitted_by_respondent_id).toBe(personA.id);

    // Immutable: UPDATE and DELETE on the row, and every child set.
    await expect(db.query(`UPDATE roastery_portal_response SET origin = 'tampered' WHERE id = $1`, [v1.id])).rejects.toMatchObject({ code: '23000' });
    await expect(db.query(`DELETE FROM roastery_portal_response WHERE id = $1`, [v1.id])).rejects.toMatchObject({ code: '23000' });
    await expect(db.query(`UPDATE roastery_portal_response_note SET roaster_words = 'x' WHERE response_id = $1`, [v1.id])).rejects.toMatchObject({ code: '23000' });
    await expect(db.query(`DELETE FROM roastery_portal_response_dimension WHERE response_id = $1`, [v1.id])).rejects.toMatchObject({ code: '23000' });
    await expect(db.query(`DELETE FROM roastery_portal_response_brew WHERE response_id = $1`, [v1.id])).rejects.toMatchObject({ code: '23000' });
    await expect(db.query(`INSERT INTO roastery_portal_response_note (response_id, rank, roaster_words) VALUES ($1, 99, 'late')`, [v1.id])).rejects.toMatchObject({ code: '23000' });
    // Submitting again with no open draft is a conflict, not a silent no-op.
    await expectPortalError(submitResponse({ roasterId: roasterA, portalCoffeeId: coffee.id, respondentId: personA.id }), 'no_draft');

    // Reopen: the first edit opens version 2, pre-filled from version 1.
    const reopened = await saveDraft({ roasterId: roasterA, portalCoffeeId: coffee.id, respondentId: personA.id, doc: await fullDoc({ origin: 'Edited origin' }) });
    expect(reopened.version).toBe(2);
    const v2sub = await submitResponse({ roasterId: roasterA, portalCoffeeId: coffee.id, respondentId: personA.id });
    expect(v2sub.version).toBe(2);

    const v1After = (await db.query(`SELECT * FROM roastery_portal_response WHERE id = $1`, [v1.id])).rows[0];
    expect(v1After).toEqual(v1);
    expect(v1After.origin).toBe('Test origin');
    const versions = await listResponseVersions(coffee.id);
    expect(versions.map(v => [v.version, v.status])).toEqual([[2, 'submitted'], [1, 'submitted']]);
    expect((await getCurrentResponse(coffee.id))?.origin).toBe('Edited origin');
  });

  it('a reopened draft copies the previous version\'s children before the first edit lands', async () => {
    const coffee = await newCoffee(roasterA, 'copy');
    await saveDraft({ roasterId: roasterA, portalCoffeeId: coffee.id, respondentId: personA.id, doc: await fullDoc() });
    await submitResponse({ roasterId: roasterA, portalCoffeeId: coffee.id, respondentId: personA.id });
    await saveDraft({ roasterId: roasterA, portalCoffeeId: coffee.id, respondentId: personA.id, doc: await fullDoc({ brewNotes: 'Second take' }) });
    const cur = await getCurrentResponse(coffee.id);
    expect(cur?.version).toBe(2);
    expect(cur?.status).toBe('draft');
    expect(cur?.notes).toHaveLength(2);
    expect(cur?.alsoGoodBrews.sort()).toEqual(['drip', 'espresso']);
  });

  it('progress view: state, sections answered, who last saved, and the needs-mapping marker', async () => {
    const coffee = await newCoffee(roasterA, 'progress');
    let row = (await getLineup(roasterA)).find(c => c.portalCoffeeId === coffee.id)!;
    expect(row.state).toBe('not_started');
    expect(row.sectionsAnswered).toBe(0);

    await saveDraft({ roasterId: roasterA, portalCoffeeId: coffee.id, respondentId: personA.id, doc: { notes: [{ words: 'Plum', cuppingNoteId: null }], dimensions: { } } });
    row = (await getLineup(roasterA)).find(c => c.portalCoffeeId === coffee.id)!;
    expect(row.state).toBe('in_progress');
    expect(row.sectionsAnswered).toBe(1);
    expect(row.lastSavedByName).toBe('Ann');

    await saveDraft({ roasterId: roasterA, portalCoffeeId: coffee.id, respondentId: personA.id, doc: await fullDoc() });
    row = (await getLineup(roasterA)).find(c => c.portalCoffeeId === coffee.id)!;
    expect(row.sectionsAnswered).toBe(6);
    expect(row.hasUnmappedNotes).toBe(true); // the first note has words only

    await submitResponse({ roasterId: roasterA, portalCoffeeId: coffee.id, respondentId: personA.id });
    row = (await getLineup(roasterA)).find(c => c.portalCoffeeId === coffee.id)!;
    expect(row.state).toBe('submitted');
    expect(row.submittedByName).toBe('Ann');
    expect(row.submittedVersionCount).toBe(1);
    expect(row.hasOpenDraft).toBe(false);
  });

  it('lineup answers are versioned the same way and immutable once submitted', async () => {
    const before = await getCurrentLineupResponse(roasterB);
    await saveLineupDraft({ roasterId: roasterB, respondentId: personB.id, doc: { typicalNotice: 'under_2_weeks', similarWhenOut: 'yes', anythingElse: 'Hi' } });
    const sub = await submitLineupResponse({ roasterId: roasterB, respondentId: personB.id });
    expect(sub.version).toBe((before?.version ?? 0) + 1);
    const row = (await db.query(`SELECT id FROM roastery_portal_lineup_response WHERE roaster_id = $1 AND version = $2`, [roasterB, sub.version])).rows[0];
    await expect(db.query(`UPDATE roastery_portal_lineup_response SET typical_notice = 'x' WHERE id = $1`, [row.id])).rejects.toMatchObject({ code: '23000' });
    await expectPortalError(submitLineupResponse({ roasterId: roasterB, respondentId: personB.id }), 'no_draft');
    const reopened = await saveLineupDraft({ roasterId: roasterB, respondentId: personB.id, doc: { typicalNotice: '2_plus_months' } });
    expect(reopened.version).toBe(sub.version + 1);
    await submitLineupResponse({ roasterId: roasterB, respondentId: personB.id });
  });
});

describe('vocabulary validation', () => {
  let coffeeId: string;
  beforeAll(async () => { coffeeId = (await newCoffee(roasterA, 'vocab')).id; });

  async function rejects(doc: Record<string, unknown>) {
    await expect(saveDraft({ roasterId: roasterA, portalCoffeeId: coffeeId, respondentId: personA.id, doc })).rejects.toMatchObject({ name: 'PortalError', code: 'validation' });
  }

  it('rejects any value outside the allowed vocabulary', async () => {
    await rejects({ processValues: ['smoked'] });
    await rejects({ roastLevel: 'burnt' });
    await rejects({ blendOrSingle: 'triple' });
    await rejects({ bestBrew: 'chemex' });
    await rejects({ alsoGoodBrews: ['chemex'] });
    await rejects({ bestBrew: 'v60', alsoGoodBrews: ['v60'] });
    await rejects({ takesIt: 'sugar' });
    await rejects({ availability: 'sometimes' });
    await rejects({ typicalNotice: 'next_week' });
    await rejects({ similarWhenOut: 'maybe' });
    await rejects({ proposedArchetype: 'balanced' }); // the enum code is balanced_sweet
    await rejects({ dimensions: { '99999': 3 } });
    await rejects({ dimensions: { '5': 6 } });
    await rejects({ dimensions: { '5': 0 } });
    await rejects({ dominantDimensionId: 99999 });
  });

  it('rejects a wheel pick that is not an active wheel descriptor (defects under Other are not offered)', async () => {
    const defect = (await db.query(`SELECT id FROM cupping_note WHERE wheel_category = 'Other' AND is_active LIMIT 1`)).rows[0];
    await rejects({ notes: [{ words: 'musty', cuppingNoteId: defect.id }] });
    await rejects({ notes: [{ words: 'x', cuppingNoteId: '00000000-0000-0000-0000-000000000000' }] });
    await rejects({ notes: [{ words: 'x', cuppingNoteId: 'nope' }] });
  });

  it('caps free text and the number of notes, and rejects a coffee as its own cousin', async () => {
    await rejects({ origin: 'x'.repeat(301) });
    await rejects({ brewNotes: 'x'.repeat(2001) });
    await rejects({ anythingElse: 'x'.repeat(2001) });
    await rejects({ notes: Array.from({ length: 16 }, (_, i) => ({ words: `n${i}`, cuppingNoteId: null })) });
    await rejects({ closestCousinPortalCoffeeId: coffeeId });
    await expect(addLineupCoffee({ roasterId: roasterA, name: 'x'.repeat(121), addedBy: 'admin' })).rejects.toBeInstanceOf(PortalError);
    await expect(upsertRespondent({ roasterId: roasterA, linkId: linkA.id, name: 'No Email', email: 'not-an-email' })).rejects.toMatchObject({ code: 'validation' });
  });

  it('accepts a legal document, keeps a words-only note, names a pick-only note after its descriptor, and drops an empty note', async () => {
    const vocab = await getVocabulary({ fresh: true });
    const pick = vocab.wheel[0].subcategories[0].descriptors[0];
    await saveDraft({
      roasterId: roasterA, portalCoffeeId: coffeeId, respondentId: personA.id,
      doc: { notes: [{ words: 'Cranberry jam', cuppingNoteId: null }, { words: '', cuppingNoteId: pick.id }, { words: '  ', cuppingNoteId: null }] },
    });
    const cur = await getCurrentResponse(coffeeId);
    expect(cur?.notes.map(n => [n.rank, n.roasterWords, n.cuppingNoteId])).toEqual([[1, 'Cranberry jam', null], [2, pick.descriptor, pick.id]]);
  });

  it('serves the vocabulary from the DB: 7 numeric dimensions, the wheel without defects, the six families', async () => {
    const vocab = await getVocabulary({ fresh: true });
    expect(vocab.dimensions.map(d => d.label)).toEqual(['Acidity', 'Sweetness', 'Bitterness', 'Body', 'Clarity', 'Mouthfeel', 'Finish']);
    expect(vocab.wheel.map(c => c.name)).not.toContain('Other');
    expect(vocab.wheel.length).toBe(8);
    expect(vocab.archetypes.map(a => a.code)).toEqual(['floral', 'fruity', 'balanced_sweet', 'chocolate_nutty', 'earthy', 'experimental']);
    expect(vocab.process.map(p => p.value)).toContain('co-ferment');
    expect(vocab.roastLevel.map(p => p.value)).toContain('light-medium');
  });
});

describe('brew vocabulary drift guard', () => {
  it('roastery_portal_brew_method values equal the customer brew profile vocabulary exactly', async () => {
    const customer = getBrewProfileFieldsConfig().brew_methods.allowedValues ?? [];
    const portal = (await getVocabulary({ fresh: true })).brewMethods.map(b => b.value);
    expect([...portal].sort()).toEqual([...customer].sort());
    expect(customer.length).toBeGreaterThan(0);
  });
});

describe('the portal never writes the catalog', () => {
  it('lint:roastery-portal passes on the tree as it stands', () => {
    const script = fileURLToPath(new URL('../../scripts/lint-roastery-portal.mjs', import.meta.url));
    const out = execFileSync(process.execPath, [script], { encoding: 'utf8' });
    expect(out).toContain('clean');
  });
});
