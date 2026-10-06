// Roastery portal part 2 (2026-10-05) — accepting a submitted coffee into the catalog.
// Runs on the isolated test database (see vitest.config.ts). Covers: accept creates and links
// a coffee; accept on a linked coffee updates only the ticked items; set semantics retire
// without deleting; the acceptance log is immutable; a mapping is remembered and suggested and
// superseding keeps history; a failed step rolls the whole accept back; the wheel view filters
// retired descriptors; the dominant-dimension match is one SQL definition.
//
// Fixtures: the standing "Portal Test Roastery A" (active) from roasteryPortal.test.ts, plus
// uniquely named coffees that afterAll RETIRES (an active coffee with no archetype assignment
// fails catalog integrity check #6, and with it guard.test.ts and catalogImport.test.ts).
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { db } from '../db/client.js';
import {
  createLink, upsertRespondent, addLineupCoffee, saveDraft, submitResponse, deactivateLineupCoffee, acceptResponse,
  setNoteMapping, changeNoteMapping, supersedeNoteMapping, revokeLink,
} from './roasteryPortalService.js';
import { previewAcceptance, getVocabulary, listNoteMappings, getCoffeeHint, normalizeWords } from './roasteryPortalReads.js';
import { setRoasterDescriptors, retireCoffee, setMatchArchetype } from './catalogService.js';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const ADMIN = { actor: 'vitest-no-such-admin' };
const lineupIds: string[] = [];
const coffeeIds: number[] = [];
const mappingWords: string[] = [];

let roasterA: string;
let linkId: string;
let person: { id: string };
let wheel: { id: string; descriptor: string; category: string }[] = [];

async function standingRoaster(name: string): Promise<string> {
  const found = await db.query(`SELECT id, is_active FROM roaster WHERE name = $1`, [name]);
  if (found.rows[0]) return found.rows[0].id;
  return (await db.query(`INSERT INTO roaster (name, is_active) VALUES ($1, true) RETURNING id`, [name])).rows[0].id;
}

function pick(category: string, n = 0) {
  const hits = wheel.filter(w => w.category === category);
  return hits[n];
}

/** A lineup coffee with a submitted response carrying the given notes. */
async function submitted(label: string, doc: Record<string, unknown>, opts: { coffeeId?: number } = {}) {
  const c = await addLineupCoffee({ roasterId: roasterA, name: `PT Accept ${label} ${RUN}`, addedBy: 'admin' });
  lineupIds.push(c.id);
  if (opts.coffeeId !== undefined) {
    await db.query(`UPDATE roastery_portal_coffee SET coffee_id = $1 WHERE id = $2`, [opts.coffeeId, c.id]);
  }
  await saveDraft({ roasterId: roasterA, portalCoffeeId: c.id, respondentId: person.id, doc });
  const sub = await submitResponse({ roasterId: roasterA, portalCoffeeId: c.id, respondentId: person.id });
  return { portalCoffeeId: c.id, responseId: sub.responseId, name: c.name };
}

async function catalogCoffee(name: string, fields: Record<string, string | null> = {}): Promise<number> {
  const r = await db.query(
    `INSERT INTO coffees (name, roaster_id, is_active, origin, process, roast_level, blend_or_single)
     VALUES ($1, $2, true, $3, $4, $5, $6) RETURNING id`,
    [name, roasterA, fields.origin ?? null, fields.process ?? null, fields.roast_level ?? null, fields.blend_or_single ?? null]
  );
  coffeeIds.push(r.rows[0].id);
  return r.rows[0].id;
}

const allNotes = (ids: number[]) => ids.map((_, i) => ({ rank: i + 1, include: true }));

