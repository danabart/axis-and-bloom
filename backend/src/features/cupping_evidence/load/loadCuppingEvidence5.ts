// Cupping evidence, brief 5 (2026-10-21): the Balance cupping, one
// cross-roaster session (Dana + Camila) on four coffees already in the
// catalog. backend/src/features/cupping_evidence/CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_5_BALANCE_CUPPING.md.
//
//   npm run load:cupping-evidence-5 -- --target test
//   npm run load:cupping-evidence-5 -- --target prod --expect-db axisandbloom
//
// Same shapes as loader 2 (n / t / merge / Row / Sample / SessionSpec, copied
// here, not extracted), with one difference: a Sample names its roaster,
// because the session has none. Data only, through the doors:
// noteMappingService.setNoteMapping and cuppingService; reads through the
// *Reads modules. No SQL here (lint:cupping, lint:lineage). No catalog write.
// Idempotent by natural key (DESIGN §6.6): a second run reports "already
// loaded" per step and writes nothing.
//
// Order (decision 9): cupper word mappings → session header → session
// coffees (brew rows from brewDefaults) → cupper rows → rule merges → dial
// signal. mergeByRule refreshes the coffee's dial signal itself after each
// merge (cuppingService), which is decision 9's refreshDialSignal for the
// four coffees; calling it again would write a second signal row per coffee.
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

const LOADER_NOTE = 'loader 2026-10-21; rule: ';
const log = (...m: unknown[]) => console.log(...m);
const counts: Record<string, number> = {};
const bump = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };

// ── Roasters (loader 2's map; Task 0 2026-10-18) ───────────────────────────
const ROASTERS = {
  joeCoffee: { id: 'f42ad179-9ef4-410a-a92e-464eae1d84ce', name: 'Joe Coffee Company' },
  joeBean: { id: '19098f5c-99b9-4d7c-90ef-ee33d1e896b7', name: 'Joe Bean Roasters' },
  utopian: { id: 'bbf250d1-e433-4233-a30b-437fe62bcc4a', name: 'Utopian' },
} as const;
type RoasterKey = keyof typeof ROASTERS;

// ── Decisions 1, 2 ─────────────────────────────────────────────────────────
const BREW = { doseGrams: 8.5, waterGrams: 150, ratio: 17.65, brewDevice: 'cupping bowl', grindSize: '21',
  notes: 'standard A&B cupping protocol (Dana, 2026-10-16); grind 21 from Dana\'s sheet 1; temperature and steep time not recorded' };

