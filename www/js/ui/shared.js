// Helpers shared by several screens: recipe text, the add-to-grocery and day-picker sheets, file pickers, share, links.
import { h } from './dom.js';
import { sheet, bigButton, chip, textButton, say } from './widgets.js';
import * as Planner from '../engine/planner.js';
import * as Q from '../engine/quantity.js';
import { minutesLabel } from './dom.js';

export const metaLine = (r) => [r.prepMinutes != null ? `${minutesLabel(r.prepMinutes)} prep` : null, r.cookMinutes != null ? `${minutesLabel(r.cookMinutes)} cook` : null, r.servings != null ? `Serves ${r.servings}` : null].filter(Boolean).join(' · ');

export function recipeText(r, servings) {
  const f = Q.factor(r.servings, servings);
  const out = [r.title];
  if (r.description.trim()) out.push(r.description);
  const meta = metaLine(r); if (meta) out.push(meta);
  out.push('', 'Ingredients');
  r.ingredients.forEach((i) => out.push(i.header ? `\n${i.text}:` : '• ' + Q.scale(i.text, f)));
  out.push('', 'Directions');
  let n = 0; r.directions.forEach((d) => out.push(d.header ? `\n${d.text}:` : `${++n}. ${d.text}`));
  if (r.notes.trim()) out.push('', `Notes: ${r.notes}`);
  if (r.sourceUrl) out.push('', `Source: ${r.sourceUrl}`);
  return out.join('\n').trim();
}

export async function shareText(title, text) {
  try { if (navigator.share) { await navigator.share({ title, text }); return true; } } catch (e) { if (e && e.name === 'AbortError') return true; }
  try { await navigator.clipboard.writeText(text); say('Copied to the clipboard.'); return true; } catch { return false; }
}
export const openLink = (url) => { try { window.open(url, '_blank', 'noopener'); return true; } catch { return false; } };

/** Opens the system picker (photo library, camera or Files). Resolves with the chosen File, or null if the page regains focus without one. */
export function pickFile({ accept = '*/*', capture = null, multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, capture, style: 'position:fixed;left:-9999px;opacity:0' });
    document.body.append(input);
    let done = false;
    const finish = (v) => { if (done) return; done = true; input.remove(); resolve(v); };
    input.addEventListener('change', () => finish(multiple ? [...input.files] : (input.files[0] ?? null)));
    input.addEventListener('cancel', () => finish(multiple ? [] : null));
    input.click();
  });
}

export function groceryAddSheet(ctx, r, servings, onOpenList) {
  const sunday = ctx.prefs.sundayStart;
  let week = Planner.weekStart(Planner.today(), sunday ? 0 : 1);
  const checked = r.ingredients.filter((i) => i.checked && !i.header);
  let onlyChecked = false;
  const result = h('p', { class: 'sheet-note', 'aria-live': 'polite', 'data-testid': 'grocery-result' });
  return sheet({ label: 'Add to Grocery List', content: (close) => {
    const weekLabel = h('div', { style: 'flex:1;text-align:center;font-weight:600;font-size:17px' }, Planner.rangeLabel(week));
    const chips = h('div', { style: 'display:flex;flex-direction:column;gap:8px' });
    const draw = () => { weekLabel.textContent = Planner.rangeLabel(week);
      chips.replaceChildren(chip(`All ${r.ingredients.filter((i) => !i.header).length} ingredients`, !onlyChecked, () => { onlyChecked = false; draw(); }),
        chip(`Only the ${checked.length} I ticked`, onlyChecked, () => { if (checked.length) { onlyChecked = true; draw(); } })); };
    draw();
    return h('div', { class: 'sheet-col' },
      h('h2', { class: 'sheet-title' }, 'Add to Grocery List'),
      h('div', { class: 'row-line' }, textButton('‹ Earlier', () => { week = Planner.addDays(week, -7); draw(); }), weekLabel, textButton('Later ›', () => { week = Planner.addDays(week, 7); draw(); })),
      chips,
      checked.length === 0 ? h('p', { class: 'sheet-note' }, 'Tick ingredients in the recipe first to add just those.') : null,
      result,
      h('div', { class: 'sheet-row' },
        bigButton('Add', async () => {
          const n = await ctx.repo.addIngredientsToGroceries(week, r, servings ?? r.servings, onlyChecked ? checked : null);
          ctx.week.set(week);
          result.textContent = n === 0 ? `Everything is already on the list for ${Planner.rangeLabel(week)}.` : `Added or updated ${n} ${n === 1 ? 'item' : 'items'} on the list for ${Planner.rangeLabel(week)}. Tap Open list to see them.`;
        }, { testid: 'grocery-add' }),
        bigButton('Open list', () => { close(false); onOpenList(); }, { primary: false, testid: 'grocery-open' })));
  } });
}

