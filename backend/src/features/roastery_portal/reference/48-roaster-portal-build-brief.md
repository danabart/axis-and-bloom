# Axis & Bloom · Roaster Portal · Build Brief for Claude Code

**For:** Claude Code, working in the Axis & Bloom website repository
**From:** Camila (owner) · Dana owns backend, auth, and data
**Deliverable:** a hidden page at **axisandbloomcoffee.com/bloom/utopian** that reproduces the approved mockup `47-roaster-portal-mockup-v8.html` (included) and saves what the roaster submits
**Deliverable number:** 48

Read this whole file, open the mockup in a browser, and only then start.

---

## 1. What this is

Axis & Bloom is a coffee brand that classifies coffees into six **archetypes** (families of taste) using a system called the **Bloom Dial**. We ask partner roasters to describe their own coffees so we can place them. This page is the first roaster's intake: **Utopian Coffee**, ten coffees. Later roasters get the same page at their own slug (`/bloom/<roaster>`), so build it as a template fed by data, not as a one-off.

The page is **hidden**: not linked from the site, not in the sitemap, `<meta name="robots" content="noindex, nofollow">`. For this first version there is no login; the obscure URL is the gate. Dana may add auth later; don't block on it.

## 2. Source of truth

`47-roaster-portal-mockup-v8.html` is the approved design. It is a complete static page: open it, resize it, that is what we want. Lift its CSS directly. Two things in it are **mockup chrome and must not ship**:

- `.mocktitle` (fixed caption at the top)
- `.notes`, `.notetoggle`, `.note` (the DESIGN NOTES pill)

