# One-time migration script — uploads originals to gs://axis-bloom-assets/raw/...
# Triggers the optimize-bloom-image Cloud Function automatically on each upload.
# Run from repo root. Not meant to be permanent / re-run repeatedly.

$ErrorActionPreference = "Stop"
$gsutil = "C:\Users\DanaB\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gsutil.cmd"
$root = "C:\Users\DanaB\axis-and-bloom\frontend\src\design"
$bucket = "gs://axis-bloom-assets"
$cache = "Cache-Control:public, max-age=300"

$files = @(
  # Archetype bags
  @{ Src = "$root\IMAGES\bags\new bags mock up\FLORAL transp.png"; Dest = "raw/archetypes/floral/bag.png" },
  @{ Src = "$root\IMAGES\bags\new bags mock up\FRUITY transp.png"; Dest = "raw/archetypes/fruity/bag.png" },
  @{ Src = "$root\IMAGES\bags\new bags mock up\BALANCED & SWEET transp.png"; Dest = "raw/archetypes/balanced-sweet/bag.png" },
  @{ Src = "$root\IMAGES\bags\new bags mock up\CHOCOLATE & NUTTY transp.png"; Dest = "raw/archetypes/chocolate-nutty/bag.png" },
  @{ Src = "$root\IMAGES\bags\new bags mock up\SPICY & EARTHY transp.png"; Dest = "raw/archetypes/spicy-earthy/bag.png" },
  @{ Src = "$root\IMAGES\bags\new bags mock up\EXPERIMENTAL transp.png"; Dest = "raw/archetypes/experimental/bag.png" },

  # Archetype hero/sm1/sm2
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTFloralJun01.png"; Dest = "raw/archetypes/floral/hero.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTFloralJun08.png"; Dest = "raw/archetypes/floral/sm1.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTFloralJun14.png"; Dest = "raw/archetypes/floral/sm2.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTFruityJun01.png"; Dest = "raw/archetypes/fruity/hero.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTFruityJun05.png"; Dest = "raw/archetypes/fruity/sm1.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTFruityJun06.png"; Dest = "raw/archetypes/fruity/sm2.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTBalanced&SweetJun02.png"; Dest = "raw/archetypes/balanced-sweet/hero.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTBalanced&SweetJun04.png"; Dest = "raw/archetypes/balanced-sweet/sm1.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTBalanced&SweetJun09.png"; Dest = "raw/archetypes/balanced-sweet/sm2.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTChocolate&NuttyJun02.png"; Dest = "raw/archetypes/chocolate-nutty/hero.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTChocolate&NuttyJun08.png"; Dest = "raw/archetypes/chocolate-nutty/sm1.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTChocolate&NuttyJun10.png"; Dest = "raw/archetypes/chocolate-nutty/sm2.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTSpicy&EarthyJun04.png"; Dest = "raw/archetypes/spicy-earthy/hero.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTSpicy&EarthyJun07.png"; Dest = "raw/archetypes/spicy-earthy/sm1.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTSpicy&EarthyJun11.png"; Dest = "raw/archetypes/spicy-earthy/sm2.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTExperimentalJun2.png"; Dest = "raw/archetypes/experimental/hero.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTExperimentalJun7.png"; Dest = "raw/archetypes/experimental/sm1.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTExperimentalJun10.png"; Dest = "raw/archetypes/experimental/sm2.png" },

  # Archetype quiz-result wallpapers
  @{ Src = "$root\IMAGES\archetypes\Floral.jpg"; Dest = "raw/archetypes/floral/wallpaper.jpg" },
  @{ Src = "$root\IMAGES\archetypes\Fruity.jpg"; Dest = "raw/archetypes/fruity/wallpaper.jpg" },
  @{ Src = "$root\IMAGES\archetypes\Balanced-&-Sweet.jpg"; Dest = "raw/archetypes/balanced-sweet/wallpaper.jpg" },
  @{ Src = "$root\IMAGES\archetypes\WEBChocolate&Nutty.png"; Dest = "raw/archetypes/chocolate-nutty/wallpaper.png" },
  @{ Src = "$root\IMAGES\archetypes\Spicy-&-Earthy.jpg"; Dest = "raw/archetypes/spicy-earthy/wallpaper.jpg" },
  @{ Src = "$root\IMAGES\archetypes\Experimental.jpg"; Dest = "raw/archetypes/experimental/wallpaper.jpg" },

  # Home — current "scan" photos (2026-07, replaces the old per-archetype hero on Home)
  @{ Src = "$root\IMAGES\photos\july_scan1\EDITScanFloral.jpg"; Dest = "raw/home/scan-floral.jpg" },
  @{ Src = "$root\IMAGES\photos\july_scan1\EDITScanFruity.jpg"; Dest = "raw/home/scan-fruity.jpg" },
  @{ Src = "$root\IMAGES\photos\july_scan1\EDITScanBalanced&Sweet.jpg"; Dest = "raw/home/scan-balanced-sweet.jpg" },
  @{ Src = "$root\IMAGES\photos\july_scan1\EDITScanChocolate&Nutty.jpg"; Dest = "raw/home/scan-chocolate-nutty.jpg" },
  @{ Src = "$root\IMAGES\photos\july_scan1\EDITScanSpicy&Earthy.jpg"; Dest = "raw/home/scan-spicy-earthy.jpg" },
  @{ Src = "$root\IMAGES\photos\july_scan1\EDITScanExperimental.jpg"; Dest = "raw/home/scan-experimental.jpg" },

  # Home — photo essay triptych
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTSpicy&EarthyJun03.png"; Dest = "raw/home/photo-essay-1.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTFruityJun02.png"; Dest = "raw/home/photo-essay-2.png" },
  @{ Src = "$root\IMAGES\photos\june2026\WEBCUTFloralJun06.png"; Dest = "raw/home/photo-essay-3.png" },

  # Quiz — question photos + large coffee photo
  @{ Src = "$root\IMAGES\photos\Quiz Pics\QuizPic01.png"; Dest = "raw/quiz/pic-1.png" },
  @{ Src = "$root\IMAGES\photos\Quiz Pics\QuizPic02.png"; Dest = "raw/quiz/pic-2.png" },
  @{ Src = "$root\IMAGES\photos\Quiz Pics\QuizPic03.png"; Dest = "raw/quiz/pic-3.png" },
  @{ Src = "$root\IMAGES\photos\Quiz Pics\QuizPic04.png"; Dest = "raw/quiz/pic-4.png" },
  @{ Src = "$root\IMAGES\photos\Quiz Pics\QuizPic05.png"; Dest = "raw/quiz/pic-5.png" },
  @{ Src = "$root\IMAGES\photos\Quiz Pics\QuizPic06.png"; Dest = "raw/quiz/pic-6.png" },
  @{ Src = "$root\IMAGES\lifestyle\CoffeePic10.png"; Dest = "raw/quiz/coffee-large.png" },

  # Patterns — shared by FlavorQuiz + TasteFinderSection
  @{ Src = "$root\IMAGES\patterns\spicy.jpg"; Dest = "raw/patterns/spicy-earthy.jpg" },
  @{ Src = "$root\IMAGES\patterns\fruity.jpg"; Dest = "raw/patterns/fruity.jpg" },
  @{ Src = "$root\IMAGES\patterns\balanced.jpg"; Dest = "raw/patterns/balanced-sweet.jpg" },
  @{ Src = "$root\IMAGES\patterns\experimental.jpg"; Dest = "raw/patterns/experimental.jpg" },
  @{ Src = "$root\IMAGES\patterns\floral.jpg"; Dest = "raw/patterns/floral.jpg" },
  @{ Src = "$root\IMAGES\patterns\chocolate.jpg"; Dest = "raw/patterns/chocolate-nutty.jpg" },

  # Lifestyle
  @{ Src = "$root\IMAGES\lifestyle\FamilyEdit.jpg"; Dest = "raw/lifestyle/family.jpg" },
  @{ Src = "$root\IMAGES\lifestyle\CoffeePic15.jpg"; Dest = "raw/lifestyle/coffee-15.jpg" },
  @{ Src = "$root\IMAGES\lifestyle\CoffeePic15Vertical.jpg"; Dest = "raw/lifestyle/coffee-15-vertical.jpg" }
)

