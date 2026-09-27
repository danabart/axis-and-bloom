// ── Customer Blueprint · brief C1, Part C (2026-09-27) ────────────────────────
// Reserved: the only place a customer_* table (or catalog_change) may be
// SELECTed from once C3 ships its v_customer_*/v_palate_* views (lint rule 4
// in backend/scripts/lint-customer.mjs enforces this — see
// backend/src/features/customer_blueprint/README.md and
// CLAUDE_CODE_PROMPT_CUSTOMER_1_ROLES_NAMING_DOOR.md). No exports yet: C1
// only creates empty fact tables, so there is nothing to read.
export {};
