// Ella map 8 (2026-11-18): 2 lb and 5 lb are switched off (coffee_size.is_active), on the test DB as on prod.
// The size suites (Catalog Sizes, the 5 lb SKU code, the admin slot prices) still test the multi-size machinery,
// so they switch every size on through catalogService.setSizeActive for the suite and back off afterwards.
// Test files run one at a time (vitest.config fileParallelism: false), so no other file sees the sizes on.
import { db } from '../db/client.js';
import { setSizeActive } from '../services/catalogService.js';

const ACTOR = { actor: 'vitest' };

/** Switches every inactive size on; returns a function that switches those same sizes off again. */
export async function allSizesOn(): Promise<() => Promise<void>> {
  const off = (await db.query<{ weight_oz: string }>(`SELECT weight_oz::text FROM coffee_size WHERE NOT is_active`)).rows.map(r => Number(r.weight_oz));
  for (const weightOz of off) await setSizeActive({ weightOz, isActive: true }, ACTOR);
  return async () => {
    for (const weightOz of off) await setSizeActive({ weightOz, isActive: false }, ACTOR);
  };
}
