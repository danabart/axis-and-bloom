// Ella's Bloom Map 2 (2026-11-10): the map workbench's calls, one per brief 1
// route (/api/admin/map/*). The lean decision is a catalog write and lives in
// catalogWrites.setLean. A non-2xx response throws the service's message.
import type { ApiFetch } from './catalogWrites';

export type MapMode = 'preview' | 'active';

async function call<T>(apiFetch: ApiFetch, url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message ?? body?.error ?? `Request failed (${res.status})`);
  return body as T;
}
const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

export interface SeamScore { archetype: string; score: number | null; words: number | null; body: number | null }
export interface MapRow {
  coffee_id: number; coffee_name: string; roaster_id: string; roaster_name: string;
  archetype_code: string; is_center: boolean; is_placeable?: boolean;
  ring: number | null; size: number | null;
  ruler_dimension_id: number | null; ruler_value: string | number | null;
  acidity: string | number | null; bitterness: string | number | null; body: string | number | null; sweetness: string | number | null;
  lane_code: string; decided_lane_code?: string | null; suggested_lane_code?: string | null;
  suggested_scores: { side_a?: SeamScore; side_b?: SeamScore } | null;
  grade_code: string; grade_rank: number; n_sessions: number; n_cuppers: string | number;
  is_sellable: boolean; in_stock: boolean; category_codes: string[];
  flags: string[]; inputs_used: Record<string, unknown>;
  version_label?: string;
}
export interface HopRow {
  from_coffee_id: number; to_coffee_id: number; from_archetype: string; relation: string; rank: number;
  in_hop_set: boolean; within_cap: boolean; distance: string; adjacency_rank: number | null;
  delta_ring: number | null; delta_body: string | null; delta_sweetness: string | null; delta_acidity: string | null; delta_bitterness: string | null;
  to_grade_rank: number; to_in_stock: boolean; to_category_codes: string[];
  from_coffee_name: string; to_coffee_name: string; move_line: string | null;
  deltas_mentioned: Array<{ reading: string; delta: number; phrase: string }>;
}
export interface GraphCheck {
  mode: MapMode; parameters: Record<string, number>; centers: string[]; sellable: number;
  reachable: string[]; unreachableSellable: string[]; reachableWithoutTagged: string[];
  noBolder: string[]; noGentler: string[]; noDifferent: string[]; noLiveDirection: string[];
  cousins: Array<{ a: string; b: string; aToB: string | null; bToA: string | null; reproduced: boolean }>;
}
export interface Version {
  id: number; label: string; status: string; reason: string | null; parameters: Record<string, number>;
  cut_by: string | null; cut_at: string; activated_at: string | null; retired_at: string | null; n_placements: number;
  ring_cuts: Array<{ ring: number; lo: number | null; hi: number | null }>; size_cuts: Array<{ size: number; lo: number | null; hi: number | null }>;
}
export interface Wedge {
  archetype_code: string; archetype_name: string; is_center: boolean; angle_order: number;
  ruler_dimension_id: number | null; ruler_dimension_name: string | null;
  side_a_archetype: string; side_b_archetype: string; seam_family: string | null;
}
export interface Seam { archetype_a: string; archetype_b: string; label: string | null; is_labelled: boolean; is_open?: boolean }
export interface FirstMatch {
  id: number; archetype_code: string; lane_code: string; coffee_id: number; coffee_name: string; status: string; notes: string | null;
  preview_grade: string | null; active_grade: string | null; min_grade_rank: number;
  meets_grade_floor_preview: boolean | null; meets_grade_floor_active: boolean | null;
}
export interface PhraseResolved { archetype_code: string; move_code: string; button_label: string; move_line_template: string | null; edge_phrase: string | null; is_override: boolean }
export interface PhraseRow { id: number; archetype_code: string | null; move_code: string; button_label: string; move_line_template: string | null; edge_phrase: string | null }
export interface Vocabulary {
  lanes: Array<{ code: string; label: string }>;
  /** OT-123: per wedge, each lane's words with {side} resolved (Leans Fruity, Middle, Leans Earthy) */
  laneWords: Array<{ archetype_code: string; lane_code: string; label: string }>;
  grades: Array<{ code: string; label: string; rank: number; description: string }>;
  moves: Array<{ code: string; label: string; is_customer_move: boolean }>;
  versionStatuses: Array<{ code: string; label: string }>;
  firstMatchStatuses: Array<{ code: string; label: string }>;
  sizes: Array<{ code: number; label: string; customer_label: string | null }>;
  rings: Array<{ code: number; label: string }>;
  /** Ella map 5: dial_step_basis */
  stepBases: Array<{ code: string; label: string; sort_order: number; line_style: string }>;
  flags: Array<{ code: string; label: string; description: string }>;
  readings: Array<{ code: string; label: string; dimension_id: number }>;
  deltaPhrases: Array<{ reading: string; direction: string; sign: number; phrase: string }>;
  /** Ella map 7: every lane of every family and whether it may be offered (a closed side is not) */
  wedgeLanes: Array<{ archetype_code: string; lane_code: string; toward_archetype: string | null; is_open: boolean }>;
  startConditions: Array<{ code: string; label: string; sort_order: number }>;
}
/** Ella map 7: one row of the start rule (v_dial_start_rule) */
export interface StartRule {
  id: number; family_code: string; family_name: string; family_order: number | null; priority: number;
  condition_code: string; condition_label: string; also_condition_code: string | null; also_condition_label: string | null;
  coffee_id: number; coffee_name: string; admin_label: string; customer_reason: string; notes: string | null;
  decided_by: string | null; created_at: string; superseded_at: string | null; is_current: boolean;
  /** Ella map 9: the first bag's personal line and its lead */
  coffee_line: string | null; lead_to_coffee_id: number | null; lead_to_coffee_name: string | null;
  lead_line: string | null; lead_quote_family_code: string | null;
}
export interface LeanHistoryRow {
  id: number; lane_code: string; suggested_lane_code: string | null; notes: string | null; basis: Record<string, unknown> | null;
  decided_by: string | null; created_at: string; superseded_at: string | null; is_current: boolean;
}

