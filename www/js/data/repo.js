// Port of data/Db.kt + data/Repository.kt. Room is replaced by one in-memory state object persisted through a
// pluggable backend (IndexedDB in the app, memory in tests). Every write notifies subscribers so screens re-render.
import { Recipe as MkRecipe, GroceryItem as MkGrocery, newId } from '../engine/models.js';
import * as Cat from '../engine/categories.js';
import * as G from '../engine/grocery.js';
import { Units } from '../engine/units.js';
import { Family } from '../engine/units.js';
import { format as qFormat } from '../engine/quantity.js';
import { addDays } from '../engine/planner.js';

const emptyState = () => ({ recipes: {}, categories: [], meals: {}, grocery: [], aisles: [], cook: {}, version: 1 });
const BUILTIN_AISLES = ['Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Pantry', 'Bakery'];

export class MemoryBackend {
  constructor(initial = null) { this.data = initial; }
  async load() { return this.data ? structuredClone(this.data) : null; }
  async save(state) { this.data = structuredClone(state); }
}

export class Repository {
  constructor(backend = new MemoryBackend(), clock = () => Date.now()) {
    this.backend = backend; this.clock = clock; this.state = emptyState(); this.subs = new Set(); this._saving = null; this._dirty = false;
  }
  async init() {
    const loaded = await this.backend.load();
    if (loaded) this.state = { ...emptyState(), ...loaded };
    await this.ensureSeeded();
    return this;
  }
  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  _changed() {
    this._dirty = true;
    this.subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
    if (!this._saving) this._saving = Promise.resolve().then(async () => { this._saving = null; if (this._dirty) { this._dirty = false; try { await this.backend.save(this.state); } catch (e) { console.error('save failed', e); } } });
  }
  async flush() { while (this._saving) await this._saving; }

  // ---- recipes ----
  recipes() { return Object.values(this.state.recipes).sort((a, b) => b.updatedAt - a.updatedAt); }
  recipe(id) { return this.state.recipes[id] ?? null; }
  getRecipe(id) { return this.recipe(id); }
  recipeCount() { return Object.keys(this.state.recipes).length; }
  async saveRecipe(r) {
    const now = this.clock();
    const existing = this.state.recipes[r.id];
    const saved = { ...r, createdAt: existing?.createdAt ?? (r.createdAt > 0 ? r.createdAt : now), updatedAt: now };
    this.state.recipes[r.id] = saved; this._changed();
    return saved;
  }
  async deleteRecipe(id) {
    const r = this.recipe(id);
    delete this.state.recipes[id];
    for (const d of Object.keys(this.state.meals)) if (this.state.meals[d].recipeId === id) delete this.state.meals[d];
    delete this.state.cook[id]; this._changed();
    return r;
  }
  async restoreRecipe(r) { this.state.recipes[r.id] = r; this._changed(); }
  async setFavorite(id, fav) { const r = this.state.recipes[id]; if (r) { r.favorite = fav; this._changed(); } }
  async updateIngredients(id, f) { const r = this.recipe(id); if (!r) return; this.state.recipes[id] = { ...r, ingredients: f(r.ingredients) }; this._changed(); }

