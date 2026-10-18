// Cupping evidence brief 1 (2026-10-18), C2 — noteMappingService, the one
// writer of roastery_portal_note_mapping. Every write runs through the
// *InTx variants inside a rolled-back transaction, so nothing is left behind.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import { setNoteMappingInTx, retireNoteMappingInTx, NoteMappingError } from './noteMappingService.js';
import { listMappings } from './noteMappingReads.js';

afterAll(async () => { await db.end(); });

const WORDS = `zzz mapping test ${Date.now().toString(36)}`;
const node = async (descriptor: string, tier: number) =>
  (await db.query<{ id: string }>(`SELECT id FROM cupping_note WHERE descriptor = $1 AND tier = $2`, [descriptor, tier])).rows[0].id;

describe('noteMappingService', () => {
  it('supersedes the current row for the same words and kind, inserts the new one', async () => {
    const berry = await node('Berry', 2);
    const blueberry = await node('Blueberry', 3);
    await withRollback(async ({ client }) => {
      expect(await setNoteMappingInTx(client, { normalizedWords: WORDS, cuppingNoteId: blueberry, sourceKind: 'roaster' })).toBe('created');
      expect(await setNoteMappingInTx(client, { normalizedWords: `  ${WORDS.toUpperCase()} `, cuppingNoteId: blueberry, sourceKind: 'roaster' })).toBe('unchanged');
      expect(await setNoteMappingInTx(client, { normalizedWords: WORDS, cuppingNoteId: berry, sourceKind: 'roaster', note: 'generic word, tier 2' })).toBe('superseded');
      const rows = (await client.query(`SELECT cupping_note_id, superseded_at, note FROM roastery_portal_note_mapping WHERE normalized_words = $1 ORDER BY created_at, superseded_at NULLS LAST`, [WORDS])).rows;
      expect(rows).toHaveLength(2);
      expect(rows.filter(r => r.superseded_at === null)).toEqual([{ cupping_note_id: berry, superseded_at: null, note: 'generic word, tier 2' }]);
    });
  });

  it('roaster and cupper mappings for the same words coexist', async () => {
    const berry = await node('Berry', 2);
    const blueberry = await node('Blueberry', 3);
    await withRollback(async ({ client }) => {
      await setNoteMappingInTx(client, { normalizedWords: WORDS, cuppingNoteId: blueberry, sourceKind: 'roaster' });
      await setNoteMappingInTx(client, { normalizedWords: WORDS, cuppingNoteId: berry, sourceKind: 'cupper' });
      const current = await listMappings({ words: [WORDS] }, client);
      expect(current.map(m => [m.sourceKind, m.descriptor, m.tier]).sort()).toEqual([['cupper', 'Berry', 2], ['roaster', 'Blueberry', 3]]);
      expect((await listMappings({ words: [WORDS], sourceKind: 'cupper' }, client)).map(m => m.descriptor)).toEqual(['Berry']);
    });
  });

  it('retire supersedes without a replacement; unknown kinds and inactive nodes are refused', async () => {
    const berry = await node('Berry', 2);
    await withRollback(async ({ client, savepoint }) => {
      await setNoteMappingInTx(client, { normalizedWords: WORDS, cuppingNoteId: berry, sourceKind: 'cupper' });
      const id = (await listMappings({ words: [WORDS], sourceKind: 'cupper' }, client))[0].id;
      expect(await retireNoteMappingInTx(client, id)).toEqual({ superseded: true });
      expect(await retireNoteMappingInTx(client, id)).toEqual({ superseded: false });
      expect(await listMappings({ words: [WORDS] }, client)).toEqual([]);
      await expect(savepoint(() => setNoteMappingInTx(client, { normalizedWords: WORDS, cuppingNoteId: berry, sourceKind: 'customer' as never })))
        .rejects.toBeInstanceOf(NoteMappingError);
      await expect(savepoint(() => setNoteMappingInTx(client, { normalizedWords: WORDS, cuppingNoteId: '00000000-0000-0000-0000-000000000000', sourceKind: 'cupper' })))
        .rejects.toBeInstanceOf(NoteMappingError);
    });
  });

  it('roasteryPortalService no longer writes the table itself', () => {
    const src = readFileSync(fileURLToPath(new URL('./roasteryPortalService.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+roastery_portal_note_mapping\b/i);
  });
});
