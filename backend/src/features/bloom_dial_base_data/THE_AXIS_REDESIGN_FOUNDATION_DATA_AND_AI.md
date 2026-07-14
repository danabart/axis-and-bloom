# The Axis — Redesign Foundation: Data, Its Journey, and AI

**Purpose.** A base/starting point for rethinking what "The Axis" page is *about*. The proposal that motivates this doc: instead of the current page (a product explainer for the palate-matching engine), The Axis should be about **how we use data, how data travels through our development, and how AI reads it**. This document captures the conversation that built the Bloom Dial base data, because that conversation is a compact, real example of exactly that journey — raw, half-invented sensory data turned into a connected, AI-consumed, self-tightening model.

This is a synthesis of that working session, not a transcript. It's meant to be mined by a later session (or coworker) as the seed for the redesign. The concrete artifacts it refers to live in this same folder (`backend/src/features/bloom_dial_base_data/`).

---

## 1. The shift in thesis

**What The Axis says today** (`the_axis_page/THE_AXIS_PAGE_COPY.md`): "Black Box Transparency." A five-beat argument — origin isn't enough → we map your palate and every coffee onto one coordinate system → we match by multidimensional distance → a feedback loop keeps it accurate. It explains the *engine* as a finished product.

**What the proposal reframes it to:** not a finished engine, but a **living data system** — one you can watch capture, structure, connect, feed to AI, and refine. The story stops being "here is the machine that matches you" and becomes "here is how sensory reality becomes data, how that data travels and connects, where AI reads it, and how it learns." Same honesty of "black box transparency," but the subject is the *data organism and its lifecycle*, with AI as a first-class character rather than an unnamed "engine."

Why this is stronger: it's more defensible (it shows the work rather than asserting a result), more distinctive (few coffee brands can show a real data pipeline), and it's *true to how the product is actually built* — which the case study below demonstrates.

---

## 2. Case study — the Bloom Dial base data (this conversation)

A single working session that is the whole thesis in miniature. The arc:

- **Started from admittedly "made-up" data.** The goal wasn't perfection; it was to turn roaster notes and sparse cupping into a *real base to start from*, explicitly to be tuned after more cupping ("deploy now, tune later").
- **Structured it.** 29 coffees across two roasteries sorted into 5 sensory archetypes, each with a dial position on that archetype's dominant dimension (Acidity, Body, Bitterness, or Savory/Depth) and a named slot (Smooth→Lively, Classic→Full, etc.).
- **Connected it.** Built the hop graph: *Dial Turns* (moving within an archetype along its axis) and *Bridge Hops* (crossing to an adjacent archetype along a shared dimension). Isolated points became a navigable network.
- **Found the deeper model.** Realized the archetypes form a **graph** whose edges are dimension-labeled, and that a pair can share more than one edge. The pairs that need *several* edges (Chocolate&Nutty↔Earthy, Fruity↔Floral) turned out to be exactly the pairs the onboarding **quiz** already had to split with a branch question — data model and quiz UX describing the same adjacency.
- **Chose a placement philosophy.** "Spread for connectivity": with thin inventory, fill each dial's middle then push coffees to the edges so the map spans its full range and touches its neighbors now; tighten toward true cupped positions later.
- **Introduced seams.** One coffee can sit on more than one archetype's dial (a home position + guest positions at adjacent edges), welding the dials into one continuous space.
- **Verified the framework.** Confirmed the database schema already represents all of this (multigraph hops, multi-position coffees, category hops) — the only gaps were *infrastructure* (a missing write endpoint, a position endpoint that wipes multi-positions), not the data model.
- **Mapped it end to end** (Excel → DB tables → API → admin UI) and packaged the deployment as two Claude Code prompts.
- **Audited the logic** programmatically and fixed two real errors before shipping.

Every stage of that is a data-journey beat. The page could literally narrate this.

---

## 3. How data travels through our development (the spine of the new Axis)

The lifecycle the case study traces — this is the reusable backbone for the page:

**Capture — two streams meeting at a coordinate.** The *field/roaster* stream: origin, process, roast level and blend composition that travel farm → importer → roaster → us and land as metadata on each coffee, plus the roaster's own flavor descriptors (`roastery_descriptors`). The *measurement* stream: our cupping sessions scored 0–15 on the sensory dimensions, the onboarding quiz (a palate vector), and customer feedback (SMS replies to Liam, on-site ratings). Field and roaster data are where the journey *starts* and give context; the tasted coordinates themselves come from cupping — origin is the data's origin, not its target.

**Structure.** Raw scores become an *archetype assignment* and a *dial position* per coffee — a coordinate and a named place, not a tasting note. Vocabulary makes each position human-readable.

**Connect.** The hop graph (`dial_coffee_relationships`) links coffees along dimensions; the archetype graph is *derived* from those links (read the same graph at a coarser grain); seams stitch adjacent dials. Data stops being a list and becomes a traversable network. A guiding rule throughout: **derive, don't duplicate** — one source of truth, read at multiple granularities.

**Consume (where AI and the product read the map).** The quiz's branch logic, Liam's SQL-backed RAG walking `v_dial_navigation`, the recommendation engine, and the public pages (`v_dial_positions`, archetype adjacency) all read the *same* connected data.

