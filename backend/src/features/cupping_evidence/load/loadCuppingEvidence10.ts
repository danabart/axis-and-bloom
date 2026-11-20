// Cupping evidence, brief 10 (2026-11-20): the cupping of 2026-11-20, one
// cross-roaster session (Dana + Camila) on four coffees already in the
// catalog (Brazil, Indonesia, D.R. Congo from Joe Bean; The Daily from Joe
// Coffee). backend/src/features/cupping_evidence/CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_10_NOV20_CUPPING.md.
//
//   npm run load:cupping-evidence-10 -- --target test
//   npm run load:cupping-evidence-10 -- --target prod --expect-db axisandbloom
//
// Loader 8's shape and run code, copied (not extracted, so loaders 2, 5, 7
// and 8 are untouched). Data only, through the doors: noteMappingService.setNoteMapping
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
// The roaster precondition names Joe Bean and Joe Coffee only (decision 3):
// Utopian was retired 2026-11-08 and is not part of this session.
//
// Every value below is the brief's table as written; nothing is converted
// or reinterpreted. A struck word stays in notes as ~word and is never a
// descriptor. Decision 8's uncertain cells carry their reading in raw_value.
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

const LOADER_NOTE = 'loader 2026-11-20; rule: ';
const log = (...m: unknown[]) => console.log(...m);
const counts: Record<string, number> = {};
const bump = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };

// ── Roasters (loader 2's map; confirmed by name in Task 0 2026-11-20).
// Decision 3: Joe Bean and Joe Coffee only, both active. ─────────────────────
const ROASTERS = {
  joeCoffee: { id: 'f42ad179-9ef4-410a-a92e-464eae1d84ce', name: 'Joe Coffee Company' },
  joeBean: { id: '19098f5c-99b9-4d7c-90ef-ee33d1e896b7', name: 'Joe Bean Roasters' },
} as const;
type RoasterKey = keyof typeof ROASTERS;

// ── Decisions 1, 2 ─────────────────────────────────────────────────────────
const BREW = { doseGrams: 8.5, waterGrams: 150, ratio: 17.65, brewDevice: 'cupping bowl',
  notes: 'standard A&B cupping protocol (Dana, 2026-10-16); grind, temperature and steep time not recorded on the sheets' };

// ── Decision 7 (precedent: Dana, 2026-10-23): her flavor-notes line is her call ─
const FLAVOR_LINE_IS_CALL: boolean | null = true; // Dana, 2026-10-23; confirmed for brief 10 on 2026-11-20

