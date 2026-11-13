# Branch Status and Development Handoff

> Handoff guide only. Verify live GitHub state before acting.

## Current verified handoff
- Repository: `mrmundysr-sudo/Touch_Recipe` (private). Default branch `main` (one commit, no app). Nothing is merged to `main`.
- **Major-update branch (current work): `ccr-c5e79198-7pqe4i`.** Created from the planning branch, then merged `claude/ios-testflight` @ `8018f84` (verified to contain every other branch and all test-build tags). Holds the importer repair stage.
- Android source before the update: `claude/gallant-knuth-8dfywe` @ `20a819b` (rollback point; last pre-update test build `devtest-recipe-42186752200-20a819b`).
- iOS source before the update: `claude/ios-testflight` @ `8018f84` (rollback point). The iOS app (`www/`) does not yet contain the importer repairs.
- Older lines, fully contained in the above: `claude/blissful-rubin-d0ni9m`, `claude/relaxed-faraday-ijecx2`, `planning/touch-recipe-product-discovery`.
- Open PRs: none at 2026-11-11. Check live GitHub.
- Current task: complete functional update (authorized 2026-11-12). Done on this branch: importer repair, recipe photographs and cropping, Recipe Rescue, unfinished recipes, kept originals, scrolling Recipe Detail / Cook Mode / Import Review / Grocery List. Not done: final artwork (template in `docs/art-template/2026-11/`), iOS parity.
- Rollback points on this branch: `69bcbdb` (importer repair only, CI run 43158027710 green, test build `devtest-recipe-43108667815-1f8c0c1`).
- Latest verified build and CI run: see `docs/knowledge/reports/2026-11-12-functional-update.md`.
- Last reviewed: 2026-11-12.

## Startup requirements
1. Confirm exact repository and default branch.
2. Read this file, CLAUDE.md, PRODUCT_VISION.md, DECISIONS.md, DEVELOPMENT_PLAN.md, VISUAL_ASSET_SPEC.md and relevant knowledge reports.
3. Enumerate live branches, open PRs, commits, workflow runs and artifacts; do not assume newest branch contains latest source.
4. Select a safe base and report its name and SHA before coding.
5. Never reset, force-push, delete branches or discard work.

## Completion requirements
Record development branch/HEAD SHA, base branch/SHA, PR, workflow/run result, artifact, actual tests, known limitations and next step. Do not merge, release or publish without explicit owner approval.

## 2026-11-13 iOS update
`ccr-c5e79198-7pqe4i` now carries the iOS functional update on top of the Android 1.2.0 work. `claude/ios-testflight` is untouched. See `docs/knowledge/reports/2026-11-13-ios-functional-update.md`.

## 2026-11-13 iOS PDF layout fix
Branch `ccr-ios-pdf-layout-fix`, cut from `ccr-c5e79198-7pqe4i` @ `0605029` (which is untouched). Fixes the owner's PDF that imported scrambled on iOS. Not merged, not delivered. See `docs/knowledge/reports/2026-11-13-ios-pdf-layout.md`; the Swift needs the macOS `ios-check.yml` run and a device pass.
