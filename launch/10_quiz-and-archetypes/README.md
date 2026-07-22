# Quiz & Archetypes (workstream: quiz-and-archetypes)

The quiz is the product's front door and the marketing engine's fuel. This workstream owns
the archetype taxonomy, the results-screen email capture, and the shareable archetype pages.

## Tasks

| Global step | File | What | Model | Depends on | Status |
|---|---|---|---|---|---|
| 01 | `01_A1_archetype_canon.md` | 5-archetype canon; Spicy & Earthy → Earthy merge; Experimental = category (visuals untouched) | Sonnet | — | ▶ v2 ready — first run was reverted; this rewrite is audit-first with hard boundaries |
| 04 | `04_A2_quiz_firm_gate_lifecycle.md` | **FIRM** email gate on results (revised 2026-07-18: free reveal, no skip link, why+coffees email-only), lifecycle-aware (Remember, Never Reset) | Opus/Fable | Step 02 | ⚠ deployed 2026-07-20 but DEVIATED — shipped as a hard gate (card before the reveal) + inverted card typography; run 04b |
| 04b | `04b_FIX_firm_gate_reveal_order.md` | FIX for the 04 deviation: reveal renders free BEFORE the card; post-submit unlock shows full why + coffees in place; card headline/sub swapped back | Opus/Fable | Step 04 deployed | ✅ run + verified 2026-07-20 (gate order confirmed live) |
| 04c | `04c_COPY_gate_card_text.md` | Copy polish (Dana-approved): sub-line → "See why this is you — and meet the coffees chosen for your taste. First access when doors open October 1." · button → "SHOW ME WHY" | Sonnet | 04b deployed | ▶ ready |
| 07 | `07_A3_share_your_match.md` | 5 public share pages + OG images + share row | Sonnet | Steps 01 + 04 deployed (hard); date is flexible — anytime after | ✅ deployed + crawler-verified 2026-07-20 (all 5 pages: OG tags, bucket images, quiz CTA, public without ?preview, no personal data). Dana's remaining checks: real WhatsApp/iMessage unfurl · share row (mobile sheet / desktop copy) · share_match in GA4 · trio. Note: Earthy og:image path is legacy `spicy-earthy/hero.webp` — cosmetic, asset key kept from the merge |

Step 01 also **gates marketing content**: Camila's archetype-world films/posts can't start
until the canon is settled (companion doc flagged the six-vs-five confusion explicitly).

## Run commands

**Step 01** — model: Sonnet
```
Read launch/README.md for context and rules, then execute the prompt in launch/10_quiz-and-archetypes/01_A1_archetype_canon.md exactly as written. Do only this step — do not start any other numbered step. When done, show me how each ACCEPTANCE criterion is met.
```

**Step 04** — model: Opus or Fable
```
Read launch/README.md for context and rules, then execute the prompt in launch/10_quiz-and-archetypes/04_A2_quiz_firm_gate_lifecycle.md exactly as written. Do only this step. Before writing code, locate and explain the existing lifecycle mechanism you will reuse. When done, show me how each ACCEPTANCE criterion is met, including the homepage widgets still being intact.
```

**Step 04b (fix)** — model: Opus or Fable
```
Read launch/README.md for context and rules, then execute the prompt in launch/10_quiz-and-archetypes/04b_FIX_firm_gate_reveal_order.md exactly as written. Do only this fix. Before accepting the diff, demonstrate every ACCEPTANCE criterion one by one — the original step 04 session claimed a free reveal it did not deliver.
```

**Step 04c (copy)** — model: Sonnet
```
Read launch/README.md for context and rules, then execute the prompt in launch/10_quiz-and-archetypes/04c_COPY_gate_card_text.md exactly as written. Do only this copy change — two strings, nothing else. When done, show me how each ACCEPTANCE criterion is met, including the grep proving the old strings are gone.
```

**Step 07** — model: Sonnet — early September
```
Read launch/README.md for context and rules, then execute the prompt in launch/10_quiz-and-archetypes/07_A3_share_your_match.md exactly as written. Do only this step. When done, show me how each ACCEPTANCE criterion is met.
```

## Post-deploy verification

**Step 01 — archetype canon**
- [ ] Quiz answers that previously produced "Spicy & Earthy" → result shows **Earthy** with its world/wallpaper/bag
- [ ] A run tripping the experimental gate (Q3-C) renders **exactly as before** — nothing visually removed
- [ ] No enumeration/list/picker/count anywhere shows Experimental as a 6th archetype; no copy says "six archetypes"
- [ ] Standing trio (`../REGRESSION.md`)

**Step 04 — firm gate**
- [ ] Guest: quiz → free reveal → email card → submit → "why" + coffees unlock immediately on screen
- [ ] `SELECT email, archetype, confidence FROM newsletter_subscriber ORDER BY created_at DESC LIMIT 5;` → row with archetype + source post_quiz
- [ ] **No bypass exists**: first-time guest cannot reach the why/coffees any way except submitting an email (no skip link; check scroll, URL, refresh)
- [ ] Same browser, retake → no card; "your match is on its way to <masked email>" line instead; sections unlock automatically
- [ ] Signed-in user: no card; lifecycle stage moved to a QUIZ_TAKEN_* state (check user_lifecycle_state)
- [ ] GA4 + quiz_funnel_event show email_submitted
- [ ] Standing trio — **especially the homepage widgets** (this step touches lifecycle)

**Step 07 — share-your-match**
- [ ] Each of the 5 links unfurls (image + title) in WhatsApp/iMessage
- [ ] Share button: native sheet on mobile, copy-link on desktop
- [ ] share_match event in GA4; no personal data on share pages; CTA leads into the quiz
- [ ] Standing trio
