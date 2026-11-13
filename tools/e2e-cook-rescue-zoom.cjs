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
    const lastTa = page.locator('[data-testid="ing-text"]').last(); await lastTa.click(); await page.keyboard.press('End'); await page.keyboard.type(' X');
    check((await lastTa.inputValue()).endsWith(' X'), `Rescue ${tag}: the last ingredient row can be tapped and edited`);
    await page.evaluate(() => document.activeElement.blur());

    if (w !== 390) { await page.context().close(); continue; }
    // ---- zoom and pan (narrow phone: one side at a time) ----
    const tid = (i) => page.locator(`[data-testid="${i}"]`);
    const pinch = (side, factor) => page.evaluate(({ side, factor }) => {
      const o = document.querySelector(`[data-testid=gesture-${side}]`); const r = o.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2, d0 = 60;
      const ev = (type, id, x, y) => o.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 1 }));
      ev('pointerdown', 1, cx - d0, cy); ev('pointerdown', 2, cx + d0, cy);
      for (let i = 1; i <= 5; i++) { const d = d0 + (d0 * factor - d0) * (i / 5); ev('pointermove', 1, cx - d, cy); ev('pointermove', 2, cx + d, cy); }
      ev('pointerup', 1, cx - d0 * factor, cy); ev('pointerup', 2, cx + d0 * factor, cy);
    }, { side, factor });
    const drag = (side, dx, dy) => page.evaluate(({ side, dx, dy }) => {
      const o = document.querySelector(`[data-testid=gesture-${side}]`); const r = o.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const ev = (type, px, py) => o.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: px, clientY: py, bubbles: true, cancelable: true, isPrimary: true }));
      ev('pointerdown', x, y); for (let i = 1; i <= 4; i++) ev('pointermove', x + dx * i / 4, y + dy * i / 4); ev('pointerup', x + dx, y + dy);
    }, { side, dx, dy });
    const state = (side) => page.evaluate((s) => { const z = document.querySelector(`[data-testid=pane-${s}] .rr-zoom`); return z ? z.style.transform : null; }, side);
    const status = async () => (await tid('zoom-status').innerText()).trim();

    check(await tid('zoom-btn').count() === 1 && await tid('pan-btn').count() === 1, 'Rescue: magnifier (Zoom) and Pan buttons exist');
    await tid('tab-original').click(); await page.waitForTimeout(150);
    await tid('zoom-btn').click(); await page.waitForTimeout(100);
    check((await tid('zoom-btn').innerText()).includes('Original') && (await tid('zoom-btn').getAttribute('aria-pressed')) === 'true', 'first tap on the magnifier selects Original, and says so');
    check(await tid('pane-original').count() === 1 && await page.locator('.rr-wrap.rr-active').count() === 1, 'the active pane is highlighted');
    await pinch('original', 2); await page.waitForTimeout(100);
    const sO = await state('original'); check(/scale\(2/.test(sO || ''), `pinch zooms the Original (${sO})`);
    await tid('zoom-btn').click(); await page.waitForTimeout(250);   // second tap -> Recipe (narrow phone shows the Recipe side)
    check((await tid('zoom-btn').innerText()).includes('Recipe') && await tid('pane-recipe').count() === 1, 'second tap on the magnifier selects Recipe and shows that side');
    check(await state('recipe') === '', 'the Recipe is still at fit while the Original is zoomed');
    await pinch('recipe', 3); await page.waitForTimeout(100);
    const sR = await state('recipe'); check(/scale\(3/.test(sR || ''), `Recipe zooms on its own (${sR})`);
    // text cannot be edited by accident through the overlay
    const before = await tid('rr-title').inputValue(); const tb = await rect(page, '[data-testid=gesture-recipe]');
    await page.mouse.click(tb.l + 40, tb.t + 40); await page.keyboard.type('zzz');
    check((await tid('rr-title').inputValue()) === before && !(await page.evaluate(() => /INPUT|TEXTAREA/.test(document.activeElement?.tagName || ''))), 'taps on a zoom/pan-selected pane do not edit or focus text');
    // Pan mode
    await tid('zoom-btn').click(); await page.waitForTimeout(100);
    check((await tid('zoom-btn').innerText()).includes('off'), 'third tap turns the magnifier off');
    await tid('pan-btn').click(); await page.waitForTimeout(100);
    check((await tid('pan-btn').innerText()).includes('Original'), 'first tap on Pan selects Original'); await page.waitForTimeout(200);
    const beforePan = await state('original'); await drag('original', -60, -80); await page.waitForTimeout(100);
    const afterPan = await state('original'); check(afterPan !== beforePan && /translate\(-?\d/.test(afterPan), `one-finger drag pans the Original (${beforePan} -> ${afterPan})`);
    await tid('pan-btn').click(); await page.waitForTimeout(250);
    check((await tid('pan-btn').innerText()).includes('Recipe') && await tid('pane-recipe').count() === 1, 'second tap on Pan selects Recipe');
    const recBefore = await state('recipe'); await drag('recipe', -30, -200); await page.waitForTimeout(100); const recAfter = await state('recipe');
    check(recAfter !== recBefore && /scale\(3/.test(recAfter), `Recipe pans independently, still at 3x (${recAfter})`);
    // switching sides keeps each side's view
    await tid('tab-original').click(); await page.waitForTimeout(200);
    check(await state('original') === afterPan, 'switching to Original keeps its zoom and position');
    await tid('tab-recipe').click(); await page.waitForTimeout(200);
    check(await state('recipe') === recAfter, 'switching back to Recipe keeps its zoom and position');
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
