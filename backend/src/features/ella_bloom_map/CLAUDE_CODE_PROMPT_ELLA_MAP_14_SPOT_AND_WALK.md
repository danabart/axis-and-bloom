# Claude Code brief. Ella's Bloom Map 14: what moves your spot, and walking the map

Workstream: ella_bloom_map · Written 2026-11-26 by the CTO session · Design: `DESIGN_MAP_POSITION_2026-11-26.md` (read it first; Dana said yes 2026-11-26) · Builds on briefs 7, 10, 12, 13 and `HANDOFF_MAP_REASONS_2026-11-26.md` · Model: the cheaper/faster model (G1.13) · Dana runs it; push = deploy · Acceptance in **test mode on the test DB**.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (which event moves the spot, every rating limit, every count and every label is a row or a parameter; no event rule, rating number or order kind in code or a view body) · G2.2 surrogate `id` PK on any new table · G2.3 prefix `dial_` for the map's own rows · G2.4 CATALOG.md checked before any new table or view (expected: one table and one lookup, see CTO calls) · G2.5 one writer per table, reads through views, one read path for the spot · G2.7 a new vocabulary is a lookup table · G2.10 and G2.12 the decision log is insert-only and nothing in it is deleted or rewritten · G2.11 supersede, never delete · G2.14 the spot is derived at read; nothing composed is stored · G2.17 `comments.sql` then `catalog:md` · G2.19 a quiz taken by someone else is used as today, feedback and orders count for the person they belong to · **G3.9 as amended 2026-11-23: Task 0 lists every reader function, writer function, view and table this brief would add or change, beside the existing ones considered, and STOPS for Dana's yes** · G4.1 reuse `EllaMapFace`, `MapTrail`, `RevealedPanel`, the cart; add props, do not fork · G4.2 nothing typed in · G4.4 positive register · G4.5 no roaster name, no award name, never "explore" or "confidence" · G4.6 `/map` stays behind the pre-launch gate and admin-only · G5.1 vitest · G1.6 push is deploy, one closing report · **G1.9 one execution at a time: confirm no other session is running before you start and before you push.**
Mode: test. STOP points: after Task 0; before the push (the schema runs at boot, so the push is the production change).

**Goal.** On 2026-11-26 Dana opened her own `/map`. Her match is Tiger Stripe. She added Blossom to the cart and the whole page moved to Blossom. Today the price chip on a step card records a step decision and adds the bag in one tap, and the position is the latest decision. After this brief: the spot moves on evidence only, the customer can look at any coffee without anything being saved, and the cart never touches the map.

**Decisions already made (Dana, 2026-11-26; do not re-open).**

1. Adding to the cart never changes the map.
2. The customer can walk the map and look at other coffees, and always sees where their own spot is.
3. A first order of a coffee does not move the spot. It shows on the trail.
4. Ordering the same coffee again moves the spot there.
5. Positive feedback on a coffee moves the spot there, unless the spot's own coffee has a higher rating.
6. Negative feedback does not move the spot. That coffee is no longer offered as the lead.
7. These rules are rows Dana edits on `/admin/map`, in a section "What moves a spot".
8. The eight rules of the reasons work (handoff, "The rules behind it") stay. One point changes: the price chip only adds the bag. Looking at a coffee is its own tap, on the coffee's dot or on the card's name. No new button.
9. The customer Bloom page, the lane dial and every `dial_surface` row stay as they are.

The household view of the map is brief 15. Nothing of it is built here.

CTO calls, reversible, flag if the code or the data disagrees:

