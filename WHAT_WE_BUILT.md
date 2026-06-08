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
| `firebase-adminsdk-fbsvc@axis-and-bloom-prod.iam.gserviceaccount.com` | Firebase Admin SDK — verifies auth tokens in the backend |
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

## Database Schema (45 Tables)

The schema lives in `backend/src/db/schema.sql` and runs automatically on every backend startup (`CREATE TABLE IF NOT EXISTS` — fully idempotent, safe to run repeatedly).

It was merged from your original Supabase design plus adaptations for Firebase Auth (Firebase UID used as the user identifier instead of Supabase's auth.users). The cupping tool tables (added May 2026) are a separate group with SERIAL PKs rather than UUIDs.

### Table groups

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
- `payment_detail` — Stripe customer links and payment info

**Flavor / archetype engine**
- `archetype_vector` — where each archetype sits in flavor-dimension space
- `archetype_relationship` — which archetypes are adjacent/complementary
- `archetype_tunable_variable` — dials users can adjust within their archetype
- `user_vector_state` — where each user sits in flavor-dimension space (declared + behavioral)
- `user_archetype_tuning` — user's personal adjustments to their archetype
- `user_coffee_profile` — their ranked archetype matches

**Blends / roastery**
- `blend` — coffee blends available for purchase; links to Shopify variant IDs
- `blend_vector` — where each blend sits in flavor-dimension space
- `user_roaster_link` — roastery staff accounts
- `roaster` — drop-ship roastery partners; fields: name, contact_person, email, phone, address, website, api_endpoint, avg_fulfillment_hours, roaster_notes, is_active; new contact fields added May 2026

**Quiz**
- `question` — includes `weight NUMERIC DEFAULT 1`; question-level multiplier applied uniformly to all answers in that question
- `answer` — branching logic via `next_question_id`, vector impact stored as JSONB; includes `weight NUMERIC DEFAULT 1`; answer-level multiplier applied uniformly across all archetype rows for that answer
- `answer_archetype_score` — the scoring matrix: one row per (answer, archetype); `score` is the archetype-specific impact (positive or negative); `archetype_id = NULL` = neutral answer (no points); UNIQUE on `(answer_id, archetype_id)`
- `quiz_session` — a user's completed quiz
- `quiz_vector` — dimension scores from a quiz session

**Orders & fulfillment**
- `subscription` — recurring delivery schedules
- `order` — purchase records; links to Shopify order IDs
- `shipment` — tracking info per order
- `order_line_item` — individual blend quantities per order

**Intelligence**
- `notification_log` — email/SMS notifications sent
- `feedback_event` — ratings, repurchases, skips used to tune recommendations
- `recommendation_log` — AI recommendation audit trail

**Chat & newsletter**
- `chat_message` — Claude AI chat history per user
- `subscriber_source` — normalised reference table for signup origins; 4 seeded rows: `pre_launch` (Pre-Launch Popup), `newsletter` (Newsletter Modal), `post_quiz` (Post-Quiz Signup), `footer` (Footer Widget)
- `newsletter_subscriber` — `email` PK; `first_name TEXT`; `source_id` FK → `subscriber_source`; `user_id` FK → `user_profile` (optional); `subscribed BOOLEAN`; `created_at`

**Cupping tool** *(added May 2026 — SERIAL PKs, standalone from the main schema)*
- `coffees` — coffee catalogue (name, roaster, origin, process, roast level/shade, roaster flavor descriptors)
- `cupping_sessions` — session header (date, brew_method TEXT, location, notes); brew_method was originally `brew_method_enum` but migrated to `TEXT` so it accepts all lookup values (cupping, pour-over, etc.) without enum constraint failures
- `session_coffees` — junction: which coffees appeared in a session and in what order
- `dimensions` — cupping dimension catalogue, 12 seeded rows; `is_numeric = true` → scored 0–15 with scale labels; `is_numeric = false` → free-text notes only
- `cupping_scores` — per-taster score header (session_coffee_id, taster_name, is_merged, overall_notes); unique on `(session_coffee_id, taster_name)`; `is_merged = true` for the combined row
- `cupping_score_values` — one row per (cupping_score, dimension); `value_min` / `value_max` for numeric dims, `notes` for free-text dims; unique on `(cupping_score_id, dimension_id)`
- `cupping_score_descriptors` — structured flavor notes: links a score row to one or more SCA wheel descriptors (`cupping_note`) instead of free text; `intensity` (0–15) captures how prominent the descriptor was; `custom_notes` is an escape hatch for off-wheel descriptors; unique on `(cupping_score_id, cupping_note_id)`
- `coffee_roastery_descriptors` — structured version of `coffees.flavor_descriptors_roaster TEXT[]`; **one row per descriptor per coffee** (e.g. Crosshatch with 3 bag notes = 3 rows); links to SCA wheel via FK; unique on `(coffee_id, cupping_note_id)`
- `client_flavor_feedback` — post-delivery feedback from customers; **one row per descriptor per user per coffee** (e.g. a client who tasted Blueberry and Dark Chocolate = 2 rows); links user + coffee + order to SCA wheel descriptors; `intensity` optional; no session or brew params — lightweight by design
- `brew_params` — brew parameters per session-coffee (dose, water, yield, ratio, temp, grind, extraction time, pressure, steep time, device); all nullable
- `archetype_assignments` — archetype tag per coffee with confidence level; `superseded_at = NULL` for the current assignment, populated when a newer one replaces it
- `coffees.ai_summary TEXT` — AI-generated tasting note cached in the DB (added via idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`); generated once on first public page load, updated only via admin refresh; never regenerates on visitor traffic

### Views

| View | Description |
|---|---|
| `v_collaborative_flavor_wheel` | All descriptor observations per coffee with source label (`internal`, `roastery`, `client`). Columns: `coffee_id`, `coffee_name`, `cupping_note_id`, `wheel_category`, `wheel_subcategory`, `descriptor`, `source`, `intensity`. No extra JOINs needed — names are already resolved. One row per observation; GROUP BY coffee + descriptor to aggregate. |
| `v_quiz_scoring_matrix` | Full scoring matrix — one row per (question, answer, archetype). Columns: `quiz_version`, `q_number`, `q_text`, `a_number` (generated via ROW_NUMBER), `answer_text`, `q_weight`, `ans_weight`, `archetype`, `ans_score`. Lambda formula: `q_weight × ans_weight × ans_score`. Uses `DROP VIEW IF EXISTS` + `CREATE VIEW` (not `CREATE OR REPLACE`) to allow column reordering. |
| `v_newsletter_subscribers` | All newsletter signups with human-readable source label. Columns: `email`, `first_name`, `source` (e.g. `Pre-Launch Popup`), `subscribed`, `signed_up_at`. Ordered newest first. |

### Dimensions (seeded, 12 rows)

| ID | Name | Type | Scale |
|---|---|---|---|
| 1 | Fragrance | Free-text | — |
| 2 | Aroma | Free-text | — |
| 3 | Flavor | Free-text | — |
| 4 | Sweetness | Numeric | 0 (no sweetness) → 15 (very sweet) |
| 5 | Acidity | Numeric | 0 (flat) → 15 (very bright / sharp) |
| 6 | Bitterness | Numeric | 0 (none) → 15 (very bitter) |
| 7 | Body | Numeric | 0 (watery / light) → 15 (very heavy) |
| 8 | Texture | Numeric | 0 (very smooth / silky) → 15 (very drying / rough) |
| 9 | Savory / Depth | Numeric | 0 (transparent / clean) → 15 (very deep / complex) |
| 10 | Finish Length | Numeric | 0 (disappears immediately) → 15 (very long lingering) |
| 11 | Finish Character | Free-text | — |
| 12 | Mouthfeel | Free-text | — |

### Enums (cupping tool)

| Enum | Values | Used by |
|---|---|---|
| `brew_method_enum` | `filter`, `espresso`, `cold_brew`, `other` | Defined but no longer used as a column type — `cupping_sessions.brew_method` was migrated to `TEXT` |
| `archetype_enum` | `chocolate_nutty`, `balanced_sweet`, `fruity`, `earthy`, `floral`, `experimental` | `archetype_assignments.archetype` |
| `confidence_enum` | `low`, `medium`, `high` | `archetype_assignments.confidence` |
| `address_type_enum` | `shipping`, `billing` | `address.address_type`; migrated from `TEXT` via idempotent `DO` block on deploy |

---

## API Endpoints

| Method | Path | Auth required | Description |
|---|---|---|---|
| GET | `/health` | No | Returns `{"status":"ok"}` |
| GET | `/health/db` | No | Returns connected status + all table names |
| POST | `/api/auth/sync` | Yes | Creates/updates user_profile row after Firebase sign-in; accepts `{ firstName, lastName }` — saves on signup, uses `COALESCE` so re-login never overwrites existing names |
| POST | `/api/auth/reset-password` | No | Sends branded password-reset email via Resend from axisandbloomcoffee.com |
| GET | `/api/quiz/questions` | No | Returns active quiz questions + answers from DB (with archetype names and answer UUIDs) |
| POST | `/api/quiz/score` | No | Takes `{ answerIds[] }`, SUMs weighted scores from `answer_archetype_score`, returns winning archetype, secondary archetype, food signal, confidence level, and recommendation mode. Veto cascade: Q6 → Q5 → Q3 → Q1. All scoring logic lives here — zero logic in the frontend. |
| POST | `/api/quiz/results` | Yes | Saves completed quiz session with full scoring context (including secondaryArchetype, foodSignal, confidence, recommendationMode in context_data JSONB); calls Claude with mode-specific prompt; returns session ID + recommendation |
| GET | `/api/quiz/results/latest` | Yes | Returns user's most recent quiz session with archetype name |
| GET | `/api/shop/products` | No | Returns Shopify products (empty list until Shopify wired) |
| POST | `/api/shop/order` | Yes | Creates Shopify order |
| POST | `/api/agent/chat` | Yes | Claude AI chat with coffee context |
| GET | `/api/orders` | Yes | User's order history |
| GET | `/api/users/profile` | Yes | User's full profile — returns `firstName`, `lastName`, `dateOfBirth`, `email`, `archetype`, `addresses[]`, `orders[]`, `isAdmin` |
| PATCH | `/api/users/profile` | Yes | Update `firstName`, `lastName`, `dateOfBirth` — uses `COALESCE` so omitted fields are not cleared |
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
| GET | `/api/coffees` | No | Public coffee list with name, roaster, origin, process, roast level, and current archetype assignment |
| GET | `/api/coffees/:id/flavor-wheel` | No | Flavor descriptors for one coffee aggregated from all 3 sources via `v_collaborative_flavor_wheel` |
| GET | `/api/coffees/:id/dimensions` | No | Numeric dimension ranges (avg min/max per dimension) from all cupping scores + session overall notes |
| GET | `/api/coffees/:id/ai-summary` | No | Returns cached `ai_summary` from DB if it exists; otherwise generates via Claude haiku, stores, and returns |
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

### 21. Upgraded quiz to 5 questions with weighted `answer_archetype_score` table
**Problem**: The original backend scoring counted one vote per answer using `resulting_archetype_id` — flat, unweighted, inflexible. Adding a new archetype or changing scoring weights required code changes.  
**Fix**: Added a normalised `answer_archetype_score` table (one row per answer + archetype, with a `score` column). Also added `weight NUMERIC DEFAULT 1` to both `question` and `answer` tables for future question-level weighting. Scoring weights for Q1–Q5:
- Q1 = 1 pt, Q2 = 2 pts, Q3 = 1 pt (Q3-D neutral → no row), Q4 = 2 pts, Q5 = 3 pts
Added Q5 ("You're handed an espresso — straight, no milk, no sugar. How does it land?") to quiz v2 via idempotent DO block. `POST /api/quiz/score` now JOINs `answer_archetype_score`, GROUPs BY archetype, and returns SUM of scores instead of counting votes.  
**Seed file**: `backend/src/db/seeds/scoring_v1.sql` — run once in Cloud SQL Studio; idempotent, ON CONFLICT DO NOTHING.

### 20. Moved quiz scoring to backend (POST /api/quiz/score)
**Problem**: Archetype was determined in the frontend by `computeArchetype()` — a JavaScript function counting votes locally. Business logic should not live in the browser.  
**Fix**: Added `POST /api/quiz/score` to the backend. Frontend now sends the selected answer UUIDs; backend looks them up in the `answer` table, counts votes per archetype, applies tie-break logic, and returns the winner. The frontend only renders the result — it makes no decisions. `computeArchetype()` was removed entirely.

### 19. Dropped unused legacy tables
**Removed from schema and live DB:**
- `dimension` (UUID-based) — replaced by `dimensions` (SERIAL, cupping tool). FK references stripped from `archetype_vector`, `archetype_relationship`, `archetype_tunable_variable`, `user_vector_state`, `user_archetype_tuning`, `blend_vector`, `cupping_session_vector`, `quiz_vector` — columns kept, FKs removed.
- `cupping_session`, `cupping_session_note`, `cupping_session_vector` — legacy QC tables replaced by the new cupping tool (`cupping_sessions`, `session_coffees`, `cupping_scores`, `cupping_score_values`).
- `dimension_scoring_rule` — no longer needed without the `dimension` table.

All dropped via `DROP TABLE ... CASCADE` in Cloud SQL Studio. Removed from `schema.sql` so they won't be recreated on future deploys.

### 18. Refactored cupping scores to normalised dimensions model
**Problem**: `cupping_scores` had 27 hardcoded columns (sweetness_min, sweetness_max, sweetness_notes, etc.) — adding or renaming a dimension required a schema change.  
**Fix**: Replaced with a 3-table normalised design:
- `dimensions` — 12-row catalogue defining each attribute (name, scale labels, min/max, is_numeric flag)
- `cupping_scores` — slim header row per taster (session_coffee_id, taster_name, is_merged, overall_notes)
- `cupping_score_values` — one row per (score, dimension) with value_min, value_max, notes

Migration is idempotent: a DO block detects the old `sweetness_min` column and drops the table before the new `CREATE TABLE IF NOT EXISTS` runs. Sequence for `dimensions` reset to 13 after seeding IDs 1–12.

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
- Q2 has `weight = 0` — not in `answer_archetype_score` at all; answer archetype comes from `answer.resulting_archetype_id` and is captured as `food_signal`
- Q4 gains experimental gate (was Q3-C in V3)
- Q4-D split: +0.5 to Chocolate & Nutty AND +0.5 to Balanced & Sweet (two rows in `answer_archetype_score`, `resulting_archetype_id = NULL`)
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
- Q3-D scoring changed: was neutral (no row) in V2 → +0.5 Chocolate & Nutty in a mid-session fix → now correctly splits +0.5 CN + +0.5 BS (two rows in `answer_archetype_score` for the same answer)
- Q4 answer texts updated: "Feels too thin/watery" → "It has no bitterness or intensity"; "Feels too heavy or strong" → "It's too bitter or too intense"
- Q5-B and Q5-C updated to softer, more evocative language
- `answer` table gained `is_experimental_gate BOOLEAN DEFAULT FALSE` column (idempotent ALTER TABLE)
- Source file: `backend/src/quizes/Coffee_Quiz_Scoring_v3.xlsx` (committed to repo)

### 27. Tie-break was a static priority list, not spec-compliant
**Problem**: `POST /api/quiz/score` resolved ties with a hardcoded order (Balanced & Sweet > Chocolate & Nutty > Fruity) regardless of the user's actual answers. This meant two users with identical scores but different answers would always get the same archetype — wrong by design.  
**Fix**: Replaced with a veto cascade: Q5 → Q4 → Q2 → Q1. For each question in that order, if the user's answer pointed to one of the tied archetypes, that archetype wins. Q3 is intentionally excluded (contributes to raw score only). Fallback: Balanced & Sweet. A second DB query fetches the `q_number → archetype` mapping from `answer_archetype_score` only when a tie is detected — no extra cost on the happy path.

Also fixed: Q3-D ("I'm not sure. I don't usually drink it black.") was previously neutral (no row in `answer_archetype_score`). Now correctly awards +1 to Chocolate & Nutty per the scoring spec. Added to the schema.sql seed (idempotent — `ON CONFLICT DO NOTHING`).

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

The site shows a full-screen pre-launch curtain at `axisandbloom.com/` while `VITE_PRELAUNCH_MODE=true` in the CI/CD pipeline. All other routes (`/about`, `/shop`, `/admin`, etc.) remain fully accessible.

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
Visit `axisandbloom.com/?preview=true` to skip the curtain and see the full site. Stored in `sessionStorage` — resets when you close the browser.

Implemented in `frontend/src/app/App.tsx` via a `HomeOrPrelaunch` component that reads `useSearchParams` and `sessionStorage`.

### To turn off pre-launch when you're ready to launch
1. Open `.github/workflows/deploy.yml`
2. Remove or change to `false`: `VITE_PRELAUNCH_MODE: 'true'`
3. Push to `main` — deploys automatically

---

## Current State (as of 2026-06-07 — updated)

| Component | Status |
|---|---|
| Frontend deployed | ✅ https://axisandbloom.com (custom domain) / https://axis-and-bloom-prod.web.app |
| Backend deployed | ✅ https://axis-bloom-backend-oiub7eumya-uc.a.run.app |
| Database connected | ✅ 47 tables verified via /health/db |
| Email/password auth | ✅ Working |
| Google sign-in | ✅ Working (was already enabled) |
| Apple sign-in | ⚠️ Not configured |
| Flavor quiz (V4) | ✅ Active — V4 replaces V3; 6 questions, weighted scoring, food instinct question (Q2, secondary signal only), experimental gate on Q4-C, split answer on Q4-D; full food signal × secondary archetype matching logic with confidence levels and 6 recommendation modes |
| Quiz matching logic | ✅ Food signal drives confidence (high/medium/low) and recommendation mode; Option B close threshold (secondary scored on Q5 or Q6); experimental gate modifier; `POST /api/quiz/score` returns full scoring context |
| Transactional email | ✅ Resend — sends from noreply@axisandbloomcoffee.com |
| Marketing email / Mailchimp | ✅ Active — new signups synced to Mailchimp audience with FNAME merge field; credentials in Secret Manager |
| Claude AI chat | ✅ Wired up, API key in Secret Manager |
| Claude recommendations | ✅ 6 mode-specific prompts in `getRecommendation()` — primary_only, primary_plus_introduce_secondary, primary_plus_active_secondary, primary_plus_note_secondary, primary_as_starting_point, ai_agent |
| Our Coffees page (`/coffees`) | ✅ Redesigned — three content layers: (1) AI editorial content (surprise angle, three-voice story, collapsible AI note — all cached in SQL + Firestore); (2) personalization layer for logged-in users (compatibility badge + dimension comparison text); (3) data layer (dimension bars + bubble cloud). Compare mode: ⇄ toggle shows two coffees side-by-side with dimension diff bars. |
| Shopify | ⚠️ Stubbed — waiting for roastery account |
| Pre-launch page | ✅ Live — full-screen curtain at axisandbloom.com; email + first name capture saves to DB + Mailchimp; bypass via `?preview=true` |
| Newsletter subscriber tracking | ✅ `subscriber_source` table tracks signup origin (`pre_launch`, `newsletter`, `post_quiz`, `footer`); `first_name` stored |
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

## Our Coffees Page (`/coffees`)

A public consumer-facing page at `/coffees` that presents each coffee's full flavor intelligence in one editorial view. The design philosophy: answer "should I order this coffee?" — not present a data spec sheet.

**File**: `frontend/src/app/components/CoffeesPage.tsx`  
**Backend**: `backend/src/routes/coffees.ts`, `backend/src/services/claude.ts`

### DB columns on `coffees` table

| Column | Type | Description |
|---|---|---|
| `ai_summary` | TEXT | 2–3 sentence tasting note, generated once per coffee |
| `surprise_note` | TEXT | 1–2 sentence "what's unexpected" hook, editorial tone |
| `three_voice_story` | TEXT | Short paragraph narrating agreement/divergence across the 3 descriptor sources |

All three generated via Claude haiku, cached in SQL, never regenerated on visitor traffic. All added via idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

### Layout

Left sidebar (desktop) / horizontal pill scroll (mobile): coffee cards with name, roaster, and archetype pill.

Right panel, top to bottom:

1. **Coffee header** — name, roaster, origin, process, roast level tags + archetype pill + ⇄ Compare toggle
2. **Personalization layer** (logged-in users with an archetype only) — compatibility badge + dimension comparison sentence
3. **Surprise angle** — italic, editorial, left-border pull-quote style
4. **Three-voice story** — source legend (rust / sage / purple) + short narrative paragraph
5. **AI tasting note** — collapsible ("Read full note ↓ / Collapse ↑")
6. **Dimension bars** — range bars on 0–15 scale, staggered animation
7. **Descriptor bubble cloud** — √(mentions)-sized circles, colored by primary source, spring-animated

### Content layer 1 — AI content (all users)

All three AI fields generated together via `GET /api/coffees/:id/content` (new endpoint). On first request for a coffee with null fields, generates all missing ones in parallel (3 Claude haiku calls), stores to SQL, writes to Firestore non-blocking. Cached hits return immediately.

`POST /api/admin/coffees/:id/refresh-content` force-regenerates all three fields (admin only). "↺ Refresh content" button in Admin → Coffees.

All three fields are stored in Cloud SQL only (`coffees` table). Coffee AI content is not written to Firestore — it's a property of the coffee record, not user-centric data.

### Content layer 2 — Personalization (logged-in users with archetype)

Pure frontend logic — no extra backend calls. User archetype fetched once via `GET /api/users/profile` on mount.

**Compatibility badge** — three states:
- **"In your wheelhouse"** (coffee archetype === user archetype): filled rust badge
- **"Worth exploring"** (coffee archetype is adjacent — e.g. Balanced & Sweet adjacent to Chocolate & Nutty): amber outlined badge
- **"Outside your comfort zone"** (no adjacency match): grey outlined + "not a bad thing" note

Adjacency map (hardcoded): chocolate_nutty ↔ balanced_sweet; balanced_sweet ↔ fruity; fruity ↔ floral, experimental; earthy ↔ chocolate_nutty.

**Dimension comparison text** — 1–2 sentences using hardcoded typical ranges per archetype vs the coffee's actual avg cupping scores. Finds the 1–2 most divergent key dimensions (Sweetness, Acidity, Bitterness, Body) and expresses them in relative language: "significantly more / slightly more / slightly less / significantly less than your usual [Archetype] profile." Only shown if divergence ≥ 1.5 points from mid.

### Content layer 3 — Interactive data (all users)

**Dimension bars** — unchanged from prior implementation.

**Bubble cloud** — unchanged. Hover tooltip with source breakdown still works.

**Compare mode** — toggle "⇄ Compare" in the coffee header. Shows a dropdown to select a second coffee. When active:
- Side-by-side header section: name + archetype pill + compatibility badge for each coffee
- Dimension bars show two stacked range bars per dimension (rust = primary, sage = compare). Bars where the mid-point diff > 3 pts turn amber with "Notable difference" label. Legend shows both coffee names + amber = notable difference.
- Bubble clouds shown side by side, one per coffee.
- Surprise angle, three-voice story, and AI note are hidden in compare mode to keep the view scannable.
- "✕ Exit compare" button returns to single-coffee view.

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/coffees/:id/content` | No | Returns `{ aiSummary, surpriseNote, threeVoiceStory }` — generates missing fields on first call |
| GET | `/api/coffees/:id/ai-summary` | No | Legacy; kept for backward compat — new code uses `/content` |
| POST | `/api/admin/coffees/:id/refresh-content` | Admin | Force-regenerates all three AI fields, updates SQL + Firestore |
| POST | `/api/admin/coffees/:id/refresh-summary` | Admin | Legacy; kept for backward compat |

### Navigation

"Our coffees" link in the main nav between "Find my flavor" and "About".

---

## Find My Flavor Page (`/find-my-flavor`)

The quiz entry page is auth-aware and renders one of four states based on sign-in status and whether the user already has an archetype.

**File**: `frontend/src/app/components/FlavorQuiz.tsx`

On mount, fetches `GET /api/users/profile` (signed-in users only). The profile response includes `archetype` (name, description, color, features) and `lastQuizDate` (from `quiz_session.completed_at`).

### State 1 — Signed in + has archetype (returning user screen)

Two-column split-screen layout:

**Left panel** — background photo with dark overlay. "Welcome back, {firstName}" label at the bottom, then four row-link options in white text:
1. **Retake the quiz** — starts the quiz immediately with name pre-filled, no name screen
2. **Talk to our coffee sommelier** → `/`
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

## Flavor Quiz (V4)

The quiz lives in `frontend/src/app/components/FlavorQuiz.tsx`. The active quiz version is always served dynamically via `GET /api/quiz/questions` (queries `quiz WHERE is_active = TRUE`) — no frontend deploy needed to switch versions.

**Version history:**
- **V1** — 15 questions, 6 archetypes, hardcoded in frontend (replaced)
- **V2** — 5 questions, 3 archetypes, DB-driven scoring (deactivated)
- **V3** — 5 questions, 3 archetypes, new "Perfect cup" Q2, experimental gate on Q3-C, updated answer texts; source file: `backend/src/quizes/Coffee_Quiz_Scoring_v3.xlsx` (deactivated)
- **V4** — 6 questions, 3 archetypes, weighted scoring, food instinct Q2 (secondary signal only), experimental gate on Q4-C, split answer on Q4-D, full food signal matching logic; source files: `misc/v4/`

### Questions (V4 — active)

| # | Weight | Category | Question | Notes |
|---|---|---|---|---|
| 1 | 1 | Identity | How would you describe your relationship with coffee? | Lowest weight — most rationalizable |
| 2 | 0 | Food instinct | Someone places a small treat next to your coffee. Without thinking, which do you grab? | Secondary signal only — not in primary scoring |
| 3 | 2 | Perfect cup | When you finish a really good cup of coffee, what made it good? | Second highest weight |
| 4 | 1 | Black coffee reaction | You try a new coffee black. What's your first reaction? | Experimental gate + split answer live here |
| 5 | 2 | Disappointment | Which of these would bother you most about a cup of coffee? | Strong negative framing |
| 6 | 3 | Bitterness tolerance | Someone hands you a coffee that's a little more bitter than expected. What's your honest reaction? | Strongest signal, highest weight |

### Archetypes

| Archetype | Color | Personality |
|---|---|---|
| **Chocolate & Nutty** | `#a54c2d` | Daily ritual drinker — bold, rich, comforting, particular |
| **Balanced & Sweet** | `#d1ac11` | Reliable habit — smooth, easy, approachable |
| **Fruity** | `#ca445f` | Curious discoverer — bright, lively, complex |

### Scoring model — three-level normalised matrix

Scoring is split across three fields, each with a distinct role. All three are kept separate (normalised) so any level can be tuned independently without touching the others.

| Field | Table | Role | Scope |
|---|---|---|---|
| `question.weight` | `question` | How important this question is relative to others | Applies to all answers in the question |
| `answer.weight` | `answer` | How decisive/strong this answer is as a signal | Applies uniformly across all archetype rows for this answer |
| `answer_archetype_score.score` | `answer_archetype_score` | The archetype-specific impact — positive or negative | One row per (answer, archetype) |

**Lambda formula:**
```
archetype total = SUM( question.weight × answer.weight × answer_archetype_score.score )
```

**V4 seeded values** (point difference baked into `score`; Q2 excluded from `answer_archetype_score`):

| Question | Weight | Answer | Archetype | Score |
|---|---|---|---|---|
| Q1 — Identity | 1 | It's a daily ritual. I'm particular about it. | Chocolate & Nutty | +1 |
| Q1 — Identity | 1 | It's a reliable habit. I just like having it. | Balanced & Sweet | +1 |
| Q1 — Identity | 1 | It's something I'm still discovering. I'm curious about it. | Fruity | +1 |
| Q2 — Food instinct | 0 | (secondary signal — not scored, captured as food_signal) | — | — |
| Q3 — Perfect cup | 2 | It was strong and satisfying. I felt it. | Chocolate & Nutty | +2 |
| Q3 — Perfect cup | 2 | It was smooth and easy the whole way through. Nothing got in the way. | Balanced & Sweet | +2 |
| Q3 — Perfect cup | 2 | It felt alive — bright and changing. Every sip was a little different. | Fruity | +2 |
| Q4 — Black coffee | 1 | It feels complete. I'd drink it as is, or add milk to make it even richer. | Chocolate & Nutty | +1 |
| Q4 — Black coffee | 1 | It's fine, easy to drink. I might add something to smooth it out. | Balanced & Sweet | +1 |
| Q4 — Black coffee | 1 | Interesting — what flavors am I getting here? ⚑ | Fruity | +1 |
| Q4 — Black coffee | 1 | I'm not sure. I don't usually drink it black. | CN + BS split | +0.5 each |
| Q5 — Disappointment | 2 | It has no bitterness or intensity. | Chocolate & Nutty | +2 |
| Q5 — Disappointment | 2 | It's too bitter or too intense. | Balanced & Sweet | +2 |
| Q5 — Disappointment | 2 | Every sip tastes exactly the same. | Fruity | +2 |
| Q6 — Bitterness | 3 | I don't mind. Actually I kind of like it. It tastes serious. | Chocolate & Nutty | +3 |
| Q6 — Bitterness | 3 | I'd rather have something gentler and smoother. | Balanced & Sweet | +3 |
| Q6 — Bitterness | 3 | It feels burnt to me. I'd rather have something fresher or more alive. | Fruity | +3 |

⚑ = experimental gate — see below.

| Question | Weight | Max score per archetype |
|---|---|---|
| Q1 | 1 | 1 pt |
| Q2 | 0 | — (secondary signal only) |
| Q3 | 2 | 2 pts |
| Q4 | 1 | 1 pt |
| Q5 | 2 | 2 pts |
| Q6 | 3 | 3 pts |
| **Total** | | **9 pts** |

**Max possible score for one archetype**: 1 + 2 + 1 + 2 + 3 = **9 pts**

**Tuning examples — no code changes needed, just DB updates:**
- Q6 should matter even more → `UPDATE question SET weight = 4 WHERE q_number = 6`
- A specific answer is an unusually strong signal → `UPDATE answer SET weight = 1.5 WHERE answer_text = '...'`
- An answer should also hurt a competing archetype → `INSERT INTO answer_archetype_score (..., archetype_id, score) VALUES (..., <fruity_id>, -2)`

**Experimental gate (Q4-C)**

Q4 answer C ("Interesting — what flavors am I getting here?") is flagged `is_experimental_gate = TRUE` in the `answer` table. When selected, `POST /api/quiz/score` returns `experimental: true`. This is a modifier on top of the base confidence/recommendation logic — see food signal section below.

Q4-C still awards +1 to Fruity in the scoring table — the gate is a separate flag, not a scoring override.

**Tie-break — veto cascade** (only fires when two or more archetypes share the top score):

```
Priority: Q6 → Q5 → Q3 → Q1   (Q2 and Q4 excluded from cascade)

For each question in that order:
  if the user's answer pointed to one of the tied archetypes → that archetype wins
  else → continue to next question

Fallback (cascade exhausted without resolution): Balanced & Sweet
```

The cascade uses the user's actual submitted answers looked up from `answer_archetype_score` — not a static priority list. The same tie can resolve differently depending on which answers the user gave.

### Food signal matching logic

After the primary winner and secondary archetype are determined, Q2's answer is used as a food signal to compute **confidence** and **recommendation mode**. Logic lives in `POST /api/quiz/score` and stored in `misc/v4/logic_notes.csv`.

**Base scenarios (food_signal vs primary/secondary):**

| Scenario | Condition | Confidence | Recommendation mode |
|---|---|---|---|
| 1 | food == primary (no close secondary) | high | `primary_only` |
| 2 | food == secondary | medium | `primary_plus_introduce_secondary` |
| 3 | food ≠ primary AND food ≠ secondary | low | `ai_agent` |
| 4 | food == primary AND secondary scored on Q5 or Q6 | medium | `primary_plus_note_secondary` |

**"Close secondary" threshold — Option B**: secondary is considered meaningful if its score appeared on Q5 (weight 2) or Q6 (weight 3) — i.e., the user's Q5 or Q6 answer pointed to the secondary archetype. Low-weight questions (Q1, Q4) contributing to a secondary don't qualify.

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

### Full flow

```
1. mount        → GET  /api/quiz/questions
                ← { quizId, questions: [{ q_text, answers: [{ id, text, archetype_name }] }] }

2. user answers → frontend tracks selected answer UUIDs (one per question)

3. last answer  → POST /api/quiz/score  { answerIds: ["uuid1", ..., "uuid6"] }
                ← { archetype, archetypeId, scores, experimental,
                    secondaryArchetype, foodSignal, confidence, recommendationMode,
                    tied? }

4. if signed in → POST /api/quiz/results  { archetype, scores, answers, decaf,
                                            experimental, secondaryArchetype,
                                            foodSignal, confidence, recommendationMode }
                ← { id: sessionId, recommendation }
                   (all fields saved to quiz_session.context_data JSONB)
```

Question images are still managed in the frontend (keyed by `q_number`) since images aren't stored in the DB.

---

## Cupping Tool Data Model

The cupping tool is built around a 9-table normalised schema. Here's how everything connects:

```
cupping_sessions
    └── session_coffees  (which coffees, in what order)
            ├── brew_params              (dose, ratio, grind, temp…)
            └── cupping_scores           (one row per taster; is_merged=true for combined)
                    ├── cupping_score_values      → dimensions   (numeric: sweetness 9–11, acidity 6–8…)
                    └── cupping_score_descriptors → cupping_note (flavor wheel: Blueberry, Dark Chocolate…)

coffees
    ├── archetype_assignments       (current + historical archetype tags per coffee)
    ├── coffee_roastery_descriptors → cupping_note  (roaster bag notes, structured)
    └── client_flavor_feedback      → cupping_note  (post-delivery customer feedback)

cupping_note  (SCA wheel reference — 84 descriptors, static)
dimensions    (12 cupping dimensions — numeric or free-text, static)

v_collaborative_flavor_wheel  (view — unions all three descriptor sources with 'internal' | 'roastery' | 'client' label)
```

**Design decisions:**
- `cupping_score_values` handles **numeric dimensions** (sweetness, acidity, bitterness, body…) with `value_min` / `value_max` on a 0–15 scale
- `cupping_score_descriptors` handles **flavor descriptors** as FK references to the SCA wheel instead of free text — structured and queryable; `intensity` (0–15) captures how prominent a descriptor was; `custom_notes` is the escape hatch for off-wheel descriptors
- **Three separate tables** for internal / roastery / client sources — each has a different shape (session context, static bag notes, user+order context). A single `source` column on `cupping_sessions` would force client feedback into a cupping session structure it doesn't fit
- **One row per descriptor** in both `coffee_roastery_descriptors` and `client_flavor_feedback` — not a TEXT[] array or comma-separated string. This makes it possible to COUNT mentions, AVG intensity, and filter by `wheel_category` across all three sources in the collaborative wheel view
- `cupping_note` is intentionally **not** further normalized (wheel_category / wheel_subcategory repeat as TEXT) — 84 rows of fixed reference data doesn't justify the JOIN complexity of a 3-table split

---

## SCA Flavor Wheel (`cupping_note`)

84 descriptors seeded from the SCA Coffee Taster's Flavor Wheel (source: Specialty Coffee Association / World Coffee Research Sensory Lexicon). Three-level hierarchy: `wheel_category` → `wheel_subcategory` → `descriptor`. Descriptors with no subcategory have `wheel_subcategory = NULL`.

**Seed file**: `backend/src/db/seeds/cupping_notes_sca_wheel.sql` — idempotent, skips if table already has rows.

| Category | Subcategories | Descriptors |
|---|---|---|
| Floral | Floral | Black Tea, Chamomile, Rose, Jasmine |
| Fruity | Berry, Dried Fruit, Other Fruit, Citrus Fruit | Blackberry, Raspberry, Blueberry, Strawberry, Raisin, Prune, Coconut, Cherry, Pomegranate, Pineapple, Grape, Apple, Peach, Pear, Grapefruit, Orange, Lemon, Lime |
| Sour / Fermented | Sour, Alcohol / Fermented | Sour Aromatics, Acetic Acid, Butyric Acid, Isovaleric Acid, Citric Acid, Malic Acid, Winey, Whiskey, Fermented, Overripe |
| Green / Vegetative | Raw | Olive Oil, Beany, Under-ripe, Peapod, Fresh, Dark Green, Vegetative, Hay-like, Herb-like |
| Other | Papery / Musty, Chemical | Stale, Cardboard, Papery, Woody, Moldy/Damp, Musty/Dusty, Musty/Earthy, Animalic, Meaty/Brothy, Phenolic, Bitter, Salty, Medicinal, Petroleum, Skunky, Rubber |
| Roasted | Burnt, Cereal | Pipe Tobacco, Tobacco, Acrid, Ashy, Smoky, Brown, Roast, Malt, Grain |
| Spices | Pungent, Brown Spice | Pepper, Anise, Nutmeg, Cinnamon, Clove |
| Nutty / Cocoa | Nutty, Cocoa | Peanuts, Hazelnut, Almond, Chocolate, Dark Chocolate |
| Sweet | Brown Sugar | Molasses, Maple Syrup, Caramelized, Honey, Vanilla, Vanillin, Overall Sweet, Sweet Aromatics |

**Check it:**
```sql
SELECT wheel_category, COUNT(*) FROM cupping_note GROUP BY wheel_category ORDER BY wheel_category;
```

---

## Cupping Sessions

Session data is stored in the cupping tool tables and inserted manually via Cloud SQL Studio. Seed files live in `backend/src/db/seeds/` (for reference only — do not add to `schema.sql`).

### Session 001 — Path Coffee Roasters, 2026-05-27
**File**: `backend/src/db/seeds/session_001_path_2026_05_27.sql`  
**Tasters**: Dana, Camila (first cupping — scores treated as directional)  
**Brew method**: Filter  
**Notes**: Scores merged into one result set (`taster_name = 'session_1_merged'`, `is_merged = true`)

| Coffee | Origin | Blend/Single | Process | Roast | Archetype | Confidence |
|---|---|---|---|---|---|---|
| Crosshatch | Nicaragua & Ethiopia | Blend | Washed | Light-medium | Balanced & Sweet | High |
| Ethiopia | Ethiopia | Single | Washed | Light-medium | Fruity | High |
| Feather In Cap | Colombia & Ethiopia | Blend | Washed | Medium-dark | Chocolate & Nutty | Medium |

**Score highlights:**
- **Crosshatch**: sweetness 9–11 (honey, sweet), acidity 6–8 (apple, banana, coconut — soft and round), bitterness 3–5
- **Ethiopia**: sweetness 6–8 (fruit-driven brightness), acidity 8–10 (pineapple — brightest of the three), bitterness 0–2 (trace only), tea-like body
- **Feather In Cap**: sweetness 7–9 (sweet on nose, tobacco took over in cup), acidity 2–4 (low), bitterness 5–7 (tobacco/burnt character — adjusted down), drying finish

**Roastery descriptors** (`coffee_roastery_descriptors`) — seeded from bag notes:  
File: `backend/src/db/seeds/roastery_descriptors_session_001.sql`

Roastery bag notes use subcategory-level language ("Dried Fruit", "Citrus") rather than SCA leaf descriptors. Each is mapped to the closest SCA leaf; the roaster's exact language is stored in the `notes` column.

| Coffee | Bag note | → SCA descriptor | Wheel category |
|---|---|---|---|
| Crosshatch | Caramel | Caramelized | Sweet / Brown Sugar |
| Crosshatch | Dried Fruit | Raisin | Fruity / Dried Fruit |
| Crosshatch | Citrus | Lemon | Fruity / Citrus Fruit |
| Ethiopia | Stone Fruit | Cherry | Fruity / Other Fruit |
| Ethiopia | Floral | Jasmine | Floral / Floral |
| Ethiopia | Citrus | Lemon | Fruity / Citrus Fruit |
| Feather In Cap | Brown Sugar | Caramelized | Sweet / Brown Sugar |
| Feather In Cap | Cocoa | Chocolate | Nutty / Cocoa |
| Feather In Cap | Dried Fruit | Prune | Fruity / Dried Fruit |

**Internal cupping descriptors** (`cupping_score_descriptors`) — seeded from merged session notes:  
File: `backend/src/db/seeds/internal_descriptors_session_001.sql`

Free-text flavor notes from `cupping_scores` mapped to SCA leaf descriptors; original language stored in `custom_notes`.

| Coffee | Session note | → SCA descriptor | Wheel category |
|---|---|---|---|
| Crosshatch | dark chocolate | Dark Chocolate | Nutty / Cocoa |
| Crosshatch | cocoa | Chocolate | Nutty / Cocoa |
| Crosshatch | dried fruit | Raisin | Fruity / Dried Fruit |
| Crosshatch | citrus | Lemon | Fruity / Citrus Fruit |
| Crosshatch | honey / sweet | Honey | Sweet / Brown Sugar |
| Ethiopia | black tea | Black Tea | Floral |
| Ethiopia | floral | Jasmine | Floral / Floral |
| Ethiopia | berries | Blueberry | Fruity / Berry |
| Ethiopia | dried fruits | Raisin | Fruity / Dried Fruit |
| Ethiopia | citrus / lemon | Lemon | Fruity / Citrus Fruit |
| Feather In Cap | cocoa | Chocolate | Nutty / Cocoa |
| Feather In Cap | earthy | Musty / Earthy | Other / Papery / Musty |
| Feather In Cap | tobacco | Tobacco | Roasted |
| Feather In Cap | smoky | Smoky | Roasted / Burnt |
| Feather In Cap | burnt | Roast | Roasted / Burnt |
| Feather In Cap | spices | Pepper | Spices |

**Collaborative flavor wheel** — query all three sources together:
```sql
SELECT coffee_name, descriptor, wheel_category, source
FROM v_collaborative_flavor_wheel
ORDER BY coffee_name, source, descriptor;
```
Returns 25 rows for session 001: 16 internal (5+5+6) + 9 roastery (3+3+3).

---

## Useful DB Queries (run in Cloud SQL Studio)

### Check all tables
```sql
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
```

### Check enum values — single enum
```sql
SELECT unnest(enum_range(NULL::archetype_enum)) AS value;
```

### Check all cupping tool enums at once
```sql
SELECT t.typname AS enum_name, e.enumlabel AS value, e.enumsortorder AS sort_order
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('archetype_enum', 'brew_method_enum', 'confidence_enum', 'address_type_enum')
ORDER BY t.typname, e.enumsortorder;
```

### Check archetype rows
```sql
SELECT id, name, created_at FROM archetype ORDER BY name;
```

### Check dimensions
```sql
SELECT id, name, is_numeric, scale_min_label, scale_max_label, display_order
FROM dimensions ORDER BY display_order;
```

### Check cupping session data
```sql
SELECT cs.id, cs.session_date, cs.location, sc.display_order, c.name AS coffee
FROM cupping_sessions cs
JOIN session_coffees sc ON sc.session_id = cs.id
JOIN coffees c ON c.id = sc.coffee_id
ORDER BY cs.session_date, sc.display_order;
```

### Check archetype assignments (current only)
```sql
SELECT c.name AS coffee, aa.archetype, aa.confidence, aa.notes
FROM archetype_assignments aa
JOIN coffees c ON c.id = aa.coffee_id
WHERE aa.superseded_at IS NULL
ORDER BY c.name;
```

### Collaborative flavor wheel for a specific coffee
```sql
-- View already includes coffee_name, wheel_category, wheel_subcategory, descriptor — no extra JOINs needed
SELECT coffee_name, wheel_category, descriptor, source,
       COUNT(*)         AS mentions,
       AVG(intensity)   AS avg_intensity
FROM v_collaborative_flavor_wheel
WHERE coffee_id = 1   -- replace with target coffee id
GROUP BY coffee_name, wheel_category, descriptor, source
ORDER BY mentions DESC;
```

### Check quiz scoring matrix (view — should be 14 rows, Q3-D neutral has no row)
```sql
SELECT * FROM v_quiz_scoring_matrix;
```

### Newsletter subscriber list (pre-launch leads)
```sql
SELECT * FROM v_newsletter_subscribers;
```

### Check signup counts by source
```sql
SELECT source, COUNT(*) AS signups
FROM v_newsletter_subscribers
GROUP BY source
ORDER BY signups DESC;
```

### Admin user management
```sql
-- Grant admin
SELECT grant_admin('user@example.com');

-- Revoke admin (back to customer — user is not deleted)
SELECT revoke_admin('user@example.com');

-- List all admins
SELECT * FROM list_admins();
```

### Check quiz scoring table directly
```sql
SELECT q.q_number, a.answer_text, ar.name AS archetype, aas.score
FROM answer_archetype_score aas
JOIN answer    a  ON a.id  = aas.answer_id
JOIN question  q  ON q.id  = aas.question_id
JOIN archetype ar ON ar.id = aas.archetype_id
ORDER BY q.q_number, ar.name;
```

### Check all questions in quiz v2
```sql
SELECT q.q_number, q.q_text,
       json_agg(json_build_object('text', a.answer_text, 'archetype', ar.name) ORDER BY a.id) AS answers
FROM quiz qz
JOIN question q ON q.quiz_id = qz.id
JOIN answer   a ON a.question_id = q.id
LEFT JOIN archetype ar ON ar.id = a.resulting_archetype_id
WHERE qz.version = 'v2'
GROUP BY q.q_number, q.q_text
ORDER BY q.q_number;
```

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
2. Select a session — the coffee dropdown populates from `session_coffees`
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

---

## What's Still To Do

### Quiz / scoring
1. **Populate cross-archetype negative scores** — current `answer_archetype_score` rows only award one positive score per answer. Add negative rows for competing archetypes (e.g. Q5 answer A → Chocolate +3, Balanced −1, Fruity −2) to make the matrix fully competitive. Run via Cloud SQL Studio — no code deploy needed.

### Cupping tool
3. **Brew parameters UI** — the `brew_params` table exists (dose, water, yield, ratio, temp, grind, extraction time, pressure, steep time, device) but has no entry form. Could be added to the Score Entry page as a collapsible "Brew Params" section.

### Collaborative flavor wheel
5. **Client feedback flow** — post-delivery email/prompt asking customers to pick descriptors from the SCA wheel. Stores results in `client_flavor_feedback`. Schema is ready; needs backend route + frontend feedback UI.
6. **Wire AI recommendations to flavor wheel** — use `v_collaborative_flavor_wheel` to inform Claude recommendations. If a user's archetype is Fruity, surface coffees with high Blueberry / Citrus / Pineapple mentions across all three sources.

### Commerce
7. **Enable Shopify** — add 3 secrets to Secret Manager (`SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN`, `SHOPIFY_ADMIN_TOKEN`). No code changes needed — the stub lifts automatically.

### Optional
8. **Apple sign-in** — requires an Apple Developer account ($99/year). Low priority.
9. **Subscription management UI** — the schema and backend route exist but there's no frontend page yet.
