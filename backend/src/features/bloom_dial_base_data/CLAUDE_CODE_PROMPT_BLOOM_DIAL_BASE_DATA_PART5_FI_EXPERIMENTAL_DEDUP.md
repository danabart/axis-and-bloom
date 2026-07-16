# Claude Code Prompt — Bloom Dial Base Data, Part 5: FI Experimental de-dup

Small fix on top of Part 4. On the Flavor Intelligence page, experimental coffees render **twice**: once in the Experimental box (Part 4 §B2, sourced from the Experimental category tag) and again in a "Categories" sub-list (Part 4 §C1, which nests category coffees under their matched archetype). Since Kopi Safari is an Experimental-category coffee *and* matched to experimental, it appears in the Experimental box and in that box's own "CATEGORIES: EXPERIMENTAL" list.

Root cause: the "Categories" nesting includes the **Experimental** category, but Experimental is a presentation *box*, not a nestable category.

## Fix
The **"Categories" sub-list (FI, Part 4 §C1) must include only `Decaf`, `Half-Caf`, and `Flavored`** — never `Experimental`. Experimental coffees appear **only** in the Experimental box. Concretely:
- Exclude any coffee carrying the `Experimental` category from the per-archetype "Categories" sub-list, on every archetype box (including the Experimental box itself — it gets no "Categories" sub-list at all).
- Leave the Experimental box (§B2) and the Decaf/Half-Caf/Flavored nesting unchanged otherwise.
- Apply the same exclusion anywhere the "matched archetype → category coffees" grouping is computed (backend query and/or frontend), so it can't reappear.

Do **not** change any data — Kopi Safari's `archetype_assignments` (now experimental, with the superseded earthy row kept for history) is correct and stays as is. This is presentation-only.

## Verify
- [ ] On FI, Kopi Safari appears exactly **once** — in the Experimental box ("The Unexpected"); no "CATEGORIES: EXPERIMENTAL" sub-list anywhere.
- [ ] Decaf / Half-Caf / Flavored still nest correctly under their matched archetype.
- [ ] Changing a coffee's archetype in admin (append/supersede) still leaves exactly one active assignment and one presentation location.
