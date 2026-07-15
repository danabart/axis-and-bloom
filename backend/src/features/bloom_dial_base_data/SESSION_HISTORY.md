# Session history — Bloom Dial Base Data, Parts 1–4 (2026-07-14 to 2026-07-15)

Summary of the Claude Code session that deployed the full Bloom Dial base dataset and its follow-up UI corrections, for continuity in future sessions.

## What was asked

Work on "coffee hops and base data" for the Bloom Dial, related to the Axis & Bloom project. Confirm active git and GCP connections first. All commits through git directly (no PRs). Keep `WHAT_WE_BUILT.md`, `WHAT_WE_BUILT_DB.md`, and `SOMMELIER_BUILT.md` updated throughout.

## Starting state

- Git and GCP access confirmed at session start: repo on `main`, in sync with `origin/main`; `gcloud` authenticated as `danabar.mail@gmail.com` against `axis-and-bloom-prod`.
- Found a pre-written spec package, untracked, in `backend/src/features/bloom_dial_base_data/`: `Bloom_Dial_Base_Data.xlsx` (source workbook), `Bloom_Dial_Base_Data_Reasoning.md`, `Bloom_Dial_Deployment_Mapping.md`, and two Claude Code prompt specs (Part 1: Seed + Hops, Part 2: Seam Positions). Parts 3 and 4's spec files appeared mid-session, added by a concurrent editing session working on unrelated Axis-page content in the same repo.
- The xlsx has no native reader in this environment — read via a one-off `openpyxl` Python script (pip-installed ad hoc) dumping every sheet to text.

## Part 1 — Seed + Hops (commit `0b031ad`)

Loaded archetype assignments, dial positions (5 "spread for connectivity" moves), and the full hop graph (46 rows + 2 `category_hop` rows) for all 29 catalogue coffees, per the workbook.

**Spec facts checked against live prod before building, not trusted blindly:**
- The Part 1 doc claimed the hop-authoring endpoint (`POST /dial/relationships`) didn't exist ("Gap B"). It already did, built in an earlier (pre-this-session) pass — only a missing `category_hop` hard-rejection was actually needed.
- Feather In Cap's `balanced_sweet` vs `chocolate_nutty` archetype conflict, flagged as unresolved in the workbook, was already resolved in prod from a prior session.
- **Found and did not blindly seed:** a new hop between Ethiopia (Path) and Ethiopia Natural (TCR) would have connected two coffees the workbook assumed were different archetypes (fruity vs floral) but which — per live `archetype_assignments` — are actually both `floral`. Dropped the hop rather than guess; flagged the underlying Ethiopia (Path) archetype/dial-position mismatch as a pre-existing conflict needing a human call (still open — see "Open items" below).
- Also noted, not fixed: Vanilla (Path) already has a stray `balanced_sweet` dial position from before the workbook's redesign, even though it's supposed to stay off-dial until cupped.

Verified against production Cloud SQL (Auth Proxy) before and after every seed file; booted the backend locally against prod and hit `/health`, `/api/coffees`, `/api/coffees/archetype-stats`, `/api/coffees/:id/hops`, `/api/coffees/:id/legacy-slot`.

## Part 2 — Seam Positions (same commit, `0b031ad`)

Added `is_guest BOOLEAN` + `dap_guest_not_default` CHECK to `dial_archetype_positions`; changed `POST /coffees/:id/archetype` to only touch the home (`is_guest=false`) row on a re-tag; new `POST`/`DELETE /dial/positions/guest[/:id]` endpoints; locked `coffee_alias`/`blendResolver.ts` allocation paths to home-only positions. Seeded the 3 seam rows (6-Bean Espresso Blend→earthy, Colombia TCR→fruity, Guatemala TCR→chocolate_nutty).

Verified live: a simulated home re-tag against a coffee with a guest row confirmed the guest row survives untouched; the `dap_guest_not_default` CHECK tested live (correctly threw `23514`).

Docs: `WHAT_WE_BUILT.md` #93, `WHAT_WE_BUILT_DB.md`, `SOMMELIER_BUILT.md` S43 (confirmed Liam's RAG — reads `v_dial_navigation` only — unaffected).

## Part 3, Phases 1–5 — alias-as-slot regression fix (commit `2b07e8e`)

