# Compliance (workstream: compliance)

Privacy policy, terms, cookie/consent banner, and consent copy at email capture points.
Required before strangers arrive from paid ads. Brand constraint: the banner must be calm —
two choices, no dark patterns, guides-not-dominates (Visual Foundations).

## Tasks

| Global step | File | What | Model | Depends on | Status |
|---|---|---|---|---|---|
| 03 | `03_B2_compliance_pack.md` | /privacy + /terms + consent banner + consent copy | Sonnet | Step 02 (analytics utility exists to gate) | ✅ deployed + verified live 2026-07-21/22 (post-deploy checklist below all passed); one hotfix needed — banner was invisible behind PreLaunch's z-9999 overlay, fixed same day |
| 03b | `03b_ADD_recommendations_clause.md` | Add the Dana-approved "Nature of Recommendations" clause to /terms (statistical matching, no accuracy guarantee — no "beta" wording anywhere) | Sonnet | Step 03 deployed | ✅ deployed + verified live 2026-07-22 — clause renders verbatim, directly above Right Match Promise |
| M-legal | manual | Professional review of the generated privacy/terms text incl. the new clause (baseline hygiene, not legal advice) | Dana | Step 03b | ⬜ see `../GAPS.md` |

Terms include the Right Match Promise placeholder — final wording comes out of the
**Aug 8 pricing workshop** (one replacement bag per customer per first order).

## Run commands

**Step 03** — model: Sonnet — ✅ already executed
```
Read launch/README.md for context and rules, then execute the prompt in launch/30_compliance/03_B2_compliance_pack.md exactly as written. Do only this step. When done, show me how each ACCEPTANCE criterion is met.
```

**Step 03b (clause)** — model: Sonnet
```
Read launch/README.md for context and rules, then execute the prompt in launch/30_compliance/03b_ADD_recommendations_clause.md exactly as written. Do only this addition — one section on /terms, nothing else. When done, show me the diff and how each ACCEPTANCE criterion is met.
```

## Post-deploy verification

- [x] Fresh incognito visit → banner appears once; choice remembered on reload — verified live 2026-07-22
- [x] Accept → Network tab shows gtag/facebook requests — verified live: `gtag/js?id=G-GYC50VYRYN`, `fbevents.js`, and a real `google-analytics.com/g/collect` beacon all fired
- [x] "Essential only" (new incognito) → **zero** requests to google-analytics/facebook domains, but quiz_funnel_event rows still log — verified live: a real Q1 click produced exactly one request, `POST /api/quiz/event` (200), no Google/Meta requests
- [x] /privacy and /terms render; linked from main footer AND the quiz layout — verified live on footer, home/about/how-it-works (own footer line), quiz results screen, and PreLaunch
- [x] Every email form shows the one-line consent copy — verified live on NewsletterModal, PostQuizEmailGate, PreLaunch
- [ ] Standing trio (`../REGRESSION.md`) — not independently re-run this pass; this diff doesn't touch the homepage lifecycle/gift-widget/Mailchimp paths it covers
