// iOS PDF repair (2026-11): a recipe page printed to PDF from a website, read from its text layer with positions.
// The page below is written for the test (invented recipe) but has the geometry of the owner's failing PDF:
//   Directions | amounts | ingredients in touching columns (the directions run right up to the amount column),
//   amounts centred beside two- and three-line ingredients, fractions drawn as three loose pieces,
//   a heading wrapped over three lines, and a second recipe card in a sidebar.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Text from '../www/js/engine/textparser.js';
import * as Layout from '../www/js/engine/layout.js';

const H = 14, CW = 5.9, PITCH = 17.6;   // 5.9 pt per character, like the printed page
const frag = (text, left, top, { h = H, w = text.length * CW } = {}) => Layout.textLine({ text, left, top, right: left + w, bottom: top + h });
/** Words of a line, a word space apart; `endAt` shifts the line so that its last word ends exactly there. */
const words = (text, left, top, { endAt = null, h = H } = {}) => {
  let x = left; const out = text.split(' ').map((t) => { const f = frag(t, x, top, { h }); x = f.right + 3.44; return f; });
  if (endAt != null) { const d = endAt - out[out.length - 1].right; out.forEach((f) => { f.left += d; f.right += d; }); }
  return out;
};
/** An amount drawn right-aligned at `edge`; a fraction is drawn as numerator, slash and denominator pieces. */
const amount = (text, edge, top) => {
  const m = /^(\d)\/(\d)$/.exec(text);
  if (!m) return [frag(text, edge - 6, top, { w: 6 })];
  return [frag(m[1], edge - 10, top - 1, { h: 10, w: 3 }), frag('⁄', edge - 7, top + 1, { h: 13, w: 2 }), frag(m[2], edge - 5, top + 5, { h: 11, w: 5 })];
};
/** Ingredient blocks in a text column: lines a PITCH apart inside a block, a wider gap between blocks; the amount is centred on its block. */
function table(x, edge, top, blocks) {
  const out = []; const tops = []; let y = top;
  for (const [amt, lines] of blocks) {
    const first = y; lines.forEach((t, i) => out.push(...words(t, x, y + i * PITCH)));
    const bottom = y + (lines.length - 1) * PITCH + H;
    out.push(...amount(amt, edge, (first + bottom) / 2 - H / 2)); tops.push(first); y = bottom + 9;
  }
  return { frags: out, tops };
}

const INGREDIENTS = [['2', ['(10 3/4 ounce) cans', 'cream of mushroom', 'soup']], ['1', ['(16 ounce) can mixed', 'vegetables, drained']], ['2', ['cups cooked', 'chicken, diced']],
  ['1/2', ['cup milk']], ['1/2', ['teaspoon thyme']], ['1/2', ['teaspoon salt', '(optional)']], ['2', ['(9 inch) frozen pie', 'crusts, thawed']], ['1', ['egg, lightly beaten']]];
const STEPS = [['1.', 'Combine first 6', 'ingredients.'], ['2.', 'Spoon into prepared', 'pie crust.'], ['3.', 'Cover with top crust;', 'crimp edges to seal.'],
  ['4.', 'Slit the top and brush', 'with egg.'], ['5.', 'Bake at 375 degrees', 'for 40 minutes.'], ['6.', 'Cool 10 minutes', 'before serving.']];

