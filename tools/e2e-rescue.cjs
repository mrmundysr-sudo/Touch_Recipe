// Developer-only end-to-end check of Recipe Rescue, Unfinished Recipes and the kept Original in a phone-size Chromium.  node tools/e2e-rescue.cjs
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
  const sheetSend = async (label) => { await page.locator('.sheet .big-btn, .sheet button', { hasText: label }).first().click(); await page.waitForTimeout(250); };

  // a damaged import: text import keeps the original, then Recipe Rescue
  await page.evaluate(async () => {
    const { ctx, nav } = window.__app;
    const d = await ctx.importer.import({ type: 'text', text: 'Gran\'s Pancakes\nServes 4\nIngredients\n2 cups flour\n1 tbsp sugar\nA pinch of salt\nMethod\nMix the dry things together.\nAdd milk and whisk until smooth.\nCook on a hot pan until golden.' });
    ctx.importSession.draft = d; nav.go('import', {});
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__app.nav.go('rescue', {})); await page.waitForTimeout(900);
  assert.equal(await route(), 'rescue');
  assert.ok(await tid('ing-line').count() >= 3, 'ingredients shown'); ok('rescue opens with the imported lines');

  // delete a line, then undo
  const before = await tid('ing-line').count();
  await tid('ing-line').first().locator('.sp-text').click(); await page.waitForTimeout(250); await sheetSend('Delete line');
  assert.equal(await tid('ing-line').count(), before - 1); ok('delete line');
  await tid('rescue-undo').click(); await page.waitForTimeout(250);
  assert.equal(await tid('ing-line').count(), before); ok('undo restores it');

  // original tab: send text to ingredients
  await tid('tab-original').click(); await page.waitForTimeout(250);
  const n = await tid('orig-line').count(); assert.ok(n >= 5, 'original text lines');
  await tid('orig-line').nth(3).locator('.sp-text').click(); await page.waitForTimeout(150);
  await tid('send-selected').click(); await page.waitForTimeout(250); await sheetSend('Steps');
  await tid('tab-recipe').click(); await page.waitForTimeout(250);
  assert.ok(await tid('dir-line').count() >= 4, 'sent line became a step'); ok('send original line to Steps');

  // smart paste preview
  await tid('rescue-add').click(); await page.waitForTimeout(250); await tid('smart-paste').click(); await page.waitForTimeout(250);
  await tid('ask-field').fill('Ingredients\n1 egg\n1 cup milk\nDirections\nBeat the egg into the milk.'); await tid('ask-ok').click(); await page.waitForTimeout(300);
  await page.locator('.dialog button', { hasText: 'Add' }).last().click(); await page.waitForTimeout(300);
  assert.ok((await tid('ing-line').count()) >= before + 2); ok('smart paste adds lines after a preview');

  // leave and find it under Unfinished recipes
  await page.locator('[data-testid="back-chip"]').first().click(); await page.waitForTimeout(700);
  await page.evaluate(() => window.__app.nav.go('unfinished', {})); await page.waitForTimeout(700);
  assert.equal(await tid('unfinished-item').count(), 1); ok('draft waits under Unfinished recipes');
  await tid('unfinished-continue').click(); await page.waitForTimeout(900);
  assert.equal(await route(), 'rescue'); ok('continue reopens the draft');

  // create the recipe; the original stays with it
  await tid('rescue-create').click(); await page.waitForTimeout(900);
  assert.equal(await route(), 'detail'); ok('create recipe -> detail');
  const kept = await page.evaluate(async () => { const { ctx, nav } = window.__app; const id = nav.current.params.id; const o = await ctx.drafts.forRecipe(id); return o && o.source.kind; });
  assert.equal(kept, 'TEXT'); ok('original kept with the recipe');
  assert.equal(await page.evaluate(() => window.__app.ctx.drafts.count()), 0);
  await page.evaluate(() => window.__app.nav.go('original', { id: window.__app.nav.current.params.id })); await page.waitForTimeout(700);
  assert.ok((await page.locator('.sp-line').count()) > 3); ok('original viewer shows the kept text');
  await page.screenshot({ path: process.env.SHOTS ? process.env.SHOTS + '/original.png' : '/dev/null' }).catch(() => {});

  assert.deepEqual(errors, [], 'no console errors: ' + errors.join('\n'));
  await browser.close(); srv.close(); console.log('rescue e2e passed');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
