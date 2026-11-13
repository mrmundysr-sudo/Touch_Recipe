// Port of ImportRepairTest.kt: one test per failure found in the 2026-11 import audit
// (docs/knowledge/reports/2026-11-11-import-audit-and-update-plan.md). Every page is written for the test; it reproduces the shape of a
// real failure, not a real site's content. The same cases run on Android (Kotlin) and iOS (JavaScript).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import * as Web from '../www/js/engine/webextract.js';
import * as Text from '../www/js/engine/textparser.js';
import * as Layout from '../www/js/engine/layout.js';
import { Confidence, Severity } from '../www/js/engine/models.js';

Web.setHtmlParser((html) => parseHTML(/<html[\s>]/i.test(html) ? html : `<html><head></head><body>${html}</body></html>`).document);

const ld = (body) => `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Recipe","name":"Test Stew",${body}</script>`.replace(/<\/script>$/, '}</script>');
const page = (head, body) => `<html><head><title>Test Stew - Site</title>${head}</head><body>${body}</body></html>`;
const x = (html) => Web.extract(html, 'https://www.example.com/stew');
const loud = (d) => d.warnings.filter((w) => w.severity !== Severity.INFO);
const ing = (d) => d.recipe.ingredients.filter((i) => !i.header).map((i) => i.text);
const steps = (d) => d.recipe.directions.filter((i) => !i.header).map((i) => i.text);
const fifteen = Array.from({ length: 15 }, (_, i) => `${i + 1} cups ingredient number ${i + 1}`);
const q = (a) => a.map((s) => JSON.stringify(s)).join(',');
const twoSteps = '"recipeInstructions":[{"@type":"HowToStep","text":"Brown the meat well in a heavy pot over medium heat."},{"@type":"HowToStep","text":"Add everything else and simmer gently for 2 hours."}]';
const wprm = (lines) => '<div class="wprm-recipe-ingredients-container"><ul>' + lines.map((l) => { const p = l.split(' '); const rest = p.slice(2).join(' '); return `<li class="wprm-recipe-ingredient"><span class="wprm-recipe-ingredient-amount">${p[0]}</span><span class="wprm-recipe-ingredient-unit">${p[1]}</span><span class="wprm-recipe-ingredient-name">${rest}</span></li>`; }).join('') + '</ul></div>';

