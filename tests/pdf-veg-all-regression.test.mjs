// Regression for the owner's screenshots of 2026-11-13 (TestFlight candidate rejected before upload): the Veg-All Chicken Pot Pie
// PDF, which has a Bourbon Chicken card beside it, imported as broken fragments in Recipe Rescue.
// What the screenshots showed: words cut in pieces ("s poon", "chic ken", "Chin ese"), amounts and names separated, details and
// notes inside the steps, lines holding only "1" "2" "3" "4", the title reduced to "T P", the same text repeated.
// The page below is a reconstruction (the PDF itself is not in the repository) with the geometry of the real one: directions,
// amounts and ingredients in touching columns, fractions as three pieces, a sidebar recipe, and EVERY word drawn as several
// pieces with a gap inside the word, which is what the iOS text layer produced. See docs/knowledge/reports/2026-11-13-ios-pdf-layout.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Text from '../www/js/engine/textparser.js';
import * as Layout from '../www/js/engine/layout.js';
import * as R from '../www/js/engine/rescue.js';
import { healText, fragmentRate, vocabulary } from '../www/js/engine/wordheal.js';
import { Recipe, Ingredient, Direction } from '../www/js/engine/models.js';
import { ImportService, pdfText } from '../www/js/data/importer.js';

const PLAIN_TEXT = ['VEG-ALL CHICKEN POT PIE Submitted by Chef Teresa "It is really easy to make. I use deep dish pie crust. I found this recipe from a co-worker cookbook. It calls for a can of Veg-All, I use a bag of frozen mixed vegetables."',
  'Ready In: 1hr 10mins Serves: 4-6 Ingredients: 8 DIRECTIONS INGREDIENTS 2 (10 3/4 ounce) cans cream of potato soup 1 (16 ounce) can mixed vegetables, drained 2 cups cooked chicken, diced 1/2 cup milk 1/2 teaspoon thyme 1/2 teaspoon salt (optional) 2 (9 inch) frozen pie crusts, thawed 1 egg, lightly beaten',
  '1. Combine first 6 ingredients. 2. Spoon into prepared pie crust. 3. Cover with top crust; crimp edges to seal. 4. Slit the top and brush with egg. 5. Bake at 375 degrees for 40 minutes. 6. Cool 10 minutes before serving.',
  'BOURBON CHICKEN Submitted by Lin Marie "I searched and finally found this recipe on the internet. It is a copycat of Bourbon Chicken sold in Chinese carry-outs in my hometown. sons gobble it up." Editor\'s Note: Named Bourbon Chicken because it was supposedly created by a Chinese cook who worked in a restaurant on Bourbon Street. Ready In: 35mins Serves: 4 Ingredients: 11 DIRECTIONS INGREDIENTS 1. Mix the sauce. 2. Cook the chicken. 3. Combine and serve. 1 pound boneless chicken 1 clove garlic, crushed 1/4 cup apple juice'].join('\n');

