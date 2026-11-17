// Ella's Bloom Map 6 (2026-11-16), Part B: bring the five lineup coffees that
// have no catalog coffee into the catalog through the one door,
// roasteryPortalService.acceptResponse (here its in-transaction form). It
// writes no family, slot, SKU or price; family, lean and ring come from the
// brief 5 seed, run after this one, unchanged.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_6_FIVE_COFFEES.md
//
//   DATABASE_URL=<url> npx tsx src/scripts/ellaMapFiveCoffees_2026_11_16.ts [--dry-run | --apply] [--expect-db <name>]
//
// Per coffee (Dana 2026-11-16, CLOSING_REPORT_6.md): the latest submitted
// response; every basic the roaster filled in (origin, process, roast level,
// blend or single, caffeine), as stated; the one note with the wheel term Dana
// approved (the roaster's own pick for four, Chocolate for Great Heights),
// remember false; recorded under Dana's admin profile (Dana-Admin).
// Idempotent: a lineup coffee already linked to a catalog coffee is skipped and
// reported, never accepted twice. --dry-run (default) writes nothing.
//
// SAFETY: refuses unless the connected database is exactly --expect-db
// (default axisandbloom_test), checked before connecting and after.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { Tx } from '../db/client.js';
import { getLineup, getCurrentResponse } from '../services/roasteryPortalReads.js';

export const ACTOR_PROFILE_NAME = 'Dana-Admin';

/** The approved term per note rank: 'roaster_pick' (the roaster's own term, which must be the expected one) or a named wheel term. */
export interface ApprovedNote { rank: number; term: 'roaster_pick' | { descriptor: string; wheelCategory: string }; expect: { descriptor: string; wheelCategory: string } }
export interface FiveItem { key: string; roaster: string; lineupName: string; notes: ApprovedNote[] }

const JOE_COFFEE = 'Joe Coffee Company';
const JOE_BEAN = 'Joe Bean Roasters';
const CHOCOLATE = { descriptor: 'Chocolate', wheelCategory: 'Nutty / Cocoa' };

/** Dana 2026-11-16: the note table as approved. */
export const FIVE: FiveItem[] = [
  { key: 'Half Moon',     roaster: JOE_COFFEE, lineupName: 'Half Moon (Half Caff)', notes: [{ rank: 1, term: 'roaster_pick', expect: { descriptor: 'Vanilla', wheelCategory: 'Sweet' } }] },
  { key: 'Great Heights', roaster: JOE_COFFEE, lineupName: 'Great Heights',         notes: [{ rank: 1, term: CHOCOLATE, expect: CHOCOLATE }] },
  { key: 'Brazil',        roaster: JOE_BEAN,   lineupName: 'Brazil',                notes: [{ rank: 1, term: 'roaster_pick', expect: CHOCOLATE }] },
  { key: 'Indonesia',     roaster: JOE_BEAN,   lineupName: 'Indonesia',             notes: [{ rank: 1, term: 'roaster_pick', expect: { descriptor: 'Dark Chocolate', wheelCategory: 'Nutty / Cocoa' } }] },
  { key: 'D.R. Congo',    roaster: JOE_BEAN,   lineupName: 'D.R. Congo',            notes: [{ rank: 1, term: 'roaster_pick', expect: { descriptor: 'Orange', wheelCategory: 'Fruity' } }] },
];

export interface FivePlanRow {
  key: string; action: 'accept' | 'skip'; why?: string;
  portalCoffeeId: string; responseId: string | null; version: number | null; submittedAt: string | null;
  basics: { origin: string | null; process: string | null; roastLevel: string | null; blendOrSingle: string | null; caffeine: string | null };
  notes: Array<{ rank: number; words: string; cuppingNoteId: string; descriptor: string; wheelCategory: string; source: string }>;
  leftOut: Array<{ rank: number; words: string }>;
  linkedCoffeeId: number | null;
}

async function roasterId(tx: Tx, name: string): Promise<string> {
  const r = await tx.query<{ id: string }>(`SELECT id FROM roaster WHERE name = $1 AND is_active`, [name]);
  if (r.rows.length !== 1) throw new Error(`${name}: ${r.rows.length} active roasters with that name; expected one`);
  return r.rows[0].id;
}

