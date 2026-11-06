// Port of ui/screens/ReviewScreen.kt: review, correct and save an import (or edit an existing recipe).
import { h, mount } from '../ui/dom.js';
import { ArtPage, place, dp, sp } from '../ui/art.js';
import { Routes } from '../ui/nav.js';
import { bigButton, chip, sheet, dialog, confirmDialog, say, undoable, photoImg, editableRows, EditRow, rowsEditorSheet } from '../ui/widgets.js';
import { Recipe, Ingredient, Direction, Severity, Confidence } from '../engine/models.js';
import { timerSeconds } from '../engine/durations.js';
import { pickFile } from '../ui/shared.js';
import { addCategorySheet } from './categoryparts.js';

const intOrNull = (s) => (/^\s*-?\d+\s*$/.test(s) ? parseInt(s, 10) : null);

export function reviewScreen(params, ctx, nav) {
  const editId = params.edit || null;
  let s, originalPhoto = null, saved = false;
  const rowsOf = (list) => list.map((x) => ({ id: x.id, text: x.text, header: x.header }));
  function fromRecipe(r, w, conf, cands) {
    if (editId) originalPhoto = r.photo;
    return { title: r.title, description: r.description, notes: r.notes, cuisine: r.cuisine ?? '', sourceText: r.sourceUrl ?? r.sourceName ?? '', sourceUrl: r.sourceUrl, photo: r.photo,
      ingredients: rowsOf(r.ingredients), directions: rowsOf(r.directions), prep: r.prepMinutes?.toString() ?? '', cook: r.cookMinutes?.toString() ?? '', total: r.totalMinutes?.toString() ?? '', servings: r.servings?.toString() ?? '',
      categories: new Set(r.categoryIds), rawSource: r.rawSource, warnings: w, confidence: conf, candidates: cands, candidateIndex: 0, showErrors: false, editingId: editId ? r.id : null,
      favorite: r.favorite, dirty: false, timers: new Map(r.directions.map((d) => [d.id, d.timerSeconds])), createdAt: r.createdAt };
  }
  if (editId) { const r = ctx.repo.getRecipe(editId); if (r) s = fromRecipe(r, [], null, []); }
  else if (ctx.importSession.draft) { const d = ctx.importSession.draft; s = { ...fromRecipe(d.recipe, d.warnings, d.confidence, d.imageCandidates), photo: ctx.importSession.photoFile, dirty: true }; }
  s ||= { ...fromRecipe(Recipe(), [], null, []), editingId: null };
  if (!s.ingredients.length) s.ingredients = [EditRow('')];
  if (!s.directions.length) s.directions = [EditRow('')];
  const edit = (f) => { s = { ...f(s), dirty: true }; };

  const problems = () => {
    const out = [];
    if (!s.title.trim()) out.push('Add a title.');
    if (!s.ingredients.some((i) => i.text.trim() && !i.header) && !s.directions.some((d) => d.text.trim() && !d.header)) out.push('Add at least one ingredient or direction.');
    if (s.prep.trim() && intOrNull(s.prep) == null) out.push('Prep time must be a number of minutes.');
    if (s.cook.trim() && intOrNull(s.cook) == null) out.push('Cook time must be a number of minutes.');
    if (s.total.trim() && intOrNull(s.total) == null) out.push('Total time must be a number of minutes.');
    if (s.servings.trim() && intOrNull(s.servings) == null) out.push('Servings must be a number.');
    return out;
  };
  function buildRecipe() {
    const src = s.sourceText.trim();
    const isUrl = /^https?:\/\//i.test(src);
    const url = isUrl ? src : (s.sourceUrl && s.sourceUrl.trim() && src && !isUrl && !s.sourceUrl.toLowerCase().includes(src.toLowerCase()) ? s.sourceUrl : null);
    let name = null;
    if (isUrl) { try { name = new URL(src).host.replace(/^www\./, '') || null; } catch { name = null; } } else name = src || null;
    return Recipe({ ...(s.editingId ? { id: s.editingId } : {}), title: s.title.trim(), description: s.description.trim(), notes: s.notes.trim(), photo: s.photo,
      sourceUrl: url ?? (isUrl ? src : s.sourceUrl), sourceName: name, cuisine: s.cuisine.trim() || null,
      prepMinutes: intOrNull(s.prep), cookMinutes: intOrNull(s.cook), totalMinutes: intOrNull(s.total), servings: intOrNull(s.servings),
      ingredients: s.ingredients.filter((i) => i.text.trim()).map((i) => Ingredient({ id: i.id, text: i.text.trim(), header: i.header })),
      directions: s.directions.filter((d) => d.text.trim()).map((d) => Direction({ id: d.id, text: d.text.trim(), header: d.header, timerSeconds: d.header ? null : (s.timers.get(d.id) ?? timerSeconds(d.text)) })),
      categoryIds: [...s.categories], favorite: s.favorite, rawSource: s.rawSource, createdAt: s.createdAt });
  }
  async function save(r) {
    const savedR = await ctx.repo.saveRecipe(r);
    if (originalPhoto && originalPhoto !== savedR.photo) await ctx.photos.delete(originalPhoto);
    ctx.importSession.clear(); saved = true;
    nav.goPopUpTo(Routes.DETAIL, { id: savedR.id }, Routes.HUB);
    say('Saved to your collection');
  }
  async function trySave() {
    const p = problems();
    if (p.length) { s = { ...s, showErrors: true }; renderErrors(); say(p[0]); return; }
    const r = buildRecipe();
    const dup = !s.editingId ? ctx.repo.recipes().find((x) => (r.sourceUrl != null && x.sourceUrl === r.sourceUrl) || x.title.toLowerCase() === r.title.toLowerCase()) : null;
    if (dup) dialog({ title: 'You may already have this', text: `“${dup.title}” is already in your collection. Save this as a separate recipe, or keep the one you have?`, confirm: 'Save as new', cancel: 'Open existing', onConfirm: () => save(buildRecipe()), onCancel: () => nav.go(Routes.DETAIL, { id: dup.id }) });
    else save(r);
  }
  const leave = () => { if (s.dirty && !saved) confirmDialog('Leave without saving?', "Your changes to this recipe haven't been saved.", 'Discard', () => { if (!editId) ctx.importSession.clear(); nav.back(); }, true); else nav.back(); };

  const warn = (...fields) => s.warnings.filter((w) => fields.includes(w.field) && (w.severity !== Severity.INFO || ['photo', 'servings', 'times', 'source'].includes(w.field))).map((w) => w.message);

  const art = ArtPage(ctx.art, 'review', { title: editId ? 'Edit recipe' : 'Review and save', prefs: ctx.prefs, onTarget: (id) => {
    switch (id) {
      case 'back': leave(); break;
      case 'photo': photoMenu(); break;
      case 'add_ingredient': edit((x) => ({ ...x, ingredients: [...x.ingredients, EditRow('')] })); ingEd.setRows(s.ingredients); ingEd.focusLast(); break;
      case 'add_direction': edit((x) => ({ ...x, directions: [...x.directions, EditRow('')] })); dirEd.setRows(s.directions); dirEd.focusLast(); break;
      case 'ingredients_head': rowsEditorSheet({ title: 'Ingredients', initial: s.ingredients, hint: 'e.g. 1 1/2 cups flour', numbered: false, allowHeaders: true, onSave: (r) => { edit((x) => ({ ...x, ingredients: r })); ingEd.setRows(s.ingredients); } }); break;
      case 'directions_head': rowsEditorSheet({ title: 'Directions', initial: s.directions, hint: 'Describe this step', numbered: true, allowHeaders: true, onSave: (r) => { edit((x) => ({ ...x, directions: r })); dirEd.setRows(s.directions); } }); break;
      case 'add_category': addCategorySheet(ctx, s.categories, (cid, on) => { edit((x) => { const c = new Set(x.categories); on ? c.add(cid) : c.delete(cid); return { ...x, categories: c }; }); drawCats(); }); break;
      case 'details': detailsSheet(); break;
      case 'save': trySave(); break;
    }
  } });
  const { content, page } = art;
  const dyn = h('div'); content.append(dyn);

  // photo over the placeholder
  const photoHolder = place(h('div', { style: `border-radius:${dp(14)};overflow:hidden;pointer-events:none` }), page.target('photo').box);
  function drawPhoto() { mount(photoHolder); if (s.photo) { const p = photoImg(ctx.photos, s.photo, { fallback: s.title, alt: 'Recipe photo. Tap to change.' }); p.style.cssText = 'position:absolute;inset:0'; photoHolder.append(p); } }
  // title + source
  const titleStyle = `font-family:var(--display);font-weight:700;font-size:${sp(32)};color:var(--ink)`;
  const title = h('input', { type: 'text', value: s.title, 'data-testid': 'title-field', 'aria-label': 'Recipe title', placeholder: 'Recipe title', autocapitalize: 'words', enterkeyhint: 'next',
    style: `width:100%;border:0;background:transparent;${titleStyle}`, oninput: (e) => { edit((x) => ({ ...x, title: e.target.value })); if (s.showErrors) renderErrors(); } });
  const titleBox = place(h('div', { style: `display:flex;align-items:center;padding-left:${dp(14)};padding-right:${dp(48)};border-radius:${dp(14)}` }, title), page.region('title'));
  const titleErr = place(h('div', { 'aria-hidden': 'true', style: `border:3px solid var(--error);border-radius:${dp(14)};display:none;pointer-events:none` }), page.region('title'));
  const source = h('input', { type: 'url', value: s.sourceText, 'data-testid': 'source-field', 'aria-label': 'Source', placeholder: 'Source (website or cookbook)', autocapitalize: 'none', enterkeyhint: 'next',
    style: `width:100%;border:0;background:transparent;font-size:${sp(28)};color:var(--ink)`, oninput: (e) => edit((x) => ({ ...x, sourceText: e.target.value })) });
  const sourceBox = place(h('div', { style: `display:flex;align-items:center;padding:0 ${dp(10)}` }, source), page.region('source'));
  function renderErrors() { const bad = s.showErrors && !s.title.trim(); titleErr.style.display = bad ? 'block' : 'none'; title.placeholder = bad ? 'Title needed' : 'Recipe title'; }

  const badge = (label, messages, rect, extra = {}) => {
    if (!messages.length) return null;
    const b = h('button', { type: 'button', 'aria-label': `Needs a look: ${label}`, 'data-testid': `warn:${label}`, style: 'width:48px;height:48px;border:0;background:transparent;display:flex;align-items:center;justify-content:center;padding:0',
      onclick: () => dialog({ title: `Check: ${label}`, content: h('div', null, messages.map((m) => h('p', null, `• ${m}`))), confirm: 'OK', noCancel: true }) },
      h('span', { style: 'width:28px;height:28px;border-radius:50%;background:#FFE08A;border:2px solid #8A5A00;color:#5A3A00;font-weight:800;display:flex;align-items:center;justify-content:center' }, '!'));
    place(b, rect); Object.assign(b.style, { position: 'absolute', ...extra }); return b;
  };
  const badges = h('div');
  function drawBadges() {
    mount(badges, badge('title', warn('title'), { x: 0.80, y: 0.205, w: 0.12, h: 0.05 }), badge('photo', warn('photo'), { x: 0.30, y: 0.20, w: 0.07, h: 0.05 }, { transform: `translateY(${dp(-40)})` }),
      badge('ingredients', warn('ingredients'), { x: 0.52, y: 0.352, w: 0.12, h: 0.04 }), badge('directions', warn('directions'), { x: 0.52, y: 0.552, w: 0.12, h: 0.04 }));
  }

  const mkRows = (key, numbered, hint, tag) => editableRows({ rows: s[key], numbered, hint, compact: true, tag, fontSize: sp(30), lineHeight: sp(38), newRow: () => EditRow(''),
    onRows: (r) => { s = { ...s, [key]: r, dirty: true }; },
    onDelete: (row, i) => { const before = s[key]; edit((x) => ({ ...x, [key]: before.length === 1 ? [EditRow('')] : before.filter((r) => r.id !== row.id) })); (key === 'ingredients' ? ingEd : dirEd).setRows(s[key]); undoable(`Removed ${numbered ? 'step' : 'ingredient'} ${i + 1}`, () => { edit((x) => ({ ...x, [key]: before })); (key === 'ingredients' ? ingEd : dirEd).setRows(s[key]); }); } });
  const ingEd = mkRows('ingredients', false, 'Ingredient, e.g. 2 cups flour', 'ing-rows');
  const dirEd = mkRows('directions', true, 'Describe this step', 'dir-rows');
  const scrollWrap = (el) => h('div', { class: 'scroll-y fade-bottom ia', style: 'height:100%' }, el);
  const ingBox = place(h('div', null, scrollWrap(ingEd.el)), page.region('ingredients'));
  const dirBox = place(h('div', null, scrollWrap(dirEd.el)), page.region('directions'));
  const catBox = place(h('div', { class: 'scroll-y fade-bottom ia chips', 'data-testid': 'review-categories', style: 'align-content:flex-start;gap:6px' }), { x: 0.505, y: 0.811, w: 0.45, h: 0.1 });
  function drawCats() {
    const cats = ctx.repo.categories();
    mount(catBox, cats.filter((c) => c.enabled || s.categories.has(c.id)).map((c) => chip(c.name, s.categories.has(c.id), () => { edit((x) => { const set = new Set(x.categories); set.has(c.id) ? set.delete(c.id) : set.add(c.id); return { ...x, categories: set }; }); drawCats(); })));
  }
  dyn.append(photoHolder, titleBox, titleErr, sourceBox, badges, ingBox, dirBox, catBox);

  function photoMenu() {
    sheet({ label: 'Recipe photo', content: (close) => h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, h('h2', { class: 'sheet-title' }, 'Recipe photo'),
      bigButton('Choose from photo library', async () => { close(false); const f = await pickFile({ accept: 'image/*' }); if (f) { const n = await ctx.photos.saveBlob(f); if (n) { edit((x) => ({ ...x, photo: n })); drawPhoto(); } else say("That photo couldn't be used."); } }),
      bigButton('Take a photo', async () => { close(false); const f = await pickFile({ accept: 'image/*', capture: 'environment' }); if (f) { const n = await ctx.photos.saveBlob(f); if (n) { edit((x) => ({ ...x, photo: n })); drawPhoto(); } else say("That photo couldn't be used."); } }, { primary: false }),
      s.candidates.length > 1 ? bigButton('Try another image from the page', async () => { close(false); const next = (s.candidateIndex + 1) % s.candidates.length; const file = await ctx.importer.fetchPhoto([s.candidates[next]]); if (file) { edit((x) => ({ ...x, photo: file, candidateIndex: next })); drawPhoto(); } else say("That image couldn't be downloaded."); }, { primary: false }) : null,
      s.photo ? bigButton('Remove photo', () => { close(false); edit((x) => ({ ...x, photo: null })); drawPhoto(); }, { primary: false }) : null) });
  }

  function detailsSheet() {
    sheet({ label: 'Edit details', tall: true, content: (close) => {
      const num = (label, key, tid) => h('div', { style: 'flex:1' }, h('label', { class: 'lbl' }, label), h('input', { class: 'field', type: 'text', inputmode: 'numeric', 'data-testid': tid, value: s[key], 'aria-label': label, oninput: (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); edit((x) => ({ ...x, [key]: e.target.value })); } }));
      const txt = (label, key, extra = {}, tag = 'input', tid = null) => h('div', null, h('label', { class: 'lbl' }, label), h(tag, { class: 'field', value: s[key] ?? '', 'aria-label': label, 'data-testid': tid, ...extra, oninput: (e) => edit((x) => ({ ...x, [key]: tag === 'input' && key === 'sourceUrl' ? (e.target.value || null) : e.target.value })) }));
      const infos = s.warnings.filter((w) => w.severity === Severity.INFO);
      return h('div', { class: 'sheet-col' }, h('h2', { class: 'sheet-title' }, 'Edit details'),
        h('div', { class: 'sheet-scroll', style: 'display:flex;flex-direction:column;gap:4px' },
          h('div', { class: 'row-line', style: 'align-items:flex-start' }, num('Servings', 'servings', 'servings-field'), num('Prep (min)', 'prep', 'prep-field')),
          h('div', { class: 'row-line', style: 'align-items:flex-start' }, num('Cook (min)', 'cook', 'cook-field'), num('Total (min)', 'total', 'total-field')),
          txt('Cuisine', 'cuisine'), txt('Original link', 'sourceUrl', { type: 'url' }), txt('Description', 'description', { style: 'min-height:90px' }, 'textarea'), txt('Notes and substitutions', 'notes', { style: 'min-height:90px' }, 'textarea', 'notes-field'),
          h('div', { class: 'sheet-row', style: 'margin-top:8px' }, bigButton('Edit all ingredients', () => { close(false); document.querySelector('[data-art=ingredients_head]')?.click(); }, { primary: false }), bigButton('Edit all directions', () => { close(false); document.querySelector('[data-art=directions_head]')?.click(); }, { primary: false })),
          s.rawSource != null ? h('p', { class: 'sheet-note' }, 'The original imported text is kept with this recipe so you can fix mistakes later.') : null,
          infos.length ? h('div', null, h('h3', null, 'Import notes'), infos.map((w) => h('p', { class: 'sheet-note' }, `• ${w.message}`))) : null),
        bigButton('Done', () => close(), { testid: 'details-done' }));
    } });
  }

  drawPhoto(); drawBadges(); drawCats(); renderErrors();
  if (s.confidence != null && s.confidence !== Confidence.HIGH) setTimeout(() => say('Some parts were guessed. Look for the yellow ! marks.'), 300);
  const un = ctx.repo.subscribe(() => { if (art.el.isConnected) drawCats(); });
  art.destroy = un;
  art.leave = leave;
  return art;
}
