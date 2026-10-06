// Roastery portal part 3 (2026-10-06) — roaster wording + the questions we were missing. Test database.
// Covers: lookup validation of each new field; the four normalisation rules; best-seller roastery
// isolation and the three-pick cap; the caffeine fallback from the deprecated is_decaf in the view;
// guarded label updates leaving a hand-edited label alone; caffeine as a tickable category in accept.
// Fixtures follow roasteryPortalAccept.test.ts: standing "Portal Test Roastery A/B", uniquely named
// coffees that afterAll retires (an ACTIVE coffee without an archetype fails catalog integrity #6).
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from '../db/client.js';
import {
  createLink, upsertRespondent, addLineupCoffee, saveDraft, submitResponse, deactivateLineupCoffee, acceptResponse,
  saveLineupDraft, submitLineupResponse, revokeLink,
} from './roasteryPortalService.js';
import { getCurrentResponse, getVocabulary, getCurrentLineupResponse, getAdminLineup, previewAcceptance, getResponseById } from './roasteryPortalReads.js';
import { retireCoffee } from './catalogService.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const ADMIN = { actor: 'vitest-no-such-admin' };
const lineupA: string[] = []; const lineupB: string[] = [];
const coffeeIds: number[] = [];
let roasterA: string; let roasterB: string; let personA: { id: string }; let personB: { id: string };
let linkA: string; let linkB: string;

async function standingRoaster(name: string): Promise<string> {
  const found = await db.query(`SELECT id FROM roaster WHERE name = $1`, [name]);
  if (found.rows[0]) return found.rows[0].id;
  return (await db.query(`INSERT INTO roaster (name, is_active) VALUES ($1, true) RETURNING id`, [name])).rows[0].id;
}
async function lineup(roasterId: string, label: string) {
  const c = await addLineupCoffee({ roasterId, name: `PT P3 ${label} ${RUN}`, addedBy: 'admin' });
  (roasterId === roasterA ? lineupA : lineupB).push(c.id);
  return c;
}
const save = (roasterId: string, id: string, who: { id: string }, doc: Record<string, unknown>) =>
  saveDraft({ roasterId, portalCoffeeId: id, respondentId: who.id, doc });

beforeAll(async () => {
  roasterA = await standingRoaster('Portal Test Roastery A');
  roasterB = await standingRoaster('Portal Test Roastery B');
  await db.query(`UPDATE roaster SET is_active = true WHERE id = ANY($1::uuid[])`, [[roasterA, roasterB]]);
  linkA = (await createLink({ roasterId: roasterA, adminFirebaseUid: 'vitest-no-such-admin' })).id;
  linkB = (await createLink({ roasterId: roasterB, adminFirebaseUid: 'vitest-no-such-admin' })).id;
  personA = await upsertRespondent({ roasterId: roasterA, linkId: linkA, name: 'Ann', email: 'ann@example.com' });
  personB = await upsertRespondent({ roasterId: roasterB, linkId: linkB, name: 'Bea', email: 'bea@example.com' });
});

afterAll(async () => {
  const made = await db.query(`SELECT coffee_id FROM roastery_portal_coffee WHERE id = ANY($1::uuid[]) AND coffee_id IS NOT NULL`, [lineupA]);
  for (const r of made.rows) await retireCoffee({ coffeeId: r.coffee_id, reason: 'manual' }, ADMIN).catch(() => undefined);
  for (const id of coffeeIds) await retireCoffee({ coffeeId: id, reason: 'manual' }, ADMIN).catch(() => undefined);
  for (const id of lineupA) await deactivateLineupCoffee({ roasterId: roasterA, portalCoffeeId: id }).catch(() => undefined);
  for (const id of lineupB) await deactivateLineupCoffee({ roasterId: roasterB, portalCoffeeId: id }).catch(() => undefined);
  await revokeLink(linkA).catch(() => undefined);
  await revokeLink(linkB).catch(() => undefined);
});

