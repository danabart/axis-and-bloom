# Handoff: corrections to the Usual Drink 2 brief

To: the CTO session that wrote `CLAUDE_CODE_PROMPT_USUAL_DRINK_2_ROUTINE_AND_PROFILE.md`.
From: a review session, 2026-11-24. The brief was read against `DEVELOPMENT_GUARDRAILS.md` and the code at `06ae2cd`. The mockup and production data were not checked. Nothing was run or changed.

Please fold these into the brief before the build goes past Task 0. Items marked **Dana** need her answer first.

## Must fix

**1. Part C: the new row ties with the row it replaces.**
Part C writes the backfill row with `occurred_at` equal to the original answer's. The fold orders by `occurred_at` only (`schema.sql:6426`), and `source` is picked the same way (`schema.sql:6430`), so the winner of a tie is undefined. Task 0 item 3 will STOP on this every time.
Proposed: `occurred_at` = the original row's `occurred_at` plus one microsecond; `recorded_at` = now. No view changes. State it in Part C and drop the conditional STOP from Task 0 item 3 (keep the read of the fold as a check).
Also say in Part C that the customer's `source` then reads `backfill`, which `customerReads.factSourceToBrewProfileSource` maps to `profile_page` (`customerReads.ts:151`).

**2. D4 block 3: the history switcher does not match the four components.** **Dana** for (b).
- (a) "Has content" needs a definition per component. `BrewCards` returns null on no cards (`BrewCards.tsx:22`). `MapTrail` returns null on no trail (`MapTrail.tsx:32`). `TastingJournal` never returns null: it has its own empty state with a heading (`TastingJournal.tsx:21`). `ActivityTimeline` always renders.
- (b) `ActivityTimeline` owns the retake link (`ActivityTimeline.tsx:135`; `Profile.tsx:675` only covers the time before `flavorMemory` loads). Inside a switcher the link is hidden whenever another segment is showing, and gone if the activity segment is hidden as empty. Where does the retake link live?
- (c) `MapTrail` fetches its own data (`MapTrail.tsx:18`), so `Profile.tsx` cannot know whether it has content. Name the mechanism (a callback prop such as `onContent(hasContent, title)`, or lifting the fetch), under G4.1 "add a prop".
- (d) `MapTrail`'s heading is `me.copy.trail_title` from the API (`MapTrail.tsx:36`), so "exported from the component" does not work for it. The other three headings are typed strings ("Flavor activity", "Tasting journal", "Brew cards"). Say how each label reaches the switcher.

**3. B4: two things have no route to the frontend (G4.2).**
- `typeahead_max_rows` is numeric. The options payload's `copy` is `brewTextParams`, text rows only (`brewProfileCard.ts:53`, `brewParameters.ts`). Add a named place in the payload for it; today the component types in 12 (`BrewTypeahead.tsx:46`).
- No copy rows exist for the save error, the saving state, or the typeahead's clear button label. Today they are typed in `BrewProfileMirror.tsx` ("Failed to save", "Saving…"), and the server's own message is technical ("takes_it must be an array"). Add `brew_parameter` text rows for them in A9, positive register (G4.4).

**4. B2: `saveRoutine` idempotency.**
One request writes several rows, and `customer_brew_profile_change` is `UNIQUE (source, source_id)`. State the `source_id` shape: `<apiEventId>:<field>:<op>`. State the fallback when `res.locals.apiEventId` is absent; the existing routes use `brewProfileFallbackSourceId` (`users.ts:32`), reuse it (G3.9).

## Should fix

**5. The window between deploy and Part C.**
At deploy `takes_it` becomes an array field while stored answers are single values. A Liam `add` in that window starts from an empty list (`sommelier.ts:490`; fold `schema.sql:6392`), so the old value drops out. Part C then skips that customer because the current value is no longer single.
Proposed: Part C selects on the customer's latest `takes_it` `set` row holding a single value, not on the current folded value; and the acceptance text says Part C is asked for in the same sitting as the deploy.

**6. Model tier (G1.13).** **Dana.**
The header says Sonnet. Part C is a production write to an insert-only table, and the run covers schema, backend, the tab rework and a backfill. Either keep Sonnet and say why in the header, or name the stronger model.

**7. Task 0 item 1: the working tree is not clean.**
Item 1 checks three files only. Uncommitted today: `backend/src/features/commerce/CLOSING_REPORT_6.md` and this folder's `README.md` (modified), eight deleted `misc/design_documents/genova/*.ttf`, and `backend/src/scripts/ellaMapTigerStart_2026_11_24.ts` (untracked, though Ella map 11 is logged as done on production, `WHAT_WE_BUILT.md:7103`). Widen item 1 to report every modified or untracked code file, and say in "Do not" that the commit stages only this brief's files.

## Confirmed, no change needed

- The kitchen-box bug is as described (`BrewProfileMirror.tsx:58`, `valueFromDraft` in `BrewFieldControl.tsx:28`).
- Line references in Task 0 items 4 and 6 are right (`brewCard.ts:73,135`; `customerIntegrity.ts:722,730,910`; `claude.ts:99-110`; `Profile.tsx:447-694`).
- `ask_when_empty` is false on the five older fields (`schema.sql:12074-12078`), so giving them prompts does not make Liam ask; `cardFields()` moving to `is_on_card` (B4) keeps them off the card.
- `record.brewProfileChange.backfill` exists and is owner-only (`customerFacts.ts:246`); the script pattern file exists.
- `v_dial_said_back_fact` joins values by the field's own id (`schema.sql:12807`) and is unaffected by A7.
- `CATALOG.md` has no group or successor object for brew-profile fields.