function recipePage({ sidebar = true } = {}) {
  const f = [];
  const big = (t, top) => f.push(frag(t, 29.5, top, { h: 32, w: t.length * 16 }));
  big('SAVORY', 87.3); big('CHICKEN', 111.7); big('PIE', 136.1);
  f.push(...words('Submitted by Ann Cook', 29.5, 172));
  ['"It is really easy to make. I use deep', 'dish pie crust. I found this recipe in a', 'co-worker cookbook. It calls for a can of', 'mixed vegetables, I use a bag of frozen."'].forEach((t, i) => f.push(...words(t, 29.5, 197.4 + i * 17.2)));
  f.push(...words('Ready In: 1hr 10mins', 49.5, 283.4), ...words('Serves: 4-6', 198, 283.4), ...words('Ingredients: 8', 49.5, 312.1));
  f.push(frag('DIRECTIONS', 29.5, 355.3, { h: 20, w: 91 }), frag('INGREDIENTS', 172.2, 355.3, { h: 20, w: 100 }));
  const t = table(200, 182.4, 387.5, INGREDIENTS); f.push(...t.frags);
  const thymeTop = t.tops[4];
  STEPS.forEach(([n, a, b], i) => {
    const top = i === 4 ? thymeTop : 387.5 + i * 40.2;
    f.push(frag(n, 29.2, top, { w: 10 }), ...words(a, 52.4, top, { endAt: i === 4 ? 171.6 : null }), ...words(b, 52.4, top + 17.2));
  });
  if (sidebar) {
    f.push(frag('GINGER', 337.7, 87.3, { h: 32, w: 96 }), frag('COOKIES', 337.7, 111.7, { h: 32, w: 112 }), ...words('Submitted by Ben Baker', 337.7, 172));
    ['"Crisp at the edges and soft in the middle.', 'Everyone asks for the recipe."'].forEach((s, i) => f.push(...words(s, 337.7, 197.4 + i * 17.2)));
    f.push(frag('DIRECTIONS', 337.7, 355.3, { h: 20, w: 91 }), frag('INGREDIENTS', 470, 355.3, { h: 20, w: 100 }));
    ['1. Mix the dough.', '2. Roll into balls.', '3. Bake until golden.'].forEach((s, i) => f.push(...words(s, 337.7, 387.5 + i * 25)));
    f.push(...table(500, 490, 387.5, [['2', ['cups flour']], ['1', ['egg']], ['1/2', ['cup sugar']]]).frags);
  }
  return f;
}

test('pdf page: three touching columns come back as one recipe, in order, with every amount on its ingredient', () => {
  const { text } = Layout.readWithNotes(recipePage());
  const d = Text.parse(text);
  assert.equal(d.recipe.title, 'SAVORY CHICKEN PIE');
  assert.deepEqual(d.recipe.ingredients.map((i) => i.text), ['2 (10 3/4 ounce) cans cream of mushroom soup', '1 (16 ounce) can mixed vegetables, drained', '2 cups cooked chicken, diced',
    '1/2 cup milk', '1/2 teaspoon thyme', '1/2 teaspoon salt (optional)', '2 (9 inch) frozen pie crusts, thawed', '1 egg, lightly beaten']);
  assert.deepEqual(d.recipe.directions.map((s) => s.text), ['Combine first 6 ingredients.', 'Spoon into prepared pie crust.', 'Cover with top crust; crimp edges to seal.',
    'Slit the top and brush with egg.', 'Bake at 375 degrees for 40 minutes.', 'Cool 10 minutes before serving.']);
});

test('pdf page: a fraction drawn as three pieces is one fraction, and never lands in the step beside it', () => {
  const { text } = Layout.readWithNotes(recipePage());
  assert.ok(!text.includes('⁄'), 'no stray fraction slash');
  assert.ok(text.includes('1/2 cup milk'));
  assert.ok(text.includes('Bake at 375 degrees\nfor 40 minutes.') && !/375 degrees\s*1\/?2?\s*$/m.test(text), 'the amount next to step 5 is not glued to it');
});

test('pdf page: a second recipe card is set aside with a note, not mixed in', () => {
  const r = Layout.readWithNotes(recipePage());
  assert.ok(!/GINGER|COOKIES|Ben Baker/.test(r.text));
  assert.ok(/GINGER COOKIES/.test(r.extra) && /cups flour/.test(r.extra), 'the other recipe is kept');
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /more than one recipe/);
  assert.deepEqual(Layout.readWithNotes(recipePage({ sidebar: false })).notes, [], 'one recipe: nothing is set aside');
});

test('pdf page: a heading wrapped over several lines is one title', () => {
  const { text } = Layout.readWithNotes(recipePage({ sidebar: false }));
  assert.equal(text.split('\n')[0], 'SAVORY CHICKEN PIE');
});

