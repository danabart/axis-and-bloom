// Cupping evidence, brief 8 (2026-11-08): the Fruity cupping of 2026-11-06,
// one cross-roaster session (Dana + Camila) on five coffees already in the
// catalog. backend/src/features/cupping_evidence/CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_8_FRUITY_CUPPING.md.
//
//   npm run load:cupping-evidence-8 -- --target test
//   npm run load:cupping-evidence-8 -- --target prod --expect-db axisandbloom
//
// Loader 7's shape and run code, copied (not extracted, so loaders 5 and 7
// are untouched). Data only, through the doors: noteMappingService.setNoteMapping
// and cuppingService; reads through the *Reads modules. No SQL here
// (lint:cupping, lint:lineage). No catalog write. Idempotent by natural key
// (DESIGN §6.6): a second run reports "already loaded" per step and writes
// nothing.
//
// Order (decision 10, brief 5 decisions 9 to 11): cupper word mappings →
// session header → session coffees (brew rows from brewDefaults) → cupper
// rows → rule merges. mergeByRule refreshes the coffee's dial signal itself
// after each merge (cuppingService); calling refreshDialSignal again would
// write a second signal row per coffee.
//
// The roaster precondition (all three active) stays: Utopian is retired in
// Part C after this loader has run on prod, and from then on this loader
// refuses, as loaders 5 and 7 do. That is expected; do not relax it.
//
// Every value below is the brief's table as written; nothing is converted
// or reinterpreted. A struck word stays in notes as ~word and is never a
// descriptor.
import 'dotenv/config';

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
const TARGET = arg('--target');
if (TARGET !== 'test' && TARGET !== 'prod') throw new Error('usage: --target test | --target prod --expect-db <db>');
if (TARGET === 'test') {
  if (!process.env.TEST_DATABASE_URL?.match(/_test(\?|$)/)) throw new Error('TEST_DATABASE_URL must end in _test');
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
const dbName = (process.env.DATABASE_URL ?? '').replace(/\?.*$/, '').split('/').pop();
if (TARGET === 'prod' && arg('--expect-db') !== dbName) throw new Error(`--expect-db ${arg('--expect-db')} does not match DATABASE_URL (${dbName})`);

// Imported after DATABASE_URL is settled: db/client.ts reads it at import time.
const cs = await import('../../../services/cuppingService.js');
const cr = await import('../../../services/cuppingReads.js');
const { setNoteMapping } = await import('../../../services/noteMappingService.js');
const { listMappings } = await import('../../../services/noteMappingReads.js');
const { getRoasterBasics, listCatalogCoffeesForRoaster, normalizeWords } = await import('../../../services/roasteryPortalReads.js');
const { db } = await import('../../../db/client.js');

const LOADER_NOTE = 'loader 2026-11-08; rule: ';
const log = (...m: unknown[]) => console.log(...m);
const counts: Record<string, number> = {};
const bump = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };

// ── Roasters (loader 2's map; confirmed by name in Task 0 2026-11-08) ──────
const ROASTERS = {
  joeCoffee: { id: 'f42ad179-9ef4-410a-a92e-464eae1d84ce', name: 'Joe Coffee Company' },
  joeBean: { id: '19098f5c-99b9-4d7c-90ef-ee33d1e896b7', name: 'Joe Bean Roasters' },
  utopian: { id: 'bbf250d1-e433-4233-a30b-437fe62bcc4a', name: 'Utopian' },
} as const;
type RoasterKey = keyof typeof ROASTERS;

// ── Decisions 1, 2 ─────────────────────────────────────────────────────────
const BREW = { doseGrams: 8.5, waterGrams: 150, ratio: 17.65, brewDevice: 'cupping bowl',
  notes: 'standard A&B cupping protocol (Dana, 2026-10-16); grind, temperature and steep time not recorded on the sheets' };

// ── Decision 8 (Dana, 2026-11-08): Camila / Pearl / Sweetness. 4 = the oval
// over three light strokes is live (as Fabricator Bitterness, brief 5);
// null = struck, no row (Sweetness becomes a one-cupper dimension on Pearl).
// Must be set before a run. ─────────────────────────────────────────────────
const PEARL_CAMILA_SWEETNESS: 4 | null | undefined = 4; // Dana, 2026-11-08: 4 is live

