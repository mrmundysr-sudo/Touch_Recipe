// The numbered lists of Recipe Rescue: Enter starts a new numbered entry (the text after the cursor belongs to it), Backspace at the start of an entry joins it to the one above
// (its number goes), Delete at the end joins the next one, pasting makes one entry per line. Plus the engine functions that store a whole list as one Undo step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitRow, mergeUp, mergeDown, pasteInto, removeRows, replaceRows, oneEntry } from '../www/js/ui/numbered.js';
import * as R from '../www/js/engine/rescue.js';
import { Recipe, Ingredient, Direction } from '../www/js/engine/models.js';

const rows = (...t) => t.map((text, i) => ({ id: `r${i}`, text }));
const texts = (res) => res.rows.map((r) => r.text);

test('Enter in the middle: the text before stays, the text after becomes the next numbered entry, the cursor goes to its start', () => {
  const res = splitRow(rows('2 cups flour', '1 egg'), 0, 6);
  assert.deepEqual(texts(res), ['2 cups', 'flour', '1 egg']); assert.deepEqual(res.focus, { row: 1, caret: 0 });
  assert.equal(res.rows[0].id, 'r0', 'the first part keeps its identity'); assert.notEqual(res.rows[1].id, 'r1');
});
test('Enter at the end makes an empty next entry; Enter at the start pushes the whole text down', () => {
  assert.deepEqual(texts(splitRow(rows('Bake.'), 0, 5)), ['Bake.', '']);
  assert.deepEqual(texts(splitRow(rows('Bake.'), 0, 0)), ['', 'Bake.']);
  assert.deepEqual(texts(splitRow(rows('Mix well and bake'), 0, 8, 12)), ['Mix well', 'bake'], 'a selected stretch is replaced by the break');
});
test('Backspace at the start joins the entry to the one above; the cursor sits at the join; the first entry cannot join upward', () => {
  const res = mergeUp(rows('2 cups', 'flour', '1 egg'), 1);
  assert.deepEqual(texts(res), ['2 cups flour', '1 egg']); assert.deepEqual(res.focus, { row: 0, caret: 6 });
  assert.equal(mergeUp(rows('a', 'b'), 0), null);
  assert.deepEqual(texts(mergeUp(rows('Mix', ''), 1)), ['Mix'], 'an empty entry just disappears'); assert.deepEqual(texts(mergeUp(rows('', 'Mix'), 1)), ['Mix']);
});
test('Delete at the end joins the next entry; the last entry cannot', () => {
  const res = mergeDown(rows('Cook', 'until golden.'), 0);
  assert.deepEqual(texts(res), ['Cook until golden.']); assert.deepEqual(res.focus, { row: 0, caret: 4 }); assert.equal(mergeDown(rows('a', 'b'), 1), null);
});
test('Enter then Backspace gives back exactly the text that was there', () => {
  const start = rows('2 cups flour', '1 egg');
  for (const at of [0, 1, 6, 7, 12]) { const s = splitRow(start, 0, at); const m = mergeUp(s.rows, 1); assert.equal(m.rows[0].text.replace(/\s+/g, ' ').trim(), '2 cups flour', `split at ${at}`); assert.equal(m.rows.length, 2); }
});
test('pasting keeps ALL the pasted text in the one entry: nothing is split at lines, sentences or guessed boundaries', () => {
  const para = '2 cups flour\n1 egg, beaten. Mix well; then add milk\r\n\r\n3. Bake.';
  assert.equal(oneEntry(para), '2 cups flour 1 egg, beaten. Mix well; then add milk 3. Bake.', 'only the line breaks become spaces; bullets, numbers and punctuation stay');
  const res = pasteInto(rows('Mix ', 'Bake'), 0, 4, 4, para);
  assert.equal(res.rows.length, 2, 'still two entries: nothing was split'); assert.equal(res.rows[0].text, 'Mix 2 cups flour 1 egg, beaten. Mix well; then add milk 3. Bake.'); assert.equal(res.rows[1].text, 'Bake');
  assert.deepEqual(res.focus, { row: 0, caret: 4 + oneEntry(para).length }, 'the cursor sits after the pasted text');
  assert.deepEqual(texts(pasteInto(rows('abc def'), 0, 3, 4, 'X\nY')), ['abcX Ydef'], 'a selection is replaced by the pasted text');
  assert.equal(pasteInto(rows('a'), 0, 0, 0, ''), null, 'an empty paste does nothing');
  assert.deepEqual(texts(pasteInto(rows('a'), 0, 1, 1, '\u2022 bullet')), ['a\u2022 bullet'], 'a bullet in the pasted text is not stripped');
});
test('remove a bad section: the selected entries go, the others keep their numbers in order', () => {
  const res = removeRows(rows('a', 'b', 'c', 'd'), new Set(['r1', 'r2']));
  assert.deepEqual(texts(res), ['a', 'd']); assert.deepEqual(res.focus, { row: 1, caret: 0 }); assert.equal(removeRows(rows('a'), new Set(['zz'])), null);
  assert.equal(removeRows(rows('a', 'b'), new Set(['r0', 'r1'])).focus, null, 'everything removed: an empty entry is left to type in');
});
test('replace a bad section with the right text as ONE entry, put where the first selected entry was', () => {
  const res = replaceRows(rows('a', 'b', 'c', 'd'), new Set(['r1', 'r2']), 'Pasted\ntext here');
  assert.deepEqual(texts(res), ['a', 'Pasted text here', 'd']); assert.equal(res.rows[1].id, 'r1'); assert.deepEqual(res.focus, { row: 1, caret: 16 });
  assert.deepEqual(texts(replaceRows(rows('a', 'b'), new Set(['r0', 'r1']), 'whole new text')), ['whole new text']);
  assert.deepEqual(texts(replaceRows(rows('a', 'b', 'c'), new Set(['r1']), '   ')), ['a', 'c'], 'replacing with nothing removes them');
});