Deploying Parts 1–2 broke production in two ways, both confirmed live before any code was written (not assumed from the spec):
1. Category coffees (Decaf, Sleepwalker Half-Caf, etc.) started squatting real dial slots — e.g. `chocolate_nutty` slot 2 showed "Classic Decaf" instead of Noam Blend — because giving them real `archetype_assignments` rows made `resolveBlendForSlot`'s `COALESCE(aa.archetype, ca.archetype)` fallback match their stale stored `coffee_alias` columns.
2. The `experimental` dial went completely empty for the mirror-image reason (Kopi Safari's archetype moved away from `'experimental'`).

**Root-cause fixes:** `blendResolver.ts` now excludes any coffee carrying a Decaf/Half-Caf/Flavored/Experimental category tag from dial-slot resolution outright. `GET /api/coffees/archetypes` filters `is_archetype = true`, dropping the broken `experimental` loop entry. New `dial_slot_alias(archetype, dial_sort_order, platform_name)` table — a slot's display name is now a property of the slot, not of whichever coffee occupies it (fixes a second bug: duplicate names like two coffees both called "Deep Cocoa"). Every reader (public + admin) rewired to source names from here; admin rename paths now upsert `dial_slot_alias` with a `409` on duplicate names instead of fanning out across `coffee_alias` rows.

Verified against prod before and after; booted locally against prod; confirmed live post-deploy.

Docs: `WHAT_WE_BUILT.md` #94, `WHAT_WE_BUILT_DB.md`.

## Part 3, Phase 6 — Other Categories / The Unexpected shop support (commit `8ed7761`, forked)

Phase 6 needed a decision from Dana: the 6 category coffees had no pricing/cart-item model (no dial position to key one off `dial_slot_price`, which is `archetype+dial_sort_order` keyed). Asked via `AskUserQuestion`: browse-only, real shop/cart support, or hold off. **Chose real shop/cart support.**

Delegated to a forked agent (inherits full session context) given the scope: new `coffee_retail_price(coffee_id, weight_oz, retail_price_cents)` table + `resolveCoffeeBlend()` (the coffee-keyed counterpart to `resolveBlendForSlot`), new public `GET /api/coffees/other-categories`, admin `GET`/`PATCH /api/admin/coffee-prices`, a third `orders.ts` item-resolution branch, `CartItem` turned into a discriminated union (`DialCartItem` | `DirectCartItem`, every existing call site updated), new `OtherCategoryCard.tsx` wired into both The Bloom and Flavor Intelligence, and direct-by-coffee-id selection added to the FI page.

**Real shoppability at ship time, live-verified:** Decaf, Sleepwalker Half-Caf, and Kopi Safari had real `roaster_blend` rows → working add-to-cart. Vanilla, Hazelnut, and Chocolate had none → correctly "Temporarily unavailable," not a bug.

Independently re-verified after the fork reported done (own `git fetch`/GitHub API check + a live hit on `/api/coffees/other-categories`) before trusting the summary.

Docs: `WHAT_WE_BUILT.md` #95, `WHAT_WE_BUILT_DB.md` (separate commit).

## Follow-up fix — Liam and admin Inventory still citing stale names (commit `7d3d489`, #96/S44)

Prompted by a direct question ("did you update all three build docs?") — checking `SOMMELIER_BUILT.md` revealed #94/#95 never got a Liam-impact continuity note. Checking *why* surfaced a real bug, not just a missing doc: `sommelierRag.ts`'s `getAliases()` — "the only customer-facing identity Liam's catalog context may use" — read `coffee_alias.platform_name` directly, the exact column #94 declared legacy/unread.

**Verified live before fixing:** 10 of 26 dial coffees had a stale-name mismatch (Liam would say "Deep Cocoa" for 6-Bean Espresso Blend; the site had already renamed it to "Full Cocoa"). Fixed by joining `dial_slot_alias` the same way every other reader does, with a fallback to `coffee_alias.platform_name` preserved only for the 6 category coffees (which legitimately have no dial slot). Found and fixed the identical bug in `GET /api/admin/inventory` while auditing every remaining `coffee_alias.platform_name` read in the codebase.

Docs: `WHAT_WE_BUILT.md` #96, `WHAT_WE_BUILT_DB.md`, `SOMMELIER_BUILT.md` S44 (separate commit `b6ad1c2`) — used the isolated-hunk `git apply --cached` technique (see "Working alongside a concurrent editor" below) since a concurrent editor had unrelated content sitting uncommitted in the same three files.

## Part 4 — post-deploy UI corrections (commit `1c943a1`, forked)

A new spec appeared mid-session (`CLAUDE_CODE_PROMPT_BLOOM_DIAL_BASE_DATA_PART4_UI_CORRECTIONS.md`), added by the concurrent editor. User said to hold off touching it until given the go-ahead; later said to proceed.

Researched locked-in design decisions first (confirmed `v_archetype_vectors` keying, `GET /api/users/profile`'s `archetype.id` shape, `dial_slot_alias`'s then-current 21-row count, and the existing `ARCHETYPE_NAME_TO_KEY` mapping in `users.ts` to reuse rather than reinvent), then forked the implementation:

- **§A** — seeded the 3 missing experimental `dial_slot_alias` rows (21→24 total); new `GET /api/admin/dial/slot-aliases` so the admin matrix always names every slot, empty or not.
- **§B1/C1** — card titles show the alias only (dropped the `"{position} — "` prefix).
- **§B2/C1** — new `GET /api/coffees/experimental`, a real archetype-style box titled "Experimental" on both public pages. Required a genuine backend fix: `resolveBlendForSlot`'s `COALESCE(aa.archetype, ca.archetype)` let a coffee's *matching* archetype override its actual *dial position*, so Kopi Safari's own experimental slot resolved to nothing — fixed precedence to `COALESCE(dap.archetype, aa.archetype, ca.archetype)`.
- **§B3** — new `GET /api/coffees/archetype-order`, Euclidean distance over `v_archetype_vectors`' `ideal_score`. Caught and fixed a live 500 (invalid `archetype` param crashed an enum cast) before shipping — confirmed by hitting it live post-deploy with a garbage param, correctly falls back to the default order instead of erroring.
- **§C1** — removed FI's separate "Other Categories" section; category coffees now nest under their matched archetype's accordion entry instead.
- **§C2** — "Worth exploring" pill no longer wraps.
- **§E** — hardcode audit; removed the now-dead `ARCHETYPE_ORDER` array from `BloomPage.tsx`'s sort logic. Visual/asset constants (colors, hero images) deliberately left alone — not the kind of hard-coding the spec meant.

**Known gap, flagged not fixed:** the same archetype-precedence bug (`COALESCE(aa.archetype, ca.archetype)` letting match-archetype override actual position) exists in ~10 other places (`admin.ts`, `sommelierRag.ts`). Only `resolveBlendForSlot` was in scope for Part 4. Concretely, the **admin Coffees matrix still misfiles Kopi Safari under "Earthy"** instead of "Experimental" — pre-existing since Part 1, not yet fixed anywhere except the one endpoint Part 4 needed.

**Mid-task incident, resolved cleanly:** the concurrent editor committed and pushed their own Axis V2 rebuild (`6a333ae`) while the fork was mid-staging its doc updates. Caught via `git status` before committing; unstaged their files without touching their working tree; re-verified independently afterward (fresh `git fetch` + `git log`) that all three commits — the fork's code, their Axis commit, and the fork's doc follow-up — landed cleanly and separately with nothing lost or corrupted on either side.

Docs: `WHAT_WE_BUILT.md` #97, `WHAT_WE_BUILT_DB.md`, `SOMMELIER_BUILT.md` S45 (separate commit `e5175b8`).

## Working alongside a concurrent editor

A second, unrelated editing session was active in this same repo for most of this session (building "The Axis" page V2 — `axis.ts`, `TheAxis.tsx`, `theme.css`, `frontend/src/app/components/axis/`, `the_axis_page/` docs). Their in-progress, uncommitted work was left completely untouched throughout, including when it sat commingled in the same shared files (`WHAT_WE_BUILT.md`, `WHAT_WE_BUILT_DB.md`) that this session also needed to edit.

**Technique used repeatedly:** rather than `git add`-ing a whole file (which would stage their unrelated, unfinished content too), generate the diff, isolate the new hunk belonging to this session into a standalone patch file, `git apply --cached --check` then `git apply --cached` it, verify with `git diff --cached --stat` that only the intended lines are staged, then commit. Used for commits `652d56b`, `750c620`, `b6ad1c2`, and by the Part 4 fork for `e5175b8`.

## Commits (chronological)

| Commit | What |
|---|---|
| `0b031ad` | Part 1 + Part 2: base data, hops, seam positions |
| `a7edfff` | Docs for #93 |
| `2b07e8e` | Part 3 Phases 1–5: alias-as-slot regression fix |
| `652d56b` | Docs for #94 |
| `8ed7761` | Part 3 Phase 6: Other Categories / shop support |
| `750c620` | Docs for #95 |
| `7d3d489` | Liam + admin Inventory alias staleness fix |
| `b6ad1c2` | Docs for #96/S44 |
| `1c943a1` | Part 4: post-deploy UI corrections |
| `6a333ae` | *(concurrent editor's Axis V2 rebuild — not this session's work)* |
| `e5175b8` | Docs for #97/S45 |

Every commit verified live post-deploy (GitHub Actions `Deploy` run status polled via the GitHub API, then a real HTTP hit against `https://axis-bloom-backend-oiub7eumya-uc.a.run.app`) before being reported as done.

## Documentation updated

- `WHAT_WE_BUILT.md` — entries **#93–#97**.
- `WHAT_WE_BUILT_DB.md` — `dial_archetype_positions`, `dial_coffee_relationships`, `coffee_alias`, `dial_slot_alias`, `coffee_retail_price`, `v_dial_positions`, and the seed-file table all updated across the five commits above.
- `SOMMELIER_BUILT.md` — entries **S43, S44, S45**. S43 and S45 confirm no Liam impact (after actually checking, not assuming); S44 documents a real Liam-facing bug found and fixed.

## Open items (not done this session, need a human call or dedicated follow-up)

1. **Ethiopia (Path) archetype/dial-position conflict** — live `archetype_assignments` says `floral` (confidence=high, real cupping data); its `dial_archetype_positions` row still has it as the `fruity` dial's default. Needs a decision on which side is correct.
2. **Vanilla (Path) stray dial position** — sits on the `balanced_sweet` dial (`Smooth`/1) from before the workbook's redesign, despite being flagged as "off-dial until cupped." Product decision, not a code bug.
3. **The broader `COALESCE(aa.archetype, ca.archetype)` precedence bug** — Part 4 fixed this in `resolveBlendForSlot` only. The same pattern exists in ~10 other places (`admin.ts`, `sommelierRag.ts`); the admin Coffees matrix concretely still misfiles Kopi Safari under "Earthy" instead of "Experimental" as a result.
