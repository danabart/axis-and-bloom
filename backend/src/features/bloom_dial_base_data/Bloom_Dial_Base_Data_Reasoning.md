# Bloom Dial — Base Data & Reasoning (v2)

Companion to `Bloom_Dial_Base_Data.xlsx`. Still a **conceptual first draft** to cup against — but v2 reworks two things from our discussion: it treats the archetypes as a **graph** with multi-dimensional edges, and it places coffees for **connectivity first, accuracy later**.

Nothing here is written into the codebase; it's review data that maps onto `dial_archetype_positions` and `dial_coffee_relationships` when you're happy with it.

## How coffees connect today (the mechanism)

The edges in `dial_coffee_relationships` are **coffee→coffee**, not archetype→archetype. Each carries one `dimension_id`, a `direction` (more/less), and a `hop_type`: `within_archetype` (a Dial Turn), `bridge_archetype` (a Bridge), or `category_hop` (to Experimental). The archetype-level map is *derived* — `v_archetype_adjacency` groups the coffee-level bridge hops by the archetype pair of their endpoints. So there's one concrete coffee graph, and the archetype adjacency emerges from it. Liam walks that graph outward; on "too strong" feedback he traverses `direction = 'less'` on the relevant dimension.

Key enabler for the graph idea: the unique key is `(from_coffee, to_coffee, dimension_id, direction)` — `dimension_id` is *in* the key, so two coffees can already carry **parallel edges on different dimensions**. The schema is a multigraph; we just hadn't used it that way.

## The archetype graph

Nodes are archetypes, each with a **profile across several dimensions** (not just its dial axis — see the Archetype Graph tab). Edges are parallel, dimension-labeled and directional; a pair can share more than one.

The connecting rule, which also explains your quiz:

- Archetypes that differ on **one clean dimension** get a **single edge**, and the quiz separates them by scoring alone — no branch. That's balanced_sweet↔fruity (Acidity) and balanced_sweet↔chocolate_nutty (Body).
- Archetypes that **share their strongest dimension** and diverge across a **bundle** of others get **multiple edges** — and those are exactly the pairs your quiz had to add a *branch question* for, because no single score separates them. That's chocolate_nutty↔earthy and fruity↔floral.

Reading it as spines off the balanced_sweet hub:

- **Intensity spine** (Body, then Bitterness): balanced_sweet → chocolate_nutty → earthy.
- **Brightness path** (Acidity): balanced_sweet → fruity.
- **Delicacy branch** (Savory/Depth, toward light): fruity → floral.

On chocolate_nutty↔earthy specifically: Body is *shared-high* (that's why they feel adjacent — the "intensity" the quiz names), but what **measurably moves** is Bitterness (primary edge) with Savory/Depth rising alongside (secondary edge). On fruity↔floral: primary edge is Savory/Depth (more aromatic complexity), secondary is Body (less — "barely feels like coffee, like tea"). Both branched seams therefore get two bridge edges in the Bridge Hops tab, not one.

## Spread for connectivity (the placement change)

With only a handful of coffees per archetype, clustering them near the middle leaves a short dial with dead edges and no reach to its neighbors. So the rule is: **fill the middle (the default, slot 2) first, then the edges (slots 1 and 4), before intermediate slots.** A dial that reaches both edges spans its full range and touches its neighbors even on thin inventory; gaps between filled slots are crossed by multi-step Dial Turns. As inventory grows, coffees relax back toward their true cupped positions and fill the gaps. The three Session-001 **cupped** coffees are never moved — we have real data on them.

Your example drove this: 6-Bean Espresso moves from Richer (slot 3) to **Full (slot 4)**, so chocolate_nutty actually reaches its intense edge — which is the earthy seam. Applied across the catalog, the moves are:

| Coffee | Was | Now | Why |
|---|---|---|---|
| 6-Bean Espresso (TCR) | Richer (3) | Full (4) | Darkest CN → reaches the Full edge / earthy seam |
| Blonde Blend (TCR) | Smooth (1) | Bright (3) | Light roast = brighter; fills the slot below the high edge |
| Colombia (TCR) | Bright (3) | Lively (4) | Reaches the high edge / fruity seam |
| Vantablack (Path) | Bold (3) | Intense (4) | Ultra-dark → the intense edge |
| Uganda (TCR) | Bold (3) | Intense (4) | Gives TCR earthy a full 2-3-4 chain |

Result — every archetype now spans a connected range: balanced_sweet 1-2-3-4, fruity 1-2-4, chocolate_nutty 2-3-4, earthy 2-3-4. Only floral stays thin (1-2) because it only has three coffees; its important edge (Delicate, the fruity seam) is filled by Papua New Guinea.

## Seam positions — one coffee, two dials

The edges that are still empty get filled by **reusing a coffee from the adjacent dial** at its touching slot. A coffee keeps one *home* archetype (its identity, Liam's voice, its SKU/allocation); a guest slot is just a pointer that welds two dials together. It never becomes a default and gets no separate SKU. Three seams close the remaining edge gaps:

| Coffee | Home | Guest | Fills | Aligned dimension |
|---|---|---|---|---|
| 6-Bean Espresso | chocolate_nutty Full (4) | earthy Gentle (1) | earthy's empty low edge | Body shared-high / Bitterness low |
| Colombia (TCR) | balanced_sweet Lively (4) | fruity Bright (3) | fruity's Bright gap | Acidity (shared axis — one score, two labels) |
| Guatemala (TCR) | balanced_sweet Balanced (2) | chocolate_nutty Lighter (1) | CN's empty low edge | Body |

The balanced_sweet↔fruity seam is the cleanest because those two archetypes **share** their dominant dimension (Acidity) — one acidity reading literally places the coffee on both dials at once. The others need two readings (e.g. high Body *and* low Bitterness) and so are lower confidence until cupped.

## Still needs a human call

The **Feather In Cap** archetype conflict (balanced_sweet vs chocolate_nutty) is unresolved — recommended balanced_sweet, confirm at cupping; and if it stays balanced_sweet, the old Crosshatch↔Feather *body* bridge becomes a within-archetype Dial Turn (flagged in Bridge Hops). The **six uncategorized coffees** carry low-confidence archetype proposals and stay off the dial until cupped. And **every spread move and every seam** is a deliberate stretch for connectivity — green and purple rows in the workbook — to be tightened as cupping data arrives.

## Using this

The tabs map onto the tables: Archetype Map + Dial Positions → `dial_archetype_positions`; Dial Turns + Bridge Hops → `dial_coffee_relationships` (with `dimension_id`/`direction`/`hop_type`/`is_recommended`/`confidence`); Seam Positions → additional `dial_archetype_positions` rows on a non-home archetype; Archetype Graph → the reasoning that keeps the coffee-level hops consistent (and consistent with the quiz branches). When it looks right, it becomes a Claude Code prompt to generate the seed SQL.
