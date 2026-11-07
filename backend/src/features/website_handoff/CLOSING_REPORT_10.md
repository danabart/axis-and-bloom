# Closing report — Website 10: close-out (OT-96 labels, About / How it works retired)

Brief: `CLAUDE_CODE_PROMPT_WEBSITE_10_CLOSEOUT.md` · Date: 2026-11-07 · Mode: test, then push.

## Task 0 — findings (written before any change)

### 1. OT-96: where `order_fulfillment_status.customer_label` reaches a customer

The label reaches the customer only through `v_order_status.customer_label` (`schema.sql` ~L9455: the payment label when the payment is not plain `paid`, else the fulfillment label).

| Surface | Reads | Shows the label today? |
|---|---|---|
| Profile → Orders | `routes/users.ts:107` (`s.customer_label` → `status`, L213) → `Profile.tsx:718` `{order.status}` | Yes, verbatim |
| `GET /api/orders` | `routes/orders.ts:32` | Yes (API field) |
| `/checkout/return` | `checkoutService.getSessionStatus` already returns `order.customerLabel` | **No**: the page renders the order-placed line, lines, total, ships-to; the label is fetched but unused |
| Liam `customer_orders` resolver | `sommelierGate.ts:296` → `customerReads.getRecentOrders` | No: selects what was ordered and when only (Rev 2, by design); no status word |
| Paid-order email | `orderEmails.renderOrderConfirmationEmail` | No label; its own typed headline "Your coffee is on its way to being roasted." (finding below) |
| Admin orders | `commerceAdminReads` | Reads `label` / `payment_customer_label`, not the fulfillment customer label |

**Mechanism.** The labels are seed rows in `schema.sql` (`INSERT … ON CONFLICT (code) DO NOTHING`), which runs at every boot. The repo's pattern for changing a seeded value is `SEED_UPGRADES` (sommelier config): upgrade only while the live value still equals the previous seed, so an edited value is never overwritten. Chosen: the same rule in SQL, inside the seed step, right after the INSERT: `UPDATE order_fulfillment_status … WHERE code = v.code AND customer_label = v.previous`. Why not a dated migration: migrations here are run by hand once; the seed-step upgrade reaches the test DB and prod by itself at boot, is idempotent (second run matches no row), keeps the writer `seed` (G2.5) and needs no extra ops step (G1.10). The INSERT's own values change too, so a fresh database seeds the new labels directly. There is no admin editor for `customer_label` (`commerceAdminReads` lists code + label only), so "admin-edited" means any hand-changed value; the guard covers it.

**Adjacent finding (not in this brief's scope, OT-99):** the paid-order email headline (`orderEmails.ts:39`, `:78`) "your coffee is on its way to being roasted." is typed copy, and the generated order-placed beat (Liam's line, which leads `/checkout/return` when it exists) is model text. Both are the other half of the old OT-96 wording; they are copy/prompt decisions for Dana, listed as OT-99, not changed here (brief: labels only; "Do not write any customer-facing line that promises roasting").

### 2. About / How it works: every link and import

- Routes: `App.tsx:9,11` (imports), `:194` `/how-it-works`, `:198` `/about` (both inside `PrelaunchGate`).
- Links: `AdminLayout.tsx:9,11` (`NAV_UNLISTED`), `TasteFinderSection.tsx:243` (`/about`). `PublicLayout.tsx:22` `footerInPage = pathname === '/about'`. `prelaunch.ts:25` comment.
- `TasteFinderSection` is imported only by `About.tsx` and `HowItWorks.tsx`; `StripesDivider` is imported by nothing. All four files go.
- Sitemap: none exists (no `sitemap.xml`, nothing generates one). `robots.txt` lists only `/roastery/`. Nothing to change.
- Emails, backend templates: no link to `/about` or `/how-it-works` (grep of `backend/src`).
- Short links / campaigns: `/ig`, `/fb` → `/find-my-flavor`; `/crawl` is its own page. None points at the two pages.
- Asset keys used only by the retired pages (stay in the registry, listed in OPEN_TASKS): `videoAssets.aboutHero`, `videoAssets.aboutSecondary`; the six `design/IMAGES/bags/bag-{balanced,chocolate,experimental,floral,fruity,spicy}.svg` (imported `?raw` only by `TasteFinderSection`). `lifestyleAssets.coffee` / `.family` and `patternAssets` are still used elsewhere.
- Household files (`FamilyTab`, `JoinHousehold`, `routes/household.ts`) are not touched by any of the above.

Task 0 does not contradict the brief. Proceeding to Part A.
