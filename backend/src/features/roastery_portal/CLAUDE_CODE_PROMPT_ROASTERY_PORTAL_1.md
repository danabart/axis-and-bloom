# Feature: Roastery Portal, part 1 (partner page + admin page + `roastery_portal_*` tables)

> Folder: `backend/src/features/roastery_portal/` · Decided: 2026-10-05 (Dana) · Model: Sonnet is fine
> Status: not executed
> Reference files in `reference/`: Camila's mockup `47-roaster-portal-mockup-v8.html`, its two PDF renders (1440 and 390 wide), and her original brief `48-roaster-portal-build-brief.md`.
> This brief REPLACES brief 48. Where the two disagree, this one wins. The mockup stays the visual source of truth for layout, spacing, palette and tone.

## What this is

A page we send to partner roasteries so they can describe each of their coffees: in their own words, in flavor wheel terms, on our dimensions, plus brewing and availability. And an admin page where Dana creates the links, manages each roastery's coffee list, watches progress and reads the answers.

Everything a roaster submits lands in new `roastery_portal_*` tables as evidence. **Nothing in this brief writes to the catalog.** Accepting answers into the catalog (`roastery_coffee_descriptors`, `coffees`, hops) is part 2, written after the first real submissions exist.

## Decisions already made (Dana, 2026-10-05). Do not re-open.

1. **Two surfaces.** Partner page at `/roastery/:token`, outside the site layout and outside the pre-launch curtain. Admin page at `/admin/roastery-portal`, labelled "Roastery Feedback", under Catalogue & Supply right after Roasteries.
2. **Access.** One private, revocable link per roastery (unguessable token). The first screen asks who is filling it in (name and email), once per device, prefilled when the link was created for a named contact. Every save is stamped with that person. No sign-in. No email in the URL.
3. **Lineup.** A roastery's coffee list lives in its own table, managed in admin, optionally linked to a catalog coffee. Roasters can add a coffee we missed. The catalog is never touched.
4. **Tasting notes.** For each note the roaster types their own words, then picks the closest flavor wheel term (`cupping_note`). A note with no wheel pick is allowed and is saved as words only.
5. **Flavor wheel first, Bloom Dial second.** The six family cards stay, placed after the notes, stored only as the roaster's proposal. It never writes an archetype assignment.
6. **Dimensions.** The seven numeric rows of `coffee_dimensions`: Acidity, Sweetness, Bitterness, Body, Savory / Depth (shown as "Clean to deep"), Texture, Finish Length. Camila's "Intensity" (our customer name for Body) and "Roast" (already asked as roast level) are removed. Scale stays 1 to 5 relative to the roaster's own lineup and is stored separately from cupping values (0 to 15 absolute). Never mix them.
7. **Nothing hardcoded.** Roastery name, coffee list, prefills, every chip group, the dimensions, the wheel and the archetype cards are read from the DB.
8. **Status per coffee.** The landing view is the lineup list with a state on each coffee: Not started, In progress (n of 6 sections), Submitted (date, who). Drafts live on the server so a colleague can continue on another device. A submitted coffee can be reopened; each submit is kept as its own version.
9. **Fonts.** Lato, the site's fonts. No Genova, no Gotham, so brief 48's ampersand and question-mark rules do not apply (same ruling as `CrawlLanding.tsx`, 2026-09-01). Palette and "never `#ffffff`" stay.
10. **Naming.** Every new table starts with `roastery_portal_`, every new view with `v_roastery_portal_`. One writer (`services/roasteryPortalService.ts`), views as the read path, every write in `withTransaction`.
11. Nothing is ever deleted. Deactivate, revoke, or version.

## Task 0: confirm before editing (report findings in the final report; STOP only if one contradicts this brief)

