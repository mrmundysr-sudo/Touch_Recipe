# Plan: Touch Recipe to Touch Recipe sharing (PROPOSED - awaiting owner approval of this plan before any code)

Owner decisions (2026-11-14): scope approved (additive to the existing Share/Print text sharing); if a received recipe is a duplicate, the person is asked.

## Reuse audit
- `www/js/data/backup.js` already encodes/decodes recipes + photos (`data.json` + `photos/*.jpg`, `docs/BACKUP_FORMAT.md`, shared with the Android app) and `saveFile()` already writes to cache and opens the iOS share sheet. Reused for the file format, zip and sending.
- NOT reusable as is: `BackupManager.restore(MERGE)` keeps the same recipe ids and overwrites an existing recipe when the incoming one is newer. Receiving shared recipes needs its own path (`importShared`) that never overwrites.
- `tools/patch_ios.py` already edits the generated Info.plist in CI; the file-type registration goes there. Capacitor `App` plugin `appUrlOpen` delivers the opened file URL (to be verified against the installed plugin set).

## Screens / flow
1. Print & Share: new button "Send to another Touch Recipe user" (existing buttons unchanged).
2. Send screen: checklist of recipes (title, photo thumb), Select all / none, count, big "Send N recipes" button -> `.touchrecipe` file (zip, backup format, recipes+photos only, `kind:"share"`) -> iOS share sheet (AirDrop, Messages, Mail, Files).
3. Receive: tapping the file (or "Open a shared recipe file" on Print & Share) opens a preview: list with photos, "N new, M already here". Nothing is saved until the person taps Add.
4. Duplicate = same id, or same title + same source URL (or same title and ingredient count when no URL). For each duplicate the person chooses: Keep both (adds a copy titled "... (shared)"), Skip, or Replace mine (only on explicit tap, undoable once). A "do this for all" choice is offered.
5. Added recipes get new ids, keep sourceUrl/sourceName/notes/times/course/photo+frame, and a "Shared with you" note. Result toast with Undo.

## Data / recovery / privacy
- Whole file is validated before anything changes (size cap, format, newer-version message, damaged-file message). Failure changes nothing.
- No network, account or server; data goes only where the person sends it. A backup of the receiver's library is recommended before Replace (Replace is undoable).
- Categories/meal plan/grocery/preferences are never sent or applied.

## Acceptance criteria
- Round trip in tests: export N recipes -> import into an empty library -> every field and photo equal (except new ids/shared note).
- Duplicate cases each tested: keep both, skip, replace (+undo), apply-to-all.
- Corrupt, empty, wrong-format, newer-version and oversize files give a plain message and change nothing.
- Existing text Share/Print and backup/restore behavior unchanged (existing suites still pass).
- CI build includes the registered file type (verify in the generated Info.plist in the CI log).

## Limitations
- Tap-to-open on a real iPhone cannot be verified by me; owner test needs two devices/Apple IDs. The in-app "Open a shared recipe file" is the fallback.
- Android receiving is a separate task (same format).
- Very large photo sets may exceed Messages limits; AirDrop/Files are fine.

## Steps
1. Pure engine `data/share.js` (build file, parse, duplicate detection, import) + unit tests.
2. Send screen + button. 3. Receive preview + duplicate prompts. 4. patch_ios.py file type + appUrlOpen. 5. e2e + CI, report, KNOWN_ISSUES.