// ---- R3: the data block is trusted although it is partial ----
test('data block with 8 of 15 ingredients is completed from the recipe card', () => {
  const d = x(page(ld(`"recipeIngredient":[${q(fifteen.slice(0, 8))}],${twoSteps}`), wprm(fifteen)));
  assert.equal(ing(d).length, 15, 'all 15 ingredients on the page are imported, not the 8 in the data block');
  assert.equal(ing(d)[0], '1 cups ingredient number 1');
  assert.notEqual(d.confidence, Confidence.HIGH);
  assert.ok(d.warnings.some((w) => w.field === 'ingredients' && w.message.includes('15')));
});
test('a shortfall against an untrusted list is reported and the lines are kept', () => {
  const d = x(page(ld(`"recipeIngredient":[${q(fifteen.slice(0, 8))}],${twoSteps}`), `<ul>${fifteen.map((l) => `<li>${l}</li>`).join('')}</ul>`));
  assert.equal(ing(d).length, 8);
  assert.ok(loud(d).some((w) => w.field === 'ingredients' && w.message.includes('15') && w.message.includes('8')));
  assert.equal(d.unplaced.length, 7);
  assert.notEqual(d.confidence, Confidence.HIGH);
});
test('amounts missing from the data block are restored from the page', () => {
  const names = ['olive oil', 'butter', 'popping corn', 'sea salt', 'smoked paprika'];
  const shown = ['2 tbsp olive oil', '2 tbsp butter', '1/3 cup popping corn', '1 tsp sea salt', '1/2 tsp smoked paprika'];
  const d = x(page(ld(`"recipeIngredient":[${q(names)}],${twoSteps}`), `<div class="recipe-ingredients"><ul>${shown.map((l) => `<li>${l}</li>`).join('')}</ul></div>`));
  assert.deepEqual(ing(d), shown);
});
test('ingredients with no amounts anywhere are flagged', () => {
  const d = x(page(ld(`"recipeIngredient":["flour","butter","sugar","eggs","milk","salt"],${twoSteps}`), ''));
  assert.ok(loud(d).some((w) => w.field === 'ingredients' && w.message.includes('amount')));
});
test('an empty data block is filled from the recipe card', () => {
  const card = wprm(fifteen.slice(0, 4)) + '<div class="wprm-recipe-instructions-container"><ul><li class="wprm-recipe-instruction"><div class="wprm-recipe-instruction-text">Brown the meat well in a heavy pot.</div></li><li class="wprm-recipe-instruction"><div class="wprm-recipe-instruction-text">Simmer gently for 2 hours.</div></li></ul></div>';
  const d = x(page(ld('"recipeIngredient":[],"recipeInstructions":[]'), card));
  assert.equal(ing(d).length, 4); assert.equal(steps(d).length, 2); assert.equal(d.recipe.directions.at(-1).timerSeconds, 7200);
  assert.notEqual(d.confidence, Confidence.HIGH);
});
test('a whole ingredient list in one string is split', () => {
  const d = x(page(ld(String.raw`"recipeIngredient":["1/4 cup lemon juice\n1/2 cup olive oil\nKosher salt and pepper"],` + twoSteps), ''));
  assert.deepEqual(ing(d), ['1/4 cup lemon juice', '1/2 cup olive oil', 'Kosher salt and pepper']);
});
test('ingredients run together without breaks are split or flagged', () => {
  const d = x(page(ld(`"recipeIngredient":"3 tablespoons red pepper powder 2 tablespoons sesame oil 2 cups chopped onion 3 cloves garlic 1 cup silken tofu 2 cups water 2 tsp fish sauce",${twoSteps}`), ''));
  assert.ok(ing(d).length >= 6, 'several measured ingredients in one line are split');
  const glued = x(page(ld(`"recipeIngredient":"3 tablespoons red pepper powder2 tablespoons sesame oil2 cups chopped onion3 cloves garlic1 cup silken tofu2 cups water2 tsp fish sauce1 lb pork",${twoSteps}`), ''));
  assert.ok(ing(glued).length > 1 || loud(glued).some((w) => w.field === 'ingredients'));
});
test('only one ingredient is never accepted quietly', () => {
  const d = x(page(ld(`"recipeIngredient":["Chicken"],${twoSteps}`), '<div class="ingredients-list"><ul><li>150ml red wine</li><li>100g tomato paste</li><li>3 sprigs of thyme</li><li>1 whole chicken</li></ul></div>'));
  assert.equal(ing(d).length, 4, 'the list on the page replaces the keyword in the data block');
  const alone = x(page(ld(`"recipeIngredient":["Chicken"],${twoSteps}`), ''));
  assert.ok(loud(alone).some((w) => w.field === 'ingredients'));
});
test('double-escaped text is decoded', () => {
  const d = x(page(ld('"recipeIngredient":["280 g L&amp;ouml;ffelbiskuit","2 eggs"],"recipeInstructions":[{"@type":"HowToStep","text":"&lt;p&gt;Heat the oil in a large saucepan.&lt;/p&gt;"},{"@type":"HowToStep","text":"Serve warm with the biscuits."}]'), ''));
  assert.equal(ing(d)[0], '280 g Löffelbiskuit'); assert.equal(steps(d)[0], 'Heat the oil in a large saucepan.');
});
test('one step holding several paragraphs becomes several steps', () => {
  const d = x(page(ld('"recipeIngredient":["2 cups flour","1 egg"],"recipeInstructions":[{"@type":"HowToStep","text":"<p>Mix the flour and the egg.</p><p>Rest the dough for 30 minutes.</p><p>Roll it out thinly.</p>"}]'), ''));
  assert.equal(steps(d).length, 3);
});
test('step titles in the data block are replaced by the full directions on the page', () => {
  const body = '<div class="recipe-instructions"><ol><li>Bring a large pot of salted water to the boil and cook the rice noodles until just tender, about 4 minutes, then drain and rinse.</li><li>Pat the turkey dry, season it well and cook it in a hot pan with the lemongrass paste until browned and cooked through.</li><li>Toss the noodles with the turkey, the radishes and the dressing and serve straight away with lime wedges.</li></ol></div>';
  const d = x(page(ld('"recipeIngredient":["10 ounces ground turkey","5 ounces rice noodles"],"recipeInstructions":[{"@type":"HowToStep","text":"Cook the rice noodles"},{"@type":"HowToStep","text":"Prep and cook your protein"},{"@type":"HowToStep","text":"Serve"}]'), body));
  assert.equal(steps(d).length, 3); assert.ok(steps(d)[0].includes('salted water'));
});
test('directions longer on the page than in the data block are used or reported', () => {
  const long = ['Brown the meat well in a heavy pot over medium heat.', 'Add everything else and simmer gently for 2 hours.', 'Skim the fat from the surface and stir in the vinegar and the chopped herbs.', 'Rest the stew off the heat for 15 minutes before serving with bread.'];
  const d = x(page(ld(`"recipeIngredient":["2 lb beef","1 onion"],${twoSteps}`), `<div class="directions"><ol>${long.map((l) => `<li>${l}</li>`).join('')}</ol></div>`));
  assert.ok(steps(d).length === 4 || loud(d).some((w) => w.field === 'directions'));
});
test('one short direction for many ingredients is flagged', () => {
  const d = x(page(ld('"recipeIngredient":["2 cups flour","1 egg","1 cup milk","2 tbsp sugar","1 tsp salt"],"recipeInstructions":"Make the best pancakes with this recipe"'), ''));
  assert.ok(loud(d).some((w) => w.field === 'directions'));
});

