# Work Report — 2026-11-13 — Cook Mode, times, grocery, Rescue inset, Rescue zoom/pan

**Status:** Awaiting review (browser-verified only; no iPhone or Swift run)
**Repository / branch / commit:** `mrmundysr-sudo/Touch_Recipe`, branch `ccr-ios-cookmode-zoom-fix`, cut from `ccr-ios-rescue-review-fix` @ `dd20586` (untouched). Not merged, not delivered, not uploaded to TestFlight.
**Scope authorized by owner:** the six numbered items in the owner's message with screenshots IMG_8312–IMG_8317 (2026-11-13).

## Baseline and knowledge reviewed
CLAUDE.md, BRANCH_STATUS, the 2026-11-13 reports, KNOWN_ISSUES. Baseline: unit tests 36 failing both before and after (they need `linkedom`, which is missing here); Playwright suites 34 / 9 / 26 / 13 ok.

## Changes made
- **Cook Mode overlap (root cause).** `.sp-line` carries an explicit `min-height`, which switches off `min-height:auto`, so cards in the scrolling flex column shrank below their content and overflowed onto the next block. Cook Mode now has three separate areas: the step card (own scroller, capped height), the Ingredients/All steps list (its own scroller) and Previous/Next in the page footer (safe-area aware). The shrink rule is fixed for the other scrolling pages too. Small-height phones use a smaller step size.
- **Times.** `META_EACH` required a colon before the next key, so "Prep Time 15 mins Cook Time 40 mins" was one value and `looseMinutes` summed 15+40 into Prep. It now splits on the next key word. A `Course …` prefix is read into a new `course` field instead of leaving the line as the description. Detail shows Course in its own card, Prep/Cook/Total stay three cards. The Meal Planner no longer shows total as cook.
- **Grocery.** "29oz can of X" is a container size: now 1 can (29 oz). Tablespoon totals roll up to cups when the result is a clean fraction (10 tbsp → 5/8 cup; 5 1/3 tbsp → 1/3 cup). Names and amounts wrap in growing boxes instead of clipping. Pairing and per-recipe sources were audited; no cross-recipe leakage was found in the engine (covered by tests).
- **Rescue bottom inset.** The scrolling form now ends with 120px of space inside the pane, so the last row can be scrolled well above the fixed button.
- **Rescue zoom/pan.** New `www/js/ui/panzoom.js` (pure maths plus pointer gestures). Magnifier button: first tap Original, second Recipe, third off. Pan button: same cycle. The selected pane is outlined and badged with its zoom percent; a transparent overlay takes the touches so text cannot be edited or nearby controls triggered. Two fingers pinch (and move), one finger pans only in Pan mode, +/− buttons are the non-gesture alternative, "Fit" resets one pane. View state lives outside `render()`, so it survives edits, tab switches and rotation.

## Decisions and tradeoffs
Per-pane view is a CSS transform on an inner wrapper (native scrolling is used at 100%, panning when zoomed). Zoom range is 100%–400%. Selecting a side on a narrow phone switches to that side.

## Tests and evidence
| Check | Environment | Result | Evidence |
|---|---|---|---|
| `tests/time-grocery-zoom.test.mjs` (8 tests) | node --test | pass | time mapping 15/40/55, course, grocery parsing/units/leakage, zoom maths |
| `tools/e2e-cook-rescue-zoom.cjs` | Playwright, Chromium, 390×844 / 375×667 / 320×568 | pass | Cook areas do not overlap; Rescue last row clears the button; zoom/pan state independent |
| Same script on `dd20586` (worktree) | same | Cook checks FAIL, zoom buttons absent | reproduces the screenshot overlap |
| Existing e2e suites | same | 34 / 9 / 26 / 13 ok (unchanged) | logs |
| Full unit suite | node --test | same 36 failures as baseline (missing linkedom), all new tests pass | |

## Owner punch list
| ID | Reproduction | Expected | Actual | Priority | Fix | Retest |
|---|---|---|---|---|---|---|
| 1 | Cook Mode, long step, small phone | separate areas | overlapped on baseline | high | flex shrink + layout | device pass needed |
| 2 | PDF with colon-less Prep/Cook line | 15 / 40 / 55 | 55 / null / 55 | high | META_EACH | done in tests |
| 4 | Rescue last row vs Create button | reachable | could **not** reproduce in Chromium; added inset | medium | padding | device pass needed |

## Problems and fixes
The Rescue overlap in item 4 did not reproduce in desktop Chromium; the inset is a safe margin, not a confirmed root-cause fix. WKWebView on a real iPhone may differ.

## Knowledge updates
KNOWN_ISSUES K-030..K-032, BRANCH_STATUS.

## Outstanding work and approvals
- Kotlin/Android parity not changed. Swift untouched, iOS CI (`ios-check.yml`) result to be read from the pushed branch.
- Zoom/pan verified with synthetic pointer events, not a real two-finger touch.
- Merge/release authorized: No