const B = '/api/admin/map';
export const getPlacements = (f: ApiFetch, mode: MapMode) => call<MapRow[]>(f, mode === 'preview' ? `${B}/preview` : `${B}/placement`);
export const getHops = (f: ApiFetch, mode: MapMode, coffeeId?: number) =>
  call<HopRow[]>(f, `${B}/hops?mode=${mode}${coffeeId ? `&coffeeId=${coffeeId}` : ''}`);
export const getGraphCheck = (f: ApiFetch, mode: MapMode) => call<GraphCheck>(f, `${B}/graph-check?mode=${mode}`);
export const getVersions = (f: ApiFetch) => call<Version[]>(f, `${B}/versions`);
export const getWedges = (f: ApiFetch) => call<{ wedges: Wedge[]; seams: Seam[] }>(f, `${B}/wedges`);
export const getFirstMatches = (f: ApiFetch) => call<FirstMatch[]>(f, `${B}/first-match`);
export const getPhrases = (f: ApiFetch) => call<{ rows: PhraseRow[]; resolved: PhraseResolved[] }>(f, `${B}/phrases`);
export const getVocabulary = (f: ApiFetch) => call<Vocabulary>(f, `${B}/vocabulary`);
export const getLeanHistory = (f: ApiFetch, coffeeId: number) => call<LeanHistoryRow[]>(f, `${B}/lean/${coffeeId}/history`);

export const cutVersion = (f: ApiFetch, body: { label: string; reason: string }) =>
  call<{ versionId: number; label: string; created: boolean; placements: number }>(f, `${B}/versions`, json('POST', body));
