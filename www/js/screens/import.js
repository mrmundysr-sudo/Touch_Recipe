// Port of ui/screens/ImportScreen.kt: URL, paste/type, scan, file, and the result sheet.
import { h, mount } from '../ui/dom.js';
import { ArtPage } from '../ui/art.js';
import { Routes } from '../ui/nav.js';
import { bigButton, sheet, say, textButton } from '../ui/widgets.js';
import { Severity, Confidence } from '../engine/models.js';
import { ImportFailure, photoWarning } from '../data/importer.js';
import { pickFile } from '../ui/shared.js';

export function importScreen(params, ctx, nav) {
  const vm = (params.__vm ||= { ui: ctx.importSession.draft ? { s: 'done', draft: ctx.importSession.draft } : { s: 'idle' }, last: null, job: null, resultOpen: false });
  let resultSheet = null;
  vm.resultOpen = vm.ui.s !== 'idle';
  const setUi = (u) => { vm.ui = u; if (u.s !== 'idle') vm.resultOpen = true; drawResult(); };

  async function start(input) {
    vm.last = input; if (vm.job) vm.job.cancelled = true; ctx.importSession.clear();
    const job = (vm.job = { cancelled: false });
    setUi({ s: 'working', message: 'Starting…' });
    try {
      let draft = await ctx.importer.import(input, (m) => { if (!job.cancelled) setUi({ s: 'working', message: m }); });
      if (job.cancelled) return;
      if (!draft.recipe.title.trim() && !draft.recipe.ingredients.length && !draft.recipe.directions.length && draft.warnings.some((w) => w.severity === Severity.ERROR)) {
        setUi({ s: 'failed', message: draft.warnings.find((w) => w.severity === Severity.ERROR).message, retryable: input.type === 'url', offline: false, blocked: input.type === 'url' }); return;
      }
      // the recipe photo: what the source offered, judged by rules (adverts and banners are never chosen); the person can always change it
      if (!draft.photos && draft.imageCandidates && draft.imageCandidates.length) {
        setUi({ s: 'working', message: "Looking at the page's pictures…" });
        draft = { ...draft, photos: await ctx.importer.webPhotos(draft.imageCandidates) };
        if (job.cancelled) return;
        const loaded = draft.photos.loaded ?? 0, tried = draft.photos.tried ?? 0;
        const w = !loaded && tried ? { field: 'photo', message: "The page's pictures could not be downloaded. You can add your own.", severity: Severity.WARNING } : photoWarning(draft.photos);
        if (w) draft = { ...draft, warnings: [...draft.warnings, w] };
      }
      ctx.importSession.photos = draft.photos || null;
      const picked = draft.photos && draft.photos.candidates.find((c) => c.id === draft.photos.selectedId);
      if (picked) { const n = await ctx.photos.saveBlob(picked.blob); if (n) ctx.importSession.photoFile = n; }
      ctx.importSession.draft = draft;
      setUi({ s: 'done', draft });
    } catch (e) {
      if (job.cancelled) return;
      if (e instanceof ImportFailure) setUi({ s: 'failed', message: e.userMessage, retryable: e.retryable, offline: e.offline, blocked: e.blocked });
      else { console.error(e); setUi({ s: 'failed', message: 'Something went wrong while importing. Nothing was saved.', retryable: true, offline: false, blocked: false }); }
    }
  }
  const cancel = () => { if (vm.job) vm.job.cancelled = true; vm.ui = { s: 'idle' }; vm.resultOpen = false; drawResult(); };
  const dismiss = () => { if (vm.ui.s !== 'done') vm.ui = { s: 'idle' }; };
  const discard = () => { ctx.importSession.clear(); vm.ui = { s: 'idle' }; vm.resultOpen = false; drawResult(); };

  const art = ArtPage(ctx.art, 'import', { title: 'Import Recipe', prefs: ctx.prefs, onTarget: async (id) => {
    switch (id) {
      case 'back': nav.backOr(Routes.HUB); break;
      case 'url': urlSheet(); break;
      case 'text': textSheet(); break;
      case 'scan': scanSheet(); break;
      case 'file': { const f = await pickFile({ accept: 'application/pdf,image/*,text/plain,text/html,.txt,.html,.htm,.md' }); if (f) start(f.type === 'application/pdf' || /\.pdf$/i.test(f.name) ? { type: 'pdf', file: f } : f.type.startsWith('image/') ? { type: 'image', file: f } : { type: 'file', file: f, mime: f.type }); break; }
      case 'share': shareHelp(); break;
      case 'continue': if (ctx.importSession.draft) nav.go(Routes.REVIEW, {}); else say('Add a recipe first: paste a link, type or paste text, scan, or choose a file.'); break;
    }
  } });

  const clip = async () => { try { return (await navigator.clipboard.readText()) || ''; } catch { say('Paste access was not allowed. Long-press in the field and choose Paste.'); return ''; } };

  function urlSheet() {
    sheet({ label: 'Paste Recipe URL', content: (close) => {
      const err = h('div', { style: 'color:var(--error);font-size:14px;min-height:1.2em' });
      const url = h('input', { class: 'field', type: 'url', inputmode: 'url', autocapitalize: 'none', autocorrect: 'off', 'data-testid': 'url-field', 'aria-label': 'Recipe web address', placeholder: 'Recipe web address', enterkeyhint: 'go',
        oninput: () => { err.textContent = ''; }, onkeydown: (e) => { if (e.key === 'Enter') go(); } });
      const go = () => { const n = ctx.importer.normalizeUrl(url.value); if (n) { close(false); start({ type: 'url', url: n }); } else err.textContent = "That doesn't look like a web address."; };
      return h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, h('h2', { class: 'sheet-title' }, 'Paste Recipe URL'),
        h('p', { class: 'sheet-note' }, 'Touch Recipe will fetch this one page from the internet and look for the recipe. Nothing else is sent.'), url, err,
        h('div', { class: 'sheet-row' }, bigButton('Paste from clipboard', async () => { url.value = (await clip()).trim(); err.textContent = ''; }, { primary: false }), bigButton('Import', go, { testid: 'url-import' })));
    } });
  }
  function textSheet() {
    sheet({ label: 'Paste or type a recipe', tall: true, content: (close) => {
      const text = h('textarea', { class: 'field', 'data-testid': 'text-field', 'aria-label': 'Recipe text', placeholder: 'Recipe text', style: 'min-height:200px;max-height:320px', oninput: () => { go.disabled = !text.value.trim(); } });
      const go = bigButton('Continue', () => { close(false); const i = ctx.importer.classify(text.value); start(i.type === 'url' ? { type: 'text', text: text.value } : i); }, { disabled: true, testid: 'text-import' });
      return h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, h('h2', { class: 'sheet-title' }, 'Paste or type a recipe'),
        h('p', { class: 'sheet-note' }, 'Paste a recipe from anywhere, or type one in. Headings such as Ingredients and Directions help; you can fix everything on the next screen.'), text,
        h('div', { class: 'sheet-row' }, bigButton('Paste from clipboard', async () => { text.value = await clip(); go.disabled = !text.value.trim(); }, { primary: false }), go));
    } });
  }
  function scanSheet() {
    sheet({ label: 'Scan a recipe', content: (close) => h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, h('h2', { class: 'sheet-title' }, 'Scan a recipe'),
      h('p', null, "Take a clear, well-lit photo of a cookbook page or recipe card. Touch Recipe reads the text on this device. The photo isn't uploaded anywhere. Handwriting and busy layouts may need corrections."),
      bigButton('Take a photo', async () => { close(false); const f = await pickFile({ accept: 'image/*', capture: 'environment' }); if (f) start({ type: 'image', file: f }); }),
      bigButton('Choose a photo', async () => { close(false); const f = await pickFile({ accept: 'image/*' }); if (f) start({ type: 'image', file: f }); }, { primary: false }),
      textButton('Type or paste instead', () => { close(false); textSheet(); })) });
  }
  function shareHelp() {
    sheet({ label: 'Share to Touch Recipe', content: (close) => h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, h('h2', { class: 'sheet-title' }, 'Bring a recipe in from anywhere'),
      h('p', null, 'In Safari or any app, tap Share and choose Copy to copy the recipe link (or select and copy the recipe text). Then come back here and use Paste Recipe URL or Paste or Type Recipe: “Paste from clipboard” fills it in for you.'),
      h('p', null, 'Photos and PDFs from your Photos or Files apps work with Scan a Recipe and Import PDF or File.'),
      bigButton('Got it', () => close())) });
  }

  function drawResult() {
    if (!vm.resultOpen || vm.ui.s === 'idle') { resultSheet?.close(false); resultSheet = null; return; }
    const u = vm.ui;
    const body = (() => {
      if (u.s === 'working') return h('div', { class: 'sheet-col', 'data-testid': 'import-result', 'aria-live': 'polite' }, h('h2', { class: 'sheet-title' }, 'Importing…'),
        h('div', { style: 'height:6px;border-radius:3px;background:var(--surface-var);overflow:hidden' }, h('div', { class: 'indeterminate' })),
        h('p', { 'data-testid': 'import-status' }, u.message), bigButton('Cancel', cancel, { primary: false }));
      if (u.s === 'failed') return h('div', { class: 'sheet-col', 'data-testid': 'import-result', 'aria-live': 'polite' },
        h('h2', { class: 'sheet-title' }, u.offline ? 'You seem to be offline' : u.blocked ? "This page wouldn't open for us" : "We couldn't import that"),
        h('p', { 'data-testid': 'import-error' }, u.message), h('p', { class: 'sheet-note' }, 'Nothing was saved. Your other recipes are untouched.'),
        u.retryable ? bigButton('Try again', () => start(vm.last)) : null,
        bigButton('Paste or type the recipe instead', () => { vm.resultOpen = false; dismiss(); drawResult(); textSheet(); }, { primary: !u.retryable }),
        textButton('Close', () => { vm.resultOpen = false; dismiss(); drawResult(); }));
      const d = u.draft, r = d.recipe;
      return h('div', { class: 'sheet-col', 'data-testid': 'import-result', 'aria-live': 'polite' },
        h('h2', { class: 'sheet-title' }, d.confidence === Confidence.HIGH ? 'We found a recipe' : 'We found some of a recipe'),
        h('div', { style: 'font-family:var(--display);font-size:20px;font-weight:600' }, r.title.trim() || 'Untitled recipe'),
        h('p', { style: 'margin:0' }, `${r.ingredients.filter((i) => !i.header).length} ingredients · ${r.directions.filter((x) => !x.header).length} directions` + (r.servings != null ? ` · serves ${r.servings}` : '')),
        h('p', null, d.confidence === Confidence.HIGH ? "This came from the page's own recipe data, but extraction is never perfect. Please give it a quick check." : d.confidence === Confidence.MEDIUM ? 'Some parts were interpreted automatically. Please check the details before saving.' : 'This was guessed from text or layout, so mistakes are likely. Please check carefully; everything can be edited.'),
        ...d.warnings.filter((w) => w.severity !== Severity.INFO).map((w) => h('p', { style: 'color:var(--error);font-size:14px;margin:2px 0' }, `⚠ ${w.message}`)),
        bigButton('Fix it in Recipe Rescue', () => { vm.resultOpen = false; drawResult(); nav.go(Routes.RESCUE, {}); }, { primary: d.confidence !== Confidence.HIGH, testid: 'result-rescue' }),
        bigButton('Continue to Review', () => { vm.resultOpen = false; drawResult(); nav.go(Routes.REVIEW, {}); }, { primary: d.confidence === Confidence.HIGH, testid: 'result-continue' }),
        textButton('Discard this import', discard));
    })();
    if (resultSheet && resultSheet.body.isConnected) mount(resultSheet.body, body);
    else resultSheet = sheet({ label: 'Import result', tall: true, content: body, onDismiss: () => { vm.resultOpen = false; dismiss(); resultSheet = null; } });
  }
  // unfinished recipes: drafts waiting in Recipe Rescue
  const pill = h('button', { type: 'button', class: 'chip', 'data-testid': 'unfinished-pill', style: 'position:absolute;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom));z-index:5;display:none', onclick: () => nav.go(Routes.UNFINISHED) });
  art.el.append(pill);
  const pillUpdate = async () => { const n = await ctx.drafts.count(); pill.style.display = n ? '' : 'none'; pill.textContent = `Unfinished recipes (${n})`; };
  pillUpdate(); const unPill = ctx.drafts.subscribe(pillUpdate);
  if (vm.resultOpen) setTimeout(drawResult, 0);
  art.destroy = () => { resultSheet?.close(false); unPill(); };
  return art;
}
