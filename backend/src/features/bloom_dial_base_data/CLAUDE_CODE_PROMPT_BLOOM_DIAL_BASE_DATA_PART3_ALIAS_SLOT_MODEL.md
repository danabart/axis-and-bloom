# Claude Code Prompt — Bloom Dial Base Data, Part 3: Alias-as-Slot model + category presentation (regression fix + "Other Categories" section)

**Why:** Deploying Parts 1–2 surfaced two regressions on the Flavor Intelligence page, The Bloom, and the admin Coffees matrix:

1. **Category coffees took regular dial slots.** `GET /api/admin/coffee-alias` derives a coffee's archetype as `COALESCE(aa.archetype, ca.archetype)`. Part 1 gave Decaf, Sleepwalker Half-Caf, Vanilla, Hazelnut, Chocolate, and Kopi Safari real archetypes, so the derivation pulled them onto flavor dials at their old stored `dial_sort_order` — e.g. Decaf landed on chocolate_nutty slot 2 (Classic) and crowded out Noam Blend.
2. **Duplicate slot names.** `coffee_alias.platform_name` is stored per *coffee row* and was shared across coffees ("Deep Cocoa" = African + 6-Bean; "Dark Grounded" = Vantablack + Bali + Uganda). The spread moved those coffees to different dial positions, so the same name now shows at two positions.

**The correct model (this is the fix):** an **alias is a SLOT** — `(archetype, dial position)` — with a **globally unique** name. Coffees are *mapped to* a slot's alias via their dial position; **one coffee can map to several aliases** (a coffee at more than one slot — e.g. a seam guest — carries more than one). The name must never be stored per coffee.

Keep the archetype on the category coffees (needed for matching / Liam); just keep them **off the flavor dials**.

## Verified facts (confirm, then build)
- `coffee_alias(platform_name, archetype, dial_sort_order, coffee_id, priority, is_active)` — `platform_name` currently stored per row. In `admin.ts`.
- `GET /coffee-alias` (~line 573) derives archetype + `dial_sort_order` live (position from `dial_archetype_positions WHERE is_guest=false`, else the stored column); name still comes from the stored per-row `platform_name`. `PATCH /coffee-alias/slot` already renames every row in a derived slot together — i.e. the code already *treats* the name as slot-level, the data just doesn't enforce it.
- Categories: `coffee_category` + `coffee_category_assignment`; names `Experimental`, `Decaf`, `Half-Caf`, `Flavored`.
- `dial_position_vocabulary(archetype, dimension_id, sort_order, label)` = the 4 slots per archetype.
- Public reads: Flavor Intelligence + The Bloom query the same derived data (find the exact queries in `routes/coffees.ts` / `routes/axis.ts` and the FI/Bloom components).

---

## Phase 1 — Slot alias as source of truth

Create a slot-keyed alias table and make it the *only* source of slot names:
```sql
CREATE TABLE IF NOT EXISTS dial_slot_alias (
  id             SERIAL PRIMARY KEY,
  archetype      archetype_enum NOT NULL,
  dial_sort_order INT NOT NULL,
  platform_name  TEXT NOT NULL,
  UNIQUE (archetype, dial_sort_order),
  UNIQUE (platform_name)          -- aliases are globally unique
);
```
Seed all 20 flavor slots (5 archetypes × 4) + Experimental from the table in `THE ALIAS TABLE` below. Names are placeholders — they're renamable in admin (Phase 5) — but they must be seeded unique.

## Phase 2 — Routing: which coffees go where

