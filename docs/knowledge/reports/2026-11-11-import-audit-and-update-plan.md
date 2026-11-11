# Work Report — 2026-11-11 — Phase 1 audit, import benchmark and update plan

**Status:** Phase 1 complete. Awaiting owner approval. No application code was changed.
**Repository:** `mrmundysr-sudo/Touch_Recipe`
**This report's branch:** `ccr-c5e79198-7pqe4i` (docs only, at planning commit `ffbd603` plus this file)
**Scope authorized by owner:** research and technical audit only (Major Update specification, section 11).

## 0. Verified repository state

| Item | Verified value |
|---|---|
| Default branch | `main` @ `8f617ac` (one commit, no app) |
| Android source (current) | `claude/gallant-knuth-8dfywe` @ `20a819b`, native Kotlin + Jetpack Compose |
| iOS source (current) | `claude/ios-testflight` @ `8018f84`, Capacitor web app in `www/`; contains the Android branch (merge base `20a819b`, `app/` identical) |
| Latest Android test build | prerelease `devtest-recipe-42186752200-20a819b` (Android CI run 42186752200, success) |
| Latest CI on iOS branch | Android CI run 42193108572 and iOS build check run 42193108334, both success on `8018f84` |
| Open pull requests | none |
| Older lines | `claude/blissful-rubin-d0ni9m`, `claude/relaxed-faraday-ijecx2` (both already contained in the current Android branch) |

Proposed base for Phase 2: `claude/ios-testflight` @ `8018f84`, because it holds both apps and is green. The working branch `ccr-c5e79198-7pqe4i` is an ancestor of it, so it can be fast-forwarded with no force-push.

`docs/BRANCH_STATUS.md` and `README.md` on the planning branch are stale (they still say no app exists). The Touch-Modules registry is not in this session's repository scope and was not read.

## 1. Existing architecture assessment

Two separate codebases implement the same design and must be changed in parallel:

- **Android:** `core/importer/` (`WebRecipeExtractor`, `TextRecipeParser`, `Durations`), `data/ImportService.kt`, `data/Fetcher.kt`, `data/Ocr.kt`, Room database version 1, Compose screens drawn inside fixed artwork regions by `ui/art/ArtScreen.kt`.
- **iOS:** hand ports of the same engines in `www/js/engine/`, IndexedDB storage, Apple Vision and PDFKit through a small native bridge.

What exists today, by stage:

| Stage | Current behavior | Assessment |
|---|---|---|
| Web retrieval | One plain HTTP GET with a custom user agent. No cookies, no JavaScript. HTTP 401/403/429/503 is reported as "blocked". | Not measurable here (see section 3). Likely a large share of real failures. |
| Web extraction | JSON-LD, then microdata, then CSS-selector and heading heuristics. The fallback only runs when a whole section is empty. | Good on clean structured data, weak everywhere else. No cross-check against the visible page. |
| PDF, Android | Every page is rendered to a bitmap (max 1800 px, first 6 pages) and read by OCR. The embedded text layer is never used. | Confirmed root cause for digital PDFs. |
| PDF, iOS | Uses the text layer, with OCR when the layer looks damaged. | Better than Android; the two platforms disagree. |
| Photo / OCR | ML Kit Latin model (Android), Vision (iOS). Text blocks are joined in the order the recognizer returns them. No per-line confidence is kept. | Multi-column pages can interleave. No handwriting path. |
| Text parsing | Header-driven line classifier. Lines before the first header become the description. | Loses structure when headers are missing or out of order. |
| Validation | Warnings only for an empty title, empty ingredients or empty directions. | No completeness check. A recipe with 8 of 15 ingredients raises nothing. |
| Original source | `rawSource` keeps the JSON-LD block or the OCR text (60,000 characters max). The page, PDF file and photo are not kept. | Nothing to compare against later. |
| Draft persistence | `ImportSession` is held in memory only. | A draft is lost if Android closes the app. No Unfinished Recipes store. |
| Review screen | Ingredients and directions sit in small fixed artwork windows that show 2 to 4 rows with a fade (known issue K-004). | Correctly imported content can look missing. |
| Recipe page, Cook Mode, Grocery | Lists scroll inside fixed regions of an 841 x 1870 page image. Description is cut at 5 lines, title at 3. | Matches the reported layout problem. |
| Orientation | Activity is locked to portrait in the manifest. | Recipe Rescue landscape split needs this relaxed for that screen. |
| Tests | JUnit and Robolectric on Android, Node tests on iOS, three Paula Deen fixtures. No real-site corpus, no device OCR test (K-001, K-002). | The importer has never been measured against real pages before this report. |

## 2. Competitive research findings

