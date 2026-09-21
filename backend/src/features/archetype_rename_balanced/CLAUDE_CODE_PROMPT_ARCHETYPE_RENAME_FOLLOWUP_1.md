# Claude Code Prompt — Archetype rename follow-up 1: dial name lines, Firestore journey labels, quiz exit row

**Standalone brief (2026-09-21).** Follows the rename commit `5028c7d` ("Balanced & Sweet" → "Balanced"), which is deployed. Three things Dana saw on the live site after the deploy, plus one UX gap she noticed at the same time. Commit on its own; `npm run lint:catalog`, both builds and `npm test` must stay at the rename's baseline (12 pre-existing tie-break failures, nothing new).

**Goal:** after this brief, the Bloom dial's big name reads BALANCED; the profile's Flavor activity log says "Balanced" for old and new quiz entries; a retake that lands on the same archetype is counted as the same archetype even when the stored history says "Balanced & Sweet"; and the quiz result screen has an obvious way out.

**Why (context, not instructions):** the rename swept every literal spelled `Balanced & Sweet`, but two places carry the name in a shape the sweep could not see. The dial splits the name across two array elements (`['BALANCED', '& SWEET']`), and Firestore stores display names in `users/{uid}/metadata/taste_journey` and `users/{uid}`, outside the Postgres-only discovery query. The exit gap is older: the result screen's header links are 8 px at 40–45 % opacity and the "Your flavor profile →" link only appears inside the revealed panel.

**Decisions (Dana, 2026-09-21) — implement as stated:**
- Exit = a quiet action row at the end of the results plus a legible header. Add-to-cart stays where it is (per-coffee buttons + `FloatingCart`); no new cart control.
- Reuse existing pieces (`QUIET_LINK_CLASS` style, `Link`, `PostQuizEmailGate` for anonymous users). No new component files for the row.
- Copy in the positive register: say where the link goes, never what the user is leaving or what they have not done.

## Task 0 — Verify (report confirmed / deviated before editing)

- `git log -1` is `5028c7d` or a descendant; working tree clean apart from Dana's own modified docs and untracked feature docs.
- `frontend/src/app/components/bloom/dial/archetypeConfig.ts` L58–65 `NAME_LINES`: `balanced_sweet: ['BALANCED', '& SWEET']`, `chocolate_nutty: ['CHOCOLATE', '& NUTTY']`. Used at `BloomDial.tsx` L655 and L667 (`config.nameLines`).
- `backend/src/routes/quiz.ts` ~L281–300: the `taste_journey` write. `isSame = journey?.currentArchetype === archetype` compares display names; `newEntry.archetype` and `currentArchetype` store the display name. ~L232–236: `firestoreDb.doc(\`users/${req.uid}\`).set({ archetype: archetype.toLowerCase(), archetypeLabel: archetype, … })`.
- `backend/src/routes/users.ts` ~L731–741 (`/flavor-memory`): `archetypeHistory` entries mapped with `archetype: await archetypeCode(h.archetype)` and `archetypeLabel: h.archetype` (the stored string, passed through). ~L769: the synthetic fallback entry builds `archetypeLabel` from `quiz_session ⨝ coffee_archetype`, which is already correct after the rename. Note every other consumer of `journey[]` in that handler (`quizActivity` ~L780, the reading-line signal, `evolutionCount` / `currentStreakCount` if surfaced).
- `frontend/src/app/components/FlavorQuiz.tsx`: `QuizHeader` L100–140 (wordmark `AXIS & BLOOM` at 0.52 rem / opacity 0.6; `SAVE PROGRESS` 0.50 rem / 0.40 for anonymous; `EXIT ×` 0.50 rem / 0.45). Results screen ~L1800–2000: hero, `ShareMatchRow`, `DialArchetypeSection` (primary), `WorthExploring`, `DialArchetypeSection` (adjacent), then `CompareOverlay` and `PostQuizEmailGate`; `FloatingCart` at ~L2019.
- `frontend/src/app/components/bloom/RevealedPanel.tsx` L31 `QUIET_LINK_CLASS` and L137 `Your flavor profile →` (shown after reveal, `hideProfileLink` prop).
- Grep for any other split or spaced spelling the rename could have missed: `grep -rniE "'& ?SWEET'|\"& ?SWEET\"|BALANCED',\s*'&" frontend/src backend/src --include=*.ts --include=*.tsx`. Report hits.

## Part A — Dial name lines (findings 1 and 3)

`archetypeConfig.ts` L61 → `balanced_sweet: ['BALANCED'],`. Check the dial's centre text still fits on one line at the narrowest breakpoint the dial supports (the `bd-nline` styles were tuned for FLORAL / FRUITY / EARTHY, all single-line, so it should); if a size rule is keyed on line count, adjust nothing else, just confirm.

Also fix the comment at L114 if it still reads oddly after the rename, and update the fallback on L112 only if needed (it already upper-cases the live label, which is now correct).

## Part B — Firestore journey: read labels from the code, compare by code (finding 2)