beforeAll(async () => {
  roasterA = await standingRoaster('Portal Test Roastery A');
  await db.query(`UPDATE roaster SET is_active = true WHERE id = $1`, [roasterA]);
  const link = await createLink({ roasterId: roasterA, adminFirebaseUid: 'vitest-no-such-admin' });
  linkId = link.id;
  person = await upsertRespondent({ roasterId: roasterA, linkId, name: 'Ann', email: 'ann@example.com' });
  const v = await getVocabulary({ fresh: true });
  wheel = v.wheel.flatMap(c => c.subcategories.flatMap(s => s.descriptors.map(d => ({ id: d.id, descriptor: d.descriptor, category: c.name }))));
});

afterAll(async () => {
  for (const id of coffeeIds) await retireCoffee({ coffeeId: id, reason: 'manual' }, ADMIN).catch(() => undefined);
  // coffees created by accept
  const made = await db.query(`SELECT coffee_id FROM roastery_portal_coffee WHERE id = ANY($1::uuid[]) AND coffee_id IS NOT NULL`, [lineupIds]);
  for (const r of made.rows) await retireCoffee({ coffeeId: r.coffee_id, reason: 'manual' }, ADMIN).catch(() => undefined);
  for (const id of lineupIds) await deactivateLineupCoffee({ roasterId: roasterA, portalCoffeeId: id }).catch(() => undefined);
  const maps = await listNoteMappings();
  for (const m of maps.filter(x => mappingWords.includes(x.normalizedWords))) await supersedeNoteMapping({ mappingId: m.id }).catch(() => undefined);
  await revokeLink(linkId).catch(() => undefined);
});

