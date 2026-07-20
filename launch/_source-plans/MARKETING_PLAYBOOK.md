# AXIS & BLOOM — Marketing Operating Playbook

**Created:** July 16, 2026 · **For:** Dana & Camila — neither of whom is a marketer, which is fine; this document is the marketer.
**Reads with:** `MARKETING_TECH_PLAN.md` (what gets built) and Camila's strategy PDF (why). This file is *what to do, each week, and how to know it worked*.
**Companion spreadsheet:** `Unit_Economics.xlsx` (this folder) — fill the blue cells before the pricing workshop.

---

## 0. Decisions made July 16 (Dana)

1. **Everything gift-related goes digital.** E-card by email, no printed/physical gift products. (SMS as a channel later, once Twilio work lands — with proper consent, see §5.)
2. **Roastery account activates mid-August, not now** — their idle policy (accounts disabled after a few months without orders) means activating in July risks a dead account before launch. Timing below solves both directions. **Dana owns the roastery relationship** — he makes the contact and gets the answers in §2.
3. **Five archetypes, final.** Experimental is a *category*, not a sixth archetype. Everywhere the strategy says "six archetypes / six worlds," read **five** — content series, inventory, ad creative, the card set.
4. Standing decisions from the tech plan: soft quiz gate · no box (bag is the story) · Looker Studio dashboard · Dana + Claude draft emails, Camila edits · all gifting digital-only.

**Recommendation awaiting Dana + Camila sign-off — launch scope.** October 1 is *not* too soon, if the scope is this and only this:

