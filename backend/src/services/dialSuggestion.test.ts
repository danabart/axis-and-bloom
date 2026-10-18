// Cupping evidence brief 1 (2026-10-18), C2 — getDialSuggestion is band-first
// (decision 8, Dana 2026-10-17): with any band NULL the suggestion rests on
// the archetype_vector targets split across the slots; with a band on every
// active slot it is the slot whose band holds the midpoint. The coffee and its
// merged range are mocked (no fixture rows); the slots are the archetype's
// real ones, with bands set on copies only, so nothing is written.
import 'dotenv/config';
import { describe, it, expect, afterAll, vi } from 'vitest';

vi.mock('./cuppingReads.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./cuppingReads.js')>()),
  getMergedRange: vi.fn(),
}));
vi.mock('./catalogReads.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./catalogReads.js')>();
  return { ...orig, getCoffee: vi.fn(), getSlots: vi.fn(orig.getSlots) };
});

import { db } from '../db/client.js';
import { getMergedRange } from './cuppingReads.js';
import { getCoffee, getSlots, getArchetypes } from './catalogReads.js';
import { getDialSuggestion, BASIS_SPEC_BAND, BASIS_ARCHETYPE_VECTOR } from './dialSuggestion.js';

afterAll(async () => { await db.end(); });

const FAKE_COFFEE = 2_000_000_001; // no row: findHopConflict finds no hop for it

async function setup(midpoint: number) {
  const archetypes = await getArchetypes();
  const a = archetypes.find(x => x.is_archetype && x.dominant_dimension_id)!;
  vi.mocked(getCoffee).mockResolvedValue({ id: FAKE_COFFEE, match_archetype: a.code } as never);
  vi.mocked(getMergedRange).mockResolvedValue({
    coffee_id: FAKE_COFFEE, dimension_id: a.dominant_dimension_id!, dimension_name: a.dominant_dimension_name!, value_min: midpoint,
    value_max: midpoint, midpoint, n_scores: 2, basis: 'merged', session_id: 1, session_date: '2026-10-18', n_sessions: 1,
    all_ab_scale: true, scale_min_label: null, scale_max_label: null, display_order: 1, is_numeric: true,
  });
  return a;
}

describe('getDialSuggestion basis', () => {
  it('with no bands it rests on the archetype_vector targets', async () => {
    const a = await setup(8);
    const real = await (await vi.importActual<typeof import('./catalogReads.js')>('./catalogReads.js')).getSlots(a.code);
    vi.mocked(getSlots).mockResolvedValue(real.map(s => ({ ...s, spec_band_lo: null, spec_band_hi: null })));
    const s = await getDialSuggestion(FAKE_COFFEE);
    expect(s).not.toBeNull();
    expect(s!.basis).toBe(BASIS_ARCHETYPE_VECTOR);
    expect(real.map(r => r.id)).toContain(s!.suggested_slot_id);
  });

  it('with a band on every active slot it picks the slot whose band holds the midpoint', async () => {
    const a = await setup(8);
    const real = await (await vi.importActual<typeof import('./catalogReads.js')>('./catalogReads.js')).getSlots(a.code);
    const active = real.filter(s => s.is_active).sort((x, y) => x.sort_order - y.sort_order);
    // Bands 0-3.9, 4-7.9, 8-11.9, 12-15 over the first four active slots (any further slot gets 15-15).
    const banded = real.map(s => {
      const i = active.findIndex(x => x.id === s.id);
      return i === -1 ? s : { ...s, spec_band_lo: Math.min(i * 4, 15), spec_band_hi: i >= 3 ? 15 : i * 4 + 3.9 };
    });
    vi.mocked(getSlots).mockResolvedValue(banded);
    const s = await getDialSuggestion(FAKE_COFFEE);
    expect(s!.basis).toBe(BASIS_SPEC_BAND);
    expect(s!.suggested_slot_id).toBe(active[2].id);
    expect(s!.is_outlier).toBe(false);
  });

  it('outside every band: the nearest band, flagged as an outlier', async () => {
    const a = await setup(14);
    const real = await (await vi.importActual<typeof import('./catalogReads.js')>('./catalogReads.js')).getSlots(a.code);
    const active = real.filter(s => s.is_active).sort((x, y) => x.sort_order - y.sort_order);
    const banded = real.map(s => {
      const i = active.findIndex(x => x.id === s.id);
      return i === -1 ? s : { ...s, spec_band_lo: i * 2, spec_band_hi: i * 2 + 1 };
    });
    vi.mocked(getSlots).mockResolvedValue(banded);
    const s = await getDialSuggestion(FAKE_COFFEE);
    expect(s!.basis).toBe(BASIS_SPEC_BAND);
    expect(s!.suggested_slot_id).toBe(active[active.length - 1].id);
    expect(s!.is_outlier).toBe(true);
  });

  it('unmerged evidence gives no suggestion', async () => {
    await setup(8);
    vi.mocked(getMergedRange).mockResolvedValue({ ...(await getMergedRange(0, 0))!, basis: 'unmerged' });
    expect(await getDialSuggestion(FAKE_COFFEE)).toBeNull();
  });
});
