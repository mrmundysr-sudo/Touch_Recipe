// Port of ui/screens/RescueScreen.kt: fix a bad import by sending the right text to the right place, never guessing.
// Two tabs on a phone: Recipe (the editable result) and Original (what was captured). Every edit can be undone.
import { h, mount } from '../ui/dom.js';
import { Routes } from '../ui/nav.js';
import { ScrollPage, Section } from '../ui/page.js';
import { bigButton, textButton, sheet, dialog, confirmDialog, say, undoable, chip, iconBtn, photoImg } from '../ui/widgets.js';
import * as R from '../engine/rescue.js';
import { Recipe } from '../engine/models.js';
import { validate } from '../engine/validator.js';
import { pickFile } from '../ui/shared.js';
import { cropSheet } from './crop.js';

/** Starts a rescue draft from an import draft (or edits an existing one), stored privately so it survives leaving the app. */
export const draftFromImport = (d) => R.newDraft({ recipe: d.recipe, source: d.source || R.emptySource(), imageCandidates: d.imageCandidates || [], findings: validate(d).warnings || [] });

export function askText({ title, hint = '', initial = '', multiline = false, ok = 'Save', note = null, onOk }) {
  sheet({ label: title, tall: multiline, content: (close) => {
    const f = multiline ? h('textarea', { class: 'field', 'aria-label': title, placeholder: hint, style: 'min-height:180px', 'data-testid': 'ask-field' }) : h('input', { class: 'field', type: 'text', 'aria-label': title, placeholder: hint, 'data-testid': 'ask-field', onkeydown: (e) => { if (e.key === 'Enter') go(); } });
    f.value = initial;
    const go = () => { close(false); onOk(f.value); };
    return h('div', { class: 'sheet-col' }, h('h2', { class: 'sheet-title' }, title), note ? h('p', { class: 'sheet-note' }, note) : null, f, h('div', { class: 'sheet-row' }, bigButton('Cancel', () => close(), { primary: false }), bigButton(ok, go, { testid: 'ask-ok' })));
  } });
}

