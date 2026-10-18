// Cupping evidence, brief 2 (2026-10-18): the loader for Joe Coffee, Joe Bean
// and Utopian. backend/src/features/cupping_evidence/CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_2_LOADS.md.
//
//   npm run load:cupping-evidence-2 -- --target test
//   npm run load:cupping-evidence-2 -- --target prod --expect-db axisandbloom
//
// Data only, through the doors: cuppingService, roasteryRemarkService,
// noteMappingService.setNoteMapping, catalogImport, catalogService (and
// roasteryPortalService.linkLineupCoffeeToCatalog for A4, the lineup's only
// write door). Reads go through the *Reads modules. No SQL here
// (lint:cupping, lint:lineage). Idempotent by natural key (DESIGN §6.6): a
// second run reports "already loaded" per step and writes nothing.
//
// Order (decision 16, with one forced change): cupper word mappings first
// (decision 6: before any score) → session headers → manifests (the basis
// lines need s<id>) → lineup links → samples → cupper rows → rule merges
// (mergeByRule refreshes the dial signal itself, after the manifest gave the
// coffee its archetype) → remarks and roaster mappings → A3b slot prices
// (catalogService.setSlotPrice, Dana 2026-10-18). Samples cannot come
// before the manifest: addSessionCoffee needs the coffee row the manifest
// creates.
//
// Every value below is the brief's table as written (corrected from the
// blind second read); nothing is converted here (grid and word values are
// native; the views convert). A struck word stays in notes as ~word and is
// never a descriptor.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
const { recordRemarks } = await import('../../../services/roasteryRemarkService.js');
const { listRemarks } = await import('../../../services/roasteryRemarkReads.js');
const { importCatalog } = await import('../../../services/catalogImport.js');
const { getSlots, getSlotPrices } = await import('../../../services/catalogReads.js');
const { setSlotPrice } = await import('../../../services/catalogService.js');
const { getLineup, getRoasterBasics, listCatalogCoffeesForRoaster, normalizeWords } = await import('../../../services/roasteryPortalReads.js');
const { linkLineupCoffeeToCatalog } = await import('../../../services/roasteryPortalService.js');
const { db } = await import('../../../db/client.js');

const ACTOR = 'script:loadCuppingEvidence2';
const LOADER_NOTE = 'loader 2026-10-18; rule: ';
const log = (...m: unknown[]) => console.log(...m);
const counts: Record<string, number> = {};
const bump = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };

// ── Roasters (rows, by id; Task 0 2026-10-18) ──────────────────────────────
const ROASTERS = {
  joeCoffee: { id: 'f42ad179-9ef4-410a-a92e-464eae1d84ce', name: 'Joe Coffee Company' },
  joeBean: { id: '19098f5c-99b9-4d7c-90ef-ee33d1e896b7', name: 'Joe Bean Roasters' },
  utopian: { id: 'bbf250d1-e433-4233-a30b-437fe62bcc4a', name: 'Utopian' },
} as const;
type RoasterKey = keyof typeof ROASTERS;

// ── A3b (Dana, 2026-10-18) ─────────────────────────────────────────────────
const SLOT_PRICE_CENTS = 2900;
const SLOT_PRICES_A3B: Array<[string, number]> = [['fruity', 1], ['floral', 1], ['balanced_sweet', 2]];

// ── Decision 12, 14 ─────────────────────────────────────────────────────────
const BREW = { doseGrams: 8.5, waterGrams: 150, ratio: 17.65, brewDevice: 'cupping bowl',
  notes: 'standard A&B cupping protocol (Dana, 2026-10-16); temperature, grind and steep time not recorded on the sheets' };
const TRANSCRIBED_BY = 'Claude (CTO session)';
const CHECKED_BY = 'Dana; blind second read 2026-10-16 (TRANSCRIPTION_CHECK_BRIEF_2_2026-10-16.md)';

// ── Decision 6: cupper words → SCA node (written before any score) ─────────
const CUPPER_MAPPINGS: Array<[string, string, number?]> = [
  ['berries', 'Berry'], ['berry', 'Berry'],
  ['nuts', 'Nutty'], ['roasted nuts', 'Nutty'],
  ['cocoa', 'Cocoa'],
  ['chocolate', 'Chocolate'], ['milk chocolate', 'Chocolate'], ['choc', 'Chocolate'], ['choc milk', 'Chocolate'],
  ['dark chocolate', 'Dark Chocolate'], ['bitter choc', 'Dark Chocolate'],
  ['spice', 'Brown Spice'], ['spices', 'Brown Spice'],
  ['citrus', 'Citrus Fruit'], ['citrus fruits', 'Citrus Fruit'],
  ['dried fruits', 'Dried Fruit'],
  ['tea', 'Black Tea'], ['black tea', 'Black Tea'], ['green tea', 'Black Tea'], ['tea like', 'Black Tea'],
  ['burned', 'Roast'], ['burnt', 'Roast'], ['roasty', 'Roast'],
  ['sugarcane', 'Molasses'], ['cane', 'Molasses'],
  ['syrup', 'Maple Syrup'],
  ['fruits', 'Fruity', 1], ['fruit', 'Fruity', 1], ['fruity', 'Fruity', 1],
  ['flower', 'Floral', 1], ['floral', 'Floral', 1],
];

// ── Score rows ──────────────────────────────────────────────────────────────
type V = { d: number; min?: number | null; max?: number | null; raw?: string | null; notes?: string | null };
/** a numeric value (raw defaults to '<min>-<max>' or '<v>') */
const n = (d: number, min: number, max: number = min, raw?: string, notes?: string): V => ({ d, min, max, raw: raw ?? (min === max ? `${min}` : `${min}-${max}`), notes });
/** a grid digit on Camila's 0 to 5 grid */
const g = (d: number, v: number): V => ({ d, min: v, max: v, raw: `grid 0-5: ${v}` });
/** a word on Camila's low / medium / high scale (native null) */
const wd = (d: number, word: string): V => ({ d, raw: word });
/** words only */
const t = (d: number, notes: string, raw?: string): V => ({ d, notes, raw });
type Desc = [node: string, words: string[]];
interface Row {
  cupper: string; scale: 'ab_0_15' | 'grid_0_5' | 'word_3';
  values: V[]; descriptors: Desc[];
  a?: string; a2?: string; pos?: string; slot?: string; note?: string; overall?: string;
  supersedeReason?: string;
}
interface Sample { coffee: string; order: number; blindCode?: string; sampleNote?: string; rows: Row[] }
interface SessionSpec {
  key: string; roaster: RoasterKey; existingSessionId?: number;
  header: { sessionDate: string; sessionDatePrecision: 'exact' | 'estimated'; location: string | null; recordSource: string;
    transcribedAt: string; sheetFormat: string; isBlind: boolean; roasterPresent: boolean; sessionNotes: string };
  samples: Sample[];
}
const D = 'Dana', C = 'Camila';

/** values: the numeric line by dimension; text: notes on 1, 2, 3, 11, 12 (dimension → words) */
const merge = (...parts: V[][]): V[] => {
  const by = new Map<number, V>();
  for (const p of parts) for (const v of p) by.set(v.d, { ...(by.get(v.d) ?? { d: v.d }), ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) } as V);
  return [...by.values()].sort((a, b) => a.d - b.d);
};

