# Axis & Bloom — Development Guardrails

The standing rules every change in this repo follows. Written 2026-10-31 from the decisions Dana made between 2026-07 and 2026-10 (each rule carries its date). This is the reference; `CLAUDE.md` points here.

**Who reads this and how**

- **Claude Code** (the engineer running a brief): read this file before the brief's Task 0. A brief cannot relax a rule here. If a brief and this file disagree, follow this file, say so in the closing report, and keep going.
- **Claude sessions that write briefs** (the CTO role): every brief ends its header with a **Guardrails** block that lists the rule numbers it touches (template in §9). Restate the ones that matter for the task in one line each; do not paraphrase them loosely.
- **Dana** owns the rules. Only she changes them, and a change lands here first, dated, then in the briefs.

Rule numbers are stable. Cite them as `G2.3`, never by paraphrase alone.

---

## G1. Roles and workflow

- **G1.1 Three roles** (2026-08-25). CTO session: surveys the real code first, lays out options with trade-offs, records Dana's decisions, writes the brief, reviews the result once. Claude Code: executes the brief, writes the closing report and the build-log entries. Dana: decides, runs the prompts, presses every production button. The CTO session never edits project code; it writes briefs and documentation only.
- **G1.2 Briefs live in the repo.** `backend/src/features/<workstream>/CLAUDE_CODE_PROMPT_<NAME>.md`, one folder per workstream with a `README.md` listing the brief plan. A superseded brief keeps its file under a `SUPERSEDED_` prefix. The closing report is `CLOSING_REPORT_<n>.md` in the same folder.
- **G1.3 Brief anatomy.** Header (workstream, date, model tier, test or live mode) · Goal · **Decisions already made (dated; do not re-open)** · **Guardrails** block (§9) · Task 0 verify-first, read-only, findings written before anything changes · Task 0.5 Dana's manual steps, with the pause points · Parts A… (schema, backend, frontend) · Tests · Acceptance · Docs and closing · **Do not**.
- **G1.4 Verify first** (2026-08). Task 0 reads the code and the production data (read-only) and reports what is actually there. The brief's assumptions are checked, not trusted. If Task 0 contradicts the brief, STOP and report before Part A.
- **G1.5 One run, one report** (2026-08-26). Claude Code runs the whole sequence (code → tests → commit → push → deploy → startup log → smoke) in one go and reports once at the end. No per-step "paste the results and wait" gates except at irreversible steps: production data writes, deactivations, deletions, live keys, money.
- **G1.6 Push is deploy** (2026-09-14). `deploy.yml` runs on every push to `main`. A feature or fix brief is done only when: commit → push → deploy green → startup log clean (`[data-catalog]`, integrity checks, no ERROR) → smoke of the feature → one closing report. Never leave a commit unpushed between briefs; never stack a brief on an undeployed one.
- **G1.7 Exploration briefs commit nothing** (2026-09-24). A read-only audit or investigation brief states "exploration only, nothing committed, nothing pushed" and means it, helper scripts included.
- **G1.8 No pull requests, no review step** (2026-10-04). Dana is the only developer and merges straight to `main`.
- **G1.9 One Claude Code execution at a time in the repo** (2026-10-31). Parallel sessions hand work to each other through a `HANDOFF_*.md` in the workstream folder and run one after the other. Nobody drives Dana's browser while a deploy is running on her machine.
- **G1.10 Dana does no manual ops** (2026-09-25). Never hand her a checklist of SQL, scripts or verification steps. Route them to Claude Code with explicit guardrails: which database, what may be written, STOP points where a step is irreversible. Steps only she can do (console settings, Stripe dashboard, DNS) go in `launch/00_manual-setup/MANUAL_SETUP_IDS.md` as Task 0.5, and the brief pauses there.
- **G1.11 Settled decisions stay settled, stale ones are named** (2026-10-29). A brief's "Decisions already made" block is not re-opened by a later session. A decision older than about two months, or made before the facts it rests on changed, is restated to Dana for a yes before a brief leans on it ("I'm not going blindly on what was decided two months ago").
- **G1.12 Test-suite hygiene is never a gate** (2026-08-26). Flaky tests, baseline failures and fixture cleanup go to `OPEN_TASKS.md` as their own task; they do not block a feature from shipping.
- **G1.13 Model tier.** Execution briefs run on the cheaper/faster model; briefs that touch money, security or irreversible data use the strongest model in a dedicated session, and the brief header says so.
- **G1.14 Keep it short.** Messages Dana pastes between sessions are short. Briefs are complete but not padded. Do not add process, scope or tasks beyond what was asked.

