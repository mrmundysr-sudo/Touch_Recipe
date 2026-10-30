# Branch Status and Development Handoff

> Handoff guide only. Verify live GitHub state before acting.

## Current verified planning handoff
- Repository: `mrmundysr-sudo/Touch_Recipe` (private).
- Default branch: `main`; initial repository is docs-only.
- Product planning branch: `planning/touch-recipe-product-discovery`.
- App source branch: `claude/blissful-rubin-d0ni9m` (based on `planning/touch-recipe-product-discovery` @ `ffbd603`; `main` was at `8f617ac`). Never merged.
- Latest verified APK / successful workflow: see the work report; local debug and release builds succeeded in the build sandbox; CI results are recorded there once run.
- Open PRs: Check live GitHub.
- Current task: Product discovery, feature scope, import feasibility, visual flow and asset mapping plan.
- Last reviewed: 2026-10-30.
- Base commit: verified from live repository at task start; refresh before implementation.

## Startup requirements
1. Confirm exact repository and default branch.
2. Read this file, CLAUDE.md, PRODUCT_VISION.md, DECISIONS.md, DEVELOPMENT_PLAN.md, VISUAL_ASSET_SPEC.md and relevant knowledge reports.
3. Enumerate live branches, open PRs, commits, workflow runs and artifacts; do not assume newest branch contains latest source.
4. Select a safe base and report its name and SHA before coding.
5. Never reset, force-push, delete branches or discard work.

## Completion requirements
Record development branch/HEAD SHA, base branch/SHA, PR, workflow/run result, artifact, actual tests, known limitations and next step. Do not merge, release or publish without explicit owner approval.
