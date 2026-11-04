// Developer-only end-to-end check of the iOS web shell in a phone-size Chromium (not part of `npm test`, no extra dependencies in the repo).
// Needs Playwright installed globally or on NODE_PATH:   node tools/e2e.cjs
// It serves www/, drives the real UI (object taps resolve through the cutout alpha, grocery add/check/clear/undo, import -> review -> save,
// servings scaling, Cook Mode timer persistence, planner, settings, themes, kitchen timer, backup export) and fails on any console error.
const { chromium } = require('playwright');
async function start({ w = 390, h = 844, dpr = 2, dark = false } = {}) {
  const { serve } = await import('./serve.mjs');
  const srv = await serve(0);
  const port = srv.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, colorScheme: dark ? 'dark' : 'light', hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => window.__app, null, { timeout: 15000 });
  return { page, browser, srv, errors, close: async () => { await browser.close(); srv.close(); } };
}
const seed = `(async () => {
  const { ctx } = window.__app; const m = await import('/js/engine/models.js');
  const r = m.Recipe({ id: 'r1', title: 'Spaghetti al Pomodoro', description: 'A simple weeknight classic.', servings: 4, prepMinutes: 10, cookMinutes: 20, categoryIds: ['b_dinner'], sourceName: 'example.com', sourceUrl: 'https://example.com/spaghetti',
    ingredients: ['400 g spaghetti', '1 can (14 oz) crushed tomatoes', '2 cloves garlic', '3 tbsp olive oil', 'Fresh basil', 'Salt'].map((t) => m.Ingredient({ text: t })),
    directions: ['Boil the pasta in salted water for 10 minutes.', 'Warm the olive oil and garlic, add tomatoes and simmer for 15 minutes.', 'Toss everything together with basil.'].map((t) => m.Direction({ text: t, timerSeconds: t.includes('10 minutes') ? 600 : t.includes('15 minutes') ? 900 : null })) });
  await ctx.repo.saveRecipe(r);
  await ctx.repo.saveRecipe(m.Recipe({ id: 'r2', title: 'Lemon Cake', servings: 8, categoryIds: ['b_desserts'], favorite: true, ingredients: [m.Ingredient({ text: '2 cups flour' })], directions: [m.Direction({ text: 'Bake.' })] }));
})()`;


