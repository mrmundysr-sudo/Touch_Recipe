// Grocery List as a plain coded page (same style as the recipe screen): week and refresh controls on top, category headings with their
// items as cards, Add item / Clear checked in the footer below the scrolling list. No artwork is needed to use it.
import { h, mount } from '../ui/dom.js';
import { ScrollPage } from '../ui/page.js';
import { Routes } from '../ui/nav.js';
import { bigButton, chip, sheet, say, undoable, dialog, confirmDialog } from '../ui/widgets.js';
import * as G from '../engine/grocery.js';
import * as Planner from '../engine/planner.js';
import { live, weekSheet } from '../ui/shared.js';

export const AISLE_NAMES = { produce: 'Produce', meat: 'Meat & Seafood', dairy: 'Dairy & Eggs', pantry: 'Pantry', bakery: 'Bakery' };
export const aisleName = (key) => AISLE_NAMES[key] ?? key;

export function groceryScreen(params, ctx, nav) {
  const week = () => ctx.week.value;
  const items = () => ctx.repo.groceryItems(week());
  const allAisles = () => [...G.DEFAULT_AISLES, ...ctx.repo.customAisles()];
  const collapsed = (params.__collapsed ||= new Set());

  // Plain coded page in the same style as the recipe screen: real text and real buttons, no background picture.
  const page = ScrollPage({ title: 'Grocery List', testid: 'grocery', onBack: () => nav.backOr(Routes.HUB) });
  const art = { el: page.el, destroy: null };
  const tool = (art_, testid, label, onclick, aria) => { const b = h('button', { type: 'button', class: 'gl-link', 'data-testid': testid, 'data-art': art_, 'aria-label': aria ?? label, onclick }, label); return b; };
  const weekBtn = tool('week', 'grocery-week', '', () => weekSheet(ctx, week(), (w) => ctx.week.set(w)));
  const refreshBtn = tool('basket', 'grocery-refresh', '🧺 From meals', async () => { const n = await ctx.repo.generateGroceries(week()); basketSheet(); say(n === 0 ? 'No meals are planned this week, so nothing was added.' : `Refreshed from ${n} planned ${n === 1 ? 'meal' : 'meals'}.`); }, 'Refresh the list from this week\'s planned meals');
  const toolbar = h('div', { class: 'gl-toolbar' }, weekBtn, refreshBtn);
  const listEl = page.body; listEl.setAttribute('data-testid', 'grocery-list');
  const addBtn = bigButton('Add item', () => addSheet(), { testid: 'grocery-add' }); addBtn.dataset.art = 'add';
  const clearBtn = bigButton('Clear checked', () => { const n = items().filter((i) => i.checked).length; if (n === 0) say('Nothing is checked off yet.'); else confirmDialog('Clear checked items?', `${n} purchased ${n === 1 ? 'item' : 'items'} will be removed from this week's list. You can undo right after.`, 'Clear', async () => { const removed = await ctx.repo.clearChecked(week()); undoable(`Cleared ${removed.length} items`, () => ctx.repo.restoreGroceryItems(removed)); }, true); }, { primary: false, testid: 'grocery-clear' }); clearBtn.dataset.art = 'clear';
  mount(page.foot, h('div', { class: 'sp-bar' }, h('div', { class: 'sheet-row', style: 'width:100%' }, addBtn, clearBtn)));

  function drawWeek() { weekBtn.textContent = `🗓 ${Planner.rangeLabel(week())}`; weekBtn.setAttribute('aria-label', `Week range, ${Planner.rangeLabel(week())}. Tap to change.`); }

  function drawList() {
    const all = items();
    const aisles = allAisles();
    const groups = [...new Set([...aisles, ...all.map((i) => i.aisle)])].map((k) => [k, all.filter((i) => i.aisle === k)]).filter(([, l]) => l.length);
    const kids = [];
    if (!groups.length) kids.push(h('div', { 'data-testid': 'grocery-empty', style: 'flex:none;padding:16px 4px;font-size:calc(18px * var(--ts));color:rgba(42,33,24,.75);line-height:1.35' },
      'Nothing on your list yet. Tap Add Item below, add ingredients from a recipe, or plan meals and tap the basket.'));
    for (const [aisle, list] of groups) {
      const open = !collapsed.has(aisle);
      const bought = list.filter((i) => i.checked).length;
      kids.push(h('section', { class: 'sp-sec', style: 'display:flex;flex-direction:column;gap:2px;flex:none;margin-top:14px' },
        h('button', { type: 'button', class: 'aisle-head', 'data-testid': `aisle-head:${aisle}`, 'aria-expanded': String(open),
          'aria-label': `${aisleName(aisle)}: ${list.length} ${list.length === 1 ? 'item' : 'items'}, ${bought} bought. ${open ? 'Expanded' : 'Collapsed'}`,
          style: 'display:flex;align-items:center;width:100%;min-height:48px;padding:0 4px;border:0;background:transparent;border-radius:8px;text-align:left;color:inherit',
          onclick: () => { open ? collapsed.add(aisle) : collapsed.delete(aisle); drawList(); } },
          h('span', { style: 'flex:1;font-family:var(--display);font-weight:700;font-size:calc(25px * var(--ts));color:var(--forest)' }, aisleName(aisle)),
          h('span', { style: 'font-weight:600;font-size:calc(15px * var(--ts));color:rgba(42,33,24,.7)' }, `${bought}/${list.length}`),
          h('span', { style: 'font-size:calc(18px * var(--ts));color:var(--forest)' }, open ? '  ▾' : '  ▸')),
        h('div', { style: 'height:1.5px;background:rgba(31,77,58,.45)' })));
      if (!open) kids.push(h('div', { 'data-testid': `aisle-summary:${aisle}`, style: 'padding:10px;font-size:calc(15px * var(--ts));color:rgba(42,33,24,.8)' }, `${list.length} items · ${bought} bought. Tap the heading to expand.`));
      else list.forEach((item) => kids.push(row(item)));
    }
    mount(listEl, toolbar, kids);
  }

  function row(item) {
    // Long names and amounts wrap onto more lines instead of being clipped; the boxes grow to fit what they hold.
    const grow = (el) => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; };
    const name = h('textarea', { rows: '1', 'aria-label': 'Item name', autocapitalize: 'sentences', enterkeyhint: 'next', 'data-testid': `grocery-name:${item.id}`,
      style: `flex:1 1 0;min-width:0;border:0;background:transparent;font:inherit;font-size:calc(17px * var(--ts));line-height:1.25;color:var(--ink);padding:2px 6px 2px 0;resize:none;overflow:hidden;overflow-wrap:anywhere;${item.checked ? 'text-decoration:line-through' : ''}`,
      oninput: () => grow(name),
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } },
      onblur: () => { const v = name.value.replace(/\s+/g, ' ').trim(); if (v && v !== item.name) ctx.repo.updateGroceryItem({ ...item, name: v, edited: true }); else name.value = item.name; } });
    name.value = item.name;
    const qty = h('textarea', { rows: '1', placeholder: 'qty', 'aria-label': 'Quantity and unit', enterkeyhint: 'done', 'data-testid': `grocery-qty:${item.id}`,
      style: 'flex:0 1 78px;min-width:56px;max-width:28%;border:0;border-radius:6px;background:transparent;padding:6px 4px;color:var(--ink-soft,#5a4d3d);font:inherit;font-size:calc(15px * var(--ts));line-height:1.25;color:var(--ink);resize:none;overflow:hidden;overflow-wrap:anywhere;text-align:right',
      oninput: () => grow(qty),
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); qty.blur(); } },
      onblur: () => { const v = qty.value.replace(/\s+/g, ' ').trim(); if (v !== item.quantityText) ctx.repo.updateGroceryItem({ ...item, quantityText: v, edited: true }); } });
    qty.value = item.quantityText;
    requestAnimationFrame(() => { grow(name); grow(qty); });
    document.fonts?.ready?.then(() => { grow(name); grow(qty); }); setTimeout(() => { grow(name); grow(qty); }, 300);
    if (typeof ResizeObserver !== 'undefined') { let w = 0; new ResizeObserver(() => { const nw = name.clientWidth; if (nw !== w) { w = nw; grow(name); grow(qty); } }).observe(name); }
    const r = h('div', { 'data-testid': `grocery-row:${item.id}`, style: `display:flex;align-items:center;gap:6px;min-height:56px;padding:6px 0;border-bottom:1px solid rgba(31,77,58,.16);flex:none;${item.checked ? 'opacity:.55' : ''}` },
      h('button', { type: 'button', role: 'checkbox', 'aria-checked': String(item.checked), 'aria-label': `${item.name} purchased`, 'data-testid': `grocery-check:${item.id}`, style: 'width:48px;height:48px;border:0;background:transparent;display:flex;align-items:center;justify-content:center;flex:none;padding:0',
        onclick: () => ctx.repo.updateGroceryItem({ ...item, checked: !item.checked }) },
        h('span', { style: `width:24px;height:24px;border-radius:6px;border:2px solid var(--forest);background:${item.checked ? 'var(--forest)' : 'transparent'};color:var(--cream);font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center` }, item.checked ? '✓' : '')),
      name, qty,
      h('button', { type: 'button', 'aria-label': `Row options for ${item.name}`, style: 'width:40px;height:48px;border:0;background:transparent;font-size:calc(20px * var(--ts));font-weight:700;color:var(--ink);flex:none', onclick: () => itemSheet(item) }, '⋮'));
    // long press opens the row options too
    let t = null;
    r.addEventListener('touchstart', () => { t = setTimeout(() => itemSheet(item), 550); }, { passive: true });
    ['touchend', 'touchmove', 'touchcancel'].forEach((ev) => r.addEventListener(ev, () => clearTimeout(t), { passive: true }));
    return r;
  }

  function itemSheet(item) {
    let aisle = item.aisle;
    sheet({ label: 'Edit item', content: (close) => {
      const name = h('input', { class: 'field', type: 'text', value: item.name, 'data-testid': 'item-name', 'aria-label': 'Item' });
      const qty = h('input', { class: 'field', type: 'text', value: item.quantityText, 'data-testid': 'item-qty', 'aria-label': 'Quantity and unit' });
      const chips = h('div', { class: 'chips' });
      const draw = () => mount(chips, allAisles().map((a) => chip(aisleName(a), aisle === a, () => { aisle = a; draw(); })));
      draw();
      const move = async (dir) => { const l = items().filter((i) => i.aisle === item.aisle).map((i) => i.id); const i = l.indexOf(item.id), j = i + dir; if (j >= 0 && j < l.length) { l.splice(j, 0, l.splice(i, 1)[0]); await ctx.repo.reorderGrocery(week(), item.aisle, l); } };
      return h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, h('h2', { class: 'sheet-title' }, 'Edit item'),
        h('label', { class: 'lbl' }, 'Item'), name, h('label', { class: 'lbl' }, 'Quantity and unit'), qty, h('h3', null, 'Category'), chips,
        item.sources.length ? h('p', { class: 'sheet-note' }, 'From: ' + item.sources.map((s) => s.title).join(', ')) : null,
        h('div', { class: 'sheet-row' }, bigButton('Move up', () => move(-1), { primary: false }), bigButton('Move down', () => move(1), { primary: false })),
        h('div', { class: 'sheet-row' },
          bigButton('Delete', async () => { close(false); await ctx.repo.deleteGroceryItem(item.id); undoable(`Removed ${item.name}`, () => ctx.repo.restoreGroceryItems([item])); }, { primary: false, testid: 'item-delete' }),
          bigButton('Save', async () => { if (!name.value.trim()) return; close(false); await ctx.repo.updateGroceryItem({ ...item, name: name.value.trim(), quantityText: qty.value.trim(), aisle, edited: true }); }, { testid: 'item-save' })));
    } });
  }

  function addSheet() {
    let aisle = G.AISLE_PRODUCE, auto = true;
    sheet({ label: 'Add item', tall: true, content: (close) => {
      const message = h('p', { 'aria-live': 'polite', style: 'color:var(--primary);margin:0;min-height:1.2em' });
      const name = h('input', { class: 'field', type: 'text', 'data-testid': 'add-name', 'aria-label': 'Item', placeholder: 'Item', autocapitalize: 'sentences', enterkeyhint: 'next', oninput: () => { message.textContent = ''; } });
      const qty = h('input', { class: 'field', type: 'text', 'data-testid': 'add-qty', 'aria-label': 'Quantity and unit (optional)', placeholder: 'Quantity and unit (optional)', enterkeyhint: 'done', onkeydown: (e) => { if (e.key === 'Enter') add(); } });
      const chips = h('div', { class: 'chips' });
      const newAisle = h('input', { class: 'field', type: 'text', 'data-testid': 'new-aisle', 'aria-label': 'New category', placeholder: 'New category', style: 'flex:1' });
      const mine = h('div');
      const drawChips = () => mount(chips, chip('Pick for me', auto, () => { auto = true; drawChips(); }), allAisles().map((a) => chip(aisleName(a), !auto && aisle === a, () => { aisle = a; auto = false; drawChips(); })));
      const drawMine = () => {
        const custom = ctx.repo.customAisles();
        if (!custom.length && !items().some((i) => custom.includes(i.aisle))) { mount(mine); return; }
        mount(mine, h('hr', { class: 'div' }), h('h3', null, 'Your own categories'), custom.map((a) => h('div', null, h('div', { style: 'font-weight:700;margin-top:6px' }, a),
          items().filter((i) => i.aisle === a).map((i) => h('div', { class: 'row-line', style: 'min-height:48px' },
            h('input', { type: 'checkbox', checked: i.checked, style: 'width:22px;height:22px', onchange: (e) => ctx.repo.updateGroceryItem({ ...i, checked: e.target.checked }).then(drawMine) }),
            h('div', { style: 'flex:1' }, i.name + (i.quantityText ? ` — ${i.quantityText}` : '')), h('button', { class: 'text-btn', type: 'button', onclick: () => ctx.repo.deleteGroceryItem(i.id).then(drawMine) }, 'Delete'))),
          h('button', { class: 'text-btn', type: 'button', onclick: () => ctx.repo.deleteAisle(a, week()).then(() => { drawChips(); drawMine(); }) }, `Remove category “${a}” (items move to Pantry)`))));
      };
      async function add() {
        if (!name.value.trim()) { message.textContent = 'Type what you need first.'; return; }
        const n = name.value, q = qty.value, a = auto ? G.aisleFor(G.normalizeKey(n)) : aisle;
        const before = items();
        const r = await ctx.repo.addGroceryItem(week(), n, q, a);
        message.textContent = !r ? 'Type what you need first.' : before.some((i) => i.id === r.id) ? `“${r.name}” is already on the list.` : `Added “${r.name}” to ${aisleName(a)}.`;
        name.value = ''; qty.value = ''; name.focus(); drawMine();
      }
      drawChips(); drawMine();
      return h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, h('h2', { class: 'sheet-title' }, 'Add item'), name, qty, h('h3', null, 'Category'), chips,
        h('div', { class: 'row-line' }, newAisle, bigButton('Add', async () => { const ok = await ctx.repo.addAisle(newAisle.value); if (ok) { aisle = newAisle.value.trim(); auto = false; newAisle.value = ''; message.textContent = 'Category added.'; drawChips(); drawMine(); } else message.textContent = "That category name isn't available."; }, { primary: false })),
        message, bigButton('Add to list', add, { testid: 'add-confirm' }), mine, bigButton('Done', () => close(), { primary: false }));
    } });
  }

  function basketSheet() {
    const meals = ctx.repo.meals(week(), Planner.addDays(week(), 6)).sort((a, b) => (a.date < b.date ? -1 : 1));
    sheet({ label: 'Meals feeding this list', content: (close) => h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, h('h2', { class: 'sheet-title' }, 'Meals feeding this list'), h('p', { style: 'margin:0' }, Planner.rangeLabel(week())),
      !meals.length ? h('p', null, 'No meals are planned for this week. Plan meals and the ingredients will be combined here, with duplicates merged.') : null,
      meals.map((m) => { const r = ctx.repo.recipe(m.recipeId); return r ? h('div', { style: 'min-height:40px;font-weight:600' }, `${Planner.dayLabel(m.date)}: ${r.title}` + (m.servings ? ` (${m.servings} servings)` : '')) : null; }),
      bigButton('Open Meal Planner', () => { close(false); nav.go(Routes.PLANNER); }, { primary: false }), bigButton('Done', () => close())) });
  }

  drawWeek(); drawList();
  const un = live(ctx, art.el, drawList);
  const unWeek = ctx.week.subscribe(() => { drawWeek(); drawList(); });
  art.destroy = () => { un(); unWeek(); };
  return art;
}
