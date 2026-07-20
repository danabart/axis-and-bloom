# Ads & Social (workstream: ads-and-social)

Paid acquisition and organic social. Mostly **Camila's** workstream — the only code in it
is the optional lead-ad webhook (Step 11), built only if click-to-site ads miss the
$2–4 cost-per-subscriber target in September.

## Tasks

| # | Task | Owner | When | Status |
|---|---|---|---|---|
| M5 | Accept Meta portfolio invite (**expires ~Aug 16**) → create Facebook Page inside Business settings (portfolio-owned) → connect Instagram | Camila | ASAP | ⬜ |
| M4 | Ad-account payment method | Dana | before Aug 3 | ⬜ |
| M6a | Warm-up campaign ~$5/day from ~Aug 3 | Camila | Aug 3+ | ⬜ |
| M6b | Two-angle A/B at $20–40/day: "choice-overload pain" vs "find your archetype curiosity" — keep the winner | Camila | Aug | ⬜ |
| M-content | Archetype-world content: Reels (20–40s films), carousels ("the quiet why"), 3–4 posts/week rhythm; link in bio = "Find your flavor" → the quiz | Camila | after Step 01 settles the canon | ⬜ blocked by 01 |
| M10 | PR mailers / seeding: 20–30 writers & small creators, designed bag + printed archetype card + personal note (no box — the bag reveal is the story) | Camila | Sept | ⬜ |
| M-retarget | Retargeting audiences (quiz-started-not-finished) once the Pixel has data | Camila | Sept | ⬜ |
| M-assistant | Set up Camila's Claude marketing project (brand docs + plan + copy bank + voice rules loaded) | Dana | July | ⬜ see `../GAPS.md` |
| 11 | `11_E6_leadad_webhook_OPTIONAL.md` — mini-quiz inside lead ads, match delivered by email | Claude Code (Opus) | ONLY if Sept cost/subscriber > $4 | ⬜ optional |

## Brand guardrails for every ad and post

From Brand Plate v3.0 / Brand Values & Behavior v1.0 / Visual Foundations v1.0
(`misc/Brand Strategy & Visual Foundations Brief/`) and the Companion's watch-points:

- Sell **certainty, not variety**. One frame, one promise ("No more guessing in front of
  forty bags"), one tap into the quiz.
- Calm is a feature: no urgency theatrics, no countdowns, no red banners, no shouting.
  Deadlines stated once, as facts.
- Identity primary: the person recognized first, then the recommendation, then the why.
- Visual boundaries: no rustic/artisanal clichés, no barista hero imagery, no lifestyle
  collage, no decorative scripts. Color is data, not mood.
- Gift-led holiday framing, never discount-led. The Right Match Promise replaces discounts.
- Visual sources for creative: `misc/design_documents/` (logo & visual identity PDFs,
  packaging/Embalagens, package illustration) + bag label docs in `misc/`.

## Run command (only if the decision rule triggers)

**Step 11** — model: Opus
```
Read launch/README.md for context and rules, then execute the prompt in launch/50_ads-and-social/11_E6_leadad_webhook_OPTIONAL.md. Do only this step. When done, show me how each ACCEPTANCE criterion is met using Meta's webhook test tool.
```

## Verification (Step 11, if built)

- [ ] Meta webhook test lead flows end-to-end: webhook → archetype mapped → subscriber row → Mailchimp tags → journey fires
- [ ] Duplicate delivery of the same lead id does NOT double-subscribe
- [ ] Dashboard counts the subscriber under source lead_ad
- [ ] Standing trio (`../REGRESSION.md`)
