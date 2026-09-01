# Axis & Bloom · Hoboken Crawl Landing Page · Build Handoff

**For:** Dana (deploying with Claude Code)
**From:** Camila
**Deliverable:** the event landing page at **axisandbloomcoffee.com/crawl**
**Reference implementation:** `42-crawl-landing-mockup-v9.html` (included in this package)

---

## 1. What this page is

This is the destination of the QR code printed on our Hoboken Coffee Crawl card (Sunday, September 20, 2026, with the Hoboken Historical Museum). A crawler scans the card mid-event, lands here on their phone, types their name, and goes straight into the archetype quiz. The page has exactly one job: name in, quiz started. Everything else is voice.

The printed QR encodes this exact URL:

```
https://axisandbloomcoffee.com/crawl?utm_source=hoboken-crawl&utm_medium=print&utm_campaign=hoboken-crawl-2026
```

The page itself lives at `/crawl`. It must accept and ignore unknown query parameters gracefully, and **preserve the UTM parameters through the quiz flow** so attribution survives to signup.

## 2. How to use the reference file

`42-crawl-landing-mockup-v9.html` is a fully self-contained, approved mockup: fonts and the photograph are embedded as base64, and the CSS in it is the source of truth for every size, weight, color, and spacing value. Claude Code can lift the CSS directly. Two things in it are **mockup chrome and must not ship**:

- `.mocktitle` (the fixed caption at the top)
- `.notes` / `.notetoggle` / `.note` (the DESIGN NOTES pill, bottom left)

Everything else is the page. For production, replace the base64 embeds with real asset files (included in this package) and serve the fonts as `@font-face` with proper `font-weight` mappings (section 4).

## 3. Page structure, top to bottom (exact copy)

Copy must ship character for character. **House rule: no em dashes in any copy.** The one sanctioned exception is the FROM/TO lockup in the footer, which uses an em dash as a graphic element.

1. **Logo mark** — the quarter-round SVG mark (inline SVG is in the reference HTML), 24px tall, centered.
2. **Wordmark** — `AXIS & BLOOM` (10.5px, letter-spacing .3em, terracotta, Genova Regular 400; the `&` follows the ampersand rule in section 4).
3. **Kicker** — `HOBOKEN COFFEE CRAWL · SEPTEMBER 20 · WITH THE HOBOKEN HISTORICAL MUSEUM` (10px, letter-spacing .26em, gray, Regular).
4. **H1** — two stacked lines, uppercase, Genova **Medium 500**, letter-spacing .02em, line-height 1.16:
   - `HEY,` in pink `#ee5974`
   - `HOBOKEN` in terracotta `#9a2918`
   - **No period after HOBOKEN.** 54px on mobile, 84px at ≥900px.
5. **Lede** — Genova Thin 100, 15.5px (17px desktop), line-height 1.7, ink, max-width 400px (470px desktop), centered:
   > Today the whole city is tasting. Somewhere between those cups is a pattern, and it's yours: your family of taste. Three minutes, no jargon.
6. **Photo band** — full-bleed stripe of the Hoboken photograph (section 6).
7. **Game line** — 14px, Genova Thin, terracotta, max-width 380px:
   > Been noticing which words keep coming back? **Good.** The quiz will tell you if you were right.
   - `Good.` is Genova Black 900, terracotta text, on a light-pink highlight block: background `#f8b3bd`, padding `.06em .24em .1em`, border-radius 1px.
8. **Palate question** — Genova **Regular 400** (not Medium, not Thin), 29px (38px desktop), line-height 1.32, letter-spacing .01em, terracotta:
   > Whose palate are we profiling today?
   - The single word `palate` is pink `#ee5974`.
   - The `?` is **Gotham Light**, not Genova (section 4).
9. **Name field** — centered text input, placeholder `Enter your name`, Genova Thin 19px, ink text, no box: only a 1px bottom border in `#c5c7c8`, max-width 340px, transparent background.
10. **Button** — `START THE QUIZ  →` (two spaces before the arrow in the tracked setting). Genova **Black 900**, 13.5px, letter-spacing .26em, text in beige `#f2f1ea`, background terracotta `#9a2918`, padding 19px 50px, square corners, hover background `#8a2416`. A real `<button>`/submit, not a link.
11. **Perk** — 11px, Genova Regular, ink, line-height 1.65, max-width 360px:
    > FOR CRAWLERS ONLY  Finish the quiz today and your first order ships free. Five of you will receive your first match free, drawn when the doors open this fall.
    - `FOR CRAWLERS ONLY` is 10px, letter-spacing .06em, Black 900, pink `#ee5974`.
    - `ships free` and `first match free` are Black 900 in terracotta.
12. **Footer** — `FROM: AXIS & BLOOM — TO: HOBOKEN` (9.5px, letter-spacing .2em, gray, Regular; ampersand rule applies), then a full-width **six-color band**, 10px tall, six equal segments in this order:
    `#a34b78` (Floral) · `#ca445f` (Fruity) · `#d1ac11` (Balanced & Sweet) · `#a54c2d` (Chocolate & Nutty) · `#912f2f` (Earthy) · `#056c7a` (Experimental).

