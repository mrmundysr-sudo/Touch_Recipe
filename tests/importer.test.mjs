// Ports of ImporterTest / ImporterCorpusTest: the same fixtures, parsed with linkedom instead of jsoup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import * as Web from '../www/js/engine/webextract.js';
import * as Text from '../www/js/engine/textparser.js';
import * as D from '../www/js/engine/durations.js';
import { ImportMethod, Confidence, Severity } from '../www/js/engine/models.js';
import { parse as gparse } from '../www/js/engine/grocery.js';
import { scale } from '../www/js/engine/quantity.js';
import * as G from '../www/js/engine/grocery.js';
import { Recipe, Ingredient } from '../www/js/engine/models.js';

Web.setHtmlParser((html) => parseHTML(/<html[\s>]/i.test(html) ? html : `<html><head></head><body>${html}</body></html>`).document);
const hasWarning = (d, f) => d.warnings.some((w) => w.field === f);

const ldPage = `<html><head><title>Best Pasta | Site</title><meta property="og:image" content="/img/og.jpg">
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Site"},
 {"@type":["Recipe"],"name":"Best Pasta","description":"A <b>simple</b> dinner &amp; more.",
  "image":["https://x.com/a.jpg",{"@type":"ImageObject","url":"https://x.com/b.jpg"}],
  "author":{"@type":"Person","name":"Jo Cook"},"prepTime":"PT15M","cookTime":"PT1H5M","totalTime":"PT1H20M","recipeYield":["4","4 servings"],
  "recipeCategory":["Dinner"],"recipeCuisine":"Italian",
  "recipeIngredient":["1 lb spaghetti","2 tbsp olive oil","2 tbsp olive oil","salt to taste"],
  "recipeInstructions":[{"@type":"HowToSection","name":"Sauce","itemListElement":[{"@type":"HowToStep","text":"Simmer for 10-15 minutes."}]},{"@type":"HowToStep","text":"Boil pasta 9 minutes."}]}]}
</script></head><body></body></html>`;

