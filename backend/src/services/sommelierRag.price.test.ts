// Liam brand answers brief Rev 3, Testing 5 (2026-10-24) — Part B, the price
// line in Liam's catalog block: from the slot price view's cents and
// coffee_size's label, "not yet available" without a price row.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../db/client.js';
import { buildCatalogText, formatPriceLine } from './sommelierRag.js';
import { getAnchorSize, getSellableSlots } from './catalogReads.js';

afterAll(async () => { await db.end(); });

describe('formatPriceLine', () => {
  it('renders dollars from cents and the size label', () => {
    expect(formatPriceLine({ retail_price_cents: 3200, size_label: '12 oz' })).toBe('Price: $32.00 for 12 oz whole bean');
    expect(formatPriceLine({ retail_price_cents: 2950, size_label: '2 lb' })).toBe('Price: $29.50 for 2 lb whole bean');
  });

  it('"not yet available" when there is no price row', () => {
    expect(formatPriceLine({ retail_price_cents: null, size_label: null })).toBe('Price: not yet available');
    expect(formatPriceLine({ retail_price_cents: 3200, size_label: null })).toBe('Price: not yet available');
  });
});

describe('buildCatalogText', () => {
  it('prints one price line per coffee, after its flavors', async () => {
    const anchor = await getAnchorSize();
    const base = { name: 'internal', archetype: 'fruity', three_voice_story: null, weight_oz: anchor.weight_oz };
    const text = await buildCatalogText(
      [
        { ...base, id: 1, size_label: anchor.label, retail_price_cents: 3200 },
        { ...base, id: 2, size_label: null, retail_price_cents: null, weight_oz: null },
      ],
      new Map([[1, ['blueberry']]]),
      new Map([[1, 'Alias One'], [2, 'Alias Two']])
    );
    const lines = text.split('\n');
    const one = lines.indexOf(lines.find(l => l.startsWith('Alias One'))!);
    expect(lines.slice(one + 1, one + 4)).toEqual(['Tasting note: Not yet available', 'Key flavors: blueberry', `Price: $32.00 for ${anchor.label} whole bean`]);
    expect(text).toContain('Price: not yet available');
    expect(text.match(/^Price: /gm)).toHaveLength(2);
  });

  it('the anchor-size sellable rows carry the cents and label the line reads', async () => {
    const anchor = await getAnchorSize();
    const rows = await getSellableSlots({ weightOz: anchor.weight_oz });
    for (const r of rows) {
      expect(Number.isInteger(Number(r.retail_price_cents))).toBe(true);
      expect(r.size_label).toBe(anchor.label);
    }
  });
});
