// Port of ui/screens/DetailScreen.kt.
import { h, mount, minutesLabel } from '../ui/dom.js';
import { ArtPage, place, dp, sp } from '../ui/art.js';
import { Routes } from '../ui/nav.js';
import { bigButton, sheet, fitText, photoImg, say, undoable, confirmDialog, rowsEditorSheet, EditRow } from '../ui/widgets.js';
import { Ingredient, Direction } from '../engine/models.js';
import { effectiveTotal } from '../engine/models.js';
import * as Q from '../engine/quantity.js';
import * as Planner from '../engine/planner.js';
import { timerSeconds } from '../engine/durations.js';
import { recipeText, shareText, openLink, pickFile, groceryAddSheet, dayPickerSheet, live } from '../ui/shared.js';

export function detailScreen(params, ctx, nav) {
  const id = params.id;
  const st = (params.__vm ||= { servings: ctx.repo.recipe(id)?.servings ?? null });
  const recipe = () => ctx.repo.recipe(id);
  const art = ArtPage(ctx.art, 'detail', { title: 'Recipe', prefs: ctx.prefs, onTarget: (t) => onTarget(t) });
  const { content, page } = art;
  const dyn = h('div'); content.append(dyn);

  const step = (d) => { const r = recipe(); const base = r?.servings ?? st.servings ?? 4; st.servings = Math.min(99, Math.max(1, (st.servings ?? base) + d)); render(); };
  const setPhoto = async (name) => { const r = recipe(); if (r) await ctx.repo.saveRecipe({ ...r, photo: name }); };

  function onTarget(t) {
    const r = recipe(); if (!r) { if (t === 'back') nav.backOr(Routes.COLLECTION); return; }
    switch (t) {
      case 'back': nav.backOr(Routes.COLLECTION); break;
      case 'favorite': ctx.repo.setFavorite(r.id, !r.favorite); break;
      case 'cook': if (!r.directions.some((d) => !d.header)) say('Add directions first, then Cook Mode can guide you.'); else nav.go(Routes.COOK, { id: r.id }); break;
      case 'grocery': if (!r.ingredients.some((i) => !i.header)) say('This recipe has no ingredients yet.'); else groceryAddSheet(ctx, r, st.servings, () => nav.go(Routes.GROCERY)); break;
      case 'photo': photoMenu(r); break;
      case 'ingredients_head': ingEditor(r); break;
      case 'directions_head': dirEditor(r); break;
      case 'serv_dec': step(-1); break;
      case 'serv_inc': step(1); break;
    }
  }

  function ingEditor(r) {
    const factor = Q.factor(r.servings, st.servings);
    rowsEditorSheet({ title: 'Ingredients', initial: r.ingredients.map((i) => EditRow(i.text, i.header)).map((x, i) => ({ ...x, id: r.ingredients[i].id })), hint: 'e.g. 1 1/2 cups flour', numbered: false, allowHeaders: true,
      note: factor !== 1 ? `You are editing the original amounts (for ${r.servings} servings).` : null,
      onSave: async (rows) => {
        const old = new Map(r.ingredients.map((i) => [i.id, i]));
        await ctx.repo.updateIngredients(id, () => rows.map((x) => Ingredient({ id: x.id, text: x.text.trim(), header: x.header, checked: old.get(x.id)?.checked ?? false })));
        const cur = recipe(); if (cur) await ctx.repo.saveRecipe(cur);
      } });
  }
  function dirEditor(r) {
    rowsEditorSheet({ title: 'Directions', initial: r.directions.map((d) => ({ id: d.id, text: d.text, header: d.header })), hint: 'Describe this step', numbered: true, allowHeaders: true,
      onSave: async (rows) => {
        const cur = recipe(); if (!cur) return;
        const old = new Map(cur.directions.map((d) => [d.id, d]));
        await ctx.repo.saveRecipe({ ...cur, directions: rows.map((x) => Direction({ id: x.id, text: x.text.trim(), header: x.header,
          timerSeconds: x.header ? null : (old.get(x.id) && old.get(x.id).text === x.text.trim() ? old.get(x.id).timerSeconds : timerSeconds(x.text)) })) });
      } });
  }
  function photoMenu(r) {
    sheet({ label: 'Recipe photo', content: (close) => h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, h('h2', { class: 'sheet-title' }, 'Recipe photo'),
      bigButton('Choose from photo library', async () => { close(false); const f = await pickFile({ accept: 'image/*' }); if (f) { const n = await ctx.photos.saveBlob(f); n ? setPhoto(n) : say("That photo couldn't be used."); } }),
      bigButton('Take a photo', async () => { close(false); const f = await pickFile({ accept: 'image/*', capture: 'environment' }); if (f) { const n = await ctx.photos.saveBlob(f); n ? setPhoto(n) : say("That photo couldn't be used."); } }, { primary: false }),
      r.photo ? bigButton('Remove photo', () => { close(false); setPhoto(null); }, { primary: false }) : null) });
  }
  function moreMenu(r) {
    sheet({ label: 'More options', content: (close) => h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, h('h2', { class: 'sheet-title' }, r.title.trim() || 'Recipe'),
      bigButton('Edit details', () => { close(false); nav.go(Routes.REVIEW, { edit: r.id }); }, { primary: false }),
      bigButton('Add to meal plan', () => { close(false); dayPickerSheet(`Add “${r.title}” to which day?`, async (date) => { await ctx.repo.assignMeal(date, r.id, st.servings ?? r.servings); say(`Planned for ${Planner.dayLabel(date)}, ${Planner.dateLabel(date)}.`); }); }, { primary: false }),
      bigButton('Share as text', () => { close(false); shareText(r.title, recipeText(r, st.servings)); }, { primary: false }),
      bigButton('Delete recipe', () => { close(false); confirmDialog('Delete this recipe?', `“${r.title}” will be removed from your collection and meal plan. You can undo right after.`, 'Delete', async () => {
        const removed = await ctx.repo.deleteRecipe(r.id); nav.backOr(Routes.COLLECTION); if (removed) undoable(`Deleted “${removed.title}”`, () => ctx.repo.restoreRecipe(removed)); }, true); }, { primary: false, testid: 'delete-recipe' })) });
  }

  function render() {
    const r = recipe(); const cats = ctx.repo.categories();
    mount(dyn);
    if (!r) { const m = h('div', { style: 'display:flex;align-items:center;justify-content:center;text-align:center;color:var(--ink)' }, 'This recipe is no longer in your collection.'); place(m, page.region('title')); dyn.append(m); return; }
    art.setDescribe((t) => null);
    const factor = Q.factor(r.servings, st.servings);
    const serv = st.servings ?? r.servings;
    // photo window under the back/heart controls
    const pb = place(h('div', { style: `border-radius:${dp(18)};overflow:hidden;pointer-events:none` }), page.target('photo').box);
    const ph = photoImg(ctx.photos, r.photo, { fallback: r.title, alt: r.photo ? `Photo of ${r.title}` : '' }); ph.style.cssText = 'position:absolute;inset:0';
    pb.append(ph);
    if (!r.photo) pb.append(h('div', { style: `position:absolute;left:0;right:0;top:50%;padding-top:${dp(110)};text-align:center;color:var(--cream);font-weight:600;font-size:${sp(24)}` }, 'Tap to add a photo'));
    dyn.append(pb);
    // favorite heart drawn over the art heart
    const heart = place(h('div', { 'aria-hidden': 'true', 'data-testid': `heart-glyph:${r.favorite ? 'on' : 'off'}`, style: `border-radius:50%;background:#FBF4E6;display:flex;align-items:center;justify-content:center;color:var(--tomato);font-size:${sp(50)};pointer-events:none` }, r.favorite ? '♥' : '♡'), page.target('favorite').box);
    dyn.append(heart);
    const more = place(h('button', { type: 'button', 'aria-label': 'More options', 'data-testid': 'detail-more', style: `border-radius:50%;border:0;background:rgba(251,244,230,.92);color:var(--ink);font-size:${sp(40)}`, onclick: () => moreMenu(r) }, '⋯'), { x: 0.44, y: 0.012, w: 0.14, h: 0.045 });
    dyn.append(more);

    // title, categories, description, source
    const names = r.categoryIds.map((cid) => cats.find((c) => c.id === cid)?.name).filter(Boolean);
    const src = r.sourceName ?? r.sourceUrl;
    const titleBox = place(h('div', { class: 'scroll-y', style: 'color:var(--ink)' },
      fitText(r.title.trim() || 'Untitled recipe', { lines: 3, minScale: 0.5, style: `font-family:var(--display);font-weight:700;font-size:${sp(46)};line-height:${sp(52)};color:var(--ink)` }),
      names.length ? h('div', { style: `color:var(--forest);font-size:${sp(21)};font-weight:600` }, names.join(' · ')) : null,
      r.description.trim() ? h('div', { style: `font-size:${sp(21)};line-height:${sp(27)};display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden` }, r.description) : null,
      src ? h('div', { role: r.sourceUrl ? 'link' : null, tabindex: r.sourceUrl ? '0' : null, style: `color:var(--forest);font-size:${sp(20)};text-decoration:underline;min-height:32px;padding:4px 0`, onclick: () => { if (r.sourceUrl && !openLink(r.sourceUrl)) say('No app could open that link.'); } }, `Source: ${src}`) : null,
      r.notes.trim() ? h('div', { style: `font-size:${sp(20)};line-height:${sp(26)}` }, `Notes: ${r.notes}`) : null), page.region('title'));
    dyn.append(titleBox);
    // times and servings
    const vals = [minutesLabel(r.prepMinutes), minutesLabel(r.cookMinutes), minutesLabel(effectiveTotal(r)), serv != null ? String(serv) : null];
    const labels = ['Prep time', 'Cook time', 'Total time', 'Servings'];
    vals.forEach((v, i) => dyn.append(place(h('div', { role: 'text', 'aria-label': `${labels[i]}: ${v ?? 'not set'}`, style: 'display:flex;align-items:center;color:var(--ink);pointer-events:none' },
      fitText(v ?? '—', { minScale: 0.6, style: `font-family:var(--body);font-weight:600;font-size:${sp(24)};color:var(--ink);max-width:100%` })), page.region('meta' + i))));
    dyn.append(place(h('div', { 'aria-live': 'polite', 'aria-label': `Servings: ${serv ?? 'not set'}`, style: 'display:flex;align-items:center;justify-content:center;pointer-events:none' },
      fitText(serv != null ? String(serv) : '—', { style: `font-size:${sp(34)};font-weight:700;color:var(--ink);text-align:center;max-width:100%` })), page.region('servings_value')));
    dyn.querySelector('[aria-live]').dataset.testid = 'servings-value';
    // ingredients
    const ingList = h('div', { class: 'scroll-y fade-bottom', 'data-testid': 'ingredient-list', style: 'height:100%' });
    if (!r.ingredients.length) ingList.append(h('div', { style: `color:rgba(42,33,24,.7);font-size:${sp(22)}` }, 'No ingredients yet. Tap “Ingredients” to add some.'));
    r.ingredients.forEach((ing) => {
      if (ing.header) { ingList.append(h('div', { role: 'heading', 'aria-level': '3', style: `font-weight:700;color:var(--forest);font-size:${sp(24)};padding-top:6px` }, ing.text)); return; }
      const shown = Q.scale(ing.text, factor);
      ingList.append(h('div', { role: 'checkbox', tabindex: '0', 'aria-checked': String(ing.checked), 'aria-label': shown, 'data-testid': `ingredient:${ing.id}`, class: 'row-line',
        style: 'min-height:48px;padding:2px 0;color:var(--ink);cursor:pointer',
        onclick: () => ctx.repo.updateIngredients(id, (l) => l.map((x) => (x.id === ing.id ? { ...x, checked: !x.checked } : x))),
        onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.target.click(); } } },
        h('div', { style: `width:26px;height:26px;flex:none;border-radius:6px;border:2px solid var(--forest);background:${ing.checked ? 'var(--forest)' : 'transparent'};color:var(--cream);display:flex;align-items:center;justify-content:center;font-weight:700` }, ing.checked ? '✓' : ''),
        h('div', { style: `font-size:${sp(25)};line-height:${sp(30)};${ing.checked ? 'text-decoration:line-through' : ''}` }, shown)));
    });
    dyn.append(place(h('div'), page.region('ingredients')));
    dyn.lastChild.append(ingList);
    // directions with automatic numbering
    const dirList = h('div', { class: 'scroll-y fade-bottom', 'data-testid': 'direction-list', style: 'height:100%' });
    if (!r.directions.length) dirList.append(h('div', { style: `color:rgba(42,33,24,.7);font-size:${sp(22)}` }, 'No directions yet. Tap “Directions” to add some.'));
    let n = 0;
    r.directions.forEach((d) => {
      if (d.header) { dirList.append(h('div', { role: 'heading', 'aria-level': '3', style: `font-weight:700;color:var(--forest);font-size:${sp(24)};padding-top:6px` }, d.text)); return; }
      n++;
      dirList.append(h('div', { style: 'display:flex;align-items:flex-start;padding:3px 0;color:var(--ink)' },
        h('div', { style: 'width:32px;height:32px;flex:none;border-radius:50%;background:var(--forest);color:var(--cream);font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center' }, String(n)),
        h('div', { style: `margin-left:10px;padding-right:${dp(70)};font-size:${sp(24)};line-height:${sp(30)}` }, d.text)));
    });
    dyn.append(place(h('div'), page.region('directions')));
    dyn.lastChild.append(dirList);
  }
  render();
  art.destroy = live(ctx, art.el, render);
  return art;
}
