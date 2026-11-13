# Work Report — 2026-11-13 — iOS Recipe Rescue: the real PDF, root cause, stage-by-stage evidence

**Status:** Awaiting review. The importer's logic is verified against the **real PDF**; Apple's PDFKit and Vision output for it has **not** been observed (no Apple device here).
**Repository / branch:** `mrmundysr-sudo/Touch_Recipe`, branch `ccr-ios-rescue-review-fix` (follows `63ff9a2`). Commit: see the branch head.
**Why this report exists:** the owner's screenshots still showed a mess after `63ff9a2` although every automated test passed, and said the real PDF must be the source of truth. They were right: the earlier tests used a page **I reconstructed**, and its geometry and failure were not the real ones.

## Correction to the previous report (`2026-11-13-ios-rescue-review-fix.md`)
That report named "words cut mid-word by PDFKit character gaps" as the main cause, from reading the code. The real PDF's own text layer is clean (see below), so the *gap rule* was not the cause. But a macOS probe later the same day (below) showed that PDFKit's per-character boxes ARE wrong, for a different reason, so cut-up words from the PDFKit route were real too. There are two separate failures on the iOS route, both now addressed.

## What the real PDF is
`Veg-All Chicken Pot Pie Recipe - Food.com.pdf`: one page, made by iOS 26.5 Quartz from Chrome. Two recipe cards side by side (Veg-All left, Bourbon Chicken right, clipped at the page edge). **An advertisement image is drawn over the lower left** (it hides the end of step 6 and the last two ingredients **in the picture**; they are still in the text layer). Fractions are three separate pieces (numerator, U+2044, denominator) at different heights; amounts sit in a column beside multi-line ingredients; the second card's text layer overlaps itself. Text uses nested flips (`cm -0.717` with `Tm -32`) and per-run `Tc`/`TJ`.

## Root cause (reproduced with the real file)
`Text.looksGarbled()` treated **any line with an odd number of `"`** as a damaged text layer. This page's quotation wraps over several lines, so its lines have odd counts. The PDF's perfectly clean text layer was therefore thrown away and `preferCleanText` read the **page picture with Vision** instead, accepting it when it held at least 60% as much text. Reading this particular picture cannot work (the advertisement covers text; the right card is clipped), which is the corrupted text in the owner's screenshots. Evidence:
- `looksGarbled(real text)` was `true` before the fix and is `false` after; the genuine cases (`Southern "ied Chicken`, `Di!iculty`, `Di"iculty`) are still caught.
- With the old detector the real-PDF tests fail ("picture reading was requested"); with the fix they pass (run both ways on 2026-11-13).