// ---- R4: microdata present but not read ----
test('microdata properties outside the recipe element are read', () => {
  const body = `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Test Stew</h1></div>
    <ul><li itemprop="recipeIngredient">2 lb beef</li><li itemprop="recipeIngredient">1 onion, chopped</li><li itemprop="recipeIngredient">3 cups stock</li></ul>
    <div itemprop="recipeInstructions"><p>Brown the meat well in a heavy pot.</p><p>Add the stock and simmer for 2 hours.</p></div>`;
  const d = x(page('', body));
  assert.equal(ing(d).length, 3); assert.equal(steps(d).length, 2); assert.equal(d.recipe.title, 'Test Stew');
});

// ---- R2 / R5: pages with no structured data ----
test('a plain blog post with friendly headings is read', () => {
  const body = `<div class="content has-sidebar"><h1>Test Stew</h1><p>My grandmother made this every winter.</p>
    <h2>&#128722; What You&rsquo;ll Need</h2><ul><li>2 lbs beef brisket, cut into chunks</li><li>1 large yellow onion, diced</li><li>4 cloves garlic, minced</li><li>Salt and pepper to taste</li></ul>
    <p><strong>Here&rsquo;s how to make it:</strong></p><ol><li>Brown the beef in a heavy pot over medium-high heat until well coloured.</li><li>Add the onion and garlic and cook until soft, then cover with water and simmer for 2 hours.</li></ol>
    <h2>Comments</h2><p>Looks great, I will try this at the weekend with my family!</p></div>`;
  const d = x(page('', body));
  assert.equal(ing(d).length, 4); assert.equal(steps(d).length, 2);
  assert.equal(ing(d)[0], '2 lbs beef brisket, cut into chunks', 'a wrapper class such as has-sidebar must not hide the page');
  assert.equal(d.confidence, Confidence.LOW); assert.ok(loud(d).length > 0, 'a guess from layout is always labelled');
});
test('a recipe in several parts keeps every part', () => {
  const body = `<h1>Test Stew</h1><h2>Produce</h2><ul><li>1 small red onion</li><li>2 celery stalks</li><li>1/2 cup dill leaves</li></ul>
    <h2>Pantry</h2><ul><li>2 cans oil-packed tuna</li><li>1/3 cup mayonnaise</li><li>4 teaspoons Dijon mustard</li></ul>
    <h2>Method</h2><ol><li>Finely chop the onion and the celery and put them in a bowl.</li><li>Fold in the tuna, the mayonnaise and the mustard and season well.</li></ol>`;
  const d = x(page('', body));
  assert.equal(ing(d).length, 6); assert.deepEqual(d.recipe.ingredients.filter((i) => i.header).map((i) => i.text), ['Produce', 'Pantry']);
});
test('directions with no heading are found after the ingredients', () => {
  const body = '<h1>Test Stew</h1><h3>Recipe: Orange Carrots</h3><ul><li>3 large carrots</li><li>1/4 tsp. salt</li><li>1 Tbs. soy sauce</li></ul><p>Cut the carrots into thick rounds and put them in a small pan.</p><p>Add orange juice to cover and the salt, bring to a boil and cook for 10 minutes.</p>';
  const d = x(page('', body));
  assert.equal(ing(d).length, 3); assert.equal(steps(d).length, 2);
});
test('page furniture is never imported as directions', () => {
  const body = '<h1>Test Stew</h1><h2>Ingredients</h2><ul><li>1 rack baby back ribs</li><li>1 cup apple cider vinegar</li></ul><footer><p>© 2026 Example Kitchen. All rights reserved. Privacy Policy and Terms of Service apply.</p><p>Use this popup to embed a mailing list sign up form for your readers.</p></footer>';
  const d = x(page('', body));
  assert.ok(steps(d).every((s) => !s.includes('rights reserved'))); assert.ok(loud(d).some((w) => w.field === 'directions'));
});

