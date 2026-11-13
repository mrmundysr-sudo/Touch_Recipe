// Port of RescueTest.kt: Recipe Rescue editing rules (transfer, selective removal, replacement, undo, Start Fresh, questions, drafts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import * as Web from '../www/js/engine/webextract.js';
import * as R from '../www/js/engine/rescue.js';
import { Recipe, Ingredient, Direction } from '../www/js/engine/models.js';

Web.setHtmlParser((html) => parseHTML(/<html[\s>]/i.test(html) ? html : `<html><head></head><body>${html}</body></html>`).document);
const imported = () => Recipe({ title: "Grandma's Bisquits", photo: 'p.jpg', servings: 8, cookMinutes: 15,
  ingredients: [Ingredient({ id: 'i1', text: '2 cups flour' }), Ingredient({ id: 'i2', text: '1 tbsp WRONG' }), Ingredient({ id: 'i3', text: '1/2 cup milk' })],
  directions: [Direction({ id: 'd1', text: 'Mix.' }), Direction({ id: 'd2', text: 'GARBLED STEP' }), Direction({ id: 'd3', text: 'Bake for 15 minutes.', timerSeconds: 900 })], notes: 'From the tin box.' });
const st = (r = imported()) => R.state(R.newDraft({ recipe: r }));
const rec = (s) => R.recipeOf(s);

