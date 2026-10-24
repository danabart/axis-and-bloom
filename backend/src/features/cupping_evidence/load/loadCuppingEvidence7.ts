// Cupping evidence, brief 7 (2026-10-23): the Earthy / C&N cupping, one
// cross-roaster session (Dana + Camila) on five coffees already in the
// catalog. backend/src/features/cupping_evidence/CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_7_EARTHY_CUPPING.md.
//
//   npm run load:cupping-evidence-7 -- --target test
//   npm run load:cupping-evidence-7 -- --target prod --expect-db axisandbloom
//
// Loader 5's shape and run code, copied (not extracted, so loader 5 is
// untouched): a Sample names its roaster, because the session has none. Data only, through the doors:
// noteMappingService.setNoteMapping and cuppingService; reads through the
// *Reads modules. No SQL here (lint:cupping, lint:lineage). No catalog write.
// Idempotent by natural key (DESIGN §6.6): a second run reports "already
// loaded" per step and writes nothing.
//
// Order (decision 9): cupper word mappings → session header → session
// coffees (brew rows from brewDefaults) → cupper rows → rule merges → dial
// signal. mergeByRule refreshes the coffee's dial signal itself after each
// merge (cuppingService), which is decision 9's refreshDialSignal for the
// five coffees; calling it again would write a second signal row per coffee.
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

const LOADER_NOTE = 'loader 2026-10-23; rule: ';
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
const BREW = { doseGrams: 8.5, waterGrams: 150, ratio: 17.65, brewDevice: 'cupping bowl',
  notes: 'standard A&B cupping protocol (Dana, 2026-10-16); grind, temperature and steep time not recorded on the sheets' };

// ── Decision 7 (Dana, 2026-10-23): does Dana's flavor-notes line count as her
// call? false = call notes only (the brief's default, as brief 5's
// "+ Classic"); true = B4's right-hand column for Dana's rows only. Camila's
// ticks stay notes either way. Must be set before a run. ────────────────────
const FLAVOR_LINE_IS_CALL: boolean | null = true; // Dana, 2026-10-23: her flavor-notes line is her call

