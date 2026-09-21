# Closing report — Archetype rename follow-up 1

Brief: `CLAUDE_CODE_PROMPT_ARCHETYPE_RENAME_FOLLOWUP_1.md`. Build-log entry: `WHAT_WE_BUILT.md` **#189** (the brief's natural number #188 was already taken by commit `146e6fd`, the reporting view). **Nothing committed.** Every local boot/test/browser check ran against `axisandbloom_test` via `DATABASE_URL` override, never `.env`'s prod URL.

## 1. Task 0 — confirmed vs deviated

| Item | Result |
|---|---|
| HEAD | `146e6fd` (descendant of `5028c7d`); tree clean apart from your two modified docs (`OPEN_TASKS.md`, `12_G1_payment_capture_PLACEHOLDER.md`) and untracked feature docs. Confirmed. |
| `NAME_LINES` | Confirmed at `archetypeConfig.ts` L58–65; `config.nameLines` consumed at `BloomDial.tsx` L655/L667. |
| `quiz.ts` taste_journey write | Confirmed: `isSame` compared display strings; `newEntry.archetype`/`currentArchetype` store the display name; `users/{uid}` write used `archetype.toLowerCase()` + `archetypeLabel`. |
| `users.ts` `/flavor-memory` | Confirmed: `archetype: await archetypeCode(h.archetype)`, `archetypeLabel: h.archetype` (raw stored string). Synthetic fallback (~L768) already correct (built from the FK join). **Other `journey[]` consumers:** only `quizActivity` (same `archetypeLabel`) and the returned `journey`. `evolutionCount` / `currentStreakCount` are written but **read nowhere** in backend or frontend; nothing else surfaces them. |
| `QuizHeader` | Confirmed (0.52 rem / .6, 0.50 rem / .40, 0.50 rem / .45). Results screen order confirmed; `FloatingCart` still last. |
| `RevealedPanel` | `QUIET_LINK_CLASS` confirmed at L31 but it was **not exported** — I exported it rather than duplicate the string (one-word change). |
| Split-spelling grep | `grep -rniE "'& ?SWEET'|\"& ?SWEET\"|BALANCED',\s*'&"` over `frontend/src` + `backend/src`: **exactly one hit, `archetypeConfig.ts:61`**, now fixed. No other split/spaced spelling. |
| Dial fit logic (Part A check) | `BloomDial.fitLines()` sizes each `.bd-nline` to the column width independently (cap 72/56, floor 30). Nothing keys on line count, so no other change needed. L112 fallback and L114 comment already read correctly after the rename ("terracotta on the mustard Balanced field"); left as is. |

Deviations (none blocking): the two above, plus two implementation choices below.

## 2. What changed

- **Part A**: `NAME_LINES.balanced_sweet` → `['BALANCED']`.
- **Part B**: new `services/tasteJourney.ts` with `mapJourneyHistory()` (B1) and `isSameArchetype()` (B2). *Deviation from the brief's inline sketch:* I extracted both into a small service file instead of inlining, because the `/flavor-memory` handler is a ~250-line multi-query route that can't be unit-tested without mocking most of it; the extracted helpers are exactly the logic the brief describes, tested against the real (test) archetype rows. `routes/users.ts` calls `mapJourneyHistory`; `routes/quiz.ts` resolves `newCode = await archetypeCode(archetype)` once and compares by code. New docs also carry `archetypeCode` (per history entry) and `currentArchetypeCode` (doc). Display names still stored; no existing document rewritten.
- **B3 — `users/{uid}` write.** Reader search: backend has **no reader** of `users/{uid}.archetype` / `.archetypeLabel` (the only `users/{uid}` doc accesses are writes: `quiz.ts`, and `tokenBalance` in `orders.ts`; everything else is subcollections). Frontend imports Firestore only to initialise it in `lib/firebase.ts`; nothing reads a doc. So the write is now `archetype: newCode ?? archetype.toLowerCase()`; `archetypeLabel` stays the display name.
- **Part C**: header wordmark, `SAVE PROGRESS` and `EXIT ×` use `QUIET_LINK_CLASS` (`EXIT ×` behaviour unchanged, `navigate('/')`). Action row `<nav>` after the adjacent `DialArchetypeSection`, inside the same 760 px column, `mt-14`; signed-in non-anonymous: `Your flavor profile →` + `Back to home →`; anonymous: `Back to home →`.
- Housekeeping: `routes/quiz.ts` had two stray CRLF line endings left over from my earlier sed in the rename commit (the file is LF); normalised to LF while editing it.

