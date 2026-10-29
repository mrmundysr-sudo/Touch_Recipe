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

## Required independent artwork candidates
- `bg_home`: home/recipe-library background treatment.
- `bg_recipe_detail`: recipe-detail framing or decorative edges (photo area remains dynamic).
- `bg_import_review`: import/review screen treatment.
- `bg_meal_planner`: planner background treatment.
- `btn_import_recipe`: separate illustrated Import Recipe control/background.
- `btn_save_recipe`: separate illustrated Save Recipe control/background.
- `btn_add_category`: separate illustrated Add Category control/background, shown in the category picker and expandable category chooser.
- `callout_grocery_list`: illustrated grocery-list box/callout.
- Additional candidates after flow review: cook-mode controls, grocery-list actions, category/empty-state illustrations, section dividers and icons.

These are starting asset IDs only. Final folder names and grouping will be settled with the screen map.

## Mapping and implementation requirements
- Store a visual asset manifest with filename, intended screen, purpose, source dimensions, crop/scale rule, placement anchor, z-order, touch region, transparency, and revision.
- Keep hit targets as real accessible UI elements above/around art; decorative artwork must not intercept touches.
- Keep functional text (including button labels), semantics, dynamic counts and accessibility descriptions in app UI rather than flattened into raster art. The “Add Category” label should remain editable app text.
- Preserve photo aspect ratio and allow user-provided recipe photos to replace placeholders.
- Provide density/scaling guidance and safe-area behavior for 720x1600 portrait references; adapt responsively to device size and font scaling.
- Include tap-target overlays or a mapping sheet so the owner can verify cut pieces align with controls.

## First-load guidance effect
- Briefly illuminate tappable controls when a page first loads, as approved.
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
