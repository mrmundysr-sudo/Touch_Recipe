// Unfinished recipes and kept originals (port of the Android DraftStore tests).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBackend } from '../www/js/data/repo.js';
import { DraftStore } from '../www/js/data/drafts.js';
import { ImportService } from '../www/js/data/importer.js';
import * as R from '../www/js/engine/rescue.js';
import { Recipe } from '../www/js/engine/models.js';

let t = 100; const mk = () => new DraftStore(new MemoryBackend(), () => (t += 10));
const draft = (title, source) => R.newDraft({ recipe: Recipe({ title }), source: source || R.emptySource() });

test('drafts: save, list newest first, reopen unchanged', async () => {
  const s = mk(); const a = await s.save(draft('A')); await s.save(draft('B'));
  assert.deepEqual((await s.list()).map((d) => d.recipe.title), ['B', 'A']);
  assert.equal((await s.get(a.id)).recipe.title, 'A'); assert.equal(await s.count(), 2);
});
test('drafts: edit history survives a save and reload', async () => {
  const s = mk(); let st = R.state(draft('X')); st = R.addIngredients(st, '2 cups flour\n1 egg'); st = R.setTitle(st, 'Pancakes');
  await s.save(st.draft); const back = R.state(await s.get(st.draft.id));
  assert.equal(R.canUndo(back), true); assert.equal(R.undo(back).draft.recipe.title, 'X');
});
test('drafts: discard removes its original files', async () => {
  const s = mk(); const f = await s.saveFile(new Blob(['x']), 'jpg'); const d = await s.save(draft('A', { ...R.emptySource(), kind: 'IMAGE', files: [f] }));
  assert.ok(await s.file(f)); await s.discard(d.id); assert.equal(await s.file(f), null); assert.equal(await s.count(), 0);
});
test('drafts: turning a draft into a recipe keeps the original with the recipe', async () => {
  const s = mk(); const f = await s.saveFile(new Blob(['page']), 'jpg');
  const d = await s.save(draft('A', { ...R.emptySource(), kind: 'IMAGE', files: [f], text: 'line' })); await s.markDone(d.id, 'recipe-1');
  assert.equal(await s.count(), 0); const o = await s.forRecipe('recipe-1'); assert.equal(o.source.kind, 'IMAGE'); assert.ok(await s.file(f));
  await s.unlink('recipe-1'); assert.equal(await s.forRecipe('recipe-1'), null); assert.equal(await s.file(f), null);
});
test('drafts: links never show up as unfinished recipes', async () => {
  const s = mk(); await s.link('r9', { ...R.emptySource(), kind: 'TEXT', text: 'hello' }, []); assert.equal(await s.count(), 0); assert.equal((await s.allLinked()).length, 1);
});
test('import: text import keeps the pasted text as the original', async () => {
  const imp = new ImportService({ photos: null, originals: mk(), clock: () => 5 });
  const d = await imp.import({ type: 'text', text: 'Pancakes\nIngredients\n2 cups flour\nMethod\nMix.' });
  assert.equal(d.source.kind, 'TEXT'); assert.ok(d.source.text.includes('2 cups flour')); assert.equal(d.source.capturedAt, 5);
});
