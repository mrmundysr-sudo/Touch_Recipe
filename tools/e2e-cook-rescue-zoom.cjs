// Developer-only browser regression for: Cook Mode areas never overlap, Recipe Rescue's last row clears the fixed Create button,
// and the Rescue zoom / pan controls keep independent view state for Original and Recipe.  node tools/e2e-cook-rescue-zoom.cjs [outdir]
const { chromium } = require('playwright');
const assert = require('assert');
const SIZES = [[390, 844], [375, 667], [320, 568]];
(async () => {
  const outDir = process.argv[2] || null; const fails = [];
  const { serve } = await import('./serve.mjs'); const srv = await serve(0); const port = srv.address().port;
  const browser = await chromium.launch(); const ok = (m) => console.log('ok  -', m);
  const check = (cond, msg) => { if (cond) ok(msg); else { fails.push(msg); console.log('FAIL-', msg); } };
  const open = async (w, h) => {
    const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }); const page = await c.newPage(); const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { window.Capacitor = { isNativePlatform: () => false, isPluginAvailable: () => false, Plugins: {} }; });
    await page.goto(`http://localhost:${port}/`); await page.waitForFunction(() => window.__app, null, { timeout: 15000 });
    await page.evaluate(() => { window.__app.ctx.prefs.welcomeSeen = true; }); await page.waitForTimeout(1800); return { page, errors, c };
  };
  const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }, sel);
  const overlap = (a, b) => a && b && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;

  // ---------- Cook Mode ----------
  for (const [w, h] of SIZES) {
    const { page, errors } = await open(w, h);
    const id = await page.evaluate(async () => {
      const { ctx, nav } = window.__app; const m = await import('/js/engine/models.js');
      const ing = ['1 (29 oz) can Veg-All mixed vegetables, drained', '2 refrigerated pie crusts', '1/3 cup all-purpose flour', '1/3 cup butter', '1 1/2 cups chicken broth', '2 cups cooked chicken, cubed', '1 teaspoon salt', '1/2 teaspoon black pepper', '1 medium onion, chopped', '2 tablespoons milk'];
      const r = m.Recipe({ id: 'cook1', title: 'Veg-All Chicken Pot Pie', servings: 6, prepMinutes: 15, cookMinutes: 40, totalMinutes: 55, ingredients: ing.map((t) => m.Ingredient({ text: t })),
        directions: ['Preheat the oven to 425 degrees F. Place one pie crust in a 9 inch pie plate and set the second crust aside for the top of the pie.', 'In a saucepan over medium heat, cook the onion in the butter until soft, then stir in the flour, salt and pepper. Slowly whisk in the broth and milk and cook until thickened and bubbly, about 10 minutes.', 'Stir in the chicken and the drained Veg-All, then pour the filling into the crust, cover with the top crust, seal and trim the edges, and cut a few slits in the top.', 'Bake for 30 to 35 minutes until golden brown. Let it stand for 10 minutes before serving.'].map((t, i) => m.Direction({ text: t, timerSeconds: i === 1 ? 600 : null })) });
      await ctx.repo.saveRecipe(r); nav.go('cook', { id: 'cook1' }); return 'cook1';
    });
    await page.waitForTimeout(900);
    const tag = `${w}x${h}`;
    const body = await rect(page, '[data-testid=cook-body]'), card = await rect(page, '[data-testid=cook-card]'), list = (await rect(page, '[data-testid=cook-list]')) || (await rect(page, '[data-testid=cook-ingredients]')), navBar = (await rect(page, '[data-testid=cook-nav]')) || (await rect(page, '[data-testid=cook-next]'));
    check(!overlap(card, list) && !overlap(card, navBar) && !overlap(list, navBar), `Cook Mode ${tag}: step card, recipe list and Previous/Next are three separate areas`);
    // every child of the card sits inside the card, and none of them is covered by the next
    const inside = await page.evaluate(() => { const c = document.querySelector('[data-testid=cook-card]'); const cr = c.getBoundingClientRect(); const kids = [...c.children].map((k) => k.getBoundingClientRect()); const stacked = kids.every((k, i) => i === 0 || k.top >= kids[i - 1].bottom - 0.5); return { scrolls: c.scrollHeight > c.clientHeight + 1, stacked, within: kids.every((k) => k.left >= cr.left - 1 && k.right <= cr.right + 1) }; });
    check(inside.stacked && inside.within, `Cook Mode ${tag}: step number, instruction, timer and progress stack without overlapping`);
    const hdr = await rect(page, '[data-testid=cook-ingredients] h2'), firstIng = await rect(page, '[data-testid^="cook-ing:"]');
    check(!overlap(card, hdr) && !overlap(card, firstIng) && hdr.b <= firstIng.t + 1, `Cook Mode ${tag}: nothing from the Ingredients list shows through the step area`);
    const prev = await rect(page, '[data-testid=cook-prev]'), next = await rect(page, '[data-testid=cook-next]'), vp = await page.evaluate(() => window.innerHeight);
    check(next && next.b <= vp && next.t >= 0 && prev.b <= vp && next.r <= w + 0.5, `Cook Mode ${tag}: Previous / Next stay on screen`);
    check(card.b <= (list ? list.t : 1e9) + 1 && (list.b - list.t) >= 90, `Cook Mode ${tag}: the recipe list keeps a usable scrolling area (${Math.round(list.b - list.t)}px)`);
    // scroll the list to the end: the last step is reachable and still above the nav bar
    await page.evaluate(() => { const l = document.querySelector('[data-testid=cook-list]') || document.querySelector('[data-testid=cook-body]'); l.scrollTop = l.scrollHeight; });
    const lastStep = await rect(page, '[data-testid="jump:3"]'), navAfter = (await rect(page, '[data-testid=cook-nav]')) || (await rect(page, '[data-testid=cook-next]'));
    check(lastStep.b <= navAfter.t + 1, `Cook Mode ${tag}: the last step can be scrolled above the Previous/Next bar`);
    if (outDir) await page.screenshot({ path: `${outDir}/cook-${tag}.png` });
    check(errors.length === 0, `Cook Mode ${tag}: no page errors ${errors.join('; ')}`);
    await page.context().close();
  }

  // ---------- Review & Save: nothing clipped, ingredients and steps classified correctly ----------
  {
    const { page, errors } = await open(390, 844);
    const res = await page.evaluate(async () => {
      const { ctx, nav } = window.__app;
      const ing = ['1 pound Ground Beef (93% lean or leaner)', '4 medium red, yellow or green bell peppers', '1/2 cup minced onion', '2 teaspoons minced garlic', '1 can (14-1/2 ounces) diced tomatoes with green peppers and onions, drained'];
      const text = ['Classic Beef-Stuffed Peppers With Rice And Tomatoes For A Weeknight Family Dinner', 'Ingredients:', ...ing.map((l) => `• ${l}`), 'Cooking:', '1. Preheat the oven to 475°F and grease a baking dish.', '2. Brown the beef with the onion and garlic for 4 minutes, then stir in the tomatoes.'].join('\n');
      const d = await ctx.importer.import({ type: 'text', text, sourceUrl: 'https://www.example-beef-council.org/recipes/recipe/55603/classic-beef-stuffed-peppers-with-rice' });
      ctx.importSession.draft = d; nav.go('review', {});
      return { ing: d.recipe.ingredients.length, dir: d.recipe.directions.length };
    });
    check(res.ing === 5 && res.dir === 2, `Review: 5 ingredients and 2 steps imported (${JSON.stringify(res)})`);
    await page.waitForTimeout(1500);
    await page.locator('[data-testid=source-field]').fill('https://www.example-beef-council.org/recipes/recipe/55603/classic-beef-stuffed-peppers-with-rice-and-tomatoes'); await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const clip = (e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1;
      const t = document.querySelector('[data-testid=title-field]'), s = document.querySelector('[data-testid=source-field]');
      return { title: t && clip(t), source: s && clip(s), rows: [...document.querySelectorAll('[data-testid="ing-rows"] .row-input')].map((e) => clip(e)), n: document.querySelectorAll('[data-testid="ing-rows"] .row-input').length, dirs: document.querySelectorAll('[data-testid="dir-rows"] .row-input').length };
    });
    check(m.title === false && m.source === false, `Review: the long title and source are fully visible (${JSON.stringify({ t: m.title, s: m.source })})`);
    check(m.n === 5 && m.dirs === 2 && m.rows.every((c) => !c), `Review: ${m.n} ingredient rows and ${m.dirs} steps, none cut off`);
    if (outDir) await page.screenshot({ path: `${outDir}/review-390.png` });
    check(errors.length === 0, `Review: no page errors ${errors.join('; ')}`);
    await page.context().close();
  }

  // ---------- Grocery list: amounts stay with their names, long names are not clipped ----------
  {
    const { page, errors } = await open(390, 844);
    const got = await page.evaluate(async () => {
      const { ctx, nav } = window.__app; const m = await import('/js/engine/models.js'); const P = await import('/js/engine/planner.js');
      const week = P.weekStart(P.today(), ctx.prefs.sundayStart ? 0 : 1);
      const r = m.Recipe({ id: 'g1', title: 'Veg-All Chicken Pot Pie', servings: 6, ingredients: ['29oz can of Veg-All mixed vegetables', '1/3 cup all-purpose flour', '5 1/3 tbsp butter', '2 cups cooked chicken breast, cut into bite size pieces and seasoned generously with salt'].map((t) => m.Ingredient({ text: t })), directions: [m.Direction({ text: 'Bake.' })] });
      await ctx.repo.saveRecipe(r); await ctx.repo.addIngredientsToGroceries(week, r, 6, null);
      await ctx.repo.addGroceryItem(week, 'Extra long grocery item name that would not fit on one line of the narrow list', '2 large family size packages', 'pantry');
      ctx.week.set(week); nav.go('grocery', {}); return ctx.repo.groceryItems(week).map((i) => [i.name, i.quantityText]);
    });
    check(got.some(([n, q]) => /^Veg-All/.test(n) && q === '1 can') && got.some(([n, q]) => /flour/i.test(n) && q === '1/3 cup') && got.some(([n, q]) => /^Butter/.test(n) && q === '1/3 cup'),
      `Grocery: amounts stay paired with their names (${JSON.stringify(got.slice(0, 3))})`);
    await page.waitForTimeout(1200);
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="grocery-name:"]')].map((n) => { const q = document.querySelector(`[data-testid="${n.dataset.testid.replace('name', 'qty')}"]`); const row = n.closest('[data-testid^="grocery-row:"]'); const rr = row.getBoundingClientRect(); const list = document.querySelector('[data-testid=grocery-list]').getBoundingClientRect();
      return { name: n.value, clipped: n.scrollHeight > n.clientHeight + 1 || q.scrollHeight > q.clientHeight + 1, inside: rr.right <= list.right + 1 && rr.left >= list.left - 1 }; }));
    check(rows.length >= 5 && rows.every((r) => !r.clipped && r.inside), `Grocery: ${rows.length} rows, long names and amounts wrap instead of clipping`);
    check(errors.length === 0, `Grocery: no page errors ${errors.join('; ')}`);
    await page.context().close();
  }

  // ---------- Recipe Rescue: bottom inset and zoom / pan ----------
  for (const [w, h] of SIZES) {
    const { page, errors } = await open(w, h); const tag = `${w}x${h}`;
    await page.evaluate(async () => {
      const { ctx, nav } = window.__app;
      const ing = Array.from({ length: 14 }, (_, i) => `${i + 1} cup ingredient number ${i + 1} with a long descriptive name`);
      const text = ['Big Pot Pie', 'Serves 6', 'Ingredients', ...ing, 'Method', 'Mix the dry things together.', 'Add milk and whisk until smooth.', 'Bake until golden.'].join('\n');
      const d = await ctx.importer.import({ type: 'text', text }); ctx.importSession.draft = d; nav.go('rescue', {});
    });
    await page.waitForTimeout(1200);
    // everything on the form can be scrolled clear of the fixed Create button: the last control, and the last ingredient row, which can be edited there
    const create = await rect(page, '[data-testid=rescue-create]');
    await page.evaluate(() => { const p = document.querySelector('[data-testid=pane-recipe]'); p.scrollTop = p.scrollHeight; });
    const endBox = await page.evaluate(() => { const z = document.querySelector('[data-testid=pane-recipe] .rr-zoom'); const k = [...z.children].filter((e) => e.offsetHeight).pop(); const r = k.getBoundingClientRect(); return { b: r.bottom }; });
    check(endBox.b <= create.t - 4, `Rescue ${tag}: the last item on the form (${Math.round(endBox.b)}) ends above the Create recipe button (${Math.round(create.t)})`);
    const rows = await page.locator('[data-testid="ing-text"]').count();
    await page.locator('[data-testid="ing-text"]').last().evaluate((e) => e.scrollIntoView({ block: 'end' }));
    const lastRow = await page.locator('[data-testid="ing-row"]').last().evaluate((e) => { const r = e.getBoundingClientRect(); return { b: r.bottom, t: r.top }; });
    check(rows >= 14 && lastRow.b <= create.t - 4 && lastRow.t >= 0, `Rescue ${tag}: the last of ${rows} ingredient rows can be brought fully above the Create button`);
    await page.locator('[data-testid=rr-title]').fill('Eppic Recipes - Creamy & Delicious Crockpot Swedish Meatballs With Egg Noodles And Gravy'); await page.locator('[data-testid=rr-title]').blur(); await page.waitForTimeout(200);
    const tclip = await page.locator('[data-testid=rr-title]').evaluate((e) => ({ clipped: e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1, lines: Math.round(e.clientHeight / parseFloat(getComputedStyle(e).lineHeight || 20)) }));
    check(!tclip.clipped, `Rescue ${tag}: a long title wraps and is not clipped (${JSON.stringify(tclip)})`);
    const lastTa = page.locator('[data-testid="ing-text"]').last(); await lastTa.click(); await page.keyboard.press('End'); await page.keyboard.type(' X');
    const lv = await lastTa.inputValue(); check(lv.endsWith(' X'), `Rescue ${tag}: the last ingredient row can be tapped and edited (${JSON.stringify(lv.slice(-20))})`);
    await page.evaluate(() => document.activeElement.blur());

    if (w !== 390) { await page.context().close(); continue; }
    // ---- zoom and pan (narrow phone: one side at a time) ----
    const tid = (i) => page.locator(`[data-testid="${i}"]`);
    // one finger: slide(side, dy) = one finger sliding vertically in 8 events from the pane centre; drag = a diagonal drag
    const finger = (side, dx, dy) => page.evaluate(({ side, dx, dy }) => {
      const o = document.querySelector(`[data-testid=gesture-${side}]`); if (!o || o.hidden) return false; const r = o.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const ev = (type, px, py) => o.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: px, clientY: py, bubbles: true, cancelable: true, isPrimary: true }));
      ev('pointerdown', x, y); for (let i = 1; i <= 8; i++) ev('pointermove', x + dx * i / 8, y + dy * i / 8); ev('pointerup', x + dx, y + dy); return true;
    }, { side, dx, dy });
    const scaleOf = async (side) => { const t = await page.evaluate((s) => document.querySelector(`[data-testid=pane-${s}] .rr-zoom`)?.style.transform || '', side); const m = /scale\(([\d.]+)\)/.exec(t); return m ? parseFloat(m[1]) : 1; };
    const state = (side) => page.evaluate((s) => { const z = document.querySelector(`[data-testid=pane-${s}] .rr-zoom`); return z ? z.style.transform : null; }, side);
    const pressed = async (id) => (await tid(id).getAttribute('aria-pressed')) === 'true';

    check(await tid('select-btn').count() === 1 && await tid('pan-btn').count() === 1 && await tid('zoom-btn').count() === 1, 'Rescue: Select text, Pan and Zoom buttons exist');
    const zb = await rect(page, '[data-testid=zoom-btn]'); check(zb.b - zb.t >= 54, 'mode buttons are at least 56 tall (large targets)');
    await tid('tab-original').click(); await page.waitForTimeout(150);
    check(await pressed('select-btn') && await page.locator('[data-testid=gesture-original]').isHidden(), 'the default is Select text: nothing sits over the text, so it can be selected and copied');
    check(/SELECT/.test(await tid('zoom-status').innerText()), 'the status says in words what one finger does (select)');
    // selection works: select the original text and copy it
    const sel = await page.evaluate(() => { const el = document.querySelector('[data-testid=orig-text]'); if (!el) return null; const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return { text: s.toString().slice(0, 30), us: getComputedStyle(el).userSelect }; });
    check(sel && sel.us === 'text' && sel.text.length > 5, `the original text is selectable (${JSON.stringify(sel)})`);
    check(await tid('copy-all').count() === 1, 'a "Copy all the text" button is offered');
    // ZOOM mode
    await tid('zoom-btn').click(); await page.waitForTimeout(100);
    check(await pressed('zoom-btn') && !(await pressed('select-btn')) && /ZOOM: slide one finger up/.test(await tid('zoom-status').innerText()), 'Zoom mode is selected (one at a time) and explained in words');
    check(await page.locator('.rr-wrap.rr-active').count() >= 1, 'the active pane is highlighted');
    await finger('original', 0, -80); await page.waitForTimeout(100);
    const z1 = await scaleOf('original'); check(Math.abs(z1 - 2 ** (80 / 160)) < 0.05, `one finger sliding up 80px zooms in by 2^(80/160) (${z1.toFixed(3)})`);
    await finger('original', 0, 80); await page.waitForTimeout(100);
    const z2 = await scaleOf('original'); check(Math.abs(z2 - 1) < 0.02, `sliding back down returns to the start (${z2.toFixed(3)})`);
    await finger('original', 0, -160); await page.waitForTimeout(100); const z3 = await scaleOf('original'); check(Math.abs(z3 - 2) < 0.08, `160px up is one doubling (${z3.toFixed(3)})`);
    const posBefore = await state('original'); await finger('original', 90, 0); await page.waitForTimeout(100);
    check(await state('original') === posBefore, 'sideways movement is ignored in Zoom mode');
    await tid('zoom-btn').click(); // still zoom; tap-only touch must change nothing
    const tapBefore = await state('original');
    await page.evaluate(() => { const o = document.querySelector('[data-testid=gesture-original]'); const r = o.getBoundingClientRect(); const ev = (t, y) => o.dispatchEvent(new PointerEvent(t, { pointerId: 9, clientX: r.left + 50, clientY: r.top + y, bubbles: true, cancelable: true })); ev('pointerdown', 50); ev('pointermove', 54); ev('pointerup', 54); });
    check(await state('original') === tapBefore, 'a tap changes nothing');
    // the other side is untouched (switch to Recipe, zoom it on its own)
    await tid('tab-recipe').click(); await page.waitForTimeout(250);
    check(await state('recipe') === '', 'the Recipe is still at fit while the Original is zoomed');
    await finger('recipe', 0, -240); await page.waitForTimeout(100);
    const zr = await scaleOf('recipe'); check(zr > 2.7 && zr <= 3, `Recipe zooms on its own with one finger (${zr.toFixed(2)})`);
    const before = await tid('rr-title').inputValue(); const tb = await rect(page, '[data-testid=gesture-recipe]');
    await page.mouse.click(tb.l + 40, tb.t + 40); await page.keyboard.type('zzz');
    check((await tid('rr-title').inputValue()) === before && !(await page.evaluate(() => /INPUT|TEXTAREA/.test(document.activeElement?.tagName || ''))), 'taps in Zoom/Pan mode do not edit or focus text');
    // PAN mode
    await tid('pan-btn').click(); await page.waitForTimeout(100);
    check(await pressed('pan-btn') && !(await pressed('zoom-btn')) && /PAN: drag one finger/.test(await tid('zoom-status').innerText()), 'Pan mode is selected and explained in words');
    const recBefore = await state('recipe'); await finger('recipe', -30, -200); await page.waitForTimeout(100); const recAfter = await state('recipe');
    check(recAfter !== recBefore && Math.abs((await scaleOf('recipe')) - zr) < 1e-6, `one-finger drag pans the Recipe and never changes its zoom (${recAfter})`);
    await tid('tab-original').click(); await page.waitForTimeout(250);
    const afterPan0 = await state('original'); await finger('original', -60, -80); await page.waitForTimeout(100);
    const afterPan = await state('original'); check(afterPan !== afterPan0 && /translate\(-?\d/.test(afterPan) && Math.abs((await scaleOf('original')) - z3) < 1e-6, `one-finger drag pans the Original (${afterPan0} -> ${afterPan})`);
    await tid('tab-recipe').click(); await page.waitForTimeout(200);
    check(await state('recipe') === recAfter, 'switching back to Recipe keeps its zoom and position');
    // back to Select text: the overlay goes away and fields work again
    await tid('select-btn').click(); await page.waitForTimeout(150);
    check(await page.locator('[data-testid=gesture-recipe]').isHidden() && await pressed('select-btn'), 'Select text removes the gesture layer');
    // reset per pane
    await tid('fit-recipe').click(); await page.waitForTimeout(100);
    check(await state('recipe') === '', 'Fit resets the Recipe');
    await tid('tab-original').click(); await page.waitForTimeout(200);
    check(await state('original') === afterPan, 'resetting the Recipe left the Original where it was');
    await tid('fit-original').click(); await page.waitForTimeout(100); check(await state('original') === '', 'Fit resets the Original');
    if (outDir) await page.screenshot({ path: `${outDir}/rescue-zoom-${tag}.png` });
    check(errors.length === 0, `Rescue ${tag}: no page errors ${errors.join('; ')}`);
    await page.context().close();
  }
  await browser.close(); srv.close();
  if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
  console.log('cook / rescue / zoom e2e passed');
})().catch((e) => { console.error(e); process.exit(1); });
