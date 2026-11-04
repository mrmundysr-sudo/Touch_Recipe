# Google Play listing notes (draft for owner review)

**App name:** Touch Recipe  **Package:** `com.mundymorning.touchrecipe`  **Version:** 1.0.0 (`versionCode` = CI run number or 1)
**Category:** Food & Drink  **Content rating:** Everyone (no user-generated content shared with others)
**Icon:** `store/play_icon_512.png` (generated from the supplied Rolodex art on forest green). Feature graphic and screenshots still need to be made: use the Robolectric screenshots in `app/build/screens` as a starting point.

**Short description (80):** Collect, correct and cook recipes with a warm illustrated kitchen. No account needed.

**Full description (draft):** Touch Recipe turns your phone into an illustrated kitchen. Tap the Rolodex for your recipes, the fridge card to bring one in, the stove to cook, the cat calendar to plan the week and the grocery bag to shop. Import from web links, the Android Share menu, photos of printed pages, PDFs or pasted text, then check and correct everything before saving. Scale servings, cook step by step with timers, combine a week of meals into one grocery list, and back everything up to a file you control. Your recipes stay on your phone.

## Data safety answers (as implemented)
- Data collected / shared: **none**. No account, analytics, ads or crash reporting SDKs.
- Network: only when the user imports a web link (fetches that one page). Photos/PDFs are read on device (ML Kit bundled model).
- Data is stored locally; Android may include it in device backup (`allowBackup`) if the user has that enabled; deletion: Settings → Delete all my data, or uninstall.
- Permissions: `INTERNET`, `VIBRATE` (no prompt), `POST_NOTIFICATIONS` (asked when the first cooking timer is started, after an explanation). Camera and file access use system apps/pickers.

## Privacy policy
A hosted URL is required by Play. Suggested text: “Touch Recipe does not collect, transmit or share personal data. Recipes, photos, plans and lists are stored only on your device. When you import from a web link the app requests that page from its website directly; Touch Recipe's developers never see it.” **Owner action:** publish this at a stable URL.

## Release signing (owner only)
The release build is unsigned unless these environment variables are provided to Gradle: `TR_KEYSTORE`, `TR_KEYSTORE_PASSWORD`, `TR_KEY_ALIAS`, `TR_KEY_PASSWORD`. No signing material is stored in the repository.
