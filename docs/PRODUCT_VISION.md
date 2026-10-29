# Touch Recipe — Product Vision

> Status: Brainstorming / Draft. This document does not authorize implementation.

## Product identity
- **Working name:** Touch Recipe
- **Studio:** Mundy Morning Studios
- **One-sentence promise:** Collect recipes from around the web, make them your own, and enjoy a beautiful, useful recipe book for planning, shopping and cooking.
- **Audience:** Home cooks and households; exact audience needs more discussion.
- **Problem:** Favorite recipes are scattered across websites, social posts, messages, screenshots and personal notes; users need reliable capture, editable clean-up, organization and practical use.
- **Distinctive advantage:** A highly usable, visually rich recipe organizer whose capture flow includes websites, social-media sources and photographed printed recipes, with a correction workflow that makes imperfect extraction easy to fix.

## Confirmed decisions
- [x] Be ambitious and aim for a feature-rich first pass, with discovery and feasibility work before implementation.
- [x] Recipe capture from online sites is a central product priority; automatic extraction must allow customization and corrections.
- [x] Plan recipe capture from social-media sources, including TikTok, Instagram and Facebook, to get ahead of Paprika 4.
- [x] Include photographing/scanning cookbook pages and recipe cards, plus importing recipe images/PDFs already saved on the phone.
- [x] Route shared links/content into the app through Android Share, labeled “Import to Touch Recipe.”
- [x] The main Import Recipe action opens a simple chooser for website/social links, taking a photo, choosing an image/PDF, or typing/pasting recipe text.
- [x] Show an easy review and correction step before saving; usual imports should need only a quick check.
- [x] Give photography, attractive typography, color and visual polish high priority.
- [x] Use custom illustration for backgrounds and buttons, following the visual craftsmanship of Touch games.
- [x] Keep artwork modular so the owner can cut and map pieces using Pictureshop and Touch Toolkit.
- [x] Provide separate replaceable artwork for important controls, including Import Recipe, Save Recipe and the grocery-list callout/box.
- [x] On first load, briefly illuminate tappable controls to teach users where they can interact.
- [x] Current preferred concept is modern food magazine: clean editorial layouts, food photography, deep green and tomato-orange accents, expressive headings and tasteful illustrations.

## Proposed feature areas — scope to define
- Recipe capture: website/social links, Android share sheet, optional built-in browsing, camera/photos, saved images/PDFs, typed or pasted text, and robust manual fallback. Research each source's real technical availability and restrictions.
- Import review: editable title, photo, ingredients, directions, times, servings, categories, source URL and notes; clearly show missing or uncertain extraction and preserve everything captured when recovery is needed.
- Recipe library: powerful search, filters, tags/custom categories, favorites, ratings, notes, collections/cookbooks, sorting and duplicate handling.
- Recipe use: serving scaling, unit preferences/conversions, readable cook mode, timers, ingredient check-off, screen-awake option and accessibility.
- Planning: meal calendar, meal types, household meal plans, grocery list generation, consolidation, aisle customization and pantry.
- Data portability and trust: local-first storage, backup/restore, import/export, sharing, optional cross-device sync and privacy controls.
- Optional enhancements: nutrition, dietary filters, smart suggestions, recipe discovery and household collaboration; feasibility and data sources need review.

## User journeys to design
1. **Use the Import Recipe button:** choose a link, camera, saved image/PDF, or typed/pasted text → capture/extract → review/edit → save.
2. **Share from another app:** choose “Import to Touch Recipe” from Android Share → start directly with the shared link/content → review and correct → save. Exact behavior and content shared by each source require feasibility testing.
3. **Scan a printed recipe:** photograph or select a cookbook/card image or PDF → recognize recipe text → review and correct → save, optionally keeping the source file.
4. **Recover a partial import:** see what needs attention → correct fields or use assisted/manual capture → save without losing captured content.
5. **Find and cook:** search/filter library → open photo-rich recipe → scale servings → cook with clear steps and timers.
6. **Plan and shop:** place meals on a calendar → generate/adjust a grocery list → organize items for shopping.
7. **Protect and move collection:** back up/export, restore, share or sync according to chosen privacy model.

## Platform and UX
- Android-first, phone-friendly; test on both low-cost and higher-performance devices.
- Visual system: selected modern editorial concept with modular illustrated art. See `docs/VISUAL_ASSET_SPEC.md`.
- Accessibility, offline import/editing, storage, sync, privacy and data export are open product decisions.

## Reuse from existing apps
- Inspect Touch-Modules and candidate repositories for asset catalog conventions, layered visual panels, buttons, settings and persistence patterns.
- Verify source, compatibility, license, dependencies, performance and tests before reuse.

## Monetization and trust
- Pricing, ads, free limits and optional purchase model are open.
- Keep personal recipe data under user control; privacy and sync choices must be explicit.

## First release
- **In scope:** not yet approved. Owner wants an ambitious, feature-rich first pass with web/social capture, share-to-import, camera/file scans and text paste planned as key capabilities.
- **Out of scope:** not yet defined.
- **Success criteria:** define measurable import accuracy/coverage and recovery, usability, performance, accessibility, data safety and visual quality criteria before implementation.

## Open questions
See `docs/DECISIONS.md`; do not silently turn proposals into requirements.

## Approval
- **Product vision approved:** No — discovery continues.
- **Approved by / date:** Pending