export const activateVersion = (f: ApiFetch, id: number) =>
  call<{ versionId: number; retiredVersionId: number | null }>(f, `${B}/versions/${id}/activate`, json('POST', {}));
export const setFirstMatch = (f: ApiFetch, body: { archetype: string; lane: string; coffeeId: number; status?: string; notes?: string | null }) =>
  call<{ id: number; unchanged: boolean }>(f, `${B}/first-match`, json('PUT', body));
export const getStartRules = (f: ApiFetch, history = false) => call<StartRule[]>(f, `${B}/start-rules${history ? '?history=1' : ''}`);
export const setStartRule = (f: ApiFetch, body: {
  family: string; priority: number; condition: string; alsoCondition: string | null; coffeeId: number;
  adminLabel: string; customerReason: string; notes?: string | null;
  coffeeLine?: string | null; leadToCoffeeId?: number | null; leadLine?: string | null; leadQuoteFamily?: string | null;
}) => call<{ id: number; unchanged: boolean; supersededId: number | null }>(f, `${B}/start-rules`, json('PUT', body));
export const setPhrase = (f: ApiFetch, body: { archetype: string | null; move: string; buttonLabel: string; moveLineTemplate?: string | null; edgePhrase?: string | null }) =>
  call<{ id: number; unchanged: boolean }>(f, `${B}/phrases`, json('PUT', body));

// ── Ella's Bloom Map 3 (2026-11-12): the switch, the decisions, the customer words ──
export interface SurfaceRow { id: number; code: string; label: string; model_code: string; model_label: string; updated_by: string | null; updated_at: string }
export interface DecisionCandidate { coffee_id: number; coffee_name: string; move_code: string; rank: number; distance: string | number | null }
export interface DecisionRow {
  decision_id: string; canonical_user_id: string; user_id: string; actor_user_id: string | null; occurred_at: string; step: number;
  move_code: string; source: string; source_id: string; version_label: string;
  from_coffee_id: number | null; from_coffee_name: string | null; picked_coffee_id: number; picked_coffee_name: string;
  inputs: Record<string, unknown>; candidates: DecisionCandidate[];
}
export interface CustomerCopyRow { id: number; code: string; text: string; decided_by: string | null; created_at: string }
export const getSurfaces = (f: ApiFetch) => call<SurfaceRow[]>(f, `${B}/surfaces`);
export const setSurface = (f: ApiFetch, code: string, model: 'lane' | 'map') =>
  call<{ code: string; model: string; unchanged: boolean }>(f, `${B}/surfaces/${encodeURIComponent(code)}`, json('PATCH', { model }));
export const getDecisions = (f: ApiFetch, userId?: string) =>
  call<DecisionRow[]>(f, `${B}/decisions?limit=25${userId ? `&userId=${encodeURIComponent(userId)}` : ''}`);
export const getCustomerCopy = (f: ApiFetch) => call<CustomerCopyRow[]>(f, `${B}/customer-copy`);
export const setCustomerCopy = (f: ApiFetch, body: { code: string; text: string }) =>
  call<{ id: number; unchanged: boolean }>(f, `${B}/customer-copy`, json('PUT', body));

