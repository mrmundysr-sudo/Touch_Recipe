// Port of ui/screens/CollectionScreen.kt.
import { h, mount } from '../ui/dom.js';
import { ArtPage, place, dp, sp } from '../ui/art.js';
import { Routes } from '../ui/nav.js';
import { backChip, bigButton, chip, sheet, fitText, photoImg } from '../ui/widgets.js';
import { filter, Sort } from '../engine/search.js';
import { metaLine, live } from '../ui/shared.js';

const SORT_KEYS = Object.keys(Sort);

export function recipeCard(ctx, r, cats, onOpen) {
  const names = r.categoryIds.map((id) => cats.find((c) => c.id === id)?.name).filter(Boolean);
  const meta = metaLine(r);
  const fav = h('button', { class: 'fav', type: 'button', 'data-testid': `favorite:${r.id}`, 'aria-pressed': String(r.favorite), 'aria-label': r.favorite ? 'Favorite, on' : 'Favorite, off',
    onclick: (e) => { e.stopPropagation(); ctx.repo.setFavorite(r.id, !r.favorite); } }, r.favorite ? '♥' : '♡');
  const card = h('div', { class: 'rcard', role: 'button', tabindex: '0', 'data-testid': `recipe-card:${r.id}`,
    'aria-label': `${r.title.trim() || 'Untitled recipe'}. ${meta}. ${names.join(', ')}${r.favorite ? '. Favorite' : ''}`,
    onclick: onOpen, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } } },
    photoImg(ctx.photos, r.photo, { fallback: r.title, frame: r.photoFrame }),
    h('div', { class: 'info' }, h('div', { class: 't' }, r.title.trim() || 'Untitled recipe'), names.length ? h('div', { class: 'c' }, names.join(' · ')) : null, meta ? h('div', { class: 'm' }, meta) : null),
    fav);
  return card;
}