Evidence is limited: the competitor websites (paprikaapp.com, recipekeeperonline.com, copymethat.com) and Google's ML Kit documentation are blocked by this session's network policy, and no competitor app could be run. What follows comes from web search results of reviews and store listings only.

- **Paprika** imports through a built-in browser. The user opens the recipe page inside the app and taps Download. Reviews state it reads Schema.org recipe markup. For pages that fail, the user highlights text in the browser and taps a field button (Name, Ingredients, Directions and so on) to file it; Paprika's help index calls these the clipboard tools. One review notes it struggles with pages holding several recipes.
- **Copy Me That** is a one-click browser clipper with later editing; a side-by-side view is a paid feature.
- **Mela** uses an in-app browser with a "Found Recipe" button; older reports describe "no recipe found" on some sites that Paprika handled.
- **Recipe Keeper:** nothing verifiable was found.

The design lesson is clear even with thin evidence. Paprika's reliability rests on two things Touch Recipe lacks: the page is loaded by a real browser engine the user is looking at, and there is always a manual select-and-assign path. Recipe Rescue is the same idea taken further.

Not done: no side-by-side import comparison with Paprika or any other app. That needs the apps on a device.

## 3. Benchmark and root causes

### What was tested

The iOS JavaScript port of the extractor (a line-for-line port of the Kotlin one) was run unchanged over the test corpus of the open-source `recipe-scrapers` project (MIT, commit `00b5297`): **1,125 saved real recipe pages from 648 websites**, each with a maintained expected result. This is far more than the 20 pages requested, but it measures parsing only.

### Results

| Measure | Result |
|---|---|
| Complete import (every ingredient, at least 95% of instruction text) | 82.6% |
| All ingredients found | 86.8% |
| No ingredients at all | 6.4% |
| Instructions at least 95% complete | 89.9% |
| No instructions at all | 7.5% |
| Major loss (under 70% of ingredients or of instruction text) | 13.4% |
| Ingredient order kept / step order kept | 99.2% / 99.9% |
| Extra or unmatched ingredient lines (over 20% of lines) | 5.3% |
| Title correct | 97.7% |
| Image found when the page has one | 97.2% |
| Servings correct / total time correct | 91.8% / 92.9% |

By extraction path:

| Path | Pages | Complete |
|---|---|---|
| JSON-LD | 973 | 89.8% |
| Microdata | 43 | 79.1% |
| HTML fallback | 109 | 20.2% |

**Silent failures:** of 195 incomplete imports, 88 (45%) carried no warning, and 78 were labelled high confidence.

The scoring is strict and some "ingredient lines differ" cases are formatting differences, so 82.6% is a floor for parsing quality on these pages.

### Root causes, by stage

| # | Stage | Cause | Evidence |
|---|---|---|---|
| R1 | Retrieval | Plain HTTP client instead of a browser: bot checks, consent walls and script-rendered pages return no recipe. | Code reading only. **Not measured**: recipe sites are blocked from this sandbox. |
| R2 | Extraction | Generic HTML fallback fails on pages with no structured data. | 69 pages; 20% success on that path. |
| R3 | Extraction | JSON-LD is trusted when it is partial. Ingredient lines missing or different from the visible page (45), instruction text partly missing (22), all ingredients collapsed into one string (12), empty instruction or ingredient arrays (11), empty recipe node (9). | Benchmark classification. |
| R4 | Extraction | Microdata present but not used, or only partly read. | 20 pages. |
| R5 | Extraction | Known recipe-plugin markup not read by the fallback. | 6 pages. |
| R6 | PDF | Android never reads the PDF text layer; it photographs and OCRs each page, and stops at 6 pages. | `data/Ocr.kt`, `ImportService.fromPdf`. Explains losses on well-formatted PDFs. |
| R7 | OCR | Recognizer block order is used as reading order; two-column layouts interleave ingredients and steps. | Code reading. Not device-tested. |
| R8 | Parsing | Text parser depends on section headers; without them lines are guessed one at a time. | `TextRecipeParser.kt`. |
| R9 | Validation | No completeness check and no comparison with the source. | 45% of incomplete imports were silent. |
| R10 | Display | Review and recipe screens show 2 to 4 rows in fixed windows, so complete imports can appear incomplete. | `ReviewScreen.kt`, `DetailScreen.kt`, K-004. |
| R11 | Saving | Drafts live in memory; originals are not stored. | `AppContainer.ImportSession`, `Models.kt`. |

The split between R1 and the rest cannot be settled without the owner's failing examples. The repository holds only the Paula Deen page and PDF text. **The actual failing URLs, PDFs, scans and handwritten cards from family testing are needed.**

## 4. Recommended libraries and methods

