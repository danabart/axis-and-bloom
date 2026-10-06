// Roastery portal (part 5, 2026-10-06) — the pieces the public client (./api.ts) and the admin preview client
// (./previewApi.ts) both need. No fetch and no base URL in here, so the preview client can use it without ever
// touching /api/roastery-portal.

import type { Doc, Landing, LineupRow, PortalResponse } from './types';

export class PortalApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'PortalApiError';
  }
}

/** The wire document: the editor's Doc minus its local-only note keys. */
export function docToWire(doc: Doc) {
  return {
    ...doc,
    notes: doc.notes.map(n => ({ words: n.words, cuppingNoteId: n.cuppingNoteId })),
  };
}

/** The one interface the partner screens talk to. The public route passes `portalApi`; the admin preview passes a
 * client whose writes never leave the browser. */
export interface PortalClient {
  landing(token: string): Promise<Landing>;
  registerRespondent(token: string, name: string, email: string): Promise<{ respondentId: string; name: string }>;
  addCoffee(token: string, name: string, respondentId: string): Promise<{ id: string; name: string }>;
  getCoffee(token: string, id: string): Promise<{ coffee: LineupRow; response: PortalResponse | null }>;
  saveDraft(token: string, id: string, respondentId: string, doc: unknown, keepalive?: boolean): Promise<{ responseId: string; version: number; updatedAt: string }>;
  submit(token: string, id: string, respondentId: string): Promise<{ version: number; submittedAt: string }>;
  saveLineup(token: string, respondentId: string, doc: { typicalNotice: string | null; similarWhenOut: string | null; bestSellers: string[] }): Promise<{ responseId: string; version: number }>;
  submitLineup(token: string, respondentId: string): Promise<{ version: number; submittedAt: string }>;
}
