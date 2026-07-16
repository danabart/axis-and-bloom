# Find My Flavor — Part 2: just-finished-quiz results screen — reveal-timing bug + missing CTAs

**Component reuse — hard requirement for this part, not just a nice-to-have.** Every piece of "the archetype box with the dial and options" already exists (`ArchetypeSection`, `BloomDialWidget`, `PositionCard`, `RevealedPanel`, `usePositionCardData`, `CompareOverlay`, `useCart`/`CartContext`) and is already proven working on `/bloom` and on this same page's returning-user screen. This part is a consumer of that existing work, same as Part 1 was — it must not reimplement dial UI, position/price cards, reveal panels, or cart logic locally. That's exactly the mistake already sitting in this file today (the local `BloomDial` mock component + hardcoded coffee-reveal panel, chocolate-only) that this part removes. If anything about the existing components doesn't fit this screen, the fix is to adjust how this page *uses* them (props, layout, wrapper) — not to fork a parallel local version. Any change to the components themselves is still out of scope (see below) and should come back as a question, not a local workaround.

**Context.** Part 1 (`CLAUDE_CODE_PROMPT_FIND_MY_FLAVOR_PART1_RETURNING_USER_REDESIGN.md`, done 2026-07-13, see `WHAT_WE_BUILT.md` #91) redesigned State 1 ("returning user") of `frontend/src/app/components/FlavorQuiz.tsx`. That prompt explicitly deferred this screen: *"The just-finished-quiz curtain/reveal screen (Part 5's old Phase C2) — its hardcoded `BloomDial`/`BODY_LEVELS` mock stays as-is. If/when Dana asks for that, it becomes Find My Flavor Part 2, in this same folder."* Dana has now asked for it — she retook the quiz at `/find-my-flavor`, reached this screen (the one right after `isComplete` becomes `true`, roughly lines 1238–1586 of `FlavorQuiz.tsx` today), and flagged two problems.

## Bug 1 — curtain covers *after* the match is already visible, not before

**Reported behavior:** finish the quiz → the match (archetype name + bag) is visible → about a second later a full-screen "reveal window" drops down and covers it → have to scroll again to see the coffee. **Intended behavior** (per the code's own comments, line 1241-1242): the curtain should already be covering the screen the instant the results screen mounts; scrolling is what slides it away to reveal the match underneath — never the other way around.

**Root cause, found in code (please verify by reproducing before fixing, this is the most likely explanation but confirm it):** the curtain for every archetype *except* `chocolate` (`archetypeKey !== 'chocolate'`, i.e. Floral, Fruity, Balanced & Sweet, Spicy & Earthy, Experimental — this matches exactly what Dana saw, she matched Floral) is built at ~line 1518-1527 as:

```jsx
<div style={{
  position: 'absolute', top: 0, left: 0,
  width: '100%', height: '100%',
  backgroundImage: `url(${archetype.wallpaper})`,
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  pointerEvents: 'none',
}} />
```

This div has **no `backgroundColor` fallback** — only `backgroundImage`. Until `archetype.wallpaper` (a ~1MB JPG imported from `frontend/src/design/IMAGES/archetypes/*.jpg`, e.g. `Floral.jpg`) finishes downloading and decoding, this div paints fully transparent. The gradient-overlay div stacked on top of it (`linear-gradient(to top, rgba(10,6,4,0.62) 0%, ... 0% at the top)`) is only ~62% opaque at the very bottom and fully transparent at the top, so most of the screen shows the **base layer underneath** (the archetype name, bag, and profile text — all rendered immediately, not gated on any image load) right through the still-loading curtain. Once the wallpaper image finishes loading (~1s later on a typical connection), it suddenly paints in and the curtain becomes opaque — which reads exactly like "a reveal window dropping down to cover the screen" after the match was already visible. `revealProgress` is still `0` at this point (no scroll has happened yet), so the user is now looking at a fully-opaque curtain again and has to scroll to get back to where they started.

Note the `chocolate` variant (~line 1420-1425) does **not** have this bug — it sets `backgroundColor: '#f2f1ea'` explicitly on its curtain div, so it's always opaque regardless of any image load. That's the reference to match.

**Fix:**
1. Give the "other archetypes" wallpaper curtain div an explicit opaque `backgroundColor` (a sensible dark neutral consistent with the gradient overlay — e.g. `#0a0604`, the gradient's own base color — so there's no flash of anything through it while `archetype.wallpaper` loads, at any connection speed).
2. Additionally, preload `archetype.wallpaper` for the scored archetype as soon as it's known — right when `handleNext`/`handleBranchContinue` sets `archetypeKey` (before `setIsComplete(true)` even renders the results screen), e.g. via `new Image().src = ARCHETYPES[key].wallpaper` — so that by the time this screen mounts the image is already cached and there's no visible pop-in at all, not just a covered one.
3. While reproducing, also check whether the `window.scrollTo({ top: 0 })` + `setRevealProgress(0)` / `setRevealForced(false)` reset (currently in a `useEffect` keyed on `isComplete`, ~line 630-638) can itself cause a secondary flash on a **retake** specifically — if the user scrolled deep into a previous reveal (`revealProgress` near 1) before retaking, that reset only takes effect on the next render *after* paint, one tick later than the state change that shows the results screen. If this reproduces as a contributing factor, move the reset so it happens synchronously with `setIsComplete(true)` (in `handleNext`/`handleBranchContinue`/`handleRetake` directly) rather than relying on a separate effect that fires post-paint.
4. Verify the fix with the browser's network throttled (e.g. "Fast 3G") to confirm the pop-in is actually gone, not just unnoticeable on a fast dev connection — this project's convention is to verify fixes against realistic conditions, not just "looks right locally."

## Bug 2 — no CTAs (add to cart, Bloom Dial, Talk to Liam) on this screen for any archetype except a hardcoded chocolate special case

**Reported:** the page has no way to add to cart, talk to Liam, or use the Bloom Dial. Dana's ask: make this screen show the matched archetype "as we see it in other pages... with the Bloom Dial and all the options" — i.e. the Floral box, in her case.

**Root cause, found in code:** the results screen's base layer (~line 1259-1406) only wires up a real interactive dial for one hardcoded case:

```jsx
{archetypeKey === 'chocolate' ? (
  <BloomDial onReveal={setRevealedLevel} />
) : (
  // Placeholder for other archetypes — shows archetype description
  <div>...just the "YOUR PROFILE" label + shortDescription text...</div>
)}
```

`BloomDial` here (defined locally at ~line 272, **not** the same component as `BloomDialWidget` used by `ArchetypeSection` elsewhere in the app) is a self-contained mock tied to `BODY_LEVELS` (Gentle/Medium/Bold), and only feeds a hardcoded "coffee reveal panel" (Best for / Also great for / a "BUY THIS COFFEE" button that hard-navigates to `/shop`) that itself only renders when `revealedLevel` is set — which only `BloomDial`'s `onReveal` callback ever sets. So for every archetype other than Chocolate & Nutty — Floral included — there is no dial, no reveal, no cart, no Liam link, nothing but static text and a bag image. This predates `ArchetypeSection` (`frontend/src/app/components/bloom/ArchetypeSection.tsx`, The Bloom Part 10) and was explicitly called out as out of scope in Part 1 for exactly this reason — it's now in scope.

**Fix — reuse `ArchetypeSection`, the same component already doing this job on `/bloom` and on this page's own returning-user screen (State 1):**

Replace the base layer's current 50/50 dial-placeholder / bag-text split with:
- A condensed header (archetype label + short profile blurb — reuse the existing "YOUR PROFILE" / `shortDescription` text, or the "YOUR COFFEE ARCHETYPE" / name treatment, your call on which reads best once it's sitting above a full ArchetypeSection rather than being the whole screen).
- `ArchetypeSection` rendered at **full page width** underneath, for the just-scored archetype, wired the same way the returning-user screen wires it (`selectedSortOrder`, a `revealedKeys` set, dial ref, `onDialSelect`/`onToggleReveal`/`onAddToCart` via `useCart()`/`onHopClick`/`onCompare`), plus `CompareOverlay`.

**Do not** try to fit `ArchetypeSection` into the current 50/50 left/right split. Part 1's own investigation (`WHAT_WE_BUILT.md` #91) measured this directly on this exact page: at a 50/50 split the card column shrinks to ~108px and even a generous 1100px still only leaves ~140px of usable card content, with "Reveal the full profile ↓" alone eating almost all of it — the title wraps letter-by-letter. `ArchetypeSection`'s three-column row needs full page width to render correctly; that's why the returning-user screen puts its profile text + nav *above* `ArchetypeSection` rather than beside it, not next to it. Follow that same pattern here.

**Data-fetching gotcha — this screen cannot reuse `matchedData`/`matchedArchetypeId` as-is.** Those (used by the returning-user screen's `ArchetypeSection` instance, ~line 582-593) come from `userProfile?.archetype` — the user's *previously saved* profile, fetched via `getUserProfile()`, and `archetypesList` is only fetched `if (!user) return` (signed-in users only). This results screen is reached by **guests too** (most quiz-takers won't be signed in), and even for a signed-in user, `userProfile` may not yet reflect the archetype they *just* scored on this attempt. So:
- Fetch `/api/coffees/archetypes` unconditionally on this page (not gated on `user`) — or at minimum, also trigger it once scoring completes, regardless of auth state.
- Derive this screen's `ArchetypeData` by matching on the **just-scored** archetype, not `userProfile`. You'll need a mapping from this quiz's local `archetypeKey` (`floral | fruity | balanced | chocolate | earthy | experimental`) or `score.archetype` (the display name) to the `archetype` field `/api/coffees/archetypes` actually returns (an `archetype_enum` id — per #91, confirmed values include at least `floral`, `fruity`, `chocolate_nutty`, `balanced_sweet`, `earthy`, `experimental`, but **verify the exact live values from the endpoint response rather than assuming** — #91 found and fixed a real name→key mismatch bug in this exact area server-side, so don't re-guess it, check).
- Use separate component state for this screen's `ArchetypeSection` instance (`selectedSortOrder`, `revealedKeys`, dial ref, etc.) rather than reusing `matchedSortOrder`/`revealedKeys`/`matchedDialRef` from the returning-user screen — those two screens are unlikely to both be mounted at once today, but keep them cleanly separate rather than relying on that.

**Explicit tradeoff to flag back to Dana, don't silently decide it:** this removes the chocolate-only special case entirely — `BloomDial` (the local mock) and its `BODY_LEVELS` Gentle/Medium/Bold sub-selection UI, plus the hardcoded "BUY THIS COFFEE → `/shop`" button, go away in favor of the same `BloomDialWidget`/`PositionCard`/`RevealedPanel` flow every other archetype already gets through `ArchetypeSection`. This is the natural reading of "we should see the archetype box as we see it in other pages... with the Bloom Dial and all the options" (and `/shop` is the page being retired per the site's target IA, so losing that link is a plus, not a regression) — but call this out clearly in your summary/`WHAT_WE_BUILT.md` entry so Dana can weigh in if she wanted the chocolate-specific body-level interaction kept somewhere.

## Explicitly out of scope for this part

- Quiz States 1–3 (returning user, no-archetype-yet, guest name screen) and the quiz-in-progress flow itself.
- Any change to `RevealedPanel.tsx`, `PositionCard.tsx`, `BloomDialWidget.tsx`, `CompareOverlay.tsx`, `usePositionCardData.ts`, or `ArchetypeSection.tsx` itself — this page only consumes them, per established convention (`the_bloom_page`'s territory).
- Any order-scoped feedback prompt (Part 5's old Phase E — still not asked for).

## Testing task

1. **Bug 1 repro + fix, every non-chocolate archetype** (at minimum Floral, since that's the one Dana hit): finish the quiz (and also test via `/find-my-flavor?result=floral` etc. — the existing preview shortcut, ~line 493-497) with network throttled, confirm the curtain is opaque and covering from the very first paint, with no flash of the match underneath at any point before scrolling.
2. **Bug 1, retake specifically:** complete the quiz, scroll to fully reveal, then retake and complete again — confirm the curtain still covers correctly on the second results screen (this is the scenario likely closest to what Dana actually hit).
3. **Bug 2, every archetype including chocolate:** confirm `ArchetypeSection` renders full-width beneath the curtain once scrolled/revealed, with a working dial, position card, reveal toggle, add-to-cart (confirm it lands in the same shared `CartContext` floating cart used elsewhere — add here, check it persists on `/bloom`), compare, and any Liam/hop links `PositionCard`/`RevealedPanel` already provide.
4. **Guest (signed-out) path specifically** — this is the primary audience for this screen and the one most likely to break under the data-fetching gotcha above: confirm the archetype lookup and `ArchetypeSection` render correctly with no signed-in user at all.
5. Confirm scroll-driven reveal (desktop) and the mobile "TAP TO REVEAL" button still both work correctly after the layout change.

## Summary checklist

- [ ] Curtain (non-chocolate archetypes) has an opaque `backgroundColor` fallback; no transparent-while-loading flash at any network speed
- [ ] Wallpaper image preloaded as soon as the archetype is scored, ahead of the results screen mounting
- [ ] Verified whether the scroll/state-reset effect timing also needed fixing for the retake case; fixed if so
- [ ] Base layer replaced with condensed header + full-width `ArchetypeSection`, for every archetype (chocolate included — special case removed)
- [ ] Archetype lookup for this screen works for guests, not just signed-in users with a saved profile
- [ ] Chocolate-only `BODY_LEVELS`/`BloomDial` mock and `/shop` CTA removal called out explicitly in the summary for Dana's awareness
- [ ] Testing task completed
