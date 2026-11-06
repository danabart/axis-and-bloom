# Closing report — Website media upload

**Status: done 2026-11-06** (`WHAT_WE_BUILT.md` #257). Dana gave the go on the dry-run table in the session; the script wrote 20 objects, the optimizer produced all 19 WebP pairs, and the verify table is all green. Commits: the script, `MEDIA_MAP.json` and these docs. No database, no app deploy (pushing the commit runs the usual deploy, but nothing in the app changed).

Read: `DEVELOPMENT_GUARDRAILS.md` (unchanged since `3b7f084`), the brief, `README.md` D11, `frontend/src/design/CLAUDE.md`, `cloud-functions/image-optimizer/index.js`, `frontend/src/design/assets.ts`, `MEDIA_MAP.json`.

## Task 0

1. **Map vs sources vs registry.** All 20 `source` files exist under `misc/design_documents/website/axis-and-bloom-handoff/source/`. Every `target` is the raw path of the key the page already reads:
   - `homeAssets.family.*`, `axisQuiz`, `axisCupping`, `pour` and `window` → `optimized('home/…')`;
   - `homeAssets.heroPoster` → `raw('home/hero-poster.jpg')`;
   - `videoAssets.homeLoop` → `raw('video/home-loop.mp4')`;
   - `shopAssets.family.*` and `shopAssets.other` → `optimized('shop/…')`;
   - `axisAssets.story` / `bowl` / `start` → `optimized('axis/…')`.

   No mismatch, so no STOP.
2. **Credentials.** `serviceAccountKey.json` is gitignored (`.gitignore:14`) and untracked; so is `github-actions-sa-key.json`, which was not used. The account is `firebase-adminsdk-fbsvc@axis-and-bloom-prod.iam.gserviceaccount.com`. It is not bound on the bucket itself; its access comes from the project role `roles/firebase.sdkAdminServiceAgent`.
   - **Test (read-only):** listing `raw/` worked, and `testIamPermissions` granted `storage.objects.list`, `get` and `create` (`delete` too, which the script never uses).
   - **Finding:** the key file is saved with a UTF-8 byte-order mark. The storage library's `keyFilename` loader fails on it ("key must be a string, a buffer or an object"), so the script reads the JSON itself, strips the mark and hands the credential over in memory. Nothing from the key is printed but the account email.
3. **The optimizer** (`cloud-functions/image-optimizer`) fires on every object under `raw/` except `.svg` and `.mp4`, and writes `optimized/<path>.webp` (quality 85) and `optimized/<path>-mobile.webp` (800 px wide max), both `public, max-age=300`. The poster is a `.jpg`, so it also gets a WebP pair; the page keeps reading it raw.

**Also found:** rows 6 and 18 (Home's `axis-quiz.jpg` and The Axis's `axis-story.jpg`) are the same photo (md5 `3c575a66…`). Both were uploaded as mapped; a different file for either is a later `--replace`.

## Dry run (2026-11-06, before the go)

All 20 rows: bucket `missing`, action `upload`. The md5 and size per row are in the script's output, reproducible with `npx tsx scripts/upload-handoff-media.ts`.

## Write

20/20 uploaded, each re-read after the write and matching its md5: 19 as `image/jpeg`, 1 as `video/mp4`, all `cache-control: public, max-age=300`. Nothing was skipped, replaced or refused, and nothing was renamed or deleted.

## Verify (`--verify`, exit 0)

```
object                                             http  content-type  cache-control        verify
-------------------------------------------------  ----  ------------  -------------------  ------
raw/home/family-floral.jpg                         200   image/jpeg    public, max-age=300  ok    
optimized/home/family-floral.webp                  200   image/webp    public, max-age=300  ok    
optimized/home/family-floral-mobile.webp           200   image/webp    public, max-age=300  ok    
raw/home/family-fruity.jpg                         200   image/jpeg    public, max-age=300  ok    
optimized/home/family-fruity.webp                  200   image/webp    public, max-age=300  ok    
optimized/home/family-fruity-mobile.webp           200   image/webp    public, max-age=300  ok    
raw/home/family-balanced-sweet.jpg                 200   image/jpeg    public, max-age=300  ok    
optimized/home/family-balanced-sweet.webp          200   image/webp    public, max-age=300  ok    
optimized/home/family-balanced-sweet-mobile.webp   200   image/webp    public, max-age=300  ok    
raw/home/family-chocolate-nutty.jpg                200   image/jpeg    public, max-age=300  ok    
optimized/home/family-chocolate-nutty.webp         200   image/webp    public, max-age=300  ok    
optimized/home/family-chocolate-nutty-mobile.webp  200   image/webp    public, max-age=300  ok    
raw/home/family-spicy-earthy.jpg                   200   image/jpeg    public, max-age=300  ok    
optimized/home/family-spicy-earthy.webp            200   image/webp    public, max-age=300  ok    
optimized/home/family-spicy-earthy-mobile.webp     200   image/webp    public, max-age=300  ok    
raw/home/axis-quiz.jpg                             200   image/jpeg    public, max-age=300  ok    
optimized/home/axis-quiz.webp                      200   image/webp    public, max-age=300  ok    
optimized/home/axis-quiz-mobile.webp               200   image/webp    public, max-age=300  ok    
raw/home/axis-cupping.jpg                          200   image/jpeg    public, max-age=300  ok    
optimized/home/axis-cupping.webp                   200   image/webp    public, max-age=300  ok    
optimized/home/axis-cupping-mobile.webp            200   image/webp    public, max-age=300  ok    
raw/home/pour.jpg                                  200   image/jpeg    public, max-age=300  ok    
optimized/home/pour.webp                           200   image/webp    public, max-age=300  ok    
optimized/home/pour-mobile.webp                    200   image/webp    public, max-age=300  ok    
raw/home/window.jpg                                200   image/jpeg    public, max-age=300  ok    
optimized/home/window.webp                         200   image/webp    public, max-age=300  ok    
optimized/home/window-mobile.webp                  200   image/webp    public, max-age=300  ok    
raw/home/hero-poster.jpg                           200   image/jpeg    public, max-age=300  ok    
optimized/home/hero-poster.webp                    200   image/webp    public, max-age=300  ok    
optimized/home/hero-poster-mobile.webp             200   image/webp    public, max-age=300  ok    
raw/video/home-loop.mp4                            200   video/mp4     public, max-age=300  ok    
raw/shop/family-floral.jpg                         200   image/jpeg    public, max-age=300  ok    
optimized/shop/family-floral.webp                  200   image/webp    public, max-age=300  ok    
optimized/shop/family-floral-mobile.webp           200   image/webp    public, max-age=300  ok    
raw/shop/family-fruity.jpg                         200   image/jpeg    public, max-age=300  ok    
optimized/shop/family-fruity.webp                  200   image/webp    public, max-age=300  ok    
optimized/shop/family-fruity-mobile.webp           200   image/webp    public, max-age=300  ok    
raw/shop/family-balanced-sweet.jpg                 200   image/jpeg    public, max-age=300  ok    
optimized/shop/family-balanced-sweet.webp          200   image/webp    public, max-age=300  ok    
optimized/shop/family-balanced-sweet-mobile.webp   200   image/webp    public, max-age=300  ok    
raw/shop/family-chocolate-nutty.jpg                200   image/jpeg    public, max-age=300  ok    
optimized/shop/family-chocolate-nutty.webp         200   image/webp    public, max-age=300  ok    
optimized/shop/family-chocolate-nutty-mobile.webp  200   image/webp    public, max-age=300  ok    
raw/shop/family-spicy-earthy.jpg                   200   image/jpeg    public, max-age=300  ok    
optimized/shop/family-spicy-earthy.webp            200   image/webp    public, max-age=300  ok    
optimized/shop/family-spicy-earthy-mobile.webp     200   image/webp    public, max-age=300  ok    
raw/shop/other.jpg                                 200   image/jpeg    public, max-age=300  ok    
optimized/shop/other.webp                          200   image/webp    public, max-age=300  ok    
optimized/shop/other-mobile.webp                   200   image/webp    public, max-age=300  ok    
raw/axis/axis-story.jpg                            200   image/jpeg    public, max-age=300  ok    
optimized/axis/axis-story.webp                     200   image/webp    public, max-age=300  ok    
optimized/axis/axis-story-mobile.webp              200   image/webp    public, max-age=300  ok    
raw/axis/axis-bowl.jpg                             200   image/jpeg    public, max-age=300  ok    
optimized/axis/axis-bowl.webp                      200   image/webp    public, max-age=300  ok    
optimized/axis/axis-bowl-mobile.webp               200   image/webp    public, max-age=300  ok    
raw/axis/axis-start.jpg                            200   image/jpeg    public, max-age=300  ok    
optimized/axis/axis-start.webp                     200   image/webp    public, max-age=300  ok    
optimized/axis/axis-start-mobile.webp              200   image/webp    public, max-age=300  ok    
58/58 ok
```

Every WebP pair is newer than its raw object, so it was produced from this upload.

## Live check

`www.axisandbloomcoffee.com` with `?preview=true`, in Dana's Chrome through the Claude extension, signed in.
- **Why not headless:** the canonical-host redirect sends `axis-and-bloom-prod.web.app` to www, and Cloudflare challenged the headless browser on 2026-11-06. It was not bypassed.
- **Viewport:** Dana's window is 1366×607, slightly wider than the brief's 1280.
- **Lazy images:** the tab ran in the background (`visibilityState: hidden`), so lazy images were switched to eager in that tab only, to let them load for measuring.

| Page | What loads | Result |
|---|---|---|
| `/the-axis` | `optimized/axis/axis-story-mobile.webp`, `axis-bowl-mobile.webp`, `axis-start-mobile.webp` (the browser picks the 800 px variant for these display sizes) | 3/3 loaded from the new objects; "Start here" shows the glass mug on the crosswalk (screenshot) |
| `/shop` | `optimized/shop/family-{floral,fruity,balanced-sweet,chocolate-nutty,spicy-earthy}-mobile.webp`, 4 cards each | 20/20 loaded from the new objects, none fell back (screenshot of Chocolate & Nutty). `shop/other` is uploaded but not on the page: prod has no named category coffee, so the Other section is empty |
| `/` | the five family panels (`home/family-*`), `axis-quiz`, `axis-cupping`, `pour`, `window`, the film `video/home-loop.mp4` with `home/hero-poster.jpg` | **Not measured in the browser.** On Home the extension fails with "Cannot access a chrome-extension:// URL of different extension" (scripts and screenshots both; three tries; a known issue with this page, see Website 3). All 11 objects are verified above, and Home reads exactly those keys (Task 0). Dana to confirm by eye: the five family panels and the film |

## Correction to earlier reports

Closing Reports 5 and 6 said their smokes ran on the Firebase origin "without Cloudflare". They were in fact redirected to www by `VITE_CANONICAL_HOST` (#247) and passed Cloudflare's check that day. Both reports now carry the correction; their results are unaffected.

## Next

- **Quiz photos:** after Website 7A adds its rows to `MEDIA_MAP.json`, re-run dry run → go → `--write` → `--verify`.
- **Per-coffee photos (OT-77):** new rows under `raw/shop/coffee/`, same script.
