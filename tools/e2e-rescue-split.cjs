// Developer-only browser check of the Recipe Rescue split layout: original on the left and the editable recipe card on the right when the screen is wide
// (a phone on its side), the original above the card with a draggable divider when upright, either one alone, rotation without losing the work,
// copying a line across, and the requests the screen makes to the native app about turning sideways.  node tools/e2e-rescue-split.cjs [outdir]
const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const outDir = process.argv[2] || null;
  const { serve } = await import('./serve.mjs'); const srv = await serve(0); const port = srv.address().port;
  const browser = await chromium.launch(); const ok = (m) => console.log('ok  -', m); const errors = [];
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await c.newPage(); const orient = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.exposeFunction('__orient', (landscape) => { orient.push(landscape); });
  // the native bridge as far as this screen is concerned: it only records whether landscape is allowed
  await page.addInitScript(() => { window.Capacitor = { isNativePlatform: () => false, isPluginAvailable: (n) => n === 'TouchRecipeOcr', Plugins: { TouchRecipeOcr: { setOrientation: (a) => { window.__orient(!!a.landscape); return Promise.resolve(); } } } }; });
  await page.goto(`http://localhost:${port}/`); await page.waitForFunction(() => window.__app, null, { timeout: 15000 });
  await page.evaluate(() => { window.__app.ctx.prefs.welcomeSeen = true; window.__app.ctx.prefs.setTheme('DARK'); }); await page.waitForTimeout(1000);
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  assert.deepEqual(orient, [], 'before the Rescue screen opens the app never asks for landscape (every other screen stays portrait)'); ok('before Recipe Rescue: no request to allow landscape');

  await page.evaluate(async () => {
    const { ctx, nav } = window.__app;
    const text = ['Gran\'s Pancakes', 'Serves 4', 'Ingredients', '2 cups flour', '1 tbsp sugar', 'A pinch of salt', '1 1/2 cups milk', '1 egg', '2 tbsp butter, melted', 'Method',
      'Mix the dry things together.', 'Add milk and whisk until smooth.', 'Cook on a hot pan until golden.', 'Serve warm with syrup.', 'Notes', 'Best with real maple syrup.'].join('\n');
    const d = await ctx.importer.import({ type: 'text', text }); ctx.importSession.draft = d; nav.go('rescue', {});
  });
  await page.waitForTimeout(1200);
  assert.deepEqual(orient, [true], 'opening Recipe Rescue asks the native app to allow landscape'); ok('opening Recipe Rescue allows landscape (one request)');

  const box = (id) => page.evaluate((i) => { const r = document.querySelector(`[data-testid="${i}"]`).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, id);
  const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

  // ---------- upright phone ----------
  assert.ok(await tid('tab-split').count() === 1 && await tid('tab-recipe').count() === 1 && await tid('tab-original').count() === 1, 'three views');
  let o = await box('pane-original'), r = await box('pane-recipe'), dv = await box('split-divider');
  assert.ok(o.b <= dv.t + 0.5 && dv.b <= r.t + 0.5, `upright: original above the divider above the recipe (${o.b} <= ${dv.t}, ${dv.b} <= ${r.t})`);
  assert.ok(o.w > 300 && r.w > 300, 'both panes use the full width'); assert.ok(await noSideways());
  ok('upright: the original sits above the recipe card, divider between them, both full width');
  // drag the divider
  const h0 = o.h; const dvc = { x: dv.l + dv.w / 2, y: dv.t + dv.h / 2 };
  await page.mouse.move(dvc.x, dvc.y); await page.mouse.down(); await page.mouse.move(dvc.x, dvc.y + 120, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
  o = await box('pane-original'); assert.ok(o.h > h0 + 60, `dragging the divider down gives the original more room (${h0} -> ${o.h})`);
  await tid('split-divider').focus(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(150);
  const o2 = await box('pane-original'); assert.ok(o2.h < o.h - 20, 'arrow keys move the divider too'); ok('upright: the divider can be dragged and moved with the arrow keys');
  // the recipe's own buttons stay below both panes
  const foot = await box('rescue-foot'); r = await box('pane-recipe'); assert.ok(foot.t >= r.b - 0.5, 'upright: the recipe buttons are below the panes'); ok('upright: the recipe buttons are below the panes, not over them');
  // single-pane views
  await tid('tab-recipe').click(); await page.waitForTimeout(250); assert.ok(await tid('pane-recipe').count() === 0 && await tid('ing-line').count() >= 4, 'Recipe alone');
  await tid('tab-original').click(); await page.waitForTimeout(250); assert.ok(await tid('orig-line').count() >= 8 && await tid('ing-line').count() === 0, 'Original alone');
  await tid('tab-split').click(); await page.waitForTimeout(250); ok('upright: Recipe alone, Original alone and Split all work');
  if (outDir) await page.screenshot({ path: `${outDir}/split-portrait.png` });

  // ---------- rotate: the work is kept ----------
  await tid('ing-line').first().locator('.sp-text').click(); await page.waitForTimeout(200); await page.locator('.sheet button', { hasText: 'Select several lines' }).first().click(); await page.waitForTimeout(250);
  const selectedBefore = await page.locator('.sp-line.selected').count(); assert.equal(selectedBefore, 1);
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(600);
  assert.equal(await tid('tab-split').count(), 0, 'wide: no view chips (everything is shown)');
  o = await box('pane-original'); dv = await box('split-divider'); r = await box('pane-recipe');
  assert.ok(o.r <= dv.l + 0.5 && dv.r <= r.l + 0.5, `landscape: original LEFT of the divider, recipe card RIGHT (${o.r} <= ${dv.l}, ${dv.r} <= ${r.l})`);
  assert.ok(o.w > 150 && r.w > 150, 'landscape: both panes have room'); assert.ok(await noSideways(), 'no sideways scroll');
  assert.equal(await page.locator('.sp-line.selected').count(), selectedBefore, 'turning the phone keeps the selection'); ok('rotating to landscape: original on the left, recipe card on the right, the selection is kept');
  // while lines are selected the buttons are Delete / Replace / Done: they too belong to the recipe pane
  const dn = await page.locator('[data-testid="pane-recipe"] .sp-bar button', { hasText: 'Done selecting' }).count(); assert.equal(dn, 1, 'landscape: the selection buttons are inside the recipe pane');
  await page.locator('[data-testid="pane-recipe"] .sp-bar button', { hasText: 'Done selecting' }).click(); await page.waitForTimeout(250);
  // recipe buttons are inside the recipe pane
  const create = await box('rescue-create'); assert.ok(create.l >= r.l - 0.5 && create.r <= r.r + 0.5 && create.b <= r.b + 0.5, 'landscape: the recipe buttons sit at the bottom of the recipe pane');
  assert.equal((await box('rescue-foot')).h < 40, true, 'landscape: no full-width button bar');
  await tid('rescue-create').scrollIntoViewIfNeeded(); ok('landscape: the recipe buttons belong to the recipe pane');
  // nothing of a pane's content is drawn inside its own button row
  const under = await page.evaluate(() => { let bad = 0, n = 0; for (const side of ['original', 'recipe']) { const pane = document.querySelector(`[data-testid="pane-${side}"]`), sc = document.querySelector(`[data-testid="pane-${side}-scroll"]`), bar = pane.querySelector(':scope > .sp-bar'); if (!bar) continue; const br = bar.getBoundingClientRect();
      for (let k = 0; k <= 10; k++) { sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * (k / 10); for (let y = br.top + 2; y < br.bottom - 2; y += 6) for (let x = br.left + 4; x < br.right - 4; x += 20) { n++; const e = document.elementFromPoint(x, y); if (e && e.closest('.sp-line, .sp-h2, .sp-sec') && !e.closest('.sp-bar')) bad++; } } sc.scrollTop = 0; } return { bad, n }; });
  assert.equal(under.bad, 0, `landscape: no content under a pane's buttons (${under.n} points)`); ok(`landscape: no card or heading is drawn under either pane's buttons (${under.n} points)`);
  // each pane scrolls on its own
  const sc = await page.evaluate(() => { const a = document.querySelector('[data-testid="pane-original-scroll"]'), b = document.querySelector('[data-testid="pane-recipe-scroll"]'); b.scrollTop = 99999; return { aTop: a.scrollTop, bTop: b.scrollTop, bScrollable: b.scrollHeight > b.clientHeight, pageTop: document.querySelector('[data-testid="rescue-body"]').scrollTop }; });
  assert.ok(sc.bScrollable && sc.bTop > 0 && sc.aTop === 0 && sc.pageTop === 0, 'landscape: scrolling the recipe does not move the original or the page'); ok('landscape: each pane scrolls on its own');
  // divider (vertical)
  const w0 = o.w; const c2 = { x: dv.l + dv.w / 2, y: dv.t + dv.h / 2 };
  await page.mouse.move(c2.x, c2.y); await page.mouse.down(); await page.mouse.move(c2.x + 100, c2.y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
  o = await box('pane-original'); assert.ok(o.w > w0 + 50, `landscape: dragging the divider right widens the original (${w0} -> ${o.w})`); ok('landscape: the vertical divider can be dragged');
  if (outDir) await page.screenshot({ path: `${outDir}/split-landscape.png` });
  // text can be selected for copying
  const selectable = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="orig-line"] .sp-text')).userSelect || getComputedStyle(document.querySelector('[data-testid="orig-line"] .sp-text')).webkitUserSelect);
  assert.equal(selectable, 'text', 'the original text can be selected and copied'); ok('the original\'s text is selectable (long-press to copy)');
  // copy a line across: tap in the original, send to Ingredients, it appears in the card
  const before = await tid('ing-line').count();
  await page.locator('[data-testid="orig-line"] .sp-text', { hasText: 'Serve warm with syrup.' }).click(); await page.waitForTimeout(250);
  await page.locator('[data-testid="send-selected"]').click(); await page.waitForTimeout(250); await tid('send-ing').click(); await page.waitForTimeout(400);
  assert.equal(await tid('ing-line').count(), before + 1, 'a line sent from the original appears in the card');
  assert.ok((await page.locator('[data-testid="ing-line"] .sp-text').allTextContents()).some((t) => t.includes('Serve warm with syrup.')), 'with its exact text'); ok('landscape: a line tapped in the original and sent appears in the recipe card');

  // ---------- back upright ----------
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
  assert.equal(await tid('tab-split').count(), 1); o = await box('pane-original'); r = await box('pane-recipe'); assert.ok(o.b <= r.t + 0.5, 'upright again: original above the card'); ok('rotating back: stacked again, nothing lost');
  assert.ok((await page.locator('[data-testid="ing-line"] .sp-text').allTextContents()).some((t) => t.includes('Serve warm with syrup.')), 'the sent line is still there');

  // ---------- leaving puts the app back to portrait ----------
  await page.locator('.back-chip').first().click(); await page.waitForTimeout(800);
  assert.deepEqual(orient, [true, false], 'leaving Recipe Rescue asks the native app for portrait only again'); ok('leaving Recipe Rescue: the app goes back to portrait only (request to forbid landscape)');
  await browser.close(); srv.close();
  assert.deepEqual(errors, [], 'no console errors'); console.log('rescue split e2e passed');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
