# Testing History

| Date | Branch / commit | Runner | Command / checklist | Outcome | Limitations |
|---|---|---|---|---|---|
| 2026-10-30 | `claude/blissful-rubin-d0ni9m` @ code commit in the work report | 4-core Linux sandbox, JDK 21, Gradle 8.14.3, Robolectric 4.14.1 (SDK 34), native graphics | `./gradlew :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleRelease` | 82 tests passed (0 failed, 0 skipped); lint 0 errors / 48 warnings; debug and release APKs built | JVM only: no emulator or device; fake OCR; no live websites; earlier full runs showed occasional timing flakes before hardening (see K-008) |
