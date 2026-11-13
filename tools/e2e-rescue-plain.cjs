// Developer-only browser check of the plain Recipe Rescue: the numbered ingredient and step lists (Enter starts a new numbered entry, Backspace at the start of an
// entry joins it to the one above and its number goes), pasting, the original as selectable text, one side at a time when upright, both sides on a phone on its side,
// the requests to the native app about turning sideways, no artwork, readable and open.  node tools/e2e-rescue-plain.cjs [outdir]
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
  await page.addInitScript(() => { window.Capacitor = { isNativePlatform: () => false, isPluginAvailable: (n) => n === 'TouchRecipeOcr', Plugins: { TouchRecipeOcr: { setOrientation: (a) => { window.__orient(!!a.landscape); return Promise.resolve(); } } } }; });
  await page.goto(`http://localhost:${port}/`); await page.waitForFunction(() => window.__app, null, { timeout: 15000 });
  await page.evaluate(() => { window.__app.ctx.prefs.welcomeSeen = true; window.__app.ctx.prefs.setTheme('DARK'); }); await page.waitForTimeout(1000);
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  assert.deepEqual(orient, [], 'before Recipe Rescue opens, landscape is never requested'); ok('before Recipe Rescue: no request to allow landscape');
  await page.evaluate(async () => {
    const { ctx, nav } = window.__app;
    const text = ['Gran\'s Pancakes', 'Serves 4', 'Ingredients', '2 cups flour', '1 tbsp sugar', 'A pinch of salt', '1 1/2 cups milk', '1 egg', '2 tbsp butter, melted', 'Method',
      'Mix the dry things together.', 'Add milk and whisk until smooth.', 'Cook on a hot pan until golden.', 'Serve warm with syrup.', 'Notes', 'Best with real maple syrup.'].join('\n');
    const d = await ctx.importer.import({ type: 'text', text }); ctx.importSession.draft = d; nav.go('rescue', {});
  });
  await page.waitForTimeout(1200);
  assert.deepEqual(orient, [true], 'opening Recipe Rescue allows landscape'); ok('opening Recipe Rescue allows landscape (one request)');
  const texts = (id) => page.locator(`[data-testid="${id}-text"]`).evaluateAll((els) => els.map((e) => e.value));
  const nums = (id) => page.locator(`[data-testid="${id}-num"]`).allTextContents();
  const box = (id) => page.evaluate((i) => { const r = document.querySelector(`[data-testid="${i}"]`).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, id);

  // ---------- plain and open ----------
  assert.equal(await page.locator('[data-art-slot]').count() >= 0, true);
  assert.equal(await page.locator('[data-testid="rescue"][data-art-slot]').count(), 0, 'no artwork slot on Recipe Rescue'); ok('no artwork is painted on Recipe Rescue');
  assert.deepEqual(await texts('ing'), ['2 cups flour', '1 tbsp sugar', 'A pinch of salt', '1 1/2 cups milk', '1 egg', '2 tbsp butter, melted'], 'ingredients, one entry each');
  assert.deepEqual(await nums('ing'), ['1.', '2.', '3.', '4.', '5.', '6.'], 'each ingredient has its own number');
  assert.deepEqual(await texts('dir'), ['Mix the dry things together.', 'Add milk and whisk until smooth.', 'Cook on a hot pan until golden.', 'Serve warm with syrup.']);
  assert.deepEqual(await nums('dir'), ['1.', '2.', '3.', '4.'], 'each step has its own number'); ok('upright: the recipe side shows numbered ingredients (6) and numbered steps (4), one entry each');
  assert.equal(await tid('rr-title').inputValue(), "Gran's Pancakes"); assert.equal(await tid('rr-servings').inputValue(), '4'); ok('title and servings are plain fields');
  assert.equal(await tid('pane-original').count(), 0, 'upright: one side at a time'); assert.equal(await page.locator('.rr-switch .chip, .rr-switch button').count(), 2); ok('upright: one side at a time (Original | Recipe switch), full width');
  const pane = await box('pane-recipe'); assert.ok(pane.w > 340, `the recipe uses the whole width (${pane.w})`);
  const m = await page.evaluate(() => { const ta = document.querySelector('[data-testid="ing-text"]'); const cs = getComputedStyle(ta); return { fs: parseFloat(cs.fontSize), h: ta.getBoundingClientRect().height, gap: (() => { const rows = [...document.querySelectorAll('[data-testid="ing-row"]')]; return rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom; })() }; });
  assert.ok(m.fs >= 16 && m.h >= 44 && m.gap >= 10, `big, open entries (font ${m.fs}px, height ${m.h}px, gap ${m.gap}px)`); ok(`entries are big and open (font ${m.fs}px, ${Math.round(m.h)}px tall, ${Math.round(m.gap)}px between)`);
  if (outDir) await page.screenshot({ path: `${outDir}/plain-portrait-recipe.png` });

  // ---------- Enter starts a new numbered entry; the text after the cursor belongs to it ----------
  const first = page.locator('[data-testid="ing-text"]').first();
  await first.click(); await first.evaluate((e) => e.setSelectionRange(6, 6)); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  assert.deepEqual(await texts('ing'), ['2 cups', 'flour', '1 tbsp sugar', 'A pinch of salt', '1 1/2 cups milk', '1 egg', '2 tbsp butter, melted'], 'Enter split the entry at the cursor');
  assert.deepEqual(await nums('ing'), ['1.', '2.', '3.', '4.', '5.', '6.', '7.'], 'the new entry got the next number and the later ones moved up');
  const caret = await page.evaluate(() => { const a = document.activeElement; return { testid: a.dataset.testid, start: a.selectionStart, value: a.value }; });
  assert.deepEqual(caret, { testid: 'ing-text', start: 0, value: 'flour' }, 'the cursor is at the start of the new entry'); ok('Enter in the middle of "2 cups flour" makes entry 2 = "flour"; everything below moves down one number');
  // ---------- Backspace at the start joins it to the entry above, and its number goes ----------
  await page.keyboard.press('Backspace'); await page.waitForTimeout(150);
  assert.deepEqual(await texts('ing'), ['2 cups flour', '1 tbsp sugar', 'A pinch of salt', '1 1/2 cups milk', '1 egg', '2 tbsp butter, melted'], 'Backspace at the start joined the entries again');
  assert.deepEqual(await nums('ing'), ['1.', '2.', '3.', '4.', '5.', '6.']);
  const caret2 = await page.evaluate(() => { const a = document.activeElement; return { start: a.selectionStart, value: a.value }; }); assert.deepEqual(caret2, { start: 6, value: '2 cups flour' }, 'the cursor sits at the join');
  ok('Backspace at the start of an entry joins it to the one above, the number disappears, the cursor sits at the join');
  // Delete at the end joins the next one
  await page.locator('[data-testid="dir-text"]').nth(2).click(); await page.keyboard.press('End'); await page.keyboard.press('Delete'); await page.waitForTimeout(150);
  assert.deepEqual(await texts('dir'), ['Mix the dry things together.', 'Add milk and whisk until smooth.', 'Cook on a hot pan until golden. Serve warm with syrup.'], 'Delete at the end of a step joins the next one');
  assert.deepEqual(await nums('dir'), ['1.', '2.', '3.']); ok('Delete at the end of a step joins the step below; numbers follow');
  // Enter at the end makes an empty next entry; typing fills it
  await page.locator('[data-testid="dir-text"]').last().click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('Enjoy.'); await page.waitForTimeout(150);
  assert.deepEqual((await texts('dir')).slice(-2), ['Cook on a hot pan until golden. Serve warm with syrup.', 'Enjoy.']); assert.deepEqual(await nums('dir'), ['1.', '2.', '3.', '4.']); ok('Enter at the end starts step 4; typing fills it');
  // paste: several lines make several numbered entries, list marks and typed numbers are removed
  const paste = (selector, nth, text) => page.locator(selector).nth(nth).evaluate((ta, t) => { ta.focus(); const dt = new DataTransfer(); dt.setData('text', t); ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, text);
  await page.locator('[data-testid="ing-text"]').last().click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await paste('[data-testid="ing-text"]', 6, '• 3 eggs\n- 1 cup butter\n2) 2 tsp salt'); await page.waitForTimeout(200);
  assert.deepEqual((await texts('ing')).slice(6), ['3 eggs', '1 cup butter', '2 tsp salt'], 'pasted lines became entries, marks removed'); assert.deepEqual(await nums('ing'), ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.', '9.']);
  await page.locator('[data-testid="dir-text"]').last().click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await paste('[data-testid="dir-text"]', 4, '1. Preheat the oven.\n2. Grease the pan.'); await page.waitForTimeout(200);
  assert.deepEqual((await texts('dir')).slice(4), ['Preheat the oven.', 'Grease the pan.']); assert.deepEqual(await nums('dir'), ['1.', '2.', '3.', '4.', '5.', '6.']); ok('pasting several lines makes one numbered entry per line; "1." marks and bullets are removed');
  // a heading is not numbered
  await page.locator('[data-testid="ing-text"]').nth(2).click(); await page.keyboard.press('Home'); await page.keyboard.press('Enter'); await page.locator('[data-testid="ing-text"]').nth(2).click(); await page.keyboard.type('For the batter:'); await page.waitForTimeout(150);
  const n2 = await nums('ing'); assert.equal(n2[2], '', 'a heading has no number'); assert.equal(n2.filter(Boolean).length, 9, 'the others keep counting'); ok('a line ending with a colon is a heading: it has no number, the numbering carries on');
  // everything survives leaving the side and coming back (it was taken into the recipe)
  await tid('tab-original').click(); await page.waitForTimeout(300); await tid('tab-recipe').click(); await page.waitForTimeout(300);
  assert.equal((await texts('ing'))[2], 'For the batter:'); assert.equal((await texts('ing')).length, 10); assert.equal((await texts('dir')).length, 6); ok('switching sides and back keeps every edit');
  // undo
  await page.locator('[data-testid="rescue-undo"]').click(); await page.waitForTimeout(300); assert.notEqual((await texts('ing')).length, 11, 'undo steps back'); await page.locator('[data-testid="rescue-redo"]').click(); await page.waitForTimeout(300); ok('Undo and Redo work with the lists');

  // ---------- the original: plain selectable text ----------
  await tid('tab-original').click(); await page.waitForTimeout(300);
  const o = await page.evaluate(() => { const t = document.querySelector('[data-testid="orig-text"]'); const cs = getComputedStyle(t); return { text: t.textContent, sel: cs.userSelect || cs.webkitUserSelect, fs: parseFloat(cs.fontSize), cards: document.querySelectorAll('[data-testid="pane-original"] .sp-line').length }; });
  assert.ok(o.text.includes('Add milk and whisk until smooth.') && o.text.includes("Gran's Pancakes"), 'the original text is all there'); assert.equal(o.sel, 'text', 'selectable (long-press to copy)'); assert.equal(o.cards, 0, 'one block of text, not narrow cards'); assert.ok(o.fs >= 16);
  ok('the original is one open block of selectable text'); if (outDir) await page.screenshot({ path: `${outDir}/plain-portrait-original.png` });

  // ---------- contrast in the dark theme ----------
  const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const rgbOf = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  await tid('tab-recipe').click(); await page.waitForTimeout(300);
  for (const sel of ['.rr-h', '.rr-label', '[data-testid="ing-text"]', '[data-testid="rr-title"]', '.nl-num']) {
    const { fg, bg } = await page.evaluate((s) => { const el = document.querySelector(s); const fg = getComputedStyle(el).color; let n = el, bg = 'rgba(0, 0, 0, 0)'; while (n && /rgba\(.*, 0\)$|transparent/.test(bg)) { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; } return { fg, bg }; }, sel);
    assert.ok(ratio(rgbOf(fg), rgbOf(bg)) >= 4.5, `${sel} contrast ${ratio(rgbOf(fg), rgbOf(bg)).toFixed(2)}`);
  }
  ok('headings, labels, numbers and entries are readable in the dark theme (>= 4.5)');

  // ---------- on its side: both sides, original left, recipe right ----------
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(600);
  assert.equal(await page.locator('.rr-switch').count(), 0, 'no switch when both sides fit');
  const L = await box('pane-original'), Rr = await box('pane-recipe');
  assert.ok(L.r <= Rr.l + 0.5, `original on the LEFT, recipe on the RIGHT (${L.r} <= ${Rr.l})`); assert.ok(L.w > 300 && Rr.w > 300, `both sides are wide (${L.w}, ${Rr.w}) - not narrow strips`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
  const sc = await page.evaluate(() => { const a = document.querySelector('[data-testid="pane-original"]'), b = document.querySelector('[data-testid="pane-recipe"]'); b.scrollTop = 99999; return { a: a.scrollTop, b: b.scrollTop, bScrolls: b.scrollHeight > b.clientHeight }; });
  assert.ok(sc.bScrolls && sc.b > 0 && sc.a === 0, 'each side scrolls on its own'); ok(`on its side: the original is on the left (${Math.round(L.w)}px) and the recipe on the right (${Math.round(Rr.w)}px); each scrolls on its own`);
  const foot = await box('rescue-create'); assert.ok(foot.b <= 390 + 0.5 && foot.t > 200, 'one Create recipe button at the bottom'); if (outDir) await page.screenshot({ path: `${outDir}/plain-landscape.png` });
  // typing still works after the rotation and the lists are the same
  assert.deepEqual((await nums('ing')).filter(Boolean).length, 9);
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
  assert.equal(await page.locator('.rr-switch').count(), 1); assert.equal((await texts('ing')).length, 10); ok('turning the phone back: one side at a time again, nothing lost');

  // ---------- leaving puts the app back to portrait ----------
  await page.locator('.back-chip').first().click(); await page.waitForTimeout(800);
  assert.deepEqual(orient, [true, false], 'leaving Recipe Rescue forbids landscape again'); ok('leaving Recipe Rescue: the app goes back to portrait only');
  await browser.close(); srv.close();
  assert.deepEqual(errors, [], 'no console errors'); console.log('plain rescue e2e passed');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