## PDFKit evidence (macOS runner, Xcode 26.6, macOS 26.7; `.github/workflows/pdfkit-probe.yml`, run 43375472310)
An INVENTED two-card page drawn with Apple's Quartz PDF engine (doubly flipped text matrices like the real file), read with PDFKit by the app's own Swift:
- `page.string` is **clean**: whole words, whole lines, newlines between lines (`"1. Combine first 6 | ingredients. | 2. Spoon into prepared ..."`).
- `characterBounds(at:)` boxes are **wrong and drift**: "CHICKE" + "N" at the position of the line below; "Com" + "m" + "bine"; "vegetabl" + "es"; "bef" ... "ore"; "balls.3.Bakeuntilgolden.2..." run together. 27 pieces of one or two letters on a page with none in the source. The drift grows with each line break (the string counts a newline that the glyph index space does not), which is why it gets worse down the page. This matches the look of the owner's earlier screenshots.
- The app's old reader built pieces from those boxes. The new reader (`tools/swift/TextPieces.swift`) cuts words from the clean string and asks PDFKit for each word's box with `selection(for: range)` (PDFKit's text-selection API, index-aligned with the string). **Not yet confirmed by a probe run**: see BRANCH_STATUS for the run after this change.
- The probe job also reported green over a red result (the `tee` pipeline hid the failing exit code); fixed with `set -o pipefail`.

## Stage-by-stage, real PDF (`node tools/pdf-stages.mjs <pdf> outdir`)
Stage 1 here is **poppler** (`pdftotext -bbox`/`-raw`) standing in for PDFKit.
1. Raw: 286 positioned pieces on 1 page; plain text in drawing order (parses as the *wrong* recipe, Bourbon Chicken, which is why positions matter); text layer judged damaged: **false**.
2. Layout reader: first card in order, e.g. `1/2 teaspoon black pepper`, `2 (9 inch) frozen pie crusts, thawed (deep dish)`, `1 egg, lightly beaten (optional)`; the Bourbon card is returned separately with a note.
3. Parser: title `VEG-ALL CHICKEN POT PIE`, servings 4, total 70, the 8 ingredients and 6 directions word for word, notes `Submitted by Chef Teresa`, description is the quotation only.
4. Recipe Rescue screen (`node tools/e2e-real-pdf.cjs outdir`, 390x844, dark and light): 8 ingredient cards and 6 numbered step cards identical to stage 3, none marked, none clipped or covered, all reachable by scrolling, Original tab shows the real page picture and all 63 text lines.

## Other defects found while using the real file
- The set-aside second recipe's overlapping hidden text was glued into run-together words (`thoughtReadyIhadIn:35minseaten`); pieces overlapping by more than a third of a line are now never glued.
- `Submitted by Chef Teresa 2` (a review count) stayed in the description; the trailing number is now dropped and the line goes to Notes.
- Recipe Rescue showed a **"Check these" heading with nothing under it**; fixed (and asserted: no heading without content).
- The Original tab listed the stored **PDF file as a picture** (a broken image); fixed (asserted: every picture loads).
- Nothing on screen said how a file was read. The Original tab now says e.g. "Read from the PDF's own text with positions (286 pieces)" or "...a picture of each page", so the next screenshot shows the route.

## Tests
| Check | Result |
|---|---|
| `node --test` (all) | 144 pass, 1 skipped (the 4 real-PDF tests report **skipped** when the PDF is absent, never passed) |
| `tests/real-pdf.test.mjs` with the real PDF | 4 pass: clean layer judged clean; every ingredient/direction line intact and in order; other card and details in neither list; every word a whole word of the page; no lone numbers or duplicates; no marked lines; import path reads the text layer once and never asks for picture reading |
| `tools/e2e-real-pdf.cjs` with the real PDF | pass (dark and light) |
| `tools/e2e-rescue-layout.cjs`, `e2e-rescue.cjs`, `e2e.cjs` | pass |
| `.github/workflows/pdfkit-probe.yml` (macOS): Quartz-made invented two-card page, read by PDFKit with the app's shipped Swift (`tools/swift/TextPieces.swift`), then the app's layout reader and parser, words compared | see the run recorded in BRANCH_STATUS |

## Private fixture
The PDF is third-party content and the repository is public, so it is **not committed**. `tests/fixtures/real-pdf/veg-all.expected.json` holds the correct result (recipe facts); copy the PDF to `tests/private/veg-all.pdf` (git-ignored) or set `TR_REAL_PDF`. See `tests/fixtures/real-pdf/README.md`.

## Not verified (said plainly)
- What PDFKit returns for **this** file on an iPhone, and Vision's output: not observed. If the PDFKit pieces are poor the app warns and marks lines rather than guessing; the Original-tab note will show the route. The probe job exercises the same Swift on a structurally similar Quartz PDF with invented text; it is a proxy.
- The Swift refactor (`touchRecipeTextPieces` moved to `tools/swift/TextPieces.swift`, appended by `patch_ios.py`) compiles only on macOS CI.

## Owner punch list
| ID | Reproduction | Expected | Retest |
|---|---|---|---|
| P-2 | Import the Veg-All PDF on iOS | Recipe Rescue shows the 8 ingredients and 6 steps above, none marked; Original tab says "Read from the PDF's own text with positions (N pieces)" | TestFlight build of the next green commit |
