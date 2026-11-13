// Port of ui/screens/CookScreen.kt: step-by-step Cook Mode with a wall-clock timer that survives leaving the screen.
import { h, mount } from '../ui/dom.js';
import { ScrollPage } from '../ui/page.js';
import { Routes } from '../ui/nav.js';
import { dialog, photoImg, bigButton } from '../ui/widgets.js';
import * as Q from '../engine/quantity.js';
import * as T from '../engine/timer.js';
import { notifier, keepAwake } from '../data/notify.js';

export function cookScreen(params, ctx, nav) {
  const id = params.id;
  const clock = () => ctx.clock ? ctx.clock() : Date.now();
  let ui = null, missing = false, ticker = null, stopAwake = null, alive = true, timeUpShown = false;

  const persist = (u) => ctx.repo.saveCookSession({ recipeId: id, stepIndex: u.index, completed: [...u.completed].sort((a, b) => a - b), timer: u.timer, timerStep: u.timerStep, finished: u.finished });
  const update = (f) => { if (!ui) return; ui = f(ui); persist(ui); render(); };
  const busy = (u) => T.timerRunning(u.timer) || (T.timerConfigured(u.timer) && u.timer.remainingMs > 0 && u.timer.remainingMs < u.timer.totalMs);
  const carry = (u, to) => (busy(u) ? [u.timer, u.timerStep] : [T.withDuration(u.steps[to].timerSeconds), to]);

  const vm = {
    next() { if (ui.index >= ui.steps.length - 1) { update((x) => ({ ...x, completed: new Set([...x.completed, x.index]) })); return true; }
      update((x) => { const to = x.index + 1; const [t, ts] = carry(x, to); return { ...x, index: to, completed: new Set([...x.completed, x.index]), timer: t, timerStep: ts }; }); return false; },
    prev() { update((x) => { if (x.index === 0) return x; const to = x.index - 1; const [t, ts] = carry(x, to); return { ...x, index: to, timer: t, timerStep: ts }; }); },
    jump(i) { update((x) => { const [t, ts] = carry(x, i); return { ...x, index: i, timer: t, timerStep: ts }; }); },
    startPause() { let out = null; update((x) => { const t = T.timerRunning(x.timer) ? T.pause(x.timer, clock()) : T.start(x.timer, clock()); out = t; return { ...x, timer: t, timerStep: T.timerRunning(x.timer) ? x.timerStep : x.index }; }); return out; },
    reset() { update((x) => ({ ...x, timer: T.reset(x.timer), timerStep: x.index })); },
    setDuration(s) { update((x) => ({ ...x, timer: T.withDuration(s), timerStep: x.index })); },
    timerFinished() { update((x) => ({ ...x, timer: { ...x.timer, remainingMs: 0, endAtMs: null } })); },
    finish() { const u = ui; ui = { ...u, finished: true }; ctx.repo.saveCookSession({ recipeId: id, stepIndex: u.index, completed: [...u.completed], timer: T.CookTimer(), timerStep: u.timerStep, finished: true }); },
  };

  const scheduleAlarm = (t) => { if (!ui) return; if (t?.endAtMs != null) notifier.schedule(id, `${ui.recipe.title} — step ${ui.timerStep + 1} timer is done`, t.endAtMs); else notifier.cancel(id); };
  const toggleTimer = async () => {
    if (!T.timerConfigured(ui.timer)) return durationDialog();
    if (T.timerRunning(ui.timer)) return scheduleAlarm(vm.startPause());
    if (!ctx.prefs.notifAsked && (await notifier.shouldExplain())) {
      dialog({ title: 'Timer alerts', text: 'Touch Recipe can notify you when a timer finishes, even if the screen is off or you switch apps. iOS will ask for permission to show notifications. You can also keep going without it; the timer still works while this screen is open.',
        confirm: 'Continue', cancel: 'Not now',
        onConfirm: async () => { ctx.prefs.notifAsked = true; await notifier.request(); scheduleAlarm(vm.startPause()); },
        onCancel: () => { ctx.prefs.notifAsked = true; scheduleAlarm(vm.startPause()); } });
      return;
    }
    scheduleAlarm(vm.startPause());
  };

  const pressTimer = () => {
    if (!ui) return;
    if (T.timerConfigured(ui.timer) && !T.timerRunning(ui.timer) && T.remaining(ui.timer, clock()) === 0 && ui.timer.remainingMs === 0) { vm.reset(); scheduleAlarm(vm.startPause()); } else toggleTimer();
  };

  const page = ScrollPage({ title: 'Cook Mode', slot: 'page_13', testid: 'cook', onBack: () => { if (!ui) nav.backOr(Routes.HUB); else nav.backOr(Routes.DETAIL, { id }); } });
  const art = { el: page.el, destroy: null, stage: { parentElement: page.el } };
  const goNext = () => { if (vm.next()) dialog({ title: 'All steps done', text: 'Nice cooking! Finish this session, or stay and review the steps.', confirm: 'Finish', cancel: 'Keep reviewing', onConfirm: () => { vm.finish(); notifier.cancel(id); nav.backOr(Routes.DETAIL, { id }); } }); };
  const live = { clock: null, timerText: null, label: null };

  function durationDialog() {
    const cur = Math.floor(ui.timer.totalMs / 1000);
    const min = h('input', { class: 'field', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', 'data-testid': 'timer-minutes', 'aria-label': 'Minutes', placeholder: 'Minutes', value: Math.floor(cur / 60) > 0 ? String(Math.floor(cur / 60)) : '' });
    const sec = h('input', { class: 'field', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', 'data-testid': 'timer-seconds', 'aria-label': 'Seconds', placeholder: 'Seconds', value: cur % 60 > 0 ? String(cur % 60) : '' });
    [min, sec].forEach((i) => i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, i === min ? 3 : 2); }));
    let dlg;
    const content2 = h('div', null, h('p', null, 'Set how long this step should be timed. Leave both empty for no timer.'), h('div', { style: 'display:flex;gap:8px' }, min, sec),
      cur > 0 ? h('button', { class: 'text-btn', type: 'button', onclick: () => { vm.reset(); notifier.cancel(id); dlg.close(); } }, `Reset to ${T.formatMs(cur * 1000)}`) : null);
    dlg = dialog({ title: 'Step timer', content: content2, confirm: 'Set', onConfirm: () => { const total = (parseInt(min.value, 10) || 0) * 60 + (parseInt(sec.value, 10) || 0); vm.setDuration(total > 0 ? total : null); notifier.cancel(id); } });
  }

  function ingredientsSection(u) {
    const ingredients = ctx.repo.recipe(id)?.ingredients ?? u.recipe.ingredients;
    const factor = Q.factor(u.recipe.servings, params.servings);
    return h('section', { class: 'sp-sec', 'data-testid': 'cook-ingredients', 'data-art-slot': 'cook_ingredients' }, h('h2', { class: 'sp-h2' }, 'Ingredients'),
      !ingredients.length ? h('div', { class: 'sp-warn' }, 'This recipe has no ingredients listed.') : null,
      ...ingredients.map((ing) => {
        if (ing.header) return h('div', { role: 'heading', 'aria-level': '3', style: 'padding-top:8px;font-weight:700;color:var(--forest)' }, ing.text);
        const shown = Q.scale(ing.text, factor);
        const toggle = () => ctx.repo.updateIngredients(id, (l) => l.map((x) => (x.id === ing.id ? { ...x, checked: !x.checked } : x)));
        return h('div', { role: 'checkbox', tabindex: '0', 'aria-checked': String(ing.checked), 'aria-label': shown, 'data-testid': `cook-ing:${ing.id}`, class: 'sp-line', style: 'cursor:pointer', onclick: toggle, onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } } },
          h('div', { style: `width:26px;height:26px;flex:none;border-radius:6px;border:2px solid var(--forest);background:${ing.checked ? 'var(--forest)' : 'transparent'};color:var(--cream);display:flex;align-items:center;justify-content:center;font-weight:700` }, ing.checked ? '✓' : ''),
          h('div', { style: ing.checked ? 'text-decoration:line-through;opacity:.7' : '' }, shown));
      }));
  }
  const drawIngredients = () => { if (!ui || !alive) return; const old = page.body.querySelector('[data-testid=cook-ingredients]'); if (old) old.replaceWith(ingredientsSection(ui)); };

  function render() {
    live.clock = live.label = null;
    if (missing) { mount(page.body, h('div', { class: 'sp-warn' }, h('strong', null, 'Nothing to cook yet. '), 'This recipe has no directions. Add some in the recipe, then Cook Mode can guide you step by step.')); return; }
    if (!ui) return;
    const u = ui, step = u.steps[Math.min(Math.max(u.index, 0), u.steps.length - 1)];
    page.setTitle(u.recipe.title.trim() || 'Cook Mode');
    let timerRow;
    if (T.timerConfigured(u.timer)) {
      live.label = h('span', { 'data-testid': 'timer-label', style: 'font-weight:700' });
      live.clock = h('span', { 'data-testid': 'clock-face', style: 'margin-left:14px;font-weight:700;font-size:30px;font-variant-numeric:tabular-nums' });
      timerRow = h('div', null, h('div', { class: 'row-line', style: 'gap:0;flex-wrap:wrap;align-items:center' },
        h('button', { type: 'button', 'data-testid': 'timer-button', style: 'min-height:48px;border:0;border-radius:14px;background:#CF4A27;color:#FFF4E0;padding:8px 20px;cursor:pointer;font-size:17px', onclick: pressTimer }, live.label), live.clock,
        h('button', { class: 'text-btn', type: 'button', 'data-testid': 'timer-change', style: 'color:var(--forest)', onclick: durationDialog }, 'Change')),
        u.timerStep !== u.index ? h('div', { style: 'color:var(--forest);font-weight:600' }, `(timer from step ${u.timerStep + 1})`) : null);
    } else timerRow = h('button', { class: 'text-btn', type: 'button', 'data-testid': 'timer-add', style: 'color:var(--forest);font-weight:600;padding:0', onclick: durationDialog }, '⏱ Add a timer');
    const progress = u.completed.size / u.steps.length;
    const last = u.index >= u.steps.length - 1;
    // the current step stays pinned at the top while the whole recipe scrolls underneath
    const card = h('div', { class: 'sp-line', style: 'position:sticky;top:0;z-index:3;flex-direction:column;background:var(--surface,#FBF4E6);box-shadow:0 4px 12px rgba(0,0,0,.12)', 'data-testid': 'cook-card', 'data-art-slot': 'cook_step' },
      h('div', { role: 'text', 'aria-label': `Step ${u.index + 1} of ${u.steps.length}`, style: 'font-weight:700;color:var(--forest)' }, `Step ${u.index + 1} of ${u.steps.length}`),
      h('div', { class: 'row-line', style: 'gap:0;align-items:center' }, h('div', { 'data-testid': 'step-number', style: 'font-family:var(--display);font-weight:700;font-size:48px;color:var(--tomato);line-height:1.1' }, String(u.index + 1)),
        u.completed.has(u.index) ? h('div', { 'data-testid': 'step-done', style: 'margin-left:8px;color:var(--forest);font-weight:700' }, '✓ done') : null),
      h('div', { 'data-testid': 'step-text', style: 'font-size:calc(24px * var(--ts));line-height:1.35' }, step.text), timerRow,
      h('div', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(progress * 100)), 'aria-label': `${u.completed.size} of ${u.steps.length} steps completed`, 'data-testid': 'cook-progress', style: 'height:8px;border-radius:4px;background:var(--cream-deep);overflow:hidden;width:100%' }, h('div', { style: `height:100%;width:${progress * 100}%;background:var(--tomato)` })),
      h('div', { class: 'sheet-row', style: 'width:100%' }, bigButton('Previous', () => vm.prev(), { primary: false, disabled: u.index === 0, testid: 'cook-prev' }), bigButton(last ? 'Finish cooking' : 'Next step', goNext, { testid: 'cook-next' })));
    for (const [k, fn] of [['prev', () => vm.prev()], ['next', goNext]]) { const b = card.querySelector(k === 'prev' ? '[data-testid=cook-prev]' : '[data-testid=cook-next]'); b.dataset.art = k; }
    // every step is listed so the whole method can be read by scrolling; tap one to jump to it
    let n = 0;
    const steps = h('section', { class: 'sp-sec', 'data-art-slot': 'cook_steps', 'data-testid': 'step-list' }, h('h2', { class: 'sp-h2' }, 'All steps'),
      ...ctx.repo.getRecipe(id).directions.map((d) => {
        if (d.header) return h('div', { role: 'heading', 'aria-level': '3', style: 'font-weight:700;color:var(--forest);padding-top:6px' }, d.text);
        const i = n++;
        return h('button', { type: 'button', class: `sp-line${i === u.index ? ' selected' : ''}`, style: 'text-align:left;width:100%;cursor:pointer', 'aria-current': i === u.index ? 'step' : null, 'data-testid': `jump:${i}`, onclick: () => vm.jump(i) },
          h('strong', { style: 'flex:none;min-width:2ch' }, `${i + 1}.`), h('span', null, d.text), u.completed.has(i) ? h('span', { 'aria-label': 'done', style: 'margin-left:auto;color:var(--forest)' }, '✓') : null);
      }));
    const keep = page.body.scrollTop;
    mount(page.body, card, ingredientsSection(u), steps);
    page.body.scrollTop = keep;
    tick();
  }

  function tick() {
    if (!ui) return;
    const now = clock(), u = ui, rem = T.remaining(u.timer, now);
    if (live.clock) {
      live.clock.textContent = T.formatMs(u.timer.endAtMs != null || u.timer.remainingMs > 0 ? rem : u.timer.totalMs);
      live.label.textContent = T.timerRunning(u.timer) ? 'Pause timer' : rem === 0 && u.timer.remainingMs === 0 ? 'Restart timer' : u.timer.remainingMs > 0 && u.timer.remainingMs < u.timer.totalMs ? 'Resume timer' : 'Start timer';
    }
    if (T.timerRunning(u.timer) && rem === 0 && !timeUpShown) {
      timeUpShown = true; vm.timerFinished(); notifier.cancel(id);
      if (ctx.prefs.timerVibrate) notifier.buzz();
      dialog({ title: "Time's up!", text: `The timer for step ${u.timerStep + 1} has finished.`, confirm: 'Reset timer', cancel: 'OK', onConfirm: () => { timeUpShown = false; vm.reset(); }, onCancel: () => { timeUpShown = false; } });
    }
  }

  (async () => {
    const r = ctx.repo.getRecipe(id);
    const steps = r ? r.directions.filter((d) => !d.header) : [];
    if (!r || !steps.length) { missing = true; render(); return; }
    const s = ctx.repo.cookSession(id);
    if (s && !s.finished) ui = { recipe: r, steps, index: Math.min(Math.max(s.stepIndex, 0), steps.length - 1), completed: new Set((s.completed || []).filter((i) => i < steps.length)), timer: s.timer, timerStep: s.timerStep, finished: false };
    else { ui = { recipe: r, steps, index: 0, completed: new Set(), timer: T.withDuration(steps[0].timerSeconds), timerStep: 0, finished: false }; persist(ui); }
    render();
    // a timer that ran out while the app was away shows as finished right away
    tick();
  })();
  ticker = setInterval(() => { if (alive) tick(); }, 250);
  stopAwake = ctx.prefs.keepAwake ? keepAwake(true) : null;
  const unRepo = ctx.repo.subscribe(() => { if (alive && art.el.isConnected && ui) drawIngredients(); });
  art.destroy = () => { alive = false; clearInterval(ticker); stopAwake && stopAwake(); unRepo(); };
  return art;
}
