# Closing report — Website 7B, Find my flavor: the result scene

**Status: shipped** (`WHAT_WE_BUILT.md` #259). Task 0 found no contradiction with the brief, including on OT-84. The run went through code, tests, push, deploy, the startup log and the production smoke; evidence is at the end. Frontend only: no schema, no `comments.sql`, no `CATALOG.md` change.

Read for Task 0: `DEVELOPMENT_GUARDRAILS.md` and `CLAUDE.md` (unchanged), the brief, `README.md` D6, `HANDOFF_SURVEY_2026-11-04.md` §5, `CLOSING_REPORT_7A.md`, `source/flavor-b/build.py` (`#result`), `FlavorQuiz.tsx` (1809 lines at `371e915`), `DialArchetypeSection.tsx` + `field/DialFieldLayout.tsx`, `useDialSlot.ts`, `matchCopy.ts`, `routes/quiz.ts`, the `quiz_session_interpretation` block of `schema.sql`, `OPEN_TASKS.md`.

## Task 0.1 — the result render tree (`FlavorQuiz.tsx` at `371e915`)

| Part | Lines | Before 7B |
|---|---|---|
| Result root (`isComplete`) + `QuizHeader` | 1550–1552 | minimal fixed header (Save progress / Exit) |
| Sealed ending (prelaunch) | 1554–1582 | email card or "It's on its way to {email}" |
| Hero | 1585–1634 | night-scan photo, "{Name} —", "Your coffee archetype", colour bar, `{name}.`, `shortDescription`, scroll cue |
| `ShareMatchRow` | 1637 | hidden for Experimental (`shareSlug` null) |
| Unlocked column + `GateStatusNote` | 1648–1655 | masked email / consent note |
| Result header | 1663–1673 | "Your match", label upper-case, `FAMILY_LINES` |
| Dial section | 1674–1695 | `DialArchetypeSection` (dial layout, folded, breakout) |
| Worth exploring + adjacent | 1701–1735 | chips + folded adjacent section |
| End action row | 1739–1744 | "Your flavor profile →" (signed in), "Back to home →" |
| `CompareOverlay` | 1747–1752 | |
| Gate (guests) | 1755–1765 | `PostQuizEmailGate` |
| Wrap overlay | 1775–1783 | kept |
| Privacy · Terms | 1786–1795 | |

**`ARCHETYPES` (380–485), every field:** `name`, `color`, `wallpaper`, `bag`, `shortDescription`, `whyMatches[3]`, `coffees[2]` (`name`, `flavor`, `match` = a typed percentage). On screen before 7B only `name`, `color` and `shortDescription` were read; `wallpaper` only by a preload whose image was no longer shown; `bag`, `whyMatches` and `coffees` (with the percentages) were not rendered at all. `ARCHETYPE_CARDS` was dead code, and the tie screen had its own typed name map.

**The result payload** (`POST /api/quiz/score`): `archetype` (name), `archetypeId`, `scores`, `experimental`, `secondaryArchetype`, `foodSignal`, `foodSignalAlignment`, `recommendationMode`, `tieDetected`, `tiedArchetypes`, `secondaryPath`, `pairConfidence`, `exploreArchetype`, `exploreReason`, `primaryMargin`, `interpretationVersion`. No confidence percentage, no matched slot. `POST /api/quiz/results` returns `{ id }` only.

## Task 0.2 — where each `ARCHETYPES` field lives in the API

| Field | API home | 7B |
|---|---|---|
| `name` | `archetypeLabel` on `/api/coffees/archetypes` and `/experimental`; the scored `archetype` name | read from there (identical strings, so subscribe / analytics payloads are unchanged) |
| `color` | none in the API; the shared design config `ARCHETYPE_VISUALS` (via `fieldLook()`) already holds it for The Bloom | read from there |
| `wallpaper`, `bag` | design registry (`archetypeAssets`) | not needed (the hero is the result photo) |
| `shortDescription` | `coffee_archetype.description` (G2.14), served only on the signed-in profile | **not shown** (OT-84, below) |
| `whyMatches` | none. `quiz_session_interpretation.explore_reason` is an internal code, not customer copy | **not shown**; the decision's fallback ("words + stop + coffee only"); no `match_reason` column added (the brief adds it only when the why copy has no home *and* is to be shown; the decisions say the hero goes without it) |
| `coffees` + `match` % | the slot's `platformName` at the stop (data); percentages have no basis | the coffee comes from the slot; no percentage |

**OT-84 check:** `OPEN_TASKS.md` still lists OT-84 Open; no commit touches the descriptions (`git log --grep OT-84` shows only Website 6) and the `schema.sql` seed still carries the off-rule Fruity ("…not just the caffeine") and Balanced ("…never surprising") texts. The `/archetypes` payload carries no description, and prod reads go through the public API only. So the hero shows words + stop + coffee only, never the description, exactly as the decision says. Not a contradiction.

**Customer words vs the "Do not" line:** the hero shows the three `customer_words` per the decisions (the handoff's "Full · Grounded · Comforting"). The "dimension words" the brief forbids are the handoff's "warmth and sweetness over brightness" line, which is not used.

## Task 0.3 — brief 5's field and pre-setting it

`DialArchetypeSection layout="field"` takes `data`, `cards`, `selectedSortOrder`, `revealedKeys`, `onDialSelect`, `onToggleReveal`, `onAddToCart`, `onCompare`, `userArchetype`, `source`, `prelaunch`, `onDoorClick`, `between`, `hideHints` (folded/breakout props are ignored). The result passes `data` = the scored family and `selectedSortOrder` = the match's stop, so it opens there. Its section id is the family code, the scroll target for "Turn the dial". There is no server-side "matched slot" for this screen, so the match's stop is the signed-in visitor's saved position for that family, else `openingSortOrder()` (the Website 6 B2 rule /bloom uses: the classic when sellable, else the nearest sellable stop).

## What was built

**`components/quiz/QuizScenes.tsx`:**
- `ResultScene`: photo, family wash, the site header floating, "{Name}'s family of taste", "{Family}.", the line, the two actions; the stagger is driven by the wrap ceremony.
- `composeResultLine()`: words, then "Your place on the dial: stop N — {label} — next to {coffee}." Each part only when the data has it.
- `Scene` takes `className` / `style`.

**`FlavorQuiz.tsx`:**
- `ARCHETYPES`, `ARCHETYPE_CARDS`, the wallpaper/bag constants and the tie name map are gone. A `resultName` state holds the server's scored name beside `archetypeKey`; `resultLabel` = the API label, else that name.
- Hero photo: `quizResultAssets[family]` (the photo the wrap ceremony already shows), fallback `quizSceneAssets.result`; the preload now loads that photo.
- After the hero, on the paper page: `ShareMatchRow`, then the gate (guests) or `GateStatusNote` + the "Your match" header + the field + Worth exploring + the adjacent section + the end row; `CompareOverlay`; Privacy · Terms. The sealed ending is unchanged (still with its `QuizHeader`).
- "Ask Liam why ↗" uses Home's rule. "Turn the {Family} dial" keeps `/bloom?archetype=&slot=` as its href (opens in a new tab with a middle click) and scrolls on a click.

**Shared components:** `DialArchetypeSection` / `DialFieldLayout` gain `hideQuizLink` (G4.1: a prop, not a fork). `Btn` hands the click event to `onClick` and accepts `data-testid`. `PostQuizEmailGate`, `ShareMatchRow` and `GateStatusNote` are on the `--ab-*` tokens.

## Deviations from the brief, and why

1. **Field comfort zone reads the family just scored.** The field's comfort-zone aside showed "Find your flavor to see your match" to guests on their own result (it read the saved profile only). The primary field now gets `userArchetype = the scored family` (it shows "From your quiz · In your comfort zone"); the adjacent section keeps the saved-profile behaviour.
2. **Key presses during scoring and the wrap ceremony are ignored** (found in acceptance, not in the brief). The last question stays mounted under the status and the papers, and 7A's document-level letter keys reached it: the first acceptance runs scored three times per run, and on the test DB the screen said Fruity while `quiz_final` and the saved sessions said Floral. `handleAnswerSelect` returns while `isScoring || isWrapping`, `handleBranchAnswerSelect` while `isWrapping`. Test added and shown to fail without the guard. The state machine is otherwise untouched.
3. **The header over the hero is the site `Navigation`**, as on the other option-B scenes and as drawn, instead of the old minimal `QuizHeader` (whose Save progress / Exit belong to the questions; the sealed ending keeps it).
4. **A retake into another family resets the results dial** (before, the previous family's stop number carried over to the new family when no position was saved).
5. **The "Your match" family line** (`FAMILY_LINES`) is kept as the brief lists the header unchanged; it is still copy in code: OT-88.

## Copy (G4.4)

| Handoff | Now |
|---|---|
| "{Name}'s family of taste" | same ("Your family of taste" without a name) |
| "Chocolate & Nutty." | the API label + "." |
| "Full · Grounded · Comforting. Your answers leaned toward warmth and sweetness over brightness. On the dial that places you at stop 2 — Classic — next to Tiger Stripe Espresso." | "{words}. Your place on the dial: stop N — {label} — next to {coffee}." (the comparison sentence dropped as decided; "Your place on the dial" echoes the entry's "your place on the dial") |
| "Turn the Chocolate & Nutty dial ↗", "Ask Liam why ↗" | same, from data |

## Evidence

**Tests:**
- Frontend vitest **105/105** (7 files): new `quiz/result.test.tsx` (9): the hero from a mocked payload (opening stop, saved stop, no-coffee stop, no-words family); no "%" and none of the old typed copy on the page; share row hidden for Experimental; the gate for guests and no field before it; the recognized guest's masked note and home-only end row; signed in: a full run, the consent note, the subscribe payload's name, the field's props (`layout`, family, stop 2, `hideQuizLink`, `userArchetype`), Liam `/sommelier`, both end links; `?result=` for all six. `quiz.test.tsx` +1 (no second score during the ceremony).
- Frontend `tsc --noEmit`: no new error (the known 7: `ArchetypeSection.tsx` `hops`, `useAdjacentArchetype.ts` ×3, `Profile.tsx` ×3). `vite build` clean.
- CI lints all exit 0: `lint:catalog`, `lint:retention`, `lint:customer`, `lint:lineage`, `lint:roastery-portal`, `lint:cupping`. No backend file changed, so the backend suite was not rerun (baseline unchanged).

**Local acceptance (G5.2):** backend on `axisandbloom_test` (`pg_stat_activity`: its only session is on `axisandbloom_test`), Vite :5179, headless Chromium, `?preview=true`, 390 and 1280.
- **Guest runs to the gate**, B on every question, B on the branch (Fruity → Floral). After the guard: one `POST /api/quiz/score` per run; the hero reads "Floral." and equals the saved session.

  | Width | `quiz_session` (test DB) | funnel session key | rows |
  |---|---|---|---|
  | 390 | `6806ef1f-7ca2-4ab2-a1ce-627f3a4b1c81` Floral | `0d58640d-5543-4e6d-8dc2-72e0d205aabd` | `70376e36…` quiz_start, `e0d1c421…` quiz_complete Fruity, `fa4f91af…` quiz_final Floral |
  | 1280 | `a992d4cf-db94-4870-8b26-2a6a32be5cbb` Floral | `b64eb905-7441-4bf1-91d4-9a6e58f94703` | `e0956b18…` quiz_start, `6371f6ad…` quiz_complete Fruity, `0be315e6…` quiz_final Floral |

  The earlier runs before the guard (sessions `52e3595a…`, `1f5ea56d…`, `0e53d99c…`, `c3c21881…`, `02d458e5…`, `c0397ed0…`, `e5b3a9f6…`, `51e12236…`) are the double-scoring evidence for deviation 2; they stay on the test DB.
- **The six results via `?result=`** as a recognized guest (unlocked), both widths: family, line, `/bloom?archetype=&slot=` href, Liam `/sign-in?redirect=/sommelier`, share row (0 for Experimental), "Turn the dial" lands on the field (top 84 px at 390, 109 px at 1280) with the stop label matching the hero, end row "Back to home →", no "%", no "Take the quiz", no horizontal scroll, no page errors. Test-DB lines, e.g. Floral "Bright · Fragrant · Delicate. Your place on the dial: stop 1 — Delicate — next to Light Floral Edge."; Earthy "Deep · Bold · Lasting. Your place on the dial: stop 2 — Earthy."; Experimental "Your place on the dial: stop 2 — Adventurous."
- Two `POST /api/client-errors` per guest run: `[FlavorQuiz/prefill-profile]` and `[FlavorQuiz/dial-position-read]` for the anonymous Firebase user against the local backend; both paths predate 7B.

**Production (2026-11-06):**
- **Commit and deploy:** `a1dad4b` pushed to `main`; Deploy run 42270466729 green (backend + frontend); Cloud Run revision `axis-bloom-backend-00832-kz9` (us-central1).
- **Startup log** (52 lines, two boots): 0 ERROR; `[data-catalog] report only: 155 tables, 78 views, 1415 columns; 1 of 6 checks with findings`. The findings are the same as on 7A's revision: data-catalog #6, evidence-integrity #2 / #6, quiz-integrity #10, sommelier-integrity #3. No schema change, so `CATALOG.md` was not regenerated.
- **Bundle:** `https://axis-and-bloom-prod.web.app` serves `index-Brt4ppac.js`, which contains "Your place on the dial" and "family of taste" and none of the old typed copy ("Ethiopia Yirgacheffe", "You are drawn to coffees").
- **Page smoke in Dana's Chrome** (the extension opened `/find-my-flavor` this time). The account is signed in with Liam access, so this is the signed-in full result:
  - `?preview=true&result=chocolate`: "Your family of taste" / "Chocolate & Nutty." / "Full · Grounded · Comforting. Your place on the dial: stop 2 — Classic — next to Coado."; Ask Liam why → `/sommelier`; share row shown; no gate (member); no horizontal scroll.
  - Turn the dial scrolls to the field (top 112 px): stop "2 · Classic", coffee "Coado", the comfort zone "From your quiz · At the edge of your comfort zone…", no "Take the quiz", end row "Your flavor profile → · Back to home →".
  - The only "%" on the page is the field's quick pick "The Chocolate & Nutty Collection · 3 coffees · 10% off" (the offer's discount from data), not a match percentage.
  - The other five: Floral "…stop 1 — Delicate — next to Light Floral Edge.", Fruity "…stop 1 — Mellow — next to Clean Fruit.", Balanced "…stop 4 — Lively.", Earthy "…stop 4 — Intense." (Balanced and Earthy open on this account's saved dial positions, as designed), Experimental "Your place on the dial: stop 2 — Adventurous." with no share row.
  - A screenshot at desktop width was taken. The 390 width could not be set in Dana's window (the resize left `innerWidth` at 2195), so the 390 screenshots are the local ones above.
- **Not done on prod:** a guest run to the gate. It needs a signed-out private window, and a real run writes production quiz rows; the guest path is covered by the local runs (same build, test DB). OT-90 is left for Dana's own signed-in look at a fresh quiz, including the comfort-zone wording.

## What the next brief needs

- OT-84 rewrite, then one line puts the description back in the hero.
- OT-79: Profile and the adjacent sections still use the dial layout.
- OT-88 (family line), OT-89 (one result photo or per family), OT-90 (signed-in check on prod).