// PART B — Joe Coffee 2026-10-02 (Dana; dims 1-3 words only on this sheet)
const JOE_COFFEE: SessionSpec = {
  key: 'B1', roaster: 'joeCoffee',
  header: { sessionDate: '2026-10-02', sessionDatePrecision: 'exact', location: 'Joe Coffee Company, New York',
    recordSource: 'paper: Joe Coffee - Cupping Notes - Dana.pdf (4 pages; sheets printed 1 of 4 twice, 2 of 4, 3 of 4)',
    transcribedAt: '2026-10-11', sheetFormat: 'ab_0_15_8dim', isBlind: false, roasterPresent: true,
    sessionNotes: 'Cupping at Joe Coffee with Natalie (marketing director) and Joe staff. Eight coffees, Dana scored (ranges). Roaster remarks captured in roastery_remark. Merged by rule (one cupper).' },
  samples: [
    { coffee: 'Cafè Feminista: Montze Olvera', order: 1, rows: [{ cupper: D, scale: 'ab_0_15',
      values: merge([n(5, 6, 7, '6-7; crossed 4'), n(4, 7, 9), n(6, 0, 3), n(7, 3, 5)],
        [t(1, 'fruits, berries'), t(2, 'fruits, sweet'), t(3, 'fruits'), t(11, 'light acidity, sweetness')]),
      descriptors: [['Berry', ['berries']]], note: 'no call written', overall: 'Sheet 1 of the day.' }] },
    { coffee: 'Colombia La Familia Guarnizo', order: 2, rows: [{ cupper: D, scale: 'ab_0_15',
      values: merge([n(5, 4, 6), n(4, 7, 10), n(6, 2, 5)],
        [t(1, 'sweet, honey, nuts'), t(2, 'sweet, honey, caramel'), t(12, 'whole milk', '9-11 mark on the Mouthfeel scale was texture, not weight'), t(11, 'green tea bitterness, ~sweetness')]),
      descriptors: [['Honey', ['honey']], ['Caramelized', ['caramel']], ['Nutty', ['nuts']], ['Black Tea', ['green tea']]],
      a: 'balanced_sweet', note: 'call made at the table; roaster said floral (remark 12)',
      overall: 'Catalog decision 2026-10-13 adopted Floral; this row keeps Dana\'s own call.' }] },
    { coffee: 'The Village', order: 3, rows: [{ cupper: D, scale: 'ab_0_15',
      values: merge([n(5, 4, 6, '4-6; crossed 3'), n(4, 5, 7), n(6, 1, 4), n(7, 5, 7)],
        [t(1, 'green'), t(2, 'brown sugar'), t(3, 'sweetness'), t(11, 'light acid, sweetness')]),
      descriptors: [['Fresh', ['green']], ['Caramelized', ['brown sugar']]],
      a: 'balanced_sweet', a2: 'fruity', note: '"Balanced or Fruity"' }] },
    { coffee: 'Benchmark', order: 4, rows: [{ cupper: D, scale: 'ab_0_15',
      values: merge([n(5, 1, 4), n(4, 8, 10), n(6, 2, 4)],
        [t(1, 'cocoa, nuts'), t(2, 'caramel, sweet, spice'), t(3, 'sweet, caramel'), t(12, 'tea like'), t(11, 'balanced')]),
      descriptors: [['Cocoa', ['cocoa']], ['Nutty', ['nuts']], ['Caramelized', ['caramel']], ['Brown Spice', ['spice']]],
      a: 'balanced_sweet', overall: 'Drip coffee preferred (Dana\'s own remark).' }] },
    { coffee: 'Amsterdam', order: 5, rows: [{ cupper: D, scale: 'ab_0_15',
      values: merge([n(5, 1, 4), n(4, 4, 7), n(6, 5, 8, '5-8; crossed 3'), n(7, 6, 9)],
        [t(1, 'cocoa, milk chocolate'), t(2, 'nuts'), t(3, 'chocolate, nuts'), t(11, 'sweetness, light bitterness')]),
      descriptors: [['Cocoa', ['cocoa']], ['Chocolate', ['milk chocolate', 'chocolate']], ['Nutty', ['nuts']]],
      a: 'chocolate_nutty', note: '"can be earthy" written after the call', overall: 'Coffee from Brazil, best they have (Joe\'s, remark table).' }] },
    { coffee: 'The Daily', order: 6, rows: [{ cupper: D, scale: 'ab_0_15',
      values: merge([n(5, 3, 4, '3-4; crossed 1'), n(4, 6, 9), n(6, 4, 6)],
        [t(1, 'milk chocolate'), t(2, 'chocolate'), t(3, 'chocolate, caramel'), t(11, 'sweetness')]),
      descriptors: [['Chocolate', ['milk chocolate', 'chocolate']], ['Caramelized', ['caramel']]], note: 'no call written' }] },
    { coffee: 'Big City', order: 7, rows: [{ cupper: D, scale: 'ab_0_15',
      values: merge([n(5, 0, 2), n(4, 4, 6), n(6, 7, 9), n(7, 7, 9)],
        [t(1, 'musty'), t(2, 'roasted nuts, brown sugar'), t(3, 'burned, nuts'), t(12, 'silky'), t(11, 'bitterness, light')]),
      descriptors: [['Musty / Earthy', ['musty']], ['Nutty', ['roasted nuts', 'nuts']], ['Caramelized', ['brown sugar']], ['Roast', ['burned']]],
      a: 'earthy', pos: 'delicate earthy', note: 'the "natural process" part of the line is Joe\'s (remark 32)',
      overall: 'Bitterness 7–9 and aftertaste word "light" disagree; both kept as written.' }] },
    { coffee: 'Nightcap Decaf', order: 8, sampleNote: 'last cup of the day; Dana considers her scores provisional', rows: [{ cupper: D, scale: 'ab_0_15',
      values: merge([n(5, 6, 8, '6-8; crossed 1, 3'), n(4, 5, 7, '5-7; crossed 3'), n(6, 3, 5, '3-5; crossed 7'), n(7, 8, 10), n(10, 8, 10)],
        [t(1, 'nuts'), t(2, 'nuts'), t(3, 'almonds'), t(12, 'silky'), t(11, 'molasses, sweet', 'a first word scribbled out, unreadable')]),
      descriptors: [['Nutty', ['nuts']], ['Almond', ['almonds']], ['Molasses', ['molasses']]],
      note: 'no call; Nutty / Cocoa family ticked; "more fruity" on the line is Joe\'s (remark 38)', overall: 'Last cup of the day; scores provisional.' }] },
  ],
};

// PART C — Joe Bean 2026-09-30 (Dana + Camila, blind)
const JOE_BEAN: SessionSpec = {
  key: 'C1', roaster: 'joeBean',
  header: { sessionDate: '2026-09-30', sessionDatePrecision: 'exact', location: null,
    recordSource: 'paper: Dana 1.jpg, Dana 2.jpg, Camila 1.jpg, Camila 2.jpg (misc/roasteries/Joe Bean/Cupping 1 - Sep 2026)',
    transcribedAt: '2026-10-14', sheetFormat: 'ab_0_15_8dim', isBlind: true, roasterPresent: false,
    sessionNotes: 'Joe Bean Roasters, cupping 1. Four blends under blind codes (Blind Y/N not ticked on the sheets; blind per Dana). Date on sheets 2 of 4 only. Ratio, grind, water temp, steep, cups not recorded. Sheets 3 and 4 (Brazil, Indonesia, D.R. Congo single origins) are not in the folder and are not loaded. Merged by rule (union, n = 2).' },
  samples: [
    { coffee: 'Tiger Stripe Espresso', order: 1, blindCode: 'TIGER', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 4, 4, undefined, 'sweet, milk choc, caramel'), n(2, 4, 4, undefined, 'light fruit, sweet-honey?, choc'), t(3, 'chocolate, berries?'),
          n(4, 3, 5, '3-5; mark at 8 scribbled out'), n(5, 4, 6, "4-6; marks at 2 (X'd) and 8 (scribbled) struck"), n(6, 2, 5), n(7, 7, 9),
          t(11, '~sweet, tea like, light acid'), t(12, 'silky')],
        descriptors: [['Chocolate', ['milk choc', 'choc', 'chocolate']], ['Caramelized', ['caramel']], ['Honey', ['sweet-honey?']], ['Berry', ['berries']]],
        a: 'chocolate_nutty', note: '"DEF"; Nutty / Cocoa family ticked', overall: 'Acidity line has five marks, unresolved.' },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 4, 4, undefined, 'fruity tea, jasmine'), n(2, 8, 8, undefined, 'orange, bitter choc, smoky'), n(3, 5, 5, undefined, 'nuts'),
          n(4, 2), n(5, 3), n(6, 3), n(7, 5), n(10, 8), t(11, 'smoky, black tea'), t(12, 'creamy')],
        descriptors: [['Jasmine', ['jasmine']], ['Orange', ['orange']], ['Dark Chocolate', ['bitter choc']], ['Smoky', ['smoky']], ['Nutty', ['nuts']], ['Black Tea', ['fruity tea', 'black tea']]],
        note: 'no call written; Nutty / Cocoa family circled' },
    ] },
    { coffee: 'Geometric Filter Coffee', order: 2, blindCode: 'GEOMETRIC', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 5, 5, undefined, 'cocoa, chocolate, almonds'), n(2, 5, 5, undefined, 'almonds, spice?'), t(3, 'almonds'),
          n(4, 10, 12), n(5, 4, 7, 'marks at 4, 6, 7; 9 scribbled out'), n(6, 1, 4), n(7, 8, 10), t(11, 'sweet, tea like'), t(12, 'silky')],
        descriptors: [['Cocoa', ['cocoa']], ['Chocolate', ['chocolate']], ['Almond', ['almonds']], ['Brown Spice', ['spice?']]],
        a: 'balanced_sweet', note: '"DEF" (written "Balance")' },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 7, 7, undefined, 'almonds, ~fruity / berries'), n(2, 11, 11, undefined, 'chocolate, sweet, honey'), n(3, 8, 8, undefined, 'tea (dark)'),
          n(4, 5), n(5, 1), n(6, 2), n(7, 6), n(10, 3), t(12, 'silky')],
        descriptors: [['Almond', ['almonds']], ['Chocolate', ['chocolate']], ['Honey', ['honey']], ['Black Tea', ['tea (dark)']]],
        a: 'balanced_sweet' },
    ] },
    { coffee: 'Blossom Dark Roast', order: 3, blindCode: 'BLOSSOM', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 8, 8, undefined, 'cocoa, rust?, honey, smokey'), n(2, 6, 6, undefined, 'smokey, earth'), t(3, 'earthy, roasty'),
          n(4, 3, 5), n(5, 0), n(6, 7), n(7, 8, 10), t(11, 'bitter'), t(12, 'silky')],
        descriptors: [['Cocoa', ['cocoa']], ['Honey', ['honey']], ['Smoky', ['smokey']], ['Musty / Earthy', ['earth', 'earthy']], ['Roast', ['roasty']]],
        a: 'earthy', pos: 'med-strong' },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 13, 13, undefined, 'salty, smoky, BBQ chips'), n(2, 11, 11, undefined, 'after fire, syrup'), n(3, 11, 11, undefined, 'cigarette, tobacco'),
          n(4, 0), n(5, 0), n(6, 6), n(7, 9), n(10, 15), t(12, 'silky')],
        descriptors: [['Salty', ['salty']], ['Smoky', ['smoky']], ['Ashy', ['after fire']], ['Maple Syrup', ['syrup']], ['Tobacco', ['cigarette', 'tobacco']]],
        note: 'no call written; wrote "Earthy" under Other on the family line; acidity and sweetness lines marked with an asterisk' },
    ] },
    { coffee: 'Fabricator House Roast', order: 4, blindCode: 'FABRICATION', rows: [
      { cupper: D, scale: 'ab_0_15',
        values: [n(1, 8, 8, undefined, '~honey, sweet, choc milk, orange (inserted above the struck honey), ?. cherry like (interlinear)'),
          n(2, 5, 5, undefined, '~orange, fruits, sweet'), t(3, 'oranges / fruits'),
          n(4, 8, 10), n(5, 5, 7, 'marks at 5, 6, 7; the 4 overdrawn, read as struck'), n(6, 2, 5), n(7, 5, 7, 'marks at 5, 7; the 4 overdrawn, read as struck'),
          t(11, 'sweet, light acid')],
        descriptors: [['Chocolate', ['choc milk']], ['Orange', ['orange', 'oranges']], ['Cherry', ['cherry?']]],
        a: 'fruity', pos: 'light', note: '"Balance" scribbled out before "Fruity, light" (a struck word is not a secondary call)' },
      { cupper: C, scale: 'ab_0_15',
        values: [n(1, 10, 10, undefined, 'orange, dried fruits'), n(2, 3, 3, undefined, 'flower, sweet, "not citrus"'), n(3, 8, 8, undefined, 'fruits, raspberry, jasmine flower'),
          n(4, 5, 5, '5; a scribbled mark near 2-3 as well'), n(5, 7), n(6, 5), n(7, 4), n(10, 7)],
        descriptors: [['Orange', ['orange']], ['Dried Fruit', ['dried fruits']], ['Raspberry', ['raspberry']], ['Jasmine', ['flower', 'jasmine flower']]],
        note: 'no call written; Fruity family ticked' },
    ] },
  ],
};

