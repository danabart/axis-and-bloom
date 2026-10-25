# Coffee presentation, brief 4: the card says what the vault knows (all the roaster's notes, award and brew tags), remarks are masked not withheld, brew methods only from the voice, Blossom's match agrees with its slot, every match/placement divergence listed. No table or view change.

> Folder: `backend/src/features/coffee_presentation/` · Written 2026-10-24 after Dana's visual review of the C&N and Fruity dials on prod · Model: Sonnet throughout
> Builds on briefs 1 to 3 (live). Same rules: roaster's words lead, attributed; our cupping only confirms; nothing hard-coded; nothing deleted; one door per table.
> Status: done on prod 2026-10-24 (`81771aa`, rev 00780; `CLOSING_REPORT_4.md`, `WHAT_WE_BUILT.md` #236).

## Why (Dana, 2026-10-24, on prod)

1. **Coado never says it is an espresso blend.** Joe Bean's site says it in one sentence, "Winner of a 2023 Golden Bean medal, this classic espresso blend", and brief 1's guard withholds a remark whole when it carries an award token, so the espresso half vanished with the award. The portal's brew answer (`roastery_portal_response_brew`, `best` / `also_good`; `roasteryPortalReads.getCurrentResponse` already returns `bestBrew` / `alsoGoodBrews`) is not in the roaster voice at all.
2. **"Award-winning" appears only after the reveal.** Dana wants it on the card.
3. **Quieta's card shows only Hazelnut, Clean Fruit's only Coconut.** Both have three roaster nodes; the card teaser (`lib/signatureLine.ts teaserFor`) renders the signature group only and leaves the accents to the reveal.
4. **Blossom's card reads "A Chocolate & Nutty coffee for this turn of the dial. Its full tasting notes are arriving soon."** Blossom (2916) is placed on the C&N dial, slot 3 "Richer", with match archetype Earthy; its three roaster nodes (Dark Chocolate, Brown Sugar, Chocolate) fall outside Earthy's families, so the signature group is empty, the teaser is null and `DialArchetypeSection.tsx` falls back to that sentence. Brief 7's cupping of 2026-10-23 has both cuppers calling Blossom `chocolate_nutty`, position dark.
5. **Benchmark's description says "best as drip coffee or espresso".** The site says "Cortado, cappuccino, drip coffee, you really can't go wrong". Espresso was invented.

## Decisions (Dana, 2026-10-24). Do not re-open.

1. **The card teaser shows every roaster note the customer may hear**, signature first, then the accents as a clause: "Hazelnut, with citrus fruit and cinnamon"; "Coconut, with caramelized and chocolate"; with no signature rows, the accent notes alone ("Dark Chocolate, Brown Sugar, Chocolate"). Caps as brief 1's two parameters. The reveal panel keeps its two-line form (signature line, "a hint of" clause). The "arriving soon" sentence renders only when the coffee has **no** customer-voice rows at all; its wording moves out of the component into the same place the other customer copy lives (if that is a config read, use it; if copy is inline across the Bloom components today, leave it inline and say so).
2. **Card tags, from data.** Up to two small tags under the name on the collapsed card and the dial card: `Award-winning, per the roaster` when `getRoasterVoice(...).awards.count > 0`; the roaster's **best brew method** label (`bestBrew` from the portal through the lookup `roastery_portal_brew_method`, e.g. "Espresso") when present, else nothing. Rendered from the read's `tags: Array<{ kind: 'award' | 'brew', label }>`; no label text in the frontend. Camila restyles later.
3. **Remarks are masked, not withheld.** `bannedTokensFor` stays the leak list; a remark or portal answer containing a banned token is passed to the prompt with each token replaced by `[…]` ("Winner of a […] […] […], this classic espresso blend"), and the prompt rule says bracketed gaps are omitted facts, never to be guessed at. The roaster's name and the raw coffee name are masked the same way. Nothing is withheld whole any more. The post-generation guard is unchanged (a leaked token still rejects).
4. **Brew methods in the voice, and only from the voice in the text.** `getRoasterVoice` adds `portal.bestBrew` and `portal.alsoGoodBrews` (labels through the lookup). Prompt: "brew methods the roaster names: best <x>; also <y, z>" plus whatever `remarks.brewing` says. Rule, enforced like the milk rule: a brew-method label from lookup `roastery_portal_brew_method` (compare lowercased labels and their lookup synonyms if the lookup has them) may appear in generated text only if that label, or the same word, appears in the voice (portal brews or any remark). Reject and regenerate, three tries, then the field fails with the reason. Words the roaster wrote (cortado, cappuccino) are in the voice by definition.
5. **Blossom (2916) match archetype → `chocolate_nutty`**, through `catalogService.setMatchArchetype`, `source 'cupping'`, `sessionId` = the cupping session dated 2026-10-23 (looked up by date), `confidence 'high'` if both cupper rows in that session carry the call `chocolate_nutty` else `'medium'` (read it, do not assume), `notes 'Dana 2026-10-24: Blossom is Chocolate & Nutty, slot 3 Richer; both cuppers called C&N dark on 2026-10-23; roaster form proposal kept as evidence'`, basis from `composeBasis`. Loader `load/setMatch2916.ts` like brief 2's, dry run, skip when already C&N. Then `refresh-content` on 2916 (story text only) and print its line, teaser, tags and `/story dialPosition`.
6. **Divergence list.** The closing report prints every active coffee whose current match archetype differs from its home slot's archetype (`v_coffee_slot` role home + `v_coffee` match), on test and on prod, with the coffee id, platform name, match, slot archetype and slot. No write beyond decision 5; the rest are Dana's calls afterwards.
7. **Regenerate** `three_voice_story` and `story` (not admin-edited) for every active coffee after decisions 3 and 4 land, as brief 1 F2 did; print 2914, 2905, 2916, 2917, 2902.
8. **No table, view or column change. No catalog write but decision 5, through the door. Nothing deleted. Prod on Dana's go.**

## PART A: card (decisions 1, 2)
A1. `lib/signatureLine.ts`: `teaserFor(rows)` per decision 1; `accentClauses` unchanged for the reveal. The accent clause in the teaser uses the note names, not the family word (the family word belongs to the reveal's "a hint of" line).
A2. `roasterVoiceReads.getRoasterVoice` adds `tags`; `GET /api/coffees/:id/content` adds `tags` to its response (public shape, additive); `usePositionCardData` exposes them; `PositionCard.tsx` and `DialArchetypeSection.tsx` render them under the name, small caps, grey, as brief 1's grey tags on the admin page; nothing rendered when the array is empty.
A3. `DialArchetypeSection.tsx` fallback per decision 1.

## PART B: voice and prompts (decisions 3, 4)
B1. `contentGuard.ts`: `maskTokens(text, tokens)` → the bracketed text; `roasterVoiceReads` applies it to every remark and portal string in the voice instead of dropping them; `getRoasterVoice` returns `masked: number` (count of masked fragments) for the report.
B2. `roasterVoiceReads`: `portal.bestBrew`, `portal.alsoGoodBrews` through `roasteryPortalReads` (labels via the lookup, never the stored code).
B3. `claude.ts VOICE_RULES` and `storyLayer.ts`: the brew lines and the bracket rule; `contentGuard.looksLikeInventedBrew(text, voice, brewLabels)` wired into the same reject-and-retry as the milk rule for the description and the story; `brewLabels` read from the lookup at generation time.

## PART C: Blossom (decision 5)
As specified; the loader prints before/after for the assignment row, then `/flavor-wheel`, `/content` (teaser, tags) and `/story` for 2916.

## PART D: regenerate and list (decisions 6, 7)
D1. `load/regenerateStories.ts` from brief 3, extended to regenerate `three_voice_story` too (flag `--fields story,description`), dry run then real.
D2. The divergence query in the closing report (read-only), test and prod.

## Tests
- `teaserFor`: signature + accents → "Hazelnut, with citrus fruit and cinnamon"; accents only → plain list; no rows → null; caps respected.
- Tags: award row → award tag; `bestBrew` → brew tag with the lookup label; neither → `[]`; the content route returns `tags`.
- Masking: the Golden Bean sentence reaches the prompt as "Winner of a […] […] […], this classic espresso blend" (snapshot); a roaster name inside a remark is masked; the leak guard still rejects an output containing a token.
- Brew rule: voice with no brew words + output "espresso" → rejected; voice with `bestBrew = espresso` → passes; output "cortado" when the remark says cortado → passes; labels come from the lookup (test inserts a fixture lookup value and asserts it is honoured).
- Loader: dry run writes nothing; real run supersedes and keeps history; second run skips.
- Brief 1 to 3 tests green; lints, builds, catalog integrity green; full suite green except OT-19.

## CONSTRAINTS
- No `CREATE`, no `ALTER`, nothing deleted. One catalog write (2916) through the door, prod on the go.
- No label, tag text, brew word or copy sentence in a `.ts` / `.tsx` body for this feature; labels from the lookup, tags from the read, fallback copy per decision 1.
- Test DB first; STOP after the test closing report; prod on Dana's go: deploy, Part C loader (dry run, real), Part D1 (dry run, real), verify 2914 / 2916 / 2917 / 2902 cards and texts, divergence list on prod, `catalog:md`, commit.
- Commits straight to main: the reads, guard, prompts, routes, frontend, loaders, tests, `comments.sql` if any Readers line changes, regenerated `CATALOG.md`, `WHAT_WE_BUILT.md` entry, `SOMMELIER_BUILT.md` line, `CLOSING_REPORT_4.md`.

## DONE =
Every card shows all the roaster's notes a customer may hear (signature first), an award tag and a brew tag where the vault has them, and never the "arriving soon" sentence while the roaster gave notes; Coado's description says it is the roaster's espresso blend and award-winning without naming the award; no description or story names a brew method the roaster did not; Blossom's match is Chocolate & Nutty with its basis and its card and story page are whole; the closing report lists every remaining match/placement divergence on prod for Dana's decisions, with the before/after cards and texts for 2914, 2905, 2916, 2917, 2902.
