# Touch Recipe — Decision Log

Record confirmed choices separately from open proposals. Never rewrite history silently.

## Confirmed decisions

### DEC-001 — Product ambition and import priority
- **Status:** Approved · **Date:** 2026-10-29
- **Decision:** Aim for a highly ambitious, feature-rich recipe app; recipe capture from online sources and easy editing/correction are central.
- **Rationale:** Strong recipe import is a key reason users favor Paprika; Touch Recipe should make collecting and managing recipes especially good.

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
- **Custom entry behavior:** Enabling Custom reveals a text box. Enter commits the typed category, adds it as an enabled/checked category (and selects it for the current recipe where applicable), then leaves a fresh text box ready for another entry.

### DEC-011 — Keep the category picker simple, with Add Category always visible
- **Status:** Approved · **Date:** 2026-10-29
- **Decision:** Show only a short common set of categories in the initial category picker, with a visible “Add Category” option.
- **Expanded behavior:** Add Category opens the broader built-in category catalog and Custom option, so users can enable more built-in categories or create their own without crowding the normal recipe screen.
- **Open detail:** Which common categories appear in the short list.

### DEC-012 — Add Category is a modular illustrated button
- **Status:** Approved · **Date:** 2026-10-29
- **Decision:** Create “Add Category” as its own replaceable illustrated button asset, consistent with the Import Recipe and Save Recipe controls.
- **Implementation detail:** Keep the actual label as app text over/alongside the art for readability, accessibility and easy wording changes.

## Open questions
| ID | Question | Status |
|---|---|---|
| Q-001 | What feature set belongs in the ambitious first release versus later phases? | Open |
| Q-002 | Is a built-in recipe browser needed in addition to Share, URL entry and paste? | Open |
| Q-003 | How should unsupported/partial imports recover and what parser sources are feasible? | Open |
| Q-004 | Which destinations/screens and navigation model are needed? | Open |
| Q-005 | Local-only, optional cloud sync, household sharing, and backup/export model? | Open |
| Q-006 | Monetization/free limits? | Open |
| Q-007 | Exact artwork sizes, slice format, names, density variants and screen safe areas? | Open |
| Q-008 | Which categories belong in the short common list? | Open |

## Change history
| Date | Change |
|---|---|
| 2026-10-29 | Initial project decisions recorded. |
| 2026-10-29 | Confirmed social capture, Android Share, quick review, camera/file inputs, unified import chooser and flexible category system. |
| 2026-10-29 | Confirmed short common category picker with visible Add Category expansion. |
| 2026-10-29 | Added modular illustrated Add Category button to the visual system. |
