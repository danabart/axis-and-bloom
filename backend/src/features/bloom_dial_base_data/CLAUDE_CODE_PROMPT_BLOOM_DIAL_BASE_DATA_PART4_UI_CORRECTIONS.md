# Claude Code Prompt — Bloom Dial Base Data, Part 4: Post-deploy UI corrections

Follow-up to Part 3 (which deployed correctly — slot aliases are unique, category coffees are off the dial). These are review corrections across the admin Coffees page, The Bloom, and Flavor Intelligence. **Overarching rule (see §E): every name, order, and grouping on these pages must come from the database — nothing hard-coded or written in the frontend.**

## Read first
- Frontend: `frontend/src/app/components/BloomPage.tsx`, `bloom/ArchetypeSection.tsx`, `bloom/PositionCard.tsx`, `bloom/OtherCategoryCard.tsx`, `FlavorIntelligencePage.tsx`, `admin/AdminCoffees.tsx`.
- Backend: `routes/coffees.ts`, `routes/axis.ts` (`/vectors` ← `v_archetype_vectors`, `/adjacency` + `/stats` ← `v_archetype_adjacency`), `routes/admin.ts` (`dial_slot_alias` from Part 3).
- Data: `dial_slot_alias` (slot names), `archetype_assignments` (match), `coffee_category_assignment` + `coffee_category` (tags), `v_archetype_adjacency` (neighbors), `v_archetype_vectors` (distance).

---

## A. Admin Coffees — name every slot (no blank aliases)

The matrix currently builds slots from coffee rows, so a slot with no coffee shows blank. Instead, **enumerate every slot from `dial_slot_alias`** (all 4 per archetype, including experimental) and always show its alias name — even when no coffee is mapped (render an "empty" state under the name). No slot should ever appear nameless.

Also seed the **missing experimental slot aliases** so experimental has no unnamed slots (Part 3 only seeded slot 2). Add to `dial_slot_alias` (unique names, renamable placeholders):

| archetype | sort_order | platform_name |
|---|---|---|
| experimental | 1 | Curious Start |
| experimental | 3 | Daring Edge |
| experimental | 4 | The Wild Card |

(experimental 2 = "The Unexpected" already exists.)

---

## B. The Bloom page

**B1 — alias only in the card title.** Cards currently read `"{position} — {alias}"` (e.g. "Smooth — Soft & Smooth"). Show the **alias only** ("Soft & Smooth"). Drop the dial-position label from the title; the slot alias is the name.

**B2 — Experimental is an archetype-style box, titled "Experimental".** Today it renders as a "The Unexpected" section — wrong: "The Unexpected" is a *slot alias*, not the section name. Render Experimental as a 6th box that looks and behaves like the five archetype boxes, **titled "Experimental"** (the family name, like "Chocolate & Nutty"). Inside, its coffees show their own slot alias (Kopi Safari → "The Unexpected"). Source the box's coffees from the **Experimental category tag** and their experimental dial slot + `dial_slot_alias` (archetype = experimental). A coffee's behind-the-scenes match archetype (Kopi Safari → earthy, used for matching/Liam) is separate and must not change.

**B3 — order the archetype boxes by the customer's match.** Order per customer: the customer's **matched archetype first**, then the rest by **ascending distance** (nearest neighbor next, then next-closest, …). Compute distance in the **backend** from `v_archetype_vectors` (Euclidean over the archetype vectors), using `v_archetype_adjacency` as the neighbor signal; expose the personalized order via an endpoint and have the frontend render in that order — **do not hard-code the order in the component.** No match yet (pre-quiz) → fall back to a fixed default order. Place the **Experimental** box after the flavor archetypes, and keep the **Other Categories** section last.

Keep the Other Categories section on The Bloom exactly as Part 3 built it (shopping page).

---

## C. Flavor Intelligence page

**C1 — categories nest under their archetype (not a separate section).** Flavor Intelligence is not the shopping page, so it should **not** show the Bloom-style "Other Categories" section. Remove it here. Instead, inside each archetype box, after its 3–4 dial coffees, add a **"Categories"** sub-heading listing the category coffees whose **matched archetype = that archetype** (e.g. under Chocolate & Nutty: its dial coffees, then "Categories: Decaf, Half-Caf"). Label each by its category tag. Experimental is shown as its own archetype-style box here too (same as B2).

**C2 — "Worth exploring" pill.** Widen the rounded pill so the phrase stays on one line (no wrap) and looks balanced.

Apply the alias-only title (B1) here as well, for consistency.

---

## D. Keep matching intact
None of the above changes matching. Category and experimental coffees keep their `archetype_assignments`; they're only presented differently (nested list on FI, "Other Categories" on Bloom, Experimental box for experimental). Liam and the quiz are untouched.

## E. DB-driven — verify nothing is hard-coded
Audit `BloomPage.tsx`, `FlavorIntelligencePage.tsx`, `ArchetypeSection.tsx`, `PositionCard.tsx`, `OtherCategoryCard.tsx`, `AdminCoffees.tsx` for any **hard-coded** archetype names, slot/alias names, archetype order arrays, or category lists — replace every one with data fetched from the DB via the endpoints above. Confirm all Part 3 + Part 4 seed rows are actually written (`SELECT count(*) FROM dial_slot_alias` = 24: 20 flavor + 4 experimental) and that the pages render from those rows, not from constants.

---

## Verification checklist
- [ ] Admin: every slot (all archetypes incl. experimental) shows its alias name, empty slots included; no blank slot; `dial_slot_alias` has 24 unique rows.
- [ ] Bloom: card titles show the alias only (no "position —" dash).
- [ ] Bloom: Experimental renders as its own box **titled "Experimental"**, coffees inside show their slot alias ("The Unexpected"), not the section named after the alias.
- [ ] Bloom: archetype boxes are ordered with the customer's match first, then nearest-first; order comes from a backend endpoint, not a hard-coded list; Experimental after the flavor boxes; Other Categories last.
- [ ] FI: no separate "Other Categories" section; each archetype box lists its dial coffees then a "Categories" sub-list of its matched category coffees; Experimental box present.
- [ ] FI: "Worth exploring" pill does not wrap.
- [ ] Grep confirms no hard-coded archetype/slot/category names or order in the six components; all render from DB.
- [ ] Kopi Safari's earthy match (and all category coffees' archetype_assignments) unchanged.

## Out of scope
Final marketing copy for placeholder slot names; surfacing seam guests on the public dial (still home-only).