| Ships Oct 1 | Moves later |
|---|---|
| Single matched bag | Subscription UI → late October (soft-add) |
| Trial / discovery size | **Gift the Quiz (digital) → Nov 1** |
| "Two bags" bundle (manual Duo — two quiz profiles, one order) | Duo *subscription* proper → December or post-holiday |
| Quiz → email → welcome journey → early access | **B2B company subscriptions → November** (two launches on one date with two people is the plan's biggest self-inflicted risk) |

Launching Oct 1 matters because the entire Q4 gifting wave starts then. Keep the date; shrink the day.

---

## 1. The week-by-week plan (July 20 → launch)

Every week: one Dana lane (build — via Claude Code prompts), one Camila lane (content/marketing), one shared/external lane. "Done when" is the test.

| Week | Dana (build) | Camila (marketing) | Together / external | Done when |
|---|---|---|---|---|
| **Jul 16–19** | Part 0 prompt: enforce the 5-archetype canon (Experimental = category) · **Dana contacts the roasteries:** exact idle policy, drop-ship SLA, Q4 capacity, **COGS quote per bag/trial** (feeds the spreadsheet) | Read the companion doc; set up her Cowork project | — | COGS number exists; frontend shows 5 archetypes |
| **Jul 20–26** | **Part 1**: Oct 1 date, GA4 + Meta Pixel, quiz funnel events, **+ compliance pack** (privacy policy, terms, consent banner, email-footer address — §5) | Draft the IG content calendar for August (archetype world #1); open the shared Ad Spend sheet | **Email plumbing:** authenticate the domain in Mailchimp (DKIM/SPF — §6a); create Meta Business Manager + ad account + pixel, both of you as admins, verify domain (§6b) | Pixel fires on the live site; domain shows "authenticated" in Mailchimp |
| **Jul 27–Aug 2** | **Parts 2 + 3**: soft gate email capture; Mailchimp tags/merge fields/backfill | Review + fix the 5 welcome-email drafts (Dana + Claude write v1 this week) | **Part 4:** build the Mailchimp journey; run one end-to-end test. **Ads warm-up starts: $5/day** (§6b). Fill `Unit_Economics.xlsx` blue cells | A stranger's quiz → email in Mailchimp with archetype tag → Email #1 arrives |
| **Aug 3–9** | **Part 5**: read-only DB user, SQL views, Looker Studio report, thin `/admin` link card | **First real campaigns: $20–40/day, two angles** (choice-overload pain vs. archetype curiosity) | **Pricing workshop (by Aug 8)** using the spreadsheet: bag, trial, sub price, free-ship threshold, Right Match Promise wording + budget cap | Dashboard shows the five numbers; prices are on the site |
| **Aug 10–16** | **Scope "Gift the Quiz" (digital)** — spec prompt written, reusing company-gift code infra (§3) | Founder story content; keep 3–4 posts/week rhythm | Watch CPS daily but *judge weekly* (§7 rules) | Gift spec exists with build estimate |
| **Aug 17–23** | Kill/scale ads support; start Shopify integration prep | Review ad results: kill losing angle, raise winner toward $50/day if CPS < $4 | **Activate roastery Shopify account** (~6 weeks pre-launch — inside their idle window, enough time to integrate) | Roastery account live; winning ad angle identified |
| **Aug 24–30** | **Shopify integration** (replace stubbed `createOrder`) | Big photo shoot: 6–8 week library — **bag-reveal test shoot first** (§ risk 10: the bag must carry what the box was going to) | **RESEARCH CHECKPOINT** (§4): ≥300 quiz completions → re-check every assumption | Real order object reaches the roastery sandbox; checkpoint memo written |
| **Aug 31–Sep 6** | Checkout end-to-end in staging; **Part 6** share-your-match card | Early-access announcement to the list; "share your match" goes live | Referral copy decided (perk = free shipping or archetype card set, not a discount) | A test purchase completes in staging |
| **Sep 7–13** | Buffer / fix week (something will have slipped) | **PR mailers ship**: 20–30 × (bag + archetype card + note) to newsletters + 5k–50k micro-creators who took the quiz first | Raise spend toward $50–75/day if CPS healthy | Mailers out the door |
| **Sep 14–20** | — | Content peaks: archetype reveal series | **OPS DRY RUN with real money:** place a real order → roastery ships → arrives → photograph it. This also resets the roastery idle clock | One real bag arrived at a real door, correctly labeled |
| **Sep 21–27** | Freeze deploys except fixes | "One week. Your match is waiting." email | Confirm roastery inventory per archetype against the list's archetype distribution (dashboard has it) | Inventory committed in writing |
| **Sep 28–Oct 4** | **LAUNCH WEEK** — watch dashboard, fix squeaks | Per the plan: Mon 3-days email/IG · Wed doors-open-tomorrow · **Thu Oct 1, 9am: launch email**, early access + founding perk (48h, stated once, no countdown theatrics) · Fri resend to non-openers, new subject · Sun perk-ends email | Both: on Stories, human, present | First orders exist; conversion tracked against §7 |

**October–December (the short version):** Oct = stabilize, collect 20–30 reviews (day-10 email ask), add subscription UI; **Nov 1 = Gift the Quiz digital launch**; Nov 20–30 BFCM gift-led (bundle value + founding-member framing, one modest offer max); Dec 1–18 gifting peak emails weekly; **Dec 19–24 = the digital window** ("too late to ship, right on time to match" — e-cards sellable until Dec 24, delivered instantly — this is now the *whole* late-December play since gifting is digital-only, and it's the most margin-friendly week of the quarter); Dec 26–31 recipients redeem → greet them beautifully.

---

## 2. Roastery timing (answer to "they disable idle accounts")

The trap is real in both directions: activate now → idle 2.5 months → risk disabled before launch; activate too late → no time to integrate and test. The plan above threads it:

- **Now (this week), Dana:** contact them — get the *exact* idle definition (days? orders? logins?), drop-ship turnaround SLA, Q4 capacity commitment, and COGS. Don't activate yet.
- **Aug 17–23: activate.** That's ~6 weeks pre-launch: enough for integration + dry run, short enough that the account never idles.
- **Sep 14–20:** the paid dry-run order doubles as an idle-clock reset.
- **After launch:** real orders keep it warm. If launch ever slips, place one small internal order per month — $38/month is cheap account insurance.

---

## 3. "Gift the Quiz" vs. the Company Gift build (answer to "isn't this what we did?")

Close, and that's good news — but not the same thing. **Company Gift** = B2B: a company buys a 3-month perk, employees redeem codes (built: `company_gift`, `company_gift_code`, redemption widget, lookup/redeem APIs, admin dashboard). **Gift the Quiz** = consumer: one person buys a gift at checkout, the recipient gets a beautiful e-card with a code, takes the quiz, and their matched coffee ships to *their* address.

Reusable (~60%): code generation/validation, the redemption widget pattern, the redeem→account flow. Still needed: a consumer **purchase** flow (a gift SKU in checkout — requires working payments, hence after Shopify), gift tiers (single / trio / 3-month), the **gift e-card email** (recipient-facing, designed), scheduled delivery ("send it Dec 24 morning"), and redemption → quiz → **recipient address collection** → order creation. Digital-only (your decision #1) just deleted the hardest parts — printing, boxed cards, physical fulfillment. Scope week: Aug 10–16; build: October; live: Nov 1.

---

## 4. The research checkpoint (answer to "how can I do that?")

One afternoon, Aug 24–30, once ~300 real people have finished the quiz. Pull five numbers from the dashboard and compare them to the strategy's assumptions:

| The 35-person survey said | Check against | If it disagrees |
|---|---|---|
| People finish a short quiz (plan targets 60%+) | Real completion rate | <45% → shorten/fix the quiz UX before scaling spend |
| People will trade email for their match | Soft-gate opt-in rate (target 70%+) | <50% → rewrite the gate copy; test moving it later |
| "One confident pick" beats variety (94%) | Trial-size vs. "see more coffees" click behavior; ad angle winner | If the *variety* angle wins the ad fight, the storefront message needs rethinking — big deal, catch it now |
| Archetypes spread evenly enough to stock six/five | Archetype distribution of the list | Any archetype >40% → weight inventory + lead content with it |
| $2–4 per subscriber is achievable | Actual CPS after 3 weeks of ads | See §7 rules |

Write the result down (one page). If three or more rows disagree with the survey, the strategy gets revised in September — that's not failure, that's the plan's own "living document" clause doing its job.

---

## 5. Compliance pack (now in Part 1's scope)

Non-optional before paid traffic. All small, all boring, all cheap now and expensive later:
- **Privacy policy + terms pages** — covering: quiz taste data (what's stored, that it builds their profile), analytics (GA4), advertising (Meta Pixel), email. Footer-linked site-wide.
- **Consent banner** — simple, calm, on-brand; blocks Pixel/GA4 until accepted where required.
- **Email:** CAN-SPAM needs a physical mailing address in every footer (a PO box works) — set it once in Mailchimp; unsubscribe is handled by Mailchimp automatically.
- **SMS (when Twilio lands):** TCPA requires *express written consent* — an unticked checkbox at capture ("Text me my match updates"), STOP handling (Twilio manages), and no marketing texts to anyone who didn't opt in. Do not send marketing SMS to the existing list retroactively.
- Meta ad account: complete business verification early — it unblocks higher spend later.

## 6. The two warm-ups (answer to #7 — yes, you understood it: start gradually)

**a) Email domain.** Mailbox providers (Gmail etc.) trust domains that send authenticated mail in slowly growing volume. Two steps: (1) this week, authenticate the sending domain in Mailchimp — it gives you two DNS records (DKIM/SPF) to add where the domain is managed; 15 minutes, done once. (2) Let the welcome journey be the warm-up: it starts small (a few sends/day) and grows with the list through August–September, so by Oct 1 the domain has a two-month history of wanted mail. The thing to *avoid* is the cold-blast pattern: a domain that never sent anything suddenly firing 2,000 emails — that's what lands in spam. Your plan already avoids it as long as the journey is live in July.

**b) Meta ad account.** New ad accounts with sudden spend get auto-restricted constantly. Same principle: create Business Manager + ad account + pixel *now* (Jul 20–26), add both of you as admins (one flagged personal profile then can't freeze the business), add payment, verify the domain — then run **$5/day for a week or two** (a simple engagement or traffic campaign) before the real $20–40/day starts Aug 3. Also: don't edit budgets more than ~20%/day once campaigns run — each big change restarts Meta's learning phase.

## 7. Working with the numbers (answer to #8 — this is what the dashboard is for)

The dashboard shows numbers; these rules turn them into actions. Check weekly (Monday ritual), act only on 7-day trends, never on single days:

| Number | Healthy | If unhealthy → do this |
|---|---|---|
| Cost per subscriber | $2–4 (accept up to ~$6 in the first 2 learning weeks) | >$6 after 2 full weeks → pause scaling, swap creative (use best organic post), retest; >$4 through Sept → test the lead-ad mini-quiz (Part 7) |
| Quiz completion | 60%+ | <45% → shorten the quiz / fix the slowest step (funnel shows where people quit) |
| Gate opt-in | 70%+ | <50% → rewrite gate copy, test position |
| List growth | on pace for 1,200–2,000 by Oct 1 | behind at Sep 1 → shift budget from content/PR to ads (the plan says the reverse for quality; this is the one place growth wins) |
| Launch conversion (Oct) | 6–10% | <4% → the offer is the problem, not the ads — revisit price/trial/promise before adding spend |
| **LTV proxies (new, from Oct 1):** subscription take rate · 30-day reorder rate | ≥15% take · ≥20% reorder | Below both → **do not scale November ad spend**; fix retention first. This is the "LTV must clear 3× CAC" rule made measurable in October instead of December |

Both LTV proxies come free from the existing `subscription` and `"order"` tables — they go on the Looker Studio report as two more cards.

## 8. Money (answer to #3)

Open `Unit_Economics.xlsx` (this folder), fill the blue cells (price, the roastery's COGS quote, shipping), and the sheet answers: contribution per bag, what a customer must be worth, the launch-week P&L under pessimistic/expected/optimistic scenarios, and the maximum CAC you can afford. Bring it to the Aug 8 pricing workshop — the meeting is just "which blue numbers are right." The Right Match Promise gets a budget line there too (assumed 6% redemption, capped at one replacement per customer — adjust in the sheet).
