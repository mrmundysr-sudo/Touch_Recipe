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

## Open questions
| ID | Question | Status |
|---|---|---|
| Q-001 | What feature set belongs in the ambitious first release versus later phases? | Open |
| Q-002 | Which other import inputs are required at launch (built-in browser, clipboard text, photo/scan)? | Open |
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