// PART D — Utopian, three flights (Dana + Camila, not blind)
const UTOPIAN_COMMON = { location: null, isBlind: false, roasterPresent: false, transcribedAt: '2026-10-16' };
const FLIGHT_A: SessionSpec = {
  key: 'D-A', roaster: 'utopian',
  header: { ...UTOPIAN_COMMON, sessionDate: '2026-09-13', sessionDatePrecision: 'exact', sheetFormat: 'freeform_grid',
    recordSource: 'paper: IMG_3754 (Dana), IMG_3755 (Camila) (misc/roasteries/Utopian)',
    sessionNotes: 'First Utopian cupping. Freeform grid: Dana 0 to 15 ranges; Camila integers on a 0 to 5 relative grid (scale_code grid_0_5). Merged by rule (union, n = 2).' },
  samples: [
    { coffee: 'Mexico Alva Flores', order: 1, sampleNote: 'end-of-run lot', rows: [
      { cupper: D, scale: 'ab_0_15', values: [t(1, 'fruity, berry'), t(2, 'berries, dried fruits, black tea (?)'), t(3, 'black tea'),
          n(4, 7, 10), n(5, 3, 4, undefined, 'grape'), n(6, 0, 3), t(11, 'black tea, bitterness'), t(12, 'light')],
        descriptors: [['Berry', ['berry', 'berries']], ['Dried Fruit', ['dried fruits']], ['Black Tea', ['black tea']], ['Grape', ['grape']]], note: 'no call written' },
      { cupper: C, scale: 'grid_0_5', values: [t(1, 'fruits, berry'), t(2, 'honey, burnt'), t(3, 'tobacco vibes'),
          g(4, 0), g(5, 0), g(6, 4), t(11, 'bitter'), t(12, 'tea')],
        descriptors: [['Berry', ['berry']], ['Honey', ['honey']], ['Roast', ['burnt']], ['Tobacco', ['tobacco vibes']]], note: 'no call written' },
    ] },
    { coffee: 'Peru Chirinos Geisha', order: 2, rows: [
      { cupper: D, scale: 'ab_0_15', values: [t(1, 'flower, jasmin'), t(2, 'jasmin, tea, green tea'), t(3, 'tea, jasmin'),
          n(4, 4, 6), n(5, 3, 4, '3-4; second reading 6-8 struck (lime)', '~lime'), n(6, 0, 4), t(11, 'tea'), t(12, 'light')],
        descriptors: [['Jasmine', ['jasmin']], ['Black Tea', ['tea', 'green tea']]], note: 'no call written', overall: 'Acidity read twice: 3-4 and 6-8 lime.' },
      { cupper: C, scale: 'grid_0_5', values: [t(1, 'tea (maybe fruity / floral?), soft fruits, jasmin'), t(2, 'weak black tea, jasmin, caramel, ~orange (?)'), t(3, 'flower, rose'),
          g(4, 5), g(5, 1), g(6, 0), t(11, 'refreshing, happy'), t(12, 'tea')],
        descriptors: [['Jasmine', ['jasmin']], ['Black Tea', ['tea', 'weak black tea']], ['Caramelized', ['caramel']], ['Rose', ['rose']]], a: 'floral' },
    ] },
    { coffee: 'Colombia Andres Martinez', order: 3, sampleNote: 'end-of-run lot', rows: [
      { cupper: D, scale: 'ab_0_15', values: [t(1, 'cocoa, burnt, berries, dried fruits'), t(2, 'dried fruits, blackberries'), t(3, 'berries, raspberries, citrus'),
          n(4, 2, 4), n(5, 4, 6, '4-6; second reading 6-8 struck (lime)', '~lime'), n(6, 0, 4), t(11, 'dry, acid'), t(12, 'light')],
        descriptors: [['Cocoa', ['cocoa']], ['Roast', ['burnt']], ['Blackberry', ['blackberries']], ['Dried Fruit', ['dried fruits']], ['Raspberry', ['raspberries']], ['Berry', ['berries']]],
        note: 'no call written', overall: 'Acidity read twice: 4-6 and 6-8 lime.' },
      { cupper: C, scale: 'grid_0_5', values: [t(1, 'dried fruits, orange (?), sweet fruits with a bit of acidity'), t(2, 'sweet black tea, dried orange'), t(3, 'dried fruits, ~tea'),
          g(4, 3), g(5, 5), g(6, 2), t(11, 'acid, dried'), t(12, 'tea')],
        descriptors: [['Dried Fruit', ['dried fruits']], ['Orange', ['orange (?)', 'dried orange']], ['Black Tea', ['sweet black tea']]], note: 'no call written' },
    ] },
    { coffee: 'Peru Joel Silva Chirinos', order: 4, rows: [
      { cupper: D, scale: 'ab_0_15', values: [t(1, 'orange, citrus'), t(2, 'fruit, tea, orange'), t(3, 'citrus, orange'),
          n(4, 4, 5, '4-5; the 5 overwritten'), n(5, 4, 6, '4-6; second reading 6-8 overwritten, read as struck (lemon)', '~lemon'), n(6, 0, 4), t(11, 'tea like, acidity'), t(12, 'light')],
        descriptors: [['Orange', ['orange']], ['Citrus Fruit', ['citrus']], ['Black Tea', ['tea']]], note: 'no call written', overall: 'Acidity read twice: 4-6 and 6-8 lemon.' },
      { cupper: C, scale: 'grid_0_5', values: [t(1, 'tea, herbal, sweet fruits, orange'), t(2, 'fruity, sweet berries, acidity'), t(3, 'tea, strawberry'),
          g(4, 2), g(5, 5), g(6, 2), t(11, 'acid, ~a bit bitter'), t(12, 'light (~tea)')],
        descriptors: [['Orange', ['orange']], ['Berry', ['sweet berries']], ['Strawberry', ['strawberry']], ['Black Tea', ['tea']], ['Herb-like', ['herbal']]], a: 'fruity' },
    ] },
  ],
};
const FLIGHT_B: SessionSpec = {
  key: 'D-B', roaster: 'utopian',
  header: { ...UTOPIAN_COMMON, sessionDate: '2026-09-20', sessionDatePrecision: 'estimated', sheetFormat: 'freeform_grid',
    recordSource: 'paper: IMG_3753 (Dana), IMG_3751 and IMG_3752 (Camila, the same sheet photographed twice) (misc/roasteries/Utopian)',
    sessionNotes: 'Date not on the sheets; estimated 2026-09-20 (between 2026-09-14 and 2026-10-16). Freeform grid: Dana 0 to 15 ranges; Camila words low / medium / high (scale_code word_3, native values null, raw_value the word). Merged by rule; no dial signal (converted scale).' },
  samples: [
    { coffee: 'Espresso Volo', order: 1, rows: [
      { cupper: D, scale: 'ab_0_15', values: [t(1, 'burned, tobacco, ashy'), t(2, 'fruits, berries, cocoa or milk chocolate'), t(3, 'smokey, soft sweet, dark choc'),
          n(4, 0, 4), n(5, 4, 6), n(6, 5, 7), t(11, 'light bitter, dry, light'), t(12, 'juicy')],
        descriptors: [['Roast', ['burned']], ['Tobacco', ['tobacco']], ['Ashy', ['ashy']], ['Berry', ['berries']], ['Cocoa', ['cocoa or milk chocolate']], ['Smoky', ['smokey']], ['Dark Chocolate', ['dark choc']]],
        a: 'earthy', pos: 'light', note: 'written "Light Earth"' },
      { cupper: C, scale: 'word_3', values: [t(1, 'citrus fruits, dark chocolate'), t(2, 'creamy (?), sugar, milk chocolate'), t(3, 'orange (dried), dark chocolate, smoky'),
          wd(4, 'low'), wd(5, 'low'), wd(6, 'low'), t(11, 'bitter, dry'), t(12, 'syrup')],
        descriptors: [['Dark Chocolate', ['dark chocolate']], ['Chocolate', ['milk chocolate']], ['Citrus Fruit', ['citrus fruits']], ['Orange', ['orange (dried)']], ['Smoky', ['smoky']]],
        a: 'earthy', note: '"acid" and "light" written then struck' },
    ] },
    { coffee: 'Obsidian', order: 2, rows: [
      { cupper: D, scale: 'ab_0_15', values: [t(1, '~berries, cocoa, tobacco, smokey'), t(2, 'almonds, nuts, sweet'), t(3, 'roast, burnt'),
          n(4, 0, 4), n(5, 0, 4), n(6, 10, 13), t(11, 'low bitter'), t(12, 'light syrup')],
        descriptors: [['Cocoa', ['cocoa']], ['Tobacco', ['tobacco']], ['Smoky', ['smokey']], ['Almond', ['almonds']], ['Nutty', ['nuts']], ['Roast', ['roast', 'burnt']]],
        a: 'earthy' },
      { cupper: C, scale: 'word_3', values: [t(1, 'soy, spices, BBQ, ~fruits'), t(2, 'burnt (in the oven), smoky'), t(3, 'tobacco, burnt'),
          wd(4, 'low'), wd(5, 'low'), wd(6, 'medium'), t(11, 'bitter (low)'), t(12, 'syrup')],
        descriptors: [['Brown Spice', ['spices']], ['Smoky', ['smoky']], ['Roast', ['burnt (in the oven)', 'burnt']], ['Tobacco', ['tobacco']]],
        a: 'earthy', pos: 'Standard', note: '"medium" struck' },
    ] },
    { coffee: 'Decaf Mexico Veracruz', order: 3, rows: [
      { cupper: D, scale: 'ab_0_15', values: [t(1, 'cocoa, tobacco, smokey, berries'), t(2, '~fruits ~berries ~prune (?), sugarcane'), t(3, 'sweet'),
          n(4, 4, 6), n(5, 2, 4), n(6, 0, 4), t(11, 'low acid, sweet'), t(12, 'juicy')],
        descriptors: [['Cocoa', ['cocoa']], ['Tobacco', ['tobacco']], ['Smoky', ['smokey']], ['Berry', ['berries (fragrance)']], ['Molasses', ['sugarcane']]],
        a: 'balanced_sweet', note: '"choc & nut" written then struck' },
      { cupper: C, scale: 'word_3', values: [t(1, 'fruits'), t(2, 'sugar sweet, cane (?), almond tea'), t(3, 'fruity, pomegranate, chocolate'),
          wd(4, 'medium'), wd(5, 'low'), wd(6, 'low'), t(11, 'sweet, sugary'), t(12, 'juicy (~syrup)')],
        descriptors: [['Molasses', ['cane (?)']], ['Almond', ['almond tea']], ['Pomegranate', ['pomegranate']], ['Chocolate', ['chocolate']]],
        a: 'chocolate_nutty' },
    ] },
  ],
};
const FLIGHT_C_NOTES = 'Date not on the sheets; estimated 2026-09-20; Flying Jewel was placed 2026-09-27 with the note "Bloom dial: light fruity" from this sheet, so the flight is on or before that. Merged by rule (union, n = 2).';
const FLIGHT_C: SessionSpec = {
  key: 'D-C', roaster: 'utopian', existingSessionId: 35,
  header: { ...UTOPIAN_COMMON, sessionDate: '2026-09-20', sessionDatePrecision: 'estimated', sheetFormat: 'ab_0_15_8dim',
    recordSource: 'paper: IMG_3750, IMG_3749 (Dana), IMG_3747, IMG_3748 (Camila) (misc/roasteries/Utopian); sample 2 of IMG_3748 and IMG_3749 blank',
    sessionNotes: FLIGHT_C_NOTES + ' Session created by hand in Score Entry for Flying Jewel before 2026-09-27; Union and Pearl added and Dana\'s rows loaded by brief 2.' },
  samples: [
    { coffee: 'Flying Jewel', order: 1, rows: [
      { cupper: D, scale: 'ab_0_15', values: [n(1, 7, 9, undefined, 'chocolate, almonds, fruits, berries'), n(2, 7, 7, undefined, 'apple (marked x), above a scribbled-out word'), t(3, '~[illegible], fruits'),
          n(4, 5), n(5, 2, 4, "marks at 2, 4; 0 X'd out; berries"), n(6, 4, 4, '4; 6 scribbled out'), n(7, 5), n(10, 5), t(11, 'acid, ~bitter, light'), t(12, 'creamy')],
        descriptors: [['Chocolate', ['chocolate']], ['Almond', ['almonds']], ['Berry', ['berries']], ['Fruity', ['fruits']], ['Apple', ['apple (marked x)']]],
        note: 'no call written; Fruity family ticked' },
      { cupper: C, scale: 'ab_0_15', values: [t(1, 'berry'), t(2, 'brown sugar, ~chocolate (?)'), t(3, 'berries, raspberry'),
          n(4, 4), n(5, 4, 5), n(6, 0), n(7, 3), n(10, 5), t(11, 'berries')],
        descriptors: [['Berry', ['berry', 'berries']], ['Caramelized', ['brown sugar']], ['Raspberry', ['raspberry']]],
        note: 'no call written; Fruity family ticked',
        supersedeReason: 'legacy re-tag: same values, entered in Score Entry from IMG_3747; blind second read 2026-10-16 agrees; scale is the printed 0 to 15 sheet' },
    ] },
    { coffee: 'Union', order: 2, rows: [
      { cupper: D, scale: 'ab_0_15', values: [n(1, 7, 9, 'boxes 7 / 9 (max glyph could be 5)', 'fruits, pomegranate, chocolate'), n(2, 5, 5, undefined, 'fruits, black tea, ~nuts'), t(3, 'dark chocolate, fruit, orange'),
          n(4, 5), n(5, 5, 5, '5; 4 struck', 'orange'), n(6, 3, 3, "3; 8 X'd out"), n(7, 7), t(11, 'light acid')],
        descriptors: [['Pomegranate', ['pomegranate']], ['Chocolate', ['chocolate']], ['Black Tea', ['black tea']], ['Dark Chocolate', ['dark chocolate']], ['Orange', ['orange']]],
        note: 'wrote "balanced" next to Other and struck it through' },
      { cupper: C, scale: 'ab_0_15', values: [t(1, 'sour fruity'), t(2, 'black tea, sweet aromatics'), t(3, 'light citrus (?)'),
          n(4, 1), n(5, 6, 6, '6; scribble over 0-1 and a circle at 3 struck'), n(6, 1), n(7, 1), n(10, 2), t(12, 'dry')],
        descriptors: [['Sour Aromatics', ['sour fruity']], ['Black Tea', ['black tea']], ['Sweet Aromatics', ['sweet aromatics']], ['Citrus Fruit', ['light citrus (?)']]],
        note: 'Floral and Fruity boxed together on the family line, "limit of floral and fruity"; wrote BALANCED in the right margin and struck it' },
    ] },
    { coffee: 'Pearl', order: 3, rows: [
      { cupper: D, scale: 'ab_0_15', values: [n(1, 7, 9, undefined, 'cocoa, nuts'), n(2, 5, 5, undefined, 'light cocoa, fruits, dried fruits'), t(3, 'fruits, citrus'),
          n(4, 9), n(5, 3, 3, '3; 7 struck (diagonal stroke)'), n(6, 3), n(7, 7, 7, '7; 5 filled in / struck'), t(11, 'acid'), t(12, 'silky')],
        descriptors: [['Cocoa', ['cocoa', 'light cocoa']], ['Nutty', ['nuts']], ['Dried Fruit', ['dried fruits']], ['Citrus Fruit', ['citrus']]],
        a: 'fruity', pos: 'light fruity', slot: 'fruity/1',
        note: 'Fruity family ticked; wrote "Bloom dial: light fruity"; slot id set because "light" is the lowest position of the Fruity dial' },
      { cupper: C, scale: 'ab_0_15', values: [t(1, 'pepper'), t(2, 'black tea, jasmin'), t(3, 'tea'),
          n(4, 2), n(5, 0, 2, 'marks at 0 and 2'), n(6, 2), n(7, 2), n(10, 3), t(11, 'short, smoky light'), t(12, 'light')],
        descriptors: [['Pepper', ['pepper']], ['Black Tea', ['black tea', 'tea']], ['Jasmine', ['jasmin']], ['Smoky', ['smoky light']]],
        note: 'no call written; Floral family ticked' },
    ] },
  ],
};
const SESSIONS: SessionSpec[] = [JOE_COFFEE, JOE_BEAN, FLIGHT_A, FLIGHT_B, FLIGHT_C];

