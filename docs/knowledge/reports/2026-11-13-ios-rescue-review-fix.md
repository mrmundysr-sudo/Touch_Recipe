# Work Report — 2026-11-13 — iOS Recipe Rescue: cut-up words, mixed sections, unreadable review screen

> **Correction (same day):** the main cause named below (PDFKit cutting words) is **not** supported by the owner's real PDF. The real cause is in `2026-11-13-ios-real-pdf-root-cause.md`: a false "damaged text layer" verdict sent the page to picture reading. The other changes in this report remain valid hardening.

**Status:** Awaiting review (JavaScript and browser layout verified in a sandbox; the Swift change compiles only on the macOS runner and has **not** been tried on the owner's PDF or an iPhone)
**Repository / branch / commit:** `mrmundysr-sudo/Touch_Recipe`, branch `ccr-ios-rescue-review-fix`, cut from `ccr-ios-pdf-layout-fix` @ `13bf6cc` (unchanged). Commit: see the branch head.
**Scope authorized by owner:** bug report with five screenshots of the Veg-All Chicken Pot Pie PDF imported on the 13bf6cc build ("still not ready for TestFlight"). Fix before any upload. No new feature scope.
**Related issue / PR:** none opened. Nothing was uploaded to TestFlight from this report's work.

## What the screenshots showed
Words cut in pieces ("s poon", "chic ken", "Chin ese"), amounts apart from their ingredients, directions, details and notes inside one another, lines holding only "4." or "4", the title "T P", repeated text, and a review screen with dark text on a dark background, huge text, and the bottom buttons drawn over the recipe while it scrolled.

## Causes found (evidence in the code, not guesses)
1. **Cut-up words.** `textPieces` in `tools/patch_ios.py` ended a piece at any gap over 0.35 line heights between two characters. PDFKit character boxes are not exact (kerning, ligatures, web fonts), so words were cut mid-word, and `layout.js` then joined the pieces with spaces. Cut pieces also look like many narrow columns, which defeated the column and table detection (reproduced: the same page read perfectly with whole words and badly with cut words).
2. **Sections mixed.** `Ingredients: 8` matched the Ingredients heading pattern (it allows a count), "Ready In / Serves" inside the Directions section were skipped by the details rule, "Submitted by" and "Editor's Note" had no rule, and lone numbers and repeated lines were kept.
3. **Unreadable screen.** `.sp` set its text colour from `--ink` (always dark) on a `--surface` that is dark in the dark theme; headings used `--forest`. The button bar was `position: sticky` inside the scrolling area, so cards scrolled past underneath it in the body's bottom padding.

## Changes made
- `tools/patch_ios.py` (Swift): a piece now ends only at white space, or at a jump that cannot happen inside a word (a full line height of gap, going backwards, or a new baseline).
- `www/js/engine/wordheal.js` (new): joins cut pieces only when the PDF's own plain text proves the word (the joined word occurs in it and at least one piece does not occur on its own). Works on pieces before layout (`healPieces`) and on text after (`healText`). Never uses a dictionary; never joins two real words.
- `www/js/data/importer.js` `pdfText`: heals pieces, reads them through the layout reader, heals again, and if more than 2% of the words are still single stray letters adds a **warning** ("Some words in this PDF were read in pieces ... Check the text against the original"). The result keeps the same shape for old bridges. The Original tab now keeps every page up to four as a picture (was the first page only).
- `www/js/engine/textparser.js`: `Ingredients: N` is a count, not a heading; Ready In / Serves / Servings / Yield are details even inside Directions; `Submitted by ...` goes to Notes; `Editor's Note` starts the Notes section; a number alone in the steps is dropped; an amount alone on an ingredient line is joined to the line after it when that line has no amount, otherwise left out with a warning; the same line twice in a row is kept once.
- `www/js/engine/rescue.js` `reviewReason` / `linesToReview` (new, pure): a line that is only a number, has a stray single letter, a very long run-together word, recipe details inside it, or looks like the wrong kind of line is marked. Marking never changes the line.
- `www/js/screens/rescue.js`, `www/js/ui/page.js`, `www/css/app.css`: each marked line gets a red outline and "Check this line: why"; a count is shown on top; the action buttons live in a footer below the scrolling area; text colours follow the theme (`--on-surface`, `--primary`, `--error`); card text is `14px × text scale` (16.8 px at the default), wraps, and nothing is fixed-height.

## Tests and evidence
| Check | Environment | Result |
|---|---|---|
| `node --test` (all importer, layout, rescue, engine suites; `npm install` done, `linkedom` real) | Node 22 | **140 pass / 0 fail** (135 before, plus 5 new) |
| `tests/pdf-veg-all-regression.test.mjs`: Veg-All page reconstruction with a Bourbon Chicken card beside it and every word cut in pieces; the same page through `pdfText` and `ImportService.fromPdf`; the broken lines from the screenshots; parser guards | Node 22 | pass |
| `node tools/e2e-rescue-layout.cjs` (390×844, dark and light): contrast ≥ 4.5 for title, headings, cards, check notes; 13 damaged lines marked; no card drawn inside the button area at 5 scroll positions (1,680 points); no clipping or sideways scroll | Chromium via Playwright | pass (found and fixed a 3.66 contrast failure in the light theme) |
| `node tools/e2e-rescue.cjs`, `node tools/e2e.cjs` | Chromium | pass, zero console errors |
| Swift compile / `ios-check.yml` on macOS | — | see the CI run recorded in BRANCH_STATUS |
| The owner's real PDF on an iPhone | — | **Not run** |

## Limits (said plainly)
- The PDF itself is not in the repository or the sandbox. The regression is a **reconstruction** from the screenshots and the earlier report, with the same geometry, not the file. Whether PDFKit still cuts words on the owner's PDF can only be seen on a device.
- Word repair needs the plain text to contain the whole word. If the plain text is cut the same way, nothing is repaired and the person is warned instead. Two real words that happen to form a longer word ("in" + "to") are never joined, so a cut exactly there stays.
- Marking is conservative: a fragment that is not a stray letter and not a long run-together (for example "RECTIO" for DIRECTIONS) is not marked. Titles are not marked.
- Photos and scans (Vision) were not changed.

## Owner punch list
| ID | Reproduction | Expected | Priority | Retest |
|---|---|---|---|---|
| P-2 | Import the Veg-All PDF on iOS, open Recipe Rescue | clean title, 8 ingredients, 6 steps, other recipe set aside with a note, no line marked | High | TestFlight build after this branch's CI is green |
| P-3 | Dark theme, scroll the review screen | readable text; buttons never over the content | High | same |
