# The Bloom — Part 3 of 3: stock-check fix, generalized Bloom Dial, personalization

**Prerequisite: Parts 1 and 2 (this same folder) are already deployed.** This is a post-launch fix + redesign pass based on Dana's first look at the live page. Read Parts 1 and 2 first — this file assumes everything in them and only documents what's changing.

## What prompted this

The Bloom shipped and Dana reviewed it live. Three things surfaced:

1. **No coffees appear anywhere on the page** — every position renders as "Temporarily unavailable."
2. **The flavor-intelligence content (Collaborative Flavor Wheel, dimension bars, Liam's intake) never appears** — direct consequence of #1, since that content only renders on an active, revealed card.
3. **No "Add to cart" option is visible anywhere** — same root cause as #1.
4. **The position-card list ("4 lines of aliases") should be replaced with an existing visual component** — Camila already built a draggable, rotating "Bloom Dial" wheel for the quiz result screen (`FlavorQuiz.tsx`), and Dana wants that embedded on Bloom instead of the stacked card list from Part 2.

---

## Phase A — Fix: stop gating availability on untracked inventory quantities

**Root cause, confirmed with Dana:** `resolveBlendForSlot` (`backend/src/services/blendResolver.ts`) skips any candidate where `roaster_blend.quantity_available <= 0`. But this business is drop-ship — inventory quantities are explicitly **not tracked** (this was stated directly when the Blends & SKUs admin page was redesigned, see `WHAT_WE_BUILT.md` entry #70: *"drop-ship model — inventory quantities not tracked"*). `quantity_available` is almost certainly sitting at its default of 0 on every `roaster_blend` row, so every slot resolves to nothing fulfillable — no coffees, no informational layer, no cart. Bloom (Part 1/2) is the first thing that ever actually exercised this code path in a customer-facing way, so it's the first place this surfaced.

**Fix, confirmed with Dana: redefine availability in code, not with a data patch.**

- In `resolveBlendForSlot(archetype, dialSortOrder, weightOz)`, **remove the `quantity_available <= 0` → `out_of_stock` skip entirely.** A candidate is fulfillable if it has an `is_active = true` `roaster_blend` row at the requested weight — full stop. Keep the "no active blend at that weight" skip reason (a row genuinely doesn't exist for that weight), just drop the quantity check.
- `SkippedCandidate['reason']` loses the `'out of stock'` variant; only `'no active blend at that weight'` remains as a skip reason from this function going forward.
- **Don't touch the inventory-decrement logic in `orders.ts`** (`WHAT_WE_BUILT.md` #69's "Inventory decrement on order"). It can keep writing to `quantity_available` on order placement — that number just no longer gates anything. Decrementing a field nobody reads isn't a bug, it's inert. Removing that write path is unnecessary churn, out of scope here.
- **This function also drives real order routing** (`POST /api/orders`'s slot-based item resolution) — not just Bloom's display. Re-verify order placement specifically, not only the display endpoints, as part of the testing task below.

---

## Phase B — Generalize the Bloom Dial component

### What exists today

`BloomDial` in `frontend/src/app/components/FlavorQuiz.tsx` (search for `function BloomDial`) is a real, working, delightful component: a draggable/touchable rotating wheel that snaps to N evenly-spaced positions (`SNAP_DEG = 360 / N`), shows the selected position's label + description, and a "reveal" button. **It is currently hardcoded to exactly one archetype** — the quiz result screen only renders it `archetypeKey === 'chocolate' ? <BloomDial /> : <placeholder text>`, with a fixed 5-position `BODY_LEVELS` array of entirely fictional coffee names (Guatemala Huehuetenango, Brazil Los Santos, etc.) and hardcoded copy ("Personalize your Chocolate & Nutty match", "DIMENSION: BODY"). Same "beautiful but mock" pattern as `Shop.tsx` was.

**Do not modify `FlavorQuiz.tsx`'s existing behavior** — it's not part of this project and stays exactly as it is for its own use case. Instead, extract a **new, generalized, reusable version** for Bloom to use.

### New component: `BloomDialWidget.tsx` (new file, `frontend/src/app/components/`)

Same visual/interaction mechanics as `BloomDial` (draggable wheel, snap-to-position, reveal), generalized:

- **Props**: `archetype`, `positions: { dialSortOrder, label, description, isActive }[]`, `dimensionName: string`, `initialSortOrder?: number` (pre-set position, see Phase D), `onSelect: (dialSortOrder: number) => void`.
- **N = `positions.length`**, not a hardcoded 5 — most archetypes have 3 (Lighter/Classic/Richer), Experimental has 4. `SNAP_DEG = 360 / N` generalizes directly from the existing code.
- **"DIMENSION: ___" label** — already exists in the current component as a hardcoded string ("DIMENSION: BODY"); generalize it to `DIMENSION: {dimensionPlatformName.toUpperCase()}` (see the new `coffee_dimensions.platform_name` column below — a consumer-facing word, not the raw SCA term), sourced from the new endpoint fields. This is the direct answer to Dana's "how do we make the dial's purpose clear" question — the component already had the right instinct, it just needs to be data-driven instead of hardcoded to one archetype.
- **Position label + description**: pulled from `dial_position_vocabulary.label`/`.description` for the selected `dialSortOrder` — **check whether `description` is actually populated for all archetypes/positions in production** (the column exists in the schema but may be empty in places, since nothing has read it before now); if empty for a given position, fall back to just showing the label, don't show a blank line.
- **Inactive positions stay on the wheel, don't disappear from it.** All of an archetype's defined positions (active or not, same full set Part 1's `GET /api/coffees/archetypes` already returns) get a notch on the dial — removing a notch would change `SNAP_DEG` and make the wheel geometry inconsistent with what Part 1/2 already established (every position in the vocabulary is always represented, temporarily-unavailable ones included). Selecting an inactive notch is fine at the dial level; it's the card underneath (see Phase C) that shows "Temporarily unavailable" instead of purchase controls.
- **Default starting rotation**: the wheel starts at the ★-marked default position for that archetype (`dial_archetype_positions.is_default` / the middle position, e.g. sort_order 2 of 3 — "Classic") — same default already used elsewhere in this system, not a new concept.
- **Rotation direction, confirmed with Dana: clockwise = more, counter-clockwise = less, consistently across every archetype.** Turning the wheel clockwise from the default moves toward higher `dialSortOrder` (toward "Richer" / more of the dimension); counter-clockwise moves toward lower `dialSortOrder` (toward "Lighter" / less of it). This needs to hold for every archetype so the interaction is learnable once and reused everywhere, not per-archetype-specific. Add a small static visual cue directly on/around the dial — e.g. "← Lighter" on the left side and "{dimensionPlatformName} →" (e.g. "Stronger →") on the right — so the direction is legible before a first-time visitor drags anything, not something they have to discover by trial and error.

### New backend support

Extend `GET /api/coffees/archetypes` (Part 1, Phase 1a) to include `dimensionName`/`dimensionPlatformName` per archetype and `description` per slot (alongside the existing `label`/`platformName`). No new endpoint needed — these are additive fields on the response Part 1 already built.

**Dimension source — use `dial_archetype_config.dominant_dimension_id`, not `dial_position_vocabulary`.** `dial_archetype_config` is the actual one-row-per-archetype (`PRIMARY KEY (archetype)`) source of truth for "which dimension does this archetype's dial travel on" — join it to `coffee_dimensions` for the name. This is the same column the existing hop-suggestion and bucket-width logic in `dialSuggestion.ts` already reads for the same purpose, so using it here keeps the whole system consistent rather than re-deriving the same fact a second, looser way from `dial_position_vocabulary`'s per-row `dimension_id`.

**New: `coffee_dimensions.platform_name` — a consumer-facing word per dimension, confirmed with Dana.** Raw SCA dimension names (Body, Acidity, Sweetness, Savory / Depth, etc.) are cupper vocabulary, not necessarily the clearest words for a customer who's never heard them. Same naming/purpose pattern as `coffee_alias.platform_name` (a public-facing alias for something internal), just applied to dimensions instead of coffees:

- `ALTER TABLE coffee_dimensions ADD COLUMN IF NOT EXISTS platform_name TEXT` — idempotent.
- Falls back to the raw `coffee_dimensions.name` if unset — `COALESCE(platform_name, name)` at the query level, same pattern used everywhere else in this project for a customer-facing default.
- **Seed values for this pass** — all 7 numeric dimensions (the free-text ones — Fragrance, Aroma, Flavor, Finish Character, Mouthfeel — aren't used for dial/bar axes, leave their `platform_name` null):

  | Raw name | `platform_name` | Why |
  |---|---|---|
  | Sweetness | *(leave null → falls back to "Sweetness")* | Already plain English, no translation needed |
  | Acidity | **Brightness** | "Acidity" reads as sourness/stomach discomfort to most people; "Brightness" is the standard specialty-coffee consumer term for the same lively quality |
  | Bitterness | **Boldness** | "Bitter" reads negatively even though moderate bitterness is often desirable; "Bold" is common, positive, already-familiar product language |
  | Body | **Intensity** | Avoids "Strength," which reads as caffeine content rather than mouthfeel — "Intensity" mirrors how consumer coffee brands (e.g. Nespresso) already use similar language |
  | Texture | *(leave null → falls back to "Texture")* | Already plain enough — coffee bags already say "silky texture," "creamy texture" |
  | Savory / Depth | **Complexity** | Borrows a word consumers already have a positive mental model for from wine culture; roughly captures clean-and-simple vs. deep-and-layered |
  | Finish Length | **Finish** | "Finish Length" sounds like a lab measurement; "long finish" / "clean finish" is how people already talk about this |

  Treat every one of these as adjustable first-draft copy, not locked in — same caveat as the hop-link phrasing and "Liam's intake."
- Editable the same click-to-edit way `platform_name` already works on the Coffees admin page — add this field wherever dimension-level admin editing already happens, or note it as a direct-SQL-only field for now if no dimension admin UI exists yet (check before assuming one does).

---

## Phase C — Wire the dial into Bloom, replacing the stacked position-card list

This changes part of Phase 2a from Part 2. Where Part 2 specified "stack position cards if an archetype has more than one position" — replace that stacking with the dial:

- Each archetype section renders **one `BloomDialWidget`**, not a vertical list of cards.
- Below/beside the dial, **one dynamic card** — the same content Part 2 already specified per position (identity, teaser, price/weight/cart for active; "Temporarily unavailable" badge for inactive) — but now driven by whichever `dialSortOrder` is currently selected on the dial, updating as the user drags and snaps to a new position. This is the same card content and logic from Part 2's Phase 2a, just re-triggered by dial selection instead of being pre-rendered N times in a stack.
- The "Reveal the full profile" affordance, informational layer (Liam's intake, explore-further link, dimension bars, Collaborative Flavor Wheel, compatibility badge, hop links) all stay exactly as Part 2 specified — they belong to the dynamic card, unchanged in content, just now attached to whichever position the dial currently points at.
- **Hop navigation interacts with the dial now, not just scroll-and-reveal.** When a hop link (Part 2, Phase 2a #5) targets a position within the *same* archetype, rotate that archetype's dial to the target position (instead of just auto-revealing a card in a stack, since there's no more stack) — same idea, adapted to the new interaction model. A bridge hop into a different archetype still scrolls to that archetype's section and rotates *its* dial to the target position.

---

## Phase D — Personalization: remember a signed-in user's dial choice per archetype

**Confirmed with Dana: persist this per user, in a dedicated table — do not touch `user_archetype_tuning`.**

Two personalization concepts exist here and must stay fully separate, not just structurally but by ownership:

- `dial_archetype_positions`/`dial_position_vocabulary` — discrete, real-coffee positions. This is what the dial selects from.
- `archetype_tunable_variable` + `user_archetype_tuning` (+ `user_vector_state`) — a **separate system that computes a user's confidence/offset on a dimension over time, updated from feedback** (a backend-derived signal, not something a user sets directly by dragging a UI control). Currently dormant/unused, but reserved for that purpose — **do not repurpose it, even though its `(user_id, archetype_id, dimension_id)` key shape happens to match what the dial needs.** Sharing a table risks exactly the confusion this correction is fixing: which value is authoritative, and whether a future confidence-computation pass could silently overwrite or be affected by the dial's remembered position.

Instead, a small, single-purpose new table:

```sql
CREATE TABLE IF NOT EXISTS user_bloom_dial_position (
  user_id          UUID NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  archetype        archetype_enum NOT NULL,
  dial_sort_order  INT NOT NULL,
  updated_at       TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, archetype)
);
```

Uses `archetype_enum` directly (not `archetype_id UUID`) to match the rest of the Bloom Dial family (`dial_archetype_positions`, `coffee_alias`, `dial_slot_price` all key off the enum) — this table belongs conceptually with those, not with `user_archetype_tuning`.

- `CREATE TABLE IF NOT EXISTS` — idempotent, standard pattern.
- New endpoints in `backend/src/routes/users.ts` (or wherever user-scoped routes live), `requireAuth`:
  - `GET /api/users/dial-position?archetype=` — returns `{ dialSortOrder: number | null }` for the signed-in user.
  - `PATCH /api/users/dial-position` — body `{ archetype, dialSortOrder }`, upserts on `(user_id, archetype)`.
- **`BloomDialWidget` behavior when signed in**: on mount, call `GET /api/users/dial-position`; if a saved `dialSortOrder` exists, pass it as `initialSortOrder` so the wheel starts pre-rotated there instead of at the ★ default position. If none exists (new user, or signed out), start at the ★ default, same as today.
- **Save trigger**: call `PATCH /api/users/dial-position` automatically whenever the wheel snaps to a new position and the user is signed in — no separate "save preference" button, the existing snap interaction already is the save trigger. If signed out, don't attempt to save (no error needed, just skip it) — the dial still works session-only for guests, per how Part 2 already handles unauthenticated browsing.

---

## Testing task

1. **Stock-check fix**: confirm `resolveBlendForSlot` no longer skips candidates for `quantity_available`. Run against real data — coffees that were invisible before should now appear. Then, specifically, **place a real test order** (or as close to one as the Shopify stub allows) via `POST /api/orders` with a slot-based item, to confirm order routing still resolves correctly now that the quantity check is gone — this function drives real fulfillment, not just display, so display working isn't sufficient proof.
2. **Full page re-check**: with coffees now appearing, verify Bloom actually renders position content, the informational layer (Collaborative Flavor Wheel etc.) appears on reveal, and "Add to cart" is present and functional for at least one real slot end-to-end.
3. **Dial mechanics**: for at least one archetype with 3 positions and (if real data allows) Experimental with 4, confirm the wheel has the correct number of notches, snaps correctly, shows the right `DIMENSION: ___` label (using `platform_name`, e.g. "INTENSITY" not "BODY"), and updates the card beneath it live as it's dragged.
4. **Inactive positions on the dial**: confirm rotating to a position with `isActive: false` shows "Temporarily unavailable" in the card, not a broken state.
4a. **Direction and default**: confirm the wheel starts at the ★ default position on load; confirm clockwise rotation always increases `dialSortOrder` and counter-clockwise always decreases it, on every archetype tested, not just one; confirm the "← Lighter" / "{word} →" cues are visible before any interaction.
5. **Hop-to-dial-rotation**: confirm a within-archetype hop rotates the dial to the target position; confirm a bridge hop scrolls to the other archetype's section and rotates that dial correctly.
6. **Personalization**: as a signed-in test user, turn a dial to a non-default position, reload the page, confirm it starts pre-rotated to that saved position. Confirm a signed-out visit still works and doesn't error trying to save.
7. **Regression check on `FlavorQuiz.tsx`**: confirm the original `BloomDial` on the quiz result screen is completely unaffected — still Chocolate & Nutty only, still its own mock data, since Phase B explicitly didn't touch that file.

---

## Decisions Dana has confirmed (this part)

1. **Stock-check fix**: redefine `resolveBlendForSlot` to ignore `quantity_available`, check only `is_active` — not a temporary data patch. Chosen knowing this also touches real order-fulfillment routing, re-tested accordingly.
2. **`user_archetype_tuning`/`archetype_tunable_variable` stay completely untouched.** That system is reserved for a computed, feedback-derived confidence/offset signal — a different kind of data, owned by a different future feature, even though its key shape coincidentally matched what the dial needed. The Bloom Dial's memory lives in its own new table, `user_bloom_dial_position`, with no relationship to that system at all.
3. **Dial choice persists per signed-in user**, saved automatically on snap, pre-sets the dial on return visits. Guests get session-only behavior, same as before.
4. **`coffee_dimensions.platform_name`** — new consumer-facing word per dimension, same pattern as `coffee_alias.platform_name`. Body → "Intensity" for this pass (adjustable copy). Rotation direction is standardized: clockwise = more of the dimension, counter-clockwise = less, same convention on every archetype, with a visible cue on the dial itself rather than something discovered by trial and error.

## Out of scope for this part

- Any changes to `FlavorQuiz.tsx` itself — the original `BloomDial` stays exactly as is.
- Any changes to `user_archetype_tuning`, `archetype_tunable_variable`, or `user_vector_state` — all three stay exactly as they are, fully untouched by this feature.
- Writing missing `dial_position_vocabulary.description` copy for positions that don't have any — flagged during testing, not authored here; that's a content task, not a code task.

## Summary checklist

- [ ] `resolveBlendForSlot` no longer gates on `quantity_available` — only `is_active` + row-exists-at-weight
- [ ] Real order placement re-tested after the fix, not just display
- [ ] `GET /api/coffees/archetypes` extended with `dimensionName`/`dimensionPlatformName` (archetype-level) and `description` (per slot)
- [ ] `coffee_dimensions.platform_name` column added; all 7 numeric dimensions seeded per the table above (Acidity→Brightness, Bitterness→Boldness, Body→Intensity, Savory/Depth→Complexity, Finish Length→Finish; Sweetness/Texture left null); falls back to raw name via `COALESCE` where unset
- [ ] `BloomDialWidget.tsx` — new, generalized, reusable dial component; `FlavorQuiz.tsx`'s original `BloomDial` untouched
- [ ] Dial starts at ★ default position; clockwise = more/counter-clockwise = less, consistent on every archetype; visible "← Lighter" / "{word} →" cue on the dial
- [ ] Bloom's archetype sections use one dial + one dynamic card per archetype, replacing the stacked card list from Part 2
- [ ] Hop links rotate the dial (same-archetype) or scroll + rotate (bridge archetype) instead of scroll-and-reveal-in-stack
- [ ] New standalone `user_bloom_dial_position` table (not a column on `user_archetype_tuning`) + `GET`/`PATCH /api/users/dial-position` endpoints
- [ ] Dial pre-sets to saved position for signed-in users; auto-saves on snap; no-ops gracefully for guests
- [ ] Testing task above completed, including the order-placement re-verification and the FlavorQuiz.tsx regression check