Page background is beige `#f2f1ea`, content centered, column max-width 560px (720px at ≥900px) with 30px side padding.

## 4. Typography (be strict here)

Font files are in `fonts/` in this package. Register **one family, "Genova", at four weights** so the browser never fake-bolds:

| File | font-weight |
|---|---|
| GenovaThin.otf | 100 |
| Genova.otf | 400 |
| GenovaMedium.otf | 500 **and** 600 |
| GenovaBlack.otf | 900 |

(Mapping Medium to 600 as well prevents faux-bold if anything ever asks for 600.)

Also register `GothamLight.otf` (family "GothamLight") and `GothamMedium.otf` (family "GothamMed"). These are **not** for running text. They exist for two glyphs only:

**The ampersand rule.** Genova's `&` is not our `&`. Every ampersand in display/tracked text (`AXIS & BLOOM` in the wordmark and the footer) is set in **Gotham Light with a 0.55px text stroke in the current text color** (`-webkit-text-stroke: 0.55px currentColor`). The stroke is what makes it sit at the same visual weight as its neighbors. (Only exception, not on this page: next to Thin text the stroke is omitted.)

**The question-mark rule.** Genova's `?` is tilted and never ships in display text. On this page, the `?` in the palate question is **Gotham Light**, which matches Genova Regular's weight. (General rule for other surfaces: next to Medium or heavier text, use Gotham Medium instead.)

Fallback stack everywhere: `'Genova', sans-serif`.

## 5. Color (palette only, no exceptions)

| Token | Hex | Used for |
|---|---|---|
| terracotta | `#9a2918` | HOBOKEN, palate line, game line, button bg, hot spans |
| terracotta deep | `#8a2416` | button hover |
| pink | `#ee5974` | HEY, · the word "palate" · FOR CRAWLERS ONLY |
| pink light | `#f8b3bd` | highlight block behind "Good." |
| beige | `#f2f1ea` | page background, button text |
| ink | `#45474a` | body text, input text |
| gray | `#7b7f80` | kicker, footer |
| gray light | `#c5c7c8` | input underline |
| archetype six | see §3.12 | footer band only |

**Never use pure white (`#ffffff`) anywhere.** The whitest value on any Axis & Bloom surface is the beige `#f2f1ea`. Check button text, placeholder color, any focus states Claude Code adds.

## 6. The photo band

`hoboken-photo.jpg` (1800×1202, included) runs as a full-bleed cinematic stripe, `object-fit: cover`, no rounding, no borders:

- **Mobile (<900px):** height 178px, `object-position: 48% 60%`
- **Desktop (≥900px):** height 480px, `object-position: 48% 52%`

These crops are tuned so the glass cup and the colored archetype cards stay fully in frame at both widths. Camila may replace the photograph after this week's reshoot; keep the crop system and only swap the file (a new image may need its object-position re-tuned, nothing else).

Alt text: `A cup of Axis & Bloom beans on the Hoboken waterfront`.

## 7. Behavior and tracking

- Submitting the form (button or Enter key) takes the name and starts the archetype quiz, exactly like BEGIN PROFILE on the regular quiz entry page, carrying the name through.
- Every quiz start and signup originating from `/crawl` must carry the **crawl tag**. This tag is what attaches the free-shipping perk and enters people into the five-free-matches draw, so it cannot be lossy.
- Preserve incoming UTM parameters through the redirect/flow into the quiz and signup.
- Marketing consent is collected at the quiz gate (existing setup); this page adds nothing before that gate.
- Optional, recommended on mobile: keep the button visible (pinned to the bottom edge) once the user scrolls past the form. Don't add it if it fights the layout.

## 8. QA checklist before it goes live

1. Fonts: `document.fonts.check('100 16px Genova')`, `('400 …')`, `('500 …')`, `('900 …')` all true; the H1 renders Medium, not faux-bold.
2. The `&` in the wordmark and footer is Gotham Light with stroke; the `?` in the palate line is Gotham Light.
3. No `#ffffff` or `white` anywhere in computed styles; page background is `#f2f1ea`.
4. No em dashes in copy (footer lockup excepted).
5. Photo: cup and cards fully visible at 375px, 390px, 900px, 1440px widths.
6. Scan the **printed card** (not a screen): lands on `/crawl` with UTMs intact, quiz start fires with the crawl tag.
7. Phone test: name field focus does not zoom-jump the layout (font-size ≥16px on the input is already satisfied at 19px).

## Package contents

- `42-crawl-landing-mockup-v9.html` — approved reference, source of truth
- `hoboken-photo.jpg` — the photo band image (web copy, 1800×1202)
- `fonts/` — GenovaThin, Genova, GenovaMedium, GenovaBlack, GothamLight, GothamMedium (OTF)
- `43-crawl-page-handoff.md` — this document
