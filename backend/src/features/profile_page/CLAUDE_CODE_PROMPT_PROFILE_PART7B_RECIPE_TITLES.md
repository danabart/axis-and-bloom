# Profile Part 7B — meaningful Liam recipe titles

**Date:** 2026-08-02
**Prerequisite:** Profile Part 7 executed (activity log, `save_recipe` marker, liam-saves endpoint). Small follow-up fix; nothing else from Part 7 changes.

**Scope:** `backend/src/services/claude.ts` (marker instruction + parsing), `backend/src/routes/sommelier.ts` (action shape), `frontend/src/app/components/Sommelier.tsx` (chip title). Liam's walls stand: `SOMMELIER_TASK_6_VOICE.md` binding, no other prompt edits, no intent/routing/token changes.

---

## Why

Verified 2026-08-02: the saved-recipe title is `deriveRecipeTitle` in `Sommelier.tsx` — first non-empty line of Liam's message, truncated to 60 chars, fallback `'Recipe'`. Liam's replies typically open conversationally, so a user who asks for several recipes gets a journal full of near-identical, meaningless titles. The only party who knows what the recipe *is* is Liam — so he supplies the title in the marker.

## Task 1 — titled marker

**Prompt (`claude.ts`, the existing save_recipe bullet — replace with this copy, pending Dana's voice sign-off; note it in your summary if you adjust a word):**

> - If the reply you just wrote is a preparation recipe or brew guide the customer actually asked for — not a passing mention of brewing — end your reply with `<<action:save_recipe:short title>>` the same way, where the short title is two to six plain words naming the method and, when you know it, the coffee — like `V60 for Cerro Azul` or `Cold brew, overnight jar`. Never preemptively, never on a greeting or general chat.

The "at most one marker / never in an opening turn" bullet stays as is.

**Parsing (`claude.ts`):** the current exact-string `includes('<<action:save_recipe>>')` check becomes a regex accepting both forms — `<<action:save_recipe>>` (legacy/bare) and `<<action:save_recipe:Title>>`. Strip the whole marker from the reply text in both cases. Sanitize the captured title server-side: trim, collapse internal whitespace, strip `<`/`>` and markdown emphasis characters, cap at 60 chars; empty-after-sanitize = treat as bare marker. Carry the optional title through the action-types plumbing to `sommelier.ts`, which returns `{ type: 'save_recipe', title?: string }`. Additive response change; clients ignoring `title` keep working.

**Guardrail framing (unchanged in spirit):** the title is display text the server sanitizes and length-caps — never an id, never resolved against anything. The existing "never trust the LLM to emit ids" rule stands untouched.

## Task 2 — chip uses the supplied title

`Sommelier.tsx`: when the action carries a `title`, POST that to `/api/users/flavor-memory/liam-saves`; `deriveRecipeTitle(content)` remains only as the fallback for a bare marker. No change to the endpoint (it already length-validates and stores what it's given). No change to the ActivityTimeline — it already renders whatever title was stored.

Old entries saved before this fix keep their old titles; no migration, not worth one.

## Check while you're in there

Part 7's summary recorded where the marker instruction landed. Verified now: it lives in code (`claude.ts` base prompt, not Firestore-seeded intent addendums) — if that's still true, no admin-portal edit is needed; if any copy of the instruction was also seeded into `sommelier_config_seed.ts` / live config, apply the same edit there and say so in your summary.

## Testing

1. Frontend + backend build clean.
2. Ask Liam for two different recipes (e.g. a V60 for one coffee, a cold brew for another): two chips, two distinct meaningful titles, both saved entries distinguishable in the profile log.
3. Bare `<<action:save_recipe>>` (simulate) still works via the first-line fallback.
4. Sanitization: a title containing `>>`, markdown, or 200 chars comes out clean and capped; empty title falls back.
5. Marker text never leaks into the rendered chat reply in either form.
6. Greeting/general chat still produces no marker (regression on the prompt edit).

In your summary: the exact final instruction copy (for Dana's voice sign-off) and whether live Firestore config needed the mirrored edit.