describe('lookup validation of each new field', () => {
  let id: string;
  beforeAll(async () => { id = (await lineup(roasterA, 'validate')).id; });
  const rejects = async (doc: Record<string, unknown>) =>
    expect(save(roasterA, id, personA, doc)).rejects.toMatchObject({ name: 'PortalError', code: 'validation' });

  it('rejects any value outside its vocabulary, even one the normalisation would have cleared', async () => {
    await rejects({ additivesPresent: 'yes' });
    await rejects({ blendOrSingle: 'single', blendRotation: 'monthly' });
    await rejects({ caffeineLevel: 'none' });
    await rejects({ caffeineLevel: 'regular', decafProcess: 'chemical' });
    await rejects({ certifications: ['organic'] });
    await rejects({ certifications: 'fair_trade' });
    await rejects({ additivesPresent: true, additivesDetail: 'x'.repeat(301) });
    await rejects({ blendOrSingle: 'blend', blendComponents: 'x'.repeat(301) });
  });

  it('serves the new option lists from the DB with the new wording', async () => {
    const v = await getVocabulary({ fresh: true });
    // "Roasted for" was removed in part 4: the bundle no longer carries its list (the lookup rows stay, unused)
    expect('roastIntent' in v).toBe(false);
    expect((await db.query(`SELECT count(*)::int n FROM lookup_value WHERE category = 'roastery_portal_roast_intent'`)).rows[0].n).toBe(3);
    expect(v.blendRotation.map(o => o.label)).toEqual(['Fixed recipe', 'Components rotate, profile stays', 'Changes with the season']);
    expect(v.caffeine.map(o => o.value)).toEqual(['regular', 'half_caff', 'decaf']);
    expect(v.decafProcess.map(o => o.label)).toEqual(['Swiss Water', 'Sugarcane (EA)', 'Mountain Water', 'CO2', 'Other']);
    expect(v.certification.map(o => o.value)).toEqual(['usda_organic', 'fair_trade', 'rainforest_alliance', 'other', 'none']);
    expect(v.takesIt.map(o => o.label)).toEqual(['Best black', 'Great with milk', 'Works both ways']);
    expect(v.brewMethods.find(o => o.value === 'drip')?.label).toBe('Batch brew / drip');
    expect(v.availability.filter(o => o.value === 'always_on' || o.value === 'rotating').map(o => o.label)).toEqual(['Year-round (core)', 'Seasonal']);
    expect(v.dimensions.map(d => [d.label, d.lowLabel, d.highLabel])).toEqual([
      ['Acidity', 'Soft', 'Bright'], ['Sweetness', 'Low', 'High'], ['Bitterness', 'Low', 'High'], ['Body', 'Light', 'Full'],
      ['Clarity', 'Clean', 'Layered'], ['Mouthfeel', 'Silky', 'Grippy'], ['Finish', 'Short', 'Lingering'],
    ]);
  });

  it('accepts a legal document and reads every new answer back', async () => {
    await save(roasterA, id, personA, {
      blendOrSingle: 'blend', blendComponents: 'Peru, Colombia, roughly 60/40', blendRotation: 'seasonal', caffeineLevel: 'half_caff',
      decafProcess: 'swiss_water', additivesPresent: true, additivesDetail: 'passion fruit', certifications: ['fair_trade', 'usda_organic'],
    });
    const r = await getCurrentResponse(id);
    expect(r).toMatchObject({
      blendOrSingle: 'blend', blendComponents: 'Peru, Colombia, roughly 60/40', blendRotation: 'seasonal', caffeineLevel: 'half_caff',
      decafProcess: 'swiss_water', additivesPresent: true, additivesDetail: 'passion fruit',
    });
    expect('roastIntent' in (r as object)).toBe(false);
    expect(r?.certifications.sort()).toEqual(['fair_trade', 'usda_organic']);
    expect(r?.isDecaf).toBeNull(); // nothing writes is_decaf any more
  });
});

