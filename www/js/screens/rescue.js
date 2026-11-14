// Recipe Rescue: fix an import by copying what is right from the ORIGINAL into OUR recipe. Deliberately plain: no artwork, open spacing, big fields,
// nothing squeezed into narrow strips. Two sides: the original (its picture and its text, selectable) and the recipe (title, times, a numbered
// list of ingredients, a numbered list of steps, notes). Upright, one side at a time at full width (a switch at the top); on its side, both next to each other.
// Nothing is guessed: the app never moves text for you here, and every edit can be undone. Port of ui/screens/RescueScreen.kt (simplified).
import { h, mount } from '../ui/dom.js';
import { Routes } from '../ui/nav.js';
import { ScrollPage } from '../ui/page.js';
import { bigButton, textButton, sheet, dialog, confirmDialog, say, undoable, chip, iconBtn, photoImg } from '../ui/widgets.js';
import * as R from '../engine/rescue.js';
import { Recipe } from '../engine/models.js';
import { validate } from '../engine/validator.js';
import { pickFile } from '../ui/shared.js';
import { cropSheet } from './crop.js';
import { allowLandscape, isWideScreen } from '../ui/orientation.js';
import { numberedList } from '../ui/numbered.js';
import { photoFlow, photoPickerSheet } from './photo.js';
import * as PZ from '../ui/panzoom.js';

/** Starts a rescue draft from an import draft (or edits an existing one), stored privately so it survives leaving the app. */
export const draftFromImport = (d) => R.newDraft({ recipe: d.recipe, source: d.source || R.emptySource(), imageCandidates: d.imageCandidates || [], findings: validate(d).warnings || [] });

