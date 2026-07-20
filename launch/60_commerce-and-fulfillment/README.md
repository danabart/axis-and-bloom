# Commerce & Fulfillment (workstream: commerce-and-fulfillment)

Taking the customer's money AND placing real orders with the roasteries. **This is the
launch blocker** — checkout is stubbed today (`createOrder()` throws; OPEN_TASKS OT-6)
and payment capture had no task at all until 2026-07-18 (now step 12). Two systems,
joined by the order record: step 12 takes the money, step 08 fulfills.

## Tasks

| # | Task | Owner | When | Status |
|---|---|---|---|---|
| D-rails | Payment rails decision | Dana | — | ✅ **DECIDED 2026-07-18: Stripe on our own site** (roasteries stay fulfillment-only; step 08 places orders after Stripe confirms payment) |
| 12 | `12_G1_payment_capture_PLACEHOLDER.md` — Stripe checkout, order persistence, webhooks, customer order/shipping emails, Purchase event (numbering note: runs BEFORE 08b) | Claude Code (Fable, dedicated) | Aug 17–30 | ⚠ placeholder |
| M9 | Activate roastery Shopify account + get roastery answers: exact drop-ship order API/flow (Temecula, PATH), archetype-label handoff (per-SKU designs, who prints), PATH multi-bag consolidation, SLAs | Dana | Aug 17–23 | ⬜ |
| 08a | Finalize `08_D4_shopify_integration_PLACEHOLDER.md` into an executable prompt (no code yet) | Claude Code (Fable, dedicated) | after M9 | ⚠ placeholder |
| 08b | Execute the finalized prompt — staging only until Dana confirms | Claude Code (Fable, fresh dedicated session) | Aug 24 – Sep 6 | ⬜ |
| pre-08 | **Fold in OT-7**: migrate the order write path from the legacy `orders` table to the normalized `"order"` table BEFORE going live (feedback loop + notification FKs depend on it; step 12 writes to it) — see `../GAPS.md` | Claude Code | with/before 12 | ⬜ |
| M11 | Paid dry run: real order, real money, bag arrives correctly labeled — photograph it | Dana | Sep 14–20 | ⬜ |

Cost facts (memory of Unit_Economics): Temecula unified $14–17/bag incl. shipping; PATH
~$19 landed est.; blended ~$17.25 @50/50 → at $34 price: ~38% contribution. Cross-roastery
two-bag orders = two shipments (pricing already accounts for it). Track COGS per blend;
**never bias matching by margin.**

## Integration architecture (researched from the roasteries' sites, 2026-07-18)

**The customer NEVER sees Shopify.** Stripe on our site takes the money (step 12); any
Shopify involvement is invisible backend plumbing. What their public docs say:

- **Temecula (TCR):** per their FAQ and Dana's prior contact with them, **WE create our
  own Shopify store**, and Temecula installs their proprietary, invite-only **TCR App**
  into it. Their systems watch our store for paid orders and fulfill them — SKU-based,
  label designs uploaded per product, no minimums, all-in drop-ship price, tracking
  pushed back into the store.
  → Planned pattern: that store is a **headless bridge** (password-protected, no public
  theme, never customer-facing, never linked anywhere; ~$39/mo Basic). After Stripe
  confirms payment on our site, our backend creates the order in our bridge store via
  the Shopify Admin API, marked paid; the TCR app fulfills from there and we read
  tracking back via webhook/API.
- **PATH:** no Shopify app — their program runs order automation through **ShipStation**
  (third-party listings say: products added manually, orders automated via ShipStation).
  ShipStation has a full REST API and "custom store" integrations, so our backend can
  likely push PATH orders directly — **no Shopify involved at all** on the PATH side.

**Make-or-break questions for the M9 roastery calls (now the top of the list):**
1. **Temecula:** does the TCR app fulfill orders created *via the Shopify Admin API*
   (draft order → mark paid), not through Shopify's checkout? If it only triggers on
   checkout orders, the bridge pattern needs their confirmation of a workaround.
2. **Labels (both, simplified 2026-07-18):** bags carry the **archetype design only — no
   customer name, no per-order personalization** (Dana). So Temecula's per-SKU
   pre-uploaded label model fits natively: one SKU per archetype/blend with its label on
   file. Remaining questions are ordinary onboarding: label spec/dielines and print
   quality (see `misc/` bag-label docs), who prints (they do), and the SKU↔blend mapping.
3. **PATH:** exact ShipStation setup — do we push orders via the ShipStation API / a
   custom-store connection, or do they pull from somewhere? Who owns the ShipStation
   account? Same label-spec/who-prints question.
4. Both: how tracking numbers come back to us (webhook, API poll, email), and
   invoicing/billing cadence for the drop-ship cost.

## Run commands

**Step 12a (finalize the payment prompt)** — model: Fable, dedicated session — can run any time now (rails decided); final prices arrive Aug 8
```
Read launch/60_commerce-and-fulfillment/12_G1_payment_capture_PLACEHOLDER.md and the launch plan context in launch/README.md. The payment rails decision is: Stripe on our own site — roasteries are fulfillment-only; step 08 places roastery orders after Stripe confirms payment. Rewrite 12 as a complete, executable prompt covering every item in its Scope section, including the OT-7 order-table migration as a precondition. Do not write any application code yet — only produce the finalized prompt file.
```

**Step 12b (execute)** — model: Fable, fresh dedicated session
```
Read launch/README.md for context and rules, then execute the finalized prompt in launch/60_commerce-and-fulfillment/12_G1_payment_capture_PLACEHOLDER.md exactly as written. Do only this step. This touches money: test with Stripe test cards in staging only — do not enable live mode until I confirm. When done, walk me through every failure path and how each ACCEPTANCE criterion is met.
```

**Step 08a (finalize the prompt)** — model: Fable, dedicated session
```
Read launch/60_commerce-and-fulfillment/08_D4_shopify_integration_PLACEHOLDER.md and the launch plan context in launch/README.md. Here are the roastery answers: <PASTE ANSWERS: order flow, label handoff, consolidation, SLAs>. Rewrite 08 as a complete, executable prompt covering every item in its Scope section. Do not write any application code yet — only produce the finalized prompt file.
```

**Step 08b (execute)** — model: Fable, fresh dedicated session
```
Read launch/README.md for context and rules, then execute the finalized prompt in launch/60_commerce-and-fulfillment/08_D4_shopify_integration_PLACEHOLDER.md exactly as written. Do only this step. This touches payments: never lose a paid order. Test in staging only — do not enable production ordering until I confirm. When done, walk me through every failure path and how each ACCEPTANCE criterion is met.
```

## Post-deploy verification (staging first, then production)

- [ ] Staging test order reaches the roastery sandbox with correct items, address, label data
- [ ] Mixed-roastery order → two fulfillment orders created correctly
- [ ] Simulated failure (bad SKU / roastery API down) → failed queue + admin alert email + payment state stays consistent
- [ ] Purchase event fires in GA4 + Pixel
- [ ] **The real test: the Sep 14–20 paid dry run** — real money → bag arrives at a real door, correctly labeled → photograph
- [ ] Standing trio (`../REGRESSION.md`)