const PLAIN = PLAIN_TEXT;
const H = 14, CW = 5.9, PITCH = 17.6;
const frag = (text, left, top, { h = H, w = text.length * CW } = {}) => Layout.textLine({ text, left, top, right: left + w, bottom: top + h });
/** One word drawn as pieces: cut after 1-4 letters, with a gap of half the line height between the pieces (more than the old 0.35 limit). */
const REAL = vocabulary(PLAIN_TEXT);
const cut = (word, left, top, h, seed) => {
  if (word.length < 4 || /[^A-Za-z]/.test(word.slice(0, -1))) return [frag(word, left, top, { h })];
  // cut after 1-4 letters, choosing cuts whose pieces are not all real words (a cut "in|to" cannot be told from two words; that is a stated limit)
  for (let tryN = 0; tryN < 8; tryN++) {
    const pieces = []; let i = 0, n = seed + tryN;
    while (i < word.length) { const len = Math.min(word.length - i, 1 + (n++ % 4)); pieces.push(word.slice(i, i + len)); i += len; }
    if (pieces.some((p) => !REAL.has(p.toLowerCase().replace(/[^a-z]/g, '')))) {
      // the pieces tile the span the word occupies; a gap of 0.45 line heights (more than the old 0.35 cut-off) opens between them
      const out = []; const g = h * 0.45; let x = left;
      pieces.forEach((t, j) => { const w = t.length * CW; const l = x + (j > 0 ? g / 2 : 0), r = x + w - (j < pieces.length - 1 ? g / 2 : 0); out.push(frag(t, l, top, { h, w: Math.max(1, r - l) })); x += w; });
      return out;
    }
  }
  return [frag(word, left, top, { h })];
};
const words = (text, left, top, { endAt = null, h = H, split = !false } = {}) => {
  let x = left, k = 0; const out = [];
  for (const t of text.split(' ')) { const ps = split ? cut(t, x, top, h, k++) : [frag(t, x, top, { h })]; out.push(...ps); x = ps[ps.length - 1].right + 3.44; }
  if (endAt != null) { const d = endAt - out[out.length - 1].right; out.forEach((f) => { f.left += d; f.right += d; }); }
  return out;
};
const amount = (text, edge, top) => {
  const m = /^(\d)\/(\d)$/.exec(text);
  if (!m) return [frag(text, edge - 6, top, { w: 6 })];
  return [frag(m[1], edge - 10, top - 1, { h: 10, w: 3 }), frag('⁄', edge - 7, top + 1, { h: 13, w: 2 }), frag(m[2], edge - 5, top + 5, { h: 11, w: 5 })];
};
function table(x, edge, top, blocks) {
  const out = []; const tops = []; let y = top;
  for (const [amt, lines] of blocks) {
    const first = y; lines.forEach((t, i) => out.push(...words(t, x, y + i * PITCH)));
    const bottom = y + (lines.length - 1) * PITCH + H;
    out.push(...amount(amt, edge, (first + bottom) / 2 - H / 2)); tops.push(first); y = bottom + 9;
  }
  return { frags: out, tops };
}
const INGREDIENTS = [['2', ['(10 3/4 ounce) cans', 'cream of potato', 'soup']], ['1', ['(16 ounce) can mixed', 'vegetables, drained']], ['2', ['cups cooked', 'chicken, diced']],
  ['1/2', ['cup milk']], ['1/2', ['teaspoon thyme']], ['1/2', ['teaspoon salt', '(optional)']], ['2', ['(9 inch) frozen pie', 'crusts, thawed']], ['1', ['egg, lightly beaten']]];
const STEPS = [['1.', 'Combine first 6', 'ingredients.'], ['2.', 'Spoon into prepared', 'pie crust.'], ['3.', 'Cover with top crust;', 'crimp edges to seal.'],
  ['4.', 'Slit the top and brush', 'with egg.'], ['5.', 'Bake at 375 degrees', 'for 40 minutes.'], ['6.', 'Cool 10 minutes', 'before serving.']];

