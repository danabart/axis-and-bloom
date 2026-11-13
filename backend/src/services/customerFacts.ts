import { db, whoAmI, type Tx } from '../db/client.js';
import { getCatalogVersion } from './catalogReads.js';
import { getBrewProfileFieldsConfig, incrementBrewProfileCounter } from './brewProfile.js';

// ── Customer Blueprint · brief C1, Part C (2026-09-27) ────────────────────────
// The only INSERT path onto any customer_* table (plus the customer_-less
// catalog_change). No update, delete or upsert function exists here, on
// purpose — a fact is never rewritten (D3/D17). See backend/src/features/
// customer_blueprint/CLAUDE_CODE_PROMPT_CUSTOMER_1_ROLES_NAMING_DOOR.md, Part C.
//
// Every record.*() call: builds one `INSERT ... ON CONFLICT (source, source_id)
// DO NOTHING RETURNING id`, never throws on a duplicate (logs and returns
// `inserted: false` instead), and fills `catalog_version` via
// getCatalogVersion() unless the caller passes one. `occurred_at` is not a
// parameter on the normal path — the column's own DEFAULT timezone('utc',
// now()) stands in for "right now" — except through the `.backfill()`
// variant, which is the only way to set occurred_at/recorded_at explicitly,
// and which refuses to run as ab_app (backfills are owner-only, Part B).

type Runner = Tx | typeof db;

// 'quiz' (Usual Drink 1, 2026-11-12): the quiz post-result card's brew-profile rows.
export type FactSource = 'onsite' | 'liam' | 'quiz' | 'sms' | 'shopify' | 'qr' | 'backfill' | 'backfill_detected';

export interface FactResult {
  id: string | null;
  inserted: boolean;
}

interface CommonFields {
  source: FactSource;
  sourceId: string;
  catalogVersion?: string;
}

interface BackfillFields {
  occurredAt: Date;
  recordedAt?: Date;
}

async function resolveCatalogVersion(runner: Runner, provided?: string): Promise<string | null> {
  if (provided !== undefined) return provided;
  return getCatalogVersion(runner);
}

async function assertOwner(runner: Runner): Promise<void> {
  const currentUser = await whoAmI(runner);
  if (currentUser === 'ab_app') {
    throw new Error('customerFacts: .backfill() cannot run as ab_app — backfills are owner-only (Customer Blueprint C1, Part B)');
  }
}

