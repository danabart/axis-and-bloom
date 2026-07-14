# Sensory Sources — citations & how the Bloom Dial ties to WCR intensity

## The PDF
The WCR Sensory Lexicon 2.0 is **not committed to the repo** (copyright — WCR licenses it free for *personal-use* download/printing only, so we link rather than redistribute the file).

- One-click: open **`WCR_Sensory_Lexicon_2.0.url`** in this folder.
- Direct: https://worldcoffeeresearch.org/download/bf904452-fc8c-488f-b591-c0b20d9bcab2
- Landing page: https://worldcoffeeresearch.org/resources/sensory-lexicon

If you want a local copy in this folder, download it from the link above (personal-use license permits it) and save it here as `WCR_Sensory_Lexicon_2.0.pdf`.

## Citations for `sensory_source`
- **WCR Sensory Lexicon 2.0 (2017)** — World Coffee Research. 110 descriptive attributes, each with physical reference standards and a 0–15 intensity anchor. The source of the *vocabulary*.
- **SCA Coffee Taster's Flavor Wheel (2016)** — Specialty Coffee Association, derived from the WCR Lexicon. Source of our `category`/`subcategory` *grouping*, not the words.
- **SCA Cupping Form — CVA Descriptive Assessment (2023)** — Specialty Coffee Association. Scores dimensions on 0–15 *intensity*; basis for our `coffee_dimensions` scale.

## Attribute index (names/sections only — full definitions are in the PDF)
17 lexicon sections: Taste Basics · Fruity · Sour/Acid · Alcohol/Fermented · Green/Vegetative · Stale/Papery · Earthy · Chemical · Roasted · Cereal · Spices · Nutty · Cocoa · Sweet · Floral · Amplitude · Mouthfeel. (Full per-attribute list is in the Part 2b seed of `CLAUDE_CODE_PROMPT.md`.)

---

## How the Bloom Dial connects to WCR "intensity"

**What WCR means by intensity.** The lexicon is a *descriptive* tool, not a quality score. Every attribute is rated on a **0–15 intensity scale** — how *strongly* that attribute is present, with each scale point anchored to a physical reference standard (a real product tasted/smelled to calibrate the number). It says nothing about "good" or "bad," only magnitude. This is the standard descriptive-analysis (Spectrum-method) approach; the current SCA CVA descriptive form adopted the same 0–15 intensity idea.

**What the Bloom Dial does.** Each `coffee_dimensions` axis is scored **0–15** — the *intensity* of that dimension for a coffee. That is the same construct as WCR attribute intensity, just at the level of aggregate dimensions instead of 110 fine-grained attributes.

**The mapping (why they're the same idea):**

| Bloom Dial dimension (alias) | WCR equivalent | Relationship |
|---|---|---|
| Body → *Intensity* | Amplitude → **Body / Fullness** | Direct — same attribute, same 0–15 scale |
| Finish Length → *Finish* | Amplitude → **Longevity** | Direct |
| Texture → *Mouthfeel* | Mouthfeel → **Mouth Drying / Thickness / Oily** | Direct (aggregate of mouthfeel attrs) |
| Bitterness → *Boldness* | Taste Basics → **Bitter** | Direct |
| Sweetness | Sweet → **Overall Sweet** | Direct |
| Acidity → *Brightness* | Sour/Acid section | Aggregate of the acid attributes |
| Savory/Depth → *Complexity* | Amplitude → **Overall Impact / Blended** | Platform-defined aggregate, closest WCR touchpoint |

**Two intensity layers you already have (worth unifying):**
1. **Dimension intensity** — `coffee_dimensions` scores (the Dial). WCR-style intensity of an aggregate axis.
2. **Descriptor intensity** — `cupping_score_descriptors.intensity` (0–15, currently NULL for all rows per OPEN_TASKS OT-12). This is *exactly* WCR per-attribute intensity: "how much blueberry," "how much dark chocolate." Populating it is the same measurement WCR describes, one level finer than the Dial.

**Practical ways to ground the Dial in WCR:**
- Keep the **0–15** scale (already aligned with both WCR and SCA CVA).
- For dimensions that *are* WCR attributes (Body, Finish, Texture, Bitterness, Sweetness), treat the WCR attribute's reference standards as the calibration anchors for the Dial endpoints (`scale_min_label` / `scale_max_label`), so scoring is reproducible rather than vibes-based.
- Use `coffee_dimensions.lexicon_attribute_id` (added by this feature) to let the Dial cite its WCR basis in the UI ("Intensity, per WCR: Body/Fullness").
- Longer term, feeding `cupping_score_descriptors.intensity` (descriptor-level WCR intensity) into the Dial gives a bottom-up intensity signal to complement the top-down dimension scores.