describe('accept creates and links a catalog coffee', () => {
  it('creates the coffee through catalogService, links the lineup row, writes the three notes, keeps an unticked field untouched, and logs once', async () => {
    const berry = pick('Fruity');
    const second = pick('Sweet');
    const r = await submitted('create', {
      origin: 'Origin X', processValues: ['washed', 'natural'], roastLevel: 'light', blendOrSingle: 'single',
      notes: [
        { words: berry.descriptor, cuppingNoteId: berry.id },
        { words: `PT words with a pick ${RUN}`, cuppingNoteId: second.id },
        { words: `zzz ube ${RUN}`, cuppingNoteId: null },
      ],
      proposedArchetype: 'fruity', dimensions: { '5': 4 }, dominantDimensionId: 5, bestBrew: 'v60', takesIt: 'black',
    });

    const pre = await previewAcceptance(r.responseId);
    expect(pre?.coffee.exists).toBe(false);
    expect(pre?.coffee.willCreate?.name).toBe(r.name);
    expect(pre?.visibleToCustomers).toBe(false);
    expect(pre?.notes.map(n => n.roasterWords)).toHaveLength(3);
    expect(pre?.notes[2].defaultCuppingNoteId).toBeNull();

    const termForUbe = pick('Nutty / Cocoa');
    const out = await acceptResponse({
      responseId: r.responseId, actorUid: ADMIN.actor,
      items: {
        basics: { origin: { include: false }, process: { include: true, value: 'natural' }, roastLevel: { include: true }, blendOrSingle: { include: true } },
        notes: [
          { rank: 1, include: true },
          { rank: 2, include: true },
          { rank: 3, include: true, cuppingNoteId: termForUbe.id, remember: true },
        ],
      },
    });
    expect(out.createdCoffee).toBe(true);
    coffeeIds.push(out.coffeeId);

    const coffee = (await db.query(`SELECT * FROM coffees WHERE id = $1`, [out.coffeeId])).rows[0];
    expect(coffee.name).toBe(r.name);
    expect(coffee.roaster_id).toBe(roasterA);
    expect(coffee.origin).toBeNull();            // unticked: unchanged
    expect(coffee.process).toBe('natural');      // the one value the admin chose of two
    expect(coffee.roast_level).toBe('light');
    expect(coffee.blend_or_single).toBe('single');
    expect(coffee.flavor_descriptors_roaster).toEqual([berry.descriptor, `PT words with a pick ${RUN}`, `zzz ube ${RUN}`]);

    const link = (await db.query(`SELECT coffee_id FROM roastery_portal_coffee WHERE id = $1`, [r.portalCoffeeId])).rows[0];
    expect(link.coffee_id).toBe(out.coffeeId);

    const desc = (await db.query(`SELECT * FROM roastery_coffee_descriptors WHERE coffee_id = $1 ORDER BY id`, [out.coffeeId])).rows;
    expect(desc).toHaveLength(3);
    expect(desc.every(d => d.is_active && d.source_response_id === r.responseId && d.accepted_at && d.retired_at === null)).toBe(true);
    expect(new Set(desc.map(d => d.cupping_note_id))).toEqual(new Set([berry.id, second.id, termForUbe.id]));

    const acc = (await db.query(`SELECT * FROM roastery_portal_acceptance WHERE response_id = $1`, [r.responseId])).rows;
    expect(acc).toHaveLength(1);
    expect(acc[0].created_coffee).toBe(true);
    expect(acc[0].applied.basics.find((b: any) => b.field === 'process')).toMatchObject({ before: null, after: 'natural' });
    expect(acc[0].applied.basics.some((b: any) => b.field === 'origin')).toBe(false);

    const maps = await listNoteMappings();
    expect(maps.filter(m => m.normalizedWords === normalizeWords(`zzz ube ${RUN}`))).toHaveLength(1);
    mappingWords.push(normalizeWords(`zzz ube ${RUN}`));

    // the portal's own record of what the roaster said is untouched
    const resp = (await db.query(`SELECT origin, status FROM roastery_portal_response WHERE id = $1`, [r.responseId])).rows[0];
    expect(resp).toMatchObject({ origin: 'Origin X', status: 'submitted' });
  });

  it('refuses a draft, a newer-version-exists accept, and a defect term', async () => {
    const c = await addLineupCoffee({ roasterId: roasterA, name: `PT Accept guards ${RUN}`, addedBy: 'admin' });
    lineupIds.push(c.id);
    const d = await saveDraft({ roasterId: roasterA, portalCoffeeId: c.id, respondentId: person.id, doc: { notes: [{ words: 'x', cuppingNoteId: null }] } });
    await expect(acceptResponse({ responseId: d.responseId, items: {}, actorUid: ADMIN.actor })).rejects.toMatchObject({ code: 'validation' });
    expect(await previewAcceptance(d.responseId)).toBeNull();

    await submitResponse({ roasterId: roasterA, portalCoffeeId: c.id, respondentId: person.id });
    const v1 = (await db.query(`SELECT id FROM roastery_portal_response WHERE portal_coffee_id = $1 AND version = 1`, [c.id])).rows[0].id;
    await saveDraft({ roasterId: roasterA, portalCoffeeId: c.id, respondentId: person.id, doc: { notes: [{ words: 'y', cuppingNoteId: null }] } });
    await submitResponse({ roasterId: roasterA, portalCoffeeId: c.id, respondentId: person.id });
    await expect(acceptResponse({ responseId: v1, items: { notes: [{ rank: 1, include: true }] }, actorUid: ADMIN.actor })).rejects.toMatchObject({ code: 'validation' });

    const v2 = (await db.query(`SELECT id FROM roastery_portal_response WHERE portal_coffee_id = $1 AND version = 2`, [c.id])).rows[0].id;
    const defect = (await db.query(`SELECT id FROM cupping_note WHERE wheel_category = 'Other' AND is_active LIMIT 1`)).rows[0];
    await expect(acceptResponse({ responseId: v2, items: { notes: [{ rank: 1, include: true, cuppingNoteId: defect.id }] }, actorUid: ADMIN.actor }))
      .rejects.toMatchObject({ code: 'validation' });
    const created = await db.query(`SELECT 1 FROM coffees WHERE name = $1`, [`PT Accept guards ${RUN}`]);
    expect(created.rows).toHaveLength(0); // nothing was created by the refused accepts
  });
});

