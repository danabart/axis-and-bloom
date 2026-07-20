# Marketing Build — Claude Code Prompt Files

Run the numbered files **in order**. Each file is a complete, self-contained Claude Code prompt: open a fresh Claude Code session, tell it to read and execute the file (or paste the content). One prompt per session. Read the diff before deploying.

Source plans live in `backend/marketing/` (MARKETING_DEV_PLAN.md, PLAYBOOK, TECH_PLAN, Unit_Economics.xlsx).

## Execution order

| # | File | What | Model | Blocked by |
|---|------|------|-------|-----------|
| 01 | `01_A1_archetype_canon.md` | 5-archetype canon; Spicy & Earthy → Earthy merge; Experimental = badge | Sonnet | — |
| 02 | `02_B1_analytics_funnel_events.md` | Oct 1 date, GA4 + Meta Pixel, quiz funnel events table + endpoint | Sonnet | manual: create GA4 + Pixel IDs first |
| 03 | `03_B2_compliance_pack.md` | /privacy, /terms, consent banner, consent copy | Sonnet | 02 |
| 04 | `04_A2_quiz_soft_gate_lifecycle.md` | Soft email gate on quiz results, lifecycle-aware | **Opus/Fable** | 02 |
| 05 | `05_C1_mailchimp_sync_upgrade.md` | Archetype tags + merge fields + backfill script | Sonnet | 04 |
| 06 | `06_B3_reporting_views_admin_links.md` | SQL reporting views + read-only role + admin Marketing links row | **Opus/Fable** | 02 (funnel table exists) |
| 07 | `07_A3_share_your_match.md` | Shareable archetype pages + OG images + share button | Sonnet | 01, 04 |
| 08 | `08_D4_shopify_integration_PLACEHOLDER.md` | Real order placement (launch blocker) — **DO NOT RUN AS-IS**; finalize after roastery answers | **Fable, dedicated session** | roastery account active |
| 09 | `09_F1_feedback_loop.md` | Post-purchase feedback loop: Liam's ask (email now, SMS later) + form + taste memory + Right Match Promise flow | **Opus/Fable** | 08 (orders exist); Phase 2 needs Twilio (OT-2/3/4) |
| 10 | `10_D6_gift_the_quiz_PLACEHOLDER.md` | Digital Gift the Quiz — scope mid-Aug, build Oct | **Opus/Fable** | 08 |
| 11 | `11_E6_leadad_webhook_OPTIONAL.md` | Meta lead-ad mini-quiz webhook — ONLY if cost/subscriber > $4 in Sept | Opus | 05 |

## Manual (no-code) steps interleaved — from MARKETING_PLAYBOOK.md

- **Before 02:** create GA4 property + Meta Business Manager/ad account/Pixel (note both IDs); verify Mailchimp prod sync works (`node test-mailchimp.mjs`); authenticate email domain in Mailchimp (DKIM/SPF) + set footer mailing address.
- **After 05:** build the Mailchimp Customer Journey (trigger: tag `quiz-completed`) + the five welcome emails (drafted with Claude, edited by Camila).
- **After 06:** assemble the Looker Studio report (Cloud SQL views + GA4 + Ad Spend sheet) — dashboard must be live before the first real ad dollar.
- **Aug 8:** pricing workshop → set final price ($32–34 zone) in the admin slot-price matrix.
- **Aug 17–23:** activate roastery Shopify account → then finalize and run 08.
- **Before Step 09 Phase 2 (SMS):** Twilio infra done (OPEN_TASKS OT-2/3/4) + SMS consent checkbox live at checkout (TCPA — no marketing texts without stored consent).

## Testing

Every step is tested at three layers — see **`VERIFICATION.md`** (this folder): (1) the prompt's ACCEPTANCE section, demonstrated in-session before you accept the diff; (2) a per-step post-deploy smoke checklist (5–10 min on the live site); (3) a standing regression trio after EVERY deploy: guest quiz end-to-end, homepage lifecycle + Company Gift widgets still present, newsletter signup lands in Mailchimp. A failed check means roll back or fix-forward same day — never stack the next step on a broken one.

## Standing rules (apply to every prompt)

- New backend marketing logic lives in `backend/src/features/marketing/` (this folder); routes stay thin and import from it. Frontend changes follow the **existing** frontend structure (`frontend/src/app/components`, `hooks`, `lib`) — there is NO separate frontend marketing folder; place UI code per the project's current conventions.
- Never modify the homepage's lifecycle personalization or Company Gift redemption widgets (standing warning in CAMILAS_UPDATES.md).
- Reuse existing components/endpoints; never create a parallel code path.
- Brand: calm, no urgency theatrics, identity primary (Visual Foundations).
