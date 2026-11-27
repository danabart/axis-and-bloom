# Design: what moves your spot on `/map`, and walking the map

Workstream: ella_bloom_map · Written 2026-11-26 by the CTO session · **Status: design for Dana's yes. Nothing is built from this yet.** It changes the position rule from brief 3 and brief 7 and adds the household view of the map. The reasons design (`DESIGN_MAP_REASONS_REV2_2026-11-21.md`) and its eight rules stay as they are, except the one point named in "The page" below.

## Why

Dana opened her own `/map` on 2026-11-26. Her match is Tiger Stripe. She added Blossom to the cart and the whole page moved to Blossom as "You are here". She picked another coffee and it moved again. She could no longer tell where she started.

What the code does today:

- The price chip on a step card does two things in one tap: it records a step decision (`matchService.decide`, move `step`) and it adds the bag to the cart.
- The position is the latest decision (`v_customer_match_current`). So a cart tap is a move.
- Orders and feedback have no effect on the position. The page line "Your dot moves when you pick a bag" describes exactly the behaviour she rejected.

## Dana's calls, 2026-11-26

1. Adding to the cart never changes the map.
2. The customer can walk the map and look at other coffees, and always sees where their own spot is.
3. A first order does not move the spot. It shows on the trail.
4. Ordering the same coffee again moves the spot.
5. Positive feedback moves the spot. When the current spot's coffee has a higher rating, the spot stays.
6. Negative feedback does not move the spot.
7. Household members see each other's spot (first name and coffee). Answers and reasons stay private.
8. Each member has a switch for showing their spot. Default: on.
9. The rules in 3 to 6 are rows Dana edits on `/admin/map`.

## The model

Three things that are one thing today:

| | What it is | Saved? |
|---|---|---|
| **Your spot** | Where we believe your palate sits. Starts at the Founder's pick. Moves on evidence only. | Derived from the quiz, orders and feedback. Nothing new is stored. |
| **Looking at** | The coffee you are viewing while you walk the map. | Never. It lives in the page address only. |
| **Cart** | Bags you may buy. | As today. No effect on the map. |

## What moves the spot

One row per event, in a new section of `/admin/map`: "What moves a spot". Each row has an effect and an on/off switch.

| Event | Effect | Detail |
|---|---|---|
| Founder's pick (quiz result) | Sets the spot | As today, from the start rules. |
| Looked at a coffee | Nothing | Not recorded. |
| Added to cart | Nothing | |
| First order of a coffee | Trail only | Trail word: "Ordered". |
| Ordered the same coffee again | Moves the spot | A second separate order. Two bags in one order is one order. |
| Positive feedback | Moves the spot | Unless the spot's own coffee has a higher rating. |
| Neutral feedback | Trail only | The customer's words show on the trail, as today. |
| Negative feedback | Spot stays | The coffee stops being offered as the lead. |

Numbers behind the rows are parameters, not code: the lowest rating that counts as positive (4), the highest that counts as negative (2), how many separate orders make a reorder (2).

Which orders and feedback count:

- **Orders:** real orders only (not test mode, not fully refunded), counted for the person the bag was for, not the person who paid. Both rules already exist in `v_customer_bag_attribution`; the spot reads that view.
- **Feedback:** the customer's own current feedback on a coffee (`v_customer_feedback_current`).

The spot is worked out when the page loads, from those facts. The position view keeps its name and columns so its readers do not fork; its definition changes from "latest decision" to "latest event that moves the spot". It gains two columns: which event put the spot there, and since when.

## The page

**The map**

- Your spot: the ringed dot, always drawn, also while you look elsewhere.
- Looking at: a second, lighter marker on the coffee you are viewing.
- Start: once your spot has moved off the Founder's pick, a small marker stays on the pick.

**Walking**

- Tap a coffee's dot on the map, or a step card's name, to look at it. The page shows that coffee's card and its own steps. Nothing is saved.
- The price chip only adds the bag. This changes Dana's 2026-11-20 call ("the price chip is the action for choosing a step"): choosing and buying are now two things, and the walk needs its own tap. No new button is added; the dot and the card name are the targets.

**Top card**

| You are | Label | Text |
|---|---|---|
| On your spot, set by the quiz | Founder's pick | As today. |
| On your spot, set by an order or feedback | Your spot | As "You are here" today. |
| Looking at another coffee | Looking at | The coffee, one line comparing it to your spot, the price chip, and "Back to your spot: Tiger Stripe". |