describe('accept on a linked coffee updates only the ticked items', () => {
  it('writes the ticked basics and notes, leaves every other column alone, and reuses the coffee', async () => {
    const id = await catalogCoffee(`PT Linked ${RUN}`, { origin: 'Orig', process: 'honey', roast_level: 'medium', blend_or_single: 'blend' });
    const berry = pick('Fruity', 1);
    const r = await submitted('linked', {
      origin: 'Changed', processValues: ['washed'], roastLevel: 'dark', blendOrSingle: 'single',
      notes: [{ words: berry.descriptor, cuppingNoteId: berry.id }],
    }, { coffeeId: id });

    const pre = await previewAcceptance(r.responseId);
    expect(pre?.coffee).toMatchObject({ exists: true, coffeeId: id });
    expect(pre?.basics.find(b => b.field === 'origin')).toMatchObject({ catalogValue: 'Orig', roasterValue: 'Changed', differs: true });

    const out = await acceptResponse({
      responseId: r.responseId, actorUid: ADMIN.actor,
      items: { basics: { roastLevel: { include: true } }, notes: [{ rank: 1, include: true }] },
    });
    expect(out.createdCoffee).toBe(false);
    expect(out.coffeeId).toBe(id);
    const coffee = (await db.query(`SELECT * FROM coffees WHERE id = $1`, [id])).rows[0];
    expect(coffee).toMatchObject({ origin: 'Orig', process: 'honey', blend_or_single: 'blend', roast_level: 'dark' });
    expect(coffee.flavor_descriptors_roaster).toEqual([berry.descriptor]);
    const count = await db.query(`SELECT count(*)::int AS n FROM coffees WHERE name = $1`, [`PT Linked ${RUN}`]);
    expect(count.rows[0].n).toBe(1);
  });

  it('ticking no notes leaves the roaster descriptors and the roaster words alone', async () => {
    const id = await catalogCoffee(`PT NoNotes ${RUN}`);
    const t = pick('Fruity', 2);
    await setRoasterDescriptors({ coffeeId: id, notes: [{ cuppingNoteId: t.id, roasterWords: 'keep me' }], sourceResponseId: null }, ADMIN);
    const r = await submitted('nonotes', { origin: 'Z', notes: [{ words: 'other words', cuppingNoteId: null }] }, { coffeeId: id });
    await acceptResponse({ responseId: r.responseId, actorUid: ADMIN.actor, items: { basics: { origin: { include: true } }, notes: [{ rank: 1, include: false }] } });
    const active = await db.query(`SELECT count(*)::int AS n FROM roastery_coffee_descriptors WHERE coffee_id = $1 AND is_active`, [id]);
    expect(active.rows[0].n).toBe(1);
    expect((await db.query(`SELECT origin, flavor_descriptors_roaster FROM coffees WHERE id = $1`, [id])).rows[0]).toMatchObject({ origin: 'Z', flavor_descriptors_roaster: null });
  });
});