## 3. Verification

| Check | Result |
|---|---|
| `npm run lint:catalog` | exit 0 |
| Backend `tsc` / `npm run build`, frontend `vite build` | clean |
| `npm test` | **12 failed / 354 passed (366)** — the identical 12 pre-existing tie-break failures (6 `src/services/quizScoring.test.ts` + 6 stale `dist/` copy), nothing new. New `tasteJourney.test.ts`: 5 cases green (retired-name entry → `balanced_sweet` / `Balanced`; current-name entry; unknown name passes through; retake against retired-name history counts as same; false cases). |
| Bloom dial, `balanced_sweet` (local, test DB) | DOM: the Balanced dial's name block contains **one** `.bd-nline` (`BALANCED`, 56 px, ~53 px tall = single line) alongside `CHOCOLATE` + `& NUTTY` (two lines). Screenshot of `/bloom?archetype=balanced_sweet` shows the left heading "BALANCED" on one line and the coffee heading "Classic Balanced". |
| Header legibility | Computed styles on the live quiz screen for all three controls: 10.5 px, .14em tracking (1.47 px), opacity .85, `#9a2918`, uppercase, no underline (was ~8 px at .4–.6 opacity). |
| Narrowest breakpoint | **Not visually captured.** The browser tool reported a scaled viewport (2195 px inner width) and `resize_window` to 390 px did not take effect, then a screenshot timed out. By construction `BALANCED` is a single `nowrap` word sized by `fitLines()` to the column width with a 30 px floor, so it cannot wrap; please eyeball it on a phone once. |
| Result screen: action row, `FloatingCart` | **Not exercised in a browser.** The row renders only in the unlocked branch (signed-in, or anonymous after the email gate); reaching it means signing in against prod Firebase or submitting the email gate, both real form submissions I did not do without your say-so. Verified by build/typecheck and the code path only. **Please check once:** signed-in result screen shows both links; anonymous-after-gate shows only `Back to home →`; `FloatingCart` still present. Note the locked anonymous state (before the gate) still shows only the gate, as before. |
| `/api/users/flavor-memory` fixture + retake counters | **Not run end-to-end** (authed route + Firestore, no emulator, and I won't write to prod Firestore). Covered at unit level: `mapJourneyHistory` returns `archetypeLabel: 'Balanced'` for a "Balanced & Sweet" entry, and `isSameArchetype` is true for retired-name-vs-current, which is the only input to the `evolutionCount`/`currentStreakCount` branch (arithmetic in `quiz.ts` unchanged: same → streak+1, evolution unchanged). |

## 4. Other Firestore places that store an archetype display name (list only, unchanged)

- `users/{uid}/quiz_sessions/{id}`: `archetype`, `secondaryArchetype`, `branchedFrom` (display names, written verbatim from the request; nothing reads them back that I found).
- `users/{uid}`: `archetypeLabel` (display name; unread).
- `users/{uid}/metadata/taste_journey`: `currentArchetype` and every `archetypeHistory[].archetype` (display names; now read through the code). Existing docs keep "Balanced & Sweet" strings and will for as long as they exist; the read path handles them.
- Not exhaustively audited: `sommelier_sessions/*` context docs. `dial_events` use enum codes (`sommelier.ts` keys on `d.archetype` as a code), so they are unaffected.
- `quiz_session.context_data` (Postgres jsonb, from #187's list) remains the analogous history there.

## 5. Files changed

`backend/src/services/tasteJourney.ts` (new), `backend/src/services/tasteJourney.test.ts` (new), `backend/src/routes/users.ts`, `backend/src/routes/quiz.ts`, `frontend/src/app/components/FlavorQuiz.tsx`, `frontend/src/app/components/bloom/RevealedPanel.tsx` (export only), `frontend/src/app/components/bloom/dial/archetypeConfig.ts`, `WHAT_WE_BUILT.md` (#189), this report.
