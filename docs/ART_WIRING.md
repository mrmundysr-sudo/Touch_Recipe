# Art wiring: how the supplied visual package drives the app

Source of truth: `touch_recipe_visual_assets.zip` (reassemble with `cat .touch-uploads/*/* > touch_recipe_visual_assets.zip`; sha256 `d215b378…f9481` is checked in `touch_recipe_visual_assets.zip.touchmanifest`).

## Pipeline
```
zip → tools/build_assets.py (+ tools/art_map.py) → app/src/main/assets/art/<page>/clean.webp, cutout_N.webp, manifest.json
```
- `clean.png` → `clean.webp` (841×1870, the page art, never edited).
- PSD “Cutout N” layers → `cutout_N.webp` with alpha: these are the *objects* (stove, calendar, …). They give (a) the glow silhouette and (b) pixel-accurate hit testing.
- `tools/art_map.py` maps layer numbers to target ids, labels, hints and padding, and defines content windows. `manifest.json` stores everything as 0..1 fractions of the page.
- `python3 tools/mapping_sheet.py` draws every target (blue = hit region, red = object box) and window (green) over the art into `docs/art-map/`, so cut pieces can be checked against controls.
- To replace art: drop in a new `clean.png`/PSD with the same layer order, rerun `build_assets.py`. No Kotlin changes are needed unless a window moves (edit `art_map.py`).

## Touch handling
One tap layer per page resolves a tap: (1) the top-most cutout whose pixel is opaque at the tap, (2) the smallest explicit box containing it (small controls on big cards win), (3) the nearest padded hit region. Separate semantic nodes (no pointer handling) give TalkBack, switch and keyboard users the same targets, with labels/hints from the manifest (planner/grocery override them with live text), a visible white focus ring, and Enter/Space activation. `ManifestTest` fails the build if any target is unlabeled or smaller than 44 dp on a 360 dp-wide phone.

## Page → slot map
| Page | Art | Targets wired | Code-rendered windows |
|---|---|---|---|
| Splash | page_01 | tap anywhere to skip | none (title is in the art) |
| Kitchen Hub | page_02 + 7 layers | stove→Cook Mode/active recipe, calendar→Planner, fridge card→Import, magnifier→Search, grocery bag→Grocery, drawer→Junk Drawer, Rolodex→Collection | none |
| Recipe Collection | page_03 + 2 layers | search tab, New Recipe tab, 5 category tabs (All, Favorites, top 2 categories, “⋯” filters) | recipe cards on a parchment panel, search field, sort/filter |
| Recipe Detail | page_04 + 4 layers | back, heart, Cook Mode panel, Add to Grocery panel, photo, servings −/+, section headers | photo, title/categories/notes/source, times, servings, ingredient rows (checkboxes), numbered directions |
| Cook Mode | page_05 + 5 layers | back, clock, Start Timer, Previous, Next | step chip, step text, progress, step list, live clock face, state label over the timer button |
| Import Recipe | page_06 + 7 layers | back, URL, paste/type, scan, PDF/file, share, continue | sheets for each method, progress/error/result |
| Import Review | page_07 + 6 layers | back, photo, add ingredient/direction, add category, details, save, section headers | title, source, rows, category chips, warning badges |
| Meal Planner | page_08 + 3 layers | week selector, cat calendar, basket, 7 meal cards, 7 option buttons | day, date, photo, title, cook time, servings |
| Grocery List | page_09 + 5 layers | back, week, basket, add, clear, 5 category headers | rows (checkbox, name, quantity, options), placeholder rows |
| Junk Drawer | page_10 + 8 layers | gear, category cards, notebook, swatches, help card, chef timer, printer card, back (the drawer itself is **not** a target) | none |

Utility pages behind the drawer objects (Settings, Category Management, Backup, Themes, Help, Timer & Tools, Print & Share) have no supplied art; they are plain code pages using the app theme.

## Known art caveats
- Collection/Planner/Grocery rows are 44 dp minimum for touch, so a card shows about 2–4 rows before scrolling; full editors are one tap away.
- Collapsing a grocery category cannot reflow fixed art, so it replaces the rows with a one-line summary.
- No density variants exist; WebP sources are 841 px wide and look soft on large tablets.
