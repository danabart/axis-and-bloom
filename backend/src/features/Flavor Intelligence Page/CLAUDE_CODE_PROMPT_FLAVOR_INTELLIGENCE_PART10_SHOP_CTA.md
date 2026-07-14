# Flavor Intelligence Page — Part 10: missing purchase path from a coffee's detail panel

Parts 1–9 (this same folder) are live. Dana's feedback: *"we are missing add to cart button. or go to the bloom page."* Right now, looking at any specific coffee on this page, there's no way to act on it — no purchase path at all.

## Decision: link to The Bloom, don't build cart/checkout on this page

Dana offered two options; recommending the link, not a real add-to-cart integration, for reasons grounded in how this page and The Bloom have been deliberately scoped against each other throughout this whole build:
- Part 2 Decision #2 explicitly established this page's job as exploration/education, "not primarily conversion" — checkout, pricing, and weight/quantity selection all deliberately live on The Bloom.
- The Bloom's cart is a shared `CartContext` (Bloom Part 5) wrapping `/bloom` and `/find-my-flavor` specifically — pulling this page into that cart flow would mean adding `CartProvider` here, replicating price-per-weight selection UI, and duplicating checkout logic that already exists and is already tested elsewhere. That's a much bigger, riskier change than what this feedback is actually asking for (a way to act on what you're looking at).
- The existing "Shop your match on The Bloom →" link (Part 2 Decision #2, in the personalized header) already established this exact pattern — this Part just extends it to every coffee's own detail panel, not only the personalized header.

If Dana wants real in-page purchasing later, that's a bigger, separate scoping conversation — this Part assumes the link is the right call for now. Flag it back if not.

## Fix, in `FlavorIntelligencePage.tsx`

Add a "Shop on The Bloom →" link to the selected coffee's detail panel header — next to the existing "⇄ Compare" toggle (`selectedSlotData` block, where `selectedArchData.archetype` and `selectedSlot` are both already in scope):

```tsx
<Link
  to={`/bloom?archetype=${selectedArchData.archetype}&slot=${selectedSlot}`}
  className="text-xs px-3 py-1.5 rounded-full border transition-all duration-200"
  style={{ borderColor: '#b05642', color: '#b05642', backgroundColor: '#fff8f5' }}
>
  Shop on The Bloom →
</Link>
```
Placed alongside the compare toggle, not replacing it — a customer should be able to compare and shop from the same header. Unlike the personalized header's stage-gated "Shop your match" link (Decision #2 — no shop CTA for `SUBSCRIBER`/`REORDER_DUE`), **this one shows for every coffee, regardless of lifecycle stage** — it's about the coffee currently being looked at, not a personalized nudge, so the same UC-based suppression logic doesn't apply here. Show it in compare mode too, or hide it there (Claude Code's call, whichever avoids crowding the compare header) — not a hard requirement either way.

**Verify `/bloom` actually supports `?archetype=&slot=` as a deep link before treating this as done.** This build established `?archetype=&slot=` as the *Flavor Intelligence* deep-link contract (Part 1 Decision #4) — check whether The Bloom's own routing (`App.tsx`, `BloomPage.tsx`) reads and acts on the same params (scrolling to / expanding that specific archetype section) or just ignores them and lands on the default view. If Bloom doesn't support it yet, this link should still work (falling back to a plain `/bloom` landing), but flag that as a known gap for whoever picks up Bloom next — a customer clicking "Shop on The Bloom" from a Floral coffee landing on Bloom's default top-of-page view instead of that Floral section is a real, if minor, letdown worth fixing on Bloom's side eventually.

## Testing

- Every coffee's detail panel now shows a "Shop on The Bloom →" link, not just the personalized "Your match" header.
- Click it from a few different archetypes: confirm it navigates to `/bloom` with the right query params, and note (don't silently assume) whether Bloom actually lands on that specific section or just the default view.
- Confirm it renders correctly alongside the compare toggle, in both normal and compare mode, without crowding the header on a narrow viewport.
