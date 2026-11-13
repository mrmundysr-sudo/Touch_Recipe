// Port of data/DraftStore.kt: unfinished recipes (Recipe Rescue drafts) and the kept originals. Private, on-device only.
// A draft stays until the user turns it into a recipe or discards it; the original files it was made from are kept with it
// and, once a recipe is saved from the draft, with that recipe (until the user removes them).
import { newId } from '../engine/models.js';
import { emptySource, allFiles, sourceIsEmpty } from '../engine/rescue.js';

export class DraftStore {
  constructor(backend, clock = () => Date.now()) { this.backend = backend; this.clock = clock; this.subs = new Set(); this.urls = new Map(); }
  subscribe(f) { this.subs.add(f); return () => this.subs.delete(f); }
  _changed() { this.subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); }

  async save(draft) {
    const now = this.clock();
    const d = { ...draft, createdAt: draft.createdAt || now, updatedAt: now };
    await this.backend.putDraft(d.id, d); this._changed(); return d;
  }
  async get(id) { return this.backend.getDraft(id); }
  async list() {
    const out = [];
    for (const id of await this.backend.draftIds()) { const d = await this.backend.getDraft(id); if (d && !d.recipeId) out.push(d); }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async count() { return (await this.list()).length; }
  /** Removes the draft; its original files go too unless a saved recipe still keeps them. */
  async discard(id, { keepFiles = false } = {}) {
    const d = await this.backend.getDraft(id); if (!d) return;
    await this.backend.deleteDraft(id);
    if (!keepFiles) for (const f of allFiles(d.source || emptySource())) await this.deleteFile(f);
    this._changed();
  }
  // ---- original kept with a saved recipe: { recipeId, source, helpNotes }, stored under "link:<recipeId>"
  async forRecipe(recipeId) { return this.backend.getDraft('link:' + recipeId); }
  async link(recipeId, source, helpNotes = []) { await this.backend.putDraft('link:' + recipeId, { id: 'link:' + recipeId, recipeId, source, helpNotes }); this._changed(); }
  async updateHelp(recipeId, f) { const o = await this.forRecipe(recipeId); if (o) await this.link(recipeId, o.source, f(o.helpNotes || [])); }
  /** Removes the kept original of a recipe (and its files) when the user asks, or when the recipe is deleted. */
  async unlink(recipeId) { const o = await this.forRecipe(recipeId); if (!o) return; await this.backend.deleteDraft('link:' + recipeId); await this.deleteSourceFiles(o.source); this._changed(); }
  async allLinked() { const out = []; for (const id of await this.backend.draftIds()) if (String(id).startsWith('link:')) { const d = await this.backend.getDraft(id); if (d) out.push(d); } return out; }
  /** Disk used by kept originals, in bytes. */
  async bytesUsed() { let n = 0; for (const name of await this.backend.originalNames()) n += (await this.backend.getOriginal(name))?.size || 0; return n; }
  /** The draft became a recipe: it leaves the unfinished list; its files stay with the recipe. */
  async markDone(id, recipeId) {
    const d = await this.backend.getDraft(id); if (!d) return null;
    await this.backend.deleteDraft(id);
    if (recipeId && !sourceIsEmpty(d.source)) await this.link(recipeId, d.source, d.helpNotes || []); else this._changed();
    return d;
  }

  // ---- kept original files (page pictures, PDFs, cleaned copies, the dish photo)
  async saveFile(blob, ext = 'bin') { const name = `${newId()}.${ext}`; await this.backend.putOriginal(name, blob); return name; }
  async file(name) { return name ? this.backend.getOriginal(name) : null; }
  async url(name) {
    if (!name) return null; if (this.urls.has(name)) return this.urls.get(name);
    const b = await this.backend.getOriginal(name); if (!b) return null;
    const u = URL.createObjectURL(b); this.urls.set(name, u); return u;
  }
  async deleteFile(name) { if (!name) return; await this.backend.deleteOriginal(name); const u = this.urls.get(name); if (u) { URL.revokeObjectURL(u); this.urls.delete(name); } }
  async deleteSourceFiles(source) { for (const f of allFiles(source || emptySource())) await this.deleteFile(f); }
}