// ── Decision 8: cupper conventions, written before any score, only for
// words with no current cupper mapping (an existing cupper row wins). Every
// cupper word the loader resolves through the table gets its own cupper row,
// also where a roaster row exists (almond, baking chocolate, walnut; ruled in
// brief 5). The optional fourth field is the rule the brief states where it
// differs from ruleFor's (walnut → Nutty: contains). ─────────────────────────
const CUPPER_MAPPINGS: Array<[string, string, number?, string?]> = [
  ['tabaco', 'Tobacco'], ['tobacco', 'Tobacco'],
  ['ash', 'Ashy'], ['ashy', 'Ashy'],
  ['baking chocolate', 'Dark Chocolate', undefined, 'contains'],
  ['sweet almond', 'Almond', undefined, 'contains'], ['almond', 'Almond'],
  ['salty', 'Salty'], ['lemon', 'Lemon'],
  ['earthy', 'Musty / Earthy'], ['light earthy', 'Musty / Earthy'],
  ['walnut', 'Nutty', undefined, 'contains'],
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
/** Dana's flavor-notes line as her call (decision 7), only when ruled so */
const call = (a: string, pos?: string) => (FLAVOR_LINE_IS_CALL ? { a, ...(pos ? { pos } : {}) } : {});

// The Earthy / C&N cupping, 2026-10-23 (decisions 1 to 7; tables B1 to B4)
const EARTHY: SessionSpec = {
  key: 'EAR',
  header: { sessionDate: '2026-10-23', sessionDatePrecision: 'exact', location: null,
    recordSource: 'paper: Earthy - C&N Cupping - Oct 23 2026.pdf (6 pages; misc/roasteries/Earthy Cupping)',
    transcribedBy: 'Claude (CTO session)', transcribedAt: '2026-10-23',
    checkedBy: 'blind second read 2026-10-23 (TRANSCRIPTION_CHECK_BRIEF_7_2026-10-23.md)',
    sheetFormat: 'ab_0_15_8dim', isBlind: false, roasterPresent: false,
    sessionNotes: 'Earthy / C&N cupping: five dark coffees from three roasteries cupped side by side to separate earthy from chocolate-nutty (Obsidian, Espresso Volo, Blossom, Amsterdam, Big City). All five cupped before (sessions 36, 37, 39). Not blind. Ratio, grind, water temp, steep, cups not recorded. No archetype call on the call line by either cupper; Dana wrote her family reading on the flavor-notes line (see call notes). Merged by rule (union, n = 2).' },
  samples: [
    { roaster: 'utopian', coffee: 'Obsidian', order: 1, sampleNote: 'Dana page 1 sample 1; Camila page 5 sample 1', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 7, 7, undefined, 'tobacco, ash'), n(2, 6, 6, undefined, 'tobacco, deep, berries'), n(3, 6, 6, undefined, 'tobacco or smokey'),
          n(5, 0), n(4, 4, 4, '4; faint marks at 2 and 3 read as struck'), n(6, 8, 8, "8; mark at 11 X'd out"),
          n(7, 7, 7, '7; faint mark at 11 read as struck'), n(10, 10), t(12, 'milk like, smooth'), t(11, 'bitter')],
        descriptors: [['Tobacco', ['tobacco']], ['Ashy', ['ash']], ['Berry', ['berries']], ['Smoky', ['smokey']]],
        note: 'no call on the call line; flavor notes (hot): "maybe light earthy"; no family ticked', ...call('earthy') },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 6, 6, undefined, 'salty lemon(?)'), n(2, 6, 6, undefined, '(unreadable: ashes / amber / apricot across three readers) / caramel or syrup'),
          n(3, 7, 7, undefined, 'smoky'), n(5, 1), n(4, 6), n(6, 5, 5, '5; faint mark at 3 read as struck'), n(7, 4), n(10, 9), t(11, 'syrup / smoky')],
        descriptors: [['Salty', ['salty']], ['Lemon', ['lemon']], ['Caramelized', ['caramel']], ['Maple Syrup', ['syrup']], ['Smoky', ['smoky']]],
        note: 'no call; "light earthy" written next to Other on the family line' },
    ] },
    { roaster: 'utopian', coffee: 'Espresso Volo', order: 2, sampleNote: 'Dana page 1 sample 2; Camila page 5 sample 2', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 7, 7, undefined, 'dark choc, sweet, berries (then "gr…" cut off at the page edge)'),
          n(2, 9, 9, undefined, 'sweet-berry, smell like wine/te… (cut off at the page edge)'), n(3, 8, 8, undefined, 'berries'),
          n(5, 4, 4, '4; faint mark at 0 read as struck'), n(4, 7, 7, '7; faint mark at 5 read as struck'),
          n(6, 5, 5, '5; faint marks at 8 and 13 read as struck'), n(7, 6, 6, '6; faint mark at 11 read as struck'), n(10, 10),
          t(12, '~milky(?) tea like'), t(11, 'bitter ~dark with fruits touch')],
        descriptors: [['Dark Chocolate', ['dark choc']], ['Berry', ['berries', 'sweet-berry']]],
        note: 'no call on the call line; flavor notes (hot): "C&N"; no family ticked', ...call('chocolate_nutty') },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 6, 6, undefined, 'berries / chocolate'), n(2, 6, 6, undefined, 'chocolate / sugar'), n(3, 5, 5, undefined, 'berries'),
          n(5, 5), n(4, 6), n(6, 4, 4, '4; faint mark at 1 read as struck'), n(7, 4), n(10, 7, 7, '7; faint mark at 5-6 read as struck'),
          t(11, 'tobacco / berries')],
        descriptors: [['Berry', ['berries']], ['Chocolate', ['chocolate']], ['Sweet', ['sugar']], ['Tobacco', ['tobacco']]],
        note: 'no call; Nutty / Cocoa ticked; "chocolate and nutty" written by the family line' },
    ] },
    { roaster: 'joeBean', coffee: 'Blossom Dark Roast', order: 3, sampleNote: 'Dana page 2 sample 1; Camila page 6 sample 1', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 6, 6, "6; mark at 4 X'd out", 'smokey, dark choc'), n(2, 5, 5, undefined, 'dark choc'), n(3, 9, 9, undefined, 'dark choc'),
          n(5, 0), n(4, 3, 3, '3; faint mark at 5 read as struck'), n(6, 9, 9, '9; faint mark at 10 read as struck'),
          n(7, 9, 9, '9; faint mark at 10 read as struck'), n(10, 10), t(12, 'smooth, silky'), t(11, 'bitter lingers, bit of sweet')],
        descriptors: [['Smoky', ['smokey']], ['Dark Chocolate', ['dark choc']]],
        note: 'no call on the call line; flavor notes (hot): "C&N - Dark"; no family ticked', ...call('chocolate_nutty', 'dark') },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 7, 7, undefined, 'smoky'), n(2, 6, 6, undefined, 'sugar / chocolate'), n(3, 8, 8, '8; faint mark at 5 read as struck', 'dark chocolate /'),
          n(5, 2), n(4, 4), n(6, 5, 5, '5; faint mark at 3 read as struck'), n(7, 7, 7, '7; faint mark at 4 read as struck'), n(10, 6),
          t(11, 'smoky / tobacco')],
        descriptors: [['Smoky', ['smoky']], ['Sweet', ['sugar']], ['Chocolate', ['chocolate']], ['Dark Chocolate', ['dark chocolate']], ['Tobacco', ['tobacco']]],
        note: 'no call; Nutty / Cocoa ticked; "chocolate and nutty" written by the family line (first word unclear)' },
    ] },
    { roaster: 'joeCoffee', coffee: 'Amsterdam', order: 4, sampleNote: 'Dana page 2 sample 2; Camila page 6 sample 2', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 7, 7, undefined, 'dark choc, caramel'), n(2, 7, 7, undefined, 'dark choc, caramel, sweet'), n(3, 8, 8, undefined, 'caramel'),
          n(5, 0), n(4, 6), n(6, 6), n(7, 6, 6, '6; faint mark at 8 read as struck'), n(10, 5), t(11, 'sweet - caramel')],
        descriptors: [['Dark Chocolate', ['dark choc']], ['Caramelized', ['caramel']]],
        note: 'no call on the call line; flavor notes (hot): "C&N"; no family ticked', ...call('chocolate_nutty') },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 8, 8, undefined, 'caramel / dark chocolate (walnut?)'), n(2, 8, 8, undefined, 'smoky / caramel(?)'), n(3, 6, 6, undefined, 'dark chocolate'),
          n(5, 1, 1, '1; faint mark at 3 read as struck'), n(4, 4), n(6, 5, 5, '5; faint mark at 2 read as struck'), n(7, 5), n(10, 4)],
        descriptors: [['Caramelized', ['caramel']], ['Dark Chocolate', ['dark chocolate']], ['Nutty', ['walnut?']], ['Smoky', ['smoky']]],
        note: 'no call; Nutty / Cocoa ticked; aftertaste words scribbled out',
        overall: 'Aftertaste words fully scribbled out, unreadable; no row on 11.' },
    ] },
    { roaster: 'joeCoffee', coffee: 'Big City', order: 5, sampleNote: 'Dana page 3 sample 1; Camila page 4 sample 1', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 7, 7, undefined, '~tabaco, burnt or ashy'), n(2, 6, 6, undefined, 'sugar, chocolate / cocoa'), n(3, 6, 6, undefined, 'dark choc'),
          n(5, 2, 2, '2; faint mark at 0 read as struck'), n(4, 5, 5, '5; faint marks at 6 and 8 read as struck'),
          n(6, 10, 10, '10; faint marks at 8 and 9 read as struck'), n(7, 8), n(10, 10),
          t(12, 'more gripy'), t(11, '~light bitter and a bit sweetness, smokey lingers')],
        descriptors: [['Roast', ['burnt']], ['Ashy', ['ashy']], ['Sweet', ['sugar']], ['Chocolate', ['chocolate']], ['Cocoa', ['cocoa']],
          ['Dark Chocolate', ['dark choc']], ['Smoky', ['smokey']]],
        note: 'no call on the call line; flavor notes (hot): "Earthy, this is the closest to both"; (warm): "its more earthy light"; no family ticked',
        overall: '"most bitter than the rest" written on the Bitterness line.', ...call('earthy', 'light') },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 9, 9, undefined, 'spicier(?) / fruity'), n(2, 7, 7, undefined, 'sugar / sweet almond'),
          n(3, 6, 6, '6; faint mark at 7 read as struck', 'baking chocolate (because of the mouth feel…, runs off the page)'),
          n(5, 0), n(4, 3), n(6, 8, 8, '8; faint mark at 4 read as struck'), n(7, 6), n(10, 7, 7, '7; faint mark at 3 read as struck'),
          t(12, 'creamy / earthy'), t(11, 'sweet smoky')],
        descriptors: [['Brown Spice', ['spicier']], ['Fruity', ['fruity']], ['Sweet', ['sugar']], ['Almond', ['sweet almond']],
          ['Dark Chocolate', ['baking chocolate']], ['Musty / Earthy', ['earthy']], ['Smoky', ['smoky']]],
        note: 'no call; "Earthy" written under the family boxes; no box ticked' },
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
  log(`# loadCuppingEvidence7 → ${dbName}`);
  if (FLAVOR_LINE_IS_CALL === null) throw new Error('decision 7 (calls) is not set: FLAVOR_LINE_IS_CALL must be true or false');
  log(`decision 7: ${FLAVOR_LINE_IS_CALL ? "Dana's flavor-notes line is her call" : 'call notes only'}`);
  // Preconditions
  for (const [k, r] of Object.entries(ROASTERS)) {
    const basics = await getRoasterBasics(r.id);
    if (!basics || basics.name !== r.name || !basics.isActive) throw new Error(`roaster ${k} ${r.id} missing, renamed or inactive`);
  }
  const cupperRows = await cs.listCuppers();
  const cupperId = (name: string) => { const c = cupperRows.find(x => x.name === name); if (!c) throw new Error(`cupper ${name} missing`); return c.id as number; };

  // Decision 3: each coffee by (roaster name, coffee name), exactly one row, or stop before writing anything
  const coffeeIds: Record<string, number> = {};
  for (const x of EARTHY.samples) {
    const hits = (await listCatalogCoffeesForRoaster(ROASTERS[x.roaster].id)).filter(c => c.name === x.coffee);
    if (hits.length !== 1) throw new Error(`coffee ('${ROASTERS[x.roaster].name}', '${x.coffee}'): ${hits.length} rows; nothing written`);
    coffeeIds[x.coffee] = hits[0].id;
  }
  log(`coffees: ${EARTHY.samples.map(x => `${x.coffee}=${coffeeIds[x.coffee]}`).join(', ')}`);

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
  const found = existing.find(x => x.record_source === EARTHY.header.recordSource);
  if (found) { sid = found.id; log(`session ${EARTHY.key} (${sid}): already loaded`); }
  else {
    sid = await cs.createSession({ ...EARTHY.header, brewDefaults: BREW });
    bump('sessions created'); log(`session ${EARTHY.key}: created ${sid}`);
  }

  // 3. Session coffees (brew rows from the session's brewDefaults)
  const sampleIds: Record<string, number> = {};
  const scs = await cr.listSessionCoffees(sid);
  for (const x of EARTHY.samples) {
    const coffeeId = coffeeIds[x.coffee];
    const sc = scs.find(r => r.coffee_id === coffeeId);
    if (sc) { sampleIds[x.coffee] = sc.session_coffee_id; log(`session coffee ${x.coffee} (${sc.session_coffee_id}): already loaded`); continue; }
    sampleIds[x.coffee] = await cs.addSessionCoffee(sid, coffeeId, { displayOrder: x.order, sampleNote: x.sampleNote ?? null });
    bump('session coffees created'); log(`session coffee ${x.coffee}: created ${sampleIds[x.coffee]}`);
  }

  // 4. Cupper rows, 5. merges (each merge refreshes the coffee's dial signal)
  for (const x of EARTHY.samples) {
    const scId = sampleIds[x.coffee];
    const where = `${EARTHY.key} ${x.coffee}`;
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
