// Port of ui/screens/DetailScreen.kt.
import { h, mount, minutesLabel } from '../ui/dom.js';
import { ScrollPage } from '../ui/page.js';
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
  // One continuous page: photo, title, times, ingredients and directions scroll together, nothing is clipped or nested.
  const page = ScrollPage({ title: 'Recipe', slot: 'page_11', testid: 'detail', onBack: () => nav.backOr(Routes.COLLECTION) });
  const art = { el: page.el, destroy: null };

  const step = (d) => { const r = recipe(); const base = r?.servings ?? st.servings ?? 4; st.servings = Math.min(99, Math.max(1, (st.servings ?? base) + d)); render(); };
  const setPhoto = async (name) => { const r = recipe(); if (r) await ctx.repo.saveRecipe({ ...r, photo: name }); };
  const startCook = (r) => { if (!r.directions.some((d) => !d.header)) say('Add directions first, then Cook Mode can guide you.'); else nav.go(Routes.COOK, { id: r.id, servings: st.servings }); };
  const toGrocery = (r) => { if (!r.ingredients.some((i) => !i.header)) say('This recipe has no ingredients yet.'); else groceryAddSheet(ctx, r, st.servings, () => nav.go(Routes.GROCERY)); };

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
  let hasOriginal = false; ctx.drafts?.forRecipe(id).then((o) => { hasOriginal = !!o; });
  function moreMenu(r) {
    sheet({ label: 'More options', content: (close) => h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, h('h2', { class: 'sheet-title' }, r.title.trim() || 'Recipe'),
      bigButton('Edit details', () => { close(false); nav.go(Routes.REVIEW, { edit: r.id }); }, { primary: false }),
      hasOriginal ? bigButton('View the original', () => { close(false); nav.go(Routes.ORIGINAL, { id: r.id }); }, { primary: false, testid: 'view-original' }) : null,
      bigButton('Add to meal plan', () => { close(false); dayPickerSheet(`Add “${r.title}” to which day?`, async (date) => { await ctx.repo.assignMeal(date, r.id, st.servings ?? r.servings); say(`Planned for ${Planner.dayLabel(date)}, ${Planner.dateLabel(date)}.`); }); }, { primary: false }),
      bigButton('Share as text', () => { close(false); shareText(r.title, recipeText(r, st.servings)); }, { primary: false }),
      bigButton('Delete recipe', () => { close(false); confirmDialog('Delete this recipe?', `“${r.title}” will be removed from your collection and meal plan. You can undo right after.`, 'Delete', async () => {
        const removed = await ctx.repo.deleteRecipe(r.id); nav.backOr(Routes.COLLECTION); if (removed) undoable(`Deleted “${removed.title}”`, () => ctx.repo.restoreRecipe(removed)); }, true); }, { primary: false, testid: 'delete-recipe' })) });
  }

  const act = (label, id, onclick, primary = false, extra = {}) => h('button', { type: 'button', class: 'big-btn ' + (primary ? 'primary' : 'outline'), 'data-art': id, 'data-testid': `act-${id}`, onclick, ...extra }, label);
  function render() {
    const r = recipe(); const cats = ctx.repo.categories();
    if (!r) { mount(page.body, h('div', { class: 'sp-warn' }, 'This recipe is no longer in your collection.')); return; }
    page.setTitle(r.title.trim() || 'Recipe');
    const factor = Q.factor(r.servings, st.servings);
    const serv = st.servings ?? r.servings;
    const names = r.categoryIds.map((cid) => cats.find((c) => c.id === cid)?.name).filter(Boolean);
    const src = r.sourceName ?? r.sourceUrl;
    const heart = h('button', { type: 'button', class: 'sp-mini', 'aria-label': r.favorite ? 'Remove from favorites' : 'Add to favorites', 'aria-pressed': String(r.favorite), 'data-art': 'favorite', 'data-testid': `heart-glyph:${r.favorite ? 'on' : 'off'}`, style: 'color:var(--tomato);font-size:28px', onclick: () => ctx.repo.setFavorite(r.id, !r.favorite) }, r.favorite ? '♥' : '♡');
    const more = h('button', { type: 'button', class: 'sp-mini', 'aria-label': 'More options', 'data-testid': 'detail-more', style: 'font-size:28px', onclick: () => moreMenu(r) }, '⋯');
    const ph = r.photo ? photoImg(ctx.photos, r.photo, { fallback: r.title, alt: `Photo of ${r.title}`, cls: 'sp-photo' }) : null;
    if (ph) { ph.setAttribute('role', 'button'); ph.style.cursor = 'pointer'; ph.dataset.art = 'photo'; ph.addEventListener('click', () => photoMenu(r)); }
    const meta = [['Prep', minutesLabel(r.prepMinutes)], ['Cook', minutesLabel(r.cookMinutes)], ['Total', minutesLabel(effectiveTotal(r))]];
    const ingNodes = !r.ingredients.length ? [h('div', { class: 'sp-warn' }, 'No ingredients yet. Tap “Edit ingredients” to add some.')] : r.ingredients.map((ing) => {
      if (ing.header) return h('div', { role: 'heading', 'aria-level': '3', style: 'font-weight:700;color:var(--forest);padding-top:6px' }, ing.text);
      const shown = Q.scale(ing.text, factor);
      return h('div', { role: 'checkbox', tabindex: '0', 'aria-checked': String(ing.checked), 'aria-label': shown, 'data-testid': `ingredient:${ing.id}`, class: 'sp-line', style: 'cursor:pointer',
        onclick: () => ctx.repo.updateIngredients(id, (l) => l.map((x) => (x.id === ing.id ? { ...x, checked: !x.checked } : x))),
        onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.target.click(); } } },
        h('div', { style: `width:26px;height:26px;flex:none;border-radius:6px;border:2px solid var(--forest);background:${ing.checked ? 'var(--forest)' : 'transparent'};color:var(--cream);display:flex;align-items:center;justify-content:center;font-weight:700` }, ing.checked ? '✓' : ''),
        h('div', { style: ing.checked ? 'text-decoration:line-through;opacity:.7' : '' }, shown));
    });
    let n = 0;
    const dirNodes = !r.directions.length ? [h('div', { class: 'sp-warn' }, 'No directions yet. Tap “Edit directions” to add some.')] : r.directions.map((d) => {
      if (d.header) return h('div', { role: 'heading', 'aria-level': '3', style: 'font-weight:700;color:var(--forest);padding-top:6px' }, d.text);
      n++;
      return h('div', { class: 'sp-line', style: 'align-items:flex-start' }, h('div', { style: 'width:32px;height:32px;flex:none;border-radius:50%;background:var(--forest);color:var(--cream);font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:4px' }, String(n)), h('div', { style: 'padding:4px 0' }, d.text));
    });
    const keep = page.body.scrollTop;
    mount(page.body,
      h('div', { class: 'sp-bar', style: 'position:static;justify-content:flex-end;padding:0' }, heart, more),
      ph, !ph ? bigButton('Add a photo', () => photoMenu(r), { primary: false, testid: 'detail-photo' }) : null,
      h('div', null, h('h2', { class: 'sp-h2', style: 'font-size:calc(30px * var(--ts));color:var(--ink)', 'data-testid': 'detail-title' }, r.title.trim() || 'Untitled recipe'),
        names.length ? h('div', { style: 'color:var(--forest);font-weight:600' }, names.join(' · ')) : null,
        r.description.trim() ? h('p', { style: 'margin:6px 0 0' }, r.description) : null,
        src ? h('div', { role: r.sourceUrl ? 'link' : null, tabindex: r.sourceUrl ? '0' : null, style: 'color:var(--forest);text-decoration:underline;min-height:32px;padding:4px 0', onclick: () => { if (r.sourceUrl && !openLink(r.sourceUrl)) say("The link couldn't be opened."); } }, `Source: ${src}`) : null,
        r.notes.trim() ? h('p', { style: 'margin:6px 0 0' }, `Notes: ${r.notes}`) : null),
      h('div', { class: 'sheet-row' }, ...meta.map(([l, v]) => h('div', { role: 'text', 'aria-label': `${l} time: ${v ?? 'not set'}`, class: 'sp-line', style: 'flex-direction:column;align-items:center;text-align:center;min-height:0' }, h('span', { style: 'font-size:13px;opacity:.7' }, l), h('strong', null, v ?? '—')))),
      h('div', { class: 'sp-line', style: 'justify-content:space-between;align-items:center' }, h('strong', null, 'Servings'),
        h('div', { style: 'display:flex;align-items:center;gap:6px' }, h('button', { type: 'button', class: 'sp-mini', 'aria-label': 'Fewer servings', 'data-art': 'serv_dec', onclick: () => step(-1) }, '−'),
          h('strong', { 'aria-live': 'polite', 'aria-label': `Servings: ${serv ?? 'not set'}`, 'data-testid': 'servings-value', style: 'min-width:2ch;text-align:center;font-size:22px' }, serv != null ? String(serv) : '—'),
          h('button', { type: 'button', class: 'sp-mini', 'aria-label': 'More servings', 'data-art': 'serv_inc', onclick: () => step(1) }, '+'))),
      h('div', { class: 'sheet-row' }, act('Start Cook Mode', 'cook', () => startCook(r), true), act('Add to grocery list', 'grocery', () => toGrocery(r))),
      h('section', { class: 'sp-sec', 'data-art-slot': 'ingredients', 'data-testid': 'ingredient-list' }, h('button', { class: 'sp-h2', type: 'button', style: 'text-align:left;background:none;border:0;padding:0', 'data-art': 'ingredients_head', onclick: () => ingEditor(r) }, 'Ingredients ✎'), ...ingNodes),
      h('section', { class: 'sp-sec', 'data-art-slot': 'directions', 'data-testid': 'direction-list' }, h('button', { class: 'sp-h2', type: 'button', style: 'text-align:left;background:none;border:0;padding:0', 'data-art': 'directions_head', onclick: () => dirEditor(r) }, 'Directions ✎'), ...dirNodes));
    page.body.scrollTop = keep;
  }
  render();
  art.destroy = live(ctx, page.el, render);
  return art;
}
