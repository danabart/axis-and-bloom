# Axis & Bloom — Launch & Marketing Plan (Oct 1, 2026)

Reorganized 2026-07-18. This folder replaces the flat file list that previously lived in
`backend/src/features/marketing/` (originals preserved untouched in `_archive/`).
**This folder is the single source of truth for the launch.** Commit it to git immediately —
the previous folder was once wiped by a `git clean` because it was untracked.

## What changed in the reorg

- Tasks are grouped into **independent workstream folders** — each folder is the logical
  container for one area of work and holds its Claude Code prompts, its manual tasks, its
  run commands, and its verification checklists.
- **Execution order is global**, not per-folder: every Claude Code prompt keeps its global
  step number (01–11) in its filename and header. `TIMELINE.md` is the ordering authority.
- The old RUN_COMMANDS.md had drifted (its "Step 09/10" pointed at the wrong files and the
  real Step 09 had no command at all). Corrected commands now live in each workstream README.
- Manual setup (GA4 / Meta / Mailchimp) is **DONE** as of 2026-07-17 — see `00_manual-setup/`.
- `GAPS.md` lists everything the plan does *not* yet cover, with proposed owners.

## Folder map

| Folder | Contains | Claude Code steps |
|---|---|---|
| `00_manual-setup/` | Account/ID record (done) + remaining browser tasks | — |
| `05_site-readiness/` | Standalone site fixes before paid mobile traffic (mobile nav, homepage weight) | FIX-01, FIX-02 |
| `10_quiz-and-archetypes/` | Archetype canon, results-screen soft gate, share pages | 01, 04, 07 |
| `20_analytics-and-tracking/` | GA4 + Pixel wiring, funnel events, reporting views, Looker | 02, 06 |
| `30_compliance/` | Privacy, terms, consent banner | 03 |
| `40_email-marketing/` | Mailchimp sync upgrade, welcome emails, customer journey | 05 |
| `50_ads-and-social/` | Paid ads prep, creative, social accounts, lead-ad fallback | 11 (optional) |
| `60_commerce-and-fulfillment/` | Payment capture + Shopify/roastery ordering — **the launch blocker** | 08, 12 |
| `70_feedback-loop/` | Post-purchase ask from Liam, taste memory, Right Match Promise | 09 |
| `80_gifting/` | Gift the Quiz (digital-only, Nov 1) | 10 |
| `_source-plans/` | Recovered planning docs (TECH_PLAN, PLAYBOOK, Unit_Economics, Companion) | — |
| `_archive/` | The original flat files, verbatim | — |

Root docs: `TIMELINE.md` (when + in what order), `GAPS.md` (what's missing),
`REGRESSION.md` (the standing post-deploy trio).

## How to run a Claude Code step

One step per session, in global numeric order, models per each prompt's header.
Open a terminal in `C:\Users\DanaB\axis-and-bloom`, run `claude`, set the model (`/model`),
then paste the run command from the step's workstream README. Every run command follows
this template:

```
Read launch/README.md for context and rules, then execute the prompt in
launch/<workstream>/<step file> exactly as written. Do only this step — do not start any
other numbered step. When done, show me how each ACCEPTANCE criterion is met.
```

Read the diff before deploying. After each deploy: run the step's verification checklist
(in its workstream README) plus the standing trio in `REGRESSION.md`. A failed check means
roll back or fix-forward the same day — never stack the next step on a broken one.

## Standing rules (apply to every prompt, unchanged from the original plan)

- New **backend** marketing logic lives in `backend/src/features/marketing/` (that path is
  now code-only; the plan lives here in `launch/`). Routes stay thin and import from it.
- **Frontend** changes follow the existing structure (`frontend/src/app/components`,
  `hooks`, `lib`) — there is NO separate frontend marketing folder.
- Never modify the homepage's lifecycle personalization or Company Gift redemption widgets
  (standing warning at the top of `CAMILAS_UPDATES.md` — this has broken twice).
- Reuse existing components/endpoints; never create a parallel code path.
- Brand: calm, no urgency theatrics, identity primary. Source docs:
  `misc/Brand Strategy & Visual Foundations Brief/` (Brand Plate, Values & Behavior,
  Visual Foundations) and `misc/design_documents/` (logo, packaging, visual identity PDFs).

## Status at a glance (2026-07-18)

- ✅ Manual setup (GA4 `G-GYC50VYRYN`, Pixel `945138695260153`, Mailchimp verified + DKIM)
- ⬜ Step 01 (archetype canon v2) — rewritten after the reverted first run; **ready to run, not run**
- ⬜ Steps 02–07 — not run
- ⚠️ Step 08 — placeholder; blocked on roastery activation (Aug 17–23)
- ⬜ Steps 09–10 — October builds; 11 — only if cost/subscriber > $4
- ⚠️ Step 12 (payment capture) — rails **DECIDED: Stripe on our site** (2026-07-18);
  12a finalization can run any time; builds before 08b
- ⬜ FIX-01 (mobile nav) + FIX-02 (homepage weight) — ready to run now; live before Aug 3 ads
- ✅ Source planning docs recovered into `_source-plans/`; Camila's strategy PDF restored
  to its misc folder (only MARKETING_DEV_PLAN.md unaccounted — TECH_PLAN is authoritative)