test('json-ld graph', () => {
  const d = Web.extract(ldPage, 'https://www.example.com/pasta'); const r = d.recipe;
  assert.equal(d.method, ImportMethod.JSON_LD); assert.equal(d.confidence, Confidence.HIGH);
  assert.equal(r.title, 'Best Pasta'); assert.equal(r.description, 'A simple dinner & more.');
  assert.equal(r.prepMinutes, 15); assert.equal(r.cookMinutes, 65); assert.equal(r.totalMinutes, 80); assert.equal(r.servings, 4);
  assert.equal(r.sourceName, 'Jo Cook'); assert.equal(r.cuisine, 'Italian'); assert.equal(r.ingredients.length, 3); assert.equal(r.directions.length, 3);
  assert.ok(r.directions[0].header); assert.equal(r.directions[1].timerSeconds, 600); assert.equal(r.directions[2].timerSeconds, 540);
  for (const u of ['https://x.com/a.jpg', 'https://x.com/b.jpg', 'https://www.example.com/img/og.jpg']) assert.ok(d.imageCandidates.includes(u), u);
  assert.equal(r.sourceUrl, 'https://www.example.com/pasta'); assert.ok(r.rawSource);
});
test('json-ld malformed: trailing comma and string instructions', () => {
  const d = Web.extract(`<script type="application/ld+json">{"@type":"Recipe","name":"X","recipeIngredient":["1 egg",],"recipeInstructions":"Crack egg.\\nFry it for 2 minutes."}</script>`, 'https://a.org/x');
  assert.equal(d.recipe.ingredients.length, 1); assert.deepEqual(d.recipe.directions.map((x) => x.text), ['Crack egg.', 'Fry it for 2 minutes.']);
});
test('missing fields warn but keep content', () => {
  const d = Web.extract(`<script type="application/ld+json">{"@type":"Recipe","name":"Tea","recipeIngredient":["1 bag tea"]}</script>`, null);
  assert.ok(hasWarning(d, 'directions')); assert.notEqual(d.confidence, Confidence.HIGH); assert.equal(d.recipe.title, 'Tea');
});
test('html heuristic fallback never claims certainty', () => {
  const d = Web.extract(`<html><head><title>Soup - Blog</title></head><body><h1>Soup</h1><h2>Ingredients</h2><ul><li>1 onion</li><li>2 cups stock</li></ul><h2>Instructions</h2><ol><li>Chop onion.</li><li>Simmer 20 minutes.</li></ol></body></html>`, 'https://blog.com/soup');
  assert.equal(d.method, ImportMethod.HTML); assert.equal(d.recipe.ingredients.length, 2); assert.equal(d.recipe.directions.length, 2); assert.equal(d.confidence, Confidence.LOW); assert.ok(d.warnings.some((w) => w.message.includes('guessed')));
});
test('microdata', () => {
  const d = Web.extract(`<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Toast</h1><span itemprop="recipeIngredient">2 slices bread</span><span itemprop="recipeIngredient">1 tbsp butter</span><div itemprop="recipeInstructions"><ol><li>Toast it.</li><li>Butter it.</li></ol></div><meta itemprop="prepTime" content="PT5M"></div>`, null);
  assert.equal(d.method, ImportMethod.MICRODATA); assert.equal(d.recipe.title, 'Toast'); assert.equal(d.recipe.ingredients.length, 2); assert.equal(d.recipe.directions.length, 2); assert.equal(d.recipe.prepMinutes, 5);
});
test('a blocked page gives an error, not an empty success', () => {
  const d = Web.extract('<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>', 'https://x.com');
  assert.ok(d.warnings.some((w) => w.severity === Severity.ERROR));
});
test('durations', () => {
  assert.equal(D.toMinutes('PT1H30M'), 90); assert.equal(D.toMinutes('P0DT0H20M'), 20); assert.equal(D.toMinutes('1 hr 15 min'), 75); assert.equal(D.toMinutes('45 minutes'), 45);
  assert.equal(D.toMinutes('soon'), null); assert.equal(D.toMinutes(null), null); assert.equal(D.timerSeconds('Bake 25 to 30 minutes until golden'), 1500); assert.equal(D.timerSeconds('Stir well.'), null);
});
test('pasted text with headers', () => {
  const text = `Grandma's Pancakes\nPrep time: 10 minutes\nCook Time: 15 min\nServes 4\nIngredients\n• 1 1/2 cups flour\n• 2 eggs\n- 1 cup milk\nDirections\n1. Mix everything well in a large bowl until smooth.\n2. Cook on a hot griddle for 3 minutes per side.\nNotes\nWorks with oat milk.`;
  const d = Text.parse(text); const r = d.recipe;
  assert.equal(r.title, "Grandma's Pancakes"); assert.equal(r.prepMinutes, 10); assert.equal(r.cookMinutes, 15); assert.equal(r.servings, 4);
  assert.deepEqual(r.ingredients.map((i) => i.text), ['1 1/2 cups flour', '2 eggs', '1 cup milk']); assert.equal(r.directions.length, 2); assert.equal(r.directions[1].timerSeconds, 180);
  assert.equal(r.notes, 'Works with oat milk.'); assert.equal(r.rawSource, text); assert.notEqual(d.confidence, Confidence.HIGH);
});
test('pasted text without headers', () => {
  const d = Text.parse('Quick Salad\n2 cups lettuce\n1 tbsp olive oil\n1 lemon\nToss everything together in a bowl and serve right away with bread.');
  assert.equal(d.recipe.title, 'Quick Salad'); assert.equal(d.recipe.ingredients.length, 3); assert.equal(d.recipe.directions.length, 1); assert.equal(d.confidence, Confidence.LOW);
});
test('OCR wrapped lines are joined', () => {
  const d = Text.parse('Stew\nIngredients\n2 carrots\nMethod\nChop the carrots and add them to the\npot with water and simmer.', ImportMethod.OCR);
  assert.equal(d.recipe.directions.length, 1); assert.ok(d.recipe.directions[0].text.includes('to the pot')); assert.equal(d.confidence, Confidence.LOW);
});
test('empty text is an error', () => { assert.ok(Text.parse('   \n  ').warnings.some((w) => w.severity === Severity.ERROR)); });

