# Profile Part 4 — account fixes: phone number UI in Settings

**Date:** 2026-07-18 (revised same day: the dial-save whisper originally in this prompt was **removed** — superseded by the explicit "Save to my flavor memory" design in `ai_agent_liam/CLAUDE_CODE_PROMPT_LIAM_DIAL_EVENT_LOG.md`. This part is now the phone fix only. If you are reading a checked-out copy that still contains a whisper section, this version supersedes it.)

**Prerequisite:** Profile Part 1 landed (Settings tab lives in the new shell). Verify in code.

**Scope:** closes gap 1 from `PROFILE_DATA_OWNERSHIP_AND_USE_CASES.md` (update that doc's gap list as part of this task). Gap 3 (dial-save visibility) is handled by the dial event log prompt, not here.

---

## Phone number add/edit in Settings

**Problem:** Settings' SMS toggle says "Add a phone number to enable this," but no UI anywhere lets a user add one — phone numbers only enter via checkout (`user_phone` table: `phone_number`, `sms_opt_in`, `is_primary` per user). A customer who hasn't ordered can never enable Liam's SMS check-ins.

**Build:**

1. **Backend:** extend the existing profile update path (`PATCH /api/users/profile` in `users.ts` — it already UPDATEs `user_phone` for `smsOptIn`) to accept an optional `phoneNumber`. Upsert the user's `is_primary = true` row in `user_phone` (create if none, update if exists — find and reuse checkout's phone-creation/validation logic rather than inventing a second normalization). Server-side validation: digits/`+`/spaces/dashes accepted, normalized before storing, clearly-invalid input → 400 with a usable message. Extend `GET /profile` to also return the primary phone number (full is fine — user's own data on an authed route).
2. **Frontend (Settings tab, Notifications block):** when `hasPhone` is false — a phone input + save control replacing the dead-end "Add a phone number to enable this" line; on success the SMS toggle enables immediately (no reload). When a phone exists — show it with a quiet "Change" affordance using the same input. Match the tab's existing form styling (labelClass/inputClass conventions). Changing the number must NOT silently flip `smsOptIn` on — opt-in stays its own explicit toggle.

## Testing

1. Builds clean (frontend + backend).
2. No-phone account adds a number → toggle enables without reload, row lands in `user_phone` with `is_primary = true`, `smsOptIn` still off until toggled.
3. Existing-phone account sees and changes its number; `smsOptIn` unchanged by the edit.
4. Garbage input → clear 400, nothing written.
5. Checkout's own phone flow still works untouched; Liam SMS scheduling picks up a Settings-added phone (opted-in) like any other.
