// Roastery Portal (2026-10-05) — the ONLY writer of roastery_portal_* tables.
// Every verb runs in withTransaction. Reads live in roasteryPortalReads.ts
// (views as the read path). This file only ever SELECTs from the catalog
// (coffees, cupping_note, lookup_value, ...) — it never writes one; lint:roastery-portal
// fails the deploy if that ever changes.
//
// Nothing is ever deleted: a lineup coffee is deactivated, a link revoked, a
// submitted response kept as its own version (and made immutable by trigger).
//
// Brief: backend/src/features/roastery_portal/CLAUDE_CODE_PROMPT_ROASTERY_PORTAL_1.md

import { randomBytes } from 'node:crypto';
import { withTransaction, type Tx } from '../db/client.js';
import { getVocabulary, getRespondent, normalizeWords, getMappingSuggestions, type PortalVocabulary } from './roasteryPortalReads.js';
import { getCoffee as getCatalogCoffee } from './catalogReads.js';
import {
  createCoffeeInTx, updateCoffeeInTx, setRoasterDescriptorsInTx, snapshotRow, logCatalogChange, scopedIntegrity,
  type UpdateCoffeeInput,
} from './catalogService.js';

// ── Errors ───────────────────────────────────────────────────────────────────
export type PortalErrorCode =
  | 'not_found'        // also the answer for "belongs to another roastery"
  | 'validation'
  | 'duplicate_name'
  | 'no_draft'
  | 'wrong_roastery';

export class PortalError extends Error {
  constructor(public code: PortalErrorCode, message: string, public status: number) {
    super(message);
    this.name = 'PortalError';
  }
}
const notFound = (what: string) => new PortalError('not_found', `${what} not found`, 404);
const invalid = (message: string) => new PortalError('validation', message, 400);

// ── Caps (brief B3: names 120, short 300, long 2000, notes 15) ───────────────
export const LIMITS = { name: 120, short: 300, long: 2000, notes: 15, email: 254 } as const;

function text(value: unknown, max: number, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw invalid(`${field} must be text`);
  const t = value.trim();
  if (t === '') return null;
  if (t.length > max) throw invalid(`${field} is too long (max ${max} characters)`);
  return t;
}

function requiredText(value: unknown, max: number, field: string): string {
  const t = text(value, max, field);
  if (!t) throw invalid(`${field} is required`);
  return t;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}

// ── Links ────────────────────────────────────────────────────────────────────
export interface CreatedLink { id: string; roasterId: string; token: string; contactName: string | null; contactEmail: string | null }

/** An unguessable, url-safe token: 32 random bytes = 43 base64url characters. */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createLink(input: {
  roasterId: string; contactName?: unknown; contactEmail?: unknown; adminFirebaseUid: string;
}): Promise<CreatedLink> {
  const contactName = text(input.contactName, LIMITS.name, 'contact name');
  const contactEmailRaw = text(input.contactEmail, LIMITS.email, 'contact email');
  if (contactEmailRaw && !EMAIL_RE.test(contactEmailRaw)) throw invalid('contact email is not a valid address');
  const contactEmail = contactEmailRaw ? contactEmailRaw.toLowerCase() : null;

  return withTransaction(async tx => {
    const roaster = await tx.query(`SELECT id FROM roaster WHERE id = $1`, [input.roasterId]);
    if (!roaster.rows[0]) throw notFound('roastery');
    const admin = await tx.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [input.adminFirebaseUid]);
    const r = await tx.query(
      `INSERT INTO roastery_portal_link (roaster_id, token, contact_name, contact_email, created_by_admin_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, roaster_id, token, contact_name, contact_email`,
      [input.roasterId, newToken(), contactName, contactEmail, admin.rows[0]?.id ?? null]
    );
    const row = r.rows[0];
    return { id: row.id, roasterId: row.roaster_id, token: row.token, contactName: row.contact_name, contactEmail: row.contact_email };
  });
}