## G2. Data model (Cloud SQL is the source of truth)

- **G2.1 Nothing is hard-coded. Ever.** (2026-10-16) Names, labels, scales, thresholds, weights, mappings, stop lists, frequencies, discounts, fees, switches: all live in tables and are read at runtime. Not in code, not in view definitions, not in Firestore config. Business numbers Dana adjusts go in a parameter table (pattern: `commerce_parameter`, with a Range) and are editable in the admin portal. The frontend types in nothing either: options, numbers and labels come from the API.
- **G2.2 Surrogate `id` primary key on every table** (2026-10-17). `SERIAL` or `UUID`. A natural or composite key is a `UNIQUE` constraint beside it, never the primary key. Existing composite-key tables are retrofitted in their own brief, not opportunistically.
- **G2.3 Prefix is the domain** (2026-09-13, 2026-10-24). A table, view or enum starts with its domain: `coffee_` (catalog), `customer_`, `quiz_`, `brew_` (operational brew-preparation reference), `roastery_`, `commerce_`, `subscription_`, `sommelier_` (Liam). Views are `v_<domain>_…`. Operational brew information starts with `brew_`, not `coffee_`. A new domain gets its prefix stated in the brief.
- **G2.4 Before any new table or view, read `CATALOG.md`** (2026-10-13). The brief states which existing objects were considered and why none fits; the closing report repeats it. Dana's words: "before proposing any new table, check what already exists and say why it doesn't fit."
- **G2.5 One writer per table, and one reader path** (2026-10-16, 2026-10-31). Each table has exactly one service module that writes it, declared in the `Writer:` field of its `COMMENT ON` in `backend/src/db/comments.sql` (`seed` and `backfill:<script>` are declared alongside, as one set). `npm run lint:lineage` fails CI otherwise. Reads go through the table's view (`v_…`), which is the one read path; readers are listed in `Readers:`. Before adding a writer or a reader, check which already exist and reuse them. "We want to prevent data drifts."
- **G2.6 One door for a write** (2026-08-27). Every endpoint, cron and script that changes a fact calls the same service function (pattern: `assignCoffee`, `subscriptionService`, `checkoutService` as the one order writer). Where direct DB writes can still happen, integrity is enforced in the database (constraints, triggers), not only in code.
- **G2.7 Vocabularies are lookup tables.** A new status, kind or category set is a table with `id`, `code UNIQUE`, `label` (and `customer_label` where customers see it), seeded, and referenced by FK. No new `CHECK (… IN (…))` lists, no new free-text status columns. Existing enums (`archetype_enum`) stay until retired in their own brief.
- **G2.8 Schema is idempotent and additive.** `backend/src/db/schema.sql` runs at every boot (`CREATE TABLE IF NOT EXISTS`, `DO $$ … IF NOT EXISTS` guards for alters and renames). A brief that needs a one-off data move adds a dated script under `backend/src/db/migrations/<workstream>_<YYYY_MM_DD>.sql` and says when it ran. Seeds insert only if missing (`ON CONFLICT DO NOTHING`); a seed never `DELETE`s, an integrity check reports the drift instead.
- **G2.9 Timestamps are UTC `TIMESTAMPTZ`.** `created_at` and `updated_at` default to `timezone('utc', now())`; column comments state the unit.
- **G2.10 Raw data is never deleted** (2026-09-24). No retention purges on `api_event`, `quiz_funnel_event`, `quiz_session`, `newsletter_subscriber` or any raw record. The one exception: the anonymous-guest identity purge as decided 2026-09-24 (empty guests fully; quiz completers lose the Firebase Auth record only, every Postgres row stays). Retired Firestore stores keep their data.
- **G2.11 Reference content is retired, not deleted.** Quiz questions and answers, coffees, roasteries, slots: `is_active` / `retired_at` / lifecycle status, never a row delete. Content people have answered against (quiz questions, answers) is SCD Type 2 with a backup taken first (2026-10-08).
- **G2.12 Evidence is insert-only; the decision is a separate layer** (2026-10-16). Observations (cupping sessions per cupper, roaster remarks, portal answers, customer events) go in as written, one row per observation with its source and load time, never updated; later sessions supersede, they do not overwrite. Views reconcile them. The catalog assignment (archetype, slot) is a decision table that states its evidence basis beside each row. Nothing is built on conceptual theory or assumed weights, only on what the data supports (2026-09-26).
- **G2.13 State changes get an insert-only history** (pattern: `order_event`, `subscription_event`, `customer_*_change`): `event_kind` from a lookup, `source` (`checkout | cron | webhook | admin | customer`), `created_at`. The current-state row and its history are two tables.
- **G2.14 Facts live once.** A fact (archetype, email, status) is stored in one table and read from there; no copies in other tables or stores. Where a copy exists for a reason (the Firestore `users/{uid}` mirror), the comment names the source of truth and the sync writer.
- **G2.15 Firestore is not for facts.** Cloud SQL holds the data; Firestore holds session and chat transcripts and runtime config that a listener needs. New rules, thresholds and gate tables go in Postgres (2026-10-24), not `config/*` documents.
- **G2.16 Prices come from our pricing tables** (2026-10-29). `coffee_slot_price` / `coffee_retail_price` are the price; Stripe or any third party never holds one.
- **G2.17 The data dictionary is part of the change.** Every table, view and column created or altered gets its `COMMENT ON` line in `comments.sql` (format in that file's header: `Purpose | Class | Writer | Readers | Since`; anything unsettled starts `UNVERIFIED:`), then `npm run catalog:md -- --expect-db axisandbloom` and the regenerated `CATALOG.md` is committed. `CATALOG.md` is never edited by hand, and comment text never moves back into `WHAT_WE_BUILT_DB.md`.
- **G2.18 Integrity checks report, they never block.** Boot checks (`dataCatalogIntegrity.ts`, the customer and catalog checks) log and show on the admin System Health card. Enforcement that fails lives in CI only (`lint:*` in `deploy.yml`). There is no strict mode at boot (2026-10-16).

## G3. Backend

- **G3.1 Routes call services; services own SQL.** A route validates (zod), checks auth and ownership, calls one service function, returns. No SQL in routes, no business rule in two places.
- **G3.2 Parameterized SQL only.** Never interpolate values into SQL text. Table names in dynamic SQL come from an allow-list.
- **G3.3 Idempotent by design.** Cron endpoints are `GET`, behind `requireCronSecret`, and safe to run twice in a day. External calls carry idempotency keys (`<domain>:<id>:<cycle>`). Inserts driven by external events use `ON CONFLICT DO NOTHING` and re-select. For third-party systems the webhook is the truth; the caller only records the attempt.
- **G3.4 Cloud Scheduler jobs are created by hand** and listed with their exact `gcloud` line in `MANUAL_SETUP_IDS.md`.
- **G3.5 Observability follows `OBSERVABILITY_POLICY.md`.** Only catch what you can name in a comment; everything else propagates to the boundary handlers. Structured logger with severity; symptom-based alerting. Mutating endpoints are captured by `api_event` automatically; never add per-route logging.
- **G3.6 Security defaults.** Admin API gated server-side by the DB role; every customer read checks ownership; cost-bearing routes (Liam, AI summaries) keep their rate limits and caps; action markers from the LLM are server-verified and uid-scoped. Secrets live in Secret Manager and reach Cloud Run through `deploy.yml --set-secrets`; nothing secret in the repo or the frontend bundle. Third parties run in test/sandbox mode until Dana says "live", in a brief of its own.
- **G3.7 Pools.** `db` for requests (`application_name` `axis-bloom-backend`), `ownerPool()` for schema and comments, `script:<name>` for scripts. Nothing under `backend/scripts` writes production without a STOP in the brief.
- **G3.8 CI lints are all green before a push.** `lint:catalog`, `lint:retention`, `lint:customer`, `lint:roastery-portal`, `lint:cupping`, `lint:lineage`, `tsc --noEmit`, `vitest run`. A new lint rule is added report-only at boot and failing in CI, never failing at boot.
- **G3.9 Reuse, do not fork.** Task 0 lists the existing service functions the brief will call by name (`finalizePaidOrder`, `refreshLifecycleState`, `cartResolver`, the shared email sender). The brief says "reuse; do not fork" and Claude Code adapts the existing function (a parameter, a branch) rather than writing a parallel one.

## G4. Frontend

- **G4.1 Reuse shared components** (2026-08). Dial, card, reveal, archetype section, cart: `ArchetypeSection`, `BloomDialWidget`, `PositionCard`, `RevealedPanel`, `useCart`/`CartContext`, `FloatingCart`/`CartLines`. A page consumes them; it never re-implements a local copy. If one does not fit, add a prop or a wrapper, or flag the mismatch for a decision.
- **G4.2 Nothing typed in.** Numbers, options, labels and copy variants come from the API (rules endpoints, parameter tables). See G2.1.
- **G4.3 Type-check is separate from build.** `vite build` does not type-check. Run `npx tsc --noEmit` in `frontend/`; a change is clean when it adds no new errors beyond the known pre-existing set. Verify every user-facing page live, signed in, after deploy.
- **G4.4 Copy is positive register** (2026-07-23). Say what we do and what the customer gets. Never name what we are not doing, never introduce doubt or comparison ("test", "verdict", "exam"), no "not X, but Y". Honest state labels are fine ("Outside your comfort zone"); the apologetic follow-up is not. No urgency copy.
- **G4.5 Truth to the customer.** Partner roasteries roast and ship; Liam says so and never claims A&B roasts (2026-10-22). Customers never see a roaster name or an award name. Liam never says "explore" or "confidence" to a customer.
- **G4.6 Pre-launch curtain.** Customer pages sit behind the pre-launch gate; partner-facing pages (roastery portal) and bag QR landings do not. A brief that adds a route says which side it is on.

## G5. Tests and acceptance

- **G5.1 Every brief has Part D (vitest)** for the rules it adds: the one-writer function, idempotency (run twice, one effect), the fallback chain, the lookup seeds. Tests run against the test DB (`npm run test:db:refresh`), never production.
- **G5.2 Acceptance runs in test mode** on the local backend against the test DB, with the exact evidence listed (ids, amounts, emails) in the closing report. Production steps happen with Dana in the session.
- **G5.3 A spec's status is read from the build log and the code, never from `git status`** (2026-08-14). Brief files are routinely untracked; `grep <BRIEF_FILENAME> WHAT_WE_BUILT.md` and the actual symbol in code decide whether it shipped. Use `git diff --ignore-all-space` on this repo (CRLF noise).

## G6. Documentation every brief updates

- `WHAT_WE_BUILT.md`: one entry naming the brief file and what shipped. Liam work also in `SOMMELIER_BUILT.md`; security work in `WHAT_WE_BUILT_SECURITY.md`.
- `WHAT_WE_BUILT_DB.md`: one "As of" line for schema changes (history stays hand-written; object descriptions live in `CATALOG.md`).
- `comments.sql` → `npm run catalog:md` → `CATALOG.md` committed (G2.17).
- `OPEN_TASKS.md`: what was deliberately left for a later brief.
- `REGRESSION.md`: the behaviours this brief makes true that must keep working.
- `MANUAL_SETUP_IDS.md`: any console, scheduler or webhook setting touched.
- `CLOSING_REPORT_<n>.md` in the workstream folder: Task 0 findings, what was built, evidence from acceptance, deviations from the brief and why, what the next brief needs.

## G7. Things we do not do

- Do not delete raw data, rows of reference content, or a writer's code to satisfy a lint; retire, declare, or fix, and say so.
- Do not fix a multi-writer table silently; list it.
- Do not put a rule, threshold or mapping in code, a view body or Firestore config.
- Do not add a table or view without the `CATALOG.md` check written down.
- Do not create a composite or natural primary key.
- Do not leave a commit unpushed, or push from an exploration brief.
- Do not open a PR, add a review step, or hand Dana manual steps.
- Do not re-implement a shared component locally.
- Do not write customer copy that names what we are not doing.
- Do not go live with a third party (keys, bank, charges) outside a brief that says "live" in its header.

## G8. How a CTO session uses this file

1. Survey the code and `CATALOG.md` before proposing anything.
2. Present options with trade-offs, cost, reversibility; get Dana's decision; date it in the brief.
3. Write the brief in the G1.3 shape, with the Guardrails block below filled in.
4. Review once, after Claude Code's closing report; batch follow-ups into one message.
5. When Dana states a new standing rule, add it here first (numbered, dated), then cite it in briefs.

## G9. Guardrails block (paste into every brief header)

```
**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (parameters: <table>) · G2.2 surrogate id PK · G2.3 prefix <domain>_ ·
G2.4 CATALOG.md checked (why nothing fits: <one line>) · G2.5 one writer (<module>), reads via v_<…> ·
G2.17 comments.sql → catalog:md · G3.3 idempotent · G1.6 push is deploy, one closing report.
Mode: <test | live>. STOP points: <list, or "none">.
```

Drop the lines that do not apply; add any other rule number the task touches.
