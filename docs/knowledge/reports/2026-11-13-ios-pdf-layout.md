# Work Report — 2026-11-13 — iOS PDF import: scrambled ingredients

**Status:** Awaiting review (JavaScript verified in a sandbox; Swift not compiled; not tried on an iPhone)
**Repository / branch / commit:** `mrmundysr-sudo/Touch_Recipe`, branch `ccr-ios-pdf-layout-fix`, cut from `ccr-c5e79198-7pqe4i` @ `0605029` (unchanged). Commit: see the branch head.
**Scope authorized by owner:** bug report on the authorized 2026-11 functional update ("still not working correctly", screenshot + the PDF). No new feature scope.
**Related issue / PR:** none opened.

## Baseline and knowledge reviewed
CLAUDE.md, BRANCH_STATUS, DECISIONS (import rows), IOS.md, KNOWN_ISSUES (K-012, K-020), the 2026-11-13 iOS report. Baseline `node --test`: 6 suites could not load because `linkedom` is not installed in the sandbox and installs are blocked; with a throwaway stub (git-ignored, removed afterwards) the run was **91 pass / 35 fail**, all 35 failures needing the real DOM library.

## The failure (reproduced on the owner's PDF)
The PDF is a website page printed to PDF. Measured with `pdftotext -bbox`:
1. **Order.** PDFKit `page.string` follows the file's drawing order. Amounts, ingredient names and numbered steps interleave (the screenshot: "2", "2. Spoon into prepared pie crust.", "1", "3." …).
2. **No gutter.** Directions end at x = 171.6 and the amount column begins at 172.2, so there is no gap a column cut can use. A fraction beside step 5 was glued onto "375 degrees".
3. **Amounts centred.** Each amount is centred beside its ingredient block, so for a three-line ingredient it sits on the middle line. Reading row by row cannot pair them.
4. **Fractions** are drawn as three pieces (numerator, slash, denominator) at different heights.
5. **A second recipe** (Bourbon Chicken) fills a sidebar.
6. **Parser:** step 1 wraps onto a line that is only "ingredients.", which was read as an Ingredients heading and cut the directions off; "Cover with top crust;" and "crimp edges to seal." became two steps.
The repo's `LayoutReader` existed but was never given positions on iOS (IOS.md, "Known limits").

## Changes made
- `tools/patch_ios.py` (Swift bridge): `recognizePdf` also returns `lines`, text pieces with positions, built from PDFKit `characterBounds` (and from Vision boxes for scanned PDF pages). `text` stays as the plain fallback. `recognizeImage` (photos) is unchanged.
- `www/js/engine/layout.js`: fraction pieces joined to `1/2`; amount-column detection (≥3 short numbers with an aligned edge, each with text a clear gap to its right) and one table block per column, placed by a new table-aware cut; wrapped big headings joined; two complete recipe cards side by side: the first is read, the other is returned as `extra` with a note. New export `readWithNotes`; `read` is unchanged for callers.
- `www/js/data/importer.js`: `pdfText()` reads the pieces through the layout reader, falling back to plain text if there are none or if the result holds under 60% of the plain text's characters. The note is shown as an info warning; the other recipe is kept in the original text.
- `www/js/engine/textparser.js`: a heading-like line ending in "." right after an unfinished step is a wrapped sentence; a semicolon no longer ends a step for wrapping.

## Decisions and tradeoffs
Logged in DECISIONS (2026-11-13). Photos and scans were deliberately not changed (not verifiable here). The second recipe is not discarded: it is kept with the original so Rescue can use it.

## Tests and evidence
| Check | Environment | Result | Evidence |
|---|---|---|---|
| Owner's PDF, positions from `pdftotext -bbox`, through `pdfText` → `ImportService.fromPdf` | Node 22, sandbox | Title, 8 ingredients with amounts and fractions, 6 steps all correct; sidebar set aside with a note | script output in the session; the PDF itself is not committed |
| Same words in drawing order (`pdftotext -raw`) through the old path | Node 22 | Reproduces scrambling (took the Bourbon recipe's lines) | session output |
| New `tests/pdf-layout.test.mjs` (10 tests, invented recipe with the same geometry) | Node 22 | 10 pass | `node --test tests/pdf-layout.test.mjs` |
| Full `node --test`, linkedom stubbed | Node 22 | 101 pass / 35 fail; failing set identical to baseline (all need real linkedom) | TAP diff before/after |
| Swift compile, PDFKit `characterBounds` behaviour, iPhone | — | **Not run** | K-021 |

## Owner punch list
| ID | Reproduction | Expected | Actual | Priority | Fix | Retest |
|---|---|---|---|---|---|---|
| P-1 | Import the Veg-All PDF on iOS | 8 ingredients, 6 steps, note about the other recipe | scrambled (before) | High | this branch | Run `ios-check.yml`, then TestFlight/device |

## Problems and fixes
`linkedom` missing: stubbed temporarily to run non-DOM tests; removed afterwards. Early synthetic tests failed only because the invented page was drawn too wide (the gap to the sidebar was 17 pt, the real page has 24 pt); fixed in the test, not the reader.

## Knowledge updates
KNOWN_ISSUES K-021, K-022, K-023; IOS.md known limit; DECISIONS; BRANCH_STATUS.

## Outstanding work and approvals
- Run `ios-check.yml` (triggers on `ccr-**` pushes) to compile the Swift; then a device pass with the owner's PDF.
- PDFKit's character boxes may differ from poppler's word boxes; if the device result differs, capture `lines` from the bridge and add them as a test.
- Port the parser/layout changes to Kotlin (K-022) if the owner wants Android to match.
- Merge/release authorized: **No**