// ── Manifests (Part A); s<id> in each basis line is filled from the session ──
const MANIFESTS: Array<{ file: string; roaster: RoasterKey; sessionOf: (coffee: string) => string }> = [
  { file: 'joe_coffee_2026_10_02.json', roaster: 'joeCoffee', sessionOf: () => 'B1' },
  { file: 'joe_bean_2026_09_30.json', roaster: 'joeBean', sessionOf: () => 'C1' },
  { file: 'utopian_2026_09.json', roaster: 'utopian', sessionOf: (c) =>
      ['Espresso Volo', 'Obsidian', 'Decaf Mexico Veracruz'].includes(c) ? 'D-B'
      : ['Pearl', 'Union'].includes(c) ? 'D-C' : 'D-A' },
];

// ── Remarks ─────────────────────────────────────────────────────────────────
interface RemarkSpec {
  roaster: RoasterKey; coffee: string | null; topic: string; remark: string; node?: string | null; nodeTier?: number;
  saidBy: string; saidOn: string; channel: string; recordedBy: string; recordSource: string;
  proposedArchetype?: string; sessionKey?: string; mapWords?: boolean;
}
const JC = 'Joe Coffee Company';
const STAFF = 'Joe Coffee staff at the cupping table', NATALIE = 'Natalie (Joe Coffee, marketing director)';
const JCF: Record<string, string> = {
  feminista: 'paper: Joe Coffee - Feminista - Roastery Notes.pdf', lafamilia: 'paper: Joe Coffee - La Familia - Roastery Notes.pdf',
  village: 'paper: Joe Coffee - The Village - Roastery Notes.pdf', benchmark: 'paper: Joe Coffee - Benchmark - Roastery Notes.pdf',
  daily: 'paper: Joe Coffee - The Daily - Roastery Notes.pdf', amsterdam: 'paper: Joe Coffee - Amesterdam - Roastery Notes.pdf',
  bigcity: 'paper: Joe Coffee - Big City - Roastery Notes.pdf', nightcap: 'paper: Joe Coffee - Roastery notes - Nightcup.pdf',
  dana: 'paper: Joe Coffee - Cupping Notes - Dana.pdf',
};
const FEM = 'Cafè Feminista: Montze Olvera', LAF = 'Colombia La Familia Guarnizo';
const b6 = (coffee: string, topic: string, remark: string, who: 'staff' | 'Natalie', file: string, extra: Partial<RemarkSpec> = {}): RemarkSpec => ({
  roaster: 'joeCoffee', coffee, topic, remark, saidBy: who === 'staff' ? STAFF : NATALIE, saidOn: '2026-10-02', channel: 'cupping_table',
  recordedBy: 'Dana', recordSource: JCF[file], sessionKey: 'B1', ...extra,
});
// B6: 38 table remarks
const B6: RemarkSpec[] = [
  b6(FEM, 'general', 'Single origin.', 'staff', 'feminista'),
  b6(FEM, 'process', 'Interesting process.', 'staff', 'feminista'),
  b6(FEM, 'brewing', 'Best brewing: pour-over and espresso. They don\'t expect espresso and it\'s surprising.', 'staff', 'feminista'),
  b6(FEM, 'availability', 'Limited release, a specific line. If seasonal, can usually offer a similar profile when it runs out: yes.', 'staff', 'feminista'),
  b6(FEM, 'general', 'Natalie\'s favorite among the fruity coffees.', 'Natalie', 'dana'),
  b6(LAF, 'general', 'Single origin.', 'staff', 'lafamilia'),
  b6(LAF, 'classification', 'Floral.', 'staff', 'lafamilia', { proposedArchetype: 'floral' }),
  b6(LAF, 'descriptor', 'White floral.', 'staff', 'lafamilia'),
  b6(LAF, 'descriptor', 'Orange blossom.', 'staff', 'lafamilia'),
  b6(LAF, 'brewing', 'Best brewing: pour-over and espresso.', 'staff', 'lafamilia'),
  b6(LAF, 'brewing', 'Drip, pour over.', 'Natalie', 'dana'),
  b6(LAF, 'classification', 'She sees it more as floral (Dana had called it Balanced).', 'Natalie', 'dana', { proposedArchetype: 'floral' }),
  b6('The Village', 'general', 'Favorite. Single origin.', 'Natalie', 'village'),
  b6('The Village', 'classification', 'Fruity.', 'staff', 'village', { proposedArchetype: 'fruity' }),
  b6('The Village', 'descriptor', 'Malic acidity.', 'staff', 'village', { node: 'Malic Acid' }),
  b6('The Village', 'dimension', 'There is acidity here. Light roast, light fruity.', 'Natalie', 'dana'),
  b6('The Village', 'brewing', 'Best brewing: pour-over and espresso.', 'staff', 'village'),
  b6('The Village', 'availability', 'Typical notice before it becomes unavailable: 2+ months. "Similar profile when it runs out: yes" was marked and then crossed; unclear.', 'staff', 'village'),
  b6('Benchmark', 'classification', 'Balanced.', 'staff', 'benchmark', { proposedArchetype: 'balanced_sweet' }),
  b6('Benchmark', 'brewing', 'Best brewing: drip and espresso. Good in a latte.', 'staff', 'benchmark'),
  b6('Benchmark', 'general', 'No edge. Good in a latte. Drip coffee preferred.', 'Natalie', 'dana'),
  b6('The Daily', 'classification', 'Chocolate and Nutty.', 'staff', 'daily', { proposedArchetype: 'chocolate_nutty' }),
  b6('The Daily', 'brewing', 'Best brewing: drip and espresso. "Light".', 'staff', 'daily'),
  b6('The Daily', 'general', 'Their best they have; house drip.', 'Natalie', 'dana'),
  b6('Amsterdam', 'classification', 'Chocolate and nutty.', 'staff', 'amsterdam', { proposedArchetype: 'chocolate_nutty' }),
  b6('Amsterdam', 'dimension', 'Smooth.', 'staff', 'amsterdam'),
  b6('Amsterdam', 'brewing', 'Brewing method: espresso, French press.', 'staff', 'amsterdam'),
  b6('Amsterdam', 'brewing', 'Espresso recommended.', 'Natalie', 'dana'),
  b6('Amsterdam', 'origin', 'Coffee from Brazil, best they have.', 'Natalie', 'dana'),
  b6('Big City', 'classification', 'Earth (delicate earth).', 'staff', 'bigcity', { proposedArchetype: 'earthy' }),
  b6('Big City', 'dimension', 'Not bitter as much because of the natural process.', 'staff', 'bigcity'),
  b6('Big City', 'process', 'It\'s natural process, so it removes bitterness. Delicate earthy.', 'Natalie', 'dana'),
  b6('Big City', 'brewing', '1 espresso, 2 drip.', 'staff', 'bigcity'),
  b6('Big City', 'availability', 'Available all the time.', 'staff', 'bigcity'),
  b6('Big City', 'general', 'Goes with food, in restaurants. Dark roast.', 'Natalie', 'dana'),
  b6('Nightcap Decaf', 'dimension', 'Strong acidity for a decaf.', 'staff', 'nightcap'),
  b6('Nightcap Decaf', 'classification', 'Fruity decaf.', 'staff', 'nightcap', { proposedArchetype: 'fruity' }),
  b6('Nightcap Decaf', 'classification', 'More fruity.', 'Natalie', 'dana', { proposedArchetype: 'fruity' }),
];