export function rescueScreen(params, ctx, nav) {
  const drafts = ctx.drafts;
  let st = null, tab = 'recipe', lastWide = null, alive = true, saveTimer = null, lastCaret = null, restore = null;
  const editors = new Set();
  // View state for each side lives here, outside render(), so it survives redraws, edits and switching between the sides on a narrow phone.
  const view = { original: PZ.fit(), recipe: PZ.fit() };
  // One finger does one thing, chosen with the three buttons (Touch Gesture Standard): SELECT text (the default, so text can be copied), PAN, or ZOOM.
  const MODES = { select: 'Select text', pan: 'Pan', zoom: 'Zoom' };
  const SAY = { select: 'SELECT: press and hold a word to select text, then copy it and paste it into the recipe.', pan: 'PAN: drag one finger to move the page.', zoom: 'ZOOM: slide one finger up to zoom in, down to zoom out.' };
  let mode = 'select'; try { const m = localStorage.getItem('touchrecipe.rescue.mode'); if (m === 'pan' || m === 'zoom') mode = m; } catch { /* no storage */ }
  let lastSide = 'original';                       // the side the +/- buttons act on (the one last touched)
  const SIDE = { original: 'Original', recipe: 'Recipe' };
  const paneEls = {};                               // side -> { pane, zoom (inner wrapper), wrap }
  const page = ScrollPage({ title: 'Recipe Rescue', testid: 'rescue', slot: null, onBack: () => leave() });
  const undoBtn = iconBtn('Undo', '↶', () => stepHistory(R.undo), ''); const redoBtn = iconBtn('Redo', '↷', () => stepHistory(R.redo), '');
  undoBtn.dataset.testid = 'rescue-undo'; redoBtn.dataset.testid = 'rescue-redo';
  page.head.querySelector('.sp-actions').append(undoBtn, redoBtn);

  const commitAll = () => editors.forEach((e) => e.commit());
  const syncUndo = () => { undoBtn.disabled = !R.canUndo(st); redoBtn.disabled = !R.canRedo(st); };
  const apply = (next) => { st = next; schedule(); render(); };
  /** An edit made with a button: first take in whatever is being typed, then change the recipe and redraw. */
  const act = (f) => { commitAll(); apply(f(st)); };
  /** An edit made by typing in a field: the recipe changes, nothing is redrawn (a redraw would take the cursor away). */
  const field = (f) => { const next = f(st); if (next === st) return; st = next; schedule(); syncUndo(); };   // nothing changed: nothing is saved
  const schedule = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 400); };
  const flush = async () => { clearTimeout(saveTimer); saveTimer = null; if (st && !st.draft.recipeId) st = { ...st, draft: await drafts.save(st.draft) }; };
  const leave = async () => { commitAll(); await flush(); nav.backOr(Routes.HUB); };
  const recipe = () => st.draft.recipe;
  const hasImg = () => R.allFiles(st.draft.source).some((f) => !/\.pdf$/i.test(f));
  const wideNow = () => isWideScreen(window.innerWidth, window.innerHeight);
  /** A box to paste text into (for "Replace with text"). The text is handed back exactly as typed or pasted. */
  const askText = ({ title, hint = '', ok = 'OK', onOk }) => sheet({ label: title, tall: true, content: (close) => {
    const f = h('textarea', { class: 'rr-field', rows: '8', 'aria-label': title, placeholder: hint, 'data-testid': 'ask-field' });
    return h('div', { class: 'sheet-col' }, h('h2', { class: 'sheet-title' }, title), h('p', { class: 'sheet-note' }, hint), f,
      h('div', { class: 'sheet-row' }, bigButton('Cancel', () => close(), { primary: false }), bigButton(ok, () => { close(false); onOk(f.value); }, { testid: 'ask-ok' })));
  } });
  /** Undo / Redo: afterwards the cursor goes back to where it was (the nearest entry when that entry is gone). */
  const stepHistory = (f) => { restore = lastCaret; act(f); };

  // ---------- photo ----------
  /** The pictures to choose from: what the import found (while it is still in this session) and the dish photo kept with the original. */
  async function photoChoices() {
    const found = ctx.importSession.photos; const list = found ? found.candidates.slice() : []; let selectedId = found ? found.selectedId : null;
    const src = st.draft.source;
    if (!found && src.dishPhoto) { const blob = await drafts.file(src.dishPhoto); if (blob) list.push({ id: 'kept-dish', label: 'The photo found on the page', source: 'page', blob, width: 0, height: 0, note: '' }); }
    return { list, selectedId };
  }
  async function photoMenu() {
    const r = recipe(); const { list, selectedId } = await photoChoices();
    photoFlow(ctx, { photo: r.photo, frame: r.photoFrame, candidates: list, selectedId, onCut: hasImg() ? () => cutFromOriginal() : null,
      onApply: ({ photo, frame }) => { ctx.importSession.photoChecked = true; act((s) => R.setPhotoFrame(photo === s.draft.recipe.photo ? s : R.setPhoto(s, photo), frame)); } });
  }
  async function cutFromOriginal(file = null) {
    const name = file || (st.draft.source.cleaned.find(Boolean) || st.draft.source.files.find((f) => !/\.pdf$/i.test(f))); if (!name) return;
    const blob = await drafts.file(name); if (!blob) { say('The original picture is no longer on this device.'); return; }
    cropSheet(blob, { title: 'Cut out the dish photo', onDone: async (b) => { const n = await ctx.photos.saveBlob(b); n ? act((s) => R.setPhoto(s, n)) : say("That photo couldn't be used."); } });
  }

  // ---------- start fresh / discard / create ----------
  function startFresh() {
    sheet({ label: 'Start fresh', content: (close) => {
      const keep = new Set([R.TITLE, R.PHOTO]);
      const opts = [[R.TITLE, 'Title'], [R.PHOTO, 'Photo'], [R.SERVINGS, 'Servings'], [R.TIMES, 'Times'], [R.INGREDIENTS, 'Ingredients'], [R.DIRECTIONS, 'Steps'], [R.NOTES, 'Notes']];
      const box = h('div', { class: 'chips' });
      const draw = () => mount(box, opts.map(([k, l]) => chip(l, keep.has(k), () => { keep.has(k) ? keep.delete(k) : keep.add(k); draw(); })));
      draw();
      return h('div', { class: 'sheet-col' }, h('h2', { class: 'sheet-title' }, 'Start fresh'),
        h('p', { class: 'sheet-note' }, 'Clears everything except the parts you keep. The original is never touched, and one Undo brings it all back.'), box,
        h('div', { class: 'sheet-row' }, bigButton('Cancel', () => close(), { primary: false }), bigButton('Clear the rest', () => { close(false); act((s) => R.startFresh(s, [...keep])); undoable('Cleared', () => act(R.undo)); }, { testid: 'start-fresh-go' })));
    } });
  }
  const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return null; } };
  function discard() { confirmDialog('Discard this unfinished recipe?', 'The draft and its saved original files will be deleted from this device.', 'Discard', async () => { alive = false; clearTimeout(saveTimer); await drafts.discard(st.draft.id); nav.backOr(Routes.HUB); say('Draft discarded'); }, true); }
  async function create() {
    commitAll();
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

  // ---------- OUR side: the recipe ----------
  const group = (label, control) => h('label', { class: 'rr-group' }, h('span', { class: 'rr-label' }, label), control);
  const textField = (label, value, onCommit, { testid, inputmode = null, placeholder = '', wrap = false } = {}) => {
    // a title can be long: it wraps onto more lines instead of being clipped at the edge
    const el = wrap ? h('textarea', { class: 'rr-field rr-wrapfield', rows: '1', placeholder, 'data-testid': testid }) : h('input', { class: 'rr-field', type: 'text', inputmode, placeholder, value: value ?? '', 'data-testid': testid });
    if (wrap) {
      el.value = value ?? '';
      const grow = () => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`; };
      el.addEventListener('input', grow); el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
      requestAnimationFrame(grow);
    }
    el.addEventListener('change', () => onCommit(el.value));
    return group(label, el);
  };
  function recipeSide() {
    const r = recipe(); const out = [h('h2', { class: 'rr-h' }, 'Recipe')];
    const finds = (st.draft.findings || []).filter((f) => f.severity !== 'INFO').slice(0, 6);   // information-only notes are not "things to check"
    if (finds.length) out.push(h('div', { class: 'rr-notes' }, ...finds.map((f) => h('div', { class: `sp-warn${f.severity === 'ERROR' ? ' error' : ''}` }, f.message))));
    const review = R.linesToReview(r).length;
    if (review) out.push(h('div', { class: 'sp-warn', 'data-testid': 'review-count' }, `${review} line${review === 1 ? '' : 's'} marked "Check this line". They are shown exactly as they were read: compare them with the original, then fix or delete them.`));
    out.push(textField('Title', r.title, (v) => field((s) => R.setTitle(s, v)), { testid: 'rr-title', wrap: true }));
    out.push(h('div', { class: 'rr-pair' },
      textField('Servings', r.servings ?? '', (v) => field((s) => (v.trim() ? R.setServings(s, v) : R.clearServings(s))), { testid: 'rr-servings', inputmode: 'numeric' }),
      textField('Prep minutes', r.prepMinutes ?? '', (v) => field((s) => R.setTime(s, 'prep', v)), { testid: 'rr-prep', inputmode: 'numeric' }),
      textField('Cook minutes', r.cookMinutes ?? '', (v) => field((s) => R.setTime(s, 'cook', v)), { testid: 'rr-cook', inputmode: 'numeric' })));
    const flagged = (kind) => (t) => (t.trim() && !R.isHeadingText(t) ? R.reviewReason(t, kind) : null);
    const common = { ask: askText, notify: (label) => undoable(label, () => stepHistory(R.undo)), onUndo: () => stepHistory(R.undo), onRedo: () => stepHistory(R.redo) };
    const at = (id) => (restore && restore.list === id ? { row: restore.row, caret: restore.caret } : null);
    const ing = numberedList({ ...common, rows: R.ingredientRows(r), label: 'Ingredient', testid: 'ing', placeholder: 'Paste or type the ingredients. Enter starts the next one.', review: flagged('ing'), onChange: (rows) => field((s) => R.setIngredientRows(s, rows)), onCaret: (c) => { lastCaret = { list: 'ing', ...c }; }, focus: at('ing') });
    const dir = numberedList({ ...common, rows: R.stepRows(r), label: 'Step', testid: 'dir', placeholder: 'Paste or type the steps. Enter starts the next one.', review: flagged('dir'), onChange: (rows) => field((s) => R.setStepRows(s, rows)), onCaret: (c) => { lastCaret = { list: 'dir', ...c }; }, focus: at('dir') });
    restore = null;
    editors.add(ing); editors.add(dir);
    out.push(h('div', { class: 'rr-group' }, h('span', { class: 'rr-label' }, 'Ingredients'), ing.el));
    out.push(h('div', { class: 'rr-group' }, h('span', { class: 'rr-label' }, 'Steps'), dir.el));
    const notes = h('textarea', { class: 'rr-field rr-notes-field', rows: '4', 'data-testid': 'rr-notes' }); notes.value = r.notes || '';
    notes.addEventListener('change', () => field((s) => R.setNotes(s, notes.value)));
    out.push(group('Notes', notes));
    const found = ctx.importSession.photos; const unchecked = !!(found && found.selectedId && found.needsCheck && r.photo && !ctx.importSession.photoChecked);
    out.push(h('div', { class: 'rr-group', 'data-testid': 'rr-photo-group' }, h('span', { class: 'rr-label' }, 'Photo'),
      unchecked ? h('div', { class: 'sp-warn', 'data-testid': 'photo-check' }, 'This photo was chosen automatically. Check it, adjust it, or choose another.') : null,
      r.photo ? photoImg(ctx.photos, r.photo, { cls: 'rr-photo', alt: 'Recipe photo', frame: r.photoFrame }) : null,
      h('div', { class: 'rr-row' }, r.photo ? bigButton('Adjust photo', photoMenu, { primary: false, testid: 'rescue-photo' }) : bigButton('Add photo', photoMenu, { primary: false, testid: 'rescue-photo' }), r.photo ? bigButton('Change photo…', async () => { const { list, selectedId } = await photoChoices(); photoPickerSheet(ctx, { candidates: list, selectedId, current: r.photo, onCut: hasImg() ? () => cutFromOriginal() : null, onNone: () => act((s) => R.setPhoto(s, null)), onPick: ({ name }) => { ctx.importSession.photoChecked = true; act((s) => R.setPhoto(s, name)); photoFlow(ctx, { photo: name, frame: null, onApply: ({ photo, frame }) => act((s) => R.setPhotoFrame(s, frame)) }); } }); }, { primary: false, testid: 'rescue-photo-change' }) : null)));
    const qs = st.draft.helpNotes;
    if (qs.length) out.push(h('div', { class: 'rr-group' }, h('span', { class: 'rr-label' }, 'Questions for the family'), ...qs.map((n) => h('div', { class: 'rr-q', style: n.resolved ? 'opacity:.55' : '' }, h('span', { class: 'rr-q-text' }, n.text),
      h('button', { class: 'sp-mini', type: 'button', 'aria-label': n.resolved ? 'Reopen' : 'Mark answered', onclick: () => act((s) => R.resolveHelp(s, n.id, !n.resolved)) }, n.resolved ? '↺' : '✓'),
      h('button', { class: 'sp-mini', type: 'button', 'aria-label': 'Delete question', onclick: () => act((s) => R.deleteHelp(s, n.id)) }, '✕')))));
    out.push(h('div', { class: 'rr-row rr-links' }, textButton('Start fresh…', startFresh), textButton('Discard this unfinished recipe', discard)));
    return out;
  }

  // ---------- the ORIGINAL side ----------
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); say('Copied. Paste it into the recipe.'); return; } catch { /* fall back */ }
    const ta = h('textarea', { style: 'position:fixed;opacity:0;top:0' }); ta.value = t; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* no */ } ta.remove(); say(ok ? 'Copied. Paste it into the recipe.' : 'Press and hold the text to select and copy it.');
  }
  function originalSide() {
    const src = st.draft.source; const out = [h('h2', { class: 'rr-h' }, 'Original')];
    if (R.sourceIsEmpty(src)) { out.push(h('p', { class: 'rr-note' }, 'No original was kept for this recipe. You can still type everything on the recipe side.')); return out; }
    if (src.readNote) out.push(h('p', { class: 'rr-note', 'data-testid': 'read-note' }, `How this was read: ${src.readNote}`));
    if (src.url) out.push(h('div', { class: 'rr-group' }, h('p', { class: 'rr-note' }, `Captured from ${src.url}`), bigButton('Open the page in your browser', () => window.open(src.url, '_blank', 'noopener'), { primary: false })));
    // a kept PDF is opened with its own button; it is not a picture and must not be listed as one
    const files = [...(src.cleaned || []).filter(Boolean), ...(src.files || []).filter((f) => !/\.pdf$/i.test(f))];
    files.forEach((f) => {
      const img = h('img', { class: 'rr-img', alt: 'Captured page', 'data-testid': 'original-image' }); drafts.url(f).then((u) => { if (u) img.src = u; });
      out.push(h('div', { class: 'rr-group' }, img, h('div', { class: 'rr-row' }, textButton('Cut a photo out of this…', () => cutFromOriginal(f)))));
    });
    if (src.kind === 'PDF' && src.files?.[0]) out.push(h('div', { class: 'rr-row' }, textButton('Open the PDF', async () => { const b = await drafts.file(src.files[0]); if (b) window.open(URL.createObjectURL(b), '_blank'); })));
    if ((src.text || '').trim()) out.push(h('div', { class: 'rr-group' }, h('span', { class: 'rr-label' }, 'Text (press and hold a word to select it, then copy and paste it into the recipe)'), h('div', { class: 'rr-row' }, (() => { const b = textButton('Copy all the text', () => copyText(src.text.trim())); b.dataset.testid = 'copy-all'; return b; })()), h('div', { class: 'rr-original', 'data-testid': 'orig-text' }, src.text.trim())));
    return out;
  }

  // ---------- zoom and pan ----------
  const sizeOf = (side) => { const e = paneEls[side]; return { vw: e.pane.clientWidth, vh: e.pane.clientHeight, cw: e.zoom.offsetWidth, ch: e.zoom.offsetHeight }; };
  function applyView(side) {
    const e = paneEls[side]; if (!e || !e.pane.isConnected) return;
    const { vw, vh, cw, ch } = sizeOf(side);
    view[side] = PZ.clamp(view[side], vw, vh, cw, ch);
    const v = view[side], zoomed = v.s > 1;
    e.zoom.style.transform = PZ.cssTransform(v);
    e.pane.classList.toggle('zoomed', zoomed);
    if (zoomed) { e.pane.scrollTop = 0; e.pane.scrollLeft = 0; }
    const active = mode !== 'select';
    e.wrap.classList.toggle('rr-active', active);
    e.overlay.hidden = !active;
    e.badge.textContent = `${SIDE[side]} · ${PZ.percent(v)}`;
    e.fit.hidden = PZ.isFit(v); e.badge.hidden = !active && PZ.isFit(v);
    updateBar();
  }
  const setView = (side, v) => { view[side] = v; applyView(side); };
  function paneWrap(side, id, kids) {
    const zoom = h('div', { class: 'rr-zoom' }, ...kids);
    const pane = h('div', { class: 'rr-pane', 'data-testid': id }, zoom);
    const badge = h('div', { class: 'rr-badge', 'data-testid': `badge-${side}`, 'aria-hidden': 'true' });
    const fitBtn = h('button', { class: 'rr-fit', type: 'button', 'data-testid': `fit-${side}`, 'aria-label': `Reset ${SIDE[side]} to fit`, onclick: () => setView(side, PZ.fit()) }, 'Fit');
    const overlay = h('div', { class: 'rr-gesture', 'data-testid': `gesture-${side}`, 'aria-hidden': 'true' }); overlay.hidden = true;
    const wrap = h('div', { class: 'rr-wrap' }, pane, h('div', { class: 'rr-tools' }, badge, fitBtn), overlay);
    pane.addEventListener('scroll', () => { if (view[side].s > 1 && (pane.scrollTop || pane.scrollLeft)) { pane.scrollTop = 0; pane.scrollLeft = 0; } }, { passive: true });
    paneEls[side] = { pane, zoom, wrap, overlay, badge, fit: fitBtn, side };
    PZ.attachGestures(overlay, {
      get: () => view[side], set: (v) => setView(side, v), size: () => sizeOf(side),
      mode: () => mode, onTouch: () => { lastSide = side; updateBar(); }, onScroll: (dy) => { pane.scrollTop += dy; },
    });
    return paneEls[side];
  }
  let bar = null;
  const setMode = (m) => { commitAll(); mode = m; try { localStorage.setItem('touchrecipe.rescue.mode', m); } catch { /* no storage */ } ['original', 'recipe'].forEach(applyView); };
  const target = () => (wideNow() ? lastSide : tab);
  const stepZoom = (f) => { const side = target(); if (!paneEls[side]) return; const { vw, vh, cw, ch } = sizeOf(side); setView(side, PZ.zoomAt(view[side], f, vw / 2, vh / 2, vw, vh, cw, ch)); };
  function zoomBar() {
    const btn = (testid, label, onclick) => h('button', { class: 'rr-tool', type: 'button', 'data-testid': testid, onclick }, label);
    bar = h('div', { class: 'rr-zoombar', role: 'toolbar', 'aria-label': 'What one finger does' },
      btn('select-btn', '', () => setMode('select')), btn('pan-btn', '', () => setMode('pan')), btn('zoom-btn', '', () => setMode('zoom')),
      h('div', { class: 'rr-zrow' }, btn('zoom-out', '−', () => stepZoom(1 / 1.25)), btn('zoom-in', '+', () => stepZoom(1.25)),
        h('div', { class: 'rr-zstatus', 'data-testid': 'zoom-status', 'aria-live': 'polite' })));
    bar.querySelector('[data-testid=zoom-out]').setAttribute('aria-label', 'Zoom out'); bar.querySelector('[data-testid=zoom-in]').setAttribute('aria-label', 'Zoom in');
    updateBar(); return bar;
  }
  function updateBar() {
    if (!bar) return;
    const labels = { select: '✎ Select text', pan: '✋ Pan', zoom: '🔍 Zoom' };
    for (const m of Object.keys(MODES)) {
      const b = bar.querySelector(`[data-testid=${m}-btn]`);
      b.textContent = labels[m]; b.setAttribute('aria-pressed', String(mode === m)); b.classList.toggle('on', mode === m);
      b.setAttribute('aria-label', `${MODES[m]}${mode === m ? ', selected' : ''}`);
    }
    bar.querySelector('[data-testid=zoom-in]').disabled = bar.querySelector('[data-testid=zoom-out]').disabled = false;
    const o = PZ.percent(view.original), r = PZ.percent(view.recipe);
    bar.querySelector('[data-testid=zoom-status]').textContent = `${SAY[mode]} Original ${o} · Recipe ${r}`;
  }

  // Wide (a phone on its side, a tablet): the original on the left, our recipe on the right, each scrolling on its own. Upright: one at a time, full width.
  function render() {
    if (!alive || !st) return;
    editors.forEach((e) => e.destroy()); editors.clear();
    syncUndo();
    const wide = wideNow(); lastWide = wide;
    const scroll = (id) => page.body.querySelector(`[data-testid="${id}"]`)?.scrollTop ?? 0;
    const keep = { orig: scroll('pane-original'), rec: scroll('pane-recipe') };
    const sideOf = (id) => (id === 'pane-original' ? 'original' : 'recipe');
    const pane = (id, kids) => paneWrap(sideOf(id), id, kids);
    const orig = wide || tab === 'original' ? pane('pane-original', originalSide()) : null;
    const rec = wide || tab === 'recipe' ? pane('pane-recipe', recipeSide()) : null;
    const choose = h('div', { class: 'rr-switch', role: 'tablist' }, chip('Original', tab === 'original', () => { commitAll(); tab = 'original'; render(); }, { 'data-testid': 'tab-original' }), chip('Recipe', tab === 'recipe', () => { commitAll(); tab = 'recipe'; render(); }, { 'data-testid': 'tab-recipe' }));
    mount(page.body, wide ? null : choose, zoomBar(), h('div', { class: `rr-cols${wide ? ' wide' : ''}` }, orig?.wrap, rec?.wrap));
    mount(page.foot, h('div', { class: 'sp-bar' }, bigButton('Create recipe', create, { testid: 'rescue-create' })));
    for (const e of [orig, rec]) if (e) applyView(e.side);
    if (orig && PZ.isFit(view.original)) orig.pane.scrollTop = keep.orig; if (rec && PZ.isFit(view.recipe)) rec.pane.scrollTop = keep.rec;
  }
  // turning the phone: only a change between wide and upright needs a new layout
  let resizeTimer = null;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (alive && st && wideNow() !== lastWide) { commitAll(); render(); } }, 60); };
  window.addEventListener('resize', onResize);
  allowLandscape(true);   // this is the one screen that may turn sideways
  page.body.classList.add('rr-body');

  (async () => {
    if (params.draftId) { const d = await drafts.get(params.draftId); if (!d) { say('That unfinished recipe is no longer here.'); nav.backOr(Routes.HUB); return; } st = R.state(d); }
    else if (ctx.importSession.draft) { st = R.state(draftFromImport(ctx.importSession.draft)); if (ctx.importSession.photoFile && !st.draft.recipe.photo) st = R.state({ ...st.draft, recipe: { ...st.draft.recipe, photo: ctx.importSession.photoFile } }); st = { ...st, draft: await drafts.save(st.draft) }; }
    else { st = R.state(R.newDraft({ recipe: Recipe() })); }
    if (params.tab === 'original' || params.tab === 'recipe') tab = params.tab;
    render();
  })();
  page.destroy = () => {
    const wasAlive = alive; alive = false;   // after Create or Discard the screen is already finished: nothing may be saved again
    clearTimeout(resizeTimer); window.removeEventListener('resize', onResize); allowLandscape(false);
    if (wasAlive) commitAll();
    editors.forEach((e) => e.destroy()); editors.clear();
    if (wasAlive && saveTimer) flush();
  };
  return { el: page.el, destroy: () => page.destroy() };
}
