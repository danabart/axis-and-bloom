// Catalog Blueprint · brief 2 — bulk importer CLI (N7). Dry run is the
// default; pass --apply to actually write. See
// backend/src/features/catalog_blueprint/manifests/EXAMPLE_manifest.json for
// the manifest shape this reads, and services/catalogImport.ts for the
// implementation (validate-first, one transaction, dry-run rollback).
//
// Usage:
//   npm run catalog:import -- path/to/manifest.json              (dry run)
//   npm run catalog:import -- path/to/manifest.json --apply       (writes)
//   npm run catalog:import -- path/to/manifest.json --skip-existing
import 'dotenv/config';
import { readFileSync } from 'fs';
import { importCatalog, type Manifest } from '../services/catalogImport.js';

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const skipExisting = args.includes('--skip-existing');
  const manifestPath = args.find(a => !a.startsWith('--'));
  if (!manifestPath) {
    console.error('Usage: npm run catalog:import -- path/to/manifest.json [--apply] [--skip-existing]');
    process.exit(1);
  }

  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  return importCatalog(manifest, { dryRun: !apply, actor: 'import', mode: skipExisting ? 'skip_existing' : undefined })
    .then((report) => {
      console.log(`\n${report.dryRun ? 'DRY RUN' : 'APPLIED'} — ${manifestPath}\n`);

      console.log('Coffees:');
      console.table(report.coffees.map(c => ({
        name: c.name,
        status: c.status,
        coffeeId: c.coffeeId ?? '',
        warnings: c.warnings.map(w => w.kind).join(', '),
        errors: c.errors.join('; '),
      })));

      if (report.slotPrices.length) {
        console.log('\nSlot prices:');
        console.table(report.slotPrices);
      }

      if (report.integrity) {
        const failing = report.integrity.checks.filter(c => (c.severity ?? 'fail') === 'fail' && !c.pass);
        console.log(`\nIntegrity: allPass=${report.integrity.allPass}${failing.length ? ` — failing: ${failing.map(c => `#${c.id}`).join(', ')}` : ''}`);
      }

      const hasErrors = report.coffees.some(c => c.status === 'error');
      if (hasErrors) {
        console.error('\nValidation errors found — nothing was applied.');
        process.exitCode = 1;
      } else if (report.dryRun) {
        console.log('\nDry run only — nothing was written. Re-run with --apply to write.');
      }
    })
    .catch((err) => {
      console.error('\nImport failed:', err?.code ? `${err.code} — ${err.message}` : err);
      process.exitCode = 1;
    });
}

main();
