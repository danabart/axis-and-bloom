# Claude Code brief — Usual Drink 4: profile page fixes, the brew-card sentence, and a richer kitchen list (more brands, products, promoting typed names)

Workstream: usual_drink (brief 3 finished 2026-11-25, `CLOSING_REPORT_3.md`) · Written 2026-11-26 by the CTO session · Model: Sonnet (no production fact rows are written; lookup rows arrive by the boot seed) · Dana runs it; push = deploy · **Test mode.** Nothing in matching, the map, the dial or Liam's recommendation changes.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (brands, products, aliases and every new word are rows) · G2.2 surrogate id PK · G2.3 prefix `brew_` · G2.4 CATALOG.md checked (why nothing fits: `brew_cupboard_brand` has no link from a product to its brand; no table needs adding) · G2.5 one writer per table: the kitchen lookups gain their first app writer beside the boot seed, declared in `comments.sql`; reads via the existing views and readers · G2.8 seeds insert if missing · G2.11 values retired, never deleted · G2.17 comments.sql → catalog:md · G2.20 a name a customer typed stays as typed · G3.1 routes call services · G3.6 admin routes gated server-side · G3.9 reuse, do not fork; Task 0 lists every new column, writer and reader and STOPS · G4.1 add a prop, do not re-implement · G4.2 nothing typed in · G4.4 positive copy · G4.5 customers never see a partner roaster's coffees by name · G5.1 vitest · G1.6 push is deploy, one closing report.
Mode: test. STOP points: after Task 0.

**Goal.** Fix four things Dana saw on her profile page, and make the kitchen-coffee list worth searching: about 230 more brands, the best-known products of the big brands, and an admin action that turns a name customers typed into a list entry.

**Decisions already made (Dana 2026-11-26; do not re-open):**

- D1. Under "Your archetype" all of the archetype's customer words show on one line (for Chocolate & Nutty: Full, Grounded, Comforting). This replaces brief 2's "first line always, the others when the block is open": the words are single words, not sentences.
- D2. The archetype number ("NO. 04") is removed from the profile page.
- D3. The history tab row shows no up-and-down scroller.
- D4. The brew cards get one sentence saying where a card comes from.
- D5. The kitchen list is enriched three ways: more brands, products under the big brands, and promoting names customers typed.

CTO calls inside those decisions: a product is one more entry in the same autocomplete, labelled with its brand ("Starbucks Pike Place Roast"), not a second question; no products are listed for partner roasteries (G4.5).

## Task 0 — Survey and confirm (write into `CLOSING_REPORT_4.md`; STOP after it)

1. Repo on `main`, level with `origin/main`, hash; every modified or untracked code file. This folder's `README.md` and `kitchen_list_2026_11_26.csv` are this brief's; `commerce/CLOSING_REPORT_6.md` and the genova `.ttf` deletions stay unstaged.
2. `Profile.tsx`: the feature-line filter (~523, `i === 0 || openBlock === 'primary'`), the history tab row (~638, `overflow-x-auto` with `-mb-px` on the buttons) and the top tab row (~448). `DialArchetypeSection.tsx` (~462, `bd-breakout-archno`) and `dial/BloomDial.tsx` (~658, ~664): every place the number renders when the section is used on the Profile, primary and adjacent. Confirm what causes the vertical scroller in the history row and whether the top tab row has the same cause.
3. Brew cards: `routes/users.ts` (~644, the flavor-memory payload), `BrewCards.tsx`, and how a card's recipe is built in `brewCard.ts`. Report where the per-method recipe table and its adjustments live today (Firestore `config/sommelier` `brewDefaults`, with `FALLBACK_BREW_DEFAULTS` typed in code): for the OPEN_TASKS line only, nothing moves in this brief.
4. Kitchen lookups on production, read-only: row counts of `brew_profile_field_value` for `cupboard_coffee`, `brew_cupboard_brand`, `brew_cupboard_brand_alias`; confirm none of the 329 codes in `kitchen_list_2026_11_26.csv` exists yet and none of its aliases collides with an existing alias. Report any collision instead of resolving it silently.
5. Typed names on production, read-only: each distinct `customer_words` on `cupboard_coffee` rows with its customer count.
6. The admin side as built: `routes/brewProfileAdmin.ts` (`/stats`, `/parameters`), `AdminBrewProfileStats.tsx`, `customerReads.getBrewProfileFieldCounts`, and where typed names already show. How the field-list cache refreshes (`field_list_refresh_seconds`), so a new entry reaches the page without a deploy.
7. Readers of a kitchen answer's brand: `v_customer_cupboard_coffee` (brief 3), `getCupboardCoffee`, the `/map` said-back key `cupboard_coffee:<code>`, integrity checks on the brand rows and their seed counts.
8. G3.9 list. Planned: one column (`brew_cupboard_brand.parent_brand_id`); one writer module for the kitchen lookups (`brew_profile_field_value` rows of `cupboard_coffee`, `brew_cupboard_brand`, `brew_cupboard_brand_alias`), today seed-only; one admin read of typed names (extend `getBrewProfileFieldCounts` or its neighbour, say which); two admin routes; `v_customer_cupboard_coffee` body changed (C3); two component props (`hideNumber`; the about sentence). Name what was considered for each. **STOP for Dana's yes.**

## Task 0.5 — Dana's manual steps
None.

## Part A — Page fixes (frontend; no data)

A1. Archetype words: every customer word of the archetype on one line, in order, separated the way the routine's kitchen line was (a middle dot), always visible. The open-block condition goes.

A2. The number: `DialArchetypeSection` gains a `hideNumber` prop (G4.1), passed down to the dial; `Profile.tsx` sets it on the primary and the adjacent section. The Bloom page and Find My Flavor are unchanged.

