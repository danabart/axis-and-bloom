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

## Database Schema (38 Tables)

The schema lives in `backend/src/db/schema.sql` and runs automatically on every backend startup (`CREATE TABLE IF NOT EXISTS` — fully idempotent, safe to run repeatedly).

It was merged from your original Supabase design plus adaptations for Firebase Auth (Firebase UID used as the user identifier instead of Supabase's auth.users).

### Table groups

**Lookup / reference**
- `user_type` — subscriber, admin, roaster partner, etc.
- `dimension` — flavor dimensions (acidity, body, roast level, etc.)
- `archetype` — named flavor profiles (e.g. "The Bright Fruit Lover")
- `roaster` — drop-ship roastery partners
- `quiz` — quiz versions
- `cupping_note` — flavor wheel descriptors

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
- `dimension_scoring_rule` — valid score ranges per dimension
- `user_vector_state` — where each user sits in flavor-dimension space (declared + behavioral)
- `user_archetype_tuning` — user's personal adjustments to their archetype
- `user_coffee_profile` — their ranked archetype matches

**Blends / roastery**
- `blend` — coffee blends available for purchase; links to Shopify variant IDs
- `blend_vector` — where each blend sits in flavor-dimension space
- `user_roaster_link` — roastery staff accounts
- `cupping_session` — QC cupping records
- `cupping_session_note` — notes on each cupping session
- `cupping_session_vector` — dimension scores from a cupping session

**Quiz**
- `question`
- `answer` — branching logic via `next_question_id`, vector impact stored as JSONB
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

---

## API Endpoints

| Method | Path | Auth required | Description |
|---|---|---|---|
| GET | `/health` | No | Returns `{"status":"ok"}` |
| GET | `/health/db` | No | Returns connected status + all table names |
| POST | `/api/auth/sync` | Yes | Creates/updates user_profile row after Firebase sign-in |
| POST | `/api/auth/reset-password` | No | Sends branded password-reset email via Resend from axisandbloomcoffee.com |
| GET | `/api/quiz/questions` | No | Returns active quiz questions + answers from DB (with archetype names) |
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

## Current State (as of 2026-05-24)

| Component | Status |
|---|---|
| Frontend deployed | ✅ https://axis-and-bloom-prod.web.app |
| Backend deployed | ✅ https://axis-bloom-backend-oiub7eumya-uc.a.run.app |
| Database connected | ✅ 38 tables verified via /health/db |
| Email/password auth | ✅ Working |
| Google sign-in | ✅ Working (was already enabled) |
| Apple sign-in | ⚠️ Not configured |
| Flavor quiz (V2) | ✅ 4 questions, 3 archetypes — fully DB-driven (questions served from API, not hardcoded) |
| Transactional email | ✅ Resend — sends from noreply@axisandbloomcoffee.com |
| Claude AI chat | ✅ Wired up, API key in Secret Manager |
| Shopify | ⚠️ Stubbed — waiting for roastery account |
| CI/CD | ✅ Push to main deploys everything |

---

## Flavor Quiz (V2)

The quiz lives in `frontend/src/app/components/FlavorQuiz.tsx`. V2 (from `Quiz V2.xlsx`) replaced the original 15-question, 6-archetype system with a focused 4-question, 3-archetype design. **Questions and answers are no longer hardcoded** — they are seeded into the database and fetched at runtime via `GET /api/quiz/questions`.

### Questions

| # | Category | Question |
|---|---|---|
| 1 | Identity | How would you describe your relationship with coffee? |
| 2 | Food instinct | Someone puts something in front of you as a treat. Which do you reach for? |
| 3 | Black coffee reaction | You try a new coffee black. What's your first reaction? |
| 4 | Disappointment | Which coffee would disappoint you the most? |

### Archetypes

| Archetype | Color | Personality |
|---|---|---|
| **Chocolate & Nutty** | `#a54c2d` | Daily ritual drinker — bold, rich, comforting, particular |
| **Balanced & Sweet** | `#d1ac11` | Reliable habit — smooth, easy, approachable |
| **Fruity & Complex** | `#ca445f` | Curious discoverer — bright, lively, complex |

### Scoring logic

- Each answer = **+1 vote** for one archetype
- Q3 option D ("I'm not sure") is **neutral** — no vote awarded
- Most votes at the end wins
- **Tie-break order**: Balanced > Chocolate > Fruity

### How the frontend fetches questions

```
mount → GET /api/quiz/questions
     ← { quizId, questions: [{ q_number, q_text, answers: [{ id, text, archetype_name }] }] }
```

The frontend maps `archetype_name` (`'Chocolate & Nutty'` etc.) to a short display key using a local lookup table. Question images are still managed in the frontend (keyed by `q_number`) since images aren't stored in the DB.

### On completion

If the user is signed in, the quiz calls `POST /api/quiz/results` with `{ archetype: 'Chocolate & Nutty', scores, answers, decaf: false }`. The backend resolves the archetype name to its UUID and saves the session to `quiz_session` with the real FK. The result is also returned immediately so the results screen can display it.

---

## What's Still To Do

### Ready to do now
1. **Wire AI recommendations** — the agent route needs to fetch the user's `user_coffee_profile` and use it to narrow recommendations.

### When your Shopify/roastery account is ready
4. **Enable Shopify** — add 3 secrets to Secret Manager (`SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN`, `SHOPIFY_ADMIN_TOKEN`). No code changes needed.

### Optional
5. **Apple sign-in** — requires an Apple Developer account ($99/year). Low priority.
6. **Subscription management UI** — the schema and backend route exist but there's no frontend page yet.
7. **Cupping session tool** — for your roastery partner to log QC data on blends.