// D6: Utopian website (52)
const UT_SRC = 'utopiancoffee.com via misc/roasteries/intake/Roaster_Intake_Utopian.xlsx (Sep 2026)';
const d6 = (coffee: string, topic: string, remark: string, node: string | null = null, nodeTier?: number): RemarkSpec => ({
  roaster: 'utopian', coffee, topic, remark, node, nodeTier, saidBy: 'Utopian Coffee Co. (utopiancoffee.com)', saidOn: '2026-10-06',
  channel: 'website', recordedBy: 'Dana', recordSource: UT_SRC, mapWords: topic === 'descriptor' && !!node,
});
const UT_PAGES: Array<[string, Array<[string, string | null, number?]>, string, string, string?]> = [
  ['Flying Jewel', [['Berries', 'Berry'], ['Sweet Cream', null], ['Cocoa', 'Cocoa']], 'Washed + Natural', 'Medium-Light'],
  ['Espresso Volo', [['Fragrant Berries', 'Berry'], ['Cocoa', 'Cocoa'], ['Sweet Tobacco', 'Tobacco']], 'Washed + Natural', 'Medium-Dark'],
  ['Peru Chirinos Geisha', [['Mango Puree', 'Other Fruit'], ['Narcissi', 'Floral', 1], ['Honeycomb', 'Honey']], 'Washed', 'Light'],
  ['Obsidian', [['Palo Santo', 'Woody'], ['Campfire \'Mallows', 'Smoky'], ['Mrs. Buttersworth', 'Maple Syrup']], 'Washed', 'Dark'],
  ['Decaf Mexico Veracruz', [['Red Apple', 'Apple'], ['Flaky Croissant', null], ['Walnut Butter', 'Nutty']], 'Washed, Mountain Water decaf', 'Medium'],
  ['Peru Joel Silva Chirinos', [['Ground Cherry', 'Other Fruit'], ['Ube Halo Halo', null], ['Crunchy Sweetness', null]], 'Natural', 'Medium-Light'],
  ['Mexico Alva Flores', [['Black Plum', 'Other Fruit'], ['Honeycomb', 'Honey'], ['Champorado', 'Chocolate']], 'Washed', 'Medium'],
  ['Pearl', [['Citrusy', 'Citrus Fruit'], ['Sweet', null], ['juicy fruit with a backbone of chocolate', 'Chocolate']], 'Washed + Natural', 'Light', 'Bright'],
  ['Union', [['caramel sauce', 'Caramelized'], ['buttered pastry', null], ['pistachio', 'Nutty']], 'Washed', 'Medium', 'Smooth'],
  ['Colombia Andres Martinez', [['Fragrant Jasmine', 'Jasmine'], ['Green Melon', 'Other Fruit'], ['Almond Butter', 'Almond']], 'Double fermentation', 'Medium-Light'],
];
const D6: RemarkSpec[] = UT_PAGES.flatMap(([coffee, notes, process, roast, dimension]) => [
  ...notes.map(([w, node, tier]) => d6(coffee, 'descriptor', w, node, tier)),
  ...(dimension ? [d6(coffee, 'dimension', dimension)] : []),
  d6(coffee, 'process', process), d6(coffee, 'roast', roast),
]);

