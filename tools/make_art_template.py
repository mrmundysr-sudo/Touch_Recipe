# Builds the 2026-11 visual-builder template: the existing package unchanged, plus new pages for the scrolling screens.
import json, sys, zipfile, io, datetime, os
from PIL import Image, ImageDraw
src, out_dir, full_zip, delta_zip = sys.argv[1:5]
z = zipfile.ZipFile(src); manifest = json.loads(z.read('manifest.json')); readme = z.read('README.md').decode()
W = 841
PAPER = (243, 235, 219); GREEN = (31, 77, 58); BRASS = (181, 138, 60); TOMATO = (198, 61, 34)

def sheet(h, label, boxes=(), tile=False, top=False, bottom=False):
    im = Image.new('RGBA', (W, h), PAPER + (255,)); d = ImageDraw.Draw(im)
    if tile or top or bottom:
        # herb border zones down both edges; the centre must stay plain for recipe content
        d.rectangle([0, 0, 70, h - 1], fill=GREEN + (60,)); d.rectangle([W - 71, 0, W - 1, h - 1], fill=GREEN + (60,))
    if top: d.rectangle([0, 0, W - 1, 60], fill=GREEN + (90,))
    if bottom: d.rectangle([0, h - 80, W - 1, h - 1], fill=GREEN + (90,))
    d.rectangle([0, 0, W - 1, h - 1], outline=BRASS + (255,), width=3)
    d.text((90, 14), label, fill=GREEN + (255,))
    for (name, x, y, w, hh) in boxes:
        d.rounded_rectangle([x, y, x + w, y + hh], radius=18, outline=TOMATO + (255,), width=4); d.text((x + 12, y + 10), name, fill=TOMATO + (255,))
    b = io.BytesIO(); im.save(b, 'PNG'); return b.getvalue()

def items(boxes, h):
    return [{"id": n.lower().replace(' ', '_').replace('+', 'add').replace('−', 'minus'), "type": "box", "label": n, "x": round(x / W, 5), "y": round(y / h, 5), "w": round(w / W, 5), "h": round(hh / h, 5)} for (n, x, y, w, hh) in boxes]