describe('set semantics retire without deleting; the wheel view ignores retired rows', () => {
  it('activates or inserts the given set, retires the rest, reactivates the same row, never deletes', async () => {
    const id = await catalogCoffee(`PT Set ${RUN}`);
    const [a, b, c] = [pick('Fruity', 3), pick('Fruity', 4), pick('Sweet', 1)];
    await setRoasterDescriptors({ coffeeId: id, notes: [{ cuppingNoteId: a.id, roasterWords: 'wa' }, { cuppingNoteId: b.id, roasterWords: 'wb' }], sourceResponseId: null }, ADMIN);
    const rowA = (await db.query(`SELECT id FROM roastery_coffee_descriptors WHERE coffee_id = $1 AND cupping_note_id = $2`, [id, a.id])).rows[0].id;
    expect((await db.query(`SELECT count(*)::int n FROM v_collaborative_flavor_wheel WHERE coffee_id = $1 AND source = 'roastery'`, [id])).rows[0].n).toBe(2);

    await setRoasterDescriptors({ coffeeId: id, notes: [{ cuppingNoteId: b.id, roasterWords: 'wb2' }, { cuppingNoteId: c.id, roasterWords: 'wc' }], sourceResponseId: null }, ADMIN);
    const rows = (await db.query(`SELECT * FROM roastery_coffee_descriptors WHERE coffee_id = $1 ORDER BY id`, [id])).rows;
    expect(rows).toHaveLength(3); // nothing deleted
    const retiredA = rows.find(r => r.id === rowA);
    expect(retiredA).toMatchObject({ is_active: false });
    expect(retiredA.retired_at).not.toBeNull();
    expect(rows.find(r => r.cupping_note_id === b.id)).toMatchObject({ is_active: true, notes: 'wb2', retired_at: null });
    // the public-facing wheel view no longer lists the retired term
    const wheelRows = (await db.query(`SELECT cupping_note_id FROM v_collaborative_flavor_wheel WHERE coffee_id = $1 AND source = 'roastery'`, [id])).rows.map(r => r.cupping_note_id);
    expect(new Set(wheelRows)).toEqual(new Set([b.id, c.id]));
    expect(wheelRows).not.toContain(a.id);

    // reactivating a retired term reuses its row
    await setRoasterDescriptors({ coffeeId: id, notes: [{ cuppingNoteId: a.id, roasterWords: 'wa again' }], sourceResponseId: null }, ADMIN);
    const back = (await db.query(`SELECT * FROM roastery_coffee_descriptors WHERE id = $1`, [rowA])).rows[0];
    expect(back).toMatchObject({ is_active: true, notes: 'wa again', retired_at: null });

    // the empty set retires everything, still deleting nothing
    await setRoasterDescriptors({ coffeeId: id, notes: [], sourceResponseId: null }, ADMIN);
    const end = (await db.query(`SELECT count(*)::int total, count(*) FILTER (WHERE is_active)::int active FROM roastery_coffee_descriptors WHERE coffee_id = $1`, [id])).rows[0];
    expect(end).toEqual({ total: 3, active: 0 });
    expect((await db.query(`SELECT count(*)::int n FROM v_collaborative_flavor_wheel WHERE coffee_id = $1 AND source = 'roastery'`, [id])).rows[0].n).toBe(0);
  });

  it('two notes mapped to one wheel term collapse into one row and keep both phrases', async () => {
    const id = await catalogCoffee(`PT Dupe ${RUN}`);
    const t = pick('Sweet', 2);
    await setRoasterDescriptors({ coffeeId: id, notes: [{ cuppingNoteId: t.id, roasterWords: 'jam' }, { cuppingNoteId: t.id, roasterWords: 'preserves' }], sourceResponseId: null }, ADMIN);
    const rows = (await db.query(`SELECT notes FROM roastery_coffee_descriptors WHERE coffee_id = $1`, [id])).rows;
    expect(rows).toEqual([{ notes: 'jam / preserves' }]);
  });
});

