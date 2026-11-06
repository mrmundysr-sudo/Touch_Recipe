// Port of ui/screens/CookScreen.kt: step-by-step Cook Mode with a wall-clock timer that survives leaving the screen.
import { h, mount } from '../ui/dom.js';
import { ArtPage, place, dp, sp } from '../ui/art.js';
import { Routes } from '../ui/nav.js';
import { dialog, photoImg } from '../ui/widgets.js';
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

  const art = ArtPage(ctx.art, 'cook', { title: 'Cook Mode', prefs: ctx.prefs, onTarget: (t) => {
    if (!ui) { if (t === 'back') nav.backOr(Routes.HUB); return; }
    switch (t) {
      case 'back': nav.backOr(Routes.DETAIL, { id }); break;
      case 'prev': vm.prev(); break;
      case 'next': if (vm.next()) dialog({ title: 'All steps done', text: 'Nice cooking! Finish this session, or stay and review the steps.', confirm: 'Finish', cancel: 'Keep reviewing', onConfirm: () => { vm.finish(); notifier.cancel(id); nav.backOr(Routes.DETAIL, { id }); } }); break;
    }
  } });
  const { content, page } = art;
  const dyn = h('div'); content.append(dyn);
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

  let ingScroll = 0;
  const ingBox = h('div');
  function drawIngredients() {
    if (!ui) return;
    const u = ui;
    const old = ingBox.querySelector('[data-testid=cook-ingredients]'); if (old) ingScroll = old.scrollTop;
    const ingredients = ctx.repo.recipe(id)?.ingredients ?? u.recipe.ingredients;
    const factor = Q.factor(u.recipe.servings, params.servings);
    const step = u.steps[Math.min(Math.max(u.index, 0), u.steps.length - 1)];
    const list = h('div', { class: 'scroll-y fade-bottom ia', 'data-testid': 'cook-ingredients', style: 'flex:1;min-height:0' },
      !ingredients.length ? h('div', { style: `padding-top:8px;font-size:${sp(24)};opacity:.7` }, 'This recipe has no ingredients listed.') : null,
      ingredients.map((ing) => {
        if (ing.header) return h('div', { role: 'heading', 'aria-level': '3', style: `padding-top:8px;font-weight:700;color:var(--forest);font-size:${sp(26)}` }, ing.text);
        const shown = Q.scale(ing.text, factor);
        const toggle = () => ctx.repo.updateIngredients(id, (l) => l.map((x) => (x.id === ing.id ? { ...x, checked: !x.checked } : x)));
        return h('div', { role: 'checkbox', tabindex: '0', 'aria-checked': String(ing.checked), 'aria-label': shown, 'data-testid': `cook-ing:${ing.id}`, class: 'row-line', style: 'min-height:48px;cursor:pointer',
          onclick: toggle, onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } } },
          h('div', { style: `width:26px;height:26px;flex:none;border-radius:6px;border:2px solid var(--forest);background:${ing.checked ? 'var(--forest)' : 'transparent'};color:var(--cream);display:flex;align-items:center;justify-content:center;font-weight:700` }, ing.checked ? '✓' : ''),
          h('div', { style: `font-size:${sp(25)};line-height:${sp(30)};${ing.checked ? 'text-decoration:line-through' : ''}` }, shown));
      }));
    mount(ingBox, h('div', { style: 'height:100%;display:flex;flex-direction:column' },
      h('div', { role: 'heading', 'aria-level': '2', style: `font-family:var(--display);font-weight:700;font-size:${sp(34)};color:var(--forest)` }, 'Ingredients'),
      step.image ? photoImg(ctx.photos, step.image, { alt: `Photo for step ${u.index + 1}`, cls: 'step-photo' }) : null, list));
    list.scrollTop = ingScroll;
  }

  function render() {
    mount(dyn);
    live.clock = live.label = null;
    if (missing) {
      const m = h('div', { style: 'display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:24px;color:var(--ink)' },
        h('div', { style: `font-family:var(--display);font-size:${sp(44)};font-weight:700` }, 'Nothing to cook yet'),
        h('div', { style: `font-size:${sp(26)}` }, 'This recipe has no directions. Add some in the recipe, then Cook Mode can guide you step by step.'));
      place(m, page.region('top')); dyn.append(m); return;
    }
    if (!ui) return;
    const u = ui, step = u.steps[Math.min(Math.max(u.index, 0), u.steps.length - 1)];
    art.stage.parentElement.setAttribute('aria-label', `Cook Mode: ${u.recipe.title}`);
    const chip = place(h('div', { role: 'text', 'aria-label': `Step ${u.index + 1} of ${u.steps.length}`, style: 'display:flex;align-items:center;justify-content:center;pointer-events:none' }), page.region('stepchip'));
    chip.append(h('div', { class: 'fit', style: `font-weight:700;font-size:${sp(26)};color:var(--ink);text-align:center` }, `Step ${u.index + 1} of ${u.steps.length}`));
    // the timer appears only when the step has one (or the cook adds one)
    let timerRow;
    if (T.timerConfigured(u.timer)) {
      live.label = h('span', { 'data-testid': 'timer-label', style: `font-family:var(--display);font-weight:600;font-size:${sp(30)}` });
      live.clock = h('span', { 'data-testid': 'clock-face', style: `margin-left:${dp(16)};font-weight:700;font-size:${sp(36)};font-variant-numeric:tabular-nums` });
      timerRow = h('div', null,
        h('div', { class: 'row-line', style: 'gap:0;flex-wrap:wrap' },
          h('button', { type: 'button', 'data-testid': 'timer-button', style: `min-height:48px;border:0;border-radius:${dp(18)};background:#CF4A27;color:#FFF4E0;padding:${dp(8)} ${dp(22)};cursor:pointer`, onclick: pressTimer }, live.label),
          live.clock,
          h('button', { class: 'text-btn', type: 'button', 'data-testid': 'timer-change', style: `color:var(--forest);font-size:${sp(22)}`, onclick: durationDialog }, 'Change')),
        u.timerStep !== u.index ? h('div', { style: `color:var(--forest);font-weight:600;font-size:${sp(22)}` }, `(timer from step ${u.timerStep + 1})`) : null);
    } else timerRow = h('button', { class: 'text-btn', type: 'button', 'data-testid': 'timer-add', style: `color:var(--forest);font-weight:600;font-size:${sp(24)};padding:0`, onclick: durationDialog }, '⏱ Add a timer');
    const progress = u.completed.size / u.steps.length;
    const top = place(h('div', { style: `padding:${dp(100)} ${dp(22)} ${dp(16)};display:flex;flex-direction:column;color:var(--ink);overflow:hidden` },
      h('div', { style: `font-weight:600;font-size:${sp(24)};color:var(--forest);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden` }, u.recipe.title.trim() || 'Recipe'),
      h('div', { class: 'row-line', style: 'gap:0' }, h('div', { 'data-testid': 'step-number', style: `font-family:var(--display);font-weight:700;font-size:${sp(80)};color:var(--tomato);line-height:1.1` }, String(u.index + 1)),
        u.completed.has(u.index) ? h('div', { 'data-testid': 'step-done', style: `margin-left:8px;color:var(--forest);font-weight:700;font-size:${sp(28)}` }, '✓ done') : null),
      h('div', { class: 'scroll-y ia', 'data-testid': 'step-text', style: `font-size:${sp(38)};line-height:${sp(50)};flex:0 1 auto;min-height:0` }, step.text),
      h('div', { style: `height:${dp(8)}` }), timerRow,
      h('div', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(progress * 100)), 'aria-label': `${u.completed.size} of ${u.steps.length} steps completed`, 'data-testid': 'cook-progress',
        style: `margin-top:${dp(6)};height:8px;border-radius:4px;background:var(--cream-deep);overflow:hidden;flex:none` }, h('div', { style: `height:100%;width:${progress * 100}%;background:var(--tomato)` }))), page.region('top'));
    const bottom = place(h('div', { style: `padding:${dp(10)} ${dp(18)};color:var(--ink);overflow:hidden` }, ingBox), page.region('bottom'));
    dyn.append(chip, top, bottom);
    drawIngredients(); tick();
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
