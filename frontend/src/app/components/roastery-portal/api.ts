// Roastery portal (2026-10-05) — plain fetch helpers for /api/roastery-portal.
// The token in the URL is the only credential: no Authorization header, no
// Firebase session, nothing from the site's own API client.

import type { Landing, LineupRow, PortalResponse } from './types';
import { PortalApiError, docToWire, type PortalClient } from './apiShared';

export { PortalApiError, docToWire };

const BASE = '/api/roastery-portal';

async function call<T>(method: string, path: string, body?: unknown, keepalive = false): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    cache: 'no-store',
    keepalive,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* an empty or non-JSON body: handled by status below */ }
  if (!res.ok) throw new PortalApiError(res.status, data?.error ?? 'error', data?.message ?? `Request failed (${res.status})`);
  return data as T;
}

const enc = encodeURIComponent;

export const portalApi: PortalClient = {
  landing: (token: string) => call<Landing>('GET', `/${enc(token)}`),
  registerRespondent: (token: string, name: string, email: string) =>
    call<{ respondentId: string; name: string }>('POST', `/${enc(token)}/respondent`, { name, email }),
  addCoffee: (token: string, name: string, respondentId: string) =>
    call<{ id: string; name: string }>('POST', `/${enc(token)}/coffees`, { name, respondentId }),
  getCoffee: (token: string, id: string) =>
    call<{ coffee: LineupRow; response: PortalResponse | null }>('GET', `/${enc(token)}/coffees/${enc(id)}`),
  saveDraft: (token: string, id: string, respondentId: string, doc: unknown, keepalive = false) =>
    call<{ responseId: string; version: number; updatedAt: string }>('PUT', `/${enc(token)}/coffees/${enc(id)}/draft`, { respondentId, doc }, keepalive),
  submit: (token: string, id: string, respondentId: string) =>
    call<{ version: number; submittedAt: string }>('POST', `/${enc(token)}/coffees/${enc(id)}/submit`, { respondentId }),
  saveLineup: (token: string, respondentId: string, doc: { typicalNotice: string | null; similarWhenOut: string | null; bestSellers: string[] }) =>
    call<{ responseId: string; version: number }>('PUT', `/${enc(token)}/lineup`, { respondentId, doc }),
  submitLineup: (token: string, respondentId: string) =>
    call<{ version: number; submittedAt: string }>('POST', `/${enc(token)}/lineup/submit`, { respondentId }),
};
