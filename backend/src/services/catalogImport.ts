import { withTransaction, type Tx } from '../db/client.js';
import {
  CatalogError, createCoffeeInTx, setMatchArchetypeInTx, upsertSkuInTx, placeCoffeeInTx, certifyPlacementInTx,
  setSlotPriceInTx, type Ctx, type PlacementWarning, type ArchetypeCode, type ConfidenceLevel, type AssignmentSource,
} from './catalogService.js';
import { runCatalogIntegrityChecks, type CatalogIntegrityReport } from './catalogIntegrity.js';

// ── Catalog Blueprint · brief 2, Part B ──────────────────────────────────────
// Bulk importer replacing the seed files (N7). One manifest = one roastery.
// See backend/src/features/catalog_blueprint/manifests/EXAMPLE_manifest.json
// for a worked example and backend/src/scripts/catalogImport.ts for the CLI.

const KNOWN_ARCHETYPES: ArchetypeCode[] = ['chocolate_nutty', 'balanced_sweet', 'fruity', 'earthy', 'floral', 'experimental'];

export interface ManifestSku {
  weightOz: number; roasterSku?: string; shopifyVariantId?: string; costToUs?: number;
}
export interface ManifestPlacement {
  slot: string; // "<archetype>/<sort_order>" or a slot name
  priority?: number;
  placementNote?: string;
}
export interface ManifestCoffee {
  name: string; origin?: string; process?: string; roastLevel?: string; roastShade?: string; blendOrSingle?: string;
  flavorDescriptorsRoaster?: string[]; categoryCodes?: string[];
  match: { archetype: ArchetypeCode; confidence: ConfidenceLevel; source: AssignmentSource };
  home?: ManifestPlacement;
  guests?: ManifestPlacement[];
  skus?: ManifestSku[];
  certify?: { by: string; note?: string };
}
export interface Manifest {
  roaster: { name: string };
  coffees: ManifestCoffee[];
  slotPrices?: Array<{ slot: string; weightOz: number; retailPriceCents: number }>;
}

export interface ImportOptions {
  dryRun: boolean;
  actor: string;
  mode?: 'skip_existing';
}

export interface ImportCoffeeReport {
  name: string;
  status: 'created' | 'skipped' | 'error';
  coffeeId?: number;
  warnings: PlacementWarning[];
  errors: string[];
}
export interface ImportSlotPriceReport {
  slot: string; weightOz: number; status: 'set' | 'error'; error?: string;
}
export interface ImportReport {
  dryRun: boolean;
  coffees: ImportCoffeeReport[];
  slotPrices: ImportSlotPriceReport[];
  integrity?: CatalogIntegrityReport; // present once the batch was actually attempted
}

interface ResolvedSlot { id: number; archetype: string; sortOrder: number; }
async function resolveSlotRef(tx: Tx, ref: string): Promise<ResolvedSlot | null> {
  const slashMatch = ref.match(/^([a-z_]+)\/(\d+)$/);
  const result = slashMatch
    ? await tx.query<{ id: number; archetype: string; sort_order: number }>(
        `SELECT id, archetype, sort_order FROM coffee_dial_slot WHERE archetype = $1 AND sort_order = $2`,
        [slashMatch[1], Number(slashMatch[2])]
      )
    : await tx.query<{ id: number; archetype: string; sort_order: number }>(
        `SELECT id, archetype, sort_order FROM coffee_dial_slot WHERE name = $1`,
        [ref]
      );
  const row = result.rows[0];
  return row ? { id: row.id, archetype: row.archetype, sortOrder: row.sort_order } : null;
}

// Thrown to force withTransaction's own rollback while still returning a
// normal ImportReport to importCatalog's caller — used both for an explicit
// dry run and for a validation failure (nothing should ever be committed in
// either case, but neither is really an "error" the caller should catch).
class ImportAbort extends Error {
  constructor(public report: ImportReport) { super('import aborted (rolled back)'); }
}

