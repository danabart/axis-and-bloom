# Axis & Bloom — What We Built

A complete record of every infrastructure decision, file, and fix made to bring this project from zero to a fully deployed full-stack coffee brand website.

---

## The Short Version

You had a Figma Make frontend. We turned it into a production-deployed full-stack app in a single session:

- React frontend → Firebase Hosting
- Node.js/Express backend → Google Cloud Run
- PostgreSQL 38-table schema → Cloud SQL
- Firebase Auth with Email and Google sign-in
- Transactional email via Resend from `noreply@axisandbloomcoffee.com` (inbox, not spam)
- Claude AI chat agent
- Shopify stubbed (ready to wire when your roastery account is set up)
- Full CI/CD: push to `main` → deploys everything automatically

**Live site**: https://axis-and-bloom-prod.web.app  
**Backend**: https://axis-bloom-backend-oiub7eumya-uc.a.run.app

---

## Infrastructure Overview

```
GitHub (danabart/axis-and-bloom)
    │
    └── push to main → GitHub Actions
            │
            ├── Docker build → Artifact Registry (us-central1)
            │
            ├── Cloud Run deploy (axis-bloom-backend)
            │       ├── reads secrets from Secret Manager
            │       └── connects to Cloud SQL via Unix socket
            │
            └── Firebase Hosting deploy (frontend)
```

---

## GCP Project

| Field | Value |
|---|---|
| Project ID | `axis-and-bloom-prod` |
| Project number | `892123729036` |
| Region | `us-central1` |
| Billing account | `0146C3-1E6ACD-9480AC` |

---

## Firebase

| Field | Value |
|---|---|
| Project ID | `axis-and-bloom-prod` |
| Web App ID | `1:892123729036:web:8b62dc74a4b412d9453fa9` |
| API Key | `AIzaSyAoaeU75ATPBw99gUO9gjsc_2jCI3Z7CQA` |
| Auth domain | `axis-and-bloom-prod.firebaseapp.com` |
| Storage bucket | `axis-and-bloom-prod.firebasestorage.app` |
| Auth providers enabled | Email/Password, Google |
| Authorized domains | `localhost`, `axis-and-bloom-prod.web.app`, `axis-and-bloom-prod.firebaseapp.com` |

Firebase is used for **auth, hosting, and Firestore**. Structured relational data lives in Cloud SQL (PostgreSQL); user-centric and AI-feedable data (profiles, quiz sessions, AI content) lives in Firestore (`axis-bloom-fs`).

---

## Cloud SQL (PostgreSQL)

| Field | Value |
|---|---|
| Instance name | `axis-bloom-db` |
| Full name | `axis-and-bloom-prod:us-central1:axis-bloom-db` |
| Public IP | `35.223.155.186` |
| Database | `axisandbloom` |
| App user | `axisbloom` / `AxBloomApp2026#!` |
| Postgres superuser | `postgres` / `AxBloom2026#Secure!` |
| Authorized external IPs | `197.234.218.75/32` (Dana's laptop) |
| Cloud SQL Studio | https://console.cloud.google.com/sql/instances/axis-bloom-db/studio?project=axis-and-bloom-prod |

**Connection strings:**
- From Cloud Run (Unix socket): `postgresql://axisbloom:AxBloomApp2026%23!@/axisandbloom?host=/cloudsql/axis-and-bloom-prod:us-central1:axis-bloom-db`
- From local tools: `postgresql://axisbloom:AxBloomApp2026#!@35.223.155.186:5432/axisandbloom`

---

## Firestore

| Field | Value |
|---|---|
| Database name | `axis-bloom-fs` |
| Edition | Standard |
| Mode | Firestore Native |
| Region | `us-central1` (single region) |

Firestore is the AI-agent-oriented data layer for **user-centric data only**. The split:
- **Cloud SQL** — all structured relational data, including coffee records and their AI-generated content (ai_summary, surprise_note, three_voice_story). AI content is cached on the coffees table — it belongs there because it's a property of a coffee, not a property of a user.
- **Firestore** — user profiles, quiz session history, and future user feedback. Data the AI agent needs to understand a person's taste journey over time.

### Security rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /coffees/{coffeeId} {
      allow read: if true;
      allow write: if false;
    }
    match /users/{userId} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId;
      match /{subcollection}/{docId} {
        allow read, write: if request.auth != null
                           && request.auth.uid == userId;
      }
    }
  }
}
```

`coffees` — public read, backend-only write. `users` — each user can only read/write their own document and subcollections. Backend Admin SDK bypasses all rules.

### Collection structure

```
users/
  {uid}/                 ← Profile snapshot (email, firstName, lastName, archetype, archetypeLabel, lastQuizDate, syncedAt)
    quiz_sessions/
      {sessionId}/       ← One document per quiz taken (archetype, scores, secondaryArchetype, foodSignal, confidence, recommendationMode, experimental, completedAt)
```

### Sync points (all backend, non-blocking unless noted)

| Trigger | Firestore write |
|---|---|
| `GET /api/users/profile` | Upserts `users/{uid}` with current profile snapshot (fire-and-forget) |
| `PATCH /api/users/profile` | Updates `firstName` / `lastName` on `users/{uid}` (fire-and-forget) |
| `POST /api/quiz/results` | Updates archetype on `users/{uid}` (fire-and-forget) + **awaits** write to `users/{uid}/quiz_sessions/{sessionId}` |

The quiz session write is awaited (not fire-and-forget) because it creates a new subcollection document and needs to complete before the Cloud Run instance can be suspended. All other writes are non-blocking — Cloud SQL is the source of truth.

Coffee AI content (`ai_summary`, `surprise_note`, `three_voice_story`) is **not** written to Firestore — it lives only in the `coffees` SQL table. It's a property of a coffee record, not user-centric data, so it belongs in Cloud SQL alongside the rest of the coffee metadata.

### Backend wiring

`backend/src/services/firebase-admin.ts` exports:
- `firestoreDb` — named Firestore instance (`getFirestore(admin.app(), 'axis-bloom-fs')`)
- `FieldValue` — re-exported from `firebase-admin/firestore` for `serverTimestamp()` calls
- `default` (admin) — Firebase Admin SDK singleton (unchanged)

`frontend/src/app/lib/firebase.ts` exports `firestore = getFirestore(app, 'axis-bloom-fs')` — wired but not yet used for direct reads; frontend always goes through the backend API.

---

## Secret Manager

All backend secrets live in GCP Secret Manager (`axis-and-bloom-prod`). Cloud Run reads them at startup. Never stored in git.

| Secret name | What it is |
|---|---|
| `DATABASE_URL` | Cloud SQL Unix socket connection string |
| `ANTHROPIC_API_KEY` | Claude AI API key |
| `FIREBASE_PROJECT_ID` | `axis-and-bloom-prod` |
| `FIREBASE_PRIVATE_KEY` | Firebase Admin SDK private key |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-fbsvc@axis-and-bloom-prod.iam.gserviceaccount.com` |
| `SHOPIFY_STORE_DOMAIN` | Your roastery's Shopify domain (placeholder for now) |
| `SHOPIFY_STOREFRONT_TOKEN` | Shopify Storefront API token (placeholder) |
| `SHOPIFY_ADMIN_TOKEN` | Shopify Admin API token (placeholder) |
| `RESEND_API_KEY` | Resend transactional email API key (sends from noreply@axisandbloomcoffee.com) |
| `MAILCHIMP_API_KEY` | Mailchimp API key (format: `key-dc`, e.g. `abc123-us21`) — syncs newsletter signups to audience |
| `MAILCHIMP_LIST_ID` | Mailchimp audience / list ID |

---

## Service Accounts

| Account | Purpose |
|---|---|
| `firebase-adminsdk-fbsvc@axis-and-bloom-prod.iam.gserviceaccount.com` | Firebase Admin SDK — verifies auth tokens in the backend. Also granted `roles/cloudsql.client` on 2026-07-07 so its key (`serviceAccountKey.json`, already on Dana's machine) can authenticate through the Cloud SQL Auth Proxy for local seed/test scripts against the real DB — see `WHAT_WE_BUILT_DB.md`'s test-matrix notes on #73/#74. Deliberately left in place rather than revoked after use, for future testing convenience; the role alone doesn't grant data access — the separate Postgres app credentials are still required. |
| `github-actions-deploy@axis-and-bloom-prod.iam.gserviceaccount.com` | GitHub Actions — pushes Docker images, deploys Cloud Run, deploys Firebase Hosting |
| `892123729036-compute@developer.gserviceaccount.com` | Cloud Run runtime — reads Secret Manager secrets, connects to Cloud SQL |

---

## API Keys

| Service | Key |
|---|---|
| Anthropic | `sk-ant-api03-v2i-...` (full key in `backend/.env`) |
| GitHub PAT | stored securely — repo + workflow scopes (rotate at github.com/settings/tokens if needed) |

---

## Repository Structure

```
axis-and-bloom/
├── frontend/                   # React 18 + Vite 6 + TypeScript
│   ├── src/
│   │   └── app/
│   │       ├── components/     # All pages and UI components
│   │       │   ├── SignIn.tsx       # Auth page (email + Google + Apple)
│   │       │   ├── Home.tsx
│   │       │   ├── PreLaunch.tsx    # Full-screen pre-launch curtain (email + firstName signup; hides site until launch)
│   │       │   ├── FlavorQuiz.tsx
│   │       │   ├── Shop.tsx
│   │       │   ├── Profile.tsx
│   │       │   ├── PublicLayout.tsx # Nav + Footer + Outlet wrapper for public routes
│   │       │   ├── admin/
│   │       │   │   ├── AdminRoute.tsx       # Role guard — redirects non-admins to /
│   │       │   │   ├── AdminLayout.tsx      # Sidebar nav + Outlet + Back to site link
│   │       │   │   ├── AdminDashboard.tsx   # 6 stat cards (counts across tables)
│   │       │   │   ├── AdminCoffees.tsx     # Coffee catalogue table + add form
│   │       │   │   ├── AdminSessions.tsx    # Cupping sessions table + add form
│   │       │   │   ├── AdminFlavorWheel.tsx # Per-coffee descriptor view (3 sources)
│   │       │   │   ├── AdminRoasters.tsx    # Roastery partners + add form + active toggle
│   │       │   │   └── AdminCupping.tsx     # Score entry: session+coffee → 12 dims + SCA picker
│   │       │   └── ...
│   │       ├── context/
│   │       │   └── AuthContext.tsx  # Firebase auth state + signIn/signUp/Google/Apple + isAdmin
│   │       ├── hooks/
│   │       │   └── useAdminLookups.ts  # Fetches lookup_value table once per admin session
│   │       └── lib/
│   │           ├── firebase.ts     # Firebase app init
│   │           └── api.ts          # Backend API client
│   ├── .env                    # Local env vars (gitignored)
│   └── firebase.json           # Firebase Hosting config
│
├── backend/                    # Node.js + Express + TypeScript
│   ├── src/
│   │   ├── index.ts            # App entry + schema migration + /health/db
│   │   ├── db/
│   │   │   ├── client.ts       # pg Pool (SSL-aware for Cloud SQL socket)
│   │   │   └── schema.sql      # 38-table schema, runs on every startup
│   │   ├── middleware/
│   │   │   └── auth.ts         # Firebase token verification + requireAdmin middleware
│   │   ├── routes/
│   │   │   ├── auth.ts         # /api/auth — profile sync + password reset (Resend)
│   │   │   ├── quiz.ts         # /api/quiz — flavor quiz
│   │   │   ├── shop.ts         # /api/shop — Shopify products/orders
│   │   │   ├── agent.ts        # /api/agent — Claude AI chat
│   │   │   ├── orders.ts       # /api/orders
│   │   │   ├── users.ts        # /api/users (includes isAdmin flag)
│   │   │   ├── admin.ts        # /api/admin — all routes behind requireAdmin middleware
│   │   │   └── newsletter.ts   # /api/newsletter
│   │   └── services/
│   │       └── shopify.ts      # Shopify client (stubbed when no credentials)
│   ├── .env                    # Local env vars (gitignored)
│   └── Dockerfile
│
├── .github/
│   └── workflows/
│       └── deploy.yml          # CI/CD pipeline
│
└── infra/
    ├── deploy.sh
    ├── cloud-run-backend.yaml
    └── setup-secrets.sh
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 18 + Vite 6 + TypeScript |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Routing | React Router v7 |
| Animations | motion/react |
| Auth | Firebase Auth (Email/Password + Google) |
| Document store | Firestore (`axis-bloom-fs`) — user profiles, quiz sessions, AI content |
| Transactional email | Resend (sends from noreply@axisandbloomcoffee.com) |
| Marketing email | Mailchimp (newsletter subscribers synced on signup with FNAME merge field) |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL 15 on Cloud SQL |
| AI | Anthropic Claude (claude-sonnet-4-6 for chat, claude-haiku-4-5 for recommendations) |
| Orders | Shopify drop-ship (stubbed) |
| Frontend hosting | Firebase Hosting |
| Backend hosting | Google Cloud Run |
| Container registry | Artifact Registry (us-central1) |
| CI/CD | GitHub Actions |

---

## Database Schema

> Full DB reference (tables, views, enums, dimensions, cupping sessions, useful queries) has moved to **`WHAT_WE_BUILT_DB.md`**.

Schema file: `backend/src/db/schema.sql` — runs on every backend startup, fully idempotent.  
Migration scripts: `backend/src/db/migrations/`

### Table groups (summary)

**Lookup / reference**
- `user_type` — subscriber, admin, roaster partner, etc.
- `archetype` — named flavor profiles: Chocolate & Nutty, Balanced & Sweet, Fruity, Floral, Earthy, Experimental
- `roaster` — drop-ship roastery partners
- `quiz` — quiz versions
- `cupping_note` — SCA Coffee Taster's Flavor Wheel: 84 descriptors across 9 categories and ~25 subcategories; `intensity_score` is NULL by default (assigned per cupping session, not at descriptor level)
- `lookup_value` — controlled vocabulary for admin dropdowns: `category` + `value` + `label` + `sort_order`; seeded with 20 values across 4 categories (`roast_level`, `process`, `blend_or_single`, `brew_method`); `ON CONFLICT DO UPDATE` so labels/order stay current on every deploy without duplicating rows

**Users**
- `household` — shared account grouping (one household, multiple members)
- `household_invitation` — pending/accepted/cancelled invitations to join a household; token-based (32-byte hex); expires in 7 days; `ON DELETE CASCADE` from household; status: `pending`, `accepted`, `cancelled`
- `user_profile` — core user record; `firebase_uid` is the join key from Firebase Auth; columns added: `first_name TEXT`, `last_name TEXT`, `date_of_birth DATE` (all idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`)
- `user_email` — multiple email addresses per user
- `user_phone`
- `address` — shipping and billing addresses (street, city, state, postal_code, country, is_default, address_type: `address_type_enum`); collected from the profile page Settings tab; first address of each type auto-set as default
- `user_payment_detail` — Stripe customer links and payment info

**Flavor / archetype engine**
- `archetype_vector` — where each archetype sits in flavor-dimension space
- `archetype_relationship` — which archetypes are adjacent/complementary
- `archetype_tunable_variable` — dials users can adjust within their archetype
- `user_vector_state` — where each user sits in flavor-dimension space (declared + behavioral)
- `user_archetype_tuning` — user's personal adjustments to their archetype
- `user_coffee_profile` — their ranked archetype matches

**Blends / roastery**
- `roaster_blend` — coffee blends available for purchase; links to Shopify variant IDs
- `roastery_blend_vector` — where each blend sits in flavor-dimension space
- `user_roaster_link` — roastery staff accounts
- `roaster` — drop-ship roastery partners; fields: name, contact_person, email, phone, address, website, api_endpoint, avg_fulfillment_hours, roaster_notes, is_active; new contact fields added May 2026

**Quiz**
- `quiz_type` — lookup: `'main'` (user-facing quiz) | `'branch'` (reclassification sub-quiz); FK on `quiz.quiz_type_id`
- `quiz` — branch quizzes are rows with `quiz_type = 'branch'`, `trigger_archetype_id` (which primary archetype fires this branch), and `parent_quiz_id` (self-referential FK to the main quiz). No separate link table needed. `quiz_branch` was dropped in #54.
- `quiz_question` — (renamed from `question` in #55) includes `weight NUMERIC DEFAULT 1`; question-level multiplier applied uniformly to all answers in that question
- `quiz_answer` — (renamed from `answer` in #53) branching logic via `next_question_id`, vector impact stored as JSONB; includes `weight NUMERIC DEFAULT 1` and `is_experimental_gate`; shared by both main and branch quizzes
- `quiz_answer_archetype_score` — the scoring matrix: one row per (quiz_answer, archetype); `score` is the archetype-specific impact (positive or negative); `archetype_id = NULL` = neutral answer (no points); UNIQUE on `(answer_id, archetype_id)`
- `quiz_session` — a user's completed quiz
- `quiz_vector` — dimension scores from a quiz session

**Orders & fulfillment**
- `subscription` — recurring delivery schedules
- `order` — purchase records; links to Shopify order IDs. Live write path as of #73 (legacy `orders` table retired — it was never actually exercised); includes shipping-address snapshot columns
- `roastery_shipment_details` — tracking info per order
- `order_line_item` — individual blend quantities per order

**User lifecycle status** *(added #73)* — `user_lifecycle_stage`, `user_lifecycle_state`, `user_lifecycle_event`. See `WHAT_WE_BUILT_DB.md` for the full breakdown.

**Intelligence**
- `notification_log` — email/SMS notifications sent
- `user_feedback_event` — ratings, repurchases, skips used to tune recommendations
- `user_recommendation_log` — AI recommendation audit trail

**Chat & newsletter**
- `chat_message` — Claude AI chat history per user
- `subscriber_source` — normalised reference table for signup origins; 4 seeded rows: `pre_launch` (Pre-Launch Popup), `newsletter` (Newsletter Modal), `post_quiz` (Post-Quiz Signup), `footer` (Footer Widget)
- `newsletter_subscriber` — `email` PK; `first_name TEXT`; `source_id` FK → `subscriber_source`; `user_id` FK → `user_profile` (optional); `subscribed BOOLEAN`; `created_at`

**Cupping tool** *(added May 2026 — SERIAL PKs, standalone from the main schema)*
- `coffees` — coffee catalogue (name, roaster, origin, process, roast level/shade, roaster flavor descriptors)
- `cupping_sessions` — session header (date, brew_method TEXT, location, notes); brew_method was originally `brew_method_enum` but migrated to `TEXT` so it accepts all lookup values (cupping, pour-over, etc.) without enum constraint failures
- `cupping_session_coffees` — junction: which coffees appeared in a session and in what order
- `coffee_dimensions` — cupping dimension catalogue, 12 seeded rows; `is_numeric = true` → scored 0–15 with scale labels; `is_numeric = false` → free-text notes only
- `cupping_scores` — per-taster score header (session_coffee_id, taster_name, is_merged, overall_notes); unique on `(session_coffee_id, taster_name)`; `is_merged = true` for the combined row
- `cupping_score_values` — one row per (cupping_score, dimension); `value_min` / `value_max` for numeric dims, `notes` for free-text dims; unique on `(cupping_score_id, dimension_id)`
- `cupping_score_descriptors` — structured flavor notes: links a score row to one or more SCA wheel descriptors (`cupping_note`) instead of free text; `intensity` (0–15) captures how prominent the descriptor was; `custom_notes` is an escape hatch for off-wheel descriptors; unique on `(cupping_score_id, cupping_note_id)`
- `roastery_coffee_descriptors` — structured version of `coffees.flavor_descriptors_roaster TEXT[]`; **one row per descriptor per coffee** (e.g. Crosshatch with 3 bag notes = 3 rows); links to SCA wheel via FK; unique on `(coffee_id, cupping_note_id)`
- `user_flavor_feedback` — post-delivery feedback from customers; **one row per descriptor per user per coffee** (e.g. a client who tasted Blueberry and Dark Chocolate = 2 rows); links user + coffee + order to SCA wheel descriptors; `intensity` optional; no session or brew params — lightweight by design
- `cupping_brew_params` — brew parameters per session-coffee (dose, water, yield, ratio, temp, grind, extraction time, pressure, steep time, device); all nullable
- `archetype_assignments` — archetype tag per coffee with confidence level; `superseded_at = NULL` for the current assignment, populated when a newer one replaces it
- `dial_archetype_config` — dominant dimension and Bloom Dial flag per archetype
- `dial_position_vocabulary` — archetype+dimension-specific label vocabulary for the Bloom Dial (seeded)
- `dial_archetype_positions` — maps coffees to their position on the Bloom Dial per archetype
- `dial_coffee_relationships` — directional dimensional hop graph between coffees; used by the sommelier RAG and future computed dial positions
- `coffees.ai_summary TEXT` — AI-generated tasting note cached in the DB (added via idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`); generated once on first public page load, updated only via admin refresh; never regenerates on visitor traffic

> Views, dimensions, and enums are documented in `WHAT_WE_BUILT_DB.md`.

---

## API Endpoints

| Method | Path | Auth required | Description |
|---|---|---|---|
| GET | `/health` | No | Returns `{"status":"ok"}` |
| GET | `/health/db` | No | Returns connected status + all table names |
| POST | `/api/auth/sync` | Yes | Creates/updates user_profile row after Firebase sign-in; accepts `{ firstName, lastName }` — saves on signup, uses `COALESCE` so re-login never overwrites existing names |
| POST | `/api/auth/reset-password` | No | Sends branded password-reset email via Resend from axisandbloomcoffee.com |
| GET | `/api/quiz/questions` | No | Returns active quiz questions + answers from DB (with archetype names and answer UUIDs) |
| POST | `/api/quiz/score` | No | Takes `{ answerIds[] }`, SUMs weighted scores from `quiz_answer_archetype_score`, returns winning archetype, secondary archetype, food signal, confidence level, and recommendation mode. Veto cascade: Q5 → Q4 → Q2 → Q1. All scoring logic lives here — zero logic in the frontend. |
| GET | `/api/quiz/branch` | No | Takes `?archetypeId=<uuid>`, returns `{ branchQuestion: { questionId, questionText, answers:[{id,text,archetypeId,archetypeName}] } }` or `{ branchQuestion: null }`. Queries `quiz` table directly for a branch quiz row where `parent_quiz_id = activeQuizId AND trigger_archetype_id = archetypeId`. No link table needed. |
| POST | `/api/quiz/results` | Yes | Saves completed quiz session with full scoring context (including secondaryArchetype, foodSignal, confidence, recommendationMode in context_data JSONB); calls Claude with mode-specific prompt; returns session ID + recommendation. Called after branch answer (if any) so final archetype is saved. |
| GET | `/api/quiz/results/latest` | Yes | Returns user's most recent quiz session with archetype name |
| GET | `/api/shop/products` | No | Returns Shopify products (empty list until Shopify wired) |
| POST | `/api/shop/order` | Yes | Creates Shopify order |
| POST | `/api/agent/chat` | Yes | Claude AI chat with coffee context |
| POST | `/api/orders` | Yes | Places an order — writes to `"order"` + `order_line_item` (not the retired legacy `orders` table, see #73); shipping address snapshotted onto the order |
| GET | `/api/orders` | Yes | User's order history, from `"order"` + `order_line_item` |
| POST | `/api/orders/:orderId/feedback` | Yes | On-site feedback form (#73) — `{ rating: 1-5, note? }`, ownership-checked; writes Firestore `feedback_events` with `source: 'onsite'`, zero LLM calls |
| GET | `/api/users/profile` | Yes | User's full profile — returns `firstName`, `lastName`, `dateOfBirth`, `email`, `archetype`, `addresses[]`, `orders[]` (now includes `blendName`, `hasFeedback` per order), `isAdmin` |
| PATCH | `/api/users/profile` | Yes | Update `firstName`, `lastName`, `dateOfBirth` — uses `COALESCE` so omitted fields are not cleared |
| GET | `/api/users/homepage-state` | Yes | User lifecycle stage + display extras for the homepage CTA (#73) — `{ stageCode, archetype, daysSinceQuiz, pendingFeedback, usualBlend, nextDeliveryDate }`; falls back to a live `getUserSignals()` computation on first visit |
| POST | `/api/users/addresses` | Yes | Add a shipping or billing address (`addressType: 'shipping' \| 'billing'`); first address of each type auto-set as default |
| PATCH | `/api/users/addresses/:id/default` | Yes | Set an address as default for its type — unsets all others of the same type |
| DELETE | `/api/users/addresses/:id` | Yes | Remove an address (ownership-checked) |
| POST | `/api/newsletter/subscribe` | No | Newsletter signup — accepts `{ email, firstName?, source? }`; upserts `newsletter_subscriber` (preserving existing first_name if new value is blank); syncs to Mailchimp non-blocking if credentials configured; `source` defaults to `'newsletter'` |
| POST | `/api/newsletter` | No | Backward-compat alias for `/subscribe` — called by `NewsletterModal`; identical logic |
| GET | `/api/admin/lookups` | Admin | All dropdown options grouped by category (`roast_level`, `process`, `blend_or_single`, `brew_method`) |
| GET | `/api/admin/stats` | Admin | Count of coffees, sessions, internal/roastery/client descriptors, SCA entries |
| GET | `/api/admin/coffees` | Admin | All coffees with current archetype assignment |
| POST | `/api/admin/coffees` | Admin | Add a coffee to the catalogue |
| GET | `/api/admin/sessions` | Admin | All cupping sessions with coffee count |
| POST | `/api/admin/sessions` | Admin | Create a cupping session |
| GET | `/api/admin/flavor-wheel/:coffeeId` | Admin | All descriptors for a coffee across all three sources (internal, roastery, client), grouped |
| GET | `/api/admin/cupping-notes` | Admin | All 84 SCA wheel descriptors for the descriptor picker |
| GET | `/api/admin/roasters` | Admin | All roastery partners ordered by name (includes contact fields) |
| POST | `/api/admin/roasters` | Admin | Add a roastery (name, contact_person, email, phone, address, website, api_endpoint, avg_fulfillment_hours, roaster_notes) |
| PATCH | `/api/admin/roasters/:id` | Admin | Full edit of a roastery record (all fields) |
| PATCH | `/api/admin/roasters/:id/toggle` | Admin | Flip `is_active` on a roastery without a full update |
| POST | `/api/admin/coffees/:id/archetype` | Admin | Assign archetype + confidence to a coffee; supersedes current assignment |
| GET | `/api/admin/sessions/:id/coffees` | Admin | Coffees linked to a session with display order |
| POST | `/api/admin/sessions/:id/coffees` | Admin | Link a coffee to a session (auto display_order) |
| DELETE | `/api/admin/sessions/:sessionId/coffees/:scId` | Admin | Unlink a coffee from a session |
| DELETE | `/api/admin/sessions/:id` | Admin | Delete a cupping session and its coffee links (CASCADE) |
| GET | `/api/admin/dimensions` | Admin | All 12 cupping dimensions with scale labels and numeric flag |
| GET | `/api/admin/scores/session-coffee/:scId` | Admin | Existing scores + dimension values + descriptors for a session_coffee |
| POST | `/api/admin/scores` | Admin | Upsert a full cupping score (header + dimension values + descriptors) in one call |
| DELETE | `/api/admin/scores/:scoreId` | Admin | Delete a cupping score and all its dimension values + descriptors (CASCADE) |
| POST | `/api/admin/grant-admin` | Admin | Grant admin role to a user by email — body: `{ "email": "..." }` |
| DELETE | `/api/admin/revoke-admin` | Admin | Revoke admin role (sets back to customer) — body: `{ "email": "..." }` |
| POST | `/api/admin/coffees/:id/refresh-summary` | Admin | Force-regenerates and stores the AI tasting note for a coffee — use after new cupping data is added |
| GET | `/api/coffees/archetypes` | No | Roaster-blind, archetype-grouped, slot-based catalogue — the source of truth for both The Bloom and the Flavor Intelligence page. Each slot includes `isDefault: boolean` (2026-07-12). **Removed 2026-08-02 (#131/HOME Task 5d)**: the old flat `GET /api/coffees` (raw `name`/`roaster` list) — confirmed unreferenced by any frontend page, admin tooling, or test, and the "kept for admin tooling" note above was itself stale; this line is the sole survivor of that entry |
| GET | `/api/coffees/archetype-stats?archetype=` | No | Per-dimension target range + avg actual cupping score + coffee count for one archetype (2026-07-12) |
| GET | `/api/coffees/:id/legacy-slot` | No | Resolves a raw `coffeeId` to `{ archetype, dialSortOrder }` for old `?coffee=` deep links (2026-07-12) |
| GET | `/api/coffees/:id/flavor-wheel` | No | Flavor descriptors for one coffee aggregated from all 3 sources via `v_collaborative_flavor_wheel` |
| GET | `/api/coffees/:id/dimensions` | No | Numeric dimension ranges (avg min/max per dimension) from all cupping scores + session overall notes |
| GET | `/api/coffees/:id/content` | No | AI summary/surprise note/three-voice story, plus `process`/`roastLevel`/`originRegion` (2026-07-12) |
| GET | `/api/coffees/:id/ai-summary` | No | Returns cached `ai_summary` from DB if it exists; otherwise generates via Claude haiku, stores, and returns |
| POST | `/api/admin/lookups` | Admin | Upsert a `lookup_value` row on `(category, value)` — so new dropdown options don't need a code deploy (2026-07-12) |
| PATCH/DELETE | `/api/admin/lookups/:id` | Admin | Update/delete a `lookup_value` row; `DELETE` returns 409 (not a raw FK error) if still assigned to a coffee (2026-07-12) |
| PATCH | `/api/admin/coffees/:id` | Admin | Partial update — `process`/`roast_level`/`origin_region` (2026-07-12) |
| GET | `/api/axis/vectors` | No | Returns all archetype dimension vectors from `v_archetype_vectors`, grouped by archetype name — endpoint exists and is ready; not currently fetched by the public `/the-axis` page (which is static) |
| POST | `/api/household/create` | Yes | Create a household; caller becomes admin; fails if already in a household |
| GET | `/api/household/mine` | Yes | Returns current household with members + pending invitations, or `null` if not in one |
| POST | `/api/household/invite` | Yes (admin) | Invite a member by email — sends branded Resend email with join link; cancels any prior pending invite for the same email |
| DELETE | `/api/household/leave` | Yes | Leave household; if admin and only member, dissolves the household; admin with other members must remove them first |
| DELETE | `/api/household/members/:userId` | Yes (admin) | Remove a member from the household (cannot remove yourself) |
| GET | `/api/household/invite/:token` | No | Public — looks up invitation by token; returns invited email, household name, inviter name; used by the join page before sign-in |
| POST | `/api/household/join/:token` | Yes | Accept an invitation — user's email must match invited email; sets `household_id` on `user_profile`, marks invitation `accepted` |
| DELETE | `/api/household/invitations/:invitationId` | Yes (admin) | Cancel a pending invitation |

---

## CI/CD Pipeline (`.github/workflows/deploy.yml`)

Every push to `main` triggers two jobs in sequence:

**Job 1: deploy-backend**
1. Checkout code
2. Authenticate with GCP (service account key stored as `GCP_SA_KEY` GitHub secret)
3. Configure Docker for Artifact Registry
4. `docker build` the backend (`./backend/Dockerfile`)
5. Push image to `us-central1-docker.pkg.dev/axis-and-bloom-prod/axis-bloom/axis-bloom-backend:{git-sha}`
6. `gcloud run deploy` — mounts all secrets from Secret Manager, adds Cloud SQL instance

**Job 2: deploy-frontend** (runs after backend succeeds)
1. Checkout code
2. Authenticate with GCP
3. Get the Cloud Run backend URL dynamically (so `VITE_API_URL` is always correct)
4. `npm ci && npm run build` with Firebase config injected as env vars
5. Deploy built `dist/` to Firebase Hosting

GitHub Actions secrets required: `GCP_SA_KEY`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_APP_ID`

---

## How the Database Migration Works

There is no separate migration tool. The schema runs on every backend startup:

```typescript
// backend/src/index.ts
async function start() {
  const schema = readFileSync(join(__dirname, 'db', 'schema.sql'), 'utf-8');
  await db.query(schema);           // CREATE TABLE IF NOT EXISTS + idempotent seed data
  app.listen(PORT, ...);
}
```

The Dockerfile copies the SQL file into the build output:
```dockerfile
RUN npm run build && cp src/db/schema.sql dist/db/schema.sql
```

This means:
- New tables appear automatically when you deploy a new schema
- Existing tables and data are never touched
- Seed data (archetypes, quiz v2, questions, answers) runs on every startup but is fully idempotent — `ON CONFLICT DO NOTHING` for archetypes; a `DO $seed$ IF NOT EXISTS ... END $seed$` block for the quiz
- To add a column you'd need an ALTER TABLE migration (same pattern — wrap in a DO block checking information_schema)

---

## How Firebase Auth Works with the Backend

1. User signs in on the frontend (Firebase SDK handles the OAuth/email flow)
2. Frontend gets a Firebase ID token (`user.getIdToken()`)
3. Every API request includes `Authorization: Bearer {idToken}`
4. Backend middleware (`src/middleware/auth.ts`) calls `firebase-admin.auth().verifyIdToken(token)`
5. Verified `uid` is used to look up / create the `user_profile` row

The `user_profile.firebase_uid` column is indexed for fast lookups.

---

## How the AI Chat Works

Route: `POST /api/agent/chat`

- Accepts `{ message, context }` in the request body
- Maintains conversation history in the `chat_message` table (per user)
- Calls Anthropic API with a system prompt that gives Claude context about the user's flavor profile and order history
- Uses `claude-sonnet-4-6` for the main chat
- Uses `claude-haiku-4-5` (faster, cheaper) for quick product recommendations

---

## How Shopify Works (Stubbed)

```typescript
// backend/src/services/shopify.ts
const shopifyEnabled = Boolean(DOMAIN && STOREFRONT_TOKEN && ADMIN_TOKEN);

export async function getProducts() {
  if (!shopifyEnabled) return [];           // Returns empty array
  // ... real Shopify query
}

export async function createOrder(...) {
  if (!shopifyEnabled) throw new Error('Shop not yet available');
  // ... real order creation
}
```

When your roastery Shopify account is ready:
1. Get `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN`, and `SHOPIFY_ADMIN_TOKEN`
2. Update the three secrets in GCP Secret Manager
3. Redeploy (or just push any commit to main)
4. The stubbed guard will lift automatically

---

## Issues We Hit and Fixed

### 1. Firebase Management API not enabled
**Error**: `firebase projects:list` returned nothing; `firebase apps:create` returned 404  
**Fix**: Enabled `firebase.googleapis.com` via Service Usage API, then called the `addFirebase` REST endpoint to attach Firebase to the GCP project.

### 2. Firebase Auth not initialized
**Error**: `CONFIGURATION_NOT_FOUND` from the Firebase Auth SDK  
**Fix**: You clicked "Get started" in the Firebase Console Authentication section, which initializes the Auth service for the project.

### 3. Cloud SQL unauthorized extension
**Error**: Schema migration failed silently because `CREATE EXTENSION "uuid-ossp"` requires superuser  
**Fix**: Replaced all `uuid_generate_v4()` calls with PostgreSQL 15's built-in `gen_random_uuid()`, removed the `CREATE EXTENSION` line entirely.

### 4. Invalid PostgreSQL syntax for conditional ALTER TABLE
**Error**: `ALTER TABLE household ADD CONSTRAINT IF NOT EXISTS` — the `IF NOT EXISTS` clause is not valid syntax in PostgreSQL for ALTER TABLE  
**Fix**: Wrapped the constraint in a `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE ...) THEN ALTER TABLE ... END IF; END $$;` block.

### 5. schema.sql missing from Docker image
**Error**: Tables never appeared; migration silently skipped  
**Fix**: TypeScript compilation only emits `.js` files. Added `cp src/db/schema.sql dist/db/schema.sql` to the Dockerfile build step.

### 6. Cloud Run couldn't read Secret Manager secrets
**Error**: Backend crashed on startup with permission denied reading secrets  
**Fix**: Granted `roles/secretmanager.secretAccessor` and `roles/cloudsql.client` to the Compute default service account (`892123729036-compute@developer.gserviceaccount.com`).

### 7. GitHub Actions checkout failing
**Error**: `fatal: could not read Username for 'https://github.com': terminal prompts disabled`  
**Fix**: Added explicit `token: ${{ secrets.GITHUB_TOKEN }}` to both checkout steps, and added `pull-requests: write` permission to the frontend job (required by the Firebase Hosting deploy action).

### 8. SSL error on Cloud SQL connection
**Error**: `/health/db` returned `"The server does not support SSL connections"`  
**Fix**: Cloud SQL Unix socket connections don't use SSL (they're already secured by the Cloud SQL Auth proxy). Added detection in `db/client.ts`:
```typescript
const isUnixSocket = connectionString.includes('host=/cloudsql/');
ssl: process.env.NODE_ENV === 'production' && !isUnixSocket ? { rejectUnauthorized: false } : false
```

### 9. GitHub PAT missing workflow scope
**Error**: Could not push workflow files to the repo  
**Fix**: Created a new PAT with `repo` + `workflow` scopes.

### 10. `/api/users/profile` referenced non-existent tables
**Error**: Profile page silently showed "no archetype" fallback; backend was returning 500  
**Fix**: `users.ts` was written against a pre-migration placeholder schema (`users`, `quiz_results`, `orders` tables with a `uid` column). Rewrote the route to query the real 38-table schema: `user_profile` (firebase_uid), `user_email`, `quiz_session` → `archetype`, `"order"` + `order_line_item`.

### 12. Quiz V2 — replaced 15-question system with 4-question design
**Change**: Original quiz had 15 questions, 6 archetypes (Floral, Fruity, Balanced, Chocolate, Spicy, Experimental) and a complex multi-dimensional scoring system.  
**New design** (from `Quiz V2.xlsx`): 4 focused questions, 3 archetypes, simple vote-counting — each answer = +1 for one archetype, most votes wins. Q3 has a neutral "I'm not sure" option that awards no votes.

### 14. Cupping tool schema added (May 2026)
**Change**: Added 3 PostgreSQL enums and 6 new tables to support a standalone cupping / QC workflow. Tables use SERIAL PKs (not UUIDs) and are fully separate from the existing `cupping_session` (singular) legacy table. All idempotent — enums wrapped in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`, tables use `CREATE TABLE IF NOT EXISTS`.

### 15. Renamed `archetype_enum` values
**Change**: `fruity_floral` → `fruity` and `spicy_earthy` → `earthy`.  
**Fix**: Updated the `CREATE TYPE` for fresh installs, and added two idempotent `DO` blocks that check `pg_enum` before calling `ALTER TYPE archetype_enum RENAME VALUE`. Safe to run on every startup — the blocks no-op once the rename is done.

### 22. `CREATE OR REPLACE VIEW` cannot rename columns in PostgreSQL
**Error**: `pq: cannot change name of view column "cupping_note_id" to "coffee_name"`  
**Cause**: PostgreSQL's `CREATE OR REPLACE VIEW` can add new columns at the end but cannot rename or reorder existing ones. The original `v_collaborative_flavor_wheel` had `cupping_note_id` as column 2; the updated version inserted `coffee_name` before it.  
**Fix**: Switch to `DROP VIEW IF EXISTS` + `CREATE VIEW` in both `schema.sql` and the seed file. Safe because no other views or tables depend on this view.

### 21. Upgraded quiz to 5 questions with weighted `answer_archetype_score` table (later renamed to `quiz_answer_archetype_score` in #56)
**Problem**: The original backend scoring counted one vote per answer using `resulting_archetype_id` — flat, unweighted, inflexible. Adding a new archetype or changing scoring weights required code changes.  
**Fix**: Added a normalised `quiz_answer_archetype_score` table (one row per answer + archetype, with a `score` column). Also added `weight NUMERIC DEFAULT 1` to both `question` and `answer` tables for future question-level weighting. Scoring weights for Q1–Q5:
- Q1 = 1 pt, Q2 = 2 pts, Q3 = 1 pt (Q3-D neutral → no row), Q4 = 2 pts, Q5 = 3 pts
Added Q5 ("You're handed an espresso — straight, no milk, no sugar. How does it land?") to quiz v2 via idempotent DO block. `POST /api/quiz/score` now JOINs `quiz_answer_archetype_score`, GROUPs BY archetype, and returns SUM of scores instead of counting votes.  
**Seed file**: `backend/src/db/seeds/scoring_v1.sql` — run once in Cloud SQL Studio; idempotent, ON CONFLICT DO NOTHING.

### 20. Moved quiz scoring to backend (POST /api/quiz/score)
**Problem**: Archetype was determined in the frontend by `computeArchetype()` — a JavaScript function counting votes locally. Business logic should not live in the browser.  
**Fix**: Added `POST /api/quiz/score` to the backend. Frontend now sends the selected answer UUIDs; backend looks them up in the `answer` table, counts votes per archetype, applies tie-break logic, and returns the winner. The frontend only renders the result — it makes no decisions. `computeArchetype()` was removed entirely.

### 19. Dropped unused legacy tables
**Removed from schema and live DB:**
- `dimension` (UUID-based) — replaced by `coffee_dimensions` (SERIAL, cupping tool). FK references stripped from `archetype_vector`, `archetype_relationship`, `archetype_tunable_variable`, `user_vector_state`, `user_archetype_tuning`, `blend_vector`, `cupping_session_vector`, `quiz_vector` — columns kept, FKs removed.
- `cupping_session`, `cupping_session_note`, `cupping_session_vector` — legacy QC tables replaced by the new cupping tool (`cupping_sessions`, `cupping_session_coffees`, `cupping_scores`, `cupping_score_values`).
- `dimension_scoring_rule` — no longer needed without the `dimension` table.

All dropped via `DROP TABLE ... CASCADE` in Cloud SQL Studio. Removed from `schema.sql` so they won't be recreated on future deploys.

### 18. Refactored cupping scores to normalised dimensions model
**Problem**: `cupping_scores` had 27 hardcoded columns (sweetness_min, sweetness_max, sweetness_notes, etc.) — adding or renaming a dimension required a schema change.  
**Fix**: Replaced with a 3-table normalised design:
- `coffee_dimensions` — 12-row catalogue defining each attribute (name, scale labels, min/max, is_numeric flag)
- `cupping_scores` — slim header row per taster (session_coffee_id, taster_name, is_merged, overall_notes)
- `cupping_score_values` — one row per (score, dimension) with value_min, value_max, notes

Migration is idempotent: a DO block detects the old `sweetness_min` column and drops the table before the new `CREATE TABLE IF NOT EXISTS` runs. Sequence for `coffee_dimensions` reset to 13 after seeding IDs 1–12.

### 17. Added `experimental` to `archetype_enum` and 3 new `archetype` rows
**Change**: Added `experimental` to the `archetype_enum` (the cupping tool enum). Also inserted three new rows into the `archetype` table (UUID-based, used by the quiz): `Floral`, `Earthy`, `Experimental`.  
**How**: `ALTER TYPE archetype_enum ADD VALUE IF NOT EXISTS 'experimental'` — fully idempotent, safe to re-run. `CREATE TYPE` in schema.sql updated to include `experimental` for fresh installs. Archetype rows inserted via Cloud SQL Studio with `ON CONFLICT (name) DO NOTHING`.

### 16. Renamed `archetype` table row 'Fruity & Complex' → 'Fruity'
**Change**: The `archetype` table (UUID-based, used by the quiz) had the row named `'Fruity & Complex'`. Renamed to `'Fruity'` to match the cupping tool's `archetype_enum` and simplify the label.  
**Fix**: Three places updated together to stay in sync:
- `schema.sql` INSERT seed: `'Fruity & Complex'` → `'Fruity'` (for fresh installs)
- `schema.sql` added idempotent `UPDATE archetype SET name = 'Fruity' WHERE name = 'Fruity & Complex'` (runs on startup, no-ops once done)
- `schema.sql` DO $seed$ block: archetype lookup updated to `WHERE name = 'Fruity'`
- `FlavorQuiz.tsx`: `ARCHETYPE_NAME_TO_KEY` and `ARCHETYPES.fruity.name` both updated to `'Fruity'`

### 13. Quiz questions moved from hardcoded frontend to the database
**Problem**: Quiz questions and answers were hardcoded in `FlavorQuiz.tsx`. Changing a question required a code deploy.  
**Fix**: Added idempotent seed data to `schema.sql` (archetypes + quiz v2 + 4 questions + 13 answers). Rewrote `quiz.ts` with a `GET /api/quiz/questions` endpoint that serves the active quiz from the DB. Updated `FlavorQuiz.tsx` to fetch questions from the API on mount, with loading and error states. Scoring now uses `archetype_name` strings from the DB response. Any future question changes only require a DB edit, not a code deploy.

### 24. Roaster contact columns missing from production DB
**Error**: `GET /api/admin/roasters` returned 500 "Failed to fetch roasters" — the Roasteries admin page was completely blank.  
**Cause**: A previous backend deploy added `address`, `email`, `phone`, `contact_person`, `website` to the `SELECT` query and the `schema.sql` migration, but the backend crashed at startup (due to issue #23's `USING` clause bug) before those `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements could run. Cloud Run fell back to the old revision. The new revision's code selected columns that didn't exist in the DB yet.  
**Fix**: Ran the five `ALTER TABLE roaster ADD COLUMN IF NOT EXISTS ...` statements manually in Cloud SQL Studio. Also fixed in `schema.sql` so future deploys add the columns on startup.

### 25. Manual frontend build used wrong Firebase credentials
**Error**: After a manual `npm run build` + Firebase deploy, all users got `auth/api-key-not-valid` on the login page.  
**Cause**: The build command was run with Firebase config values from a previous context summary that contained stale/incorrect project credentials (wrong `MESSAGING_SENDER_ID` and `APP_ID`). Vite bakes env vars into the JS bundle at build time, so the wrong API key was shipped in the deployed assets.  
**Fix**: Rebuilt using the correct credentials from `frontend/.env` (which has the real Firebase web app config) with only `VITE_API_URL` swapped to the production Cloud Run URL. Rule: for manual deploys, always source Firebase vars from `.env`; the CI/CD pipeline reads the correct values from GitHub secrets.

### 26. `ALTER TABLE` blocked by backend connection pool during DB restart
**Error**: `ALTER TABLE cupping_sessions ALTER COLUMN brew_method TYPE TEXT USING brew_method::TEXT` failed with "another role is using the table" even after stopping and starting the Cloud SQL instance.  
**Cause**: The instance stop/start triggered a GCP maintenance update, which extended the restart to ~15 minutes. During this time Cloud SQL Studio showed "There was an error loading your databases" even after the instance showed green — the DB wasn't fully accepting connections yet.  
**Fix**: Waited for the instance to fully come up (maintenance update completed), then ran the `ALTER TABLE` successfully in Cloud SQL Studio.

### 23. `brew_method_enum` caused session creation to silently fail
**Error**: `POST /api/admin/sessions` returned 500 "Failed to create session" for any brew method other than `filter`, `espresso`, `cold_brew`, or `other`.  
**Cause**: `cupping_sessions.brew_method` was typed as `brew_method_enum`. The `lookup_value` table for `brew_method` includes values like `cupping`, `pour-over`, `french-press`, `aeropress` — none of which existed in the enum. Additionally, an empty-string selection slipped past the `?? 'filter'` fallback (because `'' ?? 'filter'` = `''`, not `'filter'`).  
**Fix**: Migrated the column to `TEXT` using an idempotent `DO` block in `schema.sql` that checks `information_schema.columns` for the old enum type before running `ALTER TABLE cupping_sessions ALTER COLUMN brew_method TYPE TEXT`. Also changed the backend fallback from `brew_method ?? null` to `brew_method || null` so empty string correctly maps to `null`. `brew_method_enum` is still defined (for any future use) but no longer applied to the column.

### 29. Browser heuristic caching causing stale admin data
**Problem**: The admin sessions page was showing old data even after the DB was updated, because browsers can heuristically cache `200 OK` responses that have no `Cache-Control` header.  
**Fix**: Three layers applied together:
1. **Backend** — added `Cache-Control: no-store` middleware for all `/api/*` routes in `backend/src/index.ts`
2. **Frontend** — all `fetch()` calls in admin components now use `cache: 'no-store'` via a shared `apiFetch()` helper that also injects the Firebase auth token
3. **Firebase Hosting** — added explicit `no-cache, no-store, must-revalidate` header for `index.html` in `firebase.json`; added `max-age=31536000, immutable` for fingerprinted JS/CSS assets

### 30. Multi-taster support in Score Entry (AdminCupping)
**Problem**: `AdminCupping.tsx` loaded only `data.scores[data.scores.length - 1]` — always the last score row, regardless of how many tasters had entered scores. Camila's scores were the only ones visible.  
**Fix**: Complete rewrite of the component. All scores for the selected session_coffee are fetched and stored in state (`allScores`, `allValues`, `allDescriptors`). A **taster tab bar** renders at the top — one tab per taster name. Clicking a tab populates the form with that taster's values. "+ Add Taster" tab creates a fresh blank form for a new entry. After saving, scores are re-fetched and the saved taster's tab re-activates automatically.

Also fixed: no try-catch around the `Promise.all` loading three parallel API calls — any single 404 left all state as `[]` and the page rendered nothing silently. Now wrapped in try-catch with a visible error banner and reload link.

### 31. Newsletter subscribe endpoint returning 404
**Problem**: `PreLaunch.tsx` POSTed to `/api/newsletter/subscribe` but the newsletter router only had `router.post('/')` — no `/subscribe` subroute. Every pre-launch signup silently failed with a 404.  
**Fix**: Added `router.post('/subscribe', ...)` as the canonical endpoint. The original `router.post('/')` kept as a backward-compat alias (called by `NewsletterModal`). Both share the same `handleSubscribe()` logic.

### 32. Newsletter table name typo
**Problem**: `newsletter.ts` queried table `newsletter_subscribers` (plural) — the actual table is `newsletter_subscriber` (singular). Every insert failed with `relation "newsletter_subscribers" does not exist`.  
**Fix**: Corrected to `newsletter_subscriber` throughout the route handler.

### 33. Pre-launch page + subscriber source tracking
**Change**: Added a full-screen pre-launch curtain page (`PreLaunch.tsx`) that sits at the root URL. Added normalised source tracking so every signup records where it came from.

**`subscriber_source` table** — 4 seeded rows: `pre_launch`, `newsletter`, `post_quiz`, `footer`. The newsletter route looks up the source by name and stores its integer FK in `newsletter_subscriber.source_id`.

**`newsletter_subscriber` columns added** (idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`):
- `first_name TEXT` — collected from the pre-launch form and newsletter modal
- `source_id INT REFERENCES subscriber_source(id)` — which touchpoint captured the signup

**`ON CONFLICT` upsert strategy**: on duplicate email, `subscribed` is reset to `TRUE`; `first_name` is updated only if the new value is non-empty (preserves existing name if not provided); `source_id` is kept from the first signup (not overwritten).

### 34. Quiz V4 — Food instinct signal, 6 questions, weighted scoring, full matching logic
**Change**: Introduced quiz V4 as the active version. V3 deactivated (`is_active = FALSE`). Source files in `misc/v4/`.

Key changes from V3:
- 6 questions (V3 had 5) — added Q2 "Food instinct" (secondary signal) and Q6 "Bitterness tolerance" (new highest-weight question; Q5 in V3 became Q6 in V4)
- Q2 has `weight = 0` — not in `quiz_answer_archetype_score` at all; answer archetype comes from `answer.resulting_archetype_id` and is captured as `food_signal`
- Q4 gains experimental gate (was Q3-C in V3)
- Q4-D split: +0.5 to Chocolate & Nutty AND +0.5 to Balanced & Sweet (two rows in `quiz_answer_archetype_score`, `resulting_archetype_id = NULL`)
- Veto cascade corrected to Q6 → Q5 → Q3 → Q1 (was Q5 → Q4 → Q2 → Q1 in V3)
- `POST /api/quiz/score` now returns `secondaryArchetype`, `foodSignal`, `confidence`, `recommendationMode` in addition to the existing fields
- `POST /api/quiz/results` saves all new fields to `quiz_session.context_data`
- `getRecommendation()` (claude.ts) updated with 6 mode-specific prompts driven by `recommendationMode`

### 35. Food signal × secondary archetype matching logic
**Change**: Defined and implemented a 4-scenario × 2-modifier decision matrix that uses the Q2 food instinct answer to determine how confident the classification is and what kind of recommendation to generate.

Scenarios: food matches primary (high confidence) / food matches secondary (medium, introduce secondary) / food matches neither (low, route to AI) / food matches primary with a close secondary (medium, note secondary for future).

Close secondary threshold — **Option B**: secondary is meaningful only if it scored on Q5 or Q6 (the two highest-weight questions). Low-weight signals (Q1, Q4) don't qualify.

Experimental modifier: if `experimental = true AND food == secondary` → strongest signal, actively push discovery coffee. If `experimental = true AND food == primary` → curious person firmly rooted, frame primary as a starting point.

Logic documented in `misc/v4/logic_notes.csv` (13 rules).

### 44. Our Coffees page — full redesign
**Change**: Rebuilt the `/coffees` page around three content layers with an editorial philosophy: answer "should I order this coffee?" rather than presenting a data spec sheet.

**Content layer 1 — AI editorial content (all users, cached)**

Three new AI-generated fields per coffee, generated once and cached in `coffees` table. All generated in parallel via Claude haiku on first page load; never regenerated on visitor traffic.

- `surprise_note TEXT` — 1–2 sentences surfacing what's unexpected or contradictory about this specific coffee. Distinct from a tasting note — it's a hook.
- `three_voice_story TEXT` — 2–4 sentence editorial paragraph narrating where the three descriptor sources (internal cupping, roaster bag notes, customer feedback) agree and diverge. Only generated if ≥ 2 sources have data.
- `ai_summary TEXT` — already existed; now generated alongside the other two.

Frontend fetches all three via new `GET /api/coffees/:id/content` endpoint (fast DB hit if cached; generates in parallel on first call). After SQL persist, backend writes `{ aiSummary, surpriseNote, threeVoiceNarrative, generatedAt }` to Firestore `coffees/{id}` — non-blocking, Cloud SQL is the source of truth.

New admin endpoint `POST /api/admin/coffees/:id/refresh-content` force-regenerates all three. Admin → Coffees button updated from "↺ Refresh" (summary only) to "↺ Refresh content" (all three).

**Content layer 2 — Personalization (logged-in users with an archetype)**

Pure frontend logic. User archetype fetched once via `GET /api/users/profile` on mount.

- **Compatibility badge**: three tiers — "In your wheelhouse" (exact match, filled rust), "Worth exploring" (adjacent archetype, amber outlined), "Outside your comfort zone" (no match, grey outlined + explanatory note). Adjacency is hardcoded per archetype (e.g. Balanced & Sweet ↔ Chocolate & Nutty, Fruity ↔ Floral).
- **Dimension comparison text**: compares the coffee's actual avg cupping scores against hardcoded typical ranges per archetype. Finds the 1–2 most divergent key dimensions (Sweetness, Acidity, Bitterness, Body) and expresses them in relative language ("significantly more acidity and slightly less body than your usual Fruity profile"). Only shown when divergence ≥ 1.5 pts from typical mid.

**Content layer 3 — Interactive data (all users)**

- Dimension bars and bubble cloud kept from the prior implementation — logic unchanged, integrated into the new layout.
- **Compare mode**: "⇄ Compare" toggle in the coffee header opens a dropdown to select a second coffee. In compare mode: side-by-side header with names + badges, stacked dimension bars per dimension (rust = primary, sage = compare, amber = divergent > 3 pts), side-by-side bubble clouds. Editorial content (surprise note, three-voice story, AI note) is hidden in compare mode to keep it scannable.

**Layout order** (single coffee, top to bottom): coffee header + ⇄ toggle → compatibility badge + comparison text (auth only) → surprise angle (italic pull-quote) → three-voice story → collapsible AI note → dimension bars → bubble cloud.

**Schema**: `ALTER TABLE coffees ADD COLUMN IF NOT EXISTS surprise_note TEXT` and `three_voice_story TEXT` — both idempotent, run on backend startup.

### 43. Find My Flavor page — returning user split-screen layout
**Change**: Redesigned the returning user screen (State 1) into a two-column layout.

- **Left panel**: Background photo with a dark overlay. "Welcome back, {firstName}" at the bottom, followed by the four row-link options (Retake quiz / Sommelier / Profile / Coffees) as white text over the image.
- **Right panel**: Clean cream panel. Small "Your coffee profile" label → "Your primary profile is" sentence → archetype name large in its brand color → archetype description → "Last quiz taken: [date]" below a separator line.

The quiz date comes from `lastQuizDate` — added to `GET /api/users/profile` response (`users.ts`). The field was already being queried from `quiz_session.completed_at`; it just wasn't being returned.

### 42. Find My Flavor page — auth-aware states
**Change**: `FlavorQuiz.tsx` now fetches `GET /api/users/profile` on mount when a user is signed in, and renders one of four states:

1. **Returning user (signed in + has archetype)**: personalised landing screen — split-screen with options on the left and archetype profile card on the right.
2. **Signed in, no archetype**: name screen skipped; `firstName` pre-filled from DB; quiz starts automatically.
3. **Guest**: original name screen + "Already have a profile? Sign in →" link added below Begin Profile button.
4. **Quiz in progress / results**: unchanged.

### 41. Profile page — user data collection (name, birthday, address)
**Change**: Extended the sign-up and profile flows to collect and persist real user data.

**Sign-up (`SignIn.tsx`)**: "Create Profile" tab now shows First name + Last name fields above email. Names are passed to `signUp()` → `AuthContext.syncUser()` → `POST /api/auth/sync` → `user_profile.first_name / last_name`. The Sign In tab is unchanged. Names are optional — sign-up still works without them.

**Schema additions** (idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`):
- `user_profile.first_name TEXT`
- `user_profile.last_name TEXT`
- `user_profile.date_of_birth DATE`

**`POST /api/auth/sync`**: now accepts `{ firstName, lastName }` in the request body. Uses `COALESCE` so subsequent sign-ins never overwrite an existing name with null.

**Profile Settings tab** (rebuilt):
- Editable first/last name + read-only email + optional birthday (labeled "for exclusive promos"). Saves via `PATCH /api/users/profile`.
- Shipping address section — lists saved addresses, Remove button per address, "+ Add Address" form (street, city, state, ZIP). First address auto-set as default. `POST /api/users/addresses` → `address` table. Ready for checkout when Shopify is wired.
- Sign Out button moved to bottom of Settings.

**Welcome header**: now shows `"Welcome back, {first_name}"` using the name from the DB, falling back to `displayName` then email.

**Birthday decision**: collected on the profile page (not at sign-up) to keep registration friction low. Users opt in at their own pace.

**Address types**: Profile Settings has two separate sections — Shipping Addresses and Billing Addresses. Each section has its own "+ Add" button; `addressType` is passed to `POST /api/users/addresses`. First address of each type auto-becomes default on creation.

**Default address UX**: Each address card shows a **"Use as default"** button (hidden on the current default) which calls `PATCH /api/users/addresses/:id/default` — unsets all others of the same type before setting the target. The current default card shows **"✓ Default shipping/billing address"** in brand red with a solid border so it's visually distinct at a glance.

**"Same as shipping address" checkbox**: Billing address form shows a checkbox when a default shipping address exists. Checking it auto-fills all fields from the default shipping address and makes them read-only. Unchecking clears the form for a different billing address to be entered.

### 39. AI tasting notes billed per visitor — cached in DB
**Problem**: `GET /api/coffees/:id/ai-summary` called Claude haiku on every page load. Every visitor triggered a billable Claude API call, once per coffee they viewed.
**Fix**: Added `ai_summary TEXT` column to `coffees` table (idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). Endpoint now checks the DB first — if populated, returns immediately with no Claude call. On first request (null), generates, stores, and returns. Admins can force-regenerate via `POST /api/admin/coffees/:id/refresh-summary` after new cupping data is added; "↺ Refresh" button added to Admin → Coffees.
**Why:** You are the account holder billed for all Claude API usage. Visitor-triggered generation is unbounded and unpredictable.

### 38. Dimension bars not showing for some coffees
**Problem**: `GET /api/coffees/:id/dimensions` returned 0 rows for Noam Blend and Nocturnal despite cupping score data existing in the DB. Crosshatch/Ethiopia/Feather showed bars correctly.
**Cause**: The query had `AND cs.is_merged = true`. Session 001 coffees have a merged score row; Noam Blend and Nocturnal were scored without the merge flag set. The filter silently excluded all their data.
**Fix**: Removed `AND cs.is_merged = true` from all three dimensions-related queries in `coffees.ts` and the ai-summary endpoint. All cupping scores are now included and averaged regardless of merge status.

### 40. Quiz scoring logic extracted + 31 unit tests
**Change**: The pure scoring logic from `POST /api/quiz/score` was extracted into `backend/src/services/quizScoring.ts` (no DB, no Express dependencies) so it can be tested independently. The route handler now imports and calls these functions instead of having logic inline.

**Functions extracted:**
- `rankScores(scores)` — sort archetypes by total score descending
- `findWinner(ranked, byQ)` — veto cascade (Q6 → Q5 → Q3 → Q1, fallback: Balanced & Sweet)
- `findSecondary(ranked, winner)` — second highest scoring archetype
- `isSecondaryClose(byQ, secondary)` — Option B: secondary scored on Q5 or Q6
- `computeConfidenceAndMode(foodSignal, winner, secondary, experimental, secondaryClose)` — all 4 scenarios + 2 experimental modifiers

**Test file**: `backend/src/services/quizScoring.test.ts` — 31 tests covering:
- Clear winner (no cascade)
- Veto cascade: Q6, Q5, Q3, Q1 resolution in order
- Cascade exhausted → Balanced & Sweet fallback
- Q4 and Q2 correctly excluded from cascade
- Three-way tie
- Secondary archetype determination
- Option B close threshold (Q5/Q6 vs low-weight questions)
- All 4 food signal confidence scenarios
- Both experimental modifiers
- Experimental overrides Scenario 4
- Null food signal defaults
- Secondary = null edge case

**Test runner**: Vitest (added to devDependencies — better ESM support than Jest for this project). Run with `npm test` from `backend/`.

### 37. Public `/coffees` page — flavor intelligence for customers
**Change**: Added a new public page at `/coffees` (`CoffeesPage.tsx`) backed by three new public endpoints. Replaces the admin-only flavor wheel as the customer-facing view. Features: coffee selector sidebar, AI tasting note (DB-cached), dimension bars (range bars on 0–15 scale), bubble cloud (descriptors as growing circles sized by √mentions). "Our coffees" added to main nav.

### 36. `v_quiz_scoring_matrix` view expanded and fixed
**Change**: View updated to include `quiz_version` (from `quiz` table), `a_number` (generated via `ROW_NUMBER() OVER (PARTITION BY q.id ORDER BY a.id)`), `q_weight`, and `ans_weight`. Column order changed.

**Fix**: `CREATE OR REPLACE VIEW` in PostgreSQL cannot rename or reorder existing columns — only append. Switched to `DROP VIEW IF EXISTS` + `CREATE VIEW` (same fix as `v_collaborative_flavor_wheel`). Seeded `misc/v4/` files committed to repo.

### 28. Quiz V3 — Perfect cup theme + experimental gate
**Change**: Introduced quiz V3 as the active version. V2 is deactivated (`is_active = FALSE`). Key changes:
- Q2 completely replaced: "Food instinct" (food choices) → "Perfect cup" (coffee experience descriptions)
- Q3-C gains `is_experimental_gate = TRUE` flag — scoring backend returns `experimental: true` when selected; stored in `quiz_session.context_data`; recommendation engine should add a discovery coffee to the result
- Q3-D scoring changed: was neutral (no row) in V2 → +0.5 Chocolate & Nutty in a mid-session fix → now correctly splits +0.5 CN + +0.5 BS (two rows in `quiz_answer_archetype_score` for the same answer)
- Q4 answer texts updated: "Feels too thin/watery" → "It has no bitterness or intensity"; "Feels too heavy or strong" → "It's too bitter or too intense"
- Q5-B and Q5-C updated to softer, more evocative language
- `answer` table gained `is_experimental_gate BOOLEAN DEFAULT FALSE` column (idempotent ALTER TABLE)
- Source file: `backend/src/quizes/Coffee_Quiz_Scoring_v3.xlsx` (committed to repo)

### 27. Tie-break was a static priority list, not spec-compliant
**Problem**: `POST /api/quiz/score` resolved ties with a hardcoded order (Balanced & Sweet > Chocolate & Nutty > Fruity) regardless of the user's actual answers. This meant two users with identical scores but different answers would always get the same archetype — wrong by design.  
**Fix**: Replaced with a veto cascade: Q5 → Q4 → Q2 → Q1. For each question in that order, if the user's answer pointed to one of the tied archetypes, that archetype wins. Q3 is intentionally excluded (contributes to raw score only). Fallback: Balanced & Sweet. A second DB query fetches the `q_number → archetype` mapping from `quiz_answer_archetype_score` only when a tie is detected — no extra cost on the happy path.

Also fixed: Q3-D ("I'm not sure. I don't usually drink it black.") was previously neutral (no row in `quiz_answer_archetype_score`). Now correctly awards +1 to Chocolate & Nutty per the scoring spec. Added to the schema.sql seed (idempotent — `ON CONFLICT DO NOTHING`).

### 48. Sommelier "Talk to Liam" entry points broken (2026-06-28)
**Problems (three separate bugs):**
1. `FlavorQuiz.tsx` quiz result screen "Talk to our coffee sommelier" had `href: '/'` — went to the home page instead of the sommelier.
2. `App.tsx` wrapped the `/sommelier` route with `<RequireAuth redirectTo="/sign-in?redirect=/sommelier">` — this hard-coded redirect dropped the `?entry=` and `?tied=` query params, so the sommelier loaded without its trigger context.
3. `Sommelier.tsx` showed chat bubbles instead of the designed prose thread layout (LIAM/YOU label-above-text, full-width, no backgrounds).

**Fixes:**
- `FlavorQuiz.tsx` line 727: `href: '/'` → `href: '/sommelier?entry=user_initiated'`
- `App.tsx`: removed `redirectTo` prop entirely — `RequireAuth` auto-builds the full redirect URL from `location.pathname + location.search`, so all query params are preserved through the sign-in flow
- `Sommelier.tsx` messages section: replaced flex bubble layout with name-label + full-width text layout (`space-y-10`, `LIAM` rust / `YOU` muted stone labels, no backgrounds or borders, loading dots under LIAM label)

### 49. Sommelier `evaluate:500` — invalid Firestore document path (2026-06-28)
**Error (from Cloud Run logs):** `Error: Value for argument "documentPath" must point to a document, but was "users/{uid}/confidence_profile". Your path does not contain an even number of components.`

**Cause:** `firestoreDb.doc("users/{uid}/confidence_profile")` has 3 path segments. Firestore's `.doc()` requires an even number of segments (collection/document pairs). The exception is thrown synchronously — before the `.catch()` ever runs — so it escapes `computeBehavioralConfidence()` and propagates to the `/evaluate` endpoint's outer try/catch → 500.

**Fix:** Changed the path to `users/${uid}/metadata/confidence_profile` (4 segments, valid) in all three files that reference it:
- `backend/src/services/behavioralConfidence.ts` — write, wrapped `.doc()` call in try/catch as additional guard
- `backend/src/services/sommelierEvaluator.ts` — read
- `backend/src/services/liamSmsFeedback.ts` — write (already had try/catch around the `.set()`)

**Note:** `SOMMELIER_BUILT.md` Firestore collections table also updated to reflect the correct path.

### 50. Sommelier `evaluate:500` — wrong SQL table name in `sommelierEvaluator.ts` (2026-06-28)
**Cause:** `evaluateSommelier()` had `SELECT COUNT(*) AS order_count FROM orders WHERE uid = $1`. The table is `"order"` (double-quoted PostgreSQL reserved keyword), not `orders`. Also the `"order"` table has no `uid` column — it joins through `user_profile`. This threw "relation 'orders' does not exist" on every evaluate call.

**Fix:** Replaced with the correct join query:
```sql
SELECT COUNT(DISTINCT o.id) AS order_count
FROM "order" o
JOIN user_profile up ON up.id = o.user_id
WHERE up.firebase_uid = $1
```

Also wrapped all SQL queries in `computeBehavioralConfidence()` and `evaluateSommelier()` in individual try/catch blocks (defaulting to 0 counts on failure) to prevent any single SQL error from crashing the entire evaluate call.

### 51. Sommelier `start:500` — ambiguous SQL operator in `spendToken` (2026-06-28)
**Error (from Cloud Run logs):** `operator is not unique: - unknown` / `hint: Could not choose a best candidate operator. You might need to add explicit type casts.` / PostgreSQL error code `42725`.

**Cause:** `tokenService.ts` `spendToken()` had `SELECT $1, -$2, $3, $4, balance FROM user_tokens WHERE uid = $1`. PostgreSQL cannot determine the type of `$2` from context in a bare SELECT list — the unary `-` operator is then ambiguous between `-integer`, `-numeric`, `-float`, etc.

**Fix:** Pass the negative value from JavaScript instead of negating in SQL:
```javascript
// Before (ambiguous):
[uid, costPerTurn, reason, referenceId]   // SQL: -$2
// After (unambiguous):
[uid, -costPerTurn, reason, referenceId]  // SQL: $2
```

### 52. Firestore composite index needed for `checkReturnedToSommelier` (2026-06-28, outstanding)
**Not causing a 500** — the error is caught inside `checkReturnedToSommelier` and logged. But the query silently fails on every session start.

**Query:** `users/{uid}/sommelier_evaluations` collection, `.where('sessionStarted', '==', true).orderBy('startedAt', 'desc')` — Firestore requires a composite index for `where` + `orderBy` on different fields.

**Fix:** Create the index in Firebase Console using the link from the Cloud Run logs:
```
Firebase Console → Firestore → Indexes → Create composite index
Collection: sommelier_evaluations
Fields: sessionStarted ASC, startedAt DESC
```
Or click the auto-generated link from the Cloud Run error log directly.

### 62. Task 6 — Liam voice reset (2026-07-04)
Full execution of `SOMMELIER_TASK_6_VOICE.md`. Three files changed, Firestore live config patched.

- **`claude.ts`**: `LIAM_BASE_PROMPT` replaced with full brand-aligned voice spec — character definition, sensory vs technical language examples, confidence vs hedged examples, generational register guide (Gen Z/Millennial/Gen X/Boomer), questions as optional, history as internal context only.
- **`sommelier.ts`**: `getGeneration()` helper added. `date_of_birth` added to quiz query. `enrichedOpeningContext` appended with customer generation before every session start. Default register is Millennial when no DOB.
- **`sommelier_config_seed.ts`**: All 6 intent `systemPromptAddendum` values rewritten — removed WHY questions, lecture framing, and urgency language from every intent.
- **Firestore patched live**: `backend/scripts/update-intent-addendums.mjs` ran directly against `config/sommelier` so the runtime config matches the seed immediately without waiting for a fresh install.

### 61. Liam prompt — ban history-narration, tighten opening template (2026-07-04)
Triggered by: Liam opened with *"You've been moving around quite a bit — what's shifted for you since the last time?"* — narrating the customer's history back at them and asking a WHY question.

Changes to `LIAM_BASE_PROMPT` in `backend/src/services/claude.ts`:
- **Extended never-say list**: added "What's shifted for you", "What changed since last time", "Why the change", and all patterns that ask the customer to account for their own history.
- **New "history is internal context only" rule**: Liam uses past data to inform recommendations silently. He never recites the customer's journey back at them ("you've been moving around", "you've tried a lot of directions") — that reads as analytical and judgmental, not helpful.
- **Opening turn now has Good/Bad examples**: concrete examples are more reliable than abstract rules. The exact bad line from the live session was added as a "Bad:" example so the model pattern-matches against it.

### 60. Liam — demographic tone calibration, brand values, register mirroring (2026-06-28)
Two files changed to make Liam speak to the person in front of him, not a generic user.

**`backend/src/services/sommelierEvaluator.ts`** — new demographic query in Stage 1:
- Fetches `date_of_birth` and `household_id` + household member count from `user_profile`.
- Computes age and generation (Gen Z / Millennial / Gen X / Boomer) and household type (solo vs family).
- Passes demographic facts and a tone calibration guide into the Haiku Stage 2 briefing prompt.
- The briefing Haiku now writes ends with a tone note: e.g. *"Tone: direct, no-nonsense — Gen X."*

**`backend/src/services/claude.ts`** — `LIAM_BASE_PROMPT` rewritten:
- **Brand values** added explicitly: Guide Don't Educate, Remember Never Reset, Clarity Over Complexity, Calm is a Feature, Customer Directed System Guided.
- **Tone is serious by default** — "composed, not warm-and-fuzzy."
- **Register mirroring**: Liam adapts to how the customer writes within one turn. Brief → brief. Formal → formal.
- **Generation tone guide** in the prompt: Gen Z informal OK; Millennial conversational/no hype; Gen X direct/earned; Boomer formal/respectful.
- **Questions are optional**: end with a question only when it moves things forward. A statement or recommendation is often the right move.
- WHY ban retained and strengthened from issue 59.

### 59. Liam prompt — ban motivation questions, explicit opening rule (2026-06-28)
Opening messages like "What's drawing you toward earthy now — did something click?" were off-brand: they ask WHY instead of WHAT and use poetic language that feels presumptuous.

Added to `LIAM_BASE_PROMPT` in `backend/src/services/claude.ts`:
- **Never-say list**: explicitly bans "What's drawing you toward X", "Did something click", "What stuck with you", and any question asking WHY the customer wants something.
- **Direction questions instead**: Liam now asks about concrete next step — "Do you want to stay with X or try something different?" — answerable in one word.
- **Opening-turn rule**: max 2 sentences, acknowledge what's known, ask one direction question. Pinned example: *"You've been in the earthy range. Want to stay there or try something different?"*

### 58. Sommelier UI fixes (2026-06-28)
Three fixes applied after the redesign deployed:

1. **Nav bar overlap** — the fixed nav (`position: fixed, top: 0, height: 64px`) was sitting on top of the Liam sidebar. Changed the Sommelier container from `height: calc(100vh-64px)` to `position: fixed, top: 64px, left: 0, right: 0, bottom: 0` — now anchors exactly below the nav.
2. **Title** — "Sommelier Concierge" corrected to "Coffee Sommelier" in the sidebar.
3. **Scroll jump on send** — `scrollIntoView()` was scrolling the whole page on every message. Replaced with a ref on the inner `overflow-y-auto` container and `scrollTop = scrollHeight` — scroll now stays within the messages pane.
4. **Buy tokens link** — added to the sidebar bottom section (below token count), in rust with underline. Routes to `/shop` when `purchaseEnabled` is true in Firestore config; shows "coming soon" alert until Stripe is wired.

### 57. Find My Flavor — nav bar restored (2026-06-28)
`/find-my-flavor` was suppressing the nav and footer via `PublicLayout`'s `isQuizPage` check. Removed that suppression — the quiz now shows the navigation bar. Footer remains suppressed (the quiz handles its own bottom content). `PublicLayout` now only bypasses nav/footer for the pre-launch page.

### 56. Sommelier page redesign — full-screen Claude/ChatGPT-style layout (2026-06-28)
Rebuilt the `/sommelier` route as a dedicated full-screen app experience. `PublicLayout` now suppresses nav/footer/newsletter modal for `/sommelier` (same as `/find-my-flavor`).

**What changed:**
- Full-screen `fixed inset-0` layout — no height caps, no nav bar
- Left sidebar (224px): "Axis & Bloom / Liam / Sommelier Concierge" header, past sessions list, "+ New conversation", token balance at bottom
- Mobile: hamburger → animated spring drawer sidebar
- Coffee names moved from header pill strip → subtle dotted line above the first message in the thread
- Integrated input bar: `rounded-2xl`, up-arrow send button, turns + tokens shown below the textarea
- Message thread unchanged: prose style, `LIAM`/`YOU` labels, `space-y-10`, no bubbles

### 55. Liam prompt rewrite — brand-aligned voice (2026-06-27)
Rewrote `LIAM_BASE_PROMPT` in `backend/src/services/claude.ts` based on the Axis & Bloom Brand Strategy & Visual Foundations Brief.

**Problems with the old prompt**: "warm, precise, and genuinely curious" produced a formal sommelier tone disconnected from the brand. 180-word limit produced wall-of-text responses. No instruction to use what the system already knows about the customer. Language like "palate", "flavor notes", "what flavor stuck with you" violated *Guide, Don't Educate*.

**What changed**:
- Liam is now "part of the Axis & Bloom team" — not "Coffee Sommelier". Removes the formal register.
- Explicit instruction: "Every customer has a taste profile. Use it. Never treat someone like a blank slate." — implements *Remember, Never Reset*.
- Voice rules: calm, direct, unhurried; 80 words max; plain language; one question per turn.
- Banned vocabulary in questions directed at the customer: palate, mouthfeel, terroir, flavor notes. Customer-facing questions must use plain English ("heavier or lighter", "does that sound right").
- "The customer sets the pace. Follow their lead." — implements *Customer Directed, System Guided*.
- "Quiet confidence — don't push, don't oversell." — implements *Calm is a Feature*.
- `max_tokens` also reduced from 400 → 200 at the API level to enforce brevity.

### 54. Conversation messages moved from Cloud SQL to Firestore (2026-06-27)
`sommelier_messages` SQL table is now legacy — no longer written to. All new conversation turns write to Firestore `users/{uid}/sommelier_sessions/{sessionId}/messages/{auto-id}`.

**Why**: Conversation turns are documents, not relational data. No cross-table joins; always fetched as an ordered list for one session.

**Ordering**: A `seq` integer field is written with each message (opening = 0, user messages = `turn_count * 2 - 1`, assistant replies = `turn_count * 2`). History queries use `.orderBy('seq')`.

**Backwards compat**: `GET /api/sommelier/:id/messages` falls back to the SQL table for sessions created before this change. `sommelier_messages` table kept but not written to.

**What stayed in PostgreSQL**: `sommelier_sessions` — has relational ties to `token_events`, turn count state machine, `is_closed` flag, and `context_data` JSONB for RAG catalog.

### 53. Sommelier session resume loaded blank chat (fixed 2026-06-27)
Clicking "Resume conversation" after leaving and returning to `/sommelier` showed an empty chat — no previous messages were loaded.

**Cause**: `handleResumeResume()` in `Sommelier.tsx` set the session ID and turn count but never fetched the prior message history. It showed only a synthetic "Welcome back" placeholder.

**Fix (two parts)**:
1. New `GET /api/sommelier/:sessionId/messages` backend endpoint — returns `{ messages: [{role, content}], coffeeNames: [] }`. Reads from Firestore (with SQL fallback for pre-migration sessions).
2. `handleResumeResume()` now calls this endpoint, restores the full message thread and coffee strip, then enters chat phase. Falls back to the "Welcome back" synthetic message only if history is empty.

### 47. Family Bundle — household invitations and shared delivery
**Change**: Added a full-stack Family Bundle feature allowing users to group into households for a shared delivery where each member gets coffee matched to their own palate.

**Backend** (`backend/src/routes/household.ts`):
- 8 endpoints on `/api/household`: `create`, `mine`, `invite`, `leave`, `members/:userId`, `invite/:token` (public), `join/:token`, `invitations/:invitationId`
- `household_invitation` table: UUID PK, `token` (32-byte hex, `UNIQUE`), `invited_email`, `invited_by_id`, `status` (`pending`/`accepted`/`cancelled`), 7-day `expires_at`; `ON DELETE CASCADE` from household
- Invite email via Resend — same branded HTML style as password reset, from `noreply@axisandbloomcoffee.com`
- Leave logic: admin with other members blocked; admin as sole member dissolves household (clears `user_profile.household_id` first to avoid FK violation, then `DELETE FROM household` which cascades to invitations)
- Join logic: `FOR UPDATE` lock on invitation row to prevent race conditions; email must match invited_email

**Frontend**:
- `FamilyTab.tsx` — three states: loading, no household (create form), in household (member list + pending invites + invite form + leave/dissolve button)
- `JoinHousehold.tsx` — public split-screen page at `/join-household?token=...`; fetches invite info before auth; if signed in with matching email → join button; if wrong account → "sign in with right account" link; if not signed in → sign-in link with `?redirect=` param
- `Profile.tsx` — added `'family'` to Tab type + tab array; renders `<FamilyTab />` in AnimatePresence
- `SignIn.tsx` — all 3 auth handlers (`handleSubmit`, `handleGoogle`, `handleApple`) now read `searchParams.get('redirect') ?? '/profile'` and navigate to it post-auth
- `App.tsx` — added `/join-household` route inside `PublicLayout`

### 11. Password reset emails going to spam
**Cause**: Firebase sends from `noreply@axis-and-bloom-prod.firebaseapp.com` — unknown domain, no SPF/DKIM for axisandbloomcoffee.com  
**Fix**: Replaced Firebase's `sendPasswordResetEmail()` with a backend route (`POST /api/auth/reset-password`) that uses `admin.auth().generatePasswordResetLink()` + Resend SDK to send from `noreply@axisandbloomcoffee.com` with proper DKIM/SPF. Added DNS records in Namecheap.

---

## Transactional Email (Resend)

Auth emails (password reset, future: order confirmations, welcome emails) are sent via **Resend** from `noreply@axisandbloomcoffee.com` instead of Firebase's default `noreply@axis-and-bloom-prod.firebaseapp.com`. This prevents spam-folder placement.

| Field | Value |
|---|---|
| Service | [Resend](https://resend.com) |
| Sending domain | `axisandbloomcoffee.com` |
| From address | `noreply@axisandbloomcoffee.com` |
| Secret name | `RESEND_API_KEY` (in GCP Secret Manager) |
| Domain registrar | **Namecheap** |

### DNS records added to Namecheap (Advanced DNS)

| Type | Host | Value |
|---|---|---|
| TXT | `resend._domainkey` | DKIM key provided by Resend dashboard |
| TXT | `@` | `v=spf1 include:amazonses.com ~all` (merge with any existing SPF) |

> DNS changes propagate in minutes on Namecheap but can take up to 24 h. Resend dashboard shows a green ✅ when verified.

### How auth emails work (password reset flow)

The frontend no longer calls Firebase's `sendPasswordResetEmail()` directly. Instead:

1. Frontend POSTs `{ email }` to `POST /api/auth/reset-password`
2. Backend calls `admin.auth().generatePasswordResetLink(email)` — Firebase generates the secure reset URL
3. Backend sends a branded HTML email via Resend SDK with the link embedded
4. User clicks the link → handled by Firebase Auth (same security, custom delivery)

This keeps Firebase's secure token generation while giving us full control over deliverability and branding.

---

## Pre-Launch Page

The site shows a full-screen pre-launch curtain at `axisandbloomcoffee.com/` while `VITE_PRELAUNCH_MODE=true` in the CI/CD pipeline. All other routes (`/about`, `/shop`, `/admin`, etc.) remain fully accessible.

**File**: `frontend/src/app/components/PreLaunch.tsx`

### Layout
Split-screen, responsive:
- **Left half** (`#f2f1ea`): `LogoLines.svg` centered, 480px wide (scales to `min(480px, 85vw)`)
- **Dividing line**: `1px solid #a3372620`
- **Right half** (`#deded1`): centered column — tagline → thin separator → first name input → email input → JOIN → button

On mobile (< 768px) stacks vertically: logo panel takes 45vh, content panel takes 55vh.

### How it works
- Form POSTs `{ email, firstName, source: 'pre_launch' }` to `POST /api/newsletter/subscribe`
- On success, renders "You're on the list." in place of the form
- Errors fail silently — the success message still shows (UX: don't alarm the user)

### Team bypass
Visit `axisandbloomcoffee.com/?preview=true` to skip the curtain and see the full site. Stored in `sessionStorage` — resets when you close the browser.

Implemented in `frontend/src/app/App.tsx` via a `HomeOrPrelaunch` component that reads `useSearchParams` and `sessionStorage`.

### To turn off pre-launch when you're ready to launch
1. Open `.github/workflows/deploy.yml`
2. Remove or change to `false`: `VITE_PRELAUNCH_MODE: 'true'`
3. Push to `main` — deploys automatically

---

## Current State (as of 2026-06-27)

| Component | Status |
|---|---|
| Frontend deployed | ✅ https://axisandbloomcoffee.com (custom domain) / https://axis-and-bloom-prod.web.app |
| Backend deployed | ✅ https://axis-bloom-backend-oiub7eumya-uc.a.run.app |
| Database connected | ✅ 48 tables verified via /health/db |
| Email/password auth | ✅ Working |
| Google sign-in | ✅ Working (was already enabled) |
| Apple sign-in | ⚠️ Not configured |
| Flavor quiz (V7) | ✅ Active — V7 replaces V4; 5 scored questions + 1 food signal (Q6, weight 0), reordered from V4, experimental gate on Q3-C, 5 archetypes (Chocolate & Nutty, Balanced & Sweet, Fruity, Floral, Earthy); branch question after scoring reclassifies Fruity→Floral or CN→Earthy if user selects answer B |
| Quiz matching logic | ✅ Food signal (Q6) drives confidence (high/medium/low) and recommendation mode; Option B close threshold (secondary scored on Q5 or Q4); veto cascade Q5→Q4→Q2→Q1; `POST /api/quiz/score` returns full scoring context; `GET /api/quiz/branch` returns optional reclassification question |
| Transactional email | ✅ Resend — sends from noreply@axisandbloomcoffee.com |
| Marketing email / Mailchimp | ✅ Active — new signups synced to Mailchimp audience with FNAME merge field; credentials in Secret Manager; API key trimmed in code to guard against whitespace |
| Claude AI chat | ✅ Wired up, API key in Secret Manager |
| Claude recommendations | ✅ 6 mode-specific prompts in `getRecommendation()` — primary_only, primary_plus_introduce_secondary, primary_plus_active_secondary, primary_plus_note_secondary, primary_as_starting_point, ai_agent |
| Liam voice | ✅ Brand-aligned prompt rewrite (2026-06-27) — calm, plain language, 80-word max, no sommelier vocabulary. Based on Brand Strategy & Visual Foundations Brief. |
| The Axis page (`/the-axis`) | ✅ Full rebuild from `axis v2.docx` — "Black Box Transparency" strategy. Fully static, no API calls. Hero + 5 sections: The Problem (origin-vs-profile split visual + pull quote), The Inputs (quiz/coffee input cards + 5 archetype cards with mini radar shapes + unlabeled concept parallel coordinates), The Engine (distance plot + 3-point explainer + subscription callout), The Feedback Loop (3 feedback bullets + circular loop diagram + editorial callout), CTA → `/find-my-flavor`. No calibration data exposed. |
| Our Coffees page (`/coffees`) | ✅ Redesigned — three content layers: (1) AI editorial content (surprise angle, three-voice story, collapsible AI note — all cached in SQL + Firestore); (2) personalization layer for logged-in users (compatibility badge + dimension comparison text); (3) data layer (dimension bars + bubble cloud). Compare mode: ⇄ toggle shows two coffees side-by-side with dimension diff bars. |
| Shopify | ⚠️ Stubbed — waiting for roastery account |
| Pre-launch page | ✅ Live — full-screen curtain at axisandbloomcoffee.com; email + first name capture saves to DB + Mailchimp; bypass via `?preview=true` |
| Newsletter subscriber tracking | ✅ `subscriber_source` table tracks signup origin (`pre_launch`, `newsletter`, `post_quiz`, `footer`); `first_name` stored |
| Homepage editorial redesign | ✅ 9 sections: full-screen video hero, concept band, how it works grid, profile entry form (CoffeePic16 bg), flavor map, cinematic video, coffee bag collection, Human+AI terracotta band, TasteFinderSection curtain |
| About page editorial redesign | ✅ 7 sections: FamilyEdit.jpg hero, brand story, Axis/Bloom name blocks, founders' note, video section, archetype bridge, final CTA — full editorial tone, cinematic layout |
| TasteFinderSection | ✅ Vertical curtain lift (translateY 0→-100%); editorial stripe preserved; revealed layer shows TransparentBag03 + right-aligned quiz copy |
| Design system | ✅ Genova font site-wide — 3 weights only: 100 Thin, 400 Regular, 900 Black; no italic; 12 brand color tokens in `theme.css` @theme block |
| Frontend performance | ✅ `inlineRasterImages` Vite plugin removed — images now served as separate files; page load reduced from 10–15s to ~1–2s |
| Cupping tool schema | ✅ 11 tables + 3 enums + 12 seeded dimensions + 84 SCA flavor wheel descriptors + collaborative flavor wheel view |
| Admin portal | ✅ 6 pages: Dashboard, Coffees (roaster autocomplete dropdown), Sessions (roastery dropdown), Score Entry (multi-taster tabs + read-only/edit), Flavor Wheel (+ stats), Roasteries (inline edit + all contact fields) |
| Admin user management | ✅ `grant_admin()` / `revoke_admin()` / `list_admins()` stored DB functions + matching API endpoints |
| Lookup values | ✅ `lookup_value` table — 20 values across 4 categories; single `GET /api/admin/lookups` call populates all admin dropdowns |
| Quiz scoring unit tests | ✅ 31 tests in `quizScoring.test.ts` — veto cascade, confidence/mode logic, all edge cases; run with `npm test` from `backend/` |
| Profile — user data collection | ✅ Sign-up collects first + last name; profile Settings tab has editable name, optional birthday, and shipping + billing address management — all written to DB |
| Family Bundle | ✅ Full-stack feature — `household_invitation` table, 8 API endpoints, Family tab in Profile, `/join-household` page with token-based invite flow, Resend invite email |
| Find My Flavor page (`/find-my-flavor`) | ✅ Auth-aware split-screen — returning users see a two-column layout: left panel has photo + nav options, right panel shows "Your primary profile is [archetype]", description, and last quiz date; signed-in users without an archetype skip the name screen; guests see original flow + "Already have a profile? Sign in →" |
| Firestore (`axis-bloom-fs`) | ✅ Live — `users/{uid}` (profile snapshot), `users/{uid}/quiz_sessions` (full session history) |
| CI/CD | ✅ Push to main deploys everything |

---

## Flavor Intelligence Page (`/flavor-intelligence`)

**Renamed and rebuilt 2026-07-12** from the old `/coffees` page (`CoffeesPage.tsx` → `FlavorIntelligencePage.tsx`) per `backend/src/features/Flavor Intelligence Page/CLAUDE_CODE_PROMPT_FLAVOR_INTELLIGENCE_PART1_BACKEND.md` + `..._PART2_FRONTEND.md`. Same core content pipeline as before (AI editorial content, three-source descriptor wheel, dimension bars, compatibility badge, compare mode) — this build made the page **roaster-blind** (matching The Bloom's drop-ship confidentiality rule), **reorganized** the flat coffee list into an archetype accordion, **personalized** it against the full lifecycle-stage taxonomy, and went deeper on data the page already had but wasn't surfacing.

**File**: `frontend/src/app/components/FlavorIntelligencePage.tsx`
**Backend**: `backend/src/routes/coffees.ts`, `backend/src/routes/admin.ts` (lookup CRUD), `backend/src/services/claude.ts`

### Roaster-blind (new)

`GET /api/coffees` (flat list, leaks `roaster`/raw `name`) is superseded for this page — it now reads `GET /api/coffees/archetypes`, the same roaster-blind, slot-based catalogue The Bloom uses, so the two pages can never disagree about what's currently sellable/explorable. Never sends `roaster`, raw coffee `name`, or the exact `origin` string. `process`, `roast_level`, and a new bucketed `originRegion` (broad geographic region, e.g. "East Africa" — see below) are shown directly; they're generic flavor vocabulary, not identifying.

**Origin region bucketing** — new `lookup_value` category `origin_region` (7 values: East Africa, Central America, South America, Southeast Asia & Pacific, Multi-Origin/Blend, Caribbean, South Asia — last two are headroom, unused today). New column `coffees.origin_region_id INTEGER REFERENCES lookup_value(id)`, nullable, admin-editable dropdown in `AdminCoffees.tsx`'s per-coffee edit panel (`PATCH /api/admin/coffees/:id`, body `{ process?, roast_level?, origin_region? }` — `origin_region` takes the lookup slug, resolved to the FK id server-side). All 29 catalogue coffees backfilled by hand against the real seed data (`coffees_path_tcr.sql` + the 3 Session 001 Path coffees) — not auto-derived from the free-text `origin` column, since strings like "Uganda & Ethiopia Blend" can't be parsed reliably.

### Layout

**Two-column** (Part 3, 2026-07-12, from Dana's post-deploy review): a narrower `lg:w-80` sticky archetype accordion on the left (one collapsible section per archetype, coffee count in the header), majority-width `flex-1` selected-coffee detail panel on the right — same relationship the old single-coffee `CoffeesPage.tsx` used, just with the sidebar now holding the accordion instead of a flat list. Falls back to a single stacked column below the `lg` breakpoint. Outer container widened to `max-w-[1400px]` (was `1100px`) to give the two columns room. Expanding a section shows its active slots as cards (`platformName` + `positionLabel`).

Selected-coffee detail panel, top to bottom: header (`platformName` + archetype/position pills + process/roastLevel/originRegion tags + ⇄ Compare) → compatibility badge/dimension comparison → surprise angle → three-voice story → collapsible AI note ("Liam's intake") → **cupping session notes** (new — the cupper's own free-text notes, previously fetched by `/dimensions` but discarded) → dimension bars → **Collaborative Flavor Wheel, now grouped into labeled sub-sections by SCA `wheel_category`** (was one flat bubble cloud; this change is in the shared `CollaborativeFlavorWheel.tsx` component, so it also applies to The Bloom's reveal panel).

**Removed in Part 3**: the per-archetype "Archetype intelligence" stats panel (target range vs. family avg actual cupping score) that briefly showed inside each expanded accordion section — didn't land well with Dana, removed along with its lazy-fetch to `GET /api/coffees/archetype-stats`. That endpoint is untouched and still live, just unused by the frontend now. Also removed the duplicate "Flavor Intelligence" eyebrow label that sat above the H1 (same text twice).

**Part 4 (2026-07-13)** — two more fixes from Dana's review:

1. **Font standardization, scoped to `FlavorIntelligencePage.tsx` only.** Root cause: `frontend/src/styles/fonts.css` loads a single static Regular-weight Lato TTF across the declared `font-weight: 100 900` range — static fonts don't interpolate weight, so every `font-light`/`font-medium` class site-wide has always rendered as the same Regular glyphs. Fixing `fonts.css` itself (sourcing real weight files) was confirmed out of scope for this pass — shared file, bigger decision. Removed all `font-light` classes from this page's own JSX (kept `font-normal` on heading-ish elements for code clarity, since visually the two are identical today) and unified the "coffee/archetype highlight" sub-heading role to `text-xl` (was `text-2xl` for "Your match", `text-lg` for the compare-mode names) — the primary selected-coffee `<h2>` stays one step larger (`text-3xl`) on purpose, documented in a code comment. Checked the button/`<select>`-inherits-a-different-font hypothesis directly (Tailwind v4's preflight sets `font-family: inherit` on form controls, and `body`/`html` set `'Lato', Arial, ...` — confirmed via computed-style inspection in a real browser, not just code reading): no leak, no code change needed there.

2. **`CollaborativeFlavorWheel.tsx` descriptor cloud → bars, no numbers.** The bubble cloud's `√(mentions/maxMentions)` sizing compressed the visual gap between a dominant note and a minor one — a "Classic Chocolate" coffee's fruit-note bubbles read as nearly as large as its chocolate bubble. Replaced with horizontal bars (label above, bar below, three small source dots — no numeric label, percentage, or mention count anywhere, including on hover). `DescriptorEntry` gained a mentions-weighted `avgIntensity` field (aggregated from `WheelRow.avg_intensity`, which already existed per row but was previously discarded); bar width is relative to the coffee's own single strongest note (`maxIntensity`, computed across all categories before grouping — not per-category, not the fixed 0–15 scale). `groupByCategory()` now orders both categories and entries-within-category by `avgIntensity` instead of `totalMentions`. Each category caps at 5 visible entries with a "+N more, less prominent →" toggle. This is a shared-component change (`coffee-info/CollaborativeFlavorWheel.tsx`), so it also applies to The Bloom's `RevealedPanel.tsx`.

   **Critical finding, not a code bug**: `cupping_score_descriptors.intensity` — the column `avg_intensity` is aggregated from — is `NULL` for all 47 existing rows in production. `AdminCupping.tsx` has always had an intensity input per descriptor (`setDescIntensity`), it's just never been filled in for any cupping session entered so far. `user_flavor_feedback.intensity` is also empty (0 rows — dormant, Shopify still stubbed). Net effect: **every descriptor bar on every coffee currently renders at the same fixed "no data" floor width** (per spec: entries with no intensity read as "present but unconfirmed," not absent or arbitrarily sized) — the redesign is code-complete and verified correct against the spec, but doesn't yet visually differentiate a dominant note from a minor one for any real coffee, because the underlying data doesn't exist yet. Needs cuppers to start actually using the existing intensity field going forward for the bars to do what they're designed to do. Tracked as `OPEN_TASKS.md` OT-12. **Superseded by Part 6 below** — bar length no longer depends on this field.

**Part 5 (2026-07-13)** — `coffee-info/TastingNotes.tsx`'s surprise-note blockquote (`text-lg`, 18px) was the one outlier Part 4 didn't catch, because Part 4 was deliberately scoped to `FlavorIntelligencePage.tsx` only and this component lives in the shared `coffee-info/` folder (also rendered by The Bloom via `RevealedPanel.tsx`). Downsized to `text-base` (16px) to match the three-voice story paragraph and the expanded AI note beneath it — the left border + color already carry "this is a different kind of note," a bigger font size on top wasn't needed. Also removed the remaining `font-light` classes from this file (same no-op reasoning as Part 4). Confirmed the "Read full note ↓" button correctly inherits the page's Lato font (no leak) via the same computed-style check Part 4 used.

**Part 6 (2026-07-13)** — the bar redesign from Part 4 still wasn't showing a dominance signal: every bar rendered at roughly the same length. Diagnosis (not a rendering bug): cupping intensity scores for descriptors that get recorded at all cluster tightly in a moderate-to-strong range — a cupper generally only notes a descriptor if it's already reasonably present — so scaling bar length by `avgIntensity` produced bars that were all close to full length regardless of how often a note was actually observed. Fixed by switching what bar **length** measures back to `totalMentions` (linearly, not the old bubble cloud's `√mentions` — square-root was the original compression problem, not mentions itself), while `avgIntensity` becomes bar **thickness** (4px–8px) instead — Dana's "longer... and bold" framing mapped onto two distinct visual properties instead of one. `groupByCategory()` and `aggregateDescriptors()` now sort by `totalMentions`/`maxMentions`, not intensity. Bars also became sharp rectangles (`rounded-full` dropped from both track and fill) — a deliberate, more graph-like look, confirmed against a mockup. Verified with real pixel measurements post-fix: a "Classic Chocolate" coffee now shows Chocolate (4 mentions) at 100% width, Raisin/Smoky (2 mentions each) at 50%, and single-mention notes at 25% — real, visible variation. Bar *thickness* still doesn't vary in production today, for the same OT-12 reason as Part 4 (no real intensity data yet) — entries without intensity get a neutral default thickness (`INTENSITY_DEFAULT_RATIO = 0.6`) rather than looking arbitrarily thin.

**Part 7 (2026-07-13)** — applied Part 6's sharp-rectangle treatment to the other bar section on this page, `coffee-info/DimensionBars.tsx` (the Sweetness/Acidity/Bitterness cupping-profile bars) and its compare-mode legend swatches, so both bar-based sections in the detail panel share one visual language. Shared component — also affects The Bloom; regression-checked there post-change (no visual or console-error issues).

**Part 8 (2026-07-13)** — three refinements to `coffee-info/CollaborativeFlavorWheel.tsx`'s bars, all confirmed with Dana after a mockup:
- **Thicker bars**: `6 + intensityRatio * 6` (6–12px), up from Part 6's `4 + intensityRatio * 4` (4–8px).
- **Dominance-clarity rescale, not literal proportion**: bar length now min-max normalized into a `[5%, 75%]` band (`MIN_BAR_WIDTH_PCT`/`MAX_BAR_WIDTH_PCT`, both named constants Dana called "maybe" — expect retuning) — computed via `computeWidthPct()`, stretching whatever spread of mention counts actually exists across the coffee's own descriptors, not a fixed `[0,100]` range. Per Dana directly: *"accuracy here is not important, what's important is creating a clear visual understanding about the dominance of each note."* The strongest note now stops at 75% (never looks "maxed out," flush to the row's edge); the weakest visible note sits at 5% (unambiguously minor). `minMentions`/`maxMentions` computed once across all of a coffee's entries, before category grouping and the `VISIBLE_PER_CATEGORY` cap, so expanding "+N more" never rescales bars already on screen.
- **Source-segmented bar fill**: the bar itself is now split into colored segments proportional to each source's share of a descriptor's mentions (using `entry.sources`, already computed since Part 6 — no backend change), instead of one flat color with small dots next to the label. The per-row source dots were removed — the bar segments carry that signal now. The section-level source legend at the top is unchanged.

Verified with real pixel + DOM measurements: a "Classic Chocolate" coffee's Chocolate bar now stops at 75% width (not 100%), single-mention notes sit at 5%, and a two-source descriptor (e.g. Raisin, internal + roastery) renders as a visibly two-toned segmented bar matching each source's mention share.

**Part 9 (2026-07-13)** — Dana reported every coffee showing "Multi-Origin / Blend" regardless of actual origin. First pass: queried the live `coffees`/`lookup_value` join directly (real, varied distribution — 13 Multi-Origin/Blend, 6 East Africa, 4 South America, 4 Central America, 3 Southeast Asia & Pacific), hit `GET /api/coffees/:id/content` for several different coffees on both local dev and live production — all correct and varied — and clicked through every visible card on the deployed frontend, confirming the displayed pills matched. Per-coffee data was never actually broken; initially reported back as "no bug found."

**Follow-up, same day** — Dana confirmed she was still seeing it, prompting a second look specifically at the *default landing view*: `chocolate_nutty` is the first archetype in `/api/coffees/archetypes`' response order, and neither of its two slots currently carries a working `isDefault: true` (the pre-existing `is_default`/resolved-coffee mismatch flagged during Part 2 testing), so the default-selection fallback lands on whichever active slot sorts first — Noam Blend ("Classic Chocolate"). Every guest saw this exact coffee, every single page load, regardless of how varied the data was everywhere else. Noam Blend's `origin` ("Central") was one of three genuinely ambiguous judgment calls in the original backfill (Part 1); Part 1's own notes already flagged "Central America" as an equally defensible alternative to "Multi-Origin/Blend." **Fixed**: reclassified Noam Blend to `Central America`, verified against the live production API. Crosshatch and Feather In Cap (the other two ambiguous calls) legitimately span two disparate regions each and correctly remain `Multi-Origin / Blend`.

**Second follow-up, 2026-07-14** — Dana found the same mislabel in the Earthy archetype. Different root cause this time: Earthy's only two coffees, Nocturnal Dark Roast and Vantablack Ultra-Dark, are `blend_or_single = 'single'`/`'single origin'` (genuinely not blends), but their roastery-provided `origin` string is `"Central/South America"` — spanning two of the seven original buckets, no single defensible pick, and tagging them `Multi-Origin / Blend` misrepresented them as blends. Audited every remaining `Multi-Origin / Blend` coffee: all others are correctly `blend_or_single = 'blend'` — these two were the only mislabeled outliers. Per Dana directly (*"we should reflect what the roastery indicated... they didn't invent a new region"*): added a new `origin_region` value, `central_south_america` → "Central & South America", seeded in `schema.sql` (not just a live patch) — reflects the roastery's own combined-region label directly, distinct from the blend bucket. Assigned to both coffees, verified against the live production API.

**Part 10 (2026-07-13)** — added the page's first purchase path: a "Shop on The Bloom →" link next to the ⇄ Compare toggle in the selected-coffee header, `to={/bloom?archetype=${archetype}&slot=${slot}}`. Deliberately a link, not in-page cart/checkout — Part 2 Decision #2 already scoped this page as exploration/education, and The Bloom's `CartContext` (Bloom Part 5) is wrapped around `/bloom`/`/find-my-flavor` specifically; pulling this page into that flow would mean duplicating pricing/weight-selection UI that already exists and is already tested. Shown for every coffee regardless of lifecycle stage (unlike the personalized header's stage-gated shop link — this is about the coffee currently in view, not a nudge). **Known gap, flagged not fixed**: confirmed `BloomPage.tsx` has no `useSearchParams` at all, so it doesn't yet read/act on `?archetype=&slot=` — the link still works, it just lands on Bloom's default view instead of scrolling to that archetype. Worth fixing on Bloom's side eventually.

**Part 11 (2026-07-13)** — renamed the "Customer feedback" source label to **"Community notes"** (Dana doesn't want "customer" used here). Two places needed the fix, not one: `SOURCE_LABEL.client` in `CollaborativeFlavorWheel.tsx` (the bars' legend), and `TastingNotes.tsx`'s "Three voices" block, which had its own separate hardcoded `['Internal cupping', 'Roastery notes', 'Customer feedback']` array that would have silently drifted out of sync. Fixed by having `TastingNotes.tsx` import and render `SOURCE_LABEL`/`SOURCE_COLOR` from `CollaborativeFlavorWheel.tsx` instead of maintaining a second copy — same root-cause fix as Part 5's "two lists that were supposed to be one." Grepped the whole frontend for any other literal "Customer feedback" — none found.

### Personalization (new — full lifecycle taxonomy, not just "has archetype")

Reads `GET /api/users/homepage-state` (no new backend work — same endpoint `Home.tsx` already uses) and renders every `user_lifecycle_stage` explicitly, mirroring `Home.tsx`'s `renderStageCTA` pattern:
- Anonymous / `NEW_NO_QUIZ` — neutral accordion, dismissible quiz-nudge banner.
- `QUIZ_TAKEN_FRESH/SETTLED/STALE_NO_ORDER` — "Your match: {archetype}" header, that archetype's section expanded + its `isDefault` slot pre-selected, adjacent archetypes (`useArchetypeAdjacency`) labeled "Worth exploring" render next, then a divider, then everything else (always fully expandable — personalization only changes what leads, never what's accessible).
- `pendingFeedback` (independent of stage) — feedback nudge at the top of the page reusing `OrderFeedbackForm`.
- `SUBSCRIBER`/`REORDER_DUE`/`LAPSED_SINGLE_ORDER`/`ACTIVE_REPEAT_USER` — match-first layout, stage-appropriate (or no) secondary nudge; no shop/reorder CTA (that's the homepage's job).

### Deep-link contract change

`?coffee={coffeeId}` → `?archetype={archetype_enum}&slot={dialSortOrder}` — human-legible and stable even if `resolveBlendForSlot` changes which physical coffee fulfills a slot. Legacy links still work: `GET /api/coffees/:id/legacy-slot` resolves an old raw `coffeeId` server-side, and the frontend redirects to the new param shape. `/coffees` (bare) redirects to `/flavor-intelligence`; `/coffees?coffee={id}` resolves-then-redirects (`CoffeesRedirect.tsx`). Every internal link that pointed at `/coffees` (nav, footer, homepage, Sommelier's auto-redirect, FlavorQuiz's returning-user panel, and The Bloom's "Explore the full flavor breakdown" link — the latter needed a new `dialSortOrder` prop threaded through `RevealedPanel.tsx`) now points at `/flavor-intelligence`.

### Compare mode

Rebuilt from `/api/coffees/archetypes` slots (`archetypeLabel` + `platformName`) instead of the old flat roaster-leaking coffee list — the one remaining identity leak the API-level fix didn't already close.

### Endpoints (new/changed)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/coffees/archetypes` | No | Now includes `isDefault: boolean` per slot (matches whichever coffee is *currently resolved* for that slot, not a static per-archetype flag) |
| GET | `/api/coffees/archetype-stats?archetype=` | No | Target range + avg actual cupping score + coffee count, per dimension, for one archetype. Roaster-blind, archetype-level aggregate only |
| GET | `/api/coffees/:id/legacy-slot` | No | Resolves a raw `coffeeId` to `{ archetype, dialSortOrder }` for the old deep-link contract; 404 if no live assignment |
| GET | `/api/coffees/:id/content` | No | Now also returns `process`, `roastLevel`, `originRegion` (never raw `origin`/`roaster`) |
| POST/PATCH/DELETE | `/api/admin/lookups` / `/api/admin/lookups/:id` | Admin | New CRUD for `lookup_value` (upsert on `category`+`value`; `DELETE` returns 409, not a raw FK error, if a value is still assigned to a coffee) — so new categories/values (like `origin_region`) don't need a code deploy |
| PATCH | `/api/admin/coffees/:id` | Admin | New — `process`/`roast_level`/`origin_region` partial update, used by the origin-region backfill UI |

### Navigation

"Flavor Intelligence" link in the main nav and footer (was "Our coffees"/"Our Coffees"). Merged 2026-07-12 with Camila's concurrent `Navigation.tsx` redesign (two-state transparent-over-hero/solid-after-scroll nav, `IntersectionObserver` on `[data-hero]`) — the full 7-link set was kept (an intermediate version briefly consolidated to 4 links and dropped The Axis/The Bloom/How It Works per an earlier v2 brief draft, then Camila restored the full set in a follow-up commit), with the coffees link pointed at `/flavor-intelligence` rather than the reverted `/coffees` label.

**Mobile bug found and fixed during Part 3 verification**: the compare-mode `<select>` had no width constraint, so a long selected-option label (e.g. "Chocolate & Nutty — Classic Chocolate") pushed 15px past the viewport at 390px width. Fixed (`min-w-0 max-w-full flex-1`, wrapping row); the side-by-side compare header also drops to one column below `sm`.

**Known pre-existing gap, not fixed (out of scope for this build)**: `Navigation.tsx`'s primary link row is `hidden md:flex` with no mobile hamburger menu — every page's nav links (not just this one) are unreachable below the `md` breakpoint; only the logo/profile/cart icons remain. Worth a dedicated mobile-nav pass if/when prioritized.

### Known pre-existing data gap (not a code bug)

`chocolate_nutty`'s "Classic" slot currently resolves to Noam Blend (priority-1, Path), but `dial_archetype_positions.is_default = true` is stamped on Brazil Santos (priority-2, TCR) for that same slot — a mismatch between which coffee is *marked* default and which is *currently active*. The `isDefault` field correctly reflects the live-resolved coffee (per Decision #8's join, keyed off the resolved `coffee_id`), so this slot currently shows `isDefault: false` for everyone. Fixing it means either re-marking the default in the DB or accepting Noam Blend isn't flagged default — an admin data decision, not something this build should silently override.

---

## Find My Flavor Page (`/find-my-flavor`)

The quiz entry page is auth-aware and renders one of four states based on sign-in status and whether the user already has an archetype.

**File**: `frontend/src/app/components/FlavorQuiz.tsx`

On mount, fetches `GET /api/users/profile` (signed-in users only). The profile response includes `archetype` (name, description, color, features) and `lastQuizDate` (from `quiz_session.completed_at`).

### State 1 — Signed in + has archetype (returning user screen)

Two-column split-screen layout:

**Left panel** — background photo with dark overlay. "Welcome back, {firstName}" label at the bottom, then four row-link options in white text:
1. **Retake the quiz** — starts the quiz immediately with name pre-filled, no name screen
2. **Talk to our coffee sommelier** → `/sommelier?entry=user_initiated`
3. **View my profile** → `/profile`
4. **Explore our coffees** → `/coffees`

**Right panel** — clean cream background. Laid out top to bottom:
- Small "Your coffee profile" label
- "Your primary profile is" sentence
- Archetype name large, in its brand color (rust / gold / rose)
- Archetype description in muted text
- Separator line → "Last quiz taken" label + formatted date (e.g. "June 1, 2026")

### State 2 — Signed in + no archetype yet

Profile is fetched, archetype is null. The name screen is skipped entirely — `firstName` from the DB (or `displayName` from Firebase) is pre-filled and the quiz starts automatically. No friction for users who already created an account but haven't taken the quiz.

### State 3 — Not signed in (guest)

Original experience: "Whose palate are we profiling today?" name input. **"Already have a profile? Sign in →"** link added below the Begin Profile button.

### State 4 — Quiz in progress / results

Unchanged. "Sign in to save progress" link still shown during the quiz for guests.

---

## Flavor Quiz (V7)

The quiz lives in `frontend/src/app/components/FlavorQuiz.tsx`. The active quiz version is always served dynamically via `GET /api/quiz/questions` (queries `quiz WHERE is_active = TRUE`) — no frontend deploy needed to switch versions.

**Version history:**
- **V1** — 15 questions, 6 archetypes, hardcoded in frontend (replaced)
- **V2** — 5 questions, 3 archetypes, DB-driven scoring (deactivated)
- **V3** — 5 questions, 3 archetypes, new "Perfect cup" Q2, experimental gate on Q3-C, updated answer texts; source file: `backend/src/quizes/Coffee_Quiz_Scoring_v3.xlsx` (deactivated)
- **V4** — 6 questions, 3 archetypes, weighted scoring, food instinct Q2 (secondary signal only), experimental gate on Q4-C, split answer on Q4-D, full food signal matching logic; source files: `misc/v4/` (deactivated)
- **V7** — 6 questions (5 scored + Q6 food signal), 5 archetypes; food signal moved from Q2→Q6, scored questions reordered (Q2–Q5 are the V4 Q3/Q4/Q5/Q6), experimental gate on Q3-C, no split answer; branch question after scoring reclassifies Fruity→Floral or CN→Earthy; source file: `backend/src/quiz/Coffee_Quiz_ScoringV7.xlsx`

### Questions (V7 — active)

| # | Weight | Category | Question | Notes |
|---|---|---|---|---|
| 1 | 1 | Identity | How would you describe your relationship with coffee? | Lowest weight — most rationalizable |
| 2 | 2 | Perfect cup | When you finish a really good cup of coffee, what made it good? | Second-highest weight (was Q3 in V4) |
| 3 | 1 | Black coffee reaction | You try a new coffee black. What's your first reaction? | Experimental gate on Q3-C; 3 options only (no split answer) |
| 4 | 2 | Disappointment | Which of these would bother you most about a cup of coffee? | (was Q5 in V4) |
| 5 | 3 | Bitterness tolerance | Someone hands you a coffee that's a little more bitter than expected. What's your honest reaction? | Strongest signal, highest weight (was Q6 in V4) |
| 6 | 0 | Food instinct | Someone places a small treat next to your coffee. Without thinking, which do you grab? | Signal only — no scoring rows; moved from Q2 in V4 |

### Archetypes

| Archetype | Color | Personality |
|---|---|---|
| **Chocolate & Nutty** | `#a54c2d` | Daily ritual drinker — bold, rich, comforting, particular |
| **Balanced & Sweet** | `#d1ac11` | Reliable habit — smooth, easy, approachable |
| **Fruity** | `#ca445f` | Curious discoverer — bright, lively, complex |
| **Floral** | `#7b6ca8` | Reclassified from Fruity — prefers delicate, tea-like, barely-coffee lightness |
| **Earthy** | `#5c6b45` | Reclassified from Chocolate & Nutty — prefers deep, intense, serious complexity |

### Scoring model — three-level normalised matrix

Scoring is split across three fields, each with a distinct role. All three are kept separate (normalised) so any level can be tuned independently without touching the others.

| Field | Table | Role | Scope |
|---|---|---|---|
| `quiz_question.weight` | `quiz_question` | How important this question is relative to others | Applies to all answers in the question |
| `quiz_answer.weight` | `quiz_answer` | How decisive/strong this answer is as a signal | Applies uniformly across all archetype rows for this answer |
| `quiz_answer_archetype_score.score` | `quiz_answer_archetype_score` | The archetype-specific impact — positive or negative | One row per (quiz_answer, archetype) |

**Lambda formula:**
```
archetype total = SUM( question.weight × quiz_answer.weight × quiz_answer_archetype_score.score )
```

**V7 seeded values** (point difference baked into `score`; Q6 excluded from `quiz_answer_archetype_score`):

| Question | Weight | Answer | Archetype | Score |
|---|---|---|---|---|
| Q1 — Identity | 1 | It's a daily ritual. I'm particular about it. | Chocolate & Nutty | +1 |
| Q1 — Identity | 1 | It's a reliable habit. I just like having it. | Balanced & Sweet | +1 |
| Q1 — Identity | 1 | It's something I'm still discovering. I'm curious about it. | Fruity | +1 |
| Q2 — Perfect cup | 2 | It was strong and satisfying — I felt it. | Chocolate & Nutty | +2 |
| Q2 — Perfect cup | 2 | It was smooth and easy the whole way through — nothing got in the way. | Balanced & Sweet | +2 |
| Q2 — Perfect cup | 2 | It felt alive — bright and changing. Every sip was a little different. | Fruity | +2 |
| Q3 — Black coffee | 1 | It feels complete. I'd drink it as is, or add milk to make it even richer. | Chocolate & Nutty | +1 |
| Q3 — Black coffee | 1 | It's fine, easy to drink. I might add something to smooth it out. | Balanced & Sweet | +1 |
| Q3 — Black coffee | 1 | Interesting — what flavors am I getting here? ⚑ | Fruity | +1 |
| Q4 — Disappointment | 2 | It has no bitterness or intensity. | Chocolate & Nutty | +2 |
| Q4 — Disappointment | 2 | It's too bitter or too intense. | Balanced & Sweet | +2 |
| Q4 — Disappointment | 2 | Every sip tastes exactly the same. | Fruity | +2 |
| Q5 — Bitterness | 3 | I don't mind. Actually I kind of like it. It tastes serious. | Chocolate & Nutty | +3 |
| Q5 — Bitterness | 3 | I'd rather have something gentler and smoother. | Balanced & Sweet | +3 |
| Q5 — Bitterness | 3 | It feels burnt to me. I'd rather have something fresher or more alive. | Fruity | +3 |
| Q6 — Food instinct | 0 | (secondary signal — not scored, captured as food_signal) | — | — |

⚑ = experimental gate — see below.

| Question | Weight | Max score per archetype |
|---|---|---|
| Q1 | 1 | 1 pt |
| Q2 | 2 | 2 pts |
| Q3 | 1 | 1 pt |
| Q4 | 2 | 2 pts |
| Q5 | 3 | 3 pts |
| Q6 | 0 | — (food signal only) |
| **Total** | | **9 pts** |

**Max possible score for one archetype**: 1 + 2 + 1 + 2 + 3 = **9 pts**

**Tuning examples — no code changes needed, just DB updates:**
- Q5 should matter even more → `UPDATE question SET weight = 4 WHERE q_number = 5`
- A specific answer is an unusually strong signal → `UPDATE quiz_answer SET weight = 1.5 WHERE answer_text = '...'`
- An answer should also hurt a competing archetype → `INSERT INTO quiz_answer_archetype_score (..., archetype_id, score) VALUES (..., <fruity_id>, -2)`

**Experimental gate (Q3-C)**

Q3 answer C ("Interesting — what flavors am I getting here?") is flagged `is_experimental_gate = TRUE` in the `answer` table. When selected, `POST /api/quiz/score` returns `experimental: true`. This is a modifier on top of the base confidence/recommendation logic — see food signal section below.

Q3-C still awards +1 to Fruity in the scoring table — the gate is a separate flag, not a scoring override. The flag lives on `quiz_answer.is_experimental_gate`.

V7 has no split answer (V4's Q4-D "I'm not sure" is removed).

**Tie-break — veto cascade** (only fires when two or more archetypes share the top score):

```
Priority: Q5 → Q4 → Q2 → Q1   (Q3 and Q6 excluded from cascade)

For each question in that order:
  if the user's answer pointed to one of the tied archetypes → that archetype wins
  else → continue to next question

Fallback (cascade exhausted without resolution): Balanced & Sweet
```

The cascade uses the user's actual submitted answers looked up from `quiz_answer_archetype_score` — not a static priority list. The same tie can resolve differently depending on which answers the user gave.

### Food signal matching logic

After the primary winner and secondary archetype are determined, Q6's answer (weight 0 — not scored) is used as a food signal to compute **confidence** and **recommendation mode**. Logic lives in `POST /api/quiz/score` and stored in `misc/v4/logic_notes.csv` (carried forward from V4 — logic unchanged).

**Base scenarios (food_signal vs primary/secondary):**

| Scenario | Condition | Confidence | Recommendation mode |
|---|---|---|---|
| 1 | food == primary (no close secondary) | high | `primary_only` |
| 2 | food == secondary | medium | `primary_plus_introduce_secondary` |
| 3 | food ≠ primary AND food ≠ secondary | low | `ai_agent` |
| 4 | food == primary AND secondary scored on Q5 or Q6 | medium | `primary_plus_note_secondary` |

**"Close secondary" threshold — Option B**: secondary is considered meaningful if its score appeared on Q5 (weight 3) or Q4 (weight 2) — i.e., the user's Q5 or Q4 answer pointed to the secondary archetype. Low-weight questions (Q1, Q3) contributing to a secondary don't qualify.

**Experimental gate modifiers** (override recommendation mode):

| Condition | Recommendation mode |
|---|---|
| experimental AND food == secondary | `primary_plus_active_secondary` — actively push secondary discovery coffee |
| experimental AND food == primary | `primary_as_starting_point` — frame primary as beginning of a journey |

**`POST /api/quiz/score` full response:**
```json
{
  "archetype": "Chocolate & Nutty",
  "archetypeId": "uuid",
  "scores": { "Chocolate & Nutty": 7, "Balanced & Sweet": 3, "Fruity": 2 },
  "experimental": false,
  "secondaryArchetype": "Balanced & Sweet",
  "foodSignal": "Fruity",
  "confidence": "low",
  "recommendationMode": "ai_agent",
  "tied": ["...", "..."]
}
```

**Claude recommendation modes** (`getRecommendation()` in `backend/src/services/claude.ts`):

| Mode | Prompt behaviour |
|---|---|
| `primary_only` | Confident single recommendation — tasting notes + why it matches |
| `primary_plus_introduce_secondary` | Primary recommendation + gentle introduction of secondary as a future discovery |
| `primary_plus_active_secondary` | Primary + actively recommend a specific secondary discovery coffee (not just a hint) |
| `primary_plus_note_secondary` | Primary + mention secondary may be worth exploring in future |
| `primary_as_starting_point` | Primary framed as the beginning of a journey, not a fixed destination |
| `ai_agent` | Approachable open-ended recommendation; invites user to share more |

**All scoring runs on the backend (Cloud Run)** — the frontend has zero scoring logic.

### Branch questions (V7)

After the primary archetype is determined, the frontend calls `GET /api/quiz/branch?archetypeId=<uuid>`. If a branch question exists for that archetype, it's shown as an intermediate "one last thing" screen before results.

| Trigger archetype | Branch question | Answer A | Answer B → reclassify to |
|---|---|---|---|
| Fruity | "One last thing. When coffee is really at its best for you, which is closer?" | "It's complex and alive..." (confirm Fruity) | "It's so light and delicate it barely feels like coffee. Almost like drinking tea." → **Floral** |
| Chocolate & Nutty | "Your profile is rich and bold. How do you like to take it?" | "Rich and comforting. Coffee that feels like a reward at the end of the day." (confirm CN) | "Deep and intense. Complex, almost challenging. The more serious the better." → **Earthy** |

Branch questions live in the `quiz_question` table and their answers in `quiz_answer`, under dedicated quiz rows of `quiz_type = 'branch'` (`v7-branch-floral`, `v7-branch-earthy`). Each branch quiz row has `trigger_archetype_id` (which primary archetype fires it) and `parent_quiz_id` (FK to the main quiz). No separate `quiz_branch` link table — the branch quiz row itself carries all the relationship data.

Each branch `quiz_answer` carries `resulting_archetype_id`. The frontend selects an answer and uses its `archetypeName` as the final archetype — no hardcoded A/B logic anywhere.

`POST /api/quiz/results` is **deferred** until after the branch answer so the correct final archetype (possibly reclassified) is what gets saved.

The secondary archetype and food signal are not affected by the branch reclassification — they carry forward from the `/score` response.

### Full flow (V7)

```
1. mount        → GET  /api/quiz/questions
                ← { quizId, questions: [{ q_text, answers: [{ id, text, archetype_name }] }] }

2. user answers → frontend tracks selected answer UUIDs (one per question)

3. last answer  → POST /api/quiz/score  { answerIds: ["uuid1", ..., "uuid6"] }
                ← { archetype, archetypeId, scores, experimental,
                    secondaryArchetype, foodSignal, confidence, recommendationMode,
                    tied? }

4. always       → GET  /api/quiz/branch?archetypeId=<uuid>
                ← { branchQuestion: { questionId, questionText,
                                      answers:[{id,text,archetypeId,archetypeName}] } }
                   or { branchQuestion: null } if no branch for this archetype

5. if branch    → show branch screen; user picks an answer
                  final archetype = selected answer's archetypeName (fully data-driven)

6. if signed in → POST /api/quiz/results  { archetype: <final>, scores, answers, decaf,
                                            experimental, secondaryArchetype,
                                            foodSignal, confidence, recommendationMode }
                ← { id: sessionId, recommendation }
                   (all fields saved to quiz_session.context_data JSONB)
```

Question images are still managed in the frontend (keyed by `q_number`) since images aren't stored in the DB.

---

## Admin Portal

The admin portal lives at `/admin/*` within the same site and deployment. It uses a completely separate layout (no public nav or footer) with a sidebar for navigation.

### Access control
- `requireAdmin` middleware verifies the Firebase token, then checks `user_profile JOIN user_type WHERE name = 'admin'`
- `AuthContext` fetches `isAdmin` from `GET /api/users/profile` on every sign-in — no token re-issue needed
- `AdminRoute` component redirects non-admins to `/`
- The "Admin" link in the public nav is hidden unless `isAdmin === true`

### To grant/revoke admin access

Three stored PostgreSQL functions are created automatically at backend startup (idempotent `CREATE OR REPLACE FUNCTION`):

```sql
-- Grant admin to any user (they must have logged in at least once)
SELECT grant_admin('user@example.com');

-- Revoke admin (sets them back to 'customer' — user stays in system)
SELECT revoke_admin('user@example.com');

-- List all current admins
SELECT * FROM list_admins();
```

The same operations are also available as API endpoints (requires an existing admin token):
- `POST /api/admin/grant-admin` — body: `{ "email": "..." }`
- `DELETE /api/admin/revoke-admin` — body: `{ "email": "..." }`

`revoke_admin` only changes the user type — it does **not** delete the user or any of their data.

### Admin pages

| Route | Page | What it shows |
|---|---|---|
| `/admin` | Dashboard | 6 stat cards: coffees, sessions, internal/roastery/client descriptors, SCA entries |
| `/admin/coffees` | Coffees | Coffee catalogue table + "Add Coffee" form + inline archetype assignment per row (dashed "+ Assign archetype" button, visible without hover); Roaster field uses `<input list>` + `<datalist>` autocomplete from active roasters in the DB — still accepts free text for roasters not in the system |
| `/admin/sessions` | Cupping Sessions | Session list + "New Session" form (with coffee pre-selection) + expandable coffee panel (link/unlink coffees); row auto-expands after creation; "Score Entry →" shortcut in header; "Location" field renamed to "Roastery" — renders as a `<select>` dropdown populated from active roasters in the DB |
| `/admin/cupping` | Score Entry | Pick session + coffee → **taster tabs** at top (one tab per taster who scored that coffee, "+ Add Taster" for new entry); each tab shows a read-only score card with "✏️ Edit"; edit mode shows 12 dimensions + SCA descriptor picker + save; new coffee goes straight to edit mode; "New Session" link in header |
| `/admin/flavor-wheel` | Flavor Wheel | Summary stats cards (total mentions, unique descriptors, top 3, per-source counts) + per-coffee descriptor table grouped by source (Internal · Roastery · Client) |
| `/admin/roasters` | Roasteries | Roastery card list + "Add Roastery" form + active/inactive toggle + "✏️ Edit" inline form per card; fields: name, contact person, email, phone, website, address, fulfillment hours, API endpoint, notes |
| `/admin/dial` | Bloom Dial | Two-tab page. **Dial Positions** tab: coffees on each archetype's dial grouped by archetype — shows dimension, vocabulary label, default badge (clickable to toggle), manual/computed source, remove button; inline "Add Position" form (coffee → archetype → vocabulary filtered by archetype → is_default checkbox). **Navigation Hops** tab: directional hop graph between coffees; inline "Add Hop" form (from/to coffee, dimension, direction, hop type, confidence, delta, recommended, notes); remove button per row. |

### Dropdown values (lookup_value table)
All select inputs in admin forms are driven by the `lookup_value` table — not hardcoded in the frontend. The `useAdminLookups` hook fetches all categories in one call (`GET /api/admin/lookups`) and memoises them for the session.

| Category | Values |
|---|---|
| `roast_level` | Light, Light-Medium, Medium, Medium-Dark, Dark |
| `process` | Washed, Natural, Honey, Anaerobic, Wet-Hulled, Other |
| `blend_or_single` | Single Origin, Blend |
| `brew_method` | Cupping, Filter, Pour-Over, Espresso, French Press, AeroPress, Other |

To add or rename an option: update the seed in `schema.sql` and deploy — no frontend change needed.

### Archetype assignment
The archetype and confidence dropdowns on the Coffees page are **not** in `lookup_value` — they map directly to PostgreSQL enum types (`archetype_enum`, `confidence_enum`) whose values are fixed at the schema level. Changing them requires a schema migration regardless of where the labels live, so they are hardcoded frontend constants (`ARCHETYPE_OPTIONS`, `CONFIDENCE_OPTIONS` in `AdminCoffees.tsx`).

### Cupping score entry workflow

**Setting up a session (do this once per session):**
1. Go to **Cupping Sessions** → click "+ New Session"
2. Fill in date, brew method, location, notes
3. Add coffees directly in the form (or add them later by clicking the session row to expand it)
4. Click "Create Session" — the row auto-expands so you can add more coffees immediately

**Entering scores:**
1. Go to **Score Entry** in the admin sidebar (or click "Score Entry →" from Sessions)
2. Select a session — the coffee dropdown populates from `cupping_session_coffees`
3. Select a coffee:
   - If scores already exist → shows a **read-only card** (taster name, all dimension values, descriptor tags)
   - Click **"✏️ Edit"** to switch to edit mode, or **"Cancel"** to return to read-only
   - If no scores exist → goes straight to edit mode for new entry
4. In edit mode: taster name is pre-filled for the active tab; fill in numeric dimensions (min/max on 0–15), free-text dimensions, and SCA flavor descriptors
5. Click **Save Score** — the backend upserts all three tables (`cupping_scores`, `cupping_score_values`, `cupping_score_descriptors`) in one call and returns to read-only view

**Cleanup (test data):**
- `DELETE /api/admin/scores/:scoreId` removes a score and all its values + descriptors (CASCADE)
- `DELETE /api/admin/sessions/:id` removes a session and its coffee links (CASCADE)

---

### 45. `address_type` enum migration failing on every deploy
**Error**: `DB migration error (non-fatal): error: default for column "address_type" cannot be cast automatically to type address_type_enum` — logged on every backend startup.
**Cause**: The migration `DO` block tried to run `ALTER TABLE address ALTER COLUMN address_type TYPE address_type_enum ... ALTER COLUMN address_type SET DEFAULT 'shipping'::address_type_enum` as a single multi-clause ALTER. PostgreSQL cannot implicitly cast the column's existing TEXT DEFAULT value during the type conversion.
**Fix**: Split into three separate statements inside the DO block — `DROP DEFAULT` first, then `ALTER COLUMN TYPE ... USING`, then `SET DEFAULT 'shipping'::address_type_enum`. The idempotency check (only runs when `data_type = 'text'`) is unchanged.

### 46. Express rate limiter misconfigured behind Cloud Run proxy
**Error**: `ValidationError: The 'X-Forwarded-For' header is set but the Express 'trust proxy' setting is false` — logged on every request.
**Cause**: Cloud Run sits behind Google's load balancer, which adds an `X-Forwarded-For` header. Express defaults to `trust proxy = false`, so `express-rate-limit` refused to use the header and threw a validation error on every request — meaning rate limiting was effectively not working correctly.
**Fix**: Added `app.set('trust proxy', 1)` before the rate limiter in `backend/src/index.ts`. This tells Express to trust one proxy hop, allowing `express-rate-limit` to correctly identify the real client IP.

### 48. Mailchimp API key corrupted by trailing newline in Secret Manager
**Problem**: Newsletter signups were saving to the DB correctly but never reaching Mailchimp. Cloud Run logs showed `403 "The API key provided is linked to a different datacenter."`
**Cause**: When the API key was added to Secret Manager by piping a PowerShell string (`$key | gcloud secrets versions add ...`), PowerShell appended a trailing `\n`. The backend code derives the datacenter from the key with `MC_API_KEY.split('-')[1]` — with the newline, this produced `us11\n` instead of `us11`, so the URL and Authorization header were mismatched.
**Fix**: Two changes together:
1. Re-stored the secret cleanly using `[System.IO.File]::WriteAllText()` to write the key file without any line ending before passing it to `--data-file`
2. Added `.trim()` to the key read in `newsletter.ts`: `const MC_API_KEY = (process.env.MAILCHIMP_API_KEY ?? '').trim()` — permanent defensive guard against whitespace in the secret value

### 49. `inlineRasterImages` Vite plugin causing 10–15 second page load
**Problem**: The site took 10–15 seconds to load — the browser progress bar would stall at ~50% before the pre-launch page appeared.
**Cause**: `frontend/vite.config.ts` had a custom `inlineRasterImages` plugin that base64-encoded every `.png` and `.jpg` import directly into the JS bundle. With 35+ images in the full asset library, the bundle grew to ~10 MB. The browser had to fully download and parse the entire JS file before rendering a single pixel — even on the lightweight pre-launch page.
**Fix**: Removed the `inlineRasterImages` plugin entirely. Vite's native image handling takes over — imported images are output as separate hashed files (e.g. `A_B03-BhqGBCC4.png`) and the browser loads them in parallel, lazily, as needed. No component code changes were needed — `import beansPhoto from '...'` still works; the import now returns a URL instead of a base64 data string. Page load dropped to ~1–2 seconds.

---

### 50. Archetype dimension vectors populated
**Change**: Populated `archetype_vector` with target dimension ranges for all 5 archetypes (Chocolate & Nutty, Balanced & Sweet, Earthy, Floral, Fruity) across 7 numeric dimensions (Sweetness, Acidity, Bitterness, Body, Texture, Savory/Depth, Finish Length). Source: `backend/src/dimensions/dimensions-vector.JPG`.

**Seed file**: `backend/src/db/seeds/archetype_vectors.sql` — 35 rows, fully idempotent. Run manually in Cloud SQL Studio.

**dimension_id**: The `archetype_vector.dimension_id` column is UUID (FK to the old `dimension` table was removed in issue #19). Since the `coffee_dimensions` table now uses SERIAL integers, dimension UUIDs are derived deterministically via `md5(dimension_name)::uuid`. This makes the seed idempotent and consistent without requiring a schema change.

**ideal_score**: Currently the midpoint of min–max (placeholder). Will be calibrated to expert judgement or data-driven averages as cupping data grows.

**Calibration pass (2026-06-12):** Six values corrected after review:

| Archetype | Dimension | Before | After |
|---|---|---|---|
| Balanced & Sweet | Bitterness | 6–8 | 2–5 |
| Chocolate & Nutty | Bitterness | 9–11 | 7–11 |
| Chocolate & Nutty | Texture | 3–5 | 7–11 |
| Earthy | Texture | 9–11 | 10–15 |
| Floral | Bitterness | 3–5 | 1–4 |
| Fruity | Bitterness | 5–7 | 1–4 |

Note: Earthy has no cupping sessions yet so its values are expert judgement only — `avg_actual` will be NULL in `v_archetype_dimension_comparison` until an Earthy coffee is added to a session.

**Schema fix**: Added Earthy, Floral, and Experimental to the `archetype` seed in `schema.sql` — they previously existed only in the production DB (inserted manually). Fresh installs now get all 6 archetypes automatically.

**Two new views added:**
- `v_archetype_vectors` — archetype × dimension with target min/ideal/max
- `v_archetype_dimension_comparison` — same plus `avg_actual` (average cupping score for coffees assigned to that archetype) and `coffee_count`. Bridges `archetype_enum` → `archetype.name` via CASE since the two systems use different identifiers.

---

### 51. The Axis page — full rebuild from `axis v2.docx`
**Strategy**: "Black Box Transparency" — explain the methodology with authority, reveal none of the calibration. Target audience: coffee enthusiasts + busy professionals. Tone: technical authority, warm confidence, no jargon overload.

**Page is fully static** — no API calls, no loading state. `GET /api/axis/vectors` exists and is ready for authenticated/post-quiz use when that feature is built; it is not called by this page.

**Five sections + hero:**

- **Hero** — "Every cup you love has a location. We built a system to find it — and keep finding it, every time." Body copy frames origin-based shopping as guesswork; The Axis changes the question from *where* to *what*.
- **Section 1 — The Problem** — "Coffee is agriculture. Agriculture is seasonal. Your morning isn't." Two-column layout: copy explaining the origin-consistency problem on the left; SVG split visual (map with location pins → clean radar polygon) + italic pull quote on the right.
- **Section 2 — The Inputs** — "Mapping your palate. Mapping the coffee. Two profiles. One coordinate system." Two input cards (your profile via quiz / every coffee via SCA scoring), five archetype cards each with name + 2-line sensory description + mini inline radar SVG showing flavor shape, and an unlabeled concept parallel coordinates chart (five colored lines, hand-coded values — no real calibration data exposed).
- **Section 3 — The Engine** — "Not a filter. A distance." Copy explains multidimensional distance analysis. Three-point explainer: *Proprietary vector mapping · Multidimensional distance analysis · Dynamic rotation*. Subscription callout: "Your subscription doesn't lock you to a coffee. It locks you to a flavor profile." Distance plot SVG (same conceptual match plot — "You" dot + five archetype dots + wheelhouse/exploring rings) on the right.
- **Section 4 — The Feedback Loop** — "The more you drink, the smarter it gets." Three feedback bullets (Sharpen your profile / Refine the coffee's position / Improve the match for everyone). Circular three-node SVG diagram: "You take the quiz" → "We match & deliver" → "You log tasting notes" → back. Editorial callout: *"Most recommendation engines optimize for clicks. Ours optimizes for your palate."*
- **Section 5 — CTA** — "Find your archetype." → `Link` to `/find-my-flavor`. Microcopy: "Free to take. No commitment. Your results are yours."

**Copy source**: `backend/src/axis page/axis v2.docx`. All section headings, subheads, body copy, and callout text taken verbatim or near-verbatim from the doc.

**Terminology used consistently** (per doc): "flavor vector", "flavor space", "sensory archetype", "multidimensional distance analysis", "proprietary vector mapping", "Collaborative Flavor Wheel" (capitalized). Avoided: specific scales, "algorithm" casually, "AI"/"machine learning" without framing, "blend" as positive.

**Files**:
- `frontend/src/app/components/TheAxis.tsx` — fully static page component
- `backend/src/routes/axis.ts` — `GET /api/axis/vectors` (ready, not used by this page)
- `backend/src/index.ts` — route registered as `app.use('/api/axis', axisRouter)`
- `frontend/src/app/App.tsx` — `/the-axis` route inside `PublicLayout`
- `frontend/src/app/components/Navigation.tsx` — "The Axis" as first nav link

---

### 52. Quiz V7 — reordered questions, branch reclassification, scoring bug fixes

**Backend changes:**
- `backend/src/db/schema.sql` — new `quiz_branch` table (text-based, since replaced in #53); V7 seed block deactivates V4 and seeds 6 questions, 15 `quiz_answer_archetype_score` rows, 2 `quiz_branch` rows
- `backend/src/routes/quiz.ts` — `GET /api/quiz/branch` endpoint (text-based response, since replaced in #53); food signal corrected from `qNum === 2` to `qNum === 6`
- `backend/src/services/quizScoring.ts` — veto cascade corrected from `[6,5,3,1]` to `[5,4,2,1]`; `isSecondaryClose` corrected from `byQ[6]/byQ[5]` to `byQ[5]/byQ[4]`

**Frontend changes (`FlavorQuiz.tsx`):**
- New interfaces: `ScoreResult`, `BranchQuestion`
- `ArchetypeKey` extended: `'floral'`, `'earthy'`
- `ARCHETYPES` extended with Floral (`#7b6ca8`) and Earthy (`#5c6b45`) display data
- After `/score`, calls `GET /api/quiz/branch?archetypeId=...`; shows branch screen if question exists
- Branch screen: split-screen "one last thing" layout, two styled answer buttons
- Answer A = keep original archetype; Answer B = reclassify to Floral or Earthy (text-based, replaced in #53)
- `saveQuizResult` deferred until after branch answer (if any) so correct final archetype is saved

**Source file**: `backend/src/quiz/Coffee_Quiz_ScoringV7.xlsx`

---

### 53. Quiz schema normalisation — quiz_type, quiz_answer rename, quiz_branch restructure

**Motivation**: quiz_branch was storing question and answer text as flat TEXT columns, bypassing the question/quiz_answer tables. quiz had no type differentiation between main and branch quizzes. answer was a generic name.

**Schema changes (`schema.sql`):**
- New `quiz_type` lookup table: `'main'` | `'branch'` — 49 tables at this point
- `quiz.quiz_type_id` FK added; existing rows backfilled as `'main'` via `WHERE quiz_type_id IS NULL` (idempotent)
- `answer` renamed to `quiz_answer` — idempotent DO block: `ALTER TABLE answer RENAME TO quiz_answer` only if old name exists; `CREATE TABLE IF NOT EXISTS quiz_answer` covers fresh deploys
- `quiz_branch` restructured: migration DO block drops old text-column version; new normalised structure: `(main_quiz_id, trigger_archetype_id, branch_quiz_id, reclassify_archetype_id)` — `branch_quiz_id` FK to a quiz row of type `'branch'` (later dropped entirely in #54)
- Branch quizzes seeded as proper quiz rows (`v7-branch-floral`, `v7-branch-earthy`) with their questions in `question` and answers in `quiz_answer`; `quiz_answer.resulting_archetype_id` carries the target archetype for each branch answer

**Backend changes (`quiz.ts`):**
- All `FROM answer` / `JOIN answer` → `FROM quiz_answer` / `JOIN quiz_answer`
- `GET /api/quiz/branch` rewritten to join normalised `quiz_branch` (later replaced in #54)

**Frontend changes (`FlavorQuiz.tsx`):**
- `BranchQuestion` interface: `answers: BranchAnswer[]` replaces `confirmAnswerText`/`reclassifyAnswerText`
- `selectedBranchAnswerId: string | null` replaces `branchAnswer: 'A' | 'B' | null`
- `handleBranchContinue` reads `selected.archetypeName` → final archetype; no A/B logic
- Branch screen renders `branchQuestion.answers.map()` — fully data-driven from DB

---

### 54. Drop quiz_branch — branch quizzes self-describe via trigger_archetype_id + parent_quiz_id

**Motivation**: `quiz_branch` was a link table with 4 foreign keys. Since branch quizzes are already quiz rows, they can carry their own relationship columns — no link table needed.

**Schema changes (`schema.sql`):**
- `quiz` table: added `trigger_archetype_id UUID REFERENCES archetype(id)` and `parent_quiz_id UUID REFERENCES quiz(id)` (self-referential FK); both added via idempotent `ALTER TABLE IF NOT EXISTS`
- `quiz_branch` replaced by a DROP DO block — the table is gone (48 tables now)
- V7 seed: branch quiz INSERTs now include `trigger_archetype_id` and `parent_quiz_id` directly; no `INSERT INTO quiz_branch`
- Seed guard updated: `trigger_archetype_id IS NOT NULL` replaces `quiz_type_id IS NOT NULL` check
- Q2 answer texts fixed: periods → em-dashes ("It was strong and satisfying — I felt it." / "…nothing got in the way.")

**Backend changes (`quiz.ts`):**
- `GET /api/quiz/branch` simplified: queries `quiz` directly with `WHERE parent_quiz_id = $1 AND trigger_archetype_id = $2`; `reclassifyArchetypeId` removed from response (unused)

**Frontend changes (`FlavorQuiz.tsx`):**
- `reclassifyArchetypeId` removed from `BranchQuestion` interface

**Migration files (run manually in Cloud SQL Studio):**
- `backend/src/db/migrations/v7_answer_texts_2026_06_18.sql` — two UPDATE statements fixing Q2 texts
- `backend/src/db/migrations/v7_final_2026_06_18.sql` — comprehensive idempotent migration: quiz_type, quiz columns, answer rename, quiz_branch drop, Q2 text fixes, full V7 re-seed with final design

---

### 55. Rename question table to quiz_question

**Motivation**: All quiz-related tables now follow the `quiz_` prefix convention (`quiz_type`, `quiz_answer`, `quiz_question`).

**Schema changes (`schema.sql`):**
- `CREATE TABLE IF NOT EXISTS question` → `CREATE TABLE IF NOT EXISTS quiz_question`
- Idempotent DO block: `ALTER TABLE question RENAME TO quiz_question` (runs only if old name exists)
- All seed INSERTs and JOINs updated throughout schema.sql: `INSERT INTO question` → `INSERT INTO quiz_question`; `JOIN question` → `JOIN quiz_question`

**Backend changes (`quiz.ts`):**
- All `FROM question` / `JOIN question` → `FROM quiz_question` / `JOIN quiz_question`

**View update (`v_quiz_scoring_matrix`):**
- Rebuilt to start from `quiz_answer` (not `quiz_answer_archetype_score`) — all questions now appear including Q6 (food signal, weight 0) and branch questions which have no `quiz_answer_archetype_score` rows
- New columns: `quiz_type` (main/branch), `resulting_archetype` (answer's target archetype), `scored_archetype` (NULL for Q6 and branch answers — expected and correct)
- `JOIN quiz_question` replaces `JOIN question`

**Cloud SQL Studio (one-liner):**
```sql
ALTER TABLE question RENAME TO quiz_question;
```
PostgreSQL automatically updates all FK constraints on `quiz_answer.question_id` and `quiz_answer_archetype_score.question_id`.

---

### 56. Rename answer_archetype_score to quiz_answer_archetype_score

All quiz-related tables now follow the `quiz_` prefix convention: `quiz_type`, `quiz_question`, `quiz_answer`, `quiz_answer_archetype_score`.

**Schema changes (`schema.sql`):**
- `CREATE TABLE IF NOT EXISTS answer_archetype_score` → `CREATE TABLE IF NOT EXISTS quiz_answer_archetype_score`
- Idempotent DO block added: `ALTER TABLE answer_archetype_score RENAME TO quiz_answer_archetype_score` (runs only if old name exists)
- All INSERTs, JOINs, and index definitions updated throughout `schema.sql`

**Backend changes (`quiz.ts`):** All `FROM quiz_answer_archetype_score` / `JOIN quiz_answer_archetype_score` references updated.

**Migration files updated:** `v7_final_2026_06_18.sql`, `v7_normalize_2026_06_18.sql`, `v7_answer_texts_2026_06_18.sql`, `seeds/scoring_v1.sql`

**Cloud SQL Studio (one-liner):**
```sql
ALTER TABLE answer_archetype_score RENAME TO quiz_answer_archetype_score;
```

---

### 57. Rename blend, dimensions, brew_params, coffee_roastery_descriptors

Continued the table naming convention cleanup — all tables now have domain-prefixed names.

| Old | New |
|---|---|
| `blend` | `roaster_blend` |
| `dimensions` | `coffee_dimensions` |
| `brew_params` | `cupping_brew_params` |
| `coffee_roastery_descriptors` | `roastery_coffee_descriptors` |

**Schema changes (`schema.sql`):** `CREATE TABLE IF NOT EXISTS` declarations updated; idempotent DO blocks added for each rename; all `REFERENCES`, `JOIN`, `FROM`, index names, and sequence name (`coffee_dimensions_id_seq`) updated. `blend_id`, `blend_or_single`, and `blend_name` are unchanged — only the `blend` table itself was renamed. (`blend_vector` was renamed to `roastery_blend_vector` in issue #58.)

**Backend changes:** `admin.ts` and `coffees.ts` updated for `coffee_dimensions` and `roastery_coffee_descriptors`.

**Seed file updated:** `roastery_descriptors_session_001.sql` updated for `roastery_coffee_descriptors`.

**Cloud SQL Studio (run all four):**
```sql
ALTER TABLE blend                       RENAME TO roaster_blend;
ALTER TABLE dimensions                  RENAME TO coffee_dimensions;
ALTER TABLE brew_params                 RENAME TO cupping_brew_params;
ALTER TABLE coffee_roastery_descriptors RENAME TO roastery_coffee_descriptors;
```

---

### 58. Rename seven tables — user_ and domain prefixes

Second batch of naming convention cleanup. All tables now follow a consistent `<domain>_<entity>` pattern.

| Old | New |
|---|---|
| `session_coffees` | `cupping_session_coffees` |
| `blend_vector` | `roastery_blend_vector` |
| `client_flavor_feedback` | `user_flavor_feedback` |
| `feedback_event` | `user_feedback_event` |
| `payment_detail` | `user_payment_detail` |
| `recommendation_log` | `user_recommendation_log` |
| `shipment` | `roastery_shipment_details` |

**Schema changes (`schema.sql`):** Idempotent DO blocks added for each rename; all `REFERENCES`, `JOIN`, `FROM`, and index references updated throughout. PostgreSQL auto-updates FK constraints on rename — column names like `session_coffee_id` and `shipment_id` remain unchanged.

**Backend changes:** `admin.ts` updated for `roastery_coffee_descriptors`, `cupping_session_coffees`, `user_flavor_feedback`. `coffees.ts` updated for `cupping_session_coffees`.

---

### 59. The Axis page — V2 rebuild, "Watch the data work"

Rebuilt the public page **The Axis** (`frontend/src/app/components/TheAxis.tsx`, route `/the-axis`, unchanged) per the pre-written spec in `backend/src/features/the_axis_page/CLAUDE_CODE_PROMPT_THE_AXIS_V2.md`, executing the strategy in `THE_AXIS_REDESIGN_STRATEGY.md` (v1.1) and copy in `THE_AXIS_PAGE_COPY_V2.md`. Old V1 build (#51, "Black Box Transparency") is retired in place — both V1 doc files carry a superseded-by banner, kept for reference.

**Strategic shift**: from asserting a finished matching engine to showing a living data system across five lifecycle stages — Capture → Structure → Connect → Consume → Refine — with Liam and the builders' AI both named. Competitive-safety tiers (strategy §2) govern everything rendered: archetype names/colors, aggregate counts, timestamps, and anonymous graph topology are shown; numeric scales, dimension names, formulas, schema/table names, real coffee names, and quiz/adjacency logic are never rendered.

**Files:**
- `frontend/src/app/components/TheAxis.tsx` — full rewrite, 7 sections (Hero, Capture, Structure, Connect, Consume, Refine, CTA), copy verbatim from `THE_AXIS_PAGE_COPY_V2.md`. Scrollytelling via a two-column layout: left column is the 5 scrolling step blocks (each reports its own stage via `motion`'s `onViewportEnter`), right column is a `lg:sticky` `AxisMap`; on mobile the map renders first (`order-1`) as a static preview instead of scroll-jacking. Entry-aware `?archetype=` read via `useSearchParams`, validated against the 5 known keys, passed through to `AxisMap` and used to emphasize the matching one-liner in the Structure section.
- `frontend/src/app/components/axis/AxisMap.tsx` — new. One SVG, seeded synthetic layout (`mulberry32` PRNG, fixed seed) — five archetype clusters in a pentagon, node counts driven by live `coffeeCount`/`connectionCount`/`experimentalCount` from the stats API but positions are generated, never real. States 0–5 per the prompt's spec: breathing idle (0), dim + converging streams with a demo "incoming node" (1), the demo node resolving to its archetype color + region labels appearing (2), edges lighting up + one highlighted walk to a teal-ringed Experimental node (3), three reader chips (Quiz/Profile/Liam) (4), a slow rotating rim + live counters rendered by the parent (5). Respects `prefers-reduced-motion` (crossfade, no idle breathing/rotation loop).
- `backend/src/routes/axis.ts` — added `GET /stats` to the **existing** router (already mounted at `/api/axis` since #51 with `/vectors` and `/adjacency`) rather than the prompt's literal suggestion of a new `axisStats.ts` file, to avoid a second router colliding on the same mount path. Aggregates only: `coffeesMapped` (distinct current `archetype_assignments`), per-archetype counts (joined through `dial_archetype_config.is_archetype` to exclude the Experimental pseudo-archetype), `connectionCount` (distinct undirected pairs in `dial_coffee_relationships`), `regionAdjacency` (straight from `v_archetype_adjacency`), `experimentalCount` (via `coffee_category_assignment`/`coffee_category` code `'experimental'`, not `archetype_assignments`), `bloomNotesThisMonth` (`user_flavor_feedback` this calendar month), `positionsRefinedThisQuarter` (`dial_position_signal` this quarter — currently sparse/dormant per #75, 0 is an honest current value), `lastTightenedAt` (max timestamp across the three source tables). All 8 queries run in parallel via `Promise.all`; any failure falls back to a hardcoded response so the page always renders.
- `frontend/src/styles/theme.css` — 6 new `--color-archetype-*` / `--color-experimental` tokens, provisional hexes sampled from Camila's bag PDF, flagged in a comment for her to confirm.

**Verified this session** (see [[axis_and_bloom_local_cloudsql_testing]] for the Auth Proxy playbook): backend type-checks clean (`tsc --noEmit`), frontend builds clean (`vite build`, 2128 modules), backend booted against real production Cloud SQL via the Auth Proxy — `GET /api/axis/stats` returned real data (29 coffees mapped, matches the known catalogue size, sensible per-archetype/adjacency counts, no coffee IDs/names/dimension data in the payload). Frontend dev server boots and proxies `/api` correctly; `/the-axis` and `/the-axis?archetype=floral` both return 200. Competitive-safety grep audit on `TheAxis.tsx`/`AxisMap.tsx` for retired/banned terms (proprietary vector mapping, multidimensional distance analysis, Collaborative Flavor Wheel, dimension/table column names) came back clean — the one hit in the full production bundle is the pre-existing, out-of-scope `CollaborativeFlavorWheel.tsx` shared component used elsewhere on the site, not this page.

**Not verified this session — no headless browser tool available in this environment**: the actual rendered page was never opened in a browser. The scroll-driven stage transitions, map animations, depth-expander open/close, and `?archetype=` visual highlighting are implemented per spec and the underlying data/routing is confirmed working end-to-end, but Dana should open `/the-axis` in a real browser before this is considered visually signed off.

**Not done — deferred, flagged in the strategy doc itself**: archetype hex colors need Camila's confirmation (comment left in `theme.css`); "Our Method" footnote page (strategy §8 step 5) not written; archetype one-liners in Structure section are compressed from bag copy per the copy doc's own open-review note.

**Follow-up 1 (same session, 2026-07-14) — round-1 refinements from Dana's review**, per `CLAUDE_CODE_PROMPT_THE_AXIS_V2_REFINEMENTS.md` (checklist checked off in that file): (1) archetype region labels now render in every map state, not just from Structure on — muted (~0.5 opacity) in states 0–1, full from state 2; (2) the Capture-state streams are now literal: a field stream of 2–3 dotted arcs each carrying a drifting generic-vocabulary fragment (`cherry`/`jasmine`/`honey process` — fixed picks, never real coffee/roastery names) plus a measurement stream of plain neutral ticks (no numbers), with a "From farm to first measurement." caption; (3) dot-count clamping left unchanged per Dana's explicit decision (no code change); (4) new map state 6 ("Handoff") added and wired to the CTA section only (`ctaInView` gate in `TheAxis.tsx` so the animation mounts — and thus plays — only once the CTA scrolls into view, not on page load): one dot detaches from its archetype region, travels to a landing point, and settles into a flat archetype-colored bag silhouette with "FROM: AXIS & BLOOM" / "TO: YOU" typography (`?archetype=` picks the region/color; absent param defaults to a fixed seeded archetype, not random). The journey's sticky map instance is clamped `Math.min(stage, 5)` so it never itself jumps to the Handoff state meant for the separate CTA instance. Build-verified (`vite build` clean) and dev-server-verified (`/the-axis`, `/api/axis/stats` both 200 after the change); not re-opened in an actual browser — same no-headless-browser-tool limitation as the base build.

**Follow-ups 2–6 (same session, 2026-07-14) — rounds 2–6 of Dana's review**, full detail in each round's own file (`CLAUDE_CODE_PROMPT_THE_AXIS_V2_REFINEMENTS_R2.md` through `_R6.md`, all checklists checked off): R2 restructured the opening into geography → flavor-space (states 0–1 show neutral dots grouped by world sourcing region; state 2 migrates every dot into its archetype region and color — the page's signature moment) and rebuilt the Handoff with real archetype colors matching `Home.tsx`. R3 replaced the geography circles with a hand-simplified world-map silhouette (`worldOutline.ts`), made the Capture streams bolder, and swapped in the real `GENERIC_bag_front_v3_your_archetype.png` bag asset at a larger size. R4 fixed two rendering bugs Dana caught from the live page: the Hero map's viewBox always carried the tall handoff-band aspect even when never showing it (fixed to be stage-dependent), and the bag was blurry from being SVG-scaled (moved to a plain HTML `<img>` overlay, percentage-positioned to track the map). R5 removed the persistent round swatch on the bag (replaced with a thin archetype-colored underline drawing in under "Your Archetype") and tried fully-detached ambient word slots for Capture, which R6 then reverted in favor of words anchored to the first ~40% of each stream's own path with a new cross-archetype vocabulary — both R5 and R6 reused the same deterministic non-overlapping-wave timing technique to cap concurrent visible words. Every round build-verified (`vite build` clean) and competitive-safety-grepped; none opened in an actual browser (same limitation throughout). This is the version pushed to production as commit `6a333ae`, confirmed live via the GitHub Actions `Deploy` workflow and the deployed JS bundle (`AFRICA & ARABIA`, `Bloom Note`, `GENERIC_bag_front_v3`, `honey process` all present).

**Follow-up 7 (2026-07-15) — post-deploy copy fix**: removed "Then come back and watch the map move" from the CTA microcopy (`TheAxis.tsx`) per Dana's request — `THE_AXIS_PAGE_COPY_V2.md` already carried the rationale (added by Dana directly, found already in place when this fix was made): the line implied the quiz itself moves the map, which it doesn't. Microcopy is now just "Free to take. No commitment." Build-verified (`vite build` clean).

**Seed files updated:** `roastery_descriptors_session_001.sql`, `internal_descriptors_session_001.sql`, `session_001_path_2026_05_27.sql`.

**Cloud SQL Studio (run all seven):**
```sql
ALTER TABLE session_coffees        RENAME TO cupping_session_coffees;
ALTER TABLE blend_vector           RENAME TO roastery_blend_vector;
ALTER TABLE client_flavor_feedback RENAME TO user_flavor_feedback;
ALTER TABLE feedback_event         RENAME TO user_feedback_event;
ALTER TABLE payment_detail         RENAME TO user_payment_detail;
ALTER TABLE recommendation_log     RENAME TO user_recommendation_log;
ALTER TABLE shipment               RENAME TO roastery_shipment_details;
```

---

### 59. Fix: quiz endpoint returning branch question instead of main quiz

After the branch quizzes were activated manually (`UPDATE quiz SET is_active = true WHERE version IN ('v7-branch-floral', 'v7-branch-earthy')`), they became the most recently created active rows in the `quiz` table. The `/api/quiz/questions` endpoint selects `WHERE is_active = true ORDER BY created_at DESC LIMIT 1` — which was returning a branch quiz (one question) instead of the main v7 quiz (six questions). Users taking the quiz saw only the single branch question.

**Root cause:** branch quizzes were inserted after the main quiz in the seed, so their `created_at` timestamp is later.

**Fix (`quiz.ts`):** Added `AND parent_quiz_id IS NULL` to both the `/questions` and `/branch` active-quiz lookups. Branch quizzes always have a `parent_quiz_id`; main quizzes have `NULL`. This correctly limits "find the active main quiz" to top-level quizzes only.

```typescript
// Before
`SELECT id FROM quiz WHERE is_active = true ORDER BY created_at DESC LIMIT 1`

// After
`SELECT id FROM quiz WHERE is_active = true AND parent_quiz_id IS NULL ORDER BY created_at DESC LIMIT 1`
```

---

### 60. Fix: admin nav link missing; admin role tables

The Navigation component was not reading `isAdmin` from `AuthContext`, so no "Admin" link ever appeared — even for users with the admin role set in the DB.

**Fix (`Navigation.tsx`):** Pull `isAdmin` from `useAuth()` and conditionally render an `Admin` link at the end of the primary nav when `isAdmin` is true (hidden on mobile like the other nav links).

**How admin role works:**
- `user_type` — reference table; two rows: `admin` and `customer`
- `user_profile.user_type_id` — FK to `user_type`; `NULL` by default for new users
- `grant_admin(email)` / `revoke_admin(email)` — helper functions in `schema.sql`; run in Cloud SQL Studio to promote/demote a user
- `list_admins()` — returns all users currently holding the admin role

At sign-in, `AuthContext` calls `GET /api/users/profile`; the backend joins `user_profile → user_type` and returns `isAdmin: true` if `ut.name = 'admin'`. The nav link only appears once that resolves.

---

### 61. Find My Flavor Part 2 — results screen reveal-timing bug + missing CTAs

Executed the pre-written spec `backend/src/features/find_my_flavor_page/CLAUDE_CODE_PROMPT_FIND_MY_FLAVOR_PART2_RESULTS_SCREEN_REVEAL_AND_CTAS.md` against the just-finished-quiz results screen in `frontend/src/app/components/FlavorQuiz.tsx` (Part 1, #91, had explicitly deferred this exact screen). Two bugs fixed.

**Bug 1 — curtain covered *after* the match was already visible, not before.** For every archetype except Chocolate & Nutty, the curtain's wallpaper `<div>` had no `backgroundColor` fallback — only `backgroundImage`, which paints fully transparent until the ~1MB JPG finishes loading, letting the base layer underneath show through for about a second before the image popped in and the curtain "closed" on top of an already-visible match. Fixed three ways: (1) added an opaque `backgroundColor: '#0a0604'` fallback matching the gradient overlay's own base color; (2) added a `useEffect` keyed on `archetypeKey` that calls `new Image().src = archetype.wallpaper` as soon as the archetype is known — including during the branch question's async round trip, well before the results screen ever mounts — so the image is normally already cached; (3) added a `resetReveal()` helper (scrollTo top, `revealProgress`/`revealForced` reset) called synchronously alongside every `setIsComplete(true)` (in `handleNext`, `handleBranchContinue`, and the tie interstitial's "See my primary result" button), rather than relying solely on the pre-existing `useEffect` keyed on `isComplete` — that effect fires after paint, so a stale non-zero `revealProgress` left over from a prior reveal could paint once before being corrected. Verified with Playwright by delaying the wallpaper request (`page.route`) by 3s: the curtain is fully opaque from the very first paint and stays opaque until the (now-preloaded) image is ready, with no flash at any point, for both the `?result=` preview shortcut and a real end-to-end quiz completion.

**Bug 2 — no CTAs (cart, dial, Liam) on this screen for any archetype except a hardcoded Chocolate & Nutty special case.** The base layer's dial column only rendered a real widget for `archetypeKey === 'chocolate'` — a local `BloomDial` mock (Gentle/Rounded/Structured/Full/Deep `BODY_LEVELS`) feeding a hardcoded "coffee reveal panel" with a "BUY THIS COFFEE" button hard-navigating to `/shop`. Every other archetype got only static description text. Per the spec's hard requirement to reuse existing components rather than fork a local one, replaced the whole base layer with a condensed header (archetype name + `shortDescription`) followed by the full-width `ArchetypeSection` — the exact same component/flow `/bloom` (`BloomPage.tsx`) and this page's own returning-user screen already use, with a separate state instance (`resultsSortOrder`/`resultsRevealedKeys`/`resultsDialRef`/`resultsCompareState`) so it doesn't collide with the returning-user screen's. **The chocolate-only `BloomDial`/`BODY_LEVELS` mock and its `/shop` CTA are retired entirely** — flagging this explicitly per the spec, since it's a real behavior change Dana should confirm she's fine with (the natural reading of "the archetype box as we see it in other pages" already argues for it, and `/shop` is slated for retirement anyway).

**Data-fetching fix, required for Bug 2 to work for guests at all:** the `archetypesList` fetch (`GET /api/coffees/archetypes`) was gated `if (!user) return` — fine for the returning-user screen (signed-in only) but this results screen is reached by guests too, and is most quiz-takers' *first* time here. Ungated the fetch. Also added a fetch of `GET /api/coffees/experimental` (a separate endpoint — Experimental is excluded from `/archetypes` since it's a category, not one of the 5 real archetypes, per `coffees.ts`) since the quiz can score a guest into Experimental. The just-scored archetype is looked up by `archetype_enum`, not reused from the returning-user screen's `matchedData` (which is the signed-in user's previously *saved* profile — stale or absent for a guest); added an explicit `ARCHETYPE_KEY_TO_ENUM` map since this quiz's local shorthand keys (`balanced`/`chocolate`/`earthy`) predate the real `archetype_enum` values (`balanced_sweet`/`chocolate_nutty`/`earthy`) — same naming mismatch already documented and fixed server-side in `users.ts` (#91's investigation).

**Two pre-existing issues discovered while verifying, left alone (out of scope for this part), flagged here for Dana:**
1. The "Retake the quiz" nav item on the returning-user screen (State 1) only calls `setUserName`/`setHasStarted` — it never resets `isComplete` back to `false`, so clicking it while `isComplete` is already `true` from an earlier attempt in the same session falls through to the *old* results screen instead of the question screen. `handleRetake` (which does the correct full reset) exists in the file but isn't wired to anything. This is State 1's territory, not this screen's, so it wasn't touched — but it means the "retake" scenario in this spec's own testing checklist isn't actually reachable through today's UI to verify against; the `resetReveal()` timing fix above was still applied per the spec's instruction since it's correct regardless.
2. The condensed header's archetype name ("Spicy & Earthy", from this file's local `ARCHETYPES` copy) doesn't match `ArchetypeSection`'s own label directly beneath it ("Earthy", from the backend's `ARCHETYPE_LABEL`/`archetypeLabel`) — both are now visible on the same screen for the first time. Pre-existing data/copy divergence between two independent sources of truth, not introduced here; didn't silently pick one to fix.

**Verified:** `vite build` clean (2147 modules). Backend booted against real production Cloud SQL via the Auth Proxy (see [[axis_and_bloom_local_cloudsql_testing]]); `GET /api/coffees/archetypes` (5 rows: `floral`/`fruity`/`balanced_sweet`/`chocolate_nutty`/`earthy`) and `GET /api/coffees/experimental` confirmed. Browser-verified with a disposable Playwright/Chromium install (same pattern as prior sessions): Floral and Chocolate & Nutty and Balanced & Sweet all render the full `ArchetypeSection` (dial, position card, "Reveal the full profile" → cupping notes/Liam intake/Collaborative Flavor Wheel, Add to Cart landing in the real shared `CartContext` floating cart, Compare overlay opening pre-filled) end-to-end as a signed-out guest, both via the `?result=` preview shortcut and via a real click-through quiz completion; mobile "TAP TO REVEAL" confirmed on a 390px viewport.

**Follow-up (same session, 2026-07-16) — fixed both discovered issues, per Dana's explicit follow-up ask, rather than leaving them flagged:**
1. **"Retake the quiz" now actually retakes.** The returning-user screen's nav item only called `setUserName`/`setHasStarted` — it never reset `isComplete`, so clicking it while a prior attempt's results were still in state fell through to the *old* results screen instead of the question screen. Fixed by having that nav item's action also call the pre-existing (previously unwired) `handleRetake()`, which does the full reset (`isComplete`, `showBranch`, `currentStep`, answers, `revealProgress`/`revealForced`, etc.) — `handleRetake` itself needed no changes, it was already correct, just never called.
2. **"Spicy & Earthy" → "Earthy", canonicalized site-wide on "Earthy"** (Dana's explicit direction — the backend's `ARCHETYPE_LABEL`/`archetypeLabel` was already "Earthy" and treated as the correct one; the "Spicy & Earthy" marketing copy was the outlier). Changed every customer-facing occurrence: `FlavorQuiz.tsx` (the archetype's `name`/`shortDescription`, and the tie interstitial's `archetypeNameMap`), `Home.tsx` (the homepage archetype collection + a photo-essay caption), `HowItWorks.tsx`, `About.tsx`, and `Shop.tsx`. Left untouched, deliberately: asset import names/file paths that happen to contain "Spicy" (e.g. `Spicy-&-Earthy.jpg`, `WEBCUTSpicy&EarthyJun04.png` — renaming physical files is a separate, riskier change nobody asked for), `ARCHETYPE_NAME_TO_KEY`'s input-matching entries for `'Spicy & Earthy'`/`'Spicy and Earthy'` (harmless legacy-tolerant lookup keys, not displayed text), and `backend/src/services/claude.ts`'s `RECOMMENDATION_SYSTEM_PROMPT` (still says "Spicy & Earthy: cinnamon, tobacco, cedar, syrupy body") — that's Liam's content-generation prompt, explicitly marked in `SOMMELIER_TASK_6_VOICE.md` as a separate system not to be casually edited outside a dedicated Sommelier task, so it wasn't touched here; flagging it in case Dana wants it aligned too.

**Verified**: `vite build` clean; browser-confirmed the Find My Flavor results screen for `earthy` now shows "Earthy" consistently in both the condensed header and the `ArchetypeSection` label beneath it (previously "Spicy & Earthy" vs "Earthy"). The "Retake the quiz" fix was code-reviewed against the already-correct `handleRetake` implementation but not browser-verified end-to-end — no signed-in test account with a saved archetype was available this session (same limitation noted in prior sessions); Dana should spot-check with a real signed-in account.

---

### 62. Find My Flavor Part 3 — confirmed Part 2 shipped; fixed stale compatibility badge; missing bag image did not reproduce

Executed `backend/src/features/find_my_flavor_page/CLAUDE_CODE_PROMPT_FIND_MY_FLAVOR_PART3_STATUS_CHECK_STALE_PROFILE_AND_BAG.md`.

**Task 0 — confirmed (not assumed) that Part 2 actually shipped.** The spec's premise was that a fresh read of `FlavorQuiz.tsx` that day showed no trace of Part 2. Checked directly rather than trusting either claim: local `git log` shows both #61 commits present and pushed; a live pull of the deployed frontend bundle (`index-htCi59UV.js`, `Last-Modified` timestamped right after the second #61 push) confirms the old mock's strings (`"BUY THIS COFFEE"`, `"SEE YOUR PERSONALIZED COFFEE"`, `"YOUR BLOOM DIAL"`) are gone, `/api/coffees/experimental` and the `chocolate_nutty` archetype-enum lookup are present, and the display field reads `name:"Earthy"` (not `"Spicy & Earthy"`). Part 2 is genuinely live; Dana's read was very likely a caching artifact (repeated testing had the wallpaper image warm, masking exactly the symptom Part 2 fixed), not a missed deploy. No re-implementation needed.

**Task 2 — stale compatibility badge, root cause confirmed by real repro before fixing (not just theory), then fixed.** Signed up a throwaway test account, completed the quiz to Balanced & Sweet, retook it to Floral (the one authored adjacency pair) in the same session, and checked the freshly-scored Floral section's own compatibility badge without reloading: it read **"Worth exploring"** instead of **"In your wheelhouse."** A full page reload immediately self-healed it to the correct badge — proving this was pure front-end state staleness, not a backend write race or a bug in `useCompatibility`/`archetypeAdjacency.ts` themselves (both untouched, per the spec's scope). **Root cause:** `userProfile` (and the `matchedArchetypeId` derived from it, passed as the `userArchetype` prop feeding `useCompatibility` on both the returning-user screen and the Part 2 results screen) only refetched once per `user` object reference — never after `saveQuizResult()`, which was fire-and-forget with no follow-up read. **Fix (`FlavorQuiz.tsx`):** added `refreshUserProfile()` (a plain `getUserProfile().then(setUserProfile)`) and chained it onto all three `saveQuizResult(...)` call sites (`handleNext`, `handleBranchContinue`, the tie interstitial's "See my primary result") via `.then(refreshUserProfile).catch(console.error)`. Re-ran the identical repro post-fix: the same-session, no-reload compatibility badge now correctly reads "In your wheelhouse" for a freshly-scored archetype — confirmed the fix resolves the exact reported symptom, and as a bonus, the badge now also works correctly on a user's very *first* quiz completion (previously absent entirely, since `matchedArchetypeId` was null pre-fix until the next full reload).

**Task 2 regression check:** with the test account still matched to Balanced & Sweet, checked `/bloom`'s Floral and Chocolate & Nutty sections — both correctly read "Worth exploring" (real, live adjacency via `GET /api/axis/adjacency`: `balanced_sweet` is currently adjacent to `floral`, `fruity`, *and* `chocolate_nutty` — more pairs than the spec's own circumstantial claim of "just the one authored pair," confirmed directly against the endpoint rather than assumed) — and Balanced & Sweet's own section correctly reads "In your wheelhouse." Adjacency detection is unaffected by the fix, as expected (the fix only touches freshness of `userArchetype`, not the adjacency lookup itself).

**Task 3 — missing bag image did not reproduce.** Followed the spec's reproduction steps with the same Balanced & Sweet test account: the bag (`BALANCED & SWEET transp.png`) rendered correctly and visibly on both `/bloom` and the returning-user screen at `/find-my-flavor`, with a valid `naturalWidth` (1500) and no failed network requests or console errors tied to the image. Reporting as **not reproducible** rather than silently closing it, per the spec's explicit instruction — most likely a one-off slow load on Dana's end, not a code bug. If it recurs, the next useful data point would be the browser Network tab at the moment it's blank (status code / timing for that specific request).

**Aside, unrelated to this task — flagged, not touched:** mid-session, a second, separate Claude Code session was found live-editing `FlavorQuiz.tsx`/`Home.tsx`/`About.tsx`/`Shop.tsx`/`BloomPage.tsx`/`TasteFinderSection.tsx` on disk (a "Marketing Step 01/A1" rewrite dropping Experimental as a scoreable quiz archetype), which had left the tree in a broken, uncommitted state (`scanExperimental is not defined`). Dana stopped that session; its in-progress changes were preserved via `git stash push -u` (tracked files + the related untracked `backend/marketing/`, `backend/src/features/marketing/`, `frontend/src/features/`, `misc/_to_delete/` directories) rather than discarded, so that work can resume exactly where it left off via `git stash pop` whenever Dana's ready — nothing from it was reverted or merged into this fix.

**Verified:** `vite build` clean. All findings above are from real browser repro via a disposable Playwright/Chromium install and a throwaway signed-up test account (over the Cloud SQL Auth Proxy, see [[axis_and_bloom_local_cloudsql_testing]]) — not assumed from reading code, per the spec's repeated instruction not to patch on theory alone.

---

### 61. Bloom Dial admin UI + backend API

Full management UI for the Bloom Dial feature — positions and navigation graph.

**Backend — 7 new endpoints in `admin.ts`** (all protected by `requireAdmin`):

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/admin/dial/positions` | All positions from `dial_archetype_positions` with coffee name, dimension, vocabulary label |
| GET | `/api/admin/dial/navigation` | Full hop graph from `dial_coffee_relationships` with coffee names |
| GET | `/api/admin/dial/vocabulary` | All vocabulary options with dimension name — used to populate the add-position form |
| POST | `/api/admin/dial/positions` | Add or update a coffee's position (upserts on `archetype + coffee_id` conflict) |
| PATCH | `/api/admin/dial/positions/:id` | Toggle `is_default` |
| DELETE | `/api/admin/dial/positions/:id` | Remove a coffee from the dial |
| POST | `/api/admin/dial/relationships` | Add a directional hop (returns 409 if from/to/dimension/direction already exists) |
| DELETE | `/api/admin/dial/relationships/:id` | Remove a hop |

**Frontend — `AdminDial.tsx` at `/admin/dial`:**
- Two tabs: Dial Positions / Navigation Hops
- Positions grouped by archetype (one section per archetype, shows count)
- Vocabulary dropdown filters by selected archetype — only shows positions valid for that archetype
- Dimension dropdown for hops filtered to the 4 dial-relevant dimensions: Acidity (5), Bitterness (6), Body (7), Savory/Depth (9)
- Default toggle updates immediately via PATCH without a full page reload

**Files changed:**
- `backend/src/routes/admin.ts` — 7 new routes
- `frontend/src/app/components/admin/AdminDial.tsx` — new page component
- `frontend/src/app/App.tsx` — `/admin/dial` route
- `frontend/src/app/components/admin/AdminLayout.tsx` — "Bloom Dial" nav link

---

### 62. Admin sidebar — Bloom Dial removed from Sommelier section

Bloom Dial appeared in both the general section (`NAV_MAIN`) and the Sommelier section (`NAV_SOMMELIER`) of the admin sidebar. Removed the duplicate entry from `NAV_SOMMELIER` — it lives only in the general section now.

**File changed:** `frontend/src/app/components/admin/AdminLayout.tsx` — removed `{ to: '/admin/dial', label: 'Bloom Dial' }` from `NAV_SOMMELIER`.

---

### 63. Roastery catalogue — Path Coffee Roasters + Temecula Coffee Roasters (2026-06-29)

Full coffee catalogue seeded for both roastery partners. Source: `backend/src/db/roasteries notes and conceptual mapping/roasteries notes and conceptual matrix.xlsx`.

**New seed files** (run in order via Cloud SQL Studio):

| # | File | Table | Rows |
|---|---|---|---|
| 1 | `seeds/coffees_path_tcr.sql` | `coffees` | 10 Path (new) + 16 TCR = 26 rows |
| 2 | `seeds/roastery_descriptors_path_tcr.sql` | `roastery_coffee_descriptors` | ~45 new rows (ON CONFLICT skips session 001 dupes) |
| 3 | `seeds/archetype_assignments_path_tcr.sql` | `archetype_assignments` | 5 Path (new) + 16 TCR = 21 rows |
| 4 | `seeds/roaster_blend_both.sql` | `roaster_blend` | 10 Path × 2 sizes + 16 TCR × 2 = 52 rows |
| 5 | `seeds/dial_positions_path_tcr.sql` | `dial_archetype_positions` | 8 Path + 15 TCR = 23 rows |
| 6 | `seeds/coffee_alias_path_tcr.sql` | `coffee_alias` | 25 rows |

**Schema change** (`schema.sql`): New `coffee_alias` table added (idempotent `CREATE TABLE IF NOT EXISTS`).  
`coffee_alias` maps Axis & Bloom platform slot names to the coffees that fill them. Supports priority=1 (Path, preferred) and priority=2 (TCR, fallback). NULL archetype for Half-Caf and Decaf.

**Coffees added — Path Coffee Roasters** (10 new; Crosshatch, Ethiopia, Feather In Cap already existed):  
Colombia, Noam Blend, Nocturnal Dark Roast, Vantablack Ultra-Dark, Honduras, Sleepwalker Half-Caf, Decaf, Vanilla, Hazelnut, Chocolate

**Coffees added — Temecula Coffee Roasters** (all 16 new):  
Breakfast Blend, Blonde Blend, Guatemala, Colombia, Brazil Santos, African Espresso Blend, 6-Bean Espresso Blend, Sumatra, Bali Blue, Uganda, Papua New Guinea, Ethiopia Natural, Costa Rica, Tanzania, Kenya, Kopi Safari

**Skipped / pending:**
- Flavored coffees (Vanilla, Hazelnut, Chocolate) — in `coffees` and `roaster_blend` tables, but skipped from archetype/dial/alias tables (ground-only, need separate handling)
- Kopi Safari — in `coffees`, `archetype_assignments` (experimental), and `roaster_blend`, but skipped from `dial_archetype_positions` (no vocabulary for experimental archetype) and added to `coffee_alias` for "The Unexpected" slot
- "Whiskey Barrel (Rotating)" in coffee_alias experimental Right slot — coffee does not yet exist in DB; add manually when the coffee is added to the catalogue
- `dial_coffee_relationships` (navigation hops between coffees) — do via admin UI after positions are confirmed
- "Whiskey Barrel (Rotating)" experimental slot (`sort_order=3 / Daring`) — add when coffee is in the DB; vocabulary row already exists

**Execution fixes (2026-06-29):**

- `coffees` table had no UNIQUE constraint on `(name, roaster)` so earlier xlsx import attempts had created duplicate rows for some TCR coffees. All seed files updated to use `SELECT MIN(id) FROM coffees WHERE ...` for FK resolution to be safe against duplicates. Roaster/archetype lookups kept as `SELECT id` — those tables use UUID PKs where MIN() doesn't apply and have no duplicates.
- `dial_archetype_positions` had a pre-existing row for Feather In Cap mapped to `chocolate_nutty / sort_order=3 (Richer)` — a leftover from when Session 001 tagged it as Chocolate & Nutty. Deleted manually: `DELETE FROM dial_archetype_positions WHERE archetype = 'chocolate_nutty' AND coffee_id IN (SELECT id FROM coffees WHERE name = 'Feather In Cap')`. Feather In Cap correctly sits in `balanced_sweet / sort_order=2` per the new catalogue.

---

### 64. Experimental archetype added to Bloom Dial (2026-06-29)

`dial_position_vocabulary` previously had no rows for `experimental`, so the Bloom Dial page showed an empty experimental section even though Kopi Safari was assigned that archetype.

**Changes in `schema.sql`** (auto-deploys on Cloud Run startup):
- Added 4 vocabulary rows for `experimental` using **dimension 9 (Savory/Depth)**:

| sort_order | Label |
|---|---|
| 1 | Curious |
| 2 | Adventurous ★ |
| 3 | Daring |
| 4 | Untamed |

- Added idempotent `INSERT INTO dial_archetype_positions` for **Kopi Safari** at `sort_order=2 (Adventurous)`, `is_default=true`.

**Whiskey Barrel (Rotating)** will go at `sort_order=3 (Daring)` when that coffee is added to the catalogue — vocabulary row already exists.

---

### 65. Bloom Dial admin — Default badge, Set Default button, move left/right (2026-06-29)

**Files:** `frontend/src/app/components/admin/AdminDial.tsx`, `backend/src/routes/admin.ts`

**UI changes (AdminDial.tsx):**
- `★ Default` — static dark pill badge (non-clickable). Previously was a button that could accidentally unset the default.
- `Set Default` — terracotta action button, only shown when the coffee is not yet the default for that archetype.
- `← →` arrows flanking the position badge — move the coffee one step left (gentler) or right (bolder) along the dial vocabulary. Disabled and faded when already at the first or last position. Tooltip shows the target label on hover.

**Backend changes (`PATCH /api/admin/dial/positions/:id`):**
- Now accepts both `is_default` (boolean) and `vocabulary_id` (number) in the same endpoint.
- When `is_default: true` is sent, automatically clears the previous default for the same archetype + same roaster before promoting the new one — prevents duplicate defaults per roaster per archetype.
- `vocabulary_id` update powers the ← → move arrows.

---

### 66. Admin — dial positions consolidated into Coffees page (2026-06-29)

**Files:** `frontend/src/app/components/admin/AdminCoffees.tsx`, `frontend/src/app/components/admin/AdminDial.tsx`, `backend/src/routes/admin.ts`

**Problem:** AdminCoffees and AdminDial were duplicating concerns — both touched archetype/dial data for the same coffees, requiring admins to jump between two pages to fully configure a coffee.

**AdminCoffees** now owns everything per coffee:
- New **Dial Position column** on every row: shows `2. Classic ★` with ← → quick-move arrows for one-click position changes without opening the form.
- Inline assignment form (click the archetype badge) now includes: Archetype + Confidence + **Dial Position dropdown** (filtered to selected archetype) + **Set as Default checkbox** + Notes — all saved in one action.
- Changing the archetype in the form resets the dial position dropdown automatically.

**AdminDial** is now **Navigation Hops only** — tab UI removed, Dial Positions section removed, renamed to "Navigation Hops". Empty state note reminds admin to wait for cupping data before adding hops.

**Backend changes (`admin.ts`):**
- `GET /api/admin/coffees` — extended with `dial_vocab_id`, `dial_label`, `dial_position_sort`, `dial_is_default` via LEFT JOINs to `dial_archetype_positions` + `dial_position_vocabulary`.
- `POST /api/admin/coffees/:id/archetype` — now accepts optional `vocabulary_id` + `dial_is_default`. Wrapped in a transaction: supersedes old archetype assignment, deletes all existing dial positions for the coffee (handles archetype change), inserts new dial position, promotes default (clearing previous same-archetype + same-roaster default). All atomic.

---

### 67. Admin Coffees — matrix view with alias slots (2026-07-04)

**Files:** `frontend/src/app/components/admin/AdminCoffees.tsx`, `backend/src/routes/admin.ts`

**Problem:** The flat coffee list was hard to read at a glance — no sense of how the catalogue maps to the Bloom Dial, and coffee aliases were not visible anywhere in admin.

**New layout** mirrors the archetype matrix Excel:
- Six archetype sections (Chocolate & Nutty, Balanced & Sweet, Fruity, Earthy, Floral, Experimental)
- Each section is a bordered table with columns: **Position** (`← Lighter` / `◉ Classic` / `→ Richer`) · **Slot Name** (alias from `coffee_alias`) · **Path Coffee Roasters** · **Temecula Coffee Roasters**
- Coffees with the archetype but no dial position show in an amber-tinted "— no position" row at the bottom of that section
- **Unplaced section** at the bottom shows coffees with no archetype (Half-Caf, Decaf, Flavored) as a flat table with "+ Assign" button

**Per-coffee interactions (visible on hover):**
- Click coffee name → inline edit form expands below that matrix row (archetype, confidence, dial position, default checkbox, notes)
- `← →` arrows for quick one-step position moves
- `↺` to refresh AI content
- `★` marks the default coffee for that roaster + archetype

**Backend:** Added `GET /api/admin/coffee-alias` — returns all `coffee_alias` rows joined to `coffees` (name, roaster, platform_name, archetype, dial_sort_order, priority). Used by the matrix to populate the Slot Name column.

---

### 68. Admin Coffees — delete coffee + unplaced bug fix (2026-07-04)

**Files:** `frontend/src/app/components/admin/AdminCoffees.tsx`, `backend/src/routes/admin.ts`

**Bug fixed:** Coffees with an archetype but no dial position were appearing in both the archetype section's "no position" amber row AND the bottom Unplaced section. Fixed by simplifying `unplaced` to `coffees.filter(c => !c.archetype)` — the Unplaced section is now strictly for coffees with no archetype at all.

**Delete coffee:**
- Added `DELETE /api/admin/coffees/:id` backend endpoint — hard deletes the row; cascades remove archetype assignments, dial positions, and aliases automatically via FK constraints.
- Added "Remove coffee" button to the inline edit form (right-aligned, red text, requires confirmation). Visible when any coffee chip is clicked to edit.

**Architecture note:** Out-of-stock / inventory status (`roaster_blend.inventory_status`) is a separate concern from the coffee catalogue and will live in a future **Admin Blends** page covering SKUs, prices, stock status, and Shopify variant IDs.

---

### 69. Link coffees ↔ roaster_blend, inventory admin page, decrement on order, admin nav reorganization (2026-07-04)

**Files:** `backend/src/db/schema.sql`, `backend/src/routes/admin.ts`, `backend/src/routes/orders.ts`, `frontend/src/app/components/admin/AdminInventory.tsx`, `frontend/src/app/App.tsx`, `frontend/src/app/components/admin/AdminLayout.tsx`

#### The problem
`roaster_blend` (UUID PK — the sellable package variant: weight, SKU, Shopify variant ID, inventory) had no foreign key back to `coffees` (INTEGER PK — the QC/tasting catalogue). They were the same real-world coffee, matched only by informal text name. ~10 tables FK into `coffees`; `order_line_item` and `roastery_blend_vector` FK into `roaster_blend`. Merging them would require rewriting 12 downstream tables for no real benefit — the fix was to link them, not merge.

#### Schema changes (`schema.sql`)
- `ALTER TABLE roaster_blend ADD COLUMN IF NOT EXISTS coffee_id INTEGER REFERENCES coffees(id)` — proper FK link
- `ALTER TABLE roaster_blend ADD COLUMN IF NOT EXISTS last_restocked_at TIMESTAMPTZ` — tracks manual admin restocks separately from `inventory_last_synced_at` (reserved for future automated feed)
- Idempotent name-match backfill: `UPDATE roaster_blend SET coffee_id = c.id FROM coffees c WHERE rb.coffee_id IS NULL AND lower(trim(blend_name)) = lower(trim(c.name))` — safe to re-run on every startup, no-ops once matched. Unmatched rows (flavored coffees etc.) surface in the admin UI for manual linking.

#### Backend routes (`admin.ts`)
- `computeInventoryStatus(qty, buffer)` shared helper: `<= 0` → `out_of_stock`, `<= buffer` → `low_stock`, else `in_stock`
- `GET /api/admin/inventory` — all blends joined to coffee name; unlinked rows sorted first, then by stock level
- `PATCH /api/admin/inventory/:id` — update on-hand qty, reorder buffer, and/or assign `coffee_id` to an unlinked row
- `POST /api/admin/inventory/:id/restock` — adds a positive qty delta, sets `last_restocked_at`, recomputes status
- `GET /api/admin/inventory/coffees-lookup` — coffee name list for the link-assignment dropdown (declared before `/:id` routes to avoid Express swallowing it as an ID param)

#### Inventory decrement on order (`orders.ts`)
The live order path (`POST /api/orders` → `INSERT INTO orders`) now decrements `roaster_blend.quantity_available` for each item in the order, keyed on `item.blendId ?? item.id`. Runs synchronously after the DB insert but is per-item best-effort (a bad blend ID logs and skips, does not fail the order). No hard oversell gate yet — all current seed data has `quantity_available = 0` / `status = 'pending'`, so a gate would block every order today. Blocking oversell is deferred until real quantities are populated via the admin restock tool.

#### AdminInventory page (`AdminInventory.tsx`)
New page at `/admin/inventory`. Blends grouped by coffee name (one group can have a 12oz row and a 5lb row). Unlinked blends (no `coffee_id`) surface at the top with an amber border and "Unlinked — needs coffee assignment" badge.
- Status badges: `in_stock` green / `low_stock` amber / `out_of_stock` red / `pending` neutral gray
- Per-row **Restock** action: inline qty input → `POST /restock`
- Per-row **Edit** action: inline form for on-hand qty + reorder buffer; link-to-coffee dropdown shown only for unlinked rows → `PATCH`
- Re-fetches full list after every mutation (no optimistic updates — matches rest of admin)

#### Admin nav reorganization (`AdminLayout.tsx`)
Replaced flat `NAV_MAIN` + `NAV_SOMMELIER` arrays with grouped sections:
- Dashboard (ungrouped, top)
- **Catalogue & Supply**: Coffees · Roasteries · Supply & Inventory
- **Cupping & QC**: Cupping Sessions · Score Entry · Flavor Wheel
- **Sommelier AI**: Configuration · Intent Editor · Flow & Stats · Bloom Dial

---

### 70. Home page auth-aware CTAs + Blends & SKUs admin page (2026-07-04)

**Files:** `frontend/src/app/components/Home.tsx`, `frontend/src/app/components/admin/AdminInventory.tsx`, `frontend/src/app/components/admin/AdminLayout.tsx`, `backend/src/routes/admin.ts`

#### Home page — sign-in CTAs hidden when already logged in

`Home.tsx` had no awareness of auth state. Three hardcoded "Sign in" links were always visible even after the user logged in — visible in the nav header ("Sign out" present) but still shown in the hero and profile sections.

- Added `useAuth` import and `const { user } = useAuth()`
- **Hero section**: "Sign in →" replaced with "My profile →" (`/profile`) when signed in
- **Profile CTA section**: "Already a member? Sign in →" hidden when signed in
- **Quiz CTA section**: "or sign in →" hidden when signed in

#### Blends & SKUs admin page — rethought for drop-ship model

The original "Supply & Inventory" page (entry #69) was built with stock quantity tracking (On Hand, Reorder Buffer, Restock button) that doesn't apply to the drop-ship model — Axis & Bloom holds no physical inventory. Page redesigned as a **Blends & SKUs** manager:

**Removed:** On Hand column, Reorder Buffer column, Restock action, restock inline form.

**New purpose:** manage the sellable package variants that exist in the DB — link them to the right coffee, keep Shopify variant IDs and roaster SKUs up to date, toggle active/inactive.

- Grouped by coffee (unlinked blends surface first with amber border)
- **Active/Inactive toggle** — clickable status badge; hover colour changes to hint the upcoming action (green→red / gray→green). Calls `PATCH /inventory/:id` with `{ is_active }`.
- **Edit form** per row: Roaster SKU + Shopify Variant ID inputs; coffee-link dropdown shown only for unlinked rows.
- Page description text explicitly states "drop-ship model — inventory quantities not tracked" so the intent is clear.
- Sidebar label updated: "Supply & Inventory" → "Blends & SKUs".
- Backend `PATCH /api/admin/inventory/:id` extended to accept `is_active`, `shopify_variant_id`, `roaster_sku` (all COALESCE-guarded so omitting a field leaves it unchanged).
- Backend `GET /api/admin/inventory` extended to include `shopify_variant_id` in the SELECT.

---

### 71. Blends & SKUs — alias display + fulfillment rank (2026-07-05)

**Files:** `frontend/src/app/components/admin/AdminInventory.tsx`, `backend/src/routes/admin.ts`

**Why:** Each alias slot (e.g. "Classic Chocolate") can have multiple coffees assigned at different ranks — rank 1 is the first-choice fulfillment, rank 2 is the fallback if rank 1 is unavailable, and so on. The page previously had no visibility into this, and no way to edit it.

**Backend:**
- `GET /api/admin/inventory` extended with a LATERAL LEFT JOIN on `coffee_alias` (by `coffee_id`), returning `alias_id`, `alias_name`, and `alias_rank` (the existing `priority` field) per blend. Uses `LIMIT 1 ORDER BY priority` so each blend gets its primary alias assignment without duplicating rows.
- `PATCH /api/admin/coffee-alias/:id` — new endpoint to update `coffee_alias.priority` (fulfillment rank). Validates that priority ≥ 1.

**Frontend — Blends & SKUs group header:**
- Each coffee group now shows: **alias slot name** (e.g. "Classic Chocolate") + **rank badge** ("1st choice ★" in rust, "2nd choice" in gray).
- Clicking the rank badge opens an inline number editor directly in the header row. Saving calls `PATCH /api/admin/coffee-alias/:alias_id` and reloads.
- Coffees with no alias show "No alias slot assigned" in muted gray.

**Fulfillment logic (future):** When a customer orders by alias name, the system tries `priority = 1` first; if that blend is inactive or out of stock, falls back to `priority = 2`, and so on. Rank is currently set manually; future versions will derive it from cupping scores, roaster ratings, or customer feedback.

---

### 72. Blends & SKUs — matrix layout (archetype → position → ranked choices) (2026-07-05)

**File:** `frontend/src/app/components/admin/AdminInventory.tsx`

**Why:** The previous design grouped by coffee, so two coffees competing for the same alias slot (e.g. "Classic Chocolate") appeared as disconnected groups — the 1st/2nd choice relationship wasn't visible. The redesign flips the grouping so alias slots are the primary organizer, matching the mental model: "for Classic Chocolate, try Path first, then TCR as fallback."

**Structure:**
- Grouped by **archetype** (Chocolate & Nutty, Balanced & Sweet, …)
- Within each archetype, grouped by **dial position** (← Lighter, ◉ Classic, → Richer, ⟶ Intense)
- Within each position, the alias slot name is the header; coffees are listed in rank order (1st choice ★ in rust, 2nd choice in gray)
- Each coffee entry shows its blend variants (12 oz / 5 lb) with SKU, Shopify Variant ID, Active toggle, and Edit form
- Rank badge is clickable → inline number editor → `PATCH /api/admin/coffee-alias/:id`
- Blends with no alias slot surface in an amber "No Alias Assigned" section at the bottom

**Data source:** Combines two existing endpoints — `/api/admin/coffee-alias` (for slot/rank structure) and `/api/admin/inventory` (for blend variants) — joined on `coffee_id` in the frontend.

---

### 73. User lifecycle status + order-table migration + homepage CTA fix (2026-07-07)

**Files:** `backend/src/db/schema.sql`, `backend/src/routes/orders.ts`, `backend/src/routes/users.ts`, `backend/src/routes/quiz.ts`, `backend/src/services/userSignals.ts` (new), `backend/src/services/userLifecycle.ts` (new), `backend/src/services/sommelierEvaluator.ts`, `backend/src/services/liamSmsFeedback.ts`, `frontend/src/app/components/Home.tsx`, `frontend/src/app/components/Profile.tsx`, `frontend/src/app/components/OrderFeedbackForm.tsx` (new), `frontend/src/app/lib/api.ts`

**The bug that started this:** a signed-in user landing on the homepage still saw the anonymous "Enter your name" profile-capture form and the "TAKE THE QUIZ" prompt, regardless of whether they'd already quizzed. Root cause: `Home.tsx` sections 2 and 6 rendered unconditionally for every visitor — only the small "sign in" sub-links were gated on `!user`.

**Two deliberately separate systems** (not one shared taxonomy):
- **User lifecycle status** — a business/marketing question ("where does this user stand"), queryable/joinable, with history. Lives in **Cloud SQL**.
- **Sommelier conversation-scoping state** — what Liam should know to open a chat well. Unchanged, still Firestore (`confidence_profile`, `sommelier_evaluations`, `taste_journey`).
They share exactly one thing: `getUserSignals(uid)` — a function, not a shared store. Neither reads the other's output.

**Phase 0 — retired the legacy `orders` table.** It was hand-created outside `schema.sql` and never actually exercised — every checkout attempt failed at the Shopify step (`createOrder()` throws until real Shopify credentials exist) before it ever reached the `INSERT INTO orders`. Rewrote `POST /api/orders` to write to `"order"` + `order_line_item` instead — resolves `user_profile.id` from the firebase UID first (`"order".user_id` is a UUID FK, not a firebase UID string like the legacy table used), snapshots the shipping address onto the order (new columns `shipping_street/city/state/postal_code/country` + `shipping_address_id` convenience pointer) rather than live-referencing `address`, and inserts one `order_line_item` per cart item instead of an `items` JSONB blob. `GET /api/orders` rewritten to match. The real order ID now flows into `schedulePostDeliveryMessage()`, closing the `sommelier_sms_feedback.order_id = null` gap noted in `SOMMELIER_BUILT.md` decision S13. This also fixes `sommelierEvaluator`'s `totalOrders` signal, which silently read 0 for every real customer before this (nothing wrote to `"order"`), which in turn was capping `behavioralConfidence`'s `behavioralValidation` component at its 0.40 neutral default — that component now reflects real order history.

**Phase 1 — three new SQL tables** (`user_lifecycle_stage`, `user_lifecycle_state`, `user_lifecycle_event` — see `WHAT_WE_BUILT_DB.md`). Flat classification, not a state graph — no stage has to be reached before another.

**Phase 2 — shared signals + two independent consumers:**
- `userSignals.ts` — `getUserSignals(uid)` pulls the Stage-1 data collection out of `sommelierEvaluator.ts` (quiz history, order history, behavioral confidence, feedback, demographics) plus new fields the homepage needs: per-order dates, active-subscription flag, and `oldestOrderMissingFeedback` (checked against Firestore `feedback_events.orderId`, any channel — SMS or on-site).
- `sommelierEvaluator.ts` refactored to call `getUserSignals()` instead of inlining its own queries — six-Intent logic unchanged.
- `userLifecycle.ts` — `classifyStage()` (pure function, named threshold constants: `QUIZ_FRESH_DAYS=30`, `QUIZ_DRIFTED_DAYS=180`, `FEEDBACK_WINDOW_START_DAYS=10`, `FEEDBACK_NAG_SUPPRESS_DAYS=14`, `REORDER_GAP_MULTIPLIER=1.5`, `SINGLE_ORDER_LAPSE_DAYS=45` — separate from the Sommelier's Firestore `config/sommelier` thresholds) + `refreshLifecycleState(uid)` (upserts current state, inserts a history row only when the stage actually changes). Wired fire-and-forget from three hooks: quiz results (`quiz.ts`), order placed (`orders.ts`), and feedback captured (both `liamSmsFeedback.ts`'s SMS parser and the new on-site feedback endpoint).
- `GET /api/users/homepage-state` — single indexed join, falls back to a live `getUserSignals()` computation (and persists it) on a user's very first visit before any hook has fired.
- **On-site feedback form** — `POST /api/orders/:orderId/feedback` (ownership-checked), star rating (1–5) computed to sentiment/sValue in plain code — **zero LLM calls**, unlike the SMS path which has to parse free text. Writes the same Firestore `feedback_events` doc shape as `liamSmsFeedback.ts`, plus `source: 'onsite'`, so every downstream consumer treats the two channels interchangeably. Surfaced from `Profile.tsx` order history (`OrderFeedbackForm.tsx`) and from the homepage UC3 nudge.
- **`Home.tsx`** — sections 2 and 6 rewritten. Signed-out visitors see the unchanged name-capture form + quiz CTA (UC0). Signed-in users get a CTA driven entirely by `GET /api/users/homepage-state` (`renderSignedInCTA()`): no-quiz prompt, quiz-taken-with-archetype copy (fresh/settled/stale, quiz de-emphasized once ordered), the feedback nudge with a 14-day localStorage dismiss, subscriber/reorder/lapsed/repeat copy. Section 6's quiz CTA is now gated entirely on `!user` — every signed-in stage already has its own CTA in section 2, so showing it unconditionally would just duplicate/conflict.

**Decisions carried over from the planning doc** (`backend/src/features/customer_life_cycle/1_CLAUDE_CODE_PROMPT_CUSTOMER_STATE.md`) rather than re-litigated: shipping address is a snapshot, not a live FK; the accepted threshold defaults above; no special-casing for admin/roaster accounts on the homepage (same signals-driven CTA as anyone); the on-site feedback form was in scope to build now, not defer; the `totalOrders` fix changing live Sommelier behavior (e.g. `CONVERSION` firing correctly, `behavioralValidation` no longer stuck at neutral) was expected and wanted.

**Not done in this pass:** the doc's test matrix (seed test users covering all 9 stages, verify classification + the sanity `GROUP BY` query) is blocked — the Firebase Admin service account used locally doesn't have the `roles/cloudsql.client` IAM role, and I didn't want to change IAM permissions or run `gcloud auth application-default login` without Dana present. Deferred per Dana's go-ahead. Real UC3/UC4 verification against live checkout traffic also isn't possible until Shopify is wired for real.

### 74. Fixed `FIRST_ORDER_FEEDBACK_PENDING` silently overriding every other lifecycle stage (2026-07-07)

**Files:** `backend/src/db/schema.sql`, `backend/src/services/userSignals.ts`, `backend/src/services/userLifecycle.ts`, `backend/src/routes/users.ts`, `frontend/src/app/components/Home.tsx`

**Found by:** running the #73 test matrix once Dana granted `roles/cloudsql.client` to the Firebase Admin service account (`firebase-adminsdk-fbsvc@axis-and-bloom-prod.iam.gserviceaccount.com`), unblocking the local Cloud SQL Auth Proxy. All 5 order-bearing test scenarios (subscriber, reorder-due, lapsed-single, active-repeat, genuine feedback-pending) landed on `FIRST_ORDER_FEEDBACK_PENDING` — because `classifyStage()` checked it as a mutually-exclusive early-return *before* the subscriber/reorder/repeat checks, with no upper time bound. A real subscriber who never answered the feedback ask on order #1 would be stuck seeing "How was your coffee?" forever instead of their subscription status.

**Root cause, precisely two bugs in one check:** (1) the feedback-pending check was structured as an early return in `classifyStage()`, making it structurally incapable of coexisting with a user's actual standing relationship; (2) it had a lower bound (`FEEDBACK_WINDOW_START_DAYS`) but no upper bound, so it could persist indefinitely. Root cause traced to the original spec (`1_CLAUDE_CODE_PROMPT_CUSTOMER_STATE.md`) describing pending-feedback and standing-relationship status as separate concerns, but the implementation collapsed them into one mutually-exclusive enum value.

**The fix** — documented in `2_CLAUDE_CODE_PROMPT_LIFECYCLE_FEEDBACK_FIX.md`: pending feedback becomes an independent flag, not a stage.
- `classifyStage()` — removed the early-return block entirely; `FIRST_ORDER_FEEDBACK_PENDING` no longer participates in stage classification at all.
- New `getPendingFeedbackOrder(signals)` (`userLifecycle.ts`) — standalone function, checked separately from `classifyStage()`. New constant `FEEDBACK_ASK_EXPIRES_DAYS = 60` bounds it on both ends (SMS already tried at day 10 for orders 1–2; past day 60, further nudging just feels naggy).
- `userSignals.ts` — `OrderSignal` gained a `blendId` field (needed by the new function; previously only derived ad hoc in the route handler).
- `schema.sql` — `FIRST_ORDER_FEEDBACK_PENDING` row deactivated (`is_active = false, homepage_enabled = false`), not deleted — `user_lifecycle_event` rows from testing may already reference it via `from_stage_id`/`to_stage_id`. Any `user_lifecycle_state` row still pointing at it self-corrects on that user's next `refreshLifecycleState()` run — no backfill needed.
- `GET /api/users/homepage-state` — calls `getPendingFeedbackOrder()` unconditionally instead of gating the blend lookup on `stageCode === 'FIRST_ORDER_FEEDBACK_PENDING'`.
- `Home.tsx` — `renderSignedInCTA()` split: a `feedbackNudge` block renders independently above whatever the real stage-specific CTA is (`renderStageCTA()`), instead of replacing it. The dismissal-suppression effect now keys off `pendingFeedback?.orderId` directly rather than `stageCode`.

**Re-verified** with an expanded test matrix (10 scenarios, including a new "feedback ask expired" case): subscriber and reorder-due scenarios now correctly show their real stage *and* `pendingFeedback: true` simultaneously; the genuine feedback-pending scenario shows its real stage (`ACTIVE_REPEAT_USER`) with `pendingFeedback: true`; orders older than `FEEDBACK_ASK_EXPIRES_DAYS` correctly show no pending feedback at all. Idempotency (event rows only added on actual stage change) still holds across a second `refreshLifecycleState()` run.

### 75. Bloom Dial admin reorg — fixed position/archetype desync, added cupping-based suggestion + hop-graph adjacency (2026-07-09)

**Files:** `backend/src/db/schema.sql`, `backend/src/routes/admin.ts`, `backend/src/services/dialSuggestion.ts` (new), `frontend/src/app/components/admin/AdminCoffees.tsx`, `frontend/src/app/components/admin/AdminInventory.tsx`, `frontend/src/app/components/admin/AdminDial.tsx`

Implements all 5 phases of `backend/src/features/bloom_dial/CLAUDE_CODE_PROMPT_BLOOM_DIAL_REORG.md` (full rationale in the companion `BLOOM_DIAL_ALLOCATION_SPEC.md`, same folder). No page was renamed, merged, or removed — Coffees, Blends & SKUs, and the Navigation Hops page (under the "Bloom Dial" sidebar entry) stay at their current routes; what changed is who's allowed to *write* position/priority vs. who just reads it.

**Phase 1 — fixed two real desync bugs:** `dial_archetype_positions`/`archetype_assignments` (edited on Coffees) and `coffee_alias.dial_sort_order`/`archetype` (read by Blends & SKUs) were independent, unsynced columns. `GET /api/admin/coffee-alias` now derives both live from the position/archetype tables, falling back to the stored `coffee_alias` values only for rows with no live position (Half-Caf/Decaf, `archetype = NULL` by design). Separately, `PATCH /api/admin/dial/positions/:id` used to silently overwrite whatever coffee already occupied a target slot; it now swaps the two coffees' `vocabulary_id` values in a transaction when the target slot is taken by another coffee of the same archetype + roaster.

**Phase 2 — moved rank/priority ownership to Coffees:** new `POST /api/admin/coffee-alias` creates an alias row (`dial_sort_order` derived server-side from the coffee's current position — never accepted from the client, keeping the Phase 1 single-source-of-truth rule intact for new rows too). `AdminCoffees.tsx`'s `EditForm` gained the rank-editing badge (moved from `AdminInventory.tsx`) plus a "+ Create alias" control. `AdminInventory.tsx` lost all rank-editing state/handlers — it's read-only for rank/position now, SKU/Shopify/active/restock only.

**Phase 3 — cupping-based dial position suggestion:** `dial_archetype_config` gained `is_archetype BOOLEAN` (true for the 5 real flavor families, false for `experimental` — a cross-cutting category like Decaf/Half-Caf, not a sixth peer archetype; full decoupling is future work, not this pass). New `dialSuggestion.ts` exports `getDialSuggestion(coffeeId)`: computes a suggested dial slot from the coffee's average merged cupping score on its archetype's dominant dimension vs. the archetype's target range (`v_archetype_dimension_comparison`), entirely live, never persisted or auto-applied. Every lookup that can miss data returns `null` rather than guessing. Wired into `GET /api/admin/coffees`. `AdminCoffees.tsx` shows a "Suggested: ... [Apply]" hint when it differs from the current position, or an outlier warning with no one-click apply when the cupping score falls outside the archetype's normal range.

**Phase 4 — connected the hop graph:** `dial_coffee_relationships` (the "Navigation Hops" table) previously fed only Liam's RAG context, despite being designed from the start to eventually inform computed dial positions. New `v_archetype_adjacency` view groups `bridge_archetype` hops by the pair of archetypes their coffees currently belong to (filtered to true archetypes only, per Phase 3a), exposed via `GET /api/admin/dial/archetype-adjacency` and a new read-only summary section on the Navigation Hops page. The "Add Hop" dropdown now shows "Dial Turn"/"Hop" instead of the raw enum text (display-only — `hop_type_enum` values unchanged). `getDialSuggestion` also cross-checks `within_archetype` hops against its own cupping-based ordering claim for the same dimension; a disagreement surfaces as `hop_conflict`, styled the same as the outlier warning, next to the suggestion hint.

**Phase 5 — multi-source signal infrastructure, dormant by default:** new tables `dial_position_signal` (one row per source's opinion, superseded not deleted — same pattern as `archetype_assignments`), `cupping_note_dimension_weight` (table shape only, intentionally empty — populating it means asserting a descriptor genuinely correlates with a dimension, which needs cupping volume that doesn't exist yet), and `dial_source_weight` (`cupping=3`, `sms_feedback`/`onsite_feedback=1`, `roastery_wheel`/`client_wheel=0` until a validated descriptor mapping exists). `recordCuppingSignal(coffeeId)` populates the `cupping` source only — called from `POST /api/admin/scores` after a merged-score save, reusing `getDialSuggestion` so all its null-guards apply here too. New `v_dial_position_consensus` rollup view + read-only `GET /api/admin/dial/consensus/:coffeeId`, not wired into any frontend page. Nothing in this phase writes to `dial_archetype_positions` — that stays fully manual via the Phase 3 Apply action.

**Verified against production Cloud SQL** via the Auth Proxy (see `axis_and_bloom_local_cloudsql_testing` memory): `schema.sql` applies cleanly; `is_archetype` seeds `true` for the 5 real archetypes and `false` for `experimental`; the derived `coffee-alias` query matches `dial_archetype_positions`; `getDialSuggestion` returns sane suggestions for the Session 001 coffees (Crosshatch, Ethiopia, Feather In Cap) and correctly returns `null` for Kopi Safari (`experimental`) and every coffee with no cupping data; `recordCuppingSignal` writes and correctly supersedes `dial_position_signal` rows without touching `dial_archetype_positions` (position count unchanged before/after); `v_dial_position_consensus` mirrors the live Phase 3 suggestion as expected with only `cupping` weighted above zero.

**Not done in this pass (explicitly out of scope):** decoupling "category" from "archetype" entirely (a coffee still can't hold a real archetype and `experimental` simultaneously — see the prompt's out-of-scope list); populating `cupping_note_dimension_weight`, `roastery_wheel`/`client_wheel`, or `sms_feedback`/`onsite_feedback` signals; any auto-write from the consensus view to the live position; dropping the legacy `coffee_alias` fallback columns.

### 76. Bloom Dial follow-up 1 — priority-swap bug, alias editing, hop validation + computed suggestions (2026-07-09)

**Files:** `backend/src/routes/admin.ts`, `backend/src/services/dialSuggestion.ts`, `frontend/src/app/components/admin/AdminCoffees.tsx`, `frontend/src/app/components/admin/AdminInventory.tsx`, `frontend/src/app/components/admin/AdminLayout.tsx`, `frontend/src/app/components/admin/AdminDial.tsx`

Implements `backend/src/features/bloom_dial/CLAUDE_CODE_PROMPT_BLOOM_DIAL_FOLLOWUP_1.md`, gaps found using #75's deployed reorg.

**Phase 1 — fixed a parallel-miss priority-swap bug:** `PATCH /api/admin/coffee-alias/:id` (the Coffees page rank editor) did a plain overwrite with no collision check — the position-swap fix from #75 was never given to the equivalent priority endpoint. Now finds whichever *other* alias occupies the target priority within the same live slot (same derivation as `GET /coffee-alias`: `COALESCE(aa.archetype, ca.archetype)` / `COALESCE(dpv.sort_order, ca.dial_sort_order)`, `IS NOT DISTINCT FROM` for NULL-safety) and swaps in a transaction instead of producing duplicate ranks.

**Phase 2 — alias rename + active toggle *(corrected same day — see below)*:** `PATCH /api/admin/coffee-alias/:id` extended to accept `platform_name`/`is_active` as a partial update alongside `priority`. `AdminCoffees.tsx`'s alias section gained a click-to-edit name field and an active/inactive toggle badge (same visual pattern as blend toggles in `AdminInventory.tsx`). Inactive aliases still display on Blends & SKUs, now with a muted "Inactive" badge rather than disappearing. **`is_active` toggle is correct and final as shipped here** — see the correction below for `platform_name`.

**Phase 3 — nav placement:** moved the "Bloom Dial" sidebar entry from "Sommelier AI" to "Catalogue & Supply" in `AdminLayout.tsx` — no route, label, or page-heading change. Reflects that the hop graph now feeds archetype adjacency and the Coffees suggestion cross-check (#75), not just Liam's RAG.

**Phase 4 — hop validation at creation time:** `POST /api/admin/dial/relationships` now hard-rejects (400) logical contradictions before insert: same coffee on both ends, either coffee missing an archetype, a `within_archetype` hop across two different archetypes, or a `bridge_archetype` hop within the same archetype. Separately, soft-validates (never blocks) the claimed `direction` against real merged cupping data when both coffees have it on that dimension, and flags an existing opposite-direction hop between the same pair — both surface as a `warning` string in the 201 response. `AdminDial.tsx` shows it as a dismissible amber note.

**Phase 5 — computed hop suggestions:** new `GET /api/admin/dial/hop-suggestions` — for every pair of coffees sharing a true archetype with merged cupping data on that archetype's dominant dimension, surfaces a suggested Dial Turn hop when the score delta clears that archetype's own bucket width (same threshold math as the #75 position suggestion), skipping pairs that already have a hop. Cross-archetype (bridge) suggestions are explicitly out of scope — needs real volume in `v_archetype_adjacency` first. `AdminDial.tsx` lists suggestions with a one-click "Add" that pre-fills `POST /dial/relationships` (`hop_type: within_archetype`, `confidence: medium`, an auto-generated note); accepted suggestions disappear from the list (no duplicate).

**Refactor:** extracted `getAvgCuppingScore(coffeeId, dimensionId)` and `getArchetypeBucketWidth(archetype, dimensionId)` as shared exports in `dialSuggestion.ts` — used by `getDialSuggestion`, the Phase 4 hop-validation warning, and the Phase 5 suggestion endpoint, replacing three near-duplicate inline queries.

**Verified against production Cloud SQL** via the Auth Proxy: the priority-swap logic was exercised inside a rolled-back transaction against real alias data (two aliases in the same live slot swapped correctly, then verified restored to their original priorities after `ROLLBACK` — no real data changed); `getAvgCuppingScore`/`getArchetypeBucketWidth` return correct values for known coffees/archetypes; the hop-suggestions computation, run read-only against production, correctly suggested Feather In Cap → Crosshatch on Acidity (delta 4, well above `balanced_sweet`'s ~0.5 bucket width) and correctly produced no suggestion for Ethiopia (the only cupped coffee in `floral`, no pair to compare).

**Correction, same day: Phase 2's `platform_name` rename was scoped to the wrong level.** The rename control above lived inside a single coffee's `EditForm` and wrote through `PATCH /coffee-alias/:id` — but `platform_name` is stored once **per `coffee_alias` row (per coffee)**, not once per slot. Confirmed in the seed data (`coffee_alias_path_tcr.sql`): `'Classic Balanced'` is inserted on *two separate rows* — Feather In Cap (Path) and Guatemala (TCR) — both at `balanced_sweet` / position 2. Renaming through one coffee's row only updated that row, leaving the other coffee at the same slot showing the old name — the same class of drift the whole reorg (#75) started by fixing on `dial_sort_order`/`archetype`, just recreated on `platform_name`. The visible "alias" a user actually clicks is the **"Slot Name" column** in the Coffees archetype matrix, not the per-coffee edit panel.

**Fix:** new `PATCH /api/admin/coffee-alias/slot` (registered ahead of `/coffee-alias/:id` so Express doesn't swallow `slot` as an ID param), body `{ archetype, dial_sort_order, platform_name }`. Identifies every `coffee_alias` row belonging to that slot via the same live derivation `GET /coffee-alias` already uses, and updates all of them in one statement. The "Slot Name" `<td>` in `AdminCoffees.tsx` is now the edit control itself (click → input + Save/Cancel, pencil-icon affordance on hover) — the per-coffee `EditForm` rename control from the first pass is left in place but is now understood to be for the edge case where a coffee's alias intentionally differs from its slot's shared name, not the primary rename path. `is_active` is unaffected by this correction — it's genuinely per-coffee (one fulfillment choice being active or not) and was correctly scoped from the start.

**Re-verified against production Cloud SQL**, again inside a rolled-back transaction: found a real slot (`balanced_sweet` / position 2) with 3 alias rows carrying *inconsistent* names already (`Classic Balanced` ×2, `Bright & Balanced` ×1 — the exact drift this fix addresses), renamed all 3 via the new query, confirmed the row count matched the slot's alias count, then rolled back and confirmed all three were restored to their original names untouched.

### 77. Priority-fallback roaster routing for order fulfillment (2026-07-10)

**Files:** `backend/src/services/blendResolver.ts` (new), `backend/src/routes/orders.ts`, `backend/src/routes/shop.ts`

Confirmed with Dana that the archetype → position → alias/slot → priority-ordered roaster design (the `coffee_alias.priority` convention documented since Task 6: `priority=1` preferred, `priority=2` fallback) was purely a merchandising/admin-display concept — `coffee_alias` was never actually consulted by the real order-placement code (`orders.ts`, `shop.ts`, `shopify.ts` had zero references to it). Roastery accounts aren't connected yet (Shopify remains stubbed), but the routing *logic* doesn't depend on that, so it's built now rather than deferred.

**`resolveBlendForSlot(archetype, dialSortOrder, weightOz)`** — new shared service. Walks `coffee_alias` rows for a Bloom Dial slot in priority order (live-derived the same way `GET /api/admin/coffee-alias` is, so a coffee moved or re-tagged on the Coffees page is picked up automatically), and returns the first coffee with an active, in-stock `roaster_blend` at the requested weight. Returns `null` — never guesses — if nothing in the slot is currently fulfillable, with a `skipped` array explaining why each earlier-priority candidate was passed over (`no active blend at that weight` / `out of stock`).

**`POST /api/orders`** — items can now specify either a direct `blendId`/`variantId` (existing behavior, unchanged) or a Bloom Dial slot (`{ archetype, dialSortOrder, weightOz }`), resolved server-side via the fallback above before Shopify order creation, line-item insertion, and inventory decrement. The response includes `resolvedCoffeeName`/`resolvedRoaster` per item. Fixed a latent bug surfaced by this change: the SMS-feedback-scheduling block read `items[0].blendId` directly, which would've silently resolved to `null` for slot-based items — now reads `resolvedItems[0].blendId`, correct for both item shapes.

**`GET /api/shop/resolve-blend`** — new read-only preview endpoint (`?archetype=&dialSortOrder=&weightOz=`), same resolution, no auth, no side effects. Lets the routing logic be exercised right now even though full order placement is still blocked on Shopify credentials.

**Verified against production Cloud SQL**, using Dana's own example (Chocolate & Nutty / Classic position → alias "Classic Chocolate" → Noam Blend, Path, priority 1; Brazil Santos, Temecula, priority 2) — confirmed this exact relationship is correctly modeled in the DB. Then exercised the resolver by temporarily writing real stock quantities directly (not inside a transaction, since the resolver reads through the connection pool and wouldn't see an uncommitted single-connection transaction) and restoring them in a `finally` block: both in stock → resolves to Noam/Path (priority 1); Noam set to 0 → falls back to Brazil Santos/Temecula (priority 2), with Noam correctly listed in `skipped`; both set to 0 → returns `null`. Original quantities (`0`/`0`) confirmed restored via a follow-up read.

**Also fixed in this pass, then corrected again same day — real root cause was different from the first diagnosis:** the alias name on the Coffees page looked oddly larger than surrounding text. First pass treated it as a `text-sm` vs `text-xs` class mismatch on the per-coffee `EditForm` rename button and fixed that — but the visual bug persisted, because the actual "Slot Name" column button (the primary rename control, per #76's correction) had **no text-size class at all**, not a wrong one. Every other button in `AdminCoffees.tsx` explicitly declares its own `text-xs`/`text-sm` — none rely on inheriting a parent's font-size — because `<button>` elements don't reliably inherit ancestor font-size without an explicit CSS reset, so an unstyled button renders at the browser's default button font size regardless of its container. Found and fixed every remaining instance of this pattern: the "Slot Name" button and its Cancel/error-state siblings, the #75 cupping-suggestion "Apply" button (predating this conversation, same bug), and `AdminDial.tsx`'s hop-warning dismiss button. `AdminInventory.tsx` was already clean.

**Not done in this pass:** actually placing an order end-to-end still fails at the `createOrder()` Shopify call (`shopifyEnabled` is `false` until `SHOPIFY_STORE_DOMAIN`/`SHOPIFY_STOREFRONT_TOKEN`/`SHOPIFY_ADMIN_TOKEN` are set) — unrelated to this fix, tracked separately under "Commerce" below. No frontend cart/checkout UI exists yet to actually send slot-based items; the resolver and the two endpoints above are ready for it.

**Follow-up, same day: rank badge made visible in the matrix, not just on click.** The `coffee_alias.priority` ranking (1st/2nd choice — the same one `resolveBlendForSlot` walks in order) was only visible after clicking a coffee to open its `EditForm`. `CoffeeChip` (used in every Path/Temecula matrix cell in `AdminCoffees.tsx`) now shows a small inline badge next to the coffee name — same visual convention as the `EditForm`'s rank badge (priority 1 = filled brand color, priority 2+ = outlined), read-only in this view. For the Chocolate & Nutty / Classic slot, this now shows "1st" next to Noam Blend and "2nd" next to Brazil Santos directly in the table, no click required.

**Follow-up, same day: dial position description made editable.** `dial_position_vocabulary.description` has existed since the original Bloom Dial build but was never populated, returned by any GET route, or exposed anywhere in the admin UI — only `label` (e.g. "Classic") was ever shown. `GET /api/admin/dial/vocabulary` now also selects it; new `PATCH /api/admin/dial/vocabulary/:id` updates it. The "Position" column in the Coffees archetype matrix is now click-to-edit for the description (same interaction as the Slot Name column: click → textarea + Save/Cancel, pencil-icon affordance on hover), showing "Add description" in muted italic when empty. Verified against production Cloud SQL: read the real Chocolate & Nutty / Classic row (`description` was `null`), wrote a test value, confirmed it persisted, restored the original `null`, confirmed the restore.

**Correction, same day: "edit the position" meant the name itself, not the description.** `PATCH /api/admin/dial/vocabulary/:id` extended to accept `label` alongside `description` as an independent partial update (renaming one never touches the other). The position name in the "Position" column (e.g. "Classic") is now click-to-edit the same way — input + Save/Cancel, pencil-icon affordance. The description control from the entry above is unaffected and stays in place alongside it. Verified against production Cloud SQL: wrote a test label to the real Chocolate & Nutty / Classic row, confirmed the partial-update query left `description` untouched, restored the original label, confirmed the restore.

**Reverted, same day: description editing removed.** Turned out not to be wanted at all — `GET /api/admin/dial/vocabulary` no longer selects `description`, `PATCH /api/admin/dial/vocabulary/:id` is back to label-only, and the description textarea/UI is gone from `AdminCoffees.tsx`. Label rename (above) stays. `dial_position_vocabulary.description` itself is untouched in the schema (was never populated before this detour either).

### 78. Coffee categories: decouple category from archetype (2026-07-10)

**Files:** `backend/src/db/schema.sql`, `backend/src/routes/admin.ts`, `frontend/src/app/components/admin/AdminCoffees.tsx`

Implements `backend/src/features/bloom_dial/CLAUDE_CODE_PROMPT_BLOOM_DIAL_CATEGORIES_DB.md` (design in `BLOOM_DIAL_ALLOCATION_SPEC.md` §6) — the decoupling flagged as out-of-scope future work back in #75. `experimental` was never a true archetype; it's a cross-cutting category, the same kind of thing as Decaf, Half-Caf, or Flavored — none of which were tracked at all before this pass. Several real coffees (Decaf, Sleepwalker Half-Caf, Vanilla, Hazelnut, Chocolate) sat with `archetype = NULL` and no categorization whatsoever, identified only by name.

**Phase 1 — DB:** new `coffee_category` table (admin-extensible, seeded with the 4 known categories; only `experimental` has `is_hoppable = true`) and `coffee_category_assignment` join table (many-to-many — a coffee can carry more than one tag, and a category tag is independent of `archetype_assignments`/`dial_archetype_positions`, no FK between them). Mechanical backfill tagged all 6 known coffees by name (no cupping judgment involved — their actual archetype remains a real tasting decision, not scripted). `dial_coffee_relationships` gained nullable `from_category_id`/`to_category_id` plus `CHECK` constraints requiring exactly one of {coffee, category} per side, and a new `category_hop` value on `hop_type_enum` for these fuzzier, no-single-dimension-score hops. Category-hop *creation* stays SQL-only for now — no admin UI/API — `is_hoppable` is infrastructure for a future Navigation Hops page feature. `POST /api/admin/coffees/:id/archetype` now hard-rejects `archetype: 'experimental'` — the actual assignment-time guard (the `is_archetype` flag from #75 only ever gated suggestion/adjacency logic).

**Phase 2 — Coffees page UI:** new `GET`/`POST`/`PATCH /api/admin/categories` (create/rename/toggle-active — `is_hoppable` never accepted from the client, stays a manual DB decision) and `GET`/`POST`/`DELETE /api/admin/coffee-categories` (per-coffee tagging). On `AdminCoffees.tsx`: a collapsible Categories panel above the archetype matrix (active/inactive toggle pills, "+ Add category" with the code derived client-side from the label), per-coffee tagging checkboxes in `EditForm` (immediate toggle, no separate Save — same pattern as alias active/inactive), and category badges next to the coffee name in both `CoffeeChip` (archetype matrix) and the Unplaced section.

**Verified against production Cloud SQL** via the Auth Proxy: `schema.sql` applied cleanly; `coffee_category` seeded correctly; the mechanical backfill produced all 6 expected assignments; a category-endpoint hop insert succeeded via raw SQL while a double-endpoint insert was correctly rejected by the new `CHECK` constraint (both exercised inside a transaction, then rolled back — confirmed zero `category_hop` rows remain); `v_archetype_adjacency` still runs without error (its existing `INNER JOIN`s + `hop_type = 'bridge_archetype'` filter already exclude category-endpoint/NULL-coffee rows, no view change was needed). Category CRUD (create, rename, deactivate, tag, duplicate-tag, untag) exercised against real data inside a rolled-back transaction — all behaved as designed.

**Not done in this pass (explicitly out of scope):** category-hop creation UI/API (Navigation Hops page, future work); assigning a real archetype to any of the 6 newly-categorized coffees (a cupping/tasting decision, not something to script).

### 79. Coffees page cleanup — DB-driven archetypes, category delete, clearer layout (2026-07-10)

**Files:** `backend/src/routes/admin.ts`, `frontend/src/app/components/admin/AdminCoffees.tsx`

Post-deployment feedback on #78: `AdminCoffees.tsx`'s archetype-assignment dropdown still offered "Experimental" (it was a hardcoded `ARCHETYPE_OPTIONS` const, unaware of the new `is_archetype` flag), there was no way to delete a category outright (only deactivate), and Categories vs. Archetypes weren't visually distinct on the page.

**DB-driven archetypes:** new `GET /api/admin/archetypes` — `dial_archetype_config` joined to the `archetype` table's human labels via the same enum→name `CASE` bridge already used in `v_archetype_dimension_comparison`. `AdminCoffees.tsx` fetches this once and derives two views: the full list (matrix section headers) and an `is_archetype`-filtered list (the assignment dropdown — no longer offers `experimental`). The hardcoded `ARCHETYPE_OPTIONS`/`ARCHETYPE_LABEL` consts are gone.

**Category delete:** new `DELETE /api/admin/categories/:id` — `coffee_category_assignment` rows cascade automatically (`ON DELETE CASCADE`, already in place from #78); a category still referenced by a `dial_coffee_relationships` hop (no cascade there, by design) is blocked with a clear `409` instead of a raw FK error. Each category in the UI is now a row (label + Active/Inactive toggle + Remove) instead of a toggle-only pill.

**Clearer layout:** an "Archetypes" heading now sits above the matrix; Categories moved out of a collapsible mid-page panel down to its own clearly-labeled section at the bottom of the page, with a one-line description of what it is.

**Follow-up, same day: `experimental` still looked like an archetype.** Even after the dropdown fix above, the Archetypes section still rendered a full "Experimental" position table (Kopi Safari's legacy dial position + alias) — visually indistinguishable from a real archetype's table, just sitting under the "Archetypes" heading. The per-archetype position table (Position/Slot Name/Path/Temecula grid) was extracted from its single inline `.map()` into a standalone `renderArchetypeSection(archValue, archLabel)` function, reused in two places: the Archetypes section (`is_archetype = true` only — the 5 real archetypes) and, new, inside the Categories section itself, right below the plain category list — today just `experimental`, since it's the only category still carrying its own `dial_position_vocabulary`/`dial_archetype_positions`/`coffee_alias` data (Decaf/Half-Caf/Flavored are plain tags with no position system of their own). Confirmed unchanged: a coffee like Vanilla — real archetype `balanced_sweet` plus a `Flavored` category tag — still shows under Balanced & Sweet in Archetypes with a Flavored badge; only `experimental` gets the dedicated-table treatment, moved to sit under Categories instead of Archetypes.

**Verified against production Cloud SQL:** the `/archetypes` query returns all 6 archetypes with correct labels and `is_archetype` flags (`experimental` correctly `false`, the other 5 `true`); category delete cascades to assignments correctly and is correctly blocked (`23503`) when a hop references the category — both tested inside a rolled-back transaction, confirmed no leftover data.

**Reverted, next day: `experimental` restored as an assignable archetype option.** The `POST /coffees/:id/archetype` guard added in #78 turned out to be a real regression, not a cleanup — the "Experimental" table under Categories (added in the follow-up above) is still driven by `archetype_assignments`/`dial_archetype_positions`, the exact same mechanism as a real archetype, and it never got its own placement path through the `coffee_category` system. Blocking `archetype: 'experimental'` left no way to place any coffee into that table going forward — only the legacy Kopi Safari row could ever appear there. Backend guard removed; frontend `assignableArchetypeOptions` is the full archetype list again. The Categories-vs-Archetypes section split (`is_archetype`, `renderArchetypeSection`) is unaffected — `experimental` still renders under Categories, only the ability to *assign* it is restored.

---

### 80. The Bloom — Part 1 backend: dial_slot_price, roaster-blind endpoints, hop navigation (2026-07-11)

**Context:** First half of a two-part build for a new customer page, The Bloom (`/bloom`) — a drop-ship-safe merge of `/coffees`' flavor intelligence and `/shop`'s archetype-grouped commerce shell. Full spec in `backend/src/features/the_bloom_page/CLAUDE_CODE_PROMPT_THE_BLOOM_PART1_BACKEND.md`. Part 2 (`BloomPage.tsx` itself) follows in #81+.

**Schema:** new `dial_slot_price` table (`archetype`, `dial_sort_order`, `weight_oz`, `retail_price_cents`) — retail price per Bloom Dial slot, per weight. Named to group with the existing `dial_*` table family (renamed from an earlier `slot_price` draft). Not on `coffee_alias` (no weight dimension) or `roaster_blend` (would let two roasters fulfilling the same slot show two prices for the same weight). Defaults applied at the query level when no row exists: **$38.00/12oz, $199.00/5lb (80oz)**.

**New admin endpoints (`admin.ts`):** `GET`/`PATCH /api/admin/slot-prices` — upsert on `(archetype, dial_sort_order, weight_oz)`. `AdminCoffees.tsx`'s matrix table gained a "Price (12oz / 5lb)" column next to Slot Name, same click-to-edit pattern as the existing Slot Name/vocabulary-label editors.

**New public, roaster-blind endpoints (`coffees.ts`, `shop.ts`):**
- `GET /api/coffees/archetypes` — every archetype × every position in its dial vocabulary (not just occupied ones, so "Temporarily unavailable" positions render too). `coffeeId` per position is resolved via the existing `resolveBlendForSlot` (stock-aware, priority-ordered) — never statically pinned to the priority-1 alias row, so notes/dimensions shown always match the coffee that will actually ship. Never returns `roaster` or a raw coffee name.
- `GET /api/shop/slot-availability?archetype=&dialSortOrder=&weightOz=` — thin roaster-blind wrapper over `resolveBlendForSlot`, returns only `{ available, weightOz }`. `GET /resolve-blend` (the existing internal diagnostic) is untouched.
- `GET /api/coffees/:coffeeId/hops` — Bloom Dial hop navigation. Derives the *target's live slot* (its archetype/position may have moved since the hop was recorded — never trusts the stored `to_coffee` association alone), drops any hop whose target isn't currently active (a dead end otherwise), `is_recommended` only, ordered by confidence high→medium→low, capped at 3. Never includes `to_coffee`'s id, name, or roaster.

**Leak fix:** `/:id/flavor-wheel` (shared with `/coffees`) was selecting and grouping by `coffee_name` even though the bubble-cloud UI never uses it — dropped from the query. `GET /api/coffees` (the flat list) is intentionally left untouched per Decision #2 in the spec; it still leaks roaster/name but that's `/coffees`' own known, deferred issue, not in scope here.

**Verified against production Cloud SQL** (same rolled-back/reverted pattern as #75-77): `dial_slot_price` creates cleanly, `UNIQUE(archetype, dial_sort_order, weight_oz)` rejects a duplicate; the admin upsert SQL inserts then updates the same row correctly. **Real finding, not a bug:** every `roaster_blend` row in production currently has `quantity_available = 0` — nothing is in stock anywhere right now, so a first pass of `/api/coffees/archetypes` showed `isActive: false` everywhere. Confirmed the stock-aware logic itself is correct by temporarily bumping two real rows: priority-fallback resolves correctly in both directions (falls back to priority-3 when priority-1 is out of stock; prefers priority-1 once it's back in stock), price defaults apply correctly and an explicit `dial_slot_price` row correctly overrides them, `slot-availability` respects per-weight stock independently, and the hops endpoint correctly drops a target with no dial position (Ethiopia — archetype assigned but no `dial_archetype_positions` row) and a target that's out of stock, then correctly resolves and labels a real active hop (Crosshatch → Feather In Cap) with zero roaster/name leakage. All mutations reverted immediately after each check. Regression check: `GET /api/coffees`, `/:id/dimensions`, `/:id/content` all unaffected.

**Flagged, not fixed (out of scope per spec — spec only asked to check, not fix):** `ai_summary`/`surprise_note`/`three_voice_story` are generated by prompting Claude with the coffee's literal internal name (`getCoffeeSummary`/`getCoffeeSurpriseNote`/`getCoffeeThreeVoiceStory` in `claude.ts` all take `coffeeName` as the prompt subject), so cached content *could* echo the raw coffee name — a real risk for Bloom's "Liam's intake" display in Part 2, since these fields are otherwise unsanitized. One coffee spot-checked didn't mention its name, but that's not a structural guarantee across all cached content. Worth a closer look before Part 2 ships this content on `/bloom`.

---

### 81. The Bloom — Part 2 frontend: BloomPage.tsx, shared informational-layer components, cart/checkout, compare overlay (2026-07-11)

**Context:** Second half of the two-part build started in #80. Full spec in `backend/src/features/the_bloom_page/CLAUDE_CODE_PROMPT_THE_BLOOM_PART2_FRONTEND.md`. `/bloom` is now live alongside `/coffees` and `/shop` — neither existing page was touched beyond the shared-component extraction and one secondary link (below).

**Shared informational-layer components** (`frontend/src/app/components/coffee-info/`) — extracted out of `CoffeesPage.tsx` so `/coffees` and `/bloom` never fork this logic: `DimensionBars.tsx`, `CollaborativeFlavorWheel.tsx` (renamed from "Flavor notes" — Decision, shared with #8), `useCompatibility.tsx` (badge + dimension-divergence copy), `TastingNotes.tsx` (surprise note + three-voice story + collapsible "Liam's intake", renamed from "AI tasting note" per Decision #8, with an optional "Explore the full flavor breakdown →" link — only rendered on Bloom, since `/coffees` already is that destination). `CoffeesPage.tsx` now imports all four; its own copies were deleted. **Side effect, expected and confirmed working**: the "Liam's intake"/"Collaborative Flavor Wheel" labels now also show on `/coffees`.

**`BloomPage.tsx`** (`frontend/src/app/components/BloomPage.tsx` + `frontend/src/app/components/bloom/`): Camila's `Shop.tsx` archetype shell preserved (alternating photo layout, same brand images via `bloomVisuals.ts` — same files, unmodified, `loading="lazy"`/explicit dimensions added below the fold per Phase 2's image-performance requirement). The hardcoded coffee teaser is replaced with one `PositionCard` per position from `GET /api/coffees/archetypes`:
- **Active**: collapsed heading (position label + platform name) + one-line teaser (first sentence of `surprise_note`), per-weight price/availability (fetched via `GET /api/shop/slot-availability`, independently per weight — a slot can be `isActive` on the canonical 12oz check but have zero real availability once checked per-weight, in which case the card degrades to the unavailable state, per spec), Add to cart, Compare. Reveal expands in place: `TastingNotes` → `DimensionBars` → `CollaborativeFlavorWheel` → compatibility badge → up to 3 Bloom Dial hop links (`GET /api/coffees/:coffeeId/hops`), same order as `/coffees`.
- **Temporarily unavailable**: position label + greyed badge only, no controls — Decision #3.

**Hop navigation**: clicking a hop link sets that slot's revealed state and scrolls to it (`scrollIntoView`), working both within an archetype section and across to a different one (target slot key is looked up via a ref registry keyed by `${archetype}_${dialSortOrder}`).

**Compare overlay** (`bloom/CompareOverlay.tsx`): modal, not an inline page state — opens pre-filled with the card that was clicked, a picker for any other active slot, stacked `DimensionBars` + side-by-side `CollaborativeFlavorWheel`, no editorial content (matches `CoffeesPage.tsx`'s existing compare-mode convention of hiding notes).

**Cart + checkout** (`bloom/FloatingCart.tsx`): in-memory only (no `localStorage`), persists across scroll via a fixed floating icon + item count. Checkout reuses `POST /api/orders`'s existing slot-based item contract (`{archetype, dialSortOrder, weightOz, quantity}`, already wired since #77) via `placeOrder()` in `lib/api.ts` (broadened to accept slot-based items alongside the existing `variantId` shape). Signed-out users see "Sign in to check out" linking to `/sign-in?redirect=/bloom`. Order confirmation renders only from the cart's own `platformName`/`retailPriceCents`, never the API response's `resolvedCoffeeName`/`resolvedRoaster`.

**Routing/nav**: `/bloom` added to `App.tsx`; "The Bloom" added to `Navigation.tsx` next to "The Axis" (no links removed); secondary "Already know your archetype? Browse The Bloom →" link added beneath `TheAxis.tsx`'s existing flavor-quiz CTA.

**Verified in a real browser** (Playwright against the local dev server, backend pointed at production Cloud SQL via the Auth Proxy, same temporary-stock-bump-then-revert pattern as #80's testing): archetype sections render with real hero/bag art; every position correctly showed "Temporarily unavailable" against real (all-zero-stock) production data; temporarily bumping two real `roaster_blend` rows produced a genuine active card — confirmed single-weight price display (no selector shown when only one weight is available, per spec), reveal/collapse, Collaborative Flavor Wheel bubble cloud with real descriptors, Add to cart → floating cart badge/line item/subtotal, and the Compare overlay opening correctly scoped to the clicked card. Zero console errors on `/bloom`, `/coffees`, `/shop`, `/the-axis`. Regression confirmed: `/coffees` still fully functional (a coffee with real data showed both renamed labels correctly; a coffee with no cupping data correctly showed its pre-existing "No tasting data yet" empty state — not a regression). `/shop` and `/the-axis` unaffected except the one new secondary link. Stock bumps reverted immediately after.

**Real leak found, not fixed here (flagged in #80, now confirmed with an actual example):** revealing the "Classic — Classic Chocolate" card during testing showed a Liam's intake reading *"**Brazil Santos** is a comforting cup with rich dark chocolate and roasted hazelnut notes..."* — the AI-generated content literally names the internal coffee. This is a genuine drop-ship violation on `/bloom` (customers must never see raw coffee names), caused by `getCoffeeSummary`/`getCoffeeSurpriseNote`/`getCoffeeThreeVoiceStory` (`backend/src/services/claude.ts`) prompting Claude with the literal `coffeeName`. Fixing it means either regenerating cached content with the prompt keyed to platform name instead of coffee name, or a runtime sanitizer — both are judgment calls (regenerating rewrites content already reviewed/cached; a sanitizer is fragile string-matching) that Part 1/2's scope explicitly deferred ("check, not fix"). **Flagging as a pre-launch blocker for The Bloom**, not shipping silently patched.

**Not done in this build** (spec-scoped, not overlooked): real Shopify checkout (stub still throws `Shop not yet available`, surfaced to the user as a graceful "Checkout isn't live yet" message rather than a crash); a full in-page address form for checkout (currently uses the customer's existing saved default address from Profile — if none exists, checkout shows an error directing them to add one).

---

### 82. Fixed the #81 coffee-name leak at its root, plus a second real leak found in the same audit (2026-07-11)

**Context**: `backend/src/features/ai_agent_liam/SOMMELIER_TASK_6_VOICE.md` was updated with a new Step 2b specifically to chase down the leak flagged in #81. Full detail in `SOMMELIER_BUILT.md` S38 — summarized here since the customer-facing symptom was on `/bloom`.

**Fix 1 — the actual #81 bug**: `getCoffeeSummary()`/`getCoffeeSurpriseNote()`/`getCoffeeThreeVoiceStory()` (`backend/src/services/claude.ts`) build their prompt around whatever `coffeeName` they're given — left completely unchanged, per the task doc's explicit constraint. The fix is at the only call site, `fetchCoffeeDataForContent()`/`generateAndStoreAllContent()`/`generateAndStoreSummary()` (`backend/src/routes/coffees.ts`): now fetches the coffee's active `coffee_alias.platform_name` and passes `displayName ?? archetypeLabel ?? 'This coffee'` instead of the raw `coffees.name`.

**Fix 2 — a second, separate leak found during the same audit**: `sommelierRag.ts`'s `buildCatalogText()` was injecting the raw roastery name (`c.roaster`) and the raw coffee name directly into Liam's system prompt context on every single session — not a generated-text bug, a structural one, relying entirely on the base prompt's "never reveal" instruction (Task 6, S35) as the only safety net. Removed `roaster` from the `CoffeeRow` type and all six SQL blocks in the file; added `getAliases()` (same pattern as the file's existing `getDescriptors()`); the catalog line is now alias + archetype only.

**Verified against production Cloud SQL**: spot-checked all 13 coffees with cached content — all 13 contained the raw coffee name pre-fix. Regenerated all 13 with the fixed code path; re-checked — 12/13 clean, one false positive (substring match on an unrelated word in Claude's own text, not a real leak). Full detail, including the one coffee that now needs real cupping data before it can get a proper tasting note, in `SOMMELIER_BUILT.md` S38.

---

### 83. The Bloom Part 3 — stock-check fix, generalized Bloom Dial, per-user personalization (2026-07-11)

**Context**: post-launch fix + redesign pass based on Dana's first live look at The Bloom. Full spec in `backend/src/features/the_bloom_page/CLAUDE_CODE_PROMPT_THE_BLOOM_PART3_DIAL_AND_FIXES.md`. Three things surfaced: no coffees appeared anywhere (every position "Temporarily unavailable"), the informational layer + "Add to cart" never appeared as a direct consequence, and Dana wanted the stacked position-card list replaced with the existing Bloom Dial wheel component from the quiz result screen.

**Phase A — the actual root cause, confirmed and fixed**: `resolveBlendForSlot` (`backend/src/services/blendResolver.ts`) was skipping any candidate with `roaster_blend.quantity_available <= 0` — but this is a drop-ship model where inventory quantities are explicitly not tracked (`WHAT_WE_BUILT.md` #70), so that column sits at its schema default of 0 on effectively every row in production. Every slot resolved to nothing, for both display *and* real order routing (`POST /api/orders` uses the same function). Removed the quantity check entirely — fulfillability is now `is_active = true` + a row existing at the requested weight, full stop. `SkippedCandidate['reason']` loses the `'out of stock'` variant. `orders.ts`'s inventory decrement on order placement is untouched and now simply writes to a field nothing reads.

**Phase B — generalized `BloomDialWidget.tsx`** (new file, `frontend/src/app/components/`): same draggable/snapping-wheel mechanics as `FlavorQuiz.tsx`'s `BloomDial` (untouched — that component stays hardcoded to Chocolate & Nutty/Body for its own use case), generalized to `N = positions.length` positions (not hardcoded 5), any archetype, driven entirely by data. Rotation convention standardized and enforced by the same angle math across every archetype: clockwise increases `dialSortOrder` ("more" of the dimension), counter-clockwise decreases it ("less") — verified by dragging in a real browser against real data (Chocolate & Nutty: clockwise moved Classic → Richer correctly). A "← Lighter" / "{dimension} →" cue sits above the wheel so the direction is legible before a first drag. Exposes a `rotateTo()` imperative handle (via `forwardRef`/`useImperativeHandle`) for hop-driven rotation.

**New backend fields, additive on `GET /api/coffees/archetypes`**: `dimensionName`/`dimensionPlatformName` per archetype (from `dial_archetype_config.dominant_dimension_id` — the same column `dialSuggestion.ts` already reads for this purpose, not re-derived from `dial_position_vocabulary`) and `description` per slot (from `dial_position_vocabulary.description`, gracefully omitted where empty — confirmed empty everywhere in production right now, a content gap flagged for later, not authored here). New `coffee_dimensions.platform_name TEXT` column — same public-alias pattern as `coffee_alias.platform_name` — seeded for all 5 numeric dimensions currently in play: Acidity → **Brightness**, Bitterness → **Boldness**, Body → **Intensity**, Savory / Depth → **Complexity**, Finish Length → **Finish**. Sweetness and Texture stay null on purpose (already plain English); the three free-text dimensions (Fragrance, Aroma, Flavor, Finish Character, Mouthfeel) aren't used for dial/bar axes and stay unseeded. Every value COALESCEs back to the raw name where unset. Direct-SQL-only for now — no dimension admin UI exists yet to edit it from.

**Phase C — wired into `BloomPage.tsx`**: each archetype section now renders one `BloomDialWidget` + one dynamic `PositionCard` for whichever position is currently dial-selected (`selectedSortOrder` state lifted to `BloomPage`, keyed per archetype), replacing Part 2's stacked list entirely. Hop navigation now rotates the target archetype's dial (`dialRefs.current[archetype]?.rotateTo(dialSortOrder)`) and auto-reveals the resulting card, scrolling to the archetype section for bridge hops — same idea as Part 2's scroll-and-reveal-in-stack, adapted to the new interaction model.

**Phase D — per-user dial memory**: new standalone `user_bloom_dial_position` table (`PRIMARY KEY (user_id, archetype)`) — deliberately **not** a repurposing of `user_archetype_tuning`/`archetype_tunable_variable`, which are reserved for a different, computed, feedback-derived confidence signal, even though the key shape coincidentally matches. New `requireAuth` endpoints `GET`/`PATCH /api/users/dial-position`. The widget pre-sets to the signed-in user's saved position on load (via a separate effect that seeds `BloomPage`'s `selectedSortOrder` state directly, rather than round-tripping through the widget's own `onSelect`, so the initial sync never triggers a spurious save); every real snap — drag or hop-triggered — calls `setDialPosition()` automatically, no save button. Signed-out visits stay session-only, unchanged from Part 2.

**Verified against production Cloud SQL and in a real browser**: the archetypes endpoint now shows real active coffees across every archetype with zero manual stock bumps needed (direct confirmation the root cause diagnosis was correct) — e.g. Chocolate & Nutty "Classic Chocolate"/"Deep Cocoa" both active, dimension label correctly reading "DIMENSION: INTENSITY". Directly re-verified `resolveBlendForSlot` — the exact function `POST /api/orders` depends on — now resolves a real slot whose underlying `roaster_blend` row genuinely has `quantity_available: 0, is_active: true`, proving order routing is fixed too (a full authenticated HTTP order placement wasn't performed — no test user credentials available in this session — but the only thing that changed, and the only thing gating both display and order routing, was verified directly). `user_bloom_dial_position`'s upsert SQL verified directly (insert then update, exactly one row, no duplicates). In-browser: dragging the Chocolate & Nutty wheel clockwise correctly moved Classic → Richer (Deep Cocoa); reveal/informational layer works unchanged on the dial-driven card; a hop click executed without error (this specific coffee's only hop happens to loop back to its own current slot — a real data artifact from two coffees sharing one slot, not a bug); zero console errors throughout. `FlavorQuiz.tsx` confirmed completely untouched (`git diff` empty).

**Not done in this build** (spec-scoped): writing missing `dial_position_vocabulary.description` copy (content task, flagged not authored); a dimension admin edit UI for `platform_name` (none existed before this pass either).

---

### 84. Dimension aliases completed; compatibility badge wired to real data instead of three hardcoded frontend tables (2026-07-12)

**Context**: Dana asked directly whether everything shown in the Bloom UI actually comes from the DB. Audit found three real hardcoded-data spots (distinct from the intentional, spec'd static brand assets in `bloomVisuals.ts` — colors/photos/bag art, which stay local imports by design).

**1. Dimension aliases completed**: the coworker's Part 3 doc update specified all 5 numeric dimensions, not just Body. Seeded: Acidity → **Brightness**, Bitterness → **Boldness**, Body → **Intensity**, Savory / Depth → **Complexity**, Finish Length → **Finish**. Verified live: each archetype's dial now shows the correct word (Earthy → "DIMENSION: BOLDNESS", Floral → "DIMENSION: COMPLEXITY", etc.).

**2. `ARCHETYPE_TYPICAL` (hardcoded cupping-midpoint ranges, used to generate "this coffee has more/less X than your usual archetype" text) replaced with live data** from the existing `GET /api/axis/vectors` endpoint (built for The Axis page, reads the real, calibrated `archetype_vector`/`v_archetype_vectors`). New `coffee-info/archetypeVectors.ts` — a `useArchetypeVectors()` hook with a module-level fetch-once cache (shared across every card instead of one request per card).

**3. `ARCHETYPE_ADJACENT` (hardcoded "which archetypes are adjacent" map, used for the "Worth exploring" compatibility tier) replaced with live data — but not from `archetype_relationship`.** That table is confirmed empty (0 rows) in production and unused. Per Dana's direction ("use what Liam is using, and hop in admin page"), the new `GET /api/axis/adjacency` endpoint reads **`v_archetype_adjacency`** instead — the same hop-derived, admin-curated view already shown on the Bloom Dial admin page (`AdminDial.tsx`) and fed by real authored bridge hops (`dial_coffee_relationships`). Confirmed real data: `balanced_sweet ↔ floral` (hop_count 2, avg_confidence 3.00). No fallback constant — a pair with no bridge hop authored yet honestly shows no adjacency rather than a guess. New `coffee-info/archetypeAdjacency.ts` mirrors the same fetch-once-cache pattern.

**4. `BloomDialWidget`'s "← Lighter" cue was literal hardcoded text** on every archetype's dial regardless of that archetype's real lowest position (e.g. Earthy's is "Gentle", not "Lighter"). Now reads the real label from the sorted position list (`sorted[0].label`).

Both `useCompatibility.tsx`'s pure functions (`getCompatibility`, `getDimensionComparison`) now take the live maps as parameters instead of reading module-level constants — `ARCHETYPE_LABEL`/`ARCHETYPE_COLOR` (still legitimate static label/color constants, not data) moved to a new `coffee-info/archetypeConstants.ts` to avoid a circular import between `useCompatibility.tsx` and the two new data hooks.

**5. Follow-up — hop navigation link wording didn't match the dial's own vocabulary.** `GET /api/coffees/:coffeeId/hops` (`coffees.ts`, built in Part 1 before `coffee_dimensions.platform_name` existed) returned the raw dimension name (`cd.name`, e.g. "Body"), so a hop link would read "less body" right next to a dial reading "DIMENSION: INTENSITY" for the same dimension. Changed the query to `COALESCE(cd.platform_name, cd.name)`, same pattern as everywhere else this column is read. Verified live: the same real hop (coffee 3 → `balanced_sweet` position 2) now reports `dimensionName: "Intensity"` instead of `"Body"`.

**Verified against production Cloud SQL and in a real browser**: both new endpoints return real data; Earthy's dial screenshot confirmed showing "← GENTLE" / "BOLDNESS →" (both real); zero console errors on `/bloom` and `/coffees`.

---

## What's Still To Do

### The Bloom — pre-launch blocker
0. ~~AI-generated content leaks raw coffee names (confirmed, #81)~~ — **fixed, see #82.** `fetchCoffeeDataForContent()` now passes the coffee's alias instead of its raw name into `getCoffeeSummary()`/`getCoffeeSurpriseNote()`/`getCoffeeThreeVoiceStory()`; all 13 previously-cached records were regenerated and re-verified clean against production Cloud SQL.

---

### 85. The Bloom Part 4 — Liam links, dial legibility/personalize tag, full-width reveal panel, mobile layout fix (2026-07-12)

**Context**: post-launch polish pass from Dana's review of the live Part 3 build. Spec in `backend/src/features/the_bloom_page/CLAUDE_CODE_PROMPT_THE_BLOOM_PART4_POLISH.md`.

**Phase A — "Talk to Liam" links.** `TastingNotes.tsx` gained a second optional link prop (`talkToLiamLink`, same pattern as the existing `exploreLink`) so both links render together with consistent styling; Bloom passes `talkToLiamLink="/sommelier"`. `FloatingCart.tsx` gained a second floating button (outlined, secondary treatment vs. the solid cart button) at `right: 96` linking straight to `/sommelier` — `/sommelier` is already `RequireAuth`-gated in `App.tsx`, so the existing sign-in-redirect flow just handles it, no new gating logic needed.

**Phase B — dial legibility.** Wheel reduced from `clamp(180px, 20vw, 280px)` to `clamp(130px, 14vw, 190px)`. Direction-cue text (`← {label}` / `{dimension} →`) bumped from `0.48rem`/opacity 0.5 to `0.58rem`/0.65; position description bumped from opacity 0.46 to 0.68. The separate "DIMENSION: ___" line removed entirely — the alias already appears in the direction-cue row.

**Phase C — "Personalize your {archetype}" tag.** New `archetypeLabel` prop on `BloomDialWidget`; renders as an eyebrow above the direction-cue row, styled identically to the existing `No. {num}`/archetype-label pair in `BloomPage.tsx` (same `letterSpacing`/opacity), not a new style.

**Phase D — full-width reveal panel (structural).** The revealed informational layer was nested inside the ~40%-wide position-card column, making it "long and narrow." Extracted the fetch/derived state that used to live entirely inside `PositionCard.tsx` into a new shared hook, `bloom/usePositionCardData.ts`, called once per archetype section in `BloomPage.tsx`'s `ArchetypeSection` and passed down as props to two now-separate pieces: `PositionCard.tsx` (collapsed header + commerce row only, unchanged content) and a new `bloom/RevealedPanel.tsx` (the informational layer — notes/Liam's intake, dimension bars, Collaborative Flavor Wheel, compatibility badge, hop links — unchanged order/content) rendered as a full-width sibling *after* the three-column row closes, not inside any column of it. One fetch, two consumers — avoids double-fetching the same coffee data.

**Mobile layout fix, not in the original spec — found during testing.** The three-column row (`flex-direction: row`/`row-reverse`) had zero responsive breakpoint at all; at a phone viewport every column overlapped illegibly. Converted photo/dial/card columns to stack vertically below Tailwind's `md:` breakpoint (`w-full` mobile, `md:basis-[34%]`/`md:basis-[26%]`/`md:flex-1` desktop, same proportions as before), matching this project's existing `md:` convention rather than inventing a new one. Also fixed two smaller mobile issues found in the same pass: `CompareOverlay.tsx`'s top "This one"/"Compare with" grid was hardcoded 2-column with no mobile stack (its lower dimension/flavor-wheel grid already had one); `FloatingCart.tsx`'s cart panel had a fixed 360px width with no viewport-relative cap, close to overflowing on the narrowest real phones (e.g. 375px).

**Verified in a real browser against production Cloud SQL, both flip orientations and mobile**: "DIMENSION:" confirmed gone site-wide; "Personalize your X" tag present on all 6 archetype sections; floating Liam button present and correctly positioned; "Talk to Liam about this coffee →" appears in the revealed panel; reveal/collapse confirmed clean (no leftover full-width block, section height dropped from 1726px to 773px on collapse, commerce row unaffected); full-width reveal panel confirmed in both non-flip (Chocolate & Nutty) and flip (Fruity) row directions. At a 390px phone viewport: archetype sections stack cleanly top-to-bottom with no overlap, revealed panel and both new Liam links render correctly, Compare overlay stacks to one column and fits the viewport, zero horizontal page overflow, zero console errors (aside from expected 429s from this session's own repeated local testing, not a real issue).

### 86. The Bloom Part 6 — balance the photo/dial/card row, close the gap before the reveal panel (2026-07-12)

**Context**: Dana's direct visual feedback on the live Part 4 build (`Capture.JPG`) — in the three-column row (photo `md:basis-[34%]`, dial `md:basis-[26%]`, card `md:flex-1`), the photo column (full hero + two small photos stacked) ran significantly taller than the dial and card columns beside it, leaving them looking small/stranded with blank space, and pushing `RevealedPanel` (which sits full-width *after* the row closes, per Part 4) down behind a large empty gap.

**Fix**, `BloomPage.tsx`'s `ArchetypeSection` photo column: narrowed `md:basis-[34%]` → `md:basis-[27%]`; replaced the hero's `aspectRatio: '4/3'` sizing with an explicit `height: 320` (kept `objectFit: 'cover'` so it crops rather than distorts) and the two small photos' `aspectRatio: '1/1'` with `height: 155` each — explicit heights were needed because at this column's width, the aspect-ratio-derived natural height was already *below* the dial column's height, so a `maxHeight` cap alone had no effect (it only ever engaged if the natural height exceeded it). Removed `md:sticky md:top-[100px]` from the photo column — confirmed with Dana it wasn't intentional/load-bearing. The 320/155 split was tuned by measuring the dial column's actual rendered height (≈482px, from Part 4's wheel `clamp(130px,14vw,190px)` + bag `maxHeight:160`) and matching the photo column to it, per the spec's instruction to treat the dial column as the target rather than adjusting the dial/card columns to match the photo.

**Verified in a real browser against production Cloud SQL**: photo/dial column bottoms now land within 2px of each other (measured 480px vs 481.7px) across both flip orientations (`fruity`, `balanced_sweet`) and 4 other archetypes' hero images (crops confirmed intentional, no important content cut off); `RevealedPanel` now renders with exactly zero gap after the row (`row.bottom === panel.top`, confirmed both numerically and visually in the revealed state); the card column remains shorter than the other two, which is expected/unchanged (Part 6 only targets the photo-vs-dial imbalance, not card content). Re-checked at a 390px phone viewport: stacked layout unchanged from before this part, zero horizontal overflow, zero console errors.

### 87. The Bloom Part 7 — move the bag between the dial and card, close the remaining gap (2026-07-12)

**Context**: Dana's screenshot (`Capture3.JPG`) still showed a gap between the archetype row and the expanded `RevealedPanel` after Part 6. Part 6 balanced photo-vs-dial by capping the photo, but the dial column's own height was still dictated by the bag image stacked underneath it — a hard-to-predict target to size the photo against. Spec in `backend/src/features/the_bloom_page/CLAUDE_CODE_PROMPT_THE_BLOOM_PART7_BAG_REPOSITION.md`.

**Phase A — reposition the bag**, `BloomPage.tsx`'s `ArchetypeSection`: removed the bag `<img>` from beneath `BloomDialWidget` — the dial column is now just the dial. Added the bag as a new sibling of `PositionCard` inside the card column's own flex sub-row (`flex-col`/`md:flex-row` or `md:flex-row-reverse`, mirroring the outer row's `flip`), with `alignItems: 'stretch'` so the bag's wrapper height automatically tracks `PositionCard`'s actual rendered height with no hardcoded pixel guess — `objectFit: 'contain'`, `max-h-[190px]` on mobile (no stretch context there) and `md:max-h-full` at the desktop breakpoint. DOM order is always `[bag, PositionCard]`; the sub-row's own flex-direction (not DOM order) flips per archetype so the bag lands on whichever side of the card actually faces the dial in both orientations. On mobile this also means the bag renders directly above the card, not stranded near the dial.

**Phase B — re-balanced the photo column against the new tallest group.** Measured in a real browser (not guessed): with the bag gone, the bare dial column is 314px — taller than the card group's 293px (h2 + bag/card sub-row, bag and `PositionCard` both stretched to 220px), contrary to the spec's guess that bag+card would be tallest. Photo column's hero/small-photo heights scaled down proportionally from Part 6's 320/155 to 210/100 (kept the same ratio, same `objectFit: 'cover'`) to land at ~315px, matching the dial.

**Verified in a real browser against production Cloud SQL**: photo/dial/card column heights measured 315/314/293px across 5 of 6 archetypes (314→284 for `experimental`'s shorter wheel — a pre-existing per-archetype variance, not something this pass changes); bag renders at a proportionate, non-stretched size beside the card for all 6 archetypes (bag artwork aspect ratios vary but all read as intentional); `RevealedPanel` gap confirmed exactly zero (`row.bottom === panel.top`, both numerically and via screenshot matching `Capture3.JPG`'s Fruity case) for Fruity and re-checked after Floral; correct bag-faces-dial placement confirmed in both flip orientations (Floral non-flip: bag sits left of card, right of dial; Fruity flip: bag sits right of card, left-facing the dial — mirrored via the sub-row's own `flip`-driven flex-direction, not DOM order). At a 390px phone viewport: DOM/visual order is photo → dial → heading → bag → card (bag directly above its card, not near the dial), zero horizontal overflow. Console/page-error check across all 6 archetypes with panels expanded: zero errors.

### 88. The Bloom Part 8: bag size, CTA clarity, deep-linked flavor intelligence, shipping note (2026-07-12)

**Context**: four fixes from Dana's latest screenshot review, on top of Parts 1–4 and 7. Spec in `backend/src/features/the_bloom_page/CLAUDE_CODE_PROMPT_THE_BLOOM_PART8_FIXES.md`.

**Phase A — bag was too small.** Part 7 repositioned the bag beside the card but sized its container to a 15%-of-card-column basis, which worked out to a narrow sliver. `BloomPage.tsx`: changed the bag column's basis from `md:basis-[15%]` to `md:basis-[clamp(130px,14vw,190px)]` — the exact same formula Part 4 used for the dial wheel — so the two now read as equally-weighted elements side by side; bumped the image's own `maxWidth` from 75% to 92% of that box. Measured 160×160px rendered across all 6 archetypes (up from the previous ~74–98px sliver).

**Phase B — CTA clarity.** `TastingNotes.tsx`'s explore/Talk-to-Liam text links: added a `border-top` + more top padding so the pair reads as a distinct actions row instead of trailing off the AI-summary paragraph above, plus a leading icon per link (🧭 explore, 💬 Talk to Liam — the same emoji already used for the floating Liam button, for visual consistency). `FloatingCart.tsx`'s floating Talk-to-Liam button: added a `group`-hover/focus tooltip pill ("Talk to Liam text) that fades in to the button's left — accessible `aria-label` was already correct, this only adds a *visible* label for sighted first-time visitors, same pattern as the icon-only cart button would need if it ever loses its badge context.

**Phase C — deep-linked flavor-intelligence CTA.** Root cause confirmed in code: `exploreLink="/coffees"` was a hardcoded string in `RevealedPanel.tsx`, always landing on `CoffeesPage.tsx`'s default selection (`useState<number | null>(null)`, which resolves to the first coffee once the list loads) regardless of which archetype/coffee the customer was reading about. Fix: `RevealedPanel.tsx` gained a `coffeeId` prop (passed from `BloomPage.tsx` as `currentSlot.coffeeId`, a value already fetched for this slot, not a new lookup) and now builds `` `/coffees?coffee=${coffeeId}` ``; `CoffeesPage.tsx` reads a `coffee` search param via `useSearchParams` (same pattern as `FlavorQuiz.tsx`'s `?result=` preview param) on its initial coffee-list fetch, and pre-selects it if it matches a real coffee ID, falling back to the existing first-in-list default otherwise. **Found and reverted during testing**: an initial version also called `scrollIntoView` on the matching sidebar button to "show the selection in the sidebar" per the spec's optional suggestion — this actively broke the page, since the sidebar and detail panel share one page-level scroll region (no independent sidebar scroll container), so scrolling to a button near the bottom of the 29-coffee list dragged the actual detail panel (the entire point of the deep link) completely out of the viewport (confirmed via `window.scrollY` jumping to 1972px, panel blank on screen). Removed that scroll call — the sidebar's border/background highlight already reflects the selection whenever visible, and the detail panel now correctly renders at the top of the page on load, which is what actually matters for a deep link.

**Phase D — shipping note.** `PositionCard.tsx`: added `"Price includes shipping"` as a quiet `text-xs`/`#a09880` line beneath the commerce row (price/weight buttons, Add to cart, Compare), wrapped the row in its own flex div so the note sits below rather than wrapping into it.

**Verified in a real browser against production Cloud SQL**: bag renders at a consistent 160×160px across all 6 archetypes (up from the earlier undersized version), reads as comparably prominent to the dial wheel; actions-row separator/icons and the floating button's hover tooltip confirmed visually; `exploreLink` hrefs confirmed parameterized per-archetype (`/coffees?coffee=11` for Floral, `/coffees?coffee=30` for Fruity, not hardcoded to one case) and confirmed the linked coffee ("Tanzania", Fruity) actually renders at the top of `/coffees` with matching tasting-note text; no-param and invalid-param cases both correctly fall back to the pre-existing first-coffee default (`coffee-sidebar-23`), matching unchanged prior behavior; shipping note renders cleanly under the commerce row without crowding the buttons, confirmed on both desktop and a 390px mobile viewport. Zero horizontal overflow on mobile, zero console/page errors (aside from expected 429s from this session's own repeated local testing).

### 89. The Bloom Part 9: card width, unavailable-state design, fixed photo height (2026-07-12)

**Context**: three related fixes from Dana's latest screenshots (Fruity — active position, text/buttons wrapping; Balanced & Sweet — "Lively" position, temporarily unavailable, rendering as a small stray pill). Diagnosis: Part 7's photo column was tuned by measuring a neighbor's height and matching it, and that neighbor's height isn't constant between the active and unavailable card states — plus Part 7's bag placement had eaten into the card column's own width. Spec in `backend/src/features/the_bloom_page/CLAUDE_CODE_PROMPT_THE_BLOOM_PART9_ROW_POLISH.md`.

**Phase A — card gets its width back.** `BloomPage.tsx`: bag's container changed from `md:basis-[clamp(130px,14vw,190px)]` (a wide flex share, sized to match the dial's *footprint* per Part 8) to `md:w-[clamp(90px,9vw,120px)] md:flex-none` — a tight intrinsic-width box. Height is unaffected (still stretches to the card's height via the parent row's existing `alignItems: 'stretch'`), so the bag keeps its Part 8 prominence vertically while giving the card column back the horizontal room it needs.

**Phase B — redesigned the "Temporarily unavailable" state**, `PositionCard.tsx`: replaced the small `flex items-center justify-between` pill-in-empty-space with the same structural weight as the active card — rounded border, comparable padding, `minHeight: 176` (real box presence rather than collapsing to minimal content height), title + `slot.description` (when present) + the "Temporarily unavailable" badge, vertically centered. Dropped the previous whole-box `opacity: 0.65` dimming, which read as "broken" more than "intentional" — muted text/background colors alone (unchanged from before) already communicate the inactive state. The archetype `<h2>` heading itself was never conditionally styled on card state; its "displaced" look in the screenshot was purely a side effect of the tiny unavailable box leaving a large height mismatch next to the photo/dial columns — fixed structurally by giving the box real height, not by touching the heading.

**Phase C — fixed photo column height**, `BloomPage.tsx`: measured live rather than assumed (same methodology as Part 7) — confirmed the dial column's height is already state-invariant (314px whether the current position is active or unavailable), and Part 7's fixed pixel values (210/100) already landed close to that. Per the spec's explicit instruction to anchor to *the active card's* typical height specifically (not the dial), re-measured the active card group's total height post-Phase-A/B (319px) and updated the hero/small-photo heights from 210/100 to 213/101 to match precisely. Net visual change is small (~4px) since the prior values were already close, but the value is now deliberately anchored and documented rather than an artifact of Part 7's dial-matching process.

**Verified in a real browser against production Cloud SQL**: Fruity's "Balanced — Bright & Tart" now reads on 2 lines (was 3), weight buttons side by side, Add to cart/Compare on one row — confirmed via direct DOM measurement, not just visual inspection. Simulated a real drag gesture on Balanced & Sweet's dial (mouse down/move/up, not a shortcut) to reach the "Lively" position and confirmed via its own live label ("Lively · Temporarily unavailable") that the correct state was reached; the redesigned unavailable card now measures 176px tall with real border/padding/centered content, vs. the previous tiny pill, and the "Balanced & Sweet" heading sits in its normal large position and size, unmoved. Photo column height confirmed exactly 319px across all 6 archetypes and both the active and unavailable position states (state-invariant, per Phase C's goal) — spot-checked Floral's naturally longer title ("Perfumed & Expressive") wrapping to 3 lines at the same card width as Fruity's 2; confirmed this is pre-existing text-length variance unrelated to Part 9, not a regression, since the width fix (Phase A) was already applied when measured. Bag still renders with real vertical presence (244px tall active / 176px unavailable, both well above the dial's own footprint) despite the narrower width cap — Phase A's regression check. Mobile (390px) and both flip orientations (Fruity flip, Balanced & Sweet non-flip) confirmed clean: zero horizontal overflow, zero console/page errors.

### 90. The Bloom Part 10: extracted `ArchetypeSection`, shared `CartContext` (2026-07-13)

**Context**: prep work for reusing Bloom's per-archetype block on other pages — starting with Find My Flavor's returning-user screen (a separate, not-yet-started task in `find_my_flavor_page/`). This is the part of the long-dormant `CLAUDE_CODE_PROMPT_THE_BLOOM_PART5_REUSE_ON_QUIZ.md` (written and confirmed with Dana, never executed) that's genuinely about Bloom's own code — extracting the reusable piece and lifting cart state out of page-local state — not about building the Find My Flavor consumer itself. Spec in `backend/src/features/the_bloom_page/CLAUDE_CODE_PROMPT_THE_BLOOM_PART10_ARCHETYPE_SECTION_REUSE_PREP.md`.

**Phase A — extracted `ArchetypeSection`.** Moved the per-archetype block (header row + photo/dial/card row + full-width `RevealedPanel`) and its `computeDefaultSortOrder` helper out of `BloomPage.tsx` into a new `frontend/src/app/components/bloom/ArchetypeSection.tsx`, exported, carrying over Parts 6–9's row-layout/bag-position fixes unchanged — a pure extraction, no logic changes. Added the one new prop the spec calls for: `showPhoto?: boolean` (default `true`). When `false`, the photo column is omitted entirely; no extra flex-basis math was needed to "redistribute" the row, since the dial column's basis is already fixed (`26%`) and the card column is already `flex:1` — removing the photo div lets the card's existing flex-1 absorb the freed width automatically. `BloomPage.tsx` now imports `ArchetypeSection`/`computeDefaultSortOrder` from the new file instead of defining them locally, passing `showPhoto` unset (defaults `true`, zero visual change on `/bloom`).

**Phase B — shared `CartContext`.** Created `frontend/src/app/context/CartContext.tsx`, relocating `BloomPage.tsx`'s existing cart state and add/remove/checkout logic verbatim into a provider (same in-memory shape, no `localStorage`). The checkout flow's shipping-address/customer-name lookup moved with it as its own `getUserProfile()` call inside the provider, rather than trying to share `BloomPage`'s separate `userArchetype` fetch — keeps the cart provider self-contained and usable on any page, at the cost of one small duplicate profile fetch when both are mounted together. `CartProvider` wraps the whole router tree in `App.tsx` (nested inside `AuthProvider`, since it depends on `useAuth()`) — the simplest option that covers `/bloom` and `/find-my-flavor` both, per the spec. `FloatingCart` promoted from a `BloomPage.tsx`-local render to a layout-level one in `PublicLayout.tsx` (alongside `NewsletterModal`), so every public page now shares one consistent cart UI automatically — `BloomPage.tsx` no longer renders it itself, just consumes `useCart()` for `addToCart`.

**Verified in a real browser against production Cloud SQL**: `/bloom`'s Fruity row measured pixel-identical to Part 9's known-good heights (photo 319 / dial 314 / card 319) and the reveal-panel gap is still exactly 0 — confirming the extraction is behavior-identical, not just "looks the same." Cart regression: added an item from `/bloom`, confirmed the layout-level `FloatingCart` badge updated and the panel auto-opened, removed it, confirmed it emptied — all through the new `CartContext`, not the old page-local state. Spot-checked that `CartProvider` now wrapping the entire router tree didn't break any other public page — Home, Find My Flavor, About, and Flavor Intelligence all load with zero console/page errors. Mobile (390px) re-checked on a non-flip archetype (Floral): pixel-identical to prior sessions, zero horizontal overflow.

**Not done, explicitly out of scope for this part**: embedding `ArchetypeSection` on `/find-my-flavor` itself, or any change to `FlavorQuiz.tsx` — that's `find_my_flavor_page`'s Part 1, which has this part as its prerequisite. No changes made to `RevealedPanel.tsx`, `PositionCard.tsx`, `BloomDialWidget.tsx`, `CompareOverlay.tsx`, or `usePositionCardData.ts` beyond what the extraction itself required (none were needed).

### 91. Find My Flavor Part 1: returning-user screen redesign, `?tab=` support on Profile, archetype-key bug fix (2026-07-13)

**Context**: redesign of the returning-user state of `frontend/src/app/components/FlavorQuiz.tsx` (`/find-my-flavor` — the screen a signed-in user with an existing archetype sees). Spec in `backend/src/features/find_my_flavor_page/CLAUDE_CODE_PROMPT_FIND_MY_FLAVOR_PART1_RETURNING_USER_REDESIGN.md`, building on #90's `ArchetypeSection` extraction + shared `CartContext`.

**Layout — deviated from the spec's literal two-column ask, for a concrete reason.** The spec described a persistent left column (profile text + embedded `ArchetypeSection`) beside a sticky right-column nav. Measured this directly at every width tried: at a 50/50 split (720px available) `ArchetypeSection`'s card column shrank to ~108px; even reserving only ~340px for the nav and giving the rest to `ArchetypeSection` (1100px), the collapsed `PositionCard` header row (title + "Reveal the full profile ↓") still only had ~140px of real content width — the non-wrapping reveal affordance (~121px) ate nearly all of it, leaving the title ~4px to wrap into, letter-by-letter, reading as overlapping garbled text. `ArchetypeSection`/`PositionCard` are out of scope to edit (that's `the_bloom_page`'s territory). The fix: keep profile text + nav side by side at the top (neither ever needed much width), then render `ArchetypeSection` at full page width below — same width it already gets on `/bloom`. Confirmed clean at 1440px: card column reached 495px combined (bag + card), `PositionCard` rendered normally (title, teaser, weight/price buttons, Add to cart, Compare, all legible).

**Bug found and fixed (not just flagged) — `backend/src/routes/users.ts`'s `ARCHETYPES` map used stale shorthand keys (`chocolate`, `balanced`, `spicy`) while the lookup derived its key via `archetype.name.toLowerCase()` (e.g. `"Chocolate & Nutty".toLowerCase()` → `"chocolate & nutty"`, not `"chocolate"`).** Only `floral`/`fruity`/`experimental` survived `.toLowerCase()` unscathed; the other three (`Chocolate & Nutty`, `Balanced & Sweet`, `Earthy` — the last renamed from `spicy_earthy` in an earlier schema migration that never touched this map) silently fell through to a generic-rust-color/no-features fallback, and worse, produced an `.id` that didn't match `archetype_enum` (`chocolate_nutty`, `balanced_sweet`, `earthy`) used everywhere else, including `/api/coffees/archetypes`. This was already silently breaking `BloomPage.tsx`'s "your matched archetype" highlighting and `FlavorIntelligencePage.tsx`'s personalization match (`matchArchetypeId` lookups) for those three archetypes — pre-existing, not introduced by this work — and would have broken this feature's own archetype match outright. Fixed by normalizing `ARCHETYPES`'s keys to `archetype_enum` and adding an explicit `ARCHETYPE_NAME_TO_KEY` name→key map instead of the blind `.toLowerCase()`, used by both `GET /api/users/profile` and `GET /api/users/homepage-state`. Verified against production Cloud SQL with a seeded test quiz result: `Chocolate & Nutty` now correctly resolves and matches.

**Screen changes**: hero photo (`3NAnXgR.jpeg`) removed entirely. Nav restyled off-photo to the page's normal dark-on-cream palette (`text-[#a33726]/60` family), `ArrowRight` hover-slide kept. New nav item **"Create a household party"** → `/profile?tab=family`. `ArchetypeSection` wired with the same handler shapes `BloomPage.tsx` uses (`selectedSortOrder`, `revealedKeys`, dial ref, `handleDialSelect`/`toggleReveal`/`handleHopClick`/`openCompare`) plus `useCart()` — no second local cart. `CompareOverlay` rendered on this screen too. `showPhoto` left at its default (`true`).

**`Profile.tsx`**: added `useSearchParams`, initializes `activeTab` from `?tab=` when it's a valid `Tab` (`memory | orders | settings | family`), falling back to `'memory'` otherwise — previously the query param was silently ignored.

**Verified in a real browser against production Cloud SQL** (seeded a throwaway Firebase test user + `quiz_session` row for this, cleaned up after): returning-user screen shows the correct matched archetype (Chocolate & Nutty) with no hero photo; dial/reveal/add-to-cart/compare all functional; added an item here, then navigated to `/bloom` via a real in-app nav-link click (not a hard reload — `CartContext` is in-memory only, so a hard reload legitimately clears it, which is expected, not a bug) and confirmed the item and subtotal persisted, cart badge updated to 1; clicked "Create a household party" and confirmed it lands on `/profile` with the Family tab already active and the other three tabs still default correctly when reached without a `tab` param.

**Observed, not chased down — likely unrelated pre-existing behavior**: a `Failed to sync user: TypeError: Failed to fetch` console error fires from `AuthContext.tsx`'s `syncUser()` on sign-in in this dev environment, but doesn't block anything downstream (Firebase auth state and `getUserProfile()` both still resolve correctly afterward). Not investigated further since it didn't affect any behavior under test here.

**Explicitly out of scope, per the spec**: the just-finished-quiz curtain/reveal screen, any order-scoped feedback prompt, quiz States 2–4, and any change to `RevealedPanel.tsx`/`PositionCard.tsx`/`BloomDialWidget.tsx`/`CompareOverlay.tsx`/`usePositionCardData.ts`/`ArchetypeSection.tsx` itself.

---

### 92. Sensory Source Provenance — WCR Lexicon reference table + provenance links on cupping_note/coffee_dimensions (2026-07-13)

**Context**: our `cupping_note` vocabulary (the SCA Coffee Taster's Flavor Wheel, 84 descriptors) is itself a derived regrouping of the **WCR Sensory Lexicon 2.0 (2017)** — WCR supplies the words, the SCA wheel supplies the `wheel_category`/`wheel_subcategory` grouping. Separately, `coffee_dimensions` (the Bloom Dial's 12 axes) are 0–15 intensity scales, the same measurement model WCR uses per attribute and the SCA CVA descriptive cupping form uses per dimension. This feature makes that provenance explicit and queryable. Spec: `backend/src/features/sensory-source-provenance/CLAUDE_CODE_PROMPT.md`.

**Two bugs found in the spec and fixed during implementation** (checked against the live schema before writing any SQL): `cupping_note.id` is `UUID`, not `INT` — the spec's `cupping_note_id INT REFERENCES cupping_note(id)` FK type was wrong; and `cupping_note`'s wheel columns are `wheel_category`/`wheel_subcategory`, not `category`/`subcategory` — the spec's own `verify.sql` checksum query used the wrong column names. Both fixed in the actual DDL/seed/verify.sql written for this feature.

**Schema changes (`schema.sql`, non-destructive — only new tables + nullable columns):**
- New `sensory_source` lookup table — 4 rows: `wcr_lexicon`, `sca_flavor_wheel`, `sca_cva`, `platform`.
- New `sensory_lexicon_attribute` reference table — full WCR set kept separate from the active 84-descriptor wheel so that vocabulary stays clean; `cupping_note_id UUID REFERENCES cupping_note(id)` links to an active descriptor where one exists.
- `cupping_note`: added `descriptor_source_id` (backfilled to `wcr_lexicon` for all 84 rows) and `lexicon_section`.
- `coffee_dimensions`: added `source_id` (backfilled per dimension — `sca_cva` for the aroma/flavor-phase dims and Acidity/Finish Character, `wcr_lexicon` for Bitterness/Body/Texture/Finish Length/Mouthfeel, `platform` for Savory/Depth) and `sensory_lexicon_attribute_id`.

**Seed (`seeds/sensory_lexicon_attributes_wcr.sql`, run manually, same convention as `archetype_vectors.sql`):**
- 113 rows (109 unique attribute names — Sweet/Sour/Bitter/Salty are intentionally cross-listed once under "Taste Basics" and once under their own section, matching WCR's own structure) across all 17 lexicon sections, each with a best-effort `wheel_category`/`wheel_subcategory` mapped onto the same taxonomy `cupping_notes_sca_wheel.sql` already uses. Amplitude and Mouthfeel sections are left wheel-unmapped (`NULL`/`NULL`) — they're WCR/CVA-only constructs that feed `coffee_dimensions`, not the SCA wheel.
- Explicit 84-row mapping (not a bare name join) links every active `cupping_note` descriptor to its lexicon attribute — needed because several WCR names are ambiguous across sections (`Bitter`/`Salty` appear in both Taste Basics and Chemical; `Sweet`/`Sour` in both Taste Basics and their own section) and three need an alias (`Overripe` → "Overripe / Near-fermented", `Brown` → "Brown-Roast", `Roast` → "Roasted"). Backfills `cupping_note.lexicon_section` from the link, then backfills `coffee_dimensions.sensory_lexicon_attribute_id` for the 7 numeric dims that map to one specific WCR attribute (Sweetness→Overall Sweet, Bitterness→Bitter, Body→Body/Fullness, Texture→Mouth Drying, Savory/Depth→Overall Impact, Finish Length→Longevity, Mouthfeel→Thickness). Acidity is deliberately left unlinked — it aggregates the whole Sour/Acid section rather than one attribute.

**Verified directly against production Cloud SQL** via the Auth Proxy (see `axis_and_bloom_local_cloudsql_testing` memory): captured an md5 checksum of `cupping_note`'s descriptor/wheel_category/wheel_subcategory and `coffee_dimensions`'s name/scale_min/scale_max *before* applying anything, applied schema.sql + the seed, recaptured — both checksums matched exactly (non-destructive, confirmed). All 4 sources present, 113/113 lexicon rows sourced to `wcr_lexicon`, all 84 `cupping_note` rows linked with 0 unmatched, all 12 `coffee_dimensions` sourced with the 7 expected numeric axes correctly linked. Re-ran schema.sql + seed a second time — identical counts (idempotency confirmed). Booted the backend against the migrated DB and hit `/api/coffees`, `/api/coffees/archetype-stats`, and `/api/coffees/:id/content` — all 200, no runtime errors from the new columns.

**Not done (optional per the spec)**: Part 5 (exposing `descriptor_source` on `v_collaborative_flavor_wheel` / the Flavor Intelligence descriptor query so the page can cite "Source: WCR Sensory Lexicon") — data-layer only in this pass, no UI/view changes.

### 93. Bloom Dial base data — archetypes, spread positions, hop graph, seam positions (2026-07-14)

**Context**: the Bloom Dial had 63 tables of infrastructure but almost no real data — only the 3 Session-001 cupped coffees and 2 bridge hops existed. This feature loads the full base dataset for all 29 catalogue coffees, prepared as two Claude Code prompt specs (`backend/src/features/bloom_dial_base_data/CLAUDE_CODE_PROMPT_BLOOM_DIAL_BASE_DATA_PART1_SEED_AND_HOPS.md`, `..._PART2_SEAM_POSITIONS.md`) from a source workbook (`Bloom_Dial_Base_Data.xlsx`) and reasoning doc, both in the same folder. "Spread for connectivity" placement philosophy: with thin inventory, fill each dial's middle then push to the edges so every archetype's dial spans its full range and reaches its neighbors now, tightening toward true cupped positions as more sessions land.

**Part 1 — seed + hops**:
- `archetype_assignments_base.sql` — Kopi Safari's underlying archetype corrected `experimental` → `earthy` (its Experimental *category* tag is untouched and separate); 4 previously-unplaced coffees (Sleepwalker Half-Caf, Decaf, Hazelnut, Chocolate) given `chocolate_nutty`, `confidence='low'` proposals. Feather In Cap's `balanced_sweet` vs `chocolate_nutty` conflict (flagged in the workbook as unresolved) turned out to already be resolved in prod from a prior session — confirmed, not re-touched.
- `dial_positions_base.sql` — the 5 spread-rule moves: 6-Bean Espresso Blend → Full(4), Blonde Blend → Bright(3), Colombia (TCR) → Lively(4), Vantablack Ultra-Dark → Intense(4), Uganda → Intense(4).
- `dial_relationships_base.sql` — the full Dial Turn (within-archetype) + Bridge Hop (cross-archetype) graph, 46 navigable rows plus 2 `category_hop` rows (Bali Blue ↔ the Experimental category, SQL-seed only — excluded from Liam's `v_dial_navigation` until category traversal is built). Retired the now-stale Crosshatch↔Feather In Cap `bridge_archetype` row (both coffees are `balanced_sweet` post-Phase-A, so a bridge between them is a same-archetype contradiction) — the replacement `within_archetype` Dial Turn was already in the new hop seed.
- `admin.ts`: `POST /dial/relationships` now hard-rejects `hop_type='category_hop'` (SQL-seed only, per spec) — the endpoint itself, plus `GET /dial/navigation` and the hard/soft validation logic, already existed from the #75/#76 session; the deployment-mapping doc's "Gap B" (missing write endpoint) was stale.

**Part 2 — seam (guest) positions**: lets one coffee sit on more than one archetype's dial — a home position plus optional guest positions at adjacent-archetype edges, welding dials together without creating a second SKU.
- `schema.sql`: `dial_archetype_positions.is_guest BOOLEAN` + `dap_guest_not_default` CHECK (a guest row can never be `is_default`); `v_dial_positions` now exposes `is_guest`.
- `admin.ts`: `POST /coffees/:id/archetype` no longer wipes *all* of a coffee's dial positions on a re-tag — it now deletes/replaces only the `is_guest=false` home row, leaving guest rows untouched (verified with a live retag simulation against prod). New `POST /dial/positions/guest` (hard-rejects a "seam" onto the coffee's own home archetype) and `DELETE /dial/positions/guest/:id`. All `coffee_alias` read/write paths (`GET/POST/PATCH /coffee-alias`, `/coffee-alias/slot`) restricted to home positions — a guest row can never be aliased for allocation.
- `blendResolver.ts`: the dial-position join gained `is_guest = false` — without this fix, once seam rows existed a coffee's guest slot could have leaked into fulfilment resolution for the wrong archetype/slot.
- `dial_seam_positions.sql` — the 3 seams from the workbook: 6-Bean Espresso Blend → earthy Gentle(1) (fills earthy's empty low edge), Colombia (TCR) → fruity Bright(3) (the cleanest seam — balanced_sweet and fruity share their dominant dimension, Acidity), Guatemala (TCR) → chocolate_nutty Lighter(1) (fills chocolate_nutty's empty low edge).

**Found and fixed in-flight, not in either spec**: a same-archetype bridge would have been created between Ethiopia (Path) and Ethiopia Natural (TCR). Ethiopia (Path)'s live `archetype_assignments` row is actually `floral` (`confidence='high'`, i.e. real cupping data), not `fruity` as both the workbook and its own `dial_archetype_positions` row (fruity Vibrant(4), `is_default=true`) assume — a pre-existing inconsistency, not introduced here. The new hop was dropped rather than guessed at; flagged for a human call on which side is correct (the archetype assignment or the dial position). Note this also means the original Session-001 Crosshatch↔Ethiopia bridge is currently mislabeled as `balanced_sweet↔floral` rather than the intended `balanced_sweet↔fruity` — left alone (pre-existing, out of scope). Separately (not fixed, just noted): Vanilla (Path) already has a `dial_archetype_positions` row (`balanced_sweet` Smooth(1)) from before the workbook's redesign, even though the workbook says it should stay off-dial until cupped — a product decision, not touched.

**Verified against production Cloud SQL** (Auth Proxy) before and after every seed: `archetype_assignments`/`dial_archetype_positions`/`dial_coffee_relationships` counts, no `bridge_archetype` row connects two same-archetype coffees and no `within_archetype` row connects two different-archetype coffees, `dap_guest_not_default` CHECK tested live (correctly threw `23514`), a simulated home re-tag confirmed a guest row survives untouched, re-applied `schema.sql` in full (idempotent). Booted the backend locally against prod and hit `/health`, `/api/coffees`, `/api/coffees/archetype-stats`, `/api/coffees/:id/hops`, `/api/coffees/:id/legacy-slot` — all correct (including the expected 404 for Kopi Safari, which has no dial position yet by design). Confirmed the same against the live deployed backend post-push.

### 94. Bloom Dial slot-name/allocation regression fix — alias-as-slot model (2026-07-14)

**Context**: deploying #93 (Bloom Dial base data) exposed two live regressions on the Flavor Intelligence page, The Bloom, and the admin Coffees matrix, diagnosed in `backend/src/features/bloom_dial_base_data/CLAUDE_CODE_PROMPT_BLOOM_DIAL_BASE_DATA_PART3_ALIAS_SLOT_MODEL.md`. Confirmed both live before touching any code (not just trusted the spec): `chocolate_nutty` slot 2 showed "Classic Decaf" instead of Noam Blend/Brazil Santos, and the `experimental` dial had gone completely empty (0 active slots).

**Root cause 1 — category coffees squatting real dial slots**: giving Decaf/Sleepwalker Half-Caf/Vanilla/Hazelnut/Chocolate/Kopi Safari real `archetype_assignments` rows in #93 silently broke `resolveBlendForSlot`'s fallback `COALESCE(aa.archetype, ca.archetype)` derivation — a coffee with no real `dial_archetype_positions` row but an old `coffee_alias` row started resolving onto a real archetype's dial slot via its *stale stored* `archetype`/`dial_sort_order` fallback columns, since `aa.archetype` (now populated) took precedence in the COALESCE. Separately, this is exactly why the `experimental` dial went empty too: Kopi Safari's archetype changed away from `'experimental'`, so it stopped matching that slot's own candidate query — the same mechanism, opposite direction. **Fix**: `blendResolver.ts`'s `resolveBlendForSlot` now excludes any coffee carrying a Decaf/Half-Caf/Flavored/Experimental `coffee_category_assignment` tag from ever resolving as a dial-slot candidate, full stop — this is the actual root-cause fix, not just a display-layer patch (the spec's own Phase 3 wording only mentioned "displayed slot name," but the routing rule in its Phase 2 requires excluding candidates, not just relabeling them — verified by tracing `resolveBlendForSlot`'s SQL directly rather than assuming the spec's phase boundaries were complete). `GET /api/coffees/archetypes` (`coffees.ts`, shared by both Flavor Intelligence and The Bloom — confirmed by reading both frontend components' fetch calls, not assumed) also now filters `dial_archetype_config.is_archetype = true`, dropping `experimental` from the 5-archetype loop entirely (it's a category, not a peer flavor family, and was rendering a now-permanently-broken 6th section).

**Root cause 2 — duplicate slot names**: `coffee_alias.platform_name` was stored per coffee row, not per slot, so two coffees at different dial positions could share a name ("Deep Cocoa" = both African Espresso Blend and 6-Bean Espresso Blend), and a coffee's name went stale when #93's spread-rule moves relocated it to a different slot. **Fix**: new `dial_slot_alias(archetype, dial_sort_order, platform_name)` table, `UNIQUE` on both the slot key and the name — a slot's display name is now a property of the slot, never of whichever coffee occupies it. Seeded all 20 flavor slots + the Experimental slot with the workbook's placeholder (admin-renamable) names. Every reader that shows a slot name — the public `/api/coffees/archetypes` and `/api/coffees/:coffeeId/hops` endpoints, `GET /api/admin/coffee-alias` — now sources it from `dial_slot_alias`. Both admin rename paths (`PATCH /coffee-alias/slot`, the per-coffee "Alias:" rename via `PATCH /coffee-alias/:id`) now write to `dial_slot_alias` instead of fanning out across `coffee_alias` rows, so a rename can no longer desync or collide (`UNIQUE(platform_name)` enforced, `409` on conflict). `coffee_alias` keeps its fulfilment role (coffee↔slot mapping, priority, `is_active`); its `platform_name` column is legacy/unread going forward (kept, still `NOT NULL`, harmlessly written on create but never displayed).

**Verified against production Cloud SQL and a local boot against prod** before commit: `SELECT platform_name, COUNT(*) FROM dial_slot_alias GROUP BY 1 HAVING COUNT(*)>1` empty (no duplicate names), simulated + live-HTTP-confirmed that `chocolate_nutty` slot 2 resolves to Noam Blend/Brazil Santos (not Decaf), slots 3/4 show distinct names ("Deep Cocoa"/"Full Cocoa"), `/api/coffees/archetypes` returns exactly 5 archetype sections (no more broken empty Experimental section), `/api/coffees/:id/hops` target labels correct. Confirmed the same against the live deployed backend post-push.

**Deferred — Phase 6 of the same spec, not done here**: a new public "Other Categories"/"The Unexpected" section presenting the 6 excluded coffees (currently: matched to an archetype for Liam/quiz purposes, but browsable nowhere on the public site — a known, intentional gap, not a silent one). This is genuinely new UI, and its "shop / add-to-cart affordance" has no specified pricing/cart-item model for a coffee with no dial position — today's `CartItem` type and `dial_slot_price` table are both keyed by `archetype + dialSortOrder`, not `coffeeId`. Flagged to Dana rather than guessed at; needs a decision on whether these get a shop affordance at all (vs. browse-only with Talk to Liam / Flavor Intelligence links) before building.

### 95. Bloom Dial base data Part 3, Phase 6 — Other Categories / The Unexpected, real shop support (2026-07-14)

**Context**: #94 flagged a genuine gap rather than guessing at it — the 6 category coffees (Decaf, Sleepwalker Half-Caf, Vanilla, Hazelnut, Chocolate, Kopi Safari) had no pricing/cart-item model since they'd never had a dial position to key one off. Asked Dana how to handle the "Other Categories"/"The Unexpected" public section's shop affordance: browse-only, real shop/cart support, or hold off. She chose real shop/cart support.

**The pricing gap and its fix**: `roaster_blend` has no retail price column (only `cost_to_us`) — retail pricing has only ever lived on `dial_slot_price`, keyed by `(archetype, dial_sort_order, weight_oz)`, which doesn't fit a coffee with no dial position. New `coffee_retail_price(coffee_id, weight_oz, retail_price_cents)` table (`UNIQUE(coffee_id, weight_oz)`), same "$38.00/12oz, $199.00/5lb default when unset" convention as `dial_slot_price`. New `resolveCoffeeBlend(coffeeId, weightOz)` in `blendResolver.ts` — the coffee-keyed counterpart to `resolveBlendForSlot`, no priority-fallback chain needed (a category coffee is one specific product, not a slot several roasters could fill); same "`is_active` + a row exists, full stop" fulfillability rule as the rest of the site (quantity never checked — drop-ship model).

**Backend**: `GET /api/coffees/other-categories` (public, roaster-blind) — one row per coffee with its category tags, matched-archetype label, and per-weight price + availability; a coffee carrying two tags (e.g. a flavored decaf, none exist today but the shape supports it) is grouped once with both tags attached, the frontend decides how many cards to render. `GET`/`PATCH /api/admin/coffee-prices` mirrors the existing slot-prices endpoint pair exactly (no admin UI wiring this pass, same carve-out Part 2 used for seam-position UI). `orders.ts` gained a third item-resolution branch, `{ coffeeId, weightOz }`, alongside the existing dial-slot branch and the raw blendId/variantId fallback — flows through the identical Shopify/order/inventory pipeline every other item already uses.

**Frontend — `CartItem` becomes a discriminated union**, the highest-risk part of this change since every dial add-to-cart/checkout call in production already depends on its shape: `DialCartItem` (`kind:'dial'`, unchanged) | `DirectCartItem` (`kind:'direct'`, coffee-id-keyed). Grepped every `CartItem`/`.archetype`/`.dialSortOrder` usage in the codebase before changing the type — `PositionCard.tsx`'s `handleAddToCart` was the only other construction site, `CartContext.tsx` (same-line matching + checkout's item-to-API mapping) and `FloatingCart.tsx` (cart-line subtitle) the only shape-dependent consumers. Behavior for existing `'dial'` items is unchanged.

New `bloom/OtherCategoryCard.tsx` — same visual language as `PositionCard.tsx`: category pill(s), "Matches ‹Archetype›" line, an interactive weight/price picker + real Add to cart, or `PositionCard`'s exact "Temporarily unavailable" treatment when no `roaster_blend` row exists at any weight. Takes a `renderFlavorIntelligenceLink` render-prop so `BloomPage.tsx` (a real `Link` out to FI) and `FlavorIntelligencePage.tsx` (an in-page selection button, no navigation) each wire the same card differently without duplicating it. Both pages fetch `/api/coffees/other-categories` and render two sections after the existing dial content — "Other Categories" (decaf/half_caf/flavored) and "The Unexpected" (experimental) — matching the spec's exact split.

`FlavorIntelligencePage.tsx` additionally gained direct-by-coffee-id selection (`?directCoffee=<id>` or an in-page click), since its detail panel was entirely archetype/dial-slot-derived before this: `selectedCoffeeId` is now `directCoffeeId ?? selectedSlotData?.coffeeId` — the existing wheel/dimensions/content fetch effect needed no changes (already keyed on the plain id). The panel's dial-only affordances (position-label pill, "Shop on The Bloom" link, Compare mode) are gated behind `selectedSlotData` specifically and simply omitted for a direct coffee; an inline `OtherCategoryCard` renders in their place for add-to-cart. `selectSlot()` and the new `selectDirectCoffee()` each clear the other's state so dial navigation and direct selection can't both be active — a stale `compareMode=true` from a prior dial selection could otherwise reach `selectedSlotData`-dependent JSX with no slot data and crash.

**Current real shoppability, verified live**: Decaf, Sleepwalker Half-Caf, and Kopi Safari have real `roaster_blend` rows today and show working Add to cart; Vanilla, Hazelnut, and Chocolate have no SKU yet and correctly render "Temporarily unavailable" — same as any empty dial slot, not a bug.

**Verified**: `schema.sql` applied to prod; `GET /api/coffees/other-categories` hit live via a local boot against prod (Auth Proxy) confirming the exact 3-active/3-unavailable split, category tags, archetype-match labels, and displayName fallback (alias where one exists, raw coffee name otherwise); `GET`/`PATCH /api/admin/coffee-prices` verified at the SQL level; `vite build` clean (2129 modules, +1 for the new component); grepped the built bundle for `other-categories`/`directCoffee` to confirm the new fetch calls actually shipped; confirmed the same live payload against the deployed backend post-push. **Not verified — no headless browser tool available in this environment**: no actual click-through of add-to-cart/checkout/section rendering in a live page. The underlying data flow is confirmed end-to-end and every `CartItem` call site was traced by hand for the `.kind` branch, but the rendered UI itself was never opened in a browser — Dana should click through before this is considered visually signed off, same standing caveat as the Axis V2 entry (#59) used for its own unverified UI.

### 96. Fixed Liam and admin Inventory still citing stale/duplicate coffee names (2026-07-15)

**Context**: #94 declared `coffee_alias.platform_name` "legacy/unread going forward" after moving dial slot names to `dial_slot_alias`, but only checked `coffees.ts`/`admin.ts`'s slot-name readers before writing that — not every consumer of the column. A direct question ("did you also update WHAT_WE_BUILT.md/DB.md/SOMMELIER_BUILT.md?") prompted a check of `SOMMELIER_BUILT.md`, which turned up that #94 and #95 never got a Liam-impact continuity note (unlike #93's S43) — and checking *why* surfaced a real bug, not just a missing doc: `sommelierRag.ts`'s `getAliases()` — "the only customer-facing identity Liam's catalog context may use" — reads `coffee_alias.platform_name` directly.

**Verified live before fixing anything**: 10 of 26 dial coffees had a stale name — Liam would still say "Deep Cocoa" for 6-Bean Espresso Blend (public site: "Full Cocoa"), "Dark Grounded" for Uganda (public site: "Intense & Dark"), etc.

**Fix**: `getAliases()` now joins `dial_slot_alias` the same way every other reader does, falling back to `coffee_alias.platform_name` only for the 6 category-tagged coffees (no dial slot to derive from — same fallback `/api/coffees/other-categories` uses). Auditing every remaining `coffee_alias.platform_name` read in the codebase turned up one more: `GET /api/admin/inventory` had the identical bug (admin-only, lower stakes, same fix applied).

**Verified**: both corrected queries re-run directly against prod (real dial coffees resolve to live slot names; the 3 category coffees with existing aliases — Decaf, Sleepwalker Half-Caf, Kopi Safari — keep their own distinct names; no unexpected duplicates beyond the expected multi-roaster same-slot sharing, e.g. Vantablack/Uganda both legitimately "Intense & Dark"). Backend boots clean locally against prod, `/health` OK. See `SOMMELIER_BUILT.md` S44 for the full Liam-specific writeup.

### 97. Bloom Dial base data Part 4 — post-deploy UI corrections (2026-07-15)

**Context**: follow-up review of Parts 1-3 across the admin Coffees page, The Bloom, and Flavor Intelligence, per `backend/src/features/bloom_dial_base_data/CLAUDE_CODE_PROMPT_BLOOM_DIAL_BASE_DATA_PART4_UI_CORRECTIONS.md`. Six pieces: admin slot naming, card-title format, a proper Experimental box on both public pages, personalized archetype ordering on The Bloom, category coffees nested under their archetype on Flavor Intelligence instead of a separate section, and a CSS fix.

**§A — admin matrix, no blank slot names**: seeded the 3 missing `dial_slot_alias` rows for experimental (only slot 2 had a name before) — 24 total now (20 flavor + 4 experimental). New `GET /api/admin/dial/slot-aliases` returns all 24 unconditionally (unlike `GET /coffee-alias`, which only has rows for occupied slots); `AdminCoffees.tsx`'s alias lookup now sources from it, so an empty slot always shows its name — occupancy is still shown as "—" per-roaster, unchanged.

**§B1/C1 — card titles are the alias only**: `PositionCard.tsx` dropped the `"{position} — "` prefix (shared by both public pages via `ArchetypeSection`). Left the hop-link copy, FI's compare dropdown, and `CompareOverlay`'s heading alone — genuinely different UI, not "the card title" the spec meant.

**§B2/C1 — a real "Experimental" box, titled correctly, on both pages**: new `GET /api/coffees/experimental` (extracted the shared per-archetype slot logic out of `/archetypes` into `buildSlotsForArchetype()` so both stay in sync), rendered via the same `ArchetypeSection` component as the 5 real archetypes and titled "Experimental" (the family name) — a coffee inside (Kopi Safari) shows its own slot alias ("The Unexpected"), not the section name. Replaces the old grouped-card "The Unexpected" section on The Bloom (which conflated the two); on Flavor Intelligence it's merged into the existing accordion as a 6th entry, zero parallel code path.

Getting this to actually resolve required a real backend fix: `blendResolver.ts`'s `resolveBlendForSlot` derived a candidate's archetype as `COALESCE(aa.archetype, ca.archetype)` — a coffee's *match* archetype silently overrode its actual dial position. Invisible until now because no coffee's match and position diverged before Kopi Safari (match=`earthy` for Liam, position=`experimental` via its category tag) — its own slot resolved to nothing. Changed precedence to `COALESCE(dap.archetype, aa.archetype, ca.archetype)`; verified this doesn't reopen the #94 category-exclusion regression (independent guard) and doesn't change any other coffee's behavior (match and position already agree everywhere else).

**§B3 — The Bloom's archetype order is personalized, not hard-coded**: new `GET /api/coffees/archetype-order?archetype=`, Euclidean distance over `v_archetype_vectors`' `ideal_score` from a valid real-archetype match, fixed default order otherwise. Found and fixed live: an invalid `archetype` param 500'd (enum-typed column, arbitrary string crashes the Postgres cast) — now validated in JS against the known archetype set before ever querying. Removed `bloomVisuals.ts`'s now-dead `ARCHETYPE_ORDER` export (confirmed no other importer — `AxisMap.tsx` has its own unrelated same-named local constant).

**§C1 — category coffees nest under their matched archetype on Flavor Intelligence**: removed FI's "Other Categories" + old "Unexpected" grouped sections entirely (Bloom keeps its Other Categories section unchanged — FI isn't the shopping page). Each real archetype's accordion entry now lists a "Categories" sub-heading of `/api/coffees/other-categories` entries matching that archetype, when any exist.

**§C2**: `useCompatibility.tsx`'s "Worth exploring" pill gained `whitespace-nowrap` + slightly more padding.

**§E — hardcode audit**: clean across the 6 named components beyond `ARCHETYPE_ORDER` (removed) and `ARCHETYPE_VISUALS` (left alone — visual/asset metadata like hero images and hex colors, not the kind of DB-backed fact the spec meant, and the 5 real archetypes already used this exact pattern unflagged).

**Known gap, flagged not fixed**: the same `COALESCE(aa.archetype, ca.archetype)` pattern this fix addressed in `resolveBlendForSlot` also appears in 10+ other places (`admin.ts`'s coffee-alias derivation, `sommelierRag.ts`, `coffees.ts`'s `isDefault` lookup). Only `resolveBlendForSlot` was required for the Experimental box to function. Concretely: the admin Coffees matrix still files Kopi Safari under "Earthy — no position" rather than "Experimental," since `GET /api/admin/coffees` derives `coffee.archetype` from `aa.archetype` alone. Pre-existing since Part 1 (not introduced here), outside §A's explicit scope (slot *names*, not archetype-grouping logic) — worth a dedicated follow-up.

**Verified**: `dial_slot_alias` = 24 rows against prod; `GET /api/coffees/experimental` correctly resolves Kopi Safari active at slot 2 after the `blendResolver.ts` fix; `GET /api/coffees/archetype-order` verified for a real match, no match, and invalid input (the bogus-500 fix); `/api/coffees/archetypes` and `/api/coffees/other-categories` re-verified unaffected. `vite build` clean (2131 modules); bundle-verified via Node (PowerShell's line-based text search undercounts matches in minified single-line output) that `archetype-order`/`coffees/experimental`/`dial/slot-aliases`/`directCoffee` all shipped. Confirmed the same against the live deployed backend post-push. **Not verified — no headless browser tool available in this environment**: no actual click-through of the admin matrix, reordered Bloom boxes, Experimental box, or FI Categories sub-lists — every path traced by hand and HTTP-verified where auth allowed; Dana should click through before this is visually signed off, same standing caveat as #59/#95.

### 98. Homepage (home-v3) regression fixes + site-wide mobile nav (2026-07-15)

**Context**: Camila's `feat(home-v3)` rebuild (commits `23076f5`, `ce208ab`, 2026-07-14/15) replaced `Home.tsx` wholesale and its own commit message said outright "Removed: flavor-map cards, old curtain quiz band, stageCode CTA." Two real features were dropped as a side effect of the visual rebuild, per the pre-written spec at `backend/src/features/homepage_v3_fixes/CLAUDE_CODE_PROMPT_HOMEPAGE_V3_FIXES.md`. Ground rule: don't change position/order/visual design of any home-v3 section — restore functionality inside the current visual language only.

**Part 1 — lifecycle-aware §2 CTA restored**: every signed-in visitor was seeing the same anonymous "Whose palate are we profiling today?" name-capture form regardless of lifecycle stage — the exact bug #73/#74 fixed, reintroduced by the rebuild. Restored `refreshHomepageState`/`homepageStateLoading`/`feedbackDismissed` state and `renderSignedInCTA()`/`renderStageCTA()` in `Home.tsx`, branching on `useAuth()`'s `user`. Signed-out JSX is byte-for-byte unchanged; signed-in renders a stage-driven headline + CTA pill restyled to §2's current tokens (`#9a2918` headline, `#45474a` body, Lato) instead of the old dark hero-adjacent styling. `FEEDBACK_NAG_SUPPRESS_DAYS` is re-declared locally in `Home.tsx` (frontend can't import the backend's `userLifecycle.ts` constant across the client/server boundary) with a comment pointing at the source of truth.

**Part 2 — Company Gift code redemption restored**: `CompanyGiftRedemption.tsx` and its API (`lookupCompanyGiftCode`/`redeemCompanyGiftCode`) were untouched but unreachable — deleted from `Home.tsx`'s JSX only. Re-added as its own thin band directly below §2 and above §3 (matching its pre-rebuild position), wired to `onRedeemed={refreshHomepageState}`.

**Part 3 — Navigation.tsx had no mobile menu at all**: `hidden md:flex` on the nav links had zero fallback below the `md` breakpoint since `207c0ad` — mobile visitors only ever saw the logo and icons. Added a `lucide-react` `Menu`/`X` hamburger toggle and a full-width slide-down panel (`#f2f1ea` background, same `LINK` style token, stacked links + conditional Sign out), closing on route change and on link click. **Bug caught by browser verification, not by `vite build`**: the hamburger button's inline `style` object included `display: 'flex'` (copied from the always-visible cart/profile icon pattern) — an inline style always wins over a class-based media query, so `md:hidden` silently never took effect and the hamburger rendered on desktop too, next to the full desktop nav. Fixed by moving `display` out of the inline style and into the className (`flex md:hidden`) instead.

**Part 4**: added a standing warning note to `CAMILAS_UPDATES.md` (right after the header) flagging that this site has lifecycle-aware personalization and the Company Gift widget, so a future full redesign either preserves the branch logic or explicitly calls out dropping it — this is the second time a visual rebuild has silently dropped it (2026-07-07, then 2026-07-14/15).

**Verified**: `vite build` clean, no console/page errors. Installed Playwright + Chromium locally (isolated in the scratchpad, not added to `frontend/package.json`) and drove the actual dev server: confirmed the signed-out §2 form is pixel-identical, the Company Gift band renders directly beneath it, the hamburger appears only below `md` and opens/closes correctly closing on link-click, and — critically — that the hamburger is genuinely absent at a 1400px desktop viewport once the inline-style bug above was fixed. **Not verified — no test account with lifecycle data available this session**: the six signed-in `stageCode` branches (`NEW_NO_QUIZ` / `QUIZ_TAKEN_*` / `SUBSCRIBER` / `REORDER_DUE` / `LAPSED_SINGLE_ORDER` / fallback) and the pending-feedback nudge were code-reviewed against the already-proven pre-rebuild logic and the live `GET /api/users/homepage-state` response shape, but not click-through tested signed in — Dana should spot-check with a real account per stage, same standing caveat as #12's Flavor Intelligence signed-in states.

### 99. Unlisted About/Shop/How It Works from public nav + footer, added Admin quick-links (2026-07-15)

**Context**: Per the pre-written spec at `backend/src/features/unlist_pages/CLAUDE_CODE_PROMPT_UNLIST_PAGES.md`. `/about`, `/shop`, and `/how-it-works` needed to stop being reachable from the main site navigation and footer without being deleted or retired — routes in `frontend/src/app/App.tsx` (`<Route path="/how-it-works" .../>`, `/about`, `/shop`) were explicitly left untouched.

**`frontend/src/app/components/Navigation.tsx`**: removed the three `<Link>`s from both the desktop nav block and the mobile menu link array. `THE AXIS`, `THE BLOOM`, `FIND MY FLAVOR`, `FLAVOR INTELLIGENCE`, and the conditional `ADMIN` link are untouched in both places.

**`frontend/src/app/components/Footer.tsx`**: removed `{ to: '/shop', label: 'Shop' }` and `{ to: '/how-it-works', label: 'How it works' }` from the "Explore" column, and `{ to: '/about', label: 'About' }` from the "Company" column (which now renders only Contact/Instagram).

**`frontend/src/app/components/admin/AdminLayout.tsx`**: added a new `NAV_UNLISTED` constant and an "Unlisted Pages" section rendered below the existing `NAV_SECTIONS.map(...)` block (after Company Gifts, before "Back to site + Sign out"), using plain `<a target="_blank" rel="noopener noreferrer">` tags (not `NavLink`) so clicking one opens the page in a new tab instead of navigating the admin panel away — these are public pages, not admin sub-routes.

**Verified**: `vite build` clean, no type errors (2131 modules unaffected). Installed Playwright + Chromium locally in the session scratchpad (not added to `frontend/package.json`) and drove the real dev server: confirmed `/about`, `/shop`, `/how-it-works` all return 200 and render correctly when loaded directly by URL with the nav bar intact; confirmed neither the desktop nav, the mobile hamburger menu, nor the footer (checked on `/the-axis`, since `/` and `/about` render `Footer` inline inside `TasteFinderSection` behind the curtain reveal per `PublicLayout.tsx`) contain any of the three links anymore; confirmed every other nav/footer link is unchanged. Other in-page CTAs that link to `/shop`/`/about` (e.g. `Home.tsx`'s signed-in stage CTAs, `TasteFinderSection.tsx`'s body copy) were left untouched — out of scope per the spec, which named only `Navigation.tsx` and `Footer.tsx`. **Not verified — no admin test credentials available this session**: the new Admin sidebar section itself was not click-through tested signed in as an admin (`/admin` redirects to `/` without auth); the JSX was code-reviewed against the spec verbatim and follows the exact same header/list pattern as the existing `NAV_SECTIONS` rendering just above it. Dana should spot-check the Admin sidebar with a real admin account.

### 100. Profile Parts 1–3 — full-width redesign, memory layer (journal/journey/adjacents), feedback v2 (2026-07-18)

Executed all three pre-written specs in `backend/src/features/profile_page/` in sequence against `frontend/src/app/components/Profile.tsx`: `CLAUDE_CODE_PROMPT_PROFILE_PART1_FLAVOR_MEMORY_AND_LAYOUT.md`, `..._PART2_BACKEND_FLAVOR_MEMORY_AND_FEEDBACK_V2.md`, `..._PART3_FRONTEND_MEMORY_UI_AND_FEEDBACK_V2.md`.

**Part 1 — layout + real `ArchetypeSection`**: replaced the old `h-screen overflow-hidden` 50/50 shell (static Unsplash photo pane + `max-w-[480px]` content column) with a normal-flow `min-h-screen` page, `max-w-[1400px] mx-auto` container, matching `FlavorIntelligencePage.tsx`'s shell pattern — footer now appears below content. The Flavor Memory tab's old text-only "Your Archetype: {name}" + feature list is replaced by the same `ArchetypeSection` stack `/bloom` and Find My Flavor's returning-user/results screens already use (dial, position card, reveal panel, add-to-cart, compare, hop links) — reusing `GET /api/coffees/archetypes`/`/experimental`, `getDialPosition`/`setDialPosition`, `useCart()`; nothing local was reimplemented. Flavor Memory content is driven by `GET /api/users/homepage-state` (`stageCode`, `archetype`, `pendingFeedback`), mapped per the lifecycle stage table from `customer_life_cycle/1_CLAUDE_CODE_PROMPT_CUSTOMER_STATE.md` rather than a binary has-archetype check; a guard falls back to the `NEW_NO_QUIZ` empty state if a stage implies quiz-taken but the archetype resolves null. Added a low-emphasis "Retake the quiz" link → `/find-my-flavor?retake=1` (a new mount-time check in `FlavorQuiz.tsx` reuses the returning-user screen's own existing `handleRetake()` reset, then strips the param via `navigate(..., { replace: true })`). Removed ~15 stray `font-light` instances from `Profile.tsx` per the standing convention (#11 in this file's Frontend backlog, now closed for this file).

**Part 2 — backend**: new `GET /api/users/flavor-memory` (auth) returns `journal[]` (this user's orders merged with their Firestore `feedback_events`, one read for all events not per-order), `journey[]` (archetype history), and `contributionCount` (their `user_flavor_feedback` row count). Extended `POST /api/orders/:orderId/feedback` to v2 — `expectation` (`lighter`/`as_expected`/`bolder`) and `tastedNoteIds` (chip picks) are both optional and additive; old `{rating, note}`-only calls behave unchanged. `expectation` writes one `dial_position_signal` row (`source: 'onsite_feedback'`, `direction: 'less'|'more'`, resolved via the order's coffee → `archetype_assignments` → `dial_archetype_config.dominant_dimension_id`) — **appended, not superseded**, since (unlike `recordCuppingSignal`'s recompute-and-replace semantics) each feedback submission is an independent customer observation, not a re-estimate of the same measurement; `as_expected` writes no signal row this pass (a confirmation-signal design is flagged as future work, not built). `tastedNoteIds` writes one `user_flavor_feedback` row per chip, validated server-side against that specific coffee's own distinct `cupping_note_id` set in `v_collaborative_flavor_wheel` (400, nothing written, if any id doesn't belong to that coffee). Extended `GET /api/coffees/:id/flavor-wheel` to also select `cupping_note_id` (additive — existing bubble-cloud consumer ignores it) so the frontend chips have a stable id to submit rather than just a label. Order→coffee resolution follows the codebase's existing first-line-item convention via `order_line_item.blend_id → roaster_blend.coffee_id`.

**Part 3 — frontend memory/horizon layers**: three new small components under `frontend/src/app/components/profile/` — `WorthExploring.tsx` (1–2 adjacent-archetype chips via the existing `useArchetypeAdjacency` hook, hidden entirely with no authored adjacency), `TastingJournal.tsx` (newest-first order timeline; collapses to a quiet seed line instead of empty-list chrome when there are no orders yet; an unanswered entry expands the v2 `OrderFeedbackForm` inline), `PalateTimeline.tsx` (oldest-first archetype history, and now owns the "Retake the quiz" link, relocated here from Part 1 per the design concept — a fallback bare link renders in Part 1's old spot only while `flavor-memory` hasn't loaded yet). The Part 1 UC3 feedback nudge's click target changed from switching to the Past Orders tab to expanding the pending order's form inline in the journal (the journal supersedes that detour; the Past Orders tab's own independent feedback flow is untouched). `OrderFeedbackForm.tsx` (shared — Profile journal/orders tab, `Home.tsx`'s and `FlavorIntelligencePage.tsx`'s UC3 nudges all get v2 simultaneously) gained an optional `coffeeId` prop, a closed "lighter / as expected / bolder" question, and up to 8 (expandable) tasted-note chips fetched from that coffee's own `/flavor-wheel` data — stars stay the only required field, and the chips section simply doesn't render when `coffeeId` can't be resolved (e.g. a legacy blend), matching the spec's "degrade, don't break" instruction. `homepageState.pendingFeedback` gained a `coffeeId` field (backend + `Home.tsx`/`FlavorIntelligencePage.tsx`/Profile's types) purely so those nudges' forms can resolve chips too.

**Two real bugs found and fixed during browser verification, neither pre-existing in scope but both directly blocking this feature from working**:
1. **`Profile.tsx`'s sign-out redirect didn't gate on `useAuth()`'s `loading` flag** — Firebase's `onAuthStateChanged` starts with `user = null` before it resolves from persisted session storage, so a fresh page load (e.g. a `?tab=` deep link, or any hard reload) could see the false-negative `null` and bounce a signed-in user to `/sign-in`. `FlavorIntelligencePage.tsx` already guards this exact race with an `authLoading` gate; applied the same fix here (`useEffect` depends on `[user, authLoading]`, returns early while `authLoading`).
2. **The `?retake=1` mount-time check (Part 1) had a stale-closure race**: it gated on `profileLoading`, whose *initial* value (`false`) is what a same-render-pass effect reads before the profile-fetching effect's own `setProfileLoading(true)` has actually committed — so on first mount the retake effect saw `profileLoading === false` and `userProfile === null` simultaneously, concluded (wrongly) that the user was unmatched, consumed the one-shot ref, and stripped the param without ever calling `handleRetake()`. Fixed by adding a dedicated `profileFetchDone` state (set only in the fetch's own `.finally()`) and gating on that instead.
3. **Discovered (not part of this task's original scope, fixed anyway since it directly undermines Part 3's "Palate over time"): `users/{uid}/taste_journey` is a 3-segment Firestore path.** Document references require an even segment count (collection/doc/collection/doc/…); `firestoreDb.doc('users/{uid}/taste_journey')` in `quiz.ts` (Sommelier Task 1 §12) and in the new `flavor-memory` read has always thrown synchronously, silently caught by each call site's own try/catch — meaning `taste_journey` has never actually persisted since Task 1 shipped it, papered over entirely by this feature's own backfill fallback (a single synthetic entry from the user's current archetype). Confirmed by reproducing the throw directly and by reading the doc via the Admin SDK. Fixed both the write (`quiz.ts`) and read (`users.ts`) paths to `users/{uid}/metadata/taste_journey` (4 segments), matching the working `confidence_profile` convention already used one line below it in `orders.ts`. Confirmed this doesn't affect the Sommelier's `TASTE_EVOLUTION` intent — that derives `archetypeChangedLastTwoQuizzes` from SQL `quiz_session` history (`userSignals.ts`), never from this Firestore doc.

**Verified end-to-end** with a throwaway signed-up test account + a directly-seeded test order (Shopify isn't wired, so a real checkout can't produce one) against real production Cloud SQL via the Auth Proxy: signed-out redirect; `NEW_NO_QUIZ` empty state; full archetype layout (dial/photo/bag/reveal panel) after taking the quiz; all four `?tab=` deep links plus the invalid-value fallback; the retake flow landing directly on question 1 with the param stripped (not the returning-user screen); mobile 390px (no horizontal scroll); the UC3 nudge expanding the inline v2 feedback form with real tasted-note chips for the seeded coffee; a full v2 submission (4 stars, "Bolder", 2 chips, a note) confirmed via direct DB query to write exactly one `dial_position_signal` row (`onsite_feedback`, correct archetype/dimension/direction) and one `user_flavor_feedback` row per chip, and the journal entry updating in place after reload; and — after the `taste_journey` path fix — two real retakes producing two distinct `first_quiz`/`retake` entries in "Palate over time" (previously would always have shown only the single backfill entry). All seeded test data (order, line item, signal/feedback rows, and every throwaway test account created this session, in SQL/Firestore/Firebase Auth) was cleaned up afterward. **Not verified**: the `Worth exploring` chip row (no authored adjacency pair currently includes `balanced_sweet`, the archetype the test account scored — the row's hide-when-empty behavior was confirmed, not the chip's populated appearance); `SUBSCRIBER`/`REORDER_DUE`/`LAPSED_SINGLE_ORDER` stage copy (no subscription/multi-order test data seeded this pass).

### 101. Profile Parts 4–5 — phone number in Settings; feedback editing via superseding events (2026-07-18)

Executed `backend/src/features/profile_page/CLAUDE_CODE_PROMPT_PROFILE_PART4_ACCOUNT_FIXES.md` and `..._PART5_FEEDBACK_EDITING.md`, closing gaps 1 and 2 from `PROFILE_DATA_OWNERSHIP_AND_USE_CASES.md` (both updated in place).

**Part 4 — phone number add/edit.** `PATCH /api/users/profile` now accepts an optional `phoneNumber`, validated and normalized server-side (`normalizePhoneNumber()` — accepts digits/`+`/spaces/dashes/parens, rejects anything that doesn't reduce to `+`?7-15 digits, 400 with nothing written on failure) before upserting the user's `is_primary` `user_phone` row (create if none, update if one exists — `phone_number` is `UNIQUE` across all users, so a collision returns a clear 400 rather than a raw constraint error). `GET /profile` now also returns `phoneNumber`. **Corrected a wrong premise in the spec**: it described reusing "checkout's phone-creation/validation logic" — grepped the whole backend (including `orders.ts`) and found no such logic anywhere; every `user_phone` row today came from manual/admin seeding, not any live code path, so this was written fresh rather than reused. Settings' Notifications block gained an add/change affordance beneath the SMS toggle, matching the tab's existing form styling; saving updates local state directly (no reload) so the toggle enables immediately, and changing an existing number never touches `smsOptIn`.

**Part 5 — feedback editing via superseding events (Dana's decision, no time window).** `POST /api/orders/:orderId/feedback` is now submit-or-revise: it looks up this order's current (non-superseded) `feedback_events` doc, if any; on a revision it marks that doc `supersededAt` (never mutates/deletes it) before adding the new one. **Every consumer of `feedback_events` was found and updated to ignore superseded docs** — `behavioralConfidence.ts`'s event/alignment counts, `userSignals.ts`'s `hasRecentNegativeFeedback` (dropped its `.limit(1)` so a superseded negative doesn't shadow a real remaining one), `sommelier.ts`'s `RECOMMENDATION_MISS` exclude-list query, and the Part 2 `flavor-memory` journal map — four consumers, matching what the spec asked to be enumerated. (`orderIdsWithFeedback` in both `users.ts` and `userSignals.ts` deliberately did **not** change — a superseded doc + its replacement still counts as "has feedback," per the never-ask-twice invariant.) The negative-feedback flag (`hasPendingNegativeFeedback`) now recomputes on every submission from that submission's own sentiment (not just when negative), so a revision upward clears it and a revision downward sets it — scoped to the one event, same as the pre-Part-5 logic, not a full rescan across the user's other orders. **Derived rows**: `dial_position_signal`'s prior row is superseded via an *exact* `notes` equality match rather than Part 2's fuzzy `LIKE '%orderId%'` — the spec explicitly invited flagging that lookup as fragile; since this exact string is the only thing this route ever writes into `notes` and `orderId` is unique, equality is strictly more precise with zero schema change, so that was the fix rather than adding an `order_id` column. `user_flavor_feedback` has no supersede column and feeds a live per-coffee mention count (not an audit trail — that trail is `feedback_events`), so a revision deletes this user's rows for the order and reinserts the new chips. Added `tastedNoteIds` (id array, additive alongside the existing `descriptors` label array) to the `feedback_events` doc write specifically so the frontend edit form can prefill the exact chips, not just their labels.

**Frontend**: `OrderFeedbackForm.tsx` gained optional `initialRating`/`initialExpectation`/`initialTastedNoteIds`/`initialNote` props (additive; existing call sites unaffected) and swaps its button/thank-you copy to "Update Feedback"/"Updated — thanks for the correction." when editing. `TastingJournal.tsx`'s entries and the Past Orders tab both gained a quiet "Edit" link next to existing feedback that opens the same form prefilled from `flavor-memory`'s journal data (Past Orders resolves the same `flavorMemory.journal` lookup it already uses for `coffeeId`); submitting revises via the endpoint above and the entry updates in place. FI's and the homepage's UC3 nudges are untouched — they only ever render for *missing* feedback, and a revision doesn't re-trigger them.

**Verified end-to-end** against real Cloud SQL + Firestore via the Auth Proxy with a throwaway account: Part 4 — no-phone account shows the add-number affordance; garbage input 400s with nothing written; a real number saves and the SMS toggle enables without reload; changing the number preserves `smsOptIn`. Part 5 — first submission (2★, "lighter", 2 chips, a note) then a same-order revision (4★, "bolder", 2 different chips, a new note), confirmed directly via DB/Firestore query: exactly 2 `feedback_events` docs (one `supersededAt`, one live with the revised rating/sentiment/expectation), exactly 2 `dial_position_signal` rows (the `less`-direction one superseded, the `more`-direction one live), `user_flavor_feedback` holding only the 2 *current* revision's chips (the original 2 correctly gone), and `hasPendingNegativeFeedback` correctly cleared to `false` after the upward revision. Journal UI confirmed showing the revised note/rating in place after reload, with the old note gone. All test data (2 seeded orders + derived rows, the throwaway account across SQL/Firestore/Firebase Auth) cleaned up afterward. **Not verified**: a downward revision's negative-flag *set* path (only upward was exercised this pass — the clear-path code is symmetric and reads directly off `sentiment`, but wasn't independently clicked through); `sms_feedback`-channel revisions (out of scope — Part 5 only extended the on-site endpoint).

### 102. Liam action links + Dial Event Log — Bloom deep links, chat action chips, explicit-save/cart Firestore log, dial-activity awareness (2026-07-18)

Executed `backend/src/features/ai_agent_liam/CLAUDE_CODE_PROMPT_LIAM_ACTION_LINKS.md` and `..._DIAL_EVENT_LOG.md`. Both build on `?retake=1` from #100/Profile Part 1.

**Action Links Phase A — `BloomPage.tsx` honors `?archetype=&slot=` deep links.** The page had no `useSearchParams` at all; Flavor Intelligence's existing "Shop on The Bloom →" link (`/bloom?archetype=&slot=`) has been landing on the plain default view since it was written. On mount, once the archetype catalogue (+ the Experimental card) has loaded, an unknown/missing archetype or an invalid slot falls through to the default view with no error; a valid pair scrolls to that archetype's section and calls the existing `rotateTo()` imperative handle (same mechanism hop-links already use) — reuses `onSelect`'s existing auto-save path rather than adding a parallel state update.

**Dial Event Log Phase A0 — table rename.** `user_bloom_dial_position` → `user_bloom_dial_current_position` (idempotent `ALTER TABLE RENAME`, same precedent as the existing `client_flavor_feedback` rename), purely to make the current-setting/history split legible from the name once a real history log existed alongside it. Table comment added stating the contract. Both `users.ts` queries updated; grepped the whole repo — no other code references, only two doc/spec files that weren't touched (`PROFILE_DATA_OWNERSHIP_AND_USE_CASES.md`, `the_bloom_page/...PART3...md`, both historical/informational, not live code).

**Dial Event Log Phase A — the two-layer model.** `user_bloom_dial_current_position` (SQL) stays exactly what it was: silently auto-updated on every dial turn, no history, no narration. `users/{uid}/dial_events` (new Firestore collection) logs only two *intentional* kinds — `explicit_save` (a new "Save to my flavor memory" button, added once in `ArchetypeSection.tsx` so it renders on all four dial surfaces: `/bloom`, both Find My Flavor screens, Profile) and `add_to_cart` (fired alongside the existing add-to-cart flow, position/coffeeId riding along). `PATCH /api/users/dial-position` gained optional `trigger`/`source`/`coffeeId` — requests without `trigger` are byte-identical to the old silent auto-save path (old clients unaffected); requests with a valid `trigger` additionally append the Firestore doc, fire-and-forget, a logging failure never fails the request. `ArchetypeSection.tsx` took a new `source` prop (`'bloom' | 'find_my_flavor_returning' | 'find_my_flavor_results' | 'profile' | null`, default `null` so nothing else had to change) threaded through all four render sites.

**Action Links Phase B — chat action markers.** `LIAM_BASE_PROMPT` (`claude.ts`) gained a mechanical "Action markers" section: Liam may end a reply with `<<action:retake_quiz>>` or `<<action:open_dial>>`, at most one per turn, never on the opening turn, only once he's actually reached a recommendation. `chatWithSommelier()` now strips any `<<action:...>>` token from the visible reply (malformed/unknown ones included — stripped silently, no action) and returns the recognized ones as `actionTypes`. `sommelier.ts` resolves these server-side — never trusts the LLM for ids: `retake_quiz` needs nothing, `open_dial` resolves the archetype from the session's own quiz-derived context (a new local `ARCHETYPE_NAME_TO_KEY` map, matching `users.ts`'s existing one) and looks up the user's saved dial slot if any (omitted, not guessed, when they have none). Wired into both `/start` (opening turn, defensively — the prompt says never to fire here) and `/message`, with `actions` persisted on the Firestore message doc and returned in both endpoints' JSON so `GET /:sessionId/messages` replays chips correctly on a reopened session too.

**Action Links Phase C — chips in `Sommelier.tsx`.** Below a Liam message carrying `actions`, small pill links matching the thread's existing quiet visual language: "Retake the quiz →" → `/find-my-flavor?retake=1`, "Open your dial →" → `/bloom?archetype=&slot=` (slot omitted when none saved). Links, not chat inputs — clicking navigates away, no round-trip.

**Dial Event Log Phase B — Liam reads `recentDialActivity`.** At session start (`sommelier.ts`, same place `userArchetype`/`previousArchetype` are already gathered), for `EXPLORATION` and `PROFILE_AMBIGUOUS` only, the last ~30 `dial_events` are summarized server-side into a compact per-archetype string (latest position + whether it came from a save or a cart add, save/cart counts) and appended to `enrichedOpeningContext` — never raw events into the prompt. Both intents' seed addendums (`sommelier_config_seed.ts`) gained a line permitting Liam to reference it naturally ("I see you saved a bolder spot recently") only when actually present. **`PROFILE_AMBIGUOUS`, `TASTE_EVOLUTION`, `RECOMMENDATION_MISS`, and `EXPLORATION` addendums also each gained one line nudging the relevant action marker for that intent's own goal** (retake for the first two, open_dial for the latter two) — the marker mechanism itself lives once in the base prompt; per-intent copy just says when it fits. **Seed-file changes only** — `seedSommelierConfig()` is first-run-only and `config/sommelier` already exists live, so none of this reaches production until Dana applies the equivalent addendum edits via the admin portal (`PATCH /api/admin/sommelier/config`), same caveat `SOMMELIER_TASK_6_VOICE.md` already established. Exact proposed copy is in the seed file diff, pending Dana's voice sign-off before going live.

**A mid-session collision, documented for the record**: a second, concurrent Claude Code session (Dana's own, working Profile Parts 4–5 — see #101) committed and rebased against the same working tree while this was in progress, twice reverting `BloomPage.tsx`/`ArchetypeSection.tsx`/`schema.sql` back to their pre-edit state (once mid-session, once again after that session was closed and a rebase folded in an unrelated "quiz v2 rebuild" branch). `users.ts`/`api.ts` survived by landing inside her commits. Both times the lost pieces were plain re-applications (the base files were back to clean HEAD, nothing of hers to lose), not merges — reconstructed fully from this file's own earlier description of the work rather than guessing. Final state verified by grepping every touched file for the expected content, not assumed from either session's history.

**Verified end-to-end**, same session, against a local backend running through the Cloud SQL Auth Proxy (see [[axis_and_bloom_local_cloudsql_testing]]) plus a disposable Playwright/Chromium install, using throwaway signed-up accounts — not just code-reviewed. Found and fixed two real bugs neither `tsc` nor `vite build` could have caught:

1. **Bloom deep-link race condition (real bug, not a test artifact)**: the Phase A effect gated on `[...orderedArchetypes, ...(experimentalData ? [experimentalData] : [])].length > 0` as its "catalogue loaded" signal. `experimentalData` is a separate fetch (`/api/coffees/experimental`) that can resolve *before* the main `/api/coffees/archetypes` fetch — when it does, `all.length` is already 1 (experimental only), which falsely satisfied the guard. The effect then searched for the target archetype in a catalogue that didn't have it yet, concluded "not found," and — because the handled-ref latches permanently — never retried once the real data arrived a moment later. A `/bloom?archetype=floral&slot=X` link would silently land on the default view depending on which fetch happened to win the race, which in production is genuinely nondeterministic. Fixed by tracking an explicit `catalogueSettled` state (`Promise.allSettled` over both fetches) instead of inferring "loaded" from array length.
2. **Schema rename hard-failing on boot (real bug, production-confirmed)**: a deploy-ordering race left production with *both* `user_bloom_dial_position` (empty, 0 rows — recreated by an older build's `CREATE TABLE IF NOT EXISTS` running at a moment when the name had already been vacated by this commit's rename) and `user_bloom_dial_current_position` (the real, correctly-renamed data, 6 rows). The rename DO block's `IF EXISTS` guard only checked the source name, so on every subsequent boot it attempted the rename again and hard-failed with "already exists" — and because `schema.sql` runs as one multi-statement batch, that failure silently aborted every statement after it for that boot (verified directly against the live table state via the Auth Proxy, not assumed from the error message alone). Fixed by also guarding on the target name not existing, and — after verifying the stray table was genuinely empty — dropped it directly in production. No data was ever at risk; all 6 real rows were correctly in the renamed table the whole time.

With both fixed: confirmed a valid `/bloom?archetype=floral&slot=4` deep link now genuinely scrolls to and rotates the dial (verified via the rendered position-card heading changing, not just the scroll), and an invalid one falls through cleanly to the default view with no error. Confirmed the "Save to my flavor memory" button flips to "Saved ✓" and writes the exact expected `dial_events` doc (`trigger: explicit_save`, right archetype/slot/source, `coffeeId: null`); confirmed add-to-cart independently writes its own doc (`trigger: add_to_cart`, right `coffeeId`) without delaying the cart action. Confirmed a real Liam conversation via the live Anthropic API: the opening turn correctly never carries an action (`openingActions: []`), and a mid-conversation turn where the customer hinted at wanting a retake correctly returned `actions: []` and a clean, marker-free reply — Liam asked a clarifying direction question ("what's shifted — bolder, lighter, or different?") instead of firing prematurely, which is exactly the "only once you've concluded" rule working as intended, not a failure to fire. Confirmed the frontend renders zero chips when `actions` is empty. **Not independently observed**: an actual `<<action:...>>` marker firing and rendering as a chip — this needs either a longer conversation than was practical to drive live, or (more importantly) Dana's sign-off on the addendum copy and its application to live `config/sommelier`, since the marker instruction doesn't reach production until then regardless. The parsing/stripping/resolution code path itself is exercised (confirmed producing correct empty results), just not the positive case.

### 103. Profile Part 6 — post-deploy fixes: journey history root-cause + backfill, intro overlap, in-place adjacent exploration, profile deep link (2026-07-18)

Executed `backend/src/features/profile_page/CLAUDE_CODE_PROMPT_PROFILE_PART6_POST_DEPLOY_FIXES.md`, four issues from Dana's screenshot review of Parts 1–3.

**A — "Palate over time" showing only one stale "first quiz" entry.** Diagnosed against Dana's real account before touching anything: `users/{uid}/metadata/taste_journey` genuinely only had 1 `archetypeHistory` entry despite 15 real `quiz_session` rows in SQL. Root cause was **not** a currently-active bug — it's the historical fallout of the 3-segment Firestore path bug already fixed in #100 (Part 2): every quiz completion before that fix threw synchronously and silently dropped its journey write; only the very next quiz after the fix (her Jul 18 retake) succeeded, and since it was the doc's actual first successful write, the code correctly-but-misleadingly labeled it `first_quiz`. Confirmed going forward already worked correctly (a same-session retake for a fresh test account appended a second `retake` entry immediately, no reload needed). Still hardened per the spec regardless of root cause: (1) `quiz.ts`'s journey write no longer sits inside the same try/catch as `computeBehavioralConfidence` — bc now computes best-effort in its own try/catch first, so a bc failure can never again block the journey write from running; (2) `users.ts`'s `flavor-memory` read now distinguishes "doc genuinely missing" from "read threw" — only the former falls back to the single-entry SQL synthetic reconstruction, a real read failure now 500s instead of silently fabricating history. **Backfill**: new one-time idempotent script `backend/scripts/backfill-taste-journey.ts` (dry-run by default, `--apply` to write) rebuilds `archetypeHistory` from SQL `quiz_session` for any user whose SQL session count exceeds their journey-entry count — matches existing entries by `quizSessionId` (preserving their real `confidenceLevel`), fills in the rest with `confidenceLevel: null` (not fabricated), recomputes `trigger`/`currentArchetype`/`evolutionCount`/`currentStreakCount` from the full merged chronological sequence. Dry-run hand-verified against Dana's account (`evolutionCount: 13` matched a manual count of archetype transitions across her 15 sessions), then applied for real: **10/10 users who've ever quizzed needed backfill, 25 entries total** — confirming the pre-fix bug affected every account, not just hers. Second dry-run pass after applying confirmed 0 users need backfill (idempotent). Guest quizzes (never saved to SQL) are unrecoverable and stated as such, not silently omitted.

**B — intro block text overlap.** `Profile.tsx`'s `renderStageNote()` (the "You haven't tried your match yet" / "Your next delivery" line) had `-mt-6` instead of `mt-6` — a negative top margin pulling it up into the feature list above instead of spacing it below. One-character-class fix; a positive margin can't overlap the element above it regardless of viewport width or how tall the list wraps, so this holds at 390px without needing pixel-by-pixel re-verification of every width.

**C — "Worth exploring" chips now expand in place (Dana's decision, supersedes the Part 3 spec).** `WorthExploring.tsx` changed from `<Link>`s that ejected to Flavor Intelligence into buttons with an active state (border/color change + ✕ when active). `Profile.tsx` gained a second, fully independent `ArchetypeSection` state instance for the adjacent archetype (own `adjacentSortOrder`/`adjacentRevealedKeys`/`adjacentDialRef`, own `getDialPosition` fetch) — same "never share state between two on-screen instances" pattern `FlavorQuiz.tsx` already uses for its two screens — so turning the adjacent dial or revealing its panel never touches the primary section above. Clicking the active chip again (or its ✕) collapses it; clicking the other chip swaps it, one open at a time. A demoted "See in Flavor Intelligence →" escape-hatch link sits above the expanded section for users who still want to leave. Browser-verified: expand, swap between both chips, collapse, primary section state untouched throughout.

**D — "Your flavor profile →" link added to `RevealedPanel`'s action row, every surface except Profile.** New optional `profileLink` prop on `TastingNotes.tsx` (third link alongside the existing explore/Liam links), threaded as `hideProfileLink` (default `false` = shown) through `RevealedPanel` → `ArchetypeSection`. Only `Profile.tsx`'s two `ArchetypeSection` calls (primary + adjacent) pass `hideProfileLink` — every other consumer (`/bloom`, both Find My Flavor screens) compiles unchanged and picks up the link automatically. Shown to guests too (`/profile` redirects to sign-in, the right nudge right after finishing the quiz). Browser-verified present on `/bloom` linking correctly to `/profile`, and absent from both `ArchetypeSection` instances on the Profile page itself.

**A mid-session note on the shared working tree**: a second, concurrent Claude Code session (Dana's own, working #102's Liam Action Links + Dial Event Log) was active in the same checkout throughout this session. Its commit (`b73f5d9`) ended up including several of this task's in-progress edits to shared files (`users.ts`, `ArchetypeSection.tsx`) since both sessions were editing the same working tree — confirmed via `git diff HEAD` on each shared file that nothing from either session was lost or overwritten, purely additive on both sides.

**Verified end-to-end** against real Cloud SQL + Firestore via the Auth Proxy, backend `tsc --noEmit` clean, frontend `vite build` clean. Browser-verified with a throwaway signed-up test account (not Dana's real account, to avoid adding more noise to her already-backfilled history): full quiz completion → A's live-append behavior (first_quiz then retake, two different archetypes, both showing correctly); B's fixed spacing; C's full expand/swap/collapse cycle; D present on `/bloom`, absent on Profile. All test data (SQL rows, Firestore docs, Firebase Auth user) cleaned up afterward. Dana's own account backfill (A) was applied directly against production with her explicit go-ahead, verified via a direct Firestore read before and after. **Not independently re-verified this pass**: 390px pixel-exact overlap check for B (the fix is structurally viewport-independent — see above — so not re-tested at every width); `SUBSCRIBER` stage's "Your next delivery" copy (same `renderStageNote()` fix, no subscription test data seeded this pass).

**Same-session follow-up**: Dana asked to cap "Palate over time" to the 3 most recent entries by default (her own account's backfill made it 15 long), with a way to see the rest, and to order it most-recent-first rather than oldest-first. `PalateTimeline.tsx` now reverses `entries` (still oldest-first from the API — unchanged, in case another consumer relies on that order) purely for its own render, shows the first 3 of that reversed list by default, and a "Show full history (N)" / "Show recent only" toggle swaps in the rest — a plain toggle rather than a numeric picker, since a fixed collapse count plus an escape hatch covers the actual need. Verified with a fresh throwaway account seeded via 4 direct `POST /api/quiz/results` calls (bypassing the UI for speed — same effect as 4 real completions): collapsed view showed the correct 3 newest, the toggle expanded/re-collapsed correctly, and the entry order read newest archetype first down to the original `first_quiz` entry last. Cleaned up afterward.

### 104. Liam SMS Dial Question — channel parity for the lighter/bolder question (2026-07-18)

Executed `backend/src/features/ai_agent_liam/CLAUDE_CODE_PROMPT_LIAM_SMS_DIAL_QUESTION.md`. Prerequisite (Profile Part 2's `expectation → dial_position_signal` write logic, #100) confirmed already shipped before starting.

**Extracted the shared resolver.** Part 2's coffee → archetype → dominant-dimension → `dial_position_signal` insert logic was inlined in `orders.ts`'s feedback route, exactly as the spec anticipated ("if Part 2 inlined it in the route, extract it"). Pulled it into a new `backend/src/services/dialPositionSignal.ts` (`writeDialPositionSignal({ coffeeId, expectation, source, notes })`) — `as_expected`/`null` writes nothing, same rule both channels already followed. `orders.ts` now calls it instead of carrying its own copy; behavior unchanged, verified by diffing the generated SQL/params before and after.

**Outbound copy** (`schedulePostDeliveryMessage`, `liamSmsFeedback.ts`): both the primary and fallback SMS variants now also ask "lighter or bolder than you expected?" — customer language, not the dimension name, per `SOMMELIER_TASK_6_VOICE.md`. The question is never dropped for length; only the fallback's greeting shortens. Checked programmatically against a worst-case realistic name+blend (`"Maximilian-Alexander"` + `"Ethiopian Yirgacheffe Reserve"`): primary 150 chars, both variants always ≤160 and always carry the question.

**Reply parsing extended**: the existing Haiku parse now also extracts `expectation: 'lighter' | 'as_expected' | 'bolder' | null` (null when the reply doesn't address it — never guessed), and `feedback_events` gains the same `expectation` field on-site v2 already writes, keeping the two channels' docs interchangeable. When `expectation` is `lighter`/`bolder`, the SMS row's `blend_id` is resolved to a `coffee_id` and handed to the shared `writeDialPositionSignal()` with `source: 'sms_feedback'` — schema already had this covered (`dial_position_signal`'s `source` CHECK and `dial_source_weight`'s seed both already included `sms_feedback`, from #75/#84 — no migration needed here.

**A real, currently-live bug found and fixed during testing, not theoretical**: verified the Haiku parse against the spec's own three test replies via the real Anthropic API (`"loved it, way bolder than I expected"` → `bolder`, `"it was nice"` → `null`, `"a bit weak honestly"` → `lighter` — all three matched exactly) and discovered Haiku currently wraps its JSON response in ` ```json ... ``` ` fences despite the "no explanation" instruction. The existing `JSON.parse(raw)` call — unchanged since Sommelier Task 5 — has no fence-stripping, so it would throw on essentially every real reply and silently fall back to `sentiment: neutral, rating: 3, descriptors: []` for *all* fields, not just the new `expectation` one. This is not a regression this task introduced — it was already live — but it sits in the exact block this task extended, so fixed it here: strip a leading ` ```json`/`` ``` `` and trailing ` ``` ` before parsing. Re-verified against the real API post-fix: all three replies parse cleanly.

**Verified end-to-end** against real Cloud SQL via the Auth Proxy: the three Haiku test replies above (real API calls, not mocked), and `writeDialPositionSignal()` called directly against a real coffee (Crosshatch, `coffee_id=1`) — resolved to `archetype: balanced_sweet`, `dimension_id: 5`, inserted with `source: sms_feedback, direction: more` for a `bolder` expectation, and confirmed `as_expected` writes nothing (row count unchanged). Test rows cleaned up afterward. `tsc --noEmit` clean. **Not verified**: the full webhook-to-Firestore path end-to-end (no live SMS provider wired — `smsProvider.ts` is still a stub, per Sommelier Task 5) and `v_dial_position_consensus` reflecting a real `sms_feedback` row (implied by the confirmed schema/weight seed and the direct insert test above, not independently queried this pass). `RECOMMENDATION_SYSTEM_PROMPT`'s stale "Spicy & Earthy" line, scheduling rules, opt-in logic, and the never-ask-twice invariant are all untouched, per the spec's explicit scope.

---

### 105. FIX-01 — Mobile nav menu accessibility: Escape close, focus trap, scroll lock (2026-07-19)

Executed `launch/05_site-readiness/FIX-01_mobile_nav_menu.md` (the new `launch/` workstream reorg's site-readiness fixes, ahead of paid mobile ad traffic starting ~Aug 3).

**Audit first, as the spec required.** The spec's premise — "the nav links are `hidden md:flex` with no mobile alternative at all" — was already stale: the mobile hamburger menu (trigger button, slide-down panel, full link set, close-on-tap/route-change) was actually built and shipped in the 2026-07-15 home-v3 session (#98), three days before the launch-plan doc was written. Confirmed via `git log -- Navigation.tsx` rather than assuming either the spec or the file was right. Desktop nav audit: THE AXIS, THE BLOOM, FIND MY FLAVOR, FLAVOR INTELLIGENCE, ADMIN (signed-in admins only) as links, plus a Profile icon, Sign-out (signed-in only), and a Cart icon that are always visible regardless of viewport (not gated by `md:`). All confirmed present in the mobile panel — none dropped, none added.

**What was actually still missing**, checked against the spec's own accessibility requirement line by line: Escape-to-close, a focus trap inside the open panel, body scroll lock while open, and returning focus to the trigger on close — none of the four existed. Added all four in `Navigation.tsx`: a `useEffect` keyed on `mobileOpen` that sets `document.body.style.overflow = 'hidden'` while open (restored on cleanup), focuses the panel's first link on open, adds a `keydown` listener closing on `Escape` and wrapping Tab/Shift+Tab between the panel's first/last focusable elements, and returns focus to the trigger button (via ref) on cleanup. Also added `role="dialog"`/`aria-modal="true"`/`aria-controls` wiring the trigger to the panel by `id`. No changes to desktop layout/styling, the link set, or any component this touches beyond `Navigation.tsx` itself.

**Quiz/admin nav-hiding requirement (spec item 5)**: confirmed structurally via `App.tsx` — `/find-my-flavor` and `/admin` both render outside `PublicLayout`, so `Navigation` (and this menu) never mounts on either route. Nothing to change; verified by reading the router, not assumed.

**Verified**: `vite build` clean. Functionally exercised via direct DOM/JS calls against the real running dev server (open/close toggle, `aria-expanded` flip, body-scroll lock/unlock, Escape-closes, link-tap closes + navigates + restores scroll) — all correct. **Not verified**: true mobile-width visual rendering and the Tab focus-trap/focus-return in a real focused browser — this session's browser automation sandbox reported `document.hasFocus() === false` and window resize requests were silently no-ops, so `document.activeElement` never left `<body>` regardless of what the code did. The trap/return-focus logic is standard and code-reviewed, but Dana should spot-check on a real phone or a real desktop browser window before considering this fully closed. Committed as `ed68e65` (rebased once — a concurrent quiz-fix push to `origin/main` touched only `FlavorQuiz.tsx`, no overlap) and pushed; GitHub Actions Deploy confirmed running for this commit as of writing.

---

### 106. Image pipeline — GCS bucket + optimization Cloud Function + shared frontend registry (2026-07-19/20)

Executed `backend/src/features/image_pipeline/CLAUDE_CODE_PROMPT_IMAGE_PIPELINE.md` (written 2026-07-12, referencing `IMAGE_ASSET_INVENTORY_AND_PLAN.md`'s key table from the same date). All 5 parts.

**Part 1 — GCP.** Created `gs://axis-bloom-assets` (`axis-and-bloom-prod`, `us-central1`, Standard class, uniform bucket-level access). Public read (`allUsers:objectViewer`), Object Versioning on, CORS set (GET/HEAD, any origin), 5-minute `Cache-Control` on every upload (not the JS/CSS `immutable` convention — filenames are stable on purpose, per the spec). Granted `camilamarchon@gmail.com` `roles/storage.objectAdmin` on the bucket (Dana's decision, recorded in the spec, not re-litigated). One extra step the spec's checklist anticipated but didn't fully cover: the GCS service agent (`service-892123729036@gs-project-accounts.iam.gserviceaccount.com`) didn't exist yet in this project and had no `roles/pubsub.publisher` — had to force-provision it (`gcloud storage service-agent`) and grant the role before Eventarc triggers would validate at all.

**Part 2 — Cloud Function.** `cloud-functions/image-optimizer/` (`optimize-bloom-image`, gen2, Node 20, `us-central1`), triggered on `google.cloud.storage.object.v1.finalized` for the bucket. Writes `optimized/<path>.webp` (quality 85) + a `-mobile` variant (800px max width) for every `raw/<path>` upload except `.svg`/`.mp4`, which pass through untouched. **Deployed at 512Mi per the spec's own number — undersized in practice.** Several of the newer, larger source photos (see below) failed with `Memory limit exceeded` (up to 523 MiB used against the 512Mi cap); redeployed at 1024Mi, one file (`balanced-sweet`'s July scan photo, an 11.8MB JPG) still exceeded that (1041 MiB), redeployed again at 2048Mi/120s timeout, which cleared everything. Final config: 2048Mi, 120s, not the spec's 512Mi/60s.

**Part 3 — Upload, expanded past the spec's own file list (see below).** 61 files uploaded to `raw/...` (spec's original plan covered ~29). 16 uploads failed on the first pass — every filename containing `&` (e.g. `WEBCUTBalanced&SweetJun02.png`) — because `gsutil.cmd` is a batch wrapper that gets reprocessed by `cmd.exe`, which treats bare `&` as a command separator; PowerShell's own quoting doesn't protect against that second layer. Fixed by copying each affected file to a temp copy with `&`→`and` in the filename before upload (bucket destination paths were never affected, only the local source path during the `cp` call). Verified every raw upload produced both optimized variants (110/110 `.webp` files present) before moving on, exactly as the spec's own Part 3 check instructed.

**Scope correction, found before Part 3 ran, confirmed with Dana before proceeding:** the source inventory doc is dated 2026-07-12 and had drifted hard from the actual codebase by the time this ran (a week of unrelated quiz/homepage work in between). Checked real current imports via `grep` rather than trusting the doc, and found: (1) `Home.tsx` no longer uses the old per-archetype hero photos the doc's "consolidate onto `archetypeAssets[x].hero`" decision assumed — it now uses 6 new `july_scan1/EDITScan*.jpg` files (53MB) from a photo shoot the doc predates; migrating it per the doc literally would have **reverted Home's current photography to outdated images**, not just moved a file. (2) `TasteFinderSection.tsx` was completely redesigned since the doc was written — it no longer imports `TransparentBag03.png`/`CoffeePic13.png` (the doc's registry keys for it) at all; it now uses 6 inline `?raw`-loaded SVG bags and 6 small pattern JPGs the doc never mentions. (3) `FlavorQuiz.tsx` picked up two large undocumented assets: 6 new `QuizPic01–06.png` (25MB) and a single `CoffeePic10.png` at **26.6MB by itself** — none of this was in the spec, and this is the page paid mobile ads point at directly. Dana chose to expand scope to match reality (keep Home's/Quiz's current content, migrate everything actually live including the newly-discovered ~117MB, don't force a content regression) rather than execute the doc literally.

**Part 4 — Registry + migration.** `frontend/src/design/assets.ts`: `archetypeAssets` (6 slugs × hero/sm1/sm2/bag/wallpaper, matches the doc), plus three sections the doc didn't have — `homeAssets` (Home's own `scan.*` photos + photo-essay triptych, deliberately *not* aliased onto `archetypeAssets[x].hero`, since that would be the same regression described above), `quizAssets` (6 question photos + the large coffee photo), `patternAssets` (6 small patterns shared by FlavorQuiz + TasteFinderSection). Migrated `About.tsx`, `bloomVisuals.ts`, `FlavorQuiz.tsx`, `Home.tsx`, `NewsletterModal.tsx`, `PreLaunch.tsx`, `TasteFinderSection.tsx` (patterns only — its 6 raw-SVG bags stay local imports, deliberately not migrated: they're loaded via Vite's `?raw` as inline markup strings, not `<img src>`, so they don't fit the registry's URL-based shape, and they're tiny, ~0.1MB total, no performance case for moving them), `Navigation.tsx`, `Footer.tsx`, `BloomDialWidget.tsx` (brand SVGs — only the 2 logo files actually still imported anywhere; `LogoCircle`/`LogoQuarter2-4` have zero current references and were left unmigrated, same treatment as any other unused asset). **`Shop.tsx` untouched**, exactly as the spec required — confirmed via `git diff --stat` showing zero changes to it after the whole migration. Kept this pass to a behavior-equivalent swap (`.src` only, no `srcSet`/lazy-loading wiring) since FIX-02 (queued next in the site-readiness workstream, per the 2026-07-18 reorder to FIX-01 → IMG → FIX-02) explicitly still owns loading-behavior changes; every registry entry already exposes `.mobileSrc` so FIX-02 can wire responsive `srcSet` without another migration pass.

**Part 5 — Cleanup + verification.** Deleted only files with zero remaining local imports after the migration (confirmed via a fresh `grep` across `frontend/src`, not assumed from the plan) — 37 files: 6 wallpapers, 4 videos, 4 lifestyle photos, 6 Quiz Pics, 6 July-scan photos, the 3 specific photo-essay files (not the 18 hero/sm1/sm2 files — those stay, `Shop.tsx` still needs them locally), 6 patterns, 2 logo SVGs. `vite build` clean before and after deletion. Compression spot-check: `CoffeePic10.png` 26.6MB → 2.1MB full-size WebP (92% reduction) + 41KB mobile variant; a `july_scan1` scan photo 21.4MB → 6.2MB + 101KB mobile; an archetype bag PNG 1.07MB → 76KB. Live-verified against the real running app (frontend dev server + backend dev server through the Cloud SQL Auth Proxy, see [[axis_and_bloom_local_cloudsql_testing]], not just `vite build`): Home (16/16 images load, both hero/placeholder videos return 200 with correct `video/mp4` content-type), About (all images + TasteFinderSection's pattern backgrounds load, confirmed via computed `background-image`), The Bloom (all archetype images load from the bucket including a same-page real-data fetch, not the "Failed to load coffees" state a missing backend would show), the quiz's opening screen (the migrated large coffee photo loads). `NewsletterModal.tsx`/`PreLaunch.tsx` were code-reviewed but not individually browser-triggered — identical single-image-swap pattern to the ones fully verified elsewhere. Camila's IAM grant was confirmed via the policy binding itself (`roles/storage.objectAdmin` correctly bound to her account) but not simulated end-to-end — no way to impersonate her actual sign-in from this session.

**Not done, deliberately out of scope**: `AxisMap.tsx`'s `GENERIC_bag_front_v3_your_archetype.png` import (small, 0.08MB, no weight case, and not one of the spec's named files) was left as a local import, unmigrated.

---

### 107. FIX-02 — Homepage video compression + loading behavior (2026-07-20)

Executed `launch/05_site-readiness/FIX-02_homepage_media_weight.md` (re-scoped 2026-07-18 to video + in-code loading behavior only, now that #106 owns image compression).

**Audit first**: confirmed via `grep` that `Home.tsx` and `PreLaunch.tsx` have zero remaining local `design/IMAGES` imports (both fully migrated in #106) — nothing to flag as a pipeline straggler. `PreLaunch.tsx` needed no loading-behavior changes at all: it's a fixed full-screen layout with a single always-visible image and no scroll, so there's no "below the fold" concept to apply.

**Video compression, from scratch — `ffmpeg` wasn't installed.** Installed it via `winget install Gyan.FFmpeg` as a local system tool (same category as `gsutil`/`gcloud`, not an npm dependency — nothing added to `package.json`, respecting the spec's "no new dependencies" boundary). Downloaded both `Home.tsx` videos from the bucket, inspected them first rather than guessing settings: both already 1920×1080 H.264 30fps with **no audio track** (nothing to strip). Hero (`home-hero.mp4`, 18.35s) was at ~19.4Mbps — compressed to 2400kbps (libx264, `-preset slow`, faststart) → 42.45MB → **5.41MB**, inside the 5–6MB target. The Liam/placeholder video (`home-placeholder.mp4`, only 2.2s) compressed the same way (CRF 23) → 4.43MB → **0.76MB**. Extracted a poster frame for each via `ffmpeg -ss <t> -frames:v 1` (2s into the hero, 0.5s into the placeholder — both real, meaningful frames, not black/fade frames, visually confirmed before uploading), both well under the 150KB target (76KB/96KB source JPEGs, 60KB/78KB after the pipeline's own WebP pass). Re-uploaded the compressed videos to their *same* `raw/video/` paths (stable URLs, no registry change needed) and the new posters to two new paths, added as two new `videoAssets` registry keys.

**A real bug found and fixed, not just an attribute add.** Setting `preload="none"` on the below-the-fold Liam video alone didn't work — a clean network capture showed it was still fetched at page load. Root cause: the `autoPlay` HTML attribute was also present, and `autoplay` forces the browser to start fetching regardless of `preload`. The file already has a working IntersectionObserver (`observe()`, existing code) that calls `.play()` when the video scrolls into view — removed the native `autoPlay` attribute and let that existing observer drive both playback *and* loading, since a JS-triggered `.play()` on a muted video is universally allowed by browser autoplay policy. Re-verified with a clean network capture (cleared, single navigation, no dev-server HMR noise) against `vite preview` (the actual production build, not the dev server): the placeholder video no longer appears in the initial request list at all. The hero video (above the fold, `autoPlay` correctly kept) shows a `206 Partial Content` request — `preload="metadata"` fetching just the header, not the full file, as intended.

**Below-the-fold images**: added `loading="lazy"` to all of them (§4's 6 archetype cards ×2 images each, §5's 3 photo-essay images). For §4's archetype "scan" photos, switched from `.src` to `.mobileSrc` (the pipeline's 800px-capped variant) — these render as ~200px-wide thumbnail cards in a 6-column grid, so 800px comfortably covers even 3× DPR; verified the math before changing, not after. For §5's photo-essay images (larger, ~400px columns), used a real `srcSet` (`mobileSrc 800w, src 1200w`) with a `sizes` hint instead of a hard cap, since those sit closer to the 800px edge case. Also added explicit `width={1200} height={1500}` plus a CSS `aspectRatio: '4/5'` (checked actual pixel dimensions via `ffprobe` first, not guessed) — §4's images already had layout-shift protection via a fixed-aspect-ratio parent container, §5's did not until this change.

**Verified**: `vite build` clean. Full before/after measured against `vite preview` (production build) with a clean, cleared network capture: **first-load transfer ≈2.4MB** (down from ~120MB), comfortably under the <10MB target; full-scroll worst case (both videos fully played) ≈8.5MB. Poster frames confirmed showing instantly via screenshot before the video buffers. `git diff` on `Home.tsx` confirmed every change is a media attribute/source swap — zero lines touched in `renderSignedInCTA`/`renderStageCTA` or the Company Gift redemption section. **One acceptance criterion partially met, flagged rather than overclaimed**: Chrome's own native lazy-load lookahead distance still prefetched the §4/§5 images somewhat ahead of an actual user scroll in this test (a short, compact page) — `loading="lazy"` is correctly applied at the code level (confirmed via `img.loading === 'lazy'` in the DOM), but the literal "nothing below the fold downloads at page open" wasn't observed in this specific viewport; impact is far smaller now regardless since these are 80–300KB mobile-optimized WebP files, not the original multi-MB originals. **Browser automation broke mid-verification** (a "Cannot access a chrome-extension:// URL of different extension" error, on both the original tab and a freshly created one) after the network/DOM checks above had already completed — stopped retrying per the "don't loop on repeated tool failures" guidance rather than burning further turns on it.

**Explicitly flagged, not fixed — out of FIX-02's named file scope**: `TasteFinderSection.tsx`'s 4 pattern backgrounds (~400KB) and `NewsletterModal.tsx`'s image both still load eagerly on the homepage (the former is rendered inline via `<TasteFinderSection />`, the latter globally via `PublicLayout`) — neither file is `Home.tsx` or `PreLaunch.tsx`, the only two the spec named.

WHAT_WE_BUILT.md #107, SOMMELIER_BUILT.md S56 (no Liam impact).

---

### 108. Step 01 (A1) — Archetype canon cleanup: 5 archetypes, Experimental as category (2026-07-20)

Executed `launch/10_quiz-and-archetypes/01_A1_archetype_canon.md` (v2, rewritten 2026-07-17 after a reverted first run).

**Part 1 — audit.** Grepped every frontend surface rendering archetype names/colors/wallpapers/bag imagery/lists/counts. Found "Spicy & Earthy" already canonicalized to "Earthy" everywhere customer-facing except one place: `bag-spicy.svg`'s baked-in artwork text, rendered live via `TasteFinderSection` (used on Home/About/HowItWorks/Shop, though only Home actually passes a real `archetype` prop — About/HowItWorks/Shop always render the pre-quiz card, never the bag). Found Experimental presented as a 6th taxonomy entry in exactly two places: `About.tsx`'s hardcoded 6-item color strip ("Six flavor archetypes...") and `HowItWorks.tsx`'s hardcoded 6-card grid ("Meet your coffee archetype"). Everywhere else Experimental appears as a 6th item (`Shop.tsx`, `BloomPage.tsx`, `FlavorIntelligencePage.tsx`, `bloomVisuals.ts`, the admin archetype-assignment dropdowns) is a separate, deliberate, already-documented product decision (Bloom Dial Base Data Part 4 §B2/C1's `/api/coffees/experimental` merge, and #78's restored-assignability decision) — not taxonomy drift, left untouched.

**Part 2 — merge.** `bag-spicy.svg`: fixed the one baked-in `<text>` element from "SPICY & EARTHY" to "EARTHY" (layout/colors/other text untouched — a display-text fix, not an asset rebuild). Internal keys (`spicy`, `spicy-earthy` — fixed slugs per `design/CLAUDE.md`) deliberately left alone.

**Part 3 — reclassify.** `About.tsx`: removed the Experimental entry from the `archetypes` array (6 → 5); "Six flavor archetypes" → "Five flavor archetypes". `HowItWorks.tsx`: removed the 6th ("Experimental", `id: '06'`) card from the archetype grid.

**Known gap, flagged not fixed**: `Home.tsx:665` still reads "...maps your palate to one of six flavor archetypes." Left untouched per this task's own hard boundary (never modify the homepage — lifecycle personalization / Company Gift widget history of silent breakage, standing warning at the top of `CAMILAS_UPDATES.md`) even though it's technically a hit for the "no copy says six" acceptance criterion.

**Verified**: `vite build` clean. Backend booted against real production Cloud SQL via the Auth Proxy (see [[axis_and_bloom_local_cloudsql_testing]]). Browser-verified: `/about` and `/how-it-works` render exactly 5 archetypes with no layout break; `/find-my-flavor?result=earthy` and `?result=experimental` (preview shortcut) render correctly — Earthy shows no "Spicy" anywhere, Experimental renders byte-for-byte as before (file untouched); a full real click-through guest quiz completion (6 questions, including the actual `is_experimental_gate=true` DB answer at Q3) completed cleanly end-to-end; homepage's signed-out lifecycle CTA and the Company Gift redemption widget both confirmed still present and untouched.

WHAT_WE_BUILT.md #108, SOMMELIER_BUILT.md S57 (no Liam impact).

---

### 109. Step 02 (B1) — Launch date, GA4 + Meta Pixel, quiz funnel events (2026-07-20)

Executed `launch/20_analytics-and-tracking/02_B1_analytics_funnel_events.md`. GA4 `G-GYC50VYRYN` + Meta Pixel `945138695260153` (already-created IDs from manual setup) wired end-to-end.

**Launch date**: `PreLaunch.tsx` — "Coming September 1." → "Coming October 1." (only occurrence site-wide, confirmed via grep).

**Analytics utility**, new `frontend/src/app/lib/analytics.ts` — GA4 (`gtag.js`) + Meta Pixel, both env-driven (`VITE_GA4_ID`/`VITE_META_PIXEL_ID`), both no-op with zero script tags/network calls when their ID is unset. `send_page_view: false` on GA4 config since this is an SPA — `trackPageView()` fires manually instead, wired via a new `AnalyticsRouteTracker` component (`useLocation` + `useEffect`) rendered inside `App.tsx`'s `<BrowserRouter>`, covering every route change including the initial load. `setAnalyticsConsent()`/localStorage-backed consent flag included so `30_compliance`'s upcoming consent banner has something real to call — defaults to granted since no banner exists yet.

**Custom events** — `trackEvent()`/`trackLead()` wired at: `QuizStart` (first answer selected, `FlavorQuiz.tsx`, guarded to fire once per session), `QuizComplete` (successful `POST /api/quiz/score` response, includes `archetype`), `EmailSubmitted` + Meta's standard `Lead` event (both existing newsletter/subscribe call sites — `NewsletterModal.tsx` and `PreLaunch.tsx` — gated on `res.ok`, not fired blindly like the pre-existing UI does for its own "thank you" state). `Purchase` intentionally left as a stub site — no real checkout exists yet (blocked on Step 08/12).

**First-party funnel logging** (source of truth, since guests dominate and `/api/quiz/score` is public): new table `quiz_funnel_event` (`session_key`, `event` CHECK'd to `quiz_start`/`quiz_complete`/`email_submitted`, `archetype`, `created_at`) + indexes on `session_key`/`created_at`. New `POST /api/quiz/event`, rate-limited (30/min, tighter than the app-wide limiter since it's public and write-only) — thin route in `routes/quiz.ts`, actual insert/validation logic in new `backend/src/features/marketing/funnelEvents.ts` per the plan's standing rule (this folder already existed as a code-only placeholder from the 2026-07-18 reorg, now has its first real file). `FlavorQuiz.tsx` generates one `crypto.randomUUID()` per quiz attempt (a ref, reset on retake) and reuses it across `quiz_start`/`quiz_complete`; the two newsletter call sites generate a fresh one-off key per submission instead, since neither is part of an active quiz session in the current codebase (Step 04's firm email gate, which will make `email_submitted` genuinely quiz-session-scoped, hasn't shipped yet).

**Deployment config**: `.github/workflows/deploy.yml` — added `VITE_GA4_ID`/`VITE_META_PIXEL_ID` as plain (non-secret) values next to the existing `VITE_PRELAUNCH_MODE`, same pattern — these are public tracking IDs, not credentials.

**A real bug found and fixed mid-verification, not part of the spec.** `POST /api/quiz/event` returning `res.status(204).end()` (the only 204 response anywhere in this backend) came back as a synthetic `503` specifically when called from the actual browser through the Vite dev proxy — silent, no server-side trace at all (confirmed via direct `curl`-equivalent calls to both the backend directly and through the proxy via PowerShell, both succeeded with 204; only the real browser fetch failed). Switched to `res.json({ ok: true })`, matching every other endpoint's convention in this codebase — resolved immediately, re-verified via a real click-through. Root cause not fully isolated (browser/extension-layer handling of empty-body 204 responses, not a Vite or Express bug — both proxy and backend individually confirmed healthy) — flagging in case a future 204 response anywhere else in this app hits the same wall.

**Verified**: `tsc`/`vite build` both clean. Backend booted against real production Cloud SQL via the Auth Proxy (see [[axis_and_bloom_local_cloudsql_testing]]). Local dev with env vars unset: confirmed zero requests to `googletagmanager.com`/`facebook.net`/`facebook.com` and a clean console across `/about`, `/find-my-flavor`, and a full quiz click-through. Same click-through with a temporary second dev instance with the real IDs set: confirmed `gtag/js?id=G-GYC50VYRYN` and `connect.facebook.net/en_US/fbevents.js` both load, `dataLayer` receives correctly-shaped `config`/`page_view` events with `gtm.load` confirming Google's runtime processed them, and a real `Lead`-shaped `facebook.com/tr/?...ev=PageView&id=945138695260153` beacon fires — as close to DebugView/Pixel Helper confirmation as achievable without Dana's own GA4/Meta dashboard login. Confirmed via direct DB queries (then cleaned up the test rows afterward) that a real click-through writes `quiz_start` and `quiz_complete` (correct `archetype`) under the *same* `session_key`, and that a real newsletter submission writes `email_submitted`. Homepage's lifecycle CTA/Company Gift widget: untouched, not part of this step's diff.

WHAT_WE_BUILT.md #109, SOMMELIER_BUILT.md S58 (no Liam impact).

---

### 110. Step 04 (A2) — Firm email gate on quiz results, lifecycle-aware (2026-07-20/21)

Executed `launch/10_quiz-and-archetypes/04_A2_quiz_firm_gate_lifecycle.md`. Before any code, located and confirmed reuse of the existing lifecycle mechanism (`refreshLifecycleState()` in `services/userLifecycle.ts`, the same function `Home.tsx`'s `renderSignedInCTA`/`renderStageCTA` reads its stage from) — it was already wired to quiz completion at `routes/quiz.ts:279` inside `POST /api/quiz/results` (fire-and-forget, after `computeBehavioralConfidence`), and `FlavorQuiz.tsx` already calls that route for every signed-in completion. So the "update lifecycle stage on quiz completion" requirement needed zero new code — just verifying the gate rebuild didn't disturb that existing call path, which `git diff routes/quiz.ts` (no changes at all in this step) confirms it didn't.

**The gate itself.** Section 1 (curtain reveal — name/wallpaper/bag) stays free, unconditional. Sections 2-3 (the `ArchetypeSection` instance below the curtain — dial, position card, "why"/coffees in `RevealedPanel`) now render only when `emailGateUnlocked` (`!!user || !!postQuizEmail`), applied identically in both of `FlavorQuiz.tsx`'s result-render branches (the `fromWrapRef` fast path and the full scroll-curtain path). When locked, a new inline `PostQuizEmailGate.tsx` renders in `ArchetypeSection`'s place instead — no skip link, no bypass; scrolling past Section 1 lands on the card since it's genuinely the only thing there in normal document flow, not a modal.

**Lifecycle-aware branches**, all in `FlavorQuiz.tsx`:
- **Signed-in**: never see the card. One effect (keyed on `userProfile`/`archetypeKey`, fires once per archetype) calls the existing subscribe endpoint with `source: 'post_quiz'`; if they weren't already a subscriber (`GET /api/users/profile`'s new `isNewsletterSubscriber` field), shows a one-line consent note once and fires `EmailSubmitted`/`Lead`/the funnel event; if already subscribed, resyncs the archetype fields silently, no note, no event.
- **Guest, first time**: sees `PostQuizEmailGate`. On submit, calls the subscribe endpoint, stores the email in `localStorage` (`axisbloom.postQuizEmail`), fires `EmailSubmitted`/`Lead`/the funnel event, and Sections 2-3 mount immediately — no reload, no waiting on the actual email delivery (that's Step 05's Mailchimp journey, a separate concern).
- **Guest, recognized** (the local flag from a previous visit/retake): no card — a quiet "Your match is on its way to `j***@e***.com`" line (masked) instead, and a silent resync to the current archetype, no repeat analytics event.

**Extended `POST /api/newsletter/subscribe`** (`newsletter.ts`, both the real route and the backward-compat alias) to accept `archetype?`, `experimental?`, `confidence?`, `quizSessionKey?`, plus `optionalAuth` so a signed-in caller's `user_id` gets linked (the column already existed, nothing had ever populated it). New nullable columns on `newsletter_subscriber`: `archetype`, `experimental`, `confidence`, `quiz_session_key` — `COALESCE(new, existing)` on conflict so a later non-quiz signup never wipes a captured result, but a quiz retake's new archetype does overwrite the old one. `GET /api/users/profile` gained `isNewsletterSubscriber` (a separate query after the existing `Promise.all`, keyed off the already-resolved primary email) — the one new read the signed-in branch needed.

**Verified against real production Cloud SQL** via the Auth Proxy: guest first-time flow (card → submit → immediate unlock, no page reload, no bypass by scrolling past Section 1); guest-recognized flow (masked-email line, silent resync, `newsletter_subscriber.archetype` updated, no duplicate funnel event); signed-in flow with a real throwaway test account — first quiz completion via the `?result=` preview shortcut showed the one-line consent note and fired the subscribe + `EmailSubmitted`/`Lead`/funnel event once; a second, *real* click-through completion (6 questions, real `POST /api/quiz/score`) showed no note (already subscribed), no duplicate event, and confirmed `user_lifecycle_state` genuinely transitioned `NEW_NO_QUIZ` → `QUIZ_TAKEN_FRESH_NO_ORDER` via the pre-existing mechanism. All test rows (subscriber, funnel events, quiz session, lifecycle state/event, user_profile) cleaned up from production afterward. `tsc`/`vite build` both clean. Homepage lifecycle CTA/Company Gift widget: not part of this step's diff, confirmed via `git status`.

WHAT_WE_BUILT.md #110, SOMMELIER_BUILT.md S59 (no Liam impact).

---

### 111. Step 04b — FIX: firm gate had shipped as a hard gate (2026-07-21)

Executed `launch/10_quiz-and-archetypes/04b_FIX_firm_gate_reveal_order.md`. Step 04's deploy had deviated from spec: Section 1 (the archetype reveal — name/wallpaper/bag/description) was wrapped inside the same `emailGateUnlocked` conditional as `ArchetypeSection`, so a first-time guest on the actual completion path (`fromWrapRef.current`, the branch every real quiz finish takes — `?result=` preview links are the only thing that reach the other, unaffected scroll-curtain branch) saw nothing but the email card at the end of the quiz: no curtain, no name, no bag. The card's own typography was also inverted (the small supporting line rendered as the huge heading, the actual headline as a small eyebrow).

**FIX 1 — free Section 1 reveal.** New `Section1Reveal` component in `FlavorQuiz.tsx` (wallpaper background, bag image, archetype name, one-line description, same fade/slide-up motion used elsewhere on this screen) rendered unconditionally in the `fromWrapRef` branch, gated only on `archetype` (available synchronously right after scoring) rather than the `archetypesList` fetch that gates `ArchetypeSection` — so it appears immediately, not after a network round trip. Uses `archetype.wallpaper`/`archetype.bag` uniformly for all six archetypes, including Chocolate & Nutty (the unaffected scroll-curtain branch special-cases chocolate with brand text instead of a photo; deliberately not replicated here — pre-Step-04 this path rendered every archetype, chocolate included, through the same unified `ArchetypeSection` with no special case, so uniform treatment is the correct "identical to pre-step-04" behavior, not a new inconsistency).

**FIX 2 — required no code change.** The immediate in-place unlock (`handleGateSuccess` synchronously sets `postQuizEmail`, flipping `emailGateUnlocked` and swapping `PostQuizEmailGate` for `ArchetypeSection` in the same render, no reload/redirect) was already correct from Step 04 — verified live for all three paths rather than assumed.

**FIX 3 — card typography swap.** `PostQuizEmailGate.tsx`: "Where should we send your match?" is now the large heading (was the small eyebrow); "The full why, your matched coffees, and your archetype card — plus first access October 1." is now the smaller supporting line beneath it (was the huge heading) — dropped its uppercase-eyebrow letter-spacing treatment since it's genuinely supporting text now, not a kicker above a title.

**Verified live**, not from code reading — real guest flow against the local dev stack (frontend/backend through the Cloud SQL Auth Proxy against real production Cloud SQL): a genuinely fresh guest (cleared `localStorage` **and** the Firebase `IndexedDB` session — an earlier pass was accidentally testing the *signed-in* path because a prior test session's auth had persisted) saw the full free reveal with no email required, the swapped card hierarchy, and no skip/scroll/URL bypass to Sections 2-3. Submitting a real email unlocked `ArchetypeSection` immediately in place; confirmed server-side too — `newsletter_subscriber` row landed with `source: post_quiz`/correct `archetype`, and `quiz_start → quiz_complete → email_submitted` all logged under one `quiz_funnel_event.session_key`. Signed-in (no card, reveal + sections visible, one-line consent note) and returning-guest (no card, masked-email line, sections auto-unlocked) paths both confirmed live as well. Homepage lifecycle CTA/Company Gift widget: not part of this fix's diff (`FlavorQuiz.tsx`/`PostQuizEmailGate.tsx` only), confirmed via `git status`. All test rows (subscriber + funnel events) cleaned from production afterward, re-verified at 0 rows. `vite build` clean.

WHAT_WE_BUILT.md #111, SOMMELIER_BUILT.md S60 (no Liam impact).

---

### 112. Step 04c — COPY: email-gate sub-line + button text (2026-07-21)

Executed `launch/10_quiz-and-archetypes/04c_COPY_gate_card_text.md`. Two strings in `PostQuizEmailGate.tsx`: sub-line "The full why, your matched coffees, and your archetype card — plus first access October 1." → "See why this is you — and meet the coffees chosen for your taste. First access when doors open October 1."; button "Show My Match" → "Show me why" (button was inaccurate — the archetype is already revealed above the card by Step 04b; the button unlocks the why + coffees, not the match itself). Headline, email field, and all gate behavior untouched. Confirmed via `grep` that neither old string exists anywhere else in `frontend/src` (single occurrence each, no shared constant to fork). `vite build` clean.

WHAT_WE_BUILT.md #112, SOMMELIER_BUILT.md S61 (no Liam impact).

---

### 113. Step 07 (A3) — Share-your-match card: 5 public share pages + OG images + share row (2026-07-21)

Executed `launch/10_quiz-and-archetypes/07_A3_share_your_match.md`.

**5 public share pages** at `/match/<slug>` — `floral`, `fruity`, `balanced-sweet`, `chocolate-nutty`, `earthy` (the 5-archetype canon; Experimental excluded, per its own CONTEXT). Hand-authored standalone static HTML under `frontend/public/match/<slug>/index.html` (Vite copies `public/*` verbatim into `dist/`) rather than a React/SPA route with build-time prerendering — this codebase has no existing SSR/prerender tooling, and the task's own item 3 explicitly names "host them as static files" as an equally valid simplest-correct option. Firebase Hosting's static-file priority + clean-URL resolution serves `dist/match/<slug>/index.html` directly to crawlers ahead of the SPA catch-all rewrite in `firebase.json` — confirmed live, not assumed (see Verified below).

Each page: full OG/Twitter meta tags (title, description, `og:image` reusing the archetype's existing hero photo straight from the GCS bucket registry — no new image asset created, per the "reuse archetype assets" constraint), zero personal data, and real visible content matching brand (name, one-line description, tagline, "Find your flavor" CTA into `/find-my-flavor`) — a human landing on the page sees the same thing a crawler's preview shows, not a meta-tag-only shell. Same color palette as the quiz results screen's own `ARCHETYPES` data for continuity with what the user just saw.

**New `ShareMatchRow.tsx`** — one-tap share row rendered on the free Section 1 reveal (available even to a locked first-time guest; sharing an identity match doesn't need email capture, and Section 1 is unconditional per Step 04b). `navigator.share` feature-detected (not UA-sniffed) for the native share sheet; falls back to `navigator.clipboard.writeText` + a "Link copied" state change. Fires `share_match` via the existing `trackEvent()`. Wired into both of `FlavorQuiz.tsx`'s result-render branches, right after `Section1Reveal`; hidden entirely (`shareSlug === null`) for Experimental.

**Verified**: `vite build` clean; confirmed `dist/match/<slug>/index.html` exists for all 5. Live on production: fetched the raw HTML of all 5 `/match/<slug>` URLs directly (no JS execution, matching what a real crawler sees) and confirmed every `og:title`/`og:description`/`og:image`/`twitter:*` tag is correct per archetype; confirmed all 5 `og:image` URLs resolve 200 `image/webp`. Share row confirmed rendering on the live results screen. **Not independently click-verified**: the exact "Link copied" fallback UI swap — `navigator.share` is genuinely available in the browser used for testing, so the native-share branch was the one actually exercised; the clipboard-fallback branch was code-reviewed (standard, widely-supported API, wrapped in try/catch) rather than click-verified, since `navigator.clipboard.writeText`'s permission prompt hangs non-interactive browser automation. Local dev note (not a production gap): Vite's dev server doesn't do Firebase Hosting's automatic directory-index resolution, so `/match/<slug>` needs an explicit `/index.html` suffix locally — confirmed this is dev-only by testing the deployed site directly.

WHAT_WE_BUILT.md #113, SOMMELIER_BUILT.md S62 (no Liam impact).

---

### 114. Step 06 (B3) — Reporting views, read-only role, admin Marketing links (2026-07-21)

Executed `launch/20_analytics-and-tracking/06_B3_reporting_views_admin_links.md`.

**4 reporting views** in `schema.sql` (`v_subscribers_weekly` by source, `v_quiz_funnel_weekly` with completion/opt-in rates, `v_archetype_distribution` by share, `v_orders_weekly` — returns 0 rows pre-launch, not an error). All `DROP VIEW IF EXISTS` + recreate on every startup, same pattern as the existing `v_*` views.

**`reporting_ro` role** — created `NOLOGIN` in `schema.sql` so no credential ever lives in git; Dana enables `LOGIN` + sets a real password manually (Secret Manager), documented in the workstream README. Granted `CONNECT` + `USAGE` on the schema + `SELECT` on the 4 views only — re-granted every startup since `DROP VIEW` revokes privileges on the old view object. Verified directly against production Cloud SQL (via the Auth Proxy): temporarily enabled login with a throwaway password, confirmed `SELECT` succeeds on the views and is denied (`permission denied for table ...`) on `newsletter_subscriber` and `"order"`, then reverted to `NOLOGIN` — no lasting credential.

**Admin Marketing row** — new `marketing_config` key/value table (3 seeded rows: `looker_studio_url`, `mailchimp_audience_url`, `adspend_sheet_url`), `GET`/`PATCH /api/admin/marketing/config` (thin routes in `admin.ts`, logic in `backend/src/features/marketing/reportingConfig.ts`), and `AdminDashboard.tsx` gained a "Marketing" card row above the existing 6 cupping-stat cards (demoted under a "Cupping & Catalogue" label) — each card is click-to-edit (same inline-edit convention as `coffee_alias.platform_name`) and links out once a URL is set. Empty by design until Dana pastes the Looker Studio URL in at M3.

**Verified**: backend + frontend both typecheck/build clean. Ran `schema.sql` against production Cloud SQL via the Auth Proxy — all 4 views return real data (`v_subscribers_weekly`/`v_quiz_funnel_weekly`/`v_archetype_distribution` non-empty from live traffic, `v_orders_weekly` empty as expected pre-launch), role + grants confirmed exactly as specified via `information_schema.role_table_grants`. **Not browser-verified**: `/admin`'s Marketing row itself — no admin test credentials this session (`/admin` redirects unauthenticated visitors to `/`, same limitation as prior sessions); code-reviewed against the proven `AdminDashboard.tsx`/`AdminCoffees.tsx` patterns instead. Dana should spot-check with a real admin account and complete the manual GCP steps (role password + Looker Studio connector access) below.

WHAT_WE_BUILT.md #114, SOMMELIER_BUILT.md S63 (no Liam impact).

---

### 115. Step 03 (B2) — Compliance pack: privacy, terms, consent banner (2026-07-21)

Executed `launch/30_compliance/03_B2_compliance_pack.md`. Depended on Step 02's analytics utility (#109), which had already anticipated this step — `analytics.ts` shipped with a `setAnalyticsConsent()` hook and a comment flagging that its default-granted behavior was a stopgap "since no consent banner exists before launch/30_compliance's step."

**Consent default flipped.** `readStoredConsent()` used to return `true` when nothing was stored yet (everyone tracked by default pre-banner). Now returns `false` until an explicit choice is stored — `hasStoredConsentChoice()` is the new export `ConsentBanner.tsx` reads to decide whether to render itself. `setAnalyticsConsent()`'s own accept/reject wiring needed no changes — it already force-reinitialized on a granted choice.

**New `ConsentBanner.tsx`** — fixed bottom bar, two equal-weight buttons ("Essential only" outlined / "Accept" filled, same size, no pre-selected default), rendered once at the `App.tsx` root (inside `<BrowserRouter>`, alongside `<AnalyticsRouteTracker />`) so it covers every layout — public site, the quiz's own minimal chrome, and PreLaunch — without being duplicated per-layout. Suppressed only on `/admin` (internal staff, not the paid-ad visitor the banner exists for) via a `pathname.startsWith('/admin')` check, not a route-level omission.

**New `/privacy` and `/terms` pages** (`Privacy.tsx`/`Terms.tsx`, added to `App.tsx`'s `PublicLayout` route group). Privacy covers quiz/taste-profile data, account + order data, newsletter (Mailchimp as processor), GA4/Meta Pixel (gated on consent), cookies, and a deletion contact — extended slightly beyond the prompt's named list to also mention AI chat with Liam (Anthropic) and SMS feedback, since those are real data flows a plain-language policy shouldn't omit. Terms includes the Right Match Promise as an explicit placeholder pending the Aug 8 pricing workshop, matching `launch/30_compliance/README.md`'s own framing. Contact email is `hello@axisandbloomcoffee.com` — corrected mid-session from a guessed `privacy@` address after Dana caught it; `noreply@axisandbloomcoffee.com` (the existing transactional sender) was never a candidate since it's one-way.

**Linked from every layout — this took more than the standard `Footer.tsx`.** `Footer.tsx`'s Privacy/Terms links were already-present `#privacy`/`#terms` placeholders, just rewired to real routes. But `PublicLayout` suppresses that Footer entirely on `/`, `/about`, and `/find-my-flavor` (`noFooter`/`footerInPage` logic) — Home and About instead render their own footer-like nav line inside `TasteFinderSection.tsx`, which had no legal links at all before this change; added them there too (also fixes `/how-it-works`, which embeds the same component). The quiz (`FlavorQuiz.tsx`) has no footer whatsoever — added a minimal Privacy/Terms line beneath the results screen's existing content, not on every internal quiz state (name entry, questions), since the results screen is the layout's natural bottom. `PreLaunch.tsx` (the pre-Oct-1 front door, no shared layout at all) got its own minimal link pair too.

**Consent copy** ("We'll email your match and early access — unsubscribe anytime.") added under all three real email-capture forms: `NewsletterModal.tsx`, `PostQuizEmailGate.tsx`, `PreLaunch.tsx`. `SignIn.tsx`/`Profile.tsx`/`FamilyTab.tsx`/admin forms audited and excluded — authentication or internal-admin email fields, not marketing capture.

**Verified live** against the local dev stack (frontend/backend through the Cloud SQL Auth Proxy, GA4/Pixel IDs unset locally so no network-request check was possible here — that half of Step 02's original verification already covered the "IDs unset → zero calls" case and is unaffected by this change): cleared `localStorage` → banner appeared on first load; clicking "Essential only" set `axisbloom.analyticsConsent = 'false'` and dismissed it permanently across reloads; `/privacy` and `/terms` both render correctly; `Footer.tsx`'s and `TasteFinderSection.tsx`'s Privacy/Terms links both navigate correctly (confirmed via a real click, not just markup inspection) on `/how-it-works`; the quiz results screen (`/find-my-flavor?result=floral`) shows the new minimal footer line. `vite build` clean. No DB schema change — consent state is client-side only (`localStorage`, same mechanism Step 02 already established), so `WHAT_WE_BUILT_DB.md` is untouched by this step.

**Not done, flagged rather than assumed**: no legal review of the generated text (the prompt's own note, and `GAPS.md` #21 / this workstream's `M-legal` row — both already call this out as a standing manual step, not something this step could satisfy).

WHAT_WE_BUILT.md #115, SOMMELIER_BUILT.md S64 (no Liam impact).

---

### 116. Step 03b — ADD: "Nature of Recommendations" clause to /terms (2026-07-21/22)

Executed `launch/30_compliance/03b_ADD_recommendations_clause.md`. One section inserted into `Terms.tsx`, verbatim per the prompt, immediately before "The Right Match Promise" (same `h2`/`p` style constants already defined in the file — no new styling). No other section, page, or file touched; confirmed via `git diff --stat` showing only `Terms.tsx`. No "beta"/unfinished-product language used, per the prompt's hard boundary.

**Verified**: `vite build` clean; live text (via a real page fetch, not just a diff read) confirmed the clause renders verbatim and sits directly above the Right Match Promise placeholder. Standing trio not independently re-run — this diff touches only static Terms copy, nothing in the quiz/homepage/newsletter paths the trio covers.

WHAT_WE_BUILT.md #116, SOMMELIER_BUILT.md S65 (no Liam impact).

---

### 117. M1 — Welcome Journey: Mailchimp HTML/text templates (2026-07-23)

Turned `launch/40_email-marketing/WELCOME_EMAILS_DRAFT_v3.md` (final, verbatim copy) into 5
production-ready Mailchimp templates — `email1.html`–`email5.html` + matching `.txt` versions,
plus `MAILCHIMP_SETUP.md` (exact import/journey-build/Email-5-campaign click-path) — all under
the new `launch/40_email-marketing/templates/` folder. Content assets only; no `backend/` or
`frontend/` files touched, no DB schema change (`WHAT_WE_BUILT_DB.md` untouched by this entry).

**Typography — real Genova, self-hosted.** The live site currently ships Lato (its most recent
typography commit, `cab3716`, actually reverted Genova → Lato — confirmed by reading the current
`theme.css`/`fonts.css` and `git log`, not assumed from stale docs). Per Dana's explicit call and
the brand's visual identity deck (`misc/design_documents/Axis & Bloom logo and visual identity_
adjustments2 (1).pdf`, p.8), these emails use the real Genova typeface instead. Dana supplied the
`.ttf` files, committed at `misc/design_documents/genova/` (`383184e`). Base64-embedding them
inline was considered and rejected — 3 weights (Regular/Thin/Black, matching the site's own
settled convention) raw ≈126KB, ~168KB base64-inflated, per email, which alone would push every
send past Gmail's ~102KB clipping threshold. Instead, uploaded the 3 weights to the existing
public `gs://axis-bloom-assets` bucket at `raw/fonts/genova/` (same unprocessed-passthrough
convention as `frontend/src/design/CLAUDE.md`'s `raw()` helper), verified publicly reachable
(200, `Content-Type: font/ttf`), and referenced via `@font-face` with an Arial/Helvetica fallback
for clients that don't support it (Outlook desktop, mainly).

**Typographic hierarchy, not new copy.** Applied the Visual Foundations brief's own stated
ordering ("recognize the person, then present the system": Primary = Identity, Secondary =
Recommendation, Tertiary = Explanation, Quaternary = optional System Depth) purely through size/
weight/color — no wording changed anywhere. Email 1 got a real display moment: a 15px kicker
("*|FNAME|*, your match is in.") under a 36px/900 archetype-colored headline ("You're
ARCHETYPE."), the per-archetype flavor paragraph promoted into a callout bordered in the same
archetype color, and the Liam/Taste Memory paragraph deliberately receded to the site's existing
muted gray (`#7b7f80`) — "depth available, never imposed." Emails 2–5 each got a 26px/900 section
headline reusing that email's own already-authored v3 working title verbatim.

**Personalization.** Email 1's per-archetype flavor paragraph (and its accent-bar/headline color)
uses `*|IF:ARCHETYPE=...|*` Mailchimp conditional blocks keyed on the exact display-name strings
the backend already sends (`Floral`, `Fruity`, `Balanced & Sweet`, `Chocolate & Nutty`, `Earthy`
— confirmed against `FlavorQuiz.tsx`'s `ARCHETYPES[key].name`, the same value Step 05's Mailchimp
sync uses for the `ARCHETYPE` merge field); the `ELSE` branch reuses the site's live Experimental
description verbatim rather than inventing new copy, and also covers a blank/unsynced value.
Emails 3 and 5's CTAs use the same conditional pattern to link to the real public `/match/<slug>`
pages Step 07 already shipped (slug convention confirmed against `ShareMatchRow.tsx`: `floral`,
`fruity`, `earthy`, `chocolate-nutty`, `balanced-sweet`; Experimental/unset falls back to
`/profile`, same as `ShareMatchRow` hiding its own share row for Experimental). Email 4 links
statically to `/profile`. CAN-SPAM footer on every template via Mailchimp's own `*|LIST:ADDRESS|*`
+ `*|UNSUB|*` merge tags rather than a hardcoded address.

**Verified**: a standalone preview harness (not committed — browser-only) confirmed all 5
templates render and that the `*|IF|*` conditional logic (flavor paragraph, accent-bar/headline
color, `/match/<slug>` CTA) resolves correctly for each of the 6 simulated archetype values,
using a small parser mirroring Mailchimp's own merge-tag syntax. **Not yet done**: a real
Mailchimp test send (the harness's own parser isn't Mailchimp's, and email-client `@font-face`
support varies — flagged in `MAILCHIMP_SETUP.md`), and M2 itself (building the actual Mailchimp
Customer Journey + the Email 5 one-off campaign) — both manual steps for Dana, fully spec'd in
`MAILCHIMP_SETUP.md`.

**Found, not fixed (out of scope — outside this task's `frontend/` boundary)**: `ShareMatchRow.tsx`
hardcodes `https://www.axisandbloomcoffee.com` (with `www`) for its `/match/<slug>` links, while
`launch/README.md`'s explicit rule and every link in these email templates use
`https://axisandbloomcoffee.com` (no `www`). Both almost certainly resolve today; flagged for
Dana/Camila to reconcile.

WHAT_WE_BUILT.md #117, SOMMELIER_BUILT.md S66 (no Liam impact).

---

### 118. Pricing update — $38→$32/12oz, $199→$185/5lb, plus removed the hardcoded fallback entirely (2026-07-24)

Dana's request: update the bag price to $32.00/12oz (and $185.00/5lb, since that size already exists in the model). **Audit first, before any change**: both `dial_slot_price` and `coffee_retail_price` — the tables the admin "slot-price matrix" is supposed to edit — were completely empty in production (0 rows each). Every price shown anywhere on the site was actually coming from a single hardcoded fallback constant, `BLOOM_DEFAULT_PRICE_CENTS` in `backend/src/routes/coffees.ts`, applied whenever no DB row exists (which was always). A second, client-side mirror of the same constant lived in `AdminCoffees.tsx`, used only to preview the effective price of an unset slot in the admin matrix. No hardcoded price strings found anywhere in frontend copy — every displayed price is already rendered dynamically from `retailPriceCents`.

**Seeded real rows** (`backend/src/db/migrations/pricing_update_2026_07_24.sql`, idempotent — `ON CONFLICT DO NOTHING`, safe to re-run, won't clobber a future admin edit): 32 rows into `dial_slot_price` (the 16 currently-active, non-guest archetype+dial_sort_order slots × 2 weights) and 8 into `coffee_retail_price` (the 4 "other category" coffees with no dial position: Sleepwalker Half-Caf, Decaf, Hazelnut, Chocolate) — all at 3200/18500 cents. Ran directly against production via the Auth Proxy; before/after query confirmed 0→32 and 0→8 rows, all at the correct new prices.

**Then Dana's follow-up call, mid-task**: no hardcoded fallback price at all, ever — a slot/coffee with no price row should show as an explicit, visible gap, not silently default to a guessed number (this is exactly the failure mode that let $38/$199 sit unnoticed for however long). Removed `BLOOM_DEFAULT_PRICE_CENTS` entirely; `buildSlotsForArchetype`'s and `GET /api/coffees/other-categories`' price arrays now simply omit a weight with no explicit DB row instead of guessing. New `isUnpriced` signal threaded through (`usePositionCardData.ts` computes it for dial slots; `GET /api/coffees/other-categories` returns it directly for other-category coffees) and rendered as **"Unpriced"** in `PositionCard.tsx`/`OtherCategoryCard.tsx` — reusing the exact same box/badge treatment already established for "no coffee resolved for this slot" (`isActive: false` → "Temporarily unavailable"), just a different label so it's clear *what's* missing (a coffee vs. a price). `AdminCoffees.tsx`'s mirrored fallback constant removed too, same reasoning.

**Verified**: `tsc --noEmit` clean on both frontend and backend (frontend has no build-time type gate normally — ran an ad-hoc equivalent tsconfig for this change only; the handful of pre-existing errors it surfaced are all in unrelated files — `AdminDial.tsx`, `Footer.tsx`, `Home.tsx`, `Profile.tsx`, `TheAxis.tsx` — none introduced by this change). Traced every consumer via grep before editing (`<PositionCard` has exactly one call site, `ArchetypeSection.tsx`, updated; `<OtherCategoryCard` call sites in `BloomPage.tsx`/`FlavorIntelligencePage.tsx` pass the whole `coffee` object through, so `isUnpriced` needed no call-site changes there). Confirmed live on `axisandbloomcoffee.com` post-migration: "12oz · $32.00" / "5lb · $185.00" both render and are selectable, cart works — this took effect immediately on running the migration, independent of the code deploy, since the public read endpoints query `dial_slot_price`/`coffee_retail_price` live on every request. The new "Unpriced" state itself wasn't visually demoed in production — nothing is currently unpriced, since every active slot/coffee was just backfilled — but is covered by the type-check + manual trace above. Comments in `schema.sql`/`admin.ts` documenting the old $38/$199 default updated for accuracy (then made moot by the fallback's removal, left corrected regardless since they still describe the tables' history).

WHAT_WE_BUILT.md #118, WHAT_WE_BUILT_DB.md updated, SOMMELIER_BUILT.md S67 (no Liam impact).

---

### 119. Guest identity — Firebase Anonymous Auth + fold guests into existing quiz/lifecycle machinery (2026-07-28)

**Files:** `frontend/src/app/context/AuthContext.tsx`, `backend/src/middleware/auth.ts`, `backend/src/routes/orders.ts`, `backend/src/routes/household.ts`, `backend/src/routes/companyGiftRedemption.ts`, `backend/src/routes/tokens.ts`, `backend/src/routes/sommelier.ts`, `frontend/src/app/components/FlavorQuiz.tsx`, `frontend/src/app/components/Home.tsx`

**Problem**: Since the quiz-first homepage change (#108), most quiz-takers are guests who never sign in. Two systems that already exist and work for real accounts were invisible to them: quiz answer persistence (`POST /api/quiz/results` is `requireAuth`, only called `if (user)` from `FlavorQuiz.tsx`) and the customer lifecycle system (`user_lifecycle_state`/`classifyStage()`, entirely keyed on `user_profile.firebase_uid NOT NULL`). Full spec: `backend/src/features/guest_identity/CLAUDE_CODE_PROMPT_GUEST_ANONYMOUS_AUTH_AND_LIFECYCLE.md`.

**Decision**: rather than build a parallel guest-tracking system, give every visitor a real (invisible) Firebase Anonymous Auth identity, so they flow through the existing quiz-persistence and lifecycle machinery with zero duplicated logic — both already do a lazy `INSERT ... ON CONFLICT (firebase_uid)` upsert and don't care whether the uid came from an anonymous or real sign-in. No schema migration needed.

**Frontend (`AuthContext.tsx`)**: `onAuthStateChanged` now calls `signInAnonymously(auth)` when `u === null` (first visit or fully signed out) instead of leaving `user` null; the resulting re-fire of the listener handles `isAdmin`/`loading`. The `/api/users/profile` isAdmin check is now skipped for anonymous users (`!u.isAnonymous` gate) — avoids creating a `user_profile` row on every anonymous page view as a side effect of that endpoint's lazy upsert. New `isGuest` boolean on the context (`!!user && user.isAnonymous`).

**Conversion — link, don't replace**: `signUp()` now uses `linkWithCredential(auth.currentUser, EmailAuthProvider.credential(...))` when the current session is anonymous (falls back to `createUserWithEmailAndPassword` otherwise) — the same `firebase_uid` carries forward, so quiz history/lifecycle state merge automatically with zero backend changes. `signInWithGoogle()`/`signInWithApple()` try `linkWithPopup()` first when anonymous, falling back to a plain `signInWithPopup()` if that provider identity already belongs to a separate real account (`auth/credential-already-in-use`). `signIn()` (email/password into a pre-existing account) is unchanged by design — there's no credential to link, and Firebase doesn't support merging two already-real accounts; the anonymous session's data is simply abandoned in that one case, matching Firebase's own model.

**Backend (`middleware/auth.ts`)**: `AuthRequest` gained `isAnonymous?: boolean`, set in `requireAuth`/`requireAdmin`/`optionalAuth` from `decoded.firebase?.sign_in_provider === 'anonymous'` — Firebase issues normal verifiable ID tokens for anonymous users, so `verifyIdToken()` needed no change. New `blockAnonymousAuth` middleware (chained after `requireAuth`) returns `403 { error: 'Create a free account to continue', code: 'anonymous_not_allowed' }` for anonymous callers. Applied to every purchase/account-management route: `orders.ts` (`POST /`, `GET /`, `POST /:orderId/feedback` — no guest checkout), all seven `household.ts` routes, `companyGiftRedemption.ts`'s `POST /:code/redeem`, both `tokens.ts` routes, and all six `sommelier.ts` routes (Liam stays real-account-only for now, independent of any future "Liam for guests" decision). Left untouched — the guest-friendly surfaces this feature unlocks: `quiz.ts`'s `POST /results`, `users.ts`'s profile/homepage-state/dial-position/flavor-memory/address routes, `newsletter.ts` (already `optionalAuth`), `auth.ts`'s `/sync` (harmless either way, never called for anonymous sessions per the frontend change above).

**Frontend guest-aware checks**: `FlavorQuiz.tsx`'s `if (user) { saveQuizResult(...) }` guards were left as-is on purpose — they now fire for anonymous guests too, which is the actual mechanism that gets guest quiz answers into `quiz_session`. Three checks that used to mean "signed in vs. guest" were updated to mean "real account vs. still-anonymous": `emailGateUnlocked` now requires `!user.isAnonymous` (anonymous auth gives no email — the post-quiz email card still has to run for guests); the recognized-guest resync effect's `user` guard now excludes only non-anonymous users (still fires for guests who already gave an email); the signed-in auto-subscribe effect now also bails on `user.isAnonymous` (that silent, no-card path is for genuine real accounts only). `Home.tsx`'s homepage CTA branch now reads `(!user || (user.isAnonymous && !homepageState))` — an anonymous guest sees the name-capture form only until `homepage-state` resolves (which now succeeds for them too, per the backend change above), then switches to the same lifecycle-driven CTA (`renderStageCTA`) real users get; this same condition also covers the loading-flash edge case (`renderSignedInCTA()` returns `null` while `homepageStateLoading` is true) — a first-time guest still sees the capture form during that window instead of a blank section. `refreshHomepageState`'s `if (!user)` guard needed no code change — `user` is already truthy for anonymous sessions, so it was already firing for guests.

**Manual prerequisite — resolved (2026-07-28, same session)**: the spec's own instruction assumed enabling Anonymous sign-in required the Firebase Console UI and flagged it back to Dana as something "Claude Code cannot do." That assumption was wrong — the initial 403 from the Identity Platform Admin API (`identitytoolkit.googleapis.com/admin/v2/projects/.../config`) turned out to be a missing `x-goog-user-project` quota-project header, not a permissions gap (the account already has `roles/owner`). Once that header was added, `GET` confirmed Anonymous was **not** enabled (absent from the `signIn` block — only `email` was present); a follow-up `PATCH` with `updateMask=signIn.anonymous.enabled` turned it on, and a second `GET` confirmed `signIn.anonymous.enabled: true` persisted. Done via API with Dana's explicit go-ahead, not the console — the feature is now fully live end-to-end, no outstanding manual step.

**Not done in this pass (by design, per spec)**: no cross-device guest recognition (a guest who takes the quiz on two devices gets two anonymous identities unless they've already given an email); signing into a pre-existing separate real account from an anonymous session abandons that session's history rather than merging it; every visitor now gets a free-tier Firebase Auth identity including instant bounces (expected, cheap, not a cost concern at this site's scale).

**Verification checklist (manual, hand back to Dana/Camila per the spec — not run here)**: fresh incognito visit silently creates an anonymous user; completing the quiz as that guest writes real `quiz_session` + `user_lifecycle_state` rows; reloading shows the lifecycle CTA instead of the blank capture form; creating a real account afterward keeps the same `uid` and the guest's quiz/lifecycle history visible under `/profile`; `POST /api/orders` as a still-anonymous guest returns `403 anonymous_not_allowed`; a Google/Apple identity that already belongs to a separate real account falls back to signing into that account.

WHAT_WE_BUILT.md #119, WHAT_WE_BUILT_DB.md updated (no schema change), SOMMELIER_BUILT.md S68 (no Liam RAG/session-logic impact — sommelier routes just gained the real-account gate).

---

### 120. Guest identity follow-up — fix Navigation/Profile guest-access gaps, add stale-anonymous-guest purge cron (2026-07-29)

**Files:** `frontend/src/app/components/Navigation.tsx`, `frontend/src/app/components/RequireAuth.tsx`, `frontend/src/app/App.tsx`, `backend/src/routes/users.ts`, `backend/src/services/staleGuestCleanup.ts` (new), `backend/src/routes/cron.ts`

**Problem**: #119 gave every visitor an anonymous Firebase identity and updated `AuthContext.tsx`/`FlavorQuiz.tsx`/`Home.tsx` to distinguish real accounts from guests, but missed two other files still gating on plain `user` truthiness — now true for every visitor. `Navigation.tsx` showed the "Sign out" button and linked the profile icon to `/profile` for anonymous guests too; a guest clicking "Sign out" called `signOut(auth)` on their anonymous session, which `AuthContext`'s listener immediately replaced with a brand-new unrelated anonymous uid — there's no "log back in" for an anonymous identity, so this permanently orphaned that browser's prior quiz result. Separately, `/profile` had no `RequireAuth` wrapper and `Profile.tsx`'s own `if (!user)` guard also passed for guests, so a guest reaching `/profile` (via the mis-guarded nav icon, or a direct link) triggered `GET /api/users/profile`'s lazy `user_profile`/Firestore-mirror upsert for whatever uid was active — confirmed in the Firebase console as `users/{uid}` docs containing nothing but `syncedAt`. Full spec: `backend/src/features/guest_identity/CLAUDE_CODE_PROMPT_GUEST_IDENTITY_FOLLOWUP_NAV_AND_CLEANUP.md`.

**Part A — stop the bleeding**: `Navigation.tsx` now destructures `isGuest` from `useAuth()` and gates both "Sign out" buttons (desktop + mobile) and the profile icon's link target on `!isGuest`. `RequireAuth.tsx` now treats an anonymous session as unauthenticated (`if (!user || isGuest)`) — the same intent as the backend's `blockAnonymousAuth`, applied at the route-gate layer. `/profile` in `App.tsx` is now wrapped in `RequireAuth`, same pattern as `/sommelier`, so a guest hitting it is redirected to `/sign-in` before ever reaching the API. As defense in depth, `users.ts`'s `GET /profile` and `PATCH /profile` also gained `blockAnonymousAuth` (chained after `requireAuth`, same as `50cb4af`'s other routes) — belt-and-suspenders in case any other path ever reaches these while anonymous; the client-side fix is what actually matters for the UX. `homepage-state`/`dial-position`/`flavor-memory`/address routes are untouched — still the guest-friendly surfaces #119 intended.

**Part B — scheduled purge of stale anonymous guests**: standard Firebase Authentication (not the Identity Platform tier) never auto-deletes anonymous users, so every anonymous identity — from the sign-out bug above, or ordinary churn (incognito, multi-device, cleared cookies) — would otherwise accumulate in Auth/Postgres/Firestore forever. New `backend/src/services/staleGuestCleanup.ts` exports `purgeStaleAnonymousGuests()`, run daily via a new `GET /api/cron/purge-stale-anonymous-guests` (`cron.ts`, same `requireCronSecret` pattern as the existing `liam-sms-send`/`expire-company-gift-codes` jobs). Retention policy (confirmed with Dana): a guest who never completed the quiz is purged 7 days after `user_profile.created_at`; a guest who completed the quiz but never converted or ordered is purged 90 days after their most recent `quiz_session.completed_at`. Both SQL candidate queries (capped at 500/run each) exclude anyone with a `user_email.is_verified = true` row or any `"order"` row as a cheap pre-filter, but the real gate is live: for every candidate uid, `admin.auth().getUser(uid)` is checked and only a record with `providerData.length === 0` (still purely anonymous — `linkWithCredential`/`linkWithPopup` keep the same uid, so this can't be inferred from Postgres alone) proceeds to deletion; anything linked is skipped even if it matched the SQL query. Deletion order per confirmed-stale uid: `admin.auth().deleteUser()` (skipping `auth/user-not-found`), `firestoreDb.recursiveDelete()` on `users/{uid}` (covers `quiz_sessions`/`feedback_events`/`metadata`/every other subcollection in one call, per the Admin SDK's own recursive-delete rather than hand-rolled per-subcollection deletes), then `DELETE FROM user_profile WHERE firebase_uid = $1` in its own try/catch (an unanticipated FK violation is logged and counted as skipped rather than aborting the batch — most user-scoped tables cascade; `"order"` deliberately doesn't, though an anonymous guest should never have one since `blockAnonymousAuth` already blocks anonymous checkout). Returns and logs `{ checked, purged, skipped }`.

**Verified**: `tsc --noEmit` clean on the backend (new service + route + middleware changes); `vite build` clean on the frontend (2127 modules, no errors) — no dedicated frontend type-check gate exists per #118's note, so the production build stood in for it. Not run: the manual verification checklist below (needs a deployed environment and an artificially-aged test guest).

**Manual prerequisite (flagged back to Dana/Camila, same as #119's Firebase Console step)**: a **Cloud Scheduler** job must be created pointing at `GET /api/cron/purge-stale-anonymous-guests` with the `x-cron-secret` header set to the existing `CRON_SECRET`, same pattern as OT-2/OT-13 in `OPEN_TASKS.md`. Suggested: once daily, off-peak. This is infrastructure provisioning outside the repo — not something to do from code.

**Not done in this pass (by design, per spec)**: no changes to `signInAnonymously`/`linkWithCredential`/`linkWithPopup` mechanics themselves (correct as built in #119); no "log back into your guest session" feature (anonymous auth has no such concept — the fix is removing the "Sign out" action that destroys a guest's only path back to their data, not adding a recovery flow); no backfill/purge of orphaned docs that predate this fix — the new cron job catches them on its first run once the 7/90-day windows apply.

WHAT_WE_BUILT.md #120, no schema change (WHAT_WE_BUILT_DB.md untouched), SOMMELIER_BUILT.md S69 (`RequireAuth.tsx`'s tightened guard also wraps `/sommelier` — reinforces, doesn't change, Liam's existing real-account-only gate).

---

### 121. Hotfix — #120's `blockAnonymousAuth` on `GET /api/users/profile` was over-broad, broke guest quiz recognition (2026-07-30)

**File:** `backend/src/routes/users.ts`

**Problem**: #120's "defense in depth" step put `blockAnonymousAuth` on both `GET /profile` and `PATCH /profile`. The `PATCH` block was correct — `Profile.tsx` is its only caller and it's now behind `RequireAuth`. The `GET` block was wrong: `getUserProfile()` (`frontend/src/app/lib/api.ts`) isn't just `Profile.tsx`'s data source — it's also called by `FlavorQuiz.tsx` (twice — the initial profile-fetch effect and `refreshUserProfile()`), `BloomPage.tsx`, and `CartContext.tsx`, all guest-facing. Every one of those call sites swallows the error with `.catch(() => {})`, so nothing threw — a guest just silently stopped being recognized as having already taken the quiz, every single time, in every browser context. Confirmed live: fresh anonymous session hitting `/find-my-flavor` got `GET /api/users/profile → 403`. This is what Dana was seeing as "the quiz doesn't remember me." Quiz data itself was never affected — `POST /api/quiz/results` was untouched by #120 and kept saving correctly; this was purely a broken read-back path, not data loss.

**Fix**: removed `blockAnonymousAuth` from `GET /profile` only, restoring `router.get('/profile', requireAuth, async (req: AuthRequest, res) => {`. `PATCH /profile` keeps the block, unchanged. `GET /profile`'s own logic already null-safes a guest with no history (lazy-upserts `user_profile`, returns nulls for anything unset) — that's exactly what guest callers were already relying on before #120 ever shipped; the API-level block was always the redundant half of #120's fix, not the actual mechanism. The actual mechanism — `RequireAuth` wrapping the `/profile` page, and `Navigation.tsx` no longer linking guests there — is untouched and still holds.

**Verified** (local dev servers against production Cloud SQL/Firestore/Firebase Auth via the Cloud SQL Auth Proxy, Playwright-driven, per the spec's checklist): fresh anonymous guest's `GET /api/users/profile` → `200` (not `403`); completed the quiz via the API as that guest, reloaded `/find-my-flavor` → showed the returning-guest screen ("YOUR COFFEE PROFILE — Your primary profile is Fruity — WELCOME BACK") instead of restarting the quiz; direct nav to `/profile` as that guest still redirected to `/sign-in` (#120's `RequireAuth` fix intact); `PATCH /api/users/profile` as that guest still returned `403 anonymous_not_allowed`. Test guest identity deleted immediately after (Firebase Auth, Firestore, Postgres) rather than left for the purge cron.

WHAT_WE_BUILT.md #121, no schema change, no Sommelier-adjacent files touched (SOMMELIER_BUILT.md untouched).

---

### 122. HOME Task 1 — Config Source of Truth: seed-vs-live drift indicator + one-click apply (2026-07-30)

**Files:** `backend/src/db/seeds/sommelier_config_seed.ts`, `backend/src/routes/admin.ts`, `frontend/src/app/components/admin/AdminSommelierConfig.tsx`

**Problem**: `SOMMELIER_BUILT.md` S35 and S51 both edited the sommelier config seed file expecting it to reach production, and both shipped inert — `seedSommelierConfig()` is a no-op once `config/sommelier` already exists in Firestore, so a seed edit alone never touches the live document. The only thing that ever actually fixed it was a one-time ad-hoc script (`backend/scripts/update-intent-addendums.mjs`). `home_v3`'s Task 1 (`backend/src/features/ai_agent_liam/home_v3/HOME_TASK_1_CONFIG_TRUTH.md`) replaces that pattern before any home_v3 content ships through the same config document.

**Declared rule**: the admin portal's live `config/sommelier` document is canonical. Seed files are for fresh environments only.

**Backend**: `sommelier_config_seed.ts`'s config object is now a named export, `DEFAULT_SOMMELIER_CONFIG` — pure refactor, no values changed; `seedSommelierConfig()` spreads it plus `updatedAt`. Two new admin-gated endpoints in `admin.ts`: `GET /api/admin/sommelier/config-drift` deep-compares the seed object against the live document (recursing through plain objects, comparing arrays/primitives as leaves by `JSON.stringify` equality) and returns one `{ path, seedValue, liveValue }` entry per differing dot-path — a key present on only one side falls out of the same recursion with the missing side as `undefined`, so there's one list, not two. `POST /api/admin/sommelier/config-apply` takes `{ paths: string[] }`, looks up each path's value in the seed object, and writes via Firestore's dot-notation `update()` — which merges at the leaf rather than replacing the document, so unlisted paths and any live-only keys are untouched. Writes an audit doc per apply to `config/sommelier/audit/{autoId}` (uid, email, paths, timestamp).

**Frontend**: `AdminSommelierConfig.tsx` gained a "Config Source of Truth" section above the existing editor — a drift badge ("seed differs from live: N fields" or a quiet "seed and live match"), an expandable per-field diff list with pre-checked checkboxes, and an apply button that posts the selection and refreshes both the drift list and the config form. One sentence in the UI states the source-of-truth rule.

**Verified** (`tsc --noEmit` clean on the backend; no dedicated frontend type-check gate exists per #118's note, verified by careful review instead): ran a full drift → apply → audit → cleanup cycle directly against the real `config/sommelier` document — there's no separate dev Firestore project, `axis-and-bloom-prod` is the only one configured, so this was done deliberately against prod with immediate revert, per house convention #5's "prod spot-checks where the task says so." Temporarily added a live-only test key and a simulated seed/live diff on `ragLimits.maxCoffees`; the drift endpoint's logic reported exactly those two paths; applying only the numeric path updated it correctly while leaving the live-only key untouched (confirming the merge doesn't clobber siblings); the audit doc recorded the right paths; `onSnapshot` picked up every write immediately. All test artifacts (the temp key, the value change, the audit doc) were reverted/deleted before finishing — the live document ended in its original state.

WHAT_WE_BUILT.md #122, `WHAT_WE_BUILT_DB.md` gained the `config/sommelier/audit/{autoId}` entry in the Firestore path table, `SOMMELIER_BUILT.md` S70 (full detail + the S35/S51 incidents this closes).

---

### 123. HOME Task 2 — Modes & Topic Router: two response contracts, turn-level topic routing, mode-aware context assembly (2026-07-30)

**Files:** `backend/src/services/topicRouter.ts` (new), `backend/src/services/claude.ts`, `backend/src/routes/sommelier.ts`, `backend/src/services/sommelierConfig.ts`, `backend/src/db/seeds/sommelier_config_seed.ts`, `backend/src/db/schema.sql` (comment only)

**What this builds**: a turn-level topic classifier beneath Liam's existing six-intent evaluator (untouched by this task), giving knowledge-dominant turns ("how do I brew this?", "what's the process on this one?") a second response contract — a wider word ceiling, a numbers-are-always-allowed carve-out, no frozen six-coffee catalog block, and the expertise model regardless of the existing keyword/length heuristic. Matching-mode turns (recommendation flow) are unaffected.

**`topicRouter.ts` (new)**: `routeTopic(message, sessionContext)` — keyword rules per topic (`config.topics`, seeded with `brewing`/`equipment`/`origins_process`/`my_coffee`/`caffeine_decaf` as expertise-mode topics, `matching`/`other` as matching-mode), checked in a configurable priority order. Stickiness: the previous turn's topic carries forward when nothing matches this turn (so "and what about temperature?" keeps the prior topic), decaying after `config.topicRouter.stickyDecayTurns` (seed: 2) silent turns. No match, no sticky topic → `null`/matching — today's Liam, unchanged.

**`claude.ts`**: `assembleSystemPrompt()` pulled out as its own pure, exported function (no network call) so the system-prompt assembly is directly testable — `chatWithSommelier()` calls it internally, now accepts an optional `mode` param (default `'matching'`, preserving every existing call site's behavior). Added a "Guardrails" section to `LIAM_BASE_PROMPT` (caffeine/health — explicitly covers medication/pregnancy/children, deferring to a professional; equipment — categories only, never models/prices; origins — speak only from provided context, never invent) — this section is in the base prompt, so it applies in both modes. `max_tokens` is now config-driven for both modes (`config.responseContracts.matching/expertise.maxTokens`) instead of a hardcoded `200`; matching mode's seeded default is still `200`, so nothing changes unless an admin tunes it later.

**`sommelier.ts`**: `/message` now calls `routeTopic()` before generating a reply, passes the resulting mode into `chatWithSommelier()`, and — new — persists `currentTopic`, `currentTopicTurnsSinceMatch`, and an appended `topicLog` entry back into `sommelier_sessions.context_data` every turn. Before this task, `context_data` was written once at session start and never updated again; this is the first thing to change that.

**Config**: 5 new top-level sections in `config/sommelier` (`topics`, `topicRouter`, `responseContracts`, `contextAssembly`) plus `modelRouting.expertiseModelOverride` — added to `DEFAULT_SOMMELIER_CONFIG` in the seed and pushed live via the exact operation Task 1's `config-apply` endpoint performs (dot-path merge + audit doc), since Task 1 (#122) is now deployed and a one-off script is exactly the pattern it exists to retire. 22 new paths applied, zero existing values touched (verified programmatically before applying), zero remaining drift after.

**Verified**: `tsc --noEmit` clean. The verification Dana cared about most — captured the pre-change assembly logic from git and diffed it against the new code for a matching-mode turn: the only difference, in both a mid-session and a final-turn scenario, is the deliberate Guardrails insertion; stripping exactly that block from the new output reproduces the old output character-for-character, so nothing else in the matching-mode path drifted. Expertise mode confirmed: catalog omitted, numbers carve-out present, guardrails present in both modes. Topic router tested against the real live config (post-push): fresh keyword match, sticky pronoun carry-forward, decay clearing after exactly the seeded 2 silent turns, cold ambiguous message → null/matching. Persistence tested end-to-end against a marked test `sommelier_sessions` row (no real Firebase account needed — `uid` has no FK) via the Cloud SQL Auth Proxy: 4-turn sequence, `topicLog` correct at each step, `topicLog` survives session close, test row deleted after.

**Not verified this pass**: reading real conversation transcripts against the voice rules (S32 pattern) — there's no live traffic yet that could have hit expertise mode, since this hasn't shipped to users. Do this once real expertise-mode conversations exist.

**Out of scope, unchanged**: token/meter logic (Task 3), memory markers (Task 4), story content (Task 5), the six-intent evaluator and its priority/selection logic, any frontend surface.

WHAT_WE_BUILT.md #123, `WHAT_WE_BUILT_DB.md` gained the `context_data` shape additions (`currentTopic`, `currentTopicTurnsSinceMatch`, `topicLog`) and the schema.sql comment update, `SOMMELIER_BUILT.md` S71 (full detail).

---

### 124. HOME Task 3 — Meter Retirement & the Invisible Guard Layer: token meter retired customer-facing, config-driven gating (default off), operator guard layer (2026-07-30)

**Files:** `backend/src/services/sommelierGuards.ts` (new), `backend/src/services/tokenService.ts`, `backend/src/routes/sommelier.ts`, `backend/src/routes/admin.ts`, `backend/src/services/sommelierConfig.ts`, `backend/src/db/seeds/sommelier_config_seed.ts`, `backend/src/db/schema.sql`, `frontend/src/app/components/Sommelier.tsx`, `frontend/src/app/components/admin/AdminSommelierFlow.tsx`

**What this builds**: Liam moves inside the subscription (§5, decided 2026-07-27) — no customer ever sees a token balance, a cost, or "buy tokens" again. `tokenEconomy.gatingEnabled` (new config flag, seed default `false`) controls whether `/start`/`/message` still gate on balance (`true`, today's old behavior, kept as a rollback lever) or just log that a turn happened (`false`, the new default — no balance check, no spend, no rollback path needed). The `user_tokens`/`token_events` schema stays exactly as-is; what replaces the meter as the actual usage bound is a new operator-facing guard layer (§4.8).

**`sommelierGuards.ts` (new)**: `checkDailyCap(uid)` (default 60/day, counted from `token_events` — both the gated and ungated turn paths already write one row per turn, so one SQL counter covers either state of `gatingEnabled`); `getMonthlySpendEstimate`/`checkMonthlySpendAndAlert` (turns × a configured $/model estimate, `console.warn`-logged once per user per day when crossing the configured ceiling — a planning estimate, not real Anthropic billing data); `checkAggregateAnomaly` (today's turns vs. the trailing 7-day average, for the admin dashboard, not checked per-turn).

**`tokenService.ts`** gained exactly one new export: `logUsage(uid, referenceId, model)` — the ungated-turn accounting row (`delta: 0`, no lock, no balance mutation). Every existing export is untouched.

**`token_events`** gained a nullable `model TEXT` column (additive) — which model handled a turn, needed for the monthly-spend estimate.

**`sommelier.ts`**: both `/start` and `/message` branch on `gatingEnabled` (balance-check-and-spend vs. `logUsage`), gained a daily-cap check (a fixed, Liam-voiced closing line — not a model call, per S33's "hard rules belong in code" — the user's message still saves, the session closes with `close_reason: 'daily_cap'`, same shape as a normal turn-limit close), and gained per-IP and per-account rate limiting (`express-rate-limit`, thresholds config-driven, `windowMs` fixed at 1 minute, **per-instance** since Cloud Run runs multiple instances — a documented, accepted tolerance at this scale, not a global limit).

**Admin dashboard**: `GET /api/admin/sommelier/stats` and `AdminSommelierFlow.tsx` gained a Guard Layer section — today's turns, a 7-day trend, top-10 users by turns this month with estimated spend + an over-ceiling flag, daily-cap hit count, and the aggregate anomaly flag. Admin-only.

**`Sommelier.tsx`**: removed the sidebar token balance, "Buy tokens," the status-row token count, the zero-balance "get more tokens" block, and the two fetches (`/api/tokens/balance`, the config fetch for `purchaseEnabled`) that only existed to feed them. The turn counter (`X/N`) stays — a session shape, not a price. `402`/`429` (only reachable via the `gatingEnabled` rollback lever or the invisible daily cap) now degrade to a generic error state, never token/limit language. Side-effect fix: a pre-existing placeholder-text bug (`inputDisabled` was true during ordinary `sending`, incorrectly showing "No tokens remaining") is gone along with the tokenBalance condition it depended on.

**The grep Dana asked for specifically**: every read of `tokenBalance`/`token_events`/`user_tokens`/`tokenEconomy`/`costPerTurn`/"Buy tokens"/`purchaseEnabled` across `frontend/src`, broadened to a case-insensitive `token`/`balance` sweep per the S44 lesson (don't stop at the first, narrower grep). Three files matched the narrow grep: `Sommelier.tsx` (fixed, above) and `AdminSommelierConfig.tsx`/`AdminSommelierFlow.tsx` (admin-only, legitimately out of scope — admins are exactly who'd flip the rollback lever). The broadened sweep's other hits were all unrelated (`getIdToken()` auth calls, a text-splitting type named `QuoteToken`/`CinToken` in `Home.tsx`, visual/flavor "balance" copy on marketing pages). **Confirmed: nothing customer-facing renders a token balance anymore.**

**Config pushed live via the config-drift/config-apply mechanism, not a one-off script**: 8 new paths (`tokenEconomy.gatingEnabled`, `guards.*`), every one confirmed new before applying, 0 remaining drift after.

**Verified** (no separate dev Firestore/Postgres — `axis-and-bloom-prod` is the only environment; confirmed with Dana before flipping anything live that no deployed Cloud Run instance was serving real traffic during this pass, and that the final `gatingEnabled` state, `false`, was her explicit choice): `tsc --noEmit` clean. `ALTER TABLE token_events ADD COLUMN IF NOT EXISTS model TEXT` applied directly against prod ahead of deploy. Created a marked test user (real `user_profile`/`user_tokens` rows, since `user_tokens.uid` FKs to `user_profile` unlike `sommelier_sessions.uid`): with `gatingEnabled=false`, a zero-balance user logged two `usage_log` turns with balance staying at 0. Flipped `gatingEnabled` to `true` live — `spendToken` correctly blocked the zero-balance user, then correctly succeeded after a grant (confirming `spendToken`/`grantTokens` still work); flipped back to `false` immediately. Forced `dailyTurnCap` to 3 live — correctly hit; a manually-inserted yesterday-dated row confirmed the day-boundary query excludes it. Restored `dailyTurnCap` to 60. All test rows deleted; live config ended exactly at Dana's specified final state.

**E5 TODO — not touched this pass, per explicit scope** (`launch/40_email-marketing` untouched): the welcome-journey E5 email's "expanded token allowance for Liam" line needs the full-sommelier-access reword before it ships, since the meter it references is gone. Flagged for the email workstream owner.

**Out of scope, unchanged, per the task spec**: no schema drops; `tokenService.ts`'s existing exports beyond `logUsage`; no router/prompt changes (Task 2's territory); the tokens API routes still exist, admin-reachable, just uncalled by any customer surface now.

WHAT_WE_BUILT.md #124, `WHAT_WE_BUILT_DB.md` gained the `token_events.model` column entry, `SOMMELIER_BUILT.md` S72 (full detail).

---

### 125. HOME Task 4 — Memory & the Brew Profile: `<<remember:...>>` markers, brew-profile whitelist, five write rules, Profile mirror (2026-07-31)

**Files:** `backend/src/services/brewProfile.ts` (new), `frontend/src/app/components/profile/BrewProfileMirror.tsx` (new), `backend/src/services/claude.ts`, `backend/src/routes/sommelier.ts`, `backend/src/routes/users.ts`, `backend/src/routes/admin.ts`, `backend/src/services/sommelierConfig.ts`, `backend/src/db/seeds/sommelier_config_seed.ts`, `frontend/src/app/lib/api.ts`, `frontend/src/app/components/Profile.tsx`, `frontend/src/app/components/admin/AdminSommelierFlow.tsx`

**What this builds**: Liam's first piece of durable memory (§4.5) — when a customer states a fact about their brewing setup or habits, he confirms it in-voice and remembers it permanently via a new `<<remember:field=value>>` marker (same "never trust the model" pattern as S51's `<<action:...>>`). Five write rules, made non-negotiable by the `taste_journey` incident (S49 — a silent 3-segment-path bug meant that doc never persisted for a year): in-voice confirmation, a day-one Profile-page mirror (read/edit/delete), an admin-visible write/failure counter (never a silent fire-and-forget), end-to-end production verification before shipping, and a stale-re-confirm nudge capped at once per session.

**Marker + whitelist**: `chatWithSommelier()` (`claude.ts`) parses and strips `<<remember:...>>` the same way it already handled action markers, returning `rememberOps` for the caller to resolve — never trusting the model's field or value directly. A new `resolveRemember()` (`sommelier.ts`) validates against `config/sommelier.brewProfile.fields` (Phase 1: `brew_methods`, `grinder`, `takes_it`, `decaf_constraint`, `aversions` — every field chosen because it changes a sentence Liam can say, per §3.5) and writes to `users/{uid}/metadata/brew_profile` (4 segments). Conversation writes append/dedup array fields across turns and sessions; the Profile-page mirror's edits replace the full value — two different capture modes, one shared validator (`brewProfile.ts`).

**Injection**: through `assembleSystemPrompt()` (S71) via a new `brewProfileContext` param — a one-line summary appended every turn (not just the opening one, since a fact learned mid-conversation needs to inform the rest of that same conversation), only when non-empty. Also carries the stale-re-confirm nudge when relevant (topic-gated, once per session via a new `context_data.staleNudgeSent` flag).

**Mirror**: `GET/PATCH/DELETE /api/users/brew-profile` (`users.ts`) + `BrewProfileMirror.tsx` on the Profile page — shows captured fields only (full self-serve add-a-field UI is Task 10), edit replaces, delete removes the field key via `FieldValue.delete()` (never a null-write).

**Admin visibility**: `admin_stats/brew_profile` (Firestore, 2-segment path) tracks `writes`/`failures`, incremented on every attempt from either writer, surfaced on `GET /api/admin/sommelier/stats` and a new row on `AdminSommelierFlow.tsx`.

**A real bug, caught by this task's own required verification**: the live model emitted the field name as `brew_method` (singular) against the plural whitelist key on its first real API call — dropped and logged correctly (write rule 3 working exactly as designed), then fixed at the prompt level (all five field names now spelled out verbatim) and hardened with a small alias-normalization safety net (`brew_method`→`brew_methods`) as defense-in-depth. Re-tested live afterward — the model then emitted the correct field name.

**Config pushed live via the config-drift/config-apply mechanism, not a one-off script**: 12 new paths under `brewProfile.*`, zero existing values touched, zero drift after.

**Verified** (Firestore-only, no Postgres needed for this task; `axis-and-bloom-prod` is the only environment): `tsc --noEmit` clean. Byte-for-byte re-check of `assembleSystemPrompt()`: no profile → identical to pre-task output; profile present → identical plus exactly one new line. One real `chatWithSommelier()` call against production, confirmed in-voice ("V60 — noted…"), write read back via the Admin SDK directly. Forced invalid marker (unknown field + invalid value) → both dropped, neither written, failure counter incremented by exactly 2. Mirror edit/delete round-trip confirmed via read-back. Stale nudge confirmed correct on all four branches (stale+relevant+fresh-session, already-nudged, wrong-topic, not-yet-stale). All test writes deleted; the real `admin_stats/brew_profile` counters restored to their exact pre-test values.

**Out of scope, unchanged**: no fields beyond the Phase 1 whitelist (Task 10's); no brew cards (Task 6); no beats (Task 8); action-marker behavior, the topic router, and the six-intent evaluator are all untouched.

WHAT_WE_BUILT.md #125, `WHAT_WE_BUILT_DB.md` gained `users/{uid}/metadata/brew_profile` and `admin_stats/brew_profile` in the Firestore path table, `SOMMELIER_BUILT.md` S73 (full detail).

---

### 125. The Bloom Part 12 — restore commerce/reveal/save-to-memory onto Camila's Bloom Dial (2026-08-01)

**Files:** `frontend/src/app/components/bloom/dial/BloomDial.tsx`, `frontend/src/app/components/bloom/DialArchetypeSection.tsx` (new), `frontend/src/app/components/BloomPage.tsx`, `frontend/src/app/components/FlavorQuiz.tsx`, `frontend/src/app/components/Profile.tsx`

**Problem**: Camila's Bloom Dial production build (brief 33, commit `ac424ef`, unauthenticated/untested per her own commit message — "no node runtime in this environment... Needs local/CI build + Safari pass before merge") replaced `/bloom`'s `ArchetypeSection` with a new reusable `BloomDial` component but only wired the dial itself — it dropped the revealed informational layer (tasting notes/dimension bars/flavor wheel/wheelhouse badge/Talk-to-Liam), the 12oz/5lb weight picker + Add to Cart + Compare + "Price includes shipping", "Save to my flavor memory", worth-exploring hop chips, and real slot-availability blocking (placeholder positions were purchasable at hardcoded $32/$185 defaults; "Unpriced"/"Temporarily unavailable" states were gone). Full spec: `backend/src/features/the_bloom_page/CLAUDE_CODE_PROMPT_THE_BLOOM_PART12_RESTORE_FEATURES_ON_DIAL.md`.

**Approved decisions (Dana)**: keep Camila's dial design everywhere the archetype div renders; restore full commerce restyled into the dial's reading column; restore the informational layer as an expandable "Reveal the full profile ↓" opening the existing `RevealedPanel` below the dial; restore save-to-memory with its `explicit_save` Dial Event Log trigger; apply to all four dial surfaces (`/bloom`, Find My Flavor returning-user + results, Profile ×2) via a compact `embedded` variant; placeholder slots (no resolved catalogue position at all) stay browsable ("Coming soon", no cart button) while real unpriced/unavailable slots keep their old blocked states, and purchases always use real slot prices, never the dial's placeholder defaults; photos stay out, consistent with her design.

**`BloomDial.tsx`**: added three optional props without touching the fill engine/drag/keyboard/deep-link `rotateTo` — `bottomContent` (replaces the built-in PRE-ORDER button when provided), `belowStage` (full-width content rendered below `.bd-stage`, inside the section), `embedded` (adds `.bd-embedded`, a smaller dial/ruler/reading-column CSS variant for in-page contexts).

**`DialArchetypeSection.tsx` (new)**: the unified section, prop surface matching the old `ArchetypeSection` so every call site is a one-line swap. Builds a synthetic inactive slot (hooks still run unconditionally) when the selected dial position has no entry in `data.slots` at all — `isPlaceholder` — distinct from a real slot that's merely inactive/unpriced; reuses `usePositionCardData` unchanged for teaser/availability/reveal data. `bottomContent` renders the teaser, a "Coming soon" badge for placeholders / "Unpriced"/"Temporarily unavailable" for real inactive-or-unpriced slots, or full commerce (weight pills, Add to Cart building the `CartItem` from the real resolved slot — never the dial's placeholder name/price — Compare, "Price includes shipping") for effectively-active slots; the reveal link only shows when `currentSlot.coffeeId != null && currentSlot.isActive`; save-to-memory shows for any signed-in user on a real (non-placeholder) slot. `belowStage` is the existing `RevealedPanel`, unchanged content, horizontally padded on `/bloom` and edge-to-edge when `embedded`.

**`BloomPage.tsx`**: swapped the raw per-archetype `BloomDial` map for `DialArchetypeSection`; restored `revealedKeys`/`toggleReveal`, `compareState`/`openCompare`, and `CompareOverlay`; deleted Camila's `handlePreOrder` and the now-unused `buildDialConfig`/`DialCoffee`/`CartItem` imports (commerce now lives inside `DialArchetypeSection`). **Deviation from the literal spec, flagged**: restored `handleHopClick` per the spec's own instruction to also call `setSelectedSortOrder` — the new dial's `rotateTo()` only repaints, it doesn't emit `onZoneChange` the way the old `BloomDialWidget` did, so without this the reading column wouldn't switch to a hopped-to slot even though the dial visually rotated there.

**`FlavorQuiz.tsx` / `Profile.tsx`**: the four embedded call sites (`find_my_flavor_returning`, `find_my_flavor_results`, `profile` ×2) swapped to `DialArchetypeSection` with `embedded` added, all other props unchanged, per spec. **Same hop-click gap found and fixed at all four sites, not just BloomPage's**: `handleMatchedHopClick`/`handleResultsHopClick` (`FlavorQuiz.tsx`) and `handleHopClick`/`handleAdjacentHopClick` (`Profile.tsx`) all had the identical old-widget-only assumption baked in (`rotateTo()` used to implicitly emit `onZoneChange`); each now also calls its own `set*SortOrder`. The spec only named BloomPage's instance explicitly, but the same new-dial behavior applies everywhere `rotateTo` is called from a hop chip, so this was extended to all four rather than left as a known-broken corner.

**Verified**: `npm run build` (vite) clean. Manual pass via a disposable Playwright/Chromium install (scratchpad-only, not added to `package.json`) against the local dev servers running through the Cloud SQL Auth Proxy against real production data — confirmed on `/bloom`: dial keyboard rotation repainting the reading column, the deep link `/bloom?archetype=fruity&slot=2` rotating + resolving the right coffee, a real inactive slot (Floral "Complex") correctly showing "Temporarily unavailable" with no cart button while its dial name still shows Camila's approved placeholder, a real active slot's full commerce (teaser/weight pills/Add to Cart/Compare/"Price includes shipping"/reveal/save-to-memory) all present and functioning, `RevealedPanel`'s "Talk to Liam" link present after reveal, `CompareOverlay` opening, and a clean mobile (390px) layout. Confirmed on the Find My Flavor results screen, Profile's primary archetype section, Profile's "Worth exploring" adjacent-archetype expansion (chip click correctly mounts a second, independent `DialArchetypeSection` instance with its own dial/reveal state), and Find My Flavor's returning-user screen (via throwaway signed-up test accounts that completed the quiz) that the `embedded` variant renders correctly with real coffee/price/teaser data at a visibly smaller dial size on every one of the four surfaces. One dev-environment-only wrinkle found and ruled out during this pass: `FlavorQuiz.tsx`'s returning-user screen occasionally showed 0 dial sections right after a client-side (React Router) navigation into it — traced to the `GET /api/coffees/archetypes` request itself hanging (never resolving, not erroring) specifically on that navigation path in this Vite-dev/React-StrictMode harness under rapid repeated scripted navigation; a plain reload always resolved it immediately with the correct data. Not reproducible via a normal one-at-a-time page load, and the fetch effect itself is untouched by this diff — a pre-existing dev-server/StrictMode quirk under heavy automated traffic, not a Part 12 regression. Not run: the Safari pass the spec calls out (brief 33's own guards were never Safari-tested either).

**Left in place, not deleted, per spec**: `ArchetypeSection.tsx`/`PositionCard.tsx` — no longer mounted anywhere except `Shop.tsx` (deliberately untouched, being retired).

**Test data cleanup**: 21 throwaway Firebase accounts created across two verification passes (`bloom-part12-test-*@example.com`, `bloom-part12-verify-*@example.com`) were deleted directly (Firebase Auth, Firestore `users/{uid}` recursive delete, `user_profile` row) rather than left for the stale-anonymous-guest purge cron (#120) — these were real, non-anonymous accounts, which that cron doesn't target. Confirmed zero remaining afterward.

WHAT_WE_BUILT.md #125, no schema change (WHAT_WE_BUILT_DB.md untouched), SOMMELIER_BUILT.md not touched (no Liam/RAG/session-logic files in this diff — this is pure Bloom Dial frontend restoration; `RevealedPanel`'s existing "Talk to Liam" link is reused unchanged, not modified).

---

### 126. HOME Task 5 — The Story Layer: per-coffee story content, specificity line enforced twice, public story page (2026-07-31)

**Files:** `backend/src/services/storyLayer.ts` (new), `frontend/src/app/components/CoffeeStoryPage.tsx` (new), `backend/src/routes/coffees.ts`, `backend/src/routes/admin.ts`, `backend/src/routes/sommelier.ts`, `backend/src/services/claude.ts`, `backend/src/services/sommelierConfig.ts`, `backend/src/db/seeds/sommelier_config_seed.ts`, `backend/src/db/schema.sql`, `frontend/src/app/components/admin/AdminCoffees.tsx`, `frontend/src/app/App.tsx`

**What this builds**: "their coffee, explained" — curated per-coffee story content (120–200 words, region/process/cupping-tied, editorial voice) that Liam speaks from on `my_coffee`/`origins_process` topic turns, instead of ever touching raw `coffees.origin`/`process` columns directly. The specificity line (region and process yes; farm/co-op/lot/estate/importer/roaster no) is enforced twice: in the generation prompt, and again post-generation via `checkStorySpecificityViolations()` (raw coffee name, every linked roaster name, and a configurable banned-term list), with up to 2 retries feeding back exactly what was caught.

**Storage**: `coffees` gained `story`/`story_draft`/`story_published`/`story_admin_edited`/`story_generated_at`. "Generate, scan, then mark live" — `story` (the only field anything reads) and `story_published` only advance when a generation attempt actually passes the specificity check; a repeatedly-failing coffee leaves its latest attempt in `story_draft` for admin review, never exposed. `story_admin_edited` rows are skipped by future bulk regenerates.

**The S44 lesson, copied not reinvented**: `fetchCoffeeDataForContent()`'s alias resolution was quietly still using the pre-S44 pattern (`coffee_alias.platform_name` only) — fixed by extracting a shared `resolveDisplayName()` matching `sommelierRag.ts`'s `getAliases()` join, used by both content generation and the new public story endpoint.

**Injection**: through `assembleSystemPrompt()` (S71) via a new optional `storyContext` param, injected in the same branch that already omits the catalog in expertise mode — the caller (`sommelier.ts`) decides relevance (topic-gated), keeping the assembly function itself pure and topic-agnostic. The relevant coffee is whichever of the session's RAG-selected coffees (cached at session start, same no-re-query principle as `catalogText`) has a published story — no "current coffee" concept invented here (that's Task 6's).

**Admin**: a story view/edit modal on `AdminCoffees.tsx` + `PATCH /api/admin/coffees/:id/story`, running the same specificity check with a logged `force: true` override for a confident human call.

**Public story page**: `GET /api/coffees/:id/story` (public, roaster-blind) + `/coffee/:id/story`, a small dedicated page (not an extension of `BloomPage.tsx` — that component carries cart/compare/personalization state this public surface doesn't need) reusing the site's archetype-color and editorial-typography conventions. Also — route shape only — Task 7's future non-owner/retired-coffee scan destination.

**Backfill — two real findings, fixed before calling it done**: (1) every generated story included an unwanted Markdown title header, and one invented a new name instead of using the given display name — neither a specificity leak, but both a rendering/consistency problem; fixed at the prompt level plus a defensive strip, and all 25 coffees' story field was regenerated against the corrected prompt. (2) For coffees whose *raw internal catalog name* literally is the origin country (Ethiopia, Honduras, Guatemala, Sumatra, Uganda, Papua New Guinea, Costa Rica, Kenya — an existing naming convention) or a legitimate category term (Decaf), the raw-name check correctly-per-its-own-rule flagged genuinely-compliant region-level content as a match. All but 2 reworded around it within retries; the remaining 2 (Decaf, Sumatra) were read in full, confirmed clean, and published via the documented admin override. **Final state: 25/25 active-rotation coffees have a published story.**

**Config pushed live via the config-drift/config-apply mechanism, not a one-off script**: 1 new path (`storyLayer.bannedTerms`), 0 drift after.

**Verified** (no dev Firestore/Postgres — content generation and backfill ran directly against `axis-and-bloom-prod`): `tsc --noEmit` clean. The S38 spot-check repeated: programmatically scanned all 25 published stories — 23 clean outright, 2 flagged exactly matching the documented overrides (the scan working correctly, not a gap). Manually read well over 5 in full across two backfill passes. Reject-and-retry demonstrated both organically (9+ real rejections during backfill, each logged with the exact violation) and via one hand-crafted deliberately-violating string caught correctly by `checkStorySpecificityViolations()` in isolation. Regenerate-after-edit: an admin-edited story survived `generateAndStoreAllContent(id, {force:true})` byte-for-byte. Injection verified both structurally (`assembleSystemPrompt()` with/without a story, expertise vs. matching mode) and in one real `chatWithSommelier()` conversation turn on a `my_coffee` topic, where Liam's reply drew accurately from the injected story alone.

**Out of scope, unchanged**: `claude.ts`'s three existing content functions (and the file itself, beyond new optional params already covered); no `sommelierRag.ts` query changes; no QR/redirect work (Task 7's own).

WHAT_WE_BUILT.md #126, `WHAT_WE_BUILT_DB.md` gained the `coffees.story*` column group, `SOMMELIER_BUILT.md` S74 (full detail).

---

### 127. Profile Part 7 — Flavor Memory as an activity log: quiz/ordered/saved/recipe, save removal, Liam recipe saves (2026-08-02)

**Files:** `backend/src/routes/users.ts`, `backend/src/services/claude.ts`, `backend/src/routes/sommelier.ts`, `frontend/src/app/lib/api.ts`, `frontend/src/app/lib/deriveReadingLine.ts` (new), `frontend/src/app/components/profile/ActivityTimeline.tsx` (new, replaces `PalateTimeline.tsx`, deleted), `frontend/src/app/components/Profile.tsx`, `frontend/src/app/components/bloom/DialArchetypeSection.tsx`, `frontend/src/app/components/Sommelier.tsx`

**Dana's decision, stated once, enforced everywhere:** the Flavor Memory tab's side column becomes an activity log of **explicit, 100%-confidence moments only** — quiz completed, order completed, save-to-flavor-memory, Liam recipe saves. Dial rotations, add-to-cart, reveals, and anything inferred are permanently excluded, not just today's default.

**Task 1 — enrich `explicit_save` events at write time.** `PATCH /api/users/dial-position` now stores `coffeeId` (unified across both `explicit_save`/`add_to_cart` triggers, previously `add_to_cart`-only) and a new `platformName` field (a display-name snapshot at save time — roaster-blind, never resolved at read time since slot→coffee mappings drift). `DialArchetypeSection.tsx`'s `handleExplicitSave` sends both from `currentSlot`.

**Task 2 — save removal (tombstone).** Two new routes, `PATCH /api/users/flavor-memory/saved/:docId/remove` and `.../recipes/:docId/remove`. Both set `removedAt` via `FieldValue.serverTimestamp()`, never a hard delete — the Dial Event Log keeps full history for Liam/analytics regardless of what the user removes from their own journal view. Ownership is implicit in the doc path (`users/{uid}/...`); the saved-entry route additionally rejects removing anything whose `trigger !== 'explicit_save'` (i.e. an `add_to_cart` event can't be tombstoned through this path).

**Task 3 — unified `activity` array, additive to `GET /flavor-memory`.** Merges `taste_journey` (→ `quiz`, reusing the existing journey read/backfill, `trigger` carried through for Task 4's copy split), the existing orders query extended with an `archetype_assignments` join (→ `ordered`, archetype kept out of the pre-existing `journal` field so nothing already consuming it changes shape), `dial_events` filtered to `trigger == 'explicit_save'` with tombstones filtered in code (→ `saved`), and `liam_saves` (→ `recipe`, Task 5). Sorted newest-first server-side. `add_to_cart` events are read for nothing here. Legacy pre-Task-1 saves (no `coffeeId`/`platformName`) render honestly as position-only.

**Task 4 — `ActivityTimeline.tsx` replaces `PalateTimeline.tsx`.** Same side-column slot, quiet register, collapsed-to-3-with-"Show full history" toggle, and "Retake the quiz" link. Badge copy Quiz/Ordered/Saved/Recipe; the old first-quiz/retake distinction folds into the quiz substance line's wording instead of a separate tag. Removable entries (`saved`/`recipe`) get a "Remove" affordance — visible on hover on desktop (`md:opacity-0 md:group-hover:opacity-100`), always visible on mobile. Recipe entries expand inline to their stored body on click. `DialArchetypeSection.tsx`'s "Saved ✓" gained a companion "View in your flavor memory →" link to `/profile?tab=memory`.

**Task 5 — Liam recipe saves, Action Links mechanism extended.** New marker `<<action:save_recipe>>`, landed in `LIAM_BASE_PROMPT` (base, not a per-intent addendum — same precedent as `retake_quiz`/`open_dial`, since a brew guide can come up on any intent) — appended only when the reply just written *is* a recipe/brew guide the customer asked for, never preemptively. Unlike the two existing actions, `save_recipe` carries no server-resolved payload: it's user-initiated (Liam only marks the offer appropriate; the write happens because the signed-in user taps the chip), so `resolveActions()` just echoes `{ type: 'save_recipe' }`. New Firestore subcollection `users/{uid}/liam_saves`, written by a new `POST /api/users/flavor-memory/liam-saves` (length-validated `title`/`body`, `title` derived client-side in `Sommelier.tsx` from the message's own first line — "dumb and predictable" per spec, not model-generated). Guardrail reconciliation: Action Links' "no writes from chat" rule was about identity/dial state and still stands — this is a user-initiated *content* save through a validated endpoint, the LLM never supplies an id.

**Task 6 — the derived reading line.** Pure, rule-based, client-side (`deriveReadingLine.ts`, no LLM, no new endpoint): compares the latest quiz archetype against the archetypes of the most recent 3 `saved`/`ordered` entries (`ordered` archetype resolved via Task 3's new join). Same archetype, or fewer than 2 recent signal entries ("too little data") → renders nothing. Diverging → one italic sentence above the activity log.

**Verified** against real production Cloud SQL/Firestore through the Auth Proxy (see [[axis_and_bloom_local_cloudsql_testing]]) and a real browser session, not assumed from code reading: `tsc --noEmit` (backend) and `vite build` (frontend) both clean. Scripted API pass on a throwaway signed-up account confirmed the full Task 1/2/3/5 loop end-to-end (`explicit_save` writes `coffeeId`/`platformName`; a same-slot `add_to_cart` immediately after does **not** create a second/duplicate activity entry — editorial rule holds; `liam-saves` POST → `recipe` entry with correct body; both removal routes tombstone and the entries disappear from a subsequent `GET`; an unknown docId 404s). `deriveReadingLine()`'s 6 branch cases (no quiz, too little data, aligned, diverging, recipe/quiz entries excluded from "signal", archetype-less legacy saves excluded) verified via a disposable script — flagging honestly: this repo has no frontend test runner yet, so there's no persisted unit test file for it, only this verification pass. Real browser click-through (throwaway signed-up account, real quiz completion → Balanced & Sweet): Bloom Dial "Save to my flavor memory" → "Saved ✓" + "View in your flavor memory →" → Profile's Flavor Activity log showing the correctly-formatted `Saved`/`Quiz` entries newest-first; the Remove button (confirmed present but opacity-gated behind desktop hover, as designed) tombstoned the saved entry live, vanishing from the log without a page reload. Separately, a real Liam conversation (asked for a V60 recipe) produced the `<<action:save_recipe>>` marker correctly — chip rendered, tap flipped it to "Saved ✓" + "View in your flavor memory →", and the recipe appeared in the same activity log as an expandable `Recipe` entry with the full brew steps. All throwaway accounts and their Cloud SQL/Firestore data cleaned up after (2 accounts — a form-submission retry accidentally created an extra one, also cleaned up).

**Out of scope, unchanged:** Liam's routing/token/turn logic, model selection, and every existing intent; `user_bloom_dial_current_position` (dial preload state — untouched by save-removal, confirmed by code path, not exercised live this pass); no hard deletes anywhere in this brief.

WHAT_WE_BUILT.md #127 (no schema change — `liam_saves`/`dial_events.platformName`/`coffeeId` are schemaless Firestore fields), SOMMELIER_BUILT.md gains the `save_recipe` action link entry.

---

### 128. Profile Part 7B — meaningful Liam recipe titles (2026-08-02)

**Files:** `backend/src/services/claude.ts`, `backend/src/routes/sommelier.ts`, `frontend/src/app/components/Sommelier.tsx`

**Why**: #127's `save_recipe` title was `deriveRecipeTitle` — the first non-empty line of Liam's reply, truncated. Liam's replies typically open conversationally ("Here's a recipe for..."), so a user who saves several recipes got a journal full of near-identical, meaningless titles. The only party who actually knows what the recipe *is* is Liam — so he now supplies the title himself, in the marker.

**Task 1 — titled marker.** `<<action:save_recipe>>` becomes `<<action:save_recipe:short title>>` — 2-6 plain words naming the method and, when known, the coffee (e.g. "V60 for Cerro Azul", "Cold brew, overnight jar"). `claude.ts` parses both the bare legacy form and the titled one via one regex (`/<<action:save_recipe(?::([^>]*))?>>/`); a captured title is run through a new `sanitizeRecipeTitle()` — strips `<`/`>` and markdown emphasis chars, collapses whitespace, caps at 60 — never trusted verbatim, same "never trust the LLM for ids" discipline as the rest of Action Links (this is display text, never an id). Empty-after-sanitize is treated as no title, not an error — falls through to the bare-marker path. `chatWithSommelier()`'s return type gained `saveRecipeTitle?: string`, threaded through both `resolveActions()` call sites (opening turn and main turn) in `sommelier.ts`; `SommelierAction`'s `save_recipe` variant gained an optional `title`.

**Task 2 — chip uses the supplied title.** `Sommelier.tsx`'s `handleSaveRecipe()` takes an optional title override, used when the action carries one; `deriveRecipeTitle(content)` (first-line fallback) now only fires for a bare legacy marker. No endpoint change — `POST /api/users/flavor-memory/liam-saves` already just stores whatever title it's given. No `ActivityTimeline.tsx` change — it already renders whatever title was stored.

**Marker instruction location, checked as asked**: confirmed still living entirely in `LIAM_BASE_PROMPT` (code), not mirrored into any Firestore-seeded intent addendum (`sommelier_config_seed.ts` has zero `save_recipe` references) — no admin-portal edit needed.

**Verified** with a real conversation, not a synthetic marker: asked Liam for a V60 recipe for a named coffee, then a separate cold-brew recipe — got back exactly `"V60 for Cerro Azul"` and `"Cold brew overnight jar"` (the first literally matches the spec's own example verbatim), both chips saved correctly, both entries distinguishable in the activity log with the model-supplied titles intact. Also unit-verified via a disposable script: bare marker (no title) still resolves the action with no title (frontend fallback applies); markdown/angle-bracket/extra-whitespace sanitization; long-title capping at exactly 60 chars; an all-markdown title (`***`) sanitizes to empty and correctly falls back to no-title rather than erroring; `tsc --noEmit`/`vite build` both clean. Throwaway account and its Firestore data cleaned up after.

**Out of scope, unchanged**: `retake_quiz`/`open_dial`'s own resolution logic; no new intents/routing/token changes; old pre-Part-7B saved recipes keep their old first-line titles (no migration — not worth one, per spec).

WHAT_WE_BUILT.md #128, SOMMELIER_BUILT.md S75 updated in place (same entry, titled-marker addendum — not a new S-number, since it's a direct extension of the same feature).

---

### 129. HOME Task 5b — FIX: story selection by named coffee + memory-confirm integrity (2026-08-02)

**Files:** `backend/src/routes/sommelier.ts`, `backend/src/services/claude.ts`, `backend/src/services/sommelierRag.ts`, `backend/src/services/sommelierConfig.ts`, `backend/src/db/seeds/sommelier_config_seed.ts`

**Why**: two real defects found in live production verification, both narrow, both fixed here. (1) Liam denied knowing about a coffee (Kenya) that was actually in his own session's candidates — the story-selection logic picked "whichever candidate has a published story," not the one the customer actually named. (2) A customer stated two facts ("french press... milk") in one message; Liam confirmed both in voice but the one-marker-per-turn cap only let one actually save.

**Fix 1 — name-matching selection.** `context_data.storyCandidates` now carries `{ coffeeId, alias, story }` for every RAG-selected coffee (not just published-story ones — `story: null` for the rest, a legitimate match target with nothing to inject). Alias resolved via `sommelierRag.ts`'s `getAliases()` (now exported), the same S44-correct join already used for Liam's catalog text — not reinvented. New `resolveStoryForMessage(message, candidates)` (`sommelier.ts`, exported): case-insensitive whole-word alias match, longest alias wins on ties. Selection: named match with a story → inject it; named match without one → no story at all (never substitutes a different coffee's content); no match → prior fallback behavior. Every `my_coffee`/`origins_process` turn logs the selected coffeeId, so selection is provably deliberate. `LIAM_BASE_PROMPT`'s Origins guardrail gained a never-say rule against absence-denial phrasing ("not in the catalog," "isn't in my system"), with the exact live bad output as the Bad example.

**A real, separate finding, flagged not fixed**: no alias in the catalog contains the word "Kenya" (the real coffee's alias is "Jammy & Aromatic"; its story deliberately says "Nyeri County" instead, per the specificity check). The customer could only type "the kenya" because `sommelier.ts`'s `coffeeNames` field (feeding the frontend coffee-strip line, in both `/start` and `/messages`) selects the raw `coffees.name` directly, never resolved through the S44 alias join — a genuine, pre-existing naming-discipline violation. Out of scope for this fix task ("No frontend changes," two specific defects only) — flagged for a follow-up, same treatment as the E5 email TODO in #124.

**Fix 2 — marker cap raised to 2.** New `brewProfile.maxMarkersPerTurn` config (seed default 2). `chatWithSommelier()`'s marker-collection loop caps how many parsed markers get collected into `rememberOps` (still strips all regardless of count, so an over-cap model reply never leaks a stray token). `resolveRemember()` needed no change — it already validated/wrote each op independently with its own failure-counter increment. Prompt raised to "up to two markers, one per distinct fact," with the exact live example as a Good pair, plus (added mid-verification) two more Good/Bad pairs for a "confirms three, marks two" failure mode and a malformed comma-joined marker value.

**Verified** against production (Cloud SQL Auth Proxy + Admin SDK, marked test data, cleanup after): `tsc --noEmit` clean. Kenya repro: a real 3-candidate session (including coffeeId 31/Kenya) named by its real alias correctly resolved and injected Kenya's story, coffeeId logged, ruling out fallback coincidence; the literal "kenya" wording was also run for transparency — no alias match (expected, per the finding above), correct fallback, and the new guardrail phrasing held (no absence-denial language). `resolveStoryForMessage` unit checks (exact/case/longest-tie/no-match/match-without-story) all passed. Two-fact round-trip: the exact live sentence → both fields parsed, written, and read back via Admin SDK. Mixed-validity marker test: one valid + one invalid → valid written, invalid dropped and counted, no exception. Mechanical (not visual) line-diff of `LIAM_BASE_PROMPT` old vs new confirmed only the two deliberate edits changed. Three-fact message: the 2-marker cap held reliably across three attempts and three rounds of prompt tightening, but the "don't verbally note the unmarked third fact" instruction was not reliably followed — recorded honestly as a demonstrated, unresolved voice-discipline limit (no data-integrity issue; only the confirmation language over-includes).

**Out of scope, unchanged**: no Task 6 work, no new whitelist fields, no topic router/intent/guard changes, no story-generation/scan pipeline changes, no frontend changes.

WHAT_WE_BUILT.md #129, `WHAT_WE_BUILT_DB.md` gained the `context_data.storyCandidates` shape update (`alias` field added), `SOMMELIER_BUILT.md` S76 (full detail, both live defects recorded verbatim).

---

### 130. HOME Task 5c — FIX: coffee-strip raw-name leak, the last known customer-facing `coffees.name` read (2026-08-02)

**Files:** `backend/src/routes/sommelier.ts`

**Why**: flagged verbatim in #129/S76 while fixing HOME Task 5b — the coffee-strip line above the first Liam message (`coffeeNames`, built in both `POST /start` and `GET /:sessionId/messages`) selected the coffee's raw internal name (e.g. "Kenya") instead of its customer-safe alias, the same violation class S38 and S44 already fixed elsewhere. It also explains why S76's Defect 1 happened at all: the UI was teaching customers a name Liam is forbidden to know, so the customer could never type back an alias for the new name-matching path to catch.

**Fix**: new `resolveCoffeeDisplayNames(coffeeIds)` helper resolves through `sommelierRag.ts`'s exported `getAliases()` (the S44-correct `dial_slot_alias` join, not reinvented), falling back to the coffee's archetype label — never the raw name — for any coffee with no alias, matching `buildCatalogText()`'s own fallback rule. Both `coffeeNames` build sites now call it; no third site exists. Historical sessions need no migration — names resolve at read time.

**The S44 grep audit** (full table in `SOMMELIER_BUILT.md` S77): every `coffees.name`/`c.name` read across `backend/src`, verdicted. Two genuine, pre-existing, out-of-scope findings surfaced and flagged, not fixed: `GET /api/coffees` (bare list) is fully public with no auth and returns raw `c.name`/`c.roaster` directly, though unreferenced by the current frontend; `GET /api/coffees/other-categories` is alias-preferred but falls back to the raw name (not the archetype label) if a category coffee ever lacks an active alias row — currently benign, all 6 category coffees have one. Everything else audited was already alias-correct at its boundary or legitimately admin-only (`router.use(requireAdmin)`).

**Verified** against production (Cloud SQL Auth Proxy + a live backend instance, real browser, marked test data, full cleanup): `tsc --noEmit` clean. Proved historical-session healing against a real pre-fix session (id 16, started 2026-07-31, containing coffee 31/Kenya) — minted a Firebase ID token for its own uid via Admin SDK custom-token exchange and called the live `GET /:sessionId/messages` endpoint directly: returns `"Jammy & Aromatic"`, never `"Kenya"`, with no data migration. Real browser signup + fresh Liam session showed an all-alias coffee strip (screenshot taken); the app's own "Resume conversation" flow (which hits the same endpoint) rendered identically on reload. Closed the loop the task called out: sent "tell me about the jammy & aromatic one" into a session and got `[storyLayer] turn selected coffeeId=31 (named match)` in the logs plus an accurate Kenya-story reply — the exact mechanism S76 built but couldn't fully exercise until this fix. Test account and all its Auth/Firestore/Postgres data deleted after.

**Out of scope, unchanged**: no story/selection-logic changes (S76's, already working); no RAG query changes beyond name resolution; no alias data edits; no Task 6 work; the two flagged findings above.

WHAT_WE_BUILT.md #130, no schema change, `SOMMELIER_BUILT.md` S77 (full detail, including the complete grep audit table).

---

### 131. HOME Task 5d — FIX: public API raw-name exposure, closing both #130/S77 findings (2026-08-02)

**Files:** `backend/src/routes/coffees.ts`

**Why**: the direct follow-up to #130/S77's grep audit, which documented two findings as out-of-scope. This task closes both — one by removal, one by formal acceptance.

**Finding A — `GET /api/coffees` (bare list, public, unauthenticated, returned raw `name`+`roaster`) — removed.** Confirmed dead before touching anything: no bare `fetch('/api/coffees')` anywhere in `frontend/src` (public or admin components), no reference in the static `/match/*` share pages (pure static HTML, no JS at all), no reference in `backend/scripts/`, and zero test coverage in `coffees.test.ts` despite the router being mounted there. The route table's own prior claim ("kept for admin tooling") was itself stale — no admin component calls it either. Removed the route entirely rather than rebuilding it alias-only, per the task's stated preference: nothing depends on it, so there's no alias-safe version worth maintaining. This table's own `/api/coffees` row above is corrected to reflect the removal.

**Finding B — `GET /api/coffees/other-categories`'s raw-name fallback — accepted, documented, unchanged.** For the 6 category-tagged coffees (Decaf/Half-Caf/Flavored/Experimental), `platform_name ?? coffee_name` is the deliberate S44 fallback rule: these coffees have no dial slot to inherit an alias from, so their own name (or coffee_alias, where one exists) genuinely *is* their customer identity — "Decaf" is a product name, not a leaked internal codename. Formally recorded as accepted-as-designed so a future audit doesn't re-flag it from scratch.

**The routes-audit table** (full table in `SOMMELIER_BUILT.md` S78) — every unauthenticated route in `routes/coffees.ts` (13, now 12 after the removal) and `routes/axis.ts` (3), each given a raw-name/roaster verdict. Confirmed both files have zero `requireAuth`/`requireAdmin` anywhere, so every route in both is public by construction. Result: one fixed (removal), one accepted (Finding B), everything else already alias-safe or carries no coffee identity at all in its response shape.

**Verified**: `tsc --noEmit` clean. Local backend against production Cloud SQL (Auth Proxy, no separate dev environment): `GET /api/coffees` now `404`s; `GET /api/coffees/archetypes` (its replacement) still `200`s, confirming no collateral damage to the router.

**Out of scope, unchanged**: no admin endpoint changes (raw names there are legitimate, `requireAdmin`-gated); no alias data edits; no Task 6/7/8 work.

WHAT_WE_BUILT.md #131, no schema change, `SOMMELIER_BUILT.md` S78 (full detail, including the complete routes-audit table).

---

### 132. HOME Task 6 — Brew Cards + the Arrival Note, resolves S71's deferred "current coffee" concept (2026-08-02)

**Files:** `backend/src/db/schema.sql`, `backend/src/db/seeds/sommelier_config_seed.ts`, `backend/src/services/sommelierConfig.ts`, `backend/src/services/brewCard.ts` (new), `backend/src/services/storyLayer.ts`, `backend/src/services/claude.ts`, `backend/src/routes/sommelier.ts`, `backend/src/routes/orders.ts`, `backend/src/routes/cron.ts`, `backend/src/routes/users.ts`, `frontend/src/app/components/profile/BrewCards.tsx` (new), `frontend/src/app/components/Profile.tsx`, `frontend/src/app/components/Sommelier.tsx`, `frontend/src/app/lib/api.ts`

**What it is**: "Your Uganda · V60 · 1:16 · medium-coarse · 94°C — adjusted after you found it bitter." A per-customer, per-coffee×method brew card, created by the arrival note or by conversation, read-only on the Profile Flavor Memory tab, updated through conversation via a new server-resolved `<<card:...>>` marker (S51's exact action-marker pattern, one more type). The arrival note is the card's first version — the two loops (§3.1, §3.2) share one artifact, per the strategy doc.

**New `brew_card` table** — `user_id`/`coffee_id`/`method`/`params JSONB` (ratio, grindLabel, tempC, notes — customer language only)/`origin`/`revision`/`last_adjustment_reason`, plus two deliberate additions beyond the task's literal column list: `arrival_email_scheduled_for`/`arrival_email_sent_at`, the note's own delivery-timing state, kept on the card row rather than a new queue table.

**Recipe generator (`brewCard.ts`) — code + config, zero LLM calls for the numbers.** A base recipe per brew method, shifted by three cupping-dimension delta rules (Body/Intensity, Acidity/Brightness, Bitterness/Boldness), phrased through the Task 4 brew profile. Proven deterministic directly (same inputs → byte-identical output).

**Arrival note** hooks the exact same order-placement signal `schedulePostDeliveryMessage` already uses — no new signal invented. Fires on every order (not orders-1-2-only like the SMS ask), but only schedules a *new* email for a genuinely new card — a repeat order of a coffee+method already carded doesn't double-send. Delivered via **Resend, not Mailchimp** — a deliberate, reasoned deviation: Mailchimp here is purely the pre-purchase tag/journey tool with no per-order dynamic-content mechanism (confirmed by reading its own README), a real template-dependency blocker the task's own spec anticipated; Resend already handles this exact shape of transactional email elsewhere in the codebase. Bag-number-aware length: only the first-ever bag of a coffee gets the content-pipeline warm sentence (`storyLayer.ts`'s new `generateBrewNoteSentence()`, same alias/specificity discipline as the full story).

**`<<card:save>>` / `<<card:adjust=KEY>>`** — new `resolveCard()` in `sommelier.ts`, scoped to sessions anchored by a coffee (see below); a marker with nothing to attach to is dropped and logged, never trusted beyond its whitelisted key.

**Resolves S71's deferred "current coffee" concept**: `assembleSystemPrompt()` gained a new `currentCoffeeContext` param — when a session opens with `entry=bag|card&coffee={id}` (this task's own arrival-note/home-surface links today; the contract Task 7's future QR redirect must honor), that coffee's card + published-story opening line ground the whole conversation, every turn, both modes — independent of topic. Absent produces zero prompt difference, re-verified byte-for-byte.

**Home display v1**: read-only "Brew cards" section on Flavor Memory (`BrewCards.tsx`), alias names only.

**Config pushed live** the same way S71/S72/S74 did with no interactive admin session available: one new path, `brewDefaults`, applied via the identical Firestore dot-path-update + audit-write the admin config-apply endpoint performs, confirmed 0 remaining drift.

**Verified** against real production data end-to-end, not mocked: a real conversation opened with `entry=bag&coffee=31` correctly grounded on the coffee's alias ("Jammy & Aromatic," never the raw name "Kenya"); asking for an adjustment ("too bitter, go coarser") produced a clean reply with the marker stripped, the card's grind moved exactly one configured step, revision incremented, and the customer's own words recorded as the reason — confirmed live on both the conversation path and the home-surface read of the same row. Full grep audit of every new render path found one legitimate raw-name read (a specificity-check comparison input, never rendered — same already-audited pattern as the story layer), nothing else. One honest, disclosed limitation: this environment's placeholder `RESEND_API_KEY` means actual email delivery couldn't be proven, only the render/selection/scheduling logic around it (see `SOMMELIER_BUILT.md` S79 for the full disclosure).

**Out of scope, unchanged**: no QR/redirect endpoint (Task 7's own — the `entry=bag` contract is defined here for it to honor); no SMS delivery (Task 8's own); no card-editing UI (Phase 2); the six intents/topic router/guard layer untouched.

**Still needs manual setup**: a Cloud Scheduler job for the new `GET /api/cron/brew-card-arrival-send` endpoint (same `x-cron-secret` pattern as the existing `liam-sms-send` job) — the code is verified correct but nothing calls it in production yet.

WHAT_WE_BUILT.md #132, `WHAT_WE_BUILT_DB.md` gains the `brew_card` table + the `entry=bag|card&coffee={id}` param contract, `SOMMELIER_BUILT.md` S79 (full detail).

---

### 134. HOME Task 7 — The QR Door: per-coffee tokens, `/b/:token` redirect, scan logging, artwork export (2026-08-02/03)

*(Numbered 134, out of file order — a concurrent session's #133 (HOME Task 8) landed while this entry was being written; renumbered here rather than touching their entry.)*

**Files:** `backend/src/db/schema.sql`, `backend/src/services/qrDoor.ts` (new), `backend/src/routes/qr.ts` (new), `backend/src/routes/admin.ts`, `backend/src/index.ts`, `frontend/src/app/components/QrDoor.tsx` (new), `frontend/src/app/components/admin/AdminQrDoor.tsx` (new), `frontend/src/app/components/CoffeeStoryPage.tsx`, `frontend/src/app/components/admin/AdminLayout.tsx`, `frontend/src/app/App.tsx`, `frontend/src/app/lib/api.ts`

**What it is**: "Never print a URL whose meaning is fixed — print a pointer the server re-aims." One opaque token per coffee (`coffees.qr_token`), a public resolve endpoint deciding the destination fresh on every scan, and the admin tooling to mint tokens and export the label-artwork URL list.

**No bare `/b/{token}` Express route is possible** — every backend router in this codebase mounts under `/api/*` (`index.ts`), and the frontend is a separate SPA with no static hosting from this backend. `/b/:token` is a frontend route (`QrDoor.tsx`) that calls a new public `GET /api/qr/:token/resolve` (`optionalAuth`, rate-limited) and renders whichever of five states comes back — mirroring the existing `/coffee/:id/story` + `GET /api/coffees/:id/story` split.

**The five destinations**: unknown token → inline 404-style state; retired coffee (no active `roaster_blend` row — no dedicated column exists, this is an inferred convention) → redirects to the existing story page with `?retired=1&nearestHop=`, which now renders a past-tense banner + "closest relative" CTA (`CoffeeStoryPage.tsx`, extending the stub Task 5 explicitly deferred here); signed out → `/sign-in?redirect=/b/{token}` (hand-built S21 shape, since this route isn't `RequireAuth`-wrapped — retired/non-owner/unknown all need to render without forcing sign-in); signed-in non-owner → the same story page, no query params; signed-in owner → the bag view, rendered inline on `/b/:token` itself (no dedicated single-card page existed before this task — `BrewCards.tsx` is a list section only), reusing Task 6's fetch-or-create card logic and linking to `/sommelier?entry=bag&coffee={id}`.

**Real bug caught during verification, fixed before calling this done**: every visitor gets an anonymous Firebase session automatically (`AuthContext.tsx`'s `signInAnonymously()`), and the frontend's `getHeaders()` sends that anonymous user's real ID token on every request. The resolve endpoint's first version treated any decoded `req.uid` as "signed in," so a guest's first-ever scan — the strategy doc's own "majority case for a first scan" — silently landed on the public story page instead of the sign-in prompt. Fixed by mirroring `RequireAuth.tsx`'s own `isAnonymous` check (`isRealSignIn = !!req.uid && !req.isAnonymous`) in the resolve handler. Caught live, not in review — the first pass through the actual signed-out browser flow produced the wrong destination, traced to a stale anonymous session and then to this real logic gap.

**Ownership resolver, two independently pluggable checks**: `checkPersonalOrderOwnership` is the standard `order_line_item → roaster_blend → coffee_id` path. `checkSponsorshipOwnership` reads `order_line_item.intended_for_user_id` — a column already present in schema before this task but never read or written anywhere in `backend/src` (grepped, confirmed). Not an invented column, per the environment note's explicit constraint: the real B2B/company-gift model (`company_gift`/`company_gift_code`) links a company to a subscription but never to a specific coffee or order line, and today's fulfillment orders already carry `order.user_id` = the receiving employee's own profile — so personal-order ownership already covers the common sponsored case. `intended_for_user_id` is the one real, currently-inert seam for when it wouldn't. TODO logged in code pointing at the B2B workstream. Verified with a real (marked test) row, not a mock: a third-party "placer" account placed an order with `intended_for_user_id` set to a "sponsored" test account that never placed an order itself — the sponsored account correctly resolved to `owner`.

**Scan logging** — `qr_scan_event`, one row per resolve, every path. `auth_state` extends the task spec's literal three values (`owner`/`signed_out`/`non_owner`) with a fourth, `unresolved`, for the two cases (unknown token, retired coffee) where ownership is never evaluated at all — documented as a deliberate extension, not a silent mismatch.

**A real, pre-existing drift found and worked around, not fixed**: `sommelierRag.ts` queries `v_dial_navigation` for `vdn.from_coffee_id`/`to_coffee_id`, but the view's definition checked into `schema.sql` (from `bloom_dial_seed_2026_06_23.sql`) only exposes coffee **names**, not ids — the live view must have been altered directly against prod at some point without the file being updated, the same seed-vs-live drift Task 1 exists to catch, just for a view instead of config. The nearest-hop lookup for a retired coffee queries `dial_coffee_relationships` directly instead — confirmed as the right call by finding the existing `GET /api/admin/dial/navigation` endpoint already does the identical thing, for the identical reason. Flagged for whoever next touches the Bloom Dial views; out of this task's own scope to fix.

**Admin**: `POST /api/admin/qr/mint/:coffeeId` and `/mint-missing` (idempotent — never regenerates an existing token); `GET /api/admin/qr/tokens` for the artwork-export list, alias-resolved with the same archetype-label fallback the customer-facing resolve endpoint uses (an earlier pass used a weaker `Coffee ${id}` placeholder here — caught and fixed for consistency before calling this done). URL-only export, no server-side PNG generation — a deliberate decision to avoid adding a QR-rendering dependency to a production service when the label designer's own tool can generate the code directly from the exported URL (the spec allows either).

**Verified against real production data, not mocked** (Cloud SQL Auth Proxy + a local backend instance pointed at prod, marked test data, full cleanup):
- `tsc --noEmit` clean (backend); `vite build` clean (frontend — no `tsconfig.json` exists in this project, `vite build` is this codebase's actual frontend correctness check).
- **Minted real tokens for all 30 production coffees** via `mintTokensForAllCoffees()` — the actual deliverable, left in place (not test data).
- **All five paths exercised for real**, both via direct API calls and a real browser session (screenshots taken of each): unknown token → `{"status":"unknown"}` 404; retired coffee (a real one found in production data, coffee 14, no active blend) → past-tense story page, correctly no hop CTA since this particular coffee has no outgoing recommended hop; owner → real generated brew card for a real coffee with real cupping data; the full signed-out→sign-in→return loop through the actual `SignIn.tsx` UI, landing back on `/b/:token` showing the bag view; non-owner → redirected to the public story page.
- **`qr_scan_event` rows confirmed for every path** with correct `auth_state`/`destination`/`user_id`, read directly from the table.
- Test users, orders, and scan events were all marked (`CLAUDE_QR_TEST%` promo codes, `claude-qr-test-*@example.com` emails) and fully deleted after verification; confirmed zero remaining. Real minted `qr_token` values on real coffees were deliberately left in place.
- **Not verified in this environment**: an actual physical phone scan of a printed code — no label artwork exists yet (a separate design workstream), and this environment has no printer. The redirect/resolve logic itself is fully verified end-to-end; the one remaining step is genuinely physical and needs to happen once real (even draft) artwork exists.

**Out of scope, unchanged, per the task's explicit list**: no label artwork (design workstream); no changes to story-page or card content, only routing to them; no per-bag serialization — one token per coffee, exactly as specified.

WHAT_WE_BUILT.md #134, `WHAT_WE_BUILT_DB.md` gains `coffees.qr_token` + `qr_scan_event` + the two new enums, `SOMMELIER_BUILT.md` S82 (full detail).

---

### 133. HOME Task 8 — Beats v1 + Twilio: order-placed, arrival note, first-brew dial-in (2026-08-02)

**Files:** `backend/src/services/beatEngine.ts` (new), `backend/src/routes/beats.ts` (new), `backend/src/db/schema.sql`, `backend/src/db/seeds/sommelier_config_seed.ts`, `backend/src/services/sommelierConfig.ts`, `backend/src/services/storyLayer.ts`, `backend/src/services/smsProvider.ts`, `backend/src/services/liamSmsFeedback.ts`, `backend/src/routes/orders.ts`, `backend/src/routes/cron.ts`, `backend/src/index.ts`, `.github/workflows/deploy.yml`, `frontend/src/app/context/CartContext.tsx`

**What it is**: the bag cycle's first three beats, lifecycle-aware and degrading gracefully on silence — order-placed confirmation line, arrival note dispatch (Task 6's card+email, now routed through a real engine instead of an unconditional hook), and first-brew dial-in (a closed lighter/bolder question whose reply adjusts the customer's brew card and writes a dial-position signal). Plus a real, gated Twilio integration ready for the moment A2P approval lands.

**New `beat_event` table** — one row per (user, order, beat type), `UNIQUE(user_id, order_id, beat_type)` is the idempotency guarantee: every dispatch is `ON CONFLICT DO NOTHING`, so re-firing a signal for the same order is always a safe no-op. Also new: `user_phone.sms_beats_opt_in*` (the extended consent, distinct from the legacy feedback-only opt-in) and `sommelier_sms_feedback.message_kind`/`beat_event_id` (lets the inbound webhook route a beat reply without touching its existing parsing function's signature).

**The engine** (`beatEngine.ts`) reads every rule from `config/sommelier.beats` — no hard-coded cases. Bag number and repeat-coffee skip reuse Task 6's own `getBagNumberForCoffee()`. Degrade-on-silence: a trailing-window responded/sent ratio drops `dial_in` (never `arrival_note` — the minimal-set floor) below a configured response rate, with too little history never judged prematurely.

**The order-placed line** is now real, injected synchronously into the checkout response (`orderPlacedLine`), shown in place of the old static "Order placed!" text.

**First-brew dial-in** fires `config`-driven days after order placement (default 3, distinct from both the legacy 10-day ask and Task 6's own 4-day arrival delay) via a new daily cron. Two reply paths converge on one shared handler, `respondToDialInBeat()`: an on-site capability link ("the card's door," reachable from the email's quick-response buttons) and the existing SMS webhook (extended, not duplicated — `parseInboundReply()` now returns its parsed expectation instead of only writing it internally).

**Twilio** (`smsProvider.ts`) is a real, working REST integration (plain `fetch`, no new SDK dependency) — verified against Twilio's live API with placeholder credentials (got a real, structurally-correct `401`, proving the request shape works). Three new secrets created in GCP Secret Manager with clearly-labeled placeholders so `deploy.yml` can safely reference them without breaking the next deploy. Every real send stays behind `config.beats.smsEnabled` (seed `false`) — email is the only live channel this pass.

**The supersede cutover**: `orders.ts` no longer calls the legacy `schedulePostDeliveryMessage()` at all — a structural cutover, not a per-order check, so a customer can never receive both the dial-in beat and the legacy post-delivery ask for the same bag. The legacy scheduling/parsing functions themselves are untouched and still used by historical, already-scheduled rows.

**A real, dormant production bug found and fixed along the way**: `FRONTEND_URL` was never actually set on Cloud Run (confirmed by querying the live service directly) — every email link built from it, including Task 6's own arrival-note link, has pointed at `localhost` in production since it shipped. Fixed via `deploy.yml`'s new `--set-env-vars`.

**Verified** against real production data, not mocked: idempotency proven by calling both dispatch functions twice and confirming no duplicate rows/cards; repeat-coffee skip confirmed with a real second order (`skip_reason` recorded); degrade-on-silence confirmed in isolation (arrival note still fired, dial-in didn't); the full reply round-trip confirmed live (card grind adjusted, revision bumped, signal written, reply marked responded, and a second reply attempt correctly no-op'd); supersede audit confirmed zero legacy SMS rows created alongside real beat dispatch; Twilio's real API call and graceful failure handling both confirmed live.

**Out of scope, unchanged**: no empty-bag reorder beat (Task 12's own); no palate prompts (Task 11's own); A2P carrier registration and the extended consent copy are Dana's calendar items.

**Still needs manual setup**: a Cloud Scheduler job for `GET /api/cron/beat-dial-in-send` (same pattern as the still-open `brew-card-arrival-send` job from #132).

WHAT_WE_BUILT.md #133, `WHAT_WE_BUILT_DB.md` gains the `beat_event` table + the `sms_beats_opt_in`/`message_kind` fields, `SOMMELIER_BUILT.md` S81 (full detail).

---

### 135. HOME Task 8b — Post-merge fix pass: S-number cleanup, env-var audit, retired-coffee story backfill (2026-08-03)

**What it is**: Tasks 7 and 8 ran concurrently in one working tree — the incident that prompted `HOME_TASK_INDEX.md`'s new house convention #9. This pass ties off three loose ends before Task 9: the build-log S-number collision (turned out already resolved — S81/Task 8 and S82/Task 7 landed correctly, only one stale cross-reference needed fixing), a full audit of every `process.env.` var the backend reads against `deploy.yml`/live Cloud Run (zero more `FRONTEND_URL`-class bugs found), and real published stories for the 4 retired coffees with a minted QR token that didn't have one — closing the "story isn't ready yet" placeholder Task 7's own verification caught live.

**The env-var audit**: 19 distinct variables, verdicted set-and-live / secret-and-live / intentionally-absent (with the fallback reasoning recorded) — full table in `SOMMELIER_BUILT.md` S83. `FRONTEND_URL`/`BACKEND_URL` reconfirmed live and correct on Cloud Run; a re-rendered arrival-note email now carries the production domain.

**The retired-coffee backfill**: 3 of 4 (Vanilla/Hazelnut/Chocolate — Flavored-category add-ons) hit the exact same raw-name false-positive the specificity check already has documented precedent for (S74's Decaf/Sumatra) — read all three drafts in full, confirmed zero roaster/farm/lot/estate/importer leaks, published via the same reviewed-override mechanism the admin story-edit endpoint uses. The 4th (Guatemala) is genuinely data-starved (no archetype, no cupping data) — skipped gracefully, no story, per the existing guard. The frontend's hop-CTA rendering needed no code change at all — it was already correct; this was purely a missing-content gap.

**Full detail**: `SOMMELIER_BUILT.md` S83.

---

### 136. HOME Task 7b — SQL view drift audit: zero drift found, real bug traced to a consumer query (2026-08-03)

**What it is**: Task 7 (S82) flagged a suspected `schema.sql`-vs-live drift on `v_dial_navigation` — `sommelierRag.ts` selects id columns the checked-in view definition doesn't have. This task set out to reconcile the file to match live. **The premise was wrong**: captured `pg_get_viewdef()` for all 14 views in `schema.sql` against real production and diffed every one — zero drift, across the board. `v_dial_navigation`'s live definition is byte-for-byte identical to what's checked in, in both places, neither ever had id columns.

**The real bug**: `sommelierRag.ts`'s two dial-navigation queries (`RECOMMENDATION_MISS`'s dial-alternative lookup, `DISCOVERY_SEEKER`'s bridge-hop supplementation) fail with a real `42703: column vdn.to_coffee_id does not exist` against production — proven by running them directly, not theorized. Both are wrapped in their own try/catch, so this has silently degraded to archetype-only RAG on every call since S43 first populated real hop data (2026-07-14) — never a visible error, never fixed, because nothing ever surfaced it. Flagged, not fixed, per this task's own scope boundary (no changes to `sommelierRag.ts`); the actual fix (select names and join back, or bypass the view the way `qrDoor.ts`'s `getNearestHopCoffeeId()` already does) is queued as its own follow-up.

**Verified**: all 14 views' `DROP`/`CREATE` statements applied against real prod inside a rolled-back transaction — a fresh build from `schema.sql` produces exactly what's live today, zero errors. A prevention note was added to `schema.sql`'s views-section header.

**Full detail**: `SOMMELIER_BUILT.md` S84.

---

### 137. HOME Task 7d — FIX: Liam's dial-navigation RAG queries actually work now, for the first time (2026-08-03)

**What it is**: closes the S82 → S84 → here chain. Rewrote `sommelierRag.ts`'s two `v_dial_navigation` queries to read `dial_coffee_relationships` directly by id — the same pattern `qrDoor.ts`'s `getNearestHopCoffeeId()` already uses — since S84 proved the view has never had id columns anywhere. `RECOMMENDATION_MISS`'s directional dial-alternative lookup and `DISCOVERY_SEEKER`'s bridge-hop supplementation now genuinely run in production, for the first time since the hop graph got real data back in S43. Catch-block logging upgraded from an unread `console.warn` to a distinct, unmissable `console.error` tag with the real error attached.

**Two more instances of a related bug, found live and fixed with explicit go-ahead**: proving the fix end-to-end (the verification this task cared about most) meant actually running the real `discovery`-focus code path — which threw *before* ever reaching the fixed query, on a separate, pre-existing `SELECT DISTINCT ON (c.id)` / `ORDER BY` mismatch in the RAG focus's very first query. That meant the entire `discovery` focus (not just its dial supplement) has always returned zero coffees. A grep for the same pattern found an identical second instance in `exact_match` (the `CONVERSION` intent's RAG focus) — also always empty. Both fixed with a minimal `ORDER BY` reorder, confirmed live before touching anything.

**Verified**: both rewritten queries return real rows directly against prod. Real before/after coffee-id diffs through the actual `fetchSommelierCoffees()`: RECOMMENDATION_MISS-shaped gained coffee `1` it never had before; DISCOVERY_SEEKER-shaped gained `12` and `11`; CONVERSION-shaped went from always-`[]` to `[1, 3, 7, 14, 17]`. Forced a live failure and confirmed the new log tag fires and the archetype-only fallback still degrades gracefully, byte-identical to the pre-fix behavior. `tsc --noEmit` clean.

**Full detail**: `SOMMELIER_BUILT.md` S85. No schema change — no `WHAT_WE_BUILT_DB.md` entry.

---

### 138. HOME Task 7c — The Universal Printed QR: bag-specificity moves from ink to order history (2026-08-03)

**What it is**: strategy decision, 2026-08-03 — the printed QR stops being per-coffee. One identical code goes on every bag from every roastery; scanning it resolves to the customer's own most-recent-order history instead of a fixed coffee. Per-coffee tokens (Task 7) don't go away — they stay exactly as built for digital links (story pages, emails) — this adds a second, additive token type resolved through the *same* `/b/{token}` endpoint, never a fork.

**New `qr_universal_token` table** — one row per roastery (`path`, `temecula`), same immutability rule as per-coffee tokens (never regenerate a printed one). `qr_auth_state_enum` gains `no_orders`, `qr_destination_enum` gains `bag_picker`/`brand_landing`, `qr_scan_event` gains `token_type`/`source` (additive, backfills existing rows to `'coffee'`/`null` correctly).

**The resolve logic**: signed-in customer, one active bag (order within the config window, default 45 days) → straight to that bag's view. Two or more active bags → a minimal picker, every candidate's full card returned in one response so a tap is client-side, no second round trip. Signed in, zero orders → the homepage (brand landing, already carries the quiz CTA). Signed out → the exact same sign-in-preserving-redirect Task 7 already built, reused verbatim. B2B sponsorship counts as an order via the same resolver Task 7 built.

**Admin page**: "Printed codes" now leads, visually unmistakable (red-bordered, copy buttons, both roasteries) — the only thing meant to ever reach a printer. The original per-coffee list demotes to a muted "Digital links (not for print)" section below, with explicit reorienting copy.

**Verified**: real universal tokens minted for both roasteries (the actual deliverable). Every resolve path walked live in a real browser with three marked test accounts — one active bag, two active bags (picker, with a working tap-to-select), zero orders (homepage), and the full signed-out → sign-in → destination round trip. `qr_scan_event` rows confirmed correct `token_type`/`source`/`auth_state`/`destination` for every path. Admin page's printed/digital split confirmed visually and functionally (copy buttons work). `claude.ts`: zero diff. All test data deleted after.

**Full detail**: `SOMMELIER_BUILT.md` S86. `WHAT_WE_BUILT_DB.md` gains `qr_universal_token` + the `qr_scan_event`/enum extensions.

---

### 139. HOME Task 7e — QR Simplification: one universal code, the profile absorbs the bag view, per-coffee tokens go fully dark (2026-08-04)

**What it is**: a Phase 1 patch closing the QR design for launch, amending #138 (Task 7c) per three fresh decisions from Dana. (0) Exactly one universal printed code, not one per roastery — 7c's `path`/`temecula` split is narrowed to `path` as canonical; `temecula`'s existing token stays valid in the DB but is never shown or minted again. (1) The universal scan now lands on the customer's own `/profile` page instead of a dedicated bag-view/picker page — signed-in customer (orders or B2B sponsorship) → `/profile`; signed out → sign-in → `/profile`; signed-in non-customer → `/find-my-flavor`. This deletes 7c's two-bag picker outright, since the profile page already shows every card for free. (2) Per-coffee tokens are retired from every remaining surface — the admin "Digital links" section (list, per-coffee mint button, mint-missing) is deleted, not demoted; existing per-coffee `/b/{token}` links (story pages, emails — already direct-linked, not token-based) keep resolving untouched, just surfaced nowhere.

**Net result: less code than #138 left behind.** `qrDoor.ts` loses the per-coffee-grouped `getActiveBagsForProfile()`/`ActiveBag` (replaced by a plain existence check, `hasAnyOrderOrSponsorship()`); `qr.ts`'s universal branch drops the recency-window/picker-construction logic and the `getSommelierConfig`/`buildBagView` calls that supported it; `admin.ts` drops three now-orphaned routes (`/qr/mint/:coffeeId`, `/qr/mint-missing`, `/qr/tokens`) whose only caller was the deleted admin UI section; `AdminQrDoor.tsx` shrinks to a single printed-code block plus the print-QA checklist.

**No schema change** — `auth_state`/`destination` on `qr_scan_event` reuse existing enum values (`owner`/`bag_view` for a customer scan, now surfaced at `/profile`; `no_orders`/`brand_landing` for a non-customer, now pointed at the quiz specifically) rather than growing new ones.

**Verified**: all three universal-scan destinations walked live in a browser with a marked test customer (real order + quiz result + a brew card generated via the same order-placement hook real orders use) and a marked test non-customer — customer → `/profile` with brew cards visible; signed-out → sign-in → `/profile`; non-customer → `/find-my-flavor`. A legacy per-coffee token (coffee 6) confirmed still resolving, no 404. Admin QR Door page confirmed showing exactly one printed URL plus the checklist. `qr_scan_event` rows read back correct for every path. `tsc --noEmit` and `vite build` both clean. `claude.ts`: zero diff. All test data deleted after.

**Full detail**: `SOMMELIER_BUILT.md` S87 (supersedes parts of S86). No `WHAT_WE_BUILT_DB.md` entry — no schema change.

---

### The Bloom — content/admin follow-ups (#83, #84)
- **`dial_position_vocabulary.description` is empty everywhere in production** — the Bloom Dial widget gracefully omits it when empty (no blank line), but every position currently just shows its label with no supporting copy. Content task, not a code task.
- **No dimension admin UI exists** — `coffee_dimensions.platform_name` (5 numeric dimensions seeded, see #84) is direct-SQL-only for now. Add click-to-edit for it wherever dimension-level admin editing eventually lives, same pattern as `coffee_alias.platform_name` on the Coffees page.
- **`archetype_relationship` table is confirmed unused (0 rows)** — `v_archetype_adjacency` (hop-derived) is the real source of truth for archetype adjacency now (#84). Consider dropping `archetype_relationship`/`archetype_tunable_variable`'s sibling concerns or documenting it as legacy, if confirmed dead elsewhere too — not done here, out of scope for this pass.
- **Sparse hop-derived adjacency** — only one archetype pair (`balanced_sweet ↔ floral`) currently has an authored bridge hop, so the "Worth exploring" compatibility tier will rarely trigger until more bridge hops are added via the Bloom Dial admin page.

### Quiz / scoring
1. **Populate cross-archetype negative scores** — current `quiz_answer_archetype_score` rows only award one positive score per answer. Add negative rows for competing archetypes (e.g. Q5 answer A → Chocolate +3, Balanced −1, Fruity −2) to make the matrix fully competitive. Run via Cloud SQL Studio — no code deploy needed.

### Bloom Dial — navigation hops
- **`dial_coffee_relationships`** (the "want something bolder? try X" hops) has not been populated for the new Path and TCR coffees. All new coffees have `confidence = medium` pre-cupping estimates — actual sensory distances (sweetness, acidity, body values in `cupping_score_values`) are unknown, so any hops added now would be guesses.
- **Correct order:** (1) run cupping sessions for new coffees → `cupping_scores` + `cupping_score_values` populated; (2) promote archetype confidence from `medium` → `high`; (3) add hops via admin UI — `v_dial_positions.delta_from_default` will then reflect real scores to guide which coffees are genuinely one step bolder/lighter from each other.
- **Session 001 coffees** (Crosshatch, Ethiopia, Feather In Cap) already have cupping data and could have hops added now if needed.
- ~~Hop graph feeds only Liam's RAG, not archetype tagging/dial position~~ — done, #75: `v_archetype_adjacency` + within-archetype `hop_conflict` check now cross-reference the hop graph against archetype adjacency and the cupping-based suggestion.
- **Multi-source signal infrastructure (#75)** — tables + rollup view built, wired for `cupping` since #75; `onsite_feedback` now also populates `dial_position_signal` as of #100 (the on-site feedback form's new closed "lighter/as expected/bolder" question). `sms_feedback` still needs the equivalent question redesign — see `BLOOM_DIAL_ALLOCATION_SPEC.md` §3 Stage 2.
- **Decoupling "category" from "archetype"** — `experimental` now has `is_archetype = false` (#75) but still can't coexist with a real archetype on the same coffee. Migrating Kopi Safari to also carry a genuine archetype, plus the schema/UI rework that requires, is flagged as a deliberate next decision, not started.

### Cupping tool
3. **Brew parameters UI** — the `cupping_brew_params` table exists (dose, water, yield, ratio, temp, grind, extraction time, pressure, steep time, device) but has no entry form. Could be added to the Score Entry page as a collapsible "Brew Params" section.

### Collaborative flavor wheel
5. ~~Client feedback flow~~ — done, #100: `POST /api/orders/:orderId/feedback` v2 tasted-note chips write to `user_flavor_feedback`, surfaced via `OrderFeedbackForm.tsx`'s chip picker (Profile journal, Past Orders tab, Home/FI UC3 nudges).
6. **Wire AI recommendations to flavor wheel** — use `v_collaborative_flavor_wheel` to inform Claude recommendations. If a user's archetype is Fruity, surface coffees with high Blueberry / Citrus / Pineapple mentions across all three sources.

### Commerce
7. **Enable Shopify** — add 3 secrets to Secret Manager (`SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN`, `SHOPIFY_ADMIN_TOKEN`). No code changes needed — the stub lifts automatically.

### Frontend
10. **Replace video placeholders** — the hero and cinematic sections in `Home.tsx` and About's video section use placeholder `<source src>` URLs. Swap these for real video files when ready. No other code changes needed — the `<video autoPlay loop muted playsInline>` pattern is already in place.
11. **`font-light` cleanup** — remaining instances of `font-light` (Tailwind weight 300) on unredesigned pages (`FlavorQuiz.tsx`, `Shop.tsx`, `CoffeesPage.tsx`, `JoinHousehold.tsx`, `SignIn.tsx`, `FamilyTab.tsx`, `NewsletterModal.tsx`). Genova has no weight 300 so the browser falls back to Thin (100). Clean up page by page during each redesign pass. `Profile.tsx` cleaned in #100.

### User lifecycle (#73, #74)
15. **Real UC3/UC4 verification** — can't be tested against live checkout traffic until Shopify is wired for real (orders don't happen yet).
16. **Admin UI for `user_lifecycle_stage`** — the table is designed to be admin-editable the same way `lookup_value` is, but no dedicated admin screen was built yet — reuse the `AdminSommelierConfig`-style pattern if/when needed.

### Optional
12. **Apple sign-in** — requires an Apple Developer account ($99/year). Low priority.
13. **Subscription management UI** — the schema and backend route exist but there's no frontend page yet.