// ---- completeness of text, PDF and OCR imports ----
test('a missing numbered step is reported', () => {
  const d = Text.parse('Soup\nIngredients\n2 carrots\n1 onion\nDirections\n1. Chop the carrots and the onion.\n2. Fry them gently in butter.\n4. Blend until smooth and season.');
  assert.ok(loud(d).some((w) => w.field === 'directions' && w.message.includes('3')));
});
test('a last direction cut off mid-sentence is reported', () => {
  const d = Text.parse('Soup\nIngredients\n2 carrots\n1 onion\nDirections\nChop the carrots and the onion.\nFry them gently in butter and then add the');
  assert.ok(loud(d).some((w) => w.field === 'directions' && w.message.includes('mid-sentence')));
});
test('headings with counts and scale buttons are recognised', () => {
  const d = Text.parse('Taquitos\nIngredients 1x 2x 3x\n2 Tablespoons olive oil\n1 cup diced onion\nInstructions\nStep 1\nHeat the oil in a large pan over medium heat.\nStep 2\nAdd the onion and cook until translucent.');
  assert.equal(d.recipe.ingredients.length, 2); assert.equal(d.recipe.directions.filter((s) => s.text.length > 20).length, 2);
  assert.equal(Text.parse('Cake\nIngredients (2)\n1 cup flour\n2 eggs\nMethod\nMix everything together and bake for 30 minutes.').recipe.ingredients.length, 2);
});
test('a wrapped ingredient line is joined and tick boxes are removed', () => {
  const d = Text.parse('Cookies\nIngredients\n▢ 1 cup (2 sticks) unsalted butter,\nsoftened\n▢ 3/4 cup sugar\nDirections\n① Beat the butter with the sugar until pale and fluffy.');
  assert.deepEqual(d.recipe.ingredients.map((i) => i.text), ['1 cup (2 sticks) unsalted butter, softened', '3/4 cup sugar']);
  assert.equal(d.recipe.directions[0].text, 'Beat the butter with the sugar until pale and fluffy.');
});
test('several labelled values on one line are all read', () => {
  const r = Text.parse('Cookies\nServings: 36 Prep time: 20 minutes Cook time: 11 minutes\nIngredients\n1 cup flour\n2 eggs\nDirections\nMix and bake until golden at the edges.').recipe;
  assert.equal(r.servings, 36); assert.equal(r.prepMinutes, 20); assert.equal(r.cookMinutes, 11);
});
test('a printed web page uses the recipe block, not the site menu', () => {
  const text = ['11/6/26, 3:04 PM Whole Wheat Buns - Example Kitchen', 'Home', 'Recipes', 'Ingredients', 'Sauces, Wines & Oils', 'Spices & Seasonings', 'Noodles & Wrappers', 'About Us', 'Contact',
    'Whole Wheat Buns', 'INGREDIENTS', '1 3/4 cups warm milk', '1 teaspoon active dry yeast', '2 1/2 cups all-purpose flour', 'INSTRUCTIONS',
    '1 Heat the milk until warm to the touch, then stir in the yeast.', '2 Mix in the flour until the dough is smooth and soft.', 'Nutrition', 'Calories: 120kcal', 'Leave a comment', 'Great recipe!',
    'https://www.example-kitchen.test/buns/ 1/3'].join('\n');
  const d = Text.parse(text); const r = d.recipe;
  assert.equal(r.title, 'Whole Wheat Buns'); assert.equal(r.ingredients.length, 3); assert.equal(r.directions.length, 2);
  assert.equal(r.sourceUrl, 'https://www.example-kitchen.test/buns/');
  assert.ok(r.rawSource.includes('Spices & Seasonings'), 'everything that was read is still kept with the recipe');
});

