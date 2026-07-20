# Step 12 (G1) — Payment capture ⚠ PLACEHOLDER — decide rails first, build BEFORE 08b

> Global step 12 of 12 · Workstream: commerce-and-fulfillment · Model: **Fable, dedicated session** (touches money) · Added 2026-07-18 (GAPS.md #4) · **Numbering note: 12 is an identity, not a position — this executes BEFORE step 08b.** `TIMELINE.md` is the ordering authority.

## Why this exists

The plan covered *placing orders with roasteries* (step 08) but never *taking the
customer's money*. Today: `POST /api/orders` requires auth and calls a stubbed
`createOrder()`; Stripe is unconfigured (OPEN_TASKS OT-9 — currently scoped to token
purchases only); there is no cart→pay→confirmation flow. The TECH_PLAN's own hard review
called this "the single biggest risk in the whole program." Everything downstream hangs
on it: the launch offer, gift SKUs (step 10), OT-14's placeholder link, the subscription
question, and the Sep 14–20 paid dry run.

## Payment rails — ✅ DECIDED (Dana, 2026-07-18): option 1, Stripe on our own site

Roasteries stay fulfillment-only; step 08 places roastery orders after Stripe confirms
payment. **Clarified 2026-07-18: the roasteries' own tooling may still involve Shopify —
invisibly.** Temecula's TCR app lives inside a Shopify store (their requirement), so step
08 will likely talk to a headless bridge Shopify store we own via the Admin API; PATH
automates via ShipStation (API-friendly, no Shopify). None of this touches the customer:
Stripe is the only checkout the customer ever sees. Details + the make-or-break roastery
questions: this folder's README, "Integration architecture" section. The prompt can now
be finalized (run command 12a) — final prices land Aug 8. The options considered:

1. **Stripe on our own site (CHOSEN).** Checkout stays fully in the brand
   experience (quiz → match → pay without leaving); roasteries remain fulfillment-only
   via step 08's drop-ship integration; Stripe Payment Intents + webhooks; supports
   future subscriptions (Stripe Billing) and gift SKUs naturally. This is also the
   TECH_PLAN §8.1 fallback if the roastery account slips — making it primary removes
   that whole risk class. Cost: ~2.9% + 30¢.
2. **Roastery Shopify checkout.** Hand the customer to Shopify's hosted checkout.
   Less build, but breaks the brand experience mid-flow, complicates two-roastery
   orders (whose checkout?), personalized-label data handoff, and makes subscriptions/
   gift SKUs dependent on someone else's store. Only viable if the roastery answers
   (M9) reveal it's effectively required.
3. **Hybrid** — Stripe takes the money; step 08 places roastery orders after payment
   confirmation. (This is what option 1 means in practice; listed separately to make
   explicit that payment capture and fulfillment are two systems joined by the order
   record.)

## Scope the finalized prompt must cover (Stripe, per the decision)

1. Stripe account + keys in GCP Secret Manager + `deploy.yml --set-secrets`; test/live mode split.
2. Cart → checkout flow reusing the existing cart context and design system (no parallel
   cart; the shared CartContext shipped in Bloom Part 10). Calm, minimal, no upsell noise.
3. `POST /api/orders` upgraded: create Payment Intent → confirm → persist the order (on
   the normalized `"order"` table — OT-7 migration is a precondition, see workstream
   README) → then hand off to step 08's `createOrder()` for roastery placement.
4. Webhook handling (payment_intent.succeeded / failed) with idempotency; the payment
   state and fulfillment state must never silently diverge (same invariant as step 08).
5. **Customer transactional emails via Resend: order confirmation (immediately) and
   shipping notification (when the roastery ships)** — the audience is mistake-averse;
   silence after paying is the worst possible experience (GAPS.md #12).
6. Purchase analytics event (the step-02 stub) fires on confirmed payment.
7. Prices read from the admin slot-price matrix (final numbers from the Aug 8 workshop);
   Right Match Promise line item logic NOT here (that's step 09's redemption flow).
8. Refund path: admin-triggered refund that keeps order + payment state consistent.
9. ACCEPTANCE: staging end-to-end with Stripe test cards — success, decline, webhook
   replay, refund; then one real $1-level live-mode transaction before the Sep dry run.

## Standing constraints

Backend logic in `backend/src/features/marketing/` or existing commerce modules per
codebase convention; requireAuth stays on checkout; never lose a paid order; no homepage
modifications; brand: no urgency theatrics anywhere in checkout.