export function dayPickerSheet(title, onPick) {
  const today = Planner.today();
  return sheet({ label: title, content: (close) => h('div', null, h('h2', { class: 'sheet-title' }, title),
    ...Array.from({ length: 14 }, (_, i) => { const d = Planner.addDays(today, i);
      return h('button', { class: 'listrow', type: 'button', onclick: () => { close(false); onPick(d); } }, `${i === 0 ? 'Today' : Planner.dayLabel(d)}, ${Planner.dateLabel(d)}`); })) });
}

/** Re-renders `fn` when the repository or prefs change, but never while the user is typing in `root` (it re-runs on blur). */
export function live(ctx, root, fn) {
  let pending = false;
  const run = () => { if (!root.isConnected) return; const a = document.activeElement; if (a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { pending = true; return; } pending = false; fn(); };
  root.addEventListener('focusout', () => { if (pending) setTimeout(run, 0); });
  const un = [ctx.repo.subscribe(run)];
  return () => un.forEach((u) => u());
}

import { filter as searchFilter, Sort } from '../engine/search.js';
import { mount } from './dom.js';

export function weekSheet(ctx, week, onPick) {
  const first = ctx.prefs.sundayStart ? 0 : 1;
  let cur = week;
  return sheet({ label: 'Choose a week', content: (close) => {
    const label = h('div', { style: 'flex:1;text-align:center;font-weight:600;font-size:17px', 'aria-live': 'polite' });
    const draw = () => { label.textContent = Planner.rangeLabel(cur); };
    draw();
    const pick = (w) => { cur = w; onPick(w); draw(); };
    const dateInput = h('input', { class: 'field', type: 'date', 'aria-label': 'Pick a date', style: 'display:none;margin-top:8px', 'data-testid': 'week-date',
      onchange: (e) => { if (e.target.value) { pick(Planner.weekStart(e.target.value, first)); close(false); } } });
    return h('div', { class: 'sheet-col' }, h('h2', { class: 'sheet-title' }, 'Choose a week'),
      h('div', { class: 'row-line' }, bigButton('‹ Previous', () => pick(Planner.addDays(cur, -7)), { primary: false, testid: 'week-prev' }), label, bigButton('Next ›', () => pick(Planner.addDays(cur, 7)), { primary: false, testid: 'week-next' })),
      bigButton('This week', () => { pick(Planner.weekStart(Planner.today(), first)); close(false); }, { primary: false }),
      bigButton('Pick a date…', () => { dateInput.style.display = 'block'; dateInput.focus(); try { dateInput.showPicker?.(); } catch { /* ignore */ } }, { primary: false }), dateInput,
      bigButton('Done', () => close(), { testid: 'week-done' }));
  } });
}

export function recipePickerSheet(recipes, title, onPick, onImport) {
  return sheet({ label: title, tall: true, content: (close) => {
    const list = h('div', { class: 'sheet-scroll', 'data-testid': 'picker-list' });
    const draw = (q) => {
      const items = searchFilter(recipes, [], q, null, false, Sort.TITLE);
      mount(list, items.map((r) => h('button', { class: 'listrow', type: 'button', 'data-testid': `pick:${r.id}`, style: 'flex-direction:column;align-items:flex-start;justify-content:center', onclick: () => { close(false); onPick(r); } },
        h('div', null, r.title.trim() || 'Untitled recipe'), metaLine(r) ? h('div', { style: 'font-size:14px;font-weight:400;opacity:.8' }, metaLine(r)) : null)),
        items.length ? null : h('p', { style: 'padding:16px' }, `No recipes match “${q}”.`));
    };
    if (!recipes.length) return h('div', null, h('h2', { class: 'sheet-title' }, title), h('p', null, 'No recipes yet.'), bigButton('Import a recipe', () => { close(false); onImport(); }));
    draw('');
    return h('div', { class: 'sheet-col' }, h('h2', { class: 'sheet-title' }, title),
      h('input', { class: 'field', type: 'search', placeholder: 'Search your recipes', 'data-testid': 'picker-search', oninput: (e) => draw(e.target.value) }), list);
  } });
}