BAR_TOP = 150; BAR_BOTTOM_1 = 150; BAR_BOTTOM_2 = 280
new = [
 ("page_11", "Scrolling Page Top Piece", "page_11_scroll_top", 260, dict(top=True), [],
  "NEW 2026-11. Shared by Recipe Detail, Cook Mode, Import Review and Grocery List. Decorative piece shown once at the very top of the scrolling content. Herbs or vines may fill the top band and the two side zones (70 px each); keep the centre plain parchment because recipe text starts right below it. No text in the artwork."),
 ("page_12", "Scrolling Page Repeating Side Strip", "page_12_scroll_tile", 400, dict(tile=True), [],
  "NEW 2026-11. Shared. This strip is repeated down the page for as long as the recipe needs, so its top edge must join its bottom edge without a visible seam. Decoration only in the two side zones (70 px each); the centre must be plain parchment (or transparent). It is never stretched."),
 ("page_13", "Scrolling Page Bottom Piece", "page_13_scroll_bottom", 300, dict(bottom=True), [],
  "NEW 2026-11. Shared. Decorative piece shown once, after the last line of content, wherever that falls. It closes the side borders. No text in the artwork."),
 ("page_14", "Recipe Detail Controls", "page_14_recipe_detail_controls", BAR_TOP + BAR_BOTTOM_2 + 40, {},
  [("Back", 20, 30, 110, 110), ("More options", 590, 30, 110, 110), ("Favorite", 715, 30, 110, 110),
   ("Fewer servings", 520, 205, 100, 100), ("Servings value", 630, 205, 90, 100), ("More servings", 730, 205, 100, 100), ("Cook Mode", 20, 330, 395, 120), ("Add to Grocery List", 426, 330, 395, 120)],
  "NEW 2026-11, replaces the fixed layout of page_04 (page_04 artwork is kept, not deleted, and no longer drawn). Two bars that stay on screen while the recipe scrolls: the top bar (rows 0-150: Back, More options, Favorite heart) and the bottom bar (rows 190-470: servings minus / value / plus, Cook Mode, Add to Grocery List). Supply each control as its own PSD layer (Cutout 1..7 in the order of the boxes) so it can glow and be tapped; the servings value is text drawn by the app. Button labels may be part of the button artwork."),
 ("page_15", "Cook Mode Controls", "page_15_cook_mode_controls", BAR_TOP + 120 + BAR_BOTTOM_1 + 60, {},
  [("Back", 20, 30, 110, 110), ("Step chip", 150, 30, 670, 110), ("Timer button", 20, 165, 330, 100), ("Previous Step", 20, 320, 395, 120), ("Next Step", 426, 320, 395, 120)],
  "NEW 2026-11, replaces the fixed layout of page_05. Top bar (Back; a plate behind the app-drawn text 'Step 2 of 8' and progress line; the timer button, shown only when a step has a timer, with the time drawn by the app beside it) and bottom bar (Previous Step, Next Step). Each control as its own PSD layer. Ingredients and all steps scroll between the bars and are drawn by the app; the current step gets a code-drawn highlight."),
 ("page_16", "Grocery List Controls", "page_16_grocery_list_controls", 500, {},
  [("Back", 20, 30, 110, 110), ("Week selector", 20, 165, 470, 100), ("From meal plan", 505, 165, 316, 100), ("Add Item", 20, 330, 395, 120), ("Clear checked", 426, 330, 395, 120)],
  "NEW 2026-11, replaces the fixed layout of page_09. Top bar (Back, the title 'Grocery List' may be part of the bar artwork, week selector plate with the dates drawn by the app, From meal plan basket) and bottom bar (Add Item, Clear checked). Each control as its own PSD layer. The list scrolls between the bars."),
 ("page_17", "Import Review Controls", "page_17_import_review_controls", 520, {},
  [("Back", 20, 30, 110, 110), ("Details", 640, 30, 181, 110), ("Add Ingredient", 20, 205, 260, 100), ("Add Direction", 290, 205, 260, 100), ("Add Category", 560, 205, 261, 100), ("Save Recipe", 20, 330, 801, 130)],
  "NEW 2026-11, replaces the fixed layout of page_07. Top bar (Back, Details) and bottom bar (Add Ingredient, Add Direction, Add Category, Save Recipe). Each control as its own PSD layer. Photo, title, source, ingredient rows, direction rows and categories scroll between the bars and are drawn by the app."),
 ("page_18", "Recipe Rescue", "page_18_recipe_rescue", 400, {}, [("Top bar background", 0, 40, 841, 150), ("Divider handle", 0, 230, 841, 44)],
  "NEW 2026-11. Working screen: the original on one side, the editable recipe on the other (side by side in landscape). It uses plain code-drawn panels on purpose. OPTIONAL artwork only: a top-bar background strip and the divider handle between the two panes. No artwork is required for this screen to be finished."),
 ("page_19", "Unfinished Recipes", "page_19_unfinished_recipes", 300, dict(top=True), [],
  "NEW 2026-11. Plain list page (like Settings). OPTIONAL: a header illustration. On Import Recipe (page_06) the app currently draws a small 'Unfinished (n)' chip at the top right; if you want an illustrated object for it, add it to page_06 as a new PSD layer and say where."),
]
os.makedirs(out_dir, exist_ok=True)
added = {}; pages = manifest['pages']; idx = len(pages)
sections = []
for (pid, name, folder, h, kind, boxes, notes) in new:
    path = f"pages/{folder}"
    png = sheet(h, f"{pid}  {name}  ({W} x {h} px)  PLACEHOLDER: replace this file", boxes, **kind)
    added[f"{path}/clean.png"] = png
    coords = {"schema": "app-visual-builder/coords@1", "page": pid, "image_size": {"width": W, "height": h}, "coordinate_space": "normalized_0_1", "items": items(boxes, h)}
    if boxes: added[f"{path}/coords.json"] = json.dumps(coords, indent=2).encode()
    pages.append({"id": pid, "index": idx, "name": name, "folder": path, "notes": notes,
        "slots": {"clean": {"path": f"{path}/clean.png", "display_name": f"{folder[8:]}_clean.png"}, "markup": [], "psd": None, "coords": ({"path": f"{path}/coords.json", "display_name": f"{folder[8:]}_coords.json"} if boxes else None), "other": []},
        "image_size": {"width": W, "height": h}, "items": items(boxes, h)})
    idx += 1
    sections.append(f"### {idx}. {name} (`{pid}`)\n\n**Notes:** {notes}\n\n- Clean: `{path}/clean.png` ({W} x {h} px placeholder, to be replaced)\n" + (f"- Coords: `{path}/coords.json`\n" if boxes else "") + "- PSD: add `layers.psd` with one layer per control box (not supplied yet)\n" if boxes else f"### {idx}. {name} (`{pid}`)\n\n**Notes:** {notes}\n\n- Clean: `{path}/clean.png` ({W} x {h} px placeholder, to be replaced)\n")
