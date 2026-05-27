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

Firebase is used for **auth and hosting only**. The database is Cloud SQL (PostgreSQL), not Firestore.

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
│   │       │   ├── FlavorQuiz.tsx
│   │       │   ├── Shop.tsx
│   │       │   ├── Profile.tsx
│   │       │   └── ...
│   │       ├── context/
│   │       │   └── AuthContext.tsx  # Firebase auth state + signIn/signUp/Google/Apple
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
│   │   │   └── auth.ts         # Firebase token verification
│   │   ├── routes/
│   │   │   ├── auth.ts         # /api/auth — profile sync + password reset (Resend)
│   │   │   ├── quiz.ts         # /api/quiz — flavor quiz
│   │   │   ├── shop.ts         # /api/shop — Shopify products/orders
│   │   │   ├── agent.ts        # /api/agent — Claude AI chat
│   │   │   ├── orders.ts       # /api/orders
│   │   │   ├── users.ts        # /api/users
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
| Transactional email | Resend (sends from noreply@axisandbloomcoffee.com) |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL 15 on Cloud SQL |
| AI | Anthropic Claude (claude-sonnet-4-6 for chat, claude-haiku-4-5 for recommendations) |
| Orders | Shopify drop-ship (stubbed) |
| Frontend hosting | Firebase Hosting |
| Backend hosting | Google Cloud Run |
| Container registry | Artifact Registry (us-central1) |
| CI/CD | GitHub Actions |

---

## Database Schema (42 Tables)

The schema lives in `backend/src/db/schema.sql` and runs automatically on every backend startup (`CREATE TABLE IF NOT EXISTS` — fully idempotent, safe to run repeatedly).

