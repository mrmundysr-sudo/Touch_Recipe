# Work Report — 2026-10-30 — Touch Recipe first production-release implementation

**Status:** Awaiting owner review (not merged, not released)
**Repository / branch / commit:** `mrmundysr-sudo/Touch_Recipe` · `claude/blissful-rubin-d0ni9m` · code commit `COMMIT_CODE`; this report committed in a follow-up (see `git log`)
**Base:** `planning/touch-recipe-product-discovery` @ `ffbd603` (verified live; `main` @ `8f617ac` contained no app or docs). No open PRs were found or created.
**Scope authorized by owner:** the 2026-10-30 assignment (DEC-013). Merge/publish/release/signing were **not** authorized.
**Related issue / PR:** none

## Baseline and knowledge reviewed
CLAUDE.md, README, PRODUCT_VISION, DECISIONS, DEVELOPMENT_PLAN, VISUAL_ASSET_SPEC, CATEGORY_CATALOG, KITCHEN_HUB_INTERACTION_MAP, COMPONENT_REGISTRY, BRANCH_STATUS, knowledge registers (all empty). The asset archive was reassembled from the 182 chunks; sha256 matched the manifest (`d215b378…f9481`). The Touch-Modules registry was **not reachable** (outside session scope); recorded in `docs/ARCHITECTURE.md`.

## Changes made
Complete native Android app (Kotlin, Compose, Room, ML Kit, jsoup): splash, Kitchen Hub, Recipe Collection (+search/filter/sort/favorites), Recipe Detail (scaling, checkboxes, editors, cook/grocery panels), Cook Mode (persistent steps and wall-clock timer, notification explanation at first start), Import Recipe (URL, paste/type, camera/OCR, PDF/file, Android Share, clipboard) with progress/error/retry, Import Review & Save (dynamic rows with drag handles, undo, validation, confidence badges, category system with 50 custom limit), Meal Planner, Grocery List (generation, merge/dedupe, purchased state, custom aisles), Kitchen Junk Drawer and its seven utility pages (Settings, Category Management, Backup & Export, Themes, Help, Timer & Tools incl. converter, Print & Share). Art is wired by manifest from the PSD cutouts; first-load illumination implemented (DEC-016). Tooling: `tools/build_assets.py`, `tools/art_map.py`, `tools/mapping_sheet.py` (+ `docs/art-map/*.jpg`). CI workflow `.github/workflows/android.yml`. Docs added: ART_WIRING, ARCHITECTURE, TESTING, BACKUP_FORMAT, store/PLAY_LISTING.

## Decisions and tradeoffs
DEC-013…DEC-019 in `docs/DECISIONS.md`. Biggest tradeoff: fixed art means small content windows (2–4 rows) with one-tap full editors; portrait lock; Material-based (themed) utility pages because no art exists for them.

## Tests and evidence
| Check | Environment | Result | Evidence |
|---|---|---|---|
| 82 unit + Robolectric/Compose UI tests (engines, importer incl. JSON-LD/microdata/HTML/text/OCR-fake, persistence across DB reopen, backup/restore, every page and hub/drawer object navigation, first-load glow + reduced motion, URL/paste/share/offline/blocked imports, dynamic rows/undo/reorder/keyboard, categories + 50-limit, serving scaling, Cook Mode timer/steps/persistence/finish/time's-up, planner assign/replace/remove/week dates, grocery generation/merge/purchased/clear/collapse, settings/themes, converter, manifest touch-target audit, portrait lock, permission list, small/tablet/dark/200 %-font tours) | JVM (Robolectric 4.14 SDK 34, native graphics), 4-core sandbox | 82 run, 0 failed, 0 skipped; last 4 consecutive full runs green | `app/build/test-results`, `docs/TESTING.md` |
| Lint (debug) | Android lint | 0 errors, 48 warnings (dependency/AGP version notices etc.). Lint found and I fixed: missing VIBRATE permission, API-33-only call in the URL fetcher (crash on Android 8–12), two theme attributes needing version resources, two StateFlow reads in composition | `app/build/reports/lint-results-debug.xml` |
| Debug APK | Gradle 8.14.3 / AGP 8.7.3 / JDK 21 | built, 62 MB, `com.mundymorning.touchrecipe.debug` 1.0.0-debug, minSdk 26, targetSdk 35 | `app/build/outputs/apk/debug/app-debug.apk` |
| Release APK (R8 + resource shrink) | same | built, 51 MB, **unsigned** by design, `com.mundymorning.touchrecipe` 1.0.0 | `app/build/outputs/apk/release/app-release-unsigned.apk` |
| Emulator smoke test | — | **written, not run here** (no KVM in sandbox); CI job `instrumented` runs it | `app/src/androidTest` |
| Device checks (camera/OCR, PDF, share from real apps, TalkBack, alarm/notification, vibration, live sites) | — | **not run** | `docs/TESTING.md`, K-001…K-003 |

## Owner punch list
| ID | Reproduction | Expected | Actual | Priority | Fix | Retest |
|---|---|---|---|---|---|---|
| OP-1 | Install debug APK; import a real recipe URL, a photo and a PDF | Review screen fills sensibly | not testable in sandbox | High | Device test | pending |
| OP-2 | TalkBack through Hub → Review → Cook Mode | Every object announced and operable | semantics present, unverified on device | High | Device test | pending |
| OP-3 | Compare `docs/art-map/*.jpg` with intended touch regions | Regions match objects | derived from PSD layers | Medium | Adjust `tools/art_map.py` | pending |

## Problems and fixes
See `LESSONS_LEARNED.md` L-001…L-008 (snackbar swallowing taps, blocking toast before navigation, flow re-creation, main-thread navigation, undersized touch targets, dark-mode chips, test return types, sandbox rate limits) and the four lint defects above.

## Knowledge updates
`PATTERNS.md` P-001…P-007, `LESSONS_LEARNED.md`, `KNOWN_ISSUES.md` K-001…K-009, `TESTING_HISTORY.md`.

## Outstanding work and approvals
- **Matthew's decisions before release:** (1) confirm DEC-013…019, esp. glow policy (first two visits/page), portrait lock, snackbar at top, code back chips on Collection/Planner; (2) approve utility-page look or commission art for them; (3) provide signing key / Play account and approve the privacy-policy text; (4) approve using ML Kit (bundled, adds ≈ 40 MB to the APK before Play splitting) vs. a lighter OCR; (5) compare with the Touch-Modules registry; (6) decide on sync/sharing (still open) and monetization (Q-006); (7) approve merging this branch.
- Merge/release authorized: **No**
