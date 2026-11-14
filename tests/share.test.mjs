import test from 'node:test';
import assert from 'node:assert/strict';
import { Repository, MemoryBackend } from '../www/js/data/repo.js';
import { PhotoStore } from '../www/js/data/photos.js';
import { buildShare, parseShare, importShared, findDuplicate, classify } from '../www/js/data/share.js';
import { BackupException } from '../www/js/data/backup.js';
import { Recipe, Ingredient, Direction } from '../www/js/engine/models.js';

let clock = 1000;
const mk = async () => { const be = new MemoryBackend(); const repo = await new Repository(be, () => (clock += 10)).init(); return { repo, photos: new PhotoStore(be), be }; };
const rec = (id, title, o = {}) => Recipe({ id, title, servings: 4, prepMinutes: 15, cookMinutes: 40, course: 'Main', notes: 'n', sourceUrl: 'https://x.com/a?utm=1', sourceName: 'x.com', photo: o.photo ?? null, photoFrame: o.photo ? { zoom: 1.5 } : null,
  ingredients: [Ingredient({ text: '1 lb pasta' }), Ingredient({ text: 'Sauce', header: true }), Ingredient({ text: '2 cloves garlic' })], directions: [Direction({ text: 'Boil.', timerSeconds: 600 })], ...o });
const putPhoto = (a, name) => a.be.putPhoto(name, new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }));

test('share: round trip keeps every field and the photo, with new ids', async () => {
  const a = await mk(); await putPhoto(a, 'p1.jpg'); await a.repo.saveRecipe(rec('r1', 'Spaghetti', { photo: 'p1.jpg' })); await a.repo.saveRecipe(rec('r2', 'Salad'));
  const s = await buildShare(a, ['r1', 'r2']); assert.equal(s.count, 2); assert.match(s.name, /\.touchrecipe$/);
  const b = await mk(); const parsed = await parseShare(s.bytes); const res = await importShared(b, parsed);
  assert.equal(res.added, 2); const got = b.repo.recipes().find((r) => r.title === 'Spaghetti'); const orig = a.repo.recipe('r1');
  for (const k of ['title', 'servings', 'prepMinutes', 'cookMinutes', 'course', 'notes', 'sourceUrl', 'sourceName', 'photoFrame', 'photo']) assert.deepEqual(got[k], orig[k], k);
  assert.deepEqual(got.ingredients.map((i) => [i.text, i.header]), orig.ingredients.map((i) => [i.text, i.header]));
  assert.deepEqual(got.directions.map((d) => [d.text, d.timerSeconds]), orig.directions.map((d) => [d.text, d.timerSeconds]));
  assert.notEqual(got.id, 'r1'); assert.ok(await b.photos.exists('p1.jpg'));
});
test('share: the sender keeps everything untouched', async () => {
  const a = await mk(); await a.repo.saveRecipe(rec('r1', 'A')); const before = JSON.stringify(a.repo.recipe('r1')); await buildShare(a, ['r1']); assert.equal(JSON.stringify(a.repo.recipe('r1')), before);
});
test('share: duplicates are found by id, or by title + source, never by title alone when sources differ', async () => {
  const mine = [rec('m1', 'Spaghetti')];
  assert.ok(findDuplicate(rec('m1', 'Other'), mine)); assert.ok(findDuplicate(rec('z', ' spaghetti '), mine));
  assert.equal(findDuplicate(rec('z', 'Spaghetti', { sourceUrl: 'https://other.com/b' }), mine), null);
  assert.equal(findDuplicate(rec('z', 'Soup'), mine), null);
  assert.ok(findDuplicate(rec('z', 'Spaghetti', { sourceUrl: 'http://www.x.com/a/' }), mine));
  const noUrl = [rec('m2', 'Toast', { sourceUrl: null })]; assert.ok(findDuplicate(rec('q', 'Toast', { sourceUrl: null }), noUrl));
  assert.equal(findDuplicate(rec('q', 'Toast', { sourceUrl: null, ingredients: [] }), noUrl), null);
  assert.equal(classify([rec('z', 'Soup')], mine)[0].dup, null);
});
test('share: duplicate choices - skip (default), copy, replace + undo; others are added', async () => {
  const a = await mk(); await a.repo.saveRecipe(rec('r1', 'Spaghetti', { notes: 'sender version' })); await a.repo.saveRecipe(rec('r2', 'Salad'));
  const parsed = await parseShare((await buildShare(a, ['r1', 'r2'])).bytes);
  const b = await mk(); await b.repo.saveRecipe(rec('x1', 'Spaghetti', { notes: 'mine', favorite: true }));
  const skip = await importShared(b, parsed, {}); assert.deepEqual([skip.added, skip.skipped], [1, 1]); assert.equal(b.repo.recipes().length, 2);
  const id = parsed.recipes[0].id;
  const copy = await importShared(b, parsed, { [id]: 'copy' }); assert.equal(copy.copied, 1); assert.ok(b.repo.recipes().some((r) => r.title === 'Spaghetti (shared)'));
  assert.equal(b.repo.recipe('x1').notes, 'mine');
  const rep = await importShared(b, parsed, { [id]: 'replace' }); assert.equal(rep.replaced, 1); assert.equal(b.repo.recipe('x1').notes, 'sender version'); assert.equal(b.repo.recipe('x1').favorite, true);
  await rep.undo(); assert.equal(b.repo.recipe('x1').notes, 'mine');
  const n = b.repo.recipes().length; const again = await importShared(b, parsed, { [id]: 'skip' }); await again.undo(); assert.equal(b.repo.recipes().length, n);
});
test('share: undo removes what was added', async () => {
  const a = await mk(); await a.repo.saveRecipe(rec('r1', 'A')); const parsed = await parseShare((await buildShare(a, ['r1'])).bytes);
  const b = await mk(); const r = await importShared(b, parsed); assert.equal(b.repo.recipes().length, 1); await r.undo(); assert.equal(b.repo.recipes().length, 0);
});
test('share: a photo the receiver already has is copied under a new name for a copy', async () => {
  const a = await mk(); await putPhoto(a, 'p1.jpg'); await a.repo.saveRecipe(rec('r1', 'A', { photo: 'p1.jpg' }));
  const parsed = await parseShare((await buildShare(a, ['r1'])).bytes); await importShared(a, parsed, { r1: 'copy' });
  const c = a.repo.recipes().find((r) => r.title === 'A (shared)'); assert.ok(c.photo && c.photo !== 'p1.jpg'); assert.ok(await a.photos.exists(c.photo));
});
test('share: bad files change nothing and say so', async () => {
  for (const bytes of [new Uint8Array(0), new TextEncoder().encode('hello'), new TextEncoder().encode('{"format":"other"}'), new TextEncoder().encode('{"format":"touch-recipe-backup","version":99,"recipes":[]}'), new TextEncoder().encode('{"format":"touch-recipe-backup","version":1,"recipes":[]}'), new Uint8Array([0x50, 0x4B, 1, 2, 3, 4, 5])])
    await assert.rejects(parseShare(bytes), BackupException);
  const a = await mk(); await assert.rejects(buildShare(a, ['nope']), BackupException);
});
