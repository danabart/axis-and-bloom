-- Family Household 1, Part A4 (2026-11-07): move the 2026-05 memberships
-- (user_profile.household_id / is_household_admin) into household_member +
-- household_member_role, and the 2026-05 invitations onto status_id.
-- backend/src/features/household/CLAUDE_CODE_PROMPT_HOUSEHOLD_1_FOUNDATION_AND_JOIN_LINKS.md
--
-- Runs once per database after schema.sql has booted the new tables (the
-- script never creates DDL). Idempotent: every insert is guarded by
-- WHERE NOT EXISTS, every update by its own predicate, so a second run
-- changes nothing. Writes nothing else; deletes nothing.
--
-- Production: run only after Dana's go at the Part A4 STOP. Run record:
--   test DB:    2026-11-07 (householdService.test.ts, twice, identical)
--   production: 2026-11-07 after Dana's go, twice, identical (CLOSING_REPORT_1.md)

BEGIN;

-- 1. One active membership per profile that carries a household_id.
INSERT INTO household_member (household_id, user_id, status_id, joined_at)
SELECT up.household_id, up.id,
       (SELECT id FROM household_member_status WHERE code = 'active'),
       COALESCE(h.created_at, timezone('utc', now()))
FROM user_profile up
JOIN household h ON h.id = up.household_id
WHERE up.household_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM household_member hm WHERE hm.user_id = up.id AND hm.household_id = up.household_id)
  -- Already an active member elsewhere (joined a new household between the
  -- deploy and this run): skipped, shows as legacy_members > members.
  AND NOT EXISTS (SELECT 1 FROM household_member hm JOIN household_member_status s ON s.id = hm.status_id AND s.code = 'active'
                  WHERE hm.user_id = up.id);

-- 2. Roles. Everyone migrated is in the household box.
INSERT INTO household_member_role (member_id, role_id, granted_at)
SELECT hm.id, r.id, hm.joined_at
FROM household_member hm
JOIN user_profile up ON up.id = hm.user_id AND up.household_id = hm.household_id
JOIN household_role r ON r.code = 'household'
WHERE NOT EXISTS (SELECT 1 FROM household_member_role mr WHERE mr.member_id = hm.id AND mr.role_id = r.id);

-- 2b. Admin: is_household_admin = true.
INSERT INTO household_member_role (member_id, role_id, granted_at)
SELECT hm.id, r.id, hm.joined_at
FROM household_member hm
JOIN user_profile up ON up.id = hm.user_id AND up.household_id = hm.household_id AND up.is_household_admin
JOIN household_role r ON r.code = 'admin'
WHERE NOT EXISTS (SELECT 1 FROM household_member_role mr WHERE mr.member_id = hm.id AND mr.role_id = r.id);

-- 2c. A household with no admin: primary_billing_user_id's member becomes
-- admin. A household with neither is left as is and listed by the report query.
INSERT INTO household_member_role (member_id, role_id, granted_at)
SELECT hm.id, r.id, hm.joined_at
FROM household h
JOIN household_member hm ON hm.household_id = h.id AND hm.user_id = h.primary_billing_user_id
JOIN household_role r ON r.code = 'admin'
WHERE EXISTS (SELECT 1 FROM user_profile up WHERE up.household_id = h.id) -- 2026-05 households only
  AND NOT EXISTS (
  SELECT 1 FROM household_member hm2
  JOIN household_member_role mr ON mr.member_id = hm2.id AND mr.revoked_at IS NULL
  WHERE hm2.household_id = h.id AND mr.role_id = r.id
);

-- 3. Invitations: status_id from the retired text, member_id stays NULL.
UPDATE household_invitation hi
SET status_id = s.id
FROM household_invitation_status s
WHERE hi.status_id IS NULL
  AND s.code = CASE hi.status WHEN 'pending' THEN 'legacy' WHEN 'accepted' THEN 'accepted' WHEN 'cancelled' THEN 'revoked' ELSE 'legacy' END;

-- 4. One 'created' event per migrated household (a 2026-05 household: some
-- profile still carries its id; households made by householdService have
-- their own 'created' event already).
INSERT INTO household_event (household_id, kind_id, source_id, detail, created_at)
SELECT h.id,
       (SELECT id FROM household_event_kind WHERE code = 'created'),
       (SELECT id FROM household_event_source WHERE code = 'system'),
       '{"migrated_from": "user_profile", "script": "household_2026_11_07"}'::jsonb,
       COALESCE(h.created_at, timezone('utc', now()))
FROM household h
WHERE EXISTS (SELECT 1 FROM user_profile up WHERE up.household_id = h.id)
  AND NOT EXISTS (SELECT 1 FROM household_event e WHERE e.household_id = h.id AND e.detail ->> 'script' = 'household_2026_11_07');

COMMIT;

-- Report (read-only).
SELECT
  (SELECT COUNT(*) FROM household) AS households,
  (SELECT COUNT(*) FROM user_profile WHERE household_id IS NOT NULL) AS legacy_members,
  (SELECT COUNT(*) FROM user_profile WHERE household_id IS NOT NULL AND is_household_admin) AS legacy_admins,
  (SELECT COUNT(*) FROM household_member) AS members,
  (SELECT COUNT(*) FROM household_member_role mr JOIN household_role r ON r.id = mr.role_id WHERE r.code = 'admin' AND mr.revoked_at IS NULL) AS admin_roles,
  (SELECT COUNT(*) FROM household_member_role mr JOIN household_role r ON r.id = mr.role_id WHERE r.code = 'household' AND mr.revoked_at IS NULL) AS household_roles,
  (SELECT COUNT(*) FROM household_invitation WHERE status_id IS NULL) AS invitations_without_status,
  (SELECT COUNT(*) FROM household_event WHERE detail ->> 'script' = 'household_2026_11_07') AS migration_events,
  (SELECT COUNT(*) FROM household h WHERE NOT EXISTS (
     SELECT 1 FROM household_member hm JOIN household_member_role mr ON mr.member_id = hm.id AND mr.revoked_at IS NULL
     JOIN household_role r ON r.id = mr.role_id AND r.can_administer WHERE hm.household_id = h.id)) AS households_without_admin;
