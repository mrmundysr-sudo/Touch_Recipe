// Ports of EnginesTest / QuantityTest / NamedTimersTest from the Android app: same cases, same expectations.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../www/js/engine/quantity.js';
import * as G from '../www/js/engine/grocery.js';
import * as Cat from '../www/js/engine/categories.js';
import * as T from '../www/js/engine/timer.js';
import * as P from '../www/js/engine/planner.js';
import * as Conv from '../www/js/engine/convert.js';
import { Recipe, Ingredient, GroceryItem } from '../www/js/engine/models.js';
import { filter, Sort } from '../www/js/engine/search.js';

const recipe = (id, servings, ...lines) => Recipe({ id, title: `R${id}`, servings, ingredients: lines.map((text) => Ingredient({ text })) });

test('quantity: scales simple amounts', () => {
  assert.equal(Q.scale('1 cup flour', 2), '2 cups flour');
  assert.equal(Q.scale('1 cup flour', 0.5), '1/2 cup flour');
  assert.equal(Q.scale('2 tbsp butter', 2), '4 tbsp butter');
  assert.equal(Q.scale('2 cloves garlic', 0.5), '1 clove garlic');
  assert.equal(Q.scale('2 eggs', 1.5), '3 eggs');
  assert.equal(Q.scale('1 tsp salt', 0.5), '1/2 tsp salt');
});
test('quantity: mixed and unicode fractions', () => {
  assert.equal(Q.scale('1 1/2 cups milk', 2), '3 cups milk');
  assert.equal(Q.scale('½ cup sugar', 2), '1 cup sugar');
  assert.equal(Q.scale('1½ cups rice', 2), '3 cups rice');
});
test('quantity: ranges', () => {
  assert.equal(Q.scale('2-3 cloves garlic', 2), '4-6 cloves garlic');
  assert.equal(Q.scale('2 to 3 cloves garlic', 2), '4-6 cloves garlic');
});
test('quantity: text amounts are left alone', () => {
  assert.equal(Q.scale('salt to taste', 3), 'salt to taste');
  assert.equal(Q.scale('a pinch of nutmeg', 3), 'a pinch of nutmeg');
  assert.equal(Q.scale('Salt and pepper', 2), 'Salt and pepper');
});
test('quantity: only the leading amount scales', () => {
  assert.equal(Q.scale('1 (14 oz) cans tomatoes', 2), '2 (14 oz) cans tomatoes');
  assert.equal(Q.scale('2 chicken thighs, cooked at 350F', 2), '4 chicken thighs, cooked at 350F');
});
test('quantity: bad factors never corrupt', () => {
  assert.equal(Q.scale('1 cup flour', 0), '1 cup flour');
  assert.equal(Q.scale('1 cup flour', NaN), '1 cup flour');
});
test('quantity: formatting and servings factor', () => {
  assert.equal(Q.format(1 / 3), '1/3'); assert.equal(Q.format(2 / 3), '2/3'); assert.equal(Q.format(1.25), '1 1/4'); assert.equal(Q.format(12), '12');
  assert.ok(Math.abs(Q.factor(4, 8) - 2) < 1e-4); assert.equal(Q.factor(null, 8), 1);
});
test('quantity: decimal comma and malformed', () => {
  assert.equal(Q.scale('1,5 dl milk', 2), '3 dl milk');
  assert.equal(Q.scale('2x4 board', 2), '2x4 board');
});

