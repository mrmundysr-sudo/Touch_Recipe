# Touch Recipe on iOS

The Android app (`app/`, Kotlin + Compose) is untouched. The iOS app is a **Capacitor** app that lives in the same repository on its own branch, **`claude/ios-testflight`** (started from `claude/gallant-knuth-8dfywe` @ `0d496a5`, which holds the current Android source with the open-parchment Grocery List). It is never merged into `main` or the Android branches without explicit approval.

## Why a Capacitor web app
The studio's portfolio TestFlight launcher (`Touch_Music_ID` → `.github/workflows/portfolio-ios-testflight.yml`) builds Capacitor projects: it checks out a source repo and ref, runs `npm install`, `npm test`, `npx cap add ios`, `npx cap sync ios`, then `tools/patch_ios.py` if present, signs with the existing cloud-managed key, uploads to TestFlight and waits for Apple's processing. This repository follows that contract, exactly as Touch 7 Come 11 does. No signing workflow was created here and no credentials are stored here.

## Layout (repository root, so the launcher finds it)
| Path | What |
|---|---|
| `package.json`, `capacitor.config.json` | Capacitor 7 (CocoaPods → `App.xcworkspace`), bundle id `com.mundymorning.touchrecipe`, name "Touch Recipe" |
| `www/` | the whole app: plain HTML/CSS/ES modules, no bundler |
| `www/art/` | the same art + `manifest.json` the Android app ships (byte-identical, enforced by `tests/art-sync.test.mjs`) |
| `www/js/engine/` | pure logic ported from `app/.../core` (quantity, grocery, importers, categories, planner, timers, converter, search) |
| `www/js/data/` | repository (Room equivalent over IndexedDB), backup + ZIP, prefs, import service, notifications |
| `www/js/ui/`, `www/js/screens/` | art/touch engine, widgets, and every screen |
| `tools/patch_ios.py` | runs after `cap sync`: portrait iPhone, opaque icon, export compliance, launch screen, on-device text recognition bridge |
| `tests/` | `npm test` (Node): ports of the Android engine/importer/data tests + art sync |
| `.github/workflows/ios-check.yml` | unsigned simulator build check (no secrets, never uploads) |
| `tools/e2e.cjs`, `tools/serve.mjs` | developer tools: browser end-to-end check, dev server (`npm run serve`) |

The visual source is `touch_recipe_visual_assets.zip` (chunked in `.touch-uploads/`). `app/src/main/assets/art` is generated from it by `tools/build_assets.py`; `www/art` is a copy of that output.

## Parity with Android
Screens, rules, data and files match: Splash, Kitchen Hub (physical-object touch with cutout hit-testing, first-load illumination), Recipe Collection (search, sort, filters, favorites, category tabs), Recipe Detail (servings scaling, ingredient ticks, editors, photo, share, delete with undo), Cook Mode (wall-clock timer that survives leaving the screen, step list, finish), Import (link, paste/type, scan, PDF/file) → Review (warning badges, editors, categories, duplicate check) → Save, Meal Planner, the **open-parchment Grocery List** (bold category headings with their items in one scrolling panel; add, check, clear checked, grouping, collapse, row options, undo), and the Junk Drawer pages (Settings, Category Management, Themes, Help, Backup & Export, Timer & Tools, Print & Share).
Backups use the same ZIP/`data.json` format (`docs/BACKUP_FORMAT.md`): a backup made on Android restores on iOS and back.

### Deliberate differences (platform limits, none hidden)
- **No iOS Share-sheet entry** ("Import to Touch Recipe"). A Share Extension is a separate signed target; instead every import screen has "Paste from clipboard" and the Share-help sheet explains copy → paste.
- **Scan / PDF** use Apple Vision + PDFKit through a small native bridge (installed by `patch_ios.py`); recognition is on-device. In a desktop browser the bridge is absent and the app offers Paste or Type.
- **Timer alerts** use Capacitor Local Notifications (permission explained first, at the first timer start). Vibration uses Haptics.
- **Print** buttons open the iOS share sheet (it contains Print and Save to Files).
- **Keep screen on** uses the Screen Wake Lock API (iOS 16.4+).
- Text size uses the in-app setting (iOS Dynamic Type is not applied to the artwork pages).

## Delivering to TestFlight
Run the **Portfolio iOS TestFlight Launcher** workflow in `mrmundysr-sudo/Touch_Music_ID` (branch `grok/ios-testflight`) with:
`source_repository` = `mrmundysr-sudo/Touch_Recipe`, `source_ref` = `claude/ios-testflight`, `bundle_id` = `com.mundymorning.touchrecipe`, `app_name` = `Touch Recipe`.
Prerequisite on Apple's side: an App Store Connect app record for `com.mundymorning.touchrecipe` (the upload step cannot create one). Signing and upload secrets are the studio's existing `APPLE_SIGNING_*` / `APP_STORE_CONNECT_*` values in that repository.

## Verification
- `npm test` — 56 Node tests (ports of the Android tests, art sync, ZIP/backup round trips incl. Android-format files).
- `node tools/e2e.cjs` — 36 UI checks in a phone-size browser, zero console errors.
- `ios-check.yml` — unsigned macOS build: project generation, patching, compile for the iOS Simulator (including the Swift bridge), launch, and a CI-only tour of every screen.

## Parity with the Android functional update (2026-11): status

Ported to `www/` and verified by `npm test` (126 tests; the real-page benchmark runs in CI) and the browser end-to-end checks (`tools/e2e.cjs`, `tools/e2e-rescue.cjs`). The native Swift additions compile only on the macOS runner (`ios-check.yml`).

| Android piece | iOS status |
|---|---|
| Importer repair: PageScan, Reconcile, ImportValidator, ImageCandidates, repaired text parser | Ported 1:1 (`www/js/engine/`), same test cases, benchmark within ~0.4 points of Android |
| Recipe Rescue (select, send, replace, Smart Paste, Start Fresh, undo/redo, family questions) | Ported (`screens/rescue.js`); phone layout uses two tabs (Recipe / Original) |
| Unfinished recipes, kept originals, View the original, removal and orphan clean-up | Ported (`data/drafts.js`, IndexedDB v2 stores `drafts`, `originals`; `screens/unfinished.js`) |
| Straightening, brightness, dish-photo cut-out, manual crop | Ported with canvas (`data/imagetools.js`, `screens/crop.js`); drag four handles, or "Find the photo for me" |
| PDF first page as picture + dish photo | New native method `renderPdfPage` in `tools/patch_ios.py` (PDFKit) |
| Detail and Cook Mode as continuous scrolling pages | Done (`ui/page.js`, art slots `page_11`, `page_13`) |
| Grocery list, Import Review | **Not rebuilt.** Grocery already scrolls as one list inside its artwork panel; Review is a form. Both unchanged and working. |

### Known limits on iOS
- `LayoutReader` (column-aware reading order) is ported but not fed: the native bridge returns text, not line positions, so two-column cookbook scans may read in page order. Rescue's Original tab is the remedy.
- No in-app live browsing of a recipe page (cross-origin frames cannot be read in a WKWebView); use Share/Copy, then paste, or open the page in Safari.
- "Open the PDF" uses a blob link and may not open in the web view; the cleaned page picture is shown instead.
- Drafts and originals are not part of the backup ZIP yet (same as Android).
- Recipe Rescue is portrait (the app is portrait-only on iPhone).
- Swift changes were not compiled locally.