function vegAllPage() {
  const f = [];
  const big = (t, top) => f.push(frag(t, 29.5, top, { h: 32, w: t.length * 16 }));
  big('VEG-ALL', 87.3); big('CHICKEN', 111.7); big('POT PIE', 136.1);
  f.push(...words('Submitted by Chef Teresa', 29.5, 172));
  ['"It is really easy to make. I use deep', 'dish pie crust. I found this recipe from a', 'co-worker cookbook. It calls for a can of', 'Veg-All, I use a bag of frozen mixed vegetables."'].forEach((t, i) => f.push(...words(t, 29.5, 197.4 + i * 17.2)));
  f.push(...words('Ready In: 1hr 10mins', 49.5, 283.4), ...words('Serves: 4-6', 198, 283.4), ...words('Ingredients: 8', 49.5, 312.1));
  f.push(frag('DIRECTIONS', 29.5, 355.3, { h: 20, w: 91 }), frag('INGREDIENTS', 172.2, 355.3, { h: 20, w: 100 }));
  const t = table(200, 182.4, 387.5, INGREDIENTS); f.push(...t.frags);
  STEPS.forEach(([n, a, b], i) => { const top = i === 4 ? t.tops[4] : 387.5 + i * 40.2; f.push(frag(n, 29.2, top, { w: 10 }), ...words(a, 52.4, top, { endAt: i === 4 ? 171.6 : null }), ...words(b, 52.4, top + 17.2)); });
  // the second recipe, in the sidebar
  f.push(frag('BOURBON', 337.7, 87.3, { h: 32, w: 112 }), frag('CHICKEN', 337.7, 111.7, { h: 32, w: 112 }), ...words('Submitted by Lin Marie', 337.7, 172));
  ['"I searched and finally found this recipe on the internet. It is a copycat of Bourbon Chicken sold in Chinese carry-outs in my hometown."'.slice(0, 44), 'sons gobble it up."'].forEach((s, i) => f.push(...words(s, 337.7, 197.4 + i * 17.2)));
  f.push(...words("Editor's Note: Named Bourbon Chicken because it was supposedly created by a Chinese cook who worked in a restaurant on Bourbon Street.".slice(0, 40), 337.7, 240));
  f.push(...words('Ready In: 35mins', 337.7, 283.4), ...words('Serves: 4', 470, 283.4), ...words('Ingredients: 11', 337.7, 312.1));
  f.push(frag('DIRECTIONS', 337.7, 355.3, { h: 20, w: 91 }), frag('INGREDIENTS', 470, 355.3, { h: 20, w: 100 }));
  ['1. Mix the sauce.', '2. Cook the chicken.', '3. Combine and serve.'].forEach((s, i) => f.push(...words(s, 337.7, 387.5 + i * 25)));
  f.push(...table(500, 490, 387.5, [['1', ['pound boneless chicken']], ['1', ['clove garlic, crushed']], ['1/4', ['cup apple juice']]]).frags);
  return f;
}
/** What PDFKit's `string` gives: the real words, whole, in the file's drawing order (so not a usable order). */
test('screenshot regression: a page whose every word is cut in pieces reads as one clean recipe, in order', () => {
  const frags = vegAllPage();
  assert.ok(fragmentRate(frags.map((f) => f.text).join(' ')) > 0.1, 'the input really is cut up like the screenshots (many one-letter pieces)');
  const r = pdfText({ text: PLAIN, lines: frags, pages: 1 });
  assert.equal(fragmentRate(r.text), 0, 'no stray letters are left');
  assert.equal(r.cautions, undefined, 'nothing is left that the app is unsure about');
  const d = Text.parse(r.text);
  assert.equal(d.recipe.title, 'VEG-ALL CHICKEN POT PIE');
  assert.deepEqual(d.recipe.ingredients.map((i) => i.text), ['2 (10 3/4 ounce) cans cream of potato soup', '1 (16 ounce) can mixed vegetables, drained', '2 cups cooked chicken, diced',
    '1/2 cup milk', '1/2 teaspoon thyme', '1/2 teaspoon salt (optional)', '2 (9 inch) frozen pie crusts, thawed', '1 egg, lightly beaten']);
  assert.deepEqual(d.recipe.directions.map((s) => s.text), ['Combine first 6 ingredients.', 'Spoon into prepared pie crust.', 'Cover with top crust; crimp edges to seal.',
    'Slit the top and brush with egg.', 'Bake at 375 degrees for 40 minutes.', 'Cool 10 minutes before serving.']);
  assert.equal(d.recipe.servings, 4);
  assert.equal(d.recipe.totalMinutes, 70);
  assert.ok(!/Bourbon|Lin Marie|Editor/i.test(JSON.stringify([d.recipe.ingredients, d.recipe.directions])), 'the second recipe never enters the lists');
  assert.ok(/GINGER|BOURBON/.test(r.extra) && /apple juice/.test(r.extra), 'the other recipe is kept, not thrown away');
});

test('screenshot regression: the whole import path keeps the original text, sets the other recipe aside and flags nothing wrongly', async () => {
  const frags = vegAllPage();
  const svc = new ImportService({ photos: null, ocr: { recognizePdf: async () => ({ ...pdfText({ text: PLAIN, lines: frags }), pages: 1 }) } });
  const d = await svc.fromPdf({ name: 'veg-all.pdf' }, () => {});
  assert.equal(d.recipe.ingredients.length, 8); assert.equal(d.recipe.directions.length, 6);
  assert.match(d.source.text, /Another recipe on the same page[\s\S]*Bourbon/i);
  assert.deepEqual(R.linesToReview(d.recipe), [], 'a clean import has no line marked for review');
  const lines = [...d.recipe.ingredients, ...d.recipe.directions];
  assert.equal(new Set(lines.map((l) => l.text)).size, lines.length, 'no line appears twice');
  assert.ok(lines.every((l) => /\p{L}/u.test(l.text)), 'no line is only a number');
});

