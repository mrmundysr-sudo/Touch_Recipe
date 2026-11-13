# Work Report — 2026-11-13 — "Classic Beef-Stuffed Peppers" import and Review layout

**Status:** Awaiting review (text path reproduced and fixed; the page's raw HTML was not available here)
**Repository / branch:** `mrmundysr-sudo/Touch_Recipe`, `ccr-ios-cookmode-zoom-fix` (continuing from `7f70641`). Not merged or delivered.

## What was and was not available
The new screenshots did not reach this session (the uploads folder held only the earlier Veg-All screenshots). The page's HTML could not be fetched (the workspace network is allow-listed). I used a web search/fetch of the public pages (mnbeef.org and centennialcuts.com) for the recipe's structure: 11 ingredients in one bulleted list, 3 numbered steps and a "Cooking Tip". The importer was reproduced from that text structure, not from the exact HTML the app fetched. The real-page (linkedom) tests cannot run in this workspace.

## Cause
After an "Ingredients:" heading with no recognised Directions heading, the text parser cut the ingredient list at the first line that was not `looksLikeIngredient` and was longer than 40 characters. `looksLikeIngredient` needed a unit word or six words or fewer, so "4 medium red, yellow or green bell peppers" (a quantity, no unit, 8 words) failed. It was taken as the first step, and every later ingredient followed it into the directions (1 ingredient, ~15+ steps). A "Cooking:" label was also not a Directions heading, and "Cooking Tip: …" was read as a step.

## Changes
- `textparser.js`: new `isStepStart` rule used for that split (a quantity line is an ingredient even without a unit; a numbered line is a step); "Cooking:" / "Cooking directions:" count as a Directions heading; "Cooking Tip:" / "Tip:" lines go to notes.
- `validator.js`: if the first directions look like ingredients the warning now names them ("The first 3 directions look like ingredients (starting "4 medium red…")").
- Review & Save: title, source and ingredient/direction rows are wrapping text areas (long text wraps; title and source shrink to fit their art box and open to full size while being edited). The ingredient and direction warning badges now offer "Show the ingredients/directions", which takes you to the first row. Art region geometry was not changed.

## Tests
`tests/stuffed-peppers.test.mjs` (7 tests, 5 fail on the previous commit): 11 ingredients, 4 steps, no ingredient in the directions, tip as note, validator naming the mis-split lines. `tools/e2e-cook-rescue-zoom.cjs`: Review at 390×844 with a long title, long link and wrapped ingredients. Existing e2e suites unchanged (34/9/26/13); unit failures are the same 36 `linkedom` ones as before.

## Limits
- The gap between the Ingredients and Directions boxes is the owner's art layout (fixed regions). With the ingredients correctly placed the box fills; I did not move the regions.
- Not checked: the exact HTML of the page, the Swift/native paths, Kotlin parity (K-033).
- Merge/release authorized: No
