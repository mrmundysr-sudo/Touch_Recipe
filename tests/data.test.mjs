// Repository, backup and ZIP tests (ports of DataTest, with the same expectations where they apply).
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { Repository, MemoryBackend } from '../www/js/data/repo.js';
import { Prefs, MemoryStorage } from '../www/js/data/prefs.js';
import { BackupManager, BackupException, decode, encode } from '../www/js/data/backup.js';
import { zip, unzip, crc32 } from '../www/js/data/zip.js';
import { Recipe, Ingredient, Direction } from '../www/js/engine/models.js';

let clock = 1000;
const mk = async () => new Repository(new MemoryBackend(), () => (clock += 10)).init();
const sample = (id = 'r1', title = 'Spaghetti') => Recipe({ id, title, servings: 4, ingredients: [Ingredient({ id: 'i1', text: '1 lb spaghetti' }), Ingredient({ id: 'i2', text: '2 cloves garlic' }), Ingredient({ id: 'i3', text: '1 can tomatoes' })], directions: [Direction({ id: 'd1', text: 'Boil 9 minutes.', timerSeconds: 540 })] });
const WEEK = '2026-11-02';

test('repo: seeds categories once; recipes keep createdAt and bump updatedAt', async () => {
  const r = await mk(); assert.ok(r.categories().length > 50); assert.equal(r.categories().filter((c) => c.enabled).length, 9);
  const a = await r.saveRecipe(sample()); const b = await r.saveRecipe({ ...a, title: 'Changed' });
  assert.equal(b.createdAt, a.createdAt); assert.ok(b.updatedAt > a.updatedAt); assert.equal(r.recipe('r1').title, 'Changed');
  await r.ensureSeeded(); assert.ok(r.categories().length > 50);
});
test('repo: ticking an ingredient is not an edit (updatedAt is kept)', async () => {
  const r = await mk(); const a = await r.saveRecipe(sample());
  await r.updateIngredients('r1', (l) => l.map((i) => (i.id === 'i1' ? { ...i, checked: true } : i)));
  assert.equal(r.recipe('r1').updatedAt, a.updatedAt); assert.ok(r.recipe('r1').ingredients[0].checked);
});
test('repo: delete cascades to meals and cook state; restore brings the recipe back', async () => {
  const r = await mk(); await r.saveRecipe(sample()); await r.assignMeal('2026-11-03', 'r1', 4); await r.saveCookSession({ recipeId: 'r1', stepIndex: 0, completed: [], timer: { totalMs: 0, remainingMs: 0, endAtMs: null }, timerStep: 0, finished: false });
  const gone = await r.deleteRecipe('r1'); assert.equal(r.recipe('r1'), null); assert.equal(r.meals(WEEK, '2026-11-08').length, 0); assert.equal(r.cookSession('r1'), null);
  await r.restoreRecipe(gone); assert.equal(r.recipe('r1').title, 'Spaghetti');
});
test('repo: custom categories - add, rename, enable, delete strips recipes', async () => {
  const r = await mk(); const [res, id] = await r.addCustomCategoryReturningId('Potluck Hits'); assert.ok(res.ok);
  assert.equal((await r.addCustomCategory('potluck hits')).ok, false);
  await r.saveRecipe({ ...sample(), categoryIds: [id, 'b_dinner'] });
  assert.equal(r.recipesUsingCategory(id), 1);
  assert.equal((await r.renameCategory(id, 'Potluck Stars')).ok, true); assert.equal((await r.renameCategory('b_dinner', 'X')).ok, false);
  assert.equal(await r.deleteCustomCategory(id), 1); assert.deepEqual(r.recipe('r1').categoryIds, ['b_dinner']);
  assert.equal(await r.deleteCustomCategory('b_dinner'), 0);
});
test('repo: meals by week and grocery generation from planned meals', async () => {
  const r = await mk(); await r.saveRecipe(sample()); await r.assignMeal('2026-11-03', 'r1', 8); await r.assignMeal('2026-11-20', 'r1', 4);
  assert.equal(r.meals(WEEK, '2026-11-08').length, 1);
  assert.equal(await r.generateGroceries(WEEK), 1);
  const items = r.groceryItems(WEEK); assert.equal(items.length, 3);
  assert.equal(items.find((i) => i.name.startsWith('Spaghetti')).quantityText, '2 lb');   // scaled 4 -> 8
  assert.ok(items.find((i) => i.name.startsWith('Garlic')).generated);
});
test('repo: manual grocery items - dedupe, check, clear with undo, reorder', async () => {
  const r = await mk();
  const milk = await r.addGroceryItem(WEEK, 'Milk', '1 l', 'dairy'); const again = await r.addGroceryItem(WEEK, 'milk', '', 'dairy'); assert.equal(again.id, milk.id);
  await r.addGroceryItem(WEEK, 'Eggs', '', 'dairy'); await r.addGroceryItem(WEEK, 'Bread', '', 'bakery');
  assert.equal(await r.addGroceryItem(WEEK, '   ', '', 'dairy'), null);
  await r.updateGroceryItem({ ...milk, checked: true });
  const removed = await r.clearChecked(WEEK); assert.deepEqual(removed.map((i) => i.name), ['Milk']); assert.equal(r.groceryItems(WEEK).length, 2);
  await r.restoreGroceryItems(removed); assert.equal(r.groceryItems(WEEK).length, 3);
  const ids = r.groceryItems(WEEK).filter((i) => i.aisle === 'dairy').map((i) => i.id).reverse();
  await r.reorderGrocery(WEEK, 'dairy', ids); assert.deepEqual(r.groceryItems(WEEK).filter((i) => i.aisle === 'dairy').map((i) => i.id), ids);
});
test('repo: custom aisles - rules and deleting moves items to Pantry', async () => {
  const r = await mk(); assert.equal(await r.addAisle('Pet food'), true); assert.equal(await r.addAisle('pet food'), false); assert.equal(await r.addAisle('Bakery'), false); assert.equal(await r.addAisle('x'.repeat(31)), false);
  await r.addGroceryItem(WEEK, 'Kibble', '', 'Pet food'); await r.deleteAisle('Pet food', WEEK);
  assert.equal(r.groceryItems(WEEK)[0].aisle, 'pantry'); assert.deepEqual(r.customAisles(), []);
});
test('repo: adding a recipe\'s ingredients merges with what is on the list', async () => {
  const r = await mk(); const rec = await r.saveRecipe(sample());
  assert.equal(await r.addIngredientsToGroceries(WEEK, rec, 4), 3);
  assert.equal(await r.addIngredientsToGroceries(WEEK, rec, 4), 0);                       // same recipe twice adds nothing
  const other = await r.saveRecipe({ ...sample('r2', 'Other'), ingredients: [Ingredient({ text: '1 lb spaghetti' })] });
  assert.equal(await r.addIngredientsToGroceries(WEEK, other, 4), 1);
  assert.equal(r.groceryItems(WEEK).find((i) => i.name.startsWith('Spaghetti')).quantityText, '2 lb');
});
test('repo: cook session - active is the newest unfinished', async () => {
  const r = await mk(); const t = { totalMs: 0, remainingMs: 0, endAtMs: null };
  await r.saveCookSession({ recipeId: 'a', stepIndex: 1, completed: [0], timer: t, timerStep: 0, finished: false });
  await r.saveCookSession({ recipeId: 'b', stepIndex: 0, completed: [], timer: t, timerStep: 0, finished: false });
  assert.equal(r.activeCookSession().recipeId, 'b');
  await r.saveCookSession({ recipeId: 'b', stepIndex: 0, completed: [], timer: t, timerStep: 0, finished: true });
  assert.equal(r.activeCookSession().recipeId, 'a');
});
test('repo: persists through the backend and notifies subscribers', async () => {
  const backend = new MemoryBackend(); const r = await new Repository(backend).init(); let n = 0; r.subscribe(() => n++);
  await r.saveRecipe(sample()); await r.flush(); assert.ok(n >= 1);
  const again = await new Repository(backend).init(); assert.equal(again.recipe('r1').title, 'Spaghetti');
});

