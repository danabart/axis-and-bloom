# usual_drink

Usual Drink: what a customer drinks at home, the coffee in their kitchen and how they feel about it, captured as brew-profile facts beside the quiz. Spec and reviews: `REVIEW_SPEC.md` (Rev 4); Rev 1 and Rev 3 of the brief and Rev 1 of the spec are kept under `SUPERSEDED_` and were never run.

Brief plan (one Claude Code run each, push = deploy, test mode):

1. `CLAUDE_CODE_PROMPT_USUAL_DRINK_1_CAPTURE.md` (Rev 4, written 2026-11-12; Sonnet). Capture only: three fields (`usual_drink`, `cupboard_coffee`, `coffee_feeling`) asked on an optional post-result card, on the Profile page and by Liam when empty; brew-profile field definitions move from Firestore config, CHECK lists and TS unions into `brew_*` lookups; nothing in matching, the map, the dial or Liam's recommendation reads them. Task 0 done 2026-11-12 (four questions, answered by Dana the same day). **Ran 2026-11-12:** `CLOSING_REPORT_1.md`, `WHAT_WE_BUILT.md` #271.

What comes after (OPEN_TASKS OT-127 to OT-133): the feeling in the first match (a map brief), drinks against the roaster's brew method, home ZIP on the same card, partner brand links, pod and buy-out follow-ups.