describe('the four normalisation rules', () => {
  it('clears decaf_process unless caffeine is Decaf or Half-caff', async () => {
    const c = await lineup(roasterA, 'norm-decaf');
    await save(roasterA, c.id, personA, { caffeineLevel: 'decaf', decafProcess: 'co2' });
    expect((await getCurrentResponse(c.id))?.decafProcess).toBe('co2');
    await save(roasterA, c.id, personA, { caffeineLevel: 'regular', decafProcess: 'co2' });
    expect((await getCurrentResponse(c.id))?.decafProcess).toBeNull();
    await save(roasterA, c.id, personA, { decafProcess: 'co2' });
    expect((await getCurrentResponse(c.id))?.decafProcess).toBeNull();
  });

  it('clears blend components and rotation when the coffee is not a blend', async () => {
    const c = await lineup(roasterA, 'norm-blend');
    await save(roasterA, c.id, personA, { blendOrSingle: 'blend', blendComponents: 'a, b', blendRotation: 'fixed' });
    expect(await getCurrentResponse(c.id)).toMatchObject({ blendComponents: 'a, b', blendRotation: 'fixed' });
    await save(roasterA, c.id, personA, { blendOrSingle: 'single', blendComponents: 'a, b', blendRotation: 'fixed' });
    expect(await getCurrentResponse(c.id)).toMatchObject({ blendComponents: null, blendRotation: null });
    await save(roasterA, c.id, personA, { blendComponents: 'a, b', blendRotation: 'fixed' }); // blend not chosen at all
    expect(await getCurrentResponse(c.id)).toMatchObject({ blendComponents: null, blendRotation: null });
  });

  it('clears the additives detail unless additives_present is true', async () => {
    const c = await lineup(roasterA, 'norm-add');
    await save(roasterA, c.id, personA, { additivesPresent: true, additivesDetail: 'passion fruit' });
    expect(await getCurrentResponse(c.id)).toMatchObject({ additivesPresent: true, additivesDetail: 'passion fruit' });
    await save(roasterA, c.id, personA, { additivesPresent: false, additivesDetail: 'passion fruit' });
    expect(await getCurrentResponse(c.id)).toMatchObject({ additivesPresent: false, additivesDetail: null });
    await save(roasterA, c.id, personA, { additivesDetail: 'passion fruit' });
    expect(await getCurrentResponse(c.id)).toMatchObject({ additivesPresent: null, additivesDetail: null });
  });

  it('selecting none leaves only none; no selection stays "not answered"', async () => {
    const c = await lineup(roasterA, 'norm-cert');
    await save(roasterA, c.id, personA, { certifications: ['fair_trade', 'other', 'none', 'usda_organic'] });
    expect((await getCurrentResponse(c.id))?.certifications).toEqual(['none']);
    await save(roasterA, c.id, personA, { certifications: ['fair_trade', 'other'] });
    expect((await getCurrentResponse(c.id))?.certifications.sort()).toEqual(['fair_trade', 'other']);
    await save(roasterA, c.id, personA, { certifications: [] });
    expect((await getCurrentResponse(c.id))?.certifications).toEqual([]);
  });

  it('counts the new per-coffee answers toward section 01 (still 6 sections)', async () => {
    const c = await lineup(roasterA, 'sections');
    // a stale client still sending roastIntent: ignored (not stored, not counted, not rejected)
    await save(roasterA, c.id, personA, { roastIntent: 'filter' });
    let row = (await getAdminLineup(roasterA)).find(x => x.portalCoffeeId === c.id)!;
    expect(row.sectionsAnswered).toBe(0);
    expect((await db.query(`SELECT roast_intent FROM roastery_portal_response WHERE portal_coffee_id = $1`, [c.id])).rows[0].roast_intent).toBeNull();
    await save(roasterA, c.id, personA, { certifications: ['none'] });
    row = (await getAdminLineup(roasterA)).find(x => x.portalCoffeeId === c.id)!;
    expect(row.sectionsAnswered).toBe(1);
    await save(roasterA, c.id, personA, { certifications: ['none'], anythingElse: 'hello' });
    row = (await getAdminLineup(roasterA)).find(x => x.portalCoffeeId === c.id)!;
    expect(row.sectionsAnswered).toBe(2);
  });
});

