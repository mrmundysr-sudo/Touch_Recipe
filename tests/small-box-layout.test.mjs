// PDFKit's word boxes are about the font size (11.5 pt for 11.5 pt text); poppler's are taller (14 pt for the same text). The macOS probe (2026-11-13) showed the layout reader
// only coped with the tall boxes: with small boxes it did not pair the amounts with their ingredients and the steps ended up in the ingredient list.
// tests/fixtures/small-box-pieces.json holds the positions of the probe's INVENTED two-card page with small boxes (no third-party text).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Text from '../www/js/engine/textparser.js';
import { pdfText } from '../www/js/data/importer.js';

const pieces = JSON.parse(fs.readFileSync(new URL('./fixtures/small-box-pieces.json', import.meta.url), 'utf8'));
const plain = pieces.map((p) => p.text).join(' ');

test('small boxes: every amount is on its ingredient, every step is a step, the other recipe stays out', () => {
  const h = pieces.filter((p) => p.text === 'Combine')[0]; assert.ok(h.bottom - h.top < 12, 'the boxes really are small (about the font size)');
  const r = pdfText({ text: plain, lines: pieces, pages: 1 });
  const d = Text.parse(r.text);
  assert.equal(d.recipe.title, 'SAVORY CHICKEN PIE');
  assert.deepEqual(d.recipe.ingredients.map((i) => i.text), ['2 (10 3/4 ounce) cans cream of mushroom soup', '1 (16 ounce) can mixed vegetables, drained', '2 cups cooked chicken, diced', '1/2 cup milk', '1/2 teaspoon thyme', '1/2 teaspoon black pepper', '2 (9 inch) frozen pie crusts, thawed', '1 egg, lightly beaten']);
  assert.deepEqual(d.recipe.directions.map((s) => s.text), ['Combine first 6 ingredients.', 'Spoon into prepared pie crust.', 'Cover with top crust; crimp edges to seal.', 'Slit the top and brush with egg.', 'Bake at 375 degrees for 40 minutes.', 'Cool 10 minutes before serving.']);
  assert.ok(/GINGER\s+COOKIES/.test(r.extra) && !/GINGER|Ben Baker/.test(r.text), 'the second card is set aside');
  assert.equal(d.recipe.servings, 4); assert.equal(d.recipe.totalMinutes, 70); assert.deepEqual(r.cautions, undefined);
});
