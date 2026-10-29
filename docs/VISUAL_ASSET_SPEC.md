# Touch Recipe — Visual Asset and Mapping Spec

> Status: Visual direction confirmed; detailed production specifications remain open. Concept sheets are references, not shippable assets.

## Visual direction
- Modern food magazine/editorial layout.
- Keep food photography prominent; custom art frames and supports it rather than competing with it.
- Deep forest green and tomato-orange accents, warm light neutral surfaces, readable expressive headings and clear sans-serif body/UI type.
- Add tasteful ingredient/utensil illustrations and illustrated backgrounds/buttons in the crafted style used by Touch games.
- Avoid text baked into backgrounds where text should resize, localize, read aloud or remain editable.

## Owner art workflow
Matthew will use image generation for illustration concepts, then cut, label and map pieces through Pictureshop and Touch Toolkit. Claude implements against the provided mapped assets and this specification. Every visual must be replaceable without changing business logic.

## Kitchen Hub visual map
The Kitchen Hub is a full illustrated kitchen scene. It uses physical-looking objects as navigation areas rather than conventional button rows. See `docs/KITCHEN_HUB_INTERACTION_MAP.md`.

Required hub objects:
- Whole stove/oven appliance: Cook Mode or active recipe.
- Recipe Rolodex on the counter: recipe collection and magazine pages.
- Grocery bag sitting on the counter, with Italian bread and groceries sticking out: Grocery List. The entire bag/grocery grouping is tappable.
- Calendar: Meal Plan.
- Magnifying glass on a magnetic hook on the refrigerator door opposite the new-recipe note: Search.
- Refrigerator note/card reading “New Recipe,” with decorative handwriting beneath it: Import Recipe.
- One actual kitchen cabinet drawer used as the Kitchen Junk Drawer: Settings and utility area.

## Required independent artwork candidates
- `bg_kitchen_hub`: full illustrated kitchen scene.
- `bg_home`: home/recipe-library background treatment.
- `bg_recipe_detail`: recipe-detail framing or decorative edges (photo area remains dynamic).
- `bg_import_review`: import/review screen treatment.
- `bg_meal_planner`: planner background treatment.
- `btn_import_recipe`: separate illustrated Import Recipe control/background where needed outside the hub.
- `btn_save_recipe`: separate illustrated Save Recipe control/background.
- `btn_add_category`: separate illustrated Add Category control/background.
- `callout_grocery_list`: illustrated grocery-list box/callout.
- Additional candidates after flow review: cook-mode controls, grocery-list actions, category/empty-state illustrations, section dividers and icons.

## Mapping and implementation requirements
- Store a visual asset manifest with filename, intended screen, purpose, source dimensions, crop/scale rule, placement anchor, z-order, touch region, transparency, and revision.
- Keep hit targets as real accessible UI elements above/around art; decorative artwork must not intercept touches.
- Keep functional text (including button labels), semantics, dynamic counts and accessibility descriptions in app UI rather than flattened into raster art. The “New Recipe” label remains editable/accessible text even when visually part of the refrigerator card.
- Preserve photo aspect ratio and allow user-provided recipe photos to replace placeholders.
- Provide density/scaling guidance and safe-area behavior for 720x1600 portrait references; adapt responsively to device size and font scaling.
- Include tap-target overlays or a mapping sheet so the owner can verify cut pieces align with controls.
- Use generous touch regions around complete objects, not only tiny visible details such as a handle or icon.

## First-load guidance effect
- Briefly illuminate tappable objects when a page first loads, as approved.
- On the Kitchen Hub, illuminate each navigational object: rolodex, stove/oven, grocery bag, calendar, magnifying glass and junk drawer/refrigerator note.
- Must be clear but brief, avoid competing animations, respect reduced motion and not cover or block controls.
- Define duration, whether it runs once per app/page/session, and replay option in product decisions before coding.
- Functional accessibility focus and semantic labels remain available even when the light effect is not visible.

## Asset folder handoff structure (proposed)
```
Touch-Recipe-Visual-Assets/
  README_ASSET_MAP.md
  manifest.csv
  backgrounds/
  buttons/
  callouts/
  illustrations/
  icons/
  references/
```

## Pending
- Final screen inventory and annotated flow.
- Exact resolution, transparent PNG vs layered formats, naming, crop rules and 9-patch/slice strategy.
- Day/night themes, custom photography behavior and any mascot/brand art.
