# Work Report — 2026-11-12 — Complete functional update (Android)

**Status:** see "Build and delivery" at the end (filled in from CI).
**Repository / branch:** `mrmundysr-sudo/Touch_Recipe`, `ccr-c5e79198-7pqe4i`
**Scope authorized by owner:** the complete functional update in one pass, Android first, temporary visuals, final artwork later.
**Rollback point:** `69bcbdb` (importer repair only; Android CI run 43158027710 green; test build `devtest-recipe-43108667815-1f8c0c1`).

## Confirmed about the importer build already delivered (`1f8c0c1`)
That APK was built by Android CI run 43108667815 from commit `1f8c0c1` and contains: PDF text reading with per-page recognition fallback, the website cross-check, pages without recipe data, layout-aware reading order, completeness findings and the "may be incomplete" result sheet. All of it is kept and extended here; nothing was reverted.

## What this update adds
| Area | What now happens |
|---|---|
| Recipe photographs from websites | Pictures are ranked: the recipe data's image, the page's declared main image, then pictures inside the recipe. Logos, avatars, adverts, icons and pixels are left out. Several candidates are kept so the cover can be switched. A photo that exists but cannot be downloaded is reported. On the benchmark pages a photo is found on 99.1% of pages that have one (was 97.2%). |
| Photographed cards and pages | A light card on a darker surface is found, straightened, cropped and brightened for reading. The photo as taken is always kept; the straightened page is a second file. |
| Dish photo on a page | A solid block of picture among text is cut out and offered as the cover, with a plain warning when the find is uncertain. It is stored as its own file. |
| PDFs | The recipe's own picture is taken straight from a digital PDF. On a scanned PDF the first page is checked for a dish photo. The PDF itself is kept. |
| Manual crop tool | Four corner handles: free corners to straighten a card, an upright rectangle to cut out the dish photo. Find edges, Whole picture, optional Sharpen. |
| Originals | Every import keeps its original: page snapshot and address, PDF, photos, pasted text. Saved with the recipe; "View the original" on the recipe page; removed only by the user. |
| Recipe Rescue | The original beside the editable recipe: side by side in landscape, resizable split in portrait. Text tab with tap-to-select lines for every kind of source; live page or saved copy for websites; page-by-page PDF and zoomable photos. Transfer to Ingredients, Steps, Title, Notes, Servings, Times, Description, several lines at once, optionally corrected first. Select, Remove, Replace, All ingredients, All steps, Undo, Redo, Start Fresh with kept fields, Smart Paste with a preview, questions for the family on lines or on a spot of the original. |
| In-app browser import | "Open the page in the app and import from there", and "Open the page here and read it" after a failed link import: the page is shown in the app and read from what is on screen. |
| Unfinished Recipes | Save for later from the import result or from Recipe Rescue; autosaved after every change and when the app is left; listed with source, counts and open questions. |
| Repair a saved recipe | "Repair with Recipe Rescue" on any recipe; the saved recipe changes only after "Update" is confirmed. |
| Scrolling pages | Recipe Detail, Cook Mode, Import Review and Grocery List are continuous pages with pinned controls. Nothing is cut to a window: the whole title, every ingredient, every step. |
| Cook Mode | Ingredients with shared tick boxes, then every step in one page; the current step is highlighted and any step can be tapped to make it current; Previous / Next still work; the timer stays pinned at the top; progress is saved as before. |
| Grocery List | One list as long as needed, pinned Add Item and Clear checked, position kept. Data and behaviour unchanged. |

## Data safety
- No database change. Drafts and originals are private files (`files/drafts`, `files/originals`). Existing recipes, lists, plans and settings are read exactly as before.
- A new import always becomes a new recipe. A saved recipe is replaced only through the explicit Update confirmation.
- Originals are deleted only on an explicit user action, and a file still used by a saved recipe or a draft is never deleted.
- Existing artwork files, manifest and art tools are untouched; four screens stopped drawing their page art.