// ---- R6 / R7: reading order of PDF and OCR text ----
const col = (xx, lines, top = 100) => lines.map((t, i) => Layout.textLine({ text: t, left: xx, top: top + i * 16, right: xx + t.length * 6, bottom: top + i * 16 + 11 }));
test('two columns are read one after the other, not interleaved', () => {
  const left = ['Ingredients', '2 cups flour', '1 tsp salt', '3 large eggs', '1 cup whole milk', '2 tbsp butter'];
  const right = ['Directions', 'Whisk the flour and the salt in a bowl.', 'Beat in the eggs and then the milk.', 'Rest the batter for half an hour.', 'Fry in butter until golden.', 'Serve at once with lemon.'];
  const text = Layout.read([Layout.textLine({ text: 'Pancakes', left: 40, top: 40, right: 200, bottom: 60 }), ...col(40, left), ...col(300, right)]);
  assert.deepEqual(text.split('\n').filter((l) => l.trim()), ['Pancakes', ...left, ...right]);
  const d = Text.parse(text);
  assert.equal(d.recipe.ingredients.length, 5); assert.equal(d.recipe.directions.length, 5);
});
test('amount and name in separate table cells stay on one line', () => {
  const qty = ['2 cups', '1 tsp', '3 large', '1 cup', '2 tbsp', '1 pinch'], name = ['flour', 'salt', 'eggs', 'whole milk', 'butter', 'nutmeg'];
  const text = Layout.read([...col(40, qty), ...col(160, name)]);
  assert.deepEqual(text.split('\n').filter((l) => l.trim()), qty.map((a, i) => `${a} ${name[i]}`));
});
test('running headers and footers are dropped and the source address is kept', () => {
  const pageOf = (n, body) => [Layout.textLine({ text: '11/6/26, 3:04 PM Pancakes - Example Kitchen', left: 40, top: 10, right: 400, bottom: 20, page: n }),
    ...body.map((t, i) => Layout.textLine({ text: t, left: 40, top: 60 + i * 16, right: 400, bottom: 71 + i * 16, page: n })),
    Layout.textLine({ text: `https://www.example-kitchen.test/pancakes/ Page ${n + 1} of 2`, left: 40, top: 760, right: 400, bottom: 770, page: n })];
  const text = Layout.read([...pageOf(0, ['Pancakes', 'Ingredients', '2 cups flour', '3 eggs', 'Directions', 'Whisk the flour with the eggs and then fry spoonfuls of the batter in a hot pan until']), ...pageOf(1, ['golden on both sides, about 2 minutes each.'])]);
  assert.ok(!text.includes('3:04 PM')); assert.ok(!text.includes('Page 1 of 2'));
  const d = Text.parse(text);
  assert.equal(d.recipe.title, 'Pancakes'); assert.equal(d.recipe.sourceUrl, 'https://www.example-kitchen.test/pancakes/');
  assert.equal(d.recipe.directions.length, 1, 'a step that continues on the next page is one step');
  assert.ok(d.recipe.directions[0].text.endsWith('about 2 minutes each.'));
});