**Step cards** are composed as today, from the coffee you are looking at. The comparison line names that coffee.

**The line at the bottom** changes from "Nothing moves until you choose. Your dot moves when you pick a bag." to something like: "Look around as much as you like. Your spot moves when you order a coffee again or tell us you liked it." (copy row, Dana edits.)

**The trail** becomes a short true history: Founder's pick, what was ordered, what the customer said, when the spot moved. No cart taps.

## Dana's own page, step by step

| She does | Her spot | What she sees |
|---|---|---|
| Takes the quiz | Tiger Stripe | Founder's pick: Tiger Stripe. Lead: Blossom. |
| Taps Blossom | Tiger Stripe | Looking at Blossom. "A darker roast than Tiger Stripe, with a fuller body." Tiger still ringed. Back to your spot. |
| Taps on from Blossom | Tiger Stripe | Looking at the next coffee. Tiger still ringed. |
| Adds Blossom to the cart | Tiger Stripe | The cart count changes. The map does not. |
| Orders Blossom | Tiger Stripe | Trail: "Ordered Blossom". |
| Rates Tiger 5, then Blossom 4 | Tiger Stripe | Blossom's words on the trail. Spot stays: Tiger is rated higher. |
| Instead: never rates Tiger, rates Blossom 4 | Blossom | Your spot: Blossom. Start marker on Tiger. |
| Instead: orders Blossom a second time | Blossom | Your spot: Blossom. Start marker on Tiger. |
| Instead: rates Blossom 2 | Tiger Stripe | Blossom is no longer the lead from Tiger. |

## The household map (second brief)

- One map, one dot per member with their first name. Your own spot is ringed.
- Shown: first name and the coffee of the spot. Never shown: answers, reasons, feedback, the trail.
- A member's switch, "Show my spot to my household", in their own Family Household settings. Only they can change it. The default for a new member is a `household_parameter` row, set to on.
- A managed member (no account yet): the admin sets the switch for them, until they have their own account. Then it is theirs (G2.19).
- Off means the household sees what it sees today: first name and archetype.
- This amends the 2026-11-07 household decision "first name and archetype name only".
- G2.19 says a member may turn another member's dial. On this map there is nothing to turn: walking saves nothing, and a spot moves only on that member's own orders and feedback.

## Two briefs

1. **Ella map 14: the spot and the walk.** The event rows and parameters, the position view's new definition, the read-only "look at" on `/map`, the three labels, the trail, the admin section, "Read it as" showing which event set the spot.
2. **Ella map 15: the household map.** The switch, its default, the member dots.

## What stops, and what stays

- `/map` stops recording a decision on a tap. The decision door stays for the quiz result.
- Step decisions already recorded stay in the log (insert-only, never deleted) and no longer count toward the spot. Dana's test taps need no cleanup.
- Not in this design: the text Liam writes from feedback (OT-162, OT-168), the backfill, the switch (brief 4), usual drink on `/map`.

## CTO calls (say so if one is wrong)

1. **A quiz retake** resets the spot only while the spot is still a Founder's pick. Once an order or feedback has moved it, the evidence wins and the new pick is not applied.
2. **Subscription renewals and gift redemptions are not a reorder.** A renewal ships what the system chose, so counting it would be circular. Which order kinds count is a flag on the order-kind lookup.
3. **An unrated spot gives way.** If the spot's coffee was never rated, a positive rating on another coffee moves the spot there.
4. **Liam's accepted pick and the re-order email buttons** are intent, like the cart. They do not move the spot.
5. **A low rating on the spot's own coffee** leaves the spot where it is, because we have no better place yet. What the page then says belongs to the feedback level.
6. **The trail word for a first order is "Ordered"**, not "Tried". We do not know yet that the bag was opened.

## Found on the way

- `v_customer_feedback_current` has the positive and negative rating limits written into the view (4 and 2). That breaks G2.1. Brief 14 would move them to parameters, since the spot rule needs the same numbers.
- `hasBag` on `/map` is true when the customer took a step, not when they ordered. Brief 14 would base it on a real order.

## Not verified

- Production data. Task 0 of brief 14 reads it.
- Blossom's own steps (the example's third row).
- Where a member's own settings are stored today, for the household switch. Task 0 of brief 15 names it.