describe('the acceptance log is immutable', () => {
  it('rejects UPDATE and DELETE, and an insert that does not point at a submitted version of its own coffee', async () => {
    const r = await submitted('log', { notes: [{ words: 'plain', cuppingNoteId: null }] });
    const out = await acceptResponse({ responseId: r.responseId, actorUid: ADMIN.actor, items: { notes: [{ rank: 1, include: true }] } });
    coffeeIds.push(out.coffeeId);
    const row = (await db.query(`SELECT id FROM roastery_portal_acceptance WHERE response_id = $1`, [r.responseId])).rows[0];
    await expect(db.query(`UPDATE roastery_portal_acceptance SET created_coffee = false WHERE id = $1`, [row.id])).rejects.toMatchObject({ code: '23000' });
    await expect(db.query(`DELETE FROM roastery_portal_acceptance WHERE id = $1`, [row.id])).rejects.toMatchObject({ code: '23000' });

    const c = await addLineupCoffee({ roasterId: roasterA, name: `PT Accept logdraft ${RUN}`, addedBy: 'admin' });
    lineupIds.push(c.id);
    const d = await saveDraft({ roasterId: roasterA, portalCoffeeId: c.id, respondentId: person.id, doc: {} });
    await expect(db.query(
      `INSERT INTO roastery_portal_acceptance (response_id, portal_coffee_id, coffee_id, applied) VALUES ($1, $2, $3, '{}')`,
      [d.responseId, c.id, out.coffeeId]
    )).rejects.toMatchObject({ code: '23000' });
    // a submitted version, but of a different lineup coffee
    await expect(db.query(
      `INSERT INTO roastery_portal_acceptance (response_id, portal_coffee_id, coffee_id, applied) VALUES ($1, $2, $3, '{}')`,
      [r.responseId, c.id, out.coffeeId]
    )).rejects.toMatchObject({ code: '23000' });
  });
});

