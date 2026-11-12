# Work Report — 2026-11-11 — Importer repair stage (Android)

**Status:** see "Build and delivery" at the end (filled in from CI).
**Repository / branch:** `mrmundysr-sudo/Touch_Recipe`, `ccr-c5e79198-7pqe4i`
**Scope authorized by owner:** importer repair stage only (website extraction and PDF repairs, completeness validation), then an importer-only Android APK and a stop for testing. Recipe Rescue, scrolling layouts and artwork are later stages and were not started.

## Verified baseline before any code change
- `claude/ios-testflight` @ `8018f84` contains every other branch (`main`, planning, `blissful-rubin`, `relaxed-faraday`, `gallant-knuth` @ `20a819b`) and all seven `devtest-` tags: no commit exists outside it.
- Android source, build files, art tools and the artwork package are byte-identical on the Android and iOS branches; the 55 Android art files equal the 55 iOS copies.
- The update branch merged that commit with an ordinary merge. No source branch was changed; `8018f84` and `20a819b` are the rollback points.

## What changed
| Area | Before | Now |
|---|---|---|
| Web: recipe data block | Trusted whenever it parsed | Checked against the visible page. Gaps are filled, a fuller trustworthy page version is used, dropped amounts are restored, and a suspected shortfall is reported with the lines kept |
| Web: pages without recipe data | Fixed selectors, first matching heading | Recipe-card markup, itemprop/RDFa anywhere, named sections, headings in many languages, multi-part lists, text after the ingredients; page furniture removed by exact name only |
| PDF (Android) | Every page photographed and recognised, first 6 pages | The PDF's own text is read (up to 40 pages). Only picture-only or damaged pages are recognised (up to 12). Mixed documents work page by page |
| Reading order | Recogniser block order | Rebuilt from positions: columns one after another, table rows kept together, running headers and footers dropped, printed source address kept |
| Text parser (paste, PDF, photo) | First heading wins, no end of section | Best ingredient and direction blocks chosen, heading variants, wrapped lines joined, several values per line, browser print header used as title |
| Completeness | Warned only when a section was empty | Findings on every import: shortfall against the page, no amounts, one ingredient, run-together lines, missing step numbers, cut-off last step, too little direction text, unreadable lines |
| Unplaced content | Not tracked | Shown on the result sheet and written into the recipe notes on the way to Review; the full extracted text stays in the recipe as before |
| Result sheet | "We found a recipe" | Says "This import may be incomplete" when anything is missing, lists what to check |

No database change, no change to saved recipes, artwork, navigation or other screens. App version name is 1.1.0.

## Measurements
Real-page benchmark, 1,125 saved pages from 647 sites (recipe-scrapers corpus, commit `00b5297`), same pages and same scoring before and after. The scorer was made tolerant of spacing and tsp/teaspoon differences during this stage, and the baseline was re-measured with it, so the "before" column differs slightly from the audit report.

| Measure | Before | After | Initial target |
|---|---|---|---|
| Complete imports | 83.6% | 90.6% | 93% |
| Major loss | 12.6% | 5.4% | under 5% |
| Incomplete imports with no warning (share of incomplete) | 42% (78 of 184) | 35% (37 of 106) | under 5% |
| Major loss with no warning (share of all pages) | 3.5% (39 pages) | 0.7% (8 pages) | — |
| No ingredients at all | 6.2% | 1.4% | — |
| No directions at all | 7.4% | 1.2% | — |
| Pages with standard recipe data: complete | 90.6% | 93.2% | — |
| Pages without it: complete | 20.2% | 65.1% | — |
| Extra or unmatched ingredient lines | 4.6% | 4.2% | no increase |
| Ingredient order kept | 99.3% | 99.4% | — |

**The initial targets are not met.** Complete imports are 2.4 points short and major loss 0.4 points over. The "silent" share is still 35% by the original definition; most of those 37 pages are near-complete (one line worded differently from the reference, or 90 to 95% of direction text), which no check can see. Counting only real losses, pages that lose a major part with no warning fell from 39 to 8, and at least 4 of those 8 are errors in the reference data (run-together words in the expected result), not in the import. About 7% of complete structured-data imports now carry a warning that turns out to be unnecessary.

PDF checks:
- Generated PDFs in four layouts (single column, two columns, amount/name table, three pages with browser header and footer): all ingredients, all steps, servings, times and source address correct.
- Stress test, 63 real pages printed to PDF with no styling (menus, sidebars and comments all included, up to 86 pages each): complete 44 of 63; title correct 52 of 63 (was about 3); pages with unrelated lines among the ingredients 13 (was 26). This is harder than a site's own print view and is reported as a limit, not a pass.

## Tests
- `ImportRepairTest` (27): one per failure class from the audit.
- `RealPageBenchmarkTest`: the benchmark above with regression floors; runs in CI.
- `DataTest` additions (5): PDF layouts through the Android service with PdfBox-Android, long PDF, scanned PDF path, two-column photo, unplaced lines kept.
- Existing suites unchanged and passing locally for the pure-Kotlin core (76 tests). The Android-layer tests can only run in CI: this sandbox has no Android SDK.

## Not done, not verified
- **iOS:** the repairs are not ported to the iOS app.
- **Live websites:** not reachable from the build sandbox. A site that blocks the plain request or needs scripts still fails by link (reported to the user, Paste offered).
- **Device:** camera recognition, scanned PDFs, handwriting and PDF rendering were not run on a phone. No handwriting-specific work was done.
- **Owner samples:** none received yet; the Paula Deen fixtures still pass.
- **Originals:** the page, PDF or photo itself is not stored yet (address and extracted text only). This needs the draft and attachment storage planned for the next stage.
- **Competitors:** no comparison with Paprika was possible.

## Decisions and tradeoffs
- The page version replaces the data block only when it comes from recipe markup or a named section and covers what the data block has; otherwise the recipe is left alone and the difference is reported. This keeps invented content out at the cost of some warnings.
- Unplaced lines go into the notes rather than a new storage field, so nothing is lost before Recipe Rescue exists and no database migration was needed.
- The benchmark corpus is cloned in CI and not committed: its pages are third-party content.
- The CI trigger and the DEV/TEST publisher were widened from `claude/**` to also accept `ccr-**`, because the update branch has that name. The publisher is otherwise unchanged (prerelease only, never `main`).

## Build and delivery
| Item | Value |
|---|---|
| Source commit of the build | `1f8c0c17b6a8ded416c28027d4e2b7c02203e1bc` on `ccr-c5e79198-7pqe4i` |
| CI run | Android CI run 43108667815 (run number 24): success. Jobs: build-test (unit and Robolectric tests with the benchmark corpus fetched, lint, debug and release assemble) and instrumented (emulator smoke test) |
| Test build | Prerelease `devtest-recipe-43108667815-1f8c0c1`, file `touch-recipe-debug-1f8c0c1-DEVTEST.apk`, package `com.mundymorning.touchrecipe.debug`, version 1.1.0-debug |
| Publisher run | DEV/TEST release run 43157877117: success, including its checks that the file is a real signed APK and that the published link downloads the same file |
| Device testing | None. The build has not been installed on a phone by the developer |

**Status:** Awaiting owner testing. Work stops here until feedback; Recipe Rescue is not started.

Installing: each CI debug build is signed with that run's own debug key, so Android will not install this build over an earlier test build. Uninstalling the earlier build deletes its saved recipes. To keep them: make a backup in the old build first (Junk Drawer, Backup), uninstall it, install this build, then restore the backup. APK SHA-256: `538374670badc63919e1c12569e9f461853650cc2970deab050dac436855f47a`.
