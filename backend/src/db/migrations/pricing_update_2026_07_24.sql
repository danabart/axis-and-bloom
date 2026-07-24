-- Pricing update — 2026-07-24
-- Decision (Dana, 2026-07-24): 12oz bag $38.00 -> $32.00; 5lb (80oz) $199.00 -> $185.00.
-- Safe to run multiple times (ON CONFLICT DO NOTHING — a seed, not a forced overwrite;
-- won't clobber a price an admin has since edited via the slot-price/coffee-price matrix).
-- Run in Cloud SQL Studio: axis-and-bloom-prod -> axisandbloom database.
--
-- AUDIT FINDING (2026-07-24): dial_slot_price and coffee_retail_price were both
-- completely empty in production before this migration — every price shown anywhere
-- on the site was coming from the BLOOM_DEFAULT_PRICE_CENTS fallback constant in
-- backend/src/routes/coffees.ts (updated separately, same commit, to 3200/18500 cents).
-- This migration seeds real, explicit rows for every currently-active slot/coffee so
-- the price is queryable and editable from the admin matrix going forward, rather than
-- silently living only in a code constant.

-- ─── Bloom Dial slots (archetype + dial_sort_order) ────────────────────────────
-- One row per currently-active, non-guest slot x each of the two sizes.

INSERT INTO dial_slot_price (archetype, dial_sort_order, weight_oz, retail_price_cents)
SELECT DISTINCT dap.archetype, dpv.sort_order, w.weight_oz, w.retail_price_cents
FROM dial_archetype_positions dap
JOIN dial_position_vocabulary dpv ON dpv.id = dap.vocabulary_id
CROSS JOIN (VALUES (12, 3200), (80, 18500)) AS w(weight_oz, retail_price_cents)
WHERE dap.is_guest = false
ON CONFLICT (archetype, dial_sort_order, weight_oz) DO NOTHING;

-- ─── "Other category" coffees (no dial position — Decaf/Half-Caf/Flavored/Experimental) ──
-- One row per coffee with no non-guest dial position x each of the two sizes.

INSERT INTO coffee_retail_price (coffee_id, weight_oz, retail_price_cents)
SELECT c.id, w.weight_oz, w.retail_price_cents
FROM coffees c
LEFT JOIN dial_archetype_positions dap ON dap.coffee_id = c.id AND dap.is_guest = false
CROSS JOIN (VALUES (12, 3200), (80, 18500)) AS w(weight_oz, retail_price_cents)
WHERE dap.id IS NULL
ON CONFLICT (coffee_id, weight_oz) DO NOTHING;

-- ─── Verify ───────────────────────────────────────────────────────────────────

SELECT 'dial_slot_price rows'    AS item, COUNT(*)::text AS value FROM dial_slot_price
UNION ALL
SELECT 'dial_slot_price @ $32/12oz', COUNT(*)::text FROM dial_slot_price WHERE weight_oz = 12 AND retail_price_cents = 3200
UNION ALL
SELECT 'dial_slot_price @ $185/80oz', COUNT(*)::text FROM dial_slot_price WHERE weight_oz = 80 AND retail_price_cents = 18500
UNION ALL
SELECT 'coffee_retail_price rows', COUNT(*)::text FROM coffee_retail_price
UNION ALL
SELECT 'coffee_retail_price @ $32/12oz', COUNT(*)::text FROM coffee_retail_price WHERE weight_oz = 12 AND retail_price_cents = 3200
UNION ALL
SELECT 'coffee_retail_price @ $185/80oz', COUNT(*)::text FROM coffee_retail_price WHERE weight_oz = 80 AND retail_price_cents = 18500;
