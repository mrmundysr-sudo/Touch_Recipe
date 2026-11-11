// Regression tests for the import problems found with Paula Deen's "Southern Fried Chicken":
// (1) a JSON-LD block ending in "};" was thrown away, (2) pages without a data block lost times/servings,
// (3) browser PDF footers became directions, (4) damaged PDF text layers ("Southern \"ied", "Di!iculty"),
// (5) wrapped lines starting with a bracket became separate steps, (6) byline / difficulty polluted the description.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';
import * as Web from '../www/js/engine/webextract.js';
import * as Text from '../www/js/engine/textparser.js';
import { ImportService } from '../www/js/data/importer.js';
import { ImportMethod, Confidence } from '../www/js/engine/models.js';

Web.setHtmlParser((html) => parseHTML(/<html[\s>]/i.test(html) ? html : `<html><head></head><body>${html}</body></html>`).document);
const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const URL_ = 'https://www.pauladeen.com/recipe/southern-fried-chicken-recipe/';

// ---------- 1. the real page ----------
test('real page: a JSON-LD block ending in "};" is still read (complete, high confidence)', () => {
  const d = Web.extract(fx('paula-deen-page-jsonld-with-semicolon.html'), URL_); const r = d.recipe;
  assert.equal(d.method, ImportMethod.JSON_LD); assert.equal(d.confidence, Confidence.HIGH);
  assert.equal(r.title, 'Southern Fried Chicken'); assert.equal(r.servings, 10); assert.equal(r.prepMinutes, 10); assert.equal(r.cookMinutes, 10); assert.equal(r.totalMinutes, 20);
  assert.equal(r.sourceName, 'Paula Deen'); assert.equal(r.ingredients.length, 5); assert.equal(r.directions.length, 2);
  assert.equal(r.ingredients[0].text, "Paula Deen's House Seasoning"); assert.equal(r.ingredients[4].text, '3 eggs');
  assert.ok(r.directions[1].text.includes('(about 1 cup)')); assert.ok(d.imageCandidates.some((u) => u.endsWith('southern_fried_chicken_1.jpg')));
  assert.ok(r.description.includes('classic Southern Fried Chicken'), 'blank JSON-LD description falls back to the page description');
});
test('json-ld reader tolerates trailing semicolons, assignments, BOM/CDATA, commas and several objects', () => {
  const one = '{"@type":"Recipe","name":"X","recipeIngredient":["1 egg"],"recipeInstructions":"Cook."}';
  for (const raw of [one + ';', `var data = ${one};`, '\uFEFF' + one, `//<![CDATA[\n${one}\n//]]>`, one.replace('"Cook."}', '"Cook.",}'), `{"@type":"WebPage"}\n${one};`]) {
    const vals = Web.parseLenientAll(raw); assert.ok(vals.some((v) => v['@type'] === 'Recipe'), raw.slice(0, 30));
  }
  const d = Web.extract(`<script type="application/ld+json">{"@type":"WebPage"}${one};</script>`, null);
  assert.equal(d.recipe.title, 'X'); assert.equal(d.method, ImportMethod.JSON_LD);
  assert.deepEqual(Web.parseLenientAll('not json at all'), []);
});

// ---------- 2. pages with no data block ----------
test('page without a data block still gets servings and times from visible labels', () => {
  const html = `<html><head><title>Soup</title></head><body><h1>Soup</h1><div class="meta"><span>Servings: 6</span><span>Prep time: 15 minutes</span><span>Cook time: 1 hour</span></div>
    <h2>Ingredients</h2><ul><li>1 onion</li><li>2 cups stock</li></ul><h2>Instructions</h2><ol><li>Chop onion.</li><li>Simmer 20 minutes.</li></ol></body></html>`;
  const d = Web.extract(html, 'https://blog.example/soup'); const r = d.recipe;
  assert.equal(d.method, ImportMethod.HTML); assert.equal(r.servings, 6); assert.equal(r.prepMinutes, 15); assert.equal(r.cookMinutes, 60); assert.equal(r.ingredients.length, 2);
});