- `roaster` (UUID id) has an active row for Utopian, and Flying Jewel exists in `coffees` (expected id 2891) with that `roaster_id`.
- The ids and names of the seven `is_numeric = true` rows in `coffee_dimensions` in prod.
- `cupping_note`: 84 active rows, 9 `wheel_category` values, defects under `wheel_category = 'Other'`.
- `lookup_value` categories `process`, `roast_level`, `blend_or_single` and their current values.
- The customer brew profile vocabulary (`getBrewProfileFieldsConfig().brew_methods.allowedValues`, config or fallback) as it resolves in prod, and whether roaster-friendly labels for those values already exist anywhere. Reuse them if they do.
- Where the archetype display label, color, three-word tagline and small dial image already exist (`v_coffee_archetype`, `useArchetypes()`, the asset registry, shared frontend constants). Reuse what exists. Only what does not exist anywhere may be added, in the same place its siblings live. Report what you reused and what you added.
- How `/crawl` handles: route placement outside `PublicLayout`, `PRELAUNCH_OPEN_ROUTES`, noindex, analytics.
- How an existing internal notification picks its recipients (the API error alert). Used in step 9.
- The existing lints (`lint:catalog` and the two others in `deploy.yml`) and the precedent for adding a rule.

## TASK

### A. Schema (`schema.sql`, idempotent, applies cleanly twice)

All FKs to `roaster(id)` are UUID, to `coffees(id)` INT, to `cupping_note(id)` UUID, to `coffee_dimensions(id)` INT.

1. `roastery_portal_link`: `id`, `roaster_id`, `token` (unique, at least 32 url-safe random characters), `contact_name`, `contact_email` (both optional, prefill only), `created_by_admin_id`, `created_at`, `last_opened_at`, `revoked_at`.
2. `roastery_portal_respondent`: `id`, `roaster_id`, `link_id`, `name`, `email` (lowercased), `created_at`. Unique on (`roaster_id`, `email`).
3. `roastery_portal_coffee` (the lineup): `id`, `roaster_id`, `name`, `coffee_id` (nullable link to the catalog), prefill columns `origin`, `process_values TEXT[]`, `roast_level`, `blend_or_single`, `is_decaf`, `prefill_source` (`roaster_site` | `catalog` | null), `added_by` (`admin` | `roaster`), `added_by_respondent_id`, `sort_order`, `is_active`, `created_at`. Unique active name per roastery (case-insensitive).
4. `roastery_portal_dimension` (which dimensions the portal asks, and how it words them): `dimension_id` PK, `label`, `low_label`, `high_label`, `sort_order`, `is_active`. Seed by dimension NAME, not id: Acidity (Low / High), Sweetness (Low / High), Bitterness (Low / High), Body (Light / Full), Savory / Depth as "Clean to deep" (Clean / Deep), Texture (Silky / Drying), Finish Length as "Finish length" (Short / Long).
5. `roastery_portal_response` (one row per coffee per version): `id`, `portal_coffee_id`, `version`, `status` (`draft` | `submitted`), `origin`, `process_values TEXT[]`, `roast_level`, `blend_or_single`, `is_decaf`, `proposed_archetype archetype_enum` (nullable), `dominant_dimension_id`, `takes_it` (`black` | `milk` | `both`), `brew_notes`, `availability`, `typical_notice`, `expected_availability`, `similar_when_out`, `closest_cousin_portal_coffee_id`, `what_changes`, `anything_else`, `last_saved_by_respondent_id`, `submitted_by_respondent_id`, `created_at`, `updated_at`, `submitted_at`. Partial unique index: at most one `draft` per coffee. Unique (`portal_coffee_id`, `version`). A submitted row is never updated again (enforce with a trigger that rejects UPDATE/DELETE when `OLD.status = 'submitted'`, children included).
6. `roastery_portal_response_note`: `response_id`, `rank` (1 = leading note), `roaster_words` NOT NULL, `cupping_note_id` nullable.
7. `roastery_portal_response_dimension`: `response_id`, `dimension_id`, `value` INT CHECK 1 to 5. Unique pair.
8. `roastery_portal_response_brew`: `response_id`, `brew_method`, `role` (`best` | `also_good`). One `best` per response.
9. `roastery_portal_lineup_response` (asked once per roastery, versioned the same way): `id`, `roaster_id`, `version`, `status`, `typical_notice`, `similar_when_out`, `anything_else`, respondent stamps, timestamps. A coffee's own `typical_notice` / `similar_when_out` are overrides; null means "same as the lineup answer".
10. Vocabulary in `lookup_value` (ON CONFLICT DO NOTHING):
    - `process`: add `co-ferment` ("Co-ferment").
    - New category `roastery_portal_brew_method`: values exactly equal to the customer brew profile values found in Task 0, with roaster-friendly labels (`v60` → "Pour-over", `drip` → "Drip", `espresso` → "Espresso", `french_press` → "French press", `aeropress` → "AeroPress", `moka` → "Moka pot", `cold_brew` → "Cold brew", `other` → "Other"). Add a test that fails if this category and the brew profile vocabulary drift apart.
    - New categories `roastery_portal_availability` (always_on, rotating, limited_release), `roastery_portal_notice` (under_2_weeks, 2_to_4_weeks, 1_to_2_months, 2_plus_months, unpredictable), `roastery_portal_similar` (yes, usually, sometimes, no, not_sure). Labels as in the mockup.