export async function revokeLink(linkId: string): Promise<{ revoked: boolean }> {
  return withTransaction(async tx => {
    const exists = await tx.query(`SELECT id FROM roastery_portal_link WHERE id = $1`, [linkId]);
    if (!exists.rows[0]) throw notFound('link');
    const r = await tx.query(
      `UPDATE roastery_portal_link SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
      [linkId]
    );
    return { revoked: (r.rowCount ?? 0) > 0 };
  });
}

/** Stamps last_opened_at, at most once a minute per link (a page load fires
 * several reads; one stamp is enough). */
export async function touchLink(linkId: string): Promise<void> {
  await withTransaction(async tx => {
    await tx.query(
      `UPDATE roastery_portal_link SET last_opened_at = now()
       WHERE id = $1 AND (last_opened_at IS NULL OR last_opened_at < now() - interval '1 minute')`,
      [linkId]
    );
  });
}

// ── Respondents ──────────────────────────────────────────────────────────────
export async function upsertRespondent(input: {
  roasterId: string; linkId: string; name: unknown; email: unknown;
}): Promise<{ id: string; name: string; email: string }> {
  const name = requiredText(input.name, LIMITS.name, 'name');
  const emailRaw = requiredText(input.email, LIMITS.email, 'email');
  if (!EMAIL_RE.test(emailRaw)) throw invalid('email is not a valid address');
  const email = emailRaw.toLowerCase();
  return withTransaction(async tx => {
    // First name wins: an existing (roastery, email) keeps the name it was
    // first recorded under, so earlier stamps never silently change.
    await tx.query(
      `INSERT INTO roastery_portal_respondent (roaster_id, link_id, name, email)
       VALUES ($1, $2, $3, $4) ON CONFLICT (roaster_id, email) DO NOTHING`,
      [input.roasterId, input.linkId, name, email]
    );
    const r = await tx.query(
      `SELECT id, name, email FROM roastery_portal_respondent WHERE roaster_id = $1 AND email = $2`,
      [input.roasterId, email]
    );
    return r.rows[0];
  });
}

async function requireRespondent(tx: Tx, roasterId: string, respondentId: unknown) {
  if (typeof respondentId !== 'string') throw invalid('respondent is required');
  const r = await getRespondent(roasterId, respondentId, tx);
  if (!r) throw invalid('respondent is not recognised for this roastery');
  return r;
}

// ── Lineup coffees ───────────────────────────────────────────────────────────
export interface LineupCoffeeInput {
  name?: unknown;
  origin?: unknown;
  processValues?: unknown;
  roastLevel?: unknown;
  blendOrSingle?: unknown;
  isDecaf?: unknown;
  prefillSource?: unknown;
}

function lookupValues(opts: { value: string; label: string }[]): Set<string> {
  return new Set(opts.map(o => o.value));
}

interface NormalizedPrefill {
  origin: string | null;
  processValues: string[];
  roastLevel: string | null;
  blendOrSingle: string | null;
  isDecaf: boolean | null;
  prefillSource: 'roaster_site' | 'catalog' | null;
}

function normalizePrefill(input: LineupCoffeeInput, vocab: PortalVocabulary): NormalizedPrefill {
  const origin = text(input.origin, LIMITS.short, 'origin');
  let processValues: string[] = [];
  if (input.processValues !== undefined && input.processValues !== null) {
    if (!Array.isArray(input.processValues)) throw invalid('process must be a list');
    const allowed = lookupValues(vocab.process);
    processValues = [...new Set(input.processValues.map(v => String(v)))];
    for (const v of processValues) if (!allowed.has(v)) throw invalid(`unknown process value "${v}"`);
  }
  const roastLevel = text(input.roastLevel, LIMITS.name, 'roast level');
  if (roastLevel && !lookupValues(vocab.roastLevel).has(roastLevel)) throw invalid(`unknown roast level "${roastLevel}"`);
  const blendOrSingle = text(input.blendOrSingle, LIMITS.name, 'blend or single');
  if (blendOrSingle && !lookupValues(vocab.blendOrSingle).has(blendOrSingle)) throw invalid(`unknown blend or single "${blendOrSingle}"`);
  let isDecaf: boolean | null = null;
  if (input.isDecaf !== undefined && input.isDecaf !== null) {
    if (typeof input.isDecaf !== 'boolean') throw invalid('decaf must be true or false');
    isDecaf = input.isDecaf;
  }
  let prefillSource: NormalizedPrefill['prefillSource'] = null;
  if (input.prefillSource !== undefined && input.prefillSource !== null) {
    if (input.prefillSource !== 'roaster_site' && input.prefillSource !== 'catalog') throw invalid('unknown prefill source');
    prefillSource = input.prefillSource;
  }
  return { origin, processValues, roastLevel, blendOrSingle, isDecaf, prefillSource };
}

async function nextSortOrder(tx: Tx, roasterId: string): Promise<number> {
  const r = await tx.query(`SELECT COALESCE(max(sort_order), 0) + 1 AS n FROM roastery_portal_coffee WHERE roaster_id = $1`, [roasterId]);
  return r.rows[0].n;
}

export async function addLineupCoffee(input: LineupCoffeeInput & {
  roasterId: string; addedBy: 'admin' | 'roaster'; respondentId?: string | null;
}): Promise<{ id: string; name: string }> {
  const name = requiredText(input.name, LIMITS.name, 'name');
  return withTransaction(async tx => {
    const vocab = await getVocabulary({ fresh: true });
    const prefill = normalizePrefill(input, vocab);
    let respondentId: string | null = null;
    if (input.addedBy === 'roaster') {
      respondentId = (await requireRespondent(tx, input.roasterId, input.respondentId)).id;
    }
    const sortOrder = await nextSortOrder(tx, input.roasterId);
    try {
      const r = await tx.query(
        `INSERT INTO roastery_portal_coffee
           (roaster_id, name, origin, process_values, roast_level, blend_or_single, is_decaf,
            prefill_source, added_by, added_by_respondent_id, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, name`,
        [input.roasterId, name, prefill.origin, prefill.processValues, prefill.roastLevel, prefill.blendOrSingle,
         prefill.isDecaf, prefill.prefillSource, input.addedBy, respondentId, sortOrder]
      );
      return r.rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) throw new PortalError('duplicate_name', `"${name}" is already in this lineup`, 409);
      throw err;
    }
  });
}

/** Paste several names at once (one per line). Blank lines and names already
 * in the lineup (case-insensitive, active rows) are skipped, not errors. */
export async function bulkAddLineupCoffees(input: {
  roasterId: string; names: unknown; prefillSource?: unknown;
}): Promise<{ added: { id: string; name: string }[]; skipped: string[] }> {
  if (!Array.isArray(input.names)) throw invalid('names must be a list');
  if (input.names.length > 200) throw invalid('too many names at once (max 200)');
  const names = input.names.map(n => text(n, LIMITS.name, 'name')).filter((n): n is string => n !== null);
  return withTransaction(async tx => {
    const vocab = await getVocabulary({ fresh: true });
    const { prefillSource } = normalizePrefill({ prefillSource: input.prefillSource }, vocab);
    const existing = await tx.query(
      `SELECT lower(name) AS n FROM roastery_portal_coffee WHERE roaster_id = $1 AND is_active`,
      [input.roasterId]
    );
    const seen = new Set<string>(existing.rows.map((x: any) => x.n));
    let sortOrder = await nextSortOrder(tx, input.roasterId);
    const added: { id: string; name: string }[] = [];
    const skipped: string[] = [];
    for (const name of names) {
      const key = name.toLowerCase();
      if (seen.has(key)) { skipped.push(name); continue; }
      seen.add(key);
      const r = await tx.query(
        `INSERT INTO roastery_portal_coffee (roaster_id, name, prefill_source, added_by, sort_order)
         VALUES ($1, $2, $3, 'admin', $4) RETURNING id, name`,
        [input.roasterId, name, prefillSource, sortOrder++]
      );
      added.push(r.rows[0]);
    }
    return { added, skipped };
  });
}

async function lockLineupCoffee(tx: Tx, roasterId: string, portalCoffeeId: string, opts: { requireActive?: boolean } = {}) {
  const r = await tx.query(
    `SELECT id, roaster_id, name, coffee_id, is_active FROM roastery_portal_coffee WHERE id = $1 FOR UPDATE`,
    [portalCoffeeId]
  );
  const row = r.rows[0];
  // Another roastery's coffee is indistinguishable from a missing one.
  if (!row || row.roaster_id !== roasterId) throw notFound('coffee');
  if (opts.requireActive && !row.is_active) throw notFound('coffee');
  return row as { id: string; roaster_id: string; name: string; coffee_id: number | null; is_active: boolean };
}

export async function updateLineupCoffee(input: {
  roasterId: string; portalCoffeeId: string; patch: LineupCoffeeInput;
}): Promise<void> {
  return withTransaction(async tx => {
    await lockLineupCoffee(tx, input.roasterId, input.portalCoffeeId);
    const vocab = await getVocabulary({ fresh: true });
    const p = input.patch;
    const prefill = normalizePrefill(p, vocab);
    const sets: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => { values.push(value); sets.push(`${column} = $${values.length}`); };
    if ('name' in p) add('name', requiredText(p.name, LIMITS.name, 'name'));
    if ('origin' in p) add('origin', prefill.origin);
    if ('processValues' in p) add('process_values', prefill.processValues);
    if ('roastLevel' in p) add('roast_level', prefill.roastLevel);
    if ('blendOrSingle' in p) add('blend_or_single', prefill.blendOrSingle);
    if ('isDecaf' in p) add('is_decaf', prefill.isDecaf);
    if ('prefillSource' in p) add('prefill_source', prefill.prefillSource);
    if (sets.length === 0) return;
    values.push(input.portalCoffeeId);
    try {
      await tx.query(`UPDATE roastery_portal_coffee SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    } catch (err) {
      if (isUniqueViolation(err)) throw new PortalError('duplicate_name', 'another coffee in this lineup already has that name', 409);
      throw err;
    }
  });
}

/** Links a lineup coffee to a catalog coffee of the SAME roastery (or unlinks
 * it with null). Only reads the catalog; rejects a coffee that belongs to
 * another roastery. */
export async function linkLineupCoffeeToCatalog(input: {
  roasterId: string; portalCoffeeId: string; coffeeId: number | null;
}): Promise<void> {
  return withTransaction(async tx => {
    await lockLineupCoffee(tx, input.roasterId, input.portalCoffeeId);
    if (input.coffeeId !== null) {
      if (!Number.isInteger(input.coffeeId)) throw invalid('coffee id must be a whole number');
      const c = await tx.query(`SELECT roaster_id FROM coffees WHERE id = $1`, [input.coffeeId]);
      if (!c.rows[0]) throw notFound('catalog coffee');
      if (c.rows[0].roaster_id !== input.roasterId) {
        throw new PortalError('wrong_roastery', 'that catalog coffee belongs to a different roastery', 422);
      }
    }
    await tx.query(`UPDATE roastery_portal_coffee SET coffee_id = $1 WHERE id = $2`, [input.coffeeId, input.portalCoffeeId]);
  });
}

export async function deactivateLineupCoffee(input: { roasterId: string; portalCoffeeId: string }): Promise<void> {
  return withTransaction(async tx => {
    await lockLineupCoffee(tx, input.roasterId, input.portalCoffeeId);
    await tx.query(`UPDATE roastery_portal_coffee SET is_active = false WHERE id = $1`, [input.portalCoffeeId]);
  });
}

export async function reorderLineupCoffees(input: { roasterId: string; orderedIds: unknown }): Promise<void> {
  if (!Array.isArray(input.orderedIds) || input.orderedIds.some(i => typeof i !== 'string')) throw invalid('order must be a list of ids');
  const ids = input.orderedIds as string[];
  return withTransaction(async tx => {
    const owned = await tx.query(
      `SELECT id FROM roastery_portal_coffee WHERE roaster_id = $1 AND id = ANY($2::uuid[])`,
      [input.roasterId, ids]
    );
    if (owned.rows.length !== new Set(ids).size) throw notFound('coffee');
    for (let i = 0; i < ids.length; i++) {
      await tx.query(`UPDATE roastery_portal_coffee SET sort_order = $1 WHERE id = $2`, [i + 1, ids[i]]);
    }
  });
}

// ── A coffee's response: the document ───────────────────────────────────────
export interface ResponseDoc {
  origin: string | null;
  processValues: string[];
  roastLevel: string | null;
  blendOrSingle: string | null;
  // Part 3 (2026-10-06). All optional. is_decaf is DEPRECATED: nothing writes it any more
  // (caffeineLevel replaces it; v_roastery_portal_response derives an old answer's caffeine).
  additivesPresent: boolean | null;
  additivesDetail: string | null;
  roastIntent: string | null;
  blendComponents: string | null;
  blendRotation: string | null;
  caffeineLevel: string | null;
  decafProcess: string | null;
  certifications: string[];
  notes: { words: string; cuppingNoteId: string | null }[];
  proposedArchetype: string | null;
  dimensions: Record<string, number>;
  dominantDimensionId: number | null;
  bestBrew: string | null;
  alsoGoodBrews: string[];
  takesIt: string | null;
  brewNotes: string | null;
  availability: string | null;
  typicalNotice: string | null;
  expectedAvailability: string | null;
  similarWhenOut: string | null;
  closestCousinPortalCoffeeId: string | null;
  whatChanges: string | null;
  anythingElse: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

function oneOf(value: unknown, allowed: Set<string>, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !allowed.has(value)) throw invalid(`unknown ${field}`);
  return value;
}

/** Shape + vocabulary check for one full document. Every lookup value, wheel
 * pick, dimension and archetype must belong to the allowed vocabulary; the
 * cousin and the wheel picks are checked against the DB inside the same
 * transaction. Throws PortalError('validation') on the first problem. */
async function normalizeResponseDoc(
  tx: Tx, raw: any, ctx: { roasterId: string; portalCoffeeId: string }
): Promise<ResponseDoc> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('document must be an object');
  // The 60s-cached vocabulary: autosave fires about once a second, and a
  // lookup/wheel change taking up to a minute to reach validation is fine.
  const vocab = await getVocabulary();

  const prefill = normalizePrefill(
    { origin: raw.origin, processValues: raw.processValues, roastLevel: raw.roastLevel, blendOrSingle: raw.blendOrSingle },
    vocab
  );

  // Tasting notes: leading one first, capped. A note with a wheel pick but no
  // words is kept under the descriptor's own name; a note with neither is
  // dropped. A pick must be an active wheel descriptor (defects excluded).
  const rawNotes: unknown[] = raw.notes === undefined || raw.notes === null ? [] : raw.notes;
  if (!Array.isArray(rawNotes)) throw invalid('notes must be a list');
  if (rawNotes.length > LIMITS.notes) throw invalid(`at most ${LIMITS.notes} notes per coffee`);
  const wheelIds = new Set<string>();
  for (const cat of vocab.wheel) for (const sub of cat.subcategories) for (const d of sub.descriptors) wheelIds.add(d.id);
  const descriptorById = new Map<string, string>();
  for (const cat of vocab.wheel) for (const sub of cat.subcategories) for (const d of sub.descriptors) descriptorById.set(d.id, d.descriptor);
  const notes: ResponseDoc['notes'] = [];
  for (const n of rawNotes as any[]) {
    if (!n || typeof n !== 'object') throw invalid('each note must be an object');
    const words = text(n.words, LIMITS.short, 'tasting note');
    let cuppingNoteId: string | null = null;
    if (n.cuppingNoteId !== undefined && n.cuppingNoteId !== null && n.cuppingNoteId !== '') {
      if (!isUuid(n.cuppingNoteId) || !wheelIds.has(n.cuppingNoteId)) throw invalid('unknown flavor wheel term');
      cuppingNoteId = n.cuppingNoteId;
    }
    if (!words && !cuppingNoteId) continue;
    notes.push({ words: words ?? descriptorById.get(cuppingNoteId!)!, cuppingNoteId });
  }

  const archetypeCodes = new Set(vocab.archetypes.map(a => a.code));
  const proposedArchetype = oneOf(raw.proposedArchetype, archetypeCodes, 'family');

  const dimensionIds = new Set(vocab.dimensions.map(d => String(d.dimensionId)));
  const dimensions: Record<string, number> = {};
  if (raw.dimensions !== undefined && raw.dimensions !== null) {
    if (typeof raw.dimensions !== 'object' || Array.isArray(raw.dimensions)) throw invalid('dimensions must be an object');
    for (const [k, v] of Object.entries(raw.dimensions)) {
      if (!dimensionIds.has(k)) throw invalid('unknown dimension');
      if (v === null) continue; // unanswered scale
      if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 5) throw invalid('dimension values run from 1 to 5');
      dimensions[k] = v as number;
    }
  }
  let dominantDimensionId: number | null = null;
  if (raw.dominantDimensionId !== undefined && raw.dominantDimensionId !== null && raw.dominantDimensionId !== '') {
    if (!dimensionIds.has(String(raw.dominantDimensionId))) throw invalid('unknown dominant dimension');
    dominantDimensionId = Number(raw.dominantDimensionId);
  }

  const brewAllowed = lookupValues(vocab.brewMethods);
  const bestBrew = oneOf(raw.bestBrew, brewAllowed, 'brewing method');
  const alsoRaw: unknown[] = raw.alsoGoodBrews === undefined || raw.alsoGoodBrews === null ? [] : raw.alsoGoodBrews;
  if (!Array.isArray(alsoRaw)) throw invalid('also-good brewing methods must be a list');
  const alsoGoodBrews = [...new Set(alsoRaw.map(v => String(v)))];
  for (const v of alsoGoodBrews) if (!brewAllowed.has(v)) throw invalid('unknown brewing method');
  if (bestBrew && alsoGoodBrews.includes(bestBrew)) throw invalid('the best brewing method cannot also be listed as also good');

  let closestCousinPortalCoffeeId: string | null = null;
  if (raw.closestCousinPortalCoffeeId !== undefined && raw.closestCousinPortalCoffeeId !== null && raw.closestCousinPortalCoffeeId !== '') {
    if (!isUuid(raw.closestCousinPortalCoffeeId)) throw invalid('unknown closest cousin');
    if (raw.closestCousinPortalCoffeeId === ctx.portalCoffeeId) throw invalid('a coffee cannot be its own closest cousin');
    const c = await tx.query(
      `SELECT 1 FROM roastery_portal_coffee WHERE id = $1 AND roaster_id = $2 AND is_active`,
      [raw.closestCousinPortalCoffeeId, ctx.roasterId]
    );
    if (!c.rows[0]) throw invalid('unknown closest cousin');
    closestCousinPortalCoffeeId = raw.closestCousinPortalCoffeeId;
  }

  // ── part 3 answers: validate every value against its lookup category, THEN normalise ──
  let additivesPresent: boolean | null = null;
  if (raw.additivesPresent !== undefined && raw.additivesPresent !== null) {
    if (typeof raw.additivesPresent !== 'boolean') throw invalid('"anything added" must be yes or no');
    additivesPresent = raw.additivesPresent;
  }
  const additivesDetailRaw = text(raw.additivesDetail, LIMITS.short, 'what is added');
  const roastIntent = oneOf(raw.roastIntent, lookupValues(vocab.roastIntent), 'roasted for');
  const blendComponentsRaw = text(raw.blendComponents, LIMITS.short, 'blend components');
  const blendRotationRaw = oneOf(raw.blendRotation, lookupValues(vocab.blendRotation), 'recipe change answer');
  const caffeineLevel = oneOf(raw.caffeineLevel, lookupValues(vocab.caffeine), 'caffeine');
  const decafProcessRaw = oneOf(raw.decafProcess, lookupValues(vocab.decafProcess), 'decaf process');
  const certAllowed = lookupValues(vocab.certification);
  const certRaw: unknown[] = raw.certifications === undefined || raw.certifications === null ? [] : raw.certifications;
  if (!Array.isArray(certRaw)) throw invalid('certifications must be a list');
  let certifications = [...new Set(certRaw.map(v => String(v)))];
  for (const c of certifications) if (!certAllowed.has(c)) throw invalid('unknown certification');
  // The four normalisation rules (the form mirrors them, so nothing stale is ever kept):
  //  - "None" is a real answer and clears the others
  if (certifications.includes('none')) certifications = ['none'];
  //  - the decaf process only means something for Decaf or Half-caff
  const decafProcess = caffeineLevel === 'decaf' || caffeineLevel === 'half_caff' ? decafProcessRaw : null;
  //  - components and rotation only mean something for a blend
  const isBlend = prefill.blendOrSingle === 'blend';
  const blendComponents = isBlend ? blendComponentsRaw : null;
  const blendRotation = isBlend ? blendRotationRaw : null;
  //  - the detail only means something when something is added
  const additivesDetail = additivesPresent === true ? additivesDetailRaw : null;

  return {
    origin: prefill.origin,
    processValues: prefill.processValues,
    roastLevel: prefill.roastLevel,
    blendOrSingle: prefill.blendOrSingle,
    additivesPresent, additivesDetail, roastIntent, blendComponents, blendRotation, caffeineLevel, decafProcess, certifications,
    notes,
    proposedArchetype,
    dimensions,
    dominantDimensionId,
    bestBrew,
    alsoGoodBrews,
    takesIt: oneOf(raw.takesIt, lookupValues(vocab.takesIt), 'way of enjoying it'),
    brewNotes: text(raw.brewNotes, LIMITS.long, 'brewing notes'),
    availability: oneOf(raw.availability, lookupValues(vocab.availability), 'availability'),
    typicalNotice: oneOf(raw.typicalNotice, lookupValues(vocab.notice), 'typical notice'),
    expectedAvailability: text(raw.expectedAvailability, LIMITS.short, 'expected availability'),
    similarWhenOut: oneOf(raw.similarWhenOut, lookupValues(vocab.similar), 'similar profile answer'),
    closestCousinPortalCoffeeId,
    whatChanges: text(raw.whatChanges, LIMITS.short, 'what changes'),
    anythingElse: text(raw.anythingElse, LIMITS.long, 'anything else'),
  };
}

