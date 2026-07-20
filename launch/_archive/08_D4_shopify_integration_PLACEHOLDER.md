# Step 08 (D4) — Shopify drop-ship integration ⚠ PLACEHOLDER — DO NOT RUN AS-IS

> Order: 8 of 10 · Model: **Fable — strongest available, dedicated session, no exceptions** (touches payments; a lost paid order costs more than any tokens) · Depends on: roastery account activated (Aug 17–23) + roastery answers from Dana's calls · Target: Aug 24 – Sep 6 · **This is the launch blocker.**

## Why this is a placeholder

`createOrder()` in shopify.ts currently throws (stubbed). The real prompt cannot be written until Dana's roastery calls answer: the exact drop-ship order API/flow for Temecula and PATH, how the personalized label data is handed off (who prints it), PATH's multi-bag consolidation rules, and SLAs. Finalize this file in a dedicated session with those answers, then run it.

## Scope the final prompt must cover

1. Replace stubbed `createOrder()` with real order placement against the roastery account(s).
2. **Per-roastery routing:** each line item's coffee belongs to Temecula or PATH — route accordingly; a mixed order becomes two fulfillment orders (note: two shipments; pricing already accounts for this per Unit_Economics.xlsx warning).
3. Personalized label/archetype data handoff per the roastery's mechanism (order note, line-item property, or separate channel — per D1 answers).
4. Failure handling that NEVER loses a paid order: retries with idempotency keys, a persisted failed-order queue with admin visibility, alerting (Resend email to admin) on placement failure. The customer's payment state and the fulfillment state must never silently diverge.
5. Fire the Purchase analytics event (stubbed call site from Step 02) on confirmed order.
6. End-to-end staging test, then the paid dry run (Sep 14–20): real order → roastery ships → arrives → photograph.

## Standing constraints

Backend logic in backend/src/features/marketing/ or the existing shopify.ts module (whichever the codebase's conventions favor — order placement may belong with existing commerce code, not marketing); do not touch homepage widgets; requireAuth on checkout stays.
