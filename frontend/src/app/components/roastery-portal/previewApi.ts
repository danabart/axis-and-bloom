// Roastery portal (part 5, 2026-10-06) — the admin preview's API client. Same interface as the public client.
// It imports NOTHING from ./api and never calls /api/roastery-portal (a test enforces both).
//
// Reads (`landing`, `getCoffee`) call the two read-only admin endpoints with the admin's Firebase token. Every write
// (`registerRespondent`, `addCoffee`, `saveDraft`, `submit`, `saveLineup`, `submitLineup`) makes NO request: it
// resolves locally and the answer is remembered in this object only, so the screens behave as on the real form (the
// draft indicator, the move to the next coffee, a coffee row added for this session) and a refresh forgets it all.

import { PortalApiError, type PortalClient } from './apiShared';
import type { Landing, LineupRow, PortalResponse, CoffeeState } from './types';

export const PREVIEW_API_PREFIX = '/api/admin/roastery-portal/roasteries';

interface LocalDraft { doc: any; status: 'draft' | 'submitted'; version: number; updatedAt: string; submittedAt: string | null }

export function createPreviewClient(roasterId: string, getToken: () => Promise<string>, fetchFn: typeof fetch = (...a) => fetch(...a)): PortalClient {
  const drafts = new Map<string, LocalDraft>();
  const added: LineupRow[] = [];
  let lineupDoc: { typicalNotice: string | null; similarWhenOut: string | null; bestSellers: string[] } | null = null;
  let lineupSubmittedAt: string | null = null;
  let seq = 0;
  const who = { name: 'Preview' };

  async function read<T>(path: string): Promise<T> {
    const res = await fetchFn(`${PREVIEW_API_PREFIX}/${encodeURIComponent(roasterId)}${path}`, {
      method: 'GET',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${await getToken()}` },
    });
    let data: any = null;
    try { data = await res.json(); } catch { /* handled by status */ }
    if (!res.ok) throw new PortalApiError(res.status, data?.error ?? 'error', data?.message ?? `Request failed (${res.status})`);
    return data as T;
  }

  const stateOf = (d: LocalDraft | undefined, fallback: CoffeeState): CoffeeState => (d ? (d.status === 'submitted' ? 'submitted' : 'in_progress') : fallback);
  const now = () => new Date().toISOString();

  function overlayRow(row: LineupRow): LineupRow {
    const d = drafts.get(row.portalCoffeeId);
    if (!d) return row;
    return {
      ...row, state: stateOf(d, row.state), hasOpenDraft: d.status === 'draft', currentVersion: d.version,
      lastSavedAt: d.updatedAt, lastSavedByName: who.name,
      submittedAt: d.submittedAt ?? row.submittedAt, submittedByName: d.submittedAt ? who.name : row.submittedByName,
    };
  }

  function responseFrom(id: string, d: LocalDraft): PortalResponse {
    const w = d.doc ?? {};
    return {
      id: `preview-${id}`, portalCoffeeId: id, version: d.version, status: d.status,
      origin: w.origin || null, processValues: w.processValues ?? [], roastLevel: w.roastLevel ?? null, blendOrSingle: w.blendOrSingle ?? null,
      isDecaf: null, proposedArchetype: w.proposedArchetype ?? null, dominantDimensionId: w.dominantDimensionId ?? null, takesIt: w.takesIt ?? null,
      brewNotes: w.brewNotes || null, availability: w.availability ?? null, typicalNotice: w.typicalNotice ?? null,
      expectedAvailability: w.expectedAvailability || null, similarWhenOut: w.similarWhenOut ?? null,
      closestCousinPortalCoffeeId: w.closestCousinPortalCoffeeId ?? null, whatChanges: w.whatChanges || null, anythingElse: w.anythingElse || null,
      additivesPresent: w.additivesPresent ?? null, additivesDetail: w.additivesDetail || null, blendComponents: w.blendComponents || null,
      blendRotation: w.blendRotation ?? null, caffeineLevel: w.caffeineLevel ?? null, decafProcess: w.decafProcess ?? null,
      certifications: w.certifications ?? [],
      lastSavedByName: who.name, lastSavedByRespondentId: 'preview', submittedByName: d.submittedAt ? who.name : null,
      submittedByRespondentId: d.submittedAt ? 'preview' : null, createdAt: d.updatedAt, updatedAt: d.updatedAt, submittedAt: d.submittedAt,
      notes: (w.notes ?? []).filter((n: any) => (n.words ?? '').trim()).map((n: any, i: number) => ({
        rank: i + 1, roasterWords: n.words, cuppingNoteId: n.cuppingNoteId ?? null, descriptor: null, wheelCategory: null,
      })),
      dimensions: w.dimensions ?? {}, bestBrew: w.bestBrew ?? null, alsoGoodBrews: w.alsoGoodBrews ?? [],
    };
  }

  return {
    async landing() {
      const l = await read<Landing>('/preview');
      const lineup = [...l.lineup, ...added].map(overlayRow);
      return {
        ...l,
        lineup,
        counts: { total: lineup.length, submitted: lineup.filter(c => c.state === 'submitted').length },
        lineupResponse: lineupDoc
          ? {
              id: 'preview-lineup', version: 1, status: lineupSubmittedAt ? 'submitted' : 'draft',
              typicalNotice: lineupDoc.typicalNotice, similarWhenOut: lineupDoc.similarWhenOut, anythingElse: null,
              lastSavedByName: who.name, submittedByName: lineupSubmittedAt ? who.name : null, updatedAt: now(), submittedAt: lineupSubmittedAt,
              bestSellers: lineupDoc.bestSellers.map((pid, i) => ({ portalCoffeeId: pid, name: lineup.find(c => c.portalCoffeeId === pid)?.name ?? '', rank: i + 1 })),
            }
          : l.lineupResponse,
      };
    },

    async getCoffee(_token, id) {
      const local = added.find(c => c.portalCoffeeId === id);
      const [coffee, response] = local
        ? [local, null as PortalResponse | null]
        : await read<{ coffee: LineupRow; response: PortalResponse | null }>(`/preview/coffees/${encodeURIComponent(id)}`).then(r => [r.coffee, r.response] as const);
      const d = drafts.get(id);
      return { coffee: overlayRow(coffee), response: d ? responseFrom(id, d) : response };
    },

    async registerRespondent(_t, name) {
      who.name = name.trim() || 'Preview';
      return { respondentId: 'preview-respondent', name: who.name };
    },
    async addCoffee(_t, name) {
      const id = `preview-coffee-${++seq}`;
      added.push({
        portalCoffeeId: id, name: name.trim(), coffeeId: null, origin: null, processValues: [], roastLevel: null, blendOrSingle: null,
        isDecaf: null, prefillSource: null, addedBy: 'roaster', sortOrder: 1000 + seq, isActive: true, state: 'not_started', hasOpenDraft: false,
        sectionsAnswered: 0, currentVersion: null, lastSavedAt: null, lastSavedByName: null, submittedAt: null, submittedByName: null,
        submittedVersionCount: 0, hasUnmappedNotes: false,
      });
      return { id, name: name.trim() };
    },
    async saveDraft(_t, id, _r, doc) {
      const prev = drafts.get(id);
      const d: LocalDraft = { doc, status: 'draft', version: (prev?.version ?? 0) + (prev?.status === 'submitted' ? 1 : 0) || 1, updatedAt: now(), submittedAt: null };
      drafts.set(id, d);
      return { responseId: `preview-${id}`, version: d.version, updatedAt: d.updatedAt };
    },
    async submit(_t, id) {
      const prev = drafts.get(id);
      const at = now();
      drafts.set(id, { doc: prev?.doc ?? {}, status: 'submitted', version: prev?.version ?? 1, updatedAt: at, submittedAt: at });
      return { version: prev?.version ?? 1, submittedAt: at };
    },
    async saveLineup(_t, _r, doc) {
      lineupDoc = { ...doc };
      return { responseId: 'preview-lineup', version: 1 };
    },
    async submitLineup() {
      lineupSubmittedAt = now();
      return { version: 1, submittedAt: lineupSubmittedAt };
    },
  };
}
