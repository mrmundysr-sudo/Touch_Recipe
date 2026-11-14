// Port of ui/screens/UtilityScreens.kt: the Junk Drawer pages (plain, accessible, follow the chosen theme).
import { h, mount } from '../ui/dom.js';
import { Routes } from '../ui/nav.js';
import { bigButton, chip, say, confirmDialog, dialog, textButton } from '../ui/widgets.js';
import { TextSize, ThemeMode } from '../data/prefs.js';
import { categoryCatalogContent } from './categoryparts.js';
import * as Planner from '../engine/planner.js';
import * as T from '../engine/timer.js';
import * as Conv from '../engine/convert.js';
import { DEFAULT_AISLES } from '../engine/grocery.js';
import { BackupManager, BackupException, saveFile } from '../data/backup.js';
import { notifier } from '../data/notify.js';
import { recipeText, shareText, pickFile } from '../ui/shared.js';
import { sendSheet, openSharedFileFromPicker } from './sharing.js';
import { aisleName } from './grocery.js';

function utilityPage(nav, title, build, { back = Routes.DRAWER } = {}) {
  const body = h('div', { class: 'plain-body', 'data-testid': `utility:${title}` });
  const el = h('div', { class: 'plain', role: 'region', 'aria-label': title },
    h('div', { class: 'plain-bar' }, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back', style: 'width:56px;height:56px;color:var(--on-bg)', onclick: () => nav.backOr(back) }, '←'), h('h1', { role: 'heading', 'aria-level': '1' }, title)), body);
  const s = { el, body, destroy() {} };
  build(body, s);
  return s;
}
const switchRow = (label, detail, value, onChange) => {
  const input = h('input', { class: 'switch', type: 'checkbox', role: 'switch', checked: value, 'aria-label': label, onchange: (e) => onChange(e.target.checked) });
  return h('label', { class: 'switch-row' }, h('div', { class: 'grow' }, h('div', { style: 'font-weight:600;font-size:calc(17px * var(--ts))' }, label), detail ? h('small', null, detail) : null), input);
};
const p = (t, cls = '') => h('p', { class: cls }, t);
const h2 = (t) => h('h2', { role: 'heading', 'aria-level': '2' }, t);

export function settingsScreen(params, ctx, nav) {
  return utilityPage(nav, 'Settings', (body) => {
    const pr = ctx.prefs;
    const draw = () => mount(body,
      h2('Text size'),
      h('div', { class: 'seg' }, Object.entries(TextSize).map(([k, t]) => chip(t.label, pr.textSize === k, () => { pr.setTextSize(k); }, { 'data-testid': `text-size:${k}` }))),
      p("Makes the words bigger on every page.", 'sheet-note'),
      switchRow('Highlight things to tap', 'A brief glow shows tappable objects the first times you open a page.', pr.glowGuide, (v) => pr.setGlowGuide(v)),
      bigButton('Replay first-time tips', () => { pr.resetGlow(); say('Tips will show again the next time you open each page.'); }, { primary: false }),
      switchRow('Reduce motion', 'Softens glows and removes page transitions. iOS “Reduce Motion” is always respected.', pr.motion === 'REDUCED', (v) => pr.setMotion(v ? 'REDUCED' : 'SYSTEM')),
      switchRow('Keep the screen on while cooking', null, pr.keepAwake, (v) => pr.setKeepAwake(v)),
      switchRow('Vibrate when a timer finishes', null, pr.timerVibrate, (v) => pr.setTimerVibrate(v)),
      switchRow('Week starts on Sunday', 'Affects the Meal Planner and Grocery List.', pr.sundayStart, (v) => { pr.setSundayStart(v); ctx.week.set(Planner.weekStart(ctx.week.value, v ? 0 : 1)); }),
      bigButton('Appearance and themes', () => nav.go(Routes.THEMES), { primary: false }),
      h('hr', { class: 'div' }), h2('Privacy'),
      p('Your recipes, photos, meal plans and lists are stored only on this phone. Touch Recipe has no account and no ads or analytics. The internet is used only when you import from a web link. Photos are read on the device (not uploaded). iOS may include app data in your iCloud device backup if you have it turned on; you can turn that off in iOS Settings.'),
      h('hr', { class: 'div' }), h2('Danger zone'),
      bigButton('Delete all my recipes and data', () => confirmDialog('Delete everything?', "This permanently removes all recipes, photos, meal plans, grocery lists and cooking progress from this phone. This can't be undone. Make a backup first if you might want them back.", 'Delete everything', async () => {
        await ctx.repo.wipeUserData(); pr.saveTimers([]); await ctx.backend.clearPhotos(); ctx.photos.urls.clear(); say('All data deleted.'); }, true), { primary: false, testid: 'wipe' }),
      h('hr', { class: 'div' }), h2('About'),
      p(`Touch Recipe ${ctx.appInfo?.version ?? '1.0.0'}${ctx.appInfo?.build ? ` (build ${ctx.appInfo.build})` : ''} — Mundy Morning Studios`),
      p('Open-source notices: Playfair Display and Source Sans 3 (SIL Open Font License 1.1), Capacitor (MIT). Text in photos and PDFs is recognised on the device with Apple’s Vision framework. Full font license texts are bundled with the app.', 'sheet-note'));
    draw();
    const un = pr.subscribe(() => { if (body.isConnected && !body.contains(document.activeElement)) draw(); else if (body.isConnected) setTimeout(draw, 0); });
    body.__un = un;
  });
}

export function categoriesScreen(params, ctx, nav) {
  return utilityPage(nav, 'Category Management', (body) => { mount(body, p('Pick which categories appear when you organise recipes, and add up to 50 of your own.'), categoryCatalogContent(ctx, null, null)); });
}

export function themesScreen(params, ctx, nav) {
  const opts = [
    ['SYSTEM', 'Match my phone', "Follows the phone's light or dark setting.", ['#F6EBD6', '#1F4D3A', '#C63D22', '#17211B']],
    ['LIGHT', 'Kitchen Light', 'Warm cream and forest green.', ['#F6EBD6', '#1F4D3A', '#C63D22', '#B58A3C']],
    ['DARK', 'Forest Night', 'Deep green with cream text, easier on the eyes in a dim kitchen.', ['#17211B', '#8FD1AE', '#FF8A65', '#E0B865']],
    ['GARDEN', 'Garden Sage', 'Fresh herb greens on a soft sage background.', ['#E8F1E2', '#2E6B3F', '#8A4B14', '#6B8E23']],
    ['HARVEST', 'Harvest Amber', 'Toasted amber and terracotta, like a baked crust.', ['#FBE9CF', '#9A3412', '#7A4A00', '#B45309']],
    ['BERRY', 'Berry Night', 'Dark plum with pink and apricot accents.', ['#241421', '#E6A8D7', '#FFB68A', '#D9C27A']],
  ];
  return utilityPage(nav, 'Themes', (body, s) => {
    const draw = () => mount(body, p('Themes restyle the menus, sheets, timer, tools and settings pages. The illustrated pages (kitchen, recipes, planner, grocery) are fixed artwork and keep their warm look in every theme.'),
      opts.map(([mode, title, detail, sw]) => { const sel = ctx.prefs.theme === mode;
        return h('button', { type: 'button', class: 'swatch' + (sel ? ' sel' : ''), role: 'radio', 'aria-checked': String(sel), 'data-testid': `theme:${mode}`, style: 'background:var(--surface);color:var(--on-surface);border:2px solid ' + (sel ? 'var(--primary)' : 'var(--outline)'), onclick: () => ctx.prefs.setTheme(mode) },
          h('span', { class: 'dots' }, sw.map((c) => h('i', { style: `background:${c}` }))), h('span', { style: 'flex:1' }, h('div', null, title), h('div', { style: 'font-weight:400;font-size:13px;opacity:.8' }, detail)), h('span', { style: 'font-size:14px' }, sel ? '✓ Selected' : '')); }));
    draw(); s.destroy = ctx.prefs.subscribe(() => { if (body.isConnected) draw(); });
  });
}

export function helpScreen(params, ctx, nav) {
  const items = [
    ['Bring a recipe in', 'Tap the “New Recipe” card on the fridge. Paste a web link, paste or type text, scan a printed recipe with the camera, or choose a PDF or photo. Every import is shown for review before it is saved. Tip: copy a link anywhere, then use “Paste from clipboard”.'],
    ['Fix what the import got wrong', 'On the review page, tap any field to edit it. Yellow ! marks show where the import was unsure. Add, remove and reorder ingredients and directions; tap “Ingredients” or “Directions” for a bigger editor. Removed a row by mistake? Tap Undo.'],
    ['Cook step by step', 'Open a recipe and tap Cook Mode, or tap the stove. Your place and timer are remembered if you leave.'],
    ['Plan the week', 'Tap the cat calendar. Tap a day to choose a recipe, then tap the grocery basket to build one combined shopping list.'],
    ['Shop', 'On the Grocery List tick items as you buy them. Tick state is kept. “Clear Checked” removes what you bought (with undo).'],
    ['Back up your recipes', 'Open the notebook in the junk drawer. Export a backup file, then keep it somewhere safe. Restore it on any phone with Touch Recipe.'],
    ["Sites that won't import", 'Some sites block automatic reading or hide recipes behind a login. Open the page in your browser, copy the recipe text, and use Paste or Type Recipe.'],
  ];
  return utilityPage(nav, 'Help', (body) => mount(body, items.map(([t, x]) => h('div', null, h2(t), p(x))), bigButton('Replay the glowing tips', () => { ctx.prefs.resetGlow(); say('Tips will show again.'); }, { primary: false })));
}

export function backupScreen(params, ctx, nav) {
  const mgr = new BackupManager({ repo: ctx.repo, photos: ctx.photos, prefs: ctx.prefs, appVersion: ctx.appInfo?.version ?? '1.0.0' });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return utilityPage(nav, 'Backup & Export', (body) => {
    const msg = h('p', { 'aria-live': 'polite', 'data-testid': 'backup-message', style: 'font-weight:600' });
    const buttons = [];
    const busy = (b) => { buttons.forEach((x) => { x.disabled = b; }); };
    const run = async (fn) => { busy(true); try { msg.textContent = await fn(); } catch (e) { msg.textContent = e instanceof BackupException ? e.message : "That didn't work. Please try again."; } busy(false); };
    const mk = (label, fn, primary, tid) => { const b = bigButton(label, fn, { primary, testid: tid }); buttons.push(b); return b; };
    async function doRestore(bytes, mode) { const s = await mgr.restore(bytes, mode); return `Restored ${s.recipes} recipes, ${s.meals} planned meals and ${s.groceries} grocery items.`; }
    mount(body,
      p('Your recipes live only on this phone. A backup file lets you move to a new phone or recover from loss. Files are saved where you choose and are never uploaded by Touch Recipe.'),
      mk('Back up everything', () => run(async () => { const r = await mgr.exportZip(); await saveFile(`touch-recipe-backup-${stamp}.zip`, r.bytes, 'application/zip'); return `Backup ready: ${r.recipes} recipes and their photos. Choose where to save it.`; }), true, 'backup-export'),
      mk('Export recipes as JSON', () => run(async () => { const r = mgr.exportRecipesJson(); await saveFile(`touch-recipe-recipes-${stamp}.json`, r.text, 'application/json'); return `Exported ${r.recipes} recipes (no photos).`; }), false),
      mk('Restore from a backup', async () => {
        const f = await pickFile({ accept: '.zip,.json,application/zip,application/json,application/octet-stream' }); if (!f) return;
        const bytes = new Uint8Array(await f.arrayBuffer());
        let dlg;
        dlg = dialog({ title: 'Restore this backup?', text: "Merge adds the backup's recipes to what you have now (newer versions win). Replace swaps your current recipes, plans and lists for the backup's.", confirm: 'Merge', cancel: 'Cancel', onConfirm: () => run(() => doRestore(bytes, 'MERGE')) });
        dlg && document.querySelector('.dialog-actions')?.prepend(h('button', { class: 'text-btn', type: 'button', onclick: () => { dlg.close(); confirmDialog('Replace everything?', 'Your current recipes, meal plans and grocery lists will be replaced by the backup. Consider making a backup of what you have first.', 'Replace', () => run(() => doRestore(bytes, 'REPLACE')), true); } }, 'Replace…'));
      }, false, 'backup-restore'),
      msg, h('hr', { class: 'div' }), h('h2', null, 'Backup format'),
      p("A backup is a ZIP file holding data.json (recipes, categories, meal plan, grocery lists, preferences) and a photos folder. The format is documented in the project's docs/BACKUP_FORMAT.md, so your data is never locked in. Backups made on Android restore here, and the other way round.", 'sheet-note'));
  });
}

export function toolsScreen(params, ctx, nav) {
  const st = (params.__vm ||= { tab: 0, kind: Conv.Kind.VOLUME, amount: '1', from: 'cup', to: 'ml', name: '', mins: '' });
  return utilityPage(nav, 'Timer & Tools', (body, s) => {
    const tabs = h('div', { class: 'seg' }); const panel = h('div');
    let stopTimer = null;
    const drawTabs = () => mount(tabs, ['Timer', 'Convert', 'Measures'].map((t, i) => chip(t, st.tab === i, () => { st.tab = i; draw(); })));
    function draw() { stopTimer && stopTimer(); stopTimer = null; drawTabs(); mount(panel); if (st.tab === 0) stopTimer = timerPanel(panel); else if (st.tab === 1) converterPanel(panel); else measuresPanel(panel); }
    function timerPanel(root) {
      const clock = () => Date.now();
      const name = h('input', { class: 'field', type: 'text', 'data-testid': 'timer-name', 'aria-label': 'Name (optional)', placeholder: 'Name (optional, e.g. Biscuits)', value: st.name, maxlength: '40', autocapitalize: 'sentences', oninput: (e) => { st.name = e.target.value; } });
      const mins = h('input', { class: 'field', type: 'text', inputmode: 'numeric', 'data-testid': 'timer-mins', 'aria-label': 'Custom minutes', placeholder: 'Custom minutes', value: st.mins, style: 'flex:1', oninput: (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 3); st.mins = e.target.value; } });
      const list = h('div', { style: 'display:flex;flex-direction:column;gap:12px' });
      const times = new Map();
      const save = (l) => ctx.prefs.saveTimers(l);
      const sched = (t) => { if (t.endAtMs != null) notifier.schedule('kt-' + t.id, `${t.name} is done`, t.endAtMs); };
      async function add(minutes) {
        const before = ctx.prefs.timers; const l = T.addTimer(before, st.name, minutes, clock());
        if (l.length === before.length) return;
        if (!ctx.prefs.notifAsked && (await notifier.shouldExplain())) { ctx.prefs.notifAsked = true; await notifier.request(); }
        save(l); sched(l[l.length - 1]); st.name = ''; st.mins = ''; name.value = ''; mins.value = '';
      }
      const rename = (t) => { const v = h('input', { class: 'field', type: 'text', value: t.name, maxlength: '40', 'data-testid': 'timer-rename', 'aria-label': 'Timer name' }); dialog({ title: 'Rename timer', content: v, confirm: 'Save', onConfirm: () => { if (v.value.trim()) save(ctx.prefs.timers.map((x) => (x.id === t.id ? { ...x, name: v.value.trim() } : x))); } }); };
      function drawList() {
        const timers = ctx.prefs.timers; times.clear();
        mount(list, !timers.length ? p('No timers yet. Pick a time above to start one.') : timers.map((t) => {
          const clk = T.namedTimerClock(t); const done = T.timerConfigured(clk) && !T.timerRunning(clk) && t.remainingMs === 0;
          const time = h('div', { style: `font-family:var(--body);font-weight:700;font-size:calc(44px * var(--ts) / 1.2);text-align:center;font-variant-numeric:tabular-nums;${done ? 'color:var(--secondary)' : ''}`, 'data-testid': `timer-time:${t.id}` }); times.set(t.id, [t, time]);
          return h('div', { class: 'card', 'data-testid': `timer:${t.id}`, style: 'background:var(--surface-var)' },
            h('div', { class: 'row-line' }, h('div', { style: 'flex:1;font-weight:700;font-size:calc(17px * var(--ts))' }, t.name), textButton('Rename', () => rename(t))), time,
            h('div', { class: 'sheet-row' },
              bigButton(clk.endAtMs != null ? 'Pause' : 'Start', () => { if (clk.endAtMs != null) { save(timers.map((x) => (x.id === t.id ? T.withClock(x, T.pause(clk, clock())) : x))); notifier.cancel('kt-' + t.id); } else { const s2 = T.start(clk, clock()); save(timers.map((x) => (x.id === t.id ? T.withClock(x, s2) : x))); sched({ ...t, endAtMs: s2.endAtMs }); } }),
              bigButton('Reset', () => { save(timers.map((x) => (x.id === t.id ? T.withClock(x, T.reset(clk)) : x))); notifier.cancel('kt-' + t.id); }, { primary: false }),
              bigButton('Delete', () => { save(timers.filter((x) => x.id !== t.id)); notifier.cancel('kt-' + t.id); }, { primary: false })));
        }));
        tick();
      }
      function tick() {
        const now = clock();
        const [settled, finished] = T.settle(ctx.prefs.timers, now);
        if (finished.length) { finished.forEach((f) => notifier.cancel('kt-' + f.id)); ctx.prefs.saveTimers(settled); return; }
        times.forEach(([t, el]) => { const clk = T.namedTimerClock(t); const done = T.timerConfigured(clk) && !T.timerRunning(clk) && t.remainingMs === 0; el.textContent = done ? "Time's up!" : T.formatMs(T.remaining(clk, now)); el.setAttribute('aria-label', done ? `${t.name}: time's up` : `${t.name}: ${T.formatMs(T.remaining(clk, now))} left`); });
      }
      mount(root, h('div', { 'data-testid': 'tool-timer', style: 'display:flex;flex-direction:column;gap:12px' },
        p('Start as many timers as you need. They keep running when you leave this page or close the app, and you will be notified when each one finishes.'), name,
        h('div', { class: 'chips' }, [1, 5, 10, 15, 20, 30, 45, 60].map((m) => bigButton(`${m} min`, () => add(m), { primary: false, cls: 'compact' }))),
        h('div', { class: 'row-line' }, mins, bigButton('Start', () => { const m = parseInt(mins.value, 10); if (m > 0) add(m); }, { primary: false })),
        ctx.prefs.timers.length >= T.MAX_TIMERS ? p(`That's the most timers at once (${T.MAX_TIMERS}). Delete one to add another.`, 'sheet-note') : null, h('hr', { class: 'div' }), list));
      drawList();
      const un = ctx.prefs.subscribe(() => { if (root.isConnected) drawList(); });
      const iv = setInterval(() => { if (root.isConnected) tick(); }, 250);
      return () => { un(); clearInterval(iv); };
    }
    function converterPanel(root) {
      const units = () => Conv.unitsFor(st.kind);
      if (!units().includes(st.from)) st.from = units()[0]; if (!units().includes(st.to)) st.to = units()[1] ?? units()[0];
      const result = h('div', { 'aria-live': 'polite', 'data-testid': 'convert-result', style: 'font-family:var(--display);font-size:calc(22px * var(--ts));font-weight:600;margin-top:10px' });
      const amount = h('input', { class: 'field', type: 'text', inputmode: 'decimal', 'data-testid': 'convert-amount', 'aria-label': 'Amount', value: st.amount, oninput: (e) => { e.target.value = e.target.value.replace(/[^\d.\-]/g, '').slice(0, 8); st.amount = e.target.value; upd(); } });
      const kinds = h('div', { class: 'seg' }), from = h('div', { class: 'chips' }), to = h('div', { class: 'chips' });
      const upd = () => { const v = parseFloat(st.amount); result.textContent = Number.isNaN(v) ? 'Enter a number to convert.' : `${st.amount} ${st.from} = ${Conv.format(st.kind, Conv.convert(st.kind, v, st.from, st.to), st.to)}`; };
      const drawChips = () => { mount(kinds, Object.values(Conv.Kind).map((k) => chip(k, st.kind === k, () => { st.kind = k; if (!units().includes(st.from)) st.from = units()[0]; if (!units().includes(st.to)) st.to = units()[1] ?? units()[0]; drawChips(); upd(); })));
        mount(from, units().map((u) => chip(u, st.from === u, () => { st.from = u; drawChips(); upd(); }))); mount(to, units().map((u) => chip(u, st.to === u, () => { st.to = u; drawChips(); upd(); }))); };
      drawChips(); upd();
      mount(root, kinds, h('label', { class: 'lbl' }, 'Amount'), amount, h('h3', null, 'From'), from, h('h3', null, 'To'), to, result);
    }
    function measuresPanel(root) {
      mount(root, h('h2', null, 'Kitchen equivalents'), Conv.equivalents.map((e) => p('• ' + e)), h('h2', null, 'Oven temperatures'), Conv.ovenTemps.map((e) => p('• ' + e)), p('Flour and sugar weights are approximate; weighing is more accurate than measuring by volume.', 'sheet-note'));
    }
    mount(body, tabs, panel); draw();
    s.destroy = () => { stopTimer && stopTimer(); };
  });
}

export function printScreen(params, ctx, nav) {
  return utilityPage(nav, 'Print & Share', (body, s) => {
    const week = () => ctx.week.value;
    const planText = () => { const meals = new Map(ctx.repo.mealsFor(week(), Planner.addDays(week(), 6)).map((m) => [m.date, m]));
      return [`Meal plan: ${Planner.rangeLabel(week())}`, ...Planner.days(week()).map((d) => { const m = meals.get(d), r = m ? ctx.repo.recipe(m.recipeId) : null; return `${Planner.dayLabel(d)} ${Planner.dateLabel(d)}: ${r?.title ?? '—'}${m?.servings ? ` (${m.servings} servings)` : ''}`; })].join('\n'); };
    const groceryText = () => { const items = ctx.repo.groceryItems(week()); const out = [`Grocery list: ${Planner.rangeLabel(week())}`];
      [...DEFAULT_AISLES, ...new Set(items.map((i) => i.aisle).filter((a) => !DEFAULT_AISLES.includes(a)))].forEach((a) => { const l = items.filter((i) => i.aisle === a); if (l.length) { out.push('', aisleName(a)); l.forEach((i) => out.push((i.checked ? '[x] ' : '[ ] ') + i.name + (i.quantityText ? ` — ${i.quantityText}` : ''))); } });
      return out.join('\n'); };
    const draw = () => {
      const recipes = ctx.repo.recipes().sort((a, b) => (a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1));
      mount(body, p('Share as text with any app. In the share sheet, choose Print to print it or Save to Files for a PDF.'), h2('Meal plan and grocery list'), p(Planner.rangeLabel(week())),
        h('div', { class: 'sheet-row' }, bigButton('Share meal plan', () => shareText('Meal plan', planText()), { primary: false }), bigButton('Print meal plan', () => shareText('Meal plan', planText()), { primary: false })),
        h('div', { class: 'sheet-row', style: 'margin-top:8px' }, bigButton('Share grocery list', () => shareText('Grocery list', groceryText()), { primary: false }), bigButton('Print grocery list', () => shareText('Grocery list', groceryText()), { primary: false })),
        h('hr', { class: 'div' }), h2('To another Touch Recipe user'), p('Send recipes exactly as they are, with photos, to a friend who also has Touch Recipe. They choose what to add.'),
        h('div', { class: 'sheet-row' }, bigButton('Send recipes…', () => sendSheet(ctx), { primary: false, testid: 'send-recipes' }), bigButton('Open a shared recipe file', () => openSharedFileFromPicker(ctx), { primary: false, testid: 'open-shared' })),
        h('hr', { class: 'div' }), h2('A recipe'), !recipes.length ? p('Save a recipe first, then you can share or print it here.') : null,
        recipes.map((r) => h('div', { class: 'row-line', style: 'min-height:56px' }, h('div', { style: 'flex:1;font-weight:600' }, r.title.trim() || 'Untitled recipe'), textButton('Share', () => shareText(r.title, recipeText(r, null))), textButton('Print', () => shareText(r.title, recipeText(r, null))))));
    };
    draw(); s.destroy = ctx.repo.subscribe(() => { if (body.isConnected && !body.contains(document.activeElement)) draw(); });
  });
}
