# Note: future "flavor intelligence" page is relevant to Liam (not implemented here)

Context note, not a spec — captured while planning The Bloom page (see `backend/src/features/the_bloom_page/CLAUDE_CODE_PROMPT_THE_BLOOM.md`), because Dana flagged it as something that should be on Liam's radar too, for whoever picks up Liam-side work next.

## The idea

Dana's direction: `/coffees` should eventually evolve into a richer, secondary "flavor intelligence" destination — more statistics, more SCA (Specialty Coffee Association) descriptor detail — that customers reach only if they want to go deeper. It won't be part of the primary Axis/Bloom browsing flow; it's an opt-in page for people who want the full technical picture behind a coffee (this is the same Collaborative Flavor Wheel content `/coffees` already shows today, just deeper).

## Why it's relevant to Liam

Liam already has RAG context that touches the flavor/dial data (`dial_coffee_relationships`, cupping data, etc. — see `SOMMELIER_TASK_2_BACKEND.md` and related docs in this folder). If a customer asks Liam something that goes deeper than a quick recommendation — wants to understand *why* a coffee scores the way it does, or wants the full sensory breakdown — Liam may be a natural place to surface a pointer to this future flavor-intelligence page, the same way The Bloom will link to it from a coffee's notes.

## Not done anywhere yet

- The enhanced `/coffees` flavor-intelligence page itself doesn't exist — `/coffees` today is the current, simpler version.
- Liam doesn't currently link out to `/coffees` or reference it as a "go deeper" destination in conversation.
- No decision has been made on exact copy, trigger conditions, or whether this belongs in Liam's system prompt / RAG context at all — this is a raw idea, not a scoped task.

Pick this up alongside whatever session eventually builds out the enhanced `/coffees` page (see Decision #9 in the Bloom prompt).
