# Touch Recipe

An illustrated, local-first Android recipe app from Mundy Morning Studios. Collect recipes from web links, the Android Share menu, photos, PDFs or pasted text; correct them in a quick review step; cook step by step with timers; plan the week and build one grocery list. Everything is stored on the phone.

## Status
- First production-release implementation: **built on branch `claude/blissful-rubin-d0ni9m`**, awaiting owner review. Not merged, not released.
- See `docs/knowledge/reports/2026-10-30-first-production-release.md` for evidence, limitations and the owner approval list.

## Start here
1. [CLAUDE.md](CLAUDE.md) — working rules. 2. [Product Vision](docs/PRODUCT_VISION.md), [Decisions](docs/DECISIONS.md), [Development Plan](docs/DEVELOPMENT_PLAN.md).
3. [Art wiring](docs/ART_WIRING.md) · [Architecture](docs/ARCHITECTURE.md) · [Testing](docs/TESTING.md) · [Backup format](docs/BACKUP_FORMAT.md) · [Play listing notes](docs/store/PLAY_LISTING.md).

## Build and test
```bash
./gradlew :app:testDebugUnitTest          # 80+ unit and Robolectric UI tests (see docs/TESTING.md)
./gradlew :app:assembleDebug              # app/build/outputs/apk/debug/
./gradlew :app:assembleRelease            # R8-minified; unsigned unless TR_KEYSTORE* variables are set
```
Requires JDK 17 and the Android SDK (platform 35). Regenerate artwork assets with `python3 tools/build_assets.py <extracted package>` (needs Pillow and psd-tools); `python3 tools/mapping_sheet.py` draws the touch-target overlay sheets in `docs/art-map/`.

## Layout
`app/src/main/java/.../core` (pure Kotlin engines: model, quantity, importer, grocery, planner, categories, timer, backup) · `data` (Room, repository, fetch, OCR, backup, alarms) · `ui` (theme, art framework, components, screens) · `app/src/main/assets/art` (wired artwork + manifest) · `tools` (asset pipeline) · `docs`.