export function collectionScreen(params, ctx, nav) {
  const st = (params.__vm ||= { query: '', category: null, favoritesOnly: false, sort: SORT_KEYS.includes(ctx.prefs.sortOrder) ? ctx.prefs.sortOrder : 'RECENT', searchOpen: !!params.search });
  const setSort = (s) => { st.sort = s; ctx.prefs.sortOrder = s; rerender(); };
  const tabLabels = h('div'); const list = h('div', { class: 'scroll-y ia', 'data-testid': 'recipe-list', style: 'flex:1;min-height:0' });
  const searchBox = h('div');
  const countText = h('div', { style: 'flex:1;font-weight:600;color:var(--ink)', 'aria-live': 'polite' });
  let tabCats = [];

  const art = ArtPage(ctx.art, 'collection', {
    title: 'Recipe Collection', prefs: ctx.prefs,
    onTarget: (id) => {
      switch (id) {
        case 'search': st.searchOpen = !st.searchOpen; drawSearch(true); break;
        case 'new_recipe': nav.go(Routes.IMPORT); break;
        case 'tab0': st.category = null; st.favoritesOnly = false; rerender(); break;
        case 'tab1': st.favoritesOnly = !st.favoritesOnly; rerender(); break;
        case 'tab2': case 'tab3': { const c = tabCats[id === 'tab2' ? 0 : 1]; if (c) { st.category = st.category === c.id ? null : c.id; rerender(); } else openFilters(); break; }
        case 'tab4': openFilters(); break;
      }
    },
  });
  const { content, page } = art;
  const back = backChip(() => nav.backOr(Routes.HUB)); Object.assign(back.style, { position: 'absolute', right: '12px', top: dp(14), pointerEvents: 'auto' });
  const panel = h('div', { class: 'ia', style: `border-radius:${dp(18)};background:#F4E9D3;padding:${dp(10)} ${dp(14)};display:flex;flex-direction:column;overflow:hidden` },
    searchBox, h('div', { class: 'row-line', style: 'padding:4px 0' }, countText, h('button', { class: 'text-btn', type: 'button', style: 'color:var(--forest)', onclick: () => openFilters() }, 'Sort & filter')), list);
  place(panel, page.region('list'));
  content.append(back, tabLabels, panel);

  function drawSearch(focus) {
    mount(searchBox);
    if (!st.searchOpen) return;
    const input = h('input', { class: 'field', type: 'search', 'data-testid': 'search-field', placeholder: 'Search title, ingredient, category, source…', value: st.query, enterkeyhint: 'search', style: 'color:var(--ink);background:#fff8',
      oninput: (e) => { st.query = e.target.value; renderList(); } });
    mount(searchBox, input, st.query ? h('button', { class: 'text-btn', type: 'button', onclick: () => { st.query = ''; input.value = ''; renderList(); } }, 'Clear') : null);
    if (focus) input.focus();
  }
  function openFilters() {
    const cats = ctx.repo.categories().filter((c) => c.enabled);
    sheet({ label: 'Sort and filter', content: (close) => {
      const body = h('div'); const draw = () => mount(body,
        h('h2', { class: 'sheet-title' }, 'Sort and filter'),
        h('h3', null, 'Sort by'), h('div', { class: 'chips' }, SORT_KEYS.map((k) => chip(Sort[k], st.sort === k, () => { setSort(k); draw(); }))),
        h('div', { style: 'margin-top:12px' }, chip('Favorites only', st.favoritesOnly, () => { st.favoritesOnly = !st.favoritesOnly; rerender(); draw(); })),
        h('h3', null, 'Category'),
        h('div', { class: 'chips' }, chip('All', st.category == null, () => { st.category = null; rerender(); draw(); }), cats.map((c) => chip(c.name, st.category === c.id, () => { st.category = st.category === c.id ? null : c.id; rerender(); draw(); }))),
        h('div', { style: 'margin-top:16px' }, bigButton('Done', () => close(), { testid: 'filters-done' })));
      draw(); return body; } });
  }
  function renderTabs() {
    const cats = ctx.repo.categories(); const all = ctx.repo.recipes();
    const usage = new Map(); all.flatMap((r) => r.categoryIds).forEach((id) => usage.set(id, (usage.get(id) || 0) + 1));
    tabCats = cats.filter((c) => c.enabled).sort((a, b) => (usage.get(b.id) || 0) - (usage.get(a.id) || 0)).slice(0, 2);
    const items = [
      ['tab0', 'All', st.category == null && !st.favoritesOnly], ['tab1', 'Favorites', st.favoritesOnly],
      ['tab2', tabCats[0]?.name ?? 'Dinner', !!tabCats[0] && tabCats[0].id === st.category], ['tab3', tabCats[1]?.name ?? 'Desserts', !!tabCats[1] && tabCats[1].id === st.category], ['tab4', '⋯', false],
    ];
    mount(tabLabels, items.map(([id, label, active]) => {
      const box = h('div', { 'aria-hidden': 'true', style: 'display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none' },
        fitText(label, { minScale: 0.8, style: `font-family:var(--display);font-size:${sp(id === 'tab4' ? 30 : 19)};font-weight:${active ? 700 : 500};color:var(--ink);padding:0 ${dp(4)};text-align:center;max-width:100%` }),
        active ? h('div', { style: `margin-top:${dp(3)};height:${dp(4)};width:${dp(34)};background:var(--tomato)` }) : null);
      return place(box, page.target(id).box);
    }));
  }
  function renderList() {
    const cats = ctx.repo.categories(); const all = ctx.repo.recipes();
    const visible = filter(all, cats, st.query, st.category, st.favoritesOnly, st.sort);
    countText.textContent = `${visible.length} ${visible.length === 1 ? 'recipe' : 'recipes'}` + (st.favoritesOnly ? ' · favorites' : '') + (st.category ? ` · ${cats.find((c) => c.id === st.category)?.name ?? ''}` : '');
    const empty = (title, text, action, fn) => h('div', { class: 'empty', 'data-testid': 'empty-state' }, h('h3', null, title), h('p', null, text), bigButton(action, fn));
    if (!all.length) mount(list, empty('Your Rolodex is empty', 'Bring in your first recipe from a web page, a photo, a PDF or by typing it in.', 'Import a recipe', () => nav.go(Routes.IMPORT)));
    else if (!visible.length) mount(list, empty('No recipes match', 'Try a different word, or clear the filters.', 'Clear filters', () => { st.query = ''; st.category = null; st.favoritesOnly = false; drawSearch(false); rerender(); }));
    else mount(list, visible.map((r) => recipeCard(ctx, r, cats, () => nav.go(Routes.DETAIL, { id: r.id }))), h('div', { style: 'height:12px' }));
  }
  function rerender() { renderTabs(); renderList(); }
  drawSearch(st.searchOpen); rerender();
  const un = live(ctx, art.el, () => { renderTabs(); renderList(); });
  art.destroy = un;
  return art;
}