describe('best sellers (once per lineup)', () => {
  it('keeps the pick order, replaces on re-save, caps at three, and is immutable once submitted', async () => {
    const [a, b, c, d] = [await lineup(roasterB, 'bs-a'), await lineup(roasterB, 'bs-b'), await lineup(roasterB, 'bs-c'), await lineup(roasterB, 'bs-d')];
    await expect(saveLineupDraft({ roasterId: roasterB, respondentId: personB.id, doc: { bestSellers: [a.id, b.id, c.id, d.id] } }))
      .rejects.toMatchObject({ code: 'validation' }); // a fourth pick is refused
    await expect(saveLineupDraft({ roasterId: roasterB, respondentId: personB.id, doc: { bestSellers: [a.id, a.id] } }))
      .rejects.toMatchObject({ code: 'validation' });

    await saveLineupDraft({ roasterId: roasterB, respondentId: personB.id, doc: { bestSellers: [c.id, a.id, b.id] } });
    expect((await getCurrentLineupResponse(roasterB))?.bestSellers.map(x => [x.rank, x.portalCoffeeId])).toEqual([[1, c.id], [2, a.id], [3, b.id]]);
    await saveLineupDraft({ roasterId: roasterB, respondentId: personB.id, doc: { bestSellers: [d.id] } });
    expect((await getCurrentLineupResponse(roasterB))?.bestSellers.map(x => x.portalCoffeeId)).toEqual([d.id]);

    const sub = await submitLineupResponse({ roasterId: roasterB, respondentId: personB.id });
    const lr = (await db.query(`SELECT id FROM roastery_portal_lineup_response WHERE roaster_id = $1 AND version = $2`, [roasterB, sub.version])).rows[0].id;
    await expect(db.query(`DELETE FROM roastery_portal_lineup_response_best_seller WHERE lineup_response_id = $1`, [lr])).rejects.toMatchObject({ code: '23000' });
    await expect(db.query(`INSERT INTO roastery_portal_lineup_response_best_seller (lineup_response_id, portal_coffee_id, rank) VALUES ($1, $2, 2)`, [lr, a.id])).rejects.toMatchObject({ code: '23000' });
    await expect(db.query(`UPDATE roastery_portal_lineup_response_best_seller SET rank = 3 WHERE lineup_response_id = $1`, [lr])).rejects.toMatchObject({ code: '23000' });
  });

  it("answers another roastery's coffee, an inactive one and a malformed id with not found", async () => {
    const mine = await lineup(roasterB, 'bs-mine');
    const theirs = await lineup(roasterA, 'bs-theirs');
    const gone = await lineup(roasterB, 'bs-gone');
    await deactivateLineupCoffee({ roasterId: roasterB, portalCoffeeId: gone.id });
    for (const bad of [theirs.id, gone.id, 'not-a-uuid', '00000000-0000-0000-0000-000000000000']) {
      await expect(saveLineupDraft({ roasterId: roasterB, respondentId: personB.id, doc: { bestSellers: [mine.id, bad] } }))
        .rejects.toMatchObject({ code: 'not_found', status: 404 });
    }
    await saveLineupDraft({ roasterId: roasterB, respondentId: personB.id, doc: { bestSellers: [mine.id] } });
    expect((await getCurrentLineupResponse(roasterB))?.bestSellers.map(x => x.portalCoffeeId)).toEqual([mine.id]);
  });
});

describe('the caffeine fallback from the deprecated is_decaf', () => {
  async function rawResponse(portalCoffeeId: string, version: number, status: string, cols: Record<string, unknown>) {
    const keys = Object.keys(cols);
    await db.query(
      `INSERT INTO roastery_portal_response (portal_coffee_id, version, status${keys.map(k => `, ${k}`).join('')}${status === 'submitted' ? ', submitted_at' : ''})
       VALUES ($1, $2, $3${keys.map((_, i) => `, $${i + 4}`).join('')}${status === 'submitted' ? ', now()' : ''})`,
      [portalCoffeeId, version, status, ...keys.map(k => cols[k])]
    );
  }
  const effective = async (id: string) => (await db.query(`SELECT caffeine_level FROM v_roastery_portal_current_response WHERE portal_coffee_id = $1`, [id])).rows[0].caffeine_level;

  it('derives decaf / regular from is_decaf, prefers the new column, and stays null when unanswered', async () => {
    const [t, f, n, both] = [await lineup(roasterA, 'cf-t'), await lineup(roasterA, 'cf-f'), await lineup(roasterA, 'cf-n'), await lineup(roasterA, 'cf-both')];
    await rawResponse(t.id, 1, 'submitted', { is_decaf: true });
    await rawResponse(f.id, 1, 'submitted', { is_decaf: false });
    await rawResponse(n.id, 1, 'submitted', {});
    await rawResponse(both.id, 1, 'submitted', { is_decaf: true, caffeine_level: 'half_caff' });
    expect(await effective(t.id)).toBe('decaf');
    expect(await effective(f.id)).toBe('regular');
    expect(await effective(n.id)).toBeNull();
    expect(await effective(both.id)).toBe('half_caff');
    expect((await getResponseById((await db.query(`SELECT id FROM roastery_portal_response WHERE portal_coffee_id = $1`, [t.id])).rows[0].id))?.caffeineLevel).toBe('decaf');
  });

  it('a response submitted before part 3 keeps its caffeine when reopened, and is_decaf is never written again', async () => {
    const c = await lineup(roasterA, 'cf-reopen');
    await rawResponse(c.id, 1, 'submitted', { is_decaf: true, origin: 'Old answer' });
    await save(roasterA, c.id, personA, { origin: 'New answer', caffeineLevel: 'decaf' });
    const rows = (await db.query(`SELECT version, status, is_decaf, caffeine_level FROM roastery_portal_response WHERE portal_coffee_id = $1 ORDER BY version`, [c.id])).rows;
    expect(rows).toEqual([
      { version: 1, status: 'submitted', is_decaf: true, caffeine_level: null },   // never backfilled
      { version: 2, status: 'draft', is_decaf: null, caffeine_level: 'decaf' },    // is_decaf not carried or written
    ]);
    // a draft opened on an old response copies the effective caffeine forward, but a save is a full-document replace, so the form must re-send it
    const d = await lineup(roasterA, 'cf-carry');
    await rawResponse(d.id, 1, 'submitted', { is_decaf: false });
    await save(roasterA, d.id, personA, { origin: 'x' });
    expect(await effective(d.id)).toBeNull(); // a bare save that omits caffeine clears it, as for every other field; the form always re-sends what it shows
  });
});