| Need | Recommendation | License / cost | Notes |
|---|---|---|---|
| Web retrieval | In-app browser (Android `WebView`, iOS `WKWebView`). Extract from the rendered page the user is viewing. Keep the HTTP fetch as the quick path. | Platform, free | Same approach as Paprika. User-directed; no access control is bypassed. Also provides the "original" pane for Recipe Rescue. |
| Structured data | Keep jsoup and the existing JSON-LD and microdata readers; add RDFa and fix R3 to R5. | MIT, existing | |
| Site knowledge | Do not embed `recipe-scrapers` (Python, cannot run on device). Use its corpus as the regression suite and its site rules as reference. | MIT | Corpus pages are third-party content: fetch in CI, do not ship in the app. |
| HTML fallback | Section finder scored on ingredient-like lines and step-like blocks under headings, instead of fixed selectors. | In-house | Measured against the corpus. |
| PDF text, Android | PdfBox-Android text stripper with position sorting; OCR only for pages with no usable text. | Apache-2.0, free | Confirm text-stripper behavior in a short spike. Android 15 also has `PdfRenderer.Page.getTextContents()` (API 35), usable as a second source on new devices. |
| PDF text, iOS | Keep PDFKit, add the same page-by-page mixed handling. | Platform | |
| Printed OCR | Keep ML Kit (Android) and Vision (iOS); sort lines by position, detect columns, keep bounding boxes and confidence. | Free, on-device | |
| Handwriting | On-device recognition as a draft only, with the photo shown beside editable text and low-confidence words flagged. No cloud OCR by default. | Free | Vision handles handwriting; ML Kit's Latin model is not built for it (from prior knowledge, documentation could not be opened). Expect manual correction on Android. A paid cloud service would be an owner decision on cost and privacy. |
| Ingredient parsing | Keep `core/quantity`; no new dependency. | Existing | |

## 5. Recipe Rescue design

**Data (additive only, Room migration 1 to 2, IndexedDB store on iOS):**

- `import_drafts`: id, current recipe fields as JSON, source reference, undo stack, unresolved questions, timestamps, status.
- `source_attachments`: id, owner (draft or recipe), kind (page snapshot, PDF, photo, pasted text), file name in private storage, original address.
- `help_notes`: id, owner, target (ingredient id, step id, or a point on a source image), text, resolved flag.
- `Recipe` gains optional attachment references. Existing rows are untouched. Backup format gains these as optional entries so old backups still restore.

**Pipeline:** every import method produces one `ImportResult`: recipe fields, the preserved source, every source line with a classification (title, ingredient, step, note, unclassified), and validation findings. Unclassified lines are kept and shown, never dropped.

**Completeness validation:** compare the count and text of ingredient-like lines found in the source against what was captured; compare instruction text length; check each ingredient for a quantity; check step numbering gaps. Findings are either *confirmed missing* (present in source, absent in recipe) or *uncertain* (low OCR confidence, ambiguous line).

**Screens:**

1. *Import preview:* Accept, Edit, Compare with original, Open Recipe Rescue, Save for Later. Shows findings at the top. Never overwrites a saved recipe; a matching source address offers "save as new" or "replace" explicitly.
2. *Recipe Rescue:* landscape shows the original on the left (web view, PDF pages, or zoomable image) and the editor on the right, each scrolling on its own. Portrait uses a draggable divider with the original above, or two tabs on small phones. State is held in a view model and autosaved to `import_drafts` on every change, so rotation and interruption lose nothing.
3. *Transfer:* select text on the left, then Add to Ingredients, Add to Steps, Set Title, Set Servings, Set Times, Add to Notes. Multi-line selections split into rows in order. For images, tap recognized lines or drag a box; the text is editable before it is added. Smart Paste classifies a pasted block and shows the result for confirmation.
4. *Select mode:* multi-select of ingredients, steps, photo, notes and fields; Remove Selected, Replace Selected, Select All Ingredients, Select All Steps, Cancel; Undo and Redo from a command stack saved with the draft.
5. *Start Fresh:* clears chosen fields after confirmation, keeps the source, is undoable.
6. *Unfinished Recipes:* list of drafts reachable from the Import screen and the Collection.
7. *Needs Help:* flag on any row or a pin on the source image, with a note; listed on the draft and kept on the saved recipe until resolved.
8. *Original kept:* the photo or scan stays attached to the finished recipe with a "View original" action.

## 6. Layout and artwork architecture assessment

The art pipeline is sound and stays: the owner's `app-visual-builder/manifest@1` ZIP (page IDs, fixed slot filenames, normalized 0 to 1 coordinates) is converted by `tools/build_assets.py` and `tools/art_map.py` into `art/manifest.json`. Hub, Splash, Import, Planner and Junk Drawer are fixed scenes and need no change.

The problem is confined to four pages where variable content is forced into regions of one fixed page image: Recipe Detail (`page_04`), Cook Mode (`page_05`), Import Review (`page_07`) and Grocery List (`page_09`).

