// Liam sees everything brief Rev 2, Part A + Testing 1 (2026-10-24) — the
// shared catalog block: rendering (sizes and prices, categories, dial, story
// sentences, empty lines dropped), byte-stability, and roaster redaction on a
// fixture with three roasteries and a coffee whose internal name contains its
// roaster's name. Supersedes Brief 1's sommelierRag.price.test.ts: the
// per-coffee "Price:" line became the block's "Sizes:" line.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import { renderCatalogBlock, getCatalogCoffees, catalogBlockConfig, type CatalogCoffee } from './sommelierRag.js';
import { assembleSystemPrompt, LIAM_BASE_PROMPT } from './claude.js';
import { DEFAULT_SOMMELIER_CONFIG } from '../db/seeds/sommelier_config_seed.js';

afterAll(async () => { await db.end(); });

const CFG = { ...catalogBlockConfig(), ...DEFAULT_SOMMELIER_CONFIG.catalogBlock };

const coffee = (over: Partial<CatalogCoffee> = {}): CatalogCoffee => ({
  id: 1, alias: 'Clean Fruit', archetype: 'fruity', archetypeLabel: 'Fruity', categories: [], dialPosition: 'Bright',
  sizes: [{ label: '12 oz', cents: 3200 }, { label: '2 lb', cents: 8000 }],
  tastingNote: 'The roaster calls it berry and citrus.', keyFlavors: ['Blueberry', 'Lemon'],
  story: 'First sentence. Second sentence! Third sentence? Fourth.', ...over,
});

describe('renderCatalogBlock', () => {
  it('renders every size with its price, the form, the dial position and the first N story sentences', () => {
    const text = renderCatalogBlock([coffee()], CFG, 2);
    expect(text.startsWith(CFG.header)).toBe(true);
    expect(text).toContain('Clean Fruit — Fruity · dial: bright');
    expect(text).toContain('Sizes: 12 oz $32.00 · 2 lb $80.00 (whole bean)');
    expect(text).toContain('Tasting note: The roaster calls it berry and citrus.');
    expect(text).toContain('Key flavors: Blueberry, Lemon');
    expect(text).toContain('Story: First sentence. Second sentence!');
    expect(text).not.toContain('Third sentence');
  });

  it('a category coffee: category labels, no dial, "not yet available" without a priced active size', () => {
    const text = renderCatalogBlock([coffee({ alias: 'Nightcap Decaf', categories: [{ code: 'decaf', label: 'Decaf' }], dialPosition: null, sizes: [] })], CFG, 2);
    expect(text).toContain('Nightcap Decaf — Fruity, Decaf');
    expect(text).not.toContain('dial:');
    expect(text).toContain(`Sizes: ${CFG.notYetAvailable}`);
  });

  it('drops a line whose placeholders are all empty, and story level 0 drops the Story line', () => {
    const text = renderCatalogBlock([coffee({ tastingNote: null, keyFlavors: [] })], CFG, 0);
    expect(text).not.toContain('Tasting note:');
    expect(text).not.toContain('Key flavors:');
    expect(text).not.toContain('Story:');
  });

  it('is byte-stable: two renders of the same catalog are identical', () => {
    const list = [coffee(), coffee({ id: 2, alias: 'Coado', archetypeLabel: 'Chocolate & Nutty' })];
    expect(renderCatalogBlock(list, CFG)).toBe(renderCatalogBlock(list.map(c => ({ ...c })), { ...CFG }));
  });
});

describe('roaster redaction (three roasteries, one coffee named after its roaster)', () => {
  it('no roastery name appears anywhere in the catalog block or the assembled prompt', async () => {
    await withRollback(async ({ client }) => {
      const stamp = Date.now().toString(36);
      const names = [`Vitest Ridgeback Roasters ${stamp}`, `Vitest Harbor Coffee Co ${stamp}`, `Vitest Lantern Roastery ${stamp}`];
      const roasterIds: string[] = [];
      for (const n of names) {
        roasterIds.push((await client.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ($1, true) RETURNING id`, [n])).rows[0].id);
      }
      const decaf = (await client.query<{ id: number }>(`SELECT id FROM coffee_category WHERE code = 'decaf'`)).rows[0].id;
      const coffeeNames = [`${names[0]} House Decaf`, `Vitest Quiet Decaf ${stamp}`, `Vitest Evening Decaf ${stamp}`];
      const ids: number[] = [];
      for (let i = 0; i < 3; i++) {
        const id = (await client.query<{ id: number }>(
          `INSERT INTO coffees (name, roaster_id, is_active, story, story_published) VALUES ($1, $2, true, $3, true) RETURNING id`,
          [coffeeNames[i], roasterIds[i], `Roasted by ${names[i]} in small batches. A second sentence.`]
        )).rows[0].id;
        await client.query(`INSERT INTO coffee_category_assignment (coffee_id, category_id) VALUES ($1, $2)`, [id, decaf]);
        ids.push(id);
      }

      const coffees = await getCatalogCoffees(client);
      const mine = coffees.filter(c => ids.includes(c.id));
      expect(mine).toHaveLength(3);
      // The coffee named after its roaster gets a neutral alias; the others keep the name the site shows.
      expect(mine.find(c => c.id === ids[0])!.alias).not.toContain('Ridgeback');
      expect(mine.find(c => c.id === ids[1])!.alias).toBe(coffeeNames[1]);
      // No row carries a roaster field at all.
      for (const c of mine) expect(Object.keys(c).some(k => /roaster/i.test(k))).toBe(false);

      // Stories on: the fixture stories name their roaster, and the block scrubs them.
      const block = renderCatalogBlock(coffees, CFG, 2);
      expect(block).toContain('Roasted by the roaster in small batches.');
      const prompt = assembleSystemPrompt({
        session: { intent: 'MATCHED', turnCount: 1, openingContext: '' },
        catalogContext: block, mode: 'matching', config: DEFAULT_SOMMELIER_CONFIG as never,
        profileLine: 'ABOUT THIS CUSTOMER (facts; rebuilt every turn)\nName: Test',
      });
      expect(prompt.startsWith(LIAM_BASE_PROMPT)).toBe(true);
      const allRoasters = (await client.query<{ name: string }>(`SELECT name FROM roaster`)).rows.map(r => r.name);
      for (const n of allRoasters) expect(prompt.toLowerCase(), `prompt contains roaster "${n}"`).not.toContain(n.toLowerCase());
    });
  }, 30000);
});