**B1. Read side, `routes/users.ts` ~L735–741.** For each history entry, resolve `code = await archetypeCode(h.archetype)` (already done) and set `archetypeLabel: code ? await archetypeLabel(code) : String(h.archetype ?? '')`. Import `archetypeLabel` from `catalogReads` if the file aliases it (`catalogArchetypeLabel` is used at L804/L823; reuse that alias). Result: an entry stored as "Balanced & Sweet" renders "Balanced"; entries stored under any future rename follow the row automatically.

**B2. Write side, `routes/quiz.ts` ~L285.** Compare by code, not by display string:
```ts
const [newCode, currentCode] = await Promise.all([
  archetypeCode(archetype),
  journey?.currentArchetype ? archetypeCode(journey.currentArchetype) : Promise.resolve(null),
]);
const isSame = !!newCode && newCode === currentCode;
const isFirst = !journey?.currentArchetype;
```
Keep storing the display name in `currentArchetype` / `newEntry.archetype` for backward compatibility with existing docs, but add `archetypeCode: newCode` to `newEntry` and `currentArchetypeCode: newCode` to the doc so future readers can key on the code without a lookup. Do not rewrite existing documents.

**B3. `users/{uid}` doc, `routes/quiz.ts` ~L232.** `archetype: archetype.toLowerCase()` yields `'balanced'` today and yielded `'balanced & sweet'` before. Grep backend and frontend for readers of that field (`users/{uid}` `.archetype` / `.archetypeLabel`; Task 0 found none in the backend, check the frontend's Firebase hooks and the Liam context builder). If there are none, change the write to `archetype: newCode ?? archetype.toLowerCase()` and leave `archetypeLabel` as the display name. If there is a reader, list it and leave the write alone; report either way.

**B4. Test.** In whatever test file covers `/flavor-memory` (or a new `routes/users.flavorMemory.test.ts` following the existing express-spin-up pattern, Firestore mocked the way the neighbouring tests do it), one case: a history entry `{ archetype: 'Balanced & Sweet', trigger: 'first_quiz' }` yields `archetype: 'balanced_sweet'`, `archetypeLabel: 'Balanced'`. And one unit case for the B2 logic if it is extracted into a small pure helper (`isSameArchetype(newCode, currentCode)`), otherwise cover it in the same test.

## Part C — Quiz result screen exit (finding 4)

**C1. Legible header.** In `QuizHeader` (FlavorQuiz.tsx L100–140): raise the wordmark and `EXIT ×` to a size and opacity that read as controls at arm's length. Match the quiet-link scale already used elsewhere on the site (`QUIET_LINK_CLASS`: 10.5 px, tracking .14em, `#9a2918`, opacity .85 → 1 on hover) rather than inventing a new size. Keep `SAVE PROGRESS` for anonymous users at the same scale. `EXIT ×` keeps its current behaviour (`navigate('/')`).

**C2. Action row at the end of the results.** Directly after the adjacent `DialArchetypeSection` block (before `CompareOverlay`), inside the same content column, render a row with the `QUIET_LINK_CLASS` style, centred, with two links:
- Signed-in, non-anonymous user: `Your flavor profile →` (`Link to="/profile"`) and `Back to home →` (`Link to="/"`).
- Anonymous user: `Back to home →` only; the profile path for them is the existing `PostQuizEmailGate` / sign-in flow, which stays as it is.

Spacing: same vertical rhythm as the gap between the two `DialArchetypeSection` blocks. No border, no card, no button chrome; two text links with a gap. Mobile: the two links wrap to two lines naturally.

**C3. Nothing else moves.** `FloatingCart`, per-coffee add-to-cart, `ShareMatchRow`, `WorthExploring`, `CompareOverlay`, `PostQuizEmailGate` and the revealed panel's own `Your flavor profile →` all stay. The returning-user screen (~L1205–1300) already has its own links; leave it.

## Don'ts

- No changes to `catalogReads.ts` beyond imports at call sites; no new label maps; no lint allow-list entries.
- No Firestore backfill or rewrite of existing `taste_journey` docs.
- No new component files, no new dependencies, no copy that names the old archetype name or tells the user what they have not done yet.
- No changes to `BloomDial.tsx` rendering beyond what Part A needs (which should be none).

## Definition of done

- `npm run lint:catalog` 0; backend + frontend builds clean; `npm test` at baseline plus the new cases green.
- Local (against `axisandbloom_test`, never `.env`'s prod URL): Bloom page dial for `balanced_sweet` shows BALANCED on one line; quiz result for a Balanced run shows BALANCED inside the dial and "Balanced" in the heading.
- `/api/users/flavor-memory` for a fixture user whose `taste_journey` history contains a "Balanced & Sweet" entry returns `archetypeLabel: 'Balanced'` for it; a retake that scores Balanced for that same user leaves `evolutionCount` unchanged and increments `currentStreakCount`.
- Result screen: header links legible; action row present with the right links for signed-in vs anonymous; `FloatingCart` still renders.
- Closing report at `backend/src/features/archetype_rename_balanced/CLOSING_REPORT_FOLLOWUP_1.md`: Task 0 results (including the split-spelling grep), the B3 reader list and what you did with the `users/{uid}` write, screenshots or a description of the dial at the narrowest breakpoint, and anything else in Firestore you noticed storing an archetype display name (list only; do not change).
