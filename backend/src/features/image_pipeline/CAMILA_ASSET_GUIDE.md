# Updating site images — guide for Camila

This is the whole workflow now that images live in a Google Cloud Storage bucket instead of the code. No developer, no deploy, no waiting — you upload a file, and it's live in a few minutes.

## Where to go

**Bucket link:** https://console.cloud.google.com/storage/browser/axis-bloom-assets?project=axis-and-bloom-prod

Sign in with your Google account (camilamarchon@gmail.com) — you already have upload/replace access to the whole bucket.

## The one rule that matters: keep the filename exactly the same

To **replace** an existing photo (new bag design, new archetype hero shot, whatever), you upload your new file into the *same folder*, with the *exact same filename* — same spelling, same capitalization, same extension (`.png` stays `.png`, don't swap in a `.jpg`). The Cloud Console will ask "replace existing file?" — say yes.

If you upload with a different filename or a different extension, it does **not** replace anything — it creates a second, unrelated file, and the site keeps showing the old one. If you genuinely need to change a file's format (say, a PNG that should become a JPG), message Dana first rather than guessing — that one needs a small adjustment on the code side, not just a re-upload.

## Where things live (the `raw/` folder — this is the only folder you touch)

**Archetype photos** — `hero` / `sm1` / `sm2` are the three photos used on The Bloom page for that archetype. **Home has its own separate photo per archetype** (the "scan" row below) — it is *not* the same file as `hero`, on purpose, so don't expect replacing one to change the other.

| What | Path |
|---|---|
| Floral — hero / small 1 / small 2 / bag / quiz wallpaper | `raw/archetypes/floral/hero.png` / `sm1.png` / `sm2.png` / `bag.png` / `wallpaper.jpg` |
| Fruity | `raw/archetypes/fruity/hero.png` / `sm1.png` / `sm2.png` / `bag.png` / `wallpaper.jpg` |
| Balanced & Sweet | `raw/archetypes/balanced-sweet/hero.png` / `sm1.png` / `sm2.png` / `bag.png` / `wallpaper.jpg` |
| Chocolate & Nutty | `raw/archetypes/chocolate-nutty/hero.png` / `sm1.png` / `sm2.png` / `bag.png` / `wallpaper.png` |
| Spicy & Earthy | `raw/archetypes/spicy-earthy/hero.png` / `sm1.png` / `sm2.png` / `bag.png` / `wallpaper.jpg` |
| Experimental | `raw/archetypes/experimental/hero.png` / `sm1.png` / `sm2.png` / `bag.png` / `wallpaper.jpg` |

**Homepage's own photos** (separate from the archetype photos above):

| What | Path |
|---|---|
| Homepage collection photo — Floral / Fruity / Balanced & Sweet / Chocolate & Nutty / Spicy & Earthy / Experimental | `raw/home/scan-floral.jpg` / `scan-fruity.jpg` / `scan-balanced-sweet.jpg` / `scan-chocolate-nutty.jpg` / `scan-spicy-earthy.jpg` / `scan-experimental.jpg` |
| Homepage photo-essay triptych (3 images, no archetype tie) | `raw/home/photo-essay-1.png`, `photo-essay-2.png`, `photo-essay-3.png` |

**Quiz photos:**

| What | Path |
|---|---|
| The 6 question photos (in order) | `raw/quiz/pic-1.png` through `pic-6.png` |
| The large coffee photo on the quiz's opening screen | `raw/quiz/coffee-large.png` |

**Small background patterns** (used behind the quiz and the "find my flavor" section — same 6 files, one per archetype):

`raw/patterns/floral.jpg`, `fruity.jpg`, `balanced-sweet.jpg`, `chocolate-nutty.jpg`, `spicy-earthy.jpg`, `experimental.jpg`

**Everything else:**

| What | Path |
|---|---|
| Family / lifestyle photos | `raw/lifestyle/family.jpg`, `coffee-15.jpg`, `coffee-15-vertical.jpg` |
| Logo files | `raw/brand/logo-quarter-1.svg`, `logo-lines.svg` |
| Videos | `raw/video/about-hero.mp4`, `about-secondary.mp4`, `home-placeholder.mp4`, `home-hero.mp4` |

**A few things intentionally aren't in the bucket at all** — the "find my flavor" bag illustrations (those are inline artwork, not a bucket photo) and the Shop page's photos (Shop is being retired, still lives fully in the code, untouched by any of this). If you're not sure whether something you want to change is bucket-managed, ask rather than guess — the table above is the complete list.

## What NOT to touch

There's a second folder in the bucket called `optimized/` — **ignore it completely.** It's generated automatically from whatever you upload to `raw/`, gets overwritten every time, and anything you put there directly will just get replaced or ignored. Only ever upload to `raw/`.

## What happens after you upload

1. You upload/replace a file under `raw/`.
2. Within about a minute, an automated process compresses it and generates the version the site actually displays (including a smaller version for phones). You don't need to compress or resize anything yourself before uploading — just use a reasonably sized export from your design tool (a few thousand pixels on the long edge is plenty; no need to hand-optimize file size).
3. It's live on the site within about 5 minutes. If you check and still see the old image, it's almost always just your browser cache — try a private/incognito window.

## Adding something brand new (not a replacement)

A new image that doesn't have a slot in the tables above needs one new entry in the code's asset registry (`frontend/src/design/assets.ts`) so the site knows where to find it — that one step isn't self-serve through the bucket alone. But you don't need to go through Dana for this either — you have Claude Code, and this is exactly the kind of small, contained task it handles well.

**What happens, in order:**
1. You give Claude Code the prompt below (filled in).
2. It adds the new key to `assets.ts` and tells you the exact `raw/...` bucket path to use.
3. You upload your file to that exact path in the Cloud Console — same steps as a normal replacement (see above).
4. That's it. Updating it again later is a plain swap-in-place, same as everything already in the tables.

### Prompt to give Claude Code

There's a `CLAUDE.md` file inside `frontend/src/design/` that Claude Code reads automatically whenever it works in that folder — it already knows the naming pattern, the hard rules (don't touch `Shop.tsx`, don't rename existing keys, always report back the upload path), and where the rest of the background docs live. You don't need to re-explain any of that. Just describe what you need:

```
I need a new image slot added to the asset registry in
frontend/src/design/assets.ts.

- What it is: [photo / bag graphic / logo / video]
- What it's for: [e.g. "a 7th archetype called Bold" / "a new hero photo
  for the About page's second section"]
- Where it should appear: [which page/component]
```

Claude Code adds the key following the folder's existing rules, tells you the exact `raw/...` path, and wires it into the page you named.

**One thing worth deciding with Dana, not assuming:** whether these registry-addition changes should get a quick look from her before they go live, or whether you're both fine with Claude Code pushing them straight through like a normal replacement. That's a judgment call about review, not a technical requirement — flag it to her if it's not already clear.

**A full page redesign is a different scope, not a variant of this.** New layouts, new sections, rearranging how a page works — that's a product decision, not just a new image slot, and is worth looping Dana in on for direction even though the execution still happens through Claude Code either way.
