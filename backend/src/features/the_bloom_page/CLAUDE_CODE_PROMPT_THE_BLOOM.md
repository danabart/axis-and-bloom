# The Bloom — build index

This build was split into two sequential Claude Code prompts, in this same folder, to be run in order:

1. **`CLAUDE_CODE_PROMPT_THE_BLOOM_PART1_BACKEND.md`** — schema (`dial_slot_price`), the five new/modified roaster-blind backend endpoints, and a testing task verifying them against real data before Part 2 starts.
2. **`CLAUDE_CODE_PROMPT_THE_BLOOM_PART2_FRONTEND.md`** — `BloomPage.tsx` itself, routing/nav, and a testing task covering the full page (assumes Part 1 is already live).

Each file is fully self-contained (context, data model recap, decisions log, out-of-scope list, checklist) so either can be handed to Claude Code on its own — Part 2 just requires Part 1 to be done first, since it depends on those endpoints existing.

Related, but not part of this build:

- `IMAGE_PERFORMANCE_FINDINGS.md` (this folder) — deferred image/CDN performance write-up, not scheduled.
- `../ai_agent_liam/NOTE_FLAVOR_INTELLIGENCE_PAGE.md` — a context note (not a spec) on how the future "flavor intelligence" page concept relates to Liam.
