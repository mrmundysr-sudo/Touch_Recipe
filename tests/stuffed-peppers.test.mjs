// Regression: "Classic Beef-Stuffed Peppers" imported with 1 ingredient and 18 directions. Under "Ingredients" only the first line has a unit word;
// "4 medium red, yellow or green bell peppers" (quantity, no unit) was taken for the start of the method, and everything after it became a step.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../www/js/engine/textparser.js';

const ING = ['1 pound Ground Beef (93% lean or leaner)', '4 medium red, yellow or green bell peppers', '1/2 cup minced onion', '2 teaspoons minced garlic',
  '1 can (14-1/2 ounces) diced tomatoes with green peppers and onions, drained', '1/2 cup cooked rice', '3 tablespoons tomato paste', '2 teaspoons dried parsley',
  '1/2 teaspoon salt', '1/4 teaspoon pepper', 'Chopped fresh parsley, optional'];
const STEPS = ['Coat a large baking dish with cooking spray and set it aside. Preheat the oven to 475°F.',
  'Cut the tops off the peppers and remove the seeds. Arrange them in the dish, cover tightly and bake 15 minutes.',
  'Cook the beef with the onion and garlic for 3 to 4 minutes, breaking it into small crumbles, then stir in the tomatoes, rice and seasonings.',
  'Fill the peppers with the mixture, replace the tops and bake 17 to 22 minutes until the beef reaches 160°F.'];
const TIP = 'Cooking Tip: Cooking times are for fresh or thoroughly thawed ground beef.';

const shapes = {
  'bulleted list, numbered "Cooking:" steps': ['Classic Beef-Stuffed Peppers', '45 min 4 SERVINGS', 'Ingredients:', ...ING.map((l) => `• ${l}`), 'Cooking:', ...STEPS.map((s, i) => `${i + 1}. ${s}`), TIP],
  'checkbox glyph lines': ['Classic Beef-Stuffed Peppers', 'Ingredients:', ...ING.flatMap((l) => ['☐', l]), 'Directions:', ...STEPS, TIP],
  'no directions heading at all': ['Classic Beef-Stuffed Peppers', 'Ingredients:', ...ING.map((l) => `• ${l}`), ...STEPS],
  'plain lines, Instructions heading': ['Classic Beef-Stuffed Peppers', 'Ingredients', ...ING, 'Instructions', ...STEPS],
};
for (const [name, lines] of Object.entries(shapes)) {
  test(`peppers: ${name}`, () => {
    const d = T.parse(lines.join('\n'));
    const r = d.recipe;
    assert.deepEqual(r.ingredients.map((i) => i.text), ING, 'all 11 ingredients, in order, none cut or merged');
    assert.equal(r.directions.length, 4, 'four real steps');
    assert.ok(r.directions.every((s) => !/^\d/.test(s.text) || /minutes|°F/.test(s.text)), 'no ingredient line is stored as a direction');
    assert.ok(!r.directions.some((s) => ING.includes(s.text)));
    assert.ok(!d.warnings.some((w) => /Only one ingredient/.test(w.message)), 'no "only one ingredient" warning');
    assert.ok(!r.directions.some((s) => /^Cooking Tip/.test(s.text)), 'the tip is not a step');
  });
}
test('peppers: the tip is kept as a note', () => {
  assert.match(T.parse(shapes['bulleted list, numbered "Cooking:" steps'].join('\n')).recipe.notes, /Cooking Tip: Cooking times are for fresh/);
});
test('a mis-split recipe is flagged with the exact lines to move', async () => {
  const { validate } = await import('../www/js/engine/validator.js');
  const { Recipe, Ingredient, Direction } = await import('../www/js/engine/models.js');
  const r = Recipe({ title: 'x', ingredients: [Ingredient({ text: '1 pound Ground Beef' })], directions: [...ING.slice(1, 4), STEPS[0]].map((t) => Direction({ text: t })) });
  const w = validate({ recipe: r, warnings: [], unplaced: [] }).warnings.find((x) => /look like ingredients/.test(x.message));
  assert.ok(w && /first 3 directions/.test(w.message) && /4 medium red/.test(w.message), w?.message);
});
test('quantity lines with no unit word stay ingredients', () => {
  const d = T.parse(['Egg Dish', 'Ingredients', '6 large eggs', '2 ripe avocados, halved', '3 green onions, thinly sliced', 'Directions', 'Whisk the eggs well and cook them in a hot pan until just set, about 3 minutes.'].join('\n')).recipe;
  assert.equal(d.ingredients.length, 3); assert.equal(d.directions.length, 1);
});
