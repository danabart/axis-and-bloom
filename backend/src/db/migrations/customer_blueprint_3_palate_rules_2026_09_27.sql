-- Customer Blueprint · brief C3, Part D — palate read v1 rules from Dana's
-- fixture review — 2026-09-27
-- MIRROR, not a standalone migration to run: this is a redundant paper-trail
-- copy of the block schema.sql applies automatically on every backend boot
-- (backend/src/index.ts, `await db.query(schema)` through ownerPool()). Same
-- convention as customer_blueprint_1_2026_09_27.sql in this directory.
-- Running this file by hand against a database that already booted with the
-- updated schema.sql is a safe no-op — v_palate_shared_traits is
-- CREATE OR REPLACE VIEW; v_palate_slot_candidates is a plain DROP VIEW IF
-- EXISTS + CREATE VIEW (CREATE OR REPLACE VIEW cannot reorder/rename an
-- existing view's columns, which rule 6 does — hit for real in production,
-- see schema.sql's own comment above this view).
--
-- Scope: only the two views Dana's six-rule review changed. Everything else
-- Parts A-C added (the other v_customer_*/v_palate_* views, user_saved_item,
-- sommelier_evaluation, the dead-table drops) shipped in an earlier C3 pass
-- and is not repeated here.
--
-- Rules (recorded in full on palate_read_fixture_v1.xlsx's notes sheet,
-- "DECISIONS (Dana, 2026-09-27)" block, and in each view's own comment below):
--   1. Disliked bags (feedback rating <= 2) never shape a customer's shared
--      traits or slot candidates; a slot whose own coffee was rated <= 2 is
--      excluded outright. v_palate_dominant_dimensions' liked/disliked split
--      is unchanged.
--   2. v_palate_slot_candidates gains already_bought/last_rating (informational
--      columns; they never affect ordering).
--   3. Only dimensions where the customer's own shared-trait row has
--      overlaps = true are comparable; zero comparable dimensions falls
--      through to in_pair as the tiebreak.
--   4. Deterministic tiebreak: ORDER BY ends with slot sort_order, slot id.
--   5. read_version stays 'v1' (not applied here — no code change; these
--      rules define v1, they don't revise it). order_kind filtering is the
--      first named v2 item (OPEN_TASKS.md OT-25).
--   6. n_dims_disliked_overlap: dimensions where a slot's coffee range
--      overlaps ANY range of a coffee the customer rated <= 2 — pushes
--      disliked-adjacent slots down rather than just excluding the disliked
--      coffee itself. A customer with disliked-only bags but a quiz still
--      gets ranked candidates via the quiz-pair fallback.
-- See backend/src/features/customer_blueprint/CLAUDE_CODE_PROMPT_CUSTOMER_3_VIEWS_AND_RETIREMENTS.md.

CREATE OR REPLACE VIEW v_palate_shared_traits AS
WITH attributed_coffees AS (
  SELECT DISTINCT vci_i.canonical_user_id, vba.coffee_id
  FROM v_customer_bag_attribution vba
  JOIN v_customer_identity vci_i ON vci_i.user_id = vba.drinker_user_id
  LEFT JOIN v_customer_feedback_current vfc
    ON vfc.order_line_item_id = vba.order_line_item_id AND vfc.canonical_user_id = vci_i.canonical_user_id
  WHERE vba.attribution <> 'unattributed' AND (vfc.rating IS NULL OR vfc.rating >= 3)
),
dim AS (
  SELECT ac.canonical_user_id, 'dimension'::text AS kind, cdr.dimension_id::text AS trait_key, cdr.dimension_name AS trait_label,
    MAX(cdr.value_min) AS value_min, MIN(cdr.value_max) AS value_max, COUNT(*) AS n_coffees
  FROM attributed_coffees ac
  JOIN v_coffee_dimension_range cdr ON cdr.coffee_id = ac.coffee_id
  GROUP BY ac.canonical_user_id, cdr.dimension_id, cdr.dimension_name
),
total_coffees AS (
  SELECT canonical_user_id, COUNT(*) AS n_total FROM attributed_coffees GROUP BY canonical_user_id
),
desc_agg AS (
  SELECT ac.canonical_user_id, 'descriptor'::text AS kind, vcd.descriptor AS trait_key, vcd.descriptor AS trait_label,
    NULL::numeric AS value_min, NULL::numeric AS value_max, COUNT(DISTINCT ac.coffee_id) AS n_coffees
  FROM attributed_coffees ac
  JOIN v_coffee_descriptor vcd ON vcd.coffee_id = ac.coffee_id
  GROUP BY ac.canonical_user_id, vcd.descriptor
)
SELECT canonical_user_id, kind, trait_key, trait_label, value_min, value_max,
       (value_min IS NOT NULL AND value_max IS NOT NULL AND value_min <= value_max) AS overlaps, n_coffees
FROM dim
UNION ALL
SELECT d.canonical_user_id, d.kind, d.trait_key, d.trait_label, d.value_min, d.value_max, NULL::boolean AS overlaps, d.n_coffees
FROM desc_agg d
JOIN total_coffees t ON t.canonical_user_id = d.canonical_user_id AND d.n_coffees = t.n_total;

DROP VIEW IF EXISTS v_palate_slot_candidates;
CREATE VIEW v_palate_slot_candidates AS
WITH traits AS (
  SELECT canonical_user_id, trait_key::int AS dimension_id, value_min, value_max
  FROM v_palate_shared_traits WHERE kind = 'dimension' AND "overlaps" = true
),
customers_with_dimension_rows AS (
  SELECT DISTINCT canonical_user_id FROM v_palate_shared_traits WHERE kind = 'dimension'
),
disliked_coffees AS (
  SELECT DISTINCT vci_i.canonical_user_id, vba.coffee_id
  FROM v_customer_bag_attribution vba
  JOIN v_customer_identity vci_i ON vci_i.user_id = vba.drinker_user_id
  JOIN v_customer_feedback_current vfc
    ON vfc.order_line_item_id = vba.order_line_item_id AND vfc.canonical_user_id = vci_i.canonical_user_id
  WHERE vba.attribution <> 'unattributed' AND vfc.rating <= 2
),
disliked_ranges AS (
  SELECT dc.canonical_user_id, cdr.dimension_id, cdr.value_min, cdr.value_max
  FROM disliked_coffees dc
  JOIN v_coffee_dimension_range cdr ON cdr.coffee_id = dc.coffee_id
),
customers_disliked_only AS (
  SELECT DISTINCT dc.canonical_user_id
  FROM disliked_coffees dc
  JOIN v_customer_quiz_current qc ON qc.canonical_user_id = dc.canonical_user_id
  WHERE dc.canonical_user_id NOT IN (SELECT canonical_user_id FROM customers_with_dimension_rows)
),
eligible_customers AS (
  SELECT canonical_user_id FROM customers_with_dimension_rows
  UNION
  SELECT canonical_user_id FROM customers_disliked_only
),
already_bought AS (
  SELECT DISTINCT vci_i.canonical_user_id, vba.coffee_id
  FROM v_customer_bag_attribution vba
  JOIN v_customer_identity vci_i ON vci_i.user_id = vba.drinker_user_id
  WHERE vba.attribution <> 'unattributed'
),
last_feedback AS (
  SELECT DISTINCT ON (canonical_user_id, coffee_id) canonical_user_id, coffee_id, rating
  FROM v_customer_feedback_current
  ORDER BY canonical_user_id, coffee_id, occurred_at DESC
),
slots AS (SELECT * FROM v_coffee_sellable_slot WHERE weight_oz = 12),
compare AS (
  SELECT c.canonical_user_id, s.slot_id, s.coffee_id, cdr.dimension_id,
    (t.dimension_id IS NOT NULL) AS is_comparable,
    (t.dimension_id IS NOT NULL AND cdr.value_min <= t.value_max AND cdr.value_max >= t.value_min) AS overlaps_dim,
    EXISTS (
      SELECT 1 FROM disliked_ranges dr
      WHERE dr.canonical_user_id = c.canonical_user_id AND dr.dimension_id = cdr.dimension_id
        AND cdr.value_min <= dr.value_max AND cdr.value_max >= dr.value_min
    ) AS is_disliked_overlap
  FROM eligible_customers c
  CROSS JOIN slots s
  JOIN v_coffee_dimension_range cdr ON cdr.coffee_id = s.coffee_id
  LEFT JOIN traits t ON t.canonical_user_id = c.canonical_user_id AND t.dimension_id = cdr.dimension_id
),
agg AS (
  SELECT canonical_user_id, slot_id, coffee_id,
    COUNT(*) FILTER (WHERE is_comparable) AS n_dims_compared,
    COUNT(*) FILTER (WHERE is_comparable AND overlaps_dim) AS n_dims_overlapping,
    COUNT(*) FILTER (WHERE is_disliked_overlap) AS n_dims_disliked_overlap
  FROM compare
  GROUP BY canonical_user_id, slot_id, coffee_id
)
SELECT
  a.canonical_user_id, s.slot_id, s.archetype, s.sort_order, s.slot_name, s.position_label,
  s.coffee_id, s.coffee_name, s.blend_id, s.roaster_sku, s.shopify_variant_id, s.retail_price_cents,
  a.n_dims_overlapping, a.n_dims_compared, a.n_dims_disliked_overlap,
  COALESCE(qc.archetype_code = s.archetype OR qc.secondary_archetype_code = s.archetype, false) AS in_pair,
  (ab.coffee_id IS NOT NULL) AS already_bought,
  lf.rating AS last_rating
FROM agg a
JOIN slots s ON s.slot_id = a.slot_id AND s.coffee_id = a.coffee_id
LEFT JOIN v_customer_quiz_current qc ON qc.canonical_user_id = a.canonical_user_id
LEFT JOIN already_bought ab ON ab.canonical_user_id = a.canonical_user_id AND ab.coffee_id = a.coffee_id
LEFT JOIN last_feedback lf ON lf.canonical_user_id = a.canonical_user_id AND lf.coffee_id = a.coffee_id
WHERE NOT EXISTS (
  SELECT 1 FROM disliked_coffees dc WHERE dc.canonical_user_id = a.canonical_user_id AND dc.coffee_id = a.coffee_id
)
ORDER BY in_pair DESC, a.n_dims_overlapping DESC, a.n_dims_disliked_overlap ASC, a.n_dims_compared DESC, s.sort_order, s.slot_id;
