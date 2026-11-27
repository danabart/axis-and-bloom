// Usual Drink 4 (2026-11-26, C2) — the one app writer of the kitchen list, beside
// the boot seed in schema.sql: the kitchen field's brew_profile_field_value rows
// (and no other field's), brew_cupboard_brand and brew_cupboard_brand_alias.
// promoteTypedName turns a name customers typed into a list entry in one
// transaction (the value, its brand row, its alias); retireKitchenEntry sets
// is_active false and never deletes (G2.11). No customer_brew_profile_change row
// is written: an old typed answer resolves on read in v_customer_cupboard_coffee
// (C3, G2.20). The kitchen field is found by its brand rows, so no field code is
// typed here. A new entry reaches the autocomplete and Liam at the next
// field-list refresh (field_list_refresh_seconds).
// backend/src/features/usual_drink/CLAUDE_CODE_PROMPT_USUAL_DRINK_4_PAGE_FIXES_AND_KITCHEN_LIST.md
import { withTransaction, type Tx } from '../db/client.js';

export class KitchenListError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'KitchenListError';
  }
}
const invalid = (message: string) => new KitchenListError(400, 'KITCHEN_LIST_INVALID', message);

/** lower-cased and trimmed, the alias form (the seed's lower(trim(...))) */
export const aliasOf = (typed: string) => typed.trim().toLowerCase();

/** A code from a label: lower-case letters, digits and underscores (accents dropped). */
export function codeFromLabel(label: string): string {
  return label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

async function inTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : withTransaction(fn);
}

/** The field whose values the brand rows decompose (cupboard_coffee). */
async function kitchenField(tx: Tx): Promise<{ id: number; maxItemLen: number | null }> {
  const r = await tx.query<{ id: number; max_item_len: number | null }>(
    `SELECT DISTINCT f.id, f.max_item_len FROM brew_cupboard_brand b
       JOIN brew_profile_field_value fv ON fv.id = b.field_value_id JOIN brew_profile_field f ON f.id = fv.field_id`);
  if (r.rows.length !== 1) throw new KitchenListError(500, 'KITCHEN_FIELD', `expected one kitchen field, found ${r.rows.length}`);
  return { id: r.rows[0].id, maxItemLen: r.rows[0].max_item_len };
}

export interface PromoteInput {
  /** the name as customers typed it; becomes the entry's alias, lower-cased and trimmed */
  typed: string;
  /** the entry's label, as the admin entered it */
  label: string;
  /** brew_cupboard_brand_kind code; a product takes its brand's kind */
  kindCode?: string | null;
  /** a product's brand (its value code), else null */
  parentCode?: string | null;
}
export interface PromoteResult { created: boolean; code: string }

/** C2: one value, one brand row, one alias. Idempotent on the alias: an alias already on an entry returns that entry. */
export async function promoteTypedName(input: PromoteInput, tx?: Tx): Promise<PromoteResult> {
  const alias = aliasOf(input.typed ?? '');
  const label = (input.label ?? '').trim();
  if (!alias) throw invalid('the typed name is empty');
  if (!label) throw invalid('the label is empty');
  return inTx(tx, async t => {
    // one promotion at a time, so the alias check and the inserts cannot interleave
    await t.query(`SELECT pg_advisory_xact_lock(hashtext('brewKitchenList.promoteTypedName'))`);
    const field = await kitchenField(t);
    if (field.maxItemLen && label.length > field.maxItemLen) throw invalid(`the label is longer than ${field.maxItemLen} characters`);
    const existing = (await t.query<{ code: string }>(
      `SELECT fv.code FROM brew_cupboard_brand_alias a JOIN brew_cupboard_brand b ON b.id = a.brand_id
         JOIN brew_profile_field_value fv ON fv.id = b.field_value_id
       WHERE fv.field_id = $1 AND a.alias = $2 ORDER BY fv.id LIMIT 1`, [field.id, alias])).rows[0];
    if (existing) return { created: false, code: existing.code };
    if ((await t.query(`SELECT 1 FROM brew_profile_field_value WHERE field_id = $1 AND lower(trim(label)) = lower($2)`, [field.id, label])).rowCount) {
      throw new KitchenListError(409, 'KITCHEN_LABEL_TAKEN', `an entry is already labelled "${label}"`);
    }
    let kindId: number;
    let parentId: number | null = null;
    if (input.parentCode) {
      const p = (await t.query<{ id: number; brand_kind_id: number }>(
        `SELECT b.id, b.brand_kind_id FROM brew_cupboard_brand b JOIN brew_profile_field_value fv ON fv.id = b.field_value_id
         WHERE fv.field_id = $1 AND fv.code = $2 AND fv.is_active AND NOT fv.accepts_words AND b.parent_brand_id IS NULL`,
        [field.id, input.parentCode])).rows[0];
      if (!p) throw invalid(`"${input.parentCode}" is not an active brand`);
      parentId = p.id; kindId = p.brand_kind_id;
    } else {
      const k = (await t.query<{ id: number }>(`SELECT id FROM brew_cupboard_brand_kind WHERE code = $1 AND is_active`, [input.kindCode ?? ''])).rows[0];
      if (!k) throw invalid(`"${input.kindCode ?? ''}" is not an active brand kind`);
      kindId = k.id;
    }
    const base = codeFromLabel(label) || 'brand';
    const taken = new Set((await t.query<{ code: string }>(
      `SELECT code FROM brew_profile_field_value WHERE field_id = $1 AND (code = $2 OR code LIKE $2 || '\\_%')`, [field.id, base])).rows.map(r => r.code));
    let code = base;
    for (let n = 2; taken.has(code); n++) code = `${base}_${n}`;
    const value = (await t.query<{ id: number }>(
      `INSERT INTO brew_profile_field_value (field_id, code, label, sort_order)
       SELECT $1, $2, $3, COALESCE(max(sort_order), 0) + 1 FROM brew_profile_field_value WHERE field_id = $1
       RETURNING id`, [field.id, code, label])).rows[0];
    const brand = (await t.query<{ id: number }>(
      `INSERT INTO brew_cupboard_brand (field_value_id, brand_kind_id, parent_brand_id) VALUES ($1, $2, $3) RETURNING id`,
      [value.id, kindId, parentId])).rows[0];
    await t.query(`INSERT INTO brew_cupboard_brand_alias (brand_id, alias) VALUES ($1, $2)`, [brand.id, alias]);
    return { created: true, code };
  });
}

/** C2: retire a kitchen entry (is_active false). It stays displayable for customers who hold it; never deleted. */
export async function retireKitchenEntry(code: string, tx?: Tx): Promise<{ retired: boolean }> {
  return inTx(tx, async t => {
    const field = await kitchenField(t);
    const r = await t.query(
      `UPDATE brew_profile_field_value SET is_active = false, updated_at = now()
       WHERE field_id = $1 AND code = $2 AND is_active AND NOT accepts_words AND NOT pinned`, [field.id, code]);
    if (!r.rowCount) {
      const exists = (await t.query(`SELECT is_active FROM brew_profile_field_value WHERE field_id = $1 AND code = $2`, [field.id, code])).rows[0];
      if (!exists) throw new KitchenListError(404, 'KITCHEN_ENTRY_NOT_FOUND', `no kitchen entry "${code}"`);
      if (exists.is_active) throw invalid(`"${code}" is a fixed answer of the kitchen question and stays`);
      return { retired: false };
    }
    return { retired: true };
  });
}

