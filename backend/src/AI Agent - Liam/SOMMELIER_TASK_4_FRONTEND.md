# Sommelier Task 4 — Frontend
## Liam Chat UI, Token Display, and Entry Points

**Depends on Task 2 being complete.** Before starting, verify all `/api/sommelier/*` and `/api/tokens/*` endpoints are live.

---

## Read these files first

1. `WHAT_WE_BUILT.md` — frontend stack, routing, design system
2. `frontend/src/app/components/FlavorQuiz.tsx` — quiz tie entry point
3. `frontend/src/app/components/Profile.tsx` — profile entry point
4. `frontend/src/app/components/CoffeesPage.tsx` — coffees entry point
5. `frontend/src/app/App.tsx` — routing
6. `frontend/src/app/lib/api.ts` — apiFetch helper
7. `frontend/src/app/context/AuthContext.tsx` — auth state

---

## Design system reminder

- Font: Genova — 100 Thin, 400 Regular, 900 Black only. No italic.
- Brand colors from `theme.css` — cream `#f2f1ea`, sage `#deded1`, rust `#a33726`
- Animations: motion/react (already installed)
- Components: shadcn/ui where already used

---

## 1. `Sommelier.tsx` — Liam chat interface

File: `frontend/src/app/components/Sommelier.tsx`

### Layout

```
┌──────────────────────────────────────────────────────┐
│  [Intent label]               [X Close]              │
│  Exploring today: [Crosshatch] [Nocturnal] [Feather] │
├──────────────────────────────────────────────────────┤
│                                                      │
│  [Liam bubble]                                       │
│  Hi, I'm Liam. Let's find your next coffee...        │
│                                                      │
│                        [User bubble — rust bg]       │
│                        I usually like dark coffee    │
│                                                      │
│  [Liam bubble]                                       │
│  Interesting — tell me more about...                 │
│                                                      │
├──────────────────────────────────────────────────────┤
│  3 of 8 turns · 14 tokens remaining                  │
│  ┌──────────────────────────────────┐  [Send →]      │
│  │ Ask Liam anything...             │                │
│  └──────────────────────────────────┘                │
└──────────────────────────────────────────────────────┘
```

### Chat bubbles

- **Liam (left):** white background, 1px rust border, rounded-lg. Small "Liam" name label above the first bubble only. Avatar: a minimal circular badge with "L" in Genova Black.
- **User (right):** rust background, white text, rounded-lg. No label.

### Status bar (above input)

Shows two pieces of information on one line, muted text:
- `"{N} of {max} turns"`
- `"{balance} tokens remaining"`

Color of turn counter shifts: grey → amber when 2 turns remain → rust on final turn. Color of token balance shifts: grey → amber when balance ≤ 3 → rust when balance = 0.

### Input bar

- Placeholder: "Ask Liam anything..."
- Enter to submit, Shift+Enter for newline
- Disabled and greyed when `sessionClosed === true` OR token balance = 0
- Loading state: Liam avatar pulses gently while awaiting response. Input disabled during request.

### Intent label (top-left)

Human-readable intent name in Genova Thin, muted color:
- `PROFILE_AMBIGUOUS` → "Discovering your profile"
- `RECOMMENDATION_MISS` → "Finding a better match"
- `TASTE_EVOLUTION` → "Recalibrating your taste"
- `DISCOVERY_SEEKER` → "Going somewhere unexpected"
- `CONVERSION` → "Taking the first step"
- `EXPLORATION` → "Exploring together"

### Coffee strip (below intent label)

"Exploring today:" followed by pill tags — one per coffee from `coffeeNames`. Hover shows roaster name as a tooltip.

### Session closed state

When `sessionClosed === true` (turn limit reached or user closed):
```
This conversation with Liam has ended.
[Start a new conversation →]
```

"Start a new conversation" calls `/api/sommelier/evaluate` then `/api/sommelier/start`.

### Out of tokens state

When `tokenBalance === 0` and session is still open:
```
You've run out of tokens.
Orders earn you more — or purchase tokens to continue.
[Get more tokens]
```

"Get more tokens" checks `config.tokenEconomy.purchaseEnabled`. If false: shows "Token purchases coming soon." inline (no navigation). If true (future): navigates to a purchase flow.

### Mobile layout

Full-screen. Coffee strip collapses to a single pill "4 coffees" that expands on tap. Status bar stacks vertically. Chat fills the screen with a sticky input bar at the bottom.

### On mount flow

```
1. Read URL params: ?entry= and ?tied=
2. Call GET /api/tokens/balance — store tokenBalance
3. Call POST /api/sommelier/evaluate with flags from URL params
4. If needsSommelier === false AND entry !== 'user_initiated': redirect to /coffees
5. Call GET /api/sommelier/sessions — check for resumable session
6. If resumable session found from < sessionResumeWindowHours hours ago:
     → show resume prompt (see below)
7. Otherwise: call POST /api/sommelier/start
8. Display opening message with fade-in animation (motion/react)
9. Focus input
```

### Resume prompt