test('zip: stored round trip with crc and unicode names', async () => {
  const data = new TextEncoder().encode('{"hello":"wörld"}'); const photo = Uint8Array.from({ length: 5000 }, (_, i) => i % 251);
  const out = await unzip(zip([{ name: 'data.json', data }, { name: 'photos/ä.jpg', data: photo }]));
  assert.deepEqual(out.map((e) => e.name), ['data.json', 'photos/ä.jpg']); assert.deepEqual([...out[1].data], [...photo]); assert.equal(new TextDecoder().decode(out[0].data), '{"hello":"wörld"}');
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});
test('zip: reads deflate entries (what Android backups contain)', async () => {
  const raw = new TextEncoder().encode('x'.repeat(2000) + 'deflate me'); const comp = zlib.deflateRawSync(raw); const name = new TextEncoder().encode('data.json');
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc32(raw), 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
  const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 8); eo.writeUInt16LE(1, 10); eo.writeUInt32LE(46 + name.length, 12); eo.writeUInt32LE(30 + name.length + comp.length, 16);
  const file = new Uint8Array(Buffer.concat([lh, Buffer.from(name), comp, cd, Buffer.from(name), eo]));
  const [e] = await unzip(file); assert.equal(e.name, 'data.json'); assert.deepEqual([...e.data], [...raw]);
  await assert.rejects(() => unzip(new Uint8Array([1, 2, 3])));
});

