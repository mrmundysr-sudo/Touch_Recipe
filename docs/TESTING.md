# Testing

## What runs where
| Layer | Tooling | Where it runs | Location |
|---|---|---|---|
| Rules and engines (quantity scaling, importer, grocery, categories, timer, planner, backup codec, converters) | JUnit | JVM | `app/src/test/.../core` |
| Persistence, backup/restore, import service (OCR with a fake engine, files, social captions, offline/blocked) | Robolectric + Room | JVM | `.../data/DataTest.kt` |
| Every page, navigation through every illustrated object, first-load glow, reduced motion, import → review → save, share intent flow, no-network retry, dynamic rows with undo and reorder, categories incl. the 50 limit, serving scaling, Cook Mode timer/steps/persistence/finish, planner, grocery generation/dedupe/purchased/clear, settings/themes | Robolectric + Compose UI test (real touch injection through the art layer) | JVM | `.../ui/FlowsTest.kt`, `ScreensSmokeTest.kt` |
| Touch-target audit, labels, orientation lock, permission list | JUnit/Robolectric | JVM | `.../ui/QualityTest.kt` (`ManifestTest`) |
| Small phone (320×568), tablet (800×1280), dark mode, 200 % font scale tours with “nothing leaves the screen” checks and screenshots | Robolectric native graphics | JVM | `.../ui/QualityTest.kt` |
| Real device smoke test (splash → hub → each hub object) | `connectedDebugAndroidTest` | emulator in CI | `app/src/androidTest` |

Run locally: `./gradlew :app:testDebugUnitTest` (set `ROBOLECTRIC_DEPS_DIR` to a folder holding the Robolectric `android-all-instrumented` jars on networks that block Maven downloads). Screenshots of every page at each size are written to `app/build/screens`.

Opt-in live import check on a machine with internet: `./gradlew :app:testDebugUnitTest -Dtr.live.urls=https://site/recipe1,https://site/recipe2` (prints method, confidence and counts per URL).

## Not covered by automated tests (do these on a device before release)
- Real camera capture, ML Kit recognition quality, PDF rendering (the JVM tests use a fake OCR engine and an invalid-PDF failure case).
- Android share sheet entry from a real browser/TikTok/Instagram, the notification permission dialog, alarm delivery with the screen off, vibration.
- Screen-reader walkthrough (TalkBack), hardware keyboard focus order, real IME behaviour with the art scrolling.
- Real-site import corpus (sandbox network was restricted; fixtures in `ImporterCorpusTest` stand in for common page shapes).
- ANR/crash monitoring over a long session, low-end device performance.
