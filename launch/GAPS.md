# Gap Analysis — what the plan does not yet cover (2026-07-18)

Cross-checked against OPEN_TASKS.md, CAMILAS_UPDATES.md, the Marketing Plan Companion,
the brand docs, and project memory. Ordered by how much they threaten Oct 1.

## A. Plan integrity

1. ~~The source planning docs are gone from the repo~~ **RECOVERED 2026-07-18** — Dana
   re-uploaded MARKETING_TECH_PLAN.md, MARKETING_PLAYBOOK.md, and Unit_Economics.xlsx;
   now in `_source-plans/` together with the Companion.docx. Still missing:
   **Camila's strategy PDF** (`Axis_and_Bloom_Marketing_Strategy.pdf` — its folder under
   `misc/marketing/` is empty; get a copy from Camila) and **MARKETING_DEV_PLAN.md**
   (referenced by the old README/RUN_COMMANDS; possibly an earlier name for the
   TECH_PLAN — Dana to confirm it ever existed separately).
   **Update 2026-07-18: Camila's strategy PDF restored by Dana** to
   `misc/marketing/marketing strategy - camilas presentation/`. Only DEV_PLAN remains
   unaccounted; the TECH_PLAN is treated as authoritative.
2. **Nothing here is in git.** The wipe already happened once. → `git add launch/` and
   commit today, and keep committing after every plan edit.
3. ~~RUN_COMMANDS drift~~ (Step 09/10 pointed at the wrong files; the real Step 09 had no
   command; headers said "of 10") — **fixed by this reorg**, commands now live per workstream.

## B. Money — the biggest unanswered question

4. **Who takes the customer's money on Oct 1?** → **Resolved on paper:** step 12 added
   2026-07-18, and the rails are **DECIDED (Dana, 2026-07-18): Stripe on our own site**,
   roasteries fulfillment-only. 12a finalization can run any time; build before 08b.
   Still open: whether subscriptions are in the Oct 1 offer (see #6).
5. **OT-7 (orders-table migration) isn't in the plan.** The legacy `orders` table means
   `notification_log.order_id` and feedback FKs are always null — Step 09's dedupe and
   the Promise flow quietly depend on the normalized `"order"` table. → Fold OT-7 into
   the pre-08 work (now listed in `60_commerce-and-fulfillment/README.md`).
6. **Subscription mechanics are undefined.** The $29–30 subscription is in the pricing
   decisions, but no step builds recurring billing, pause/skip, or renewal emails. If
   subscriptions are in the Oct 1 offer, this is unscoped engineering; if not, the offer
   copy must say bags-only. → Decide at the Aug 8 workshop.

## C. The site ads will land on

7. **No mobile menu.** → **Fix prompt written 2026-07-18:**
   `05_site-readiness/FIX-01_mobile_nav_menu.md` — ready to run, live before Aug 3.
8. **Homepage weight (~120MB media).** → **Fix prompt written 2026-07-18:**
   `05_site-readiness/FIX-02_homepage_media_weight.md` — compress-in-place + lazy-load,
   deliberately scoped NOT to duplicate the pending image-bucket migration
   (`backend/src/features/image_pipeline/`). Ready to run, live before Aug 3. Still
   worth doing regardless: point ad traffic straight at the quiz ("one tap to the quiz"
   is the plan's own recommendation).
9. **Regression baseline unverified.** The home-v3 rebuild dropped the lifecycle CTA and
   Company Gift widget; fixes went out 2026-07-15 but the trio hasn't been run since.
   → Run `REGRESSION.md` once *before* Step 01 so failures aren't misattributed.
10. **OT-10 video placeholders** — hero/cinematic sections still use placeholder sources;
    real brand films are also what the ads and archetype worlds need. → One asset
    pipeline: Camila's archetype-world shoot feeds both site and Reels.

## D. Launch-day and lifecycle plumbing not in any step

11. **No launch-day checklist.** The flip exists (`VITE_PRELAUNCH_MODE` in deploy.yml, per
    CAMILAS_UPDATES) but Oct 1 needs a sequence: flip → smoke test → regression trio →
    announcement email to the list → social posts → monitoring window + rollback
    criteria. → Write it in September; owner Dana.
12. **Customer transactional emails** (order confirmation, shipping notification) →
    now in scope item 5 of the new step 12 (payment capture) — resolved on paper,
    verify when 12 is finalized.
13. **Launch-announcement email to the list.** The whole July pipeline builds a
    1,200–2,000-person list for launch day, but no task drafts/schedules the Oct 1
    "we're open, here's your match" send and the founding-perk mechanics (48h, stated
    once, no countdown). → Add to 40_email-marketing, draft mid-Sept.
14. **B2B collision unresolved.** Company Gift subscriptions target Oct 1 too; the
    recommendation to slip B2B to Nov was never signed off. Two launches share checkout,
    email domain reputation, and Dana. → Make the call explicitly; if B2B slips, OT-13's
    cron jobs still need scheduling for existing redemptions.
15. **OT-5 (Firestore rule) and OT-2 (Cloud Scheduler for Liam SMS)** — small security/
    infra items that predate this plan and are still open; OT-13's two Company Gift cron
    jobs also remain unscheduled. → One 30-minute GCP session covers all of them.

## E. Marketing operations

16. **Camila's Claude marketing project isn't set up yet** (Companion §6 promises it) —
    it's also the natural place to draft welcome emails and captions. → Dana, ~1h, this
    month. Note the brand docs to load are in `misc/Brand Strategy & Visual Foundations
    Brief/` and the plan is now in `launch/`.
17. **Welcome-email drafting has no date.** "After Step 05" is a dependency, not a
    schedule, and Camila's editing pass needs lead time before the journey goes live in
    July's window. → Put M1/M2 on real dates once Step 05 lands.
18. **Meta invite expiry is a real deadline** — Camila's admin invite dies ~Aug 16, and
    the Facebook Page + Instagram connection block ad warm-up (~Aug 3). → Nudge Camila
    this week.
19. **Ad creative production is untracked.** Two ad angles, archetype-world Reels,
    carousels — all gated on Step 01's canon and on brand-approved visuals
    (`misc/design_documents/`). No shoot date, no asset list. → Camila plans the shoot
    once 01 deploys; the plan's "films and copy built on the real system" warning applies.
20. **Pricing gap is bigger than a workshop agenda item.** The site charges $38 today;
    the decided zone is $32–34; the plan's market reference was $18–24. Until the Aug 8
    workshop lands the number in the admin slot-price matrix, *the live site contradicts
    the plan*. Ads must not start before price and site agree.
21. **Legal review of privacy/terms** (Step 03 generates baseline text only) and the
    **Right Match Promise terms** (finalized Aug 8) need a professional pass before
    real ad spend scales. → Budget it; even a light review beats none.
22. **GA4 access for Camila** — only Dana has access; fine if Looker is the plan of
    record, but decide before she needs campaign-level GA4 exploration in August.

## F. Worth deciding, not urgent

23. **SEO basics** — Step 07 prerenders 5 share pages, but there's no sitemap/robots/meta
    pass for the rest of the site. Organic won't matter by Oct 1; cheap to add later.
24. **Support workflow** — hello@ forwards to Dana's Gmail; fine at launch scale, but
    define who answers what (match questions vs order problems) before the first
    Promise redemption arrives.
25. **Q4 gift hero content** (Dec 19–24 window) — Step 10 builds the machine; nobody owns
    the December creative yet. Revisit in October.