manifest['page_count'] = len(pages); manifest['exported_at'] = datetime.datetime.now().astimezone().isoformat()
manifest['template_note'] = "2026-11 functional update: pages page_01..page_10 are unchanged. page_11..page_19 are new template pages with placeholder images. See the README section 'Template update 2026-11'."
table = "\n".join(f"| {p['id']} | {p['name']} | {st} |" for p, st in zip(pages, ["unchanged, in use", "unchanged, in use", "unchanged, in use", "kept, no longer drawn: replaced by page_11-13 + page_14", "kept, no longer drawn: replaced by page_11-13 + page_15", "unchanged, in use (a code-drawn 'Unfinished' chip sits top right)", "kept, no longer drawn: replaced by page_11-13 + page_17", "unchanged, in use", "kept, no longer drawn: replaced by page_11-13 + page_16", "unchanged, in use"] + ["NEW: artwork needed" if i < 7 else "NEW: artwork optional" for i in range(len(new))]))
readme += f"""

---

## Template update 2026-11 (functional update: scrolling pages and Recipe Rescue)

Nothing in pages `page_01` to `page_10` was changed, renamed or removed. Four of those pages are no longer drawn by the app
because their fixed windows clipped long recipes; their files stay in this package for reference and reuse.

| ID | Name | Status |
|----|------|--------|
{table}

### How a scrolling screen is built

1. A top bar and a bottom bar stay on screen (the controls page for that screen: `page_14` to `page_17`).
2. Between them the content scrolls as one page: `page_11` (top piece) once, then the recipe drawn by the app over a parchment
   centre with `page_12` repeated down the sides, then `page_13` (bottom piece) once after the last line.
3. Ingredients, directions, checkboxes, timers and grocery rows are always drawn by the app. They are never placed by coordinates.

All new placeholders are {W} px wide, the same width as the existing pages, so existing brushes and textures match.
The red boxes on the controls placeholders are where each control sits; `coords.json` holds the same boxes as fractions of the image.

### Things to check in the visual builder (not verified by the developer)

- The existing package contains no coordinate items (`items` is empty on every page and there is no `coords.json`), so the
  item format used here (`type: box` with `x, y, w, h` as fractions, top-left origin, as described under Coordinate convention)
  is inferred from this README. If the builder writes a different shape, keep the builder's output: the app only needs boxes per control.
- The builder's naming is kept: page IDs continue from `page_11`, folders are `pages/page_NN_name`, slots are `clean`, `psd`, `coords`, `other_N`.
- If one shared set of scroll pieces is too plain, add screen-specific pieces as further pages and say which screen each belongs to.

### New and changed pages

""" + "\n".join(sections)
added['manifest.json'] = json.dumps(manifest, indent=4, ensure_ascii=False).encode(); added['README.md'] = readme.encode()
# delta folder + zip (only what is new or changed)
for name, data in added.items():
    p = os.path.join(out_dir, name); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'wb').write(data)
with zipfile.ZipFile(delta_zip, 'w', zipfile.ZIP_DEFLATED) as dz:
    for name, data in added.items(): dz.writestr(name, data)
# full package: every existing file byte for byte, manifest and README replaced, new pages added
with zipfile.ZipFile(full_zip, 'w', zipfile.ZIP_DEFLATED) as fz:
    for info in z.infolist():
        if info.filename in added: continue
        fz.writestr(info, z.read(info.filename), compress_type=zipfile.ZIP_STORED if info.filename.endswith(('.png', '.psd')) else zipfile.ZIP_DEFLATED)
    for name, data in added.items(): fz.writestr(name, data)
print(len(pages), 'pages;', len(added), 'new or changed files')
