// Port of core/rescue/Rescue.kt: every Recipe Rescue edit as a pure function, so each one can be undone and tested.
// Nothing here guesses: text is placed only where the user sends it. State = { draft, selecting, selection: string[] }.
import { Ingredient, Direction, newId } from './models.js';
import { timerSeconds, toMinutes, looseMinutes } from './durations.js';
import { ingredientLike, text as pageNodeText } from './pagescan.js';
import { parse as parseText } from './textparser.js';
import { select as sel } from './htmlparse.js';
import { parse as parseDoc } from './htmlparse.js';

export const TITLE = 'f:title', PHOTO = 'f:photo', SERVINGS = 'f:servings', TIMES = 'f:times', NOTES = 'f:notes', DESCRIPTION = 'f:description', INGREDIENTS = 'f:ingredients', DIRECTIONS = 'f:directions';
const HISTORY = 40;
const bullet = /^[^\p{L}\p{Nd}(\[¼½¾⅓⅔⅛⅜⅝⅞]+/u;
const stepNum = /^\s*(?:step\s*)?\d{1,2}\s*[.):]\s+(?=\S)|^\s*step\s*\d{1,2}\s*[.):\-–—]?\s*/i;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isLower = (c) => c !== c.toUpperCase() && c === c.toLowerCase();

export const emptySource = () => ({ kind: 'NONE', url: null, files: [], text: '', capturedAt: 0, cleaned: [], dishPhoto: null });
export const sourceIsEmpty = (s) => !s || s.kind === 'NONE' || (!s.url && !(s.files || []).length && !(s.text || '').trim());
export const sourceLines = (s) => (s.text || '').split('\n').map((l) => l.trim()).filter(Boolean);
export const allFiles = (s) => [...(s.files || []), ...(s.cleaned || []).filter(Boolean), ...(s.dishPhoto ? [s.dishPhoto] : [])];

export function newDraft(o = {}) {
  return { id: newId(), recipe: o.recipe, source: emptySource(), helpNotes: [], findings: [], recipeId: null, imageCandidates: [], undo: [], redo: [], createdAt: 0, updatedAt: 0, ...o };
}
export const state = (draft) => ({ draft, selecting: false, selection: [] });
export const recipeOf = (s) => s.draft.recipe;
export const canUndo = (s) => s.draft.undo.length > 0;
export const canRedo = (s) => s.draft.redo.length > 0;
export const openQuestions = (d) => d.helpNotes.filter((n) => !n.resolved).length;

/** Changes the recipe and remembers the previous version for Undo. An edit that changes nothing leaves the history alone. */
export function edit(s, f) {
  const next = f(s.draft.recipe);
  if (same(next, s.draft.recipe)) return s;
  return { ...s, draft: { ...s.draft, recipe: next, undo: [...s.draft.undo, s.draft.recipe].slice(-HISTORY), redo: [] } };
}
export function undo(s) {
  const prev = s.draft.undo[s.draft.undo.length - 1]; if (!prev) return s;
  return { ...s, draft: { ...s.draft, recipe: prev, undo: s.draft.undo.slice(0, -1), redo: [...s.draft.redo, s.draft.recipe].slice(-HISTORY) }, selection: [] };
}
export function redo(s) {
  const next = s.draft.redo[s.draft.redo.length - 1]; if (!next) return s;
  return { ...s, draft: { ...s.draft, recipe: next, redo: s.draft.redo.slice(0, -1), undo: [...s.draft.undo, s.draft.recipe].slice(-HISTORY) }, selection: [] };
}

/** One entry per non-empty line; list marks are removed, amounts and wording are untouched. */
export const ingredientLines = (text) => text.split('\n').map((l) => l.trim().replace(bullet, '').trim()).filter(Boolean);

/** One step per line or paragraph; a wrapped sentence is joined to the line above it, and "1." / "Step 2" marks are removed. */
export function stepLines(text) {
  const out = []; let blankBefore = true;
  for (const raw of text.split('\n')) {
    const t = raw.trim();
    if (!t) { blankBefore = true; continue; }
    const marked = stepNum.test(t) || (bullet.test(t) && !/[\p{L}\p{Nd}]/u.test(t[0]));
    const clean = t.replace(bullet, '').replace(stepNum, '').trim();
    if (!clean) continue;
    const prev = out[out.length - 1];
    if (prev !== undefined && !marked && !blankBefore && !/[.!?:;]$/.test(prev) && isLower(clean[0])) out[out.length - 1] = `${prev} ${clean}`;
    else out.push(clean);
    blankBefore = false;
  }
  return out;
}