test('grocery: merges same unit and different unit spelling', () => {
  const items = G.generate([
    { recipe: recipe('1', 4, '1 cup flour', '2 cloves garlic, minced', '1 large onion, diced'), servings: 4 },
    { recipe: recipe('2', 2, '8 tbsp flour', '3 cloves garlic', '2 onions'), servings: 4 },
  ]);
  assert.equal(items.find((i) => i.name.startsWith('Flour')).quantity !== undefined, true);
  assert.equal(G.quantityText(items.find((i) => i.name.startsWith('Flour'))), '2 cups');
  const garlic = items.find((i) => i.name.startsWith('Garlic')); assert.equal(garlic.sources.length, 2);
  const onion = items.find((i) => i.name.startsWith('Onion')); assert.equal(G.quantityText(onion), '5');
  assert.deepEqual(new Set(onion.sources.map((s) => s.recipeId)), new Set(['1', '2']));
});
test('grocery: scales to planned servings', () => {
  const items = G.generate([{ recipe: recipe('1', 2, '1 cup rice', 'salt to taste'), servings: 6 }]);
  assert.equal(G.quantityText(items.find((i) => i.name === 'Rice')), '3 cups');
  assert.equal(G.quantityText(items.find((i) => i.name.startsWith('Salt'))), '');
});
test('grocery: different families stay separate', () => {
  assert.equal(G.generate([{ recipe: recipe('1', null, '1 cup milk', '200 ml milk', '1 lb beef', '500 g beef'), servings: null }]).length, 4);
});
test('grocery: aisles and headers', () => {
  assert.equal(G.aisleFor(G.normalizeKey('boneless chicken breasts')), G.AISLE_MEAT);
  assert.equal(G.aisleFor('eggs'), G.AISLE_DAIRY); assert.equal(G.aisleFor('tomatoes'), G.AISLE_PRODUCE);
  assert.equal(G.aisleFor('baguette'), G.AISLE_BAKERY); assert.equal(G.aisleFor('tomato paste'), G.AISLE_PANTRY);
  const r = Recipe({ ingredients: [Ingredient({ text: 'Sauce', header: true }), Ingredient({ text: '1 onion' })] });
  assert.equal(G.generate([{ recipe: r, servings: null }]).length, 1);
});
test('grocery: merge preserves purchased and edited, custom items, history', () => {
  const gen = G.generate([{ recipe: recipe('1', null, '2 onions', '1 lb beef'), servings: null }]);
  const first = G.merge('2026-01-05', [], gen);
  const marked = first.map((i) => (i.name === 'Onions' ? { ...i, checked: true } : i.name === 'Beef' ? { ...i, edited: true, quantityText: '3 lb' } : i));
  const custom = [...marked, GroceryItem({ weekStart: '2026-01-05', name: 'Paper towels', aisle: G.AISLE_PANTRY })];
  const regen = G.generate([{ recipe: recipe('1', null, '4 onions', '1 lb beef'), servings: null }]);
  const merged = G.merge('2026-01-05', custom, regen);
  assert.ok(merged.find((i) => i.name === 'Onions').checked);
  assert.equal(merged.find((i) => i.name === 'Beef').quantityText, '3 lb');
  assert.ok(merged.some((i) => i.name === 'Paper towels')); assert.equal(merged.length, 3);
  const none = G.merge('2026-01-05', merged, []);
  assert.deepEqual(new Set(none.map((i) => i.name)), new Set(['Onions', 'Beef', 'Paper towels']));
});
test('grocery: international units and malformed quantities never crash', () => {
  ['250 ml Milch', '1 ½ Tassen Mehl', '2–3 EL Öl', '1/0 cup broken', '½-¾ tsp salt', '', '   ', 'a handful of kale', '3 (400 g) tins tomatoes', '1,5 dl cream', '1 1/2 cups', '99999999999 cups'].forEach((l) => { assert.ok(G.parse(l)); assert.ok(typeof Q.scale(l, 2) === 'string'); });
  assert.equal(Q.scale('250 ml Milch', 2), '500 ml Milch'); assert.equal(Q.scale('a handful of kale', 2), 'a handful of kale'); assert.equal(Q.scale('1/0 cup broken', 2), '1/0 cup broken');
});
test('grocery: duplicate ingredients across sections merge', () => {
  const r = Recipe({ ingredients: [Ingredient({ text: '1 cup sugar' }), Ingredient({ text: 'For the glaze', header: true }), Ingredient({ text: '1/2 cup sugar' }), Ingredient({ text: 'Sugar, to taste' })] });
  const items = G.generate([{ recipe: r, servings: null }]);
  assert.ok(items.some((i) => G.quantityText(i) === '1 1/2 cups'), items.map((i) => i.name + '=' + G.quantityText(i)).join());
  assert.equal(items.length, 2);
});

test('categories: rules', () => {
  const seed = Cat.seed();
  assert.equal(seed.filter((c) => c.enabled).length, Cat.starter.length);
  assert.equal(Cat.validateNew('  ', seed).ok, false); assert.equal(Cat.validateNew('dinner', seed).ok, false);
  assert.deepEqual(Cat.validateNew("  Grandma's   Pies ", seed), { ok: true, name: "Grandma's Pies" });
  let cats = seed;
  for (let i = 0; i < Cat.MAX_CUSTOM_CATEGORIES; i++) { const r = Cat.validateNew(`Custom ${i}`, cats); assert.ok(r.ok); cats = [...cats, { id: `c_${i}`, name: r.name, group: 'Custom', builtIn: false, enabled: true, sortOrder: 1000 + i }]; }
  const over = Cat.validateNew('One too many', cats); assert.ok(!over.ok && over.reason.includes('50'));
  assert.equal(Cat.validateNew('custom 3', cats).ok, false); assert.equal(Cat.validateRename('c_1', 'Custom 2', cats).ok, false); assert.equal(Cat.validateRename('c_1', 'Custom 1', cats).ok, true);
});

