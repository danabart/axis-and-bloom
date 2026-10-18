// Cupping evidence brief 4 (2026-10-18): the admin catalog and acceptance
// calls in one place, so the Calibration workbench and the Coffees page
// dialogs send the same requests to the same existing endpoints (there were
// only inline fetches before). No new endpoint: each function is one call to a
// route that already existed; brief 4 adds only `basis` (match, placements)
// and `placedFromSessionId` (placements) to their bodies. A non-2xx response
// throws an Error carrying the service's own message, verbatim.

export type ApiFetch = (url: string, options?: RequestInit) => Promise<Response>;

export interface CatalogWarning { kind: string; [k: string]: unknown }

async function call<T>(apiFetch: ApiFetch, url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message ?? body?.error ?? `Request failed (${res.status})`);
  return body as T;
}
const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

/** PUT /api/admin/catalog/coffees/:id/match (catalogService.setMatchArchetype). */
export function setMatch(apiFetch: ApiFetch, coffeeId: number, body: {
  archetype: string; confidence: string; source: 'cupping' | 'manual' | 'import';
  sessionId?: number | null; notes?: string; basis?: Record<string, unknown>;
}): Promise<{ coffeeId: number; warnings: CatalogWarning[] }> {
  return call(apiFetch, `/api/admin/catalog/coffees/${coffeeId}/match`, json('PUT', { ...body, sessionId: body.sessionId ?? undefined }));
}

/** GET /api/admin/catalog/placement-preview (catalogService.previewPlacement). */
export function previewPlacement(apiFetch: ApiFetch, coffeeId: number, slotId: number, role: 'home' | 'guest'): Promise<{ warnings: CatalogWarning[] } & Record<string, unknown>> {
  return call(apiFetch, `/api/admin/catalog/placement-preview?coffeeId=${coffeeId}&slotId=${slotId}&role=${role}`);
}

/** POST /api/admin/catalog/coffees/:id/placements (catalogService.placeCoffee). */
export function placeCoffee(apiFetch: ApiFetch, coffeeId: number, body: {
  slotId: number; role: 'home' | 'guest'; priority?: number; placementNote?: string;
  basis?: Record<string, unknown>; placedFromSessionId?: number | null;
}): Promise<{ assignmentId: number; warnings: CatalogWarning[] }> {
  return call(apiFetch, `/api/admin/catalog/coffees/${coffeeId}/placements`, json('POST', body));
}

/** POST /api/admin/catalog/coffees/:id/move (catalogService.moveCoffee). */
export function moveCoffee(apiFetch: ApiFetch, coffeeId: number, body: {
  toSlotId: number; priority?: number; placementNote?: string;
  basis?: Record<string, unknown>; placedFromSessionId?: number | null;
}): Promise<{ assignmentId: number; warnings: CatalogWarning[] }> {
  return call(apiFetch, `/api/admin/catalog/coffees/${coffeeId}/move`, json('POST', body));
}

/** POST /api/admin/catalog/coffees/:id/placements/:slotId/certify (catalogService.certifyPlacement). */
export function certifyPlacement(apiFetch: ApiFetch, coffeeId: number, slotId: number, body: { by: string; note?: string }): Promise<{ assignmentId: number }> {
  return call(apiFetch, `/api/admin/catalog/coffees/${coffeeId}/placements/${slotId}/certify`, json('POST', body));
}

/** GET /api/admin/roastery-portal/responses/:id/acceptance-preview (read-only). */
export function getAcceptancePreview<T = Record<string, unknown>>(apiFetch: ApiFetch, responseId: string): Promise<T> {
  return call(apiFetch, `/api/admin/roastery-portal/responses/${responseId}/acceptance-preview`);
}

/** POST /api/admin/roastery-portal/responses/:id/accept (roasteryPortalService.acceptResponse). */
export function acceptResponse<T = Record<string, unknown>>(apiFetch: ApiFetch, responseId: string, items: {
  basics?: Record<string, { include: boolean; value?: string }>;
  notes?: { rank: number; include: boolean; cuppingNoteId: string | null; remember: boolean }[];
}): Promise<T> {
  return call(apiFetch, `/api/admin/roastery-portal/responses/${responseId}/accept`, json('POST', { items }));
}