11. Views:
    - `v_roastery_portal_coffee`: lineup row with prefill values, taking the catalog's values (`v_coffee`) when `coffee_id` is set and the lineup row's own columns otherwise.
    - `v_roastery_portal_current_response`: per lineup coffee, the open draft if one exists, else the latest submitted version.
    - `v_roastery_portal_progress`: per lineup coffee: state (`not_started` | `in_progress` | `submitted`), sections answered (0 to 6), last saved at/by, submitted at/by, submitted version count, and `has_unmapped_notes` (any note with null `cupping_note_id`).

### B. Backend

1. `services/roasteryPortalService.ts`, the only writer of `roastery_portal_*`. Each verb in `withTransaction`: `createLink`, `revokeLink`, `touchLink`, `upsertRespondent`, `addLineupCoffee` (admin or roaster), `bulkAddLineupCoffees`, `updateLineupCoffee`, `linkLineupCoffeeToCatalog`, `deactivateLineupCoffee`, `saveDraft` (full-document replace of the draft row and its three child sets; creates the draft, copying the latest submitted version, if none is open), `submitResponse` (draft → submitted, stamps respondent and time), `saveLineupDraft`, `submitLineupResponse`. `linkLineupCoffeeToCatalog` only reads the catalog; it must reject a coffee that belongs to another roastery.
2. `services/roasteryPortalReads.ts`: typed reads over the three views plus the vocabulary bundle (process, roast level, blend or single, brew methods, availability groups, dimensions from `roastery_portal_dimension`, archetypes from `v_coffee_archetype`, the wheel from active `cupping_note` rows EXCLUDING `wheel_category = 'Other'`, grouped category → subcategory → descriptor).
3. `routes/roasteryPortal.ts` mounted at `/api/roastery-portal`. Public, token-gated, its own rate limiter modelled on `qrResolveLimiter`. An unknown or revoked token returns the same 404 for every route. Every write validates that the respondent, the lineup coffee, the cousin coffee and every lookup value belong to this token's roastery or to the allowed vocabulary. Cap free-text lengths (names 120, short fields 300, long fields 2000, notes 15 per coffee).
   - `GET /:token` → roastery name, link contact prefill, vocabulary bundle, lineup with progress, current lineup response.
   - `POST /:token/respondent` `{ name, email }` → respondent id.
   - `POST /:token/coffees` `{ name }` → a roaster-added lineup coffee.
   - `GET /:token/coffees/:id` → prefill + current response.
   - `PUT /:token/coffees/:id/draft` → full-document save.
   - `POST /:token/coffees/:id/submit`.
   - `PUT /:token/lineup` and `POST /:token/lineup/submit`.
4. Admin routes under `/api/admin/roastery-portal` (`requireAdmin`): roasteries with progress summary; links (create, list, revoke); lineup (add one, bulk add from pasted lines, edit prefills, link to a catalog coffee of the same roastery, deactivate, reorder); read a coffee's current response and its submitted versions; read the lineup response.
5. On submit, send one internal notification ("<Roastery>: <coffee> submitted by <name>") through the existing mechanism found in Task 0. If no reusable mechanism exists, skip the email, say so in the report, and do not invent a new one.
6. Lint: extend the existing lint precedent so any `INSERT/UPDATE/DELETE` on `roastery_portal_*` outside `roasteryPortalService.ts` fails. Also fail if `roasteryPortalService.ts` or `routes/roasteryPortal.ts` contains DML on any `coffee_*` table, `coffees`, or `roastery_coffee_descriptors`.

### C. Partner page (frontend)

