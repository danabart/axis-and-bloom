# Task: Link coffees ↔ roaster_blend, wire real inventory, reorganize Admin nav

## Context — read this before touching anything

There are two overlapping "coffee" tables today:

- `coffees` (SERIAL PK) — the tasting/QC catalogue. Admins manage it on the "Coffees" page. It's the parent of cupping sessions, archetype assignments, dial positions, descriptors, and AI-generated copy (`ai_summary`, etc). ~10 tables FK into `coffees.id`.
- `roaster_blend` (UUID PK) — the sellable unit: package size (`weight_oz`), roaster SKU, Shopify variant ID, cost, and the inventory columns (`quantity_available`, `safety_stock_buffer`, `inventory_status`, `inventory_last_synced_at`). `order_line_item.blend_id` and `roastery_blend_vector.blend_id` FK into `roaster_blend.id`.

These are **not** duplicates that should be dropped into one table — `coffees.id` and `roaster_blend.id` each have real, separate downstream FKs (cupping/QC data hangs off one, order/commerce data hangs off the other), and collapsing them into a single table would mean rewriting ~12 dependent tables for no real benefit. The actual problem is that `roaster_blend` has no link back to `coffees` — it's a second, disconnected identity for the same coffee, matched only informally by matching text (`roaster_blend.blend_name` vs `coffees.name`, confirmed via the seed file `backend/src/db/seeds/roaster_blend_both.sql`, e.g. `blend_name = 'Colombia'` ↔ `coffees.name = 'Colombia'`).

**The fix: link them, don't merge them.** Add `coffee_id` to `roaster_blend` so it becomes a proper "sellable package variant of a coffee" (a coffee can have a 12oz row and a 5lb row, both pointing at the same `coffees.id` — this is literally how they were seeded). One coffee identity (`coffees`), one or more purchasable variants underneath it (`roaster_blend`), inventory tracked on the variant because that's what a customer actually buys and what `order_line_item` actually references.

**Also important — there are two separate order-writing code paths, and only one is live:**
- `backend/src/routes/orders.ts` (`POST /api/orders`) is the code that actually runs today. It inserts into a plain `orders` table with `items` stored as a raw JSON blob (`JSON.stringify(items)`), keyed by `item.blendId ?? item.id`. This is what needs to decrement inventory.
- The fully-normalized `"order"` + `order_line_item` tables (which FK into `roaster_blend`) exist in the schema but are **not** written to by this route. Don't build decrement logic against `order_line_item` — it won't fire. Hook the decrement into `orders.ts` instead, keyed on `blendId`.

Do not attempt to reconcile the `orders` vs `"order"`/`order_line_item` duplication in this task — that's a separate, bigger cleanup. Just make sure inventory correctly decrements through the code path that's actually live.

Follow the existing conventions: idempotent SQL (`ADD COLUMN IF NOT EXISTS`, guarded `UPDATE ... WHERE x IS NULL` for backfills) in `backend/src/db/schema.sql`, Tailwind stone/rust palette, local `apiFetch()` helper with Firebase bearer token + `cache: 'no-store'`.

---

## 1. Schema changes — `backend/src/db/schema.sql`

Add near the existing `roaster_blend` block:

```sql
ALTER TABLE roaster_blend ADD COLUMN IF NOT EXISTS coffee_id INTEGER REFERENCES coffees(id);
ALTER TABLE roaster_blend ADD COLUMN IF NOT EXISTS last_restocked_at TIMESTAMPTZ;
```

