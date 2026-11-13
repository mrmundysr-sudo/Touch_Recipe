// Regression coverage for: time fields (prep 15 / cook 40 / total 55), grocery ingredient parsing and unit display, and the zoom/pan maths.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../www/js/engine/textparser.js';
import * as G from '../www/js/engine/grocery.js';
import * as PZ from '../www/js/ui/panzoom.js';

const body = '\nIngredients\n1 29oz can of Veg-All mixed vegetables, drained\n1 box of refrigerated pie crusts\n1/3 cup of butter\n\nInstructions\n1. Preheat oven to 425°F.\n2. In a saucepan, cook onion in melted butter over medium heat.\n3. Stir in flour, salt & pepper.\n';
const times = (r) => [r.prepMinutes, r.cookMinutes, r.totalMinutes];

test('PDF layout: Course / Prep / Cook on one line, Total / Servings on the next', () => {
  const r = T.parse('Veg-All Pot Pie\nCourse Main Course Prep Time 15 mins Cook Time 40 mins\nTotal Time 55 mins Servings 6' + body).recipe;
  assert.deepEqual(times(r), [15, 40, 55]);
  assert.equal(r.course, 'Main Course'); assert.equal(r.servings, 6);
  assert.equal(r.description, '', 'the details line is not left behind as a description');
});
test('times without colons, on one line or on separate lines', () => {
  for (const head of ['Prep Time 15 mins Cook Time 40 mins Total Time 55 mins', 'Prep Time 15 mins\nCook Time 40 mins\nTotal Time 55 mins', 'Prep: 15 min  Cook: 40 min  Total: 55 min']) {
    assert.deepEqual(times(T.parse('Pot Pie\n' + head + body).recipe), [15, 40, 55], head);
  }
});
test('total is never copied into cook, and cook is not invented', () => {
  const r = T.parse('Pot Pie\nTotal Time 55 mins' + body).recipe;
  assert.deepEqual(times(r), [null, null, 55]);
});

test('grocery: a container size is not a quantity', () => {
  const p = G.parse('29oz can of Veg-All');
  assert.equal(p.quantity, 1); assert.equal(p.unitText, 'can'); assert.match(p.name, /^Veg-All \(29 oz\)$/); assert.equal(p.unit, null);
  const q = G.parse('1 (29 oz) can Veg-All mixed vegetables, drained');
  assert.equal(q.quantity, 1); assert.equal(q.unitText, 'can'); assert.match(q.name, /Veg-All/);
  assert.equal(G.normalizeKey(p.name), 'veg all');
});
test('grocery: amounts stay paired with their own names', () => {
  const r = { id: 'r', title: 'Pie', servings: 4, ingredients: ['1/3 cup all-purpose flour', '1/3 cup butter', '1 1/2 cups chicken broth', '29oz can of Veg-All', '2 refrigerated pie crusts'].map((text) => ({ text })) };
  const got = Object.fromEntries(G.generate([{ recipe: r, servings: 4 }]).map((g) => [g.name, G.quantityText(g)]));
  assert.deepEqual(got, { 'All-purpose flour': '1/3 cup', Butter: '1/3 cup', 'Chicken broth': '1 1/2 cups', 'Veg-All': '1 can', 'Refrigerated pie crusts': '2' });
});
test('grocery: tablespoon totals roll up to a readable cup amount, merged per ingredient only', () => {
  const r = { id: 'r', title: 'Pie', servings: 4, ingredients: ['1/4 cup flour', '1/4 cup flour', '2 tbsp flour', '5 1/3 tbsp butter', '3 tbsp sugar'].map((text) => ({ text })) };
  const got = Object.fromEntries(G.generate([{ recipe: r, servings: 4 }]).map((g) => [g.name, G.quantityText(g)]));
  assert.deepEqual(got, { Flour: '5/8 cup', Butter: '1/3 cup', Sugar: '3 tbsp' });
});
test('grocery: two recipes do not leak into each other', () => {
  const a = { id: 'a', title: 'A', servings: 2, ingredients: [{ text: '1 cup milk' }] }, b = { id: 'b', title: 'B', servings: 2, ingredients: [{ text: '2 eggs' }] };
  const only = G.generate([{ recipe: a, servings: 2 }]);
  assert.deepEqual(only.map((g) => g.name), ['Milk']); assert.deepEqual(only[0].sources.map((s) => s.recipeId), ['a']);
  assert.equal(G.generate([{ recipe: a, servings: 2 }, { recipe: b, servings: 2 }]).length, 2);
});

test('zoom maths: independent views, clamped to the pane, zoom keeps the point under the fingers', () => {
  const size = [300, 400, 300, 1000];
  let a = PZ.fit(), b = PZ.fit();
  a = PZ.zoomAt(a, 2, 150, 200, ...size);
  assert.equal(a.s, 2); assert.ok(PZ.isFit(b), 'zooming one side leaves the other at fit');
  assert.equal(PZ.zoomAt(PZ.fit(), 10, 0, 0, ...size).s, PZ.MAX_SCALE);
  assert.equal(PZ.zoomAt(a, 0.1, 150, 200, ...size).s, 1, 'cannot zoom out past fit');
  const pt = (v, px, py) => [(px - v.x) / v.s, (py - v.y) / v.s];
  assert.deepEqual(pt(a, 150, 200).map(Math.round), [150, 200]);
  const far = PZ.panBy(a, -9999, -9999, ...size); assert.deepEqual([far.x, far.y], [300 - 600, 400 - 2000]);
  const back = PZ.panBy(a, 9999, 9999, ...size); assert.deepEqual([back.x, back.y], [0, 0]);
  assert.equal(PZ.cssTransform(PZ.fit()), ''); assert.equal(PZ.percent(a), '200%');
});