$svgFiles = @(
  @{ Src = "$root\LOGO\LogoQuarter1.svg"; Dest = "raw/brand/logo-quarter-1.svg" },
  @{ Src = "$root\LOGO\LogoLines.svg"; Dest = "raw/brand/logo-lines.svg" }
)

$videoFiles = @(
  @{ Src = "$root\IMAGES\videos\PlaceHolder09.mp4"; Dest = "raw/video/about-hero.mp4" },
  @{ Src = "$root\IMAGES\videos\PlaceHolder08.mp4"; Dest = "raw/video/about-secondary.mp4" },
  @{ Src = "$root\IMAGES\videos\PlaceHolder01.mp4"; Dest = "raw/video/home-placeholder.mp4" },
  @{ Src = "$root\IMAGES\videos\PlaceHolderHERO.mp4"; Dest = "raw/video/home-hero.mp4" }
)

$failed = @()
$count = 0

foreach ($f in $files) {
  if (-not (Test-Path $f.Src)) { $failed += $f.Src; continue }
  & $gsutil -h $cache cp $f.Src "$bucket/$($f.Dest)"
  if ($LASTEXITCODE -ne 0) { $failed += $f.Src } else { $count++ }
}

foreach ($f in $svgFiles) {
  if (-not (Test-Path $f.Src)) { $failed += $f.Src; continue }
  & $gsutil -h $cache -h "Content-Type:image/svg+xml" cp $f.Src "$bucket/$($f.Dest)"
  if ($LASTEXITCODE -ne 0) { $failed += $f.Src } else { $count++ }
}

foreach ($f in $videoFiles) {
  if (-not (Test-Path $f.Src)) { $failed += $f.Src; continue }
  & $gsutil -h $cache -h "Content-Type:video/mp4" cp $f.Src "$bucket/$($f.Dest)"
  if ($LASTEXITCODE -ne 0) { $failed += $f.Src } else { $count++ }
}

Write-Host "Uploaded: $count"
Write-Host "Failed: $($failed.Count)"
$failed | ForEach-Object { Write-Host "  FAILED: $_" }