- **The events are rows.** One new table, `dial_spot_event` (code, label, effect, on/off, sort order; supersede and insert like `dial_reason_choice`), and one lookup, `dial_spot_effect` (sets the spot, moves the spot, trail only, nothing). `dial_reason_choice` was considered: it has no effect to carry. The service or view dispatches on the code, and a code it does not know is skipped and reported by an integrity check, as brief 10 does.
- **The numbers are parameters** (propose `evidence_parameter`, each with a Range): the lowest rating that counts as positive (4), the highest that counts as negative (2), how many separate orders make a reorder (2), and whether a negatively rated coffee is skipped as the lead (1).
- **One definition of positive and negative.** `v_customer_feedback_current` has 4 and 2 written into the view. Move them to the two rating parameters, same columns, same results. Task 0 proves the results are identical before anything else leans on it.
- **Which order kinds count toward a reorder** is a flag on `customer_order_kind`: manual and Liam-followed yes, subscription renewal and gift redemption no.
- **Orders and feedback are read through what exists:** `v_customer_bag_attribution` (real orders only, counted for the drinker, not the payer) and `v_customer_feedback_current` (the customer's own current feedback).
- **One position.** `v_customer_match_current` keeps its name and its readers. Its definition changes from "the latest decision" to "the latest event that moves the spot", with two more columns: the event that put the spot there, and since when. Columns that only a decision has are NULL when the spot came from an order or feedback. If Task 0 finds a reader this breaks, say so at the STOP.
- **A quiz retake** sets the spot only while no order or feedback has moved it. After that the evidence wins.
- **An unrated spot gives way:** when the spot's coffee has no rating, a positive rating on another coffee moves the spot.
- **Step, hop, "same again", Liam's accepted pick and the re-order email buttons** do not move the spot. Decisions already in the log stay there and are read by nothing for the spot.
- **A low rating on the spot's own coffee** leaves the spot where it is.
- **Looking at a coffee lives in the page address** (`/map?at=<coffee id>`), so refresh and back work. It is never written anywhere.

---

## The rule, exactly

Events for one customer, in time order:

| Event | Effect (seed) |
|---|---|
| Quiz result (`founders_pick`) | Sets the spot, when no later row has moved it |
| Map tap, hop, same again, Liam's pick, email button (`decision_other`) | Nothing |
| First order of a coffee (`first_order`) | Trail only |
| A separate order of the same coffee that reaches the reorder count (`reorder`) | Moves the spot |
| Feedback at or above the positive limit (`feedback_positive`) | Moves the spot, unless the spot's coffee currently has a higher rating |
| Feedback between the limits (`feedback_neutral`) | Trail only |
| Feedback at or below the negative limit (`feedback_negative`) | Trail only; the coffee is skipped as the lead when the switch is on |

Two bags in one order are one order. A row switched off has no effect and leaves the trail.

## Pinned cases (tests and acceptance use these)

Start: quiz result Tiger Stripe.

| Then | Spot | Basis |
|---|---|---|
| nothing | Tiger Stripe | founders_pick |
| map step decisions to Blossom and on (old rows) | Tiger Stripe | founders_pick |
| Blossom in the cart | Tiger Stripe | founders_pick |
| orders Blossom once | Tiger Stripe | founders_pick |
| rates Tiger 5, orders Blossom, rates Blossom 4 | Tiger Stripe | feedback_positive |
| orders Blossom, rates Blossom 4, Tiger never rated | Blossom | feedback_positive |
| orders Blossom twice, in two orders | Blossom | reorder |
| two bags of Blossom in one order | Tiger Stripe | founders_pick |
| orders Blossom, rates it 2 | Tiger Stripe | founders_pick; Blossom is not the lead |
| rates Tiger 2, nothing else | Tiger Stripe | founders_pick |
| spot moved to Blossom by a reorder, then a quiz retake gives Benchmark | Blossom | reorder |
| no order or feedback, quiz retake gives Benchmark | Benchmark | founders_pick |
| a subscription renewal ships Blossom twice | Tiger Stripe | founders_pick |
| `reorder` row switched off, orders Blossom twice | Tiger Stripe | founders_pick |

## Task 0: Verify (write into `CLOSING_REPORT_14.md`; STOP after)

Read-only, test DB and production.

1. **Every reader of the position and the trail:** `v_customer_match_current`, `getMatchCurrent`, `v_customer_match_trail`, `getMatchTrail`, `getMatchTrailLines`, the `has_position` read in `customerReads`, the integrity check in `dataCatalogIntegrity`, and anything else. For each: what it uses, and what changes for it under the new definition. Include the pieces behind `dial_surface` (quiz result, profile trail, beats and emails) and Liam.
2. **Reader, writer, view and table list (G3.9 amended)** for everything this brief would add or change, beside what exists. Name the existing writer module for `dial_reason_choice` and say whether the new table's writer belongs in it.
3. **How the spot is computed.** Decision 5 depends on the spot at the time of the feedback, so the rule is read in time order. Propose how: in the view, or as one fold in one reader function over an event view. One read path either way (G2.5). Show the pinned cases passing on paper.
4. **`v_customer_feedback_current`:** every view and function that reads `sentiment`, and the count per sentiment on production before and after moving the limits to parameters. They must be equal.
5. **Production counts:** decisions by move code; customers with one attributed real order, with a reorder, with feedback by rating. Then Dana's own event list and the spot the rule gives her. Expected: Tiger Stripe, basis founders_pick.
6. **The walk:** the steps that leave Blossom on the active map. Then write out by hand three pages for Dana: on her spot; looking at Blossom; looking at one coffee further.
7. **Copy rows:** which existing `dial_customer_copy` rows are reused (for example `here_title`, `closing_line`) and which are new.

**STOP.** Show Dana items 2, 3, 5 and 6, and anything in 1 or 4 that is not as expected.

## Parts

**A. Schema and data.** `dial_spot_effect`, `dial_spot_event` and its view; the parameters; the `customer_order_kind` flag; `v_customer_feedback_current` reading the two rating parameters; `v_customer_match_current` redefined with its two new columns; an event view if Task 0 item 3 needs one. `comments.sql` for each. Seed: `backend/src/scripts/ellaMapSpot_2026_11_26.ts`, same shape as the earlier seeds, insert if missing.

**B. Backend.**
- `matchService.steps` takes an optional coffee to look from. It checks the coffee is on the active map and may be shown to this customer, and composes the page from it as it does today from the position. It writes nothing. Without it, the page is composed from the spot.
- The response carries the spot (coffee, basis, since), the looked-at coffee when there is one with its compare line, and the Founder's pick coffee when the spot has moved off it.
- The compare line of a looked-at coffee: the published step line from the spot to it, `{from}` filled with the spot's name, when that step exists; otherwise the coffee's `map_line`.
- The lead skips a coffee the customer rated at or below the negative limit, when the switch is on.
- `hasBag` is true when the customer has an attributed real order, not when they took a step.
- `matchService.me`: the trail is the customer's spot events in order (Founder's pick, ordered, their words, the spot moved), not the decision log.
- `GET /api/map/steps?at=`. The decide route and the decision door stay as they are; `/map` stops calling them.
- Admin: read and write for "What moves a spot"; "Read it as" also returns the customer's events, the spot, its basis and since when.