The mockup is **filled in with sample answers** (Flying Jewel's chips and dots are selected, text fields hold values). The real page starts **empty** for every coffee, except the prefilled fields in section 6.

The mockup renders in a stand-in font because the brand fonts weren't in that workspace. **Production uses the real fonts** (section 5).

## 3. Routes and data model

```
/bloom/utopian                 → the page, coffee picker with nothing selected
/bloom/utopian?coffee=<slug>   → same page with that coffee active and its saved answers loaded
```

Keep state in the URL so a roaster can leave and return to a coffee. Autosave a draft on every change (debounced ~1 s) and show "Draft saved" in the actions row; the explicit **SAVE COFFEE** button marks the coffee complete. "Save and add another" saves, then returns to the picker with nothing selected.

**Roaster record** (seed as a JSON file or a table row; Dana decides where it lives):

```json
{
  "slug": "utopian",
  "name": "Utopian Coffee",
  "coffees": [
    {"slug": "colombia-andres-martinez", "name": "Colombia Andres Martinez",
     "prefill": {"origin": "Cauca, Colombia", "process": ["Other"], "roast": "Medium-light"}},
    {"slug": "mexico-alva-flores", "name": "Mexico Alva Flores",
     "prefill": {"origin": "Santa Cruz Ozolotepec, Oaxaca, Mexico", "process": ["Washed"], "roast": "Medium"}},
    {"slug": "peru-chirinos-geisha", "name": "Peru Chirinos Geisha",
     "prefill": {"origin": "Chirinos, Cajamarca, Peru", "process": ["Washed"], "roast": "Light"}},
    {"slug": "decaf-mexico-veracruz", "name": "Decaf Mexico Veracruz",
     "prefill": {"origin": "Veracruz, Mexico", "process": ["Washed"], "roast": "Medium"}},
    {"slug": "flying-jewel", "name": "Flying Jewel",
     "prefill": {"origin": "Blend, Peru components", "process": ["Washed","Natural"], "roast": "Medium-light"}},
    {"slug": "pearl", "name": "Pearl",
     "prefill": {"origin": "Blend", "process": ["Washed","Natural"], "roast": "Light"}},
    {"slug": "espresso-volo", "name": "Espresso Volo",
     "prefill": {"origin": "Blend", "process": ["Washed","Natural"], "roast": "Medium-dark"}},
    {"slug": "obsidian", "name": "Obsidian",
     "prefill": {"origin": "Blend", "process": ["Washed"], "roast": "Dark"}},
    {"slug": "union", "name": "Union",
     "prefill": {"origin": "Blend", "process": ["Washed"], "roast": "Medium"}},
    {"slug": "peru-joel-silva-chirinos", "name": "Peru Joel Silva Chirinos",
     "prefill": {"origin": "Chirinos, Cajamarca, Peru", "process": ["Natural"], "roast": "Medium-light"}}
  ]
}
```

Colombia Andres Martinez is a double fermentation; "Other" is the closest chip, the roaster will correct it. Prefills come from utopiancoffee.com, Sept 2026.

**Answer record**, one per (roaster, coffee). Field names are the contract with our records; keep them exactly:

| Field | Type | Values |
|---|---|---|
| `origin` | string | free text |
| `process` | string[] | Washed · Natural · Honey · Anaerobic · Co-ferment · Other |
| `roast_level` | string | Light · Medium-light · Medium · Medium-dark · Dark |
| `tasting_notes` | string | free text, the roaster's words |
| `archetype_proposed` | string | floral · fruity · balanced · chocolate-nutty · earthy · experimental |
| `dim_acidity` … `dim_sweetness`, `dim_bitterness`, `dim_body`, `dim_intensity`, `dim_roast`, `dim_clean_deep` | int 1–5 | |
| `dominant_dimension` | string | acidity · sweetness · bitterness · body · intensity · roast · clean-deep |
| `brew_best` | string | Pour-over · Drip · Espresso · French press · AeroPress · Cold brew · Other |
| `brew_second` | string | same list |
| `brew_notes` | string | optional |
| `availability` | string | Always on · Rotating · Limited release |
| `notice` | string | Under 2 weeks · 2 to 4 weeks · 1 to 2 months · 2+ months · Unpredictable |
| `expected_availability` | string | optional |
| `similar_when_out` | string | Yes · Usually · Sometimes · No · Not sure |
| `closest_cousin` | string | |
| `what_changes` | string | |
| `anything_else` | string | optional |
| `status` | string | draft · complete |
| `updated_at` | timestamp | |

Section 5 of the page (Availability) has the "typical notice" and "expected availability" fields side by side; the mockup shows both. Nothing on the page is required; a roaster can save a coffee with gaps.

## 4. Page structure (matches the mockup, top to bottom)

1. **Portal bar**: `AXIS & BLOOM  ROASTER PORTAL` left (wordmark + small label), `UTOPIAN COFFEE · N OF 10 COFFEES DONE` right (count = coffees with `status: complete`; hidden under 640 px).
2. **Breadcrumb**: `UTOPIAN COFFEE / YOUR COFFEES / <coffee name>` (last segment only when a coffee is active).
3. **H1**, three stacked lines, Genova Medium, uppercase: `HELLO, UTOPIAN.` in pink `#ee5974`, then `YOUR COFFEES,` and `IN YOUR WORDS.` in terracotta `#9a2918`. 40 px, 34 px on mobile.
4. **Lede** (exact copy): *We listed your lineup from your website and prefilled what we found; correct anything that is off. Your answers do two things: they help us place each coffee on our Bloom Dial, and they shape how we present it, since every coffee gets its own imagery.* **The 1 to 5 scales are relative to your own lineup:** *1 is your gentlest coffee on that scale, 5 your most intense. There are no wrong answers.* (The bold span is Genova Regular; the rest Thin.)
5. **01 The coffee**: coffee picker (chips; completed coffees show a check and gray text; a dashed `+ A coffee not listed` chip reveals a text field and creates a new coffee record), then Origin (text, FROM YOUR SITE tag), Process (multi-select chips, tag), Roast level (single, tag).
6. **02 Tasting notes**: one textarea, label *Your official tasting notes*, hint *three to five, the leading one first, in plain flavor words even if the bag says it more poetically*, placeholder *Blueberry, cream, milk chocolate*. Then the **Bloom Dial question**: label *If you had to place this coffee in our Bloom Dial, where would it bloom?* hint *pick the family it belongs to first; we will refine it with you*. Six selectable cards in a 2-column grid (1 column on mobile), fixed order 01–06. Each card: dial image on a disc of the family color, `01 —` number, name in Medium uppercase, three words tracked uppercase. Experimental carries one extra line: *Only for the truly rare: mushroom-infused, aged in a whisky barrel, a process almost nobody has tasted. Unusual is not enough; it has to surprise.* Selected card fills with its archetype color, text in its lightest tint (table below).
7. **03 Dimensions**: hint *Relative to your own lineup. 1 is your gentlest coffee on that scale, 5 your most intense.* Seven 1–5 scales in a 2-column grid: Acidity (Low–High), Sweetness (Low–High), Bitterness (Low–High), Body (Light–Full), Intensity (Gentle–Intense), Roast (Light–Dark), Clean to deep (Clean–Deep). Then *Most dominant dimension* chips, hint *the one thing people notice first*.
8. **04 How to drink it**: Best brewing method chips; Second-best, the same seven chips; textarea *Anything we should know about brewing it?* (optional).
9. **05 Availability**: *How it lives in your lineup* chips; *Typical notice before it becomes unavailable* chips; *Expected availability* text (hint *if seasonal*); *When it runs out, can you usually offer a similar profile?* chips; *Closest cousin in your lineup* text; *What changes between them* text (hint *a few words*).
10. **06 Anything else**: one textarea, placeholder *Awards, the story of the lot, what you love about it. Optional, and welcome.*
11. **Actions**: `SAVE COFFEE  →` button (terracotta, Genova Black, tracked), `SAVE AND ADD ANOTHER` ghost link, `Draft saved …` status right-aligned.
12. **Footer**: `FROM: AXIS & BLOOM — TO: OUR ROASTERS` small tracked gray, then the **six-color band**, 8 px, equal segments in order: `#a34b78 #ca445f #d1ac11 #a54c2d #912f2f #056c7a`.

Every chip is a `<button type="button" role="radio|checkbox" aria-pressed>`; every scale dot likewise. Keyboard operable. Labels are real `<label for>`.

## 4b. Phone version

The page is **mobile-first**: most roasters will fill it on a phone between batches. Two renders of the approved mockup are in the package: `47-roaster-portal-desktop-v8.pdf` (1440 wide) and `47-roaster-portal-phone-v8.pdf` (390 wide). Match the phone PDF as closely as the desktop one.

Breakpoint is **640 px**. Below it:

- Every two- and three-column grid becomes one column: the Origin/Process row, the Dimensions grid, the Bloom Dial cards, the brewing and availability rows. Order is preserved top to bottom, left column first.
- The H1 drops from 40 to 34 px and keeps its three lines.
- The portal bar keeps the wordmark; the `UTOPIAN COFFEE · N OF 10 COFFEES DONE` count is hidden.
- Chips wrap naturally onto as many lines as they need; never shrink them, never truncate text, never turn them into a dropdown.
- Scale dots stay 30 px (comfortable thumb targets) with the end labels (Low / High) on either side; the row may wrap its labels above and below if the width is too tight, but the five dots stay on one line.
- Bloom Dial cards stay full-width with the dial left and text right, same as desktop, just one per row.
- The actions row stacks: button full-width first, then `SAVE AND ADD ANOTHER`, then the draft status.
- Inputs are 17 px so iOS doesn't zoom on focus. Side padding is 20 px.
- Nothing is removed on mobile except the bar count. All questions, all chips, all hints survive.

Test at 390 and 375 wide in a real phone or device emulation, not just a narrow desktop window.

## 5. Typography (strict)

Font files: ask Camila for the `fonts/` folder (GenovaThin, Genova, GenovaMedium, GenovaBlack, GothamLight, GothamMedium, all OTF). Register **one family "Genova"** at weights 100 / 400 / 500 (also 600) / 900. Register `GothamLight` and `GothamMed` as their own families.

- Genova **Thin 100**: lede, hints, help text, textareas and inputs.
- Genova **Regular 400**: labels, chips, tracked small lines (bar, breadcrumb, footer).
- Genova **Medium 500**: H1, section titles, archetype names.
- Genova **Black 900**: the SAVE button only.

**Ampersand rule.** Every `&` in display or tracked text (`AXIS & BLOOM`, `CHOCOLATE & NUTTY`) is **Gotham Light** with `-webkit-text-stroke: .55px currentColor`. Never Genova's ampersand.
**Question-mark rule.** The `?` in the Bloom Dial label and the two brewing/availability questions is **Gotham Light**, not Genova (Genova's tilts). Use a `<span class="qm">`.

## 6. Color (palette only)

| Token | Hex | Use |
|---|---|---|
| beige | `#f2f1ea` | page ground, button text, selected-chip text |
| beige2 | `#ebebe3` | FROM YOUR SITE tag ground |
| beige3 | `#e5e5da` | section rules |
| ink | `#45474a` | text |
| gray | `#7b7f80` | small tracked lines, hints |
| gray60 / gray40 | `#aeb0b1` / `#c5c7c8` | placeholders / underlines and chip borders |
| terracotta | `#9a2918` | selected chips and dots, button, H1 lines 2–3, section titles |
| terracotta deep | `#8a2416` | button hover |
| pink | `#ee5974` | H1 line 1 only |

**Never `#ffffff`.** The lightest value on any Axis & Bloom surface is beige `#f2f1ea`. Check focus rings and autofill styles too.

Archetype colors and the tint used for text when a card is selected:

| # | slug | color | tint |
|---|---|---|---|
| 01 | floral | `#a34b78` | `#d3acb7` |
| 02 | fruity | `#ca445f` | `#e5b0b4` |
| 03 | balanced | `#d1ac11` | `#e7d79d` |
| 04 | chocolate-nutty | `#a54c2d` | `#e1a99c` |
| 05 | earthy | `#912f2f` | `#caa19e` |
| 06 | experimental | `#056c7a` | `#88bab9` |

## 7. Assets

- **Dial images**: the mockup embeds six PNGs (base64, 160 px, transparent) extracted from the Bloom Dial renderer; extract them from the mockup's `<img class="dialimg">` tags into `/public/bloom/dials/<slug>.png` for the first build. Ask Dana for SVG or 2× PNG exports from the dial generator to replace them; the card slot is 52 px.
- **Logo mark** is not on this page. The wordmark is set in type.

## 8. Behavior details

- Picker: one coffee active at a time; switching coffees autosaves the current one first.
- Chips: single-select groups behave as radios; `process` is multi-select.
- FROM YOUR SITE tag disappears from a field once the roaster edits it.
- "Draft saved N min ago" updates from `updated_at`.
- Mobile: single column everywhere, chips wrap, dots stay 30 px.
- No analytics, no cookies beyond what saving needs.

## 9. Copy rules

- No em dashes in copy. The footer `FROM / TO` and the `01 —` card numbers are graphic elements and the sanctioned exceptions.
- Sentence case for sentences, uppercase with tracking for labels and lockups.
- Don't add copy that isn't in the mockup; if a state needs words (empty, error, saved), write them short, Thin, and gray, and send them to Camila.

## 10. Definition of done

1. `/bloom/utopian` renders pixel-close to the mockup at 1440 and 390 wide, in Genova, with the six dials showing.
2. Not indexed; not linked from anywhere.
3. Picking a coffee loads its prefill; typing autosaves; refresh keeps the draft; SAVE marks it complete and the bar count updates.
4. Answers land in storage with the field names in section 3 and can be exported as JSON or CSV for Camila and Dana.
5. `document.fonts.check` is true for Genova 100/400/500/900; no `#ffffff` in computed styles; every `&` and display `?` is Gotham.
6. Second roaster test: duplicate the seed with a different slug and name, confirm the page works at `/bloom/<slug>` with zero code changes.

## Package contents

- `48-roaster-portal-build-brief.md` — this file
- `47-roaster-portal-mockup-v8.html` — approved design, source of truth (stand-in font; dials embedded)
- `47-roaster-portal-desktop-v8.pdf`, `47-roaster-portal-phone-v8.pdf` — the approved renders at 1440 and 390 wide
- `utopian.json` — the roaster seed from section 3