export function addIngredients(s, text) {
  const lines = ingredientLines(text); if (!lines.length) return s;
  return edit(s, (r) => ({ ...r, ingredients: [...r.ingredients, ...lines.map((l) => Ingredient({ text: l.replace(/:+$/, ''), header: l.endsWith(':') && l.length < 50 }))] }));
}
export function addSteps(s, text) {
  const lines = stepLines(text); if (!lines.length) return s;
  return edit(s, (r) => ({ ...r, directions: [...r.directions, ...lines.map((l) => Direction({ text: l, timerSeconds: timerSeconds(l) }))] }));
}
export const setTitle = (s, text) => edit(s, (r) => ({ ...r, title: (text.split('\n').find((l) => l.trim()) || '').trim().slice(0, 200) }));
export const setDescription = (s, text) => edit(s, (r) => ({ ...r, description: text.trim() }));
export const addNotes = (s, text) => edit(s, (r) => ({ ...r, notes: [r.notes, text.trim()].filter((x) => x && x.trim()).join('\n') }));
export const setNotes = (s, text) => edit(s, (r) => ({ ...r, notes: text }));
/** Reads the first whole number in the text ("Serves 6 to 8" gives 6). Text without a number changes nothing. */
export function setServings(s, text) { const m = /\d{1,3}/.exec(text); const n = m ? parseInt(m[0], 10) : null; if (n == null || n < 1 || n > 999) return s; return edit(s, (r) => ({ ...r, servings: n })); }
export const clearServings = (s) => edit(s, (r) => ({ ...r, servings: null }));
/** which is "prep", "cook" or "total". Accepts "45", "45 min", "1 hr 10 min", "PT1H". Text with no time in it changes nothing. */
export function setTime(s, which, text) {
  const t = text.trim();
  const m = t === '' ? null : /^\d+$/.test(t) ? parseInt(t, 10) : (toMinutes(t) ?? looseMinutes(t));
  if (t !== '' && m == null) return s;
  const key = which === 'prep' ? 'prepMinutes' : which === 'cook' ? 'cookMinutes' : 'totalMinutes';
  return edit(s, (r) => ({ ...r, [key]: m }));
}
export const setPhoto = (s, name) => edit(s, (r) => ({ ...r, photo: name }));

export const editIngredient = (s, id, text) => edit(s, (r) => ({ ...r, ingredients: r.ingredients.map((i) => (i.id === id ? { ...i, text: text.trim() } : i)) }));
export const editStep = (s, id, text) => edit(s, (r) => ({ ...r, directions: r.directions.map((d) => (d.id === id ? { ...d, text: text.trim(), timerSeconds: d.header ? null : timerSeconds(text) } : d)) }));
export const toggleHeader = (s, id) => edit(s, (r) => ({ ...r, ingredients: r.ingredients.map((i) => (i.id === id ? { ...i, header: !i.header } : i)), directions: r.directions.map((d) => (d.id === id ? { ...d, header: !d.header, timerSeconds: null } : d)) }));
export const remove = (s, id) => { const n = edit(s, (r) => ({ ...r, ingredients: r.ingredients.filter((i) => i.id !== id), directions: r.directions.filter((d) => d.id !== id) })); return { ...n, selection: n.selection.filter((x) => x !== id) }; };
export function move(s, id, delta) {
  const shift = (l, i) => { const j = i + delta; if (i < 0 || j < 0 || j >= l.length) return l; const m = [...l]; m.splice(j, 0, m.splice(i, 1)[0]); return m; };
  return edit(s, (r) => ({ ...r, ingredients: shift(r.ingredients, r.ingredients.findIndex((i) => i.id === id)), directions: shift(r.directions, r.directions.findIndex((d) => d.id === id)) }));
}