// ── Decision 9: cupper conventions, written before any score, only for
// words with no current cupper mapping (an existing cupper row wins and is not
// rewritten). The optional fourth field is the rule the brief states where it
// differs from ruleFor's. The first block is expected to exist already (Task 0
// 2026-11-20: all do); the second block is new. ─────────────────────────────
const CUPPER_MAPPINGS: Array<[string, string, number?, string?]> = [
  ['chocolate', 'Chocolate'], ['milk chocolate', 'Chocolate'], ['dark chocolate', 'Dark Chocolate'], ['cocoa', 'Cocoa'],
  ['caramel', 'Caramelized'], ['sugar', 'Sweet'], ['honey', 'Honey'], ['almond', 'Almond'],
  ['nuts', 'Nutty'], ['roasted nuts', 'Nutty'], ['dried fruits', 'Dried Fruit'], ['fruity', 'Fruity', 1], ['fruits', 'Fruity', 1],
  ['orange', 'Orange'], ['clementine', 'Citrus Fruit'], ['burnt', 'Roast'], ['tea', 'Black Tea'],
  // new (decision 9)
  ['light fruits', 'Fruity', 1, 'contains'], ['a bit of fruits', 'Fruity', 1, 'contains'],
  ['light caramel', 'Caramelized', undefined, 'contains'], ['light chocolate', 'Chocolate', undefined, 'contains'],
  ['raisins', 'Raisin', undefined, 'exact'], ['apricot', 'Other Fruit', undefined, 'contains'],
  ['wood', 'Woody', undefined, 'exact'], ['cedar', 'Woody', undefined, 'contains'],
  ['leaves', 'Green / Vegetative', 1, 'contains'], ['popcorn', 'Cereal', undefined, 'contains'],
  ['nuttella', 'Hazelnut', undefined, 'contains'], ['nutella', 'Hazelnut', undefined, 'contains'],
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
const RULING = 'her call, ruling 2026-10-23';
/** Dana's call from her flavor-notes line (decision 7) */
const call = (a: string) => (FLAVOR_LINE_IS_CALL ? { a } : {});

// The cupping of 2026-11-20 (decisions 1 to 9; tables B1 to B4)
const NOV20: SessionSpec = {
  key: 'N20',
  header: { sessionDate: '2026-11-20', sessionDatePrecision: 'exact', location: null,
    recordSource: 'paper: Cupping - Nov 20 2026.pdf (4 pages; misc/roasteries/Cupping)',
    transcribedBy: 'Claude (CTO session)', transcribedAt: '2026-11-20',
    checkedBy: 'same reader, second pass at 300 dpi, 2026-11-20; no blind second read; uncertain cells confirmed by Dana 2026-11-20 (brief 10 decision 8)',
    sheetFormat: 'ab_0_15_8dim', isBlind: false, roasterPresent: false,
    sessionNotes: 'Cupping of 2026-11-20: four coffees from two roasteries cupped side by side (Brazil, Indonesia, D.R. Congo from Joe Bean; The Daily from Joe Coffee). First cupping of the three Joe Bean single origins; The Daily cupped before (session 36). Not blind. Ratio, grind, water temp, steep, cups not recorded. Archetype call line blank on all eight samples; Dana wrote a family reading on the flavor-notes line of all four of hers, loaded as her call (her standing ruling of 2026-10-23); Camila made no call. Camila marked no Aroma and no Flavor value on Indonesia. Merged by rule (union, n = 2).' },
  samples: [
    { roaster: 'joeBean', coffee: 'Brazil', order: 1, sampleNote: 'Dana page 3 sample 1; Camila page 2 sample 1', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 7, 7, "7; mark at 4 X'd out", 'chocolate, nuts, light fruits'), n(2, 6, 8, undefined, '~(one struck word) chocolate'),
          n(3, 7, 7, undefined, 'chocolate, almond, sweet - dried fruits'), n(5, 0), n(4, 12, 12, "12; mark at 10 X'd out"), n(6, 1, 1, "1; mark at 2 X'd out"),
          n(7, 7, 7, "7; mark at 5 X'd out"), n(10, 10), t(12, 'round'), t(11, 'sweetness')],
        descriptors: [['Chocolate', ['chocolate']], ['Nutty', ['nuts']], ['Fruity', ['light fruits']], ['Almond', ['almond']], ['Dried Fruit', ['dried fruits']]],
        ...call('balanced_sweet'), note: `call line blank; flavor notes (hot): "Balance" (${RULING}); no family ticked` },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 10, 10, undefined, 'chocolate (milk), nuts, a bit of fruits'), n(2, 9, 9, undefined, 'honey / chocolate / roasted nuts'),
          n(3, 10, 10, '10; mark at 7 scribbled out', 'roasted nuts / popcorn'), n(5, 1), n(4, 12, 12, '12; mark at 3 scribbled out'), n(6, 0), n(7, 2), n(10, 5),
          t(11, 'popcorn (burnt)')],
        descriptors: [['Chocolate', ['chocolate (milk)', 'chocolate']], ['Nutty', ['nuts', 'roasted nuts']], ['Fruity', ['a bit of fruits']], ['Honey', ['honey']],
          ['Cereal', ['popcorn']], ['Roast', ['burnt']]],
        note: 'no call; no family ticked' },
    ] },
    { roaster: 'joeBean', coffee: 'Indonesia', order: 2, sampleNote: 'Dana page 3 sample 2; Camila page 2 sample 2', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 6, 6, "6; mark at 4 X'd out", 'wood - cedar. caramel, aprico… (cut off at the page edge)'), n(2, 6, 6, undefined, 'leaves, raisins'),
          n(3, 9, 9, undefined, 'dark chocolate, fruity'), n(5, 5, 5, '5; mark at 3 scribbled out'), n(4, 8, 8, "8; mark at 6 X'd out"),
          n(6, 2, 2, "2; marks at 5 and 7 X'd out"), n(7, 4, 4, '4; circle at 6 scribbled with a tail stroke, read as struck'), n(10, 6, 6, "6; mark at 8 X'd out"),
          t(12, 'silky'), t(11, '~bitterness light acidity - finish with ~bitterness maybe')],
        descriptors: [['Woody', ['wood', 'cedar']], ['Caramelized', ['caramel']], ['Other Fruit', ['apricot']], ['Green / Vegetative', ['leaves']],
          ['Raisin', ['raisins']], ['Dark Chocolate', ['dark chocolate']], ['Fruity', ['fruity']]],
        ...call('chocolate_nutty'), note: `call line blank; flavor notes (hot): "fruity C&N" (${RULING}; C&N with a fruity accent); no family ticked` },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 9, 9, undefined, 'fruits, raisins, nature'), t(2, 'wood / sweet'), t(3, 'fruits'), n(5, 4), n(4, 7, 7, '7; mark at 3 scribbled out'),
          n(6, 0), n(7, 2), n(10, 3), t(11, 'fruits')],
        descriptors: [['Fruity', ['fruits']], ['Raisin', ['raisins']], ['Woody', ['wood']]],
        note: 'no call; no family ticked', overall: 'No Aroma or Flavor value marked; words only on both lines.' },
    ] },
    { roaster: 'joeBean', coffee: 'D.R. Congo', order: 3, sampleNote: 'Dana page 4 sample 1; Camila page 1 sample 1', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 5, 5, undefined, 'fruity, light caramel'), n(2, 4, 4, undefined, 'tea - sweet, orange'), n(3, 8, 8, undefined, 'orange, light chocolate'),
          n(5, 7), n(4, 8, 8, "8; mark at 10 X'd out"), n(6, 1), n(7, 5), n(10, 5),
          t(12, 'like almond milk texture'), t(11, 'sweet with light acid finish or biter - chocolate finish!')],
        descriptors: [['Fruity', ['fruity']], ['Caramelized', ['light caramel']], ['Black Tea', ['tea']], ['Orange', ['orange']],
          ['Chocolate', ['light chocolate', 'chocolate']]],
        ...call('fruity'), note: `call line blank; flavor notes (hot): "fruity leaning chocolate. More fruits very light chocolate notes." (${RULING}); Fruity family box ticked` },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 6, 6, undefined, 'fruits (no berries)'), n(2, 6, 6, undefined, 'caramel / clementine'),
          n(3, 10, 10, '10; mark at 7 scribbled out', 'clementine / chocolate / caramel'), n(5, 5),
          n(4, 6, 6, '6; one oval round the 6 with a small scribble at its upper left, read as live'), n(6, 3, 3, '3; mark at 0 scribbled out'), n(7, 6), n(10, 3),
          t(12, 'silky?'), t(11, 'fruity')],
        descriptors: [['Fruity', ['fruits', 'fruity']], ['Caramelized', ['caramel']], ['Citrus Fruit', ['clementine']], ['Chocolate', ['chocolate']]],
        note: 'no call; no family ticked',
        overall: 'Aroma: the original line is fully scribbled out, unreadable; "caramel / clementine" written above it is the line as loaded.' },
    ] },
    { roaster: 'joeCoffee', coffee: 'The Daily', order: 4, sampleNote: 'Dana page 4 sample 2; Camila page 1 sample 2', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 4, 4, undefined, 'cocoa, caramel'), n(2, 6, 6, undefined, 'chocolate, sweet - caramel or… (cut off at the page edge)'),
          n(3, 6, 6, undefined, 'chocolate, caramel, sugar'), n(5, 2, 2, "2; marks at 0 and 3 X'd out"), n(4, 9, 9, "9; mark at 10 X'd out"),
          n(6, 3, 3, '3; faint circle at 1 read as ghosted'), n(7, 8), n(10, 8),
          t(12, '~round'), t(11, 'sweet ~and ~noth ~of ~acid with a spike bitter ("with a spike bitter" written above the struck words)')],
        descriptors: [['Cocoa', ['cocoa']], ['Caramelized', ['caramel']], ['Chocolate', ['chocolate']], ['Sweet', ['sugar']]],
        ...call('chocolate_nutty'), note: `call line blank; flavor notes (hot): "C&N"; (warm): "feels like Nutela" (${RULING}); no family ticked` },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 6, 6, undefined, 'dark chocolate'), n(2, 6, 6, undefined, 'dark chocolate / caramel'), n(3, 7, 7, undefined, 'caramel / chocolate'),
          n(5, 1, 1, '1; oval at 0 scribbled over, read as struck'), n(4, 8, 8, '8; mark at 3 scribbled out'), n(6, 3, 3, '3; marks at 1 and 2 scribbled out'),
          n(7, 6), n(10, 8, 8, '8; mark at 3 scribbled out'), t(12, 'creamy'), t(11, 'nuttella')],
        descriptors: [['Dark Chocolate', ['dark chocolate']], ['Caramelized', ['caramel']], ['Chocolate', ['chocolate']], ['Hazelnut', ['nuttella']]],
        note: 'no call; no family ticked' },
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
  log(`# loadCuppingEvidence10 → ${dbName}`);
  if (FLAVOR_LINE_IS_CALL === null) throw new Error('decision 7 (calls) is not set: FLAVOR_LINE_IS_CALL must be true or false');
  log(`decision 7: ${FLAVOR_LINE_IS_CALL ? "Dana's flavor-notes line is her call" : 'call notes only'}`);
  log('decision 8: uncertain cells loaded with the defaults Dana confirmed 2026-11-20 (raw_value carries each reading)');
  // Preconditions
  for (const [k, r] of Object.entries(ROASTERS)) {
    const basics = await getRoasterBasics(r.id);
    if (!basics || basics.name !== r.name || !basics.isActive) throw new Error(`roaster ${k} ${r.id} missing, renamed or inactive`);
  }
  const cupperRows = await cs.listCuppers();
  const cupperId = (name: string) => { const c = cupperRows.find(x => x.name === name); if (!c) throw new Error(`cupper ${name} missing`); return c.id as number; };

  // Decision 3: each coffee by (roaster name, coffee name), exactly one row, or stop before writing anything
  const coffeeIds: Record<string, number> = {};
  for (const x of NOV20.samples) {
    const hits = (await listCatalogCoffeesForRoaster(ROASTERS[x.roaster].id)).filter(c => c.name === x.coffee);
    if (hits.length !== 1) throw new Error(`coffee ('${ROASTERS[x.roaster].name}', '${x.coffee}'): ${hits.length} rows; nothing written`);
    coffeeIds[x.coffee] = hits[0].id;
  }
  log(`coffees: ${NOV20.samples.map(x => `${x.coffee}=${coffeeIds[x.coffee]}`).join(', ')}`);

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
  const found = existing.find(x => x.record_source === NOV20.header.recordSource);
  if (found) { sid = found.id; log(`session ${NOV20.key} (${sid}): already loaded`); }
  else {
    sid = await cs.createSession({ ...NOV20.header, brewDefaults: BREW });
    bump('sessions created'); log(`session ${NOV20.key}: created ${sid}`);
  }

  // 3. Session coffees (brew rows from the session's brewDefaults)
  const sampleIds: Record<string, number> = {};
  const scs = await cr.listSessionCoffees(sid);
  for (const x of NOV20.samples) {
    const coffeeId = coffeeIds[x.coffee];
    const sc = scs.find(r => r.coffee_id === coffeeId);
    if (sc) { sampleIds[x.coffee] = sc.session_coffee_id; log(`session coffee ${x.coffee} (${sc.session_coffee_id}): already loaded`); continue; }
    sampleIds[x.coffee] = await cs.addSessionCoffee(sid, coffeeId, { displayOrder: x.order, sampleNote: x.sampleNote ?? null });
    bump('session coffees created'); log(`session coffee ${x.coffee}: created ${sampleIds[x.coffee]}`);
  }

  // 4. Cupper rows, 5. merges (each merge refreshes the coffee's dial signal)
  for (const x of NOV20.samples) {
    const scId = sampleIds[x.coffee];
    const where = `${NOV20.key} ${x.coffee}`;
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