It was merged from your original Supabase design plus adaptations for Firebase Auth (Firebase UID used as the user identifier instead of Supabase's auth.users). The cupping tool tables (added May 2026) are a separate group with SERIAL PKs rather than UUIDs.

### Table groups

**Lookup / reference**
- `user_type` — subscriber, admin, roaster partner, etc.
- `archetype` — named flavor profiles: Chocolate & Nutty, Balanced & Sweet, Fruity, Floral, Earthy, Experimental
- `roaster` — drop-ship roastery partners
- `quiz` — quiz versions
- `cupping_note` — SCA Coffee Taster's Flavor Wheel: 84 descriptors across 9 categories and ~25 subcategories; `intensity_score` is NULL by default (assigned per cupping session, not at descriptor level)

**Users**
- `household` — shared account grouping (one household, multiple members)
- `user_profile` — core user record; `firebase_uid` is the join key from Firebase Auth
- `user_email` — multiple email addresses per user
- `user_phone`
- `address` — shipping addresses
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
- `newsletter_subscriber`

**Cupping tool** *(added May 2026 — SERIAL PKs, standalone from the main schema)*
- `coffees` — coffee catalogue (name, roaster, origin, process, roast level/shade, roaster flavor descriptors)
- `cupping_sessions` — session header (date, brew method, location, notes)
- `session_coffees` — junction: which coffees appeared in a session and in what order
- `dimensions` — cupping dimension catalogue, 12 seeded rows; `is_numeric = true` → scored 0–15 with scale labels; `is_numeric = false` → free-text notes only
- `cupping_scores` — per-taster score header (session_coffee_id, taster_name, is_merged, overall_notes); unique on `(session_coffee_id, taster_name)`; `is_merged = true` for the combined row
- `cupping_score_values` — one row per (cupping_score, dimension); `value_min` / `value_max` for numeric dims, `notes` for free-text dims; unique on `(cupping_score_id, dimension_id)`
- `cupping_score_descriptors` — structured flavor notes: links a score row to one or more SCA wheel descriptors (`cupping_note`) instead of free text; `intensity` (0–15) captures how prominent the descriptor was; `custom_notes` is an escape hatch for off-wheel descriptors; unique on `(cupping_score_id, cupping_note_id)`
- `brew_params` — brew parameters per session-coffee (dose, water, yield, ratio, temp, grind, extraction time, pressure, steep time, device); all nullable
- `archetype_assignments` — archetype tag per coffee with confidence level; `superseded_at = NULL` for the current assignment, populated when a newer one replaces it

### Views

| View | Description |
|---|---|
| `v_quiz_scoring_matrix` | Full scoring matrix — one row per (question, answer, archetype). Columns: `q_number`, `q_text`, `q_weight`, `answer_text`, `archetype`, `ans_score`, `ans_weight`. Use this to inspect or debug the scoring data. Lambda formula: `q_weight × ans_weight × ans_score`. |

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

| Enum | Values |
|---|---|
| `brew_method_enum` | `filter`, `espresso`, `cold_brew`, `other` |
| `archetype_enum` | `chocolate_nutty`, `balanced_sweet`, `fruity`, `earthy`, `floral`, `experimental` |
| `confidence_enum` | `low`, `medium`, `high` |

---

## API Endpoints

| Method | Path | Auth required | Description |
|---|---|---|---|
| GET | `/health` | No | Returns `{"status":"ok"}` |
| GET | `/health/db` | No | Returns connected status + all table names |
| POST | `/api/auth/sync` | Yes | Creates/updates user_profile row after Firebase sign-in |
| POST | `/api/auth/reset-password` | No | Sends branded password-reset email via Resend from axisandbloomcoffee.com |
| GET | `/api/quiz/questions` | No | Returns active quiz questions + answers from DB (with archetype names and answer UUIDs) |
| POST | `/api/quiz/score` | No | Takes `{ answerIds[] }`, SUMs weighted scores from `answer_archetype_score`, returns winning archetype + full score map. All scoring logic lives here — zero logic in the frontend. |
| POST | `/api/quiz/results` | Yes | Saves completed quiz session; resolves archetype UUID by name; returns session ID |
| GET | `/api/quiz/results/latest` | Yes | Returns user's most recent quiz session with archetype name |
| GET | `/api/shop/products` | No | Returns Shopify products (empty list until Shopify wired) |
| POST | `/api/shop/order` | Yes | Creates Shopify order |
| POST | `/api/agent/chat` | Yes | Claude AI chat with coffee context |
| GET | `/api/orders` | Yes | User's order history |
| GET | `/api/users/profile` | Yes | User's full profile |
| POST | `/api/newsletter/subscribe` | No | Newsletter signup |

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

## Current State (as of 2026-05-25)

| Component | Status |
|---|---|
| Frontend deployed | ✅ https://axis-and-bloom-prod.web.app |
| Backend deployed | ✅ https://axis-bloom-backend-oiub7eumya-uc.a.run.app |
| Database connected | ✅ 42 tables verified via /health/db |
| Email/password auth | ✅ Working |
| Google sign-in | ✅ Working (was already enabled) |
| Apple sign-in | ⚠️ Not configured |
| Flavor quiz (V2) | ✅ Fully DB-driven — questions from API, scoring on backend, zero logic in frontend |
| Transactional email | ✅ Resend — sends from noreply@axisandbloomcoffee.com |
| Claude AI chat | ✅ Wired up, API key in Secret Manager |
| Shopify | ⚠️ Stubbed — waiting for roastery account |
| Cupping tool schema | ✅ 9 tables + 3 enums + 12 seeded dimensions + 84 SCA flavor wheel descriptors — no backend routes or UI yet |
| CI/CD | ✅ Push to main deploys everything |

---

## Flavor Quiz (V2)

The quiz lives in `frontend/src/app/components/FlavorQuiz.tsx`. V2 replaced the original 15-question, 6-archetype system with a focused 5-question, 3-archetype design. **Questions and answers are no longer hardcoded** — they are seeded into the database and fetched at runtime via `GET /api/quiz/questions`.

### Questions

| # | Category | Question |
|---|---|---|
| 1 | Identity | How would you describe your relationship with coffee? |
| 2 | Food instinct | Someone puts something in front of you as a treat. Which do you reach for? |
| 3 | Black coffee reaction | You try a new coffee black. What's your first reaction? |
| 4 | Disappointment | Which coffee would disappoint you the most? |
| 5 | Bitterness tolerance | You're handed an espresso — straight, no milk, no sugar. How does it land? |

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

**Current seeded values** (all weights = 1; point difference is baked into `score`):

| Question | `score` per answer | Effective pts |
|---|---|---|
| Q1 — Identity | 1 | 1 pt |
| Q2 — Food instinct | 2 | 2 pts |
| Q3 — Black coffee reaction | 1 (option D = no row) | 1 pt |
| Q4 — Disappointment | 2 | 2 pts |
| Q5 — Bitterness tolerance | 3 | 3 pts (strongest signal) |

**Max possible score for one archetype**: 1 + 2 + 1 + 2 + 3 = **9 pts**

**Tuning examples — no code changes needed, just DB updates:**
- Q5 should matter even more → `UPDATE question SET weight = 2 WHERE q_number = 5`
- A specific answer is an unusually strong signal → `UPDATE answer SET weight = 1.5 WHERE answer_text = '...'`
- An answer should also hurt a competing archetype → `INSERT INTO answer_archetype_score (..., archetype_id, score) VALUES (..., <fruity_id>, -2)`

**Tie-break** (rare with weighted scoring): Balanced & Sweet > Chocolate & Nutty > Fruity  
**All scoring runs on the backend (Lambda)** — the frontend has zero scoring logic.

### Full flow

```
1. mount        → GET  /api/quiz/questions
                ← { questions: [{ q_text, answers: [{ id, text, archetype_name }] }] }

2. user answers → frontend tracks selected answer UUIDs (one per question)

3. last answer  → POST /api/quiz/score  { answerIds: ["uuid1", ..., "uuid5"] }
                ← { archetype: "Chocolate & Nutty", archetypeId: "uuid", scores: { ... } }
                   (backend SUMs answer_archetype_score rows for submitted UUIDs)

4. if signed in → POST /api/quiz/results  { archetype, scores, answers, decaf: false }
                ← { id: sessionId }   (saved to quiz_session with real FK)
```

Question images are still managed in the frontend (keyed by `q_number`) since images aren't stored in the DB.

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
WHERE t.typname IN ('archetype_enum', 'brew_method_enum', 'confidence_enum')
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

### Check quiz scoring matrix (view — should be 14 rows, Q3-D neutral has no row)
```sql
SELECT * FROM v_quiz_scoring_matrix;
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

## What's Still To Do

### Ready to do now
1. **Wire AI recommendations** — the agent route needs to fetch the user's `user_coffee_profile` and use it to narrow recommendations.
2. **Cupping tool API + UI** — the DB schema is ready (`coffees`, `cupping_sessions`, `session_coffees`, `cupping_scores`, `brew_params`, `archetype_assignments`). Next step is backend routes and a frontend interface for logging cupping sessions.

### When your Shopify/roastery account is ready
3. **Enable Shopify** — add 3 secrets to Secret Manager (`SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN`, `SHOPIFY_ADMIN_TOKEN`). No code changes needed.

### Optional
4. **Apple sign-in** — requires an Apple Developer account ($99/year). Low priority.
5. **Subscription management UI** — the schema and backend route exist but there's no frontend page yet.