// ── Ella's Bloom Map 5 (2026-11-16): the decided map ──
export interface StepRow {
  id: number; from_coffee_id: number; from_coffee_name: string; to_coffee_id: number; to_coffee_name: string;
  button_word: string; customer_line: string | null; basis_code: string; basis_label: string; line_style: string;
  basis_sort_order: number; is_shown: boolean; notes: string | null; decided_by: string | null; created_at: string;
  is_current: boolean; is_in_active_version: boolean; on_active_map: boolean;
  /** Ella map 9: the direction the step answers and its card's opening clause */
  move_code: string | null; when_line: string | null;
}
export interface DecidedPlacement {
  coffee_id: number; coffee_name: string; roaster_name: string; archetype_code: string; is_center: boolean;
  ring: number; lane_code: string; size: number | null; is_sellable: boolean; in_stock: boolean; flags: string[]; grade_code: string;
}
export interface DecisionNow {
  coffee_id: number; coffee_name: string; roaster_id: string; roaster_name: string; archetype_code: string; is_center: boolean;
  is_placeable: boolean; ring: number | null; decided_ring: number | null; calculated_ring: number | null; ring_assignment_id: number | null;
  lane_code: string; decided_lane_code: string | null; size: number | null; roaster_sweetness: number | null; flags: string[];
}
export interface RoasterFacts {
  coffeeId: number; submittedAt: string;
  dimensions: Array<{ dimension_id: number; label: string; low_label: string; high_label: string; value: number }>;
  notes: Array<{ rank: number; roaster_words: string; cupping_note_id: string | null }>;
}
/** Ella map 8 (C4): a coffee's buyability at the anchor size (v_dial_coffee_availability). */
export interface CoffeeAvailability {
  coffee_id: number; is_sellable: boolean; size_label: string | null; price_cents: number | null;
  has_sku: boolean; has_price: boolean; map_name: string;
}
export interface DecidedMap {
  version: { id: number; label: string; reason: string | null; cut_at: string; activated_at: string } | null;
  availability: CoffeeAvailability[];
  placements: DecidedPlacement[];
  activeSteps: StepRow[];
  steps: StepRow[];
  decisions: DecisionNow[];
  roaster: RoasterFacts[];
  unpublished: { family: number; lean: number; ring: number; step: number; total: number; cut_at: string | null };
}
export interface RingHistoryRow {
  id: number; ring: number; ring_label: string | null; suggested_ring: number | null; notes: string | null;
  basis: Record<string, unknown> | null; decided_by: string | null; created_at: string; is_current: boolean;
}
export const getDecidedMap = (f: ApiFetch) => call<DecidedMap>(f, `${B}/decided`);
export const getRingHistory = (f: ApiFetch, coffeeId: number) => call<RingHistoryRow[]>(f, `${B}/ring/${coffeeId}/history`);
export const setStep = (f: ApiFetch, body: { from: number; to: number; word: string; line: string | null; basis: string; shown: boolean; move?: string | null; whenLine?: string | null }) =>
  call<{ id: number; unchanged: boolean }>(f, `${B}/steps`, json('PUT', body));

// â”€â”€ Ella's Bloom Map 9 (2026-11-20): what we say back, and "Read it as" â”€â”€
export interface SaidBackFact {
  source_code: string; fact_code: string; fact_label: string; context: string | null; context_group: string | null;
  q_number: number | null; weight: string | number | null; is_quotable: boolean; said_back_id: number | null; says_back: string | null; is_quoted: boolean | null;
}
export interface MapCustomerHit { profile_id: string; email: string; has_quiz: boolean; has_position: boolean }
export const getSaidBack = (f: ApiFetch) => call<SaidBackFact[]>(f, `${B}/said-back`);
export const setSaidBack = (f: ApiFetch, body: { source: string; fact: string; saysBack: string | null; isQuoted?: boolean }) =>
  call<{ id: number | null; unchanged: boolean }>(f, `${B}/said-back`, json('PUT', body));
export const searchMapCustomers = (f: ApiFetch, q: string) => call<MapCustomerHit[]>(f, `${B}/customers?q=${encodeURIComponent(q)}`);
export const getReasons = (f: ApiFetch, profileId: string) =>
  call<import('./mapCustomer').MapSteps>(f, `${B}/reasons?profileId=${encodeURIComponent(profileId)}`);
export const setRing = (f: ApiFetch, coffeeId: number, body: { ring: number; basis: string }) =>
  call<{ result: { coffeeId: number; unchanged: boolean } }>(f, `${B}/ring/${coffeeId}`, json('PATCH', body));
export const publishMap = (f: ApiFetch, body: { label: string; reason: string }) =>
  call<{ versionId: number; label: string; placements: number; retiredVersionId: number | null }>(f, `${B}/publish`, json('POST', body));