// ── Decision 8: cupper conventions, written before any score, only for
// words with no current cupper mapping (an existing cupper row wins). Every
// cupper word the loader resolves through the table gets its own cupper row,
// also where a roaster row exists (caramel, honey, strawberry, fruity tea;
// Dana 2026-10-21). banana is an acidity note, not a descriptor: no row.
// The optional fourth field is the rule Dana gave where it differs from
// ruleFor's (caramel → Caramelized: exact). ─────────────────────────────────
const CUPPER_MAPPINGS: Array<[string, string, number?, string?]> = [
  ['tangerine', 'Citrus Fruit'],
  ['strawberry', 'Strawberry'],
  ['caramel', 'Caramelized', undefined, 'exact'],
  ['fruity tea', 'Black Tea'],
  ['brown sugar', 'Brown Sugar'],
  ['honey', 'Honey'],
  ['sugar', 'Sweet', 1],
  ['smoky', 'Smoky'], ['smokey', 'Smoky'],
  ['spicier', 'Brown Spice'],
  ['dark choc', 'Dark Chocolate'],
  ['light fruity', 'Fruity', 1],
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
const NO_CALL = 'no call written; no family ticked';

// The Balance cupping, 2026-10-21 (decisions 1 to 7; tables B1 to B4)
const BALANCE: SessionSpec = {
  key: 'BAL',
  header: { sessionDate: '2026-10-21', sessionDatePrecision: 'exact', location: null,
    recordSource: 'paper: Balance Cupping - Oct 21 2026.pdf (4 pages; misc/roasteries/Balance Cupping)',
    transcribedBy: 'Claude (CTO session)', transcribedAt: '2026-10-21',
    checkedBy: 'blind second read 2026-10-21 (TRANSCRIPTION_CHECK_BRIEF_5_2026-10-21.md)',
    sheetFormat: 'ab_0_15_8dim', isBlind: false, roasterPresent: false,
    sessionNotes: 'Balance cupping: four coffees from three roasteries cupped side by side to compare the balanced end of the dial (Union, Benchmark, Fabricator, Geometric). All four were cupped before in their roastery sessions (35, 36, 37). Not blind. Grind 21 on Dana\'s sheet 1; ratio, water temp, steep, cups not recorded. No archetype call written by either cupper on any sample; no SCA family ticked. Merged by rule (union, n = 2).' },
  samples: [
    { roaster: 'utopian', coffee: 'Union', order: 1, sampleNote: 'Dana sample 1; Camila sample 5', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 9, 9, undefined, 'cocoa, nuts'), n(2, 8, 8, undefined, 'sugar, sweet, black tea'), n(3, 6, 6, undefined, 'sweet'),
          n(5, 4, 4, '4; faint marks at 1 and 3 read as struck'), n(4, 9), n(6, 0), t(12, 'silky'), t(11, 'sweet, light acidity')],
        descriptors: [['Cocoa', ['cocoa']], ['Nutty', ['nuts']], ['Sweet', ['sugar']], ['Black Tea', ['black tea']]],
        note: NO_CALL },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 8, 8, undefined, 'smoky / savory(?)'), n(2, 7, 7, undefined, 'caramel / burn(?)'), n(3, 7, 7, undefined, 'butter / caramel'),
          n(5, 3), n(4, 8), n(6, 4), n(7, 9), n(10, 2, 2, '2; mark at 6-7 scribbled out'), t(12, 'silky?'), t(11, 'caramel')],
        descriptors: [['Smoky', ['smoky']], ['Caramelized', ['caramel']]],
        note: NO_CALL },
    ] },
    { roaster: 'joeCoffee', coffee: 'Benchmark', order: 2, sampleNote: 'Dana sample 2; Camila sample 6', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 5, 5, undefined, 'cocoa, brown sugar or spice'), n(2, 6, 7, undefined, 'chocolate, caramel'), n(3, 6, 6, undefined, 'cocoa'),
          n(5, 1, 1, '1; faint mark at 0 read as struck', 'banana (acidity character: low, banana-like; Dana 2026-10-21)'), n(4, 5, 5, '5; faint mark at 4 read as struck'), n(6, 2, 2, '2; faint marks at 4 and 5 read as struck'),
          n(7, 5), t(12, '2% milk - less'), t(11, '~light ~bitterness sweet')],
        descriptors: [['Cocoa', ['cocoa']], ['Brown Sugar', ['brown sugar']], ['Brown Spice', ['spice']], ['Chocolate', ['chocolate']],
          ['Caramelized', ['caramel']]],
        note: NO_CALL, overall: 'Flavor notes (hot): "balanced coffee with no edges."' },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 6, 6, '6; mark at 10 scribbled out', 'spicier(?)'), n(2, 6, 6, undefined, 'caramel / sugar'), n(3, 8, 8, undefined, 'smokey? / dark chocolate'),
          n(5, 0), n(4, 5), n(6, 1), n(7, 4), n(10, 4), t(11, 'caramel / honey')],
        descriptors: [['Brown Spice', ['spicier']], ['Caramelized', ['caramel']], ['Sweet', ['sugar']], ['Smoky', ['smokey?']],
          ['Dark Chocolate', ['dark chocolate']], ['Honey', ['honey']]],
        note: 'no call written; "+ Classic" written in small script after the coffee name (not on the call line; left as a note)' },
    ] },
    { roaster: 'joeBean', coffee: 'Fabricator House Roast', order: 3, sampleNote: 'Dana sample 3; Camila sample 1', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 7, 7, '7; smudged mark at 8 read as struck', 'cocoa, brown sugar, honey'), n(2, 7, 7, undefined, 'cocoa, sweetish'),
          n(3, 7, 7, undefined, 'dark choc?, ~roasted, fruity - citrus'),
          n(5, 4, 4, '4; faint mark at 2 read as struck'), n(4, 3), n(6, 3, 3, '3; faint mark at 6 read as struck'),
          t(12, 'silky'), t(11, 'light ~bitter ~acid sweet acid')],
        descriptors: [['Cocoa', ['cocoa']], ['Brown Sugar', ['brown sugar']], ['Honey', ['honey']], ['Dark Chocolate', ['dark choc?']], ['Citrus Fruit', ['citrus']]],
        note: NO_CALL, overall: 'Flavor notes (hot): "Very similar to Union. Union is a bit more acid and more sweet."' },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 9, 9, '9; mark at 11 scribbled out', 'fruity (tangerine)'), n(2, 8, 8, undefined, 'fruity / nuts'), n(3, 4, 4, undefined, 'citrus / nuts'),
          n(5, 4, 4, '4; mark at 3 scribbled out'), n(4, 4),
          n(6, 5, 5, '5; bold circle drawn over hatch strokes, live (Dana confirmed 2026-10-21); mark at 8 scribbled out'),
          n(7, 6), n(10, 5), t(11, 'citrus')],
        descriptors: [['Fruity', ['fruity']], ['Citrus Fruit', ['tangerine', 'citrus']], ['Nutty', ['nuts']]],
        note: 'no call written; "Tangerine" also written above the Roast field',
        overall: 'Bitterness line: mark at 8 scribbled out; the 5 is a bold circle over hatch strokes, confirmed live by Dana 2026-10-21.' },
    ] },
    { roaster: 'joeBean', coffee: 'Geometric Filter Coffee', order: 4, sampleNote: 'Dana sample 4; Camila sample 2', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 8, 8, '8; faint mark at 10 read as struck', 'cocoa, sweet - fruit'), n(2, 8, 8, undefined, 'cocoa, sweet - fruit'), n(3, 8, 8, undefined, 'sweet'),
          n(5, 4, 4, '4; faint mark at 6 read as struck'), n(4, 10), n(6, 1), n(7, 4),
          t(12, '~2% milk, like tea'), t(11, 'sweet + acid lingers, and they are balanced')],
        descriptors: [['Cocoa', ['cocoa']], ['Fruity', ['fruit']]],
        note: NO_CALL },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 10, 10, '10; mark at 6-7 scribbled out', 'light fruity / fruity tea'), n(2, 9, 9, undefined, 'strawberry / honey'), n(3, 7, 7, undefined, 'honey'),
          n(5, 2), n(4, 7, 7, '7; mark at 0-1 scribbled out'), n(6, 4), n(7, 4), n(10, 4), t(11, 'honey / strawberry')],
        descriptors: [['Fruity', ['light fruity']], ['Black Tea', ['fruity tea']], ['Strawberry', ['strawberry']], ['Honey', ['honey']]],
        note: NO_CALL },
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
  log(`# loadCuppingEvidence5 → ${dbName}`);
  // Preconditions
  for (const [k, r] of Object.entries(ROASTERS)) {
    const basics = await getRoasterBasics(r.id);
    if (!basics || basics.name !== r.name || !basics.isActive) throw new Error(`roaster ${k} ${r.id} missing, renamed or inactive`);
  }
  const cupperRows = await cs.listCuppers();
  const cupperId = (name: string) => { const c = cupperRows.find(x => x.name === name); if (!c) throw new Error(`cupper ${name} missing`); return c.id as number; };

  // Decision 3: each coffee by (roaster name, coffee name), exactly one row, or stop before writing anything
  const coffeeIds: Record<string, number> = {};
  for (const x of BALANCE.samples) {
    const hits = (await listCatalogCoffeesForRoaster(ROASTERS[x.roaster].id)).filter(c => c.name === x.coffee);
    if (hits.length !== 1) throw new Error(`coffee ('${ROASTERS[x.roaster].name}', '${x.coffee}'): ${hits.length} rows; nothing written`);
    coffeeIds[x.coffee] = hits[0].id;
  }
  log(`coffees: ${BALANCE.samples.map(x => `${x.coffee}=${coffeeIds[x.coffee]}`).join(', ')}`);

  // 1. Decision 8: cupper word mappings, before any score; an existing cupper row wins
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
  const found = existing.find(x => x.record_source === BALANCE.header.recordSource);
  if (found) { sid = found.id; log(`session ${BALANCE.key} (${sid}): already loaded`); }
  else {
    sid = await cs.createSession({ ...BALANCE.header, brewDefaults: BREW });
    bump('sessions created'); log(`session ${BALANCE.key}: created ${sid}`);
  }

  // 3. Session coffees (brew rows from the session's brewDefaults)
  const sampleIds: Record<string, number> = {};
  const scs = await cr.listSessionCoffees(sid);
  for (const x of BALANCE.samples) {
    const coffeeId = coffeeIds[x.coffee];
    const sc = scs.find(r => r.coffee_id === coffeeId);
    if (sc) { sampleIds[x.coffee] = sc.session_coffee_id; log(`session coffee ${x.coffee} (${sc.session_coffee_id}): already loaded`); continue; }
    sampleIds[x.coffee] = await cs.addSessionCoffee(sid, coffeeId, { displayOrder: x.order, sampleNote: x.sampleNote ?? null });
    bump('session coffees created'); log(`session coffee ${x.coffee}: created ${sampleIds[x.coffee]}`);
  }

  // 4. Cupper rows, 5. merges (each merge refreshes the coffee's dial signal)
  for (const x of BALANCE.samples) {
    const scId = sampleIds[x.coffee];
    const where = `${BALANCE.key} ${x.coffee}`;
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
