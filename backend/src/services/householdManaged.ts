// Family Household 1 (2026-11-07): a profile a household admin set up by
// first name has firebase_uid = MANAGED_UID_PREFIX + a UUID. It is never a
// Firebase uid; middleware/auth refuses the prefix, householdService mints it.
// Kept in its own module so the auth middleware imports nothing else.
export const MANAGED_UID_PREFIX = 'managed:';