const fakePhotos = () => { const m = new Map(); return { backend: { putPhoto: async (n, b) => m.set(n, b) }, blob: async (n) => m.get(n) ?? null, exists: async (n) => m.has(n), m }; };
async function setup() { const repo = await mk(); const photos = fakePhotos(); const prefs = new Prefs(new MemoryStorage()); return { repo, photos, prefs, mgr: new BackupManager({ repo, photos, prefs, clock: () => 5 }) }; }

test('backup: round trip through a ZIP with photos and every data type', async () => {
  const a = await setup(); await a.repo.saveRecipe({ ...sample(), photo: 'p1.jpg', categoryIds: ['b_dinner'] }); a.photos.m.set('p1.jpg', new Blob([new Uint8Array([1, 2, 3])]));
  await a.repo.assignMeal('2026-11-03', 'r1', 6); await a.repo.addGroceryItem(WEEK, 'Milk', '1 l', 'dairy'); a.prefs.setTheme('GARDEN');
  const { bytes, recipes } = await a.mgr.exportZip(); assert.equal(recipes, 1);
  const b = await setup(); b.prefs.setTheme('LIGHT');
  const s = await b.mgr.restore(bytes, 'REPLACE');
  assert.deepEqual(s, { recipes: 1, categories: a.repo.categories().length, meals: 1, groceries: 1, photos: 1 });
  assert.equal(b.repo.recipe('r1').title, 'Spaghetti'); assert.equal(b.repo.meals(WEEK, '2026-11-08')[0].servings, 6); assert.equal(b.repo.groceryItems(WEEK)[0].name, 'Milk'); assert.equal(b.prefs.theme, 'GARDEN'); assert.ok(b.photos.m.has('p1.jpg'));
});
test('backup: merge keeps newer local recipes; replace swaps everything', async () => {
  const a = await setup(); await a.repo.saveRecipe(sample('r1', 'Old title')); const { bytes } = await a.mgr.exportZip();
  const b = await setup(); await b.repo.saveRecipe(sample('r1', 'Newer local')); await b.repo.saveRecipe(sample('r2', 'Only local'));
  await b.mgr.restore(bytes, 'MERGE'); assert.equal(b.repo.recipe('r1').title, 'Newer local'); assert.ok(b.repo.recipe('r2'));
  await b.mgr.restore(bytes, 'REPLACE'); assert.equal(b.repo.recipe('r1').title, 'Old title'); assert.equal(b.repo.recipe('r2'), null);
});
test('backup: validation never touches data when the file is bad', async () => {
  const a = await setup(); await a.repo.saveRecipe(sample());
  for (const bad of ['not json', '{"format":"other","version":1,"exportedAt":1}', '{"format":"touch-recipe-backup","version":99,"exportedAt":1}', '[1,2]'])
    await assert.rejects(() => a.mgr.restore(new TextEncoder().encode(bad), 'REPLACE'), BackupException);
  await assert.rejects(() => a.mgr.restore(new Uint8Array([0x50, 0x4B, 1, 2, 3, 4, 5, 6]), 'REPLACE'), BackupException);
  assert.equal(a.repo.recipeCount(), 1);
});
test('backup: a recipes-only JSON export restores too', async () => {
  const a = await setup(); await a.repo.saveRecipe(sample()); const { text } = a.mgr.exportRecipesJson(); assert.equal(decode(text).categories.length, 0);
  const b = await setup(); const s = await b.mgr.restore(new TextEncoder().encode(text), 'MERGE'); assert.equal(s.recipes, 1); assert.equal(b.repo.recipe('r1').title, 'Spaghetti');
});
test('backup: reads a file in the Android format (field names and defaults)', async () => {
  const android = JSON.stringify({ format: 'touch-recipe-backup', version: 1, exportedAt: 5, appVersion: '1.0.0',
    recipes: [{ id: 'a', title: 'T', description: '', notes: '', photo: null, sourceUrl: null, sourceName: null, cuisine: null, prepMinutes: null, cookMinutes: null, totalMinutes: null, servings: null,
      ingredients: [{ id: 'x', text: '1 egg', header: false, checked: false }], directions: [{ id: 'y', text: 'Go', timerSeconds: 30, header: false, image: null }], categoryIds: [], favorite: false, rawSource: null, createdAt: 0, updatedAt: 0 }],
    categories: [{ id: 'b_dinner', name: 'Dinner', group: 'Meal and course', builtIn: true, enabled: true, sortOrder: 3 }], mealPlan: [{ date: '2026-10-30', recipeId: 'a', servings: 4 }],
    groceryItems: [{ id: 'g', weekStart: '2026-10-26', name: 'Egg', quantityText: '', aisle: 'dairy', checked: false, sortIndex: 0, key: '', generated: false, edited: false, sources: [] }], preferences: { theme: 'DARK' } });
  const f = decode(android); assert.equal(f.recipes[0].directions[0].timerSeconds, 30); assert.equal(f.mealPlan[0].servings, 4); assert.equal(f.preferences.theme, 'DARK');
  assert.deepEqual(JSON.parse(encode(f)).recipes[0].ingredients[0], { id: 'x', text: '1 egg', header: false, checked: false });
});
test('prefs: defaults, round trip and glow plays', () => {
  const p = new Prefs(new MemoryStorage()); assert.equal(p.theme, 'SYSTEM'); assert.equal(p.textSize, 'LARGE'); assert.equal(p.glowGuide, true); assert.equal(p.keepAwake, true); assert.equal(p.sundayStart, false);
  p.setTheme('BERRY'); p.setSundayStart(true); assert.deepEqual(p.exportable().theme, 'BERRY'); p.restore({ theme: 'nope', text_size: 'XLARGE' }); assert.equal(p.theme, 'BERRY'); assert.equal(p.textSize, 'XLARGE');
  assert.equal(p.glowPlays('hub'), 0); p.markGlowPlayed('hub'); p.markGlowPlayed('hub'); assert.equal(p.glowPlays('hub'), 2); p.resetGlow(); assert.equal(p.glowPlays('hub'), 0);
  p.saveTimers([{ id: 't', name: 'a', totalMs: 1, remainingMs: 1, endAtMs: null }]); assert.equal(new Prefs(p.sp).timers.length, 1);
});