/** Exposed for tests: the same normalisation saveDraft applies. */
export async function validateResponseDoc(raw: unknown, ctx: { roasterId: string; portalCoffeeId: string }): Promise<ResponseDoc> {
  return withTransaction(tx => normalizeResponseDoc(tx, raw, ctx));
}

/** The open draft for a coffee, creating it (copying the latest submitted
 * version, if any) when none is open. The caller holds the coffee row lock,
 * so two devices can't both create one. */
async function openDraft(tx: Tx, portalCoffeeId: string): Promise<string> {
  const open = await tx.query(
    `SELECT id FROM roastery_portal_response WHERE portal_coffee_id = $1 AND status = 'draft'`,
    [portalCoffeeId]
  );
  if (open.rows[0]) return open.rows[0].id;

  // Read through the view: it carries the effective caffeine answer, so a reopened old response keeps its
  // caffeine even though is_decaf itself is never copied (nothing writes it any more).
  const latest = await tx.query(
    `SELECT * FROM v_roastery_portal_response WHERE portal_coffee_id = $1 ORDER BY version DESC LIMIT 1`,
    [portalCoffeeId]
  );
  const prev = latest.rows[0];
  const version = prev ? prev.version + 1 : 1;
  const created = await tx.query(
    `INSERT INTO roastery_portal_response
       (portal_coffee_id, version, status, origin, process_values, roast_level, blend_or_single,
        proposed_archetype, dominant_dimension_id, takes_it, brew_notes, availability, typical_notice,
        expected_availability, similar_when_out, closest_cousin_portal_coffee_id, what_changes, anything_else,
        additives_present, additives_detail, roast_intent, blend_components, blend_rotation, caffeine_level,
        decaf_process, certifications)
     VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
             $18, $19, $20, $21, $22, $23, $24, $25)
     RETURNING id`,
    [portalCoffeeId, version, prev?.origin ?? null, prev?.process_values ?? [], prev?.roast_level ?? null,
     prev?.blend_or_single ?? null, prev?.proposed_archetype ?? null,
     prev?.dominant_dimension_id ?? null, prev?.takes_it ?? null, prev?.brew_notes ?? null, prev?.availability ?? null,
     prev?.typical_notice ?? null, prev?.expected_availability ?? null, prev?.similar_when_out ?? null,
     prev?.closest_cousin_portal_coffee_id ?? null, prev?.what_changes ?? null, prev?.anything_else ?? null,
     prev?.additives_present ?? null, prev?.additives_detail ?? null, prev?.roast_intent ?? null,
     prev?.blend_components ?? null, prev?.blend_rotation ?? null, prev?.caffeine_level ?? null,
     prev?.decaf_process ?? null, prev?.certifications ?? []]
  );
  const id = created.rows[0].id as string;
  if (prev) {
    await tx.query(`INSERT INTO roastery_portal_response_note (response_id, rank, roaster_words, cupping_note_id)
                    SELECT $1, rank, roaster_words, cupping_note_id FROM roastery_portal_response_note WHERE response_id = $2`, [id, prev.id]);
    await tx.query(`INSERT INTO roastery_portal_response_dimension (response_id, dimension_id, value)
                    SELECT $1, dimension_id, value FROM roastery_portal_response_dimension WHERE response_id = $2`, [id, prev.id]);
    await tx.query(`INSERT INTO roastery_portal_response_brew (response_id, brew_method, role)
                    SELECT $1, brew_method, role FROM roastery_portal_response_brew WHERE response_id = $2`, [id, prev.id]);
  }
  return id;
}