describe('guarded label updates', () => {
  it('re-applying schema.sql updates an old label, leaves a hand-edited one alone, and is a no-op otherwise', async () => {
    const schema = readFileSync(fileURLToPath(new URL('../db/schema.sql', import.meta.url)), 'utf8');
    const label = async (cat: string, value: string) => (await db.query(`SELECT label FROM lookup_value WHERE category = $1 AND value = $2`, [cat, value])).rows[0].label;
    const dim = async (name: string) => (await db.query(`SELECT p.label, p.low_label, p.high_label FROM roastery_portal_dimension p JOIN coffee_dimensions d ON d.id = p.dimension_id WHERE d.name = $1`, [name])).rows[0];
    try {
      // drip back at its OLD label, always_on hand-edited, Acidity's low label back at the old value, Texture hand-edited
      await db.query(`UPDATE lookup_value SET label = 'Drip' WHERE category = 'roastery_portal_brew_method' AND value = 'drip'`);
      await db.query(`UPDATE lookup_value SET label = 'Core range (my wording)' WHERE category = 'roastery_portal_availability' AND value = 'always_on'`);
      await db.query(`UPDATE roastery_portal_dimension p SET low_label = 'Low' FROM coffee_dimensions d WHERE d.id = p.dimension_id AND d.name = 'Acidity'`);
      await db.query(`UPDATE roastery_portal_dimension p SET label = 'Feel (my wording)' FROM coffee_dimensions d WHERE d.id = p.dimension_id AND d.name = 'Texture'`);
      await db.query(schema);
      expect(await label('roastery_portal_brew_method', 'drip')).toBe('Batch brew / drip');
      expect(await label('roastery_portal_availability', 'always_on')).toBe('Core range (my wording)'); // untouched
      expect((await dim('Acidity')).low_label).toBe('Soft');
      expect((await dim('Texture')).label).toBe('Feel (my wording)');                                    // untouched
      expect(await label('roastery_portal_availability', 'rotating')).toBe('Seasonal');                  // already new: no-op
      await db.query(schema);
      expect(await label('roastery_portal_availability', 'always_on')).toBe('Core range (my wording)');
    } finally {
      await db.query(`UPDATE lookup_value SET label = 'Year-round (core)' WHERE category = 'roastery_portal_availability' AND value = 'always_on'`);
      await db.query(`UPDATE roastery_portal_dimension p SET label = 'Mouthfeel' FROM coffee_dimensions d WHERE d.id = p.dimension_id AND d.name = 'Texture'`);
    }
  });
});