test('timer: survives pause and restart', () => {
  let t = T.withDuration(60);
  assert.ok(T.timerConfigured(t) && !T.timerRunning(t));
  t = T.start(t, 1000); assert.equal(T.remaining(t, 31000), 30000);
  t = T.pause(t, 31000); assert.equal(T.remaining(t, 500000), 30000);
  t = T.start(t, 500000); assert.equal(T.remaining(t, 520000), 10000); assert.ok(T.finished(t, 560001)); assert.equal(T.remaining(t, 900000), 0);
  t = T.reset(t); assert.equal(T.remaining(t, 0), 60000); assert.ok(!T.timerRunning(t));
  assert.equal(T.formatMs(65000), '01:05'); assert.equal(T.formatMs(3665000), '1:01:05');
  assert.ok(!T.timerConfigured(T.withDuration(null))); assert.ok(!T.timerRunning(T.start(T.CookTimer(), 0)));
});
test('named timers: independent, persisted, settle, cap', () => {
  let l = T.addTimer([], 'Biscuits', 12, 1000); l = T.addTimer(l, '', 5, 1000);
  assert.deepEqual(l.map((x) => x.name), ['Biscuits', 'Timer 1']);
  const back = T.decodeTimers(T.encodeTimers(l)); assert.deepEqual(back, l);
  assert.equal(T.remaining(T.namedTimerClock(back[0]), 61000), 12 * 60000 - 60000);
  const l2 = T.addTimer(T.addTimer([], 'Short', 1, 0), 'Long', 30, 0);
  const [settled, finished] = T.settle(l2, 61000);
  assert.deepEqual(finished.map((x) => x.name), ['Short']); assert.equal(settled[0].remainingMs, 0); assert.equal(settled[0].endAtMs, null); assert.notEqual(settled[1].endAtMs, null);
  let big = []; for (let i = 0; i < T.MAX_TIMERS + 3; i++) big = T.addTimer(big, `T${i}`, 1, 0);
  assert.equal(big.length, T.MAX_TIMERS); assert.deepEqual(T.addTimer(big, 'x', 0, 0), big); assert.deepEqual(T.decodeTimers('not json'), []);
});

test('planner: weeks and labels', () => {
  const ws = P.weekStart('2026-10-30'); assert.equal(ws, '2026-10-26');
  assert.equal(P.days(ws).length, 7); assert.equal(P.days(ws).at(-1), '2026-11-01');
  assert.equal(P.weekStart('2026-10-30', 0), '2026-10-25');
  assert.equal(P.rangeLabel('2026-11-02'), 'Nov 2 – Nov 8'); assert.equal(P.rangeLabel('2026-12-28'), 'Dec 28, 2026 – Jan 3, 2027');
  assert.equal(P.dayLabel('2026-11-04'), 'Wednesday'); assert.equal(P.addDays('2026-03-07', 1), '2026-03-08');
});

test('converter: volume, weight and temperature', () => {
  assert.ok(Math.abs(Conv.convert(Conv.Kind.VOLUME, 1, 'cup', 'ml') - 236.588) < 0.01);
  assert.ok(Math.abs(Conv.convert(Conv.Kind.WEIGHT, 1, 'lb', 'g') - 453.592) < 0.01);
  assert.equal(Math.round(Conv.convert(Conv.Kind.TEMPERATURE, 350, '°F', '°C')), 177);
  assert.equal(Conv.convert(Conv.Kind.TEMPERATURE, 4, 'Gas mark', '°F'), 350);
});

test('search: every word must match; sort orders', () => {
  const cats = [{ id: 'c1', name: 'Dinner' }];
  const rs = [Recipe({ id: 'a', title: 'Zesty Pasta', ingredients: [Ingredient({ text: '1 lemon' })], categoryIds: ['c1'], createdAt: 1, cookMinutes: 30 }), Recipe({ id: 'b', title: 'Apple Pie', createdAt: 2, favorite: true, prepMinutes: 5 })];
  assert.deepEqual(filter(rs, cats, 'lemon dinner', null, false, Sort.TITLE).map((r) => r.id), ['a']);
  assert.deepEqual(filter(rs, cats, '', null, false, Sort.TITLE).map((r) => r.id), ['b', 'a']);
  assert.deepEqual(filter(rs, cats, '', null, false, Sort.RECENT).map((r) => r.id), ['b', 'a']);
  assert.deepEqual(filter(rs, cats, '', null, false, Sort.QUICKEST).map((r) => r.id), ['b', 'a']);
  assert.deepEqual(filter(rs, cats, '', null, true, Sort.TITLE).map((r) => r.id), ['b']);
});
