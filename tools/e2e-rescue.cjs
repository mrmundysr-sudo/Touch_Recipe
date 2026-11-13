// Developer-only end-to-end check of the plain Recipe Rescue flows in a phone-size Chromium: clearing an entry and undoing it, leaving and finding the draft under Unfinished
// recipes, continuing it, creating the recipe with the edits made in the numbered lists, the original kept with it, and damaged lines marked "Check this line".  node tools/e2e-rescue.cjs
const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const { serve } = await import('./serve.mjs'); const srv = await serve(0); const port = srv.address().port;
  const browser = await chromium.launch();
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await c.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://localhost:${port}/`); await page.waitForFunction(() => window.__app, null, { timeout: 15000 });
  const ok = (m) => console.log('ok  -', m);
  await page.evaluate(() => { window.__app.ctx.prefs.welcomeSeen = true; }); await page.waitForTimeout(1500);
  const route = () => page.evaluate(() => window.__app.nav.current.name);
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  const texts = (id) => page.locator(`[data-testid="${id}-text"]`).evaluateAll((els) => els.map((e) => e.value));

  await page.evaluate(async () => {
    const { ctx, nav } = window.__app;
    const d = await ctx.importer.import({ type: 'text', text: 'Gran\'s Pancakes\nServes 4\nIngredients\n2 cups flour\n1 tbsp sugar\nA pinch of salt\nMethod\nMix the dry things together.\nAdd milk and whisk until smooth.\nCook on a hot pan until golden.' });
    ctx.importSession.draft = d; nav.go('import', {});
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__app.nav.go('rescue', {})); await page.waitForTimeout(900);
  assert.equal(await route(), 'rescue'); assert.deepEqual(await texts('ing'), ['2 cups flour', '1 tbsp sugar', 'A pinch of salt']); ok('rescue opens with the imported entries');

  // clear an entry, then undo
  await page.locator('[data-testid="ing-text"]').nth(1).fill(''); await tid('rr-title').click(); await page.waitForTimeout(400);
  assert.deepEqual(await texts('ing'), ['2 cups flour', 'A pinch of salt']); ok('an emptied entry disappears and the numbers close up');
  await tid('rescue-undo').click(); await page.waitForTimeout(300);
  assert.deepEqual(await texts('ing'), ['2 cups flour', '1 tbsp sugar', 'A pinch of salt']); ok('undo brings it back');

  // edit the title and add a step, then leave and find the draft under Unfinished recipes
  await tid('rr-title').fill('Gran\'s Fluffy Pancakes'); await page.locator('[data-testid="dir-text"]').last().click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('Serve warm.'); await tid('rr-title').click(); await page.waitForTimeout(400);
  await page.locator('.back-chip').first().click(); await page.waitForTimeout(700);
  await page.evaluate(() => window.__app.nav.go('unfinished', {})); await page.waitForTimeout(700);
  assert.equal(await tid('unfinished-item').count(), 1); ok('draft waits under Unfinished recipes');
  await tid('unfinished-continue').click(); await page.waitForTimeout(900);
  assert.equal(await route(), 'rescue'); assert.equal(await tid('rr-title').inputValue(), "Gran's Fluffy Pancakes"); assert.equal((await texts('dir')).pop(), 'Serve warm.'); ok('continue reopens the draft with every edit');

  // create the recipe; the edits are in it and the original stays with it
  await tid('rescue-create').click(); await page.waitForTimeout(900);
  assert.equal(await route(), 'detail'); ok('create recipe -> detail');
  const made = await page.evaluate(async () => { const { ctx, nav } = window.__app; const id = nav.current.params.id; const o = await ctx.drafts.forRecipe(id); const r = await ctx.repo.getRecipe(id); return { kind: o && o.source.kind, title: r.title, ing: r.ingredients.map((i) => i.text), dir: r.directions.map((d) => d.text) }; });
  assert.equal(made.kind, 'TEXT'); assert.equal(made.title, "Gran's Fluffy Pancakes"); assert.deepEqual(made.ing, ['2 cups flour', '1 tbsp sugar', 'A pinch of salt']); assert.equal(made.dir.length, 4); assert.equal(made.dir[3], 'Serve warm.'); ok('the saved recipe has the edits; the original is kept with it');
  assert.equal(await page.evaluate(() => window.__app.ctx.drafts.count()), 0);
  await page.evaluate(() => window.__app.nav.go('original', { id: window.__app.nav.current.params.id })); await page.waitForTimeout(700);
  assert.ok((await page.locator('.sp-line').count()) > 3); ok('original viewer shows the kept text');

  // damaged lines (as in the owner's screenshots) are shown unchanged and marked
  await page.evaluate(async () => {
    const { ctx, nav } = window.__app; const mod = await import('/js/engine/models.js');
    const recipe = mod.Recipe({ title: 'TP', ingredients: ['2', '41/cuplightbrown3sugar2tablespoons1.Editor\'sNote:NamedBou rbonChickenbecauseit lbs', '1 ugarlic clove, cr d 1/teaspoon g', '2 cups flour'].map((t) => mod.Ingredient({ text: t })),
      directions: ['Combine first 6 ingredients.', '4.', '12. In: 35mins Serv es: 4 Bourbon Chicken because it was supp osedly Ingredients: 11 created by a Chin ese cook wh'].map((t) => mod.Direction({ text: t })) });
    ctx.importSession.draft = { recipe, source: { kind: 'PDF', text: 'x', files: [], cleaned: [], capturedAt: 1 }, warnings: [], imageCandidates: [] }; nav.go('rescue', {});
  });
  await page.waitForTimeout(1200);
  assert.deepEqual(await texts('ing'), ['2', "41/cuplightbrown3sugar2tablespoons1.Editor'sNote:NamedBou rbonChickenbecauseit lbs", '1 ugarlic clove, cr d 1/teaspoon g', '2 cups flour'], 'damaged entries are shown exactly as read');
  const notes = await page.locator('[data-testid="review-note"]:visible').count(); assert.equal(notes, 5, `five damaged entries are marked (${notes})`); assert.equal(await tid('review-count').count(), 1);
  const empty = await page.evaluate(() => [...document.querySelectorAll('.rr-group')].filter((g) => g.querySelector(':scope > .rr-label') && g.children.length < 2).map((g) => g.textContent));
  assert.deepEqual(empty, [], 'no heading without anything under it'); ok('damaged entries are shown unchanged, marked "Check this line", and counted at the top');

  assert.deepEqual(errors, [], 'no console errors: ' + errors.join('\n'));
  await browser.close(); srv.close(); console.log('rescue e2e passed');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