Define, in one reusable place, a routing rule that sends each coffee to exactly one presentation bucket:
- Carries **Decaf**, **Half-Caf**, or **Flavored** → **not on any flavor dial**; rendered in a new **"Other Categories"** section, grouped by its category tag (see Phase 6). Keeps its `archetype_assignments` (used for matching, and shown as a "matches" label), but has no dial slot.
- Carries **Experimental** → off the 5 flavor dials; rendered only under its own **"The Unexpected"** section.
- Otherwise → **dial-eligible** (shows on its archetype's dial at its home slot).

Never strip a coffee's `archetype_assignments` — routing is a render-time decision only. A coffee with more than one category tag shows under each relevant group.

## Phase 3 — Rewire the derivation and every reader

A coffee's displayed slot name must come from `dial_slot_alias` keyed by (its **home** archetype + home `dial_sort_order`, from `dial_archetype_positions WHERE is_guest=false` → `dial_position_vocabulary.sort_order`), **not** from `coffee_alias.platform_name`.

Update, consistently:
- `GET /api/admin/coffee-alias` (admin matrix)
- the public Flavor Intelligence query
- the public Bloom query
- any allocation read that shows a slot name

so that each: (a) resolves the slot name from `dial_slot_alias`, and (b) applies the Phase 2 exclusion. `coffee_alias` **keeps** its fulfillment role — coffee↔slot mapping, `priority`, `is_active`, SKU/Shopify — but its `platform_name`/`dial_sort_order` columns are no longer read as the name/position source (leave them as legacy fallback only for coffees with no live position, same pattern already in place).

## Phase 4 — One coffee, several aliases (seams)

A coffee with more than one `dial_archetype_positions` row (a home plus a guest, from Part 2) resolves to the `dial_slot_alias` of **each** slot it occupies. Because names are slot-keyed, this can never duplicate. Guests stay off the public dial for now (Part 2 kept allocation home-only) — but the resolution must be written so that when a guest is surfaced it simply picks up that slot's existing alias.

## Phase 5 — Admin "Slot Name" editor

Point the Slot-Name editor (currently `PATCH /coffee-alias/slot`, which fans out across `coffee_alias` rows) at `dial_slot_alias` instead — one row per slot, so a rename can't desync and can't collide (the `UNIQUE(platform_name)` enforces it; surface a clear error if an admin tries to reuse a name).

## Phase 6 — The "Other Categories" section (Decaf / Half-Caf / Flavored)

These coffees have **no Bloom Dial** — no slots, no dial positions — but they are still matched to an archetype and are fully shoppable. Present them, on both the Flavor Intelligence page and The Bloom, in a single **"Other Categories"** section placed after the five archetype dials, sub-grouped by category tag exactly as the admin tags them: **Decaf**, **Half-Caf**, **Flavored**.

- **Backend:** add a query/endpoint returning every coffee carrying a Decaf/Half-Caf/Flavored tag, with — a display name (use the coffee's `coffee_alias.platform_name` if present, else the coffee name, e.g. "Classic Decaf", "Smooth Half-Caf"), its category tag(s), and its matched archetype (non-superseded `archetype_assignments`) with a friendly label (e.g. "Chocolate & Nutty").
- **Frontend:** render "Other Categories" after the dials, one sub-group per category (Decaf, Half-Caf, Flavored). Use the **same coffee-card component** as the dial coffees, so every card keeps the **same actions — "Talk to Liam" and "Flavor Intelligence"** — plus its shop / add-to-cart affordance. The **only** thing omitted is the dial-position/slot label; in its place show the **category tag + "matches &lt;Archetype&gt;"**.
- A coffee with two tags (e.g. a flavored decaf) appears under each of its tags. Group order: match the admin's order (Decaf, Half-Caf, Flavored, else alphabetical).

This is the counterpart to the dial: dial-eligible coffees are placed *by slot*; category coffees are grouped *by tag* and carry an archetype match — same data (`archetype_assignments` + `coffee_category_assignment`) and the **same interactions**, just a different placement.

---

## THE ALIAS TABLE (seed values for `dial_slot_alias`)

| archetype | sort_order | platform_name |
|---|---|---|
| balanced_sweet | 1 | Soft & Smooth |
| balanced_sweet | 2 | Classic Balanced |
| balanced_sweet | 3 | Bright & Balanced |
| balanced_sweet | 4 | Lively & Vivid |
| chocolate_nutty | 1 | Soft Cocoa |
| chocolate_nutty | 2 | Classic Chocolate |
| chocolate_nutty | 3 | Deep Cocoa |
| chocolate_nutty | 4 | Full Cocoa |
| earthy | 1 | Gentle Earth |
| earthy | 2 | Grounded & Earthy |
| earthy | 3 | Dark Grounded |
| earthy | 4 | Intense & Dark |
| floral | 1 | Light Floral Edge |
| floral | 2 | Perfumed & Expressive |
| floral | 3 | Complex Bloom |
| floral | 4 | Layered Bouquet |
| fruity | 1 | Clean Fruit |
| fruity | 2 | Bright & Tart |
| fruity | 3 | Vivid Fruit |
| fruity | 4 | Jammy & Aromatic |
| experimental | 2 | The Unexpected |

---

## Verification checklist
- [ ] `SELECT platform_name, COUNT(*) FROM dial_slot_alias GROUP BY 1 HAVING COUNT(*)>1` returns nothing (all unique).
- [ ] chocolate_nutty Classic shows **Noam Blend** again; **Classic Decaf is gone from the dial**.
- [ ] "Deep Cocoa" (Richer) and "Full Cocoa" (Full) are distinct — no name appears at two positions on any dial.
- [ ] Decaf / Half-Caf / Vanilla / Hazelnut / Chocolate appear on **no** flavor dial, but each still has a non-superseded `archetype_assignments` row (Liam/matching intact).
- [ ] Kopi Safari appears **only** under "The Unexpected", not on the earthy dial.
- [ ] The **"Other Categories"** section renders on both FI and The Bloom, sub-grouped Decaf / Half-Caf / Flavored, each coffee showing its tag + matched archetype and **no** dial slot.
- [ ] Each "Other Categories" card still exposes **Talk to Liam** and **Flavor Intelligence** (same actions as dial cards).
- [ ] The same "Other Categories" coffees appear on **no** flavor dial (no double-render).
- [ ] Flavor Intelligence page, The Bloom, and the admin matrix all agree.
- [ ] Renaming a slot in admin updates it everywhere and rejects a duplicate name.

## Out of scope
Surfacing seam guests on the public dial (still home-only from Part 2); final marketing copy for the slot names and the "Other" display names (placeholders, renamable in admin); any change to how a customer is *matched* to a category coffee (matching already works off `archetype_assignments` — this prompt only changes presentation).