// D7 / D8: Joe Coffee and Joe Bean websites (captured 2026-10-18)
type Page = { slug: string; coffee: string | null; rows: Array<[topic: string, remark: string, node?: string | null, tier?: number, paragraph?: boolean]> };
const web = (roaster: 'joeCoffee' | 'joeBean', saidBy: string, host: string, pages: Page[]): RemarkSpec[] =>
  pages.flatMap(p => p.rows.map(([topic, remark, node, tier, paragraph]) => ({
    roaster, coffee: p.coffee, topic, remark, node: node ?? null, nodeTier: tier, saidBy, saidOn: '2026-10-18', channel: 'website',
    recordedBy: 'Claude (review session); not yet checked by Dana',
    recordSource: p.slug ? `https://${host}/products/${p.slug}${paragraph ? ' (description paragraph)' : ''}; captured 2026-10-18` : `https://${host}; site-wide brewing tip; captured 2026-10-18`,
    mapWords: topic === 'descriptor' && !!node,
  })));
const P = true; // description-paragraph row
const D7 = web('joeCoffee', 'Joe Coffee Company (joecoffeecompany.com)', 'joecoffeecompany.com', [
  { slug: 'cafe-feminista-montze-olvera', coffee: FEM, rows: [
    ['descriptor', 'Papaya', 'Other Fruit'], ['descriptor', 'Milk Duds', null], ['descriptor', 'Candied Coconut', 'Coconut'],
    ['descriptor', 'milk chocolate', 'Chocolate', undefined, P], ['descriptor', 'toasted caramel', 'Caramelized', undefined, P], ['descriptor', 'ripe papaya', 'Other Fruit', undefined, P],
    ['descriptor', 'candied coconut', 'Coconut', undefined, P], ['descriptor', 'warm, sugar-browning richness', 'Brown Sugar', undefined, P],
    ['process', 'Honey'], ['roast', 'Light'],
    ['origin', 'Sierra de Tenango, Hidalgo, México; Montze Olvera; Typica & Marsellesa; 1400 MASL'],
    ['general', 'a coffee to enjoy on its own or in milk'] ] },
  { slug: 'colombia-la-familia-guarnizo-1', coffee: LAF, rows: [
    ['descriptor', 'Caramel', 'Caramelized'], ['descriptor', 'Honey', 'Honey'], ['descriptor', 'Clementine', 'Citrus Fruit'],
    ['descriptor', 'stone fruit', 'Other Fruit', undefined, P], ['descriptor', 'almonds', 'Almond', undefined, P],
    ['process', 'Washed'], ['roast', 'Light'],
    ['origin', 'Huila, Colombia; The Guarnizo Family; Caturra, Colombia; 1600-1800 MASL'],
    ['dimension', 'medium acidity'], ['general', 'a customer favorite'] ] },
  { slug: 'the-village', coffee: 'The Village', rows: [
    ['descriptor', 'Apple Blossom', 'Floral', 1], ['descriptor', 'Candied Grapefruit', 'Grapefruit'], ['descriptor', 'Apricot', 'Other Fruit'],
    ['descriptor', 'honeyed', 'Honey', undefined, P], ['descriptor', 'ripe, stone-fruit sweetness', 'Other Fruit', undefined, P], ['descriptor', 'melon', 'Other Fruit', undefined, P],
    ['descriptor', 'orange blossom', 'Floral', 1, P], ['descriptor', 'rosewater', 'Rose', undefined, P], ['descriptor', 'vanilla', 'Vanilla', undefined, P],
    ['process', 'Washed'], ['roast', 'Light'],
    ['origin', 'Ngozi, Burundi; Turihamwe Women\'s Group; Bourbon; 1750 MASL'],
    ['general', 'complex and delicate flavors … unfurl and lengthen in the aftertaste'] ] },
  { slug: 'benchmark', coffee: 'Benchmark', rows: [
    ['descriptor', 'Cocoa', 'Cocoa'], ['descriptor', 'Spice', 'Brown Spice'], ['descriptor', 'Caramel', 'Caramelized'],
    ['process', 'Washed'], ['roast', 'Medium'],
    ['origin', 'San Ignacio, Cajamarca, Peru; El Guayacan Smallholder Farmers; Typica, Caturra, Bourbon; 1,600-2,100 MASL; Blend'],
    ['general', 'smooth, balanced, and robust'],
    ['brewing', 'Cortado, cappuccino, drip coffee—you really can\'t go wrong with this one'],
    ['general', 'designed to shine both in milk and on its own'] ] },
  { slug: 'amsterdam', coffee: 'Amsterdam', rows: [
    ['descriptor', 'Dark Chocolate', 'Dark Chocolate'], ['descriptor', 'Walnut', 'Nutty'], ['descriptor', 'Caramel', 'Caramelized'],
    ['descriptor', 'chocolate', 'Chocolate', undefined, P], ['descriptor', 'nut', 'Nutty', undefined, P], ['descriptor', 'toffee', 'Brown Sugar', undefined, P],
    ['process', 'Natural'], ['roast', 'Medium'],
    ['origin', 'Cerrado, Minas Gerais, Brazil; Veloso Family; Red Catuaí; 1066 MASL; Blend'],
    ['general', 'Rich, sweet, and comforting'], ['roast', 'a deeper roast profile'], ['brewing', 'the perfect drip coffee option'] ] },
  { slug: 'the-daily', coffee: 'The Daily', rows: [
    ['descriptor', 'Chocolate', 'Chocolate'], ['descriptor', 'Caramel', 'Caramelized'], ['descriptor', 'Molasses', 'Molasses'],
    ['process', 'Washed'], ['roast', 'Medium'],
    ['origin', 'Tapachula, Chiapas, Mexico (Muguira Family; Sarchimor, Marsellesa, H16; 2350 MASL) and Huila, Colombia (El Paraíso Growers\' Association; Caturra, Colombia, Catuai; 1300-1800 MASL); Blend'],
    ['general', 'built around seasonally fresh components, typically coffees from South America'],
    ['general', 'a satisfying, drink-every-day blend'] ] },
  { slug: 'big-city', coffee: 'Big City', rows: [
    ['descriptor', 'Burnt Sugar', 'Brown Sugar'], ['descriptor', 'Baking Chocolate', 'Dark Chocolate'], ['descriptor', 'Roasted Almond', 'Almond'],
    ['descriptor', 'burnt sugar', 'Brown Sugar', undefined, P], ['descriptor', 'baking chocolate', 'Dark Chocolate', undefined, P], ['descriptor', 'roasted nuts', 'Nutty', undefined, P],
    ['process', 'Natural, Washed'], ['roast', 'French Roast (Dark)'],
    ['origin', 'Cerrado, Minas Gerais, Brazil (Veloso Family) and South Caribbean Autonomous Region, Nicaragua (smallholder farmers); Red Catuai, Peaberry Robusta; 200-1,500 MASL; Blend'],
    ['dimension', 'full-bodied'], ['general', 'Sturdy and sweet'],
    ['general', 'crafted for wide appeal … without ever compromising on sweetness'] ] },
  { slug: 'nightcap-decaf', coffee: 'Nightcap Decaf', rows: [
    ['descriptor', 'Almond', 'Almond'], ['descriptor', 'Molasses', 'Molasses'], ['descriptor', 'Cola', null],
    ['process', 'Washed'], ['roast', 'Medium'],
    ['origin', 'Tapachula, Chiapas, Mexico; Muguira Family; Sarchimor, Marsellesa, H16; 2350 MASL; Single Origin'],
    ['brewing', 'Whether prepared as brewed coffee or espresso'],
    ['general', 'sweet, rich, and drinkable around the clock'] ] },
]);
const D8 = web('joeBean', 'Joe Bean Roasters (shop.joebeanroasters.com)', 'shop.joebeanroasters.com', [
  { slug: 'tiger-stripe-espresso-2lb', coffee: 'Tiger Stripe Espresso', rows: [
    ['descriptor', 'Chocolate', 'Chocolate'], ['descriptor', 'Peanut Butter', 'Peanuts'], ['descriptor', 'Almond', 'Almond'], ['descriptor', 'Fig', 'Dried Fruit'],
    ['descriptor', 'Apple', 'Apple'], ['descriptor', 'Pear', 'Pear'], ['descriptor', 'Cherry', 'Cherry'],
    ['descriptor', 'chocolate', 'Chocolate', undefined, P], ['descriptor', 'almond', 'Almond', undefined, P], ['descriptor', 'fruit', 'Fruity', 1, P],
    ['dimension', 'sweet & full-bodied'],
    ['general', 'Winner of a 2023 Golden Bean medal, this classic espresso blend'],
    ['brewing', 'Use an 18g dose; aim for a 40g – 45g yield; 35 sec - 40 sec shot time'],
    ['general', 'perfect on its own, or with steamed milk'],
    ['origin', 'community-blended micro-lots sourced through our farming partners'] ] },
  { slug: 'geometric-filter-coffee-2lb', coffee: 'Geometric Filter Coffee', rows: [
    ['descriptor', 'Toffee', 'Brown Sugar'], ['descriptor', 'Strawberry', 'Strawberry'], ['descriptor', 'Apricot', 'Other Fruit'], ['descriptor', 'Honey', 'Honey'],
    ['descriptor', 'citrus', 'Citrus Fruit', undefined, P], ['descriptor', 'caramel', 'Caramelized', undefined, P],
    ['general', 'A beautiful combination of citrus and caramel, this three part blend'],
    ['general', 'appealing to those who love bright, fruity coffees'],
    ['brewing', 'perfect for manual pour-over brewing (and automatic drip)'] ] },
  { slug: 'blossom-dark-roast-2lb', coffee: 'Blossom Dark Roast', rows: [
    ['descriptor', 'Dark Chocolate', 'Dark Chocolate'], ['descriptor', 'Black Cherry', 'Cherry'], ['descriptor', 'Toffee', 'Brown Sugar'], ['descriptor', 'Turbinado Sugar', 'Brown Sugar'],
    ['descriptor', 'chocolate', 'Chocolate', undefined, P], ['descriptor', 'black cherry', 'Cherry', undefined, P], ['descriptor', 'toffee', 'Brown Sugar', undefined, P],
    ['roast', 'This is our darkest roasted coffee'],
    ['dimension', 'Full-bodied'], ['general', 'surprisingly sweet and flavorful'], ['general', 'a pleasant finish'] ] },
  { slug: 'fabricator-house-roast-2lb', coffee: 'Fabricator House Roast', rows: [
    ['descriptor', 'Hazelnut', 'Hazelnut'], ['descriptor', 'Citrus', 'Citrus Fruit'], ['descriptor', 'Graham Cracker', null], ['descriptor', 'Cinnamon', 'Cinnamon'],
    ['descriptor', 'hazelnut', 'Hazelnut', undefined, P], ['descriptor', 'light citrus', 'Citrus Fruit', undefined, P], ['descriptor', 'graham cracker', null, undefined, P], ['descriptor', 'cinnamon', 'Cinnamon', undefined, P],
    ['process', 'the Brazil element contains naturally processed coffee grown in the Mogiana region'],
    ['dimension', 'medium-bodied'], ['general', 'beautifully balanced'],
    ['origin', 'combines coffees from Colombian and Brazilian; the Colombia blend is directly sourced through our on-the-ground partners; the Brazil element … Mogiana region'],
    ['brewing', 'tastes great brewed a variety of ways including auto drip, pour over, and even espresso'] ] },
  { slug: '', coffee: null, rows: [
    ['brewing', 'We recommend using a 1:16 ratio by weight, 60g of coffee for every 1,000g of water. Using filtered (but not distilled) water.'] ] },
]);

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
const ruleFor = (words: string, n: Node) => normalizeWords(words) === n.descriptor.toLowerCase() ? 'exact' : n.tier < 3 ? 'node' : 'contains';