describe('accept: caffeine is a tickable category through the catalog door', () => {
  async function submittedWith(label: string, doc: Record<string, unknown>, coffeeId?: number) {
    const c = await lineup(roasterA, label);
    if (coffeeId !== undefined) await db.query(`UPDATE roastery_portal_coffee SET coffee_id = $1 WHERE id = $2`, [coffeeId, c.id]);
    await save(roasterA, c.id, personA, doc);
    const sub = await submitResponse({ roasterId: roasterA, portalCoffeeId: c.id, respondentId: personA.id });
    return { lineupId: c.id, responseId: sub.responseId };
  }
  const cats = async (coffeeId: number) => (await db.query(
    `SELECT cc.code FROM coffee_category_assignment a JOIN coffee_category cc ON cc.id = a.category_id WHERE a.coffee_id = $1 ORDER BY cc.code`, [coffeeId]
  )).rows.map(r => r.code as string);

  it('offers Category: Decaf as a tickable basic, creates the coffee, applies the existing category code, and logs it', async () => {
    const r = await submittedWith('acc-decaf', { caffeineLevel: 'decaf', decafProcess: 'swiss_water', origin: 'x' });
    const pre = await previewAcceptance(r.responseId);
    expect(pre?.basics.find(b => b.field === 'caffeine')).toMatchObject({ catalogValue: null, roasterValue: 'decaf', differs: true, applicable: true });
    expect(pre?.extras).toMatchObject({ caffeineLevel: 'decaf', decafProcess: 'swiss_water' });
    const unticked = await acceptResponse({ responseId: r.responseId, actorUid: ADMIN.actor, items: { basics: { caffeine: { include: false } }, notes: [] } });
    coffeeIds.push(unticked.coffeeId);
    expect(await cats(unticked.coffeeId)).toEqual([]); // not ticked: nothing applied

    const r2 = await submittedWith('acc-decaf2', { caffeineLevel: 'decaf' });
    const out = await acceptResponse({ responseId: r2.responseId, actorUid: ADMIN.actor, items: { basics: { caffeine: { include: true } }, notes: [] } });
    coffeeIds.push(out.coffeeId);
    expect(await cats(out.coffeeId)).toEqual(['decaf']);
    expect((out.applied.basics as { field: string; after: unknown }[]).find(b => b.field === 'caffeine')?.after).toEqual(['decaf']);
  });

  it('applies half-caff, keeps the coffee\'s other categories, and replaces decaf with half-caff', async () => {
    const id = (await db.query(`INSERT INTO coffees (name, roaster_id, is_active) VALUES ($1, $2, true) RETURNING id`, [`PT P3 Linked ${RUN}`, roasterA])).rows[0].id;
    coffeeIds.push(id);
    await db.query(`INSERT INTO coffee_category_assignment (coffee_id, category_id) SELECT $1, id FROM coffee_category WHERE code IN ('experimental', 'decaf')`, [id]);
    const r = await submittedWith('acc-half', { caffeineLevel: 'half_caff' }, id);
    await acceptResponse({ responseId: r.responseId, actorUid: ADMIN.actor, items: { basics: { caffeine: { include: true } }, notes: [] } });
    expect(await cats(id)).toEqual(['experimental', 'half_caf']);
  });

  it('Regular offers nothing to apply', async () => {
    const r = await submittedWith('acc-regular', { caffeineLevel: 'regular' });
    const pre = await previewAcceptance(r.responseId);
    expect(pre?.basics.find(b => b.field === 'caffeine')).toMatchObject({ roasterValue: null, applicable: false });
    const out = await acceptResponse({ responseId: r.responseId, actorUid: ADMIN.actor, items: { basics: { caffeine: { include: true } }, notes: [] } });
    coffeeIds.push(out.coffeeId);
    expect(await cats(out.coffeeId)).toEqual([]);
  });

  it('an old response (is_decaf only) offers Category: Decaf from the view', async () => {
    const c = await lineup(roasterA, 'acc-old');
    await db.query(`INSERT INTO roastery_portal_response (portal_coffee_id, version, status, is_decaf, submitted_at) VALUES ($1, 1, 'submitted', true, now())`, [c.id]);
    const rid = (await db.query(`SELECT id FROM roastery_portal_response WHERE portal_coffee_id = $1`, [c.id])).rows[0].id;
    expect((await previewAcceptance(rid))?.basics.find(b => b.field === 'caffeine')).toMatchObject({ roasterValue: 'decaf', applicable: true });
  });

  it('additives are display only: a notice in the preview and a marker on the admin row, never written anywhere', async () => {
    const r = await submittedWith('acc-add', { additivesPresent: true, additivesDetail: 'passion fruit', blendOrSingle: 'blend', blendRotation: 'rotates_same_profile' });
    const pre = await previewAcceptance(r.responseId);
    expect(pre?.extras.additivesNotice).toBe('Contains added ingredients: passion fruit. Check the ingredients statement on the bag.');
    expect(pre?.extras.blendRecipeChanges).toBe(true);
    const row = (await getAdminLineup(roasterA)).find(x => x.portalCoffeeId === r.lineupId)!;
    expect(row).toMatchObject({ additivesPresent: true, additivesDetail: 'passion fruit', blendRecipeChanges: true });
    const out = await acceptResponse({ responseId: r.responseId, actorUid: ADMIN.actor, items: { basics: { origin: { include: true } }, notes: [] } });
    coffeeIds.push(out.coffeeId);
    expect(JSON.stringify((await db.query(`SELECT * FROM coffees WHERE id = $1`, [out.coffeeId])).rows[0])).not.toContain('passion');
  });
});
