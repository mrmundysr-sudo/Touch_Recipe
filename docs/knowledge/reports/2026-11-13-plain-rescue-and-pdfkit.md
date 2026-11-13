# Work Report — 2026-11-13 — Plain Recipe Rescue (numbered lists) and the PDFKit findings

**Status:** Awaiting review. JavaScript and browser behaviour verified here (Chromium, real PDF through poppler as a stand-in for PDFKit). The Swift is compiled and run on a macOS runner by the PDFKit probe; **nothing has been tried on an iPhone**. Nothing uploaded to TestFlight from this work.
**Repository / branch:** `mrmundysr-sudo/Touch_Recipe`, branch `ccr-ios-rescue-review-fix` (follows `4977a52`). Commit: see the branch head.
**Scope authorized by owner (chat, 2026-11-13):** Recipe Rescue should be coded "very simple style and layout", no visuals, open and not crowded; the original on one side and our recipe on the other, so text can be copied across without being forced into narrow sections. Agreed: our side = plain form with big text boxes; upright = one side at a time at full width. Ingredients and steps are numbered lists: one number per entry; Enter starts a new numbered entry and the text after the cursor belongs to it; deleting at the start of an entry joins it to the one above and its number goes. Landscape allowed for this screen only (everything else portrait).

## What the screen is now (`www/js/screens/rescue.js`, `www/js/ui/numbered.js`)
- No artwork slot, no cards, no arrows, no per-line menus, no Select mode, no Add / Smart Paste menu, no draggable divider. Big plain fields (16 px or the text-size setting, 44 px or taller, 14 px apart).
- **Original side:** how the file was read, the kept page pictures (every page up to four), the whole original text as ONE selectable block (press and hold to select and copy).
- **Recipe side:** Title, Servings, Prep and Cook minutes, Ingredients (numbered), Steps (numbered), Notes, Photo, Start fresh / Discard. A line ending with a colon is a heading (not numbered). Entries the app is unsure about get the red outline and "Check this line: why", unchanged.
- **Upright:** a switch Original | Recipe, one side at a time at full width. **On its side:** both next to each other, original left, recipe right, each scrolling on its own; one Create recipe button below.
- Paste into an entry: several lines make one entry each; bullets and typed numbers ("2)", "1.") are removed because numbering is automatic.
- Native: only this screen asks the app to allow landscape (`TouchRecipeOcr.setOrientation`); leaving it turns the phone back to portrait.

## Removed (say so plainly)
Line cards with move up / down arrows, the per-line menu (edit / make a heading / ask the family / delete), Select lines mode, Smart Paste and the Add menu, the Send selected buttons, the stacked-with-divider layout. "Questions for the family" already in a draft are still shown (mark answered / delete); new ones can no longer be added from a line. Undo and Redo remain (one step per burst of typing or per Enter / join / paste).

## PDFKit findings (macOS 26.7, Xcode 26.6, probe runs 43375472310 and 43376912755; invented Quartz-made page)
1. `page.string` is clean. `characterBounds(at:)` drifts (cut words). Replaced by per-word `selection(for: range)` boxes: run 43376912755 shows 192 whole-word pieces with correct positions.
2. PDFKit's word boxes are the font size (11.5 pt), poppler's are taller (14 pt). The layout reader's table detection assumed tall boxes in three places, so it failed on PDFKit-like boxes (steps ended up in the ingredient list; amounts unpaired). Fixed in `layout.js`: ingredient blocks are cut from the measured line pitch (smallest top-to-top distance + 12% less the box height), "text beside an amount" uses vertical distance not box overlap, and "a heading right above the table" uses the pitch. A Helvetica reconstruction of the probe page with the same small boxes now parses fully (8 ingredients with amounts, 6 steps); fixture `tests/fixtures/small-box-pieces.json` (invented text) guards it.
3. The probe job had reported green over a red result (the `tee` pipe hid the exit code); fixed with `set -o pipefail`.

## Tests
`node --test`: 156 pass, 1 skipped (the real-PDF tests report skipped without the private PDF). Browser: `tools/e2e-rescue-plain.cjs` (Enter / Backspace / Delete / paste / headings / numbering / undo, original as selectable text, contrast in the dark theme, landscape layout, native orientation requests, no artwork), `tools/e2e-rescue.cjs` (clear and undo, Unfinished drafts, create, original kept, damaged entries marked), `tools/e2e-real-pdf.cjs` (the real PDF: title, 8 numbered ingredients and 6 numbered steps word for word, nothing clipped or marked, original side shows the page and text, landscape), `tools/e2e.cjs`. A bug the old suite caught during the rewrite: the screen's cleanup re-saved the draft after Create (fixed).

## Not verified
The real Veg-All PDF through PDFKit on an iPhone. The macOS probe uses an invented page. The Swift `setOrientation` compiles (iOS build check) but turning the phone has not been seen on a device.