test('words are joined only when the page itself proves the word; otherwise they are left alone and the person is told', () => {
  const plain = 'spoon chicken Chinese tablespoon olive oil';
  assert.equal(healText('1 table s poon olive oil\nchic ken\nChin ese', plain), '1 tablespoon olive oil\nchicken\nChinese');
  assert.equal(healText('olive oil, grated\nsome one', 'olive oil grated someone some one'), 'olive oil, grated\nsome one', 'two real words are never joined');
  assert.equal(healText('s poon', 'nothing relevant here'), 's poon', 'no proof, no change');
  // the plain text is cut up the same way: nothing can be proven, the text stays as read and a caution is raised
  const frags = vegAllPage();
  const cutPlain = frags.map((f) => f.text).join(' ');
  const r = pdfText({ text: cutPlain, lines: frags, pages: 1 });
  assert.ok(Array.isArray(r.cautions) && /pieces/.test(r.cautions[0]), 'the person is warned');
});

test('screenshot regression: every broken line from the screenshots is marked for review, shown unchanged and editable', () => {
  const broken = [
    ['dir', '12. In: 35mins Serv es: 4 Bourbon Chicken because it was supp osedly Ingredients: 11 created by a Chin ese cook wh worked in a restaurant on B o ourbon Street." DI'],
    ['dir', '3. DIRECTIONS 1. Co ore serving. INGRED f mbine first IENTS 2 (10 3/4 oun pre ) cream of pot n into ce ato soup 1 ( pared pie crust.'],
    ['dir', '5. Slit top crust and brush with egg. 5 chicken, d i'],
    ['dir', '4.'],
    ['ing', '4'],
    ['ing', '1 ugarlic clove, cr d 1/teaspoon g'],
    ['ing', "41/cuplightbrown3sugar2tablespoons1.Editor'sNote:NamedBourbonChickenbecauseit lbs"],
    ['dir', '10. Chicken sold in Chinese carry-outs in my h ometown. This recipe is so good that my sons gobb le itrexcuseupleavingwasmethejust a spoonful.ythoughtThei'],
    ['ing', '15. NS IN bon ess chicken b el reasts, crush 4 red p on epper flake'],
  ];
  const recipe = Recipe({ title: 'x', ingredients: broken.filter(([k]) => k === 'ing').map(([, t]) => Ingredient({ text: t })), directions: broken.filter(([k]) => k === 'dir').map(([, t]) => Direction({ text: t })) });
  const flagged = R.linesToReview(recipe);
  assert.equal(flagged.length, broken.length, `every broken line is marked: ${JSON.stringify(flagged.map((f) => f.item.text.slice(0, 20)))}`);
  const before = JSON.stringify(recipe);
  R.linesToReview(recipe);
  assert.equal(JSON.stringify(recipe), before, 'marking a line never changes it');
  for (const ok of ['2 (10 3/4 ounce) cans cream of potato soup', '1/2 teaspoon salt (optional)', '1 egg, lightly beaten']) assert.equal(R.reviewReason(ok, 'ing'), null, ok);
  for (const ok of ['Combine first 6 ingredients.', 'Bake at 375 degrees for 40 minutes.', 'Cover with top crust; crimp edges to seal.']) assert.equal(R.reviewReason(ok, 'dir'), null, ok);
});

test('text parser: details, notes, a second count line, lone numbers and repeated lines never become ingredients or steps', () => {
  const d = Text.parse(['Chicken Pie', 'Submitted by Chef Teresa', 'Ready In: 1hr 10mins', 'Serves: 4-6', 'Ingredients: 8', '', 'Ingredients', '2', 'cups cooked chicken', '1 egg', '1 egg', '3', '2 tbsp butter', '', 'Directions',
    '1. Mix well.', '4.', '2. Bake it.', '2. Bake it.', "Ready In: 35mins", '', "Editor's Note: Named for a street."].join('\n'));
  assert.deepEqual(d.recipe.ingredients.map((i) => i.text), ['2 cups cooked chicken', '1 egg', '3 2 tbsp butter'.replace('3 2 tbsp butter', '2 tbsp butter')].slice(0, 3));
  assert.deepEqual(d.recipe.directions.map((s) => s.text), ['Mix well.', 'Bake it.']);
  assert.match(d.recipe.notes, /Submitted by Chef Teresa/); assert.match(d.recipe.notes, /Editor's Note: Named for a street\./);
  assert.equal(d.recipe.servings, 4);
  assert.ok(d.warnings.some((w) => /stray number/.test(w.message)), 'a number with nothing next to it is reported, not invented into a line');
});
