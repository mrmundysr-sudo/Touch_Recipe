# Known Issues

| ID | Component | Symptoms | Severity | Status | Workaround | Evidence |
|---|---|---|---|---|---|---|
| K-001 | Import / OCR | Camera, ML Kit recognition and PDF page rendering were not exercised on a device (the JVM tests use a fake OCR engine). | High until device-tested | Open | Test on a phone; fall back to Paste or Type | `docs/TESTING.md` |
| K-002 | Import / web | No live recipe sites could be reached from the build sandbox, so real-site coverage is unmeasured. Fixtures cover common shapes. | High until tested | Open | Run `-Dtr.live.urls=…` on a networked machine; users can paste text | `ImporterCorpusTest` |
| K-003 | Accessibility | No TalkBack/hardware-keyboard walkthrough was done on a device. Semantics, labels, focus rings and custom actions exist and are tested at the semantics level only. | Medium | Open | Manual pass before release | `docs/TESTING.md` |
| K-004 | Layout | Art windows are small, so lists show 2–4 rows before scrolling; collapsing a grocery category cannot reflow the art. | Low | By design | Tap the section header for the full editor | `docs/ART_WIRING.md` |
| K-005 | Art | Source art is 841 px wide with no density variants; large tablets look soft. | Low | Open | Provide larger art | — |
| K-006 | Cook Mode | A step image is shown if a direction has one, but no screen sets step images yet. | Low | Open | — | `Direction.image` |
| K-007 | Printing | Print/share use plain text (no photos or styling). | Low | Open | — | `printText` |
| K-008 | Tests | Under heavy CPU load the Robolectric UI suite has shown occasional timing flakes (fewer after hardening; 3 consecutive clean full runs). | Low | Monitor | Re-run; waits are generous | report |
| K-009 | Release | The release APK is built unsigned unless signing variables are supplied; Play upload needs an owner-held key. | Blocking for store | Owner action | — | `docs/store/PLAY_LISTING.md` |
| K-010 | Import / web | A site that blocks the app's plain page request, or builds the recipe with scripts, still cannot be imported by link; the user is told and offered Paste. The in-app browser planned for this is a later stage. | High | Open | Paste or Type; share the page text | audit report R1 |
| K-011 | Import / iOS | The 2026-11 importer repairs (page cross-check, completeness findings, layout-aware reading order) exist only in the Android app. The iOS port in `www/js/engine` is unchanged. | High for parity | Open | — | `docs/knowledge/reports/2026-11-11-importer-repair.md` |
| K-012 | Import / PDF, OCR | PdfBox text reading is covered by JVM tests with generated PDFs; scanned pages, real camera photos, handwriting and the owner's own PDFs are not yet tested on a device. | High until device-tested | Open | Paste or Type | same report |
| K-013 | Import / originals | The original page, PDF file or photo is not stored yet (only the address and the extracted text). Planned with drafts and Recipe Rescue. | Medium | Open | Keep the original file | owner decision 5, 2026-11-11 |
| K-014 | Import / web | On pages with no recipe data at all, about one in three still imports incompletely (always with a warning). Whole web pages printed to PDF with menus and sidebars import less cleanly than a site's own print view. | Medium | Open | Recipe Rescue (planned) | benchmark |