describe('remembered mappings', () => {
  it('is remembered, suggested for the same words (any case or spacing) on another coffee, and superseding keeps history', async () => {
    const words = `  ZZZ   Ube ${RUN}b `;
    const key = normalizeWords(words);
    mappingWords.push(key);
    const t1 = pick('Nutty / Cocoa', 1);
    const t2 = pick('Sweet', 3);

    const r1 = await submitted('map1', { notes: [{ words, cuppingNoteId: null }] });
    const o1 = await acceptResponse({ responseId: r1.responseId, actorUid: ADMIN.actor, items: { notes: [{ rank: 1, include: true, cuppingNoteId: t1.id, remember: true }] } });
    coffeeIds.push(o1.coffeeId);

    // another roastery coffee, same words: the preview offers the remembered term, preset and marked as suggested
    const r2 = await submitted('map2', { notes: [{ words: `zzz ube ${RUN}b`, cuppingNoteId: null }] });
    const pre = await previewAcceptance(r2.responseId);
    expect(pre?.notes[0].suggestion?.cuppingNoteId).toBe(t1.id);
    expect(pre?.notes[0].defaultCuppingNoteId).toBe(t1.id);
    expect(pre?.notes[0].defaultFromSuggestion).toBe(true);

    // nothing is auto-applied: the first accept's descriptors exist only for the first coffee
    expect((await db.query(`SELECT count(*)::int n FROM roastery_coffee_descriptors WHERE cupping_note_id = $1 AND coffee_id <> $2 AND source_response_id = $3`, [t1.id, o1.coffeeId, r2.responseId])).rows[0].n).toBe(0);

    // changing the mapping supersedes the old row and inserts a new one
    const active = (await listNoteMappings()).find(m => m.normalizedWords === key)!;
    await changeNoteMapping({ mappingId: active.id, cuppingNoteId: t2.id, actorUid: ADMIN.actor });
    const all = (await db.query(`SELECT cupping_note_id, superseded_at FROM roastery_portal_note_mapping WHERE normalized_words = $1 ORDER BY created_at`, [key])).rows;
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ cupping_note_id: t1.id });
    expect(all[0].superseded_at).not.toBeNull();
    expect(all[1]).toMatchObject({ cupping_note_id: t2.id, superseded_at: null });
    expect((await previewAcceptance(r2.responseId))?.notes[0].suggestion?.cuppingNoteId).toBe(t2.id);
    expect((await setNoteMapping({ words, cuppingNoteId: t2.id, actorUid: ADMIN.actor })).result).toBe('unchanged');

    // one active row per normalized words, enforced
    await expect(db.query(`INSERT INTO roastery_portal_note_mapping (normalized_words, cupping_note_id) VALUES ($1, $2)`, [key, t1.id])).rejects.toMatchObject({ code: '23505' });

    // retiring leaves history and removes the suggestion
    await supersedeNoteMapping({ mappingId: (await listNoteMappings()).find(m => m.normalizedWords === key)!.id });
    expect((await previewAcceptance(r2.responseId))?.notes[0].suggestion).toBeNull();
    expect((await db.query(`SELECT count(*)::int n FROM roastery_portal_note_mapping WHERE normalized_words = $1`, [key])).rows[0].n).toBe(2);
  });

  it('an accept that does not send a term defaults as the preview presets it: the roaster pick, else the remembered suggestion', async () => {
    const words = `zzz default ${RUN}`;
    mappingWords.push(normalizeWords(words));
    const t = pick('Sweet', 5);
    const first = await submitted('def1', { notes: [{ words, cuppingNoteId: null }] });
    const o1 = await acceptResponse({ responseId: first.responseId, actorUid: ADMIN.actor, items: { notes: [{ rank: 1, include: true, cuppingNoteId: t.id, remember: true }] } });
    coffeeIds.push(o1.coffeeId);
    const second = await submitted('def2', { notes: [{ words: `ZZZ  Default ${RUN}`, cuppingNoteId: null }] });
    const o2 = await acceptResponse({ responseId: second.responseId, actorUid: ADMIN.actor, items: { notes: [{ rank: 1, include: true }] } });
    coffeeIds.push(o2.coffeeId);
    const rows = (await db.query(`SELECT cupping_note_id, is_active FROM roastery_coffee_descriptors WHERE coffee_id = $1`, [o2.coffeeId])).rows;
    expect(rows).toEqual([{ cupping_note_id: t.id, is_active: true }]);
    // an explicit null stays words-only, on purpose
    const third = await submitted('def3', { notes: [{ words, cuppingNoteId: null }] });
    const o3 = await acceptResponse({ responseId: third.responseId, actorUid: ADMIN.actor, items: { notes: [{ rank: 1, include: true, cuppingNoteId: null }] } });
    coffeeIds.push(o3.coffeeId);
    expect((await db.query(`SELECT count(*)::int n FROM roastery_coffee_descriptors WHERE coffee_id = $1 AND is_active`, [o3.coffeeId])).rows[0].n).toBe(0);
  });

  it('does not remember when the box is not ticked', async () => {
    const words = `zzz nomem ${RUN}`;
    const r = await submitted('nomem', { notes: [{ words, cuppingNoteId: null }] });
    const out = await acceptResponse({ responseId: r.responseId, actorUid: ADMIN.actor, items: { notes: [{ rank: 1, include: true, cuppingNoteId: pick('Sweet', 4).id }] } });
    coffeeIds.push(out.coffeeId);
    expect((await listNoteMappings()).some(m => m.normalizedWords === normalizeWords(words))).toBe(false);
  });
});

