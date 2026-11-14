// Developer-only browser regression for app-to-app sharing: send checklist, file produced, receive preview, duplicate prompts, undo, bad file.
const { chromium } = require('playwright');
(async () => {
  const fails = []; const check = (c, m) => { if (c) console.log('ok  -', m); else { fails.push(m); console.log('FAIL-', m); } };
  const { serve } = await import('./serve.mjs'); const srv = await serve(0); const port = srv.address().port;
  const browser = await chromium.launch();
  for (const [w, h] of [[390, 844], [320, 568]]) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, acceptDownloads: true }); const page = await c.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { window.Capacitor = { isNativePlatform: () => false, isPluginAvailable: () => false, Plugins: {} }; });
    await page.goto(`http://localhost:${port}/`); await page.waitForFunction(() => window.__app, null, { timeout: 15000 });
    await page.evaluate(() => { window.__app.ctx.prefs.welcomeSeen = true; }); await page.waitForTimeout(1800);
    const tag = `${w}x${h}`; const tid = (i) => page.locator(`[data-testid="${i}"]`);
    await page.evaluate(async () => {
      const { ctx, nav } = window.__app; const m = await import('/js/engine/models.js');
      for (const t of ['Apple Pie', 'Beef Stew', 'Chili']) await ctx.repo.saveRecipe(m.Recipe({ title: t, servings: 4, ingredients: [m.Ingredient({ text: '1 cup flour' })], directions: [m.Direction({ text: 'Mix.' })] }));
      nav.go('print', {});
    });
    await page.waitForTimeout(600);
    check(await tid('send-recipes').count() === 1 && await tid('open-shared').count() === 1, `${tag}: Print & Share offers Send recipes and Open a shared file (old Share/Print still there: ${await page.getByText('Share meal plan').count()})`);
    await tid('send-recipes').click(); await page.waitForTimeout(300);
    check(await tid('send-row').count() === 3 && await tid('send-go').isDisabled(), `${tag}: checklist lists 3 recipes, Send disabled until one is ticked`);
    await tid('send-row').nth(0).click(); await tid('send-row').nth(2).click();
    check((await tid('send-go').innerText()).includes('2') && !(await tid('send-go').isDisabled()), `${tag}: two ticked -> "Send 2 recipes"`);
    const box = await tid('send-go').boundingBox(); check(box && box.y + box.height <= h && box.height >= 44, `${tag}: Send button is on screen and large (${JSON.stringify(box)})`);
    const dl = page.waitForEvent('download'); await tid('send-go').click(); const d = await dl;
    check(/\.touchrecipe$/.test(d.suggestedFilename()), `${tag}: a .touchrecipe file is produced (${d.suggestedFilename()})`);
    const path = await d.path(); const fs = require('fs'); const bytes = [...fs.readFileSync(path)];
    // receive: a duplicate (Apple Pie, Chili exist) and a new one
    await page.evaluate(async () => { const { ctx } = window.__app; await ctx.repo.deleteRecipe(ctx.repo.recipes().find((r) => r.title === 'Beef Stew').id); });
    await page.waitForTimeout(300);
    await page.evaluate(async (b) => { const m = await import('/js/screens/sharing.js'); window.__recv = m.receiveShare(window.__app.ctx, new Uint8Array(b)); }, bytes); await page.waitForTimeout(500);
    check(await tid('receive-dup').count() === 2 && await tid('receive-new').count() === 0, `${tag}: both received recipes are already here, each shows its own choice`);
    check(/0 new, 2 already here/.test(await tid('receive-summary').innerText()), `${tag}: summary is honest`);
    await tid('receive-add').click(); await page.waitForTimeout(500);
    check(await page.evaluate(() => window.__app.ctx.repo.recipes().length) === 2, `${tag}: default for a duplicate is Skip (nothing added)`);
    await page.evaluate(async (b) => { const m = await import('/js/screens/sharing.js'); m.receiveShare(window.__app.ctx, new Uint8Array(b)); }, bytes); await page.waitForTimeout(500);
    await tid('dup-copy').first().click(); await tid('dup-replace').nth(1).click(); await page.waitForTimeout(150);
    check((await tid('dup-copy').first().getAttribute('aria-checked')) === 'true' && (await tid('dup-skip').first().getAttribute('aria-checked')) === 'false', `${tag}: choosing Keep both is shown and exclusive`);
    await tid('receive-add').click(); await page.waitForTimeout(500);
    const titles = await page.evaluate(() => window.__app.ctx.repo.recipes().map((r) => r.title).sort());
    check(titles.length === 3 && titles.some((t) => /\(shared\)$/.test(t)), `${tag}: Keep both added one copy, Replace changed none extra (${titles.join(' | ')})`);
    // undo through the snackbar
    const undo = page.getByText('Undo', { exact: true }); if (await undo.count()) { await undo.first().click(); await page.waitForTimeout(400); }
    check(await page.evaluate(() => window.__app.ctx.repo.recipes().length) === 2, `${tag}: Undo takes the copy back out`);
    // a bad file
    await page.evaluate(async () => { const m = await import('/js/screens/sharing.js'); await m.receiveShare(window.__app.ctx, new TextEncoder().encode('not a recipe')); }); await page.waitForTimeout(300);
    check(await tid('receive-add').count() === 0 && await page.evaluate(() => window.__app.ctx.repo.recipes().length) === 2, `${tag}: a bad file shows no Add button and changes nothing`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join('; ')}`);
    await c.close();
  }
  await browser.close(); srv.close();
  if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
  console.log('share e2e passed');
})().catch((e) => { console.error(e); process.exit(1); });
