# The Bloom — build index

This build was split into two sequential Claude Code prompts, in this same folder, to be run in order:

1. **`CLAUDE_CODE_PROMPT_THE_BLOOM_PART1_BACKEND.md`** — schema (`dial_slot_price`), the five new/modified roaster-blind backend endpoints, and a testing task verifying them against real data before Part 2 starts.
2. **`CLAUDE_CODE_PROMPT_THE_BLOOM_PART2_FRONTEND.md`** — `BloomPage.tsx` itself, routing/nav, and a testing task covering the full page (assumes Part 1 is already live).
3. **`CLAUDE_CODE_PROMPT_THE_BLOOM_PART3_DIAL_AND_FIXES.md`** — post-launch fixes from Dana's first review: the stock-check bug that made every coffee show as unavailable, replacing the stacked position-card list with a generalized version of Camila's existing Bloom Dial wheel component, and per-user personalization of the dial's starting position. Assumes Parts 1 and 2 are live.
4. **`CLAUDE_CODE_PROMPT_THE_BLOOM_PART4_POLISH.md`** — a second round of post-launch fixes from Dana's review of the Part 3 build: a "Talk to Liam" link (in-card and a persistent floating button), dial size/legibility, removing the "DIMENSION:" label, a "Personalize your archetype" tag, and fixing the revealed profile panel rendering too narrow. Assumes Parts 1–3 are live.
5. **`CLAUDE_CODE_PROMPT_THE_BLOOM_PART5_REUSE_ON_QUIZ.md`** — **on hold, do not run yet.** Extracts Bloom's archetype section into a shared, reusable component and embeds it on both Find My Flavor screens, lifts the cart to be app-wide/shared, and adds an order-feedback prompt. Paused so Part 6's visual fixes land first.
6. **`CLAUDE_CODE_PROMPT_THE_BLOOM_PART6_ROW_BALANCE.md`** — fixes the photo/dial/card row height imbalance visible in Dana's screenshot (`Capture.JPG`, same folder) and the resulting gap before the reveal panel. May or may not have been run — see Part 7.
7. **`CLAUDE_CODE_PROMPT_THE_BLOOM_PART7_BAG_REPOSITION.md`** — the gap persisted (`Capture3.JPG`, same folder) — this moves the coffee bag from under the dial to sit between the dial and card instead, giving the row a shorter, more predictable height to size the photo against. Supersedes Part 6 where they overlap.
8. **`CLAUDE_CODE_PROMPT_THE_BLOOM_PART8_FIXES.md`** — four fixes: the bag ended up too small after Part 7, both "Talk to Liam"/"flavor intelligence" CTAs weren't reading clearly, the flavor-intelligence link didn't deep-link to the actual coffee, and a "price includes shipping" note was missing. Assumes Parts 1–4 and 7 are live.
9. **`CLAUDE_CODE_PROMPT_THE_BLOOM_PART9_ROW_POLISH.md`** — current priority. Three related fixes: the card is now too narrow (text/buttons wrapping) after the bag took its width, the "Temporarily unavailable" state looks broken rather than designed, and the photo column needs a fixed height instead of one relative to its neighbors, since that only worked for the active-card case. Assumes Parts 1–4, 7, and 8 are live.

Each file is fully self-contained (context, decisions log, out-of-scope list, checklist) so any of them can be handed to Claude Code on its own, in order — each part assumes the previous ones are already deployed.

Related, but not part of this build:

- `IMAGE_PERFORMANCE_FINDINGS.md` (this folder) — deferred image/CDN performance write-up, not scheduled.
- `../ai_agent_liam/NOTE_FLAVOR_INTELLIGENCE_PAGE.md` — a context note (not a spec) on how the future "flavor intelligence" page concept relates to Liam.
