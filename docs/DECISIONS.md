# Touch Recipe — Decision Log

Record confirmed choices separately from open proposals. Never rewrite history silently.

## Confirmed decisions

### DEC-001 — Product ambition and import priority
- **Status:** Approved
- **Date:** 2026-10-29
- **Decision:** Aim for a highly ambitious, feature-rich recipe app; recipe capture from online sources and easy editing/correction are central.
- **Rationale:** Strong recipe import is a key reason users favor Paprika; Touch Recipe should make collecting and managing recipes especially good.
- **Approved by:** Matthew Mundy
- **Affected files/modules:** Product vision, development plan, import UX.

### DEC-002 — Modular illustrated visual identity
- **Status:** Approved
- **Date:** 2026-10-29
- **Decision:** Use the selected modern food magazine concept: food photography, editorial type, deep green and tomato-orange accents, tasteful illustration, and polished backgrounds/buttons in the spirit of Touch games.
- **Rationale:** Owner selected the modern editorial four-screen concept as the favorite.
- **Approved by:** Matthew Mundy
- **Affected files/modules:** Visual system, app screens, asset pipeline.

### DEC-003 — Owner-mapped replaceable artwork
- **Status:** Approved
- **Date:** 2026-10-29
- **Decision:** Keep illustrated artwork in separate replaceable pieces for the owner to cut and map using Pictureshop and Touch Toolkit. Initial examples include Import Recipe, Save Recipe and the grocery-list box/callout.
- **Rationale:** Lets visual assets be revised without cluttering app logic.
- **Approved by:** Matthew Mundy
- **Affected files/modules:** Visual asset spec and UI implementation.

### DEC-004 — First-load clickable guidance
- **Status:** Approved
- **Date:** 2026-10-29
- **Decision:** Briefly illuminate clickable controls when a page first loads.
- **Rationale:** Help users notice available interactions.
- **Approved by:** Matthew Mundy
- **Open details:** Which screens, exact duration, replay/reset behavior, reduced-motion/accessibility alternative.

### DEC-005 — Include social-media recipe capture in product scope
- **Status:** Approved
- **Date:** 2026-10-29
- **Decision:** Plan for saving recipes from social-media sources, including TikTok, Instagram and Facebook, alongside ordinary recipe websites.
- **Rationale:** The owner explicitly wants Touch Recipe to get ahead of Paprika 4's social import update.
- **Approved by:** Matthew Mundy
- **Affected files/modules:** Product vision, import research, feasibility audit.
- **Implementation note:** Supported behavior, platform restrictions, available captions/text and lawful/authorized access must be researched; do not promise universal extraction until tested.

### DEC-006 — Android Share menu import entry
- **Status:** Approved
- **Date:** 2026-10-29
- **Decision:** Touch Recipe should be available as a destination from Android's Share menu, using the action label “Import to Touch Recipe.” Choosing it starts the import flow with the shared link or content ready for review.
- **Rationale:** Let users send recipes directly from browsers and supported social apps without manually switching apps and re-entering a URL.
- **Approved by:** Matthew Mundy
- **Affected files/modules:** Android share intent handling, import flow.
- **Open implementation details:** Which content types each source app shares and what can be extracted must be verified.

### DEC-007 — Quick, forgiving review before saving
- **Status:** Approved
- **Date:** 2026-10-29
- **Decision:** After importing, show the captured recipe for review and correction before saving. The common successful path should be a quick check and save; when correction is needed, make the problem easy to spot and the fix painless.
- **Rationale:** Automatic extraction may not be perfect, but users should not have to rebuild a recipe manually. The app should feel intuitive and efficient.
- **Approved by:** Matthew Mundy
- **Affected files/modules:** Import pipeline, review screen, editable recipe model, error recovery.
- **Design requirement:** Preserve extracted content, focus attention on missing or uncertain fields, allow direct edits, and avoid unnecessary steps when extraction is complete.

### DEC-008 — Capture printed recipes by camera or file
- **Status:** Approved
- **Date:** 2026-10-29
- **Decision:** Include a way to photograph or scan a cookbook page or recipe card, and to import recipe images or PDFs already saved on the phone, turning them into editable recipes.
- **Rationale:** The owner considers camera/scan capture very important and approved importing existing phone files as well.
- **Approved by:** Matthew Mundy
- **Affected files/modules:** Camera/photo input, Android document picker, PDF/image handling, OCR/recipe extraction, review screen.
- **Design requirement:** Let users check and correct recognized text before saving; preserve the source image/PDF when useful.
- **Implementation note:** Handwriting recognition, page layouts, file size, image quality, offline processing and device performance require feasibility testing.

### DEC-009 — One clear import hub with multiple input methods
- **Status:** Approved
- **Date:** 2026-10-29
- **Decision:** The main “Import Recipe” action opens a simple choice of ways to add a recipe: enter a website or social link, take a photo, choose a saved image/PDF, or type/paste recipe text. Android Share imports can enter directly with the shared content ready.
- **Rationale:** Make all common input methods easy to find without crowding the home screen, while keeping direct sharing fast.
- **Approved by:** Matthew Mundy
- **Affected files/modules:** Home screen, import chooser, camera/document/text input and import routing.

## Open questions
| ID | Question | Status |
|---|---|---|
| Q-001 | What feature set belongs in the ambitious first release versus later phases? | Open |
| Q-002 | Which other import inputs are required at launch (built-in browser)? | Open |
| Q-003 | How should unsupported/partial imports recover and what parser sources are feasible? | Open |
| Q-004 | Which destinations/screens and navigation model are needed? | Open |
| Q-005 | Local-only, optional cloud sync, household sharing, and backup/export model? | Open |
| Q-006 | Monetization/free limits? | Open |
| Q-007 | Exact artwork sizes, slice format, names, density variants and screen safe areas? | Open |

## Change history
| Date | Change |
|---|---|
| 2026-10-29 | Initial project planning decisions recorded. |
| 2026-10-29 | Confirmed social-media recipe capture as a product requirement. |
| 2026-10-29 | Confirmed Android Share menu entry labeled “Import to Touch Recipe.” |
| 2026-10-29 | Defined quick, forgiving pre-save review and correction. |
| 2026-10-29 | Confirmed camera, scan and existing phone-file import for printed recipes. |
| 2026-10-29 | Defined one import hub for links, photos, saved files and typed/pasted text. |
