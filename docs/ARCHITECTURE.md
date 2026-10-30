# Architecture and reusable modules

Single Gradle module (`app`), package `com.mundymorning.touchrecipe`. Packages are layered so each reusable piece can later be lifted into its own Touch module; **nothing in `core/` touches Android or the UI.**

| Reusable piece | Package / files | Depends on |
|---|---|---|
| Recipe data model | `core/model/Models.kt` (serializable) | kotlinx.serialization |
| Quantity parsing / safe scaling | `core/quantity/Quantity.kt` | none |
| Import / extraction pipeline | `core/importer/` (`WebRecipeExtractor`: JSON-LD → microdata → HTML heuristics; `TextRecipeParser`: paste/OCR/captions; `Durations`) + `data/ImportService.kt` (URL, share, image/PDF/file orchestration), `data/Fetcher.kt`, `data/Ocr.kt` | jsoup, ML Kit (data layer only) |
| Dynamic editable rows | `ui/components/Components.kt` (`EditableRows`, `RowsEditorSheet`) | Compose |
| Category manager | `core/categories/`, `data/Repository.kt`, `ui/screens/CategoryParts.kt` | Room |
| Grocery engine | `core/grocery/` (`GroceryEngine`, `GroceryMerge`, `Units`) | `core/quantity` |
| Meal-planner engine | `core/planner/Planner.kt` + `Repository` meal methods | Room |
| Cook Mode timer | `core/timer/CookTimer.kt` (wall-clock based), `data/TimerAlarm.kt`, `ui/screens/CookScreen.kt` | none / AlarmManager |
| Asset manifest + visual touch targets | `ui/art/ArtManifest.kt`, `ArtScreen.kt`, `tools/build_assets.py`, `tools/art_map.py` | Compose |
| First-load illumination | inside `ArtScreen` (`GlowController`, `LocalReducedMotion`) | none |
| Backup / export | `core/backup/Backup.kt`, `data/BackupManager.kt`, `docs/BACKUP_FORMAT.md` | Room |

## Data flow
Room (`recipes`, `categories`, `meal_plan`, `grocery_items`, `grocery_aisles`, `cook_state`) → `Repository` (flows + suspend writes) → screens (`remember`ed flows, small ViewModels where state must survive navigation: collection filters, detail servings, cook session, import, review). Schema is exported to `app/schemas` for migrations. Preferences are a small `SharedPreferences` wrapper (`data/Prefs.kt`).

Imports never write to the library: `ImportService` → `ImportDraft` → `ImportSession` (memory) → Review screen → `Repository.saveRecipe` on Save.

## Component-registry check (CLAUDE.md requirement)
The shared registry `Touch-Modules` (`registry/components.json`) is **not** in this session's repository scope and could not be read; no module was reused and nothing was modified outside this repo. Everything above is new code with its own tests. Libraries added: Compose/Material3 (Apache-2.0), Room (Apache-2.0), jsoup (MIT), Google ML Kit text recognition (bundled model, Google ML Kit terms), kotlinx.serialization/coroutines (Apache-2.0), Playfair Display and Source Sans 3 (OFL 1.1, license texts bundled in `assets/licenses`). **Owner action:** compare with the registry before release and fold in or replace any overlapping module.