async function runImportInTx(tx: Tx, manifest: Manifest, options: ImportOptions): Promise<ImportReport> {
  const ctx: Ctx = { actor: options.actor };

  // Roaster must already exist — a hard precondition, not a collected
  // validation error (Part B: "must already exist; create it on
  // /admin/roasters first"). This is what the prod dry-run's expected
  // ROASTER_NOT_FOUND proves (Definition of Done).
  const roasterResult = await tx.query<{ id: string; name: string; is_active: boolean }>(
    `SELECT id, name, is_active FROM roaster WHERE lower(trim(name)) = lower(trim($1))`,
    [manifest.roaster.name]
  );
  if (!roasterResult.rowCount) {
    throw new CatalogError(404, 'ROASTER_NOT_FOUND', `Roaster "${manifest.roaster.name}" not found — create it via /admin/roasters first`);
  }
  const roaster = roasterResult.rows[0];

  const slotCache = new Map<string, ResolvedSlot | null>();
  async function resolveCached(ref: string): Promise<ResolvedSlot | null> {
    if (!slotCache.has(ref)) slotCache.set(ref, await resolveSlotRef(tx, ref));
    return slotCache.get(ref)!;
  }

  // ── Pass 1: validate the whole manifest — collected, not thrown one at a time ──
  const namesLower = manifest.coffees.map(c => c.name.trim().toLowerCase());
  const coffeeReports: ImportCoffeeReport[] = [];

  for (let i = 0; i < manifest.coffees.length; i++) {
    const coffee = manifest.coffees[i];
    const errors: string[] = [];

    if (!coffee.match || !KNOWN_ARCHETYPES.includes(coffee.match.archetype)) {
      errors.push(`Unknown archetype: ${coffee.match?.archetype}`);
    }
    if (namesLower.indexOf(coffee.name.trim().toLowerCase()) !== i) {
      errors.push(`Duplicate coffee name in manifest: ${coffee.name}`);
    }
    if (coffee.home && !(await resolveCached(coffee.home.slot))) errors.push(`Unknown slot: ${coffee.home.slot}`);
    for (const g of coffee.guests ?? []) {
      if (!(await resolveCached(g.slot))) errors.push(`Unknown slot: ${g.slot}`);
    }
    if (!(coffee.skus ?? []).some(s => s.weightOz === 12)) errors.push('Missing a 12 oz SKU');

    const existingResult = await tx.query(
      `SELECT id FROM coffees WHERE roaster_id = $1 AND lower(trim(name)) = lower(trim($2)) AND is_active = true`,
      [roaster.id, coffee.name]
    );
    const alreadyExists = (existingResult.rowCount ?? 0) > 0;
    if (alreadyExists && options.mode !== 'skip_existing') errors.push('COFFEE_EXISTS');

    coffeeReports.push({
      name: coffee.name,
      status: errors.length ? 'error' : (alreadyExists ? 'skipped' : 'created'),
      warnings: [],
      errors,
    });
  }

  const slotPriceValidationErrors: ImportSlotPriceReport[] = [];
  for (const sp of manifest.slotPrices ?? []) {
    if (!(await resolveCached(sp.slot))) {
      slotPriceValidationErrors.push({ slot: sp.slot, weightOz: sp.weightOz, status: 'error', error: `Unknown slot: ${sp.slot}` });
    }
  }

  if (coffeeReports.some(r => r.status === 'error') || slotPriceValidationErrors.length) {
    return { dryRun: options.dryRun, coffees: coffeeReports, slotPrices: slotPriceValidationErrors };
  }

  // ── Pass 2: apply — createCoffee -> setMatchArchetype -> upsertSku (all) ->
  // placeCoffee(home) -> addGuest (each) -> certifyPlacement, per coffee, then
  // setSlotPrice for each price. All in this one transaction. ────────────────
  for (let i = 0; i < manifest.coffees.length; i++) {
    const coffee = manifest.coffees[i];
    const report = coffeeReports[i];
    if (report.status === 'skipped') continue;

    const { coffeeId } = await createCoffeeInTx(tx, {
      roasterId: roaster.id, name: coffee.name, origin: coffee.origin, blendOrSingle: coffee.blendOrSingle,
      process: coffee.process, roastLevel: coffee.roastLevel, roastShade: coffee.roastShade,
      flavorDescriptorsRoaster: coffee.flavorDescriptorsRoaster, categoryCodes: coffee.categoryCodes,
    });
    report.coffeeId = coffeeId;

    const { warnings: matchWarnings } = await setMatchArchetypeInTx(tx, {
      coffeeId, archetype: coffee.match.archetype, confidence: coffee.match.confidence, source: coffee.match.source,
    });
    report.warnings.push(...matchWarnings);

    for (const sku of coffee.skus ?? []) {
      await upsertSkuInTx(tx, { coffeeId, weightOz: sku.weightOz, roasterSku: sku.roasterSku, shopifyVariantId: sku.shopifyVariantId, costToUs: sku.costToUs });
    }

    try {
      if (coffee.home) {
        const slot = (await resolveCached(coffee.home.slot))!;
        const { warnings } = await placeCoffeeInTx(tx, { coffeeId, slotId: slot.id, role: 'home', priority: coffee.home.priority, placementNote: coffee.home.placementNote }, ctx);
        report.warnings.push(...warnings);
      }
      for (const g of coffee.guests ?? []) {
        const slot = (await resolveCached(g.slot))!;
        const { warnings } = await placeCoffeeInTx(tx, { coffeeId, slotId: slot.id, role: 'guest', priority: g.priority, placementNote: g.placementNote }, ctx);
        report.warnings.push(...warnings);
      }
    } catch (err) {
      if (err instanceof CatalogError && err.code === 'NOTE_REQUIRED') {
        // Surfaced as an error naming the coffee and the missing note (Part B)
        // — still aborts the whole batch (one transaction; a half-applied
        // import is worse than none).
        throw new CatalogError(err.status, err.code, `${coffee.name}: ${err.message}`, err.detail);
      }
      throw err;
    }

    if (coffee.certify && coffee.home) {
      const slot = (await resolveCached(coffee.home.slot))!;
      await certifyPlacementInTx(tx, { coffeeId, slotId: slot.id, by: coffee.certify.by, note: coffee.certify.note });
    }
  }

  const slotPriceReports: ImportSlotPriceReport[] = [];
  for (const sp of manifest.slotPrices ?? []) {
    const slot = (await resolveCached(sp.slot))!;
    await setSlotPriceInTx(tx, { slotId: slot.id, weightOz: sp.weightOz, retailPriceCents: sp.retailPriceCents });
    slotPriceReports.push({ slot: sp.slot, weightOz: sp.weightOz, status: 'set' });
  }

  // Unscoped integrity report after the batch, against this same open
  // transaction so it reflects the batch's own (still-uncommitted) writes —
  // true both for a dry run (report "as if applied") and a real apply.
  const integrity = await runCatalogIntegrityChecks({ tx });

  return { dryRun: options.dryRun, coffees: coffeeReports, slotPrices: slotPriceReports, integrity };
}

export async function importCatalog(manifest: Manifest, options: ImportOptions): Promise<ImportReport> {
  try {
    return await withTransaction(async (tx) => {
      const report = await runImportInTx(tx, manifest, options);
      if (options.dryRun) throw new ImportAbort(report);
      return report;
    });
  } catch (err) {
    if (err instanceof ImportAbort) return err.report;
    throw err;
  }
}