Files in `frontend/src/app/components/roastery-portal/`. Route `/roastery/:token` and `/roastery/:token/coffee/:id` in `App.tsx`, outside `PublicLayout`, not wrapped in `PrelaunchGate`; add `/roastery/:token` to `PRELAUNCH_OPEN_ROUTES` with a one-line comment. Noindex, nofollow; add `Disallow: /roastery/` to robots. No site navigation, no footer links, no newsletter modal, no consent banner, no analytics events, no Liam.

Lift layout, spacing, palette and component shapes from the mockup. Do not ship its mockup chrome (`.mocktitle`, `.notes`, `.notetoggle`, `.note`) or its sample answers. Mobile first, breakpoint 640 px, all of brief 48 section 4b applies (single column, chips wrap and never shrink or become dropdowns, 30 px scale dots on one line, 17 px inputs, 20 px side padding). Every chip and dot is a real button with `role` and `aria-pressed` or `aria-checked`, keyboard operable; labels are real labels.

**Screen 1, who is filling this in.** Shown when this device has no stored respondent for this token. Name and email, prefilled from the link's contact. Stored in localStorage (try/catch) as the respondent id; the server is the record.

**Screen 2, the lineup.** Portal bar and H1 as in the mockup, with the roastery name from the DB and the count from `v_roastery_portal_progress`. Then the coffee list: one row per coffee with name and state (Not started · In progress, n of 6 · Submitted, date, by whom). Tapping a row opens the coffee. A dashed "+ A coffee not listed" row adds one. Below the list, a short "About your lineup" block with the two lineup questions (typical notice before a coffee becomes unavailable; when one runs out, can you usually offer a similar profile) and its own save.

**Screen 3, one coffee.** Six sections, same numbering style as the mockup:

- **01 The coffee.** Origin (text). Single origin or blend (chips, `blend_or_single`). Decaf (yes / no). Process (multi-select, `process`). Roast level (single, `roast_level`). Prefilled fields carry the small prefilled tag, worded from `prefill_source` ("from your site" for `roaster_site`); the tag disappears once the value differs from the prefill.
- **02 Tasting notes.** A list of notes, leading one first, up to 15. Each note: a text field for their words, then a wheel pick under it: category chips → descriptor chips (subcategory shown as a small group label). If the typed words equal a descriptor (case-insensitive), preselect it. The pick is optional and clearable. Reorder with up/down buttons. Then, AFTER the notes, the Bloom Dial question with the six family cards exactly as the mockup styles them, in `v_coffee_archetype` order, including the extra line on Experimental.
- **03 Dimensions.** One 1 to 5 scale per active `roastery_portal_dimension` row, with its labels. Then "Most dominant dimension" chips built from the same rows.
- **04 How to drink it.** "Best brewing method" (single). "Also good as" (multi-select, same list, the best one disabled). "How is it best enjoyed" (Black · With milk · Both). "Anything we should know about brewing it" (optional textarea).
- **05 Availability.** "How it lives in your lineup" (chips). "Expected availability" (text, hint "if seasonal"). Typical notice and similar-profile: show the lineup answer as the selected default with a quiet "same as your lineup" note; changing it stores an override. "Closest cousin in your lineup": a picker of this roastery's other active lineup coffees, not free text. "What changes between them" (text).
- **06 Anything else.** One textarea, placeholder from the mockup.

Saving: debounced autosave (about 1 s) through `PUT .../draft`, with "Draft saved" status as in the mockup. "SAVE COFFEE" submits and returns to the lineup. "Save and add another" becomes "Save and open the next coffee" (next coffee that is not submitted). Nothing is required. Opening a submitted coffee shows its answers; the first edit opens a new draft version. If the draft was last saved by someone else, show "Last saved by <name>, <when>".

**Copy.** Keep the mockup's copy where the question is unchanged. Positive register, no em dashes (the FROM / TO footer lockup and the `01 —` card numbers are graphic elements and stay). New or changed lines, all drafts for Camila's review, collected in one `COPY` block at the top of the component:

- Lede: "We listed your lineup and prefilled what we found; correct anything that is off. Your answers do two things: they help us map each coffee to the flavor wheel, and they shape how we present it, since every coffee gets its own imagery. **The 1 to 5 scales are relative to your own lineup:** 1 is your gentlest coffee on that scale, 5 your most intense. There are no wrong answers."
- Notes hint: "Your words first, the leading note on top. Then pick the closest match on the flavor wheel."
- Bloom Dial hint: unchanged from the mockup.
- Usage line above the footer: "We use your notes to describe each coffee to our customers under the Axis & Bloom name."
- Who screen: "Who is filling this in?" · "So we know who to thank, and who to ask if we have a question."

### D. Admin page (frontend)

`AdminRoasteryPortal.tsx` at `/admin/roastery-portal`, nav label "Roastery Feedback" after Roasteries. Reuse the existing admin layout, table, form and `LookupSelect` patterns; no new shared components.

- Roastery list (active roasteries) with: link status, coffees submitted / total, last activity.
- Per roastery: create link (optional contact name and email), copy link, revoke; lineup editor (add, paste several names at once, edit prefills, link to a catalog coffee, deactivate, reorder); progress table from `v_roastery_portal_progress` with a "needs mapping" marker for unmapped notes.
- Per coffee: read-only view of the current response (their words next to the wheel term, proposed family, the 1 to 5 values labelled "relative to their lineup", brewing, availability), who and when, and a version switcher for earlier submissions.
- No accept, promote or edit-on-behalf actions in this brief.

## CONSTRAINTS

- No write to any catalog table, cupping table or `roastery_coffee_descriptors`. No change to any customer-facing surface.
- No roastery can see another roastery's name, coffees or answers through any portal endpoint.
- No hardcoded roastery, coffee, chip list, dimension or wheel term in frontend or backend code. Seeds and lookups only.
- No new fonts, no new colors beyond the mockup palette, never `#ffffff`.
- No new environment variables unless Task 0 shows one is unavoidable; if so, STOP and report before adding it.
- `npx tsc --noEmit` clean in backend and frontend, `vite build` clean, all lints and boot integrity checks green, `schema.sql` applies twice on the test database, existing tests green. Add service tests for: token isolation between two roasteries, one-draft rule, submitted rows immutable, version bump on reopen, vocabulary validation.
- No dev environment: production only, marked test data, deactivated afterwards (nothing deleted).

## DONE = commits pushed straight to `main`, deploy green, startup log clean, acceptance verified live, Utopian's lineup loaded (below), `WHAT_WE_BUILT.md` and `WHAT_WE_BUILT_DB.md` entries, Status above flipped. One report at the end.

## ACCEPTANCE (live production)

Use the existing inactive "Zzz Test Roastery" for steps 1 to 8 (create its link and two test lineup coffees through the admin page), then revoke its link and deactivate its lineup rows.

1. `/roastery/<token>` loads signed out, in a fresh browser, with the pre-launch curtain on. No site nav. Response carries noindex.
2. A wrong token and a revoked token both show the same "this link is not active" page and return 404 from the API.
3. Who screen appears once, then the lineup with both coffees "Not started".
4. Fill a coffee at 390 wide: two notes (one typed as an exact wheel word that preselects, one with no wheel pick), a family card, all seven dimensions, best + also-good brewing, a cousin. Refresh mid-way: the draft is intact. State shows "In progress, n of 6".
5. Open the same link in a second browser as a different person: the draft is there, with "Last saved by <first person>".
6. Submit. Lineup shows "Submitted" with date and name. Reopen, change one field, submit: version 2 exists, version 1 is unchanged in the DB.
7. Admin page shows progress, both versions, the "needs mapping" marker, and who submitted. The notification from step B5 arrived (or is reported as skipped).
8. With a second test link for a different roastery, no endpoint returns the first roastery's data when called with the second token and the first roastery's coffee ids.
9. `SELECT` proof in the report: zero rows written to `coffees`, any `coffee_*` table, or `roastery_coffee_descriptors` by this work.

**Then load Utopian (real data, through the admin page or its API, not SQL):** the ten coffees and prefills from section 3 of `reference/48-roaster-portal-build-brief.md`, `prefill_source = 'roaster_site'`, Flying Jewel linked to its catalog coffee. Map brief 48's "Medium-light" to the `roast_level` value `light-medium`. Do NOT create Utopian's link; Dana creates it from the admin page when she is ready to send it. Report the admin URL where she does that.
