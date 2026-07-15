# Refine: The Axis V2 page — round 1 (Dana's review, 2026-07-14)

Context: the V2 build (`CLAUDE_CODE_PROMPT_THE_AXIS_V2.md`) is live and structurally correct. Four refinements from review. All competitive-safety rules from the V2 prompt still apply unchanged.

Files touched: `frontend/src/app/components/axis/AxisMap.tsx`, possibly `frontend/src/app/components/TheAxis.tsx`. No backend changes.

---

## 1. Archetype labels visible from the Hero (state 0)

Currently region labels only render at state 2 (Structure). The hero's circles read as anonymous blobs.

- Render the five archetype name labels in **every state, including state 0** — small, muted (same style currently used in state 2, but at reduced opacity ~0.5 in states 0–1, full label opacity from state 2 on).
- Labels use each archetype's color token, not gray.
- Do NOT add a world map, geography, or any origin imagery to the hero/map identity — the map is flavor space, not geography (strategy §1: origin is the start of the data, not the destination).

## 2. Capture state (1): make the field/origin stream literal

The two converging streams are currently abstract dotted arcs. Give the *field stream* visible origin character so the journey visibly starts at the farm:

- Left/upper stream = **field stream**: 2–3 dotted arcs entering from off-canvas, each carrying 2–3 tiny drifting fragments toward the convergence point — small muted chips or micro-icons suggesting farm/origin data (e.g., a leaf/cherry glyph, a process word like "washed", a roaster-note word like "jasmine"). Text fragments must be generic vocabulary examples, never real coffee/roastery names.
- Right/lower stream = **measurement stream**: dotted arc carrying small neutral "measurement" ticks (plain dots/dashes — no numbers, no dimension names).
- The two streams merge into the single new gray node (existing behavior). Keep it calm: slow drift, low opacity, no parallax.
- Optional caption under the visual in state 1 only: "From farm to first measurement." (style: muted micro-caption).

## 3. Dot counts: keep as-is (decision)

Dana reviewed the clamped grouping (3–7 dots per region) and it stays. Do NOT make dots one-to-one with real coffees — the map is illustrative density, the counters carry the real numbers. No change to `NODE_MIN_PER_CLUSTER`/`NODE_MAX_PER_CLUSTER` or edge generation.

## 4. The handoff — close the cycle with the bag (new final state)

The journey currently ends at Refine + CTA with the map still abstract. Close the narrative the way the packaging does: **the map hands a coffee to the customer.**

- Add a final map state, **state 6 (Handoff)**, shown alongside the CTA section ("Find your place on the map"):
  - One dot detaches gently from its region and travels toward the foreground/bottom of the SVG.
  - As it arrives it transforms into a **small stylized coffee bag** (simple flat SVG silhouette, colored in the dot's archetype token — reference the bag shape from Camila's designs, no photorealism).
  - Beside/on the bag, render the packaging typography treatment: **"FROM: AXIS & BLOOM"** with **"TO: YOU"** — same stacked/oversized style as the bag layouts (`misc/design_documents/Embalagens_v1.pdf`, bottom-front panel). "TO: YOU" is the emphasis element.
  - If `?archetype=` is present, the detaching dot comes from that region and the bag takes that color; otherwise pick a seeded default.
  - Motion stays calm: one slow detach-travel-settle sequence (~2s total), plays once when the CTA section enters view, no loop. `prefers-reduced-motion`: render the final composed frame statically.
- Wire it in `TheAxis.tsx`: the CTA section's `useInView` sets stage 6.
- This is the emotional close: the entire data journey existed so that one bag could be addressed to one person. Don't add explanatory copy — the visual and the CTA button do the work.

## 4. No backend changes

The stats endpoint is correct as built (aggregates + timestamps only, read-only). Do not add fields to support the above — everything needed (`coffeesMapped`, per-archetype `coffeeCount`, `connectionCount`, `regionAdjacency`, `experimentalCount`) is already in the response.

---

## Checklist
- [x] Labels on all five regions in every map state (reduced opacity in states 0–1)
- [x] Capture state: field stream with origin fragments + measurement stream, merging into the new node
- [x] No real coffee/roastery names in stream fragments; no numbers or dimension names anywhere
- [x] Dot clamping unchanged (illustrative density kept, per Dana's decision)
- [x] State 6 (Handoff): dot detaches → becomes archetype-colored bag → "FROM: AXIS & BLOOM / TO: YOU" typography, plays once at CTA
- [x] Handoff respects `?archetype=` (bag color = visitor's archetype)
- [x] `prefers-reduced-motion` still respected; no new motion faster than the existing timing

**2026-07-14 — implemented and build-verified** (`vite build` clean, dev server re-checked serving `/the-axis` and `/api/axis/stats`). Field-stream fragments are a fixed 3-word pick from a small generic vocabulary list (`cherry`, `jasmine`, `honey process`), never randomized per load, never real coffee/roastery names. Handoff's "seeded default" (no `?archetype=`) is the first cluster in a fixed archetype order (`fruity`), not random. Not re-verified in an actual browser — same limitation as the V2 build, no headless-browser tool available in this environment; Dana should eyeball the Capture streams and the Handoff sequence at the CTA before deploy.