// Low-level insert shared by every record.*() function below. `table` is
// always one of this file's own hardcoded literals, never external input.
async function insertFact(runner: Runner, table: string, columns: string[], values: unknown[]): Promise<FactResult> {
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const result = await runner.query<{ id: string }>(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})
     ON CONFLICT (source, source_id) DO NOTHING RETURNING id`,
    values
  );
  if (result.rowCount) return { id: result.rows[0].id, inserted: true };
  const sourceIdx = columns.indexOf('source');
  const sourceIdIdx = columns.indexOf('source_id');
  console.warn(`[customerFacts:DUPLICATE] ${table} source=${values[sourceIdx]} source_id=${values[sourceIdIdx]}`);
  return { id: null, inserted: false };
}

// ── customer_identity_link ────────────────────────────────────────────────────
export interface IdentityLinkInput extends CommonFields {
  userId: string; // = fromUserId (the profile being linked away)
  fromUserId: string;
  toUserId: string;
  how: 'email_match' | 'household_claim' | 'admin';
}
async function identityLinkFn(input: IdentityLinkInput, tx?: Tx): Promise<FactResult> {
  const runner = tx ?? db;
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_identity_link',
    ['user_id', 'source', 'source_id', 'catalog_version', 'from_user_id', 'to_user_id', 'how'],
    [input.userId, input.source, input.sourceId, catalogVersion, input.fromUserId, input.toUserId, input.how]);
}
async function identityLinkBackfill(input: IdentityLinkInput & BackfillFields, runner: Runner): Promise<FactResult> {
  await assertOwner(runner);
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_identity_link',
    ['user_id', 'occurred_at', 'recorded_at', 'source', 'source_id', 'catalog_version', 'from_user_id', 'to_user_id', 'how'],
    [input.userId, input.occurredAt, input.recordedAt ?? input.occurredAt, input.source, input.sourceId, catalogVersion, input.fromUserId, input.toUserId, input.how]);
}
const identityLink = Object.assign(identityLinkFn, { backfill: identityLinkBackfill });

// ── customer_identity_unlink (Family Household 2, D25) ────────────────────────
// Undoing a customer_identity_link is a new row, never a delete of the link.
// v_customer_identity skips a link that has one. Idempotent per link: callers
// pass sourceId = `identity_unlink:<linkId>`.
export interface IdentityUnlinkInput extends CommonFields {
  userId: string; // = the link's from_user_id
  linkId: string;
  actorUserId?: string | null;
  reason?: string | null;
}
async function identityUnlinkFn(input: IdentityUnlinkInput, tx?: Tx): Promise<FactResult> {
  const runner = tx ?? db;
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_identity_unlink',
    ['user_id', 'source', 'source_id', 'catalog_version', 'link_id', 'actor_user_id', 'reason'],
    [input.userId, input.source, input.sourceId, catalogVersion, input.linkId, input.actorUserId ?? null, input.reason ?? null]);
}
async function identityUnlinkBackfill(input: IdentityUnlinkInput & BackfillFields, runner: Runner): Promise<FactResult> {
  await assertOwner(runner);
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_identity_unlink',
    ['user_id', 'occurred_at', 'recorded_at', 'source', 'source_id', 'catalog_version', 'link_id', 'actor_user_id', 'reason'],
    [input.userId, input.occurredAt, input.recordedAt ?? input.occurredAt, input.source, input.sourceId, catalogVersion, input.linkId, input.actorUserId ?? null, input.reason ?? null]);
}
const identityUnlink = Object.assign(identityUnlinkFn, { backfill: identityUnlinkBackfill });

// ── customer_feedback_event ───────────────────────────────────────────────────
export interface FeedbackInput extends CommonFields {
  userId: string;
  orderLineItemId?: string | null;
  coffeeId: number;
  rating?: number | null;
  expectation?: string | null;
  rawText?: string | null;
  supersedesId?: string | null;
  channel: 'onsite' | 'sms' | 'liam';
}
async function feedbackFn(input: FeedbackInput, tx?: Tx): Promise<FactResult> {
  const runner = tx ?? db;
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_feedback_event',
    ['user_id', 'source', 'source_id', 'catalog_version', 'order_line_item_id', 'coffee_id', 'rating', 'expectation', 'raw_text', 'supersedes_id', 'channel'],
    [input.userId, input.source, input.sourceId, catalogVersion, input.orderLineItemId ?? null, input.coffeeId, input.rating ?? null, input.expectation ?? null, input.rawText ?? null, input.supersedesId ?? null, input.channel]);
}
async function feedbackBackfill(input: FeedbackInput & BackfillFields, runner: Runner): Promise<FactResult> {
  await assertOwner(runner);
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_feedback_event',
    ['user_id', 'occurred_at', 'recorded_at', 'source', 'source_id', 'catalog_version', 'order_line_item_id', 'coffee_id', 'rating', 'expectation', 'raw_text', 'supersedes_id', 'channel'],
    [input.userId, input.occurredAt, input.recordedAt ?? input.occurredAt, input.source, input.sourceId, catalogVersion, input.orderLineItemId ?? null, input.coffeeId, input.rating ?? null, input.expectation ?? null, input.rawText ?? null, input.supersedesId ?? null, input.channel]);
}
const feedback = Object.assign(feedbackFn, { backfill: feedbackBackfill });

// ── customer_feedback_descriptor (common columns minus catalog_version) ──────
export interface FeedbackDescriptorInput {
  userId: string;
  source: FactSource;
  feedbackEventId: string;
  cuppingNoteId: string;
}
async function feedbackDescriptorFn(input: FeedbackDescriptorInput, tx?: Tx): Promise<FactResult> {
  const runner = tx ?? db;
  const sourceId = `${input.feedbackEventId}:${input.cuppingNoteId}`;
  return insertFact(runner, 'customer_feedback_descriptor',
    ['user_id', 'source', 'source_id', 'feedback_event_id', 'cupping_note_id'],
    [input.userId, input.source, sourceId, input.feedbackEventId, input.cuppingNoteId]);
}
async function feedbackDescriptorBackfill(input: FeedbackDescriptorInput & BackfillFields, runner: Runner): Promise<FactResult> {
  await assertOwner(runner);
  const sourceId = `${input.feedbackEventId}:${input.cuppingNoteId}`;
  return insertFact(runner, 'customer_feedback_descriptor',
    ['user_id', 'occurred_at', 'recorded_at', 'source', 'source_id', 'feedback_event_id', 'cupping_note_id'],
    [input.userId, input.occurredAt, input.recordedAt ?? input.occurredAt, input.source, sourceId, input.feedbackEventId, input.cuppingNoteId]);
}
const feedbackDescriptor = Object.assign(feedbackDescriptorFn, { backfill: feedbackDescriptorBackfill });

// ── customer_brew_profile_change ──────────────────────────────────────────────
export interface BrewProfileChangeInput extends CommonFields {
  userId: string;
  /** a brew_profile_field code (FK); validated at the door against the field rows (Usual Drink 1, B1) */
  field: string;
  value?: string | null;
  /** a brew_profile_op code (FK): set, add, remove, clear, declined */
  op: string;
  sessionId?: number | null;
  /** quiz writer only (D12) */
  quizSessionId?: string | null;
  /** the customer's own words, only on a value that accepts them (D17) */
  customerWords?: string | null;
}

/** A brew-profile write the door refuses (Usual Drink 1, B1): counted in brew_profile.failures; callers answer 400, never 500. */
export class BrewProfileChangeRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrewProfileChangeRejected';
  }
}

/** The door's checks: field exists and is active, op fits the field's kind, value and words match the field rows. */
export function checkBrewProfileChange(input: BrewProfileChangeInput): string | null {
  const cfg = getBrewProfileFieldsConfig()[input.field];
  if (!cfg) return `unknown or inactive field '${input.field}'`;
  const isArray = cfg.type === 'array' || cfg.type === 'array_freeform';
  const valueOps = isArray ? ['set', 'add', 'remove'] : ['set'];
  if (input.source === 'quiz' && !input.quizSessionId) return 'a quiz row carries its quiz_session_id';
  if (input.source !== 'quiz' && input.quizSessionId) return 'only the quiz writer sets quiz_session_id';
  if (input.op === 'clear' || input.op === 'declined') {
    if (input.value != null) return `${input.op} carries value NULL`;
    if (input.customerWords) return `${input.op} carries no words`;
    if (input.op === 'declined' && input.source !== 'quiz' && input.source !== 'onsite') return 'declined comes from the card or the profile';
    return null;
  }
  if (!valueOps.includes(input.op)) return `op '${input.op}' does not fit ${cfg.type} field ${cfg.code}`;
  let parsed: unknown;
  try { parsed = JSON.parse(String(input.value)); } catch { return 'value is not JSON'; }
  const items: unknown[] = input.op === 'set' && isArray ? (Array.isArray(parsed) ? parsed : [null]) : [parsed];
  if (input.op === 'set' && isArray) {
    if (cfg.maxLength !== undefined && items.length > cfg.maxLength) return `${cfg.code} takes at most ${cfg.maxLength} values`;
    if (new Set(items.map(String)).size !== items.length) return `${cfg.code} has a duplicate value`;
  }
  for (const item of items) {
    if (cfg.type === 'array_freeform') {
      if (typeof item !== 'string' || !item.trim() || (cfg.maxItemLength !== undefined && item.length > cfg.maxItemLength)) return `invalid item for ${cfg.code}`;
    } else if (cfg.type === 'bool') {
      if (typeof item !== 'boolean' || !cfg.allowedValues?.includes(String(item))) return `invalid value for ${cfg.code}`;
    } else if (input.op === 'remove') {
      if (!cfg.values.some(v => v.code === item)) return `unknown value for ${cfg.code}`;
    } else if (typeof item !== 'string' || !cfg.allowedValues?.includes(item)) {
      return `invalid value for ${cfg.code}`;
    }
  }
  if (input.customerWords) {
    const takesWords = items.some(i => cfg.values.find(v => v.code === i)?.acceptsWords === true);
    if (!takesWords) return `${cfg.code} does not take words for this value`;
    if (cfg.maxItemLength === undefined || input.customerWords.length > cfg.maxItemLength) return `words for ${cfg.code} are over the cap`;
  }
  return null;
}

async function brewProfileChangeFn(input: BrewProfileChangeInput, tx?: Tx): Promise<FactResult> {
  const runner = tx ?? db;
  const problem = checkBrewProfileChange(input);
  if (problem) {
    await incrementBrewProfileCounter('failures');
    console.warn(`[customerFacts:brew-profile] rejected source=${input.source} field=${input.field} op=${input.op}: ${problem}`);
    throw new BrewProfileChangeRejected(problem);
  }
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_brew_profile_change',
    ['user_id', 'source', 'source_id', 'catalog_version', 'field', 'value', 'op', 'session_id', 'quiz_session_id', 'customer_words'],
    [input.userId, input.source, input.sourceId, catalogVersion, input.field, input.value ?? null, input.op, input.sessionId ?? null,
     input.quizSessionId ?? null, input.customerWords ?? null]);
}
async function brewProfileChangeBackfill(input: BrewProfileChangeInput & BackfillFields, runner: Runner): Promise<FactResult> {
  await assertOwner(runner);
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_brew_profile_change',
    ['user_id', 'occurred_at', 'recorded_at', 'source', 'source_id', 'catalog_version', 'field', 'value', 'op', 'session_id'],
    [input.userId, input.occurredAt, input.recordedAt ?? input.occurredAt, input.source, input.sourceId, catalogVersion, input.field, input.value ?? null, input.op, input.sessionId ?? null]);
}
const brewProfileChange = Object.assign(brewProfileChangeFn, { backfill: brewProfileChangeBackfill });

// ── customer_dial_event ───────────────────────────────────────────────────────
export interface DialEventInput extends CommonFields {
  userId: string;
  eventType: 'explicit_save' | 'add_to_cart';
  slotId?: number | null;
  coffeeId?: number | null;
  archetypeCode?: string | null;
  /** Family Household 2 (D27): the member who turned this dial for the profile's person; NULL/absent = self. */
  actorUserId?: string | null;
}
async function dialEventFn(input: DialEventInput, tx?: Tx): Promise<FactResult> {
  const runner = tx ?? db;
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_dial_event',
    ['user_id', 'source', 'source_id', 'catalog_version', 'event_type', 'slot_id', 'coffee_id', 'archetype_code', 'actor_user_id'],
    [input.userId, input.source, input.sourceId, catalogVersion, input.eventType, input.slotId ?? null, input.coffeeId ?? null, input.archetypeCode ?? null, input.actorUserId ?? null]);
}
async function dialEventBackfill(input: DialEventInput & BackfillFields, runner: Runner): Promise<FactResult> {
  await assertOwner(runner);
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_dial_event',
    ['user_id', 'occurred_at', 'recorded_at', 'source', 'source_id', 'catalog_version', 'event_type', 'slot_id', 'coffee_id', 'archetype_code'],
    [input.userId, input.occurredAt, input.recordedAt ?? input.occurredAt, input.source, input.sourceId, catalogVersion, input.eventType, input.slotId ?? null, input.coffeeId ?? null, input.archetypeCode ?? null]);
}
const dialEvent = Object.assign(dialEventFn, { backfill: dialEventBackfill });

// ── customer_liam_recommendation ──────────────────────────────────────────────
export interface LiamRecommendationInput extends CommonFields {
  userId: string;
  sessionId: number;
  turn: number;
  messageId: string;
  coffeeId?: number | null;
  slotId?: number | null;
  candidateCoffeeIds: number[];
  palateReadVersion?: string | null;
  detected?: boolean;
}
async function liamRecommendationFn(input: LiamRecommendationInput, tx?: Tx): Promise<FactResult> {
  const runner = tx ?? db;
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_liam_recommendation',
    ['user_id', 'source', 'source_id', 'catalog_version', 'session_id', 'turn', 'message_id', 'coffee_id', 'slot_id', 'candidate_coffee_ids', 'palate_read_version', 'detected'],
    [input.userId, input.source, input.sourceId, catalogVersion, input.sessionId, input.turn, input.messageId, input.coffeeId ?? null, input.slotId ?? null, input.candidateCoffeeIds, input.palateReadVersion ?? null, input.detected ?? false]);
}
async function liamRecommendationBackfill(input: LiamRecommendationInput & BackfillFields, runner: Runner): Promise<FactResult> {
  await assertOwner(runner);
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_liam_recommendation',
    ['user_id', 'occurred_at', 'recorded_at', 'source', 'source_id', 'catalog_version', 'session_id', 'turn', 'message_id', 'coffee_id', 'slot_id', 'candidate_coffee_ids', 'palate_read_version', 'detected'],
    [input.userId, input.occurredAt, input.recordedAt ?? input.occurredAt, input.source, input.sourceId, catalogVersion, input.sessionId, input.turn, input.messageId, input.coffeeId ?? null, input.slotId ?? null, input.candidateCoffeeIds, input.palateReadVersion ?? null, input.detected ?? false]);
}
const liamRecommendation = Object.assign(liamRecommendationFn, { backfill: liamRecommendationBackfill });

// ── customer_liam_question ────────────────────────────────────────────────────
export interface LiamQuestionInput extends CommonFields {
  userId: string;
  sessionId: number;
  turn: number;
  messageId: string;
  kind: 'thread' | 'palate' | 'brew';
  archetypeCode?: string | null;
  question: string;
}
async function liamQuestionFn(input: LiamQuestionInput, tx?: Tx): Promise<FactResult> {
  const runner = tx ?? db;
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_liam_question',
    ['user_id', 'source', 'source_id', 'catalog_version', 'session_id', 'turn', 'message_id', 'kind', 'archetype_code', 'question'],
    [input.userId, input.source, input.sourceId, catalogVersion, input.sessionId, input.turn, input.messageId, input.kind, input.archetypeCode ?? null, input.question]);
}
async function liamQuestionBackfill(input: LiamQuestionInput & BackfillFields, runner: Runner): Promise<FactResult> {
  await assertOwner(runner);
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_liam_question',
    ['user_id', 'occurred_at', 'recorded_at', 'source', 'source_id', 'catalog_version', 'session_id', 'turn', 'message_id', 'kind', 'archetype_code', 'question'],
    [input.userId, input.occurredAt, input.recordedAt ?? input.occurredAt, input.source, input.sourceId, catalogVersion, input.sessionId, input.turn, input.messageId, input.kind, input.archetypeCode ?? null, input.question]);
}
const liamQuestion = Object.assign(liamQuestionFn, { backfill: liamQuestionBackfill });

// ── customer_liam_reply (the reply side of customer_liam_question) ───────────
export interface LiamReplyInput extends CommonFields {
  userId: string;
  questionId: string;
  reply: string;
  messageId: string;
}
async function liamReplyFn(input: LiamReplyInput, tx?: Tx): Promise<FactResult> {
  const runner = tx ?? db;
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_liam_reply',
    ['user_id', 'source', 'source_id', 'catalog_version', 'question_id', 'reply', 'message_id'],
    [input.userId, input.source, input.sourceId, catalogVersion, input.questionId, input.reply, input.messageId]);
}
async function liamReplyBackfill(input: LiamReplyInput & BackfillFields, runner: Runner): Promise<FactResult> {
  await assertOwner(runner);
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_liam_reply',
    ['user_id', 'occurred_at', 'recorded_at', 'source', 'source_id', 'catalog_version', 'question_id', 'reply', 'message_id'],
    [input.userId, input.occurredAt, input.recordedAt ?? input.occurredAt, input.source, input.sourceId, catalogVersion, input.questionId, input.reply, input.messageId]);
}
const liamReply = Object.assign(liamReplyFn, { backfill: liamReplyBackfill });

// ── customer_liam_action ──────────────────────────────────────────────────────
export interface LiamActionInput extends CommonFields {
  userId: string;
  sessionId: number;
  messageId: string;
  actionType: 'open_dial' | 'retake_quiz' | 'save_recipe';
}
async function liamActionFn(input: LiamActionInput, tx?: Tx): Promise<FactResult> {
  const runner = tx ?? db;
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_liam_action',
    ['user_id', 'source', 'source_id', 'catalog_version', 'session_id', 'message_id', 'action_type'],
    [input.userId, input.source, input.sourceId, catalogVersion, input.sessionId, input.messageId, input.actionType]);
}
async function liamActionBackfill(input: LiamActionInput & BackfillFields, runner: Runner): Promise<FactResult> {
  await assertOwner(runner);
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_liam_action',
    ['user_id', 'occurred_at', 'recorded_at', 'source', 'source_id', 'catalog_version', 'session_id', 'message_id', 'action_type'],
    [input.userId, input.occurredAt, input.recordedAt ?? input.occurredAt, input.source, input.sourceId, catalogVersion, input.sessionId, input.messageId, input.actionType]);
}
const liamAction = Object.assign(liamActionFn, { backfill: liamActionBackfill });

// ── customer_bag_claim ────────────────────────────────────────────────────────
export interface BagClaimInput extends CommonFields {
  userId: string;
  qrScanEventId?: number | null;
  orderLineItemId?: string | null;
  coffeeId: number;
}
async function bagClaimFn(input: BagClaimInput, tx?: Tx): Promise<FactResult> {
  const runner = tx ?? db;
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_bag_claim',
    ['user_id', 'source', 'source_id', 'catalog_version', 'qr_scan_event_id', 'order_line_item_id', 'coffee_id'],
    [input.userId, input.source, input.sourceId, catalogVersion, input.qrScanEventId ?? null, input.orderLineItemId ?? null, input.coffeeId]);
}
async function bagClaimBackfill(input: BagClaimInput & BackfillFields, runner: Runner): Promise<FactResult> {
  await assertOwner(runner);
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'customer_bag_claim',
    ['user_id', 'occurred_at', 'recorded_at', 'source', 'source_id', 'catalog_version', 'qr_scan_event_id', 'order_line_item_id', 'coffee_id'],
    [input.userId, input.occurredAt, input.recordedAt ?? input.occurredAt, input.source, input.sourceId, catalogVersion, input.qrScanEventId ?? null, input.orderLineItemId ?? null, input.coffeeId]);
}
const bagClaim = Object.assign(bagClaimFn, { backfill: bagClaimBackfill });

// ── catalog_change (the one customer_-less fact — no user_id) ────────────────
// Its own source vocabulary (Part D): 'catalogService' for every verb-driven
// write; 'backfill' reserved for a future backfill, same as every other fact.
export type CatalogChangeSource = 'catalogService' | 'backfill';
export interface CatalogChangeInput {
  source: CatalogChangeSource;
  sourceId: string;
  catalogVersion?: string;
  entity: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  changedBy?: string | null;
}
async function catalogChangeFn(input: CatalogChangeInput, tx?: Tx): Promise<FactResult> {
  const runner = tx ?? db;
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'catalog_change',
    ['source', 'source_id', 'catalog_version', 'entity', 'entity_id', 'action', 'before', 'after', 'changed_by'],
    [input.source, input.sourceId, catalogVersion, input.entity, input.entityId, input.action,
     input.before !== undefined ? JSON.stringify(input.before) : null,
     input.after !== undefined ? JSON.stringify(input.after) : null,
     input.changedBy ?? null]);
}
async function catalogChangeBackfill(input: CatalogChangeInput & BackfillFields, runner: Runner): Promise<FactResult> {
  await assertOwner(runner);
  const catalogVersion = await resolveCatalogVersion(runner, input.catalogVersion);
  return insertFact(runner, 'catalog_change',
    ['occurred_at', 'recorded_at', 'source', 'source_id', 'catalog_version', 'entity', 'entity_id', 'action', 'before', 'after', 'changed_by'],
    [input.occurredAt, input.recordedAt ?? input.occurredAt, input.source, input.sourceId, catalogVersion, input.entity, input.entityId, input.action,
     input.before !== undefined ? JSON.stringify(input.before) : null,
     input.after !== undefined ? JSON.stringify(input.after) : null,
     input.changedBy ?? null]);
}
const catalogChange = Object.assign(catalogChangeFn, { backfill: catalogChangeBackfill });

// ── customer_match_decision + customer_match_candidate (Ella's Bloom Map 3, 2026-11-12) ──
// Called only by matchService.decide (the one door for a match decision,
// G2.6). The decision and its candidates go in the caller's transaction;
// a repeat (source, source_id) writes nothing (inserted: false) and adds no
// candidates. Insert-only: the guard trigger refuses UPDATE and DELETE.
export type MatchSource = 'quiz' | 'map' | 'beat' | 'liam' | 'admin';
export interface MatchCandidateInput { coffeeId: number; moveId: number; rank: number; distance: number | null }
export interface MatchDecisionInput {
  userId: string;
  actorUserId?: string | null;
  versionId: number;
  moveId: number;
  fromCoffeeId?: number | null;
  pickedCoffeeId: number;
  source: MatchSource;
  sourceId: string;
  inputs: Record<string, unknown>;
  candidates: MatchCandidateInput[];
}
async function matchDecisionFn(input: MatchDecisionInput, tx: Tx): Promise<FactResult> {
  const r = await insertFact(tx, 'customer_match_decision',
    ['user_id', 'actor_user_id', 'version_id', 'move_id', 'from_coffee_id', 'picked_coffee_id', 'source', 'source_id', 'inputs'],
    [input.userId, input.actorUserId ?? null, input.versionId, input.moveId, input.fromCoffeeId ?? null, input.pickedCoffeeId,
     input.source, input.sourceId, JSON.stringify(input.inputs ?? {})]);
  if (!r.inserted || !r.id) return r;
  for (const c of input.candidates) {
    await tx.query(
      `INSERT INTO customer_match_candidate (decision_id, coffee_id, move_id, rank, distance, source, source_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (decision_id, coffee_id, move_id) DO NOTHING`,
      [r.id, c.coffeeId, c.moveId, c.rank, c.distance, input.source, `${input.sourceId}:${c.moveId}:${c.coffeeId}`]);
  }
  return r;
}
// Owner-only (like every .backfill): a historical decision with its own
// occurred_at, e.g. a later backfill of quiz rows from before brief 3 (OPEN_TASKS).
async function matchDecisionBackfill(input: MatchDecisionInput & { occurredAt: Date }, tx: Tx): Promise<FactResult> {
  await assertOwner(tx);
  const r = await insertFact(tx, 'customer_match_decision',
    ['user_id', 'actor_user_id', 'occurred_at', 'recorded_at', 'version_id', 'move_id', 'from_coffee_id', 'picked_coffee_id', 'source', 'source_id', 'inputs'],
    [input.userId, input.actorUserId ?? null, input.occurredAt, input.occurredAt, input.versionId, input.moveId, input.fromCoffeeId ?? null, input.pickedCoffeeId,
     input.source, input.sourceId, JSON.stringify(input.inputs ?? {})]);
  if (!r.inserted || !r.id) return r;
  for (const c of input.candidates) {
    await tx.query(
      `INSERT INTO customer_match_candidate (decision_id, coffee_id, move_id, rank, distance, source, source_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (decision_id, coffee_id, move_id) DO NOTHING`,
      [r.id, c.coffeeId, c.moveId, c.rank, c.distance, input.source, `${input.sourceId}:${c.moveId}:${c.coffeeId}`]);
  }
  return r;
}
const matchDecision = Object.assign(matchDecisionFn, { backfill: matchDecisionBackfill });

// ── The door. No update/delete/upsert export exists anywhere in this file —
// customerFacts.test.ts asserts this export surface by name. ─────────────────
export const record = {
  identityLink,
  identityUnlink,
  feedback,
  feedbackDescriptor,
  brewProfileChange,
  dialEvent,
  liamRecommendation,
  liamQuestion,
  liamReply,
  liamAction,
  bagClaim,
  catalogChange,
  matchDecision,
};
