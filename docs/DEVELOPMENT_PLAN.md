# Touch Recipe — Development Plan

> Status: Planning only. Do not implement until the owner approves the scoped plan.

## Source of truth and working rules
- GitHub is authoritative. Verify repository, branches, commits, PRs and Actions before each assignment.
- Keep planning on an isolated branch; implementation goes on its own branch when approved.
- No merges, releases or public launches without explicit approval.
- Do not infer approvals from aspirational brainstorms.

## Feasibility audit — pending
| Area | Evidence to gather |
|---|---|
| Website recipe extraction | Schema.org/JSON-LD Recipe, Open Graph, page DOM, supported site samples, failure modes and legal/terms constraints |
| Share and browser entry | Android intent/share behavior, URL handling, clipboard permissions and user expectations |
| Text, image and print capture | On-device OCR feasibility, image rights/storage, correction UX, device performance |
| Social/video import | Platform behavior, login/terms limits, captions/transcripts availability, no bypassing controls |
| Search and organization | Local indexing, custom categories/tags, duplicates and large-library performance |
| Planning and groceries | Ingredient parsing/consolidation limits, aisle mapping, editable quantities |
| Data and privacy | Local database, backup/export formats, optional sync, account/collaboration needs |
| Artwork pipeline | 720x1600 portrait source guidance plus scalable layouts, asset slices, density variants, touch targets and mapping workflow |
| Reuse and licenses | Touch-Modules registry, source repositories, third-party libraries and terms |
| Device support | Low-cost Android phone and OnePlus-class device; offline, storage and image memory tests |

## Proposed architecture — unresolved
- Data model, parser pipeline, provenance/confidence metadata, local persistence and migration: pending research.
- Import adapters and fallback strategy: pending feasibility audit.
- Optional sync and shared-household data: pending privacy and cost analysis.
- Visual assets: modular resource catalog, documented slice map and functional Compose controls with accessible labels/hit targets.
- CI/build configuration: inspect shared AutoBuild before setup.

## Milestones
### Phase 0 — Product discovery and design
- [x] Confirm visual concept direction and modular asset workflow.
- [ ] Decide first-pass feature scope, import entry points, recovery behavior, screen map and data/privacy model.
- [ ] Produce asset inventory and annotated screen-flow / interaction map.
- [ ] Audit import feasibility, dependencies, terms and device constraints.
- [ ] Present implementation scope, architecture, effort/risk and acceptance criteria for approval.

### Phase 1 — Foundation and core library (proposed)
- [ ] Build approved navigation, data model, persistence, accessibility and visual asset pipeline.
- [ ] Implement recipe add/edit, search, categories, favorites and backup/export as approved.
- [ ] Verify on target devices and through CI.

### Phase 2 — Import and cooking (proposed)
- [ ] Implement approved import sources, review/correction, error recovery, cook mode, scaling and timers.
- [ ] Validate with a representative test corpus across varied website structures.

### Phase 3 — Planning, grocery and advanced features (proposed)
- [ ] Implement approved meal planner, grocery list, pantry, sync/sharing and optional enhancements.
- [ ] Validate edge cases, offline behavior, migrations and data recovery.

### Phase 4 — Release readiness
- [ ] Accessibility, privacy, licenses, performance, error handling, versioning and device coverage.
- [ ] Verified CI APK and delivery report.

## Definition of done
- Owner-approved acceptance criteria pass on target device classes.
- Actual tests and GitHub Actions results are recorded.
- Recipe import failures preserve user work and provide a clear recovery path.
- Export/backup and restore behavior is verified if included.
- Visual assets are replaceable, mapped and accessible; no essential text is baked into art.
- Known limitations and manual checks are documented; verified APK attached when implementation is authorized.

## Approval
- **Development authorized:** No.
- **Approved scope / date:** Pending.

## Persistent knowledge and component reuse
- Review `docs/knowledge/` before authorized assignments; create a dated work report after substantial work.
- Consult `docs/COMPONENT_REGISTRY.md` and verify source and licenses before reuse.
