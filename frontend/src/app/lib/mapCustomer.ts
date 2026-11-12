// Ella's Bloom Map 3 (2026-11-12): the customer map's calls (/api/map/*). Every
// word on the map pages comes back from these calls (G4.2); a non-2xx response
// throws the service's message.
import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import type { ApiFetch } from './catalogWrites';
import type { FacePlacement, FaceWedge, FaceSeam } from '../components/bloom/map/EllaMapFace';

export class MapApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
async function call<T>(f: ApiFetch, url: string, init?: RequestInit): Promise<T> {
  const res = await f(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new MapApiError(res.status, body?.error ?? 'error', body?.message ?? body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export interface MapFaceData { versionLabel: string | null; placements: FacePlacement[]; wedges: FaceWedge[]; seams: FaceSeam[] }
export interface MapCard { coffeeId: number; name: string; moveLine: string | null; notes: string[]; compatibility: string | null; rank: number }
export interface MapMoveOption { move: 'stay' | 'bolder' | 'gentler' | 'different'; label: string; edge: boolean; edgePhrase: string | null; cards: MapCard[] }
export interface MapPosition {
  coffeeId: number; name: string; archetypeCode: string | null; isCenter: boolean; available: boolean;
  notes: string[]; compatibility: string | null; sentence: string | null; substitute: { coffeeId: number; name: string } | null;
}
export interface MapMoves { position: MapPosition | null; moves: MapMoveOption[]; copy: Record<string, string>; versionLabel: string | null }
export interface MapTrailStep {
  step: number; occurredAt: string; move: string; moveWord: string | null; coffeeId: number; name: string; byOther: boolean;
  onActiveMap: boolean;
}
export interface MapMe {
  position: null | { coffeeId: number; name: string; archetypeCode: string | null; isCenter: boolean; isInActiveVersion: boolean; available: boolean; sentence: string | null; move: string; byOther: boolean };
  trail: MapTrailStep[]; versionLabel: string | null; copy: Record<string, string>;
}

const B = '/api/map';
export const getMapSurfaces = (f: ApiFetch) => call<Record<string, string>>(f, `${B}/surfaces`);
export const getMapFace = (f: ApiFetch) => call<MapFaceData>(f, `${B}/face`);
export const getMapMe = (f: ApiFetch) => call<MapMe>(f, `${B}/me`);
export const getMapMoves = (f: ApiFetch) => call<MapMoves>(f, `${B}/moves`);
export const decideMove = (f: ApiFetch, body: { move: MapMoveOption['move']; coffeeId?: number; requestId: string }) =>
  call<{ decisionId: string; created: boolean; pickedCoffeeId: number }>(f, `${B}/decide`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

/** The signed-in fetch every map piece uses (null until a user is signed in). */
export function useMapFetch(): ApiFetch | null {
  const { user } = useAuth();
  const f = useCallback(async (url: string, options: RequestInit = {}) => {
    const token = await user!.getIdToken();
    return fetch(url, { cache: 'no-store', ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) } });
  }, [user]);
  return user ? f : null;
}
