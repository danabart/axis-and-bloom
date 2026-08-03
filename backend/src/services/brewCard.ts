import { db } from '../db/client.js';
import { getSommelierConfig, type SommelierConfig } from './sommelierConfig.js';
import type { BrewProfileDoc } from './brewProfile.js';

// HOME_TASK_6 (§3.2, §3.1) — "Your Uganda · V60 · 1:16 · medium-coarse · 94°C —
// adjusted after you found it bitter." The recipe generator is deterministic
// code + config, never an LLM call for the numbers (cards must be exactly
// reproducible) — see computeRecipe() below. The one warm sentence *around*
// the card (the arrival note's prose) is separate, generated once via
// storyLayer.ts's generateBrewNoteSentence(), same alias-only discipline.

export interface BrewCardParams {
  ratio: string;
  grindLabel: string;
  tempC: number | null;
  notes: string;
}

export interface BrewCardRow {
  id: number;
  userId: string;
  coffeeId: number;
  method: string;
  params: BrewCardParams;
  origin: 'arrival_note' | 'conversation';
  revision: number;
  lastAdjustmentReason: string | null;
  createdAt: string;
  updatedAt: string;
}

const FALLBACK_BREW_DEFAULTS: NonNullable<SommelierConfig['brewDefaults']> = {
  grindScale: ['extra-coarse', 'coarse', 'medium-coarse', 'medium', 'medium-fine', 'fine', 'extra-fine'],
  methods: {
    v60:          { ratio: '1:16', grindLabel: 'medium-fine',  grindIndex: 4, tempC: 94 },
    french_press: { ratio: '1:15', grindLabel: 'coarse',       grindIndex: 1, tempC: 96 },
    espresso:     { ratio: '1:2',  grindLabel: 'fine',         grindIndex: 5, tempC: 93 },
    moka:         { ratio: '1:10', grindLabel: 'medium-fine',  grindIndex: 4, tempC: null },
    aeropress:    { ratio: '1:15', grindLabel: 'medium-fine',  grindIndex: 4, tempC: 85 },
    cold_brew:    { ratio: '1:8',  grindLabel: 'extra-coarse', grindIndex: 0, tempC: null },
    drip:         { ratio: '1:16', grindLabel: 'medium',       grindIndex: 3, tempC: 94 },
    other:        { ratio: '1:16', grindLabel: 'medium',       grindIndex: 3, tempC: 94 },
  },
  dimensionDeltas: [
    { dimensionName: 'Body', highThreshold: 10, lowThreshold: 4, highGrindShift: 1, lowGrindShift: -1,
      highNote: 'started a touch coarser for the body in this one', lowNote: 'started a touch finer to build more body' },
    { dimensionName: 'Acidity', highThreshold: 10, lowThreshold: 4, highTempShiftC: -2, lowTempShiftC: 2,
      highNote: 'a couple degrees cooler to keep the brightness in check', lowNote: 'a couple degrees hotter to pull out more brightness' },
    { dimensionName: 'Bitterness', highThreshold: 10, lowThreshold: null, highGrindShift: 1, highTempShiftC: -1,
      highNote: 'coarser and slightly cooler so it doesn\'t turn bitter' },
  ],
  adjustments: {
    grind_coarser: { grindShift: 1, note: 'went coarser' },
    grind_finer:   { grindShift: -1, note: 'went finer' },
    temp_up:       { tempShiftC: 2, note: 'a couple degrees hotter' },
    temp_down:     { tempShiftC: -2, note: 'a couple degrees cooler' },
    ratio_stronger: { note: 'a touch stronger' },
    ratio_weaker:   { note: 'a touch lighter' },
  },
  archetypeDefaultMethod: {
    floral: 'v60', fruity: 'v60', balanced_sweet: 'drip',
    chocolate_nutty: 'french_press', earthy: 'french_press', experimental: 'v60',
  },
  arrivalNote: { deliveryDelayDays: 4, shortNoteFromBagNumber: 2 },
};

function getBrewDefaults(): NonNullable<SommelierConfig['brewDefaults']> {
  return getSommelierConfig()?.brewDefaults ?? FALLBACK_BREW_DEFAULTS;
}

