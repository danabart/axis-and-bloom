# Liam SMS feedback — add the dial-direction question (channel parity with on-site v2)

**Date:** 2026-07-18
**Prerequisite:** Profile Part 2 (`profile_page/CLAUDE_CODE_PROMPT_PROFILE_PART2_BACKEND_FLAVOR_MEMORY_AND_FEEDBACK_V2.md`) must be executed first — this task reuses the `expectation → dial_position_signal` write logic it creates. Verify before starting.

**Scope:** `backend/src/services/liamSmsFeedback.ts` (+ shared signal-writing helper from Part 2 if it was factored into a service). This touches Liam's SMS system, which is deliberately walled off from casual edits — treat `SOMMELIER_TASK_6_VOICE.md` as binding for any copy changes, and change nothing beyond what this spec names.

---

## Why

Dana decided (2026-07-18) that both feedback channels should ask the same closed dial-direction question, so `sms_feedback` and `onsite_feedback` populate `dial_position_signal` identically — this is what `BLOOM_DIAL_ALLOCATION_SPEC.md` §3 Stage 2 envisioned, and `dial_source_weight` already seeds `sms_feedback = 1`. Today the SMS asks only an open "how are you finding the {coffee}?" and Haiku-parses the reply into rating/sentiment/descriptors; the dial dimension is never asked, so the SMS channel can't feed the dial loop.

## Changes

1. **Outbound copy** (`schedulePostDeliveryMessage`): extend the message to also ask the dial question in Liam's voice — e.g. "…was it lighter or bolder than you expected?" appended to the existing question. Constraints: stay within the existing 160-char primary/fallback pattern (both variants get the question; if 160 is impossible with the name + blend name, the fallback may shorten the greeting, not drop the question). Voice per `SOMMELIER_TASK_6_VOICE.md` — warm, no jargon; "lighter or bolder" is customer language for the dominant dimension, deliberately not naming the dimension.
2. **Reply parsing**: extend the existing Haiku parse to also extract `expectation: 'lighter' | 'as_expected' | 'bolder' | null` from the free-text reply (null when the reply doesn't address it — never guess). Additive change to the parsing prompt/schema; existing extracted fields unchanged.
3. **Signal write**: when `expectation` is `lighter`/`bolder`, write the same `dial_position_signal` row Part 2 writes for on-site — same coffee/archetype/dominant-dimension resolution, `source = 'sms_feedback'`, `direction = 'less'`/`'more'`. **Reuse Part 2's writer function — do not duplicate the resolution logic.** If Part 2 inlined it in the route, extract it to a shared service as part of this task and have both call it. `as_expected`/null → no signal row (same rule as on-site).
4. **`feedback_events` doc**: include the parsed `expectation` field, same as on-site v2, keeping the two channels' docs interchangeable for every downstream consumer.

## Out of scope — explicitly

- `RECOMMENDATION_SYSTEM_PROMPT` in `claude.ts` (separate flagged item — still says "Spicy & Earthy"; not this task).
- Any change to scheduling rules (orders 1–2 only, 10-day delay, idempotency), opt-in logic, or the never-ask-twice invariant.
- Descriptor chips have no SMS equivalent (chips don't work over text) — descriptor extraction stays as the existing Haiku parse.

## Testing

1. `tsc --noEmit` clean.
2. Outbound body ≤160 chars with a realistic long name + long blend name; question present in both primary and fallback variants.
3. Simulated inbound replies: "loved it, way bolder than I expected" → rating/sentiment as before + `expectation: 'bolder'` + one `sms_feedback` row in `dial_position_signal`; "it was nice" → `expectation: null`, no signal row; "a bit weak honestly" → `'lighter'` + `direction = 'less'`.
4. `v_dial_position_consensus` shows the sms row weighted per `dial_source_weight`.
5. Regression: a reply processed end-to-end still updates `behavioralConfidence` and lifecycle state as today.

In your summary: the final outbound copy (both variants) for Dana's sign-off, and where the shared signal writer ended up.