export interface SavedResponse { responseId: string; version: number; updatedAt: string }

/** Full-document replace of the open draft and its three child sets. Creates
 * the draft (copying the latest submitted version) when none is open. */
export async function saveDraft(input: {
  roasterId: string; portalCoffeeId: string; respondentId: unknown; doc: unknown;
}): Promise<SavedResponse> {
  return withTransaction(async tx => {
    await lockLineupCoffee(tx, input.roasterId, input.portalCoffeeId, { requireActive: true });
    const respondent = await requireRespondent(tx, input.roasterId, input.respondentId);
    const doc = await normalizeResponseDoc(tx, input.doc, { roasterId: input.roasterId, portalCoffeeId: input.portalCoffeeId });

    const responseId = await openDraft(tx, input.portalCoffeeId);
    const updated = await tx.query(
      `UPDATE roastery_portal_response SET
         origin = $2, process_values = $3, roast_level = $4, blend_or_single = $5,
         proposed_archetype = $6, dominant_dimension_id = $7, takes_it = $8, brew_notes = $9,
         availability = $10, typical_notice = $11, expected_availability = $12, similar_when_out = $13,
         closest_cousin_portal_coffee_id = $14, what_changes = $15, anything_else = $16,
         additives_present = $17, additives_detail = $18, roast_intent = $19, blend_components = $20,
         blend_rotation = $21, caffeine_level = $22, decaf_process = $23, certifications = $24,
         last_saved_by_respondent_id = $25, updated_at = now()
       WHERE id = $1 AND status = 'draft'
       RETURNING version, updated_at`,
      [responseId, doc.origin, doc.processValues, doc.roastLevel, doc.blendOrSingle,
       doc.proposedArchetype, doc.dominantDimensionId, doc.takesIt, doc.brewNotes, doc.availability,
       doc.typicalNotice, doc.expectedAvailability, doc.similarWhenOut, doc.closestCousinPortalCoffeeId,
       doc.whatChanges, doc.anythingElse,
       doc.additivesPresent, doc.additivesDetail, doc.roastIntent, doc.blendComponents,
       doc.blendRotation, doc.caffeineLevel, doc.decafProcess, doc.certifications, respondent.id]
    );

    await tx.query(`DELETE FROM roastery_portal_response_note WHERE response_id = $1`, [responseId]);
    for (let i = 0; i < doc.notes.length; i++) {
      await tx.query(
        `INSERT INTO roastery_portal_response_note (response_id, rank, roaster_words, cupping_note_id) VALUES ($1, $2, $3, $4)`,
        [responseId, i + 1, doc.notes[i].words, doc.notes[i].cuppingNoteId]
      );
    }
    await tx.query(`DELETE FROM roastery_portal_response_dimension WHERE response_id = $1`, [responseId]);
    for (const [dimensionId, value] of Object.entries(doc.dimensions)) {
      await tx.query(
        `INSERT INTO roastery_portal_response_dimension (response_id, dimension_id, value) VALUES ($1, $2, $3)`,
        [responseId, Number(dimensionId), value]
      );
    }
    await tx.query(`DELETE FROM roastery_portal_response_brew WHERE response_id = $1`, [responseId]);
    if (doc.bestBrew) {
      await tx.query(`INSERT INTO roastery_portal_response_brew (response_id, brew_method, role) VALUES ($1, $2, 'best')`, [responseId, doc.bestBrew]);
    }
    for (const method of doc.alsoGoodBrews) {
      await tx.query(`INSERT INTO roastery_portal_response_brew (response_id, brew_method, role) VALUES ($1, $2, 'also_good')`, [responseId, method]);
    }
    return { responseId, version: updated.rows[0].version, updatedAt: updated.rows[0].updated_at };
  });
}

