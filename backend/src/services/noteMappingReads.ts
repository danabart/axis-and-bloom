// Cupping evidence, brief 1 (2026-10-18), B8 — reads of the words → SCA node
// mappings (roastery_portal_note_mapping), both vocabularies. The roaster
// portal keeps its own roaster-only reads in roasteryPortalReads.
import { db, type Tx } from '../db/client.js';
import { normalizeWords } from './roasteryPortalReads.js';
import type { NoteSourceKind } from './noteMappingService.js';

type Runner = Tx | typeof db;

export interface NoteMappingRow {
  id: string;
  normalizedWords: string;
  sourceKind: NoteSourceKind;
  cuppingNoteId: string;
  descriptor: string;
  wheelCategory: string;
  wheelSubcategory: string | null;
  tier: number;
  note: string | null;
  createdAt: string;
  supersededAt: string | null;
}

export async function listMappings(
  filter: { sourceKind?: NoteSourceKind; currentOnly?: boolean; words?: string[] } = {},
  runner: Runner = db
): Promise<NoteMappingRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.currentOnly ?? true) clauses.push('m.superseded_at IS NULL');
  if (filter.sourceKind) { params.push(filter.sourceKind); clauses.push(`m.source_kind = $${params.length}`); }
  if (filter.words?.length) {
    params.push([...new Set(filter.words.map(normalizeWords).filter(Boolean))]);
    clauses.push(`m.normalized_words = ANY($${params.length}::text[])`);
  }
  const r = await runner.query(
    `SELECT m.id, m.normalized_words, m.source_kind, m.cupping_note_id, cn.descriptor, cn.wheel_category,
            cn.wheel_subcategory, cn.tier, m.note, m.created_at, m.superseded_at
     FROM roastery_portal_note_mapping m JOIN cupping_note cn ON cn.id = m.cupping_note_id
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY m.source_kind, m.normalized_words, m.created_at DESC`,
    params
  );
  return r.rows.map((x: any) => ({
    id: x.id, normalizedWords: x.normalized_words, sourceKind: x.source_kind, cuppingNoteId: x.cupping_note_id,
    descriptor: x.descriptor, wheelCategory: x.wheel_category, wheelSubcategory: x.wheel_subcategory, tier: Number(x.tier),
    note: x.note, createdAt: x.created_at, supersededAt: x.superseded_at,
  }));
}