**C. Frontend.**
- `MapPage`: the price chip adds the bag and nothing else. Tapping a coffee's dot or a step card's name looks at that coffee (`?at=`). "Back to your spot: {coffee}" clears it.
- `EllaMapFace` (props, not a fork): the spot ringed, always; a lighter marker on the looked-at coffee; a small marker on the Founder's pick once the spot has left it.
- Top card labels from copy rows: "Founder's pick" on a spot set by the quiz, "Your spot" on a spot set by an order or feedback, "Looking at" on a looked-at coffee.
- The closing line becomes: "Look around as much as you like. Your spot moves when you order a coffee again or tell us you liked it."
- `MapTrail` reads the new trail. The word for a first order is "Ordered".
- `/admin/map`: the section "What moves a spot" (each row's effect from the lookup, on/off, the four parameters), next to "How a card is chosen".

**D. Tests.** Every pinned case. Looking at a coffee writes no row in any table. The chip adds the bag and the spot, the trail and the decision log are unchanged. A coffee off the active map is refused for `at`. Switching a row off changes the spot on the next read. The sentiment counts are unchanged. A member's bag ordered by the household admin counts for the member.

**E. Push.** Test DB first. **STOP before the push:** the dry run of the seed, the pinned cases as built, Dana's three pages as built, and the item 4 counts. Push after Dana's yes.

## Acceptance (local, signed in as admin, test DB)

- Dana's page opens on Tiger Stripe as Founder's pick, whatever step decisions are in her log.
- Tapping Blossom shows "Looking at" Blossom with Tiger Stripe still ringed and "Back to your spot: Tiger Stripe". Refresh keeps it. Back returns.
- The chip on Blossom adds one bag to the cart. The map, the top card and the trail do not change.
- With test orders and feedback entered through the existing doors, each pinned case gives its spot and basis.
- Switching `reorder` off on `/admin/map` returns the spot to the Founder's pick on the next read.
- "Read it as" shows the events, the spot, its basis and since when.
- The old Bloom page is unchanged; every `dial_surface` row says `lane`.
- Laptop and phone layouts both checked. Click every new control in a browser. Screenshots: Dana's spot page, the looking-at page, the admin section, "Read it as".

## Docs and closing (G6)

`README.md` here; `WHAT_WE_BUILT.md`; `WHAT_WE_BUILT_DB.md`; `REGRESSION.md` (the cart never moves the spot; looking at a coffee writes nothing; a first order is trail only; a reorder and positive feedback move the spot; the rules are rows); `OPEN_TASKS.md` (the decide route's `step` move is no longer called from `/map`; rows no longer read for the spot); `comments.sql` and `catalog:md`; `CLOSING_REPORT_14.md`.

## Do not

- Do not write anything when a customer looks at a coffee.
- Do not let the cart, a map tap, a hop, Liam's pick or an email button move the spot.
- Do not delete, update or rewrite a row of `customer_match_decision`.
- Do not put an event rule, a rating limit, a count or an order kind in code or a view body.
- Do not add a reader, writer, view or table Dana did not approve at the Task 0 STOP.
- Do not build a second map face, trail or reveal component.
- Do not call a model to write a customer sentence.
- Do not build any part of the household map.
- Do not change the customer Bloom page, the lane dial or any `dial_surface` row.
- Do not push before the STOP in Part E.