export interface SubmittedResponse {
  responseId: string; version: number; submittedAt: string;
  coffeeName: string; respondentName: string;
}

/** draft -> submitted, stamping who and when. The row (and its children) are
 * immutable from here on; the next edit opens version + 1. */
export async function submitResponse(input: {
  roasterId: string; portalCoffeeId: string; respondentId: unknown;
}): Promise<SubmittedResponse> {
  return withTransaction(async tx => {
    const coffee = await lockLineupCoffee(tx, input.roasterId, input.portalCoffeeId, { requireActive: true });
    const respondent = await requireRespondent(tx, input.roasterId, input.respondentId);
    const r = await tx.query(
      `UPDATE roastery_portal_response
       SET status = 'submitted', submitted_by_respondent_id = $2, submitted_at = now(), updated_at = now(),
           last_saved_by_respondent_id = $2
       WHERE portal_coffee_id = $1 AND status = 'draft'
       RETURNING id, version, submitted_at`,
      [input.portalCoffeeId, respondent.id]
    );
    if (!r.rows[0]) throw new PortalError('no_draft', 'there is nothing to submit yet', 409);
    return {
      responseId: r.rows[0].id, version: r.rows[0].version, submittedAt: r.rows[0].submitted_at,
      coffeeName: coffee.name, respondentName: respondent.name,
    };
  });
}

