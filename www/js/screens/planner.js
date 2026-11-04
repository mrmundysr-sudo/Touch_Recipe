// Port of ui/screens/PlannerScreen.kt: the weekly meal planner.
import { h, mount, minutesLabel } from '../ui/dom.js';
import { ArtPage, place, dp, sp } from '../ui/art.js';
import { Routes } from '../ui/nav.js';
import { backChip, bigButton, sheet, fitText, photoImg, undoable, say } from '../ui/widgets.js';
import * as Planner from '../engine/planner.js';
import { effectiveTotal } from '../engine/models.js';
import { weekSheet, recipePickerSheet, live } from '../ui/shared.js';

const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function plannerScreen(params, ctx, nav) {
  const week = () => ctx.week.value;
  const days = () => Planner.days(week());
  const recipeFor = (i) => { const e = ctx.repo.meals(week(), Planner.addDays(week(), 6)).find((m) => m.date === days()[i]); return e ? ctx.repo.recipe(e.recipeId) : null; };
  const entryFor = (i) => ctx.repo.meals(week(), Planner.addDays(week(), 6)).find((m) => m.date === days()[i]) ?? null;

  const art = ArtPage(ctx.art, 'planner', {
    title: 'Meal Planner', prefs: ctx.prefs,
    describe: (t) => {
      const m = /^(day|act)(\d)$/.exec(t.id);
      if (m) {
        const i = +m[2], d = days()[i];
        if (m[1] === 'day') { const r = recipeFor(i), e = entryFor(i); return `${Planner.dayLabel(d)}, ${Planner.dateLabel(d)}: ` + (r ? `${r.title}, ${minutesLabel(r.cookMinutes) ?? 'no cook time'}, ${e?.servings ?? r.servings ?? '?'} servings. Opens the recipe` : 'no meal planned. Opens the recipe chooser'); }
        return `${Planner.dayLabel(d)} options: ${recipeFor(i) ? 'replace or remove the meal' : 'assign a recipe'}`;
      }
      return t.id === 'week' ? `Week selector, ${Planner.rangeLabel(week())}` : null;
    },
    onTarget: async (id) => {
      if (id === 'week' || id === 'calendar') weekSheet(ctx, week(), (w) => ctx.week.set(w));
      else if (id === 'grocery') { await ctx.repo.generateGroceries(week()); nav.go(Routes.GROCERY); }
      else if (id.startsWith('day')) { const i = +id.slice(3); const r = recipeFor(i); if (r) nav.go(Routes.DETAIL, { id: r.id }); else if (!ctx.repo.recipes().length) daySheet(i); else picker(i); }
      else if (id.startsWith('act')) daySheet(+id.slice(3));
    },
  });
  const { content, page } = art;
  const dyn = h('div'); content.append(dyn);
  const back = backChip(() => nav.backOr(Routes.HUB)); Object.assign(back.style, { position: 'absolute', right: '12px', top: dp(14), pointerEvents: 'auto' });
  content.append(back);

  function picker(i) { recipePickerSheet(ctx.repo.recipes(), `Choose a recipe for ${Planner.dayLabel(days()[i])}`, async (r) => { await ctx.repo.assignMeal(days()[i], r.id, r.servings); }, () => nav.go(Routes.IMPORT)); }
  function daySheet(i) {
    const date = days()[i];
    sheet({ label: 'Day', content: (close) => {
      const body = h('div', { style: 'display:flex;flex-direction:column;gap:8px' });
      const draw = () => {
        const r = recipeFor(i), e = entryFor(i), recipes = ctx.repo.recipes();
        const kids = [h('h2', { class: 'sheet-title' }, `${Planner.dayLabel(date)}, ${Planner.dateLabel(date)}`)];
        if (!recipes.length) kids.push(h('p', null, "You haven't saved any recipes yet. Import one first, then plan it here."), bigButton('Import a recipe', () => { close(false); nav.go(Routes.IMPORT); }));
        else if (!r) kids.push(bigButton('Assign a recipe', () => { close(false); picker(i); }), h('p', { class: 'sheet-note' }, "Leave the day empty if you don't want to plan a meal."));
        else {
          const cur = e?.servings ?? r.servings ?? 4;
          kids.push(h('div', { style: 'font-weight:600;font-size:17px' }, r.title),
            h('div', { class: 'row-line' }, h('div', { style: 'flex:1;font-weight:600' }, 'Servings'),
              h('button', { class: 'big-btn outline', type: 'button', style: 'width:48px;min-height:48px;padding:0;font-size:22px', 'aria-label': 'Fewer servings', onclick: async () => { await ctx.repo.assignMeal(date, r.id, Math.max(1, cur - 1)); draw(); } }, '−'),
              h('div', { style: 'min-width:48px;text-align:center;font-size:20px;font-weight:700', 'data-testid': 'day-servings' }, String(cur)),
              h('button', { class: 'big-btn outline', type: 'button', style: 'width:48px;min-height:48px;padding:0;font-size:22px', 'aria-label': 'More servings', onclick: async () => { await ctx.repo.assignMeal(date, r.id, Math.min(99, cur + 1)); draw(); } }, '+')),
            bigButton('Open recipe', () => { close(false); nav.go(Routes.DETAIL, { id: r.id }); }),
            bigButton('Replace recipe', () => { close(false); picker(i); }, { primary: false }),
            bigButton('Remove from this day', async () => { close(false); const prev = e; await ctx.repo.removeMeal(date); if (prev) undoable(`Removed ${r.title} from ${Planner.dayLabel(date)}`, () => ctx.repo.assignMeal(date, prev.recipeId, prev.servings)); }, { primary: false, testid: 'remove-meal' }));
        }
        mount(body, kids);
      };
      draw(); return body;
    } });
  }

  function render() {
    mount(dyn);
    const wk = place(h('div', { 'aria-hidden': 'true', 'data-testid': 'week-label', style: 'display:flex;align-items:center;justify-content:center;pointer-events:none' }), page.target('week').box);
    wk.append(fitText(Planner.rangeLabel(week()), { style: `font-weight:700;font-size:${sp(24)};color:var(--ink);text-align:center;max-width:100%` }));
    dyn.append(wk);
    page.days.forEach((d, i) => {
      const date = days()[i], r = recipeFor(i), e = entryFor(i);
      const box = (rect, child, extra = '') => { const el = place(h('div', { 'aria-hidden': 'true', style: `display:flex;align-items:center;pointer-events:none;${extra}` }), rect); if (child) el.append(child); dyn.append(el); return el; };
      const center = 'justify-content:center;';
      box(d.label, fitText(SHORT[Planner.fromIso(date).getDay()], { minScale: 0.8, style: `font-weight:700;font-size:${sp(24)};color:var(--forest);text-align:center;max-width:100%` }), center).firstChild.dataset.testid = `day-label:${i}`;
      box(d.date, fitText(Planner.dateLabel(date), { style: `font-weight:600;font-size:${sp(21)};color:var(--ink);text-align:center;max-width:100%` }), center).firstChild.dataset.testid = `day-date:${i}`;
      const pb = box(d.photo, null, `border-radius:${dp(12)};overflow:hidden;`);
      if (r) { const ph = photoImg(ctx.photos, r.photo, { fallback: r.title }); ph.style.cssText = 'position:absolute;inset:0'; pb.append(ph); } else pb.append(h('div', { style: `width:100%;text-align:center;font-size:${sp(52)};color:rgba(181,138,60,.8)` }, '＋'));
      const tb = box(d.title, fitText(r?.title ?? 'Nothing planned', { minScale: 0.5, style: `font-family:var(--display);font-weight:${r ? 700 : 400};font-size:${sp(28)};color:${r ? 'var(--ink)' : 'rgba(42,33,24,.55)'};max-width:100%` }), `padding-left:${dp(10)};padding-right:${dp(64)};`);
      tb.firstChild.dataset.testid = `day-title:${i}`;
      box(d.cook, fitText(minutesLabel(r?.cookMinutes ?? (r ? effectiveTotal(r) : null)) ?? '—', { style: `font-weight:600;font-size:${sp(21)};color:var(--ink);text-align:center;max-width:100%` }), center);
      box(d.servings, fitText(String(e?.servings ?? r?.servings ?? '—'), { style: `font-weight:600;font-size:${sp(21)};color:var(--ink);text-align:center;max-width:100%` }), center);
      box(d.action, h('div', { style: `width:${dp(58)};height:${dp(58)};border-radius:50%;background:rgba(251,244,230,.92);border:1.5px solid var(--brass);display:flex;align-items:center;justify-content:center;font-size:${sp(34)};font-weight:700;color:var(--ink)` }, r ? '⋯' : '＋'), center);
    });
    art.refreshLabels();
  }
  render();
  const unWeek = ctx.week.subscribe(render);
  const un = live(ctx, art.el, render);
  art.destroy = () => { un(); unWeek(); };
  return art;
}
