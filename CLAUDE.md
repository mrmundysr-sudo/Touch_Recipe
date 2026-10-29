# Touch Recipe — Claude Development Instructions

This repository is currently in product discovery. A brainstorm, screenshot, generated concept, or proposed feature is not by itself authorization to implement it.

## Read before any work
1. `docs/PRODUCT_VISION.md`
2. `docs/DECISIONS.md`
3. `docs/DEVELOPMENT_PLAN.md`
4. `docs/VISUAL_ASSET_SPEC.md`
5. `docs/BRANCH_STATUS.md` and `README.md`

## Non-negotiable workflow
- GitHub is the single source of truth. Verify repository, branch, commit, workflows, open PRs and existing behavior before editing.
- Keep brainstorming and approved decisions distinct. Do not start implementation until the owner approves the product scope and development plan.
- Work on an isolated development branch. Never merge to main, publish, or release without explicit owner approval.
- Do not reset, force-push, delete branches, or discard work.
- Before substantial functionality, inspect the Touch-Modules registry and relevant source; document why reuse is or is not appropriate.
- Respect source-site terms and technical restrictions. Do not bypass access controls. Treat recipe-page importing as user-directed capture; preserve the source URL and attribution data when available. Make failures recoverable with user editing and manual entry.
- Use incremental changes; run relevant tests and GitHub Actions; inspect logs and artifacts. Report only evidence-backed results.
- Record decisions and changes in the appropriate planning documents and persistent knowledge reports.
- Preserve user-owned recipes with backup/export pathways; define sync, privacy and data ownership before implementing network storage.

## Touch Recipe product and visual requirements
- The app should be ambitious and feature-rich, with recipe importing/capture and correction as a defining strength. The exact release scope is still being decided.
- Current visual direction is the selected modern food magazine concept: clean editorial layout, prominent food photography, deep green and tomato-orange accents, expressive readable headings, and tasteful custom illustration.
- Visual artwork must stay modular and replaceable. The owner will cut and map assets with Pictureshop and Touch Toolkit. Keep custom backgrounds, panels, buttons, and decorative pieces separate from functional controls and app logic; document asset names, dimensions, anchors, layering, safe areas and click/touch regions.
- The owner specifically plans separate artwork for controls such as Import Recipe, Save Recipe and the grocery-list callout/box.
- On first load, briefly illuminate tappable controls to teach the interface. Keep it brief, clear, accessible, and non-repeating in a way that becomes annoying; exact timing and replay preference remain to be decided.
- Generated concept sheets are visual references, not production-ready screen assets or exact layout specifications. Do not bake text into reusable backgrounds when it should remain editable/accessibility-readable in the UI.

## Starting an authorized implementation
- Audit feasibility, import approaches, Android share intents, website parsing constraints, storage, image handling, accessibility, offline behavior, privacy, dependencies and licensing.
- Provide an implementation plan with screen flows, data model, recovery behavior, measurable acceptance criteria and limitations.
- Wait for explicit approval of the scope/plan before coding.
- Check and record actual file paths, tests, CI evidence, source commit and APK delivery requirements.

## Persistent project knowledge and component reuse
- Before authorized code work, read `docs/knowledge/README.md` and relevant patterns, lessons, issues, test history and work reports.
- After substantial work, add a dated report under `docs/knowledge/reports/` using the template; update knowledge registers only with verified evidence.
- Consult `docs/COMPONENT_REGISTRY.md`; do not assume another app's source can be reused without checking compatibility and license.

## Mandatory branch discovery and handoff
- Read `docs/BRANCH_STATUS.md`, then verify live GitHub branches, PRs, commits, workflows and artifacts. The handoff file is only a hint.
- Identify current source branch separately from latest successful APK branch.
- Report the verified base and commit before implementation.
- Never merge, reset, force-push, delete branches or release without explicit approval.

## APK delivery
When Android implementation is authorized, follow the shared Touch AutoBuild and APK delivery standards in the touch-development hub. An assignment is not complete until the verified APK is attached to chat and repository, branch, commit, CI run, validation and limitations are reported. Do not claim an artifact the delivery tool did not confirm.
