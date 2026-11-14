# 2026-11-14 App-to-app recipe sharing
Plan: docs/SHARE_APP_TO_APP_PLAN.md (owner approved scope, duplicate prompt, and plan 2026-11-14).
Built: `www/js/data/share.js` (build/parse/duplicate detection/import with undo), `www/js/screens/sharing.js` (send checklist, receive preview with per-duplicate Skip / Keep both / Replace mine + apply-to-all, Open a shared file, `appUrlOpen` listener), Print & Share buttons, `.touchrecipe` file type in tools/patch_ios.py.
Deviation from plan: no "Shared with you" note is written into the recipe, so the received recipe is exactly the sender's.
Evidence: tests/share.test.mjs 7 ok; tools/e2e-share.cjs passes at 390x844 and 320x568; e2e 34, rescue 9 ok. Full `node --test tests/` has 7 failures that are identical without this change (DOM suites need linkedom, absent in the workspace).
Not verified: tap-to-open of a .touchrecipe from Messages/AirDrop on a real iPhone (Info.plist document type and appUrlOpen are untested outside CI); Android receiving.