// ---- corpus ----
test('corpus: wordpress plugin html without structured data', () => {
  const d = Web.extract(`<html><head><title>Banana Bread - Some Blog</title><meta property="og:image" content="https://cdn.x.com/b.jpg"></head><body><h1>Banana Bread</h1>
<ul class="wprm-recipe-ingredients"><li class="wprm-recipe-ingredient">3 ripe bananas</li><li class="wprm-recipe-ingredient">1/3 cup melted butter</li><li class="wprm-recipe-ingredient">3/4 cup sugar</li></ul>
<ul class="wprm-recipe-instructions"><li><div class="wprm-recipe-instruction-text">Mash the bananas.</div></li><li><div class="wprm-recipe-instruction-text">Bake for 60 minutes.</div></li></ul></body></html>`, 'https://blog.example.com/banana-bread');
  assert.equal(d.recipe.title, 'Banana Bread'); assert.equal(d.recipe.ingredients.length, 3); assert.equal(d.recipe.directions.length, 2); assert.equal(d.recipe.directions[1].timerSeconds, 3600); assert.equal(d.confidence, Confidence.LOW);
  assert.deepEqual(d.imageCandidates, ['https://cdn.x.com/b.jpg']);
});
test('corpus: yoast graph with numeric yield and html instructions', () => {
  const d = Web.extract(`<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Org"},{"@type":"WebPage","name":"Page"},{"@type":"Recipe","name":"Gazpacho","recipeYield":6,"image":[{"@type":"ImageObject","url":"https://i.x/g1.jpg"},"https://i.x/g2.jpg"],"recipeCuisine":["Spanish"],"recipeIngredient":["1 kg tomatoes","1 cucumber","50 ml olive oil"],"recipeInstructions":"<p>Blend everything.</p><p>Chill 2 hours.</p>"}]}</script>`, 'https://x.es/gazpacho');
  assert.equal(d.recipe.servings, 6); assert.equal(d.recipe.cuisine, 'Spanish'); assert.equal(d.imageCandidates.length, 2);
  assert.deepEqual(d.recipe.directions.map((x) => x.text), ['Blend everything.', 'Chill 2 hours.']); assert.equal(d.recipe.directions[1].timerSeconds, 7200);
});
test('corpus: sections, entities and notes', () => {
  const d = Web.extract(`<script type="application/ld+json">{"@type":"Recipe","name":"Pie &amp; Mash","description":"Rich &frac12; cup gravy","recipeNotes":"Swap butter for oil.","recipeIngredient":["500 g potatoes","2 tbsp butter"],"recipeInstructions":[{"@type":"HowToSection","name":"Mash","itemListElement":[{"@type":"HowToStep","text":"Boil potatoes."}]},{"@type":"HowToSection","name":"Pie","itemListElement":[{"@type":"HowToStep","text":"Bake the pie 35 min."}]}]}</script>`, null);
  assert.equal(d.recipe.title, 'Pie & Mash'); assert.ok(d.recipe.description.includes('½')); assert.equal(d.recipe.notes, 'Swap butter for oil.');
  assert.deepEqual(d.recipe.directions.map((x) => x.header), [true, false, true, false]); assert.equal(d.recipe.directions[3].timerSeconds, 2100);
});
test('corpus: multiple recipes picks the most complete and says so', () => {
  const d = Web.extract(`<script type="application/ld+json">[{"@type":"Recipe","name":"Small","recipeIngredient":["1 egg"],"recipeInstructions":"Cook."},{"@type":"Recipe","name":"Big","recipeIngredient":["1 egg","2 cups flour","1 cup milk"],"recipeInstructions":"Mix. Bake."}]</script>`, 'https://x.com/roundup');
  assert.equal(d.recipe.title, 'Big'); assert.ok(d.warnings.some((w) => w.message.includes('2 recipes')));
});
test('corpus: json-ld missing directions is filled from html and flagged', () => {
  const d = Web.extract(`<html><script type="application/ld+json">{"@type":"Recipe","name":"Half","recipeIngredient":["1 apple","1 pear"]}</script><body><h2>Instructions</h2><ol><li>Slice the fruit.</li><li>Serve cold.</li></ol></body></html>`, null);
  assert.equal(d.recipe.directions.length, 2); assert.notEqual(d.confidence, Confidence.HIGH); assert.ok(d.warnings.some((w) => w.message.includes('guessed')));
});
