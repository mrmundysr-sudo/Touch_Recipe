// Port of ui/screens/CategoryParts.kt: the full category catalog + custom entry. Used by Review's "Add Category"
// (with selected/onSelect for the recipe being edited) and by Category Management (selection hidden).
import { h, mount } from '../ui/dom.js';
import { bigButton, sheet, dialog, confirmDialog } from '../ui/widgets.js';
import * as Cat from '../engine/categories.js';

export function categoryCatalogContent(ctx, selected, onSelect) {
  const root = h('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  const fieldHolder = h('div');
  let name = '', error = null;
  const field = h('input', { class: 'field', type: 'text', 'data-testid': 'custom-category-field', 'aria-label': 'New custom category', placeholder: 'New custom category', autocapitalize: 'words', enterkeyhint: 'done',
    oninput: (e) => { name = e.target.value; error = null; hint.textContent = defaultHint; hint.style.color = ''; }, onkeydown: (e) => { if (e.key === 'Enter') commit(); } });
  const defaultHint = 'Press Enter to add it. New categories are switched on right away.';
  const hint = h('div', { style: 'font-size:13px;opacity:.8;min-height:1.2em' }, defaultHint);
  async function commit() {
    const [res, id] = await ctx.repo.addCustomCategoryReturningId(name);
    if (res.ok) { onSelect && onSelect(id, true); name = ''; field.value = ''; error = null; hint.textContent = defaultHint; hint.style.color = ''; field.focus(); }
    else { error = res.reason; hint.textContent = res.reason; hint.style.color = 'var(--error)'; }
  }
  const list = h('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  root.append(h('h3', { style: 'margin:4px 0', role: 'heading' }, ''), fieldHolder, hint, list);
  const title = root.firstChild;

  function draw() {
    if (!root.isConnected && root.dataset.mounted) { unsub(); return; }
    const cats = ctx.repo.categories();
    const customs = cats.filter((c) => !c.builtIn);
    title.textContent = `Custom categories (${customs.length} of ${Cat.MAX_CUSTOM_CATEGORIES})`;
    if (!fieldHolder.firstChild) fieldHolder.append(field);
    const kids = [];
    customs.forEach((cat) => kids.push(h('div', { class: 'row-line', style: 'min-height:52px' },
      h('input', { type: 'checkbox', style: 'width:22px;height:22px', 'aria-label': cat.name, checked: selected ? selected.has(cat.id) : cat.enabled, onchange: (e) => { if (selected) onSelect && onSelect(cat.id, e.target.checked); else ctx.repo.setCategoryEnabled(cat.id, e.target.checked); } }),
      h('div', { style: 'flex:1' }, cat.name),
      h('button', { class: 'text-btn', type: 'button', onclick: () => renameDialog(cat) }, 'Edit'),
      h('button', { class: 'text-btn', type: 'button', onclick: () => { const n = ctx.repo.recipesUsingCategory(cat.id);
        confirmDialog(`Delete “${cat.name}”?`, n === 0 ? 'No recipes use it.' : `It will be removed from ${n} ${n === 1 ? 'recipe' : 'recipes'}. The recipes themselves are kept.`, 'Delete', async () => { await ctx.repo.deleteCustomCategory(cat.id); if (selected && selected.has(cat.id)) onSelect && onSelect(cat.id, false); }, true); } }, 'Delete'))));
    kids.push(h('hr', { class: 'div' }), h('h3', { style: 'margin:4px 0' }, 'Built-in categories'),
      h('p', { class: 'sheet-note' }, 'Switch on the categories you want to see when organising recipes. Turning one off only hides it; recipes keep their categories.'));
    Cat.groups.forEach(([group, names]) => {
      kids.push(h('h3', { style: 'margin:10px 0 2px' }, group));
      names.forEach((n) => {
        const cat = cats.find((c) => c.id === Cat.idFor(n)); if (!cat) return;
        kids.push(h('div', { class: 'row-line', style: 'min-height:48px' }, h('div', { style: 'flex:1' }, cat.name),
          selected && selected.has(cat.id) ? h('span', { style: 'font-size:13px;font-weight:600' }, '✓ on this recipe') : null,
          h('input', { class: 'switch', type: 'checkbox', role: 'switch', 'aria-label': `${cat.name}, ${cat.enabled ? 'on' : 'off'}`, checked: cat.enabled,
            onchange: (e) => { ctx.repo.setCategoryEnabled(cat.id, e.target.checked); if (selected) onSelect && onSelect(cat.id, e.target.checked); } })));
      });
    });
    mount(list, kids);
  }
  function renameDialog(cat) {
    const v = h('input', { class: 'field', type: 'text', value: cat.name, 'aria-label': 'Category name' });
    const err = h('div', { style: 'color:var(--error);font-size:13px;min-height:1.2em' });
    const dlg = dialog({ title: 'Rename category', content: h('div', null, v, err), confirm: null, cancel: 'Cancel' });
    dlg.close = dlg.close; // keep API
    const box = v.closest('.dialog').querySelector('.dialog-actions');
    box.append(h('button', { class: 'text-btn', type: 'button', onclick: async () => { const r = await ctx.repo.renameCategory(cat.id, v.value); if (r.ok) dlg.close(); else err.textContent = r.reason; } }, 'Save'));
  }
  const unsub = ctx.repo.subscribe(() => { const a = document.activeElement; if (a === field) return; if (root.isConnected) draw(); });
  draw();
  queueMicrotask(() => { root.dataset.mounted = '1'; });
  return root;
}

export function addCategorySheet(ctx, selected, onSelect) {
  return sheet({ label: 'Add Category', tall: true, content: (close) => h('div', { class: 'sheet-col' }, h('h2', { class: 'sheet-title' }, 'Add Category'),
    h('div', { class: 'sheet-scroll' }, categoryCatalogContent(ctx, selected, onSelect)), bigButton('Done', () => close(), { testid: 'cats-done' })) });
}
