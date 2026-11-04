# Work Report — 2026-11-04 — Grocery List open parchment layout

**Status:** Awaiting review (CI evidence and APK recorded below once the run finishes)
**Repository / branch / commit:** `mrmundysr-sudo/Touch_Recipe`, `claude/gallant-knuth-8dfywe` (app source merged in from `claude/relaxed-faraday-ijecx2` @ `ea5f0e2`; see git log for the final commit)
**Scope authorized by owner:** Replace the five Grocery List category cards with one open parchment area; headings and items drawn by the app; keep add / check / clear / grouping behavior. Android only; no iOS.
**Related issue / PR:** none (no PR opened; no merge to main)

## Baseline and knowledge reviewed
CLAUDE.md, docs/ART_WIRING.md, docs/TESTING.md, BRANCH_STATUS (hint only). Live branches: `claude/relaxed-faraday-ijecx2` @ `ea5f0e2` is the newest app source and contains `claude/blissful-rubin-d0ni9m`; `main` is docs-only.

## Changes made
- Visual assets ZIP: `pages/page_09_grocery_list/clean.png` replaced with the open-parchment art; `layers.psd` and `other_1.png` kept as reference of the old card layout; ZIP `manifest.json` and `README.md` notes updated; re-chunked (`.touch-uploads/04b9d405…`, `.touchmanifest`).
- Art pipeline: `tools/art_map.py` (no `cards`, new `list` region), `tools/build_assets.py` (cards code removed); regenerated `app/src/main/assets/art/grocery/clean.webp` and `art/manifest.json` with the real builder (every other page byte-identical).
- App: `GroceryScreen.kt` draws one scrolling list in the `list` region; per-category "All N" buttons, "Add an item…" fields and the aisle sheet removed; `ArtManifest.kt` drops the unused `GroceryCard`.
- Tests: `FlowsTest` (collapse, add-from-recipe, new open-list and long-list/empty tests), `ScreensSmokeTest` (seeded grocery screenshot).

## Decisions and tradeoffs
- The supplied image was a phone screenshot (status/nav bars, margins, baked week text). It was cropped to the art area (registered against the old art, scale 0.91), rescaled to 841×1870 and the week text patched from the old empty field. Slight softness from the 1.1× upscale is expected; a native export is preferred.
- Empty categories are hidden; with no items an empty-state message shows. Add Item and the row editor still reach every category.

## Tests and evidence
| Check | Environment | Result | Evidence |
|---|---|---|---|
| ZIP integrity, chunk sha256 | sandbox | pass | testzip OK, 28 entries, chunks hash to manifest |
| build_assets.py rerun | sandbox | pass | only grocery/clean.webp and manifest.json differ |
| Unit/Robolectric, lint, assemble | GitHub Actions | see run | recorded in the delivery message |

## Owner punch list
| ID | Reproduction | Expected | Actual | Priority | Fix | Retest |
|---|---|---|---|---|---|---|
| — | open Grocery List on a phone | one parchment, bold headings, scrolling | to be confirmed on device | — | — | — |

## Problems and fixes
A first ZIP commit (`5f59537`) stored the raw screenshot as `clean.png`; corrected before use.

## Knowledge updates
Lesson: check supplied "assets" visually before packaging; screenshots are not page art.

## Outstanding work and approvals
- Merge/release authorized: No