const TAKES_IT_PHRASE: Record<string, string> = {
  milk: 'You take it with milk.',
  sugar: 'You take it with sugar.',
  milk_and_sugar: 'You take it with milk and sugar.',
};

export interface DimensionAverage {
  dimensionName: string;
  avgMin: number;
  avgMax: number;
}

// Same numeric-dimension query shape coffees.ts's GET /:id/dimensions already
// uses — not reinvented, just scoped to what the recipe generator needs.
export async function getCuppingDimensionAverages(coffeeId: number): Promise<DimensionAverage[]> {
  const result = await db.query(
    `SELECT d.name AS dimension,
            ROUND(AVG(csv.value_min)::numeric, 1) AS avg_min,
            ROUND(AVG(csv.value_max)::numeric, 1) AS avg_max
     FROM cupping_score_values csv
     JOIN cupping_scores cs  ON cs.id  = csv.cupping_score_id
     JOIN cupping_session_coffees sc ON sc.id = cs.session_coffee_id
     JOIN coffee_dimensions d       ON d.id  = csv.dimension_id
     WHERE sc.coffee_id = $1 AND d.is_numeric = true AND csv.value_min IS NOT NULL
     GROUP BY d.id, d.name
     ORDER BY d.id`,
    [coffeeId]
  );
  return result.rows.map((r: { dimension: string; avg_min: string; avg_max: string }) => ({
    dimensionName: r.dimension,
    avgMin: Number(r.avg_min),
    avgMax: Number(r.avg_max),
  }));
}

// Pure — the determinism the task cares about most. Same methodKey +
// dimensionAverages + brewProfile + config always produce byte-identical
// params. No DB access, no randomness, no wall-clock read.
export function computeRecipe(
  methodKey: string,
  dimensionAverages: DimensionAverage[],
  brewProfile: BrewProfileDoc | null
): BrewCardParams {
  const defaults = getBrewDefaults();
  const base = defaults.methods[methodKey] ?? defaults.methods.other;
  const grindScale = defaults.grindScale;

  let grindIndex = base.grindIndex;
  let tempC = base.tempC;
  const dimensionNotes: string[] = [];

  for (const rule of defaults.dimensionDeltas) {
    const dim = dimensionAverages.find(d => d.dimensionName === rule.dimensionName);
    if (!dim) continue;
    const avg = (dim.avgMin + dim.avgMax) / 2;
    if (rule.highThreshold != null && avg >= rule.highThreshold) {
      if (rule.highGrindShift) grindIndex += rule.highGrindShift;
      if (rule.highTempShiftC && tempC != null) tempC += rule.highTempShiftC;
      if (rule.highNote) dimensionNotes.push(rule.highNote);
    } else if (rule.lowThreshold != null && avg <= rule.lowThreshold) {
      if (rule.lowGrindShift) grindIndex += rule.lowGrindShift;
      if (rule.lowTempShiftC && tempC != null) tempC += rule.lowTempShiftC;
      if (rule.lowNote) dimensionNotes.push(rule.lowNote);
    }
  }

  grindIndex = Math.max(0, Math.min(grindScale.length - 1, grindIndex));
  const grindLabel = grindScale[grindIndex];

  const takesIt = brewProfile?.takes_it?.value;
  const takesItPhrase = typeof takesIt === 'string' ? TAKES_IT_PHRASE[takesIt] : undefined;

  const noteParts: string[] = [];
  if (dimensionNotes.length) {
    const joined = dimensionNotes.join('; ');
    noteParts.push(joined.charAt(0).toUpperCase() + joined.slice(1) + '.');
  }
  if (takesItPhrase) noteParts.push(takesItPhrase);

  return {
    ratio: base.ratio,
    grindLabel,
    tempC,
    notes: noteParts.join(' '),
  };
}