A3. The history tab row: no vertical overflow (the active underline sits inside the row; vertical overflow hidden), and it still scrolls sideways on a phone. Apply the same to the top tab row if Task 0 finds the same cause.

A4. Brew cards sentence: `brew_parameter` text `brew_cards_about`, insert if missing: "Each card starts from a standard recipe for the way you brew. We adjust it for that coffee and add how you take it." The flavor-memory payload carries it (read through `brewTextParams`); `BrewCards` shows it once, under its heading, above the first card. No words typed in the component.

## Part B — More brands and products (schema seed)

B1. `brew_cupboard_brand.parent_brand_id INT REFERENCES brew_cupboard_brand(id)`, nullable: set on a product, pointing at its brand. `comments.sql` says so.

B2. Seed from `kitchen_list_2026_11_26.csv` (this folder; columns `code, label, brand_kind, parent_code, aliases` with aliases separated by `|`), as insert-if-missing rows in a marked USUAL DRINK 4 block of `schema.sql`:
- 229 brand rows: a `cupboard_coffee` value (label as given, not pinned, no words), its `brew_cupboard_brand` row with the given kind, and its aliases lower-cased.
- 100 product rows (`parent_code` set): a value, and a `brew_cupboard_brand` row with the parent's kind and `parent_brand_id`.
- Sort order: brands after the existing ones in file order; each product directly after its brand, so typing the brand lists the brand first and then its products.
The CSV is the reviewable source; the seed in `schema.sql` is generated from it once and committed. Do not read the CSV at runtime.

B3. Integrity: the seed counts and the brand-row checks cover the new rows; one new informational check: a product whose parent is inactive or is itself a product.

## Part C — Promote a typed name (admin)

C1. Read: the admin brew-profile block lists each typed kitchen name (as typed, case-folded for grouping) with its customer count, most common first, leaving out names that already match an alias.

C2. Write, one door: a service function (the new writer of Task 0 item 8) that adds a brand from a typed name in one transaction: the `cupboard_coffee` value (admin-entered label, generated unique code), its `brew_cupboard_brand` row (kind from `brew_cupboard_brand_kind`, optional parent brand), and an alias equal to the typed name lower-cased and trimmed. Idempotent on the alias. Admin route gated by the DB role (G3.6), zod-validated. A second route retires an entry (`is_active = false`), never deletes it. The admin form's options (kinds, brands) come from the API.

C3. Old answers stay as typed (G2.20): no `customer_brew_profile_change` row is written or changed by a promotion. `v_customer_cupboard_coffee` resolves them on read: when the stored value is the words value and the customer's words match exactly one alias of an active brand, the view returns that brand's value, label and kind, and still returns `customer_words`. The customer's own page keeps showing their words.

C4. A promoted or seeded entry reaches the autocomplete on the next field-list refresh, with no deploy. Liam's prompt field list picks it up the same way.

## Part D — Tests (vitest, test DB)

Frontend: all three archetype words on one line with the block closed; no number on the Profile's sections and the number still on the Bloom page; the brew-cards sentence renders from the payload; typing a brand lists the brand first, then its products; typing a product word ("pike") finds the product.
Backend: seed counts; a product row carries its parent and the parent's kind; promote writes one value, one brand row, one alias, and twice is once; a typed answer resolves to the promoted brand in `v_customer_cupboard_coffee` while its row is unchanged; retire hides an entry from the options and keeps it displayable; a non-admin gets 403.

## Acceptance (one closing report, `CLOSING_REPORT_4.md`; screenshots `ud4_*.png`)

Local backend, test DB, a marked test customer and an admin, at desktop width and at 390 px.
1. Profile: the archetype words read on one line; no "NO." on the page; the history tab row has no vertical scroller at either width; the Brew cards tab shows the sentence.
2. Kitchen: "tatte" finds Tatte Bakery & Café; "starbucks" lists Starbucks, then its products; "pike" finds Starbucks Pike Place Roast; a picked product saves and shows as a chip.
3. Admin: a typed name appears with its count; promoting it adds the entry; after the field-list refresh it is in the autocomplete; the customer who typed it still sees their own words, and `v_customer_cupboard_coffee` returns the promoted brand for them.
4. `/map` for a customer with a kitchen answer reads as before.
5. Lints, `tsc --noEmit` (both sides), `vitest run src` green apart from the known set. Push, deploy green, boot log clean (field count unchanged, value counts up by 329), production smoke of 2 through the API as the smoke test user.

## Docs (G6)

`WHAT_WE_BUILT.md` (next number, naming this file) · `WHAT_WE_BUILT_DB.md` one "As of" line · `comments.sql` (the new column; the `Writer:` fields of the three kitchen lookups; the readers) → `npm run catalog:md -- --expect-db axisandbloom` → `CATALOG.md` committed · `REGRESSION.md` (acceptance 1 to 3) · `OPEN_TASKS.md`: OT-130 and OT-178 closed by Part C; the brew-card recipe table still lives in Firestore config with a code fallback (G2.1, G2.15), its own brief; product names are a snapshot of 2026-11-26 and need the admin's upkeep · this folder's `README.md` · `CLOSING_REPORT_4.md`.

## Do not

- Do not change matching, the map, the start rules, the dial or Liam's recommendation.
- Do not write, update or delete any `customer_brew_profile_change` row.
- Do not delete a value, a brand or an alias; retire it.
- Do not add products for a partner roastery, or anything that links a kitchen entry to an Axis & Bloom coffee.
- Do not type a brand, a product, a kind or a customer-facing word into a component, a service or a view body.
- Do not move the brew-card recipe table in this brief.
- Do not stage anything but this brief's files; commits add files by path.
- Do not open a PR or leave a commit unpushed.
