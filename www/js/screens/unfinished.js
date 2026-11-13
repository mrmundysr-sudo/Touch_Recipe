// Unfinished recipes: Recipe Rescue drafts that were never turned into a recipe. Nothing here is lost until the user discards it.
import { h, mount } from '../ui/dom.js';
import { Routes } from '../ui/nav.js';
import { ScrollPage, Section } from '../ui/page.js';
import { bigButton, textButton, confirmDialog, say } from '../ui/widgets.js';
import * as R from '../engine/rescue.js';

const when = (t) => { try { return new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; } };

export function unfinishedScreen(params, ctx, nav) {
  const page = ScrollPage({ title: 'Unfinished recipes', testid: 'unfinished', slot: 'page_16', onBack: () => nav.backOr(Routes.HUB) });
  let alive = true;
  async function render() {
    const list = await ctx.drafts.list(); if (!alive) return;
    if (!list.length) { mount(page.body, h('div', { class: 'sp-warn', 'data-testid': 'unfinished-empty' }, 'Nothing is waiting here. When an import needs fixing, you can leave Recipe Rescue at any time and it will wait for you here.'), bigButton('Import a recipe', () => nav.go(Routes.IMPORT))); return; }
    mount(page.body, ...list.map((d) => {
      const r = d.recipe, open = R.openQuestions(d), ing = r.ingredients.filter((i) => !i.header).length, dir = r.directions.filter((x) => !x.header).length;
      return Section('', h('div', { class: 'sp-line', style: 'flex-direction:column', 'data-testid': 'unfinished-item' },
        h('div', { style: 'font-weight:700' }, r.title.trim() || 'Untitled recipe'),
        h('div', { class: 'sp-note', style: 'font-size:14px;opacity:.75' }, `${ing} ingredients · ${dir} steps · ${when(d.updatedAt)}`),
        open ? h('span', { class: 'sp-pill' }, `${open} open question${open === 1 ? '' : 's'}`) : null,
        h('div', { class: 'sheet-row', style: 'width:100%' }, bigButton('Continue', () => nav.go(Routes.RESCUE, { draftId: d.id }), { testid: 'unfinished-continue' }),
          textButton('Discard', () => confirmDialog('Discard this unfinished recipe?', 'The draft and its saved original files will be deleted from this device.', 'Discard', async () => { await ctx.drafts.discard(d.id); say('Draft discarded'); }, true)))));
    }));
  }
  render(); const un = ctx.drafts.subscribe(render);
  page.destroy = () => { alive = false; un(); };
  return { el: page.el, destroy: () => page.destroy() };
}

/** The original kept with a saved recipe: what the recipe was made from, so it can be compared or corrected later. */
export function originalScreen(params, ctx, nav) {
  const id = params.id;
  const page = ScrollPage({ title: 'Original', testid: 'original', slot: 'page_17', onBack: () => nav.backOr(Routes.DETAIL, { id }) });
  let alive = true;
  async function render() {
    const o = await ctx.drafts.forRecipe(id); if (!alive) return;
    if (!o || R.sourceIsEmpty(o.source)) { mount(page.body, h('div', { class: 'sp-warn' }, 'No original is kept for this recipe.')); return; }
    const s = o.source;
    const kids = [Section('', h('div', { class: 'sp-warn' }, `Kept ${s.kind === 'WEB' ? 'web page' : s.kind === 'PDF' ? 'PDF' : s.kind === 'IMAGE' ? 'photo' : 'text'} from ${when(s.capturedAt)}.`),
      s.url ? textButton(s.url, () => window.open(s.url, '_blank', 'noopener')) : null)];
    const files = [...(s.cleaned || []).filter(Boolean), ...(s.files || [])].filter((f) => !/\.pdf$/.test(f));
    for (const f of files) { const img = h('img', { class: 'sp-img', alt: 'Kept original picture' }); ctx.drafts.url(f).then((u) => { if (u) img.src = u; }); kids.push(img); }
    const pdf = (s.files || []).find((f) => /\.pdf$/.test(f)); if (pdf) kids.push(bigButton('Open the PDF', async () => { const b = await ctx.drafts.file(pdf); if (b) window.open(URL.createObjectURL(b), '_blank'); }, { primary: false }));
    const lines = R.sourceLines(s); if (lines.length) kids.push(Section('Text', ...lines.map((l) => h('div', { class: 'sp-line' }, h('div', { class: 'sp-text', style: 'cursor:default' }, l)))));
    const hn = o.helpNotes || []; if (hn.length) kids.push(Section('Questions for the family', ...hn.map((n) => h('div', { class: 'sp-line', style: n.resolved ? 'opacity:.55' : '' }, h('div', { class: 'sp-text', style: 'cursor:default' }, n.text),
      h('button', { class: 'sp-mini', type: 'button', 'aria-label': n.resolved ? 'Reopen' : 'Mark answered', onclick: async () => { await ctx.drafts.updateHelp(id, (l) => l.map((x) => (x.id === n.id ? { ...x, resolved: !x.resolved } : x))); render(); } }, n.resolved ? '↺' : '✓')))));
    kids.push(Section('', textButton('Remove the kept original', () => confirmDialog('Remove the kept original?', 'The saved page, pictures and text are deleted from this device. The recipe stays.', 'Remove', async () => { await ctx.drafts.unlink(id); say('Original removed'); nav.backOr(Routes.DETAIL, { id }); }, true))));
    mount(page.body, ...kids);
  }
  render();
  page.destroy = () => { alive = false; };
  return { el: page.el, destroy: () => page.destroy() };
}
