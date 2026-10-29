# Touch Recipe — Kitchen Hub Interaction Map

The Kitchen Hub is the app's illustrated home scene. It is the navigation equivalent of the desk hub used in Touch Find-a-Word, while keeping Touch Recipe's own modern food-magazine visual identity.

## Interactive objects

| Kitchen object | Opens | Interaction |
|---|---|---|
| Recipe Rolodex on the counter | Recipe collection and magazine-style recipe pages | Entire rolodex is tappable |
| Stove/oven appliance | Cook Mode or the currently active recipe | Entire appliance is tappable |
| Grocery bag on the counter, with Italian bread and groceries visible | Grocery List | Entire bag and visible grocery contents share one generous touch area |
| Calendar | Meal Plan | Entire calendar is tappable |
| Magnifying glass on a magnetic hook on the opposite refrigerator door | Search | Entire magnifying glass/hook area is tappable |
| Refrigerator note/card reading “New Recipe” with decorative handwriting below | Import Recipe | Entire card and magnet area are tappable |
| Kitchen cabinet junk drawer | Settings and utility area | Entire drawer front/handle area is tappable |

## Interaction behavior

- On first load of the Kitchen Hub, each interactive object briefly illuminates so the user can discover the map.
- The illumination fades before normal use and must not block touches.
- Objects should look naturally placed in the illustration, not like conventional UI buttons.
- Use generous touch regions around the full object, including the bag and groceries.
- Keep functional hit targets, semantic labels and accessibility actions separate from the raster artwork.
- The visual asset manifest must record each object's filename, bounds, anchor, z-order, touch region and revision.
- The Kitchen Hub may later include additional objects, but new navigation should remain discoverable and consistent.

## Design relationship

- Kitchen Hub: memorable illustrated navigation and exploration.
- Recipe Magazine: focused recipe collection, detail and cooking experience.
- The hub's objects should lead into the corresponding magazine-style pages without changing the user's data or losing their place.