test('pdf page: ordinary "2 cups flour" pieces (one word space apart) are not mistaken for an amount column', () => {
  const rows = ['2 cups flour', '1 egg, beaten', '3 tbsp butter', '1 pinch of salt', '4 apples, sliced'];
  const f = [frag('Ingredients', 40, 100, { h: 16, w: 80 }), ...rows.flatMap((r, i) => words(r, 40, 124 + i * 18))];
  assert.equal(Layout.read(f), ['Ingredients', ...rows].join('\n'));
});

test('pdf page: ingredients on the left and directions on the right are two columns, not two recipes', () => {
  const f = [frag('Ingredients', 40, 80, { h: 16, w: 80 }), frag('Directions', 330, 80, { h: 16, w: 80 })];
  ['2 cups flour', '1 egg', '3 tbsp butter', '1 cup milk'].forEach((r, i) => f.push(...words(r, 40, 110 + i * 18)));
  ['1. Mix everything well.', '2. Pour into a pan.', '3. Bake until set.', '4. Cool and serve.'].forEach((r, i) => f.push(...words(r, 330, 110 + i * 18)));
  const r = Layout.readWithNotes(f);
  assert.equal(r.extra, ''); assert.deepEqual(r.notes, []);
  assert.ok(r.text.indexOf('2 cups flour') < r.text.indexOf('Directions') && r.text.indexOf('Directions') < r.text.indexOf('Mix everything'));
});

test('text parser: a step that wraps onto a line holding the word "ingredients." is not an Ingredients heading', () => {
  const d = Text.parse('Pie\n\nDirections\n1. Combine first 6\ningredients.\n2. Spoon into the crust.\n\nIngredients\n2 cups flour\n1 egg\n3 tbsp butter');
  assert.deepEqual(d.recipe.directions.map((s) => s.text), ['Combine first 6 ingredients.', 'Spoon into the crust.']);
  assert.equal(d.recipe.ingredients.length, 3);
});

test('text parser: a step that wraps after a semicolon is one step', () => {
  const d = Text.parse('Pie\n\nIngredients\n2 cups flour\n1 egg\n\nDirections\n1. Cover with top crust;\ncrimp edges to seal.\n2. Bake.');
  assert.deepEqual(d.recipe.directions.map((s) => s.text), ['Cover with top crust; crimp edges to seal.', 'Bake.']);
});

// ---- the importer's side of the bridge ----
import { ImportService, pdfText } from '../www/js/data/importer.js';
const plainOf = (frags) => frags.map((f) => f.text).join(' ');   // what the file's own drawing order would give: no usable order

test('bridge answer: positioned pieces are read in layout order; the plain text is only the fallback', () => {
  const frags = recipePage();
  const r = pdfText({ text: plainOf(frags), lines: frags, pages: 1 });
  assert.ok(r.text.startsWith('SAVORY CHICKEN PIE'));
  assert.ok(r.text.includes('1/2 cup milk'));
  assert.equal(r.notes.length, 1);
  assert.deepEqual(pdfText({ text: 'Pie\nIngredients\n2 cups flour' }), { text: 'Pie\nIngredients\n2 cups flour', extra: '', notes: [] }, 'an older bridge sends no pieces');
  assert.equal(pdfText({ text: plainOf(frags), lines: [frag('x', 0, 0)] }).text, plainOf(frags), 'pieces that cover far less than the plain text are not trusted');
});

test('pdf import: the recipe is the first card, the other card is kept with the original and the person is told', async () => {
  const frags = recipePage();
  const svc = new ImportService({ photos: null, ocr: { recognizePdf: async () => ({ ...pdfText({ text: plainOf(frags), lines: frags }), pages: 1 }) } });
  const d = await svc.fromPdf({ name: 'page.pdf' }, () => {});
  assert.equal(d.recipe.title, 'SAVORY CHICKEN PIE');
  assert.equal(d.recipe.ingredients.length, 8);
  assert.equal(d.recipe.directions.length, 6);
  assert.ok(d.warnings.some((w) => /more than one recipe/.test(w.message)));
  assert.match(d.source.text, /Another recipe on the same page[\s\S]*GINGER COOKIES/);
});
