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
export interface Seam { archetype_a: string; archetype_b: string; label: string | null; is_labelled: boolean }
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
  flags: Array<{ code: string; label: string; description: string }>;
  readings: Array<{ code: string; label: string; dimension_id: number }>;
  deltaPhrases: Array<{ reading: string; direction: string; sign: number; phrase: string }>;
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
