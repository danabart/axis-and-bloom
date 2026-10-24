-- ═══════════════════════════════════════════════════════════════════════════
-- comments.sql — the data dictionary. Every COMMENT ON in the database lives
-- here and only here (data catalog brief 1, 2026-10-16;
-- backend/src/features/data_catalog/). Applied at every boot right after
-- schema.sql on the owner pool (index.ts, [db-comments]); apply by hand
-- after an edit with `npm run db:comments -- --expect-db <db>`.
--
-- One statement per line, dollar-quoted ($c$...$c$), grouped by table in
-- schema.sql order. Formats (lint: src/db/comments.format.test.ts):
--   table/view: Purpose: <sentence> | Class: <master|fact|operating|snapshot|view|deprecated> | Writer: <x> | Readers: <y> | Since: <z>
--   column:     <sentence on meaning and unit>[ | Writer: <x> when it differs from the table's]
--   deprecated column: Class: deprecated | <sentence>
--   anything code and docs do not settle starts with UNVERIFIED: <why> |
-- View columns are not commented (they inherit from the view and its base columns).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Firestore (named database axis-bloom-fs) ───────────────────────────────
-- Firestore has no schema to comment on; this block is hand-maintained and
-- brief 2's generator copies it into CATALOG.md. Inventoried 2026-10-16 from
-- every firestoreDb.doc()/.collection()/.collectionGroup() call (all access
-- goes through backend/src/services/firebase-admin.ts; frontend/src and
-- cloud-functions do not use Firestore). No firestore.rules file exists in the
-- repo; firestore.indexes.json indexes only two retired collections
-- (feedback_events, sommelier_evaluations).
-- firestore: users/{uid} | Purpose: Mirror of the user's name, email and token balance; Cloud SQL is the source of truth. | Writer: routes/users.ts (GET /profile sync, PATCH /profile), tokenService.spendToken/grantTokens, orders token bonus (routes/orders.ts); deleted with all subcollections by staleGuestCleanup | Readers: none
-- firestore: users/{uid}/sommelier_sessions/{sessionId}/messages | Purpose: Liam chat transcript, one doc per message (role, content, modelUsed, seq, actions, createdAt); the parent session doc is never written. | Writer: routes/sommelier.ts (session open, user turn, assistant reply, daily-cap close) | Readers: routes/sommelier.ts (history for Claude, past-session transcript with SQL fallback)
-- firestore: config/sommelier | Purpose: Sommelier runtime config including aiControls, cached in memory by a live listener. | Writer: seed (db/seeds/sommelier_config_seed.ts, only if absent), routes/admin.ts (PATCH /sommelier/config, POST /sommelier/config-apply, PUT /ai-ops/controls) | Readers: sommelierConfig (get + onSnapshot), routes/admin.ts (config, config-drift, ai-ops)
-- firestore: config/sommelier/audit | Purpose: Audit trail of admin config changes (uid, email, paths or old/new, at). | Writer: routes/admin.ts (config-apply, ai-controls) | Readers: routes/admin.ts (GET /ai-ops, last 30)
-- firestore: config/sommelierCentroids | Purpose: Per-intent 13-dimension feature centroids (DISCOVERY_SEEKER, PROFILE_AMBIGUOUS, TASTE_EVOLUTION, RECOMMENDATION_MISS, CONVERSION, EXPLORATION). | Writer: seed (sommelier_config_seed.ts, only if absent), routes/admin.ts (POST /sommelier/recompute-centroids) | Readers: none beyond the seed's existence check
-- firestore: admin_stats/brew_profile | Purpose: Admin counters for brew-profile writes, failures and no-ops. | Writer: brewProfile (increment) | Readers: brewProfile.getBrewProfileCounters
-- firestore: admin_stats/liam_writeback | Purpose: Counter of Liam recommendation write-backs that could not be resolved. | Writer: liamWriteBack (increment) | Readers: liamWriteBack.getLiamWriteBackCounters
-- Retired stores (writes removed by Customer Blueprint C2/C3, 2026-09-27; facts now in Postgres customer_* tables). They STILL HOLD DATA; nothing deletes it. Read only by customerIntegrity check 15 (post-cutover write detector, due for removal after 2026-10-27). Some backend/scripts one-off backfills read them.
-- firestore: users/{uid}/feedback_events | Purpose: Retired: per-user coffee feedback events, replaced by customer_feedback_event. Still holds data. | Writer: none (retired, C2/C3) | Readers: customerIntegrity check 15
-- firestore: users/{uid}/dial_events | Purpose: Retired: dial movement history, replaced by customer_dial_event (explicit saves by user_saved_item). Still holds data. | Writer: none (retired, C2/C3) | Readers: customerIntegrity check 15
-- firestore: users/{uid}/metadata/brew_profile | Purpose: Retired: brew profile doc, replaced by customer_brew_profile_change. Still holds data. | Writer: none (retired, C2/C3) | Readers: customerIntegrity check 15
-- firestore: users/{uid}/metadata/taste_journey | Purpose: Retired: taste journey summary doc. Still holds data. | Writer: none (retired, C2/C3) | Readers: customerIntegrity check 15
-- firestore: users/{uid}/metadata/confidence_profile | Purpose: Retired: behavioral confidence profile doc. Still holds data. | Writer: none (retired, C2/C3) | Readers: customerIntegrity check 15
-- firestore: users/{uid}/quiz_sessions | Purpose: Retired: per-user quiz session copies; quiz facts live in quiz_session / quiz_session_interpretation. Still holds data. | Writer: none (retired, C2/C3) | Readers: customerIntegrity check 15
-- firestore: users/{uid}/liam_saves | Purpose: Retired: items saved from Liam chat, replaced by user_saved_item. Still holds data. | Writer: none (retired, C2/C3) | Readers: customerIntegrity check 15
-- firestore: users/{uid}/sommelier_evaluations | Purpose: Retired: per-session sommelier evaluations, replaced by sommelier_evaluation. Still holds data. | Writer: none (retired, C2/C3) | Readers: customerIntegrity check 15

-- ── user_type ──
COMMENT ON TABLE user_type IS $c$Purpose: Lookup of account roles that user_profile.user_type_id points to (admin, customer) | Class: operating | Writer: seed | Readers: middleware/auth, users, liamAccess, roasteryPortalReads, admin, SQL fn list_admins | Since: 2026-05-22$c$;
COMMENT ON COLUMN user_type.id IS $c$Surrogate primary key (UUID); referenced by user_profile.user_type_id.$c$;
COMMENT ON COLUMN user_type.name IS $c$Role name, unique; seeded values are admin and customer (docs also mention subscriber and roaster partner, never seeded).$c$;
COMMENT ON COLUMN user_type.description IS $c$Free-text description of the role.$c$;
COMMENT ON COLUMN user_type.created_at IS $c$UTC timestamp when the row was created.$c$;
COMMENT ON COLUMN user_type.updated_at IS $c$UTC timestamp of last update; no code path updates it after seeding.$c$;
-- ── quiz_type ──
COMMENT ON TABLE quiz_type IS $c$Purpose: Lookup that classifies a quiz row as the main quiz or a branch (reclassification) quiz | Class: operating | Writer: seed | Readers: v_quiz_scoring_matrix, quiz.quiz_type_id FK | Since: 2026-06-17$c$;
COMMENT ON COLUMN quiz_type.id IS $c$Surrogate primary key (UUID); referenced by quiz.quiz_type_id.$c$;
COMMENT ON COLUMN quiz_type.name IS $c$Quiz kind, unique. One of: main, branch.$c$;
-- ── coffee_archetype ──
COMMENT ON TABLE coffee_archetype IS $c$Purpose: The six named flavor-profile archetypes (Chocolate & Nutty, Balanced, Fruity, Earthy, Floral, Experimental) with their catalog identity and Bloom Dial config | Class: master | Writer: catalogService.setArchetypeDescriptorFamilies; seed | Readers: v_coffee_archetype, v_archetype_vectors, v_quiz_scoring_matrix, v_customer_quiz_current, quizScorer, quizSession, catalogService, v_coffee_customer_descriptor (descriptor_families), +10 more | Since: 2026-05-22 (as archetype; renamed 2026-09-16 by Catalog Blueprint brief 5b)$c$;
COMMENT ON COLUMN coffee_archetype.id IS $c$Surrogate primary key (UUID); the FK target for quiz answers, quiz sessions, archetype_vector and similar quiz-side tables (catalog tables key on code instead).$c$;
COMMENT ON COLUMN coffee_archetype.name IS $c$Display name of the archetype, unique; still the natural key inside the quiz seed blocks. Balanced was renamed from Balanced & Sweet on 2026-09-19.$c$;
COMMENT ON COLUMN coffee_archetype.description IS $c$Customer-facing one-sentence profile text for the archetype.$c$;
COMMENT ON COLUMN coffee_archetype.is_active IS $c$Class: deprecated | DEPRECATED 2026-10-16: boolean default true that no code or view reads or writes; all six archetypes are live and retiring one is a code change, not a flag.$c$;
COMMENT ON COLUMN coffee_archetype.created_at IS $c$UTC timestamp when the row was created.$c$;
COMMENT ON COLUMN coffee_archetype.updated_at IS $c$UTC timestamp of last update; set by the seed rename UPDATEs in schema.sql.$c$;
COMMENT ON COLUMN coffee_archetype.code IS $c$Stable catalog identity of the archetype, unique; archetype_enum (chocolate_nutty, balanced_sweet, fruity, earthy, floral, experimental). Backfilled once from name in schema.sql, no runtime writer.$c$;
COMMENT ON COLUMN coffee_archetype.sort_order IS $c$Canonical display order 1-6 (floral, fruity, balanced_sweet, chocolate_nutty, earthy, experimental); set once by schema.sql backfill.$c$;
COMMENT ON COLUMN coffee_archetype.has_bloom_dial IS $c$True when the archetype has a Bloom Dial (slot ladder); seeded true for all six by schema.sql.$c$;
COMMENT ON COLUMN coffee_archetype.is_archetype IS $c$True for the five real archetypes, false for experimental (a category, not an archetype); seeded once by schema.sql.$c$;
COMMENT ON COLUMN coffee_archetype.dominant_dimension_id IS $c$References coffee_dimensions.id (integer): the dimension that dominates this archetype (7 chocolate_nutty, 5 balanced_sweet and fruity, 9 floral, 6 earthy); NULL for experimental. Seeded once by schema.sql.$c$;
COMMENT ON COLUMN coffee_archetype.descriptor_families IS $c$Array of cupping_note.wheel_category strings that count as on family for this archetype (D6 placement check); seeded by schema.sql, admin-editable | Writer: catalogService.setArchetypeDescriptorFamilies$c$;
COMMENT ON COLUMN coffee_archetype.descriptor_families_seeded_at IS $c$UTC timestamp when descriptor_families was seeded; guards the one-time seed so an admin edit is never reset on the next boot | Writer: seed, catalogService.setArchetypeDescriptorFamilies$c$;
-- ── roaster ──
COMMENT ON TABLE roaster IS $c$Purpose: Drop-ship roastery partners that supply the coffees, with contact details and an active or deactivated state | Class: operating | Writer: admin.POST /api/admin/roasters, admin.PATCH /api/admin/roasters/:id, catalogService.deactivateRoastery, catalogService.reactivateRoastery | Readers: v_coffee, v_cupping_scores_readable, admin, coffees, catalogService, catalogImport, roasteryPortalReads, +1 more | Since: 2026-05-22$c$;
COMMENT ON COLUMN roaster.id IS $c$Surrogate primary key (UUID); referenced by coffees.roaster_id, coffee_sku.roaster_id and the roastery portal tables.$c$;
COMMENT ON COLUMN roaster.name IS $c$Roastery display name; catalogImport matches manifests to a roaster by this name, case and whitespace insensitive (no unique constraint).$c$;
COMMENT ON COLUMN roaster.api_endpoint IS $c$Optional URL of the roaster's order-submission API; admin-entered, no code outside the admin form reads it.$c$;
COMMENT ON COLUMN roaster.is_active IS $c$Whether the roastery is active; written only by the deactivate and reactivate cascade, which keeps coffees.is_active truthful | Writer: catalogService.deactivateRoastery, catalogService.reactivateRoastery$c$;
COMMENT ON COLUMN roaster.avg_fulfillment_hours IS $c$Average hours from order to shipment for this roaster (numeric hours); admin-entered.$c$;
COMMENT ON COLUMN roaster.roaster_notes IS $c$Free-text internal notes about the roaster; admin-entered.$c$;
COMMENT ON COLUMN roaster.created_at IS $c$UTC timestamp when the row was created.$c$;
COMMENT ON COLUMN roaster.updated_at IS $c$UTC timestamp of last update; set by PATCH and by the deactivate and reactivate cascade.$c$;
COMMENT ON COLUMN roaster.address IS $c$Roaster postal address as free text; admin-entered.$c$;
COMMENT ON COLUMN roaster.email IS $c$Roaster contact email; admin-entered.$c$;
COMMENT ON COLUMN roaster.phone IS $c$Roaster contact phone; admin-entered.$c$;
COMMENT ON COLUMN roaster.contact_person IS $c$Name of the roaster's contact person; admin-entered.$c$;
COMMENT ON COLUMN roaster.website IS $c$Roaster website URL; admin-entered.$c$;
COMMENT ON COLUMN roaster.deactivated_at IS $c$UTC timestamp when the roastery was deactivated; NULL while active | Writer: catalogService.deactivateRoastery, catalogService.reactivateRoastery$c$;
COMMENT ON COLUMN roaster.deactivation_note IS $c$Free-text reason an admin typed in the deactivate confirm dialog; cleared on reactivation | Writer: catalogService.deactivateRoastery, catalogService.reactivateRoastery$c$;
-- ── quiz ──
COMMENT ON TABLE quiz IS $c$Purpose: One row per quiz version, main or branch; branch quizzes link to a triggering archetype and a parent main quiz | Class: operating | Writer: seed | Readers: routes/quiz, quizIntegrity, quizSession, customerIntegrity, v_quiz_scoring_matrix, campaign_funnel_v | Since: 2026-05-22$c$;
COMMENT ON COLUMN quiz.id IS $c$Surrogate primary key (UUID); referenced by quiz_question.quiz_id and quiz.parent_quiz_id.$c$;
COMMENT ON COLUMN quiz.version IS $c$Version label of the quiz, e.g. v2, v3, v7, v7-branch-floral.$c$;
COMMENT ON COLUMN quiz.description IS $c$Free-text description of the quiz version.$c$;
COMMENT ON COLUMN quiz.is_active IS $c$True for the quiz versions currently served; the seed deactivates prior versions when a new main quiz is added.$c$;
COMMENT ON COLUMN quiz.created_at IS $c$UTC timestamp when the row was created; also used as the valid_from fill for pre-SCD2 quiz questions.$c$;
COMMENT ON COLUMN quiz.quiz_type_id IS $c$References quiz_type.id (main or branch).$c$;
COMMENT ON COLUMN quiz.trigger_archetype_id IS $c$Branch quizzes only: references coffee_archetype.id, the primary archetype whose result triggers this branch; NULL for main quizzes.$c$;
COMMENT ON COLUMN quiz.parent_quiz_id IS $c$Branch quizzes only: self-reference to quiz.id of the main quiz this branch belongs to; NULL for main quizzes.$c$;
-- ── cupping_note ──
COMMENT ON TABLE cupping_note IS $c$Purpose: The SCA Coffee Taster's Flavor Wheel as a tree (tier 1 family, 2 sub-group, 3 leaf; parent_id), the vocabulary every source of descriptors resolves to | Class: operating | Writer: seed | Readers: v_collaborative_flavor_wheel, v_roastery_remark, v_cupping_score_descriptor, catalogService, cuppingService, noteMappingService, roasteryRemarkService, roasteryPortalReads, +3 more | Since: 2026-05-22 (tree: 2026-10-18, cupping evidence brief 1)$c$;
COMMENT ON COLUMN cupping_note.id IS $c$Surrogate primary key (UUID); referenced by coffee descriptor, cupping score descriptor, portal note mapping and sensory_lexicon_attribute rows.$c$;
COMMENT ON COLUMN cupping_note.wheel_category IS $c$Top-level SCA wheel category, e.g. Floral, Fruity, Sour / Fermented, Green / Vegetative, Other, Roasted, Spices, Nutty / Cocoa, Sweet; a denormalised display column since cupping evidence brief 1 (2026-10-18): a family roll-up joins parent_id, never this label.$c$;
COMMENT ON COLUMN cupping_note.wheel_subcategory IS $c$SCA wheel sub-group within the category (about 25 values); NULL on tier-1 rows and on tier-2 nodes without children (Black Tea, Vanilla, Pepper); a denormalised display column, the tree is parent_id.$c$;
COMMENT ON COLUMN cupping_note.tier IS $c$SCA wheel level of the node: 1 family (Fruity), 2 sub-group (Berry, or a childless node such as Black Tea), 3 leaf (Blueberry). A word is stored at the tier the person named, never deeper | Writer: seed$c$;
COMMENT ON COLUMN cupping_note.parent_id IS $c$References cupping_note.id: the node one tier up (leaf to sub-group, sub-group to family); NULL exactly on tier-1 rows (CHECK cupping_note_tier_parent); backfilled from the labels by schema.sql | Writer: seed$c$;
COMMENT ON COLUMN cupping_note.descriptor IS $c$The flavor descriptor word or phrase itself, e.g. Jasmine.$c$;
COMMENT ON COLUMN cupping_note.intensity_score IS $c$Class: deprecated | DEPRECATED 2026-10-16: never written; cupping_note is the descriptor vocabulary, and the intensity a descriptor showed in a cupping lives on cupping_score_descriptors.intensity (0-15).$c$;
COMMENT ON COLUMN cupping_note.ai_metadata IS $c$Class: deprecated | DEPRECATED 2026-10-16: JSONB never written, read or documented.$c$;
COMMENT ON COLUMN cupping_note.is_active IS $c$True when the descriptor is part of the active wheel; catalogService and the roastery portal only accept active descriptors.$c$;
COMMENT ON COLUMN cupping_note.created_at IS $c$UTC timestamp when the row was created.$c$;
COMMENT ON COLUMN cupping_note.updated_at IS $c$UTC timestamp of last update; no code path updates it after seeding.$c$;
COMMENT ON COLUMN cupping_note.descriptor_source_id IS $c$References sensory_source.id: where the term comes from; the 84 original rows point at wcr_lexicon (set by schema.sql UPDATE), the tier-1 and tier-2 nodes added by cupping evidence brief 1 at sca_flavor_wheel.$c$;
COMMENT ON COLUMN cupping_note.lexicon_section IS $c$Name of the WCR Sensory Lexicon section the descriptor maps to; backfilled from sensory_lexicon_attribute.section.$c$;
-- ── sensory_source ──
COMMENT ON TABLE sensory_source IS $c$Purpose: Registry of the sensory standards the vocabulary and scales come from (WCR Lexicon, SCA flavor wheel, SCA CVA, platform) | Class: operating | Writer: seed | Readers: none (FK target of cupping_note, coffee_dimensions, sensory_lexicon_attribute) | Since: 2026-07-13$c$;
COMMENT ON COLUMN sensory_source.id IS $c$Serial integer primary key; referenced by cupping_note.descriptor_source_id, coffee_dimensions.source_id and sensory_lexicon_attribute.source_id.$c$;
COMMENT ON COLUMN sensory_source.code IS $c$Stable unique short code. One of the seeded values: wcr_lexicon, sca_flavor_wheel, sca_cva, platform.$c$;
COMMENT ON COLUMN sensory_source.name IS $c$Full name of the standard.$c$;
COMMENT ON COLUMN sensory_source.publisher IS $c$Publishing organization; NULL for the platform row.$c$;
COMMENT ON COLUMN sensory_source.edition IS $c$Edition label of the standard, e.g. 2.0; NULL for platform.$c$;
COMMENT ON COLUMN sensory_source.year IS $c$Publication year of the edition (integer); NULL for platform.$c$;
COMMENT ON COLUMN sensory_source.url IS $c$Public URL of the standard; NULL for platform.$c$;
COMMENT ON COLUMN sensory_source.notes IS $c$Free-text note on what Axis & Bloom takes from this source.$c$;
-- ── sensory_lexicon_attribute ──
COMMENT ON TABLE sensory_lexicon_attribute IS $c$Purpose: Full WCR Sensory Lexicon 2.0 reference set (113 rows) kept apart from the active cupping_note wheel, with provenance links | Class: operating | Writer: seed | Readers: none (FK target of coffee_dimensions.sensory_lexicon_attribute_id) | Since: 2026-07-13$c$;
COMMENT ON COLUMN sensory_lexicon_attribute.id IS $c$Serial integer primary key; referenced by coffee_dimensions.sensory_lexicon_attribute_id.$c$;
COMMENT ON COLUMN sensory_lexicon_attribute.name IS $c$WCR lexicon attribute name, e.g. Jasmine; unique together with section.$c$;
COMMENT ON COLUMN sensory_lexicon_attribute.section IS $c$The lexicon's own section (17 sections, e.g. Taste Basics, Amplitude, Mouthfeel); Sweet, Sour, Bitter and Salty appear in two sections by design.$c$;
COMMENT ON COLUMN sensory_lexicon_attribute.wheel_category IS $c$Best-effort SCA wheel category for the attribute; NULL where it has no wheel placement (e.g. Amplitude, Mouthfeel).$c$;
COMMENT ON COLUMN sensory_lexicon_attribute.wheel_subcategory IS $c$Best-effort SCA wheel subcategory; NULL where no placement.$c$;
COMMENT ON COLUMN sensory_lexicon_attribute.source_id IS $c$References sensory_source.id; the seed sets it to wcr_lexicon.$c$;
COMMENT ON COLUMN sensory_lexicon_attribute.edition IS $c$Lexicon edition label, default 2.0 (2017).$c$;
COMMENT ON COLUMN sensory_lexicon_attribute.definition IS $c$Attribute definition text; deliberately left NULL because the WCR text is copyrighted.$c$;
COMMENT ON COLUMN sensory_lexicon_attribute.cupping_note_id IS $c$References cupping_note.id: the active descriptor this attribute corresponds to; set for all 84 active descriptors by the seed's explicit mapping, NULL otherwise.$c$;
-- ── household ──
COMMENT ON TABLE household IS $c$Purpose: A Family Bundle household grouping several user profiles under one shared account | Class: operating | Writer: household.POST /api/household/create, household.DELETE /api/household/leave | Readers: household | Since: 2026-05-22$c$;
COMMENT ON COLUMN household.id IS $c$Surrogate primary key (UUID); referenced by user_profile.household_id and household_invitation.household_id.$c$;
COMMENT ON COLUMN household.household_name IS $c$Optional household display name chosen by the creator.$c$;
COMMENT ON COLUMN household.primary_billing_user_id IS $c$References user_profile.id: the household creator, set at creation; no code changes it afterward.$c$;
COMMENT ON COLUMN household.created_at IS $c$UTC timestamp when the household was created.$c$;
COMMENT ON COLUMN household.updated_at IS $c$Timestamp set only at insert (default now()); no code updates the household row afterward.$c$;
-- ── user_profile ──
COMMENT ON TABLE user_profile IS $c$Purpose: Core customer record keyed to a Firebase uid (real or anonymous guest), holding name, household, role and consent flags | Class: operating | Writer: admin.POST /api/admin/grant-admin, admin.DELETE /api/admin/revoke-admin, auth.POST /api/auth/sync, companyGiftRedemption.POST /api/company-gift-redemption/:code/redeem, household.DELETE /api/household/leave, household.DELETE /api/household/members/:userId, household.POST /api/household/create, household.POST /api/household/join/:token, quiz.POST /api/quiz/results, staleGuestCleanup.purgeStaleAnonymousGuests, users.GET /api/users/profile, users.PATCH /api/users/profile; seed | Readers: v_customer_identity, v_customer_bag_attribution, middleware/auth, users, household, orders, cron, sommelier, +N more | Since: 2026-05-22$c$;
COMMENT ON COLUMN user_profile.id IS $c$Surrogate primary key (UUID); the user_id referenced by nearly every user-scoped table.$c$;
COMMENT ON COLUMN user_profile.firebase_uid IS $c$Firebase Auth uid, unique; may be an anonymous-auth uid, and the same uid carries forward when a guest converts to a real account.$c$;
COMMENT ON COLUMN user_profile.first_name IS $c$Customer first name | Writer: auth.POST /sync, users.PATCH /profile$c$;
COMMENT ON COLUMN user_profile.last_name IS $c$Customer last name | Writer: auth.POST /sync, users.PATCH /profile$c$;
COMMENT ON COLUMN user_profile.household_id IS $c$References household.id; NULL when the user is in no household | Writer: household.POST /create, household.POST /join/:token, household.DELETE /leave, household.DELETE /members/:userId$c$;
COMMENT ON COLUMN user_profile.is_household_admin IS $c$True when the user administers their household (the creator); false otherwise | Writer: household.POST /create, household.DELETE /leave, household.DELETE /members/:userId$c$;
COMMENT ON COLUMN user_profile.user_type_id IS $c$References user_type.id (admin or customer); NULL is treated as a regular customer | Writer: admin.POST /grant-admin, admin.DELETE /revoke-admin, SQL fns grant_admin and revoke_admin$c$;
COMMENT ON COLUMN user_profile.stripe_customer_id IS $c$Stripe customer id for the user; reserved for the Stripe payment-capture brief (getOrCreateStripeCustomer reads and writes it), not written yet.$c$;
COMMENT ON COLUMN user_profile.accepts_marketing IS $c$Class: deprecated | DEPRECATED 2026-10-16: never read or written; marketing consent lives on newsletter_subscriber (subscribed, unsubscribed_at).$c$;
COMMENT ON COLUMN user_profile.date_of_birth IS $c$Customer date of birth (date, no time zone); used to derive generation for Liam | Writer: users.PATCH /profile$c$;
COMMENT ON COLUMN user_profile.created_at IS $c$UTC timestamp when the profile was created; stale guest cleanup keys on it.$c$;
COMMENT ON COLUMN user_profile.updated_at IS $c$UTC timestamp of last profile touch; refreshed by the lazy upserts and PATCH.$c$;
COMMENT ON COLUMN user_profile.company_gift_id IS $c$References company_gift.id: the company-sponsored gift this user redeemed; NULL otherwise | Writer: companyGiftRedemption.POST /:code/redeem$c$;
-- ── household_invitation ──
COMMENT ON TABLE household_invitation IS $c$Purpose: Token-based invitations to join a household, valid 7 days | Class: operating | Writer: household.POST /api/household/invite, household.POST /api/household/join/:token, household.DELETE /api/household/invitations/:invitationId | Readers: household | Since: 2026-06-08$c$;
COMMENT ON COLUMN household_invitation.id IS $c$Surrogate primary key (UUID).$c$;
COMMENT ON COLUMN household_invitation.household_id IS $c$References household.id; invitation is deleted with the household (ON DELETE CASCADE).$c$;
COMMENT ON COLUMN household_invitation.invited_email IS $c$Lower-cased email address the invitation was sent to; acceptance requires the joiner's email to match.$c$;
COMMENT ON COLUMN household_invitation.invited_by_id IS $c$References user_profile.id: the household admin who sent the invitation.$c$;
COMMENT ON COLUMN household_invitation.token IS $c$Unique 32-byte hex secret in the join link.$c$;
COMMENT ON COLUMN household_invitation.status IS $c$Invitation state, no CHECK constraint. One of: pending, accepted, cancelled.$c$;
COMMENT ON COLUMN household_invitation.created_at IS $c$UTC timestamp when the invitation was created.$c$;
COMMENT ON COLUMN household_invitation.expires_at IS $c$UTC timestamp after which the invitation is rejected; defaults to created time plus 7 days.$c$;
-- ── user_email ──
COMMENT ON TABLE user_email IS $c$Purpose: Email addresses attached to a user profile, one flagged primary | Class: operating | Writer: auth.POST /api/auth/sync, users.GET /api/users/profile | Readers: users, household, cron, admin, roasteryPortalReads, staleGuestCleanup, SQL fns grant_admin, revoke_admin, list_admins | Since: 2026-05-22$c$;
COMMENT ON COLUMN user_email.id IS $c$Surrogate primary key (UUID).$c$;
COMMENT ON COLUMN user_email.user_id IS $c$References user_profile.id; row is deleted with the profile (ON DELETE CASCADE).$c$;
COMMENT ON COLUMN user_email.email_address IS $c$Email address, globally unique; taken from the Firebase token email.$c$;
COMMENT ON COLUMN user_email.is_primary IS $c$True for the address used for sends and lookups; code always inserts true.$c$;
COMMENT ON COLUMN user_email.is_verified IS $c$True when the address is verified; code always inserts true, and stale guest cleanup spares users with a verified email.$c$;
COMMENT ON COLUMN user_email.created_at IS $c$UTC timestamp when the row was created.$c$;
COMMENT ON COLUMN user_email.updated_at IS $c$Timestamp set only at insert (default); no code updates the row afterward.$c$;
-- ── user_phone ──
COMMENT ON TABLE user_phone IS $c$Purpose: Phone numbers for a user with SMS consent flags for post-delivery feedback and beat messages | Class: operating | Writer: users.PATCH /api/users/profile | Readers: users, cron, beatEngine, liamSmsFeedback | Since: 2026-05-22$c$;
COMMENT ON COLUMN user_phone.id IS $c$Surrogate primary key (UUID).$c$;
COMMENT ON COLUMN user_phone.user_id IS $c$References user_profile.id; row is deleted with the profile (ON DELETE CASCADE).$c$;
COMMENT ON COLUMN user_phone.phone_number IS $c$Phone number in normalized form, globally unique across users.$c$;
COMMENT ON COLUMN user_phone.is_primary IS $c$True for the number used for SMS; the profile PATCH only creates primary rows.$c$;
COMMENT ON COLUMN user_phone.is_verified IS $c$Boolean, set false on every add or change; no code sets it true, so no number is ever verified.$c$;
COMMENT ON COLUMN user_phone.created_at IS $c$UTC timestamp when the row was created.$c$;
COMMENT ON COLUMN user_phone.updated_at IS $c$UTC timestamp of last change to the number or opt-in.$c$;
COMMENT ON COLUMN user_phone.sms_opt_in IS $c$Consent to the post-delivery feedback SMS ask (legacy consent); read by liamSmsFeedback.$c$;
COMMENT ON COLUMN user_phone.sms_opt_in_at IS $c$UTC timestamp when sms_opt_in was last switched on.$c$;
COMMENT ON COLUMN user_phone.sms_beats_opt_in IS $c$Extended consent for beat SMS, default false; read live by beatEngine and the beats cron, written by nothing until the A2P consent UI exists (HOME_TASK_8 scope note in schema.sql).$c$;
COMMENT ON COLUMN user_phone.sms_beats_opt_in_at IS $c$UTC timestamp when sms_beats_opt_in was granted; written by nothing until the A2P consent UI exists.$c$;
-- ── address ──
COMMENT ON TABLE address IS $c$Purpose: Saved shipping and billing addresses per user | Class: operating | Writer: users.POST /api/users/addresses, users.PATCH /api/users/addresses/:id/default, users.DELETE /api/users/addresses/:id | Readers: users (+ order.shipping_address_id FK) | Since: 2026-05-22$c$;
COMMENT ON COLUMN address.id IS $c$Surrogate primary key (UUID); order.shipping_address_id points here as a convenience pointer.$c$;
COMMENT ON COLUMN address.user_id IS $c$References user_profile.id; row is deleted with the profile (ON DELETE CASCADE).$c$;
COMMENT ON COLUMN address.address_type IS $c$Address purpose, address_type_enum. One of: shipping, billing.$c$;
COMMENT ON COLUMN address.street IS $c$Street line of the address.$c$;
COMMENT ON COLUMN address.city IS $c$City.$c$;
COMMENT ON COLUMN address.state IS $c$State or region as free text.$c$;
COMMENT ON COLUMN address.postal_code IS $c$Postal or ZIP code as free text.$c$;
COMMENT ON COLUMN address.country IS $c$Country, default US.$c$;
COMMENT ON COLUMN address.is_default IS $c$True for the default address of its type for the user; the first address of each type is auto-default.$c$;
COMMENT ON COLUMN address.created_at IS $c$UTC timestamp when the address was saved.$c$;
COMMENT ON COLUMN address.updated_at IS $c$Timestamp set only at insert (default now()); the default-flag UPDATEs do not refresh it.$c$;
-- ── user_payment_detail ──
COMMENT ON TABLE user_payment_detail IS $c$Purpose: Retired 2026-10-16: intended store of per-user payment accounts from the original 2026-05 design; never written (0 rows), no code, and the Stripe payment-capture brief does not use it (Stripe Checkout holds payment methods); drop-later | Class: deprecated | Writer: none | Readers: none | Since: 2026-05-22 (as payment_detail, renamed user_payment_detail)$c$;
COMMENT ON COLUMN user_payment_detail.id IS $c$Surrogate primary key (UUID).$c$;
COMMENT ON COLUMN user_payment_detail.user_id IS $c$References user_profile.id; row is deleted with the profile (ON DELETE CASCADE).$c$;
COMMENT ON COLUMN user_payment_detail.account_type IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: required free-text kind of payment account, never written.$c$;
COMMENT ON COLUMN user_payment_detail.provider IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: required payment provider name, never written.$c$;
COMMENT ON COLUMN user_payment_detail.payment_terms IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: free-text payment terms, never written.$c$;
COMMENT ON COLUMN user_payment_detail.external_provider_id IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: provider-side id of the account or customer, never written.$c$;
COMMENT ON COLUMN user_payment_detail.routing_info IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: JSONB provider routing details, never written.$c$;
COMMENT ON COLUMN user_payment_detail.is_default IS $c$Boolean, default false: marks the user's default payment account.$c$;
COMMENT ON COLUMN user_payment_detail.is_active IS $c$Boolean, default true: whether the payment account is usable.$c$;
COMMENT ON COLUMN user_payment_detail.created_at IS $c$UTC timestamp when the row was created.$c$;
COMMENT ON COLUMN user_payment_detail.updated_at IS $c$UTC timestamp of last update.$c$;
-- ── user_tokens ──
COMMENT ON TABLE user_tokens IS $c$Purpose: Per-user Liam token balance and lifetime totals; source of truth for token balance | Class: operating | Writer: auth.POST /api/auth/sync, orders.POST /api/orders, tokenService.spendToken, tokenService.grantTokens; manual:grant_tokens | Readers: tokens, users, orders, tokenService, admin | Since: 2026-06-23$c$;
COMMENT ON COLUMN user_tokens.uid IS $c$Firebase uid, primary key; references user_profile.firebase_uid (ON DELETE CASCADE).$c$;
COMMENT ON COLUMN user_tokens.balance IS $c$Current token balance (integer tokens); never driven negative by spendToken.$c$;
COMMENT ON COLUMN user_tokens.lifetime_earned IS $c$Total tokens ever granted (integer tokens): signup bonus, order bonus, grants.$c$;
COMMENT ON COLUMN user_tokens.lifetime_spent IS $c$Total tokens ever spent (integer tokens) | Writer: tokenService.spendToken$c$;
COMMENT ON COLUMN user_tokens.updated_at IS $c$UTC timestamp of last balance change.$c$;
-- ── token_events ──
COMMENT ON TABLE token_events IS $c$Purpose: Append-only audit log of every token earn, spend and usage-log event | Class: operating | Writer: auth.POST /api/auth/sync, orders.POST /api/orders, tokenService.spendToken, tokenService.logUsage, tokenService.grantTokens; manual:grant_tokens | Readers: sommelierGuards, admin, sommelier | Since: 2026-06-23$c$;
COMMENT ON COLUMN token_events.id IS $c$Serial integer primary key.$c$;
COMMENT ON COLUMN token_events.uid IS $c$Firebase uid of the user (text); no FK constraint to user_profile.$c$;
COMMENT ON COLUMN token_events.delta IS $c$Signed token change (integer tokens): positive earn, negative spend, 0 for usage_log.$c$;
COMMENT ON COLUMN token_events.reason IS $c$Why the event happened. One of: signup_bonus, order_bonus, sommelier_turn, usage_log, admin_grant (SQL function only); the schema comment also lists purchase, which no code writes.$c$;
COMMENT ON COLUMN token_events.reference_id IS $c$Audit pointer as text: order id or Liam session id; NULL for signup bonus.$c$;
COMMENT ON COLUMN token_events.balance_after IS $c$user_tokens.balance after this event (integer tokens).$c$;
COMMENT ON COLUMN token_events.created_at IS $c$UTC timestamp when the event was recorded.$c$;
COMMENT ON COLUMN token_events.model IS $c$Claude model that handled a sommelier_turn or usage_log turn, used for the monthly spend estimate; NULL for bonus rows and older rows | Writer: tokenService.logUsage$c$;
-- ── archetype_vector ──
COMMENT ON TABLE archetype_vector IS $c$Purpose: Seed hypothesis (May 2026 assumed targets): target score range per archetype per flavor dimension (ideal, min, max). No customer-facing sentence reads it since coffee presentation brief 2; read by v_archetype_vectors (GET /api/coffees/archetype-order orders the Bloom page's archetype boxes by distance over it, open), v_archetype_dimension_comparison (admin) and dialSuggestion.getDialSuggestion (review 5.1, open) | Class: operating | Writer: seed | Readers: v_archetype_vectors, v_archetype_dimension_comparison | Since: 2026-05-22$c$;
COMMENT ON COLUMN archetype_vector.archetype_id IS $c$References coffee_archetype.id; part of the primary key (ON DELETE CASCADE).$c$;
COMMENT ON COLUMN archetype_vector.dimension_id IS $c$UUID derived as md5(dimension name)::uuid from the dimension name; no FK; part of the primary key.$c$;
COMMENT ON COLUMN archetype_vector.ideal_score IS $c$Ideal score for the archetype on this dimension, 0-15 scale, the midpoint of the range.$c$;
COMMENT ON COLUMN archetype_vector.min_score IS $c$Lower bound of the archetype's target range, 0-15 scale.$c$;
COMMENT ON COLUMN archetype_vector.max_score IS $c$Upper bound of the archetype's target range, 0-15 scale.$c$;
COMMENT ON COLUMN archetype_vector.updated_at IS $c$UTC timestamp of last update.$c$;
-- ── archetype_relationship ──
COMMENT ON TABLE archetype_relationship IS $c$Purpose: Planned adjacency between archetypes per dimension, superseded by v_archetype_adjacency and the Bloom Dial | Class: deprecated | Writer: none | Readers: none | Since: 2026-05-22$c$;
COMMENT ON COLUMN archetype_relationship.id IS $c$Surrogate primary key (UUID).$c$;
COMMENT ON COLUMN archetype_relationship.from_archetype_id IS $c$References coffee_archetype.id: the archetype the relationship starts from (ON DELETE CASCADE).$c$;
COMMENT ON COLUMN archetype_relationship.to_archetype_id IS $c$References coffee_archetype.id: the archetype it points to (ON DELETE CASCADE).$c$;
COMMENT ON COLUMN archetype_relationship.dimension_id IS $c$UUID of the dimension involved (md5-derived style, no FK).$c$;
COMMENT ON COLUMN archetype_relationship.direction IS $c$Free-text direction of the shift; never populated (table has 0 rows in production).$c$;
COMMENT ON COLUMN archetype_relationship.strength_delta IS $c$Numeric strength of the shift; never populated.$c$;
COMMENT ON COLUMN archetype_relationship.created_at IS $c$UTC timestamp when the row was created.$c$;
-- ── archetype_tunable_variable ──
COMMENT ON TABLE archetype_tunable_variable IS $c$Purpose: Reserved for dials a user can adjust within an archetype (min and max offset per dimension), held for a future feedback-derived feature; unused today | Class: operating | Writer: none | Readers: none | Since: 2026-05-22$c$;
COMMENT ON COLUMN archetype_tunable_variable.id IS $c$Surrogate primary key (UUID).$c$;
COMMENT ON COLUMN archetype_tunable_variable.archetype_id IS $c$References coffee_archetype.id (ON DELETE CASCADE).$c$;
COMMENT ON COLUMN archetype_tunable_variable.dimension_id IS $c$UUID of the tunable dimension (md5-derived style, no FK).$c$;
COMMENT ON COLUMN archetype_tunable_variable.display_name IS $c$Customer-facing label of the dial.$c$;
COMMENT ON COLUMN archetype_tunable_variable.min_offset IS $c$Lowest allowed offset from the archetype ideal, score points, default -2.0.$c$;
COMMENT ON COLUMN archetype_tunable_variable.max_offset IS $c$Highest allowed offset from the archetype ideal, score points, default 2.0.$c$;
COMMENT ON COLUMN archetype_tunable_variable.created_at IS $c$UTC timestamp when the row was created.$c$;
-- ── user_vector_state ──
COMMENT ON TABLE user_vector_state IS $c$Purpose: Retired 2026-10-16: per-user declared and behavioral score per flavor dimension from the original 2026-05 design; never written (0 rows), no code, and dimension_id is a UUID that cannot join coffee_dimensions (integer id); the live customer position is quiz_session_interpretation and user_bloom_dial_current_position; drop-later | Class: deprecated | Writer: none | Readers: none | Since: 2026-05-22$c$;
COMMENT ON COLUMN user_vector_state.user_id IS $c$References user_profile.id; part of the primary key (ON DELETE CASCADE).$c$;
COMMENT ON COLUMN user_vector_state.dimension_id IS $c$UUID of the flavor dimension (md5-derived style, no FK); part of the primary key.$c$;
COMMENT ON COLUMN user_vector_state.declared_score IS $c$Score the user stated; scale undefined, table unused.$c$;
COMMENT ON COLUMN user_vector_state.behavior_score IS $c$Score inferred from behavior; scale undefined, table unused.$c$;
COMMENT ON COLUMN user_vector_state.updated_at IS $c$UTC timestamp of last update.$c$;
-- ── user_archetype_tuning ──
COMMENT ON TABLE user_archetype_tuning IS $c$Purpose: Reserved for a user's personal offset per archetype dimension, held for a future computed signal; unused today | Class: operating | Writer: none | Readers: none | Since: 2026-05-22$c$;
COMMENT ON COLUMN user_archetype_tuning.user_id IS $c$References user_profile.id; part of the primary key (ON DELETE CASCADE).$c$;
COMMENT ON COLUMN user_archetype_tuning.archetype_id IS $c$References coffee_archetype.id; part of the primary key (ON DELETE CASCADE).$c$;
COMMENT ON COLUMN user_archetype_tuning.dimension_id IS $c$UUID of the dimension (md5-derived style, no FK); part of the primary key.$c$;
COMMENT ON COLUMN user_archetype_tuning.user_selected_offset IS $c$Offset the user chose from the archetype ideal, score points.$c$;
COMMENT ON COLUMN user_archetype_tuning.updated_at IS $c$UTC timestamp of last update.$c$;

-- ── user_coffee_profile ──
COMMENT ON TABLE user_coffee_profile IS $c$Purpose: Retired 2026-10-16: ranked coffee-archetype matches per user from the original 2026-05 design; never written (0 rows), no code; the live equivalent is quiz_session plus quiz_session_interpretation (primary, secondary, explore); drop-later | Class: deprecated | Writer: none | Readers: none | Since: 2026-05-22$c$;
COMMENT ON COLUMN user_coffee_profile.id IS $c$Surrogate UUID primary key.$c$;
COMMENT ON COLUMN user_coffee_profile.user_id IS $c$FK to user_profile(id), ON DELETE CASCADE; the user the match belongs to.$c$;
COMMENT ON COLUMN user_coffee_profile.archetype_id IS $c$FK to coffee_archetype(id); the matched archetype.$c$;
COMMENT ON COLUMN user_coffee_profile.match_rank IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: rank of this archetype among the user's matches, never written.$c$;
COMMENT ON COLUMN user_coffee_profile.match_confidence IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: numeric confidence of the match; scale undefined, table unused.$c$;
COMMENT ON COLUMN user_coffee_profile.is_active IS $c$True while this match row is the live one for the user; default true.$c$;
COMMENT ON COLUMN user_coffee_profile.assigned_at IS $c$UTC timestamp when the match was assigned; defaults to insert time.$c$;
-- ── coffee_sku ──
COMMENT ON TABLE coffee_sku IS $c$Purpose: Sellable bag-size variant (SKU) of one coffee at one roaster, carrying Shopify variant, roaster SKU and wholesale cost. | Class: master | Writer: catalogService.upsertSkuInTx, catalogService.retireCoffee, catalogService.restoreCoffee, catalogService.deactivateRoastery, catalogService.reactivateRoastery; seed | Readers: v_coffee_sellable_candidate, v_coffee_visibility, v_customer_bag_attribution, v_customer_timeline, catalogReads, blendResolver, orders, qrDoor, +6 more | Since: 2026-05-22 (as blend then roaster_blend; renamed coffee_sku 2026-09-16, Catalog Blueprint brief 5b)$c$;
COMMENT ON COLUMN coffee_sku.id IS $c$Surrogate UUID primary key; referenced by order_line_item.blend_id, roastery_blend_vector.blend_id and sommelier_sms_feedback.blend_id.$c$;
COMMENT ON COLUMN coffee_sku.roaster_id IS $c$FK to roaster(id); the roastery that fulfils this SKU, copied from coffees.roaster_id when the SKU is created.$c$;
COMMENT ON COLUMN coffee_sku.blend_name IS $c$Display name of the SKU; defaults to the coffee's name on insert and is used by the coffee_id name-match backfill.$c$;
COMMENT ON COLUMN coffee_sku.shopify_variant_id IS $c$Shopify variant ID passed to Shopify when an order for this SKU is placed; NULL until mapped.$c$;
COMMENT ON COLUMN coffee_sku.roaster_sku IS $c$The roaster's own SKU code for this bag size; NULL if not set.$c$;
COMMENT ON COLUMN coffee_sku.cost_to_us IS $c$Wholesale cost to Axis and Bloom for one bag of this SKU in USD dollars (admin field "Cost to us ($)", two decimals); written by catalogService.upsertSkuInTx from Admin Supply and Inventory and from catalog import, shown in Admin Supply and Inventory, read by no customer-facing path.$c$;
COMMENT ON COLUMN coffee_sku.is_active IS $c$True while the SKU is available from the roaster (the only availability lever; false = Paused); set false by coffee or roastery retirement.$c$;
COMMENT ON COLUMN coffee_sku.coffee_type IS $c$Class: deprecated | DEPRECATED 2026-10-16: never read or written, always the default blend; the kind of coffee is coffees.blend_or_single.$c$;
COMMENT ON COLUMN coffee_sku.weight_oz IS $c$Bag size in ounces; FK to coffee_size(weight_oz) (sizes 12 oz anchor, 2 lb, 5 lb); at most one active SKU per coffee_id and size.$c$;
COMMENT ON COLUMN coffee_sku.inventory_status IS $c$Class: deprecated | DEPRECATED 2026-09-30: drop-ship model, stock not tracked; not read or written by the app.$c$;
COMMENT ON COLUMN coffee_sku.quantity_available IS $c$Class: deprecated | DEPRECATED 2026-09-30: drop-ship model, stock not tracked; not read or written by the app.$c$;
COMMENT ON COLUMN coffee_sku.safety_stock_buffer IS $c$Class: deprecated | DEPRECATED 2026-09-30: drop-ship model, stock not tracked; not read or written by the app.$c$;
COMMENT ON COLUMN coffee_sku.inventory_last_synced_at IS $c$Class: deprecated | DEPRECATED 2026-09-30: drop-ship model, stock not tracked; not read or written by the app.$c$;
COMMENT ON COLUMN coffee_sku.created_at IS $c$UTC timestamp when the SKU row was created.$c$;
COMMENT ON COLUMN coffee_sku.updated_at IS $c$UTC timestamp of the last SKU edit or activation change.$c$;
COMMENT ON COLUMN coffee_sku.coffee_id IS $c$FK to coffees(id), NOT NULL; the tasting-catalogue coffee this SKU is a size of.$c$;
COMMENT ON COLUMN coffee_sku.last_restocked_at IS $c$Class: deprecated | DEPRECATED 2026-09-30: drop-ship model, stock not tracked; not read or written by the app.$c$;
COMMENT ON COLUMN coffee_sku.deactivated_at IS $c$UTC timestamp when the SKU was deactivated; NULL while active.$c$;
COMMENT ON COLUMN coffee_sku.deactivation_reason IS $c$Why the SKU was deactivated. One of: roaster, manual. NULL while active; roaster = cascaded from roastery deactivation, manual = coffee retired by an admin.$c$;
-- ── roastery_blend_vector ──
COMMENT ON TABLE roastery_blend_vector IS $c$Purpose: Retired 2026-10-16: per-SKU score on each flavor dimension from the original 2026-05 design; never written (0 rows), no code, and dimension_id is a UUID that cannot join coffee_dimensions (integer id); the live model scores coffees, not SKUs, through the cupping tables and the Bloom Dial placement (coffee_dial_slot); drop-later | Class: deprecated | Writer: none | Readers: none | Since: 2026-05-22 (as blend_vector)$c$;
COMMENT ON COLUMN roastery_blend_vector.blend_id IS $c$FK to coffee_sku(id), ON DELETE CASCADE; part of the primary key.$c$;
COMMENT ON COLUMN roastery_blend_vector.dimension_id IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: UUID with no FK that cannot join coffee_dimensions (integer id); part of the primary key.$c$;
COMMENT ON COLUMN roastery_blend_vector.score IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: numeric score of the SKU on that dimension; scale undefined, table unused.$c$;
-- ── user_roaster_link ──
COMMENT ON TABLE user_roaster_link IS $c$Purpose: Retired 2026-10-16: link from a user account to the roastery they work at, from the original 2026-05 design; never written (0 rows), no code; roastery people reach us through roastery_portal_link tokens and roastery_portal_respondent, not accounts; drop-later | Class: deprecated | Writer: none | Readers: none | Since: 2026-05-22$c$;
COMMENT ON COLUMN user_roaster_link.user_id IS $c$FK to user_profile(id), ON DELETE CASCADE; part of the primary key.$c$;
COMMENT ON COLUMN user_roaster_link.roaster_id IS $c$FK to roaster(id), ON DELETE CASCADE; part of the primary key.$c$;
COMMENT ON COLUMN user_roaster_link.role_at_roastery IS $c$Free-text role of the user at that roastery; NULL if not set.$c$;
COMMENT ON COLUMN user_roaster_link.created_at IS $c$UTC timestamp when the link was created.$c$;
-- ── quiz_question ──
COMMENT ON TABLE quiz_question IS $c$Purpose: Versioned (SCD Type 2) questions of each quiz, one row per question version. | Class: operating | Writer: seed | Readers: routes/quiz, quizScorer, quizIntegrity, v_quiz_scoring_matrix, quiz_answer joins | Since: 2026-05-22 (as question; SCD2 versioning 2026-10-09, Prompt 4A)$c$;
COMMENT ON COLUMN quiz_question.id IS $c$Surrogate UUID primary key; one per question version, referenced by quiz_answer.question_id.$c$;
COMMENT ON COLUMN quiz_question.quiz_id IS $c$FK to quiz(id), ON DELETE CASCADE; the quiz (main or branch) this question belongs to.$c$;
COMMENT ON COLUMN quiz_question.q_number IS $c$Position of the question within its quiz; with quiz_id it is the business key (one current row per quiz_id and q_number).$c$;
COMMENT ON COLUMN quiz_question.q_text IS $c$Question wording shown to the customer.$c$;
COMMENT ON COLUMN quiz_question.weight IS $c$Question-level multiplier applied to all its answers when scoring (q_weight x answer weight x answer score); default 1, 0 means no scoring.$c$;
COMMENT ON COLUMN quiz_question.valid_from IS $c$UTC timestamp when this question version became current (SCD2); defaults to now.$c$;
COMMENT ON COLUMN quiz_question.valid_to IS $c$UTC timestamp when this version was retired; NULL while current.$c$;
COMMENT ON COLUMN quiz_question.is_current IS $c$True for the live version of the question, false once retired; CHECK ties it to valid_to being NULL.$c$;
-- ── quiz_answer ──
COMMENT ON TABLE quiz_answer IS $c$Purpose: Versioned (SCD Type 2) answer options for each quiz question, with the archetype each maps to. | Class: operating | Writer: seed | Readers: routes/quiz, quizScorer, quizIntegrity, v_quiz_scoring_matrix, v_customer_quiz_current, v_subscriber_quiz_results, +1 more | Since: 2026-05-22 (as answer; SCD2 versioning 2026-10-09, Prompt 4A)$c$;
COMMENT ON COLUMN quiz_answer.id IS $c$Surrogate UUID primary key; one per answer version, persisted in sessions as answerIds and referenced by quiz_answer_archetype_score and quiz_session.branch_answer_id.$c$;
COMMENT ON COLUMN quiz_answer.question_id IS $c$FK to quiz_question(id), ON DELETE CASCADE; the question version this answer belongs to.$c$;
COMMENT ON COLUMN quiz_answer.answer_text IS $c$Answer wording shown to the customer.$c$;
COMMENT ON COLUMN quiz_answer.next_question_id IS $c$Class: deprecated | DEPRECATED 2026-10-16: legacy branching pointer (FK to quiz_question) that no seed ever set and no code reads, always NULL; the SCD2 version function only copies it forward; branching is quiz.trigger_archetype_id and quiz.parent_quiz_id.$c$;
COMMENT ON COLUMN quiz_answer.resulting_archetype_id IS $c$FK to coffee_archetype(id); the archetype this answer maps to; NULL if none.$c$;
COMMENT ON COLUMN quiz_answer.vector_impact IS $c$Class: deprecated | DEPRECATED 2026-10-16: legacy JSONB per-dimension impact that no seed ever set and no code reads, always NULL; the SCD2 version function only copies it forward; scoring is quiz_answer_archetype_score.$c$;
COMMENT ON COLUMN quiz_answer.weight IS $c$Answer-level multiplier used in scoring (q_weight x answer weight x score); default 1.$c$;
COMMENT ON COLUMN quiz_answer.is_experimental_gate IS $c$Flags an answer that counts toward the Experimental archetype gate in scoring; default false.$c$;
COMMENT ON COLUMN quiz_answer.answer_code IS $c$Stable version-scoped code (for example v7_q1_a) that decouples scoring from answer copy; unique among current rows; NULL on retired v5/v6 rows.$c$;
COMMENT ON COLUMN quiz_answer.valid_from IS $c$UTC timestamp when this answer version became current (SCD2); defaults to now.$c$;
COMMENT ON COLUMN quiz_answer.valid_to IS $c$UTC timestamp when this version was retired; NULL while current.$c$;
COMMENT ON COLUMN quiz_answer.is_current IS $c$True for the live version of the answer, false once retired; CHECK ties it to valid_to being NULL.$c$;
COMMENT ON COLUMN quiz_answer.sort_order IS $c$Display position of the answer within its question (smallint); set once, current answers served in this order.$c$;
-- ── quiz_session ──
COMMENT ON TABLE quiz_session IS $c$Purpose: One completed quiz taken by a user (immutable fact; interpretations live in quiz_session_interpretation). | Class: fact | Writer: quizSession.saveQuizSession | Readers: v_customer_quiz_current, v_subscriber_quiz_results, v_quiz_session_interpretation_history, users, behavioralConfidence, customerReads, customerIntegrity, +2 more | Since: 2026-05-22$c$;
COMMENT ON COLUMN quiz_session.id IS $c$Surrogate UUID primary key; referenced by quiz_session_interpretation.quiz_session_id.$c$;
COMMENT ON COLUMN quiz_session.user_id IS $c$FK to user_profile(id), ON DELETE CASCADE; the user who took the quiz.$c$;
COMMENT ON COLUMN quiz_session.resulting_archetype_id IS $c$FK to coffee_archetype(id); the archetype shown to the customer as their result.$c$;
COMMENT ON COLUMN quiz_session.context_data IS $c$JSONB of the scored result as returned by /api/quiz/score (secondary archetype, food signal, recommendation mode, experimental flag, answerIds and more); written once, never updated.$c$;
COMMENT ON COLUMN quiz_session.completed_at IS $c$UTC timestamp when the session was saved; defaults to insert time.$c$;
COMMENT ON COLUMN quiz_session.branch_answer_id IS $c$FK to quiz_answer(id); the branch-quiz answer the person picked (WHY layer); NULL for sessions without a branch answer and all historical sessions.$c$;
-- ── quiz_vector ──
COMMENT ON TABLE quiz_vector IS $c$Purpose: Retired 2026-10-16: per-dimension scores for a quiz session from the original 2026-05 design; never written (0 rows), no code, and dimension_id is a UUID that cannot join coffee_dimensions (integer id); quiz scoring is quiz_answer_archetype_score and the result lives in quiz_session.context_data and quiz_session_interpretation; drop-later | Class: deprecated | Writer: none | Readers: none | Since: 2026-05-22$c$;
COMMENT ON COLUMN quiz_vector.id IS $c$Surrogate UUID primary key.$c$;
COMMENT ON COLUMN quiz_vector.user_id IS $c$FK to user_profile(id), ON DELETE CASCADE; the user the scores belong to.$c$;
COMMENT ON COLUMN quiz_vector.quiz_session_id IS $c$FK to quiz_session(id), ON DELETE CASCADE; the session the scores came from.$c$;
COMMENT ON COLUMN quiz_vector.dimension_id IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: UUID with no FK that cannot join coffee_dimensions (integer id).$c$;
COMMENT ON COLUMN quiz_vector.score IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: numeric score on that dimension; scale undefined, table unused.$c$;
-- ── quiz_answer_archetype_score ──
COMMENT ON TABLE quiz_answer_archetype_score IS $c$Purpose: Scoring matrix, points each answer version awards to an archetype (insert-only, a different score means a new answer version). | Class: operating | Writer: seed | Readers: quizScorer, quizIntegrity, v_quiz_scoring_matrix | Since: 2026-05-25 (as answer_archetype_score)$c$;
COMMENT ON COLUMN quiz_answer_archetype_score.id IS $c$Surrogate UUID primary key.$c$;
COMMENT ON COLUMN quiz_answer_archetype_score.answer_id IS $c$FK to quiz_answer(id), ON DELETE CASCADE; the answer version being scored; UNIQUE with archetype_id.$c$;
COMMENT ON COLUMN quiz_answer_archetype_score.question_id IS $c$FK to quiz_question(id), ON DELETE CASCADE; the question version the answer belongs to (denormalized from the answer).$c$;
COMMENT ON COLUMN quiz_answer_archetype_score.archetype_id IS $c$FK to coffee_archetype(id), ON DELETE SET NULL; the archetype awarded points; NULL means a neutral answer that awards no points.$c$;
COMMENT ON COLUMN quiz_answer_archetype_score.score IS $c$Points added to the archetype for this answer (positive or negative number, multiplied by question and answer weights); default 0.$c$;
-- ── subscription ──
COMMENT ON TABLE subscription IS $c$Purpose: Recurring-delivery subscription of a user; in current code only company-sponsored subscriptions are created. | Class: operating | Writer: companyGiftRedemption.POST /api/company-gift-redemption/:code/redeem, cron.GET /api/cron/sponsored-subscription-check | Readers: userSignals, liamAccess, users, catalogService, cron | Since: 2026-05-22$c$;
COMMENT ON COLUMN subscription.id IS $c$Surrogate UUID primary key.$c$;
COMMENT ON COLUMN subscription.user_id IS $c$FK to user_profile(id), ON DELETE CASCADE; the subscriber (matched directly, never via household).$c$;
COMMENT ON COLUMN subscription.household_id IS $c$FK to household(id), the household the subscription belongs to; reserved, not written yet (only company-sponsored subscriptions are inserted today, by companyGiftRedemption).$c$;
COMMENT ON COLUMN subscription.status IS $c$Subscription state, default active. Code writes only: active, lapsed (cron flips expired sponsored rows to lapsed); no CHECK constraint.$c$;
COMMENT ON COLUMN subscription.frequency_days IS $c$Days between deliveries, default 30; reserved for the Stripe subscription flow, not written yet (sponsored subscriptions keep the default).$c$;
COMMENT ON COLUMN subscription.next_delivery_date IS $c$Calendar date of the next scheduled delivery; reserved for the Stripe subscription flow, not written yet (NULL today).$c$;
COMMENT ON COLUMN subscription.created_at IS $c$Timestamp when the subscription row was created (timestamptz, default now()).$c$;
COMMENT ON COLUMN subscription.updated_at IS $c$Timestamp of the last change (timestamptz); set by the sponsored-subscription cron when a row lapses.$c$;
COMMENT ON COLUMN subscription.company_gift_id IS $c$FK to company_gift(id); the sponsoring company for a gifted subscription; NULL for normal subscriptions.$c$;
COMMENT ON COLUMN subscription.sponsored_expires_at IS $c$UTC timestamp when a sponsored subscription ends (redemption time plus the gift's sponsorship months); NULL for normal subscriptions.$c$;
-- ── order ──
COMMENT ON TABLE "order" IS $c$Purpose: One checkout order placed through the site and mirrored to Shopify, with a shipping-address snapshot (immutable fact). | Class: fact | Writer: orders.POST /api/orders | Readers: orders, users, userSignals, qrDoor, catalogService, brewCard, behavioralConfidence, +4 more | Since: 2026-05-22$c$;
COMMENT ON COLUMN "order".id IS $c$Surrogate UUID primary key; referenced by order_line_item.order_id, roastery_shipment_details.order_id and notification_log.order_id.$c$;
COMMENT ON COLUMN "order".user_id IS $c$FK to user_profile(id); the buyer.$c$;
COMMENT ON COLUMN "order".household_id IS $c$FK to household(id); never set by any code path (confirmed in Customer Blueprint C2 Task 0), always NULL.$c$;
COMMENT ON COLUMN "order".external_shopify_order_id IS $c$ID of the matching order in Shopify, returned when the order was created there.$c$;
COMMENT ON COLUMN "order".fulfillment_status IS $c$Fulfilment state as free text, written as pending at checkout and never updated today; catalogService (open orders per roaster) treats delivered and cancelled as closed, while the Stripe brief plans pending, awaiting_manual, placed, shipped, delivered, canceled, needs_attention; that brief must settle the canceled vs cancelled spelling before any CHECK is added.$c$;
COMMENT ON COLUMN "order".is_subscription IS $c$True if the order is a subscription renewal, default false; reserved for the Stripe brief (createSubscriptionOrder sets it), never written today.$c$;
COMMENT ON COLUMN "order".subtotal IS $c$Sum of line prices times quantity in dollars (numeric, not cents), computed at checkout.$c$;
COMMENT ON COLUMN "order".shipping_fee_charged IS $c$Shipping fee charged to the customer in USD dollars (same unit as total_amount_paid), default 0.00; reserved for the Stripe brief, never written today.$c$;
COMMENT ON COLUMN "order".taxes_collected IS $c$Sales tax collected in USD dollars (same unit as total_amount_paid), default 0.00; reserved for the Stripe brief (automatic tax), never written today.$c$;
COMMENT ON COLUMN "order".transaction_fee IS $c$Payment-processing fee in USD dollars (same unit as total_amount_paid), default 0.00; reserved for the Stripe brief (from the balance transaction), never written today.$c$;
COMMENT ON COLUMN "order".total_amount_paid IS $c$Amount paid in dollars; at checkout it is set equal to subtotal (no shipping or tax added).$c$;
COMMENT ON COLUMN "order".currency IS $c$ISO currency code of the amounts; always the default USD, never set by code.$c$;
COMMENT ON COLUMN "order".promo_code IS $c$Promo code applied to the order; reserved, never written today (NULL); the Stripe brief decides whether Stripe promotion codes are mirrored here.$c$;
COMMENT ON COLUMN "order".created_at IS $c$UTC timestamp when the order row was created.$c$;
COMMENT ON COLUMN "order".updated_at IS $c$UTC timestamp of the last change; no code updates the row after insert.$c$;
COMMENT ON COLUMN "order".shipping_street IS $c$Street line of the shipping address snapshot copied at checkout.$c$;
COMMENT ON COLUMN "order".shipping_city IS $c$City of the shipping address snapshot copied at checkout.$c$;
COMMENT ON COLUMN "order".shipping_state IS $c$State or province of the shipping address snapshot copied at checkout.$c$;
COMMENT ON COLUMN "order".shipping_postal_code IS $c$Postal or ZIP code of the shipping address snapshot copied at checkout.$c$;
COMMENT ON COLUMN "order".shipping_country IS $c$Country of the shipping address snapshot copied at checkout.$c$;
COMMENT ON COLUMN "order".shipping_address_id IS $c$FK to address(id); the saved address the snapshot was copied from (convenience pointer only, the snapshot columns are the source of truth).$c$;
-- ── roastery_shipment_details ──
COMMENT ON TABLE roastery_shipment_details IS $c$Purpose: Reserved for the Stripe payment-capture brief (features/commerce): tracking and postage details of a roastery shipment for an order, to be written by the admin shipped endpoint; not written yet (0 rows), no code today | Class: operating | Writer: none | Readers: none | Since: 2026-05-22 (as shipment)$c$;
COMMENT ON COLUMN roastery_shipment_details.id IS $c$Surrogate UUID primary key; referenced by order_line_item.shipment_id.$c$;
COMMENT ON COLUMN roastery_shipment_details.order_id IS $c$FK to "order"(id); the order being shipped.$c$;
COMMENT ON COLUMN roastery_shipment_details.roaster_id IS $c$FK to roaster(id); the roastery that ships it.$c$;
COMMENT ON COLUMN roastery_shipment_details.tracking_number IS $c$Carrier tracking number.$c$;
COMMENT ON COLUMN roastery_shipment_details.carrier IS $c$Carrier name.$c$;
COMMENT ON COLUMN roastery_shipment_details.status IS $c$Shipment state as free text, default label_created; reserved for the Stripe brief's admin shipped endpoint (sets shipped), no CHECK until that vocabulary is settled, never written today.$c$;
COMMENT ON COLUMN roastery_shipment_details.postage_cost IS $c$Postage cost in USD dollars (the unit every money column in this schema uses); reserved, never written today.$c$;
COMMENT ON COLUMN roastery_shipment_details.shipped_at IS $c$UTC timestamp when the shipment left the roastery.$c$;
COMMENT ON COLUMN roastery_shipment_details.estimated_delivery IS $c$UTC timestamp of the carrier's estimated delivery.$c$;
COMMENT ON COLUMN roastery_shipment_details.created_at IS $c$UTC timestamp when the row was created.$c$;
COMMENT ON COLUMN roastery_shipment_details.updated_at IS $c$UTC timestamp of the last change.$c$;
-- ── order_line_item ──
COMMENT ON TABLE order_line_item IS $c$Purpose: One purchased SKU line of an order, with price paid and who it is for (immutable fact). | Class: fact | Writer: orders.POST /api/orders; seed | Readers: v_customer_bag_attribution, v_customer_timeline, v_palate_evidence, v_palate_recommendation_outcome, orders, qrDoor, users, customerReads, +5 more | Since: 2026-05-22$c$;
COMMENT ON COLUMN order_line_item.id IS $c$Surrogate UUID primary key; referenced by customer fact tables as order_line_item_id.$c$;
COMMENT ON COLUMN order_line_item.order_id IS $c$FK to "order"(id), ON DELETE CASCADE; the parent order.$c$;
COMMENT ON COLUMN order_line_item.blend_id IS $c$FK to coffee_sku(id); the SKU purchased (the column keeps its pre-rename name).$c$;
COMMENT ON COLUMN order_line_item.intended_for_user_id IS $c$FK to user_profile(id); the person the bag is for, defaults to the buyer unless the client passes another user.$c$;
COMMENT ON COLUMN order_line_item.shipment_id IS $c$FK to roastery_shipment_details(id), the shipment carrying this line; reserved for the Stripe brief, never written today.$c$;
COMMENT ON COLUMN order_line_item.quantity IS $c$Number of bags on this line; NOT NULL, default 1.$c$;
COMMENT ON COLUMN order_line_item.unit_price_charged IS $c$Price per bag charged, in dollars (numeric, not cents).$c$;
COMMENT ON COLUMN order_line_item.wholesale_cost IS $c$Wholesale cost of the line in USD dollars (same unit as coffee_sku.cost_to_us); reserved for roaster payout reconciliation, never written today.$c$;
COMMENT ON COLUMN order_line_item.discount_amount IS $c$Discount applied to this line, in dollars; only collection bundle member lines carry a non-zero value (10 percent bundle discount split across members); default 0.00.$c$;
COMMENT ON COLUMN order_line_item.tax_amount_charged IS $c$Sales tax charged on the line in USD dollars, default 0.00; reserved for the Stripe brief, never written today.$c$;
COMMENT ON COLUMN order_line_item.vendor_payout_status IS $c$Roastery payout state as free text, default pending_invoice; reserved for roaster payout reconciliation, no CHECK until that vocabulary exists, never written today.$c$;
COMMENT ON COLUMN order_line_item.created_at IS $c$UTC timestamp when the line was created.$c$;
COMMENT ON COLUMN order_line_item.updated_at IS $c$UTC timestamp of the last change; no code updates the row after insert.$c$;
COMMENT ON COLUMN order_line_item.order_kind IS $c$FK to customer_order_kind(code); how the line originated, default manual. Code only ever writes manual (gift_redemption, subscription_renewal and liam_followed have no writer yet).$c$;
-- ── user_lifecycle_stage ──
COMMENT ON TABLE user_lifecycle_stage IS $c$Purpose: Lookup of business/marketing lifecycle stages a user can be in (flat classification, no enforced sequence). | Class: operating | Writer: seed | Readers: userLifecycle.refreshLifecycleState, users.GET /api/users/homepage-state | Since: 2026-07-07$c$;
COMMENT ON COLUMN user_lifecycle_stage.id IS $c$Serial integer primary key; referenced by user_lifecycle_state.stage_id and user_lifecycle_event.from_stage_id and to_stage_id.$c$;
COMMENT ON COLUMN user_lifecycle_stage.code IS $c$Unique stage code in upper snake case (for example QUIZ_TAKEN_FRESH_NO_ORDER); the key code looks stages up by.$c$;
COMMENT ON COLUMN user_lifecycle_stage.label IS $c$Admin-facing name of the stage.$c$;
COMMENT ON COLUMN user_lifecycle_stage.description IS $c$Plain-language rule for when a user is in this stage.$c$;
COMMENT ON COLUMN user_lifecycle_stage.sort_order IS $c$Display order of the stage (seeded 10, 20 and so on); default 0.$c$;
COMMENT ON COLUMN user_lifecycle_stage.homepage_enabled IS $c$True if the stage drives a homepage call to action; default true.$c$;
COMMENT ON COLUMN user_lifecycle_stage.is_active IS $c$True while the stage can be assigned; FIRST_ORDER_FEEDBACK_PENDING is set false by schema.sql; default true.$c$;
COMMENT ON COLUMN user_lifecycle_stage.created_at IS $c$UTC timestamp when the stage row was created.$c$;
-- ── user_lifecycle_state ──
COMMENT ON TABLE user_lifecycle_state IS $c$Purpose: Current lifecycle stage of each user, one row per user, read at page view time. | Class: operating | Writer: userLifecycle.refreshLifecycleState | Readers: users.GET /api/users/homepage-state, userLifecycle.refreshLifecycleState | Since: 2026-07-07$c$;
COMMENT ON COLUMN user_lifecycle_state.user_id IS $c$FK to user_profile(id), ON DELETE CASCADE; primary key, one row per user.$c$;
COMMENT ON COLUMN user_lifecycle_state.stage_id IS $c$FK to user_lifecycle_stage(id); the user's current stage.$c$;
COMMENT ON COLUMN user_lifecycle_state.computed_at IS $c$UTC timestamp of the last recompute, refreshed even when the stage did not change.$c$;
-- ── user_lifecycle_event ──
COMMENT ON TABLE user_lifecycle_event IS $c$Purpose: Append-only history of lifecycle stage changes per user, for funnels and cohorts. | Class: operating | Writer: userLifecycle.refreshLifecycleState | Readers: none | Since: 2026-07-07$c$;
COMMENT ON COLUMN user_lifecycle_event.id IS $c$Serial integer primary key.$c$;
COMMENT ON COLUMN user_lifecycle_event.user_id IS $c$FK to user_profile(id), ON DELETE CASCADE; the user who changed stage.$c$;
COMMENT ON COLUMN user_lifecycle_event.from_stage_id IS $c$FK to user_lifecycle_stage(id); the stage left; NULL on a user's first event.$c$;
COMMENT ON COLUMN user_lifecycle_event.to_stage_id IS $c$FK to user_lifecycle_stage(id); the stage entered.$c$;
COMMENT ON COLUMN user_lifecycle_event.transitioned_at IS $c$UTC timestamp when the stage change was recorded.$c$;
-- ── notification_log ──
COMMENT ON TABLE notification_log IS $c$Purpose: Log of outbound notifications sent; in current code only the SMS feedback requests are logged. | Class: operating | Writer: smsProvider.logToNotificationLog | Readers: none | Since: 2026-05-22$c$;
COMMENT ON COLUMN notification_log.id IS $c$Surrogate UUID primary key.$c$;
COMMENT ON COLUMN notification_log.user_id IS $c$FK to user_profile(id); the recipient user.$c$;
COMMENT ON COLUMN notification_log.order_id IS $c$FK to "order"(id); never set by current code, always NULL.$c$;
COMMENT ON COLUMN notification_log.channel IS $c$Delivery channel; code writes only sms (no CHECK constraint).$c$;
COMMENT ON COLUMN notification_log.message_type IS $c$Kind of message; code writes only liam_feedback_request (no CHECK constraint).$c$;
COMMENT ON COLUMN notification_log.recipient_contact IS $c$Phone number or address the message was sent to.$c$;
COMMENT ON COLUMN notification_log.delivery_status IS $c$Send outcome, default pending; code writes sent or failed (no CHECK constraint).$c$;
COMMENT ON COLUMN notification_log.external_provider_id IS $c$Provider message ID (Twilio message SID) returned on send; NULL on failure.$c$;
COMMENT ON COLUMN notification_log.metadata IS $c$JSONB of extra context; code writes liamSmsFeedbackId, the sommelier_sms_feedback row id.$c$;
COMMENT ON COLUMN notification_log.sent_at IS $c$UTC timestamp when the log row was written (default now), not a provider delivery time.$c$;
-- ── sommelier_sms_feedback ──
COMMENT ON TABLE sommelier_sms_feedback IS $c$Purpose: One row per SMS message (outbound and inbound) of the post-delivery and dial-in beat feedback loop, with scheduling and parsed reply. | Class: operating | Writer: cron.GET /api/cron/beat-dial-in-send, cron.POST /api/webhooks/sms/inbound, cron.processDueDialInBeats, liamSmsFeedback.processPendingMessages, liamSmsFeedback.parseInboundReply, liamSmsFeedback.schedulePostDeliveryMessage | Readers: liamSmsFeedback, cron | Since: 2026-06-26$c$;
COMMENT ON COLUMN sommelier_sms_feedback.id IS $c$Surrogate UUID primary key.$c$;
COMMENT ON COLUMN sommelier_sms_feedback.user_id IS $c$FK to user_profile(id), ON DELETE CASCADE; the user the SMS is to or from.$c$;
COMMENT ON COLUMN sommelier_sms_feedback.order_id IS $c$FK to "order"(id); the order the message is about; only set on legacy post-delivery rows and inbound replies copied from them. | Writer: liamSmsFeedback.schedulePostDeliveryMessage (no live caller), cron.POST /api/webhooks/sms/inbound$c$;
COMMENT ON COLUMN sommelier_sms_feedback.blend_id IS $c$FK to coffee_sku(id); the SKU the message is about; NULL on beat dial-in rows.$c$;
COMMENT ON COLUMN sommelier_sms_feedback.phone_number IS $c$Phone number the message was sent to or received from.$c$;
COMMENT ON COLUMN sommelier_sms_feedback.direction IS $c$Message direction. One of: outbound, inbound.$c$;
COMMENT ON COLUMN sommelier_sms_feedback.body IS $c$Text of the SMS.$c$;
COMMENT ON COLUMN sommelier_sms_feedback.status IS $c$Message state. One of: scheduled, sent, delivered, failed, replied, opted_out. Default scheduled; code sets scheduled, sent, failed and replied. | Writer: liamSmsFeedback.processPendingMessages, cron.POST /api/webhooks/sms/inbound$c$;
COMMENT ON COLUMN sommelier_sms_feedback.scheduled_for IS $c$UTC timestamp when an outbound message becomes due for sending; NULL on inbound rows.$c$;
COMMENT ON COLUMN sommelier_sms_feedback.sent_at IS $c$UTC timestamp when an outbound message was sent, or when an inbound message was received. | Writer: liamSmsFeedback.processPendingMessages, cron.POST /api/webhooks/sms/inbound$c$;
COMMENT ON COLUMN sommelier_sms_feedback.provider_message_id IS $c$SMS provider message ID returned on send; NULL until sent. | Writer: liamSmsFeedback.processPendingMessages$c$;
COMMENT ON COLUMN sommelier_sms_feedback.reply_to_id IS $c$FK to sommelier_sms_feedback(id); on an inbound row, the outbound message it answers. | Writer: cron.POST /api/webhooks/sms/inbound$c$;
COMMENT ON COLUMN sommelier_sms_feedback.haiku_parsed IS $c$True once an inbound reply has been parsed; default false. | Writer: liamSmsFeedback.parseInboundReply$c$;
COMMENT ON COLUMN sommelier_sms_feedback.parsed_signal_type IS $c$Kind of signal parsed from the reply; code writes liam_sms. | Writer: liamSmsFeedback.parseInboundReply$c$;
COMMENT ON COLUMN sommelier_sms_feedback.parsed_rating IS $c$Rating parsed from the reply (integer, scale set by the parser). | Writer: liamSmsFeedback.parseInboundReply$c$;
COMMENT ON COLUMN sommelier_sms_feedback.parsed_sentiment IS $c$Sentiment parsed from the reply. One of: positive, negative, neutral. | Writer: liamSmsFeedback.parseInboundReply$c$;
COMMENT ON COLUMN sommelier_sms_feedback.parsed_descriptors IS $c$JSONB of flavor descriptors parsed from the reply. | Writer: liamSmsFeedback.parseInboundReply$c$;
COMMENT ON COLUMN sommelier_sms_feedback.firestore_feedback_doc_id IS $c$Legacy ID of a Firestore feedback document; no longer written since Customer Blueprint C3 Part C, so NULL on new rows.$c$;
COMMENT ON COLUMN sommelier_sms_feedback.created_at IS $c$UTC timestamp when the row was created.$c$;
COMMENT ON COLUMN sommelier_sms_feedback.message_kind IS $c$Which flow the message belongs to. One of: legacy_feedback, beat_dial_in. Default legacy_feedback; beat dial-in rows set beat_dial_in. | Writer: cron.GET /api/cron/beat-dial-in-send$c$;
COMMENT ON COLUMN sommelier_sms_feedback.beat_event_id IS $c$FK to beat_event(id); the dial-in beat an outbound message belongs to; NULL on legacy rows. | Writer: cron.GET /api/cron/beat-dial-in-send$c$;
-- ── sommelier_sessions ──
COMMENT ON TABLE sommelier_sessions IS $c$Purpose: One row per Liam (sommelier) chat session; messages live in Firestore. | Class: operating | Writer: sommelier.POST /api/sommelier/start, sommelier.POST /api/sommelier/:sessionId/message, sommelier.POST /api/sommelier/:sessionId/close | Readers: routes/sommelier, admin, engagementMetrics, scripts/backfillLiamRecommendations | Since: 2026-06-23$c$;
COMMENT ON COLUMN sommelier_sessions.id IS $c$Serial integer primary key; also the Firestore session document ID.$c$;
COMMENT ON COLUMN sommelier_sessions.uid IS $c$Firebase UID of the session owner (text, not a user_profile FK).$c$;
COMMENT ON COLUMN sommelier_sessions.intent IS $c$Entry intent the session was started with.$c$;
COMMENT ON COLUMN sommelier_sessions.started_at IS $c$Timestamp when the session started (timestamptz, default now()).$c$;
COMMENT ON COLUMN sommelier_sessions.last_active_at IS $c$Timestamp of the last turn or action; drives the resume window.$c$;
COMMENT ON COLUMN sommelier_sessions.turn_count IS $c$Number of turns taken so far; default 0.$c$;
COMMENT ON COLUMN sommelier_sessions.is_closed IS $c$True once the session is closed; default false.$c$;
COMMENT ON COLUMN sommelier_sessions.close_reason IS $c$Why the session closed. Code writes: turn_limit, daily_cap, user_closed (no CHECK); NULL while open.$c$;
COMMENT ON COLUMN sommelier_sessions.context_data IS $c$JSONB session state (intent, archetype, openingContext, ragFocus, coffeeIds, catalogText, evaluationId, topicLog and more), rewritten each turn.$c$;

-- ── sommelier_messages ──
COMMENT ON TABLE sommelier_messages IS $c$Purpose: Legacy pre-Firestore transcript of Liam chat turns, read only as a fallback for sessions created before 2026-06-27 | Class: deprecated | Writer: none | Readers: sommelier.GET /:sessionId/messages (fallback), customerIntegrity | Since: 2026-06-23 (Liam v1)$c$;
COMMENT ON COLUMN sommelier_messages.id IS $c$Surrogate primary key.$c$;
COMMENT ON COLUMN sommelier_messages.session_id IS $c$References sommelier_sessions.id (ON DELETE CASCADE): the Liam session this turn belonged to.$c$;
COMMENT ON COLUMN sommelier_messages.role IS $c$Who spoke this turn; code treats it as user or assistant (no CHECK constraint).$c$;
COMMENT ON COLUMN sommelier_messages.content IS $c$Full text of the turn.$c$;
COMMENT ON COLUMN sommelier_messages.model_used IS $c$Class: deprecated | DEPRECATED with its table (legacy pre-Firestore transcript): label of the model that produced an assistant turn in Liam v1, nine legacy rows, nothing writes it since the move to Firestore on 2026-06-27.$c$;
COMMENT ON COLUMN sommelier_messages.created_at IS $c$UTC timestamp the turn was stored; the fallback read orders by it.$c$;
-- ── user_brew_card ──
COMMENT ON TABLE user_brew_card IS $c$Purpose: One durable brew recipe card per customer, coffee and brew method that sharpens in place as the customer adjusts it | Class: operating | Writer: brewCard.generateCard, brewCard.createArrivalCard, brewCard.adjustCard, cron.processArrivalNotes | Readers: brewCard, users, engagementMetrics, cron | Since: 2026-08-02 (HOME_TASK_6)$c$;
COMMENT ON COLUMN user_brew_card.id IS $c$Surrogate primary key; referenced by brew_card_view_event.card_id.$c$;
COMMENT ON COLUMN user_brew_card.user_id IS $c$References user_profile.id (uuid, ON DELETE CASCADE): the customer who owns the card.$c$;
COMMENT ON COLUMN user_brew_card.coffee_id IS $c$References coffees.id (ON DELETE CASCADE): the coffee the card is for. UNIQUE together with user_id and method.$c$;
COMMENT ON COLUMN user_brew_card.method IS $c$Brew method key such as v60, french_press, espresso, moka, aeropress, cold_brew, drip or other; the list is Firestore-config driven (brew profile whitelist), not a Postgres enum.$c$;
COMMENT ON COLUMN user_brew_card.params IS $c$JSON recipe in customer language: ratio, grindLabel, tempC (degrees Celsius or null) and notes; computed deterministically by brewCard.computeRecipe with no LLM call.$c$;
COMMENT ON COLUMN user_brew_card.origin IS $c$How the card was created. One of: arrival_note, conversation.$c$;
COMMENT ON COLUMN user_brew_card.revision IS $c$Counter starting at 1, incremented by 1 on each in-place adjustment | Writer: brewCard.adjustCard$c$;
COMMENT ON COLUMN user_brew_card.last_adjustment_reason IS $c$Customer's own words (truncated) for the most recent adjustment; NULL until adjusted | Writer: brewCard.adjustCard$c$;
COMMENT ON COLUMN user_brew_card.arrival_email_scheduled_for IS $c$UTC timestamp when the arrival-note email becomes due (order time plus the configured delivery delay in days); NULL for conversation-created cards | Writer: brewCard.createArrivalCard$c$;
COMMENT ON COLUMN user_brew_card.arrival_email_sent_at IS $c$UTC timestamp the arrival-note email was sent; NULL until sent | Writer: cron.processArrivalNotes$c$;
COMMENT ON COLUMN user_brew_card.created_at IS $c$UTC timestamp the card row was created.$c$;
COMMENT ON COLUMN user_brew_card.updated_at IS $c$UTC timestamp of the last in-place adjustment (set to NOW by adjustCard; equals created_at until then) | Writer: brewCard.adjustCard$c$;
-- ── beat_event ──
COMMENT ON TABLE beat_event IS $c$Purpose: Dispatch and response ledger of Liam beats (order_placed, arrival_note, dial_in), one row per user, order and beat type | Class: operating | Writer: beatEngine.dispatchOrderPlacedBeat, beatEngine.dispatchDelayedBeats, beatEngine.respondToDialInBeat, cron.processDueDialInBeats; backfill:backfill-beat-respond-tokens | Readers: beatEngine, cron, beats, engagementMetrics | Since: 2026-08-02 (HOME_TASK_8)$c$;
COMMENT ON COLUMN beat_event.id IS $c$Surrogate primary key; never exposed in URLs (respond_token is the public handle).$c$;
COMMENT ON COLUMN beat_event.user_id IS $c$References user_profile.id (uuid, ON DELETE CASCADE): the customer the beat is for.$c$;
COMMENT ON COLUMN beat_event.order_id IS $c$References order.id (uuid, ON DELETE CASCADE): the order that triggered the beat.$c$;
COMMENT ON COLUMN beat_event.coffee_id IS $c$References coffees.id (ON DELETE CASCADE): the coffee the beat concerns.$c$;
COMMENT ON COLUMN beat_event.beat_type IS $c$Which beat this row is. One of: order_placed, arrival_note, dial_in. UNIQUE together with user_id and order_id, so a re-fired signal is a no-op.$c$;
COMMENT ON COLUMN beat_event.channel IS $c$Delivery channel. One of: sms, email, inline (inline = order-placed line injected into the order-confirmation response); NULL when the beat was skipped.$c$;
COMMENT ON COLUMN beat_event.scheduled_at IS $c$UTC timestamp the beat is due to be sent; for dial_in the cron sends it once this has passed and sent_at is NULL.$c$;
COMMENT ON COLUMN beat_event.sent_at IS $c$UTC timestamp the beat was delivered; set at insert for order_placed and by cron.processDueDialInBeats for dial_in (code never sets it for arrival_note) | Writer: beatEngine.dispatchOrderPlacedBeat, cron.processDueDialInBeats$c$;
COMMENT ON COLUMN beat_event.responded_at IS $c$UTC timestamp the customer responded to a dial_in beat; read by the degrade-on-silence counter and engagement metrics | Writer: beatEngine.respondToDialInBeat$c$;
COMMENT ON COLUMN beat_event.skip_reason IS $c$Why a beat that would otherwise fire was deliberately not sent; code writes inactive_config, repeat_coffee or degraded_silence, NULL when not skipped.$c$;
COMMENT ON COLUMN beat_event.created_at IS $c$UTC timestamp the row was created.$c$;
COMMENT ON COLUMN beat_event.updated_at IS $c$UTC timestamp defaulted to row creation; no code path updates it, so it does not track sent_at or responded_at changes.$c$;
COMMENT ON COLUMN beat_event.respond_token IS $c$Unguessable capability token (32 random bytes as hex) used in the public dial-in respond link instead of the id; unique | Writer: beatEngine (generateBeatRespondToken at insert), backfill (scripts/backfill-beat-respond-tokens.ts)$c$;
-- ── brew_card_view_event ──
COMMENT ON TABLE brew_card_view_event IS $c$Purpose: Coarse log of each render of a brew card in the Flavor Memory section, feeding the per-bag engagement rate | Class: operating | Writer: users.GET /api/users/flavor-memory (fire-and-forget insert) | Readers: engagementMetrics | Since: 2026-08-04 (HOME_TASK_9)$c$;
COMMENT ON COLUMN brew_card_view_event.id IS $c$Surrogate primary key.$c$;
COMMENT ON COLUMN brew_card_view_event.user_id IS $c$References user_profile.id (uuid, ON DELETE CASCADE): the customer who viewed the card.$c$;
COMMENT ON COLUMN brew_card_view_event.card_id IS $c$References user_brew_card.id (ON DELETE CASCADE): the card that was rendered.$c$;
COMMENT ON COLUMN brew_card_view_event.viewed_at IS $c$UTC timestamp of the render; deliberately not deduplicated, so rows are a per-render count and not unique viewers.$c$;
-- ── subscriber_source ──
COMMENT ON TABLE subscriber_source IS $c$Purpose: Reference list of where a newsletter signup came from (pre_launch, newsletter, post_quiz, footer) | Class: operating | Writer: seed | Readers: newsletter, admin, v_newsletter_subscribers, v_subscribers_weekly, v_subscriber_quiz_results, +1 more | Since: 2026-06-01$c$;
COMMENT ON COLUMN subscriber_source.id IS $c$Surrogate primary key; referenced by newsletter_subscriber.source_id.$c$;
COMMENT ON COLUMN subscriber_source.name IS $c$Machine key, unique. Seeded values: pre_launch, newsletter, post_quiz, footer.$c$;
COMMENT ON COLUMN subscriber_source.label IS $c$Human-readable label for reports, for example Pre-Launch Popup; re-applied from the seed on every schema run.$c$;
-- ── newsletter_subscriber ──
COMMENT ON TABLE newsletter_subscriber IS $c$Purpose: One row per marketing email address: consent state, signup source, quiz result and campaign attribution | Class: operating | Writer: newsletter.handleSubscribe, unsubscribe.unsubscribeByToken, unsubscribe.unsubscribeByEmail, unsubscribe.flip; seed; backfill:backfillUnsubscribeTokens; backfill:correct-subscriber-archetypes | Readers: v_newsletter_subscribers, v_subscriber_quiz_results, campaign_funnel_v, v_customer_calibration, newsletter, +9 more | Since: 2026-05-22$c$;
COMMENT ON COLUMN newsletter_subscriber.email IS $c$Primary key: the subscriber's address, lowercased and trimmed.$c$;
COMMENT ON COLUMN newsletter_subscriber.user_id IS $c$References user_profile.id (ON DELETE SET NULL): the signed-in account at signup time; the first non-null value is kept.$c$;
COMMENT ON COLUMN newsletter_subscriber.subscribed IS $c$Marketing consent and the single source of truth for suppression; true on signup, set false by unsubscribe, NULL is treated as subscribed | Writer: newsletter.handleSubscribe, unsubscribe.unsubscribeByToken, unsubscribe.unsubscribeByEmail$c$;
COMMENT ON COLUMN newsletter_subscriber.created_at IS $c$UTC timestamp of the first signup; re-subscribes do not change it.$c$;
COMMENT ON COLUMN newsletter_subscriber.source_id IS $c$References subscriber_source.id (ON DELETE SET NULL): where the first signup came from; first value wins.$c$;
COMMENT ON COLUMN newsletter_subscriber.first_name IS $c$Subscriber's first name as typed at signup; a later non-empty value replaces it.$c$;
COMMENT ON COLUMN newsletter_subscriber.archetype IS $c$Flavor archetype from the post-quiz signup, as text; for post_quiz signups only kept if backed by a scored quiz_funnel_event, and a quiz retake overwrites it | Writer: newsletter.handleSubscribe, one-off backfill (scripts/correct-subscriber-archetypes.ts)$c$;
COMMENT ON COLUMN newsletter_subscriber.experimental IS $c$True if the quiz result carried the experimental flag; NULL when the signup had no quiz result.$c$;
COMMENT ON COLUMN newsletter_subscriber.confidence IS $c$Quiz confidence label for the archetype, as text; NULL when the signup had no quiz result.$c$;
COMMENT ON COLUMN newsletter_subscriber.quiz_session_key IS $c$Client-generated quiz session key (matches quiz_funnel_event.session_key) tying the signup to a quiz run; not a foreign key.$c$;
COMMENT ON COLUMN newsletter_subscriber.campaign IS $c$Normalized marketing campaign slug that brought the signup (for example the Hoboken Coffee Crawl); first value wins | Writer: newsletter.handleSubscribe, one-off backfill (scripts/correct-subscriber-archetypes.ts)$c$;
COMMENT ON COLUMN newsletter_subscriber.campaign_vid IS $c$Visitor id (uuid) from the campaign link; only stored when campaign is valid.$c$;
COMMENT ON COLUMN newsletter_subscriber.campaign_attributed_at IS $c$UTC timestamp the campaign attribution was recorded; first value wins | Writer: newsletter.handleSubscribe, one-off backfill (scripts/correct-subscriber-archetypes.ts)$c$;
COMMENT ON COLUMN newsletter_subscriber.unsubscribe_token IS $c$Capability token (32 random bytes as hex) in the hosted unsubscribe link, unique and never rotated by a re-subscribe | Writer: newsletter.handleSubscribe, backfill (src/scripts/backfillUnsubscribeTokens.ts)$c$;
COMMENT ON COLUMN newsletter_subscriber.unsubscribed_at IS $c$UTC timestamp of the first unsubscribe; cleared to NULL by a form re-subscribe | Writer: unsubscribe.unsubscribeByToken, unsubscribe.unsubscribeByEmail, newsletter.handleSubscribe$c$;
COMMENT ON COLUMN newsletter_subscriber.unsubscribe_source IS $c$How the first unsubscribe happened; code writes one of: link, one_click, mailchimp, admin (no CHECK constraint); cleared to NULL by a re-subscribe | Writer: unsubscribe.unsubscribeByToken, unsubscribe.unsubscribeByEmail, newsletter.handleSubscribe$c$;
-- ── transactional_email_log ──
COMMENT ON TABLE transactional_email_log IS $c$Purpose: At-most-once claim log for backend-sent transactional email (Resend), one row per recipient and template | Class: operating | Writer: newsletter.sendQuizCompleteEmailOnce, roasteryPortalNotify.notifySubmission | Readers: quizIntegrity, scripts/audit-quiz-emails.mjs | Since: 2026-08-18 (Step 07/C3)$c$;
COMMENT ON COLUMN transactional_email_log.email IS $c$Recipient address (lowercased for quiz emails); part of the primary key with template. For roastery portal notices it is an admin address, not a subscriber.$c$;
COMMENT ON COLUMN transactional_email_log.template IS $c$Template key, part of the primary key; quiz_complete_v2 for the quiz-complete email, or roastery-portal-submit: followed by a portal response id. Bumping the key re-enables one send.$c$;
COMMENT ON COLUMN transactional_email_log.sent_at IS $c$UTC timestamp the send was claimed (set at claim time, before delivery; the claim row is deleted again if delivery fails).$c$;
COMMENT ON COLUMN transactional_email_log.archetype IS $c$Server-verified archetype baked into the sent quiz email; NULL for rows before 2026-09-25 and for non-quiz templates | Writer: newsletter.sendQuizCompleteEmailOnce$c$;
COMMENT ON COLUMN transactional_email_log.resend_message_id IS $c$Resend's message id for the delivered email; NULL for rows before 2026-09-25 or when Resend returned no id.$c$;
-- ── coffees ──
COMMENT ON TABLE coffees IS $c$Purpose: Coffee catalogue master: one row per coffee, owned by one roaster, with metadata, lifecycle flags, QR token and cached AI and story text | Class: master | Writer: admin.PATCH /api/admin/coffees/:id/story, catalogService.createCoffee, catalogService.updateCoffee, catalogService.retireCoffee, catalogService.createCoffeeInTx, catalogService.deactivateRoastery, catalogService.reactivateRoastery, catalogService.restoreCoffee, catalogService.updateCoffeeInTx, coffees.generateAndStoreAllContent, coffees.clearContentGenerationFlags, coffees.sanitizeStoredField, qrDoor.mintTokenForCoffee; seed | Readers: v_coffee, catalogReads, coffees, sommelier, v_archetype_dimension_profile, +11 more | Since: 2026-05-25$c$;
COMMENT ON COLUMN coffees.id IS $c$Surrogate primary key; the coffee id used across the catalog, cupping and customer tables.$c$;
COMMENT ON COLUMN coffees.name IS $c$Roaster's own raw coffee name (never shown to customers, who see platform aliases); unique per roaster among active coffees, compared trimmed and case-insensitively (coffees_active_natural_key).$c$;
COMMENT ON COLUMN coffees.origin IS $c$Free-text origin string (for example a country or blend description); kept server-side only.$c$;
COMMENT ON COLUMN coffees.blend_or_single IS $c$Blend or single origin. Values follow the lookup_value category blend_or_single: single, blend (no CHECK constraint).$c$;
COMMENT ON COLUMN coffees.process IS $c$Processing method. Values follow the lookup_value category process: washed, natural, honey, anaerobic, wet-hulled, other (no CHECK constraint).$c$;
COMMENT ON COLUMN coffees.roast_level IS $c$Roast level. Values follow the lookup_value category roast_level: light, light-medium, medium, medium-dark, dark (no CHECK constraint).$c$;
COMMENT ON COLUMN coffees.roast_shade IS $c$Roaster-supplied roast shade slug from the original catalog matrix, finer than roast_level (seed values light, light-medium, medium, medium-dark, dark, ultra-dark; NULL for flavored coffees); free text with no CHECK, carried through catalog import and the admin coffee save, not editable in the admin form, read by no customer-facing path.$c$;
COMMENT ON COLUMN coffees.flavor_descriptors_roaster IS $c$Array of the roaster's own bag tasting notes as text; the structured one-row-per-descriptor form lives in roastery_coffee_descriptors.$c$;
COMMENT ON COLUMN coffees.created_at IS $c$UTC timestamp the coffee row was created.$c$;
COMMENT ON COLUMN coffees.ai_summary IS $c$Retired from customer surfaces, coffee presentation brief 2 (2026-10-24): cached Claude-generated tasting summary, no longer generated, current values kept; still returned by GET /api/coffees/:id/content and /ai-summary for one release, rendered by nothing; NULLed if a stored value looks like a refusal | Writer: coffees.sanitizeStoredField$c$;
COMMENT ON COLUMN coffees.surprise_note IS $c$Retired from customer surfaces, coffee presentation brief 2 (2026-10-24): cached Claude-generated surprise note, no longer generated, current values kept; still returned by GET /api/coffees/:id/content for one release, rendered by nothing; NULLed if a stored value looks like a refusal | Writer: coffees.sanitizeStoredField$c$;
COMMENT ON COLUMN coffees.three_voice_story IS $c$The one description per coffee (coffee presentation brief 2): Claude-generated from the roaster's voice, shown under "In the roaster's words" on the reveal panel and Flavor Intelligence and in the admin "What the customer sees" block, and read by Liam's catalog context (sommelierRag: the Tasting note line and the editorial-completeness order); NULLed if a stored value looks like a refusal | Writer: coffees.generateAndStoreAllContent, coffees.sanitizeStoredField$c$;
COMMENT ON COLUMN coffees.origin_region_id IS $c$References lookup_value.id (category origin_region): the broad geographic bucket for the free-text origin; set by hand, never derived | Writer: catalogService.updateCoffee$c$;
COMMENT ON COLUMN coffees.story IS $c$Live customer-facing coffee story; only written from text that passed the specificity check or from an admin save | Writer: coffees.generateAndStoreAllContent, admin.PATCH /coffees/:id/story$c$;
COMMENT ON COLUMN coffees.story_draft IS $c$Latest story generation attempt even when it failed the specificity check, kept for admin review and never read by customers | Writer: coffees.generateAndStoreAllContent, admin.PATCH /coffees/:id/story$c$;
COMMENT ON COLUMN coffees.story_published IS $c$True once a story has passed the specificity check or been saved by an admin; the explicit gate for showing the story | Writer: coffees.generateAndStoreAllContent, admin.PATCH /coffees/:id/story$c$;
COMMENT ON COLUMN coffees.story_admin_edited IS $c$True once an admin hand-saved the story; bulk regeneration then skips this coffee | Writer: admin.PATCH /coffees/:id/story$c$;
COMMENT ON COLUMN coffees.story_generated_at IS $c$UTC timestamp of the last story write; set by automated generation and also by an admin save (docs say automated only, code does both) | Writer: coffees.generateAndStoreAllContent, admin.PATCH /coffees/:id/story$c$;
COMMENT ON COLUMN coffees.qr_token IS $c$Opaque 32-character hex token (randomBytes of 16) printed once as the coffee's QR code and resolved by the server per scan; unique where not NULL, never regenerated once set | Writer: qrDoor.mintTokenForCoffee, qrDoor.mintTokensForAllCoffees$c$;
COMMENT ON COLUMN coffees.ai_summary_generation_failed IS $c$True when Claude genuinely refused or failed to produce ai_summary on a real attempt; frozen since coffee presentation brief 2 (ai_summary is no longer generated), current values kept | Writer: none since coffee presentation brief 2 (was coffees.generateAndStoreAllContent, coffees.clearContentGenerationFlags)$c$;
COMMENT ON COLUMN coffees.surprise_note_generation_failed IS $c$True when Claude genuinely refused or failed to produce surprise_note on a real attempt; frozen since coffee presentation brief 2 (surprise_note is no longer generated), current values kept | Writer: none since coffee presentation brief 2 (was coffees.generateAndStoreAllContent, coffees.clearContentGenerationFlags)$c$;
COMMENT ON COLUMN coffees.three_voice_story_generation_failed IS $c$True when Claude genuinely refused or failed to produce three_voice_story on a real attempt, so the cron backfill skips it; reset by a successful forced retry | Writer: coffees.generateAndStoreAllContent, coffees.clearContentGenerationFlags (cleared on active coffees; the only flag it clears since coffee presentation brief 2)$c$;
COMMENT ON COLUMN coffees.story_generation_failed IS $c$True when story generation exhausted its retries without passing the specificity check, so the cron backfill skips it; reset by a successful run | Writer: coffees.generateAndStoreAllContent$c$;
COMMENT ON COLUMN coffees.roaster_id IS $c$References roaster.id (uuid, NOT NULL): the roastery that owns the coffee; set at creation and not changed by updateCoffee | Writer: catalogService.createCoffee, catalogService.createCoffeeInTx$c$;
COMMENT ON COLUMN coffees.is_active IS $c$False when the coffee is retired, either individually or by its roastery's deactivation; true on creation | Writer: catalogService.createCoffee, catalogService.retireCoffee, catalogService.restoreCoffee, catalogService.deactivateRoastery, catalogService.reactivateRoastery$c$;
COMMENT ON COLUMN coffees.deactivated_at IS $c$UTC timestamp the coffee was deactivated; NULL while active | Writer: catalogService.retireCoffee, catalogService.restoreCoffee, catalogService.deactivateRoastery, catalogService.reactivateRoastery$c$;
COMMENT ON COLUMN coffees.deactivation_reason IS $c$Why the coffee is inactive. One of: roaster (cascade from a roastery deactivation), manual; NULL while active | Writer: catalogService.retireCoffee, catalogService.restoreCoffee, catalogService.deactivateRoastery, catalogService.reactivateRoastery$c$;
-- ── cupping_sessions ──
COMMENT ON TABLE cupping_sessions IS $c$Purpose: Header of one Axis & Bloom cupping session (cupping evidence): date and its precision, place, blind, roaster present, printed sheet, where the rows came from, who transcribed and checked them, the brew protocol; metadata may change, never deleted while it has coffees | Class: fact | Writer: cuppingService.createSession, cuppingService.updateSessionHeader, cuppingService.removeEmptySession; seed | Readers: v_cupping_session, v_cupping_scores_readable, v_coffee_dimension_range, v_coffee_dimension_history, cuppingService | Since: 2026-05-25$c$;
COMMENT ON COLUMN cupping_sessions.id IS $c$Surrogate primary key; referenced by cupping_session_coffees.session_id, coffee_archetype_assignment.assigned_from_session_id and coffee_slot_assignment.placed_from_session_id.$c$;
COMMENT ON COLUMN cupping_sessions.session_date IS $c$Calendar date the session was held (business time); NOT NULL since cupping evidence brief 1, see session_date_precision.$c$;
COMMENT ON COLUMN cupping_sessions.brew_method IS $c$Class: deprecated | DEPRECATED since 2026-10 (cupping evidence brief 1): the brew lives in cupping_brew_params.brew_device; kept for the legacy rows, nothing writes it.$c$;
COMMENT ON COLUMN cupping_sessions.location IS $c$Free-text place where the session was held.$c$;
COMMENT ON COLUMN cupping_sessions.session_notes IS $c$Free-text notes about the session as a whole.$c$;
COMMENT ON COLUMN cupping_sessions.created_at IS $c$UTC timestamp the session row was created (system time).$c$;
COMMENT ON COLUMN cupping_sessions.record_source IS $c$Where the rows came from: score_entry (typed in admin Score Entry), seed:<file>, paper:<files>, or legacy for every session that existed when the column was added (2026-10-18, tagged by the column default, not by date).$c$;
COMMENT ON COLUMN cupping_sessions.sheet_format IS $c$References cupping_sheet_format.code: the printed sheet (or score_entry) the cuppers used; legacy_wide on the Path seed session; NULL on legacy Score Entry sessions.$c$;
COMMENT ON COLUMN cupping_sessions.session_date_precision IS $c$How sure session_date is. One of: exact, estimated (a date not written on the sheets, or backfilled from created_at).$c$;
COMMENT ON COLUMN cupping_sessions.is_blind IS $c$True when the cuppers did not know which coffee was in which cup; NULL when not recorded.$c$;
COMMENT ON COLUMN cupping_sessions.roaster_present IS $c$True when a roaster's person was at the table (their remarks could anchor our calls); NULL when not recorded.$c$;
COMMENT ON COLUMN cupping_sessions.transcribed_by IS $c$Who transcribed the paper sheets into rows; NULL for Score Entry sessions.$c$;
COMMENT ON COLUMN cupping_sessions.transcribed_at IS $c$Date the paper sheets were transcribed; NULL for Score Entry sessions.$c$;
COMMENT ON COLUMN cupping_sessions.checked_by IS $c$Who checked the transcription (for example a blind second read); NULL when unchecked or typed in Score Entry.$c$;
COMMENT ON COLUMN cupping_sessions.brew_defaults IS $c$The session's brew protocol as JSON (doseGrams, waterGrams, ratio, waterTemperatureCelsius, steepTimeMinutes, brewDevice, notes); copied into each new session coffee's cupping_brew_params unless that coffee brings its own; NULL when none was given.$c$;
-- ── cupping_session_coffees ──
COMMENT ON TABLE cupping_session_coffees IS $c$Purpose: One sample in a cupping session: which coffee, in what order, its roast date, blind code, condition and whether it is the session's control coffee | Class: fact | Writer: cuppingService.addSessionCoffee, cuppingService.updateSessionCoffee, cuppingService.removeEmptySessionCoffee; seed | Readers: v_cupping_session_coffee, v_cupping_scores_readable, v_coffee_dimension_range, v_coffee_dimension_history, cuppingService, roastery_remark_guard | Since: 2026-05-25 (as session_coffees)$c$;
COMMENT ON COLUMN cupping_session_coffees.id IS $c$Surrogate primary key; referenced as session_coffee_id by cupping_scores and cupping_brew_params, and by roastery_remark.cupping_session_coffee_id.$c$;
COMMENT ON COLUMN cupping_session_coffees.session_id IS $c$References cupping_sessions.id (ON DELETE RESTRICT): the session.$c$;
COMMENT ON COLUMN cupping_session_coffees.coffee_id IS $c$References coffees.id (ON DELETE RESTRICT): the coffee cupped.$c$;
COMMENT ON COLUMN cupping_session_coffees.display_order IS $c$1-based position of the coffee within the session; the next value is MAX plus 1 when a coffee is added.$c$;
COMMENT ON COLUMN cupping_session_coffees.roast_date IS $c$Date the sample was roasted, where known.$c$;
COMMENT ON COLUMN cupping_session_coffees.blind_code IS $c$The code written on the cup in a blind session (for example TIGER).$c$;
COMMENT ON COLUMN cupping_session_coffees.sample_note IS $c$Sample condition as noted (for example end-of-run lot, last cup of the day).$c$;
COMMENT ON COLUMN cupping_session_coffees.is_control IS $c$True for the session's control coffee: an already-placed catalog coffee cupped to anchor the cuppers against the catalog (protocol from 2026-10).$c$;
-- ── coffee_dimensions ──
COMMENT ON TABLE coffee_dimensions IS $c$Purpose: Catalogue of the 12 cupping dimensions that scores, archetype targets and the Bloom Dial are measured on | Class: master | Writer: seed | Readers: v_cupping_scores_readable, v_archetype_vectors, v_coffee_archetype, v_coffee_dimension_range, v_archetype_dimension_profile, +8 more | Since: 2026-05-25 (as dimensions)$c$;
COMMENT ON COLUMN coffee_dimensions.id IS $c$Surrogate primary key with explicit seeded ids 1 to 12; referenced by scores, coffee_hop and archetype dominant_dimension_id.$c$;
COMMENT ON COLUMN coffee_dimensions.name IS $c$Raw SCA-style dimension name, unique (for example Acidity, Body, Savory / Depth).$c$;
COMMENT ON COLUMN coffee_dimensions.description IS $c$Short explanation of what the dimension measures.$c$;
COMMENT ON COLUMN coffee_dimensions.scale_min_label IS $c$Label for the low end of the scale (for example flat); NULL for text-only dimensions.$c$;
COMMENT ON COLUMN coffee_dimensions.scale_max_label IS $c$Label for the high end of the scale (for example very bright / sharp); NULL for text-only dimensions.$c$;
COMMENT ON COLUMN coffee_dimensions.scale_min IS $c$Lowest scale value, 0 for numeric dimensions; NULL for text-only dimensions in the seed.$c$;
COMMENT ON COLUMN coffee_dimensions.scale_max IS $c$Highest scale value, 15 for numeric dimensions (0 to 15 scale); NULL for text-only dimensions in the seed.$c$;
COMMENT ON COLUMN coffee_dimensions.is_numeric IS $c$True when the dimension is scored numerically on the scale; false when it takes free-text notes only. Dimensions 1 to 3 (Fragrance, Aroma, Flavor) numeric since cupping evidence brief 1, 2026-10.$c$;
COMMENT ON COLUMN coffee_dimensions.display_order IS $c$Position of the dimension in admin and report listings, 1 to 12.$c$;
COMMENT ON COLUMN coffee_dimensions.platform_name IS $c$Consumer-facing word replacing the raw name (Acidity to Brightness, Bitterness to Boldness, Body to Intensity, Savory / Depth to Complexity, Finish Length to Finish); NULL means use name. Set by schema.sql seed UPDATEs and direct SQL, no admin UI.$c$;
COMMENT ON COLUMN coffee_dimensions.source_id IS $c$References sensory_source.id: the standard that defines this dimension (sca_cva, wcr_lexicon or platform); backfilled by schema.sql.$c$;
COMMENT ON COLUMN coffee_dimensions.sensory_lexicon_attribute_id IS $c$References sensory_lexicon_attribute.id: the single WCR Lexicon attribute this dimension corresponds to, where one applies; NULL otherwise | Writer: seed (db/seeds/sensory_lexicon_attributes_wcr.sql)$c$;
-- ── cupping_scores ──
COMMENT ON TABLE cupping_scores IS $c$Purpose: One row per Axis & Bloom cupper per sample (cupper_id, the scale used, her calls) plus the merged row (is_merged, merge_rule); values in cupping_score_values. Never edited: exactly one supersede transition per row (guard trigger), deletes raise | Class: fact | Writer: cuppingService.saveCupperScore, cuppingService.mergeByRule, cuppingService.saveManualMerge; seed | Readers: v_cupping_scores_readable, v_cupping_score, v_coffee_dimension_range, v_coffee_dimension_history, v_collaborative_flavor_wheel, cuppingService, +4 more | Since: 2026-05-25$c$;
COMMENT ON COLUMN cupping_scores.id IS $c$Surrogate primary key; referenced by cupping_score_values, cupping_score_descriptors and superseded_by_id.$c$;
COMMENT ON COLUMN cupping_scores.session_coffee_id IS $c$References cupping_session_coffees.id (ON DELETE RESTRICT): which sample was scored. One current cupper row per (session coffee, cupper) and one current merged row per session coffee (partial unique indexes).$c$;
COMMENT ON COLUMN cupping_scores.taster_name IS $c$Class: deprecated | DEPRECATED since cupping evidence brief 1 (2026-10-18): cupper_id is the key and is_merged the only merged flag; kept on the legacy rows (Dana, Camila, the seed's session_1_merged), NULL on every row written since.$c$;
COMMENT ON COLUMN cupping_scores.is_merged IS $c$True for the merged row of a sample (made by rule or by hand, never by a cupper); only current merged rows feed the dial, the public flavor wheel and the catalog reads.$c$;
COMMENT ON COLUMN cupping_scores.overall_notes IS $c$Free-text overall impressions for this score row; on a merged row the cuppers' notes, each prefixed with her name.$c$;
COMMENT ON COLUMN cupping_scores.created_at IS $c$UTC timestamp the score row was created (valid-from; superseded_at is the valid-to).$c$;
COMMENT ON COLUMN cupping_scores.cupper_id IS $c$References cupper.id: whose row this is; NULL on merged rows and on legacy rows whose taster name matched no cupper (CHECK cupping_scores_row_shape).$c$;
COMMENT ON COLUMN cupping_scores.scale_code IS $c$References cupping_scale.code: the scale the cupper actually used (ab_0_15, grid_0_5, word_3); legacy on every row that existed when the column was added (tagged by the column default); a merged row is always ab_0_15.$c$;
COMMENT ON COLUMN cupping_scores.archetype_call IS $c$The cupper's archetype call as written (archetype_enum); on a merged row only when every cupper who made a call made the same one; NULL when none was written.$c$;
COMMENT ON COLUMN cupping_scores.archetype_call_secondary IS $c$A second archetype the cupper wrote, when she wrote two; same merge rule as archetype_call.$c$;
COMMENT ON COLUMN cupping_scores.position_call IS $c$The cupper's own words for the position on the dial (for example light, med-strong, delicate).$c$;
COMMENT ON COLUMN cupping_scores.slot_call_id IS $c$References coffee_dial_slot.id: only when the call names a slot unambiguously.$c$;
COMMENT ON COLUMN cupping_scores.call_note IS $c$What the calls look like on the paper (a family ticked, a call crossed out, DEF); on a merged row the differing calls.$c$;
COMMENT ON COLUMN cupping_scores.merge_rule IS $c$How the merged row was made. One of: union_v1 (cuppingService.mergeByRule), manual (a hand merge), legacy (the Path seed's merged rows); NULL on cupper rows.$c$;
COMMENT ON COLUMN cupping_scores.merge_note IS $c$Merged rows: the scales merged, the dimensions the cuppers disagree on (gap greater than param cupper_gap), one-cupper dimensions and whether the dial signal was withheld; for a hand merge the reason.$c$;
COMMENT ON COLUMN cupping_scores.superseded_at IS $c$UTC timestamp a newer row replaced this one (a re-save, a transcription correction or a re-merge); NULL marks the current row. Set once, together with superseded_by_id and supersede_reason.$c$;
COMMENT ON COLUMN cupping_scores.superseded_by_id IS $c$References cupping_scores.id (deferred to commit): the row that replaced this one; NULL while current.$c$;
COMMENT ON COLUMN cupping_scores.supersede_reason IS $c$Why the row was replaced (edited in Score Entry, transcription correction: ..., merged by rule again, replaced by a manual merge); NULL while current.$c$;
-- ── cupping_score_values ──
COMMENT ON TABLE cupping_score_values IS $c$Purpose: One value per score row and dimension, on the scale the cupper used, with the paper verbatim in raw_value and her words in notes; immutable (trigger), converted to 0 to 15 only in the views through cupping_to_ab() | Class: fact | Writer: cuppingService.saveCupperScore, cuppingService.mergeByRule, cuppingService.saveManualMerge; seed | Readers: v_cupping_scores_readable, v_coffee_dimension_range, v_coffee_dimension_history, v_coffee_dimension_range_calibrated, cuppingService | Since: 2026-05-25$c$;
COMMENT ON COLUMN cupping_score_values.id IS $c$Surrogate primary key.$c$;
COMMENT ON COLUMN cupping_score_values.cupping_score_id IS $c$References cupping_scores.id (ON DELETE RESTRICT): the score row this value belongs to. UNIQUE together with dimension_id.$c$;
COMMENT ON COLUMN cupping_score_values.dimension_id IS $c$References coffee_dimensions.id (ON DELETE RESTRICT): the dimension scored.$c$;
COMMENT ON COLUMN cupping_score_values.value_min IS $c$Low end of the value on the scale the row's scale_code names (grid_0_5: 4; ab_0_15: as written); NULL for words-only dimensions and for word_3 rows, whose word is raw_value.$c$;
COMMENT ON COLUMN cupping_score_values.value_max IS $c$High end of the value on the row's own scale; equals value_min for a point score; NULL for words-only dimensions and word_3 rows.$c$;
COMMENT ON COLUMN cupping_score_values.notes IS $c$The words written next to the dimension; a struck word is kept as ~word and never becomes a descriptor row.$c$;
COMMENT ON COLUMN cupping_score_values.raw_value IS $c$Exactly what is on the paper for this dimension (7-9, marks at 2,4,5; 4 struck, low, grid 0-5: 4); on a merged row the union it came from; NULL on legacy rows.$c$;
-- ── cupping_score_descriptors ──
COMMENT ON TABLE cupping_score_descriptors IS $c$Purpose: Flavor-wheel nodes a cupper named on a score row, at the SCA tier she used, with her words in custom_notes; on a merged row the union; immutable (trigger) | Class: fact | Writer: cuppingService.saveCupperScore, cuppingService.mergeByRule, cuppingService.saveManualMerge; seed | Readers: v_collaborative_flavor_wheel, v_cupping_score_descriptor, cuppingService | Since: 2026-05-27$c$;
COMMENT ON COLUMN cupping_score_descriptors.id IS $c$Surrogate primary key.$c$;
COMMENT ON COLUMN cupping_score_descriptors.cupping_score_id IS $c$References cupping_scores.id (ON DELETE RESTRICT): the score row. UNIQUE together with cupping_note_id.$c$;
COMMENT ON COLUMN cupping_score_descriptors.cupping_note_id IS $c$References cupping_note.id (uuid, ON DELETE RESTRICT): the SCA node named, at the tier named (berries is Berry, never Blueberry).$c$;
COMMENT ON COLUMN cupping_score_descriptors.intensity IS $c$How prominent the descriptor was, 0 to 15 (same scale as dimensions); on a merged row the highest of the cuppers'; NULL when not given.$c$;
COMMENT ON COLUMN cupping_score_descriptors.custom_notes IS $c$The cupper's own words for the node; on a merged row each cupper's words prefixed with her name.$c$;
-- ── cupping_brew_params ──
COMMENT ON TABLE cupping_brew_params IS $c$Purpose: How each sample was brewed (dose, water, ratio, temperature, grind, steep, device; 8.5 g / 150 g standard); one row per session coffee, from the session's brew_defaults unless given; editable until a score exists under the sample, then immutable (trigger) | Class: fact | Writer: cuppingService.addSessionCoffee, cuppingService.saveBrewParams, cuppingService.removeEmptySessionCoffee | Readers: v_cupping_session_coffee, v_cupping_session | Since: 2026-05-25 (as brew_params)$c$;
COMMENT ON COLUMN cupping_brew_params.id IS $c$Surrogate primary key.$c$;
COMMENT ON COLUMN cupping_brew_params.session_coffee_id IS $c$References cupping_session_coffees.id (ON DELETE RESTRICT): the sample the parameters belong to; unique (one brew row per sample).$c$;
COMMENT ON COLUMN cupping_brew_params.dose_grams IS $c$Coffee dose in grams.$c$;
COMMENT ON COLUMN cupping_brew_params.water_grams IS $c$Water used in grams.$c$;
COMMENT ON COLUMN cupping_brew_params.yield_grams IS $c$Liquid yield in grams (espresso-style methods).$c$;
COMMENT ON COLUMN cupping_brew_params.ratio IS $c$Brew ratio as a bare number; direction (water per coffee or coffee per water) undefined, table unused.$c$;
COMMENT ON COLUMN cupping_brew_params.water_temperature_celsius IS $c$Water temperature in degrees Celsius.$c$;
COMMENT ON COLUMN cupping_brew_params.grind_size IS $c$Free-text grind size description.$c$;
COMMENT ON COLUMN cupping_brew_params.extraction_time_seconds IS $c$Extraction or brew time in seconds.$c$;
COMMENT ON COLUMN cupping_brew_params.pressure_bar IS $c$Brew pressure in bar (espresso).$c$;
COMMENT ON COLUMN cupping_brew_params.steep_time_minutes IS $c$Steep time in minutes (immersion methods).$c$;
COMMENT ON COLUMN cupping_brew_params.brew_device IS $c$Free-text name of the brewing device.$c$;
COMMENT ON COLUMN cupping_brew_params.notes IS $c$Free-text notes about the brew.$c$;
-- ── Cupping evidence brief 1 (2026-10-18): reference tables (Class: master) ──
-- Two SQL functions live beside these tables (the parser takes TABLE, VIEW and
-- COLUMN comments only, so they are documented here):
--   param(key) -> numeric: the current value of an evidence_parameter key (NULL if none); read by the v_evidence_* views (brief 3) and cuppingService (cupper_gap).
--   cupping_to_ab(scale_code, value_min, value_max, raw_value) -> (ab_min, ab_max): a native value converted to the 0 to 15 line through cupping_scale_step (identity scales pass through; stepped numeric spans floor(min)..floor(max); ordinal looks up lower(trim(raw))); NULL pair when the scale or label is unknown. Read by v_cupping_scores_readable, v_coffee_dimension_range, v_coffee_dimension_history, v_coffee_dimension_range_calibrated and cuppingService.mergeByRule.
-- ── cupper ──
COMMENT ON TABLE cupper IS $c$Purpose: Who cups for Axis & Bloom; cupping_scores.cupper_id points here, so a new cupper is a row, never code | Class: master | Writer: cuppingService.addCupper; seed | Readers: cuppingReads, cuppingService, v_cupping_scores_readable, v_cupping_score, v_cupping_session, v_cupping_session_coffee | Since: 2026-10-18 (cupping evidence brief 1)$c$;
COMMENT ON COLUMN cupper.id IS $c$Surrogate primary key; referenced by cupping_scores.cupper_id and cupper_calibration_offset.cupper_id.$c$;
COMMENT ON COLUMN cupper.name IS $c$The cupper's name as shown in Score Entry and on merged-row notes; unique.$c$;
COMMENT ON COLUMN cupper.is_active IS $c$True while the cupper can be chosen for a new score row; an inactive cupper keeps her rows.$c$;
COMMENT ON COLUMN cupper.since IS $c$Date the person started cupping for Axis & Bloom; NULL when not recorded.$c$;
COMMENT ON COLUMN cupper.note IS $c$Free-text note about the cupper (for example a guest cupper).$c$;
-- ── cupping_scale ──
COMMENT ON TABLE cupping_scale IS $c$Purpose: The scales a cupper can score on (ab_0_15, grid_0_5, word_3, legacy); a value is stored on its own scale and converted in the views | Class: master | Writer: seed | Readers: cupping_to_ab, cuppingService, cuppingReads, v_cupping_scores_readable | Since: 2026-10-18 (cupping evidence brief 1)$c$;
COMMENT ON COLUMN cupping_scale.id IS $c$Surrogate primary key; code is the natural key.$c$;
COMMENT ON COLUMN cupping_scale.code IS $c$Unique scale code referenced by cupping_scores.scale_code and cupping_scale_step.scale_code.$c$;
COMMENT ON COLUMN cupping_scale.label IS $c$Human label shown in Score Entry.$c$;
COMMENT ON COLUMN cupping_scale.kind IS $c$numeric (values in value_min/max) or ordinal (a word in raw_value).$c$;
COMMENT ON COLUMN cupping_scale.scale_min IS $c$Lowest value a numeric scale allows; NULL for ordinal scales.$c$;
COMMENT ON COLUMN cupping_scale.scale_max IS $c$Highest value a numeric scale allows; NULL for ordinal scales.$c$;
COMMENT ON COLUMN cupping_scale.note IS $c$What the scale is and where it is used.$c$;
-- ── cupping_scale_step ──
COMMENT ON TABLE cupping_scale_step IS $c$Purpose: How each native value of a converted scale maps to a span on the 0 to 15 line (grid 4 is 11 to 13, low is 0 to 5); changing a row changes the conversion without touching any evidence row | Class: master | Writer: seed | Readers: cupping_to_ab, cuppingReads | Since: 2026-10-18 (cupping evidence brief 1)$c$;
COMMENT ON COLUMN cupping_scale_step.id IS $c$Surrogate primary key; (scale_code, raw_label) is the natural key.$c$;
COMMENT ON COLUMN cupping_scale_step.scale_code IS $c$References cupping_scale.code: the scale this step belongs to.$c$;
COMMENT ON COLUMN cupping_scale_step.raw_label IS $c$The native value as text: a digit for a numeric scale (0 to 5), a word for an ordinal one (low, medium, high).$c$;
COMMENT ON COLUMN cupping_scale_step.ab_min IS $c$Low end of the 0 to 15 span this step stands for.$c$;
COMMENT ON COLUMN cupping_scale_step.ab_max IS $c$High end of the 0 to 15 span this step stands for (at least ab_min).$c$;
-- ── cupping_sheet_format ──
COMMENT ON TABLE cupping_sheet_format IS $c$Purpose: Versions of the printed cupping sheet (and Score Entry) a session was recorded on; the next sheet is an INSERT | Class: master | Writer: seed | Readers: cuppingReads, cuppingService, v_cupping_session, v_cupping_scores_readable | Since: 2026-10-18 (cupping evidence brief 1)$c$;
COMMENT ON COLUMN cupping_sheet_format.id IS $c$Surrogate primary key; code is the natural key.$c$;
COMMENT ON COLUMN cupping_sheet_format.code IS $c$Unique format code referenced by cupping_sessions.sheet_format and cupping_sheet_line.sheet_format.$c$;
COMMENT ON COLUMN cupping_sheet_format.label IS $c$Human label shown in the session form.$c$;
COMMENT ON COLUMN cupping_sheet_format.since IS $c$Date the format came into use; NULL when not recorded.$c$;
COMMENT ON COLUMN cupping_sheet_format.note IS $c$What distinguishes the format.$c$;
-- ── cupping_sheet_line ──
COMMENT ON TABLE cupping_sheet_line IS $c$Purpose: Which dimension each printed line of a sheet format feeds (Mouthfeel light to heavy is Body; Aftertaste words is Finish Character), so a loader never hard-codes the mapping | Class: master | Writer: seed | Readers: cuppingReads | Since: 2026-10-18 (cupping evidence brief 1)$c$;
COMMENT ON COLUMN cupping_sheet_line.id IS $c$Surrogate primary key; (sheet_format, line_label) is the natural key.$c$;
COMMENT ON COLUMN cupping_sheet_line.sheet_format IS $c$References cupping_sheet_format.code: the sheet the line is printed on.$c$;
COMMENT ON COLUMN cupping_sheet_line.line_label IS $c$The line as printed (Fragrance, Mouthfeel light to heavy, Aftertaste words).$c$;
COMMENT ON COLUMN cupping_sheet_line.dimension_id IS $c$References coffee_dimensions.id: the dimension the line feeds.$c$;
COMMENT ON COLUMN cupping_sheet_line.is_numeric IS $c$True when the line is a scale (values), false when it takes words (notes).$c$;
COMMENT ON COLUMN cupping_sheet_line.display_order IS $c$Position of the line on the sheet.$c$;
-- ── evidence_parameter ──
COMMENT ON TABLE evidence_parameter IS $c$Purpose: Thresholds and weights the evidence rules use (cupper_gap, roaster_rank_gap, spearman_min_n, spearman_rho_cut, rank_corr_min_n, calibration_min_n, estimated_date_review_days, website_recapture_days; brief 6: session_rank_ratio, session_half_life_days, session_gap, customer_voice_hit_tier, customer_voice_max_words (closed 2026-10-23, no current row); coffee presentation brief 1: customer_voice_signature_max, customer_voice_accent_max; brief 2: archetype_profile_min_coffees, dimension_delta_slight/_significant), with history; read through param(key), never typed into a view or a .ts file; a change is a new row superseding the current one; each note ends with the key's sane range | Class: master | Writer: evidenceParameterService.setParameterInTx; seed | Readers: param, cuppingService, compatibilityReads, evidenceReads.getParameters (admin System Health, Evidence parameters card) | Since: 2026-10-18 (cupping evidence brief 1; admin-editable since brief 6, 2026-10-21)$c$;
COMMENT ON COLUMN evidence_parameter.id IS $c$Surrogate primary key; (key, since) is the natural key.$c$;
COMMENT ON COLUMN evidence_parameter.key IS $c$Parameter name; one current row per key (partial unique index).$c$;
COMMENT ON COLUMN evidence_parameter.value IS $c$The threshold value (numeric).$c$;
COMMENT ON COLUMN evidence_parameter.since IS $c$UTC timestamp the value took effect.$c$;
COMMENT ON COLUMN evidence_parameter.superseded_at IS $c$UTC timestamp a newer value replaced this one; NULL marks the current value.$c$;
COMMENT ON COLUMN evidence_parameter.note IS $c$What the threshold decides, ending with its sane range (Range: ...) that evidenceParameterService.setParameterInTx enforces; a row written from the admin card appends the change date, the admin uid and the change note after the range.$c$;
-- ── evidence_stop_word ──
COMMENT ON TABLE evidence_stop_word IS $c$Purpose: Words the unmapped-words view ignores because they name a dimension or a texture, not a flavor (sweet, acidity, juicy) | Class: master | Writer: seed | Readers: none yet (v_evidence_unmapped_words, brief 3) | Since: 2026-10-18 (cupping evidence brief 1)$c$;
COMMENT ON COLUMN evidence_stop_word.id IS $c$Surrogate primary key; word is the natural key.$c$;
COMMENT ON COLUMN evidence_stop_word.word IS $c$The word, lower-cased; unique.$c$;
COMMENT ON COLUMN evidence_stop_word.since IS $c$Date the word was added.$c$;
COMMENT ON COLUMN evidence_stop_word.note IS $c$Why the word is ignored, when not obvious.$c$;
-- ── cupper_calibration_offset ──
COMMENT ON TABLE cupper_calibration_offset IS $c$Purpose: Per cupper and dimension correction to apply to her range, with its basis and history; empty on purpose until the calibration views show enough comparisons (param calibration_min_n) | Class: master | Writer: manual:direct SQL with supersede (none yet) | Readers: v_coffee_dimension_range_calibrated | Since: 2026-10-18 (cupping evidence brief 1)$c$;
COMMENT ON COLUMN cupper_calibration_offset.id IS $c$Surrogate primary key; (cupper_id, dimension_id, since) is the natural key.$c$;
COMMENT ON COLUMN cupper_calibration_offset.cupper_id IS $c$References cupper.id: whose ranges the offset corrects.$c$;
COMMENT ON COLUMN cupper_calibration_offset.dimension_id IS $c$References coffee_dimensions.id: the dimension corrected.$c$;
COMMENT ON COLUMN cupper_calibration_offset.offset_value IS $c$Points added to the cupper's converted range on the 0 to 15 line (negative lowers it).$c$;
COMMENT ON COLUMN cupper_calibration_offset.basis IS $c$What the offset rests on (the calibration view rows, n, date).$c$;
COMMENT ON COLUMN cupper_calibration_offset.since IS $c$UTC timestamp the offset took effect.$c$;
COMMENT ON COLUMN cupper_calibration_offset.superseded_at IS $c$UTC timestamp a newer offset replaced this one; NULL marks the current offset.$c$;
-- ── roastery_coffee_descriptors ──
COMMENT ON TABLE roastery_coffee_descriptors IS $c$Purpose: Roaster bag tasting notes mapped to flavor-wheel terms, one row per coffee and term, retired not deleted | Class: operating | Writer: catalogService.setRoasterDescriptorsInTx; seed | Readers: v_collaborative_flavor_wheel, roasteryPortalReads, admin.GET /stats | Since: 2026-05-27 (as coffee_roastery_descriptors)$c$;
COMMENT ON COLUMN roastery_coffee_descriptors.id IS $c$Surrogate primary key.$c$;
COMMENT ON COLUMN roastery_coffee_descriptors.coffee_id IS $c$References coffees.id (ON DELETE CASCADE): the coffee. UNIQUE together with cupping_note_id.$c$;
COMMENT ON COLUMN roastery_coffee_descriptors.cupping_note_id IS $c$References cupping_note.id (uuid, ON DELETE CASCADE): the flavor-wheel term the roaster's note maps to.$c$;
COMMENT ON COLUMN roastery_coffee_descriptors.notes IS $c$The roaster's exact wording when it differs from the term; several words mapped to one term are joined with a slash.$c$;
COMMENT ON COLUMN roastery_coffee_descriptors.is_active IS $c$False once the row has been retired (kept for history, ignored by the flavor wheel view); true on accept | Writer: catalogService.setRoasterDescriptorsInTx$c$;
COMMENT ON COLUMN roastery_coffee_descriptors.source_response_id IS $c$References roastery_portal_response.id (uuid): the portal response version this row was accepted from; NULL means a legacy seed row | Writer: catalogService.setRoasterDescriptorsInTx$c$;
COMMENT ON COLUMN roastery_coffee_descriptors.accepted_by_admin_id IS $c$References user_profile.id (uuid): the admin who accepted the portal notes; NULL for legacy seed rows | Writer: catalogService.setRoasterDescriptorsInTx$c$;
COMMENT ON COLUMN roastery_coffee_descriptors.accepted_at IS $c$UTC timestamp the row was last accepted from the portal; NULL for legacy seed rows | Writer: catalogService.setRoasterDescriptorsInTx$c$;
COMMENT ON COLUMN roastery_coffee_descriptors.retired_at IS $c$UTC timestamp the row was retired; NULL while active | Writer: catalogService.setRoasterDescriptorsInTx$c$;
-- ── user_flavor_feedback ──
COMMENT ON TABLE user_flavor_feedback IS $c$Purpose: Retired post-delivery customer feedback per flavor descriptor, replaced by customer_feedback_descriptor | Class: deprecated | Writer: none | Readers: users.GET /flavor-memory (count), admin.GET /stats, axis, backfillCustomerFacts | Since: 2026-05-27 (as client_flavor_feedback)$c$;
COMMENT ON COLUMN user_flavor_feedback.id IS $c$Surrogate primary key.$c$;
COMMENT ON COLUMN user_flavor_feedback.user_id IS $c$References user_profile.id (uuid, ON DELETE CASCADE): the customer who gave the feedback.$c$;
COMMENT ON COLUMN user_flavor_feedback.coffee_id IS $c$References coffees.id (ON DELETE CASCADE): the coffee tasted.$c$;
COMMENT ON COLUMN user_flavor_feedback.order_id IS $c$References order.id (uuid, ON DELETE SET NULL): the delivery that triggered the feedback request.$c$;
COMMENT ON COLUMN user_flavor_feedback.cupping_note_id IS $c$References cupping_note.id (uuid, ON DELETE CASCADE): the flavor-wheel descriptor the customer tasted.$c$;
COMMENT ON COLUMN user_flavor_feedback.intensity IS $c$How strongly the customer perceived the descriptor, 0 to 15; optional.$c$;
COMMENT ON COLUMN user_flavor_feedback.notes IS $c$Free-text note from the customer.$c$;
COMMENT ON COLUMN user_flavor_feedback.created_at IS $c$UTC timestamp the feedback row was created.$c$;
-- ── coffee_archetype_assignment ──
COMMENT ON TABLE coffee_archetype_assignment IS $c$Purpose: Match-archetype tag per coffee with confidence and history; current row has superseded_at NULL | Class: master | Writer: catalogService.setMatchArchetypeInTx; seed | Readers: v_coffee, v_archetype_dimension_comparison, v_archetype_dimension_profile, catalogIntegrity, dialSuggestion, +4 more | Since: 2026-05-25 (as archetype_assignments)$c$;
COMMENT ON COLUMN coffee_archetype_assignment.id IS $c$Surrogate primary key.$c$;
COMMENT ON COLUMN coffee_archetype_assignment.coffee_id IS $c$References coffees.id (ON DELETE RESTRICT since cupping evidence brief 1): the coffee being tagged.$c$;
COMMENT ON COLUMN coffee_archetype_assignment.archetype IS $c$Flavor archetype of the coffee. One of: chocolate_nutty, balanced_sweet, fruity, earthy, floral, experimental.$c$;
COMMENT ON COLUMN coffee_archetype_assignment.confidence IS $c$How sure the assignment is. One of: low, medium, high.$c$;
COMMENT ON COLUMN coffee_archetype_assignment.assigned_from_session_id IS $c$References cupping_sessions.id (ON DELETE SET NULL): the cupping session the assignment came from; NULL for manual or import assignments.$c$;
COMMENT ON COLUMN coffee_archetype_assignment.superseded_at IS $c$UTC timestamp a newer assignment replaced this one; NULL marks the single current row per coffee (partial unique index) | Writer: catalogService.setMatchArchetypeInTx$c$;
COMMENT ON COLUMN coffee_archetype_assignment.notes IS $c$Free-text rationale for the assignment.$c$;
COMMENT ON COLUMN coffee_archetype_assignment.created_at IS $c$UTC timestamp the assignment row was created.$c$;
COMMENT ON COLUMN coffee_archetype_assignment.source IS $c$How the assignment was made. One of: cupping, manual, import; NULL only on rows predating the column that had no backfill match.$c$;
COMMENT ON COLUMN coffee_archetype_assignment.basis IS $c$The evidence the decision rests on as JSON (sessions, calls per cupper, roaster form, roaster remarks, website, merged range, band, rule), the same facts as the basis line in notes; NULL until the Calibration workbench (cupping evidence brief 4) writes it.$c$;
-- ── coffee_hop ──
COMMENT ON TABLE coffee_hop IS $c$Purpose: Directional hop graph (more or less of a dimension) between coffees, or a coffee and a category | Class: master | Writer: catalogService.setHop, catalogService.removeHop | Readers: v_coffee_hop, catalogService, qrDoor, axis | Since: 2026-06-23 (as dial_coffee_relationships)$c$;
COMMENT ON COLUMN coffee_hop.id IS $c$Surrogate primary key.$c$;
COMMENT ON COLUMN coffee_hop.from_coffee_id IS $c$References coffees.id (ON DELETE CASCADE): the starting coffee; NULL when the starting endpoint is a category (exactly one of from_coffee_id and from_category_id is set).$c$;
COMMENT ON COLUMN coffee_hop.to_coffee_id IS $c$References coffees.id (ON DELETE CASCADE): the destination coffee; NULL when the destination endpoint is a category (exactly one of to_coffee_id and to_category_id is set).$c$;
COMMENT ON COLUMN coffee_hop.dimension_id IS $c$References coffee_dimensions.id: the dimension the hop moves along.$c$;
COMMENT ON COLUMN coffee_hop.direction IS $c$Whether the destination has more or less of the dimension. One of: more, less.$c$;
COMMENT ON COLUMN coffee_hop.delta IS $c$Size of the move on the dimension's 0 to 15 scale; may be NULL.$c$;
COMMENT ON COLUMN coffee_hop.is_recommended IS $c$True when this hop is a recommended next step for Liam; defaults to false.$c$;
COMMENT ON COLUMN coffee_hop.confidence IS $c$How sure the hop is. One of: low, medium, high; code defaults to medium.$c$;
COMMENT ON COLUMN coffee_hop.notes IS $c$Free-text rationale for the hop.$c$;
COMMENT ON COLUMN coffee_hop.created_at IS $c$UTC timestamp the hop row was created.$c$;
COMMENT ON COLUMN coffee_hop.from_category_id IS $c$References coffee_category.id: category as the starting endpoint instead of a coffee; set only by SQL seed or manual SQL, setHop cannot write it | Writer: seed (db/seeds/_retired/dial_relationships_base.sql) or manual SQL$c$;
COMMENT ON COLUMN coffee_hop.to_category_id IS $c$References coffee_category.id: category as the destination endpoint instead of a coffee; set only by SQL seed or manual SQL, setHop cannot write it | Writer: seed (db/seeds/_retired/dial_relationships_base.sql) or manual SQL$c$;
-- ── coffee_category ──
COMMENT ON TABLE coffee_category IS $c$Purpose: Cross-cutting coffee categories orthogonal to archetype (experimental, decaf, half_caf, flavored) | Class: master | Writer: catalogService.createCategory, catalogService.deleteCategory, catalogService.updateCategory; seed | Readers: v_coffee, catalogReads, roasteryPortal | Since: 2026-07-10 (#78)$c$;
COMMENT ON COLUMN coffee_category.id IS $c$Surrogate primary key; referenced by coffee_category_assignment and coffee_hop category endpoints.$c$;
COMMENT ON COLUMN coffee_category.code IS $c$Stable machine key, unique (seeded: experimental, decaf, half_caf, flavored).$c$;
COMMENT ON COLUMN coffee_category.label IS $c$Display label such as Half-Caf.$c$;
COMMENT ON COLUMN coffee_category.description IS $c$Free-text description; never written by the app, set by hand in the database.$c$;
COMMENT ON COLUMN coffee_category.sort_order IS $c$Display order, ascending; new categories get MAX plus 1.$c$;
COMMENT ON COLUMN coffee_category.is_active IS $c$False hides the category without deleting it; true by default.$c$;
COMMENT ON COLUMN coffee_category.is_hoppable IS $c$True if coffees with this category can be hop endpoints; only experimental is true, and the app never sets it (manual database decision).$c$;
COMMENT ON COLUMN coffee_category.created_at IS $c$UTC timestamp the category row was created.$c$;

-- ── coffee_category_assignment ──
COMMENT ON TABLE coffee_category_assignment IS $c$Purpose: Many-to-many join tagging coffees with cross-cutting categories (experimental, decaf, half_caf, flavored), independent of archetype or dial slot. | Class: master | Writer: catalogService.applyCategoryCodes (via createCoffee and updateCoffee); seed | Readers: v_coffee, catalogReads.getCategoryAssignments, catalogReads.getCategoryCoffees, catalogService.deleteCategory, routes/admin | Since: 2026-07-10 (#78)$c$;
COMMENT ON COLUMN coffee_category_assignment.id IS $c$Surrogate key for the tag row.$c$;
COMMENT ON COLUMN coffee_category_assignment.coffee_id IS $c$References coffees.id, the tagged coffee (ON DELETE CASCADE); UNIQUE together with category_id.$c$;
COMMENT ON COLUMN coffee_category_assignment.category_id IS $c$References coffee_category.id, the category applied (ON DELETE CASCADE); the app refuses to delete a category while rows exist.$c$;
COMMENT ON COLUMN coffee_category_assignment.assigned_at IS $c$UTC timestamp the tag was applied.$c$;

-- ── user_bloom_dial_current_position ──
COMMENT ON TABLE user_bloom_dial_current_position IS $c$Purpose: Current dial setting per user+archetype, overwritten in place on every dial turn (silent, no history); movement history (explicit saves and add-to-cart positions only) lives in Postgres customer_dial_event (the old Firestore users/{uid}/dial_events store is retired). | Class: operating | Writer: users.PATCH /api/users/dial-position; seed | Readers: users.GET /api/users/dial-position, sommelier (recent dial position), catalogIntegrity (check 12), catalogService.previewPlacement | Since: 2026-07-11 (#83, renamed #102)$c$;
COMMENT ON COLUMN user_bloom_dial_current_position.user_id IS $c$References user_profile.id (ON DELETE CASCADE); first half of the primary key.$c$;
COMMENT ON COLUMN user_bloom_dial_current_position.archetype IS $c$archetype_enum dial this position belongs to (chocolate_nutty, balanced_sweet, fruity, earthy, floral, experimental); second half of the primary key.$c$;
COMMENT ON COLUMN user_bloom_dial_current_position.updated_at IS $c$UTC timestamp of the last dial turn that overwrote this row.$c$;
COMMENT ON COLUMN user_bloom_dial_current_position.slot_id IS $c$References coffee_dial_slot.id, the slot the dial currently sits on; the only position reference (dial_sort_order was dropped, the API derives it by joining coffee_dial_slot.sort_order).$c$;

-- ── coffee_slot_price ──
COMMENT ON TABLE coffee_slot_price IS $c$Purpose: Retail price in cents for one Bloom Dial slot at one bag size, so every roaster fulfilling a slot shows the same price; a slot with no row renders Unpriced. | Class: master | Writer: catalogService.setSlotPrice, catalogService.setSlotPriceInTx; seed | Readers: v_coffee_sellable_candidate, v_coffee_sellable_slot, v_coffee_visibility, catalogReads, catalogService, catalogIntegrity | Since: 2026-07-11 as dial_slot_price (#80), renamed 2026-09-16$c$;
COMMENT ON COLUMN coffee_slot_price.id IS $c$Surrogate key; the default sequence is still named dial_slot_price_id_seq after the rename.$c$;
COMMENT ON COLUMN coffee_slot_price.weight_oz IS $c$Bag size in ounces (12, 32 or 80 today); references coffee_size.weight_oz; UNIQUE together with slot_id.$c$;
COMMENT ON COLUMN coffee_slot_price.retail_price_cents IS $c$Customer retail price for this slot and size, in US cents (3200 = $32.00).$c$;
COMMENT ON COLUMN coffee_slot_price.updated_at IS $c$UTC timestamp of the last price write; feeds the catalog version stamp (catalogReads.getCatalogVersion).$c$;
COMMENT ON COLUMN coffee_slot_price.slot_id IS $c$References coffee_dial_slot.id, the priced slot; NOT NULL since Catalog Blueprint brief 5a, replacing the dropped archetype and dial_sort_order columns.$c$;

-- ── coffee_retail_price ──
COMMENT ON TABLE coffee_retail_price IS $c$Purpose: Retail price in cents per coffee and bag size for category coffees with no dial slot (Decaf, Half-Caf, Flavored, Experimental); a coffee with no row renders Unpriced. | Class: master | Writer: catalogService.setCoffeeRetailPrice | Readers: catalogReads.getCoffeeRetailPrices, catalogReads.getSizeIntegrity, catalogIntegrity, routes/coffees (GET /api/coffees/other-categories), routes/admin (GET /api/admin/coffee-prices) | Since: 2026-07-14 (#95)$c$;
COMMENT ON COLUMN coffee_retail_price.id IS $c$Surrogate key for the price row.$c$;
COMMENT ON COLUMN coffee_retail_price.coffee_id IS $c$References coffees.id, the priced coffee (ON DELETE CASCADE); UNIQUE together with weight_oz.$c$;
COMMENT ON COLUMN coffee_retail_price.weight_oz IS $c$Bag size in ounces (12, 32 or 80 today); references coffee_size.weight_oz.$c$;
COMMENT ON COLUMN coffee_retail_price.retail_price_cents IS $c$Customer retail price for this coffee and size, in US cents (3200 = $32.00).$c$;
COMMENT ON COLUMN coffee_retail_price.updated_at IS $c$UTC timestamp of the last price write.$c$;

-- ── dial_position_signal ──
COMMENT ON TABLE dial_position_signal IS $c$Purpose: One row per source's opinion about where a coffee sits on its dial (cupping, roastery_wheel, client_wheel, sms_feedback, onsite_feedback), read only by the dormant consensus view and an admin stats count; never auto-moves a placement. | Class: operating | Writer: dialPositionSignal.writeDialPositionSignal, dialSuggestion.recordCuppingSignal, orders.POST /api/orders/:orderId/feedback (supersede only); seed | Readers: v_coffee_dial_position_consensus, axis (GET /stats) | Since: 2026-07-09 (#75)$c$;
COMMENT ON COLUMN dial_position_signal.id IS $c$Surrogate key for the signal row.$c$;
COMMENT ON COLUMN dial_position_signal.coffee_id IS $c$References coffees.id, the coffee the signal is about (ON DELETE RESTRICT since cupping evidence brief 1); nullable in the schema but always set by the writers.$c$;
COMMENT ON COLUMN dial_position_signal.archetype IS $c$archetype_enum dial the signal applies to; taken from the coffee's current match archetype.$c$;
COMMENT ON COLUMN dial_position_signal.dimension_id IS $c$References coffee_dimensions.id, the archetype's dominant dimension that the signal speaks to.$c$;
COMMENT ON COLUMN dial_position_signal.source IS $c$Where the opinion came from. One of: cupping, roastery_wheel, client_wheel, sms_feedback, onsite_feedback (CHECK); joins dial_source_weight.source.$c$;
COMMENT ON COLUMN dial_position_signal.direction IS $c$Which way the source says the coffee should move on the dimension. One of: more, less (CHECK); NULL for cupping rows. | Writer: dialPositionSignal.writeDialPositionSignal$c$;
COMMENT ON COLUMN dial_position_signal.raw_value IS $c$Cupping rows: the midpoint of the coffee's latest merged range on dimension_id, 0 to 15 (v_coffee_dimension_range, cupping evidence brief 1; was an average over every merged row); NULL for feedback rows. | Writer: dialSuggestion.recordCuppingSignal$c$;
COMMENT ON COLUMN dial_position_signal.sample_size IS $c$Number of observations behind the row: sessions with a current merged row for cupping rows, 1 for each feedback row.$c$;
COMMENT ON COLUMN dial_position_signal.confidence IS $c$Confidence in the signal. One of: low, medium, high (confidence_enum); defaults to medium and no writer sets any other value.$c$;
COMMENT ON COLUMN dial_position_signal.computed_at IS $c$UTC timestamp the signal was recorded.$c$;
COMMENT ON COLUMN dial_position_signal.superseded_at IS $c$UTC timestamp a newer signal replaced this one; NULL means current, and only current rows feed the consensus view. | Writer: dialSuggestion.recordCuppingSignal, orders.POST /:orderId/feedback$c$;
COMMENT ON COLUMN dial_position_signal.notes IS $c$For feedback rows a match key such as "onsite feedback for order <id>" that the order-feedback revision path uses to supersede the prior row; for cupping rows written since cupping evidence brief 1 the basis of the suggested slot (spec_band, or archetype_vector (May 2026 targets) while any slot of the archetype lacks a band); NULL on older cupping rows. | Writer: dialPositionSignal.writeDialPositionSignal, dialSuggestion.recordCuppingSignal$c$;
COMMENT ON COLUMN dial_position_signal.suggested_slot_id IS $c$References coffee_dial_slot.id, the slot the source suggests (replaced the dropped suggested_vocabulary_id in brief 5a); set only on cupping rows, NULL for feedback rows. | Writer: dialSuggestion.recordCuppingSignal$c$;

-- ── cupping_note_dimension_weight ──
COMMENT ON TABLE cupping_note_dimension_weight IS $c$Purpose: Reserved mapping from a cupping descriptor to a dimension and direction (for example Citrus raises Acidity), deliberately empty until enough cupping volume exists to validate a mapping. | Class: operating | Writer: none | Readers: none | Since: 2026-07-09 (#75)$c$;
COMMENT ON COLUMN cupping_note_dimension_weight.id IS $c$Surrogate key for the mapping row.$c$;
COMMENT ON COLUMN cupping_note_dimension_weight.cupping_note_id IS $c$References cupping_note.id (UUID), the descriptor being mapped; UNIQUE together with dimension_id.$c$;
COMMENT ON COLUMN cupping_note_dimension_weight.dimension_id IS $c$References coffee_dimensions.id, the dimension the descriptor moves.$c$;
COMMENT ON COLUMN cupping_note_dimension_weight.direction IS $c$Direction the descriptor pushes the dimension. One of: more, less (CHECK).$c$;
COMMENT ON COLUMN cupping_note_dimension_weight.weight IS $c$Strength of the descriptor-to-dimension association, default 0; scale and range undefined by design until Stage 2 of BLOOM_DIAL_ALLOCATION_SPEC (needs cupping volume), table empty on purpose.$c$;

-- ── dial_source_weight ──
COMMENT ON TABLE dial_source_weight IS $c$Purpose: Reliability weight per dial_position_signal source, used to weight signals in the consensus view (cupping 3, sms_feedback and onsite_feedback 1, roastery_wheel and client_wheel 0). | Class: operating | Writer: seed | Readers: v_coffee_dial_position_consensus | Since: 2026-07-09 (#75)$c$;
COMMENT ON COLUMN dial_source_weight.source IS $c$Signal source, primary key. One of: cupping, roastery_wheel, client_wheel, sms_feedback, onsite_feedback (CHECK).$c$;
COMMENT ON COLUMN dial_source_weight.reliability_weight IS $c$Relative weight of this source in the consensus, a unitless multiplier; 0 means the source is ignored.$c$;

-- ── lookup_value ──
COMMENT ON TABLE lookup_value IS $c$Purpose: Controlled vocabulary for admin dropdowns and coded fields, one row per (category, value) with a display label and order. | Class: operating | Writer: admin.POST /api/admin/lookups, admin.PATCH /api/admin/lookups/:id, admin.DELETE /api/admin/lookups/:id; seed | Readers: admin.GET /api/admin/lookups, routes/coffees (origin region), catalogService.updateCoffee, roasteryPortalReads, coffees.origin_region_id FK | Since: 2026-05-27$c$;
COMMENT ON COLUMN lookup_value.id IS $c$Surrogate key; coffees.origin_region_id references it.$c$;
COMMENT ON COLUMN lookup_value.category IS $c$Vocabulary group, for example roast_level, process, blend_or_single, brew_method, origin_region and the roastery_portal_* groups; UNIQUE together with value.$c$;
COMMENT ON COLUMN lookup_value.value IS $c$Stored code within the category (what other tables and the API hold).$c$;
COMMENT ON COLUMN lookup_value.label IS $c$Display text shown in the UI; may differ from value.$c$;
COMMENT ON COLUMN lookup_value.sort_order IS $c$Display position within the category, ascending.$c$;

-- ── coffee_dial_slot ──
COMMENT ON TABLE coffee_dial_slot IS $c$Purpose: The 24 Bloom Dial slots (archetype x sort_order 1-4): each slot's customer-facing name, position label and optional spec band, independent of which coffee fulfils it. | Class: master | Writer: catalogService.renameSlot, catalogService.setSlotSpec, catalogService.setLandingDefault; seed | Readers: v_coffee_slot, v_coffee_sellable_slot, v_coffee_sellable_candidate, v_coffee_visibility, v_roastery_portal_dimension_match, catalogReads.getSlots, +3 more | Since: 2026-09-13 (#178)$c$;
COMMENT ON COLUMN coffee_dial_slot.id IS $c$Surrogate key; referenced by coffee_slot_assignment, coffee_slot_price, user_bloom_dial_current_position, dial_position_signal, customer_dial_event and customer_liam_recommendation.$c$;
COMMENT ON COLUMN coffee_dial_slot.archetype IS $c$archetype_enum dial the slot belongs to; references coffee_archetype.code; UNIQUE together with sort_order.$c$;
COMMENT ON COLUMN coffee_dial_slot.sort_order IS $c$Position on the dial from 1 to 4 (CHECK), lightest or first to fullest; UNIQUE together with archetype.$c$;
COMMENT ON COLUMN coffee_dial_slot.name IS $c$Customer-facing slot name (formerly dial_slot_alias.platform_name); UNIQUE across all slots. | Writer: seed, catalogService.renameSlot$c$;
COMMENT ON COLUMN coffee_dial_slot.position_label IS $c$Short label for the position, for example Lighter, Classic, Richer or Full (formerly dial_position_vocabulary.label). | Writer: seed, catalogService.renameSlot$c$;
COMMENT ON COLUMN coffee_dial_slot.position_description IS $c$Optional longer description of the position; NULL or empty until set. | Writer: seed, catalogService.renameSlot$c$;
COMMENT ON COLUMN coffee_dial_slot.dimension_id IS $c$References coffee_dimensions.id, the dimension the slot position is measured on (the archetype's dominant dimension); set by the seed only (docs say renameSlot writes it, code does not).$c$;
COMMENT ON COLUMN coffee_dial_slot.is_landing_default IS $c$True for the one slot per archetype the dial opens on (partial unique index; seeded at sort_order 2). | Writer: seed, catalogService.setLandingDefault$c$;
COMMENT ON COLUMN coffee_dial_slot.spec_band_lo IS $c$Lower bound of the acceptable merged-cupping range on dimension_id (the dimension's own scale); NULL means no band set. | Writer: catalogService.setSlotSpec$c$;
COMMENT ON COLUMN coffee_dial_slot.spec_band_hi IS $c$Upper bound of the acceptable merged-cupping range on dimension_id; NULL means no band set; CHECK spec_band_lo <= spec_band_hi. | Writer: catalogService.setSlotSpec$c$;
COMMENT ON COLUMN coffee_dial_slot.spec_descriptor_families IS $c$Cupping wheel_category values this slot expects; an empty array means inherit coffee_archetype.descriptor_families. | Writer: catalogService.setSlotSpec$c$;
COMMENT ON COLUMN coffee_dial_slot.is_active IS $c$False hides the slot from the portal dimension match; no app code writes it, so it stays true unless edited by hand. | Writer: seed (column default)$c$;
COMMENT ON COLUMN coffee_dial_slot.created_at IS $c$UTC timestamp the slot row was created.$c$;
COMMENT ON COLUMN coffee_dial_slot.updated_at IS $c$UTC timestamp of the last slot edit; feeds the catalog version stamp.$c$;

-- ── coffee_slot_assignment ──
COMMENT ON TABLE coffee_slot_assignment IS $c$Purpose: Placement of a coffee in a Bloom Dial slot as home or guest, with priority, activity and certification, kept as history (inactive rows stay). | Class: master | Writer: catalogService.placeCoffee, catalogService.addGuest, catalogService.moveCoffee, catalogService.removeFromSlot, catalogService.setPriority, catalogService.certifyPlacement, catalogService.retireCoffee, catalogService.deactivateRoastery, catalogService.certifyPlacementInTx, catalogService.placeCoffeeInTx | Readers: v_coffee_slot, v_coffee_sellable_slot, v_coffee_sellable_candidate, v_coffee_visibility, v_coffee_hop, v_palate_recommendation_outcome, +3 more | Since: 2026-09-13 (#178)$c$;
COMMENT ON COLUMN coffee_slot_assignment.id IS $c$Surrogate key; a re-placement of the same coffee in the same slot reuses the row.$c$;
COMMENT ON COLUMN coffee_slot_assignment.slot_id IS $c$References coffee_dial_slot.id, the slot occupied; UNIQUE together with coffee_id.$c$;
COMMENT ON COLUMN coffee_slot_assignment.coffee_id IS $c$References coffees.id (ON DELETE RESTRICT), the placed coffee; one active home slot per coffee (partial unique index).$c$;
COMMENT ON COLUMN coffee_slot_assignment.role IS $c$Placement kind (coffee_slot_role_enum). One of: home, guest.$c$;
COMMENT ON COLUMN coffee_slot_assignment.priority IS $c$Rank within the slot, 1 is first choice (CHECK >= 1); unique among active rows of a slot.$c$;
COMMENT ON COLUMN coffee_slot_assignment.is_active IS $c$True while the placement is live; set false (with deactivated_at and deactivation_reason) instead of deleting.$c$;
COMMENT ON COLUMN coffee_slot_assignment.deactivated_at IS $c$UTC timestamp the placement was deactivated; NULL while active.$c$;
COMMENT ON COLUMN coffee_slot_assignment.deactivation_reason IS $c$Why the placement ended. One of: roaster (roastery deactivated), manual (removed or coffee retired), moved (coffee moved to another slot); NULL while active.$c$;
COMMENT ON COLUMN coffee_slot_assignment.placement_note IS $c$Admin note, required when the slot-spec check warns (band_out_of_spec or descriptor_off_family) at placement time. | Writer: catalogService.placeCoffee, catalogService.addGuest, catalogService.moveCoffee$c$;
COMMENT ON COLUMN coffee_slot_assignment.certified_at IS $c$UTC timestamp a person certified the placement after tasting; NULL if uncertified. | Writer: catalogService.certifyPlacement, catalogService.placeCoffee$c$;
COMMENT ON COLUMN coffee_slot_assignment.certified_by IS $c$Free-text name or id of whoever certified the placement. | Writer: catalogService.certifyPlacement, catalogService.placeCoffee$c$;
COMMENT ON COLUMN coffee_slot_assignment.certification_note IS $c$Optional note recorded with the certification. | Writer: catalogService.certifyPlacement, catalogService.placeCoffee$c$;
COMMENT ON COLUMN coffee_slot_assignment.created_by IS $c$Actor (admin Firebase uid, or unknown) that made the placement; overwritten when an inactive row is re-placed. | Writer: catalogService.placeCoffee, catalogService.addGuest, catalogService.moveCoffee$c$;
COMMENT ON COLUMN coffee_slot_assignment.created_at IS $c$UTC timestamp the row was first created.$c$;
COMMENT ON COLUMN coffee_slot_assignment.updated_at IS $c$UTC timestamp of the last change to the placement; feeds the catalog version stamp.$c$;
COMMENT ON COLUMN coffee_slot_assignment.basis IS $c$The evidence the placement rests on as JSON (same shape as coffee_archetype_assignment.basis); NULL until the Calibration workbench (cupping evidence brief 4) writes it.$c$;
COMMENT ON COLUMN coffee_slot_assignment.placed_from_session_id IS $c$References cupping_sessions.id (ON DELETE SET NULL): the cupping session the placement was decided from, so a newer session shows as newer evidence instead of silently moving the range; NULL until brief 4 writes it.$c$;

-- ── v_cupping_scores_readable ──
COMMENT ON VIEW v_cupping_session IS $c$Purpose: One row per cupping session for Score Entry: header and evidence columns, brew device (first sample's brew params), coffee count, current merged count and the names of the cuppers with a current row. | Class: view | Writer: none (derived) | Readers: cuppingReads | Since: 2026-10-18 (cupping evidence brief 1)$c$;
COMMENT ON VIEW v_cupping_session_coffee IS $c$Purpose: One row per sample for Score Entry: the coffee (from v_coffee), roast date, blind code, sample note, control flag, its brew params, its current merged score id, the cuppers with a current row and whether anything is scored. | Class: view | Writer: none (derived) | Readers: cuppingReads | Since: 2026-10-18 (cupping evidence brief 1)$c$;
COMMENT ON VIEW v_cupping_score IS $c$Purpose: One row per CURRENT score header (cupper or merged) with or without values: cupper name, scale, calls, merge rule and note; Score Entry lists a sample's rows from here. | Class: view | Writer: none (derived) | Readers: cuppingReads | Since: 2026-10-18 (cupping evidence brief 1)$c$;
COMMENT ON VIEW v_cupping_score_descriptor IS $c$Purpose: One row per descriptor on a CURRENT score row (cupper or merged), with the SCA node, its tier and the cupper's words. | Class: view | Writer: none (derived) | Readers: cuppingReads | Since: 2026-10-18 (cupping evidence brief 1)$c$;
COMMENT ON VIEW v_cupping_scores_readable IS $c$Purpose: One row per CURRENT score value (cupper or merged row x dimension) with session, sample, coffee, roaster and archetype (from v_coffee); value_min/max converted to 0 to 15 through cupping_to_ab(), native_min/max and raw_value as written, conversion_error, the calls and the evidence columns | Class: view | Writer: none (derived) | Readers: cuppingReads | Since: 2026-05-29 (current rows, converted: 2026-10-18)$c$;

-- ── v_collaborative_flavor_wheel ──
COMMENT ON VIEW v_collaborative_flavor_wheel IS $c$Purpose: Every decision-layer flavor-descriptor observation per coffee, one row each, labelled by source (internal = current merged cupping rows only since cupping evidence brief 1, roastery = accepted bag notes, client = customer feedback), with the SCA tier of each node. Internal since cupping evidence brief 6: customer surfaces read v_coffee_customer_descriptor, which takes its roastery and client branches. | Class: view | Writer: none (derived) | Readers: v_coffee_descriptor, v_coffee_customer_descriptor (roastery and client branches), v_evidence_descriptor (accepted), routes/admin.ts (admin Flavor Wheel, roastery and client branches), evidenceReads.getWorkbenchCoffee (accepted) | Since: 2026-05-27$c$;

-- ── quiz_backup_20261008_quiz ──
COMMENT ON TABLE quiz_backup_20261008_quiz IS $c$Purpose: Frozen copy of the quiz table taken at the first boot with SCD Type 2 quiz content, kept as a rollback reference and never written again. | Class: snapshot | Writer: seed | Readers: quizIntegrity (check 17) | Since: 2026-10-09 (#218, content as of 2026-10-08)$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz.id IS $c$Snapshot of quiz.id (UUID).$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz.version IS $c$Snapshot of quiz.version, the quiz version label (for example v7).$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz.description IS $c$Snapshot of quiz.description.$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz.is_active IS $c$Snapshot of quiz.is_active, whether the quiz was live.$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz.created_at IS $c$Snapshot of quiz.created_at (UTC).$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz.quiz_type_id IS $c$Snapshot of quiz.quiz_type_id, references quiz_type.id (main or branch).$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz.trigger_archetype_id IS $c$Snapshot of quiz.trigger_archetype_id, the coffee_archetype.id that triggers a branch quiz; NULL for main quizzes.$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz.parent_quiz_id IS $c$Snapshot of quiz.parent_quiz_id, the main quiz a branch quiz belongs to; NULL for main quizzes.$c$;

-- ── quiz_backup_20261008_quiz_question ──
COMMENT ON TABLE quiz_backup_20261008_quiz_question IS $c$Purpose: Frozen copy of the quiz_question table taken before SCD Type 2 versioning, kept as a rollback reference and never written again. | Class: snapshot | Writer: seed | Readers: quizIntegrity (check 17) | Since: 2026-10-09 (#218, content as of 2026-10-08)$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_question.id IS $c$Snapshot of quiz_question.id (UUID).$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_question.quiz_id IS $c$Snapshot of quiz_question.quiz_id, references quiz.id.$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_question.q_number IS $c$Snapshot of quiz_question.q_number, the question's position number within its quiz.$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_question.q_text IS $c$Snapshot of quiz_question.q_text, the question wording shown to customers.$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_question.weight IS $c$Snapshot of quiz_question.weight, the question's scoring multiplier (0 means food signal only).$c$;

-- ── quiz_backup_20261008_quiz_answer ──
COMMENT ON TABLE quiz_backup_20261008_quiz_answer IS $c$Purpose: Frozen copy of the quiz_answer table taken before SCD Type 2 versioning, preserving the production-minted answer ids, never written again. | Class: snapshot | Writer: seed | Readers: quizIntegrity (check 17) | Since: 2026-10-09 (#218, content as of 2026-10-08)$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_answer.id IS $c$Snapshot of quiz_answer.id (UUID), the answer id sessions store.$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_answer.question_id IS $c$Snapshot of quiz_answer.question_id, references quiz_question.id.$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_answer.answer_text IS $c$Snapshot of quiz_answer.answer_text, the answer wording shown to customers.$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_answer.next_question_id IS $c$Snapshot of quiz_answer.next_question_id, a legacy branch pointer to quiz_question.id; no TypeScript reads it.$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_answer.resulting_archetype_id IS $c$Snapshot of quiz_answer.resulting_archetype_id, the coffee_archetype.id an answer resolves to directly (branch answers).$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_answer.vector_impact IS $c$Snapshot of quiz_answer.vector_impact, a legacy JSON impact vector; no TypeScript reads it.$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_answer.weight IS $c$Snapshot of quiz_answer.weight, the answer's scoring multiplier.$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_answer.is_experimental_gate IS $c$Snapshot of quiz_answer.is_experimental_gate, true when the answer opens the experimental path.$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_answer.answer_code IS $c$Snapshot of quiz_answer.answer_code, the stable version-scoped code such as v7_q1_a; NULL for older content.$c$;

-- ── quiz_backup_20261008_quiz_answer_archetype_score ──
COMMENT ON TABLE quiz_backup_20261008_quiz_answer_archetype_score IS $c$Purpose: Frozen copy of the quiz_answer_archetype_score table taken before SCD Type 2 versioning, never written again. | Class: snapshot | Writer: seed | Readers: quizIntegrity (check 17) | Since: 2026-10-09 (#218, content as of 2026-10-08)$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_answer_archetype_score.id IS $c$Snapshot of quiz_answer_archetype_score.id (UUID).$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_answer_archetype_score.answer_id IS $c$Snapshot of quiz_answer_archetype_score.answer_id, references quiz_answer.id.$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_answer_archetype_score.question_id IS $c$Snapshot of quiz_answer_archetype_score.question_id, references quiz_question.id.$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_answer_archetype_score.archetype_id IS $c$Snapshot of quiz_answer_archetype_score.archetype_id, the scored coffee_archetype.id; NULL marked a neutral answer.$c$;
COMMENT ON COLUMN quiz_backup_20261008_quiz_answer_archetype_score.score IS $c$Snapshot of quiz_answer_archetype_score.score, points the answer awards to that archetype.$c$;

-- ── v_quiz_scoring_matrix ──
COMMENT ON VIEW v_quiz_scoring_matrix IS $c$Purpose: Full quiz scoring matrix, one row per question x answer x scored archetype across every content version, with the answer's is_current, valid_from and valid_to. | Class: view | Writer: none (derived) | Readers: none (manual SQL, no TypeScript consumer) | Since: 2026-05-25 (rebuilt on SCD2 columns 2026-10-09, #218)$c$;

-- ── v_archetype_vectors ──
COMMENT ON VIEW v_archetype_vectors IS $c$Purpose: Target flavor vector per archetype, one row per archetype x dimension with min, ideal and max score. | Class: view | Writer: none (derived) | Readers: coffees (GET /archetype-order distance; GET /api/axis/vectors removed, coffee presentation brief 2) | Since: 2026-06-12$c$;

-- ── v_archetype_dimension_comparison ──
COMMENT ON VIEW v_archetype_dimension_comparison IS $c$Purpose: Archetype target range (min, ideal, max, the May 2026 archetype_vector targets) beside the average midpoint of the latest merged cupping range (v_coffee_dimension_range) of the active coffees matched to the archetype, and their count, per archetype x dimension. | Class: view | Writer: none (derived) | Readers: coffees (GET /archetype-stats), dialSuggestion | Since: 2026-06-12 (latest merged range: 2026-10-18)$c$;
-- ── v_archetype_dimension_profile ──
COMMENT ON VIEW v_archetype_dimension_profile IS $c$Purpose: An archetype's actual profile, one row per archetype x dimension over the active coffees whose current match is that archetype and that have a pooled midpoint (v_coffee_dimension_range): avg_midpoint, min_midpoint, max_midpoint, coffee_count and coffee_ids (int[]), coffee_dimensions.id throughout; the reference the customer's compatibility sentence compares a coffee to, leaving that coffee out of its own archetype's profile. | Class: view | Writer: none (derived) | Readers: compatibilityReads | Since: 2026-10-24 (coffee presentation brief 2)$c$;

-- ── v_coffee_dial_position_consensus ──
COMMENT ON VIEW v_coffee_dial_position_consensus IS $c$Purpose: Weighted consensus of current dial_position_signal rows per coffee and archetype using dial_source_weight, a dormant advisory that never writes a placement. | Class: view | Writer: none (derived) | Readers: admin (GET /api/admin/dial/consensus/:coffeeId) | Since: 2026-07-09 (#75), renamed and re-keyed 2026-09-15$c$;

-- ── v_newsletter_subscribers ──
COMMENT ON VIEW v_newsletter_subscribers IS $c$Purpose: All newsletter signups with a human-readable source label, newest first. | Class: view | Writer: none (derived) | Readers: none (manual SQL, no TypeScript consumer) | Since: 2026-06-03$c$;

-- ── company_gift ──
COMMENT ON TABLE company_gift IS $c$Purpose: One purchased company gift batch (a sponsored few-month coffee perk for employees), a purchase event rather than a company profile. | Class: operating | Writer: companyGiftsAdmin.POST /api/admin/company-gifts, companyGiftsAdmin.POST /api/admin/company-gifts/:id/confirm-payment, companyGiftsAdmin.PATCH /api/admin/company-gifts/:id/email-template | Readers: companyGiftRedemption, companyGiftsAdmin, cron (expire-company-gift-codes) | Since: 2026-07-12$c$;
COMMENT ON COLUMN company_gift.id IS $c$Surrogate key (UUID) for the gift batch.$c$;
COMMENT ON COLUMN company_gift.company_name IS $c$Company name as typed at purchase time, a snapshot that is not updated if company.company_name changes.$c$;
COMMENT ON COLUMN company_gift.seat_count IS $c$Number of employee seats purchased, which is also the number of company_gift_code rows generated; must be greater than 0.$c$;
COMMENT ON COLUMN company_gift.sponsorship_months IS $c$Length of each redeemed sponsorship in months, default 3.$c$;
COMMENT ON COLUMN company_gift.admin_contact_name IS $c$Name of the company's HR or admin contact at purchase time (snapshot).$c$;
COMMENT ON COLUMN company_gift.admin_contact_email IS $c$Email of the company's HR or admin contact at purchase time (snapshot).$c$;
COMMENT ON COLUMN company_gift.code_redeem_by IS $c$Last date a code can be redeemed (calendar date); NULL means no deadline.$c$;
COMMENT ON COLUMN company_gift.payment_notes IS $c$Internal terms, invoice number or wire reference; never shown to employees.$c$;
COMMENT ON COLUMN company_gift.payment_confirmed_at IS $c$UTC timestamp payment was confirmed; NULL means codes exist but are not redeemable yet. | Writer: companyGiftsAdmin.POST /api/admin/company-gifts (when paid at creation), companyGiftsAdmin.POST /:id/confirm-payment$c$;
COMMENT ON COLUMN company_gift.total_amount_cents IS $c$Total agreed charge for the batch in US cents, for internal revenue reporting; NULL if not recorded.$c$;
COMMENT ON COLUMN company_gift.created_by_admin_id IS $c$References user_profile.id of the admin who created the batch.$c$;
COMMENT ON COLUMN company_gift.created_at IS $c$UTC timestamp the batch was created.$c$;
COMMENT ON COLUMN company_gift.email_template_override IS $c$Admin-edited wording for the HR handoff email, must contain the literal {{CODE}} placeholder (enforced in the API, not the database); NULL uses the default template. | Writer: companyGiftsAdmin.PATCH /:id/email-template$c$;
COMMENT ON COLUMN company_gift.company_id IS $c$References company.id, the stable employer identity across repeat purchases; NULL for rows created before the company table existed.$c$;

-- ── company_gift_code ──
COMMENT ON TABLE company_gift_code IS $c$Purpose: One redeemable code per seat of a company gift batch, tracking whether it is unredeemed, redeemed or expired. | Class: operating | Writer: companyGiftRedemption.POST /api/company-gift-redemption/:code/redeem, companyGiftsAdmin.POST /api/admin/company-gifts, cron.GET /api/cron/expire-company-gift-codes | Readers: companyGiftRedemption, companyGiftsAdmin, cron | Since: 2026-07-12$c$;
COMMENT ON COLUMN company_gift_code.id IS $c$Surrogate key (UUID) for the code row.$c$;
COMMENT ON COLUMN company_gift_code.company_gift_id IS $c$References company_gift.id, the batch this code belongs to (ON DELETE CASCADE).$c$;
COMMENT ON COLUMN company_gift_code.code IS $c$Unique redemption token, 8 human-friendly uppercase characters without ambiguous 0/O or 1/I.$c$;
COMMENT ON COLUMN company_gift_code.status IS $c$Redemption state, default unredeemed (documented values, no CHECK). One of: unredeemed, redeemed, expired. | Writer: companyGiftsAdmin.POST /api/admin/company-gifts (initial), companyGiftRedemption.POST /:code/redeem, cron.GET /expire-company-gift-codes$c$;
COMMENT ON COLUMN company_gift_code.redeemed_by_user_id IS $c$References user_profile.id of the employee who redeemed the code; NULL until redeemed. | Writer: companyGiftRedemption.POST /:code/redeem$c$;
COMMENT ON COLUMN company_gift_code.redeemed_at IS $c$UTC timestamp of redemption; NULL until redeemed. | Writer: companyGiftRedemption.POST /:code/redeem$c$;
COMMENT ON COLUMN company_gift_code.created_at IS $c$UTC timestamp the code was generated.$c$;

-- ── company ──
COMMENT ON TABLE company IS $c$Purpose: Stable employer identity so repeat company_gift purchases can be recognized as the same company; not a user profile and it never authenticates. | Class: operating | Writer: companyGiftsAdmin.POST /api/admin/company-gifts (inserts when no companyId is supplied) | Readers: companiesAdmin (GET /api/admin/companies), companyGiftsAdmin | Since: 2026-07-13$c$;
COMMENT ON COLUMN company.id IS $c$Surrogate key (UUID); referenced by company_gift.company_id.$c$;
COMMENT ON COLUMN company.company_name IS $c$Company display name, searched by the admin company picker.$c$;
COMMENT ON COLUMN company.primary_contact_name IS $c$Name of the main contact, defaulting at creation to the gift's admin contact name.$c$;
COMMENT ON COLUMN company.primary_contact_email IS $c$Email of the main contact, defaulting at creation to the gift's admin contact email.$c$;
COMMENT ON COLUMN company.notes IS $c$Relationship notes spanning all purchases; no app code writes it, so it is filled by manual database edit only.$c$;
COMMENT ON COLUMN company.created_at IS $c$UTC timestamp the company row was created.$c$;

-- ── quiz_funnel_event ──
COMMENT ON TABLE quiz_funnel_event IS $c$Purpose: First-party log of quiz funnel steps (start, complete, email submitted, final), the source of truth over GA4 because guests dominate quiz traffic. | Class: operating | Writer: funnelEvents.logFunnelEvent (via quiz.POST /api/quiz/event) | Readers: v_quiz_funnel_weekly, campaign_funnel_v, newsletter (archetype verification), quizIntegrity | Since: 2026-07-20 (#109)$c$;
COMMENT ON COLUMN quiz_funnel_event.id IS $c$Surrogate key (UUID) for the event.$c$;
COMMENT ON COLUMN quiz_funnel_event.session_key IS $c$Client-generated per-quiz-run random UUID held in memory; not a foreign key because most rows are guests.$c$;
COMMENT ON COLUMN quiz_funnel_event.event IS $c$Funnel step reached. One of: quiz_start, quiz_complete (pre-branch score), email_submitted, quiz_final (post-branch archetype shown) (CHECK).$c$;
COMMENT ON COLUMN quiz_funnel_event.archetype IS $c$Archetype display name text recorded on quiz_complete and quiz_final events; NULL on other events.$c$;
COMMENT ON COLUMN quiz_funnel_event.created_at IS $c$UTC timestamp the event was logged.$c$;
COMMENT ON COLUMN quiz_funnel_event.campaign IS $c$Campaign slug the visitor arrived through (for example hoboken-crawl-2026); NULL for non-campaign traffic.$c$;
COMMENT ON COLUMN quiz_funnel_event.campaign_vid IS $c$Anonymous per-phone visitor id (UUID) matching campaign_landing_event.vid, set only when campaign is set.$c$;

-- ── campaign_landing_event ──
COMMENT ON TABLE campaign_landing_event IS $c$Purpose: One row per campaign landing-page scan, minting the anonymous visitor key that joins a scan to later quiz and email events. | Class: operating | Writer: campaign.POST /api/campaign/landing | Readers: campaign_funnel_v | Since: 2026-08-31$c$;
COMMENT ON COLUMN campaign_landing_event.id IS $c$Surrogate key (UUID) for the landing event.$c$;
COMMENT ON COLUMN campaign_landing_event.campaign IS $c$Campaign slug the visitor landed on (for example hoboken-crawl-2026).$c$;
COMMENT ON COLUMN campaign_landing_event.vid IS $c$Anonymous per-phone visitor id (UUID) minted by the landing page; joins to quiz_funnel_event.campaign_vid and newsletter_subscriber.campaign_vid.$c$;
COMMENT ON COLUMN campaign_landing_event.utm_source IS $c$utm_source query parameter, trimmed; NULL if absent.$c$;
COMMENT ON COLUMN campaign_landing_event.utm_medium IS $c$utm_medium query parameter, trimmed; NULL if absent.$c$;
COMMENT ON COLUMN campaign_landing_event.utm_campaign IS $c$utm_campaign query parameter, trimmed; NULL if absent.$c$;
COMMENT ON COLUMN campaign_landing_event.referrer IS $c$Referrer URL sent by the client, truncated to 512 characters; NULL if absent.$c$;
COMMENT ON COLUMN campaign_landing_event.user_agent IS $c$Browser user-agent header, truncated to 256 characters; NULL if absent.$c$;
COMMENT ON COLUMN campaign_landing_event.created_at IS $c$UTC timestamp of the scan.$c$;

-- ── campaign_funnel_v ──
COMMENT ON VIEW campaign_funnel_v IS $c$Purpose: One row per campaign with scans, unique scanners, quiz starts and completes, email events, subscribers and first and last scan times. | Class: view | Writer: none (derived) | Readers: none (manual SQL, no TypeScript consumer) | Since: 2026-08-31$c$;

-- ── campaign_subscriber_archetype_v ──
COMMENT ON VIEW campaign_subscriber_archetype_v IS $c$Purpose: Per-archetype split of newsletter subscribers attributed to each campaign, for follow-up and the draw. | Class: view | Writer: none (derived) | Readers: none (manual SQL, no TypeScript consumer) | Since: 2026-08-31$c$;

-- ── v_subscribers_weekly ──
COMMENT ON VIEW v_subscribers_weekly IS $c$Purpose: Weekly new newsletter subscriber counts broken down by signup source, for the marketing dashboard. | Class: view | Writer: none (derived) | Readers: Looker Studio via reporting_ro | Since: 2026-07-22$c$;

-- ── v_quiz_funnel_weekly ──
COMMENT ON VIEW v_quiz_funnel_weekly IS $c$Purpose: Weekly quiz funnel from quiz_funnel_event with starts, completes, emails submitted, completion rate and opt-in rate (percent). | Class: view | Writer: none (derived) | Readers: Looker Studio via reporting_ro | Since: 2026-07-22$c$;

-- ── v_archetype_distribution ──
COMMENT ON VIEW v_archetype_distribution IS $c$Purpose: Newsletter subscriber count and percent share per archetype, from subscribers whose signup came through a quiz. | Class: view | Writer: none (derived) | Readers: Looker Studio via reporting_ro | Since: 2026-07-22$c$;

-- ── v_orders_weekly ──
COMMENT ON VIEW v_orders_weekly IS $c$Purpose: Weekly order count, first-time customers and revenue in cents from the order table. | Class: view | Writer: none (derived) | Readers: Looker Studio via reporting_ro | Since: 2026-07-22$c$;

-- ── quiz_session_interpretation ──
COMMENT ON TABLE quiz_session_interpretation IS $c$Purpose: SCD Type 2 interpretation of each quiz session per interpretation version; one is_current row per session, old rows kept forever. | Class: fact | Writer: quizSession.saveQuizInterpretation (live and backfill), quizSession.closeCurrentInterpretation (backfill only) | Readers: v_customer_quiz_current, v_customer_timeline, v_customer_calibration, v_subscriber_quiz_results, v_quiz_session_interpretation_history, quizSession.resolveInterpretation, +2 more | Since: 2026-09-25 (#193)$c$;
COMMENT ON COLUMN quiz_session_interpretation.id IS $c$Surrogate key (UUID) for the interpretation row.$c$;
COMMENT ON COLUMN quiz_session_interpretation.quiz_session_id IS $c$References quiz_session.id (no ON DELETE CASCADE); UNIQUE together with interpretation_version.$c$;
COMMENT ON COLUMN quiz_session_interpretation.interpretation_version IS $c$Ruleset that produced the row, such as v1 (seeded from context_data), v2.1 or v2.2.$c$;
COMMENT ON COLUMN quiz_session_interpretation.secondary_archetype IS $c$coffee_archetype.name text of the secondary archetype as written (v1 seed rows keep the legacy spelling); NULL when none.$c$;
COMMENT ON COLUMN quiz_session_interpretation.secondary_path IS $c$How the secondary was chosen. One of: near-tie, gate-backed, food-led, runner-up, none, branch-lean, branch-match; NULL on v1 rows.$c$;
COMMENT ON COLUMN quiz_session_interpretation.recommendation_mode IS $c$How to recommend. One of: primary_only, primary_plus_introduce_secondary, primary_plus_active_secondary, primary_plus_note_secondary, primary_as_starting_point, ai_agent (kept for old rows only).$c$;
COMMENT ON COLUMN quiz_session_interpretation.food_signal_alignment IS $c$Legacy food-signal label, computed as before. One of: high, medium, low.$c$;
COMMENT ON COLUMN quiz_session_interpretation.pair_confidence IS $c$Confidence in the primary-plus-secondary pair. One of: high, medium, low; NULL on v1 rows.$c$;
COMMENT ON COLUMN quiz_session_interpretation.explore_archetype IS $c$coffee_archetype.name text of the archetype suggested for exploring; NULL when none.$c$;
COMMENT ON COLUMN quiz_session_interpretation.explore_reason IS $c$Free-text reason(s) for the explore suggestion, several joined with a semicolon; NULL when none.$c$;
COMMENT ON COLUMN quiz_session_interpretation.primary_margin IS $c$Points between the winning archetype score and the runner-up (quiz score points); NULL on v1 rows.$c$;
COMMENT ON COLUMN quiz_session_interpretation.is_current IS $c$True on the one row per session produced by the latest ruleset (partial unique index); flipped false only when a successor is written. | Writer: quizSession.saveQuizInterpretation, quizSession.closeCurrentInterpretation (backfill only)$c$;
COMMENT ON COLUMN quiz_session_interpretation.valid_from IS $c$UTC timestamp this interpretation became effective; defaults to now at insert, backfilled rows keep the session time.$c$;
COMMENT ON COLUMN quiz_session_interpretation.valid_to IS $c$UTC timestamp this interpretation was superseded; NULL while current. | Writer: quizSession.closeCurrentInterpretation (backfill only)$c$;
COMMENT ON COLUMN quiz_session_interpretation.computed_by IS $c$How the row came to exist. One of: scored (live quiz submit), seed (v1 rows built from context_data), backfill (re-interpretation script) (CHECK).$c$;
COMMENT ON COLUMN quiz_session_interpretation.computed_at IS $c$UTC timestamp the row was written.$c$;
COMMENT ON COLUMN quiz_session_interpretation.match_archetype IS $c$coffee_archetype.name text of where on the Bloom Dial the person is matched (v2.2 MATCH layer); set on every v2.2 row, NULL on v1 and v2.1 rows.$c$;
COMMENT ON COLUMN quiz_session_interpretation.intensity_lean IS $c$Position lean within the match archetype. One of: delicate (CHECK); NULL means the archetype's default position.$c$;

-- ── v_subscriber_quiz_results ──
COMMENT ON VIEW v_subscriber_quiz_results IS $c$Purpose: One row per newsletter subscriber joined to their most recent quiz session and its current interpretation, for Looker Studio and calibration exports | Class: view | Writer: none (derived) | Readers: reporting_ro (Looker Studio), manual CSV exports (scripts/quizRecalibrate.ts input), no app code | Since: 2026-09-20$c$;

-- ── v_quiz_session_interpretation_history ──
COMMENT ON VIEW v_quiz_session_interpretation_history IS $c$Purpose: One row per quiz session per interpretation version (current and superseded), the calibration surface for before/after comparisons | Class: view | Writer: none (derived) | Readers: reporting_ro (Looker Studio), manual calibration exports, no app code | Since: 2026-09-25$c$;

-- ── marketing_config ──
COMMENT ON TABLE marketing_config IS $c$Purpose: Admin-editable key/value store for the Looker Studio, Mailchimp audience and ad-spend sheet URLs shown on the admin Marketing cards | Class: operating | Writer: reportingConfig.setMarketingConfigValue; seed | Readers: reportingConfig.getMarketingConfig (admin GET /api/admin/marketing/config) | Since: 2026-07-21$c$;
COMMENT ON COLUMN marketing_config.key IS $c$Config key and primary key; one of looker_studio_url, mailchimp_audience_url, adspend_sheet_url (the three seeded rows, enforced in reportingConfig.ts not by a CHECK). | Writer: seed$c$;
COMMENT ON COLUMN marketing_config.value IS $c$The URL for that key, or NULL while unset; blank input is stored as NULL.$c$;
COMMENT ON COLUMN marketing_config.updated_at IS $c$UTC timestamp of the last edit through the admin Marketing card; set on every UPDATE.$c$;

-- ── qr_scan_event ──
COMMENT ON TABLE qr_scan_event IS $c$Purpose: One row per QR token resolve (every scan, any outcome), the only data source for per-bag scan engagement | Class: operating | Writer: qr.logScanEvent (GET /api/qr/:token/resolve and GET /api/qr/resolve) | Readers: engagementMetrics.getPerBagEngagementRate, engagementMetrics.getEngagedVsUnengagedReorderRate, customer_bag_claim FK | Since: 2026-08-02$c$;
COMMENT ON COLUMN qr_scan_event.id IS $c$Auto-increment integer primary key; referenced by customer_bag_claim.qr_scan_event_id.$c$;
COMMENT ON COLUMN qr_scan_event.token IS $c$The opaque token that was scanned: a coffees.qr_token for coffee scans or the qr_universal_token.token for universal scans (bare /b scans log the canonical token); kept even when it matched nothing.$c$;
COMMENT ON COLUMN qr_scan_event.coffee_id IS $c$References coffees.id (ON DELETE SET NULL); NULL for universal-token scans and unknown tokens.$c$;
COMMENT ON COLUMN qr_scan_event.auth_state IS $c$Who scanned, enum qr_auth_state_enum. One of: owner, signed_out, non_owner, unresolved, no_orders.$c$;
COMMENT ON COLUMN qr_scan_event.destination IS $c$Where the scan sent the visitor, enum qr_destination_enum. One of: bag_view, sign_in, story_page, retired_story, unknown, bag_picker, brand_landing, door_choice.$c$;
COMMENT ON COLUMN qr_scan_event.user_id IS $c$References user_profile.id (ON DELETE SET NULL); set only when the scanner was really signed in, NULL for anonymous visitors.$c$;
COMMENT ON COLUMN qr_scan_event.scanned_at IS $c$UTC timestamp of the scan.$c$;
COMMENT ON COLUMN qr_scan_event.token_type IS $c$Kind of token scanned, enum qr_token_type_enum. One of: coffee, universal. Defaults to coffee (all rows from before the universal QR existed).$c$;
COMMENT ON COLUMN qr_scan_event.source IS $c$Print-run label from qr_universal_token.source (path or temecula) for universal-token scans; NULL for coffee-token scans.$c$;

-- ── qr_universal_token ──
COMMENT ON TABLE qr_universal_token IS $c$Purpose: The universal printed-QR tokens, one row per print-run source, resolved through the same /b endpoint as per-coffee tokens | Class: operating | Writer: qrDoor.mintUniversalToken | Readers: qrDoor.resolveUniversalToken, qrDoor.listUniversalTokens, qrDoor.mintMissingUniversalTokens | Since: 2026-08-03$c$;
COMMENT ON COLUMN qr_universal_token.id IS $c$Auto-increment integer primary key.$c$;
COMMENT ON COLUMN qr_universal_token.token IS $c$Opaque unique token printed in the QR artwork; never regenerated once minted because it may already be printed.$c$;
COMMENT ON COLUMN qr_universal_token.source IS $c$Unique print-run label the token belongs to; path (the canonical token in ink) or temecula (still resolves, no longer minted or shown in admin).$c$;
COMMENT ON COLUMN qr_universal_token.created_at IS $c$UTC timestamp the token was minted.$c$;

-- ── claude_daily_spend ──
COMMENT ON TABLE claude_daily_spend IS $c$Purpose: Atomic per-UTC-day, per-feature running total of Anthropic API spend that drives the global and per-feature Claude kill-switch caps | Class: operating | Writer: anthropicGuard.recordSpendMicros (via guardClaudeCall); seed | Readers: anthropicGuard.getTodaySpend, admin GET /api/admin/ai-ops | Since: 2026-08-08$c$;
COMMENT ON COLUMN claude_daily_spend.date IS $c$UTC calendar date of the spend; part of the primary key (date, feature).$c$;
COMMENT ON COLUMN claude_daily_spend.cents IS $c$Class: deprecated | FROZEN 2026-10-01: superseded by usd_micros (Liam access & cost brief). Not read or written by the app; kept for history. Removal tracked in OPEN_TASKS.md OT-30. (docs say never read, code does: no app TypeScript touches it, only the schema.sql boot-time backfill UPDATE reads it to seed usd_micros)$c$;
COMMENT ON COLUMN claude_daily_spend.updated_at IS $c$UTC timestamp of the last spend increment for that date and feature.$c$;
COMMENT ON COLUMN claude_daily_spend.feature IS $c$AI feature bucket the spend is attributed to, part of the primary key. One of: liam_chat, quiz_recommendation, coffee_content, lifecycle, unattributed (unattributed = rows from before per-feature attribution).$c$;
COMMENT ON COLUMN claude_daily_spend.usd_micros IS $c$Accumulated spend in micro-dollars (1 USD = 1,000,000), the only spend column the app writes and reads; each call is rounded up to the next micro-dollar.$c$;

-- ── api_event ──
COMMENT ON TABLE api_event IS $c$Purpose: Append-only capture-first log of every mutating API request (redacted body, status, duration), also carrying client-side errors from POST /api/client-errors | Class: operating | Writer: apiEventLog.apiEventLog (INSERT before the handler, UPDATE at response finish), apiEventLog.writeOutcome | Readers: admin GET /system-health, catalogReads.getChanges, quizIntegrity, customerIntegrity, scripts/audit-quiz-emails.mjs | Since: 2026-08-13$c$;
COMMENT ON COLUMN api_event.id IS $c$UUID primary key generated by the middleware per request (also exposed to handlers as res.locals.apiEventId).$c$;
COMMENT ON COLUMN api_event.occurred_at IS $c$UTC timestamp the request was captured (database now() at insert).$c$;
COMMENT ON COLUMN api_event.call_type IS $c$Route-pattern label such as POST /api/orders/:id/cancel, stable across ids; provisional at insert and corrected at finish.$c$;
COMMENT ON COLUMN api_event.method IS $c$HTTP method: POST, PUT, PATCH or DELETE.$c$;
COMMENT ON COLUMN api_event.path IS $c$Request originalUrl without the query string.$c$;
COMMENT ON COLUMN api_event.firebase_uid IS $c$Firebase uid of the caller, filled at response finish once auth middleware ran; NULL if unauthenticated or the request never finished.$c$;
COMMENT ON COLUMN api_event.is_anonymous IS $c$True if the caller was an anonymous Firebase session; NULL when unknown.$c$;
COMMENT ON COLUMN api_event.request_body IS $c$JSON request body with secret-like keys redacted and truncated over 64 KB; NULL when there was no body.$c$;
COMMENT ON COLUMN api_event.body_truncated IS $c$True if request_body was cut at the size cap.$c$;
COMMENT ON COLUMN api_event.response_status IS $c$HTTP response status; 499 = client closed the connection first; NULL = captured but never finished (crash or instance death).$c$;
COMMENT ON COLUMN api_event.response_error IS $c$JSON response body (redacted, capped at 2 KB) when status is 400 or higher, or the client-closed marker for 499; otherwise NULL.$c$;
COMMENT ON COLUMN api_event.duration_ms IS $c$Request duration in milliseconds, set at response finish.$c$;

-- ── v_coffee_archetype ──
COMMENT ON VIEW v_coffee_archetype IS $c$Purpose: One row per coffee archetype (all six including experimental) exposing code, label and dial metadata, replacing hand-typed archetype name maps | Class: view | Writer: none (derived) | Readers: catalogReads.getArchetypes, routes/axis, roasteryPortalReads, v_coffee_archetype_adjacency | Since: 2026-09-13$c$;

-- ── v_coffee ──
COMMENT ON VIEW v_coffee IS $c$Purpose: One row per coffee (active or not) with roaster name, current match archetype and category codes, the one read model for a coffee's identity | Class: view | Writer: none (derived) | Readers: catalogReads.getCoffee, catalogReads.getCoffees, routes/admin, routes/axis, catalogService, catalogIntegrity, v_coffee_slot, v_coffee_sellable_candidate, +8 more (behavioralConfidence, roasteryPortalReads, 6 views incl. v_coffee_customer_descriptor) | Since: 2026-09-13$c$;

-- ── v_coffee_slot ──
COMMENT ON VIEW v_coffee_slot IS $c$Purpose: One row per coffee_slot_assignment (active or not) showing placement archetype beside match archetype and whether they agree | Class: view | Writer: none (derived) | Readers: catalogReads.getHomeSlot, catalogReads.getSlotsForCoffee, catalogReads.getSlotsForCoffees, routes/admin, catalogService, catalogIntegrity | Since: 2026-09-13$c$;

-- ── coffee_size ──
COMMENT ON TABLE coffee_size IS $c$Purpose: The list of sellable bag sizes (12 oz anchor, 2 lb, 5 lb) that every weight in SKUs, slot prices and retail prices must come from | Class: master | Writer: seed | Readers: catalogReads.getSizes, catalogReads.getAnchorSize, catalogIntegrity, v_coffee_sellable_candidate, v_coffee_visibility, v_palate_slot_candidates, +3 FKs (coffee_sku, coffee_slot_price, coffee_retail_price) | Since: 2026-09-28$c$;
COMMENT ON COLUMN coffee_size.weight_oz IS $c$Bag weight in ounces (numeric, CHECK greater than 0); primary key referenced by coffee_sku, coffee_slot_price and coffee_retail_price weight_oz.$c$;
COMMENT ON COLUMN coffee_size.label IS $c$Customer-facing size label such as 12 oz, 2 lb or 5 lb.$c$;
COMMENT ON COLUMN coffee_size.sort_order IS $c$Unique display order of sizes, ascending.$c$;
COMMENT ON COLUMN coffee_size.is_anchor IS $c$True for the single anchor size (partial unique index coffee_size_one_anchor): the size every coffee must have a SKU for, Liam recommends and subscriptions use.$c$;
COMMENT ON COLUMN coffee_size.is_active IS $c$False hides the size from candidate and visibility views; all current sizes are active.$c$;
COMMENT ON COLUMN coffee_size.created_at IS $c$UTC timestamp the size row was created.$c$;
COMMENT ON COLUMN coffee_size.updated_at IS $c$UTC timestamp of the last change; no code path updates it today, so it equals created_at.$c$;

-- ── v_coffee_sellable_candidate ──
COMMENT ON VIEW v_coffee_sellable_candidate IS $c$Purpose: Pre-winner candidate list of active slot x assignment x coffee x size rows with blend, price, rank and is_sellable, so the resolver can explain why a candidate lost | Class: view | Writer: none (derived) | Readers: catalogReads (candidates for a slot and weight), v_coffee_sellable_slot, v_coffee_visibility | Since: 2026-09-14$c$;

-- ── v_coffee_sellable_slot ──
COMMENT ON VIEW v_coffee_sellable_slot IS $c$Purpose: One winning row per slot and weight a customer can actually buy right now (home first, then priority), the single candidate pool for Liam, checkout and public pages | Class: view | Writer: none (derived) | Readers: catalogReads.getSellableSlots, catalogService, v_coffee_visibility, v_palate_slot_candidates | Since: 2026-09-13$c$;

-- ── v_coffee_visibility ──
COMMENT ON VIEW v_coffee_visibility IS $c$Purpose: One row per active placement x active size explaining whether that coffee wins the slot and, if not, why (inactive, category, no SKU, no price, outranked) | Class: view | Writer: none (derived) | Readers: catalogReads.getCoffeeVisibility, catalogReads.getSlotVisibility, catalogReads.getNotSellable, v_coffee_visibility_summary | Since: 2026-09-28$c$;

-- ── v_coffee_visibility_summary ──
COMMENT ON VIEW v_coffee_visibility_summary IS $c$Purpose: One row per coffee saying whether it is visible to customers at any size, is placed at all, and in how many slots it wins | Class: view | Writer: none (derived) | Readers: catalogReads (coffee visibility), roasteryPortalReads | Since: 2026-09-28$c$;

-- ── v_coffee_hop ──
COMMENT ON VIEW v_coffee_hop IS $c$Purpose: One row per coffee_hop with endpoint names, active flags, home slots and archetypes, and hop_type_derived (within or bridge archetype) computed fresh | Class: view | Writer: none (derived) | Readers: catalogReads.getHops, routes/admin, routes/axis, catalogService, catalogIntegrity, dialSuggestion, v_coffee_archetype_adjacency | Since: 2026-09-13$c$;

-- ── v_coffee_archetype_adjacency ──
COMMENT ON VIEW v_coffee_archetype_adjacency IS $c$Purpose: Cross-archetype bridge-hop summary (hop counts, more/less split, average confidence) between archetype pairs, from active coffees only | Class: view | Writer: none (derived) | Readers: routes/axis (GET /api/axis/adjacency and stats), sommelierRag | Since: 2026-09-13$c$;

-- ── customer_identity_link ──
COMMENT ON TABLE customer_identity_link IS $c$Purpose: Append-only fact linking an older or guest user profile to the surviving profile it merged into, walked at read time to find a customer's canonical id | Class: fact | Writer: customerFacts.identityLink (called from auth.POST /sync), customerFacts.identityLinkBackfill | Readers: v_customer_identity, v_customer_timeline, customerReads.getFactsWatermark, customerIntegrity | Since: 2026-09-27$c$;
COMMENT ON COLUMN customer_identity_link.id IS $c$Surrogate UUID primary key of this fact row.$c$;
COMMENT ON COLUMN customer_identity_link.user_id IS $c$References user_profile.id; set equal to from_user_id (the profile being linked away).$c$;
COMMENT ON COLUMN customer_identity_link.occurred_at IS $c$UTC timestamp the link happened; database clock at insert, set explicitly only by backfill.$c$;
COMMENT ON COLUMN customer_identity_link.recorded_at IS $c$UTC timestamp the row was recorded; differs from occurred_at only for rows learned of later (backfill).$c$;
COMMENT ON COLUMN customer_identity_link.source IS $c$Origin of the fact, idempotency key with source_id. Code allows: onsite, liam, sms, shopify, qr, backfill, backfill_detected (no DB CHECK); this table gets onsite or backfill.$c$;
COMMENT ON COLUMN customer_identity_link.source_id IS $c$Idempotency key within source, built as from_user_id:to_user_id; UNIQUE (source, source_id).$c$;
COMMENT ON COLUMN customer_identity_link.catalog_version IS $c$Catalog version string from getCatalogVersion() when the fact was recorded; NULL only on backfilled rows.$c$;
COMMENT ON COLUMN customer_identity_link.from_user_id IS $c$References user_profile.id of the older or merged profile the link points away from; must differ from to_user_id.$c$;
COMMENT ON COLUMN customer_identity_link.to_user_id IS $c$References user_profile.id of the surviving profile new facts should read as.$c$;
COMMENT ON COLUMN customer_identity_link.how IS $c$How the link was established. One of: email_match, household_claim, admin (only email_match has a caller today).$c$;

-- ── customer_feedback_event ──
COMMENT ON TABLE customer_feedback_event IS $c$Purpose: Append-only fact of a customer rating and expectation feedback on a coffee they received, revised by new rows that supersede old ones | Class: fact | Writer: customerFacts.feedback (called from orders.POST /:orderId/feedback and liamSmsFeedback.parseInboundReply), customerFacts.feedbackBackfill | Readers: v_customer_feedback_current, v_customer_timeline, v_collaborative_flavor_wheel, customerReads.latestFeedbackEventForOrder, customerReads.getFactsWatermark | Since: 2026-09-27$c$;
COMMENT ON COLUMN customer_feedback_event.id IS $c$Surrogate UUID primary key of this fact row.$c$;
COMMENT ON COLUMN customer_feedback_event.user_id IS $c$References user_profile.id of the customer giving feedback; never firebase_uid or email.$c$;
COMMENT ON COLUMN customer_feedback_event.occurred_at IS $c$UTC timestamp the feedback happened; database clock at insert, set explicitly only by backfill.$c$;
COMMENT ON COLUMN customer_feedback_event.recorded_at IS $c$UTC timestamp the row was recorded; differs from occurred_at only for rows learned of later (backfill).$c$;
COMMENT ON COLUMN customer_feedback_event.source IS $c$Origin of the fact, idempotency key with source_id. Code allows: onsite, liam, sms, shopify, qr, backfill, backfill_detected (no DB CHECK); this table gets onsite, sms or backfill.$c$;
COMMENT ON COLUMN customer_feedback_event.source_id IS $c$Idempotency key within source: a fresh UUID for onsite feedback, the sommelier_sms_feedback inbound row id for sms; UNIQUE (source, source_id).$c$;
COMMENT ON COLUMN customer_feedback_event.catalog_version IS $c$Catalog version string from getCatalogVersion() when the fact was recorded; NULL only on backfilled rows.$c$;
COMMENT ON COLUMN customer_feedback_event.order_line_item_id IS $c$References order_line_item.id of the bag the feedback is about; NULL when the order had several lines and the line could not be attributed.$c$;
COMMENT ON COLUMN customer_feedback_event.coffee_id IS $c$References coffees.id of the coffee the feedback is about.$c$;
COMMENT ON COLUMN customer_feedback_event.rating IS $c$Customer rating on a 1-5 scale (CHECK 1 to 5); NULL if none given.$c$;
COMMENT ON COLUMN customer_feedback_event.expectation IS $c$Whether the coffee matched what the customer expected. One of: lighter, as_expected, bolder (enforced in app code, no DB CHECK); NULL if not addressed.$c$;
COMMENT ON COLUMN customer_feedback_event.raw_text IS $c$The customer's free-text note, or the verbatim inbound SMS body; NULL if none.$c$;
COMMENT ON COLUMN customer_feedback_event.supersedes_id IS $c$References customer_feedback_event.id of the earlier feedback this row revises; NULL for a first response. A row with no newer row pointing at it is the current one.$c$;
COMMENT ON COLUMN customer_feedback_event.channel IS $c$Channel the feedback arrived through. One of: onsite, sms, liam (no writer uses liam today).$c$;

-- ── customer_feedback_descriptor ──
COMMENT ON TABLE customer_feedback_descriptor IS $c$Purpose: Append-only fact linking a feedback event to each tasted flavor note (cupping_note) the customer picked | Class: fact | Writer: customerFacts.feedbackDescriptor (called from orders.POST /:orderId/feedback), customerFacts.feedbackDescriptorBackfill | Readers: v_customer_feedback_current, v_collaborative_flavor_wheel | Since: 2026-09-27$c$;
COMMENT ON COLUMN customer_feedback_descriptor.id IS $c$Surrogate UUID primary key of this fact row.$c$;
COMMENT ON COLUMN customer_feedback_descriptor.user_id IS $c$References user_profile.id of the customer who tasted the note; never firebase_uid or email.$c$;
COMMENT ON COLUMN customer_feedback_descriptor.occurred_at IS $c$UTC timestamp the descriptor was chosen; database clock at insert, set explicitly only by backfill.$c$;
COMMENT ON COLUMN customer_feedback_descriptor.recorded_at IS $c$UTC timestamp the row was recorded; differs from occurred_at only for rows learned of later (backfill).$c$;
COMMENT ON COLUMN customer_feedback_descriptor.source IS $c$Origin of the fact, idempotency key with source_id. Code allows: onsite, liam, sms, shopify, qr, backfill, backfill_detected (no DB CHECK); this table gets onsite or backfill.$c$;
COMMENT ON COLUMN customer_feedback_descriptor.source_id IS $c$Idempotency key within source, built as feedback_event_id:cupping_note_id; UNIQUE (source, source_id).$c$;
COMMENT ON COLUMN customer_feedback_descriptor.feedback_event_id IS $c$References customer_feedback_event.id of the feedback this note belongs to; UNIQUE with cupping_note_id.$c$;
COMMENT ON COLUMN customer_feedback_descriptor.cupping_note_id IS $c$References cupping_note.id, the flavor note the customer said they tasted.$c$;

-- ── customer_brew_profile_change ──
COMMENT ON TABLE customer_brew_profile_change IS $c$Purpose: Append-only log of changes to a customer's brew profile (methods, grinder, preferences), replayed in order to produce the current profile | Class: fact | Writer: customerFacts.brewProfileChange (called from users.PATCH /brew-profile, users.DELETE /brew-profile and sommelier.resolveRemember), customerFacts.brewProfileChangeBackfill | Readers: v_customer_brew_profile, v_customer_timeline, customerReads.getFactsWatermark, customerIntegrity | Since: 2026-09-27$c$;
COMMENT ON COLUMN customer_brew_profile_change.id IS $c$Surrogate UUID primary key of this fact row.$c$;
COMMENT ON COLUMN customer_brew_profile_change.user_id IS $c$References user_profile.id of the customer whose profile changed; never firebase_uid or email.$c$;
COMMENT ON COLUMN customer_brew_profile_change.occurred_at IS $c$UTC timestamp the change happened; database clock at insert, set explicitly only by backfill; ops are replayed in this order.$c$;
COMMENT ON COLUMN customer_brew_profile_change.recorded_at IS $c$UTC timestamp the row was recorded; differs from occurred_at only for rows learned of later (backfill).$c$;
COMMENT ON COLUMN customer_brew_profile_change.source IS $c$Origin of the fact, idempotency key with source_id. Code allows: onsite, liam, sms, shopify, qr, backfill, backfill_detected (no DB CHECK); this table gets onsite, liam or backfill.$c$;
COMMENT ON COLUMN customer_brew_profile_change.source_id IS $c$Idempotency key within source: the api_event id (or a derived fallback key) for onsite edits, session:turn:field:value for Liam; UNIQUE (source, source_id).$c$;
COMMENT ON COLUMN customer_brew_profile_change.catalog_version IS $c$Catalog version string from getCatalogVersion() when the fact was recorded; NULL only on backfilled rows.$c$;
COMMENT ON COLUMN customer_brew_profile_change.field IS $c$Which brew-profile field changed. One of: brew_methods, grinder, takes_it, decaf_constraint, aversions.$c$;
COMMENT ON COLUMN customer_brew_profile_change.value IS $c$The new value as a JSON-encoded string; NULL for a clear op.$c$;
COMMENT ON COLUMN customer_brew_profile_change.op IS $c$How the value applies to the field. One of: set, add, remove, clear.$c$;
COMMENT ON COLUMN customer_brew_profile_change.session_id IS $c$References sommelier_sessions.id when the change came from a Liam conversation; NULL for onsite edits.$c$;

-- ── customer_dial_event ──
COMMENT ON TABLE customer_dial_event IS $c$Purpose: Append-only fact of a customer explicitly saving a dial position or adding a dial coffee to cart | Class: fact | Writer: customerFacts.dialEvent (called from users.PATCH /dial-position), customerFacts.dialEventBackfill | Readers: v_customer_timeline, customerReads.getRecentDialActivity, customerReads.getFactsWatermark | Since: 2026-09-27$c$;
COMMENT ON COLUMN customer_dial_event.id IS $c$Surrogate UUID primary key of this fact row.$c$;
COMMENT ON COLUMN customer_dial_event.user_id IS $c$References user_profile.id of the customer; never firebase_uid or email.$c$;
COMMENT ON COLUMN customer_dial_event.occurred_at IS $c$UTC timestamp the event happened; database clock at insert, set explicitly only by backfill.$c$;
COMMENT ON COLUMN customer_dial_event.recorded_at IS $c$UTC timestamp the row was recorded; differs from occurred_at only for rows learned of later (backfill).$c$;
COMMENT ON COLUMN customer_dial_event.source IS $c$Origin of the fact, idempotency key with source_id. Code allows: onsite, liam, sms, shopify, qr, backfill, backfill_detected (no DB CHECK); this table gets onsite or backfill.$c$;
COMMENT ON COLUMN customer_dial_event.source_id IS $c$Idempotency key within source: a fresh UUID per onsite event; UNIQUE (source, source_id).$c$;
COMMENT ON COLUMN customer_dial_event.catalog_version IS $c$Catalog version string from getCatalogVersion() when the fact was recorded; NULL only on backfilled rows.$c$;
COMMENT ON COLUMN customer_dial_event.event_type IS $c$What the customer did. One of: explicit_save, add_to_cart.$c$;
COMMENT ON COLUMN customer_dial_event.slot_id IS $c$References coffee_dial_slot.id (integer) resolved from the archetype and dial position; NULL if unknown.$c$;
COMMENT ON COLUMN customer_dial_event.coffee_id IS $c$References coffees.id of the coffee on the dial position when the client sent one; NULL otherwise.$c$;
COMMENT ON COLUMN customer_dial_event.archetype_code IS $c$Archetype of the dial the event happened on, as an archetype_enum code; NULL if unknown.$c$;

-- ── customer_liam_recommendation ──
COMMENT ON TABLE customer_liam_recommendation IS $c$Purpose: Append-only fact of a coffee Liam recommended in a chat turn (marked pick or detected mention) with the candidate pool it chose from | Class: fact | Writer: customerFacts.liamRecommendation (called from liamWriteBack.recordTurn via recordRecommendation), customerFacts.liamRecommendationBackfill | Readers: v_customer_timeline, v_palate_evidence, v_palate_recommendation_outcome, v_customer_calibration, customerReads.getFactsWatermark | Since: 2026-09-27$c$;
COMMENT ON COLUMN customer_liam_recommendation.id IS $c$Surrogate UUID primary key of this fact row.$c$;
COMMENT ON COLUMN customer_liam_recommendation.user_id IS $c$References user_profile.id of the customer Liam was talking to; never firebase_uid or email.$c$;
COMMENT ON COLUMN customer_liam_recommendation.occurred_at IS $c$UTC timestamp the recommendation was made; database clock at insert, set explicitly only by backfill.$c$;
COMMENT ON COLUMN customer_liam_recommendation.recorded_at IS $c$UTC timestamp the row was recorded; differs from occurred_at only for rows learned of later (backfill).$c$;
COMMENT ON COLUMN customer_liam_recommendation.source IS $c$Origin of the fact, idempotency key with source_id. Code allows: onsite, liam, sms, shopify, qr, backfill, backfill_detected (no DB CHECK); this table gets liam or backfill_detected.$c$;
COMMENT ON COLUMN customer_liam_recommendation.source_id IS $c$Idempotency key within source: session:turn:recommend for a marked pick, session:turn:detected:coffee_id for a detected mention; UNIQUE (source, source_id).$c$;
COMMENT ON COLUMN customer_liam_recommendation.catalog_version IS $c$Catalog version string from getCatalogVersion() when the fact was recorded; NULL only on backfilled rows.$c$;
COMMENT ON COLUMN customer_liam_recommendation.session_id IS $c$References sommelier_sessions.id of the Liam conversation.$c$;
COMMENT ON COLUMN customer_liam_recommendation.turn IS $c$Turn number within the Liam session in which the recommendation was made.$c$;
COMMENT ON COLUMN customer_liam_recommendation.message_id IS $c$Id of Liam's assistant message (Firestore message id) that carried the recommendation.$c$;
COMMENT ON COLUMN customer_liam_recommendation.coffee_id IS $c$References coffees.id of the recommended coffee; CHECK requires coffee_id or slot_id to be set.$c$;
COMMENT ON COLUMN customer_liam_recommendation.slot_id IS $c$References coffee_dial_slot.id (integer) when the recommendation was a slot rather than a coffee; the live writer sets only coffee_id.$c$;
COMMENT ON COLUMN customer_liam_recommendation.candidate_coffee_ids IS $c$Array of coffees.id values Liam was offered as the candidate pool for this turn.$c$;
COMMENT ON COLUMN customer_liam_recommendation.palate_read_version IS $c$Version tag of the palate read in effect (live writer sets v1); NULL on backfilled rows.$c$;
COMMENT ON COLUMN customer_liam_recommendation.detected IS $c$False when Liam marked the pick explicitly, true when it was inferred from an unmarked mention in the reply (lower grade).$c$;

-- ── customer_liam_question ──
COMMENT ON TABLE customer_liam_question IS $c$Purpose: Append-only fact of a clarifying question Liam asked the customer in a chat turn (thread, palate or brew) | Class: fact | Writer: customerFacts.liamQuestion (called from liamWriteBack.recordTurn via recordQuestion), customerFacts.liamQuestionBackfill | Readers: v_customer_timeline, v_palate_evidence, v_palate_threads, customerReads.getFactsWatermark | Since: 2026-09-27$c$;
COMMENT ON COLUMN customer_liam_question.id IS $c$Surrogate UUID primary key of this fact row; referenced by customer_liam_reply.question_id.$c$;
COMMENT ON COLUMN customer_liam_question.user_id IS $c$References user_profile.id of the customer Liam was talking to; never firebase_uid or email.$c$;
COMMENT ON COLUMN customer_liam_question.occurred_at IS $c$UTC timestamp the question was asked; database clock at insert.$c$;
COMMENT ON COLUMN customer_liam_question.recorded_at IS $c$UTC timestamp the row was recorded; normally equal to occurred_at.$c$;
COMMENT ON COLUMN customer_liam_question.source IS $c$Origin of the fact, idempotency key with source_id. Code allows: onsite, liam, sms, shopify, qr, backfill, backfill_detected (no DB CHECK); this table gets liam.$c$;
COMMENT ON COLUMN customer_liam_question.source_id IS $c$Idempotency key within source, built as session:turn:ask; UNIQUE (source, source_id).$c$;
COMMENT ON COLUMN customer_liam_question.catalog_version IS $c$Catalog version string from getCatalogVersion() when the fact was recorded.$c$;
COMMENT ON COLUMN customer_liam_question.session_id IS $c$References sommelier_sessions.id of the Liam conversation.$c$;
COMMENT ON COLUMN customer_liam_question.turn IS $c$Turn number within the Liam session in which the question was asked.$c$;
COMMENT ON COLUMN customer_liam_question.message_id IS $c$Id of Liam's assistant message (Firestore message id) that carried the question.$c$;
COMMENT ON COLUMN customer_liam_question.kind IS $c$Type of question asked. One of: thread, palate, brew.$c$;
COMMENT ON COLUMN customer_liam_question.archetype_code IS $c$Archetype being explored, as an archetype_enum code; set only for thread questions, NULL otherwise.$c$;
COMMENT ON COLUMN customer_liam_question.question IS $c$The question text extracted from Liam's reply.$c$;

-- ── customer_liam_reply ──
COMMENT ON TABLE customer_liam_reply IS $c$Purpose: Append-only fact of the customer's answer to an open Liam question, stored as its own row so the question row is never updated | Class: fact | Writer: customerFacts.liamReply (called from liamWriteBack.recordReplyForOpenQuestion), customerFacts.liamReplyBackfill | Readers: v_customer_timeline, v_palate_evidence, v_palate_threads, customerReads.getFactsWatermark | Since: 2026-09-27$c$;
COMMENT ON COLUMN customer_liam_reply.id IS $c$Surrogate UUID primary key of this fact row.$c$;
COMMENT ON COLUMN customer_liam_reply.user_id IS $c$References user_profile.id of the customer who replied; never firebase_uid or email.$c$;
COMMENT ON COLUMN customer_liam_reply.occurred_at IS $c$UTC timestamp the reply was recorded as happening; database clock at insert.$c$;
COMMENT ON COLUMN customer_liam_reply.recorded_at IS $c$UTC timestamp the row was recorded; normally equal to occurred_at.$c$;
COMMENT ON COLUMN customer_liam_reply.source IS $c$Origin of the fact, idempotency key with source_id. Code allows: onsite, liam, sms, shopify, qr, backfill, backfill_detected (no DB CHECK); this table gets liam.$c$;
COMMENT ON COLUMN customer_liam_reply.source_id IS $c$Idempotency key within source, built as session:question_turn:reply; UNIQUE (source, source_id).$c$;
COMMENT ON COLUMN customer_liam_reply.catalog_version IS $c$Catalog version string from getCatalogVersion() when the fact was recorded.$c$;
COMMENT ON COLUMN customer_liam_reply.question_id IS $c$References customer_liam_question.id this reply answers; UNIQUE, so one reply per question.$c$;
COMMENT ON COLUMN customer_liam_reply.reply IS $c$The customer's incoming message, verbatim, trimmed and capped at 2000 characters.$c$;
COMMENT ON COLUMN customer_liam_reply.message_id IS $c$Id of the customer's own message (Firestore message id) that answered the question.$c$;

-- ── customer_liam_action ──
COMMENT ON TABLE customer_liam_action IS $c$Purpose: Append-only fact of a customer tapping an action offered in a Liam chat (open dial, retake quiz, save recipe) | Class: fact | Writer: customerFacts.liamAction (called from sommelier.POST /:sessionId/action), customerFacts.liamActionBackfill | Readers: v_customer_timeline, customerReads.getFactsWatermark | Since: 2026-09-27$c$;
COMMENT ON COLUMN customer_liam_action.id IS $c$Surrogate UUID primary key of this fact row.$c$;
COMMENT ON COLUMN customer_liam_action.user_id IS $c$References user_profile.id of the customer who acted; never firebase_uid or email.$c$;
COMMENT ON COLUMN customer_liam_action.occurred_at IS $c$UTC timestamp of the action; database clock at insert.$c$;
COMMENT ON COLUMN customer_liam_action.recorded_at IS $c$UTC timestamp the row was recorded; normally equal to occurred_at.$c$;
COMMENT ON COLUMN customer_liam_action.source IS $c$Origin of the fact, idempotency key with source_id. Code allows: onsite, liam, sms, shopify, qr, backfill, backfill_detected (no DB CHECK); this table gets liam.$c$;
COMMENT ON COLUMN customer_liam_action.source_id IS $c$Idempotency key within source, built as session:message_id:action_type; UNIQUE (source, source_id).$c$;
COMMENT ON COLUMN customer_liam_action.catalog_version IS $c$Catalog version string from getCatalogVersion() when the fact was recorded.$c$;
COMMENT ON COLUMN customer_liam_action.session_id IS $c$References sommelier_sessions.id of the Liam conversation.$c$;
COMMENT ON COLUMN customer_liam_action.message_id IS $c$Id of the Liam message the action was taken on.$c$;
COMMENT ON COLUMN customer_liam_action.action_type IS $c$Which action was tapped. One of: open_dial, retake_quiz, save_recipe.$c$;

-- ── customer_bag_claim ──
COMMENT ON TABLE customer_bag_claim IS $c$Purpose: Append-only fact of a signed-in customer scanning a coffee-token QR on a bag they own, claiming that bag | Class: fact | Writer: customerFacts.bagClaim (called from qr.GET /:token/resolve, coffee-token owner scans only), customerFacts.bagClaimBackfill | Readers: v_customer_bag_attribution, v_customer_timeline, customerReads.getFactsWatermark | Since: 2026-09-27$c$;
COMMENT ON COLUMN customer_bag_claim.id IS $c$Surrogate UUID primary key of this fact row.$c$;
COMMENT ON COLUMN customer_bag_claim.user_id IS $c$References user_profile.id of the customer claiming the bag; never firebase_uid or email.$c$;
COMMENT ON COLUMN customer_bag_claim.occurred_at IS $c$UTC timestamp of the claim; database clock at insert.$c$;
COMMENT ON COLUMN customer_bag_claim.recorded_at IS $c$UTC timestamp the row was recorded; normally equal to occurred_at.$c$;
COMMENT ON COLUMN customer_bag_claim.source IS $c$Origin of the fact, idempotency key with source_id. Code allows: onsite, liam, sms, shopify, qr, backfill, backfill_detected (no DB CHECK); this table gets qr.$c$;
COMMENT ON COLUMN customer_bag_claim.source_id IS $c$Idempotency key within source: the qr_scan_event id as text; UNIQUE (source, source_id).$c$;
COMMENT ON COLUMN customer_bag_claim.catalog_version IS $c$Catalog version string from getCatalogVersion() when the fact was recorded.$c$;
COMMENT ON COLUMN customer_bag_claim.qr_scan_event_id IS $c$References qr_scan_event.id (integer) of the scan that produced the claim.$c$;
COMMENT ON COLUMN customer_bag_claim.order_line_item_id IS $c$References order_line_item.id of the owned order line matched to the scan; NULL if none was found.$c$;
COMMENT ON COLUMN customer_bag_claim.coffee_id IS $c$References coffees.id of the coffee on the scanned bag.$c$;

-- ── catalog_change ──
COMMENT ON TABLE catalog_change IS $c$Purpose: Append-only fact of every catalog write (before and after row snapshots with actor), the only customer-less fact table | Class: fact | Writer: customerFacts.catalogChange (via catalogService.logCatalogChange, every catalog write verb), customerFacts.catalogChangeBackfill | Readers: customerIntegrity (check 6 and informational comparison with api_event), customerReads (reserved, no reader yet) | Since: 2026-09-27$c$;
COMMENT ON COLUMN catalog_change.id IS $c$Surrogate UUID primary key of this fact row.$c$;
COMMENT ON COLUMN catalog_change.occurred_at IS $c$UTC timestamp of the catalog change; database clock at insert, set explicitly only by backfill.$c$;
COMMENT ON COLUMN catalog_change.recorded_at IS $c$UTC timestamp the row was recorded; normally equal to occurred_at.$c$;
COMMENT ON COLUMN catalog_change.source IS $c$Origin of the fact, idempotency key with source_id. One of: catalogService, backfill (type-enforced in code, no DB CHECK); in practice catalogService.$c$;
COMMENT ON COLUMN catalog_change.source_id IS $c$Idempotency key within source, built as uuid:entity:entity_id so two writes to one entity in a transaction never collide; UNIQUE (source, source_id).$c$;
COMMENT ON COLUMN catalog_change.catalog_version IS $c$Catalog version string from getCatalogVersion() when the change was recorded.$c$;
COMMENT ON COLUMN catalog_change.entity IS $c$Kind of catalog entity changed, such as coffee, coffee_slot_assignment, category, archetype, hop, roaster, coffee_retail_price.$c$;
COMMENT ON COLUMN catalog_change.entity_id IS $c$Primary key of the changed entity as text (composite keys joined with a colon, for example coffee_id:weight_oz).$c$;
COMMENT ON COLUMN catalog_change.action IS $c$Name of the catalogService verb that made the change, such as placeCoffee, moveCoffee, retireCoffee, setHop.$c$;
COMMENT ON COLUMN catalog_change.before IS $c$JSON snapshot of the whole entity row before the change; NULL for creates.$c$;
COMMENT ON COLUMN catalog_change.after IS $c$JSON snapshot of the whole entity row after the change; NULL for deletes.$c$;
COMMENT ON COLUMN catalog_change.changed_by IS $c$Actor who made the change: an admin uid, or import or system for non-interactive writes.$c$;

-- ── customer_order_kind ──
COMMENT ON TABLE customer_order_kind IS $c$Purpose: Lookup of order kinds (manual, subscription_renewal, gift_redemption, liam_followed) referenced by order_line_item.order_kind, a dimension not a fact | Class: master | Writer: seed | Readers: order_line_item.order_kind FK, customerIntegrity (excluded by name from fact checks) | Since: 2026-09-27$c$;
COMMENT ON COLUMN customer_order_kind.code IS $c$Primary key code. One of: manual, subscription_renewal, gift_redemption, liam_followed; referenced by order_line_item.order_kind.$c$;
COMMENT ON COLUMN customer_order_kind.label IS $c$Human-readable label for the kind, such as Manual or Subscription renewal.$c$;

-- ── user_saved_item ──
COMMENT ON TABLE user_saved_item IS $c$Purpose: A customer's current saved dial positions and Liam recipes, edited by tombstone (removed_at) rather than deletion | Class: operating | Writer: users.PATCH /api/users/dial-position (dial_slot saves), users.POST /api/users/flavor-memory/liam-saves, users.PATCH /api/users/flavor-memory/saved/:docId/remove, users.PATCH /api/users/flavor-memory/recipes/:docId/remove; backfill:migrateSavedItems | Readers: users.GET /flavor-memory, migrateSavedItems | Since: 2026-09-27$c$;
COMMENT ON COLUMN user_saved_item.id IS $c$Surrogate UUID primary key of the saved item.$c$;
COMMENT ON COLUMN user_saved_item.user_id IS $c$References user_profile.id of the owner.$c$;
COMMENT ON COLUMN user_saved_item.kind IS $c$Type of saved item. One of: dial_slot, recipe.$c$;
COMMENT ON COLUMN user_saved_item.ref_id IS $c$Reference key: archetype:dial_sort_order for dial_slot items, the constant liam_recipe for recipes.$c$;
COMMENT ON COLUMN user_saved_item.title IS $c$Display title: the platform (alias) name for a dial_slot save, the recipe title for a recipe; NULL if none.$c$;
COMMENT ON COLUMN user_saved_item.payload IS $c$JSON detail: archetype, dialSortOrder, coffeeId and platformName for dial_slot; body and coffeeName for recipe.$c$;
COMMENT ON COLUMN user_saved_item.created_at IS $c$UTC timestamp the item was saved (preserved from the source for backfilled rows).$c$;
COMMENT ON COLUMN user_saved_item.removed_at IS $c$UTC timestamp the customer removed the item; NULL while the item is still saved.$c$;

-- ── sommelier_evaluation ──
COMMENT ON TABLE sommelier_evaluation IS $c$Purpose: One row per Liam sommelier evaluation of a user (intent, 13-dim feature vector, state snapshot) plus a JSONB outcome merged in later; replaced Firestore sommelier_evaluations. | Class: operating | Writer: outcomeTracker.writeOutcome, sommelier.POST /api/sommelier/start, sommelierEvaluator.evaluateSommelier | Readers: admin.GET /sommelier/stats, admin.POST /sommelier/recompute-centroids, outcomeTracker +2 fns | Since: 2026-09-27 (Customer Blueprint C3 Part B6)$c$;
COMMENT ON COLUMN sommelier_evaluation.id IS $c$Primary key (UUID); returned to the session as evaluationId and stored on the Liam session context.$c$;
COMMENT ON COLUMN sommelier_evaluation.user_id IS $c$FK to user_profile(id) (the profile id, not the Firebase uid the evaluator receives; resolved once at insert).$c$;
COMMENT ON COLUMN sommelier_evaluation.intent IS $c$Name of the first matched intent rule (highest-priority trigger that fired and is active in config).$c$;
COMMENT ON COLUMN sommelier_evaluation.triggers_fired IS $c$Names of every intent rule that fired for this evaluation, in priority order.$c$;
COMMENT ON COLUMN sommelier_evaluation.needs_sommelier IS $c$True when the evaluator decided a sommelier session is warranted; the only insert path always writes true (non-triggering evaluations are not logged).$c$;
COMMENT ON COLUMN sommelier_evaluation.feature_vector IS $c$The 13 numeric features (mostly 0-1 normalised) computed for this evaluation, positionally aligned with feature_schema; used for intent centroid recomputation.$c$;
COMMENT ON COLUMN sommelier_evaluation.feature_schema IS $c$Feature names in the same order as feature_vector (FEATURE_SCHEMA in sommelierEvaluator.ts), stored so old vectors stay interpretable if the schema changes.$c$;
COMMENT ON COLUMN sommelier_evaluation.user_state_snapshot IS $c$JSONB snapshot of the user's quiz, order and feedback state at evaluation time.$c$;
COMMENT ON COLUMN sommelier_evaluation.opening_context IS $c$Generated opening sentence(s) handed to Liam to start the session; NULL if none.$c$;
COMMENT ON COLUMN sommelier_evaluation.session_started IS $c$True once the user actually opened a Liam session from this evaluation. | Writer: sommelier.POST /start$c$;
COMMENT ON COLUMN sommelier_evaluation.started_at IS $c$UTC timestamp when the Liam session started; NULL until session_started is set. | Writer: sommelier.POST /start$c$;
COMMENT ON COLUMN sommelier_evaluation.outcome IS $c$JSONB shallow-merged over time (jsonb concat) with sessionCompleted, turnsUsed, tokensSpent, orderedWithin7Days, orderedWithin30Days, feedbackAfterSession, returnedToSommelier and outcomeUpdatedAt (ISO string). | Writer: outcomeTracker.writeOutcome$c$;
COMMENT ON COLUMN sommelier_evaluation.created_at IS $c$UTC timestamp when the evaluation row was created.$c$;
COMMENT ON COLUMN sommelier_evaluation.updated_at IS $c$UTC timestamp of the last change; set again by the session-start update and every outcome merge. | Writer: sommelier.POST /start, outcomeTracker.writeOutcome$c$;

-- ── v_customer_identity ──
COMMENT ON VIEW v_customer_identity IS $c$Purpose: One row per user_profile mapping it to its canonical_user_id by walking customer_identity_link edges (from to to, depth 5, cycle-safe) so linked profiles read as one customer. | Class: view | Writer: none (derived) | Readers: customerReads, engagementMetrics, quizInterpretationBackfill, every other v_customer_* and v_palate_* view | Since: 2026-09-27 (Customer Blueprint C3 Part A1)$c$;

-- ── v_customer_quiz_current ──
COMMENT ON VIEW v_customer_quiz_current IS $c$Purpose: One row per canonical customer: their latest completed quiz_session across all linked profiles with the current interpretation (secondary, match archetype, food signal, branch answer) and quiz-change counts. | Class: view | Writer: none (derived) | Readers: customerReads.getQuizCurrent, v_palate_evidence, v_palate_slot_candidates, v_customer_calibration | Since: 2026-09-27 (Customer Blueprint C3 Part A2)$c$;

-- ── v_customer_brew_profile ──
COMMENT ON VIEW v_customer_brew_profile IS $c$Purpose: One row per canonical customer and brew-profile field holding the current value, replayed from customer_brew_profile_change (set/clear/add/remove) in occurred_at order; cleared fields are omitted. | Class: view | Writer: none (derived) | Readers: customerReads.getBrewProfileCurrent, engagementMetrics, v_palate_evidence | Since: 2026-09-27 (Customer Blueprint C3 Part A2)$c$;

-- ── v_customer_feedback_current ──
COMMENT ON VIEW v_customer_feedback_current IS $c$Purpose: Current revision of each customer feedback event (those no other row supersedes) per canonical customer, with a derived sentiment (rating 4+ positive, 2 or less negative) and descriptor note ids. | Class: view | Writer: none (derived) | Readers: customerReads.getFeedbackCurrent, admin, v_palate_evidence, v_palate_shared_traits, v_palate_dominant_dimensions, v_palate_archetype_spread, +3 more | Since: 2026-09-27 (Customer Blueprint C3 Part A2)$c$;

-- ── v_customer_bag_attribution ──
COMMENT ON VIEW v_customer_bag_attribution IS $c$Purpose: One row per order line item saying which user drank the bag (intended_for_user_id, else the buyer, else a household bag claim, else unattributed) and why (attribution), per the D7 rule. | Class: view | Writer: none (derived) | Readers: customerReads.getFactsWatermark, v_customer_timeline, v_palate_evidence, v_palate_shared_traits, v_palate_dominant_dimensions, v_palate_archetype_spread, +3 more | Since: 2026-09-27 (Customer Blueprint C3 Part A2)$c$;

-- ── v_customer_timeline ──
COMMENT ON VIEW v_customer_timeline IS $c$Purpose: Union of every customer fact (quiz, order line, feedback, brew profile change, dial event, bag claim, Liam recommendation/question/action, identity link) as one time-ordered stream per canonical customer. | Class: view | Writer: none (derived) | Readers: customerReads.getTimeline | Since: 2026-09-27 (Customer Blueprint C3 Part A3)$c$;

-- ── v_coffee_dimension_range ──
COMMENT ON VIEW v_coffee_dimension_range IS $c$Purpose: Per active coffee and dimension, the range POOLED over every session's current merged row, converted to 0 to 15, weighted by rank (param session_rank_ratio) and recency (param session_half_life_days); session_id/session_date are the latest session; adds n_sessions_pooled, weight_latest_share, session_weights, sessions_disagree (param session_gap), rank_ratio, half_life_days; unmerged fallback as before. | Class: view | Writer: none (derived) | Readers: cuppingReads (dialSuggestion, routes/coffees, brewCard, roasterVoiceReads), roasteryPortalReads, customerIntegrity, v_archetype_dimension_comparison, v_archetype_dimension_profile (compatibilityReads), v_coffee_dimension_range_calibrated, v_palate_shared_traits, v_palate_dominant_dimensions, v_palate_slot_candidates, v_roastery_portal_dimension_match, v_evidence_dimension, v_evidence_archetype | Since: 2026-09-27 (pooled since 2026-10-21, cupping evidence brief 6)$c$;
-- ── v_coffee_dimension_history ──
COMMENT ON VIEW v_coffee_dimension_history IS $c$Purpose: Every session's current merged range per coffee x dimension x sample, converted to 0 to 15, with session date, blind and control flags and the scales behind it; what calibration and repeatability read, and where one sees which session pulled the pooled range (the catalog reads the pooled range, v_coffee_dimension_range). | Class: view | Writer: none (derived) | Readers: cuppingReads.getDimensionHistory (evidenceReads.getCoffeeEvidence, the Dimensions tab's per-session history), v_coffee_dimension_range_calibrated, v_evidence_dimension, v_evidence_cupper_calibration | Since: 2026-10-18 (cupping evidence brief 1)$c$;
-- ── v_coffee_dimension_range_calibrated ──
COMMENT ON VIEW v_coffee_dimension_range_calibrated IS $c$Purpose: The LATEST session's merged range (latest-session by design, pooled-unaware, until Dana decides offsets apply) with each cupper's current cupper_calibration_offset applied to her converted range behind it; calibrated_min/max/midpoint and n_offsets_applied. Takes the latest session from v_coffee_dimension_range.session_id and that session's range from v_coffee_dimension_history. Unread on purpose. | Class: view | Writer: none (derived) | Readers: none yet | Since: 2026-10-18 (cupping evidence brief 1)$c$;

-- ── v_coffee_descriptor ──
COMMENT ON VIEW v_coffee_descriptor IS $c$Purpose: v_collaborative_flavor_wheel grouped to one row per coffee and descriptor with wheel category/subcategory, the SCA tier and n_sources (distinct source channels that observed it). Internal: it carries our cupping words, so no customer surface reads it since cupping evidence brief 6 (v_palate_shared_traits reads v_coffee_customer_descriptor). | Class: view | Writer: none (derived) | Readers: cuppingReads.getDescriptors (no caller) | Since: 2026-09-27 (Customer Blueprint C3 Part A4)$c$;

-- ── v_palate_evidence ──
COMMENT ON VIEW v_palate_evidence IS $c$Purpose: One row per canonical customer with counts of what we know about their palate (attributed bags, distinct coffees, feedback by sentiment, Liam questions/answers/recommendations, brew fields, has_quiz); read_version v1. | Class: view | Writer: none (derived) | Readers: customerReads.getPalateEvidence | Since: 2026-09-27 (Customer Blueprint C3 Part A5)$c$;

-- ── v_palate_shared_traits ──
COMMENT ON VIEW v_palate_shared_traits IS $c$Purpose: Per canonical customer, the dimension ranges (intersection across non-disliked attributed coffees, with an overlaps flag; the ranges are the pooled ones) and the descriptors shared by every such coffee, from the customer voice (v_coffee_customer_descriptor: the roaster's words and customers', never our cupping words; since cupping evidence brief 6, defined late in schema.sql); disliked bags (rating 2 or less) are excluded. | Class: view | Writer: none (derived) | Readers: customerReads.getSharedTraits (liamProfile, Liam's profile line), v_palate_slot_candidates | Since: 2026-09-27 (Customer Blueprint C3 Part A5)$c$;

-- ── v_palate_dominant_dimensions ──
COMMENT ON VIEW v_palate_dominant_dimensions IS $c$Purpose: Per canonical customer and cupping dimension, the mean range midpoint across attributed coffees overall and split into liked and disliked bags, with counts. | Class: view | Writer: none (derived) | Readers: customerReads.getDominantDimensions | Since: 2026-09-27 (Customer Blueprint C3 Part A5)$c$;

-- ── v_palate_archetype_spread ──
COMMENT ON VIEW v_palate_archetype_spread IS $c$Purpose: Per canonical customer and match archetype of the coffees they drink, the distinct coffee count and positive/negative feedback counts. | Class: view | Writer: none (derived) | Readers: customerReads.getArchetypeSpread | Since: 2026-09-27 (Customer Blueprint C3 Part A5)$c$;

-- ── v_palate_threads ──
COMMENT ON VIEW v_palate_threads IS $c$Purpose: One row per Liam question asked of a canonical customer with its reply (if any), status asked or answered, and the session and turn it was asked on. | Class: view | Writer: none (derived) | Readers: customerReads.getThreads, admin, quizInterpretationBackfill, v_customer_calibration | Since: 2026-09-27 (Customer Blueprint C3 Part A5; session_id and turn added by Liam L3 #200, 2026-09-28)$c$;

-- ── v_palate_recommendation_outcome ──
COMMENT ON VIEW v_palate_recommendation_outcome IS $c$Purpose: One row per Liam recommendation with the first later attributed order of the same coffee (or slot's coffee), days to order, the feedback rating, and whether the pick was detected rather than marked. | Class: view | Writer: none (derived) | Readers: customerReads.getRecommendationOutcomes, admin | Since: 2026-09-27 (Customer Blueprint C3 Part A5; detected added by Liam L3 #200, 2026-09-28)$c$;

-- ── v_customer_calibration ──
COMMENT ON VIEW v_customer_calibration IS $c$Purpose: One row per canonical customer's latest quiz with email, interpretation, raw quiz_result_json and first Liam recommendation/first attributed order/thread status, exported for quiz recalibration. | Class: view | Writer: none (derived) | Readers: scripts/exportCalibration, scripts/quizRecalibrate | Since: 2026-09-28 (Liam L3 #200)$c$;

-- ── v_palate_slot_candidates ──
COMMENT ON VIEW v_palate_slot_candidates IS $c$Purpose: Per canonical customer, ranked sellable dial-slot coffees by quiz-pair fit and dimension-range overlap with their liked bags (disliked coffees excluded, dislike overlap steers order), with already_bought and last_rating. | Class: view | Writer: none (derived) | Readers: customerReads.getSlotCandidates, sommelierRag (via customerReads) | Since: 2026-09-27 (Customer Blueprint C3 Part A5)$c$;

-- ── roastery_portal_link ──
COMMENT ON TABLE roastery_portal_link IS $c$Purpose: One private, revocable partner-roastery portal link per issue, identified by an unguessable token; a roastery can have several over time. | Class: operating | Writer: roasteryPortalService.createLink, roasteryPortalService.revokeLink, roasteryPortalService.touchLink | Readers: roasteryPortalReads, roasteryPortalService | Since: 2026-10-05 (Roastery portal #209)$c$;
COMMENT ON COLUMN roastery_portal_link.id IS $c$Primary key (UUID); referenced by roastery_portal_respondent.link_id.$c$;
COMMENT ON COLUMN roastery_portal_link.roaster_id IS $c$FK to roaster(id): the roastery this link was issued to.$c$;
COMMENT ON COLUMN roastery_portal_link.token IS $c$Unique secret in the link URL (32 random bytes, url-safe, CHECK length at least 32); treat as a credential.$c$;
COMMENT ON COLUMN roastery_portal_link.contact_name IS $c$Optional contact name for prefill only; NULL if not given.$c$;
COMMENT ON COLUMN roastery_portal_link.contact_email IS $c$Optional contact email (lowercased) for prefill only; NULL if not given.$c$;
COMMENT ON COLUMN roastery_portal_link.created_by_admin_id IS $c$FK to user_profile(id) of the admin who issued the link; NULL if the admin profile was not found.$c$;
COMMENT ON COLUMN roastery_portal_link.created_at IS $c$Timestamp (timestamptz, database clock) when the link was issued.$c$;
COMMENT ON COLUMN roastery_portal_link.last_opened_at IS $c$Timestamp of the most recent time the roastery opened the link; NULL if never opened. | Writer: roasteryPortalService.touchLink$c$;
COMMENT ON COLUMN roastery_portal_link.revoked_at IS $c$Timestamp when the link was revoked; NULL while the link is live. | Writer: roasteryPortalService.revokeLink$c$;

-- ── roastery_portal_respondent ──
COMMENT ON TABLE roastery_portal_respondent IS $c$Purpose: A person who filled in the roastery portal, unique per (roaster_id, email); the first recorded name wins. | Class: operating | Writer: roasteryPortalService.upsertRespondent | Readers: roasteryPortalReads, roasteryPortalService, v_roastery_portal_progress, v_roastery_portal_coffee_hint | Since: 2026-10-05 (Roastery portal #209)$c$;
COMMENT ON COLUMN roastery_portal_respondent.id IS $c$Primary key (UUID); referenced as last-saved-by and submitted-by on responses and as added_by_respondent_id on lineup coffees.$c$;
COMMENT ON COLUMN roastery_portal_respondent.roaster_id IS $c$FK to roaster(id): the roastery this person answered for.$c$;
COMMENT ON COLUMN roastery_portal_respondent.link_id IS $c$FK to roastery_portal_link(id): the portal link they came in through.$c$;
COMMENT ON COLUMN roastery_portal_respondent.name IS $c$Respondent's name as first entered.$c$;
COMMENT ON COLUMN roastery_portal_respondent.email IS $c$Respondent's email, always lowercased (CHECK email = lower(email)); unique together with roaster_id.$c$;
COMMENT ON COLUMN roastery_portal_respondent.created_at IS $c$Timestamp when the respondent was first recorded.$c$;

-- ── roastery_portal_coffee ──
COMMENT ON TABLE roastery_portal_coffee IS $c$Purpose: A roastery's lineup as shown in the portal (managed in admin or added by the roaster), optionally linked to a catalog coffee, with prefill values; the catalog is never written from here. | Class: operating | Writer: roasteryPortalService.addLineupCoffee, roasteryPortalService.acceptResponse, roasteryPortalService.bulkAddLineupCoffees, roasteryPortalService.deactivateLineupCoffee, roasteryPortalService.linkLineupCoffeeToCatalog, roasteryPortalService.reorderLineupCoffees | Readers: roasteryPortalReads, v_roastery_portal_coffee, v_roastery_portal_progress, +2 more views | Since: 2026-10-05 (Roastery portal #209)$c$;
COMMENT ON COLUMN roastery_portal_coffee.id IS $c$Primary key (UUID); referenced as portal_coffee_id by responses, acceptances and best-seller rows.$c$;
COMMENT ON COLUMN roastery_portal_coffee.roaster_id IS $c$FK to roaster(id): the roastery that owns this lineup row.$c$;
COMMENT ON COLUMN roastery_portal_coffee.name IS $c$Coffee name as the roastery calls it; unique case-insensitively among active rows per roastery.$c$;
COMMENT ON COLUMN roastery_portal_coffee.coffee_id IS $c$Optional FK to coffees(id): the catalog coffee this lineup row maps to (same roastery only); NULL if not linked. | Writer: roasteryPortalService.linkLineupCoffeeToCatalog, roasteryPortalService.acceptResponse$c$;
COMMENT ON COLUMN roastery_portal_coffee.origin IS $c$Prefill: origin text as the roaster states it; NULL if unknown.$c$;
COMMENT ON COLUMN roastery_portal_coffee.process_values IS $c$Prefill: processing methods, values from lookup_value category process; empty array if unknown.$c$;
COMMENT ON COLUMN roastery_portal_coffee.roast_level IS $c$Prefill: roast level, a lookup_value roast_level value (light, light-medium, medium, medium-dark, dark); NULL if unknown.$c$;
COMMENT ON COLUMN roastery_portal_coffee.blend_or_single IS $c$Prefill: lookup_value blend_or_single value (single or blend); NULL if unknown.$c$;
COMMENT ON COLUMN roastery_portal_coffee.is_decaf IS $c$Prefill: true if decaf, false if not, NULL if unknown; still accepted by the admin lineup routes (the deprecation in the docs is on roastery_portal_response.is_decaf).$c$;
COMMENT ON COLUMN roastery_portal_coffee.prefill_source IS $c$Where the prefill came from. One of: roaster_site, catalog (NULL if none); roaster_site rows let the roaster's own words win over catalog values in v_roastery_portal_coffee.$c$;
COMMENT ON COLUMN roastery_portal_coffee.added_by IS $c$Who added the lineup row. One of: admin, roaster.$c$;
COMMENT ON COLUMN roastery_portal_coffee.added_by_respondent_id IS $c$FK to roastery_portal_respondent(id) when a roaster added the row; NULL for admin-added rows.$c$;
COMMENT ON COLUMN roastery_portal_coffee.sort_order IS $c$Display position within the roastery's lineup (1-based; next value is max plus 1). | Writer: roasteryPortalService.reorderLineupCoffees$c$;
COMMENT ON COLUMN roastery_portal_coffee.is_active IS $c$False once the lineup row is deactivated (rows are never deleted); inactive rows are excluded from the unique-name rule. | Writer: roasteryPortalService.deactivateLineupCoffee$c$;
COMMENT ON COLUMN roastery_portal_coffee.created_at IS $c$Timestamp when the lineup row was created.$c$;

-- ── roastery_portal_dimension ──
COMMENT ON TABLE roastery_portal_dimension IS $c$Purpose: Which numeric coffee dimensions the portal asks about and how they are worded (label plus low and high anchors) for the 1 to 5 relative scale; 7 seeded rows. | Class: operating | Writer: seed | Readers: roasteryPortalReads, v_roastery_portal_coffee_hint, v_roastery_portal_cousin_hint | Since: 2026-10-05 (Roastery portal #209)$c$;
COMMENT ON COLUMN roastery_portal_dimension.dimension_id IS $c$Primary key and FK to coffee_dimensions(id); seeded by dimension name, never by id.$c$;
COMMENT ON COLUMN roastery_portal_dimension.label IS $c$Roaster-facing name of the dimension (for example Clarity for Savory / Depth, Mouthfeel for Texture, Finish for Finish Length).$c$;
COMMENT ON COLUMN roastery_portal_dimension.low_label IS $c$Wording shown for a 1 on the scale.$c$;
COMMENT ON COLUMN roastery_portal_dimension.high_label IS $c$Wording shown for a 5 on the scale.$c$;
COMMENT ON COLUMN roastery_portal_dimension.sort_order IS $c$Display order of the question (1 to 7).$c$;
COMMENT ON COLUMN roastery_portal_dimension.is_active IS $c$False to stop asking this dimension; nothing sets it false today.$c$;

-- ── roastery_portal_response ──
COMMENT ON TABLE roastery_portal_response IS $c$Purpose: One row per lineup coffee per version holding the roaster's own answers (draft or submitted); submitted rows are immutable by trigger and reopening starts version plus 1. | Class: operating | Writer: roasteryPortalService.saveDraft (opens drafts via openDraft), roasteryPortalService.submitResponse | Readers: roasteryPortalReads, v_roastery_portal_response, v_roastery_portal_progress, +2 more views | Since: 2026-10-05 (Roastery portal #209)$c$;
COMMENT ON COLUMN roastery_portal_response.id IS $c$Primary key (UUID); referenced by the child note, dimension and brew tables and by roastery_portal_acceptance.$c$;
COMMENT ON COLUMN roastery_portal_response.portal_coffee_id IS $c$FK to roastery_portal_coffee(id): the lineup coffee this answer is about.$c$;
COMMENT ON COLUMN roastery_portal_response.version IS $c$Version number starting at 1, unique per portal_coffee_id; a new draft is version plus 1 of the latest.$c$;
COMMENT ON COLUMN roastery_portal_response.status IS $c$One of: draft, submitted; at most one draft per coffee, and a submitted row is never changed again. | Writer: roasteryPortalService.submitResponse$c$;
COMMENT ON COLUMN roastery_portal_response.origin IS $c$Origin as the roaster states it for this version; NULL if unanswered.$c$;
COMMENT ON COLUMN roastery_portal_response.process_values IS $c$Processing methods, lookup_value category process values; empty array if unanswered.$c$;
COMMENT ON COLUMN roastery_portal_response.roast_level IS $c$Roast level, a lookup_value roast_level value; NULL if unanswered.$c$;
COMMENT ON COLUMN roastery_portal_response.blend_or_single IS $c$lookup_value blend_or_single value (single or blend); NULL if unanswered.$c$;
COMMENT ON COLUMN roastery_portal_response.is_decaf IS $c$Class: deprecated | Old decaf yes/no answer; nothing writes it any more (never copied into new drafts, submitted rows never backfilled); v_roastery_portal_response derives caffeine_level from it for old rows.$c$;
COMMENT ON COLUMN roastery_portal_response.proposed_archetype IS $c$The archetype_enum family the roaster proposes for the coffee; a proposal only, never an assignment; NULL if unanswered.$c$;
COMMENT ON COLUMN roastery_portal_response.dominant_dimension_id IS $c$FK to coffee_dimensions(id): the dimension the roaster says dominates this coffee; NULL if unanswered.$c$;
COMMENT ON COLUMN roastery_portal_response.takes_it IS $c$How the coffee is best enjoyed. One of: black, milk, both; NULL if unanswered.$c$;
COMMENT ON COLUMN roastery_portal_response.brew_notes IS $c$Free-text brewing notes; NULL if unanswered.$c$;
COMMENT ON COLUMN roastery_portal_response.availability IS $c$Availability pattern, a lookup_value roastery_portal_availability value (always_on, rotating, limited_release); NULL if unanswered.$c$;
COMMENT ON COLUMN roastery_portal_response.typical_notice IS $c$Per-coffee override of the lineup answer on how much notice before it goes out of stock, a lookup_value roastery_portal_notice value; NULL means same as the lineup answer.$c$;
COMMENT ON COLUMN roastery_portal_response.expected_availability IS $c$Free-text expected availability (for example when it returns); NULL if unanswered.$c$;
COMMENT ON COLUMN roastery_portal_response.similar_when_out IS $c$Per-coffee override of the lineup answer on whether a similar profile replaces it when out, a lookup_value roastery_portal_similar value (yes, usually, sometimes, no, not_sure); NULL means same as the lineup answer.$c$;
COMMENT ON COLUMN roastery_portal_response.closest_cousin_portal_coffee_id IS $c$FK to roastery_portal_coffee(id): the roastery's own coffee this one is closest to; NULL if unanswered.$c$;
COMMENT ON COLUMN roastery_portal_response.what_changes IS $c$Free text on what differs from the closest cousin; NULL if unanswered.$c$;
COMMENT ON COLUMN roastery_portal_response.anything_else IS $c$Free-text closing remarks about this coffee; NULL if unanswered.$c$;
COMMENT ON COLUMN roastery_portal_response.last_saved_by_respondent_id IS $c$FK to roastery_portal_respondent(id): who last saved this version.$c$;
COMMENT ON COLUMN roastery_portal_response.submitted_by_respondent_id IS $c$FK to roastery_portal_respondent(id): who submitted this version; NULL while draft. | Writer: roasteryPortalService.submitResponse$c$;
COMMENT ON COLUMN roastery_portal_response.created_at IS $c$Timestamp when this version (draft) was opened.$c$;
COMMENT ON COLUMN roastery_portal_response.updated_at IS $c$Timestamp of the last save or submit.$c$;
COMMENT ON COLUMN roastery_portal_response.submitted_at IS $c$Timestamp when the version was submitted; NULL while draft. | Writer: roasteryPortalService.submitResponse$c$;
COMMENT ON COLUMN roastery_portal_response.additives_present IS $c$True if anything is added to the coffee (flavoring etc.), false if not, NULL if unanswered.$c$;
COMMENT ON COLUMN roastery_portal_response.additives_detail IS $c$Free text on what is added; only kept when additives_present is true, else NULL.$c$;
COMMENT ON COLUMN roastery_portal_response.roast_intent IS $c$Class: deprecated | Old Roasted-for answer (lookup roastery_portal_roast_intent: filter, espresso, omni); removed in part 4 (#213), nothing in code reads or writes it.$c$;
COMMENT ON COLUMN roastery_portal_response.blend_components IS $c$Free text describing the blend's components; only kept for blends, else NULL.$c$;
COMMENT ON COLUMN roastery_portal_response.blend_rotation IS $c$How the blend recipe changes. One of: fixed, rotates_same_profile, seasonal (lookup roastery_portal_blend_rotation); only kept for blends, else NULL.$c$;
COMMENT ON COLUMN roastery_portal_response.caffeine_level IS $c$Caffeine answer. One of: regular, half_caff, decaf (lookup roastery_portal_caffeine); NULL if unanswered (readers use v_roastery_portal_response, which falls back to is_decaf).$c$;
COMMENT ON COLUMN roastery_portal_response.decaf_process IS $c$Decaffeination process. One of: swiss_water, sugarcane_ea, mountain_water, co2, other; only kept when caffeine_level is decaf or half_caff, else NULL.$c$;
COMMENT ON COLUMN roastery_portal_response.certifications IS $c$Certifications held, lookup roastery_portal_certification values (usda_organic, fair_trade, rainforest_alliance, other, none); none stands alone; empty array if unanswered.$c$;

-- ── roastery_portal_response_note ──
COMMENT ON TABLE roastery_portal_response_note IS $c$Purpose: A response's ranked tasting notes: the roaster's own words plus the optional closest flavor-wheel term; immutable once the parent response is submitted. | Class: operating | Writer: roasteryPortalService.saveDraft (openDraft copies forward) | Readers: roasteryPortalReads, roasteryPortalService, v_roastery_portal_progress, v_coffee_customer_descriptor (roaster_rank) | Since: 2026-10-05 (Roastery portal #209)$c$;
COMMENT ON COLUMN roastery_portal_response_note.response_id IS $c$FK to roastery_portal_response(id); part of the primary key.$c$;
COMMENT ON COLUMN roastery_portal_response_note.rank IS $c$Position of the note, 1 = leading note (CHECK 1 or more); part of the primary key.$c$;
COMMENT ON COLUMN roastery_portal_response_note.roaster_words IS $c$The roaster's own wording for the note, verbatim.$c$;
COMMENT ON COLUMN roastery_portal_response_note.cupping_note_id IS $c$FK to cupping_note(id): the flavor-wheel term the roaster picked; NULL for words-only notes (counted as unmapped by v_roastery_portal_progress).$c$;

-- ── roastery_portal_response_dimension ──
COMMENT ON TABLE roastery_portal_response_dimension IS $c$Purpose: A response's 1 to 5 dimension values, relative to the roaster's own lineup (never mixed with the 0 to 15 cupping scale); immutable once the parent response is submitted. | Class: operating | Writer: roasteryPortalService.saveDraft (openDraft copies forward) | Readers: roasteryPortalReads, roasteryPortalService, v_roastery_portal_progress, v_roastery_portal_coffee_hint | Since: 2026-10-05 (Roastery portal #209)$c$;
COMMENT ON COLUMN roastery_portal_response_dimension.response_id IS $c$FK to roastery_portal_response(id); part of the primary key.$c$;
COMMENT ON COLUMN roastery_portal_response_dimension.dimension_id IS $c$FK to coffee_dimensions(id); part of the primary key.$c$;
COMMENT ON COLUMN roastery_portal_response_dimension.value IS $c$Roaster's rating from 1 to 5 (CHECK), relative to their own lineup, not an absolute cupping score.$c$;

-- ── roastery_portal_response_brew ──
COMMENT ON TABLE roastery_portal_response_brew IS $c$Purpose: A response's brewing methods: exactly one best method plus any number of also-good methods; immutable once the parent response is submitted. | Class: operating | Writer: roasteryPortalService.saveDraft (openDraft copies forward) | Readers: roasteryPortalReads, roasteryPortalService, v_roastery_portal_progress | Since: 2026-10-05 (Roastery portal #209)$c$;
COMMENT ON COLUMN roastery_portal_response_brew.response_id IS $c$FK to roastery_portal_response(id); part of the primary key.$c$;
COMMENT ON COLUMN roastery_portal_response_brew.brew_method IS $c$Brewing method code from lookup category roastery_portal_brew_method (v60, drip, espresso, french_press, aeropress, moka, cold_brew, other); part of the primary key.$c$;
COMMENT ON COLUMN roastery_portal_response_brew.role IS $c$One of: best, also_good; at most one best per response (partial unique index).$c$;

-- ── roastery_portal_lineup_response ──
COMMENT ON TABLE roastery_portal_lineup_response IS $c$Purpose: The lineup-wide answers asked once per roastery (typical notice, similar when out, anything else), versioned draft or submitted like a coffee response and immutable once submitted. | Class: operating | Writer: roasteryPortalService.saveLineupDraft, roasteryPortalService.submitLineupResponse | Readers: roasteryPortalReads, roasteryPortalService, v_roastery_portal_lineup_current_response | Since: 2026-10-05 (Roastery portal #209)$c$;
COMMENT ON COLUMN roastery_portal_lineup_response.id IS $c$Primary key (UUID); referenced by roastery_portal_lineup_response_best_seller.$c$;
COMMENT ON COLUMN roastery_portal_lineup_response.roaster_id IS $c$FK to roaster(id): the roastery answering for its whole lineup.$c$;
COMMENT ON COLUMN roastery_portal_lineup_response.version IS $c$Version number starting at 1, unique per roaster_id.$c$;
COMMENT ON COLUMN roastery_portal_lineup_response.status IS $c$One of: draft, submitted; at most one draft per roastery. | Writer: roasteryPortalService.submitLineupResponse$c$;
COMMENT ON COLUMN roastery_portal_lineup_response.typical_notice IS $c$Typical notice before a coffee goes out of stock, lookup_value roastery_portal_notice (under_2_weeks, 2_to_4_weeks, 1_to_2_months, 2_plus_months, unpredictable); NULL if unanswered.$c$;
COMMENT ON COLUMN roastery_portal_lineup_response.similar_when_out IS $c$Whether a similar profile replaces a coffee that is out, lookup_value roastery_portal_similar (yes, usually, sometimes, no, not_sure); NULL if unanswered.$c$;
COMMENT ON COLUMN roastery_portal_lineup_response.anything_else IS $c$Free-text closing remarks about the lineup; NULL if unanswered.$c$;
COMMENT ON COLUMN roastery_portal_lineup_response.last_saved_by_respondent_id IS $c$FK to roastery_portal_respondent(id): who last saved this version.$c$;
COMMENT ON COLUMN roastery_portal_lineup_response.submitted_by_respondent_id IS $c$FK to roastery_portal_respondent(id): who submitted this version; NULL while draft. | Writer: roasteryPortalService.submitLineupResponse$c$;
COMMENT ON COLUMN roastery_portal_lineup_response.created_at IS $c$Timestamp when this version (draft) was opened.$c$;
COMMENT ON COLUMN roastery_portal_lineup_response.updated_at IS $c$Timestamp of the last save or submit.$c$;
COMMENT ON COLUMN roastery_portal_lineup_response.submitted_at IS $c$Timestamp when the version was submitted; NULL while draft. | Writer: roasteryPortalService.submitLineupResponse$c$;

-- ── roastery_portal_acceptance ──
COMMENT ON TABLE roastery_portal_acceptance IS $c$Purpose: Insert-only log of every time an admin accepted a submitted roaster response into the catalog, with the applied items and catalog values before and after; a trigger rejects UPDATE and DELETE. | Class: operating | Writer: roasteryPortalService.acceptResponse | Readers: roasteryPortalReads, v_roastery_portal_progress | Since: 2026-10-05 (Roastery portal part 2 #210)$c$;
COMMENT ON COLUMN roastery_portal_acceptance.id IS $c$Primary key (UUID) of the acceptance event.$c$;
COMMENT ON COLUMN roastery_portal_acceptance.response_id IS $c$FK to roastery_portal_response(id): the accepted version; guard trigger requires it to be a submitted version of portal_coffee_id.$c$;
COMMENT ON COLUMN roastery_portal_acceptance.portal_coffee_id IS $c$FK to roastery_portal_coffee(id): the lineup coffee that was accepted.$c$;
COMMENT ON COLUMN roastery_portal_acceptance.coffee_id IS $c$FK to coffees(id): the catalog coffee that received the changes (existing or newly created).$c$;
COMMENT ON COLUMN roastery_portal_acceptance.created_coffee IS $c$True if this acceptance created the catalog coffee, false if it updated an existing one.$c$;
COMMENT ON COLUMN roastery_portal_acceptance.applied IS $c$JSONB record of everything applied: response version, coffee before/after, basics, roaster descriptors, notes with chosen wheel terms, and remembered mappings.$c$;
COMMENT ON COLUMN roastery_portal_acceptance.accepted_by_admin_id IS $c$FK to user_profile(id) of the accepting admin; NULL if the admin profile was not found.$c$;
COMMENT ON COLUMN roastery_portal_acceptance.accepted_at IS $c$Timestamp when the response was accepted.$c$;

-- ── roastery_portal_note_mapping ──
COMMENT ON TABLE roastery_portal_note_mapping IS $c$Purpose: Remembered translations from a roaster's or a cupper's normalized words to an SCA node (source_kind keeps the two apart), offered as a suggestion next time and looked up by the cupping loader; changing one supersedes the old row and inserts a new one. | Class: operating | Writer: noteMappingService.setNoteMappingInTx, noteMappingService.retireNoteMappingInTx | Readers: roasteryPortalReads, roasteryPortalService, noteMappingReads, noteMappingService | Since: 2026-10-05 (Roastery portal part 2 #210)$c$;
COMMENT ON COLUMN roastery_portal_note_mapping.id IS $c$Primary key (UUID).$c$;
COMMENT ON COLUMN roastery_portal_note_mapping.normalized_words IS $c$The roaster's or cupper's words lowercased, trimmed and whitespace-collapsed; unique per source_kind among rows where superseded_at IS NULL.$c$;
COMMENT ON COLUMN roastery_portal_note_mapping.cupping_note_id IS $c$FK to cupping_note(id): the flavor-wheel term these words map to.$c$;
COMMENT ON COLUMN roastery_portal_note_mapping.created_by_admin_id IS $c$FK to user_profile(id) of the admin who set the mapping; NULL if unknown.$c$;
COMMENT ON COLUMN roastery_portal_note_mapping.created_at IS $c$Timestamp when the mapping was created.$c$;
COMMENT ON COLUMN roastery_portal_note_mapping.superseded_at IS $c$Timestamp when the mapping was replaced or withdrawn; NULL while it is the active one for its words and kind. | Writer: noteMappingService.setNoteMappingInTx, noteMappingService.retireNoteMappingInTx$c$;
COMMENT ON COLUMN roastery_portal_note_mapping.source_kind IS $c$Whose vocabulary the words are. One of: roaster (portal and remark words), cupper (an Axis & Bloom cupper's words, mapped at the SCA tier she named) | Writer: noteMappingService.setNoteMappingInTx$c$;
COMMENT ON COLUMN roastery_portal_note_mapping.note IS $c$Why the words map to this node, when not obvious (for example berries is Berry, tier 2, not a berry leaf).$c$;
-- ── roastery_remark ──
COMMENT ON TABLE roastery_remark IS $c$Purpose: What a roaster said outside the portal form (cupping table, email, call, visit, website), one statement per row, verbatim, with who said it, when, through which channel and on which topic; insert-only, a correction is a new row with supersedes_id | Class: fact | Writer: roasteryRemarkService.recordRemarks | Readers: v_roastery_remark | Since: 2026-10-18 (cupping evidence brief 1)$c$;
COMMENT ON COLUMN roastery_remark.id IS $c$Primary key (UUID); referenced by supersedes_id.$c$;
COMMENT ON COLUMN roastery_remark.roaster_id IS $c$References roaster.id: the roastery that said it; every other reference on the row must belong to it (roastery_remark_guard).$c$;
COMMENT ON COLUMN roastery_remark.coffee_id IS $c$References coffees.id: the catalog coffee the remark is about; NULL when it is about the lineup or the roastery.$c$;
COMMENT ON COLUMN roastery_remark.portal_coffee_id IS $c$References roastery_portal_coffee.id: the lineup row the remark is about, when known.$c$;
COMMENT ON COLUMN roastery_remark.cupping_session_coffee_id IS $c$References cupping_session_coffees.id: the sample at whose cupping the remark was made; must be the same coffee as coffee_id when both are set.$c$;
COMMENT ON COLUMN roastery_remark.said_by IS $c$Who said it, as written (a person and role, or the roastery and its website).$c$;
COMMENT ON COLUMN roastery_remark.said_by_respondent_id IS $c$References roastery_portal_respondent.id: when the speaker is a known portal respondent of the same roaster.$c$;
COMMENT ON COLUMN roastery_remark.said_on IS $c$Business date the remark was made, or the capture date of a website page; never shifted by a timezone.$c$;
COMMENT ON COLUMN roastery_remark.channel IS $c$How it reached us. One of: cupping_table, email, call, visit, website, other.$c$;
COMMENT ON COLUMN roastery_remark.topic IS $c$What it is about. One of: classification, descriptor, dimension, brewing, availability, process, origin, roast, general, award (since coffee presentation brief 1, 2026-10-23: an award the roaster names; customers get a count, never its text).$c$;
COMMENT ON COLUMN roastery_remark.remark IS $c$Their words as captured, verbatim.$c$;
COMMENT ON COLUMN roastery_remark.cupping_note_id IS $c$References cupping_note.id: the SCA node a descriptor remark translates to, when the translation is clear; only on descriptor remarks (CHECK).$c$;
COMMENT ON COLUMN roastery_remark.proposed_archetype IS $c$The archetype a classification remark proposes (archetype_enum); a proposal, never an assignment; only on classification remarks (CHECK).$c$;
COMMENT ON COLUMN roastery_remark.recorded_by IS $c$Who wrote the remark down.$c$;
COMMENT ON COLUMN roastery_remark.record_source IS $c$Where the row came from (the paper file, the email date, the page and the file it was copied from).$c$;
COMMENT ON COLUMN roastery_remark.supersedes_id IS $c$References roastery_remark.id: the row this one corrects (same roaster); the old row is never touched, and is_current in v_roastery_remark is false for it.$c$;
COMMENT ON COLUMN roastery_remark.load_dts IS $c$UTC timestamp the row was loaded (system time).$c$;
-- ── v_roastery_remark ──
COMMENT ON VIEW v_roastery_remark IS $c$Purpose: Every roaster remark with roaster, coffee and lineup names, the SCA node (descriptor, category, sub-group, tier) and is_current (no newer row supersedes it); since cupping evidence brief 6 a descriptor remark's cupping_note_id is resolved at read time (the stored node, else the current roaster mapping of its normalised words), with stored_cupping_note_id and node_source (stored, mapping or null). | Class: view | Writer: none (derived) | Readers: roasteryRemarkReads (roasterVoiceReads: remarks per topic, award count), evidenceReads.getWorkbenchCoffee (website block), v_evidence_descriptor, v_evidence_unmapped_words, v_evidence_coverage, v_evidence_archetype, v_coffee_customer_descriptor | Since: 2026-10-18 (cupping evidence brief 1)$c$;

-- ── roastery_portal_lineup_response_best_seller ──
COMMENT ON TABLE roastery_portal_lineup_response_best_seller IS $c$Purpose: Up to three of the roastery's own lineup coffees picked as best sellers, in rank order, per lineup response; immutable once that lineup response is submitted. | Class: operating | Writer: roasteryPortalService.saveLineupDraft | Readers: roasteryPortalReads, roasteryPortalService | Since: 2026-10-06 (Roastery portal part 3 #212)$c$;
COMMENT ON COLUMN roastery_portal_lineup_response_best_seller.lineup_response_id IS $c$FK to roastery_portal_lineup_response(id); part of the primary key.$c$;
COMMENT ON COLUMN roastery_portal_lineup_response_best_seller.portal_coffee_id IS $c$FK to roastery_portal_coffee(id): the lineup coffee picked; unique per lineup response.$c$;
COMMENT ON COLUMN roastery_portal_lineup_response_best_seller.rank IS $c$Best-seller position, 1 to 3 (CHECK); part of the primary key.$c$;

-- ── v_roastery_portal_coffee ──
COMMENT ON VIEW v_roastery_portal_coffee IS $c$Purpose: Lineup row with prefill values: catalog (v_coffee) values field by field wherever present, except roaster_site rows where the roaster's own words win and the catalog only fills gaps. | Class: view | Writer: none (derived) | Readers: roasteryPortalReads | Since: 2026-10-05 (Roastery portal #209)$c$;

-- ── v_roastery_portal_response ──
COMMENT ON VIEW v_roastery_portal_response IS $c$Purpose: Every roastery_portal_response version with one effective caffeine_level (the new column, else decaf or regular derived from the deprecated is_decaf) and without roast_intent; the single definition for reading a version. | Class: view | Writer: none (derived) | Readers: roasteryPortalReads, roasteryPortalService.openDraft, roasteryPortalService.acceptResponse, v_roastery_portal_current_response, v_roastery_portal_progress | Since: 2026-10-06 (Roastery portal part 3 #212)$c$;

-- ── v_roastery_portal_current_response ──
COMMENT ON VIEW v_roastery_portal_current_response IS $c$Purpose: Per lineup coffee, the open draft if one exists else the latest submitted version (a coffee nobody has touched has no row). | Class: view | Writer: none (derived) | Readers: roasteryPortalReads (getCurrentResponseForCoffee → roasterVoiceReads), v_roastery_portal_progress, v_coffee_customer_descriptor | Since: 2026-10-05 (Roastery portal #209)$c$;

-- ── v_roastery_portal_progress ──
COMMENT ON VIEW v_roastery_portal_progress IS $c$Purpose: Per lineup coffee: state (not_started, in_progress, submitted), sections answered 0 to 6, who saved or submitted and when, version counts, unmapped-notes flag and accepted-version status for the admin review list. | Class: view | Writer: none (derived) | Readers: roasteryPortalReads | Since: 2026-10-05 (Roastery portal #209; accepted-version columns #210, additives columns #212)$c$;

-- ── v_roastery_portal_lineup_current_response ──
COMMENT ON VIEW v_roastery_portal_lineup_current_response IS $c$Purpose: Per roastery, the open lineup-wide draft if one exists else the latest submitted lineup response. | Class: view | Writer: none (derived) | Readers: roasteryPortalReads | Since: 2026-10-05 (Roastery portal part 2 #210)$c$;

-- ── v_roastery_portal_coffee_hint ──
COMMENT ON VIEW v_roastery_portal_coffee_hint IS $c$Purpose: Per catalog coffee, what the roaster said in the latest submitted response of its linked lineup coffee (proposed family, dominant dimension, 1 to 5 values with labels, respondent, date); hints only, nothing is written to the catalog. | Class: view | Writer: none (derived) | Readers: roasteryPortalReads, v_roastery_portal_dimension_match | Since: 2026-10-05 (Roastery portal part 2 #210)$c$;

-- ── v_roastery_portal_cousin_hint ──
COMMENT ON VIEW v_roastery_portal_cousin_hint IS $c$Purpose: Per lineup coffee whose latest submitted response names a closest cousin: both coffees and catalog ids, the what-changes text and each side's roaster-stated dominant dimension. | Class: view | Writer: none (derived) | Readers: roasteryPortalReads | Since: 2026-10-05 (Roastery portal part 2 #210)$c$;

-- ── v_roastery_portal_dimension_match ──
COMMENT ON VIEW v_roastery_portal_dimension_match IS $c$Purpose: Per catalog coffee with a submitted response: the roaster's dominant dimension next to ours (from its placed slot, else its match archetype), a matches flag and the merged cupping range; display and evidence only, never a gate. | Class: view | Writer: none (derived) | Readers: roasteryPortalReads | Since: 2026-10-05 (Roastery portal part 2 #210)$c$;

-- ── v_data_catalog ──
COMMENT ON VIEW v_data_catalog IS $c$Purpose: The data dictionary as rows: every table, view and table column in public with its comment and the parsed Purpose, Class, Writer, Readers and Since fields. | Class: view | Writer: none (derived) | Readers: dataCatalogIntegrity, dataCatalogMd (npm run catalog:md), admin.GET /api/admin/system-health, reporting_ro | Since: data catalog brief 2 (2026-10-16)$c$;

-- ── v_data_view_dependency ──
COMMENT ON VIEW v_data_view_dependency IS $c$Purpose: Which tables and views each view reads, one row per pair, from pg_depend on the view's rewrite rule. | Class: view | Writer: none (derived) | Readers: dataCatalogMd (CATALOG.md reads: lines), reporting_ro | Since: data catalog brief 2 (2026-10-16)$c$;

-- ── v_data_lineage_observed ──
COMMENT ON VIEW v_data_lineage_observed IS $c$Purpose: What actually ran against each table since stats_reset, one row per table, verb and role, parsed from pg_stat_statements query text (advisory, best effort; pg_stat_statements has no application_name, so the role stands in). | Class: view | Writer: none (derived) | Readers: dataCatalogMd (CATALOG.md Lineage), admin.GET /api/admin/system-health, reporting_ro | Since: data catalog brief 3 (2026-10-16)$c$;

-- ── v_data_table_activity ──
COMMENT ON VIEW v_data_table_activity IS $c$Purpose: Per-table inserts, updates, deletes and scans since the database stats_reset (pg_stat_user_tables), with is_dead_candidate for tables nothing has touched in over 30 days. | Class: view | Writer: none (derived) | Readers: dataCatalogIntegrity (check 6), dataCatalogMd (CATALOG.md Activity), admin.GET /api/admin/system-health, reporting_ro | Since: data catalog brief 3 (2026-10-16)$c$;

-- ── liam_sms_feedback ──
COMMENT ON TABLE liam_sms_feedback IS $c$Purpose: Not in schema.sql. Retired: original Sommelier Task 5 table for one-row-per-SMS Liam feedback messages, renamed to sommelier_sms_feedback in code (eff1d98); this old empty table (0 rows) was never dropped; the SMS feedback feature is not live yet and will be built on sommelier_sms_feedback, never here; drop-later, decided 2026-10-16 | Class: deprecated | Writer: none | Readers: none | Since: 2026-06-26 (Sommelier Task 5, commit 78c62f4)$c$;
COMMENT ON COLUMN liam_sms_feedback.id IS $c$Primary key (UUID); described from the Task 5 brief DDL, not from schema.sql.$c$;
COMMENT ON COLUMN liam_sms_feedback.user_id IS $c$Per the Task 5 DDL, FK to user_profile(id) ON DELETE CASCADE: the customer the message belongs to.$c$;
COMMENT ON COLUMN liam_sms_feedback.order_id IS $c$Per the Task 5 DDL, FK to "order"(id): the order that triggered the feedback request.$c$;
COMMENT ON COLUMN liam_sms_feedback.blend_id IS $c$Per the Task 5 DDL, FK to roaster_blend(id) (since renamed in the catalog; current target not checked): the bag the message asks about.$c$;
COMMENT ON COLUMN liam_sms_feedback.phone_number IS $c$Per the Task 5 brief, the E.164 phone number the SMS was sent to or received from.$c$;
COMMENT ON COLUMN liam_sms_feedback.direction IS $c$Per the Task 5 DDL CHECK, one of: outbound, inbound.$c$;
COMMENT ON COLUMN liam_sms_feedback.body IS $c$The SMS text, outbound request or inbound reply.$c$;
COMMENT ON COLUMN liam_sms_feedback.status IS $c$Per the Task 5 DDL CHECK, one of: scheduled, sent, delivered, failed, replied, opted_out (default scheduled).$c$;
COMMENT ON COLUMN liam_sms_feedback.scheduled_for IS $c$UTC timestamp an outbound message was due to send (Task 5 set order time plus 10 days).$c$;
COMMENT ON COLUMN liam_sms_feedback.sent_at IS $c$UTC timestamp the message was handed to the SMS provider; NULL if not sent.$c$;
COMMENT ON COLUMN liam_sms_feedback.provider_message_id IS $c$Message id returned by the SMS provider; NULL if none.$c$;
COMMENT ON COLUMN liam_sms_feedback.reply_to_id IS $c$Per the Task 5 DDL, self FK to liam_sms_feedback(id): the outbound message an inbound reply answers.$c$;
COMMENT ON COLUMN liam_sms_feedback.haiku_parsed IS $c$True once the inbound reply was parsed by the Haiku model (default false).$c$;
COMMENT ON COLUMN liam_sms_feedback.parsed_signal_type IS $c$Free-text signal type extracted from the reply; allowed values not documented.$c$;
COMMENT ON COLUMN liam_sms_feedback.parsed_rating IS $c$Rating integer extracted from the reply (scale not documented in the DDL).$c$;
COMMENT ON COLUMN liam_sms_feedback.parsed_sentiment IS $c$Per the Task 5 DDL CHECK, one of: positive, negative, neutral.$c$;
COMMENT ON COLUMN liam_sms_feedback.parsed_descriptors IS $c$JSONB of flavor descriptors extracted from the reply.$c$;
COMMENT ON COLUMN liam_sms_feedback.firestore_feedback_doc_id IS $c$Id of the Firestore users/{uid}/feedback_events doc created from the reply.$c$;
COMMENT ON COLUMN liam_sms_feedback.created_at IS $c$UTC timestamp when the row was created.$c$;

-- ── newsletter_subscriber_backup_20260925 ──
COMMENT ON TABLE newsletter_subscriber_backup_20260925 IS $c$Purpose: Not in schema.sql. Pre-correction copy of the 8 newsletter_subscriber rows whose archetype was fixed by the quiz resync correction on 2026-09-25, kept as the record of that fix and never dropped (decided 2026-09-25, reaffirmed 2026-10-16) | Class: snapshot | Writer: backfill:correct-subscriber-archetypes | Readers: none | Since: 2026-09-25 (quiz resync fix, WHAT_WE_BUILT.md)$c$;
COMMENT ON COLUMN newsletter_subscriber_backup_20260925.email IS $c$Subscriber email as it was in newsletter_subscriber at backup time (that table's primary key).$c$;
COMMENT ON COLUMN newsletter_subscriber_backup_20260925.user_id IS $c$user_profile id linked to the subscriber at backup time; NULL if none.$c$;
COMMENT ON COLUMN newsletter_subscriber_backup_20260925.subscribed IS $c$Subscribed flag at backup time.$c$;
COMMENT ON COLUMN newsletter_subscriber_backup_20260925.created_at IS $c$UTC timestamp the subscriber originally signed up.$c$;
COMMENT ON COLUMN newsletter_subscriber_backup_20260925.source_id IS $c$subscriber_source id at backup time.$c$;
COMMENT ON COLUMN newsletter_subscriber_backup_20260925.first_name IS $c$First name at backup time.$c$;
COMMENT ON COLUMN newsletter_subscriber_backup_20260925.archetype IS $c$The pre-correction (wrong, Balanced-placeholder) archetype value that the script replaced with the real latest quiz_session archetype.$c$;
COMMENT ON COLUMN newsletter_subscriber_backup_20260925.experimental IS $c$Experimental quiz flag at backup time.$c$;
COMMENT ON COLUMN newsletter_subscriber_backup_20260925.confidence IS $c$Quiz confidence label at backup time.$c$;
COMMENT ON COLUMN newsletter_subscriber_backup_20260925.quiz_session_key IS $c$Quiz session key that carried the subscribe call at backup time.$c$;
COMMENT ON COLUMN newsletter_subscriber_backup_20260925.campaign IS $c$Campaign attribution at backup time (the script backfilled hoboken-crawl-2026 for three rows afterward).$c$;
COMMENT ON COLUMN newsletter_subscriber_backup_20260925.campaign_vid IS $c$Campaign visitor id (UUID) at backup time.$c$;
COMMENT ON COLUMN newsletter_subscriber_backup_20260925.campaign_attributed_at IS $c$UTC timestamp campaign attribution was recorded, at backup time.$c$;
COMMENT ON COLUMN newsletter_subscriber_backup_20260925.backed_up_at IS $c$UTC timestamp the backup copy was taken (now() when the script ran).$c$;
-- ── cupping evidence brief 3: reconciliation views (Part A) ──
COMMENT ON VIEW v_cupping_note_family IS $c$Purpose: Each SCA node (cupping_note) with its tier and its tier-1 ancestor (the family), walked up parent_id; a family is this join, never a match on wheel_category text. | Class: view | Writer: none (derived) | Readers: v_evidence_descriptor, v_evidence_unmapped_words, evidenceIntegrity, v_coffee_customer_descriptor | Since: 2026-10-18 (cupping evidence brief 3)$c$;
COMMENT ON VIEW v_cupping_sheet_line IS $c$Purpose: The printed sheets' lines: which dimension each line feeds and whether it is scored or written in words. | Class: view | Writer: none (derived) | Readers: v_evidence_unmapped_words | Since: 2026-10-18 (cupping evidence brief 3)$c$;
COMMENT ON VIEW v_note_mapping_current IS $c$Purpose: The current word to SCA node mappings, roaster and cupper (source_kind); superseded rows stay in the table. | Class: view | Writer: none (derived) | Readers: v_evidence_descriptor, v_evidence_unmapped_words, evidenceIntegrity | Since: 2026-10-18 (cupping evidence brief 3)$c$;
COMMENT ON VIEW v_dial_position_signal_current IS $c$Purpose: The current dial position signals per coffee and source, with the basis line in notes. | Class: view | Writer: none (derived) | Readers: v_evidence_archetype | Since: 2026-10-18 (cupping evidence brief 3)$c$;
COMMENT ON VIEW v_evidence_dimension IS $c$Purpose: One row per coffee x numeric dimension x cupper: the cupper's latest current range (converted to 0 to 15) and its session, the pooled merged range repeated (every session, recency-weighted; merged_session_id is the latest) with n_sessions_pooled, merged_session_weights and sessions_disagree, the scales behind it, whether the cuppers agree (gap <= param cupper_gap), the roaster's 1 to 5 value and both average ranks within the roastery's lineup, and a flag (none, cuppers_disagree, roaster_disagrees, both, sessions_disagree, one_source). No cupper named in the definition. | Class: view | Writer: none (derived) | Readers: evidenceReads.getCoffeeEvidence (admin Coffees page evidence panel, workbench Dimensions tab), v_evidence_coverage, reporting_ro | Since: 2026-10-18 (cupping evidence brief 3; pooled range and sessions_disagree: brief 6)$c$;
COMMENT ON VIEW v_evidence_descriptor IS $c$Purpose: One row per coffee x SCA family (tier-1 ancestor by parent_id): which cuppers named it (from the cupper rows), the roaster's form, remarks and latest website capture, customers, accepted in the catalog, and hit / miss / extra. | Class: view | Writer: none (derived) | Readers: evidenceReads.getCoffeeEvidence, evidenceReads.getFamilies (catalogService D6 descriptor_off_family), v_evidence_roastery_calibration, reporting_ro | Since: 2026-10-18 (cupping evidence brief 3)$c$;
COMMENT ON VIEW v_evidence_descriptor_consensus IS $c$Purpose: One row per coffee x SCA node our cuppers named (from the current cupper rows, at the tier the cupper used): sessions_named, sessions_total (sessions in which any cupper scored the coffee), share, cuppers, first_named, last_named, the words written and the node's family; our cupping notes as a consensus instead of one row per cupping. Internal: reaches a customer only as confirmed_by_cupping on a roaster word. | Class: view | Writer: none (derived) | Readers: evidenceReads.getDescriptorConsensus (admin Flavor Wheel internal branch, workbench and Coffees page Descriptors tab), v_coffee_customer_descriptor, reporting_ro | Since: 2026-10-21 (cupping evidence brief 6)$c$;
COMMENT ON VIEW v_coffee_customer_descriptor IS $c$Purpose: What a customer may hear about a coffee, one row per coffee x wheel node: the roaster's words (accepted, then the latest website capture) then customers'; ours only as confirmed_by_cupping. Since coffee presentation brief 1: is_signature (family in the match archetype's descriptor_families), strength (n_roaster_channels, roaster_rank, cupping_share), qualifies (leaf, or sub-group with no leaf under it), group_order, display_order (signature then accent); caps applied by the read (customer_voice_signature_max, customer_voice_accent_max). | Class: view | Writer: none (derived) | Readers: cuppingReads.getCustomerDescriptors (roasterVoiceReads, public wheel, orders), cuppingReads.getCustomerDescriptorsAll (admin Flavor Wheel, Descriptors tab), v_palate_shared_traits, reporting_ro | Since: 2026-10-21 (cupping evidence brief 6; presentation columns 2026-10-23)$c$;
COMMENT ON VIEW v_evidence_archetype_call IS $c$Purpose: One row per coffee x cupper: the cupper's archetype, position and slot calls and call note from her latest current row, with the session, date and blind flag. | Class: view | Writer: none (derived) | Readers: v_evidence_archetype, evidenceReads.getCoffeeEvidence, reporting_ro | Since: 2026-10-18 (cupping evidence brief 3)$c$;
COMMENT ON VIEW v_evidence_archetype IS $c$Purpose: One row per coffee: every cupper call (JSON, from v_evidence_archetype_call), the merged call, the roaster's form and remark proposals, the catalog's assignment with its basis and session, the home placement with its session, evidence_newer_than_decision, the band check on the latest merged range (in_band, out_of_band, no_band, no_merged_range), the dial signal's basis and a flag. | Class: view | Writer: none (derived) | Readers: evidenceReads.getCoffeeEvidence, evidenceReads.getRoasteryEvidence (stale decisions), v_evidence_coverage, v_evidence_roastery_calibration, reporting_ro | Since: 2026-10-18 (cupping evidence brief 3)$c$;
COMMENT ON VIEW v_evidence_roastery_calibration IS $c$Purpose: One row per roastery x numeric dimension: average-rank correlation between our latest native-scale merged midpoints and the roaster's 1 to 5 values, mean rank gap, inverted (only when n >= param spearman_min_n), the archetype crosstab (our merged call x their form proposal) and descriptor hit / miss / extra counts. | Class: view | Writer: none (derived) | Readers: evidenceReads.getRoasteryEvidence (admin Roastery Feedback, Calibration), reporting_ro | Since: 2026-10-18 (cupping evidence brief 3)$c$;
COMMENT ON VIEW v_evidence_cupper_calibration IS $c$Purpose: One row per cupper x numeric dimension x blind flag, over every current native-scale cupper row: n, mean range width, signed gap to the other cuppers and disagreements, mean absolute gap to the roaster's rank and the correlation of the two rank vectors (null below param rank_corr_min_n), gap to the catalog on control samples, repeatability across sessions. | Class: view | Writer: none (derived) | Readers: evidenceReads.getRoasteryEvidence (admin Roastery Feedback, Calibration), reporting_ro | Since: 2026-10-18 (cupping evidence brief 3)$c$;
COMMENT ON VIEW v_evidence_coverage IS $c$Purpose: One row per active catalog coffee: which evidence exists (cuppers, sessions, portal, table and website remarks, customer feedback), n_sources (0 to 5), the catalog assignment and whether it states a basis, evidence_newer_than_decision and flag_unreconciled. What the System Health card reads. | Class: view | Writer: none (derived) | Readers: evidenceReads.getRoasteryEvidence, evidenceReads.getEvidenceSummary (admin System Health), reporting_ro | Since: 2026-10-18 (cupping evidence brief 3)$c$;
COMMENT ON VIEW v_evidence_unmapped_words IS $c$Purpose: One row per distinct word x source (roaster form, roaster remark, roaster website, cupper notes) that reaches no SCA node: not mapped, not a node's name, not a stop word, never a struck word. The mapping queue. | Class: view | Writer: none (derived) | Readers: evidenceReads.getUnmappedWords, evidenceReads.getEvidenceSummary (admin System Health), reporting_ro | Since: 2026-10-18 (cupping evidence brief 3)$c$;