## Tests
| Suite | What it covers |
|---|---|
| `RescueTest` (15) | Every editing rule: transfer, selection, removal, replacement, Start Fresh, Smart Paste, undo/redo, questions, draft round trip |
| `RecipeImagesTest` (9) | Card found at an angle, no false crop, dish photo found without the text, yellowed paper, plain photo not mistaken, levels, web photo ranking and exclusions |
| `ImageImportTest` (4, real Android imaging) | Card straightened with the original kept byte for byte; dish photo becomes the cover with three separate files; manual corners; crop handles |
| `DataTest` additions | Originals kept for web, PDF, photo and text imports; drafts survive a restart; files deleted only when unused |
| `FlowsTest` additions (5) | A 40-ingredient, 25-step recipe as one page and in Cook Mode; Save for later and resume; Recipe Rescue remove / undo / redo / transfer / save; Start Fresh and questions; repairing a saved recipe |
| `ImportRepairTest` (27), `RealPageBenchmarkTest` | Unchanged and still passing; benchmark below |
| Existing suites | All kept; three tests were adjusted only where the control they press moved |

Import benchmark (1,125 saved pages, unchanged scoring): complete 90.6%, major loss 5.4%, major loss with no warning 0.7%, photo found 99.1%. The import figures are the same as the importer build; this pass did not change text extraction.

## Not done or not verified
- **Nothing was run on a phone.** Rotation, the web page pane, pinch zoom, the camera, real card photos and handwriting are untested on a device.
- **Card and dish-photo detection are tested with drawn pictures only.** Real lighting, shadows and backgrounds will behave worse. Both are labelled when uncertain and both have a manual tool.
- **Handwriting:** no handwriting-specific recognition was added. The card photo is kept and shown beside the editor for typing, with questions for unclear words.
- **Text selection inside a PDF or photo** is done on the Text tab (recognised lines), not by dragging over the picture. Inside a web page it uses the page's own selection.
- **Backup** does not yet include drafts and stored originals.
- **Import targets** from the audit (93% complete, under 5% major loss) are still not met: 90.6% and 5.4%.
- **iOS** is untouched; the work needed is listed in `docs/IOS.md`.
- **Visual builder:** the template format for coordinate items is inferred from the package README because the existing package contains none.

## Screens needing artwork
Shared scroll pieces `page_11` to `page_13`; controls for Recipe Detail (`page_14`), Cook Mode (`page_15`), Grocery List (`page_16`), Import Review (`page_17`). Optional: Recipe Rescue (`page_18`), Unfinished Recipes (`page_19`). Unchanged and still in use: `page_01`, `02`, `03`, `06`, `08`, `10`. Kept but no longer drawn: `page_04`, `05`, `07`, `09`.

## Samsung testing checklist
1. **Before installing:** in the old build, Junk Drawer → Backup → make a backup. Uninstall the old build, install this one, restore the backup. Check your recipes, grocery list and plans are all there.
2. **Old recipes:** open a saved recipe. The whole title shows; scroll to the last direction; tick an ingredient; change servings.
3. **Website:** import three sites that failed before. Does each come in with its photo? If one fails, tap "Open the page here and read it", then "Read recipe from this page".
4. **PDF:** import a digital recipe PDF, then a scanned one. Are all ingredients and steps there, in order? Did a PDF with a picture get a cover?
5. **Card photo:** photograph a recipe card lying on a dark table. On the result, tap "Compare with the original". Is the card straightened under "Straightened", and the photo unchanged under "As photographed"? Try "Adjust the crop".
6. **Cookbook page with a dish photo:** photograph one. Was the dish picture set as the cover? If it is wrong, use "Cut out the dish photo".
7. **Recipe Rescue, portrait:** tap lines in Text, send them to Ingredients and Steps. Tap Select, tick two wrong lines, Remove, then Undo.
8. **Recipe Rescue, landscape:** turn the phone sideways. Are both sides visible and do they scroll separately? Turn it back: is everything still there?
9. **Save for later:** leave Recipe Rescue, close the app from recent apps, reopen. Import → "Unfinished" → continue. Is your work intact?
10. **Family question:** on a line tap ⋮ → "Needs family help", write a note, save the recipe. Does the question show on the recipe page, and can you tick it off?
11. **Cook Mode:** on a long recipe scroll freely, tap a later step, start a timer, leave the app and come back.
12. **Grocery List:** add a recipe's ingredients, scroll a long list, tick items, close and reopen.
13. **Large text:** Settings → Extra large text, then look at a recipe, Cook Mode and Recipe Rescue. Is anything cut off or unreachable?

## Build and delivery
