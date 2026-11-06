# Brief: Website 7B — Find my flavor: result scene

**Workstream:** website_handoff · **Date:** 2026-11-04 · **Model tier:** cheaper/faster · **Mode:** test, then push · **Depends on:** briefs 7A, 5 (`layout="field"` dial section) and 2 (`customer_words`).

Read first: `README.md` (D6), `HANDOFF_SURVEY_2026-11-04.md` §5 (result), `CLOSING_REPORT_7A.md`, `backend/src/features/find_my_flavor_page/…PART2_RESULTS_SCREEN_REVEAL_AND_CTAS.md`, `backend/src/features/pre_launch_reveal_in_inbox/`, `DEVELOPMENT_GUARDRAILS.md`.

Design source: `source/flavor-b/build.py` result scene (`#result`): photo with the family wash, "{Name}'s family of taste", the family name, the paragraph (words · stop · neighbour coffee), two actions "Turn the {Family} dial" and "Ask Liam why ↗".

## Goal

The result hero is the handoff scene; everything that follows it today stays, restyled: `ShareMatchRow`, `PostQuizEmailGate` / `GateStatusNote`, the unlocked result header, the dial section with cart (now `DialArchetypeSection layout="field"` from brief 5), Worth exploring + adjacent section, `CompareOverlay`, the end action row ("Your flavor profile →", "Back to home →"), Privacy/Terms. The archetype copy still hard-coded in `FlavorQuiz.tsx` (`ARCHETYPES`: descriptions, "why you match", coffee names with percentages) leaves the code.

**Decisions already made:** the hero paragraph is composed from data: `customer_words` (brief 2), the match's dial stop label and the matched coffee's platform name (the archetypes/slots payload the result already fetches); the "why" sentence comes from the existing server `why` source if one exists (Task 0: the quiz result payload / `v_quiz_session_interpretation`), else the hero shows words + stop + coffee only · OT-84 (2026-11-05): `coffee_archetype.description` is empty for two families and off-rule for two; the hero shows the description only when Task 0 finds it non-empty and rewritten (OT-84 closed), otherwise the hero is words + stop + coffee only, never an empty or off-rule sentence · the handoff line "warmth and sweetness over brightness" is not used (dimension words + comparison) · match percentages are not shown (no data basis) · the wrap ceremony stays, recoloured · the sealed (prelaunch) ending stays as 7A left it.

**Guardrails.** G4.1 reuse everything listed above · G4.2 nothing typed in: archetype descriptions, why lines and coffee names come from the API; `ARCHETYPES` is removed · G2.14 if a description field exists on `coffee_archetype` (`description`) it is the one source · G4.4 · G4.5 · G4.6 · G1.6. Schema: none unless Task 0 finds no home for the "why you match" copy; then one nullable column on `coffee_archetype` (`match_reason text`) with comment and seed from the current constants, additive. STOP: none.

## Task 0 — verify first (`CLOSING_REPORT_7B.md`)

1. In `FlavorQuiz.tsx`: the result render tree with line numbers (hero, share row, gate, header, dial, worth exploring, compare, action row, footer links); the `ARCHETYPES` constant and every field it carries; the result payload fields (`archetype`, secondary, confidence?, matched slot?).
2. Which existing API field holds each `ARCHETYPES` field; which has none.
3. Brief 5's `layout="field"` props and whether the result page can pass `archetype` + `slot` to pre-set it.

## Part A — frontend

- Hero scene as drawn, on `quizResultAssets` photo with the family wash (`tints()` from brief 5), name, family, paragraph from data, actions: "Turn the {Family} dial" (scrolls to the dial section below, which is pre-set to the match; keeps `/bloom?archetype=&slot=` as a secondary link), "Ask Liam why ↗" (`/sommelier`, gated by `hasLiamAccess`/prelaunch; signed-out → sign-in redirect).
- Then, unchanged in logic and restyled to the tokens: `ShareMatchRow` (hidden for Experimental as today), the gate, `GateStatusNote`, result header, `DialArchetypeSection layout="field"`, Worth exploring, `CompareOverlay`, end action row, legal links.
- Remove `ARCHETYPES`; if Part A of the schema is needed, do it first and read it.

## Part B — tests

vitest: hero composes from a mocked payload; no percentage anywhere; share row hidden for Experimental; gate renders for guests and the signed-in consent note for members; dial section receives the match; action row links.

## Acceptance

Two live runs (`?preview=true`): one guest to the gate, one signed-in to the full result; screenshots 390/1280; the `?result=<archetype>` preview still works for each of the six.

## Docs and closing

`WHAT_WE_BUILT.md`, `REGRESSION.md` (gate, share, action row, preview param), `OPEN_TASKS.md`, `CLOSING_REPORT_7B.md`.

## Do not

- Do not show match percentages or dimension words on the result.
- Do not drop the gate, the share row, the dial section or the action row.
