# Flavor Intelligence Page — Part 11: rename the "Customer feedback" source label to "Community notes"

Parts 1–10 (this same folder) are live. Small copy fix, confirmed with Dana: the third of the three descriptor sources — feedback from people who actually received and drank the coffee at home — is currently labeled "Customer feedback." Dana doesn't want the word "customer" used here. New label: **"Community notes."**

## Two places this needs to change, not one

`SOURCE_LABEL` in `coffee-info/CollaborativeFlavorWheel.tsx` is the shared constant (`client: 'Customer feedback'` → `client: 'Community notes'`) — this covers the bars section's legend.

**But `TastingNotes.tsx`'s "Three voices" block does not import this constant** — it has its own separate, hardcoded copy of the same three labels:
```tsx
{['Internal cupping', 'Roastery notes', 'Customer feedback'].map((label, i) => {
```
If only `SOURCE_LABEL` is fixed, this page will show "Community notes" in the descriptor bars section and "Customer feedback" in the Three Voices section right above it — the same underlying source, two different names, on the same page. Fix both:

1. `CollaborativeFlavorWheel.tsx`: `SOURCE_LABEL.client` → `'Community notes'`.
2. `TastingNotes.tsx`: **don't just patch the hardcoded string in place — import and use `SOURCE_LABEL` from `CollaborativeFlavorWheel.tsx` instead of maintaining a second, separate copy of the same three labels.** This exact bug (two lists that were supposed to be one, quietly drifting apart) is why this inconsistency existed in the first place; leaving the duplicate in place just means the next label change has the same risk. Replace the hardcoded array with `Object.entries(SOURCE_LABEL)` (or similar), keeping the same three-dot-and-label rendering, sourced from one place.

## Testing

- Confirm both the "Three voices" section (`TastingNotes.tsx`) and the Collaborative Flavor Wheel legend/bars (`CollaborativeFlavorWheel.tsx`) now say "Community notes," not "Customer feedback," and that they match each other.
- Confirm `/bloom`'s use of `TastingNotes.tsx` (via `RevealedPanel.tsx`) also picks up the new label — shared component, same as Parts 5 and 7.
- Grep the frontend once more for any other literal "Customer feedback" string this might have missed.