// ── Lineup-wide answers ──────────────────────────────────────────────────────
export interface LineupDoc { typicalNotice: string | null; similarWhenOut: string | null; anythingElse: string | null; bestSellers: string[] }

async function normalizeLineupDoc(tx: Tx, raw: any, roasterId: string): Promise<LineupDoc> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('document must be an object');
  const vocab = await getVocabulary();
  // "Which of these do you sell most?": up to three of THIS roastery's active lineup coffees, in order.
  const rawBest: unknown[] = raw.bestSellers === undefined || raw.bestSellers === null ? [] : raw.bestSellers;
  if (!Array.isArray(rawBest)) throw invalid('best sellers must be a list');
  if (rawBest.length > 3) throw invalid('pick at most three best sellers');
  const bestSellers = [...new Set(rawBest.map(v => String(v)))];
  if (bestSellers.length !== rawBest.length) throw invalid('a coffee can only be picked once');
  // Another roastery's coffee, an inactive one and a malformed id all get the same answer as everywhere
  // else in the portal: not found (404), so nothing about another roastery is revealed.
  if (bestSellers.some(id => !isUuid(id))) throw notFound('coffee');
  if (bestSellers.length) {
    const owned = await tx.query(
      `SELECT id FROM roastery_portal_coffee WHERE roaster_id = $1 AND is_active AND id = ANY($2::uuid[])`, [roasterId, bestSellers]
    );
    if (owned.rows.length !== bestSellers.length) throw notFound('coffee');
  }
  return {
    typicalNotice: oneOf(raw.typicalNotice, lookupValues(vocab.notice), 'typical notice'),
    similarWhenOut: oneOf(raw.similarWhenOut, lookupValues(vocab.similar), 'similar profile answer'),
    anythingElse: text(raw.anythingElse, LIMITS.long, 'anything else'),
    bestSellers,
  };
}

async function lockRoasterLineup(tx: Tx, roasterId: string) {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`roastery_portal_lineup:${roasterId}`]);
}

export async function saveLineupDraft(input: { roasterId: string; respondentId: unknown; doc: unknown }): Promise<{ responseId: string; version: number }> {
  return withTransaction(async tx => {
    await lockRoasterLineup(tx, input.roasterId);
    const respondent = await requireRespondent(tx, input.roasterId, input.respondentId);
    const doc = await normalizeLineupDoc(tx, input.doc, input.roasterId);

    const open = await tx.query(`SELECT id, version FROM roastery_portal_lineup_response WHERE roaster_id = $1 AND status = 'draft'`, [input.roasterId]);
    let id: string; let version: number;
    if (open.rows[0]) {
      id = open.rows[0].id; version = open.rows[0].version;
    } else {
      const latest = await tx.query(`SELECT max(version) AS v FROM roastery_portal_lineup_response WHERE roaster_id = $1`, [input.roasterId]);
      version = (latest.rows[0].v ?? 0) + 1;
      const created = await tx.query(
        `INSERT INTO roastery_portal_lineup_response (roaster_id, version, status) VALUES ($1, $2, 'draft') RETURNING id`,
        [input.roasterId, version]
      );
      id = created.rows[0].id;
    }
    await tx.query(
      `UPDATE roastery_portal_lineup_response
       SET typical_notice = $2, similar_when_out = $3, anything_else = $4, last_saved_by_respondent_id = $5, updated_at = now()
       WHERE id = $1 AND status = 'draft'`,
      [id, doc.typicalNotice, doc.similarWhenOut, doc.anythingElse, respondent.id]
    );
    await tx.query(`DELETE FROM roastery_portal_lineup_response_best_seller WHERE lineup_response_id = $1`, [id]);
    for (let i = 0; i < doc.bestSellers.length; i++) {
      await tx.query(
        `INSERT INTO roastery_portal_lineup_response_best_seller (lineup_response_id, portal_coffee_id, rank) VALUES ($1, $2, $3)`,
        [id, doc.bestSellers[i], i + 1]
      );
    }
    return { responseId: id, version };
  });
}

