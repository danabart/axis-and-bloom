-- Colombia/Guatemala data fix — 2026-08-26 (roastery soft-deactivation, CTO review round)
--
-- STATUS: Proposed, awaiting Dana's explicit approval. NOT run by Claude Code,
-- NOT auto-applied by schema.sql/index.ts (this file is a standalone script,
-- same convention as claude_daily_spend_feature_2026_08_10.sql and
-- beat_event_respond_token_2026_08_09.sql) — run manually, by Dana, via Cloud
-- SQL Studio, only after reading and approving every statement below.
--
-- CONTEXT: Task 0's multi-roaster check (WHAT_WE_BUILT.md #170) surfaced two
-- coffees named "Colombia" (one per roaster) sharing coffee id 7 by accident
-- — the pre-existing `roaster_blend.coffee_id` name-match backfill in
-- schema.sql joined on blend_name alone, and with two coffees both named
-- "Colombia" the join was ambiguous; an unqualified multi-match UPDATE...FROM
-- just picked one arbitrary row (coffee 7, Path's Colombia) for BOTH
-- roasters' Colombia rows. That backfill is now tightened (schema.sql,
-- ~L404, also requires rb.roaster_id = c.roaster_id) so this can't recur —
-- this file is the one-time fix for the damage already in prod. Separately,
-- coffees 19 and 33 are both "Guatemala" from Temecula — 19 is the real,
-- fully-populated one (2 blends, 1 alias, 2 dial positions incl. a default,
-- a live archetype assignment); 33 is a completely empty duplicate stub,
-- nothing anywhere references it (confirmed by direct query, not assumed).
--
-- Verified BEFORE writing this file (read-only, against prod): coffee_alias,
-- dial_archetype_positions, roastery_coffee_descriptors, cupping_session_coffees,
-- and archetype_assignments were checked for both coffee 7 and coffee 20 —
-- every row already sits correctly on its own coffee (Path's on 7, Temecula's
-- on 20). Nothing else of Temecula's landed on 7; only the two roaster_blend
-- rows need repointing. (Aside, not part of this fix: coffee 20's one
-- coffee_alias row claims dial_sort_order=3, but coffee 20's actual dial_
-- archetype_positions home row is sort_order=4 — a separate, pre-existing,
-- harmless staleness in coffee_alias's own legacy archetype/dial_sort_order
-- fallback columns; resolveBlendForSlot's COALESCE already prefers the real
-- dial_archetype_positions row over it, so this doesn't affect fulfillment.
-- Flagged for awareness, not touched by this fix.)
--
-- ── DEPLOY / RUN ORDER — read before running anything ──────────────────────
-- 1. Deploy the code for WHAT_WE_BUILT.md #170 (schema.sql's Part A columns —
--    coffees.is_active/roaster_id/deactivated_at/deactivation_reason and the
--    matching roaster_blend/coffee_alias columns — must exist for the UPDATEs
--    below to run at all).
-- 2. Confirm via the [roastery-lifecycle] startup warnings (index.ts) that no
--    OTHER roaster_id mismatches turned up beyond the ones already known here.
-- 3. Run Steps 1–2 below, in order, against prod (Cloud SQL Studio).
-- 4. Run the verify queries at the bottom — confirm both return the expected
--    row counts before moving on.
-- 5. Only THEN will `coffees_active_natural_key` (schema.sql, the partial
--    unique index on (roaster_id, lower(trim(name))) WHERE is_active = true)
--    successfully create — it's wrapped in DO/EXCEPTION so a still-live
--    conflict at deploy time doesn't abort the rest of schema.sql (see that
--    file's own comment), but it will keep logging a
--    "[roastery-lifecycle] coffees_active_natural_key NOT created" warning at
--    every boot until this file has been run. The next boot after Step 3
--    creates it cleanly, no redeploy needed.
--
-- Both steps are UPDATEs, never a DELETE — nothing here removes a row.

-- ── STEP 1 — repoint Temecula's two Colombia roaster_blend rows onto coffee 20 ──
-- Coffee 7 (Path's Colombia) keeps its own two Path rows untouched; only the
-- two rows whose roaster_id is Temecula's move.
UPDATE roaster_blend
SET coffee_id = 20
WHERE coffee_id = 7
  AND roaster_id = (SELECT id FROM roaster WHERE name = 'Temecula Coffee Roasters');
-- Expect: UPDATE 2

-- ── STEP 2 — mark the empty Guatemala duplicate (coffee 33) inactive ───────
UPDATE coffees
SET is_active = false, deactivation_reason = 'manual', deactivated_at = now()
WHERE id = 33;
-- Expect: UPDATE 1

-- ── Verify (run after both steps) ───────────────────────────────────────────
-- SELECT id, roaster_id, coffee_id, roaster_sku FROM roaster_blend WHERE blend_name = 'Colombia' ORDER BY roaster_id, coffee_id;
--   Expect: the two Path rows still on coffee_id = 7; the two Temecula rows now on coffee_id = 20.
-- SELECT id, name, is_active, deactivation_reason, deactivated_at FROM coffees WHERE id IN (7, 19, 20, 33) ORDER BY id;
--   Expect: 7, 19, 20 all is_active = true, deactivation_reason NULL; 33 is_active = false, deactivation_reason = 'manual', deactivated_at set.
-- SELECT roaster_id, lower(trim(name)) AS norm_name, COUNT(*) FROM coffees WHERE is_active = true GROUP BY roaster_id, lower(trim(name)) HAVING COUNT(*) > 1;
--   Expect: zero rows — no more active-coffee duplicates left for coffees_active_natural_key to reject.
