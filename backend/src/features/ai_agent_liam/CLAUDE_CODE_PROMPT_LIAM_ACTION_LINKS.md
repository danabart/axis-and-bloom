# Liam action links — advisory escape hatches for "change my archetype / change my coffee"

**Date:** 2026-07-18
**Prerequisite:** Profile Part 1 (`profile_page/CLAUDE_CODE_PROMPT_PROFILE_PART1_FLAVOR_MEMORY_AND_LAYOUT.md`) executed — its `?retake=1` param on `/find-my-flavor` is the retake link's target. Verify before starting.

**Scope:** `frontend/src/app/components/BloomPage.tsx` (Phase A), the Sommelier chat backend (`sommelier.ts` route / `claude.ts` assembly — Phase B), `Sommelier.tsx` (Phase C). Liam's system is walled off from casual edits — `SOMMELIER_TASK_6_VOICE.md` is binding for any prompt-copy changes; touch nothing beyond what this spec names.

---

## Why (decision context)

Verified 2026-07-18: three of Liam's six intents (`PROFILE_AMBIGUOUS`, `TASTE_EVOLUTION`, `RECOMMENDATION_MISS`) exist precisely for "my archetype feels wrong / this coffee isn't working" conversations — but Liam has no write path anywhere, so when a user says "so change it," he can only talk.

**Dana's decision: Liam stays advisory — archetype changes remain quiz-only** (the signal stack depends on it: `taste_journey` triggers on quiz saves, `behavioralConfidence.quizStability`, the `TASTE_EVOLUTION` trigger itself). Instead, Liam's replies gain **action links** at the moments the conversation naturally reaches them: "retake the quiz" and "open your dial on The Bloom." No writes from chat. A direct dial-write tool was considered and deferred, not rejected — do not build it here.

## Phase A — Bloom honors `?archetype=&slot=` deep links

Known flagged gap (Flavor Intelligence Part 10 and the FI feature memory both record it): `BloomPage.tsx` has no `useSearchParams` — FI's existing "Shop on The Bloom →" link already emits `/bloom?archetype={id}&slot={n}` and currently lands on the default view.

On mount with valid params: scroll to that archetype's section (sections already carry `id={data.archetype}` via `ArchetypeSection`) and set its dial to the given slot (the existing per-archetype selection state + `registerDialRef`/`rotateTo` machinery — consume it, don't add parallel state). Invalid/unknown params = plain default view, no error. This phase fixes FI's existing link for free — note that in your summary and test it.

## Phase B — action markers in the chat contract

Mechanism: Liam's prompt instructs him to append a marker token when — and only when — the conversation has actually arrived at the recommendation (not preemptively, not in openings):

- `<<action:retake_quiz>>` — when he's concluded a retake is the right move (archetype doubt, taste drift)
- `<<action:open_dial>>` — when he's suggesting a different position/coffee within their archetype

Backend (`chatWithSommelier` response path): strip markers from the text before it reaches the client; return alongside it `actions: [{ type: 'retake_quiz' } | { type: 'open_dial', archetype, slot? }]`. For `open_dial`, resolve the user's archetype server-side (already available in session context) and their saved dial slot if any — never trust the LLM to emit ids. Unknown/malformed markers: strip silently, no action. Additive response change — existing clients ignoring `actions` keep working.

Where the prompt instruction lives: read the seeded `config/sommelier` structure and `SOMMELIER_TASK_6_VOICE.md` first, then decide base-prompt vs per-intent addendum (the three intents above at minimum; `EXPLORATION` may also warrant `open_dial`). Keep the instruction copy in Liam's voice-doc register. Remember intent addendums are Firestore-config, admin-editable — if you change seeded addendum text, state clearly in your summary that already-deployed Firestore config needs the same edit applied via the admin portal (a seed change alone won't touch the live doc).

## Phase C — render action chips in `Sommelier.tsx`

Below a Liam message that carried actions: small chip-style links matching the thread's existing quiet visual language (no buttons shouting inside the prose thread — see the thread-layout conventions):

- `retake_quiz` → "Retake the quiz →" linking `/find-my-flavor?retake=1`
- `open_dial` → "Open your dial →" linking `/bloom?archetype={archetype}&slot={slot}` (omit `slot` param if none)

Chips are links, not chat inputs — clicking navigates away; no confirmation round-trip in chat.

## Guardrails (restating, binding)

- No write of archetype, dial position, or any user state from the chat path. Links navigate; the user acts on the destination page.
- No new intents; no changes to intent selection/priority, token/turn logic, or model routing.
- `RECOMMENDATION_SYSTEM_PROMPT`'s stale "Spicy & Earthy" line remains out of scope (separately flagged).

## Testing

1. Builds clean (frontend + backend).
2. Phase A: `/bloom?archetype=floral&slot=3` scrolls to Floral with the dial on slot 3; FI's "Shop on The Bloom →" now lands correctly; garbage params → default view.
3. Phase B: simulated chats where Liam recommends a retake / a bolder position produce stripped text + correct `actions`; a chat that never reaches a recommendation produces none (verify he doesn't spam the marker in greetings — test an `EXPLORATION` opening).
4. Phase C: chips render under the right message, navigate correctly (retake lands directly in the quiz per Part 1's param; dial link lands per Phase A), and are absent otherwise.
5. Mobile: chips wrap cleanly in the thread on 390px.

In your summary: where the marker instruction ended up (base vs addendums), the exact instruction copy for Dana's voice sign-off, and whether live Firestore config needs a manual admin-portal edit.
