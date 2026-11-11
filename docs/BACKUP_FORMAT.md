# Touch Recipe backup format (version 1)

A backup is a ZIP archive. Nothing in it is encrypted or proprietary, so a user's recipes are never locked in.

```
touch-recipe-backup-YYYYMMDD.zip
├── data.json            everything below
└── photos/<uuid>.jpg    one file per recipe photo referenced by recipes[].photo
```

`data.json` alone (the “Export recipes as JSON” option, which omits photos, plans, lists and preferences) is also accepted on restore.

## data.json

```jsonc
{
  "format": "touch-recipe-backup",   // must match
  "version": 1,                      // restore refuses a newer version with a clear message
  "exportedAt": 1761820000000,       // epoch ms
  "appVersion": "1.0.0",
  "recipes": [{
    "id": "uuid", "title": "…", "description": "…", "notes": "…",
    "photo": "uuid.jpg",             // name inside photos/, or null
    "sourceUrl": "https://…", "sourceName": "example.com", "cuisine": "Italian",
    "prepMinutes": 10, "cookMinutes": 20, "totalMinutes": 30, "servings": 4,
    "ingredients": [{ "id": "…", "text": "1 1/2 cups flour", "header": false, "checked": false }],
    "directions":  [{ "id": "…", "text": "Mix…", "timerSeconds": 540, "header": false, "image": null }],
    "categoryIds": ["b_dinner", "c_1a2b3c4d"],
    "favorite": false,
    "rawSource": "original imported text or structured data, kept for correction",
    "createdAt": 0, "updatedAt": 0
  }],
  "categories":   [{ "id": "b_dinner", "name": "Dinner", "group": "Meal and course", "builtIn": true, "enabled": true, "sortOrder": 3 }],
  "mealPlan":     [{ "date": "2026-11-02", "recipeId": "uuid", "servings": 6 }],
  "groceryItems": [{ "id": "…", "weekStart": "2026-10-26", "name": "Milk", "quantityText": "1 l", "aisle": "dairy",
                     "checked": true, "sortIndex": 0, "key": "milk|VOLUME", "generated": false, "edited": true,
                     "sources": [{ "recipeId": "uuid", "title": "…" }] }],
  "preferences":  { "theme": "SYSTEM", "glow": "true", "motion": "SYSTEM", "keep_awake": "true", "sunday_start": "false", "vibrate": "true" }
}
```

Unknown fields are ignored on restore, so later versions can add data without breaking older readers of the same major version.

## Restore behaviour
- **Merge**: adds recipes that are new or newer (`updatedAt`) than what the phone has; categories keep the more-enabled state; plans and lists are upserted by key.
- **Replace**: clears recipes, meal plan, grocery lists and cooking progress first, then loads the backup (preferences included). The UI asks for a second confirmation.
- The whole file is read and validated **before** anything is changed; a damaged or foreign file leaves existing data untouched.
- Photos are only written as `photos/<name>.jpg` with no path separators (zip-slip safe).

Code: `core/backup/Backup.kt` (format), `data/BackupManager.kt` (zip + database). Tests: `data/DataTest.kt`, `core/EnginesTest.kt`.
