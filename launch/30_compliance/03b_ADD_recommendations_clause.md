# Step 03b — ADD: "Nature of Recommendations" clause to the Terms

> Workstream: compliance · Model: Sonnet · Depends on: step 03 deployed (/terms exists) · Written 2026-07-20 (clause text Dana-approved). Pure content addition — one session, tiny diff.

CONTEXT: The /terms page (built by step 03) covers e-commerce basics and the Right Match
Promise placeholder, but nothing limits expectations about matching accuracy. Dana wants
a clause making clear the matching is statistical and probabilistic and not a guarantee —
professionally worded, without undermining the brand.

TASK — one addition to the /terms page:

Insert the following section, VERBATIM, **immediately before the Right Match Promise
section** (so the caveat and the remedy read as a pair). Match the page's existing
heading/typography conventions; change no other content.

> **Nature of Recommendations.** Axis & Bloom matches coffees to people using
> statistical models of taste similarity, based on your quiz responses and, over time,
> the feedback you share. Taste is personal and subjective; our recommendations
> represent a considered estimate of what you are likely to enjoy — not a guarantee
> that you will. Individual results vary, and a recommended coffee may differ from your
> expectations. Recommendations are provided for informational purposes, "as is," and
> do not constitute a warranty of fitness for your individual preferences. Our matching
> system improves continuously; the more feedback you provide, the more precisely it
> reflects your taste. If your first match isn't right, the Right Match Promise below
> describes exactly what we'll do about it.

HARD BOUNDARIES:
- Only this insertion on /terms. No changes to /privacy, the consent banner, footer
  links, or any other page or copy.
- Do NOT use the word "beta" or describe the product as unfinished anywhere — this
  clause lives in the Terms only; product UI keeps relying on the Right Match Promise
  framing.
- If the Terms content lives in a constants/content file, edit it there once; do not
  fork a second copy of the page.

ACCEPTANCE:
1. /terms renders the new section verbatim, directly above the Right Match Promise
   section, styled consistently with the rest of the page.
2. Diff touches only the Terms content (show the diff).
3. Standing trio (`../REGRESSION.md`) still passes.