// ── Decision 9: cupper conventions, written before any score, only for
// words with no current cupper mapping (an existing cupper row wins and is not
// rewritten). The optional fourth field is the rule the brief states where it
// differs from ruleFor's. ───────────────────────────────────────────────────
const CUPPER_MAPPINGS: Array<[string, string, number?, string?]> = [
  ['orange', 'Orange'],
  ['clementine', 'Citrus Fruit', undefined, 'contains'], ['bergamote', 'Citrus Fruit', undefined, 'contains'],
  ['grape', 'Grape'], ['coconut', 'Coconut'],
  ['papaya', 'Other Fruit', undefined, 'contains'],
  ['strawberry juice', 'Strawberry', undefined, 'contains'],
  ['fruit', 'Fruity', 1, 'contains'], ['fruits', 'Fruity', 1, 'contains'], ['gentle fruit', 'Fruity', 1, 'contains'],
  ['light fruit', 'Fruity', 1, 'contains'], ['sweet fruit', 'Fruity', 1, 'contains'], ['creamy fruit', 'Fruity', 1, 'contains'],
  ['fruit sweetness', 'Fruity', 1, 'contains'],
  ['toffee', 'Brown Sugar'],
  ['choc', 'Chocolate', undefined, 'contains'], ['a bit chocolate', 'Chocolate', undefined, 'contains'],
];

// ── Score rows (loader 2's shapes) ─────────────────────────────────────────
type V = { d: number; min?: number | null; max?: number | null; raw?: string | null; notes?: string | null };
/** a numeric value (raw defaults to '<min>-<max>' or '<v>') */
const n = (d: number, min: number, max: number = min, raw?: string, notes?: string): V => ({ d, min, max, raw: raw ?? (min === max ? `${min}` : `${min}-${max}`), notes });
/** words only */
const t = (d: number, notes: string, raw?: string): V => ({ d, notes, raw });
type Desc = [node: string, words: string[]];
interface Row {
  cupper: string; scale: 'ab_0_15';
  values: V[]; descriptors: Desc[];
  a?: string; a2?: string; pos?: string; slot?: string; note?: string; overall?: string;
}
interface Sample { roaster: RoasterKey; coffee: string; order: number; sampleNote?: string; rows: Row[] }
interface SessionSpec {
  key: string;
  header: { sessionDate: string; sessionDatePrecision: 'exact' | 'estimated'; location: string | null; recordSource: string;
    transcribedBy: string; transcribedAt: string; checkedBy: string; sheetFormat: string; isBlind: boolean; roasterPresent: boolean; sessionNotes: string };
  samples: Sample[];
}
const D = 'Dana', C = 'Camila';
const RULED = 'call line blank; fruity ruled by Dana 2026-11-08';
/** Camila / Pearl / Sweetness per decision 8 */
const pearlCamilaSweetness = (): V[] => (PEARL_CAMILA_SWEETNESS === 4 ? [n(4, 4, 4, '4; oval over three light strokes read as live; mark at 8-9 scribbled out')] : []);

