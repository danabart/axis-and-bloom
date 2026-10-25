import { db } from '../client.js';
import type { Tx } from '../client.js';
import { hasAnyAnswer } from '../../services/sommelierReads.js';

// Liam brand answers (brief Rev 3, Part A2, 2026-10-24) — the initial
// sommelier_answer rows, Dana's copy verbatim; she edits them in the admin
// card "Liam answers" afterwards. Insert-only, and only when the table is
// empty (same rule as sommelier_config_seed.ts): once any row exists, even a
// retired one, this never writes again, so an admin edit or retire is never
// undone by a boot. No shipping and no returns row: a missing key means Liam
// has no such fact (brandFacts.rules covers it); never seed placeholder prose.
// The seed is the one writer besides sommelierAnswerService (declared
// `seed` in comments.sql; allow-listed in lint:customer rule 8). It does not
// go through the service's content rules, so sommelierIntegrity reports any
// seeded row that breaks one.
export const SEED_ANSWERS: Array<{ key: string; kind: string; delivery: string; sortOrder: number; text: string }> = [
  { key: 'what_we_are',     kind: 'brand',      delivery: 'prefix', sortOrder: 1,
    text: 'Axis & Bloom is a flavor intelligence platform, not a roastery. We help people find coffee that fits how they actually taste, through a short quiz, six flavor archetypes, and the Bloom Dial.' },
  { key: 'how_we_match',    kind: 'brand',      delivery: 'prefix', sortOrder: 2,
    text: "Every coffee we offer is cupped and classified on our own table using SCA methodology, so a match is to the coffee's measured flavor, not to a brand or a bag note." },
  { key: 'sourcing',        kind: 'brand',      delivery: 'both',   sortOrder: 3,
    text: 'We do not roast. We carefully select the best roasteries across the US to partner with, and they roast each order fresh and ship it. Our bags, their roasting.' },
  { key: 'partner_privacy', kind: 'deflection', delivery: 'both',   sortOrder: 4,
    text: "We keep our partner roasteries private. That is a deliberate choice: the match is to the flavor, not to the roaster's name." },
  { key: 'what_you_get',    kind: 'brand',      delivery: 'both',   sortOrder: 5,
    text: 'Coffee comes as 12 oz whole bean in Axis & Bloom bags, roasted to order.' },
  { key: 'ordering',        kind: 'brand',      delivery: 'prefix', sortOrder: 6,
    text: 'Customers order on axisandbloomcoffee.com. Prices are listed per coffee in your catalog. Ordering happens on the site; you can tell them which coffee and where to find it.' },
];

/** Returns the number of rows inserted (0 when the table already has any row). */
export async function seedSommelierAnswers(runner: Tx | typeof db = db): Promise<number> {
  if (await hasAnyAnswer(runner)) return 0;
  let n = 0;
  for (const a of SEED_ANSWERS) {
    const r = await runner.query(
      `INSERT INTO sommelier_answer (key, kind_id, delivery_id, answer_text, sort_order, note, created_by)
       SELECT $1, k.id, d.id, $4, $5, 'seed: Dana''s copy, brief Rev 3 A2 (2026-10-24)', 'seed'
         FROM lookup_value k, lookup_value d
        WHERE k.category = 'sommelier_answer_kind' AND k.value = $2
          AND d.category = 'sommelier_answer_delivery' AND d.value = $3
       ON CONFLICT DO NOTHING`,
      [a.key, a.kind, a.delivery, a.text, a.sortOrder]
    );
    n += r.rowCount ?? 0;
  }
  return n;
}