describe('a failed step rolls the whole accept back', () => {
  it('leaves no coffee, no link, no descriptors, no mapping and no acceptance row', async () => {
    const name = `PT Accept rollback ${RUN}`;
    const t = pick('Fruity', 5);
    const r = await submitted('rollback', { origin: 'O', notes: [{ words: `rollbackme ${RUN}`, cuppingNoteId: null }] });
    const rows = await db.query(`SELECT name FROM roastery_portal_coffee WHERE id = $1`, [r.portalCoffeeId]);
    expect(rows.rows[0].name).toBe(r.name);

    // A temporary trigger makes the descriptor INSERT (a step AFTER the coffee was created and updated) fail.
    await db.query(`
      CREATE OR REPLACE FUNCTION pt_fail_descriptor() RETURNS trigger AS $$
      BEGIN IF NEW.notes LIKE '%rollbackme%' THEN RAISE EXCEPTION 'pt forced failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await db.query(`DROP TRIGGER IF EXISTS pt_fail_descriptor_trg ON roastery_coffee_descriptors`);
    await db.query(`CREATE TRIGGER pt_fail_descriptor_trg BEFORE INSERT ON roastery_coffee_descriptors FOR EACH ROW EXECUTE FUNCTION pt_fail_descriptor()`);
    try {
      await expect(acceptResponse({
        responseId: r.responseId, actorUid: ADMIN.actor,
        items: { basics: { origin: { include: true } }, notes: [{ rank: 1, include: true, cuppingNoteId: t.id, remember: true }] },
      })).rejects.toThrow(/pt forced failure/);
    } finally {
      await db.query(`DROP TRIGGER IF EXISTS pt_fail_descriptor_trg ON roastery_coffee_descriptors`);
      await db.query(`DROP FUNCTION IF EXISTS pt_fail_descriptor()`);
    }
    expect((await db.query(`SELECT 1 FROM coffees WHERE name = $1 AND roaster_id = $2`, [r.name, roasterA])).rows).toHaveLength(0);
    expect((await db.query(`SELECT coffee_id FROM roastery_portal_coffee WHERE id = $1`, [r.portalCoffeeId])).rows[0].coffee_id).toBeNull();
    expect((await db.query(`SELECT 1 FROM roastery_portal_acceptance WHERE response_id = $1`, [r.responseId])).rows).toHaveLength(0);
    expect((await db.query(`SELECT 1 FROM roastery_portal_note_mapping WHERE normalized_words = $1`, [normalizeWords(`rollbackme ${RUN}`)])).rows).toHaveLength(0);
    void name;
  });
});

describe('the dominant-dimension match (decision 11)', () => {
  it('is one SQL definition: matches / differs / unknown, display only', async () => {
    const f = (a: number | null, b: number | null) => db.query(`SELECT roastery_portal_dimension_matches($1::int, $2::int) AS m`, [a, b]).then(r => r.rows[0].m);
    expect(await f(5, 5)).toBe(true);
    expect(await f(5, 7)).toBe(false);
    expect(await f(null, 7)).toBeNull();
    expect(await f(5, null)).toBeNull();
  });

  it('reads ours from the match archetype when the coffee is not placed, and never from cupping scores', async () => {
    const id = await catalogCoffee(`PT Dim ${RUN}`);
    const r = await submitted('dim', { dominantDimensionId: 5, dimensions: { '5': 5 }, proposedArchetype: 'fruity', notes: [] }, { coffeeId: id });
    let hint = await getCoffeeHint(id);
    expect(hint?.match).toMatchObject({ roasterDimensionName: 'Acidity', ourDimensionId: null, ourSource: null, matches: null });

    await setMatchArchetype({ coffeeId: id, archetype: 'fruity', confidence: 'medium', source: 'manual' }, ADMIN);
    hint = await getCoffeeHint(id);
    expect(hint?.match).toMatchObject({ ourDimensionId: 5, ourSource: 'match_archetype', matches: true });

    await setMatchArchetype({ coffeeId: id, archetype: 'chocolate_nutty', confidence: 'medium', source: 'manual' }, ADMIN);
    hint = await getCoffeeHint(id);
    expect(hint?.match).toMatchObject({ ourDimensionId: 7, ourSource: 'match_archetype', matches: false });

    // a slot being chosen: compared by the same function, against that slot's own dimension
    const fruitySlot = (await db.query(`SELECT id FROM coffee_dial_slot WHERE archetype = 'fruity' AND is_active LIMIT 1`)).rows[0];
    const chocSlot = (await db.query(`SELECT id FROM coffee_dial_slot WHERE archetype = 'chocolate_nutty' AND is_active LIMIT 1`)).rows[0];
    expect((await getCoffeeHint(id, { slotId: fruitySlot.id }))?.matchForSlot?.matches).toBe(true);
    expect((await getCoffeeHint(id, { slotId: chocSlot.id }))?.matchForSlot?.matches).toBe(false);
    void r;
  });
});
