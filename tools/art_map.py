"""Annotations that turn the exported PSD cutouts into wired touch targets.

Coordinates are pixels in the 841x1870 artwork space. `tools/build_assets.py` normalises them
(0..1) into app/src/main/assets/art/manifest.json. The app is wired to target ids, never to
file names, so artwork can be replaced without touching business logic.

Target keys
  layer   PSD "Cutout N" whose pixels are the object (used for the glow and, with `pad`, the hit box)
  box     explicit box (x, y, w, h) when no cutout exists (headers, plus buttons)
  pad     extra hit padding in artwork px (generous regions around whole objects)
Region keys are dynamic content windows (x, y, w, h) that code-rendered text/photos live in.
"""

ART_W, ART_H = 841, 1870

PAGES = {
    "splash": dict(
        psd_id="page_01", folder="page_01_splash", bg="#F6E9D3", targets=[], regions={}),

    "hub": dict(
        psd_id="page_02", folder="page_02_kitchen_hub", bg="#24382B",
        targets=[
            dict(id="stove", layer=1, label="Stove and oven", hint="Opens Cook Mode", pad=14),
            dict(id="calendar", layer=2, label="Cat calendar", hint="Opens the Meal Planner", pad=14),
            dict(id="new_recipe", layer=3, label="Refrigerator new recipe card", hint="Opens Import Recipe", pad=18),
            dict(id="search", layer=4, label="Magnifying glass", hint="Opens Search", pad=22),
            dict(id="grocery", layer=5, label="Grocery bag", hint="Opens the Grocery List", pad=14),
            dict(id="drawer", layer=6, label="Kitchen junk drawer", hint="Opens the Kitchen Junk Drawer", pad=26),
            dict(id="rolodex", layer=7, label="Recipe Rolodex", hint="Opens your Recipe Collection", pad=10),
        ]),

    "collection": dict(
        psd_id="page_03", folder="page_03_recipe_collection", bg="#2B3A2E",
        targets=[
            dict(id="search", layer=1, label="Search recipes", hint="Opens search", pad=10),
            dict(id="new_recipe", layer=2, label="New Recipe", hint="Opens Import Recipe", pad=10),
            dict(id="tab0", box=(222, 138, 120, 78), label="All recipes tab", hint="Shows every recipe", pad=14),
            dict(id="tab1", box=(350, 140, 118, 76), label="Favorites tab", hint="Shows favorite recipes", pad=14),
            dict(id="tab2", box=(474, 140, 116, 76), label="Category tab", hint="Filters by this category", pad=14),
            dict(id="tab3", box=(594, 138, 140, 78), label="Category tab", hint="Filters by this category", pad=14),
            dict(id="tab4", box=(738, 142, 56, 74), label="More filters and sorting", hint="Opens filters and sorting", pad=24),
        ],
        regions=dict(
            list=(28, 258, 786, 1440),
        )),

    "detail": dict(
        psd_id="page_04", folder="page_04_recipe_detail", bg="#F2E6D0",
        targets=[
            dict(id="back", layer=4, label="Back", hint="Returns to the Recipe Collection", pad=30),
            dict(id="favorite", layer=3, label="Favorite", hint="Toggles favorite", pad=30),
            dict(id="cook", layer=1, label="Cook Mode", hint="Step by step cooking", pad=6),
            dict(id="grocery", layer=2, label="Add to Grocery List", hint="Adds ingredients to the grocery list", pad=6),
            dict(id="serv_dec", box=(506, 770, 74, 74), label="Fewer servings", hint="Decreases servings and scales ingredients", pad=18),
            dict(id="serv_inc", box=(668, 770, 74, 74), label="More servings", hint="Increases servings and scales ingredients", pad=18),
            dict(id="photo", box=(36, 104, 769, 292), label="Recipe photo", hint="Shows, replaces or removes the photo", pad=0, glow=False),
            dict(id="ingredients_head", box=(28, 850, 520, 70), label="Edit ingredients", hint="Opens the ingredient editor", pad=20),
            dict(id="directions_head", box=(28, 1476, 520, 70), label="Edit directions", hint="Opens the direction editor", pad=20),
        ],
        regions=dict(
            photo=(0, 0, 841, 408),
            title=(40, 424, 590, 236),
            meta0=(98, 684, 100, 52), meta1=(322, 684, 100, 52), meta2=(490, 684, 125, 52), meta3=(704, 684, 100, 52),
            servings_value=(590, 778, 76, 60),
            ingredients=(40, 920, 520, 400),
            directions=(40, 1566, 690, 270),
        )),

    "cook": dict(
        psd_id="page_05", folder="page_05_cook_mode", bg="#F2E6D0",
        targets=[
            dict(id="back", layer=4, label="Back", hint="Returns to the recipe", pad=26),
            dict(id="clock", layer=1, label="Timer clock", hint="Shows the countdown", pad=10),
            dict(id="start", layer=2, label="Start timer", hint="Starts, pauses or resets the timer", pad=8),
            dict(id="prev", layer=3, label="Previous step", hint="Goes to the previous step", pad=8),
            dict(id="next", layer=5, label="Next step", hint="Completes this step and goes on", pad=8),
        ],
        regions=dict(
            stepchip=(300, 192, 244, 56),
            top=(70, 262, 702, 598),
            bottom=(70, 900, 702, 380),
            clockface=(158, 1380, 108, 114),
        )),

    "import": dict(
        psd_id="page_06", folder="page_06_import_recipe", bg="#E9D8B7",
        targets=[
            dict(id="back", layer=1, label="Back", hint="Returns to the Kitchen Hub", pad=26),
            dict(id="url", layer=2, label="Paste Recipe URL", hint="Import a recipe from a web page link", pad=6),
            dict(id="text", layer=3, label="Paste or Type Recipe", hint="Paste or type recipe text", pad=6),
            dict(id="scan", layer=4, label="Scan a Recipe", hint="Photograph a printed recipe", pad=6),
            dict(id="file", layer=5, label="Import PDF or File", hint="Choose a PDF or image from your device", pad=6),
            dict(id="share", layer=6, label="Share to Touch Recipe", hint="Explains how to share a recipe into the app", pad=6),
            dict(id="continue", layer=7, label="Continue to Review", hint="Review and correct the imported recipe", pad=6),
        ]),

    "review": dict(
        psd_id="page_07", folder="page_07_import_review", bg="#E9D8B7",
        targets=[
            dict(id="back", layer=1, label="Back", hint="Returns without saving", pad=26),
            dict(id="photo", layer=2, label="Recipe photo", hint="Choose, replace or remove the photo", pad=4),
            dict(id="add_ingredient", box=(718, 654, 96, 80), label="Add ingredient", hint="Adds an ingredient row", pad=14),
            dict(id="add_direction", box=(718, 1044, 96, 80), label="Add direction", hint="Adds a direction row", pad=14),
            dict(id="ingredients_head", box=(36, 664, 330, 58), label="Edit all ingredients", hint="Opens the ingredient editor", pad=24),
            dict(id="directions_head", box=(36, 1048, 330, 58), label="Edit all directions", hint="Opens the direction editor", pad=24),
            dict(id="add_category", layer=5, label="Add Category", hint="Opens category choices", pad=8),
            dict(id="details", layer=6, label="Edit Details", hint="Edit servings, times, source and notes", pad=4),
            dict(id="save", layer=7, label="Save Recipe", hint="Validates and saves this recipe", pad=4),
        ],
        regions=dict(
            title=(307, 408, 470, 72),
            source=(388, 503, 394, 52),
            ingredients=(46, 735, 756, 300),
            directions=(46, 1126, 756, 330),
            categories=(46, 1512, 756, 200),
        )),

    "planner": dict(
        psd_id="page_08", folder="page_08_meal_planner", bg="#3B2A1B",
        targets=[
            dict(id="week", layer=36, label="Week selector", hint="Choose which week to plan", pad=32),
            dict(id="calendar", layer=37, label="Cat calendar", hint="Opens week and date selection", pad=10),
            dict(id="grocery", layer=38, label="Grocery List basket", hint="Opens the Grocery List", pad=0),
        ],
        # Per day: label, date, title, cook time, servings cutouts; photo window is the blank rectangle.
        regions=dict(),
        days=dict(first=1, count=7, per=5, photo_x=170, photo_w=227, photo_h=136, photo_dy=-10,
                  action=(692, 0, 116, 116))),

    "grocery": dict(
        psd_id="page_09", folder="page_09_grocery_list", bg="#5B3F28",
        targets=[
            dict(id="back", layer=1, label="Back", hint="Returns to the previous page", pad=30),
            dict(id="week", layer=2, label="Week range", hint="Choose the grocery week", pad=24),
            dict(id="basket", layer=3, label="Grocery basket", hint="Refresh from planned meals", pad=0),
            dict(id="add", layer=24, label="Add Item", hint="Adds a grocery item", pad=20),
            dict(id="clear", layer=25, label="Clear Checked", hint="Removes purchased items", pad=18),
        ],
        # Category cards: card layer, header+first-row layer, checkbox layer, quantity layer
        cards=[
            dict(key="produce", card=19, head=4, check=9, qty=14),
            dict(key="meat", card=20, head=5, check=10, qty=15),
            dict(key="dairy", card=21, head=6, check=11, qty=16),
            dict(key="pantry", card=22, head=7, check=12, qty=17),
            dict(key="bakery", card=23, head=8, check=13, qty=18),
        ],
        regions=dict()),

    "drawer": dict(
        psd_id="page_10", folder="page_10_kitchen_junk_drawer", bg="#2F4A36",
        targets=[
            dict(id="back", layer=8, label="Back", hint="Returns to the Kitchen Hub", pad=22),
            dict(id="settings", layer=1, label="Settings, brass gear", hint="Opens Settings", pad=6),
            dict(id="categories", layer=2, label="Category cards", hint="Opens Category Management", pad=4),
            dict(id="backup", layer=3, label="Backup and Export notebook", hint="Opens Backup and Export", pad=2),
            dict(id="themes", layer=4, label="Theme swatches", hint="Opens Themes", pad=2),
            dict(id="help", layer=5, label="Help card", hint="Opens Help", pad=4),
            dict(id="tools", layer=6, label="Chef timer and tools", hint="Opens timer, conversions and measurements", pad=6),
            dict(id="print", layer=7, label="Print and Share card", hint="Opens Print and Share", pad=2),
        ],
        regions=dict()),
}