**Refine (the loop).** Cupping scores feed a computed-position suggestion (`dialSuggestion`, `is_computed`); a multi-source signal design (`dial_position_signal`) will one day weight cupping, flavor-wheel, and feedback into consensus positions; customer feedback updates confidence. The map tightens itself as more data arrives — which is why "deploy now, tune later" is safe.

The single most page-worthy idea in here: **the same data is captured once and read everywhere, at different resolutions, by both humans and AI — and it gets more accurate the more the system is used.**

### Provenance — why the numbers are credible (and yes, we can cite SCA + WCR)

The sensory scale isn't invented; it inherits from published industry standards, and that lineage already exists in the codebase (`backend/src/features/sensory-source-provenance/`, with a `sensory_source` table and `coffee_dimensions.lexicon_attribute_id`). The through-line:

**WCR Sensory Lexicon 2.0 → SCA CVA Descriptive Assessment → our `coffee_dimensions` → the Bloom Dial.** The World Coffee Research Sensory Lexicon supplies the *vocabulary* (110 attributes, each with a physical reference standard on a 0–15 intensity scale); the SCA Coffee Taster's Flavor Wheel supplies the *grouping*; the SCA CVA Descriptive Assessment (2023) supplies the *scoring method* (0–15 intensity). Our dimensions adopt that 0–15 intensity construct at the aggregate-axis level and are linked back to their WCR attribute basis.

So the scale can be described, accurately, as: **0–15, coffee-relative calibration, WCR-aligned in method.**

**Honest-claim guardrail (matters because this may go on a public page):** say we're *aligned with / built on / calibrated to* the WCR Lexicon and SCA CVA — not "certified" or "accredited." One nuance to respect: WCR's Spectrum method uses *universal* cross-food reference standards, whereas "coffee-relative calibration" describes what we actually do (anchor within coffee's range). The defensible claim is that we use the WCR/SCA 0–15 intensity *approach and vocabulary*, calibrated to coffee — not that we operate a WCR-accredited lab. This provenance is itself a page-worthy asset: most coffee brands can't show where their numbers come from.

---

## 4. Where AI lives in the flow

- **Liam, the sommelier.** A SQL-backed RAG (not embeddings): before a session it queries the connected coffee graph and injects a structured catalogue into the model's context; different "focus types" traverse the hop graph for discovery vs. alternatives. Intent is classified from a feature vector against learned centroids; model routing and a token economy sit around it.
- **Computed positions.** Cupping deltas suggest where a coffee *should* sit on a dial; AraAI-assisted refinement replaces manual guesses as data accrues.
- **The build itself.** This very session used an AI agent to design the data model, audit it, and generate the deployment. The Axis page can be honest that AI is used *to build and tune the system*, not only to chat with customers.

---

## 5. What this could mean for the page (directions, not final copy)

Reframe the existing five beats toward the data journey:

- **The Data Journey** — capture → structure → connect → consume → refine, as the page's spine (replaces the current linear "inputs → engine → loop").
- **How a coffee earns its coordinates** — from roaster note and cupping to a position on a dial (makes "Capture/Structure" concrete).
- **The graph beneath the dial** — show that coffees are a connected network, not a shelf; the archetype spines (intensity, brightness, delicacy) and how you move along them.
- **Where AI reads the map** — name Liam and the RAG; show AI traversing the graph rather than an anonymous "engine."
- **The system that tightens itself** — the feedback/cupping loop, and why the map is deliberately provisional and improving.

Tone stays accessible; the difference is that *data and its motion* are the protagonist, and AI is named, not hidden. Visualization opportunities: the pipeline flow; the archetype graph with its spines; the hop network lighting up; the feedback loop as a cycle.

---

## 6. Threads to mine (index for the next session)

- Artifacts in this folder: `Bloom_Dial_Base_Data.xlsx` (the model), `Bloom_Dial_Base_Data_Reasoning.md`, `Bloom_Dial_Deployment_Mapping.md`, and the two `CLAUDE_CODE_PROMPT_...` deployment prompts.
- Key models coined here: **spread-for-connectivity** placement; **archetype-as-graph** with multi-dimensional edges; **seam/guest positions**; **deploy-before-cupping**; the observation that **multi-edge archetype pairs == the quiz's branch questions**.
- Verified framework facts: the schema already supports the whole model; the only gaps are infrastructure (hop-write endpoint; multi-position support for seams). Adjacency is derived, not stored.
- Related existing docs: `the_axis_page/THE_AXIS_PAGE_COPY.md` (current page), `SOMMELIER_BUILT.md` + `BLOOM_DIAL_ALLOCATION_SPEC.md` (how Liam and the dial actually work), `quizes/CLAUDE_CODE_PROMPT_QUIZ_V7.md` (branch logic).

---

## 7. Open questions for the redesign

- How much of the *machinery* (tables, RAG, computed positions) should be visible to a customer vs. abstracted? The current page hides it; the proposal leans toward showing more — where's the line?
- Is The Axis a marketing page, a trust/credibility page, or a living dashboard that actually reflects current data? Each implies a different build.
- Does "AI usage" mean explaining Liam to customers, or a broader statement about AI in how the whole system is built and tuned? (This doc assumes the broader read.)
- Where should this foundation doc live long-term — here, or moved into `the_axis_page/`?
