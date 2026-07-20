# AXIS & BLOOM — Marketing Technical Plan

**Created:** July 16, 2026 (rev. 2 same day) · **Companion to:** `Axis_and_Bloom_Marketing_Strategy.pdf` (Camila's plan, launch Oct 1)
**Decisions locked in this session:** soft email gate on quiz results · Camila gets a Cowork project as her marketing agent · welcome emails drafted by Dana + Claude, Camila edits · **no gift/PR box** — the coffee bag itself is the packaging story · metrics via **Looker Studio (free)** instead of a custom-built dashboard · deliverables in repo (this file) + Word companion for Camila.

This document translates Camila's marketing plan into concrete technical work, structured as **Claude Code prompt-ready parts** (per project convention: no direct code edits; every part below is scoped to become one Claude Code prompt). It also records the brand-alignment review and the non-code checklists (Mailchimp UI, Meta Ads setup).

---

## 1. Brand Alignment Review — verdict: aligned, with 4 flags

Checked against Brand Plate v3.0, Brand Values & Behavior v1.0, Visual Foundations v1.0.

**Strongly aligned (keep as-is):**
- "Certainty, not variety" and the four messaging pillars map directly to Clarity Over Complexity and the RTBs. The "What NOT to say" list is essentially the brand guardrails restated.
- **Right Match Promise** (risk reversal instead of discounts) is the best idea in the plan from a brand standpoint — it operationalizes Accountable Quality and directly answers the 49% money-waste fear without teaching customers to wait for sales.
- Gift-led, not discount-led BFCM stance matches "no hype, no pressure" and protects pricing integrity.
- Voice rules (no exclamation points, AI as craft not spectacle, sensory words) match Brand Behavior "Guide, Don't Educate or Push."

**Flags (each has a resolution below):**

1. **Hard email gate vs. "Customer Directed, System Guided."** The plan's "enter your email to see your archetype" is a hard gate — it withholds the result to force an exchange, which reads as "push," not "guide." **Resolved: soft gate** (decided this session). Show the archetype name + reveal freely; email unlocks the full "why," matched coffees, and the shareable archetype card. This keeps the identity moment generous (identity is Primary in the visual hierarchy) while still capturing the list. See Part 2.
2. **Urgency mechanics vs. "Calm Is a Feature."** The 48-hour founding-perk window, "ends tonight" email, and "IG Stories countdown" are conventional launch tactics but sit close to the "no visual urgency" boundary. Resolution: keep the deadlines (they're real information), drop the countdown *aesthetics*. State windows once, plainly, in body copy ("Early access pricing ends Sunday night"). No timers, no red banners, no repeated "last chance."
3. **"Six archetypes" — the plan assumes six; the system disagrees with itself.** Backend quiz V7 scores **5** archetypes (Chocolate & Nutty, Balanced & Sweet, Fruity, Floral, Earthy) + an `experimental` flag; the frontend results UI renders **6** (adds "Spicy & Earthy" and "Experimental" with their own wallpapers/bags). The marketing plan builds content worlds, inventory forecasting, and ad creative on "six." **This is a System Integrity violation and must be reconciled before the August content engine starts.** See Part 0.
4. **Pricing reference mismatch.** The plan's market reference is $18–24/bag; the live `dial_slot_price` default is **$38.00/12oz**. Not a brand violation, but the August 8 pricing workshop must reconcile this gap explicitly (premium positioning at $38 changes the ad math: cost-per-subscriber targets assume the plan's reference prices).

**Plan adjustment — no box (Dana, Jul 16).** There is no gift box or "signature box"; the beautifully designed coffee bag *is* the packaging, shipped in a regular mailer. This touches several plan items:
- **PR seeding (Sep 7–13):** "20–30 beautiful PR boxes" → 20–30 **PR mailers**: the bag itself + a printed archetype card + a personal note. The "unboxing" story becomes the **bag reveal** — the personalized label/name on the bag carries the moment the box was supposed to.
- **Gift the Quiz, physical version:** no boxed gift. Physical = an elegant **printed card with a code** (printable at home or mailed flat); the recipient's matched bag ships after they take the quiz. Digital version unchanged — and it remains the Dec 19–24 hero.
- **"Made for you" pillar copy:** "your name on the box" → "your name on the bag."
- Camila's content plan: unboxing/UGC prompts should ask for bag-reveal and first-sip shots, not box openings.

---

## 2. Current state vs. what the plan needs (gap map)

| Plan requirement | Current state | Gap |
|---|---|---|
| Site says October 1 | `PreLaunch.tsx` says "COMING SEPTEMBER 1" | One-line change (Part 1) |
| Quiz feeds email list | Quiz results free; no email capture on results screen; `post_quiz` source seeded in DB but unused | Soft gate + capture form (Part 2) |
| Mailchimp tagged with archetype + Bloom Dial | Sync is live but sends **email + FNAME only** — no tags, no source, no archetype | Sync upgrade (Part 3) |
| 5-email welcome sequence triggered by quiz | No automation exists anywhere (app or Mailchimp) | Mailchimp Journey config (Part 4, no code) |
| GA4 + Meta Pixel installed | **Zero analytics of any kind** in the codebase | Install + events (Part 1) |
| Monday 5-number measurement ritual | `/admin` landing shows 6 cupping-count cards only; no marketing data surfaced | Looker Studio report + thin admin embed (Part 5) |
| Quiz completion rate tracked | `quiz_session.completed_at` exists; guest starts not captured; no funnel | Funnel events (Part 1) |
| Cost per subscriber | No ad-spend tracking anywhere | Ad-spend Google Sheet blended in Looker Studio (Part 5) |
| Share-your-match cards | Not built | Part 6 (September) |
| Launch conversion / CAC | Orders stubbed (Shopify blocked, OT-6) | Post-OT-6; dashboard fields reserved |
| Quiz inside the ad | Nothing | Strategy in §4; optional webhook build in Part 7 |

**Ops item (verify before anything else):** WHAT_WE_BUILT marks Mailchimp ✅ Active, but CAMILAS_UPDATES #8 notes the two MC secrets were removed from `deploy.yml --set-secrets` until created in GCP. Run `node test-mailchimp.mjs` against production secrets and confirm a signup from the live site actually lands in the audience. If not, re-wire per the "How to Activate Mailchimp" runbook in CAMILAS_UPDATES.

---

## 3. The build — Claude Code prompt parts

Sequenced to match the plan's weeks. Each part = one Claude Code prompt. Reuse rules apply throughout (shared `CartContext`, existing newsletter endpoint, existing admin components — never reimplement).

### Part 0 — Archetype reconciliation (code) — *this week*
**DECIDED (Dana, Jul 16): the canon is 5 archetypes — Chocolate & Nutty, Balanced & Sweet, Fruity, Floral, Earthy. "Experimental" is a category/mode, not a sixth archetype.** (Backend V7 already works this way; the frontend is what drifted.)
**Prompt scope:** align `ARCHETYPE_NAME_TO_KEY` and the results-screen archetype map to the 5-archetype canon; remove "Spicy & Earthy" and standalone "Experimental" as archetypes; render `experimental` as a category badge/mode on any result; audit every frontend surface (quiz results, Bloom, shop, packaging templates) for the retired names.
**Marketing consequence (Camila):** every "six archetypes / six worlds / six colors" in the strategy becomes **five** — content series, inventory forecasting, ad creative, and the archetype card set all follow the 5-canon.

### Part 1 — Fix the funnel: date, analytics, quiz funnel events — *week of Jul 20*
1. `PreLaunch.tsx`: "COMING SEPTEMBER 1" → "COMING OCTOBER 1".
2. Install **GA4** (gtag) and **Meta Pixel** site-wide via env-configured IDs (`VITE_GA4_ID`, `VITE_META_PIXEL_ID`); no-op cleanly when unset (dev). Fire standard PageView on route change (SPA — must hook the router, not just index.html).
3. Custom events, both pixels: `QuizStart` (first answer selected), `QuizComplete` (score response received), `EmailSubmitted` (newsletter/soft-gate success), later `Purchase`. Meta Pixel `Lead` standard event on EmailSubmitted — this is what ads optimize on (plan §"Paid ads": objective = quiz-completed subscriber).
4. First-party funnel logging (source of truth, since guests dominate pre-launch and `POST /api/quiz/score` is public): new table `quiz_funnel_event (id, session_key, event, archetype, created_at)` + public `POST /api/quiz/event`, called at start/complete/email-submitted with a client-generated session key. Powers the dashboard's quiz completion rate without depending on GA4.

### Part 2 — Soft gate + post-quiz email capture — *week of Jul 20*
On the quiz results screen (the gift-unwrap reveal, CAMILAS #43):
- Section 1 (curtain reveal, archetype name + bag + one-line description) stays **free** — the generous identity moment.
- Sections 2–3 ("Why this matches you," "Coffees selected for you") sit behind a calm inline email card: *"Where should we send your match? The full why, your matched coffees, and your archetype card — plus first access October 1."* One field, one button, brand voice, no dark patterns; a quiet "skip for now" keeps it a soft gate.
- Signed-in users skip the card entirely (their email is known → auto-subscribe with consent copy shown once).
- Submission calls the existing `POST /api/newsletter/subscribe`, extended to accept `{ email, firstName?, source: 'post_quiz', archetype, quizSessionKey?, experimental?, confidence? }`.
- Reuse: existing newsletter endpoint + `NewsletterModal` styling patterns; do not build a second subscribe path.

### Part 3 — Mailchimp sync upgrade — *week of Jul 20 (same prompt week as Part 2)*
- Extend the Mailchimp upsert to send: **tags** `source:<source>`, `archetype:<name>`, `quiz-completed` (when source = post_quiz), `experimental` (when flagged); **merge fields** `FNAME`, `ARCHETYPE`.
- Keep the sync non-blocking and `MC_ENABLED`-guarded (existing pattern).
- One-off **backfill script** (like `test-mailchimp.mjs`): push all existing `newsletter_subscriber` rows to Mailchimp with their `source` tag.
- Ops: confirm Secret Manager secrets are in `deploy.yml --set-secrets` (see §2 ops item).

### Part 4 — Mailchimp UI configuration — *no code; Dana + Camila, week of Jul 27*
Checklist (done inside Mailchimp, not the repo):
1. Verify audience + confirm single opt-in stays (current behavior; double opt-in would suppress the funnel).
2. Create segments per archetype tag; every campaign send gets segmented by archetype from day one (plan: "segment everything by it").
3. Build the **Customer Journey**: trigger = tag `quiz-completed` added → the 5-email welcome sequence from plan §07 (instant / day 2 / day 5 / day 9 / day 14). Email #1 uses `*|ARCHETYPE|*` merge tag: "You're *|ARCHETYPE|*. Here's why."
4. Welcome email drafts: **Dana + Claude write all five** (in a Cowork session, against the brand docs); **Camila's task = review and fix** — voice, rhythm, imagery — before they go into the journey. Her Cowork project is set up for exactly this editing pass.
5. Test: run a fresh quiz completion end-to-end → tag lands → journey fires → Email #1 renders the archetype correctly.

### Part 5 — Marketing metrics via Looker Studio (free), not a custom build — *weeks of Jul 27–Aug 9*
Decision (Dana, Jul 16): don't reinvent the wheel. **Looker Studio** (Google, free tier) is the dashboard; it fits the existing GCP stack and costs nothing. What still must exist regardless of tool: the *data capture* from Part 1 (Pixel/GA4 events + `quiz_funnel_event` table) — no tool can chart what isn't recorded.

**Setup (mostly no-code, one small DB task):**
1. Create a **read-only Postgres user** on Cloud SQL scoped to the reporting tables/views (`newsletter_subscriber`, `subscriber_source`, `quiz_funnel_event`, later `"order"`), and allow Looker Studio's connector to reach the instance (authorized networks / Cloud SQL connector). This is the only piece that touches infra — small Claude Code / gcloud task.
2. Optionally add 2–3 **SQL views** (e.g. `v_weekly_subscribers`, `v_quiz_funnel_weekly`, `v_archetype_distribution`) so Looker Studio charts stay dumb and the logic lives in versioned SQL — one small Claude Code prompt.
3. Connect data sources in Looker Studio: **Cloud SQL Postgres** (native connector) + **GA4** (native) + one **Google Sheet** named `Ad Spend` (columns: week_start, platform, amount) that Camila fills weekly — replaces building an ad-spend entry UI. Cost-per-subscriber = blended Sheet ÷ SQL.
4. Build one page with the plan §09 five cards + archetype distribution + weekly growth vs. the 1,200–2,000 target line. Email opens/clicks stay in **Mailchimp's own free reports** — link, don't rebuild.
5. Share the report with Camila (viewer). No admin login needed for her Monday ritual.

**The empty `/admin` page:** becomes a thin shell, not a build — a "Marketing" card linking out to (or iframe-embedding) the Looker Studio report + the Mailchimp audience link + the Ad Spend sheet, with the six cupping cards demoted below. One small Claude Code prompt instead of a full dashboard build.

**Fallback:** if the Cloud SQL ↔ Looker Studio connection proves annoying (networking, connector limits), the original custom plan (a `GET /api/admin/marketing-stats` endpoint + dashboard page reusing existing admin components) remains documented in git history as rev. 1 of this file — build it post-launch only if Looker Studio actually fails the Monday ritual.

### Part 6 — Share-your-match card — *September*
Every quiz result gets a shareable, archetype-colored card: an OG-image endpoint (or pre-rendered per-archetype share page) so a shared link unfurls beautifully on IG/WhatsApp, plus a one-tap share/copy button on the results screen. Post-launch, extend with "Give a match, get a perk" referral. (Scope the referral mechanic in its own session — it interacts with the Company Gift code system and should reuse it, not duplicate it.)

### Part 7 (optional, September test) — Meta lead-ad mini-quiz webhook
Only if the click-to-site ads underperform (see §4): backend endpoint receiving Meta's leadgen webhook, mapping a 3-question instant-form mini-quiz to an archetype (reuse the scoring matrix subset), upserting to Mailchimp with `quiz-completed` + archetype tags → welcome journey fires with a "your match is in your inbox" variant. Pre-req: Facebook App + webhook subscription + page token (ops, not just code).

---

## 4. "Do the quiz on the ad" — how it actually works on Meta

Three real options; recommendation: **A now, B as a September test, skip C.**

**A. Click-to-quiz ads (recommended primary).** The ad's job is one tap: creative poses the pain ("No more guessing in front of forty bags"), the button opens `/find-my-flavor`. With Part 1's Pixel events, campaigns optimize delivery for `Lead` (quiz-completed + email) — Meta finds people likely to *finish*, not just click. This keeps the full brand experience (the reveal, the why, the visual system) and feeds Mailchimp natively. This is exactly the plan's "objective = quiz starts" crawl phase, upgraded to optimize on completion.

**B. Lead-ad mini-quiz (native, in-feed).** Meta instant forms support custom multiple-choice questions with conditional logic — so a 3-question taste mini-quiz can run *entirely inside Instagram/Facebook*, with email captured natively (pre-filled by Meta, very low friction). The result can't be computed on-screen, so the payoff is "your match is on its way to your inbox" → webhook (Part 7) scores it and fires Email #1. Pros: lowest friction capture, no site visit needed. Cons: no brand-world reveal, lead quality typically lower, extra plumbing. Worth an A/B test against option A in September if cost-per-subscriber from A is above the $2–4 target.

**C. Instant Experience.** A full-screen mobile canvas after the tap. It can hold polls and carousels but not real scoring logic — it's a teaser layer, not a quiz. Adds build effort without capture advantage. Skip.

---

## 5. Timeline (mapped to Camila's plan weeks)

| Week | Plan phase | Technical work (Claude Code) | Non-code |
|---|---|---|---|
| Jul 16–19 | Foundation | **Part 0** archetype decision + reconciliation | Verify Mailchimp prod wiring (test-mailchimp.mjs) |
| Jul 20–26 | Fix the funnel | **Parts 1 + 2 + 3** (date, GA4/Pixel/funnel events, soft gate, MC tags, backfill) | Create GA4 property + Meta Pixel in Business Manager |
| Jul 27–Aug 2 | Welcome emails / money decisions | **Part 5 started** (read-only DB user + SQL views) | **Part 4** Mailchimp journey; Dana + Claude draft 5 emails → Camila edits; pricing workshop prep (flag: $38 vs $18–24) |
| Aug 3–9 | Paid test begins | **Part 5 done** — Looker Studio report live before first ad dollar | First $20–40/day campaigns; log spend in the Ad Spend sheet |
| Aug–Sep | Build/Momentum | **Part 6** share cards; **Part 7** only if CPS > $4 | Content engine, PR mailers (bag + archetype card, no box), pricing decided Aug 8 |
| Sep 28–Oct 4 | Launch week | freeze deploys; dashboard watch | Launch emails per plan |

The plan's own non-negotiable holds: **the quiz-to-email pipeline (Parts 1–3) goes live in July.** Every week it isn't live is list growth lost.

---

## 6. Camila's marketing agent (Cowork project)

Setup (15 minutes, no code):
1. Create folder `C:\Users\DanaB\axis-and-bloom-marketing\` (separate from the code repo so Camila never touches code) containing: the three brand docs, the marketing strategy PDF, this plan's Word companion, and a `copy-bank.md` seeded from plan §03.
2. Camila opens the Claude desktop app → new Cowork project pointed at that folder → paste the project instructions below.
3. From then on she asks it for: captions and Reels scripts per archetype world, editing passes on the welcome-email drafts (Dana + Claude write v1, she makes them hers), ad angle variants, PR-mailer notes, weekly checklists from the plan — and every output is checked against the guardrails automatically because they live in the project.

**Project instructions (paste as-is):**
> You are the Axis & Bloom marketing assistant. Axis & Bloom matches people to coffee via a taste quiz; launch is October 1, 2026. Before drafting anything, consult the brand documents and the marketing strategy PDF in this folder. Voice: calm, warm, precise, quietly confident; short sentences; sensory words; no exclamation points in headlines; AI described as craft ("our taste-mapping"), never spectacle. Hard rules: never celebrate variety or "hundreds of coffees"; never use hype, urgency countdowns, or discount-first framing; no coffee jargon (process, masl, cupping scores) in top-of-funnel copy; every piece must ladder to one of the four messaging pillars (End the guessing / Always the why / Ritual & calm / Made for you) — if it doesn't, say so instead of writing it. When asked for social content, default to the three Instagram pillars (Archetype worlds / The quiet why / Ritual & people) and the 3–4 posts/week cadence. Always offer a "why this fits the brand" note with drafts.

Optional later: a scheduled Monday task that reads the dashboard numbers and drafts the weekly focus — worth adding once Part 5 is live.

---

## 7. Decisions log

| Decision | Choice | Date |
|---|---|---|
| Quiz results gating | Soft gate (name free; why/coffees/card behind email; skippable) | 2026-07-16 |
| Camila's agent | Cowork project with brand-guardrail instructions | 2026-07-16 |
| Welcome emails authorship | Dana + Claude draft all five; Camila reviews & fixes voice | 2026-07-16 |
| Packaging | No gift/PR box — designed coffee bag ships in a regular mailer; bag reveal replaces unboxing | 2026-07-16 |
| Metrics dashboard | Looker Studio (free) over Cloud SQL + GA4 + Ad Spend sheet; thin embed/link on `/admin`; custom build only as fallback | 2026-07-16 |
| Archetype canon (5 vs 6) | **5 archetypes; Experimental is a category, not an archetype** — plan wording changes six→five | 2026-07-16 |
| Roastery relationship | Dana owns the contact — idle policy, SLA, Q4 capacity, COGS quote | 2026-07-16 |
| Pricing (bag/trial/subscription) | OPEN — workshop by Aug 8; reconcile $38 default vs plan's $18–24 reference | — |
| Lead-ad mini-quiz (Part 7) | Deferred — only if cost/subscriber > $4 in September | 2026-07-16 |

---

## 8. The hard review — what's wrong and what's missing (requested by Dana, Jul 16)

Ranked by how badly each can hurt the launch.

**1. You cannot take money, and the plan doesn't mention it.** Checkout is stubbed (`createOrder()` throws; blocked on the roastery Shopify account, OT-6). Every week of list-building is worthless on October 1 if an order can't be placed. This is the single biggest risk in the whole program and it has no date, no owner, and no fallback in the marketing plan. The Sep 14–20 "ops dry run" assumes a working order flow that does not exist today. Required: a hard deadline for OT-6 (suggest Sep 1), and a fallback decision now — e.g., direct Stripe checkout on our side if the roastery account slips.

**2. The Q4 hero is vaporware.** "Gift the Quiz" (the plan's signature growth loop, the Dec 19–24 revenue window, the BFCM workhorse) has zero build behind it: no consumer gift purchase flow, no gift email delivery, no consumer redemption UX (the Company Gift code system is B2B and adjacent, not this), no Duo subscription, no subscription management UI at all. Nov 1 is the target. Counting backward — build, test, launch emails, card design — this needs to be scoped as its own multi-part build **in August**, or the Q4 section of the plan should be honestly downgraded now instead of in a November panic.

**3. Nobody has computed the revenue side.** The plan is meticulous about cost per subscriber and silent about what comes back. Rough math with its own numbers: 2,000 subscribers × 8% launch conversion × ~$40 order ≈ **$6.4k launch week**, against ~$3–5k ad spend plus mailers, printing, and product cost. At the low end (1,200 subs, 6%, and a realistic new-account CPS of $5–8 rather than the optimistic $2–4) launch week is ~$2.9k revenue on similar spend. Neither outcome is failure — but no one has written down what "success" means in dollars, what COGS is at $38/bag, what shipping costs, or what a Right Match Promise redemption costs (every "wrong match" = a free bag — generous, on-brand, and currently unpriced and unbudgeted, with no abuse limit defined).

**4. Two launches, two people, same date.** B2B company subscriptions are also targeted at Oct 1 (per project memory), alongside this consumer launch, the content engine, the ad management, and the ongoing build roadmap (Find My Flavor parts, Bloom Dial data, Axis redesign, homepage regressions). The marketing plan says "two people is the real constraint" and then schedules as if it isn't. Something must move — the honest options are slipping B2B to November or cutting the September press/seeding wave.

**5. The strategy stands on 35 friends and family.** The plan admits this once, then treats 94%/60%/51% as load-bearing facts in every section. Fine as a starting bet — but there is no defined checkpoint that would change the strategy. Add one: when the first ~300 organic quiz completions are in (late August), formally re-check completion rate, archetype distribution, and email opt-in rate against the assumptions, and be willing to rewrite the pillars if the data disagrees.

**6. Compliance is entirely absent.** Meta Pixel + GA4 + email capture with single opt-in and no mention anywhere of: privacy policy, cookie consent, CAN-SPAM footer/address, or terms for the quiz's personal-taste data. Ads will drive strangers to a site that (as far as the docs show) has none of this. Not optional once paid traffic starts — fold a basic privacy policy + consent banner + compliant email footer into Part 1's scope.

**7. Deliverability and ad-account fragility.** Launch emails go from a young domain via Mailchimp — without SPF/DKIM authentication and gradual sending, the Oct 1 email lands in spam. Verify domain authentication in Mailchimp now (5 minutes) and let the welcome journey warm the domain through August. Similarly, brand-new Meta ad accounts get restricted routinely; set up the account, pixel, and a $5/day warm-up well before August 3, and have the second admin added so one flagged profile doesn't freeze the account.

**8. No LTV proxy.** "LTV must clear 3× CAC" is called the one relationship that decides everything, and then no metric in Section 09 can measure it before December. Add two proxies from day one: % of launch orders choosing subscription over single bag, and 30-day reorder rate. Those two numbers in October tell you whether scaling spend in November is sane.

**9. Quiz completion 60% is a guess with no baseline.** Analytics don't exist yet, so nobody knows if the real number is 30% or 80%. If it's 30%, cost per subscriber doubles and the whole budget table shifts. Part 1 fixes the instrumentation — but treat the first two weeks of August data as baseline-setting, not target-hitting.

**10. Seeding just got weaker and the plan doesn't know it.** The "unboxing IS the story" logic was written for a box that no longer exists. A bag in a padded mailer is a materially weaker press moment than a designed box. The bag reveal + personalized label can still carry it, but that now depends entirely on the bag design being genuinely photogenic and the archetype card being excellent — worth a deliberate test shoot before committing 20–30 mailers' worth of product and postage.

**What the plan gets right (for balance):** product-as-lead-magnet is correct and rare; gift-led instead of discount-led protects the brand's pricing integrity; the measurement discipline (five numbers, ignore vanity metrics) is exactly right; the copy bank is genuinely on-brand; and sequencing everything toward one number (quiz-qualified subscribers) is the correct single focus for a two-person team.
