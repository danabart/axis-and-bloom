# Step 03 (B2) — Compliance pack: privacy, terms, consent banner

> Global step 03 of 11 · Workstream: compliance · Model: Sonnet · Depends on: Step 02 (analytics utility exists to gate).

CONTEXT: Axis & Bloom is about to run Meta ads driving strangers to the site, which now carries GA4 + Meta Pixel and captures emails (single opt-in, Mailchimp). The site currently has NO privacy policy, terms, or consent banner. Brand voice: calm, precise, no legalese-wall where avoidable.

TASK:

1. Add /privacy and /terms pages (footer-linked site-wide, including the quiz layout which hides public nav — add a minimal footer link there). Privacy policy must plainly cover: quiz answers & taste-profile data (what we store, that it personalizes matching), account data, newsletter email use (Mailchimp as processor), analytics (GA4), advertising (Meta Pixel), cookies, data deletion contact. Terms: standard e-commerce basics + the Right Match Promise terms placeholder (one replacement bag per customer per first order; wording finalized at pricing workshop).
2. Add a calm, brand-consistent cookie/consent banner (component placed per existing frontend conventions, e.g. frontend/src/app/components): two choices (accept / essential only), no dark patterns, remembered in a cookie. Analytics + Pixel (Step 02's utility) initialize only after acceptance; "essential only" keeps them off. First-party quiz_funnel_event logging is anonymous/essential and stays on.
3. Newsletter capture points: add one-line consent copy ("We'll email your match and early access — unsubscribe anytime") near every email submit.

CONSTRAINTS: reuse existing page/layout components; no new design language; banner must meet Visual Foundations (no shouting, guides not dominates). NOTE: this is baseline hygiene, not legal advice — have a professional review the generated policy text when possible.

ACCEPTANCE: fresh incognito visit shows the banner; declining keeps GA4/Pixel network requests absent; /privacy and /terms render and are linked from every layout including the quiz.
