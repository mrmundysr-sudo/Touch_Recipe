# Work Report — 2026-11-04 — Touch Recipe for iOS (TestFlight)

**Status:** Awaiting delivery step (build verified unsigned; TestFlight upload not yet run, see blockers)
**Repository / branch / commit:** `mrmundysr-sudo/Touch_Recipe`, `claude/ios-testflight` (from `claude/gallant-knuth-8dfywe` @ `0d496a5`; final commit in git log)
**Scope authorized by owner:** Complete iOS version matching the Android app (incl. the open-parchment Grocery List), delivered through the existing TestFlight launcher and credentials. No new signing workflow, no iOS merge.
**Related issue / PR:** none

## Baseline and knowledge reviewed
CLAUDE.md, DEVELOPMENT_PLAN, DECISIONS, VISUAL_ASSET_SPEC, ARCHITECTURE, ART_WIRING, TESTING, BRANCH_STATUS; Touch-Modules registry (empty: no reusable module); hub `touch-development` (Android-only AutoBuild); `Touch_7_Come_11` (`ios-testflight.yml`, `tools/patch_ios.py`) and `Touch_Music_ID` (`portfolio-ios-testflight.yml`, the launcher).

## Changes made
Capacitor iOS app at the repo root (see `docs/IOS.md`): engines and tests ported from Kotlin, IndexedDB repository, all screens, ZIP-compatible backup, Vision/PDFKit bridge via `tools/patch_ios.py`, unsigned simulator check workflow. Android sources untouched.

## Decisions and tradeoffs
- Capacitor (not native SwiftUI): the existing launcher only builds Capacitor projects; a native project would have needed a new signing workflow, which was ruled out.
- Share-sheet entry replaced by clipboard paste (a Share Extension needs a second signed target).
- Native code appended to `AppDelegate.swift` by the patcher so the generated Xcode project file is never edited.

## Tests and evidence
| Check | Environment | Result | Evidence |
|---|---|---|---|
| `npm test` (56 tests: engines, importer corpus, data/backup/ZIP, art sync) | Node 22 + macOS runner | pass | local run; ios-check.yml |
| UI end-to-end (36 checks, no console errors) | Chromium, iPhone-size viewport | pass | `tools/e2e.cjs` |
| Generate, patch, compile for iOS Simulator, launch | GitHub Actions macOS | pass | `iOS build check` runs on `5f6b3ba`, `1054d7d` |
| Screens rendered on iOS | iOS Simulator (WKWebView) | pass | screenshots from the CI tour (Review, Planner, Grocery, Settings, Tools, Themes) |
| TestFlight upload + Apple processing | portfolio launcher | **not run** | blocked, see below |

## Owner punch list
| ID | Reproduction | Expected | Actual | Priority | Fix | Retest |
|---|---|---|---|---|---|---|
| — | install the TestFlight build, open Grocery List | one parchment, bold headings, scrolling | to be confirmed on device | — | — | — |

## Problems and fixes
Invisible accessibility buttons intercepted finger taps (objects did not respond); fixed by `pointer-events: none` on them, keyboard/AT activation kept. Older-iOS fallbacks added (`structuredClone`, `dvh`).

## Knowledge updates
Lesson: when a studio launcher exists, match its contract (Capacitor + `tools/patch_ios.py`) instead of building a parallel pipeline.

## Outstanding work and approvals
- Run the portfolio launcher for this branch (inputs in `docs/IOS.md`) — needs permission to dispatch a workflow in `Touch_Music_ID`, or the owner can run it.
- Confirm an App Store Connect app record exists for `com.mundymorning.touchrecipe`.
- Merge/release authorized: No