// Whichever explicit method the brew profile names first, else the coffee's
// archetype default, else 'other'. Used only when the caller doesn't already
// know a method (arrival note, a fresh <<card:save>> with no existing card).
export async function resolveDefaultMethod(coffeeId: number, brewProfile: BrewProfileDoc | null): Promise<string> {
  const profileMethods = brewProfile?.brew_methods?.value;
  if (Array.isArray(profileMethods) && typeof profileMethods[0] === 'string') {
    return profileMethods[0];
  }
  const archResult = await db.query(
    `SELECT aa.archetype::text AS archetype FROM archetype_assignments aa
     WHERE aa.coffee_id = $1 AND aa.superseded_at IS NULL LIMIT 1`,
    [coffeeId]
  );
  const archetype = archResult.rows[0]?.archetype as string | undefined;
  const defaults = getBrewDefaults();
  return (archetype && defaults.archetypeDefaultMethod[archetype]) || 'other';
}

function rowToCard(row: any): BrewCardRow {
  return {
    id: row.id,
    userId: row.user_id,
    coffeeId: row.coffee_id,
    method: row.method,
    params: row.params,
    origin: row.origin,
    revision: row.revision,
    lastAdjustmentReason: row.last_adjustment_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Fetch-or-create — never regenerates an existing card's numbers (a card's
// whole point is stability; only <<card:adjust>> changes it). `origin` only
// applies to a genuinely new row; fetching an existing card returns it as-is
// regardless of what origin the caller passed. `brewProfile` is whatever the
// caller already has loaded (or null) — read live by the caller (getBrewProfile()
// in sommelier.ts), not re-fetched here, same "no redundant Firestore read"
// discipline as the rest of this codebase.
export async function generateCard(
  userId: string,
  coffeeId: number,
  method: string,
  origin: 'arrival_note' | 'conversation',
  brewProfile: BrewProfileDoc | null = null
): Promise<BrewCardRow> {
  const existing = await db.query(
    `SELECT * FROM brew_card WHERE user_id = $1 AND coffee_id = $2 AND method = $3`,
    [userId, coffeeId, method]
  );
  if (existing.rows.length) return rowToCard(existing.rows[0]);

  const dimensionAverages = await getCuppingDimensionAverages(coffeeId);
  const params = computeRecipe(method, dimensionAverages, brewProfile);

  const inserted = await db.query(
    `INSERT INTO brew_card (user_id, coffee_id, method, params, origin)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING *`,
    [userId, coffeeId, method, JSON.stringify(params), origin]
  );
  return rowToCard(inserted.rows[0]);
}

// HOME_TASK_6 (§3.1) — the order-placement hook (orders.ts, the exact same
// signal liamSmsFeedback.ts's schedulePostDeliveryMessage already hooks, per
// this task's own context note — not a new signal). Fetch-or-create like
// generateCard(), but only a genuinely NEW card gets an arrival email
// scheduled: a repeat order of a coffee+method this customer already has a
// card for (from a prior order or from conversation) doesn't re-trigger a
// second arrival note for the same card — same "orders 1 and 2 only" scoping
// spirit as the SMS hook, applied per coffee+method instead of per account.
// This is a deliberate v1 scope decision, recorded in the build log.
export async function createArrivalCard(
  userId: string,
  coffeeId: number,
  brewProfile: BrewProfileDoc | null
): Promise<{ card: BrewCardRow; isNewCard: boolean }> {
  const method = await resolveDefaultMethod(coffeeId, brewProfile);
  const existing = await db.query(
    `SELECT * FROM brew_card WHERE user_id = $1 AND coffee_id = $2 AND method = $3`,
    [userId, coffeeId, method]
  );
  if (existing.rows.length) return { card: rowToCard(existing.rows[0]), isNewCard: false };

  const dimensionAverages = await getCuppingDimensionAverages(coffeeId);
  const params = computeRecipe(method, dimensionAverages, brewProfile);
  const { deliveryDelayDays } = getArrivalNoteConfig();
  const scheduledFor = new Date(Date.now() + deliveryDelayDays * 86_400_000);

  const inserted = await db.query(
    `INSERT INTO brew_card (user_id, coffee_id, method, params, origin, arrival_email_scheduled_for)
     VALUES ($1, $2, $3, $4::jsonb, 'arrival_note', $5)
     RETURNING *`,
    [userId, coffeeId, method, JSON.stringify(params), scheduledFor]
  );
  return { card: rowToCard(inserted.rows[0]), isNewCard: true };
}

// The most-recently-updated card for a coffee — used to resolve entry=card
// (no method in the link contract, see HOME_TASK_6 spec item 5) and as the
// adjust-target when a customer says "go coarser" without naming a method.
export async function getMostRecentCard(userId: string, coffeeId: number): Promise<BrewCardRow | null> {
  const result = await db.query(
    `SELECT * FROM brew_card WHERE user_id = $1 AND coffee_id = $2 ORDER BY updated_at DESC LIMIT 1`,
    [userId, coffeeId]
  );
  return result.rows.length ? rowToCard(result.rows[0]) : null;
}

export async function getCardByMethod(userId: string, coffeeId: number, method: string): Promise<BrewCardRow | null> {
  const result = await db.query(
    `SELECT * FROM brew_card WHERE user_id = $1 AND coffee_id = $2 AND method = $3`,
    [userId, coffeeId, method]
  );
  return result.rows.length ? rowToCard(result.rows[0]) : null;
}

export async function getUserBrewCards(userId: string): Promise<BrewCardRow[]> {
  const result = await db.query(
    `SELECT * FROM brew_card WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  return result.rows.map(rowToCard);
}

// <<card:adjust=KEY>> — server-resolved, never trusted from the model beyond
// the whitelisted key itself (S51 discipline). `reasonText` is the customer's
// own words for this turn, truncated by the caller before it ever reaches
// here — never generated or inferred.
export async function adjustCard(cardId: number, adjustmentKey: string, reasonText: string): Promise<BrewCardRow | null> {
  const defaults = getBrewDefaults();
  const adjustment = defaults.adjustments[adjustmentKey];
  if (!adjustment) {
    console.warn('[brewCard] unknown adjustment key dropped:', adjustmentKey);
    return null;
  }

  const existing = await db.query(`SELECT * FROM brew_card WHERE id = $1`, [cardId]);
  if (!existing.rows.length) return null;
  const card = rowToCard(existing.rows[0]);

  const grindScale = defaults.grindScale;
  let grindIndex = grindScale.indexOf(card.params.grindLabel);
  if (grindIndex === -1) grindIndex = defaults.methods[card.method]?.grindIndex ?? defaults.methods.other.grindIndex;
  if (adjustment.grindShift) grindIndex = Math.max(0, Math.min(grindScale.length - 1, grindIndex + adjustment.grindShift));
  const grindLabel = grindScale[grindIndex];

  let tempC = card.params.tempC;
  if (adjustment.tempShiftC && tempC != null) tempC += adjustment.tempShiftC;

  const newParams: BrewCardParams = { ...card.params, grindLabel, tempC };

  const updated = await db.query(
    `UPDATE brew_card
     SET params = $2::jsonb, revision = revision + 1, last_adjustment_reason = $3, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [cardId, JSON.stringify(newParams), reasonText]
  );
  return rowToCard(updated.rows[0]);
}

export function getArrivalNoteConfig(): { deliveryDelayDays: number; shortNoteFromBagNumber: number } {
  return getBrewDefaults().arrivalNote;
}

// Bag-number rule (§3.1) — "first-ever bag gets the fullest note; later bags
// shorter." Computed live at send time (not stamped at order time) from real
// order history, via the same order_line_item -> roaster_blend -> coffee_id
// path liamSmsFeedback.ts and users.ts's flavor-memory route already use —
// how many times has this user ordered *this coffee* (any blend/roaster that
// resolves to it), including the order that triggered this note.
export async function getBagNumberForCoffee(userId: string, coffeeId: number): Promise<number> {
  const result = await db.query(
    `SELECT COUNT(*) AS count
     FROM order_line_item li
     JOIN "order" o ON o.id = li.order_id
     JOIN roaster_blend rb ON rb.id = li.blend_id
     WHERE o.user_id = $1 AND rb.coffee_id = $2`,
    [userId, coffeeId]
  );
  return Number(result.rows[0]?.count ?? 1) || 1;
}