  // ---- categories ----
  categories() {
    return [...this.state.categories].sort((a, b) => (Number(b.builtIn) - Number(a.builtIn)) || (a.sortOrder - b.sortOrder) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  async ensureSeeded() { if (!this.state.categories.length) { this.state.categories = Cat.seed(); this._changed(); } }
  async addCustomCategory(name) { return (await this.addCustomCategoryReturningId(name))[0]; }
  async addCustomCategoryReturningId(name) {
    const all = this.state.categories;
    const v = Cat.validateNew(name, all);
    if (!v.ok) return [v, null];
    const id = 'c_' + newId().slice(0, 8);
    const order = all.reduce((m, c) => Math.max(m, c.sortOrder), 0) + 1;
    this.state.categories.push({ id, name: v.name, group: 'Custom', builtIn: false, enabled: true, sortOrder: order }); this._changed();
    return [v, id];
  }
  async setCategoryEnabled(id, enabled) { const c = this.state.categories.find((x) => x.id === id); if (c) { c.enabled = enabled; this._changed(); } }
  async renameCategory(id, name) {
    const all = this.state.categories;
    const c = all.find((x) => x.id === id);
    if (!c) return { ok: false, reason: 'Category not found.' };
    if (c.builtIn) return { ok: false, reason: "Built-in categories can't be renamed. Turn them off instead." };
    const v = Cat.validateRename(id, name, all);
    if (v.ok) { c.name = v.name; this._changed(); }
    return v;
  }
  async deleteCustomCategory(id) {
    const c = this.state.categories.find((x) => x.id === id);
    if (!c || c.builtIn) return 0;
    let affected = 0;
    for (const r of Object.values(this.state.recipes)) if (r.categoryIds.includes(id)) { affected++; r.categoryIds = r.categoryIds.filter((x) => x !== id); }
    this.state.categories = this.state.categories.filter((x) => x.id !== id); this._changed();
    return affected;
  }
  recipesUsingCategory(id) { return Object.values(this.state.recipes).filter((r) => r.categoryIds.includes(id)).length; }

  // ---- meal plan ----
  meals(from, to) { return Object.values(this.state.meals).filter((m) => m.date >= from && m.date <= to); }
  mealsFor(from, to) { return this.meals(from, to); }
  async assignMeal(date, recipeId, servings) { this.state.meals[date] = { date, recipeId, servings: servings ?? null }; this._changed(); }
  async removeMeal(date) { delete this.state.meals[date]; this._changed(); }

  // ---- grocery ----
  _week(week) { return this.state.grocery.filter((g) => g.weekStart === week).sort((a, b) => (a.sortIndex - b.sortIndex) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)); }
  groceryItems(week) { return this._week(week); }
  customAisles() { return [...this.state.aisles].sort((a, b) => (a.sortOrder - b.sortOrder) || (a.name < b.name ? -1 : 1)).map((a) => a.name); }
  async addAisle(name) {
    const n = Cat.cleanName(name);
    if (!n || n.length > 30 || BUILTIN_AISLES.some((b) => b.toLowerCase() === n.toLowerCase()) || this.state.aisles.some((a) => a.name.toLowerCase() === n.toLowerCase())) return false;
    this.state.aisles.push({ name: n, sortOrder: this.state.aisles.length }); this._changed(); return true;
  }
  async deleteAisle(name, week) {
    this.state.grocery.forEach((g) => { if (g.weekStart === week && g.aisle === name) g.aisle = G.AISLE_PANTRY; });
    this.state.aisles = this.state.aisles.filter((a) => a.name !== name); this._changed();
  }
  async addGroceryItem(week, name, qty, aisle) {
    const n = name.trim(); if (!n) return null;
    const existing = this._week(week);
    const key = G.normalizeKey(n);
    const dup = existing.find((i) => key && G.normalizeKey(i.name) === key && i.aisle === aisle);
    if (dup) return dup;
    const item = MkGrocery({ weekStart: week, name: n, quantityText: qty.trim(), aisle, sortIndex: existing.reduce((m, i) => Math.max(m, i.sortIndex), -1) + 1, edited: true });
    this.state.grocery.push(item); this._changed(); return item;
  }
  async updateGroceryItem(item) {
    const i = this.state.grocery.findIndex((g) => g.id === item.id);
    if (i >= 0) this.state.grocery[i] = item; else this.state.grocery.push(item);
    this._changed();
  }
  async deleteGroceryItem(id) { this.state.grocery = this.state.grocery.filter((g) => g.id !== id); this._changed(); }
  async clearChecked(week) {
    const removed = this._week(week).filter((g) => g.checked);
    this.state.grocery = this.state.grocery.filter((g) => !(g.weekStart === week && g.checked)); this._changed();
    return removed;
  }
  async restoreGroceryItems(items) { for (const it of items) { const i = this.state.grocery.findIndex((g) => g.id === it.id); if (i >= 0) this.state.grocery[i] = it; else this.state.grocery.push(it); } this._changed(); }
  async reorderGrocery(week, aisle, orderedIds) {
    const all = this._week(week);
    const others = all.filter((i) => i.aisle !== aisle);
    const mine = orderedIds.map((id) => all.find((i) => i.id === id)).filter(Boolean);
    [...mine, ...others].forEach((it, i) => { const g = this.state.grocery.find((x) => x.id === it.id); if (g) g.sortIndex = i; });
    this._changed();
  }
  async generateGroceries(week) {
    const meals = this.mealsFor(week, addDays(week, 6));
    const planned = meals.map((m) => { const r = this.recipe(m.recipeId); return r ? { recipe: r, servings: m.servings } : null; }).filter(Boolean);
    const existing = this._week(week);
    const merged = G.merge(week, existing, G.generate(planned));
    this.state.grocery = this.state.grocery.filter((g) => g.weekStart !== week).concat(merged); this._changed();
    return planned.length;
  }
  async addIngredientsToGroceries(week, recipe, servings, lines = null) {
    const src = { ...recipe, ingredients: lines ?? recipe.ingredients };
    const gen = G.generate([{ recipe: src, servings }]);
    const existing = this._week(week);
    const byKey = new Map(existing.filter((i) => i.key).map((i) => [i.key, i]));
    let next = existing.reduce((m, i) => Math.max(m, i.sortIndex), -1) + 1;
    let added = 0;
    for (const g of gen) {
      const old = byKey.get(g.key);
      if (!old) {
        this.state.grocery.push(MkGrocery({ weekStart: week, name: g.name, quantityText: G.quantityText(g), aisle: g.aisle, sortIndex: next++, key: g.key, generated: true, sources: g.sources })); added++;
      } else if (g.sources.every((s) => !old.sources.some((o) => o.recipeId === s.recipeId))) {
        const q = old.edited || !old.quantityText ? old.quantityText : combineText(old.quantityText, G.quantityText(g));
        const i = this.state.grocery.findIndex((x) => x.id === old.id);
        this.state.grocery[i] = { ...old, quantityText: q, sources: [...old.sources, ...g.sources] }; added++;
      }
    }
    this._changed();
    return added;
  }

  // ---- cook mode ----
  cookSession(recipeId) { return this.state.cook[recipeId] ?? null; }
  activeCookSession() {
    const open = Object.values(this.state.cook).filter((s) => !s.finished).sort((a, b) => b.updatedAt - a.updatedAt);
    return open[0] ?? null;
  }
  async saveCookSession(s) { this.state.cook[s.recipeId] = { ...s, updatedAt: this.clock() }; this._changed(); }
  async clearCookSession(recipeId) { delete this.state.cook[recipeId]; this._changed(); }

  /** "Delete all my recipes and data": recipes, meal plan, grocery lists and cooking progress. Categories are kept. */
  async wipeUserData() { this.state.recipes = {}; this.state.meals = {}; this.state.grocery = []; this.state.cook = {}; this._changed(); }

  // ---- whole-data operations used by backup / restore ----
  snapshot() { return structuredClone(this.state); }
  async replaceAll(state) { this.state = { ...emptyState(), ...state }; await this.ensureSeeded(); this._changed(); }
}

function combineText(a, b) {
  const pa = G.parse(a + ' x'), pb = G.parse(b + ' x');
  if (pa.quantity != null && pb.quantity != null && pa.unit?.family === pb.unit?.family && pa.unitText === pb.unitText) {
    const fam = pa.unit?.family ?? Family.COUNT;
    const base = pa.quantity * (pa.unit?.factor ?? 1) + pb.quantity * (pb.unit?.factor ?? 1);
    const [q, u] = fam === Family.COUNT ? [base, pa.unitText] : Units.best(fam, base);
    return qFormat(q) + (u ? ` ${u}` : '');
  }
  return `${a} + ${b}`;
}