Proposed change: a second page type, **scrolling page**, alongside the existing fixed scene.

- Slots: `top` (decorative header, fixed aspect), `tile` (seamless herb-border strip repeated vertically, never stretched), `bottom` (drawn once after the last content item). Interactive art pieces stay as cutouts with coordinates relative to their own slot.
- Content between top and bottom is ordinary code layout in a single scroll container: one scroll per page, no nested lists.
- Buttons that must stay reachable (Cook Mode, Add to Grocery, Save) are pinned art cutouts with the same hit-testing as today.
- Phase 2 uses flat parchment colour placeholders in those slots. Existing art files are kept in the repository and disconnected only on these four pages.
- The template ZIP delivered with the APK keeps `page_01` to `page_10` unchanged, marks `page_04`, `page_05`, `page_07`, `page_09` as needing replacement, and adds new page IDs for Recipe Rescue, Import Preview and Unfinished Recipes, each with slot filenames, pixel sizes and descriptions in the same manifest schema.

Open question: whether the visual builder accepts extra slot names (`top`, `tile`, `bottom`) or whether these should be expressed as three `other_N` files plus `coords.json`. This needs the owner's answer so the template is not incompatible.

## 7. Proposed development stages

| Stage | Content | Exit test |
|---|---|---|
| A | Corpus regression harness in CI for both platforms; owner samples added as fixtures. | Baseline numbers reproduced in CI. |
| B | Extraction fixes R2 to R5, completeness validation R9, unified `ImportResult`. | Corpus targets in section 8. |
| C | Android PDF text layer and mixed PDFs (R6), position-sorted OCR (R7), original files preserved. | Owner PDFs import completely. |
| D | In-app browser import (R1). | Owner's failing URLs import or are flagged. |
| E | Draft and attachment storage, Import Preview, Unfinished Recipes. | Draft survives force-stop and rotation. |
| F | Recipe Rescue: split view, transfer, select mode, undo, Start Fresh, Needs Help. | Section 8.2 of the specification. |
| G | Scrolling page type; Recipe Detail, Cook Mode, Grocery, Review rebuilt with placeholders. | 5-ingredient and 40-ingredient recipes, large text, rotation. |
| H | Android test APK and visual-builder template ZIP delivered together. Stop for owner. | |
| I | Artwork integration, then final APK. | Visual baseline comparison. |
| J | iOS parity for each stage, through the existing TestFlight launcher when authorized. | `npm test`, e2e, iOS build check. |

Each stage is a separate set of commits with its own CI run. Stages B and C alone should remove most parsing losses and can ship to testers before Recipe Rescue is finished, if the owner wants an early build.

## 8. Risks, dependencies and test criteria

**Proposed measurable targets (same corpus, same scoring):**

- Complete imports: from 82.6% to at least 93%.
- Major loss: from 13.4% to under 5%.
- Incomplete imports with no warning: from 45% to under 5%.
- No increase in extra or invented lines (currently 5.3%).
- Digital PDFs: every owner sample imports all ingredients and steps in order.
- No test may be skipped or weakened to reach these.

**Risks:**

- Retrieval failures are unmeasured; the in-app browser is the mitigation, but its benefit can only be proven on a device with real sites.
- Handwriting accuracy on Android will be modest. The design assumes manual transcription beside the photo.
- Two codebases double the work and can drift. Shared fixtures and identical corpus thresholds are the control.
- Stored page snapshots and scans increase storage and backup size; a size cap and an option to keep only the address are needed.
- Unlocking landscape for one screen affects the art pages, which are portrait-only; the lock must stay on those.
- PdfBox-Android adds several megabytes to the APK.
- Site terms: capture stays user-directed, the source address and attribution are kept, and nothing bypasses logins or paywalls.

**Needed from the owner before or during Phase 2:**

1. Approval of this plan and of the base `claude/ios-testflight` @ `8018f84`.
2. The failing examples from family testing: web addresses, PDFs, scans, handwritten cards.
3. Answer on the visual-builder slot naming for scrolling pages (section 6).
4. Decision: on-device recognition only, or allow an optional paid cloud service for handwriting.
5. Decision: store a snapshot of imported web pages, or only the address plus extracted text.
6. Confirmation that an early importer-only test build after stage C is wanted, or wait for stage H.
7. Access to the Touch-Modules registry and the Touch AutoBuild standards if they are to be applied.

## Not verified in this phase

- Live fetching of any recipe website.
- Any competitor app's actual import results.
- ML Kit and document-scanner documentation (host blocked); PdfBox-Android text extraction behavior on device.
- OCR quality, PDF rendering and handwriting on a real device.
- The owner's own failing examples (not in the repository).