// ---------- 3 + 5 + 6. PDF text ----------
for (const name of ['paula-deen-pdf-reading-order.txt', 'paula-deen-pdf-layout.txt']) {
  test(`PDF text (${name}): footers are dropped, the sentence across the page break is rejoined, byline and difficulty go to notes`, () => {
    const d = Text.parse(fx(name), ImportMethod.OCR); const r = d.recipe;
    assert.equal(r.directions.length, 2, r.directions.map((x) => x.text).join(' | '));
    assert.equal(r.directions[0].text, 'Heat the oil to 350 °F in a deep pot. Do not fill the pot more than 1/2 full with oil.');
    assert.ok(r.directions[1].text.startsWith('In a medium size bowl'));
    assert.ok(r.directions[1].text.includes('bright orange (about 1 cup). Season'), 'wrapped line starting with "(" joins the previous line');
    assert.ok(r.directions[1].text.includes('Approximate cooking time is 13 to 14 minutes'), 'page break sentence rejoined');
    for (const junk of ['http', 'Page 1', 'Page 2', 'Learn more', '3 04 AM']) assert.ok(!r.directions.some((x) => x.text.includes(junk)), junk);
    assert.ok(!r.directions.some((x) => x.text.trim() === ':'));
    assert.equal(r.ingredients.length, 5); assert.equal(r.servings, 10); assert.equal(r.prepMinutes, 10); assert.equal(r.cookMinutes, 10);
    assert.equal(r.sourceUrl, URL_, 'the address printed in the footer becomes the source link (fragment removed)'); assert.equal(r.sourceName, 'pauladeen.com');
    assert.ok(!r.description.includes('By Paula Deen') && !/Di.{0,3}cult/.test(r.description), r.description);
    assert.ok(r.description.startsWith('Paula’s southern fried chicken recipe'));
    assert.equal(r.notes, 'By Paula Deen\nDifficulty: Medium');
    assert.equal(r.directions[1].timerSeconds, 780);
  });
}
test('cleanPageText: removes furniture, keeps recipe lines, reports the first address', () => {
  const c = Text.cleanPageText('Pancakes\n\nhttps://x.com/p/#ingredients\n11/6/26, 3 04 AM\nPage 1 of 2\n:\nLearn more\n2 eggs\nMix well https://x.com/p/#a 1/2/2026, 10:30 PM');
  assert.equal(c.sourceUrl, 'https://x.com/p/'); assert.equal(c.text, 'Pancakes\n\n2 eggs\nMix well');
});
test('wrapped lines: continuation rules', () => {
  const merged = Text.parse('Stew\nIngredients\n2 carrots\nDirections\nPeel the carrots and chop them\n(about 2 cups)\nand add to the pot.\nSimmer for 20 minutes.').recipe.directions.map((d) => d.text);
  assert.deepEqual(merged, ['Peel the carrots and chop them (about 2 cups) and add to the pot.', 'Simmer for 20 minutes.']);
  const numbered = Text.parse('Stew\nIngredients\n2 carrots\nDirections\n1. Preheat oven\n2. Mix dry ingredients\n3. Bake').recipe.directions.map((d) => d.text);
  assert.deepEqual(numbered, ['Preheat oven', 'Mix dry ingredients', 'Bake'], 'numbered steps stay separate even without punctuation');
  const plain = Text.parse('Stew\nIngredients\n2 carrots\nDirections\nPreheat oven to 350\nMix dry ingredients\nBake 20 min').recipe.directions.map((d) => d.text);
  assert.equal(plain.length, 3, 'unpunctuated steps that each start a sentence are not glued together');
});

// ---------- 4. damaged text layer ----------
test('looksGarbled flags web-font ligature damage but not ordinary text', () => {
  assert.ok(Text.looksGarbled('Southern "ied Chicken\nBy Paula Deen')); assert.ok(Text.looksGarbled('Di!iculty: Medium')); assert.ok(Text.looksGarbled('bad \uFFFD char'));
  assert.ok(!Text.looksGarbled('Southern Fried Chicken\nDifficulty: Medium\nAdd "extra" hot sauce! Then serve.\n2 cups flour'));
});
test('PDF import re-reads the pages by OCR when the text layer is damaged, and keeps the layer when OCR is much shorter', async () => {
  const garbled = fx('paula-deen-pdf-reading-order.txt');
  const clean = garbled.replace('Southern "ied Chicken', 'Southern Fried Chicken').replace('Di!iculty', 'Difficulty');
  const calls = [];
  const svc = new ImportService({ photos: null, ocr: { recognizePdf: async (f, o = {}) => { calls.push(!!o.forceOcr); return { text: o.forceOcr ? clean : garbled, pages: 2 }; } } });
  const d = await svc.fromPdf(new Blob(['x']), () => {});
  assert.deepEqual(calls, [false, true]); assert.equal(d.recipe.title, 'Southern Fried Chicken'); assert.equal(d.recipe.directions.length, 2); assert.equal(d.method, ImportMethod.OCR);
  const calls2 = [];
  const svc2 = new ImportService({ photos: null, ocr: { recognizePdf: async (f, o = {}) => { calls2.push(!!o.forceOcr); return { text: o.forceOcr ? 'x' : garbled, pages: 2 }; } } });
  assert.equal((await svc2.fromPdf(new Blob(['x']), () => {})).recipe.title, 'Southern "ied Chicken');
  const svc3 = new ImportService({ photos: null, ocr: { recognizePdf: async () => ({ text: clean, pages: 2 }) } });
  assert.equal((await svc3.fromPdf(new Blob(['x']), () => {})).recipe.title, 'Southern Fried Chicken');
});
