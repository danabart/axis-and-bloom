// Liam answer layer (2026-10-25), Part D — the scripted door for gate rules
// until rule editing lands in admin (a later brief). Reads a JSON file of
// rules and writes them through sommelierGateRuleService in one transaction,
// so the rule tests run exactly as for any other write: one failing example
// rolls the whole file back and names the message.
//
//   npm run gate:rules:apply -- rules.json --expect-db axisandbloom_test   (test database)
//   npm run gate:rules:apply -- rules.json --expect-db axisandbloom        (production, through the proxy)
//   add --dry-run to run the tests and roll back
//
// The file is a list of rules: { key, priority, resolver, answerKey?,
// topicKey, keywords: [...], maxMessageChars?, note?, examples?: [{ message,
// expectation: must_match | must_not_match, expectedLabel }] }. Omitting
// `examples` on an existing key carries its current examples over. created_by
// is script:gate-rules-apply. Same --expect-db discipline as catalogMd.ts.
import 'dotenv/config';
import { readFileSync } from 'fs';
import { db } from '../db/client.js';
import { setRuleInTx, assertRuleTests, type SetRuleInput } from '../services/sommelierGateRuleService.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const file = args.find(a => a.endsWith('.json'));
  const expectDb = arg('--expect-db');
  const dryRun = args.includes('--dry-run');
  if (!file || !expectDb) {
    console.error('usage: npm run gate:rules:apply -- <rules.json> --expect-db <database> [--dry-run]');
    process.exit(2);
  }
  const dbName = (process.env.DATABASE_URL ?? '').split('?')[0].split('/').pop();
  if (dbName !== expectDb) {
    console.error(`[gate:rules:apply] DATABASE_URL points at '${dbName}', not '${expectDb}'. Refusing.`);
    process.exit(2);
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Array<Omit<SetRuleInput, 'createdBy'>> | { rules: Array<Omit<SetRuleInput, 'createdBy'>> };
  const rules = Array.isArray(parsed) ? parsed : parsed.rules;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const rule of rules) {
      const r = await setRuleInTx(client, { ...rule, createdBy: 'script:gate-rules-apply' }, { deferTests: true });
      console.log(`[gate:rules:apply] ${r.key}: row ${r.id}${r.supersededId ? ` (supersedes ${r.supersededId})` : ' (new)'}, ${r.examples} example(s)`);
    }
    await assertRuleTests(client);
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    console.log(`[gate:rules:apply] rule tests pass; ${dryRun ? 'dry run, rolled back' : `${rules.length} rule(s) committed`}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[gate:rules:apply] refused, nothing written: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.end();
  }
}

await main();
