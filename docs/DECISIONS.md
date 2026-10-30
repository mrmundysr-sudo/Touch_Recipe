# Touch Recipe — Decision Log

Record confirmed choices separately from open proposals. Never rewrite history silently.

## Confirmed decisions

### DEC-001 — Product ambition and import priority
- **Status:** Approved · **Date:** 2026-10-29
- **Decision:** Aim for a highly ambitious, feature-rich recipe app; recipe capture from online sources and easy editing/correction are central.

### DEC-002 — Modular illustrated visual identity
- **Status:** Approved · **Date:** 2026-10-29
- **Decision:** Use the selected modern food magazine concept: food photography, editorial type, deep green and tomato-orange accents, tasteful illustration, and polished backgrounds/buttons in the spirit of Touch games.

### DEC-003 — Owner-mapped replaceable artwork
- **Status:** Approved · **Date:** 2026-10-29
- **Decision:** Keep illustrated artwork in separate replaceable pieces for the owner to cut and map using Pictureshop and Touch Toolkit. Initial examples include Import Recipe, Save Recipe and the grocery-list box/callout.

### DEC-004 — First-load clickable guidance
- **Status:** Approved · **Date:** 2026-10-29
- **Decision:** Briefly illuminate clickable controls when a page first loads.
- **Open details:** Which screens, exact duration, replay/reset behavior, reduced-motion/accessibility alternative.

### DEC-005 — Include social-media recipe capture
- **Status:** Approved · **Date:** 2026-10-29
- **Decision:** Plan for saving recipes from social-media sources, including TikTok, Instagram and Facebook, alongside ordinary recipe websites.
- **Implementation note:** Research platform restrictions and available captions/text; do not promise universal extraction until tested.

### DEC-006 — Android Share menu import entry
- **Status:** Approved · **Date:** 2026-10-29
- **Decision:** Make Touch Recipe available from Android Share as “Import to Touch Recipe.” Selecting it starts import with the shared link/content ready for review.
- **Open detail:** Verify what content each source app shares.

### DEC-007 — Quick, forgiving review before saving
- **Status:** Approved · **Date:** 2026-10-29
- **Decision:** Show the captured recipe for review and correction before saving. The usual path should be a quick check and save; when correction is needed, make the problem easy to spot and fix.
- **Design requirement:** Preserve extracted content, focus attention on missing or uncertain fields, allow direct edits, and avoid unnecessary steps when extraction is complete.

### DEC-008 — Capture printed recipes by camera or file
- **Status:** Approved · **Date:** 2026-10-29
- **Decision:** Let users photograph/scan cookbook pages and recipe cards, and import recipe images or PDFs already saved on the phone, turning them into editable recipes.
- **Design requirement:** Let users correct recognized text before saving; preserve the source image/PDF when useful.
- **Feasibility:** Handwriting, varied layouts, file size, offline processing and device performance need testing.

### DEC-009 — One clear import hub with multiple input methods
- **Status:** Approved · **Date:** 2026-10-29
- **Decision:** The main “Import Recipe” action opens choices for a website/social link, a new photo, a saved image/PDF, or typed/pasted recipe text. Android Share imports can go directly to review.

### DEC-010 — User-selectable built-in and custom categories
- **Status:** Approved · **Date:** 2026-10-29
- **Decision:** Provide a thorough built-in recipe category list whose categories users can enable or disable, plus a Custom category option. Allow up to 50 user-created categories.
- **Custom entry behavior:** Enabling Custom reveals a text box. Enter commits the typed category, adds it as an enabled/checked category and selects it for the recipe being edited, then leaves a fresh text box ready for another entry.

### DEC-011 — Simple category picker with visible Add Category
- **Status:** Approved · **Date:** 2026-10-29
- **Decision:** Show only the short common set—Breakfast, Lunch, Dinner, Appetizers, Main Dishes, Side Dishes, Snacks, Desserts and Drinks—in the initial category picker, with a visible “Add Category” option.
- **Expanded behavior:** Add Category opens the broader built-in catalog and Custom option, so users can enable more built-in categories or create their own without crowding the normal recipe screen.

### DEC-012 — Add Category is a modular illustrated button
- **Status:** Approved · **Date:** 2026-10-29
- **Decision:** Create “Add Category” as its own replaceable illustrated button asset, consistent with the Import Recipe and Save Recipe controls.
- **Implementation detail:** Keep the actual label as app text over/alongside the art for readability, accessibility and easy wording changes.

### DEC-013 — First production implementation authorized
- **Status:** Approved by owner assignment · **Date:** 2026-10-30
- **Decision:** The owner's assignment “implement Touch Recipe as a polished, store-ready Android app” (repository `Touch_Recipe`, asset package `touch_recipe_visual_assets.zip`) authorizes implementation of the ten-page first release on the branch `claude/blissful-rubin-d0ni9m`. It does **not** authorize merging to `main`, publishing, or release signing; those remain owner-only.
- **Supersedes:** the “Implementation: not authorized” status in README/DEVELOPMENT_PLAN.