// The Fruity cupping, 2026-11-06 (decisions 1 to 9; tables B1 to B4)
const FRUITY: SessionSpec = {
  key: 'FRU',
  header: { sessionDate: '2026-11-06', sessionDatePrecision: 'exact', location: null,
    recordSource: 'paper: Fruity Cupping - Nov 6 2026 - Dana and Camila.pdf (6 pages; misc/roasteries/Cupping/Fruity Cupping)',
    transcribedBy: 'Claude (CTO session)', transcribedAt: '2026-11-08',
    checkedBy: 'blind second read 2026-11-08 (TRANSCRIPTION_CHECK_BRIEF_8_2026-11-08.md)',
    sheetFormat: 'ab_0_15_8dim', isBlind: false, roasterPresent: false,
    sessionNotes: 'Fruity cupping: five coffees from three roasteries cupped side by side at the fruity end of the dial (Flying Jewel, Pearl, Geometric, The Village, Feminista). All five cupped before (sessions 35, 36, 37). Not blind. Ratio, grind, water temp, steep, cups not recorded. Dana marked spans (two circles) on most lines. No archetype call on the call line by either cupper; Dana ruled 2026-11-08 that her call is fruity for all five (see call notes); Camila boxed "THE CITRUS" under Pearl\'s family boxes. Dana\'s page 3 sample 2 was started and abandoned (Fragrance 7-9 marked, words struck, no coffee named): not loaded. Camila\'s page 5 is undated. Last session with Utopian before the roastery was retired (2026-11-08). Merged by rule (union, n = 2).' },
  samples: [
    { roaster: 'utopian', coffee: 'Flying Jewel', order: 1, sampleNote: 'Dana page 1 sample 1; Camila page 5 sample 1', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 9, 10, "9-10; mark at 13 X'd out", 'cocoa, fruity, sweet'), n(2, 8, 9, undefined, 'cocoa, berries'), n(3, 8, 10, undefined, 'citrus'),
          n(5, 10, 12), n(4, 5, 6), n(6, 0), n(7, 10), n(10, 10, 12), t(11, 'acid - bright')],
        descriptors: [['Cocoa', ['cocoa']], ['Fruity', ['fruity']], ['Berry', ['berries']], ['Citrus Fruit', ['citrus']]],
        a: 'fruity', note: 'call line blank; fruity ruled by Dana 2026-11-08 ("They are all fruity"); flavor notes (hot): "Very similar to pearl."; no family ticked' },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 4, 6, '4-6; the 4 is underlined, not struck', 'berries / chocolate'), n(2, 8, 8, '8; oval encloses the 8, spans toward 9', 'fruits / sugar'),
          n(3, 4, 4, undefined, 'berries / cream'), n(5, 7, 7, '7; marks at 2 and 4 scribbled out'), n(4, 5), n(6, 2), n(7, 4), n(10, 4), t(11, 'light fruit')],
        descriptors: [['Berry', ['berries']], ['Chocolate', ['chocolate']], ['Fruity', ['fruits', 'light fruit']], ['Sweet', ['sugar']]],
        note: 'no call; no family ticked' },
    ] },
    { roaster: 'utopian', coffee: 'Pearl', order: 2, sampleNote: 'Dana page 1 sample 2; Camila page 5 sample 2', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 9, 10, "9-10; mark at 13 X'd out", 'sweet, citrus - maybe orange li… (cut off at the page edge)'), n(2, 7, 8, undefined, 'sweet, lemon'),
          n(3, 10, 12, undefined, 'citrus - orange or clementine'), n(5, 12, 14), n(4, 4, 4, '4; mark at 2 scribbled out'), n(6, 0), n(7, 8, 10), n(10, 7, 9),
          t(11, 'bright - citrus')],
        descriptors: [['Citrus Fruit', ['citrus', 'clementine']], ['Orange', ['orange']], ['Lemon', ['lemon']]],
        a: 'fruity', note: `${RULED}; flavor notes (hot): "this is very citrus. Both of utopian are almost the same."; no family ticked` },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 5, 5, undefined, 'fruity citrus'), n(2, 8, 8, '8; oval encloses the 8, spans toward 9', 'sweet / clementine'), n(3, 5, 5, undefined, 'clementine?'),
          n(5, 9, 9, '9; mark at 1 scribbled out'), ...pearlCamilaSweetness(), n(6, 0), n(7, 2), n(10, 4)],
        descriptors: [['Fruity', ['fruity']], ['Citrus Fruit', ['citrus', 'clementine']]],
        note: 'no call; "THE CITRUS" written in capitals in a hand-drawn box under the family boxes; no box ticked' },
    ] },
    { roaster: 'joeBean', coffee: 'Geometric Filter Coffee', order: 3, sampleNote: 'Dana page 2 sample 1; Camila page 6 sample 1', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 9, 11, undefined, 'strawberry, sweet'), n(2, 6, 8, undefined, 'sweet - toffee'), n(3, 7, 8, undefined, 'strawberry, fruit sweetness'),
          n(5, 6, 7, "6-7; mark at 4 X'd out"), n(4, 5, 5, '5; mark at 7 scribbled out'), n(6, 0), n(7, 8, 10), n(10, 8, 9, "8-9; mark at 11 X'd out"),
          t(12, '~silky'), t(11, 'bright and sweet (a "-" written under bright, a "+" under sweet)')],
        descriptors: [['Strawberry', ['strawberry']], ['Brown Sugar', ['toffee']], ['Fruity', ['fruit sweetness']]],
        a: 'fruity', note: `${RULED}; flavor notes (hot): "this is more on the sweet side"; no family ticked` },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 8, 8, '8; marks at 5 and 7 scribbled out', 'berries / a bit chocolate'), n(2, 8, 8, undefined, 'strawberry / choc / honey'),
          n(3, 6, 6, undefined, 'strawberry juice / honey'), n(5, 5, 5, '5; mark at 2 scribbled out'), n(4, 6), n(6, 0), n(7, 8, 8, '8; mark at 3-4 scribbled out'),
          n(10, 5), t(11, 'honey')],
        descriptors: [['Berry', ['berries']], ['Chocolate', ['a bit chocolate', 'choc']], ['Strawberry', ['strawberry', 'strawberry juice']], ['Honey', ['honey']]],
        note: 'no call; no family ticked' },
    ] },
    { roaster: 'joeCoffee', coffee: 'The Village', order: 4, sampleNote: 'Dana page 2 sample 2; Camila page 6 sample 2', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 6, 8, undefined, 'spice,'), n(2, 5, 7, undefined, 'gentle fruit - grape'), n(3, 7, 8, "7-8; mark at 9 X'd out", 'gentle fruit,'),
          n(5, 4, 5, "4-5; mark at 7 X'd out"), n(4, 5, 7), n(6, 1, 2, "1-2; mark at 3 scribbled out, mark at 5 X'd out"), n(7, 7, 8),
          n(10, 5, 5, "5; marks at 8 and 10 X'd out"), t(12, 'silky'), t(11, 'sweet ~and ~bright')],
        descriptors: [['Brown Spice', ['spice']], ['Fruity', ['gentle fruit']], ['Grape', ['grape']]],
        a: 'fruity', note: `${RULED}; flavor notes (hot): "This is gentle fruity. Its more balanced cup."; no family ticked` },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 9, 9, '9; the figure 9 written above the line over a scribbled-out mark at 8-9; mark at 6 scribbled out', 'smoky'),
          n(2, 9, 9, undefined, 'sweet / sugar / ~(scribbled out, unreadable)'), n(3, 7, 7, undefined, 'bergamote / 8'),
          n(5, 3), n(4, 6), n(6, 0), n(7, 5), n(10, 3), t(12, 'creamy')],
        descriptors: [['Smoky', ['smoky']], ['Sweet', ['sugar']], ['Citrus Fruit', ['bergamote']]],
        note: 'no call; no family ticked', overall: 'Aroma: third word scribbled out, unreadable; no row for it.' },
    ] },
    { roaster: 'joeCoffee', coffee: 'Cafè Feminista: Montze Olvera', order: 5, sampleNote: 'Dana page 3 sample 1; Camila page 4 sample 1', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 9, 11, '9-11; faint stroke at 7, not a mark', 'fruit - coconut'), n(2, 8, 10, undefined, 'milk, sweet - papaya'),
          n(3, 8, 10, undefined, 'fruit - maybe papaya'),
          n(5, 9, 9, "9; mark at 5 scribbled out, mark at 7 X'd out", 'strawberry acid (acidity character; Dana 2026-11-06)'),
          n(4, 8, 10), n(6, 0), n(7, 8, 10), n(10, 8, 10), t(12, 'full or a bit heavy'), t(11, 'sweet')],
        descriptors: [['Fruity', ['fruit']], ['Coconut', ['coconut']], ['Other Fruit', ['papaya']]],
        a: 'fruity', note: `${RULED}; flavor notes blank; no family ticked`,
        overall: 'Her page 3 sample 2 (no coffee named) was started and abandoned: Fragrance 7-9 marked, "cocoa, fruits - coconut" and "milk" struck; not loaded.' },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 10, 10, '10; mark at 7 scribbled out', 'fruits / sweet'), n(2, 10, 10, undefined, 'honey / sweet'),
          n(3, 6, 6, undefined, 'fruity / creamy fruit … (one word cut off at the page edge), "↳ balanced" written under it'),
          n(5, 9, 9, '9; marks at 4 and 6 scribbled out'), n(4, 7), n(6, 0, 0, '0; mark at 2-3 scribbled out'), n(7, 7), n(10, 6), t(11, 'sweet fruit')],
        descriptors: [['Fruity', ['fruits', 'fruity', 'creamy fruit', 'sweet fruit']], ['Honey', ['honey']]],
        note: 'no call; "↳ balanced" written under the flavor words; no family ticked' },
    ] },
  ],
};