test('selected lines are removed and everything else is kept', () => {
  const base = st(); const orig = rec(base);
  let s = R.toggle(base, 'i2'); s = R.toggle(s, 'd2'); s = R.removeSelected(s);
  assert.deepEqual(rec(s).ingredients.map((i) => i.id), ['i1', 'i3']); assert.deepEqual(rec(s).directions.map((d) => d.id), ['d1', 'd3']);
  assert.deepEqual([rec(s).photo, rec(s).cookMinutes, rec(s).servings], ['p.jpg', 15, 8]);
  assert.equal(s.selecting, false); assert.equal(s.selection.length, 0);
  s = R.undo(s); assert.deepEqual(rec(s), orig);
  s = R.redo(s); assert.equal(rec(s).ingredients.length, 2);
});
test('keep the photo and time but remove all ingredients and steps', () => {
  const base = st(); const orig = rec(base);
  let s = R.selectAllSteps(R.selectAllIngredients(base)); assert.equal(s.selection.length, 6);
  s = R.removeSelected(s);
  assert.ok(!rec(s).ingredients.length && !rec(s).directions.length);
  assert.equal(rec(s).photo, 'p.jpg'); assert.equal(rec(s).cookMinutes, 15); assert.equal(rec(s).title, "Grandma's Bisquits");
  assert.deepEqual(rec(R.undo(s)), orig, 'one undo restores the lot');
});
test('fields can be selected and removed too', () => {
  let s = R.toggle(R.toggle(R.toggle(st(), R.TITLE), R.NOTES), R.TIMES); s = R.removeSelected(s);
  assert.equal(rec(s).title, ''); assert.equal(rec(s).notes, ''); assert.equal(rec(s).cookMinutes, null); assert.equal(rec(s).ingredients.length, 3);
});
test('cancel selection changes nothing', () => {
  const base = st(); const s = R.cancelSelection(R.toggle(base, 'i1'));
  assert.deepEqual(rec(s), rec(base)); assert.equal(R.canUndo(s), false); assert.equal(s.selecting, false); assert.equal(s.selection.length, 0);
});
test('replace selected puts the new lines where the old ones were', () => {
  let s = R.toggle(st(), 'i2'); s = R.replaceSelected(s, '• 1 tbsp baking powder\n• 1 tsp salt');
  assert.deepEqual(rec(s).ingredients.map((i) => i.text), ['2 cups flour', '1 tbsp baking powder', '1 tsp salt', '1/2 cup milk']);
  assert.deepEqual(rec(s).ingredients.filter((i) => i.id.length === 2).map((i) => i.id), ['i1', 'i3']);
  s = R.toggle(s, 'd2'); s = R.replaceSelected(s, '2. Cut in the butter until\ncrumbly.\n3. Stir in the milk.');
  assert.deepEqual(rec(s).directions.map((d) => d.text), ['Mix.', 'Cut in the butter until crumbly.', 'Stir in the milk.', 'Bake for 15 minutes.']);
});
test('transfer keeps amounts, order and several lines at once', () => {
  let s = st(Recipe());
  s = R.addIngredients(s, '2 1/2 cups all-purpose flour\n☐ ½ teaspoon salt\n\n- 1 cup (2 sticks) butter, softened\nFor the glaze:');
  assert.deepEqual(rec(s).ingredients.map((i) => i.text), ['2 1/2 cups all-purpose flour', '½ teaspoon salt', '1 cup (2 sticks) butter, softened', 'For the glaze']);
  assert.deepEqual(rec(s).ingredients.map((i) => i.header), [false, false, false, true]);
  s = R.addSteps(s, '1. Heat the oven to 375 degrees.\n2. Bake for 12 minutes, until\ngolden at the edges.\n\nCool on a rack.');
  assert.deepEqual(rec(s).directions.map((d) => d.text), ['Heat the oven to 375 degrees.', 'Bake for 12 minutes, until golden at the edges.', 'Cool on a rack.']);
  assert.equal(rec(s).directions[1].timerSeconds, 720);
  s = R.setTitle(s, '\n  Brown Sugar Cookies \nby Aunt May'); assert.equal(rec(s).title, 'Brown Sugar Cookies');
  s = R.setServings(s, 'Makes 36 cookies'); assert.equal(rec(s).servings, 36);
  s = R.setTime(s, 'prep', 'Prep time: 20 minutes'); s = R.setTime(s, 'cook', '1 hr 10 min'); assert.equal(rec(s).prepMinutes, 20); assert.equal(rec(s).cookMinutes, 70);
  s = R.addNotes(s, 'Dough keeps 3 days.'); s = R.addNotes(s, 'Freezes well.'); assert.equal(rec(s).notes, 'Dough keeps 3 days.\nFreezes well.');
  const n = s.draft.undo.length; for (let i = 0; i < n; i++) s = R.undo(s);
  assert.equal(rec(s).ingredients.length, 0); assert.equal(rec(s).title, '', 'every transfer is one undo step');
});
test('text with no number never changes servings or times', () => {
  const s = st();
  assert.equal(R.setServings(s, 'serves a crowd'), s); assert.equal(R.setTime(s, 'cook', 'until done'), s); assert.equal(R.addIngredients(s, '  \n '), s);
});
test('start fresh clears fields, keeps what was chosen and can be undone', () => {
  const src = { kind: 'IMAGE', url: null, files: ['card.jpg'], text: '2 cups flour', capturedAt: 0, cleaned: [], dishPhoto: null };
  const orig = imported();
  let s = R.state(R.newDraft({ recipe: orig, source: src }));
  s = R.startFresh(s, [R.PHOTO, R.TIMES]);
  assert.equal(rec(s).title, ''); assert.ok(!rec(s).ingredients.length && !rec(s).directions.length); assert.equal(rec(s).notes, ''); assert.equal(rec(s).servings, null);
  assert.equal(rec(s).photo, 'p.jpg'); assert.equal(rec(s).cookMinutes, 15);
  assert.deepEqual(s.draft.source, src, 'the original is never touched');
  assert.deepEqual(rec(R.undo(s)), orig);
});
test('smart paste proposes and only fills what is empty', () => {
  const plan = R.planSmartPaste('Pancakes\nServes 4\nIngredients\n1 cup flour\n1 egg\nDirections\nMix and fry for 3 minutes.');
  assert.equal(plan.title, 'Pancakes'); assert.equal(plan.ingredients.length, 2); assert.equal(plan.directions.length, 1); assert.equal(plan.servings, 4);
  const before = st(); const orig = rec(before);
  const s = R.applySmartPaste(before, plan);
  assert.equal(rec(s).title, "Grandma's Bisquits", 'an existing title is not overwritten'); assert.equal(rec(s).servings, 8);
  assert.equal(rec(s).ingredients.length, 5); assert.equal(rec(s).directions.length, 4);
  assert.deepEqual(rec(R.undo(s)), orig); assert.equal(R.planSmartPaste('   ').isEmpty, true);
});
test('edit, move, header and delete a single line', () => {
  let s = R.editIngredient(st(), 'i2', ' 1 tbsp baking powder '); assert.equal(rec(s).ingredients[1].text, '1 tbsp baking powder');
  s = R.move(s, 'i3', -1); assert.deepEqual(rec(s).ingredients.map((i) => i.id), ['i1', 'i3', 'i2']);
  s = R.move(s, 'i1', -1); assert.deepEqual(rec(s).ingredients.map((i) => i.id), ['i1', 'i3', 'i2'], 'moving past the end does nothing');
  s = R.editStep(s, 'd1', 'Rest the dough for 30 minutes.'); assert.equal(rec(s).directions[0].timerSeconds, 1800);
  s = R.toggleHeader(s, 'd2'); assert.equal(rec(s).directions[1].header, true);
  s = R.remove(s, 'd2'); assert.equal(rec(s).directions.length, 2);
});
test('questions stay until resolved and are not undone by recipe undo', () => {
  let s = R.addHelp(st(), 'i3', 'Ask Mom whether this says 1 cup or 1/2 cup.');
  s = R.addHelp(s, 'source', 'What is this smudged word?', 0, 0.4, 0.72);
  assert.equal(R.openQuestions(s.draft), 2); assert.equal(R.helpFor(s, 'i3').length, 1);
  s = R.editIngredient(s, 'i3', '1 cup milk'); s = R.undo(s);
  assert.equal(R.openQuestions(s.draft), 2, 'undoing a recipe edit keeps the questions');
  s = R.resolveHelp(s, s.draft.helpNotes[0].id); assert.equal(R.openQuestions(s.draft), 1); assert.equal(R.helpFor(s, 'i3').length, 0);
  assert.equal(s.draft.helpNotes.length, 2, 'a resolved question is kept, not deleted');
  assert.equal(R.addHelp(s, 'i1', '   '), s);
});
test('a draft survives being written and read back', () => {
  let s = R.state(R.newDraft({ recipe: imported(), source: { kind: 'PDF', url: 'https://x.test/r', files: ['a.pdf'], text: 'text', capturedAt: 5, cleaned: [], dishPhoto: null }, findings: ['Possibly missing: 1 egg'], createdAt: 1, updatedAt: 2 }));
  s = R.removeSelected(R.toggle(s, 'i2')); s = R.addHelp(s, 'd2', 'Is this 350 or 450 degrees?');
  const back = JSON.parse(JSON.stringify(s.draft));
  assert.deepEqual(back, s.draft);
  assert.equal(rec(R.undo(R.state(back))).ingredients.length, 3, 'undo still works after reopening');
});
test('saving needs a title and some content and drops blank lines', () => {
  assert.equal(R.problems(Recipe()).length, 2); assert.equal(R.problems(imported()).length, 0);
  assert.equal(R.problems(Recipe({ title: 'T' })).length, 1); assert.equal(R.problems(Recipe({ title: 'T', directions: [Direction({ text: 'Stir.' })] })).length, 0);
  const c = R.cleaned({ ...imported(), title: '  T ', ingredients: [...imported().ingredients, Ingredient({ text: '  ' })] });
  assert.equal(c.title, 'T'); assert.equal(c.ingredients.length, 3);
});
test('history is bounded', () => {
  let s = st(); for (let i = 0; i < 100; i++) s = R.setNotes(s, `note ${i}`);
  assert.equal(s.draft.undo.length, 40);
});
test('page text gives one line per block without menus', () => {
  const t = R.pageText('<html><body><nav><li>Home</li></nav><h1>Stew</h1><ul><li><span>2</span><span>cups</span> stock</li><li>1 onion</li></ul><p>Brown the meat.</p><script>x()</script></body></html>');
  assert.deepEqual(t.split('\n'), ['Stew', '2 cups stock', '1 onion', 'Brown the meat.']);
});