### DEC-014 — Native Kotlin + Jetpack Compose, local-first
- **Status:** Implemented, awaiting owner review · **Date:** 2026-10-30
- **Decision:** Native Android (Kotlin, Compose, Room, ML Kit on-device text recognition, jsoup). No account, no backend, no analytics. Only `INTERNET` is declared up front (plus `VIBRATE`, a no-prompt normal permission for the timer buzz, and `POST_NOTIFICATIONS`, requested at the first timer start after an explanation). Camera capture uses the system camera app, so no `CAMERA` permission exists; files use the system picker, so no storage permission exists.
- **Answers:** Q-004 (screen map), Q-005 (local-only + backup/export; sync deferred), Q-007 (see `docs/ART_WIRING.md`).

### DEC-015 — Illustrated pages are fixed art with code-rendered content windows
- **Decision:** Each page is its supplied 841×1870 artwork (same aspect as 720×1600 within 0.1%) fitted inside the safe area; touch regions come from the PSD cutout layers (alpha-aware hit testing, generous padding), and all dynamic text/photos/rows are drawn by code inside measured windows. Everything is wired by slot/target id through `assets/art/manifest.json`, generated by `tools/build_assets.py`.
- **Assumptions recorded (smallest reasonable):** (1) the package has no `coords.json` or markup images, so PSD cutout bounds and measured regions are used; (2) labels printed inside the art (e.g. “Cook Mode”, “Start Timer”) are kept as artwork, with state-aware code labels laid over the timer button, and every target has a code-defined accessibility label; (3) the Collection art contains a baked ghost layout that is covered by an opaque parchment panel; (4) Collection and Planner art have no back arrow, so a small code-rendered back chip is added; (5) the in-art ingredient/direction windows are small, so their headers open full-height editors.

### DEC-016 — First-load illumination policy (resolves DEC-004 open details)
- **Decision:** Every illustrated tap target glows briefly in a staggered sweep (about 0.5 s each) on the first **two** visits to each page, and on every tap. Reduced motion (system “remove animations” or in-app switch) replaces the sweep with one soft simultaneous fade and no scaling. Settings can switch the guide off or replay it. Glow never intercepts touches; semantic nodes carry a “Highlighted” state for assistive tech and tests.

### DEC-017 — Orientation locked to portrait
- **Decision:** Portrait only, because every page is a portrait composition whose touch regions, text windows and photo areas exist only in that layout. Tablets get the art centred with side margins. Revisit if landscape art is commissioned.

### DEC-018 — Category naming (resolves a catalog inconsistency)
- **Decision:** The built-in course names follow DEC-011 (“Appetizers”, “Main Dishes”, “Side Dishes”, “Snacks”, “Desserts”, “Drinks”) wherever the draft catalog used singular forms; Mediterranean-Style (dietary) was dropped as a duplicate of the cuisine entry. Custom categories: trimmed, case-insensitive uniqueness, 40 characters, maximum 50.

### DEC-019 — Backup and import trust model
- **Decision:** Backups are ZIP files (documented in `docs/BACKUP_FORMAT.md`) written only where the user chooses. Imports never save directly; social links use only public captions (TikTok oEmbed) and are always marked low confidence; blocked or login-walled pages are reported as such and never bypassed.

## Open questions
| ID | Question | Status |
|---|---|---|
| Q-001 | What feature set belongs in the ambitious first release versus later phases? | Open |
| Q-002 | Is a built-in recipe browser needed in addition to Share, URL entry and paste? | Open |
| Q-003 | How should unsupported/partial imports recover and what parser sources are feasible? | Open |
| Q-004 | Which destinations/screens and navigation model are needed? | Answered by DEC-014/015 (owner review pending) |
| Q-005 | Local-only, optional cloud sync, household sharing, and backup/export model? | Local-only + backup/export implemented; sync/sharing still open |
| Q-006 | Monetization/free limits? | Open |
| Q-007 | Exact artwork sizes, slice format, names, density variants and screen safe areas? | Answered in `docs/ART_WIRING.md`; density variants still open |

## Change history
| Date | Change |
|---|---|
| 2026-10-29 | Initial project decisions recorded. |
| 2026-10-29 | Confirmed social capture, Android Share, quick review, camera/file inputs, unified import chooser and flexible category system. |
| 2026-10-29 | Confirmed short category set and modular illustrated Add Category control. |
| 2026-10-30 | Implementation authorized by assignment; recorded DEC-013..DEC-019. |
