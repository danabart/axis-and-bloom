# Compliance (workstream: compliance)

Privacy policy, terms, cookie/consent banner, and consent copy at email capture points.
Required before strangers arrive from paid ads. Brand constraint: the banner must be calm —
two choices, no dark patterns, guides-not-dominates (Visual Foundations).

## Tasks

| Global step | File | What | Model | Depends on | Status |
|---|---|---|---|---|---|
| 03 | `03_B2_compliance_pack.md` | /privacy + /terms + consent banner + consent copy | Sonnet | Step 02 (analytics utility exists to gate) | ⬜ |
| M-legal | manual | Professional review of the generated privacy/terms text (the prompt's own note: baseline hygiene, not legal advice) | Dana | Step 03 | ⬜ see `../GAPS.md` |

Terms include the Right Match Promise placeholder — final wording comes out of the
**Aug 8 pricing workshop** (one replacement bag per customer per first order).

## Run command

**Step 03** — model: Sonnet
```
Read launch/README.md for context and rules, then execute the prompt in launch/30_compliance/03_B2_compliance_pack.md exactly as written. Do only this step. When done, show me how each ACCEPTANCE criterion is met.
```

## Post-deploy verification

- [ ] Fresh incognito visit → banner appears once; choice remembered on reload
- [ ] Accept → Network tab shows gtag/facebook requests
- [ ] "Essential only" (new incognito) → **zero** requests to google-analytics/facebook domains, but quiz_funnel_event rows still log
- [ ] /privacy and /terms render; linked from main footer AND the quiz layout
- [ ] Every email form shows the one-line consent copy
- [ ] Standing trio (`../REGRESSION.md`)
