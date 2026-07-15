# Claude Code Prompt — Homepage (home-v3) regression fixes + nav mobile fix

## Context (read before starting)

Camila's `feat(home-v3)` rebuild (commits `23076f5` "§1–§9 full homepage rebuild" and `ce208ab` "gift unwrap" — 2026-07-14/15) replaced `frontend/src/app/components/Home.tsx` wholesale. The commit message for `23076f5` says outright: **"Removed: flavor-map cards, old curtain quiz band, stageCode CTA"**. Two real features were dropped as a side effect of the visual rebuild, not intentionally deprecated:

1. **Lifecycle-aware signed-in CTA** (`renderSignedInCTA()` / `renderStageCTA()`, built in #73/#74, `backend/src/features/customer_life_cycle/1_CLAUDE_CODE_PROMPT_CUSTOMER_STATE.md` + `2_CLAUDE_CODE_PROMPT_LIFECYCLE_FEEDBACK_FIX.md`). Every signed-in visitor — regardless of lifecycle stage (subscriber, reorder-due, lapsed, quiz-taken-no-order, etc.) — now sees the same generic anonymous "Whose palate are we profiling today? / Your name / Begin →" form in §2. This is the exact bug #73 was originally written to fix, reintroduced by the rebuild.
2. **Company Gift code redemption** (`CompanyGiftRedemption.tsx`, B2B Company Subscriptions feature, `backend/src/features/b2b_company_subscriptions/`). The component still exists and its backend/API (`lookupCompanyGiftCode`, `redeemCompanyGiftCode` in `frontend/src/app/lib/api.ts`) is untouched and live — it was just deleted from `Home.tsx`'s JSX, so there is currently no way for anyone to redeem a company gift code from the homepage.

Also found while auditing this page: **Navigation.tsx has no mobile menu.** The nav links (`THE AXIS`, `THE BLOOM`, `HOW IT WORKS`, `FIND MY FLAVOR`, `FLAVOR INTELLIGENCE`, `ABOUT`, `SHOP`) are wrapped in `<div className="hidden md:flex">` with **no hamburger/mobile fallback at all** — below the `md` breakpoint every link in that row simply disappears; only the logo, profile icon, and cart icon remain. This has existed since `207c0ad` (pre-dates the home-v3 rebuild) but is a real cross-page bug, not homepage-specific.

**Ground rule for all of this: do not change the position, order, or visual design of any home-v3 section.** The goal is purely to re-enable functionality that regressed, fit into the *current* v3 visual language (colors, fonts, section rhythm) — not to revert to the pre-rebuild layout or restyle anything Camila designed.

---

## Part 1 — Restore lifecycle-aware CTA in §2 ("The Question")

**File:** `frontend/src/app/components/Home.tsx`

Currently §2 (search for `━━━ §2 THE QUESTION ━━━`) always renders the same anonymous name-capture form (headline "Whose palate are we profiling today?", name input, "Begin →" link, "Sign in" link) regardless of auth state.

**Change:** keep the section wrapper, padding, and everything else about §2 exactly as-is. Inside it, branch on `user` (from `useAuth()`, already imported):

- **`!user`** (signed out): keep the current JSX completely unchanged — same headline, input, Begin →, Sign in.
- **`user`** (signed in): replace that block with a lifecycle-driven CTA, restyled to match §2's current look (centered column, `#9a2918` terracotta headline color, `#45474a` body gray, `#ee5974` pink for any highlighted word, `'Lato', Arial, sans-serif` font, same heading scale as the current `clamp(26px,3.2vw,42px)` h2) instead of copying the old two-column dark-mode styling verbatim.

Restore the following state/logic that existed before the rebuild (reference: `git show 23076f5^:frontend/src/app/components/Home.tsx`), adapting variable names to whatever already exists in the current file:

```ts
import OrderFeedbackForm from './OrderFeedbackForm';

// Mirrors FEEDBACK_NAG_SUPPRESS_DAYS in backend/src/services/userLifecycle.ts —
// how long the feedback nudge stays hidden after a user dismisses it.
const FEEDBACK_NAG_SUPPRESS_DAYS = 14;
```

The current file already has:
```ts
const [homepageState, setHomepageState] = useState<HomepageState | null>(null);
useEffect(() => {
  if (!user) { setHomepageState(null); return; }
  getHomepageState().then(setHomepageState).catch(() => setHomepageState(null));
}, [user]);
```
Extract the fetch into a named `refreshHomepageState` function (not just an inline effect callback) so Part 2 below can call it as a callback after a successful gift-code redemption. Add back:
```ts
const [homepageStateLoading, setHomepageStateLoading] = useState(false);
const [feedbackDismissed, setFeedbackDismissed] = useState(false);

const refreshHomepageState = () => {
  if (!user) { setHomepageState(null); return; }
  setHomepageStateLoading(true);
  getHomepageState()
    .then(setHomepageState)
    .catch(() => setHomepageState(null))
    .finally(() => setHomepageStateLoading(false));
};

useEffect(refreshHomepageState, [user]);

useEffect(() => {
  const orderId = homepageState?.pendingFeedback?.orderId;
  if (orderId) {
    const key = `axisBloomFeedbackDismiss_${orderId}`;
    const dismissedAt = localStorage.getItem(key);
    const suppressed = !!dismissedAt && Date.now() - Number(dismissedAt) < FEEDBACK_NAG_SUPPRESS_DAYS * 86400000;
    setFeedbackDismissed(suppressed);
  } else {
    setFeedbackDismissed(false);
  }
}, [homepageState]);
```

Restore `renderSignedInCTA()` and `renderStageCTA()` with the same behavior as before the rebuild (full logic below — port the copy and per-stage branching, but restyle to §2's current visual tokens rather than the old dark hero-adjacent styling):

```tsx
function renderSignedInCTA() {
  if (homepageStateLoading || !homepageState) return null;
  const { stageCode, archetype, pendingFeedback, usualBlend, nextDeliveryDate } = homepageState;

  const feedbackNudge = pendingFeedback && !feedbackDismissed ? (
    <div /* restyle to §2 tokens, keep centered like the rest of §2 */>
      <p>How was {pendingFeedback.blendName ?? 'your coffee'}?</p>
      <OrderFeedbackForm
        orderId={pendingFeedback.orderId}
        blendName={pendingFeedback.blendName}
        onSubmitted={() => setFeedbackDismissed(true)}
      />
      <button
        type="button"
        onClick={() => {
          localStorage.setItem(`axisBloomFeedbackDismiss_${pendingFeedback.orderId}`, String(Date.now()));
          setFeedbackDismissed(true);
        }}
      >
        Not now
      </button>
    </div>
  ) : null;

  return (
    <>
      {feedbackNudge}
      {renderStageCTA(stageCode, archetype, usualBlend, nextDeliveryDate)}
    </>
  );
}

function renderStageCTA(
  stageCode: string,
  archetype: HomepageState['archetype'],
  usualBlend: HomepageState['usualBlend'],
  nextDeliveryDate: HomepageState['nextDeliveryDate']
) {
  if (stageCode === 'NEW_NO_QUIZ') {
    return (<>
      <p>Ready to find your flavor?</p>
      <Link to="/find-my-flavor">TAKE THE QUIZ →</Link>
    </>);
  }
  if (stageCode === 'QUIZ_TAKEN_FRESH_NO_ORDER' || stageCode === 'QUIZ_TAKEN_SETTLED_NO_ORDER' || stageCode === 'QUIZ_STALE_NO_ORDER') {
    return (<>
      <p>You're a {archetype?.name ?? 'match'} — shop your matches.</p>
      <Link to="/shop">SHOP YOUR MATCHES →</Link>
      {stageCode === 'QUIZ_TAKEN_SETTLED_NO_ORDER' && <Link to="/find-my-flavor">Retake the quiz →</Link>}
      {stageCode === 'QUIZ_STALE_NO_ORDER' && <Link to="/find-my-flavor">Palates change — retake anytime →</Link>}
    </>);
  }
  if (stageCode === 'SUBSCRIBER') {
    return (<>
      <p>Your subscription is on track.</p>
      {nextDeliveryDate && <p>Next shipment: {new Date(nextDeliveryDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</p>}
      <Link to="/profile">MANAGE SUBSCRIPTION →</Link>
    </>);
  }
  if (stageCode === 'REORDER_DUE') {
    return (<>
      <p>Ready for more {usualBlend?.name ?? 'your usual'}?</p>
      <Link to="/shop">REORDER →</Link>
    </>);
  }
  if (stageCode === 'LAPSED_SINGLE_ORDER') {
    return (<>
      <p>New arrivals since your last order.</p>
      <Link to="/shop">SEE WHAT'S NEW →</Link>
    </>);
  }
  // ACTIVE_REPEAT_USER and any other fallback
  return (<>
    <p>Welcome back.</p>
    <Link to="/shop">SHOP AGAIN →</Link>
  </>);
}
```

Full stage list and exact copy/thresholds are documented in `backend/src/features/customer_life_cycle/1_CLAUDE_CODE_PROMPT_CUSTOMER_STATE.md` and `2_CLAUDE_CODE_PROMPT_LIFECYCLE_FEEDBACK_FIX.md` if anything above is ambiguous — treat those as the source of truth for stage codes and copy, this prompt as the source of truth for *where it goes and how it should look now*.

`GET /api/users/homepage-state` (backend) is untouched — no backend work needed for this part.

---

## Part 2 — Restore Company Gift code redemption

**File:** `frontend/src/app/components/Home.tsx`

Before the rebuild this rendered as its own compact band directly below the profile/CTA section, above the Collection section:
```tsx
import CompanyGiftRedemption from './CompanyGiftRedemption';
...
<section style={{ backgroundColor: '#f2f1ea', borderTop: '1px solid rgba(154,41,24,0.12)', borderBottom: '1px solid rgba(154,41,24,0.12)', padding: '18px clamp(32px,5vw,56px)' }}>
  <CompanyGiftRedemption onRedeemed={refreshHomepageState} />
</section>
```

**Change:** re-add this as a new compact section immediately after the current `§2 THE QUESTION` section and before `§3 PULL QUOTE` (i.e., in the same relative position it held before — directly following the profile/CTA block, ahead of everything else). Do not insert it anywhere else and do not merge it into §2 or §3's own padding/background — it should read as its own thin low-key band, matching the border/padding treatment above (adapt colors to whatever §2/§3 currently use if `#9a2918`-based rgba borders read as visually inconsistent, but keep it compact — this is deliberately not a hero element).

`CompanyGiftRedemption.tsx` itself is untouched and does not need any changes — it already handles code lookup, redemption, sign-in gating, and error states via `lookupCompanyGiftCode`/`redeemCompanyGiftCode` in `frontend/src/app/lib/api.ts` (both still live, no backend changes needed).

---

## Part 3 — Fix Navigation.tsx: no mobile menu at all

**File:** `frontend/src/app/components/Navigation.tsx`

Today, the middle nav-links `<div className="hidden md:flex" ...>` (THE AXIS, THE BLOOM, HOW IT WORKS, FIND MY FLAVOR, FLAVOR INTELLIGENCE, ABOUT, SHOP, and ADMIN if `isAdmin`) is simply hidden below the `md` Tailwind breakpoint with **no replacement** — mobile visitors only ever see the logo lockup and the profile/cart icons in the nav bar. There has never been a hamburger menu built for this nav (confirmed via `git log -S"md:hidden"` / `-S"hidden md:flex"` on this file — the hidden div was added in `207c0ad` and never paired with a mobile alternative).

**Change:** add a mobile menu:
- Add a hamburger icon button (`lucide-react` is already a dependency — use e.g. `Menu`/`X` icons, consistent with the existing `ShoppingCart`/`User` icon usage) visible only below `md` (`className="md:hidden"`), placed where it reads naturally in the existing icon cluster on the right (before or after the cart icon — your call on what looks least cramped).
- Clicking it toggles a full-width dropdown or slide-in panel (simplest: an absolutely-positioned panel directly below the 46px nav bar, `background-color: #f2f1ea`, listing the same links currently in the `hidden md:flex` div, each full-width/stacked, same `LINK` style object already defined in this file) plus Sign out (if `user`) mirroring the existing desktop behavior.
- Close the panel on route change (mirror the existing `useEffect(() => setHeroVisible(pathname === '/'), [pathname])` pattern — add a similar reset for the mobile menu's open state keyed on `pathname`) and on selecting a link.
- Respect the existing `heroVisible` transparent/solid nav logic — the hamburger icon itself should use `linkColor` (already computed) so it's visible against both transparent-over-hero and solid states, same as the existing icons.
- This is a site-wide `Navigation.tsx` fix, not homepage-specific — verify it doesn't regress the existing desktop `md:flex` layout on any page.

---

## Part 4 — Note for Camila: design changes must account for the customer lifecycle feature

**File:** `CAMILAS_UPDATES.md`

Add a short, prominent standing note near the top of the file (directly under the `# Camila's Updates — Axis & Bloom` header, before "How to Deploy"), along these lines (adapt wording/formatting to match the file's existing tone, don't just paste verbatim):

> **⚠️ Before redesigning the homepage (or any page with `GET /api/users/homepage-state` personalization):** this site has a customer lifecycle feature (`user_lifecycle_stage` — see `backend/src/features/customer_life_cycle/`) that changes what signed-in users should see based on where they are (new visitor, quiz taken but no order, subscriber, reorder due, lapsed, etc.), plus a Company Gift code redemption widget (`CompanyGiftRedemption.tsx`). Full redesigns have twice dropped these as an unintended side effect of visual rebuilds (2026-07-07 bug fixed in #73/#74, then reintroduced by the 2026-07-14/15 home-v3 rebuild). When redesigning a page that currently has lifecycle-aware content, please either preserve the branch logic (`renderSignedInCTA`/`renderStageCTA` pattern in `Home.tsx`) in the new design, or flag explicitly in the commit/PR that it's being intentionally dropped so it can be re-scoped rather than silently lost again.

---

## Verification checklist

- [ ] Signed-out visitor on `/` still sees the exact current §2 name-capture form, unchanged.
- [ ] Signed-in visitor sees a stage-appropriate CTA in §2 instead of the name-capture form, for each of: `NEW_NO_QUIZ`, `QUIZ_TAKEN_FRESH/SETTLED/STALE_NO_ORDER`, `SUBSCRIBER`, `REORDER_DUE`, `LAPSED_SINGLE_ORDER`, `ACTIVE_REPEAT_USER`, and a pending-feedback case layered on top of a real stage.
- [ ] Company Gift redemption band appears directly below §2, above §3, for all visitors (signed in or not — the component itself handles the sign-in gate internally).
- [ ] No other section (§1, §3–§10) changed position, order, or styling.
- [ ] `vite build` is clean.
- [ ] Nav on a mobile viewport (< 768px) shows a working hamburger that opens all the links currently hidden, and closes on navigation.
- [ ] Desktop nav (≥ 768px) is visually unchanged.
- [ ] `CAMILAS_UPDATES.md` has the new standing note near the top.