Card displayed before chat loads when a resumable session exists:

> "You have an open conversation with Liam from {X} hours ago."
>
> [Resume conversation]  [Start fresh]

"Start fresh" calls `POST /api/sommelier/{sessionId}/close` on the old session, then opens a new one.

### Error states

| Error | Message |
|---|---|
| `insufficient_tokens` (402) | "You need tokens to chat with Liam. Orders earn you more." + "Get more tokens" button |
| `session_turn_limit_reached` (409) | Treat as session closed |
| Network error | "Something went wrong. [Try again]" with retry |

---

## 2. Quiz tie entry point — `FlavorQuiz.tsx`

After `POST /api/quiz/score` returns, check `tieDetected === true`.

Show a tie interstitial screen instead of the normal result:

```
Your taste sits right between
[Archetype A] and [Archetype B].

Some palates genuinely live on the border.
Liam, our coffee sommelier, can help you
figure out which fits you better.

[Talk to Liam →]

or [Just give me a recommendation]
```

"Talk to Liam" → `/sommelier?entry=quiz_tie&tied={ArchetypeA},{ArchetypeB}`

"Just give me a recommendation" → normal result flow with Balanced & Sweet fallback.

Use the existing result screen animation style for visual consistency.

---

## 3. Profile page entry point — `Profile.tsx`

In the profile overview tab, below the archetype display, add:

```
──────────────────────────────────
Chat with Liam, our Sommelier →
Personalized coffee guidance, powered by AI.
```

Below that, show the user's token balance: `"You have {N} tokens"`

**If balance > 0:** link navigates to `/sommelier?entry=user_initiated`
**If balance = 0:** link is muted with message "You're out of tokens — order coffee to earn more."

Token balance comes from `GET /api/tokens/balance`. Fetch this on profile page mount alongside the existing profile fetch (can run in parallel).

---

## 4. Coffees page entry point — `CoffeesPage.tsx`

Add "Ask Liam" button in the top-right of the coffee detail panel, near the ⇄ Compare toggle.

Style: outlined, rust border and text, small coffee cup icon from lucide-react.

- Balance > 0: navigates to `/sommelier?entry=user_initiated`
- Balance = 0: button is disabled, tooltip "Order coffee to earn sommelier tokens"

Fetch token balance via `GET /api/tokens/balance` on mount (in parallel with the existing user profile fetch).

---

## 5. `hasActiveSommelier` on profile response

**Backend change (small, add to Task 2 if not already done):**

Add `tokenBalance: number` to the `GET /api/users/profile` response. Query `user_tokens.balance` for this uid and include it. This allows profile-dependent components (Profile.tsx, CoffeesPage.tsx) to show the token balance without a separate API call if they've already loaded the profile.

If the profile is already fetched in a component, use `profile.tokenBalance`. Only fetch `GET /api/tokens/balance` separately in components that don't already have the profile loaded.

---

## 6. App.tsx routing

Add `/sommelier` route inside `PublicLayout`, requiring authentication:

```tsx
<Route
  path="/sommelier"
  element={
    <RequireAuth redirectTo="/sign-in?redirect=/sommelier">
      <Sommelier />
    </RequireAuth>
  }
/>
```

If `RequireAuth` doesn't already exist, create a simple wrapper that checks `AuthContext` and redirects if not authenticated.

---

## Bloom Dial frontend note

The Bloom Dial tables (`dial_coffee_relationships`, `dial_archetype_positions`, `dial_archetype_config`, `dial_position_vocabulary`) and views (`v_dial_positions`, `v_dial_navigation`) were created in June 2026. The customer-facing Bloom Dial navigation UI is a future frontend task — do not build it here. When ready, it will be added to `CoffeesPage.tsx` or a dedicated route using `v_dial_positions` and `v_dial_navigation`. No action needed in this task.

---

## Before you finish: update documentation

When all checklist items are done, append a summary to `SOMMELIER_BUILT.md` under "Issues and Decisions". Include: any auth guard implementation decisions, how the token fetch was optimized (profile-piggyback vs. separate call), mobile layout choices, and anything unexpected.

---

## What NOT to change

- Existing quiz flow (beyond the tie interstitial addition)
- Profile tabs other than overview
- The rest of `CoffeesPage.tsx`
- All admin pages

---

## Definition of done

- [ ] `Sommelier.tsx` — Liam persona, intent label, coffee strip, turn counter, token balance display, bubble styles, loading state, close state, out-of-tokens state, resume prompt, all error states
- [ ] Mount flow: token fetch → evaluate → resumable check → start/resume → opening message
- [ ] Mobile layout — coffee strip collapses, sticky input, full-screen chat
- [ ] Quiz tie interstitial — "Talk to Liam" CTA, archetype names shown, fallback option
- [ ] Profile page — "Chat with Liam" link + token balance display, empty-token state
- [ ] Coffees page — "Ask Liam" button, disabled when no tokens
- [ ] `tokenBalance` added to `GET /api/users/profile` response
- [ ] `/sommelier` route in `App.tsx` with auth guard