export async function submitLineupResponse(input: { roasterId: string; respondentId: unknown }): Promise<{ responseId: string; version: number; submittedAt: string; respondentName: string }> {
  return withTransaction(async tx => {
    await lockRoasterLineup(tx, input.roasterId);
    const respondent = await requireRespondent(tx, input.roasterId, input.respondentId);
    const r = await tx.query(
      `UPDATE roastery_portal_lineup_response
       SET status = 'submitted', submitted_by_respondent_id = $2, submitted_at = now(), updated_at = now(),
           last_saved_by_respondent_id = $2
       WHERE roaster_id = $1 AND status = 'draft'
       RETURNING id, version, submitted_at`,
      [input.roasterId, respondent.id]
    );
    if (!r.rows[0]) throw new PortalError('no_draft', 'there is nothing to submit yet', 409);
    return { responseId: r.rows[0].id, version: r.rows[0].version, submittedAt: r.rows[0].submitted_at, respondentName: respondent.name };
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// Part 2 (2026-10-05): accepting a submitted coffee into the catalog.
//
// Portal tables hold what the roaster said and are never edited after submit;
// catalog tables hold what Dana decided. This file never touches a catalog
// table itself: every catalog write below is a catalogService function
// (createCoffeeInTx, updateCoffeeInTx, setRoasterDescriptorsInTx) run inside
// the ONE transaction acceptResponse opens, so a failed step rolls the whole
// accept back. Nothing is copied back from the catalog into the portal, and the
// roaster's proposed family, their 1 to 5 dimension values, brewing and
// "black or with milk" are never written anywhere.
// ═════════════════════════════════════════════════════════════════════════════

export interface AcceptNoteItem { rank: number; include: boolean; cuppingNoteId?: string | null; remember?: boolean }
export interface AcceptBasicItem { include: boolean; value?: string | null }
export interface AcceptItems {
  basics?: { origin?: AcceptBasicItem; process?: AcceptBasicItem; roastLevel?: AcceptBasicItem; blendOrSingle?: AcceptBasicItem; caffeine?: AcceptBasicItem };
  notes?: AcceptNoteItem[];
}

export interface AcceptResult {
  acceptanceId: string;
  coffeeId: number;
  createdCoffee: boolean;
  applied: Record<string, unknown>;
  warnings: unknown[];
  integrity: unknown[];
}

async function adminProfileIdFor(tx: Tx, firebaseUid: string): Promise<string | null> {
  const r = await tx.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [firebaseUid]);
  return r.rows[0]?.id ?? null;
}

/** A wheel term an admin may choose: an active cupping_note, never a defect under 'Other'. */
async function assertWheelTerms(tx: Tx, ids: string[]): Promise<Map<string, { descriptor: string; wheelCategory: string }>> {
  const out = new Map<string, { descriptor: string; wheelCategory: string }>();
  if (!ids.length) return out;
  const r = await tx.query(
    `SELECT id, descriptor, wheel_category FROM cupping_note WHERE id = ANY($1::uuid[]) AND is_active AND wheel_category <> 'Other'`, [ids]
  );
  for (const x of r.rows) out.set(x.id, { descriptor: x.descriptor, wheelCategory: x.wheel_category });
  const bad = ids.filter(id => !out.has(id));
  if (bad.length) throw invalid('unknown flavor wheel term');
  return out;
}

/** Create, supersede or leave alone the remembered mapping for these words. */
async function rememberMapping(tx: Tx, words: string, cuppingNoteId: string, adminProfileId: string | null): Promise<'created' | 'superseded' | 'unchanged'> {
  const key = normalizeWords(words);
  if (!key) return 'unchanged';
  const cur = await tx.query(`SELECT id, cupping_note_id FROM roastery_portal_note_mapping WHERE normalized_words = $1 AND superseded_at IS NULL`, [key]);
  if (cur.rows[0]?.cupping_note_id === cuppingNoteId) return 'unchanged';
  if (cur.rows[0]) await tx.query(`UPDATE roastery_portal_note_mapping SET superseded_at = now() WHERE id = $1`, [cur.rows[0].id]);
  await tx.query(
    `INSERT INTO roastery_portal_note_mapping (normalized_words, cupping_note_id, created_by_admin_id) VALUES ($1, $2, $3)`,
    [key, cuppingNoteId, adminProfileId]
  );
  return cur.rows[0] ? 'superseded' : 'created';
}

export async function acceptResponse(input: { responseId: string; items: unknown; actorUid: string }): Promise<AcceptResult> {
  if (!isUuid(input.responseId)) throw notFound('response');
  const items = (input.items ?? {}) as AcceptItems;
  if (typeof items !== 'object' || Array.isArray(items)) throw invalid('items must be an object');
  const noteItems = items.notes ?? [];
  if (!Array.isArray(noteItems)) throw invalid('notes must be a list');
  const vocab = await getVocabulary({ fresh: true });

  return withTransaction(async tx => {
    const rr = await tx.query(
      `SELECT r.*, pc.roaster_id, pc.name AS coffee_name, pc.coffee_id, pc.is_active AS lineup_active
       FROM roastery_portal_response r JOIN roastery_portal_coffee pc ON pc.id = r.portal_coffee_id
       WHERE r.id = $1`, [input.responseId]
    );
    const resp = rr.rows[0];
    if (!resp) throw notFound('response');
    // One accept at a time per lineup coffee (and a stable view of coffee_id).
    await tx.query(`SELECT id FROM roastery_portal_coffee WHERE id = $1 FOR UPDATE`, [resp.portal_coffee_id]);
    if (resp.status !== 'submitted') throw invalid('only a submitted version can be accepted');
    if (!resp.lineup_active) throw invalid('this lineup coffee is inactive');
    const newer = await tx.query(
      `SELECT 1 FROM roastery_portal_response WHERE portal_coffee_id = $1 AND status = 'submitted' AND version > $2`,
      [resp.portal_coffee_id, resp.version]
    );
    if (newer.rows[0]) throw invalid('a newer version has been submitted; review that one instead');

    const adminId = await adminProfileIdFor(tx, input.actorUid);
    const ctxActor = input.actorUid;

    // ── the notes the admin ticked, with their final wheel term ───────────────
    const rows = (await tx.query(
      `SELECT rank, roaster_words, cupping_note_id FROM roastery_portal_response_note WHERE response_id = $1 ORDER BY rank`, [input.responseId]
    )).rows as { rank: number; roaster_words: string; cupping_note_id: string | null }[];
    const itemByRank = new Map<number, AcceptNoteItem>();
    for (const n of noteItems) {
      if (!n || typeof n.rank !== 'number' || !rows.some(r => r.rank === n.rank)) throw invalid('unknown note');
      itemByRank.set(n.rank, n);
    }
    // A term the caller does not send defaults exactly as the preview presets it: the roaster's own
    // pick, else the remembered suggestion for those words, else none (words only). An explicit
    // null means "words only, on purpose".
    const suggestions = await getMappingSuggestions(rows.map(r => r.roaster_words), tx);
    const chosen = rows
      .filter(r => itemByRank.get(r.rank)?.include === true)
      .map(r => {
        const it = itemByRank.get(r.rank)!;
        const term = it.cuppingNoteId === undefined
          ? (r.cupping_note_id ?? suggestions.get(normalizeWords(r.roaster_words))?.cuppingNoteId ?? null)
          : it.cuppingNoteId;
        return { rank: r.rank, words: r.roaster_words, cuppingNoteId: term ?? null, remember: it.remember === true, roasterPick: r.cupping_note_id };
      });
    const terms = await assertWheelTerms(tx, [...new Set(chosen.map(c => c.cuppingNoteId).filter((x): x is string => !!x))]);

    // ── the ticked basics ─────────────────────────────────────────────────────
    const b = items.basics ?? {};
    const update: UpdateCoffeeInput = { coffeeId: 0 };
    const basicsApplied: { field: string; before: unknown; after: unknown }[] = [];
    const wanted: { field: string; value: string | null; set: (v: string) => void }[] = [];
    if (b.origin?.include) wanted.push({ field: 'origin', value: resp.origin, set: v => { update.origin = v; } });
    if (b.process?.include) {
      const value = b.process.value ?? resp.process_values?.[0] ?? null;
      if (value && !vocab.process.some(o => o.value === value)) throw invalid(`unknown process value "${value}"`);
      wanted.push({ field: 'process', value, set: v => { update.process = v; } });
    }
    if (b.roastLevel?.include) wanted.push({ field: 'roastLevel', value: resp.roast_level, set: v => { update.roastLevel = v; } });
    if (b.blendOrSingle?.include) wanted.push({ field: 'blendOrSingle', value: resp.blend_or_single, set: v => { update.blendOrSingle = v; } });
    for (const w of wanted) if (w.value) w.set(w.value);

    // Caffeine (part 3): "Category: Decaf" / "Category: Half-caff", through the existing category codes only
    // (never creating a category). Regular, or a code that does not exist, offers nothing to apply.
    let caffeineChange: { before: string[]; after: string[] } | null = null;
    const caffeineWanted = b.caffeine?.include === true;
    let caffeineCode: string | null = null;
    if (caffeineWanted) {
      const level = (await tx.query(`SELECT caffeine_level FROM v_roastery_portal_response WHERE id = $1`, [input.responseId])).rows[0]?.caffeine_level;
      const code = level === 'decaf' ? 'decaf' : level === 'half_caff' ? 'half_caf' : null;
      if (code && (await tx.query(`SELECT 1 FROM coffee_category WHERE code = $1`, [code])).rows[0]) caffeineCode = code;
    }

    // ── 1. the catalog coffee: create (hidden until placed and priced) or reuse ─
    let coffeeId: number | null = resp.coffee_id;
    let created = false;
    if (coffeeId === null) {
      const c = await createCoffeeInTx(tx, { roasterId: resp.roaster_id, name: resp.coffee_name });
      coffeeId = c.coffeeId;
      created = true;
      await logCatalogChange(tx, {
        entity: 'coffee', entityId: coffeeId, action: 'createCoffee', before: null,
        after: await snapshotRow(tx, 'coffees', 'id', coffeeId), changedBy: ctxActor,
      });
      await tx.query(`UPDATE roastery_portal_coffee SET coffee_id = $1 WHERE id = $2`, [coffeeId, resp.portal_coffee_id]);
    }
    update.coffeeId = coffeeId;
    if (caffeineCode) {
      // categoryCodes is a full-set replace in the catalog door, so keep every other category the coffee has.
      const existing = ((await getCatalogCoffee(coffeeId, tx))?.category_codes ?? []) as string[];
      const after = [...existing.filter(c => c !== 'decaf' && c !== 'half_caf'), caffeineCode];
      update.categoryCodes = after;
      caffeineChange = { before: existing, after };
    }

    // ── 2. the ticked basics + the roaster's own words, in order (internal only) ─
    const phrases = chosen.map(c => c.words);
    if (phrases.length) update.flavorDescriptorsRoaster = phrases;
    let coffeeBefore: Record<string, unknown> | null = null;
    let coffeeAfter: Record<string, unknown> | null = null;
    if (Object.keys(update).length > 1) {
      const r = await updateCoffeeInTx(tx, update);
      coffeeBefore = r.before; coffeeAfter = r.after;
      await logCatalogChange(tx, { entity: 'coffee', entityId: coffeeId, action: 'updateCoffee', before: r.before, after: r.after, changedBy: ctxActor });
      const col: Record<string, string> = { origin: 'origin', process: 'process', roastLevel: 'roast_level', blendOrSingle: 'blend_or_single' };
      for (const w of wanted) if (w.value) basicsApplied.push({ field: w.field, before: r.before?.[col[w.field]] ?? null, after: r.after?.[col[w.field]] ?? null });
      if (caffeineChange) basicsApplied.push({ field: 'caffeine', before: caffeineChange.before, after: caffeineChange.after });
    }

    // ── 3. the ticked, mapped notes -> roaster descriptors (set semantics) ─────
    let descriptors: Record<string, unknown> | null = null;
    if (chosen.length) {
      const mapped = chosen.filter(c => c.cuppingNoteId).map(c => ({ cuppingNoteId: c.cuppingNoteId!, roasterWords: c.words }));
      const d = await setRoasterDescriptorsInTx(tx, { coffeeId, notes: mapped, sourceResponseId: input.responseId, adminProfileId: adminId });
      await logCatalogChange(tx, { entity: 'coffee_roaster_descriptors', entityId: coffeeId, action: 'setRoasterDescriptors', before: d.before, after: d.after, changedBy: ctxActor });
      descriptors = {
        activated: d.activated, retired: d.retired,
        words_only_notes: chosen.filter(c => !c.cuppingNoteId).map(c => c.words),
        before: d.before, after: d.after,
      };
    }

    // ── 4. remembered mappings: only where the admin chose or changed the term ─
    const remembered: { words: string; cuppingNoteId: string; result: string }[] = [];
    for (const c of chosen) {
      if (!c.remember || !c.cuppingNoteId) continue;
      remembered.push({ words: normalizeWords(c.words), cuppingNoteId: c.cuppingNoteId, result: await rememberMapping(tx, c.words, c.cuppingNoteId, adminId) });
    }

    // ── 5. the insert-only acceptance log ────────────────────────────────────
    const applied = {
      version: resp.version,
      createdCoffee: created,
      coffee: { before: coffeeBefore, after: coffeeAfter },
      basics: basicsApplied,
      flavorDescriptorsRoaster: phrases.length ? { before: coffeeBefore?.flavor_descriptors_roaster ?? null, after: phrases } : null,
      notes: chosen.map(c => ({
        rank: c.rank, roasterWords: c.words, roasterPick: c.roasterPick, cuppingNoteId: c.cuppingNoteId,
        descriptor: c.cuppingNoteId ? terms.get(c.cuppingNoteId)?.descriptor ?? null : null,
      })),
      descriptors,
      mappingsRemembered: remembered,
    };
    const log = await tx.query(
      `INSERT INTO roastery_portal_acceptance (response_id, portal_coffee_id, coffee_id, created_coffee, applied, accepted_by_admin_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.responseId, resp.portal_coffee_id, coffeeId, created, JSON.stringify(applied), adminId]
    );
    const integrity = await scopedIntegrity(tx, { coffeeId });
    return { acceptanceId: log.rows[0].id, coffeeId, createdCoffee: created, applied, warnings: [], integrity };
  });
}

// ── Remembered mappings, managed from the admin "Mappings" list ───────────────
/** Set (create, or supersede-and-replace) the remembered term for some words. */
export async function setNoteMapping(input: { words: unknown; cuppingNoteId: unknown; actorUid: string }): Promise<{ result: 'created' | 'superseded' | 'unchanged' }> {
  const words = requiredText(input.words, LIMITS.short, 'words');
  if (!isUuid(input.cuppingNoteId)) throw invalid('choose a flavor wheel term');
  return withTransaction(async tx => {
    await assertWheelTerms(tx, [input.cuppingNoteId as string]);
    return { result: await rememberMapping(tx, words, input.cuppingNoteId as string, await adminProfileIdFor(tx, input.actorUid)) };
  });
}

/** Retire a remembered mapping without a replacement (history kept). */
export async function supersedeNoteMapping(input: { mappingId: string }): Promise<{ superseded: boolean }> {
  if (!isUuid(input.mappingId)) throw notFound('mapping');
  return withTransaction(async tx => {
    const exists = await tx.query(`SELECT id FROM roastery_portal_note_mapping WHERE id = $1`, [input.mappingId]);
    if (!exists.rows[0]) throw notFound('mapping');
    const r = await tx.query(`UPDATE roastery_portal_note_mapping SET superseded_at = now() WHERE id = $1 AND superseded_at IS NULL`, [input.mappingId]);
    return { superseded: (r.rowCount ?? 0) > 0 };
  });
}

/** Change an existing mapping to a different term: supersedes the old row, inserts a new one. */
export async function changeNoteMapping(input: { mappingId: string; cuppingNoteId: unknown; actorUid: string }): Promise<{ result: 'created' | 'superseded' | 'unchanged' }> {
  if (!isUuid(input.mappingId)) throw notFound('mapping');
  if (!isUuid(input.cuppingNoteId)) throw invalid('choose a flavor wheel term');
  return withTransaction(async tx => {
    const cur = await tx.query(`SELECT normalized_words FROM roastery_portal_note_mapping WHERE id = $1 AND superseded_at IS NULL`, [input.mappingId]);
    if (!cur.rows[0]) throw notFound('mapping');
    await assertWheelTerms(tx, [input.cuppingNoteId as string]);
    return { result: await rememberMapping(tx, cur.rows[0].normalized_words, input.cuppingNoteId as string, await adminProfileIdFor(tx, input.actorUid)) };
  });
}