const recipe = () => Recipe({ title: 'T', ingredients: [Ingredient({ id: 'i1', text: '2 cups flour' }), Ingredient({ id: 'i2', text: 'For the glaze', header: true }), Ingredient({ id: 'i3', text: '1 cup sugar' })],
  directions: [Direction({ id: 'd1', text: 'Mix.' }), Direction({ id: 'd2', text: 'Bake for 15 minutes.', timerSeconds: 900 })] });
const st = () => R.state(R.newDraft({ recipe: recipe() }));

test('a heading shows with its colon, a row ending with a colon is stored as a heading, empty rows vanish', () => {
  assert.deepEqual(R.ingredientRows(recipe()).map((r) => r.text), ['2 cups flour', 'For the glaze:', '1 cup sugar']);
  const s = R.setIngredientRows(st(), [{ id: 'i1', text: '2 cups flour' }, { id: 'i2', text: 'For the glaze:' }, { id: 'x', text: '' }, { id: 'i3', text: '1 cup sugar' }, { id: 'new', text: 'For the base:' }]);
  const ing = R.recipeOf(s).ingredients;
  assert.deepEqual(ing.map((i) => [i.text, i.header]), [['2 cups flour', false], ['For the glaze', true], ['1 cup sugar', false], ['For the base', true]]);
  assert.equal(ing[0].id, 'i1', 'rows keep their identity');
  assert.equal(R.isHeadingText('For the glaze:'), true); assert.equal(R.isHeadingText('1 cup sugar:'), true, 'any short line with a colon'); assert.equal(R.isHeadingText('Bake at 375 degrees for 40 minutes, then cool on a rack for ten minutes:'), false, 'a long line is not a heading');
});
test('replacing a list is one Undo step; saving the same list again changes nothing', () => {
  const s0 = st(); const same = R.setIngredientRows(s0, R.ingredientRows(recipe())); assert.equal(same, s0, 'nothing changed, nothing to undo');
  const s1 = R.setStepRows(s0, [{ id: 'd1', text: 'Mix well.' }, { id: 'd2', text: 'Bake for 15 minutes.' }, { id: 'd3', text: 'Cool for 10 minutes.' }]);
  assert.deepEqual(R.recipeOf(s1).directions.map((d) => d.text), ['Mix well.', 'Bake for 15 minutes.', 'Cool for 10 minutes.']);
  assert.equal(R.recipeOf(s1).directions[1].timerSeconds, 900, 'an unchanged step keeps its timer'); assert.equal(R.recipeOf(s1).directions[2].timerSeconds, 600, 'a new step gets its timer from its words');
  const back = R.undo(s1); assert.deepEqual(R.recipeOf(back).directions.map((d) => d.text), ['Mix.', 'Bake for 15 minutes.']); assert.equal(R.canUndo(back), false);
});
