-- Catalog Blueprint · brief 3 — every reader onto the views (2026-09-14)
--
-- STATUS: not run as a standalone step — every statement below is also in
-- schema.sql (idempotent: DROP VIEW IF EXISTS + CREATE VIEW), which runs
-- automatically on every backend startup. This file exists only as the
-- narrative record, same convention as catalog_blueprint_1_2026_09_13.sql.
--
-- See backend/src/features/catalog_blueprint/README.md and this brief's own
-- CLAUDE_CODE_PROMPT_CATALOG_3_READERS_ONTO_VIEWS.md, Part A, for full context.
--
-- One new view, one redefined view. Drop nothing else (v_dial_positions,
-- v_dial_navigation have no TS readers and are left for brief 5 to drop).
--
--   * v_coffee_sellable_candidate (new) — the pre-DISTINCT-ON candidate list
--     v_coffee_sellable_slot picks its winner from, exposed so
--     blendResolver.ts can report *why* a losing candidate didn't resolve.
--     One row per (active slot, active assignment, active coffee, weight in
--     {12, 80}) — a weight with no active blend still gets a row
--     (blend_id NULL), unlike the old inline subquery.
--   * v_coffee_sellable_slot redefined on top of the candidate view — same
--     16 output columns as brief 1 (verified: brief 1's own tests pass
--     unchanged).
--   * v_archetype_adjacency redefined on v_coffee_hop (hop_type_derived,
--     both coffees active, both archetypes is_archetype via
--     v_coffee_archetype) instead of dial_coffee_relationships +
--     archetype_assignments directly — same 6 output columns. Moved later
--     in schema.sql (physically, not semantically) since it now depends on
--     v_coffee_hop, which is defined further down in the file — a
--     dependency-order requirement, not a schema change beyond Part A.
--
-- Safe to run any time — these are read-only view definitions; no table is
-- touched, no data changes.

-- ── v_coffee_sellable_candidate + redefined v_coffee_sellable_slot ─────────────

DROP VIEW IF EXISTS v_coffee_sellable_slot;
DROP VIEW IF EXISTS v_coffee_sellable_candidate;

CREATE VIEW v_coffee_sellable_candidate AS
SELECT
  cds.id             AS slot_id,
  cds.archetype,
  cds.sort_order,
  cds.name           AS slot_name,
  cds.position_label,
  cds.is_landing_default,
  w.weight_oz,
  vc.id              AS coffee_id,
  vc.name            AS coffee_name,
  vc.roaster_id,
  vc.roaster_name,
  csa.id             AS assignment_id,
  csa.role,
  csa.priority,
  rb.id              AS blend_id,
  rb.roaster_sku,
  rb.shopify_variant_id,
  dsp.retail_price_cents,
  (rb.id IS NOT NULL AND dsp.retail_price_cents IS NOT NULL) AS is_sellable,
  ROW_NUMBER() OVER (
    PARTITION BY cds.id, w.weight_oz
    ORDER BY (csa.role = 'home') DESC, csa.priority
  ) AS rank
FROM coffee_dial_slot cds
JOIN coffee_slot_assignment csa       ON csa.slot_id = cds.id AND csa.is_active = true
JOIN v_coffee vc                      ON vc.id = csa.coffee_id AND vc.is_active = true
CROSS JOIN (VALUES (12::numeric), (80::numeric)) AS w(weight_oz)
LEFT JOIN roaster_blend rb            ON rb.coffee_id = vc.id AND rb.is_active = true AND rb.weight_oz = w.weight_oz
LEFT JOIN dial_slot_price dsp         ON dsp.slot_id = cds.id AND dsp.weight_oz = w.weight_oz
WHERE cds.is_active = true AND cds.name IS NOT NULL
  AND NOT (vc.category_codes && ARRAY['decaf','half_caf','flavored'])
  AND (cds.archetype = 'experimental' OR NOT (vc.category_codes && ARRAY['experimental']));

CREATE VIEW v_coffee_sellable_slot AS
SELECT DISTINCT ON (cand.slot_id, cand.weight_oz)
  cand.slot_id, cand.archetype, cand.sort_order, cand.slot_name, cand.position_label,
  cand.is_landing_default, cand.weight_oz, cand.coffee_id, cand.coffee_name, cand.roaster_id,
  cand.role, cand.priority, cand.blend_id, cand.roaster_sku, cand.shopify_variant_id,
  cand.retail_price_cents
FROM v_coffee_sellable_candidate cand
WHERE cand.is_sellable
ORDER BY cand.slot_id, cand.weight_oz, cand.rank;

-- ── v_archetype_adjacency redefined on v_coffee_hop ─────────────────────────

DROP VIEW IF EXISTS v_archetype_adjacency;
CREATE VIEW v_archetype_adjacency AS
SELECT
  LEAST(vch.from_archetype, vch.to_archetype)                                           AS archetype_a,
  GREATEST(vch.from_archetype, vch.to_archetype)                                        AS archetype_b,
  COUNT(*)                                                                               AS hop_count,
  COUNT(*) FILTER (WHERE vch.direction = 'more')                                         AS more_count,
  COUNT(*) FILTER (WHERE vch.direction = 'less')                                         AS less_count,
  ROUND(AVG(CASE vch.confidence WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 END), 2) AS avg_confidence
FROM v_coffee_hop vch
JOIN v_coffee_archetype vca_from ON vca_from.code = vch.from_archetype
JOIN v_coffee_archetype vca_to   ON vca_to.code   = vch.to_archetype
WHERE vch.hop_type_derived = 'bridge_archetype'
  AND vch.from_coffee_is_active = true AND vch.to_coffee_is_active = true
  AND vca_from.is_archetype = true AND vca_to.is_archetype = true
  AND vch.from_archetype <> vch.to_archetype
GROUP BY LEAST(vch.from_archetype, vch.to_archetype), GREATEST(vch.from_archetype, vch.to_archetype)
ORDER BY hop_count DESC;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'v_coffee_sellable_slot' ORDER BY ordinal_position;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'v_archetype_adjacency' ORDER BY ordinal_position;