async function wheelTerm(tx: Tx, t: { descriptor: string; wheelCategory: string }): Promise<string> {
  const r = await tx.query<{ id: string }>(
    `SELECT id FROM cupping_note WHERE descriptor = $1 AND wheel_category = $2 AND is_active AND wheel_category <> 'Other'`,
    [t.descriptor, t.wheelCategory]);
  if (r.rows.length !== 1) throw new Error(`wheel term ${t.descriptor} (${t.wheelCategory}): ${r.rows.length} active matches; expected one`);
  return r.rows[0].id;
}

/** The admin profile the acceptances are recorded under (Dana 2026-11-16): exactly one admin named Dana-Admin. */
export async function resolveActorUid(tx: Tx): Promise<string> {
  const r = await tx.query<{ firebase_uid: string }>(
    `SELECT up.firebase_uid FROM user_profile up JOIN user_type ut ON ut.id = up.user_type_id
      WHERE ut.name = 'admin' AND up.first_name = $1 AND up.firebase_uid IS NOT NULL`, [ACTOR_PROFILE_NAME]);
  if (r.rows.length !== 1) throw new Error(`${r.rows.length} admin profiles named ${ACTOR_PROFILE_NAME}; expected one`);
  return r.rows[0].firebase_uid;
}

/** Read-only: what --apply would accept. Throws when the data no longer matches what Dana approved. */
export async function planFiveCoffees(tx: Tx, items: FiveItem[] = FIVE): Promise<FivePlanRow[]> {
  const out: FivePlanRow[] = [];
  for (const it of items) {
    const lineup = (await getLineup(await roasterId(tx, it.roaster), {}, tx)).filter(l => l.name === it.lineupName);
    if (lineup.length !== 1) throw new Error(`${it.key}: ${lineup.length} active lineup coffees named "${it.lineupName}" at ${it.roaster}; expected one`);
    const l = lineup[0];
    const empty = { origin: null, process: null, roastLevel: null, blendOrSingle: null, caffeine: null };
    if (l.coffeeId !== null) {
      out.push({ key: it.key, action: 'skip', why: `already linked to catalog coffee ${l.coffeeId}`, portalCoffeeId: l.portalCoffeeId,
        responseId: null, version: null, submittedAt: null, basics: empty, notes: [], leftOut: [], linkedCoffeeId: l.coffeeId });
      continue;
    }
    const resp = await getCurrentResponse(l.portalCoffeeId, tx);
    if (!resp || resp.status !== 'submitted') throw new Error(`${it.key}: the current response is ${resp ? 'an open draft' : 'missing'}; a submitted one is needed`);
    const caffeine = resp.caffeineLevel;
    const notes: FivePlanRow['notes'] = [];
    for (const a of it.notes) {
      const n = resp.notes.find(x => x.rank === a.rank);
      if (!n) throw new Error(`${it.key}: the response has no note ${a.rank}`);
      let id: string;
      if (a.term === 'roaster_pick') {
        if (!n.cuppingNoteId || n.descriptor !== a.expect.descriptor || n.wheelCategory !== a.expect.wheelCategory) {
          throw new Error(`${it.key}: the roaster's pick is ${n.descriptor ?? 'none'} (${n.wheelCategory ?? '-'}), not the approved ${a.expect.descriptor}`);
        }
        id = n.cuppingNoteId;
      } else {
        id = await wheelTerm(tx, a.term);
      }
      notes.push({ rank: n.rank, words: n.roasterWords, cuppingNoteId: id, descriptor: a.expect.descriptor, wheelCategory: a.expect.wheelCategory,
        source: a.term === 'roaster_pick' ? 'roaster pick' : 'approved by Dana' });
    }
    const leftOut = resp.notes.filter(n => !it.notes.some(a => a.rank === n.rank)).map(n => ({ rank: n.rank, words: n.roasterWords }));
    out.push({
      key: it.key, action: 'accept', portalCoffeeId: l.portalCoffeeId, responseId: resp.id, version: resp.version, submittedAt: resp.submittedAt,
      basics: { origin: resp.origin, process: resp.processValues[0] ?? null, roastLevel: resp.roastLevel, blendOrSingle: resp.blendOrSingle, caffeine },
      notes, leftOut, linkedCoffeeId: null,
    });
  }
  return out;
}

export interface FiveApplyResult { plan: FivePlanRow[]; accepted: Array<{ key: string; coffeeId: number; acceptanceId: string; createdCoffee: boolean }> }