// ---- selection ----
export const startSelecting = (s) => ({ ...s, selecting: true });
export const cancelSelection = (s) => ({ ...s, selecting: false, selection: [] });
export const toggle = (s, id) => ({ ...s, selecting: true, selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] });
export const selectAllIngredients = (s) => ({ ...s, selecting: true, selection: [...new Set([...s.selection, ...s.draft.recipe.ingredients.map((i) => i.id)])] });
export const selectAllSteps = (s) => ({ ...s, selecting: true, selection: [...new Set([...s.selection, ...s.draft.recipe.directions.map((d) => d.id)])] });

/** Removes exactly what is selected: lines by id, and whole fields by their field key. Everything else is kept. One Undo restores it. */
export function removeSelected(s) {
  if (!s.selection.length) return s;
  const sel = new Set(s.selection);
  const n = edit(s, (r) => ({ ...r,
    title: sel.has(TITLE) ? '' : r.title, photo: sel.has(PHOTO) ? null : r.photo, servings: sel.has(SERVINGS) ? null : r.servings,
    prepMinutes: sel.has(TIMES) ? null : r.prepMinutes, cookMinutes: sel.has(TIMES) ? null : r.cookMinutes, totalMinutes: sel.has(TIMES) ? null : r.totalMinutes,
    notes: sel.has(NOTES) ? '' : r.notes, description: sel.has(DESCRIPTION) ? '' : r.description,
    ingredients: r.ingredients.filter((i) => !sel.has(i.id)), directions: r.directions.filter((d) => !sel.has(d.id)) }));
  return { ...n, selection: [], selecting: false };
}

/** Puts new text where the selected lines were. Selected ingredients are replaced by ingredient lines, selected steps by steps; when both
 *  kinds are selected each new line goes to the list it reads like. Unselected lines keep their place and order. */
export function replaceSelected(s, text) {
  const sel = new Set(s.selection), r0 = s.draft.recipe;
  const ingSel = r0.ingredients.some((i) => sel.has(i.id)), dirSel = r0.directions.some((d) => sel.has(d.id));
  if (!ingSel && !dirSel) return s;
  let newIng = [], newDir = [];
  if (ingSel && !dirSel) newIng = ingredientLines(text);
  else if (dirSel && !ingSel) newDir = stepLines(text);
  else { const all = ingredientLines(text); newIng = all.filter(ingredientLike); newDir = stepLines(all.filter((l) => !ingredientLike(l)).join('\n\n')); }
  const n = edit(s, (r) => {
    const splice = (list, isSel, fresh) => { const at = list.findIndex(isSel); if (at < 0) return list; const kept = list.filter((x) => !isSel(x)); const before = list.slice(0, at).filter((x) => !isSel(x)).length; return [...kept.slice(0, before), ...fresh, ...kept.slice(before)]; };
    return { ...r, ingredients: splice(r.ingredients, (i) => sel.has(i.id), newIng.map((t) => Ingredient({ text: t }))), directions: splice(r.directions, (d) => sel.has(d.id), newDir.map((t) => Direction({ text: t, timerSeconds: timerSeconds(t) }))) };
  });
  return { ...n, selection: [], selecting: false };
}

/** Clears the editable fields for a badly damaged import. Fields named in keep stay; the original is never touched; one Undo brings it all back. */
export function startFresh(s, keep) {
  const k = new Set(keep);
  const n = edit(s, (r) => ({ ...r,
    title: k.has(TITLE) ? r.title : '', photo: k.has(PHOTO) ? r.photo : null, servings: k.has(SERVINGS) ? r.servings : null,
    prepMinutes: k.has(TIMES) ? r.prepMinutes : null, cookMinutes: k.has(TIMES) ? r.cookMinutes : null, totalMinutes: k.has(TIMES) ? r.totalMinutes : null,
    notes: k.has(NOTES) ? r.notes : '', description: k.has(DESCRIPTION) ? r.description : '',
    ingredients: k.has(INGREDIENTS) ? r.ingredients : [], directions: k.has(DIRECTIONS) ? r.directions : [] }));
  return { ...n, selection: [], selecting: false };
}