export function rescueScreen(params, ctx, nav) {
  const drafts = ctx.drafts;
  let st = null, tab = 'recipe', alive = true, saveTimer = null, originalLines = [], urls = {};
  const page = ScrollPage({ title: 'Recipe Rescue', testid: 'rescue', slot: 'page_15', onBack: () => leave() });
  const undoBtn = iconBtn('Undo', '↶', () => apply(R.undo(st)), ''); const redoBtn = iconBtn('Redo', '↷', () => apply(R.redo(st)), '');
  undoBtn.dataset.testid = 'rescue-undo'; redoBtn.dataset.testid = 'rescue-redo';
  page.head.querySelector('.sp-actions').append(undoBtn, redoBtn);

  const apply = (next) => { st = next; schedule(); render(); };
  const schedule = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 400); };
  const flush = async () => { clearTimeout(saveTimer); saveTimer = null; if (st && !st.draft.recipeId) st = { ...st, draft: await drafts.save(st.draft) }; };
  const leave = async () => { await flush(); nav.backOr(Routes.HUB); };

  const recipe = () => st.draft.recipe;
  const hasImg = () => R.allFiles(st.draft.source).length > 0;

  // ---------- sheets ----------
  function addMenu() {
    sheet({ label: 'Add to recipe', content: (close) => h('div', { class: 'sheet-col' }, h('h2', { class: 'sheet-title' }, 'Add to the recipe'),
      bigButton('Smart Paste…', () => { close(false); smartPaste(); }, { testid: 'smart-paste' }),
      bigButton('Add ingredients…', () => { close(false); askText({ title: 'Add ingredients', hint: 'One per line', multiline: true, ok: 'Add', onOk: (t) => apply(R.addIngredients(st, t)) }); }, { primary: false }),
      bigButton('Add steps…', () => { close(false); askText({ title: 'Add steps', hint: 'One per line or paragraph', multiline: true, ok: 'Add', onOk: (t) => apply(R.addSteps(st, t)) }); }, { primary: false }),
      bigButton('Add a note…', () => { close(false); askText({ title: 'Add a note', multiline: true, ok: 'Add', onOk: (t) => apply(R.addNotes(st, t)) }); }, { primary: false })) });
  }
  function smartPaste() {
    askText({ title: 'Smart Paste', hint: 'Paste anything: a whole recipe or part of one', multiline: true, ok: 'Preview', note: 'You will see what goes where before anything is added. Nothing already in the recipe is overwritten.',
      onOk: (t) => {
        const p = R.planSmartPaste(t);
        if (p.isEmpty) { say('Nothing recognisable in that text. Try adding it line by line instead.'); return; }
        dialog({ title: 'Add this?', confirm: 'Add', cancel: 'Cancel', content: h('div', null,
          p.title.trim() ? h('p', null, `Title: ${p.title}`) : null, h('p', null, `${p.ingredients.filter((i) => !i.header).length} ingredients, ${p.directions.filter((d) => !d.header).length} steps`),
          p.servings != null ? h('p', null, `Servings: ${p.servings}`) : null, p.leftover.length ? h('p', { class: 'sheet-note' }, `${p.leftover.length} lines could not be placed and will be left out.`) : null),
          onConfirm: () => apply(R.applySmartPaste(st, p)) });
      } });
  }
  function startFresh() {
    sheet({ label: 'Start fresh', content: (close) => {
      const keep = new Set([R.TITLE, R.PHOTO]);
      const opts = [[R.TITLE, 'Title'], [R.PHOTO, 'Photo'], [R.SERVINGS, 'Servings'], [R.TIMES, 'Times'], [R.INGREDIENTS, 'Ingredients'], [R.DIRECTIONS, 'Steps'], [R.NOTES, 'Notes']];
      const box = h('div', { class: 'chips' });
      const draw = () => mount(box, opts.map(([k, l]) => chip(l, keep.has(k), () => { keep.has(k) ? keep.delete(k) : keep.add(k); draw(); })));
      draw();
      return h('div', { class: 'sheet-col' }, h('h2', { class: 'sheet-title' }, 'Start fresh'),
        h('p', { class: 'sheet-note' }, 'Clears everything except the parts you keep. The original is never touched, and one Undo brings it all back.'), box,
        h('div', { class: 'sheet-row' }, bigButton('Cancel', () => close(), { primary: false }), bigButton('Clear the rest', () => { close(false); apply(R.startFresh(st, [...keep])); undoable('Cleared', () => apply(R.undo(st))); }, { testid: 'start-fresh-go' })));
    } });
  }
  function lineMenu(item, kind) {
    const isHdr = item.header;
    sheet({ label: 'Edit line', content: (close) => h('div', { class: 'sheet-col' }, h('h2', { class: 'sheet-title' }, kind === 'ing' ? 'Ingredient' : 'Step'),
      bigButton('Edit text…', () => { close(false); askText({ title: 'Edit', initial: item.text, multiline: true, onOk: (t) => apply(kind === 'ing' ? R.editIngredient(st, item.id, t) : R.editStep(st, item.id, t)) }); }),
      bigButton(isHdr ? 'Make it a normal line' : 'Make it a heading', () => { close(false); apply(R.toggleHeader(st, item.id)); }, { primary: false }),
      bigButton('Ask the family about this…', () => { close(false); askText({ title: 'Question for the family', hint: 'e.g. how much flour?', onOk: (t) => apply(R.addHelp(st, item.id, t)) }); }, { primary: false }),
      bigButton('Select several lines', () => { close(false); apply(R.toggle(R.startSelecting(st), item.id)); }, { primary: false }),
      bigButton('Delete line', () => { close(false); apply(R.remove(st, item.id)); undoable('Line deleted', () => apply(R.undo(st))); }, { primary: false })) });
  }
  function fieldSheet(which) {
    const r = recipe();
    const map = {
      title: () => askText({ title: 'Title', initial: r.title, onOk: (t) => apply(R.setTitle(st, t)) }),
      servings: () => askText({ title: 'Servings', initial: r.servings ?? '', hint: 'A number', onOk: (t) => (t.trim() ? apply(R.setServings(st, t)) : apply(R.clearServings(st))) }),
      time: () => sheet({ label: 'Times', content: (close) => {
        const mk = (l, v) => h('input', { class: 'field', type: 'text', inputmode: 'numeric', 'aria-label': `${l} minutes`, placeholder: `${l} (min)`, value: v ?? '' });
        const p = mk('Prep', r.prepMinutes), c = mk('Cook', r.cookMinutes), t = mk('Total', r.totalMinutes);
        return h('div', { class: 'sheet-col' }, h('h2', { class: 'sheet-title' }, 'Times'), p, c, t, bigButton('Save', () => { close(false); let n = st; n = R.setTime(n, 'prep', p.value); n = R.setTime(n, 'cook', c.value); n = R.setTime(n, 'total', t.value); apply(n); }));
      } }),
      notes: () => askText({ title: 'Notes', initial: r.notes, multiline: true, onOk: (t) => apply(R.setNotes(st, t)) }),
      description: () => askText({ title: 'Description', initial: r.description, multiline: true, onOk: (t) => apply(R.setDescription(st, t)) }),
    };
    map[which]();
  }
  async function photoMenu() {
    const r = recipe(); const src = st.draft.source;
    sheet({ label: 'Recipe photo', content: (close) => h('div', { class: 'sheet-col' }, h('h2', { class: 'sheet-title' }, 'Recipe photo'),
      src.dishPhoto ? bigButton('Use the dish photo found on the page', async () => { close(false); const b = await drafts.file(src.dishPhoto); const n = b && await ctx.photos.saveBlob(b); n ? apply(R.setPhoto(st, n)) : say("That photo couldn't be used."); }) : null,
      hasImg() ? bigButton('Cut a photo out of the original…', () => { close(false); cutFromOriginal(); }, { primary: false }) : null,
      bigButton('Choose from photo library', async () => { close(false); const f = await pickFile({ accept: 'image/*' }); if (f) { const n = await ctx.photos.saveBlob(f); n ? apply(R.setPhoto(st, n)) : say("That photo couldn't be used."); } }, { primary: false }),
      bigButton('Take a photo', async () => { close(false); const f = await pickFile({ accept: 'image/*', capture: 'environment' }); if (f) { const n = await ctx.photos.saveBlob(f); n ? apply(R.setPhoto(st, n)) : say("That photo couldn't be used."); } }, { primary: false }),
      r.photo ? bigButton('Remove photo', () => { close(false); apply(R.setPhoto(st, null)); }, { primary: false }) : null) });
  }
  async function cutFromOriginal(file = null) {
    const name = file || (st.draft.source.cleaned.find(Boolean) || st.draft.source.files[0]); if (!name) return;
    const blob = await drafts.file(name); if (!blob) { say('The original picture is no longer on this device.'); return; }
    cropSheet(blob, { title: 'Cut out the dish photo', onDone: async (b) => { const n = await ctx.photos.saveBlob(b); n ? apply(R.setPhoto(st, n)) : say("That photo couldn't be used."); } });
  }

  // ---------- creating the recipe ----------
  async function create() {
    const probs = R.problems(recipe());
    if (probs.length) { dialog({ title: 'Not ready yet', text: probs.join('\n'), confirm: 'OK', noCancel: true }); return; }
    const open = R.openQuestions(st.draft);
    const go = async () => {
      const r = R.cleaned(recipe());
      const saved = await ctx.repo.saveRecipe(Recipe({ ...r, sourceUrl: r.sourceUrl ?? st.draft.source.url ?? null, sourceName: r.sourceName ?? (st.draft.source.url ? hostOf(st.draft.source.url) : null) }));
      clearTimeout(saveTimer); saveTimer = null;
      await drafts.markDone(st.draft.id, saved.id);
      alive = false; ctx.importSession.clear();
      nav.goPopUpTo(Routes.DETAIL, { id: saved.id }, Routes.HUB); say('Saved to your collection');
    };
    if (open) dialog({ title: 'Questions still open', text: `${open} question${open === 1 ? '' : 's'} for the family ${open === 1 ? 'is' : 'are'} still open. Save the recipe anyway? The questions stay with the original.`, confirm: 'Save anyway', cancel: 'Not yet', onConfirm: go }); else go();
  }
  const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return null; } };
  function discard() { confirmDialog('Discard this unfinished recipe?', 'The draft and its saved original files will be deleted from this device.', 'Discard', async () => { alive = false; clearTimeout(saveTimer); await drafts.discard(st.draft.id); nav.backOr(Routes.HUB); say('Draft discarded'); }, true); }

  // ---------- recipe tab ----------
  function lineRow(item, kind, idx, total) {
    const sel = st.selection.includes(item.id), helps = R.helpFor(st, item.id);
    const label = (kind === 'dir' && !item.header ? `${recipe().directions.filter((d, i) => !d.header && i <= idx).length}. ` : '') + (item.text || '(empty)');
    return h('div', { class: `sp-line${sel ? ' selected' : ''}${item.header ? ' header' : ''}`, 'data-testid': `${kind}-line` },
      st.selecting ? h('input', { type: 'checkbox', checked: sel, 'aria-label': 'Select line', style: 'width:28px;height:28px', onchange: () => apply(R.toggle(st, item.id)) }) : null,
      h('div', { class: 'sp-text', role: 'button', tabindex: '0', onclick: () => (st.selecting ? apply(R.toggle(st, item.id)) : lineMenu(item, kind)) }, label,
        ...helps.map((n) => h('div', { class: 'sp-warn', style: 'margin-top:4px' }, `Ask: ${n.text}`))),
      !st.selecting ? h('button', { class: 'sp-mini', type: 'button', 'aria-label': 'Move up', disabled: idx === 0, onclick: () => apply(R.move(st, item.id, -1)) }, '↑') : null,
      !st.selecting ? h('button', { class: 'sp-mini', type: 'button', 'aria-label': 'Move down', disabled: idx === total - 1, onclick: () => apply(R.move(st, item.id, 1)) }, '↓') : null);
  }
  function fieldRow(label, value, which) { return h('button', { class: 'sp-line', type: 'button', style: 'text-align:left;cursor:pointer;width:100%', 'data-testid': `field-${which}`, onclick: () => fieldSheet(which) }, h('div', { class: 'sp-text' }, h('strong', null, label + ' '), value || h('span', { style: 'opacity:.6' }, 'Tap to add'))); }

  function recipeTab() {
    const r = recipe(); const out = [];
    const finds = st.draft.findings || [];
    if (finds.length) out.push(Section('Check these', ...finds.filter((f) => f.severity !== 'INFO').slice(0, 6).map((f) => h('div', { class: `sp-warn${f.severity === 'ERROR' ? ' error' : ''}` }, f.message))));
    out.push(Section('', h('div', { style: 'position:relative' }, r.photo ? photoImg(ctx.photos, r.photo, { cls: 'sp-photo', alt: 'Recipe photo' }) : h('div', { class: 'sp-photo', style: 'display:flex;align-items:center;justify-content:center;color:#6a5a40' }, 'No photo yet'),
      h('div', { style: 'margin-top:8px' }, bigButton(r.photo ? 'Change photo' : 'Add photo', photoMenu, { primary: false, testid: 'rescue-photo' })))));
    out.push(Section('Details', fieldRow('Title', r.title, 'title'), fieldRow('Servings', r.servings ?? '', 'servings'),
      fieldRow('Times', [r.prepMinutes != null ? `prep ${r.prepMinutes}` : '', r.cookMinutes != null ? `cook ${r.cookMinutes}` : '', r.totalMinutes != null ? `total ${r.totalMinutes}` : ''].filter(Boolean).join(' · '), 'time'),
      fieldRow('Notes', r.notes, 'notes')));
    const ingN = r.ingredients.length, dirN = r.directions.length;
    out.push(Section(`Ingredients (${r.ingredients.filter((i) => !i.header).length})`, ...(ingN ? r.ingredients.map((i, k) => lineRow(i, 'ing', k, ingN)) : [h('div', { class: 'sp-warn' }, 'No ingredients yet. Use Add, or send lines from the Original tab.')]),
      st.selecting ? textButton('Select all ingredients', () => apply(R.selectAllIngredients(st))) : null));
    out.push(Section(`Steps (${r.directions.filter((d) => !d.header).length})`, ...(dirN ? r.directions.map((d, k) => lineRow(d, 'dir', k, dirN)) : [h('div', { class: 'sp-warn' }, 'No steps yet. Use Add, or send lines from the Original tab.')]),
      st.selecting ? textButton('Select all steps', () => apply(R.selectAllSteps(st))) : null));
    const notes = st.draft.helpNotes;
    if (notes.length) out.push(Section('Questions for the family', ...notes.map((n) => h('div', { class: 'sp-line', style: n.resolved ? 'opacity:.55' : '' }, h('div', { class: 'sp-text' }, n.text),
      h('button', { class: 'sp-mini', type: 'button', 'aria-label': n.resolved ? 'Reopen' : 'Mark answered', onclick: () => apply(R.resolveHelp(st, n.id, !n.resolved)) }, n.resolved ? '↺' : '✓'),
      h('button', { class: 'sp-mini', type: 'button', 'aria-label': 'Delete question', onclick: () => apply(R.deleteHelp(st, n.id)) }, '✕')))));
    out.push(Section('', textButton('Start fresh…', startFresh), textButton('Discard this unfinished recipe', discard)));
    return out;
  }
  // ---------- original tab ----------
  function sendMenu(texts) {
    const text = texts.join('\n');
    sheet({ label: 'Send selected text', content: (close) => h('div', { class: 'sheet-col' }, h('h2', { class: 'sheet-title' }, `Send ${texts.length} line${texts.length === 1 ? '' : 's'} to…`),
      h('p', { class: 'sheet-note' }, text.length > 140 ? text.slice(0, 140) + '…' : text),
      bigButton('Ingredients', () => { close(false); apply(R.addIngredients(st, text)); originalSel.clear(); }, { testid: 'send-ing' }),
      bigButton('Steps', () => { close(false); apply(R.addSteps(st, text)); originalSel.clear(); }, { primary: false, testid: 'send-steps' }),
      bigButton('Title', () => { close(false); apply(R.setTitle(st, text)); originalSel.clear(); }, { primary: false }),
      bigButton('Servings', () => { close(false); apply(R.setServings(st, text)); originalSel.clear(); }, { primary: false }),
      bigButton('Notes', () => { close(false); apply(R.addNotes(st, text)); originalSel.clear(); }, { primary: false }),
      selectionToReplace() ? bigButton('Replace the lines I selected in the recipe', () => { close(false); apply(R.replaceSelected(st, text)); originalSel.clear(); }, { primary: false }) : null) });
  }
  const selectionToReplace = () => st.selection.length > 0;
  const originalSel = new Set();
  function originalTab() {
    const src = st.draft.source; const out = [];
    if (R.sourceIsEmpty(src)) return [Section('', h('div', { class: 'sp-warn' }, 'No original was kept for this recipe. You can still edit everything on the Recipe tab.'))];
    if (src.url) out.push(Section('', h('div', { class: 'sp-warn' }, `Captured from ${src.url}`), bigButton('Open the page in your browser', () => window.open(src.url, '_blank', 'noopener'), { primary: false })));
    const files = [...(src.cleaned || []).filter(Boolean), ...(src.files || [])];
    if (files.length) out.push(Section('Pictures', ...files.map((f) => {
      const img = h('img', { class: 'sp-img', alt: 'Captured page', 'data-testid': 'original-image' }); drafts.url(f).then((u) => { if (u && img.isConnected !== undefined) img.src = u; });
      return h('div', { class: 'sp-sec' }, img, bigButton('Cut a photo out of this…', () => cutFromOriginal(f), { primary: false }));
    })));
    if ((src.kind === 'PDF') && src.files?.[0]) out.push(Section('', textButton('Open the PDF', async () => { const b = await drafts.file(src.files[0]); if (b) window.open(URL.createObjectURL(b), '_blank'); })));
    originalLines = R.sourceLines(src);
    if (originalLines.length) {
      out.push(Section('Text (tap lines, then send them where they belong)', ...originalLines.map((l, i) => h('div', { class: `sp-line${originalSel.has(i) ? ' selected' : ''}`, 'data-testid': 'orig-line' },
        h('div', { class: 'sp-text', role: 'checkbox', 'aria-checked': String(originalSel.has(i)), tabindex: '0', onclick: () => { originalSel.has(i) ? originalSel.delete(i) : originalSel.add(i); render(); } }, l)))));
      out.push(h('div', { class: 'sp-bar' }, bigButton(`Send ${originalSel.size || ''} selected…`.replace('  ', ' '), () => sendMenu([...originalSel].sort((a, b) => a - b).map((i) => originalLines[i])), { disabled: !originalSel.size, testid: 'send-selected' }),
        bigButton('Select all', () => { originalLines.forEach((_, i) => originalSel.add(i)); render(); }, { primary: false })));
    }
    return out;
  }

  function render() {
    if (!alive || !st) return;
    undoBtn.disabled = !R.canUndo(st); redoBtn.disabled = !R.canRedo(st);
    const tabs = h('div', { class: 'sp-tabs', role: 'tablist' }, chip('Recipe', tab === 'recipe', () => { tab = 'recipe'; render(); }, { 'data-testid': 'tab-recipe' }), chip('Original', tab === 'original', () => { tab = 'original'; render(); }, { 'data-testid': 'tab-original' }));
    const keep = page.body.scrollTop;
    const bar = tab === 'recipe' ? h('div', { class: 'sp-bar' },
      st.selecting ? [bigButton(`Delete ${st.selection.length}`, () => { apply(R.removeSelected(st)); undoable('Deleted', () => apply(R.undo(st))); }, { disabled: !st.selection.length, testid: 'delete-selected' }),
        bigButton('Replace with text…', () => askText({ title: 'Replace selected lines', multiline: true, ok: 'Replace', onOk: (t) => apply(R.replaceSelected(st, t)) }), { primary: false, disabled: !st.selection.length }),
        bigButton('Done selecting', () => apply(R.cancelSelection(st)), { primary: false })]
      : [bigButton('Add…', addMenu, { primary: false, testid: 'rescue-add' }), bigButton('Select lines', () => apply(R.startSelecting(st)), { primary: false }), bigButton('Create recipe', create, { testid: 'rescue-create' })]) : null;
    mount(page.body, tabs, ...(tab === 'recipe' ? recipeTab() : originalTab()), bar);
    page.body.scrollTop = keep;
  }

  (async () => {
    if (params.draftId) { const d = await drafts.get(params.draftId); if (!d) { say('That unfinished recipe is no longer here.'); nav.backOr(Routes.HUB); return; } st = R.state(d); }
    else if (ctx.importSession.draft) { st = R.state(draftFromImport(ctx.importSession.draft)); if (ctx.importSession.photoFile && !st.draft.recipe.photo) st = R.state({ ...st.draft, recipe: { ...st.draft.recipe, photo: ctx.importSession.photoFile } }); st = { ...st, draft: await drafts.save(st.draft) }; tab = 'recipe'; }
    else { st = R.state(R.newDraft({ recipe: Recipe() })); }
    if (params.tab) tab = params.tab;
    render();
  })();
  page.destroy = () => { alive = false; if (saveTimer) flush(); };
  return { el: page.el, destroy: () => page.destroy() };
}
