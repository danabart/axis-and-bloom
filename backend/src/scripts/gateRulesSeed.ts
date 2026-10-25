// Liam answer layer (2026-10-25) — runs the gate rule seed, and since the
// Liam answer evals (2026-10-25) the eval seed, against one database (the
// boot does the same in production). refresh-test-db.mjs calls it after an
// import so the test database always has both, even when the prod clone
// predates them. Each is a no-op when its table already has rows.
//   npx tsx src/scripts/gateRulesSeed.ts --expect-db axisandbloom_test
import 'dotenv/config';
import { db } from '../db/client.js';
import { seedGateRules } from '../db/seeds/sommelier_gate_rule_seed.js';
import { seedEvals } from '../db/seeds/sommelier_eval_seed.js';

const args = process.argv.slice(2);
const expectDb = args[args.indexOf('--expect-db') + 1];
const dbName = (process.env.DATABASE_URL ?? '').split('?')[0].split('/').pop();
if (!expectDb || args.indexOf('--expect-db') < 0 || dbName !== expectDb) {
  console.error(`[gate:seed] DATABASE_URL points at '${dbName}', not '${expectDb ?? '(missing --expect-db)'}'. Refusing.`);
  process.exit(2);
}
try {
  const r = await seedGateRules();
  console.log(r.rules ? `[gate:seed] seeded ${r.rules} rule(s), ${r.examples} example(s)${r.answerAdded ? ' and the order_status_unavailable answer' : ''}` : '[gate:seed] rules already present; nothing written');
  const e = await seedEvals();
  console.log(e.cases ? `[eval:seed] seeded ${e.cases} case(s), ${e.phrasings} phrasing(s), ${e.checks} check(s)` : '[eval:seed] eval cases already present; nothing written');
} catch (err) {
  console.error(`[gate:seed] failed: ${err instanceof Error ? err.message : String(err)} (the gate tables come from schema.sql: npm test applies it)`);
  process.exitCode = 1;
} finally {
  await db.end();
}