/** What Smart Paste would do with a block of text. Nothing is changed until applySmartPaste is called with the user's confirmation. */
export function planSmartPaste(text) {
  const d = parseText(text); const r = d.recipe;
  const nonEmpty = text.split('\n').filter((l) => l.trim()).length;
  const looksLikeList = nonEmpty > 0 && r.ingredients.filter((i) => !i.header).length + r.directions.filter((x) => !x.header).length >= nonEmpty - 1;
  const title = looksLikeList && !r.ingredients.length && r.directions.length <= 1 ? '' : r.title;
  const plan = { title, ingredients: r.ingredients, directions: r.directions, servings: r.servings, prep: r.prepMinutes, cook: r.cookMinutes, total: r.totalMinutes, notes: r.notes, leftover: d.unplaced || [] };
  plan.isEmpty = !plan.title.trim() && !plan.ingredients.length && !plan.directions.length && plan.servings == null && plan.prep == null && plan.cook == null && plan.total == null && !(plan.notes || '').trim();
  return plan;
}
/** Adds the planned lines to the lists and fills only fields that are still empty: nothing already in the recipe is overwritten. */
export const applySmartPaste = (s, p) => edit(s, (r) => ({ ...r,
  title: r.title.trim() ? r.title : p.title, servings: r.servings ?? p.servings, prepMinutes: r.prepMinutes ?? p.prep, cookMinutes: r.cookMinutes ?? p.cook, totalMinutes: r.totalMinutes ?? p.total,
  ingredients: [...r.ingredients, ...p.ingredients.map((i) => ({ ...i, id: newId(), checked: false }))], directions: [...r.directions, ...p.directions.map((d) => ({ ...d, id: newId() }))],
  notes: [r.notes, p.notes].filter((x) => x && x.trim()).join('\n') }));

// ---- questions for the family ----
export const addHelp = (s, target, text, page = 0, x = null, y = null) => (!text.trim() ? s : { ...s, draft: { ...s.draft, helpNotes: [...s.draft.helpNotes, { id: newId(), target, text: text.trim(), resolved: false, page, x, y }] } });
export const resolveHelp = (s, id, resolved = true) => ({ ...s, draft: { ...s.draft, helpNotes: s.draft.helpNotes.map((n) => (n.id === id ? { ...n, resolved } : n)) } });
export const editHelp = (s, id, text) => ({ ...s, draft: { ...s.draft, helpNotes: s.draft.helpNotes.map((n) => (n.id === id ? { ...n, text: text.trim() } : n)) } });
export const deleteHelp = (s, id) => ({ ...s, draft: { ...s.draft, helpNotes: s.draft.helpNotes.filter((n) => n.id !== id) } });
export const helpFor = (s, target) => s.draft.helpNotes.filter((n) => n.target === target && !n.resolved);

/** What still stands between this draft and a saved recipe. Empty means it can be saved. */
export function problems(r) {
  const out = [];
  if (!r.title.trim()) out.push('Add a title before saving.');
  if (!r.ingredients.some((i) => !i.header && i.text.trim()) && !r.directions.some((d) => !d.header && d.text.trim())) out.push('Add at least one ingredient or one direction before saving.');
  return out;
}
/** The recipe as it will be saved: blank lines dropped, text trimmed. */
export const cleaned = (r) => ({ ...r, title: r.title.trim(), ingredients: r.ingredients.filter((i) => i.text.trim()), directions: r.directions.filter((d) => d.text.trim()) });

/** The readable text of a web page, one line per block, for the Text view of the original. Menus, scripts and forms are left out. */
export function pageText(html, maxLines = 1500) {
  try {
    const doc = parseDoc(html);
    doc.querySelectorAll('script, style, noscript, template, svg, iframe, nav, form, footer, select, button').forEach((e) => e.remove());
    const out = [];
    for (const el of doc.querySelectorAll('h1, h2, h3, h4, h5, h6, li, p, td, dt, dd, blockquote')) {
      const tag = el.tagName.toLowerCase();
      if (!['li', 'p'].includes(tag) && sel(el, 'li, p').length) continue;
      if (tag === 'li' && sel(el, 'li').length > 1) continue;
      const t = pageNodeText(el);
      if (t.length >= 2 && out[out.length - 1] !== t) out.push(t);
      if (out.length >= maxLines) break;
    }
    return out.join('\n');
  } catch { return ''; }
}