// ═════════════════════════════════════════════════════════════════════════════
// Run
// ═════════════════════════════════════════════════════════════════════════════
type Node = { id: string; descriptor: string; tier: number; is_active: boolean };
const nodes = await cr.listWheelNodes();
function node(name: string, tier?: number): Node {
  const all = nodes.filter(x => x.descriptor === name && x.is_active && (tier === undefined || x.tier === tier));
  if (!all.length) throw new Error(`SCA node '${name}'${tier ? ` (tier ${tier})` : ''} not found or inactive`);
  return all.sort((a, b) => a.tier - b.tier)[0]; // a name at two tiers (Floral) means the family unless a tier is given
}
const ruleFor = (words: string, nd: Node) => normalizeWords(words) === nd.descriptor.toLowerCase() ? 'exact' : nd.tier < 3 ? 'node' : 'contains';

async function main() {
  log(`# loadCuppingEvidence8 → ${dbName}`);
  if (PEARL_CAMILA_SWEETNESS === undefined) throw new Error('decision 8 is not set: PEARL_CAMILA_SWEETNESS must be 4 or null');
  log(`decision 7: Dana's call is fruity on all five (ruled 2026-11-08)`);
  log(`decision 8: Camila / Pearl / Sweetness = ${PEARL_CAMILA_SWEETNESS === 4 ? '4 (live)' : 'struck, no row'}`);
  // Preconditions
  for (const [k, r] of Object.entries(ROASTERS)) {
    const basics = await getRoasterBasics(r.id);
    if (!basics || basics.name !== r.name || !basics.isActive) throw new Error(`roaster ${k} ${r.id} missing, renamed or inactive`);
  }
  const cupperRows = await cs.listCuppers();
  const cupperId = (name: string) => { const c = cupperRows.find(x => x.name === name); if (!c) throw new Error(`cupper ${name} missing`); return c.id as number; };

  // Decision 3: each coffee by (roaster name, coffee name), exactly one row, or stop before writing anything
  const coffeeIds: Record<string, number> = {};
  for (const x of FRUITY.samples) {
    const hits = (await listCatalogCoffeesForRoaster(ROASTERS[x.roaster].id)).filter(c => c.name === x.coffee);
    if (hits.length !== 1) throw new Error(`coffee ('${ROASTERS[x.roaster].name}', '${x.coffee}'): ${hits.length} rows; nothing written`);
    coffeeIds[x.coffee] = hits[0].id;
  }
  log(`coffees: ${FRUITY.samples.map(x => `${x.coffee}=${coffeeIds[x.coffee]}`).join(', ')}`);

  // 1. Decision 9: cupper word mappings, before any score; an existing cupper row wins
  const existingMaps = await listMappings({ sourceKind: 'cupper', words: CUPPER_MAPPINGS.map(([w]) => w) });
  for (const [words, name, tier, rule] of CUPPER_MAPPINGS) {
    const nd = node(name, tier);
    const cur = existingMaps.find(m => m.normalizedWords === normalizeWords(words));
    if (cur) {
      log(`mapping '${words}': already loaded (→ ${cur.descriptor}${cur.cuppingNoteId === nd.id ? '' : `; the brief says ${nd.descriptor}, existing row kept`})`);
      bump('mappings already'); continue;
    }
    const result = await setNoteMapping({ normalizedWords: words, cuppingNoteId: nd.id, sourceKind: 'cupper', adminId: null, note: LOADER_NOTE + (rule ?? ruleFor(words, nd)) });
    bump(`mappings ${result}`); log(`mapping '${words}' → ${nd.descriptor} (tier ${nd.tier}): ${result}`);
  }
  const cupperMaps = await listMappings({ sourceKind: 'cupper' });
  /** the loader refuses a generic (tier 1/2) node no word of the row names or maps to */
  function assertConvention(nd: Node, words: string[], where: string) {
    if (nd.tier === 3) return;
    const ok = words.some(w => {
      const k = normalizeWords(w);
      if (k === nd.descriptor.toLowerCase() || new RegExp(`\\b${nd.descriptor.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(k)) return true;
      return cupperMaps.some(m => m.cuppingNoteId === nd.id && new RegExp(`(^|[^a-z])${m.normalizedWords.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(k));
    });
    if (!ok) throw new Error(`${where}: '${words.join(', ')}' → ${nd.descriptor} (tier ${nd.tier}) has no cupper mapping; refusing`);
  }

  // 2. Session header (natural key: record_source)
  const existing = await cr.listSessions();
  let sid: number;
  const found = existing.find(x => x.record_source === FRUITY.header.recordSource);
  if (found) { sid = found.id; log(`session ${FRUITY.key} (${sid}): already loaded`); }
  else {
    sid = await cs.createSession({ ...FRUITY.header, brewDefaults: BREW });
    bump('sessions created'); log(`session ${FRUITY.key}: created ${sid}`);
  }

  // 3. Session coffees (brew rows from the session's brewDefaults)
  const sampleIds: Record<string, number> = {};
  const scs = await cr.listSessionCoffees(sid);
  for (const x of FRUITY.samples) {
    const coffeeId = coffeeIds[x.coffee];
    const sc = scs.find(r => r.coffee_id === coffeeId);
    if (sc) { sampleIds[x.coffee] = sc.session_coffee_id; log(`session coffee ${x.coffee} (${sc.session_coffee_id}): already loaded`); continue; }
    sampleIds[x.coffee] = await cs.addSessionCoffee(sid, coffeeId, { displayOrder: x.order, sampleNote: x.sampleNote ?? null });
    bump('session coffees created'); log(`session coffee ${x.coffee}: created ${sampleIds[x.coffee]}`);
  }

  // 4. Cupper rows, 5. merges (each merge refreshes the coffee's dial signal)
  for (const x of FRUITY.samples) {
    const scId = sampleIds[x.coffee];
    const where = `${FRUITY.key} ${x.coffee}`;
    let wrote = false;
    for (const r of x.rows) {
      const cur = (await cr.getScoresForSessionCoffee(scId)).scores.find(h => !h.is_merged && h.cupper_id === cupperId(r.cupper));
      if (cur) { bump('cupper rows already'); log(`cupper row ${where} ${r.cupper} (${cur.id}): already loaded`); continue; }
      const descriptors = r.descriptors.map(([name, words]) => {
        const nd = node(name);
        assertConvention(nd, words, `${where} ${r.cupper}`);
        return { cuppingNoteId: nd.id, customNotes: words.join(', ') };
      });
      const id = await cs.saveCupperScore({
        sessionCoffeeId: scId, cupperId: cupperId(r.cupper), scaleCode: r.scale,
        archetypeCall: r.a ?? null, archetypeCallSecondary: r.a2 ?? null, positionCall: r.pos ?? null,
        slotCallId: null, callNote: r.note ?? null, overallNotes: r.overall ?? null,
        values: r.values.map(v => ({ dimensionId: v.d, valueMin: v.min ?? null, valueMax: v.max ?? null, rawValue: v.raw ?? null, notes: v.notes ?? null })),
        descriptors,
      });
      bump(`cupper rows ${r.scale}`); wrote = true; log(`cupper row ${where} ${r.cupper}: created ${id}`);
    }
    const hasMerged = (await cr.getScoresForSessionCoffee(scId)).scores.some(h => h.is_merged);
    if (hasMerged && !wrote) { bump('merges already'); log(`merge ${where}: already loaded`); continue; }
    const m = await cs.mergeByRule(scId, { n: 2 });
    bump('merges');
    log(`merge ${where}: s${sid} sc${scId} merged#${m.mergedScoreId} disagreements=[${m.union.disagreements.join(', ')}] oneCupper=[${m.union.oneCupper.join(', ')}] call=${m.union.archetypeCall ?? 'null'} ab=${m.union.allAbScale}`);
  }

  log('\n# counts this run');
  for (const [k, v] of Object.entries(counts).sort()) log(`  ${k}: ${v}`);
  log(`\n# session id ${sid}; session coffees ${JSON.stringify(sampleIds)}`);
}

try {
  await main();
} finally {
  await db.end();
}