`last_restocked_at` is deliberately separate from the existing `inventory_last_synced_at` — the synced column is reserved for a future automated feed (e.g. if a roastery's own Shopify store is ever wired up); `last_restocked_at` tracks manual restock actions taken from the new admin page.

Then add an idempotent backfill (safe to run on every startup — only touches rows where `coffee_id` is still `NULL`, so it no-ops after the first successful run):

```sql
UPDATE roaster_blend rb
SET coffee_id = c.id
FROM coffees c
WHERE rb.coffee_id IS NULL
  AND lower(trim(rb.blend_name)) = lower(trim(c.name));
```

This will not match every row (the seed file explicitly skipped flavored coffees and some session-001 coffees weren't in `roaster_blend` at all). That's expected — the admin page (section 4) needs to surface any `roaster_blend` row that's still unlinked after this runs, so it can be fixed by hand instead of silently sitting broken.

---

## 2. Backend — rewrite the inventory routes in `backend/src/routes/admin.ts` to be blend-based

Replace the earlier coffees-based inventory idea entirely — inventory lives on `roaster_blend`, joined to `coffees` for display. Add a small shared helper near the top of the file (or in a small util):

```ts
function computeInventoryStatus(quantity: number, buffer: number): string {
  if (quantity <= 0) return 'out_of_stock';
  if (quantity <= buffer) return 'low_stock';
  return 'in_stock';
}
```

Routes:

```ts
// ── GET /api/admin/inventory ──────────────────────────────────────────────────
router.get('/inventory', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT
        rb.id, rb.blend_name, rb.coffee_id, c.name AS coffee_name, c.roaster,
        rb.weight_oz, rb.roaster_sku, rb.is_active,
        rb.quantity_available, rb.safety_stock_buffer,
        rb.inventory_status, rb.inventory_last_synced_at, rb.last_restocked_at
      FROM roaster_blend rb
      LEFT JOIN coffees c ON c.id = rb.coffee_id
      ORDER BY
        (rb.coffee_id IS NULL) DESC,     -- unlinked rows surface first, they need attention
        CASE
          WHEN rb.quantity_available <= 0 THEN 0
          WHEN rb.quantity_available <= rb.safety_stock_buffer THEN 1
          ELSE 2
        END,
        COALESCE(c.name, rb.blend_name), rb.weight_oz
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/inventory]', err);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// ── PATCH /api/admin/inventory/:id ────────────────────────────────────────────
// Manual correction of on-hand quantity / reorder buffer, and/or fixing an
// unlinked or mislinked coffee_id from the admin UI.
router.patch('/inventory/:id', async (req, res) => {
  const { id } = req.params;
  const { quantity_available, safety_stock_buffer, coffee_id } = req.body;
  try {
    const current = await db.query(
      `SELECT quantity_available, safety_stock_buffer FROM roaster_blend WHERE id = $1`, [id]
    );
    if (current.rows.length === 0) { res.status(404).json({ error: 'Blend not found' }); return; }

    const nextQty    = quantity_available    ?? current.rows[0].quantity_available;
    const nextBuffer = safety_stock_buffer   ?? current.rows[0].safety_stock_buffer;
    const status     = computeInventoryStatus(nextQty, nextBuffer);

    const result = await db.query(
      `UPDATE roaster_blend
       SET quantity_available  = $1,
           safety_stock_buffer = $2,
           coffee_id           = COALESCE($3, coffee_id),
           inventory_status    = $4
       WHERE id = $5
       RETURNING id, blend_name, coffee_id, quantity_available, safety_stock_buffer, inventory_status, last_restocked_at`,
      [nextQty, nextBuffer, coffee_id ?? null, status, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[admin/inventory PATCH]', err);
    res.status(500).json({ error: 'Failed to update inventory' });
  }
});

// ── POST /api/admin/inventory/:id/restock ─────────────────────────────────────
router.post('/inventory/:id/restock', async (req, res) => {
  const { id } = req.params;
  const amt = Number(req.body.amount);
  if (!Number.isFinite(amt) || amt <= 0) { res.status(400).json({ error: 'amount must be a positive number' }); return; }
  try {
    const current = await db.query(`SELECT quantity_available, safety_stock_buffer FROM roaster_blend WHERE id = $1`, [id]);
    if (current.rows.length === 0) { res.status(404).json({ error: 'Blend not found' }); return; }
    const nextQty = current.rows[0].quantity_available + amt;
    const status  = computeInventoryStatus(nextQty, current.rows[0].safety_stock_buffer);

    const result = await db.query(
      `UPDATE roaster_blend
       SET quantity_available = $1,
           inventory_status   = $2,
           last_restocked_at  = timezone('utc', now())
       WHERE id = $3
       RETURNING id, blend_name, coffee_id, quantity_available, safety_stock_buffer, inventory_status, last_restocked_at`,
      [nextQty, status, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[admin/inventory restock]', err);
    res.status(500).json({ error: 'Failed to restock' });
  }
});

// ── GET /api/admin/inventory/coffees-lookup ───────────────────────────────────
// For the "link this blend to a coffee" dropdown when a row is unlinked.
router.get('/inventory/coffees-lookup', async (_req, res) => {
  try {
    const result = await db.query(`SELECT id, name, roaster FROM coffees ORDER BY name`);
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/inventory coffees-lookup]', err);
    res.status(500).json({ error: 'Failed to fetch coffees' });
  }
});
```

---

## 3. Decrement inventory on order — `backend/src/routes/orders.ts`

Inside the existing `router.post('/', requireAuth, ...)` handler, after the order is successfully recorded locally (after the `INSERT INTO orders ...` call, before or alongside the existing fire-and-forget block), decrement stock for each line item. Do this **synchronously in the main try block** (inventory correctness matters, unlike the token-bonus bookkeeping which is fire-and-forget) but don't let a single bad item fail the whole order — wrap each decrement in its own try/catch and log failures:

```ts
// Decrement inventory for each purchased blend. Best-effort per item —
// a failure here shouldn't block the customer's order confirmation.
for (const item of items) {
  const blendId = item.blendId ?? item.id;
  if (!blendId) continue;
  try {
    await db.query(
      `UPDATE roaster_blend
       SET quantity_available = GREATEST(quantity_available - $1, 0),
           inventory_status = CASE
             WHEN GREATEST(quantity_available - $1, 0) <= 0 THEN 'out_of_stock'
             WHEN GREATEST(quantity_available - $1, 0) <= safety_stock_buffer THEN 'low_stock'
             ELSE 'in_stock'
           END
       WHERE id = $2`,
      [item.quantity ?? 1, blendId]
    );
  } catch (err) {
    console.error('[orders] inventory decrement failed for blend', blendId, err);
  }
}
```

Do **not** add a hard "reject order if out of stock" gate in this task — real stock numbers don't exist yet (everything seeded is `quantity_available = 0` / `inventory_status = 'pending'`), so a hard gate would block every order right now. Just get accurate tracking in place; blocking overselling is a follow-up once real numbers are populated.

---

## 4. Frontend — `frontend/src/app/components/admin/AdminInventory.tsx`

Model on `AdminRoasters.tsx` (local `apiFetch()` helper, same form/table styling). Build:

- A table grouped visually by coffee name (each coffee can have multiple rows — e.g. 12oz / 5lb — shown together), with columns: **Coffee**, **Roaster**, **Package** (`weight_oz`, e.g. "12 oz"), **On Hand**, **Reorder Buffer**, **Status**, **Last Restocked**, **Actions**.
- Any row where `coffee_id` is `null` renders with a distinct "Unlinked" badge and a dropdown (populated from `GET /inventory/coffees-lookup`) to assign it to a coffee via `PATCH /inventory/:id`. Put these rows at the top — the API already returns them first.
- Status badge: `out_of_stock` = red, `low_stock` = amber, `in_stock` = green, `pending` = neutral gray (the seed data currently has `inventory_status = 'pending'` on everything — treat it as its own display state, not an error state).
- Restock action: inline amount input + button calling `POST /inventory/:id/restock`.
- Edit reorder buffer: inline number input calling `PATCH /inventory/:id` with `safety_stock_buffer`.
- Fetch with `cache: 'no-store'`; re-fetch the full list after any mutation rather than optimistic local updates, matching the rest of the admin pages.

Out of scope for this task: creating brand-new `roaster_blend` rows (new package sizes) from the UI. This page is for linking/fixing/tracking what already exists — flag that as a natural next step if wanted later.

---

## 5. Register the route — `frontend/src/app/App.tsx`

```ts
import AdminInventory from './components/admin/AdminInventory';
```

```tsx
<Route path="coffees" element={<AdminCoffees />} />
<Route path="inventory" element={<AdminInventory />} />
```

---

## 6. Reorganize the sidebar — `frontend/src/app/components/admin/AdminLayout.tsx`

Replace the current `NAV_MAIN` / `NAV_SOMMELIER` two-array setup with grouped sections. Dashboard stays ungrouped at the top (no header); three labeled sections follow:

```tsx
const NAV_TOP = [
  { to: '/admin', label: 'Dashboard', end: true },
];

const NAV_SECTIONS = [
  {
    label: 'Catalogue & Supply',
    items: [
      { to: '/admin/coffees',   label: 'Coffees' },
      { to: '/admin/roasters',  label: 'Roasteries' },
      { to: '/admin/inventory', label: 'Supply & Inventory' },
    ],
  },
  {
    label: 'Cupping & QC',
    items: [
      { to: '/admin/sessions',     label: 'Cupping Sessions' },
      { to: '/admin/cupping',      label: 'Score Entry' },
      { to: '/admin/flavor-wheel', label: 'Flavor Wheel' },
    ],
  },
  {
    label: 'Sommelier AI',
    items: [
      { to: '/admin/sommelier/config',  label: 'Configuration' },
      { to: '/admin/sommelier/intents', label: 'Intent Editor' },
      { to: '/admin/sommelier/flow',    label: 'Flow & Stats' },
      { to: '/admin/dial',              label: 'Bloom Dial' },
    ],
  },
];
```

Render `NAV_TOP` first with the existing unlabeled `<nav>` block, then `.map()` over `NAV_SECTIONS`, printing the same rust-colored uppercase label (`text-xs font-normal tracking-widest uppercase ... style={{ color: '#b05642' }}`) above each group's `<nav>` block — reuse the exact `NavLink` className logic already there (active = `bg-stone-200 font-normal text-stone-800`, inactive = `text-stone-500 hover:text-stone-800 hover:bg-stone-100`). Don't change the "Back to site" / "Sign out" footer block.

---

## 7. Verify

- `npm run build` in both `frontend/` and `backend/` with no type errors.
- Backend starts, `schema.sql` runs cleanly (new columns + backfill are idempotent and safe against the existing production DB and data).
- `GET /api/admin/inventory` returns all `roaster_blend` rows joined to their coffee name where a match was found; rows the backfill couldn't match show `coffee_name: null` and appear first.
- Linking an unlinked row via the dropdown persists after refresh.
- Restock and reorder-buffer edits persist after refresh.
- Placing a test order through `POST /api/orders` with a known `blendId` decrements that blend's `quantity_available` and updates `inventory_status` accordingly, and a failure to decrement (e.g. bad blendId) does not prevent the order from completing.
- Sidebar shows: Dashboard (top, no header) → Catalogue & Supply (Coffees, Roasteries, Supply & Inventory) → Cupping & QC (Cupping Sessions, Score Entry, Flavor Wheel) → Sommelier AI (Configuration, Intent Editor, Flow & Stats, Bloom Dial).