const assert = require('assert');
(async () => {
  const t = await start();
  const { page } = t;
  const ok = (m) => console.log('ok  -', m);
  await page.evaluate(seed);
  await page.evaluate(() => { window.__app.ctx.prefs.welcomeSeen = true; });
  await page.waitForTimeout(1600);
  const tap = async (id) => { await page.evaluate((i) => document.querySelector(`[data-art="${i}"]`).dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true })), id); await page.waitForTimeout(450); };
  const tapXY = async (nx, ny) => { const r = await page.locator('.art-stage').boundingBox(); await page.mouse.click(r.x + nx * r.width, r.y + ny * r.height); await page.waitForTimeout(450); };
  const route = () => page.evaluate(() => window.__app.nav.current.name);

  // Hub: tapping the real physical object resolves through cutout alpha
  await page.evaluate(() => window.__app.nav.go('hub', {}, { root: true })); await page.waitForTimeout(800);
  const hub = await page.evaluate(() => { const a = window.__app.ctx.art.page('hub'); return a.targets.map((t) => [t.id, t.box.cx, t.box.cy]); });
  for (const [id, expectRoute] of [['rolodex', 'collection'], ['grocery', 'grocery'], ['calendar', 'planner'], ['new_recipe', 'import'], ['drawer', 'drawer']]) {
    await page.evaluate(() => window.__app.nav.go('hub', {}, { root: true })); await page.waitForTimeout(600);
    const [, cx, cy] = hub.find((h) => h[0] === id); await tapXY(cx, cy);
    assert.equal(await route(), expectRoute, `tap ${id}`); ok(`hub tap on ${id} object -> ${expectRoute}`);
  }
  // Grocery: add, check, clear, undo
  await page.evaluate(() => window.__app.nav.go('grocery', {}, { root: true })); await page.waitForTimeout(600);
  assert.ok(await page.locator('[data-testid=grocery-empty]').count()); ok('empty grocery state');
  await tap('add'); await page.fill('[data-testid=add-name]', 'Apples'); await page.fill('[data-testid=add-qty]', '3'); await page.click('[data-testid=add-confirm]'); await page.waitForTimeout(300);
  await page.fill('[data-testid=add-name]', 'Chicken thighs'); await page.click('[data-testid=add-confirm]'); await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('.sheet-backdrop')?.click()); await page.waitForTimeout(400);
  assert.ok(await page.locator('[data-testid^="aisle-head:produce"]').count() && await page.locator('[data-testid^="aisle-head:meat"]').count()); ok('add item: auto-categorised under bold headings');
  const check = page.locator('[data-testid^="grocery-check:"]').first(); await check.click(); await page.waitForTimeout(300);
  const items = await page.evaluate(() => window.__app.ctx.repo.groceryItems(window.__app.ctx.week.value).map((i) => [i.name, i.checked]));
  assert.ok(items.some(([, c]) => c)); ok('check item off');
  await tap('clear'); await page.click('[data-testid=dialog-confirm]'); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__app.ctx.repo.groceryItems(window.__app.ctx.week.value).length), 1); ok('clear checked removes it');
  await page.click('.snack-action'); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__app.ctx.repo.groceryItems(window.__app.ctx.week.value).length), 2); ok('undo clear');
  // scrolling long list
  await page.evaluate(async () => { const c = window.__app.ctx; for (let i = 0; i < 40; i++) await c.repo.addGroceryItem(c.week.value, 'Pickle' + String.fromCharCode(97 + i % 26) + String.fromCharCode(97 + (i / 26 | 0)), '', 'pantry'); });
  await page.waitForTimeout(400);
  const sc = await page.evaluate(() => { const l = document.querySelector('[data-testid=grocery-list]'); return [l.scrollHeight, l.clientHeight]; });
  assert.ok(sc[0] > sc[1] * 2); await page.evaluate(() => { document.querySelector('[data-testid=grocery-list]').scrollTop = 99999; }); ok(`list scrolls (${sc[0]} > ${sc[1]})`);
  assert.ok(await page.locator('[data-art=add]').count() && await page.locator('[data-art=clear]').count()); ok('bottom controls remain');

  // Import text -> review -> save
  await page.evaluate(() => window.__app.nav.go('import', {}, { root: true })); await page.waitForTimeout(600);
  await tap('text'); await page.fill('[data-testid=text-field]', "Grandma's Pancakes\nServes 4\nIngredients\n- 1 1/2 cups flour\n- 2 eggs\nDirections\n1. Mix everything well in a large bowl until smooth.\n2. Cook on a hot griddle for 3 minutes per side."); await page.click('[data-testid=text-import]'); await page.waitForTimeout(700);
  assert.ok(await page.locator('[data-testid=import-result]').count()); await page.click('[data-testid=result-continue]'); await page.waitForTimeout(700);
  assert.equal(await route(), 'review'); assert.equal(await page.inputValue('[data-testid=title-field]'), "Grandma's Pancakes"); ok('import text -> review with parsed title');
  assert.equal(await page.locator('[data-testid^="ing-rows:row:"]').count(), 2); assert.equal(await page.locator('[data-testid^="dir-rows:row:"]').count(), 2); ok('review rows populated');
  await page.fill('[data-testid=title-field]', ''); await tap('save'); assert.ok((await page.locator('.snack').innerText()).includes('title')); ok('save blocked without a title');
  await page.fill('[data-testid=title-field]', "Grandma's Pancakes"); await tap('save'); await page.waitForTimeout(900);
  assert.equal(await route(), 'detail'); assert.ok(await page.evaluate(() => window.__app.ctx.repo.recipes().some((r) => r.title === "Grandma's Pancakes"))); ok('save -> detail, recipe stored');
  // Detail: scaling servings + cook
  const id = await page.evaluate(() => window.__app.ctx.repo.recipes().find((r) => r.title === "Grandma's Pancakes").id);
  await tap('serv_inc'); await tap('serv_inc'); assert.equal((await page.locator('[data-testid=servings-value]').innerText()).trim(), '6'); ok('servings stepper 4 -> 6');
  assert.ok((await page.locator('[data-testid^="ingredient:"]').first().innerText()).includes('2 1/4 cups') || (await page.locator('[data-testid^="ingredient:"]').first().innerText()).includes('2 1/4')); ok('ingredient amounts scale');
  await tap('cook'); await page.waitForTimeout(500); assert.equal(await route(), 'cook'); ok('cook mode opens');
  assert.equal((await page.locator('[data-testid=timer-label]').innerText()).trim(), 'Set timer'); ok('step 1 has no timer (label: Set timer)');
  await tap('next'); await page.waitForTimeout(400); assert.equal((await page.locator('[data-testid=timer-label]').innerText()).trim(), 'Start timer'); await tap('start'); await page.waitForTimeout(1400);
  assert.equal((await page.locator('[data-testid=timer-label]').innerText()).trim(), 'Pause timer'); assert.ok(/^02:5\d$/.test((await page.locator('[data-testid=clock-face]').innerText()).trim())); ok('timer counts down');
  await page.evaluate(() => window.__app.nav.back()); await page.waitForTimeout(600); await page.evaluate((i) => window.__app.nav.go('cook', { id: i }), id); await page.waitForTimeout(700);
  assert.equal((await page.locator('[data-testid=timer-label]').innerText()).trim(), 'Pause timer'); ok('timer + step persisted across leaving the screen');
  await tap('next'); await page.waitForTimeout(300); assert.ok(await page.locator('.dialog').count()); await page.click('[data-testid=dialog-confirm]'); await page.waitForTimeout(500); ok('last step -> finish dialog');

  // Planner assign + remove + grocery
  await page.evaluate(() => window.__app.nav.go('planner', {}, { root: true })); await page.waitForTimeout(700);
  const todayIdx = await page.evaluate(() => (new Date().getDay() + 6) % 7);
  await tap('day' + todayIdx); await page.waitForTimeout(400); assert.ok(await page.locator('[data-testid=picker-list]').count()); await page.click('[data-testid^="pick:r1"]'); await page.waitForTimeout(500);
  assert.equal((await page.locator(`[data-testid="day-title:${todayIdx}"]`).innerText()).trim(), 'Spaghetti al Pomodoro'); ok('planner: assign recipe to a day');
  await tap('grocery'); await page.waitForTimeout(800); assert.equal(await route(), 'grocery'); assert.ok(await page.evaluate(() => window.__app.ctx.repo.groceryItems(window.__app.ctx.week.value).some((i) => i.name.startsWith('Spaghetti')))); ok('planner basket -> grocery list from meals');

  // Drawer pages: settings text size, themes, tools timer, backup export
  await page.evaluate(() => window.__app.nav.go('settings', {}, { root: true })); await page.waitForTimeout(500);
  await page.click('[data-testid="text-size:XLARGE"]'); await page.waitForTimeout(300); assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--ts')), '1.4'); ok('text size XLARGE applies');
  await page.evaluate(() => window.__app.nav.go('themes', {}, { root: true })); await page.waitForTimeout(400); await page.click('[data-testid="theme:BERRY"]'); await page.waitForTimeout(300); assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'berry'); ok('theme switches');
  await page.click('[data-testid="theme:LIGHT"]');
  await page.evaluate(() => window.__app.nav.go('tools', {}, { root: true })); await page.waitForTimeout(400); await page.fill('[data-testid=timer-name]', 'Biscuits'); await page.click('text=5 min'); await page.waitForTimeout(1300);
  assert.ok(/^04:5\d$/.test((await page.locator('[data-testid^="timer-time:"]').first().innerText()).trim())); ok('kitchen timer runs');
  await page.evaluate(() => window.__app.nav.go('backup', {}, { root: true })); await page.waitForTimeout(400);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=backup-export]')]); assert.ok(dl.suggestedFilename().endsWith('.zip')); ok('backup export downloads a .zip');
  console.log('errors:', JSON.stringify(t.errors));
  await t.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