/** --apply, inside the caller's transaction: one acceptResponseInTx per 'accept' row. */
export async function applyFiveCoffees(tx: Tx, actorUid: string, items: FiveItem[] = FIVE): Promise<FiveApplyResult> {
  const { acceptResponseInTx } = await import('../services/roasteryPortalService.js');
  const plan = await planFiveCoffees(tx, items);
  const accepted: FiveApplyResult['accepted'] = [];
  for (const p of plan) {
    if (p.action !== 'accept') continue;
    const r = await acceptResponseInTx(tx, {
      responseId: p.responseId!,
      actorUid,
      items: {
        // every basic the roaster filled in, as stated (acceptance applies only a non-empty value)
        basics: { origin: { include: true }, process: { include: true }, roastLevel: { include: true }, blendOrSingle: { include: true }, caffeine: { include: true } },
        notes: p.notes.map(n => ({ rank: n.rank, include: true, cuppingNoteId: n.cuppingNoteId, remember: false })),
      },
    });
    accepted.push({ key: p.key, coffeeId: r.coffeeId, acceptanceId: r.acceptanceId, createdCoffee: r.createdCoffee });
  }
  return { plan, accepted };
}

export function formatFivePlan(plan: FivePlanRow[]): string {
  const cell = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|');
  const day = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : '');
  const out = [
    `Plan: ${plan.filter(p => p.action === 'accept').length} accept, ${plan.filter(p => p.action === 'skip').length} skipped.`, '',
    '| coffee | action | response (version, submitted) | origin | process | roast | blend or single | caffeine | note | wheel term |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const p of plan) {
    if (p.action === 'skip') { out.push(`| ${p.key} | skip (${p.why}) | | | | | | | | |`); continue; }
    const b = p.basics;
    const note = p.notes.map(n => `${n.rank}: ${n.words}`).join('; ');
    const term = p.notes.map(n => `${n.descriptor} (${n.wheelCategory}; ${n.source}; remember false)`).join('; ');
    out.push(`| ${p.key} | accept | ${p.responseId} (v${p.version}, ${day(p.submittedAt)}) | ${cell(b.origin)} | ${cell(b.process)} | ${cell(b.roastLevel)} | ${cell(b.blendOrSingle)} | ${cell(b.caffeine)} | ${cell(note)} | ${cell(term)} |`);
    for (const lo of p.leftOut) out.push(`| ${p.key} | note ${lo.rank} left out | | | | | | | ${lo.words} | not approved |`);
  }
  return out.join('\n');
}

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  if (apply && argv.includes('--dry-run')) throw new Error('pass --dry-run or --apply, not both');
  const i = argv.indexOf('--expect-db');
  return { apply, expectDb: i >= 0 ? argv[i + 1] : 'axisandbloom_test' };
}

async function main() {
  const { apply, expectDb } = parseArgs(process.argv.slice(2));
  const urlDb = (process.env.DATABASE_URL ?? '').split('?')[0].split('/').pop() ?? '';
  if (urlDb !== expectDb) {
    console.error(`REFUSING: DATABASE_URL points at '${urlDb || '(unset)'}', expected '${expectDb}'. Nothing was connected to.`);
    process.exit(2);
  }
  const { db, withTransaction } = await import('../db/client.js');
  const cur = (await db.query<{ d: string }>(`SELECT current_database() AS d`)).rows[0].d;
  if (cur !== expectDb) { console.error(`REFUSING: connected to '${cur}', expected '${expectDb}'. Nothing was written.`); process.exit(2); }
  try {
    if (!apply) {
      const client = await db.connect();
      try {
        await client.query('BEGIN READ ONLY');
        const actor = await resolveActorUid(client as unknown as Tx);
        console.log(`# Ella map 6, five coffees, DRY RUN on ${cur} (${new Date().toISOString()}); actor: the ${ACTOR_PROFILE_NAME} profile (${actor.slice(0, 6)}…)\n`);
        console.log(formatFivePlan(await planFiveCoffees(client as unknown as Tx)));
      } finally { await client.query('ROLLBACK'); client.release(); }
      return;
    }
    const result = await withTransaction(async tx => applyFiveCoffees(tx, await resolveActorUid(tx)));
    console.log(`# Ella map 6, five coffees, APPLIED on ${cur} (${new Date().toISOString()}): ${result.accepted.length} accepted\n`);
    console.log(formatFivePlan(result.plan));
    console.log('');
    for (const a of result.accepted) console.log(`- ${a.key}: coffee ${a.coffeeId}, created ${a.createdCoffee}, acceptance ${a.acceptanceId}`);
  } finally {
    await db.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
