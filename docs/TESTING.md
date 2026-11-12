# Testing

## What runs where
| Layer | Tooling | Where it runs | Location |
|---|---|---|---|
| Rules and engines (quantity scaling, importer, grocery, categories, timer, planner, backup codec, converters) | JUnit | JVM | `app/src/test/.../core` |
| Persistence, backup/restore, import service (OCR with a fake engine, files, social captions, offline/blocked) | Robolectric + Room | JVM | `.../data/DataTest.kt` |
| Every page, navigation through every illustrated object, first-load glow, reduced motion, import → review → save, share intent flow, no-network retry, dynamic rows with undo and reorder, categories incl. the 50 limit, serving scaling, Cook Mode timer/steps/persistence/finish, planner, grocery generation/dedupe/purchased/clear, settings/themes | Robolectric + Compose UI test (real touch injection through the art layer) | JVM | `.../ui/FlowsTest.kt`, `ScreensSmokeTest.kt` |
| Touch-target audit, labels, orientation lock, permission list | JUnit/Robolectric | JVM | `.../ui/QualityTest.kt` (`ManifestTest`) |
| Small phone (320×568), tablet (800×1280), dark mode, 200 % font scale tours with “nothing leaves the screen” checks and screenshots | Robolectric native graphics | JVM | `.../ui/QualityTest.kt` |
| Real device smoke test (splash → hub → each hub object) | `connectedDebugAndroidTest` | emulator in CI | `app/src/androidTest` |

Run locally: `./gradlew :app:testDebugUnitTest` (set `ROBOLECTRIC_DEPS_DIR` to a folder holding the Robolectric `android-all-instrumented` jars on networks that block Maven downloads). Screenshots of every page at each size are written to `app/build/screens`.

Opt-in live import check on a machine with internet: `./gradlew :app:testDebugUnitTest -Dtr.live.urls=https://site/recipe1,https://site/recipe2` (prints method, confidence and counts per URL).

## Not covered by automated tests (do these on a device before release)
- Real camera capture, ML Kit recognition quality, PDF rendering (the JVM tests use a fake OCR engine and an invalid-PDF failure case).
- Android share sheet entry from a real browser/TikTok/Instagram, the notification permission dialog, alarm delivery with the screen off, vibration.
- Screen-reader walkthrough (TalkBack), hardware keyboard focus order, real IME behaviour with the art scrolling.
- Real-site import corpus (sandbox network was restricted; fixtures in `ImporterCorpusTest` stand in for common page shapes).
- ANR/crash monitoring over a long session, low-end device performance.

## iOS web shell (branch `claude/ios-testflight`)
`npm test` runs the Node ports of the engine, importer, data/backup and art-sync tests; `node tools/e2e.cjs` drives the UI in a phone-size browser; `.github/workflows/ios-check.yml` builds and launches the generated Xcode project on a macOS runner (unsigned). Real-device checks (camera/Vision quality, notification delivery, TestFlight install) remain manual.

## Importer benchmark and regression tests (2026-11)
| What | Where | Runs |
|---|---|---|
| One test per failure found in the import audit (partial data blocks, missing amounts, empty data, run-together lists, plain blog pages, multi-part recipes, page furniture, numbering gaps, cut-off steps, heading variants, two-column and table layouts, running headers and footers) | `core/ImportRepairTest.kt` (27 tests, synthetic pages) | every test run |
| Real-page benchmark: about 1,100 saved pages from about 650 sites (recipe-scrapers corpus, MIT, pinned commit `00b5297`) scored against maintained expected results, with floors that fail the build on regression | `core/RealPageBenchmarkTest.kt` | CI (corpus cloned at run time into `TR_CORPUS_DIR`); skipped when the variable is not set |
| PDF import through the Android service with PdfBox-Android: single column, two columns, amount/name table, 3 pages with browser header and footer, picture-only page | `data/DataTest.kt`, fixtures in `src/test/resources/fixtures/pdf` (generated for the tests, original content) | every test run |
| Two-column photo read column by column; low-confidence lines named; unplaced lines carried into notes | `data/DataTest.kt` | every test run |

Run the benchmark locally: clone `https://github.com/hhursev/recipe-scrapers`, check out the pinned commit, then `TR_CORPUS_DIR=/path/to/recipe-scrapers/tests/test_data ./gradlew :app:testDebugUnitTest --tests '*RealPageBenchmarkTest'`. The result line starts with `REAL-PAGE BENCHMARK`.

Measured 2026-11-11 (same pages, same scoring, before -> after): complete imports 83.6% -> 90.6%; major loss 12.6% -> 5.4%; major loss with no warning 3.5% -> 0.7%; pages with no ingredients 6.2% -> 1.4%; pages with no directions 7.4% -> 1.2%. These are saved pages: fetching live sites, real PDFs from the owner, camera recognition and handwriting are not covered and still need device testing.

## Functional update tests (2026-11-12)
`RescueTest`, `RecipeImagesTest` (pure Kotlin), `ImageImportTest` (Robolectric with real graphics), additions to `DataTest` and `FlowsTest`. See `docs/knowledge/reports/2026-11-12-functional-update.md` for what each covers. CI ends its log with `FAILED-TEST` lines and a `TEST-TOTALS` line. Device checks that no automated test replaces are in the Samsung checklist in that report.

