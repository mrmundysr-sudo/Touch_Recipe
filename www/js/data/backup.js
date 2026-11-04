// Port of core/backup/Backup.kt + data/BackupManager.kt. Same file format as the Android app (docs/BACKUP_FORMAT.md):
// a ZIP with data.json and photos/<file>.jpg; a bare data.json is also accepted.
import { zip, unzip } from './zip.js';
import { Recipe, Ingredient, Direction, GroceryItem } from '../engine/models.js';

export const FORMAT = 'touch-recipe-backup', VERSION = 1;
export class BackupException extends Error {}
const te = new TextEncoder(), td = new TextDecoder();

export function decode(text) {
  let f;
  try { f = JSON.parse(text); } catch { throw new BackupException('This file is not a Touch Recipe backup, or it is damaged.'); }
  if (!f || typeof f !== 'object' || Array.isArray(f)) throw new BackupException('This file is not a Touch Recipe backup, or it is damaged.');
  if (f.format !== FORMAT) throw new BackupException('This file is not a Touch Recipe backup.');
  if ((f.version ?? 1) > VERSION) throw new BackupException('This backup was made by a newer version of Touch Recipe. Please update the app first.');
  return {
    format: f.format, version: f.version ?? 1, exportedAt: f.exportedAt ?? 0, appVersion: f.appVersion ?? '',
    recipes: (f.recipes ?? []).map((r) => ({ ...Recipe(r), ingredients: (r.ingredients ?? []).map((i) => Ingredient(i)), directions: (r.directions ?? []).map((d) => Direction(d)), categoryIds: r.categoryIds ?? [] })),
    categories: f.categories ?? [], mealPlan: f.mealPlan ?? [], groceryItems: (f.groceryItems ?? []).map((g) => GroceryItem(g)), preferences: f.preferences ?? {},
  };
}
export const encode = (file) => JSON.stringify(file, null, 2);

export class BackupManager {
  constructor({ repo, photos, prefs, appVersion = '1.0.0', clock = () => Date.now() }) { Object.assign(this, { repo, photos, prefs, appVersion, clock }); }
  snapshot() {
    const s = this.repo.snapshot();
    return { format: FORMAT, version: VERSION, exportedAt: this.clock(), appVersion: this.appVersion, recipes: Object.values(s.recipes), categories: s.categories, mealPlan: Object.values(s.meals), groceryItems: s.grocery, preferences: this.prefs.exportable() };
  }
  /** -> {bytes:Uint8Array, recipes:number} */
  async exportZip(withPhotos = true) {
    const file = this.snapshot();
    const entries = [{ name: 'data.json', data: encode(file) }];
    if (withPhotos) for (const name of [...new Set(file.recipes.map((r) => r.photo).filter(Boolean))]) {
      const b = await this.photos.blob(name);
      if (b) entries.push({ name: `photos/${name}`, data: new Uint8Array(await b.arrayBuffer()) });
    }
    return { bytes: zip(entries), recipes: file.recipes.length };
  }
  exportRecipesJson() {
    const file = { ...this.snapshot(), categories: [], mealPlan: [], groceryItems: [], preferences: {} };
    return { text: encode(file), recipes: file.recipes.length };
  }
  /** Reads and validates the whole backup before touching any existing data. mode: 'MERGE' | 'REPLACE'. */
  async restore(bytes, mode) {
    if (bytes.length > 400 * 1024 * 1024) throw new BackupException('This backup is too large.');
    let json = null; const photoData = new Map();
    if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4B) {
      let entries; try { entries = await unzip(bytes); } catch { throw new BackupException('This file is not a Touch Recipe backup, or it is damaged.'); }
      for (const e of entries) {
        if (e.name === 'data.json') json = td.decode(e.data);
        else if (e.name.startsWith('photos/') && !e.name.includes('..') && e.name.length > 7) photoData.set(e.name.slice(7), e.data);
      }
    } else json = td.decode(bytes);
    const file = decode(json ?? (() => { throw new BackupException('This archive has no recipe data.'); })());

    const st = this.repo.snapshot();
    if (mode === 'REPLACE') { st.recipes = {}; st.meals = {}; st.grocery = []; st.cook = {}; }
    let photoCount = 0;
    for (const [name, data] of photoData) {
      if (name.endsWith('.jpg') && !name.includes('/') && !(await this.photos.exists(name))) { await this.photos.backend.putPhoto(name, new Blob([data], { type: 'image/jpeg' })); photoCount++; }
    }
    if (file.categories.length) {
      const existing = new Map(st.categories.map((c) => [c.id, c]));
      const byId = new Map(st.categories.map((c) => [c.id, c]));
      for (const c of file.categories) byId.set(c.id, mode === 'MERGE' && existing.get(c.id) ? { ...existing.get(c.id), enabled: existing.get(c.id).enabled || c.enabled } : c);
      st.categories = [...byId.values()];
    }
    for (const r of file.recipes) { const have = st.recipes[r.id]; if (mode === 'REPLACE' || !have || have.updatedAt < r.updatedAt) st.recipes[r.id] = r; }
    for (const m of file.mealPlan) st.meals[m.date] = m;
    for (const g of file.groceryItems) { const i = st.grocery.findIndex((x) => x.id === g.id); if (i >= 0) st.grocery[i] = g; else st.grocery.push(g); }
    await this.repo.replaceAll(st);
    if (mode === 'REPLACE') this.prefs.restore(file.preferences);
    return { recipes: file.recipes.length, categories: file.categories.length, meals: file.mealPlan.length, groceries: file.groceryItems.length, photos: photoCount };
  }
}

export const toB64 = (bytes) => { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); };

/** Saves/shares a file: iOS share sheet (Save to Files, AirDrop, …) when native; a download in a plain browser. */
export async function saveFile(name, bytesOrText, mime) {
  const bytes = typeof bytesOrText === 'string' ? te.encode(bytesOrText) : bytesOrText;
  const cap = globalThis.Capacitor;
  const fs = cap?.Plugins?.Filesystem, share = cap?.Plugins?.Share;
  if (cap?.isNativePlatform?.() && fs && share) {
    const r = await fs.writeFile({ path: name, data: toB64(bytes), directory: 'CACHE' });
    await share.share({ title: name, url: r.uri, dialogTitle: 'Save your backup' });
    return true;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}