async function ensureMapping(words: string, n: Node, sourceKind: 'roaster' | 'cupper'): Promise<void> {
  const result = await setNoteMapping({ normalizedWords: words, cuppingNoteId: n.id, sourceKind, adminId: null, note: LOADER_NOTE + ruleFor(words, n) });
  bump(`mappings ${sourceKind} ${result}`);
}

async function main() {
  log(`# loadCuppingEvidence2 → ${dbName}`);
  // Preconditions (Task 0 shapes)
  for (const [k, r] of Object.entries(ROASTERS)) {
    const basics = await getRoasterBasics(r.id);
    if (!basics || basics.name !== r.name || !basics.isActive) throw new Error(`roaster ${k} ${r.id} missing, renamed or inactive`);
  }
  const cupperRows = await cs.listCuppers();
  const cupperId = (name: string) => { const c = cupperRows.find(x => x.name === name); if (!c) throw new Error(`cupper ${name} missing`); return c.id as number; };
  const fruity1 = (await getSlots('fruity')).find(s => s.sort_order === 1);
  if (!fruity1) throw new Error('slot fruity/1 missing');

  // 1. Decision 6: cupper word mappings, before any score
  for (const [words, name, tier] of CUPPER_MAPPINGS) await ensureMapping(words, node(name, tier), 'cupper');
  const cupperMaps = await listMappings({ sourceKind: 'cupper' });
  /** the loader refuses a generic (tier 1/2) node no word of the row names or maps to */
  function assertConvention(n: Node, words: string[], where: string) {
    if (n.tier === 3) return;
    const ok = words.some(w => {
      const k = normalizeWords(w);
      if (k === n.descriptor.toLowerCase() || new RegExp(`\\b${n.descriptor.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(k)) return true;
      return cupperMaps.some(m => m.cuppingNoteId === n.id && new RegExp(`(^|[^a-z])${m.normalizedWords.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(k));
    });
    if (!ok) throw new Error(`${where}: '${words.join(', ')}' → ${n.descriptor} (tier ${n.tier}) has no cupper mapping; refusing`);
  }

  // 2. Session headers
  const sessionIds: Record<string, number> = {};
  const existing = await cr.listSessions();
  for (const s of SESSIONS) {
    const h = { ...s.header, transcribedBy: TRANSCRIBED_BY, checkedBy: CHECKED_BY, brewDefaults: BREW };
    if (s.existingSessionId) {
      const cur = existing.find(x => x.id === s.existingSessionId);
      if (!cur) throw new Error(`session ${s.existingSessionId} missing`);
      sessionIds[s.key] = cur.id;
      if (cur.record_source === h.recordSource) { log(`session ${s.key} (${cur.id}): already loaded`); continue; }
      await cs.updateSessionHeader(cur.id, h);
      bump('sessions updated'); log(`session ${s.key} (${cur.id}): header updated`);
      continue;
    }
    const found = existing.find(x => x.record_source === h.recordSource);
    if (found) { sessionIds[s.key] = found.id; log(`session ${s.key} (${found.id}): already loaded`); continue; }
    sessionIds[s.key] = await cs.createSession(h);
    bump('sessions created'); log(`session ${s.key}: created ${sessionIds[s.key]}`);
  }

  // 3. Manifests (Part A): dry run, then apply; existing coffees are skipped
  const here = fileURLToPath(new URL('../manifests/', import.meta.url));
  for (const m of MANIFESTS) {
    const manifest = JSON.parse(readFileSync(here + m.file, 'utf8'));
    for (const c of manifest.coffees) {
      const sid = sessionIds[m.sessionOf(c.name)];
      c.match.notes = c.match.notes.replace('s<id>', `s${sid}`);
      c.match.sessionId = sid;
    }
    const dry = await importCatalog(manifest, { dryRun: true, actor: ACTOR, mode: 'skip_existing' });
    const errs = dry.coffees.filter(c => c.status === 'error');
    if (errs.length) throw new Error(`${m.file} dry run: ${JSON.stringify(errs)}`);
    if (dry.integrity && !dry.integrity.allPass) throw new Error(`${m.file} dry run: integrity not allPass`);
    if (dry.coffees.every(c => c.status === 'skipped')) { log(`manifest ${m.file}: already loaded`); continue; }
    const applied = await importCatalog(manifest, { dryRun: false, actor: ACTOR, mode: 'skip_existing' });
    for (const c of applied.coffees) {
      if (c.status === 'created') bump('coffees created');
      if (c.warnings.length) log(`  import warning ${c.name}: ${JSON.stringify(c.warnings)}`);
    }
    log(`manifest ${m.file}: ${applied.coffees.map(c => `${c.name}=${c.status}${c.coffeeId ? `#${c.coffeeId}` : ''}`).join('; ')}; integrity allPass=${applied.integrity?.allPass}`);
  }

  // Coffee ids by roaster + name (the catalog's own read)
  const coffeeIds: Record<string, number> = {};
  for (const [k, r] of Object.entries(ROASTERS)) {
    for (const c of await listCatalogCoffeesForRoaster(r.id)) if (c.isActive) coffeeIds[`${k}|${c.name}`] = c.id;
  }
  const coffeeOf = (roaster: RoasterKey, name: string) => {
    const id = coffeeIds[`${roaster}|${name}`];
    if (!id) throw new Error(`catalog coffee ${roaster} / ${name} not found`);
    return id;
  };

  // 4. Lineup links (A4)
  const lineups: Record<string, Awaited<ReturnType<typeof getLineup>>> = {};
  for (const [k, r] of Object.entries(ROASTERS)) lineups[k] = await getLineup(r.id);
  const lineupOf = (roaster: RoasterKey, name: string) => {
    const row = lineups[roaster].find(l => l.name === name);
    if (!row) throw new Error(`lineup row ${roaster} / ${name} not found`);
    return row;
  };
  const cupped = SESSIONS.flatMap(s => s.samples.map(x => [s.roaster, x.coffee] as const));
  for (const [roaster, name] of cupped) {
    const row = lineupOf(roaster, name);
    const coffeeId = coffeeOf(roaster, name);
    if (row.coffeeId === coffeeId) { bump('lineup links already'); continue; }
    if (row.coffeeId !== null) throw new Error(`lineup ${name} is linked to ${row.coffeeId}, not ${coffeeId}`);
    await linkLineupCoffeeToCatalog({ roasterId: ROASTERS[roaster].id, portalCoffeeId: row.portalCoffeeId, coffeeId });
    bump('lineup links made');
  }

  // 5. Samples, 6. cupper rows, 7. merges
  const sampleIds: Record<string, number> = {};
  for (const s of SESSIONS) {
    const sid = sessionIds[s.key];
    const scs = await cr.listSessionCoffees(sid);
    for (const x of s.samples) {
      const coffeeId = coffeeOf(s.roaster, x.coffee);
      let sc = scs.find(r => r.coffee_id === coffeeId);
      if (!sc) {
        const id = await cs.addSessionCoffee(sid, coffeeId, { displayOrder: x.order, blindCode: x.blindCode ?? null, sampleNote: x.sampleNote ?? null });
        bump('session coffees created');
        sc = { session_coffee_id: id, brew_params_id: 1 };
      } else if (!sc.brew_params_id) {
        await cs.saveBrewParams(sc.session_coffee_id, BREW); // flight C's hand-entered sample: its first brew row
        bump('brew params added');
      }
      sampleIds[`${s.key}|${x.coffee}`] = sc.session_coffee_id;
    }
  }
  const mergedThisRun = new Set<number>();
  for (const s of SESSIONS) {
    for (const x of s.samples) {
      const scId = sampleIds[`${s.key}|${x.coffee}`];
      const where = `${s.key} ${x.coffee}`;
      let wrote = false;
      for (const r of x.rows) {
        const cur = (await cr.getScoresForSessionCoffee(scId)).scores.find(h => !h.is_merged && h.cupper_id === cupperId(r.cupper));
        if (cur && cur.scale_code !== 'legacy') { bump('cupper rows already'); continue; }
        const descriptors = r.descriptors.map(([name, words]) => {
          const nd = node(name);
          assertConvention(nd, words, `${where} ${r.cupper}`);
          return { cuppingNoteId: nd.id, customNotes: words.join(', ') };
        });
        await cs.saveCupperScore({
          sessionCoffeeId: scId, cupperId: cupperId(r.cupper), scaleCode: r.scale,
          archetypeCall: r.a ?? null, archetypeCallSecondary: r.a2 ?? null, positionCall: r.pos ?? null,
          slotCallId: r.slot ? fruity1.id : null, callNote: r.note ?? null, overallNotes: r.overall ?? null,
          values: r.values.map(v => ({ dimensionId: v.d, valueMin: v.min ?? null, valueMax: v.max ?? null, rawValue: v.raw ?? null, notes: v.notes ?? null })),
          descriptors,
          supersedeReason: cur ? r.supersedeReason : undefined,
        });
        if (cur && !r.supersedeReason) throw new Error(`${where}: superseding a legacy row needs a reason`);
        bump(`cupper rows ${r.scale}`); wrote = true;
      }
      const hasMerged = (await cr.getScoresForSessionCoffee(scId)).scores.some(h => h.is_merged);
      if (hasMerged && !wrote) { bump('merges already'); continue; }
      const m = await cs.mergeByRule(scId, { n: 2 });
      bump('merges'); mergedThisRun.add(m.coffeeId);
      log(`merge ${where}: s${sessionIds[s.key]} sc${scId} merged#${m.mergedScoreId} disagreements=[${m.union.disagreements.join(', ')}] call=${m.union.archetypeCall ?? 'null'} ab=${m.union.allAbScale}`);
    }
  }
  // Decision 16's explicit refresh: mergeByRule already refreshed every
  // coffee merged in this run, after the manifest; a loaded coffee whose
  // merge did not run now (none on a full run) is refreshed here.
  for (const [roaster, name] of cupped) {
    const id = coffeeOf(roaster, name);
    if (!mergedThisRun.has(id) && counts['merges']) { await cs.refreshDialSignal(id); bump('signal refreshes'); }
  }

  // 8. Remarks + roaster mappings (B6, D6, D7, D8)
  const remarkGroups: Array<[string, RemarkSpec[]]> = [['B6', B6], ['D6', D6], ['D7', D7], ['D8', D8]];
  // The same roaster words must map to one node across all three websites,
  // or a re-run would supersede back and forth.
  const wordNode = new Map<string, string>();
  for (const r of [...D6, ...D7, ...D8]) {
    if (!r.mapWords || !r.node) continue;
    const k = normalizeWords(r.remark), v = `${r.node}/${r.nodeTier ?? ''}`;
    if (wordNode.has(k) && wordNode.get(k) !== v) throw new Error(`roaster words '${k}' map to both ${wordNode.get(k)} and ${v}`);
    wordNode.set(k, v);
  }
  const ymd = (d: unknown) => d instanceof Date
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : String(d).slice(0, 10);
  for (const [label, specs] of remarkGroups) {
    const byRoaster = new Map<RoasterKey, Awaited<ReturnType<typeof listRemarks>>>();
    const batch = [] as Parameters<typeof recordRemarks>[0];
    for (const r of specs) {
      if (!byRoaster.has(r.roaster)) byRoaster.set(r.roaster, await listRemarks({ roasterId: ROASTERS[r.roaster].id, currentOnly: false }));
      const coffeeId = r.coffee ? coffeeOf(r.roaster, r.coffee) : null;
      const nd = r.node ? node(r.node, r.nodeTier) : null;
      if (nd && r.mapWords) await ensureMapping(r.remark, nd, 'roaster');
      const dup = byRoaster.get(r.roaster)!.some(x => x.coffee_id === coffeeId && ymd(x.said_on) === r.saidOn
        && x.channel === r.channel && x.remark === r.remark);
      if (dup) { bump(`remarks ${label} already`); continue; }
      batch.push({
        roasterId: ROASTERS[r.roaster].id, coffeeId, portalCoffeeId: r.coffee ? lineupOf(r.roaster, r.coffee).portalCoffeeId : null,
        cuppingSessionCoffeeId: r.sessionKey && r.coffee ? sampleIds[`${r.sessionKey}|${r.coffee}`] : null,
        saidBy: r.saidBy, saidOn: r.saidOn, channel: r.channel as never, topic: r.topic as never, remark: r.remark,
        cuppingNoteId: nd?.id ?? null, proposedArchetype: r.proposedArchetype ?? null,
        recordedBy: r.recordedBy, recordSource: r.recordSource,
      });
    }
    if (batch.length) { await recordRemarks(batch, { actor: ACTOR }); bump(`remarks ${label}`, batch.length); }
  }

  // 9. A3b (Dana, 2026-10-18): a 12 oz retail price of $29 on the three
  // slots the placed Joe Coffee coffees sit in. A slot that already has a
  // 12 oz price is left alone and reported.
  for (const [archetype, sortOrder] of SLOT_PRICES_A3B) {
    const slot = (await getSlots(archetype)).find(s => s.sort_order === sortOrder);
    if (!slot) throw new Error(`slot ${archetype}/${sortOrder} missing`);
    const cur = (await getSlotPrices([slot.id])).find(p => p.weight_oz === 12);
    if (cur) {
      log(`slot price ${archetype}/${sortOrder}: already has 12 oz at ${cur.retail_price_cents} cents${cur.retail_price_cents === SLOT_PRICE_CENTS ? ' (already loaded)' : ', left alone'}`);
      bump(`slot prices left alone${cur.retail_price_cents === SLOT_PRICE_CENTS ? ' (already loaded)' : ' (other price)'}`);
      continue;
    }
    await setSlotPrice({ slotId: slot.id, weightOz: 12, retailPriceCents: SLOT_PRICE_CENTS }, { actor: ACTOR });
    bump('slot prices set'); log(`slot price ${archetype}/${sortOrder} (slot ${slot.id}): 12 oz set to ${SLOT_PRICE_CENTS} cents`);
  }

  log('\n# counts this run');
  for (const [k, v] of Object.entries(counts).sort()) log(`  ${k}: ${v}`);
  log(`\n# session ids ${JSON.stringify(sessionIds)}`);
}

try {
  await main();
} finally {
  await db.end();
}
