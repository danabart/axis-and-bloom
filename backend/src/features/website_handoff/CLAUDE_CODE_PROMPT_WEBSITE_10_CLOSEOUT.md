# Brief: Website 10 — close-out: order status wording (OT-96), retire About / How it works

**Workstream:** website_handoff · **Date:** 2026-11-07 · **Model tier:** cheaper/faster · **Mode:** test, then push · **Depends on:** briefs 1–9 live.

Read first: `README.md` (D14, Status), `CLOSING_REPORT_8.md` and `_9.md` (OT-93/94/96 context), `backend/src/features/commerce/README.md` (order states), `DEVELOPMENT_GUARDRAILS.md`, `CATALOG.md` (`order_fulfillment_status`, .

## Goal

Two contained fixes (the household flow is a separate workstream in its own session, Dana 2026-11-07; nothing household-related is touched here):
- **Part A, OT-96.** Customers see only facts about an order (Dana, 2026-11-04, D14): the `order_fulfillment_status.customer_label` values "Paid · being roasted" (for `awaiting_manual`, `placed`, `needs_attention`) and "Being prepared" (`pending`) become fact labels; the order confirmation page and Profile orders show them. Proposed labels (Dana may edit in the report): `awaiting_manual` → "Paid", `placed` → "Paid · sent to the roastery", `needs_attention` → "Paid", `pending` → "Paid", `shipped` "On its way" and `delivered` unchanged. These are seed rows inserted `ON CONFLICT DO NOTHING`, so Task 0 picks the existing mechanism for changing a seeded label (the `SEED_UPGRADES`-style "upgrade only while the live value still equals the previous seed" pattern used by the sommelier config, or a dated migration under `backend/src/db/migrations/`), and `comments.sql` says which.
- **Part B, retire `/about` and `/how-it-works`** (Dana, 2026-11-07): their content lives on Home and The Axis now and neither is in the menu. `/about` → 301-style client redirect to `/`, `/how-it-works` → `/the-axis` (keep the routes as redirects so old links and the sitemap keep working). Remove the links in `AdminLayout.tsx:9,11`, `TasteFinderSection.tsx:243`, `PublicLayout.tsx:22` (`footerInPage`), `prelaunch.ts:25` comment, the sitemap/robots if they list them. Then delete `About.tsx`, `HowItWorks.tsx` and, if no other page imports it any more, `TasteFinderSection.tsx` and `StripesDivider.tsx` (Task 0 greps; `Shop.tsx` is already gone). Registry image keys they used stay (G: never remove a key without confirmation; list them in OPEN_TASKS as unused).

**Guardrails.** G2.1 labels are data (Part A edits data, not code) · G2.5 `order_fulfillment_status` writer stays `seed` (the upgrade runs inside the seed step) · G2.8 idempotent, additive; a dated migration if that is the chosen mechanism · G2.17 `comments.sql` → `catalog:md` if any comment changes · G4.1 reuse · G4.3 · G4.4 · G1.6 one closing report. Mode: test. STOP points: none.

## Task 0 — verify first (findings into `CLOSING_REPORT_10.md`)

1. **OT-96.** Where `customer_label` is read (`v_order_status`, Profile orders, `CheckoutReturnPage`, Liam's `customer_orders` resolver, the paid-order email): list every surface so the new labels are checked on each. Which mechanism the repo already has for changing a seeded label; pick it and say why.
2. **About / How it works.** Every import and link into the two pages and into `TasteFinderSection` / `StripesDivider`; sitemap, robots, any email template linking them; analytics or campaign links (`/crawl`, `/ig`, `/fb` targets) that point there.

## Parts

- **A.** The label change through the mechanism Task 0 chose; the confirmation page line stays "Your order is placed." (OT-94) and the status line reads the label; tests: the four labels, the upgrade is idempotent and does not overwrite an admin-edited value.
- **B.** Redirects, link removals, file deletions, tests for the two redirects; `OPEN_TASKS.md` lists the orphaned registry keys.

## Acceptance

Test DB: a paid order shows the new label on Profile, the confirmation page and the Liam resolver (if it reads it); `/about` and `/how-it-works` redirect. Production: labels visible on Dana's own order if one exists (read-only check), the two redirects, nothing else.

## Docs and closing

`WHAT_WE_BUILT.md`, `REGRESSION.md` (fact-only order labels, redirects), `OPEN_TASKS.md` (close OT-96; add the orphaned keys), `CATALOG.md` if comments changed, `CLOSING_REPORT_10.md`.

## Do not

- Do not write any customer-facing line that promises roasting, freshness or timing (D14).
- Do not touch anything household-related (`FamilyTab`, `JoinHousehold`, `routes/household.ts`): separate workstream.
