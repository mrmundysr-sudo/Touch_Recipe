// App-to-app sharing: a .touchrecipe file is the normal backup file (docs/BACKUP_FORMAT.md) holding only the chosen recipes and their photos,
// marked `kind: "share"`. Receiving NEVER overwrites on its own: every incoming recipe is added as a new recipe unless the person chooses otherwise.
import { zip, unzip } from './zip.js';
import { decode, encode, FORMAT, VERSION, BackupException } from './backup.js';
import { newId } from '../engine/models.js';

export const SHARE_EXT = 'touchrecipe', MAX_BYTES = 400 * 1024 * 1024;
const te = new TextEncoder(), td = new TextDecoder();
const BAD = 'This file is not a Touch Recipe share, or it is damaged.';

/** -> { bytes, count, name } for the recipes with these ids (in the given order), photos included. */
export async function buildShare({ repo, photos, appVersion = '', clock = () => Date.now() }, ids) {
  const recipes = ids.map((id) => repo.recipe(id)).filter(Boolean);
  if (!recipes.length) throw new BackupException('Choose at least one recipe to send.');
  const file = { format: FORMAT, version: VERSION, kind: 'share', exportedAt: clock(), appVersion, recipes, categories: [], mealPlan: [], groceryItems: [], preferences: {} };
  const entries = [{ name: 'data.json', data: te.encode(encode(file)) }];
  for (const name of new Set(recipes.map((r) => r.photo).filter(Boolean))) {
    const b = await photos.blob(name);
    if (b) entries.push({ name: `photos/${name}`, data: new Uint8Array(await b.arrayBuffer()) });
  }
  const first = (recipes[0].title || 'recipe').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'recipe';
  return { bytes: zip(entries), count: recipes.length, name: `${recipes.length === 1 ? first : `${recipes.length}-recipes`}.${SHARE_EXT}` };
}

/** Reads and validates a whole share file without touching anything. -> { recipes, photoData: Map(name -> bytes) } */
export async function parseShare(bytes) {
  if (!bytes || !bytes.length) throw new BackupException(BAD);
  if (bytes.length > MAX_BYTES) throw new BackupException('This file is too large.');
  let json = null; const photoData = new Map();
  if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4B) {
    let entries; try { entries = await unzip(bytes); } catch { throw new BackupException(BAD); }
    for (const e of entries) {
      if (e.name === 'data.json') json = td.decode(e.data);
      else if (e.name.startsWith('photos/') && !e.name.includes('..') && e.name.length > 7) photoData.set(e.name.slice(7), e.data);
    }
  } else json = td.decode(bytes);
  if (json == null) throw new BackupException(BAD);
  const file = decode(json);
  if (!file.recipes.length) throw new BackupException('This file has no recipes in it.');
  return { recipes: file.recipes, photoData };
}

const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const normUrl = (u) => norm(u).replace(/^https?:\/\/(www\.)?/, '').replace(/[#?].*$/, '').replace(/\/$/, '');
const ingCount = (r) => (r.ingredients || []).filter((i) => !i.header).length;
/** The recipe already here that this incoming one duplicates, or null: same id, or same title and same source (same ingredient count when there is no source link). */
export function findDuplicate(incoming, existing) {
  const list = Array.isArray(existing) ? existing : Object.values(existing);
  const byId = list.find((r) => r.id === incoming.id); if (byId) return byId;
  const t = norm(incoming.title); if (!t) return null;
  const u = normUrl(incoming.sourceUrl);
  return list.find((r) => norm(r.title) === t && (u ? normUrl(r.sourceUrl) === u : !normUrl(r.sourceUrl) && ingCount(r) === ingCount(incoming))) || null;
}
/** -> [{ recipe, dup }] */
export const classify = (recipes, existing) => recipes.map((recipe) => ({ recipe, dup: findDuplicate(recipe, existing) }));

/**
 * Applies the person's choices. choices: Map or object recipeId -> 'add' | 'copy' | 'skip' | 'replace' (a duplicate defaults to 'skip' when nothing is chosen;
 * a recipe that is not a duplicate is always added). Returns { added, copied, replaced, skipped, undo() }; undo() removes what was added and puts replaced recipes back.
 */
export async function importShared({ repo, photos }, parsed, choices = {}) {
  const get = (id) => (choices instanceof Map ? choices.get(id) : choices[id]);
  const rows = classify(parsed.recipes, repo.recipes());
  const addedIds = [], replaced = []; let copied = 0, skipped = 0;
  const putPhoto = async (name, wantNew) => {
    if (!name) return null; const bytes = parsed.photoData.get(name);
    const have = await photos.exists(name);
    if (!bytes) return have ? name : null;
    if (have && !wantNew) return name;
    const out = have ? `${newId()}.jpg` : name;
    await photos.backend.putPhoto(out, new Blob([bytes], { type: 'image/jpeg' })); return out;
  };
  for (const { recipe, dup } of rows) {
    const choice = dup ? (get(recipe.id) || 'skip') : 'add';
    if (choice === 'skip') { skipped++; continue; }
    if (choice === 'replace' && dup) {
      replaced.push(dup);
      const photo = await putPhoto(recipe.photo, true);
      await repo.saveRecipe({ ...recipe, id: dup.id, createdAt: dup.createdAt, favorite: dup.favorite, photo });
    } else {
      const photo = await putPhoto(recipe.photo, true);
      const r = { ...recipe, id: newId(), createdAt: 0, photo, favorite: false, title: choice === 'copy' ? `${recipe.title} (shared)` : recipe.title,
        ingredients: (recipe.ingredients || []).map((i) => ({ ...i, id: newId() })), directions: (recipe.directions || []).map((d) => ({ ...d, id: newId() })) };
      const saved = await repo.saveRecipe(r); addedIds.push(saved.id); if (choice === 'copy') copied++;
    }
  }
  return {
    added: addedIds.length, copied, replaced: replaced.length, skipped,
    async undo() { for (const id of addedIds) await repo.deleteRecipe(id); for (const r of replaced) await repo.restoreRecipe(r); },
  };
}
