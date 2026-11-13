# 2026-11-13 iOS functional update

**Branch:** `ccr-c5e79198-7pqe4i` (contains the iOS app merged from `claude/ios-testflight` @ 8018f84). **Scope:** bring the iOS Capacitor app to the Android 1.2.0 functional update. Owner approved ("bring the ios version up to the same update").

## Done
- Engine port with the same tests as Android (importer repair, Rescue rules, image analysis): 126 JS tests, 0 failing; JS corpus benchmark 90.2% complete / 5.7% major loss / 0.9% silent major loss / 99.1% photo found (Android: within ~0.4 points).
- Data: IndexedDB v2 (`drafts`, `originals`), DraftStore with kept originals per recipe.
- Importer keeps the original in every path; dish photo cut-out from photos and from the PDF's first page (native `renderPdfPage`).
- Screens: Recipe Rescue, Unfinished recipes, Original viewer, crop tool; Detail and Cook as continuous pages.
- Tests: `tests/drafts.test.mjs`, `tools/e2e-rescue.cjs` (rescue -> unfinished -> create -> original), `tools/e2e.cjs` updated for the new Detail/Cook.

## Not done / limits
See `docs/IOS.md`, "Known limits on iOS". Grocery and Review were not rebuilt. Swift changes (`renderPdfPage`) need the macOS CI to prove they compile. No real-device test yet: that is the TestFlight pass.

## Delivery
No TestFlight upload was started by this work. Launcher inputs: `source_repository=mrmundysr-sudo/Touch_Recipe`, `source_ref=ccr-c5e79198-7pqe4i`, `bundle_id=com.mundymorning.touchrecipe`, `app_name=Touch Recipe`.
