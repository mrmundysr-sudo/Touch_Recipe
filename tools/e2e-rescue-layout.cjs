// Developer-only browser check of the Recipe Rescue REVIEW layout (screenshots of 2026-11-13): readable in the dark theme, bottom buttons
// never on top of the content, text wraps without clipping, damaged lines are marked.  node tools/e2e-rescue-layout.cjs [outdir]
const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const outDir = process.argv[2] || null;
  const { serve } = await import('./serve.mjs'); const srv = await serve(0); const port = srv.address().port;
  const browser = await chromium.launch();
  const ok = (m) => console.log('ok  -', m);
  const errors = [];
  for (const theme of ['DARK', 'LIGHT']) {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await c.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(`http://localhost:${port}/`); await page.waitForFunction(() => window.__app, null, { timeout: 15000 });
    await page.evaluate((t) => { window.__app.ctx.prefs.welcomeSeen = true; window.__app.ctx.prefs.setTheme(t); }, theme); await page.waitForTimeout(1200);
    // the damaged lines exactly as they appeared in the owner's screenshots
    await page.evaluate(async () => {
      const { ctx, nav } = window.__app;
      const text = ['TP', 'Ingredients', '2', '9 inch) frozen pie', '41/cuplightbrown3sugar2tablespoons1.Editor\'sNote:NamedBou rbonChickenbecauseit lbs', 'cup apple juice', '1 ugarlic clove, cr d 1/teaspoon g', '3/teaspo', '4',
        'Directions', '1. T P', '2. IE Submitted by Chef Teres a 2 "It is really easy to make. I use deep dish pie cr ust. I found this recipe from a co-worker cookbook. It calls for can of Veg-All, I use a bag of frozen mixed veget r 10mins Se ables." Ready In: 1h rves: 4-6 Ingr edients: 8 minutes be',
        '3. DIRECTIONS 1. Co ore serving. INGRED f mbine first IENTS 2 (10 3/4 oun pre ) cream of pot n into ce ato soup 1 ( pared pie crust. 3. Cove r with top crust; cr', '4.', '5. Slit top crust and brush with egg. 5 chicken, d i',
        '6. Bake at 375 d ced egrees for 40 minutes. 1/t', '10. Chicken sold in Chinese carry-outs in my h ometown. This recipe is so good that my sons gobb le itrexcuseupleavingwas methejust a spoonful.ythoughtThei',
        '12. In: 35mins Serv es: 4 Bourbon Chicken because it was supp osedly Ingredients: 11 created by a Chin ese cook wh worked in a restaurant on B o ourbon Street." DI', '13. RECTIO', '15. NS IN bon ess chicken b el reasts, crush 4 red p on epper flake 1 cute into bite-siz eces 1 -2 table pi s poon olive oil she inger'].join('\n');
      // build the draft straight from the lines (the parser alone would already clean some of them): ingredients and steps as shown in the screenshots
      const mod = await import('/js/engine/models.js');
      const ings = ['2', '9 inch) frozen pie', '41/cuplightbrown3sugar2tablespoons1.Editor\'sNote:NamedBou rbonChickenbecauseit lbs', 'cup apple juice', '1 ugarlic clove, cr d 1/teaspoon g', '3/teaspo', '4'];
      const dirs = text.split('\n').slice(10);
      const recipe = mod.Recipe({ title: 'TP', ingredients: ings.map((t) => mod.Ingredient({ text: t })), directions: dirs.map((t) => mod.Direction({ text: t.replace(/^\d+\.\s*/, '') })) });
      ctx.importSession.draft = { recipe, source: { kind: 'PDF', text, files: [], cleaned: [], capturedAt: 1 }, warnings: [], imageCandidates: [] };
      nav.go('rescue', {});
    });
    await page.waitForTimeout(1200);
    const tid = (id) => page.locator(`[data-testid="${id}"]`);
    const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const rgbOf = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    // an element's own text colour against the first non-transparent background behind it
    const colours = (sel) => page.evaluate((s) => {
      const el = document.querySelector(s); const fg = getComputedStyle(el).color; let n = el, bg = 'rgba(0, 0, 0, 0)';
      while (n && /rgba\(.*, 0\)$|transparent/.test(bg)) { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
      return { fg, bg };
    }, sel);

    for (const sel of ['.sp-title', '.sp-h2', '[data-testid="ing-line"] .sp-text', '.sp-check']) {
      const { fg, bg } = await colours(sel); const r = ratio(rgbOf(fg), rgbOf(bg));
      assert.ok(r >= 4.5, `${theme}: ${sel} contrast ${r.toFixed(2)} (text ${fg} on ${bg})`);
    }
    ok(`${theme}: title, headings, cards and check notes all have readable contrast (>= 4.5)`);

    // review markers on the damaged lines, none on clean ones
    const marked = await page.locator('[data-review]').count();
    assert.ok(marked >= 9, `${theme}: damaged lines are marked (${marked})`); ok(`${theme}: ${marked} damaged lines are marked "Check this line"`);
    assert.ok(await tid('review-count').count() === 1, 'a summary says how many lines need a look'); ok(`${theme}: summary of lines to check is shown`);

    // the buttons sit below the scrolling content: scroll to the bottom and nothing is under them
    const geo = await page.evaluate(() => { const b = document.querySelector('[data-testid="rescue-body"]'), f = document.querySelector('[data-testid="rescue-foot"]'); b.scrollTop = b.scrollHeight;
      const br = b.getBoundingClientRect(), fr = f.getBoundingClientRect(); const last = [...b.querySelectorAll('.sp-line')].pop().getBoundingClientRect(); return { bodyBottom: br.bottom, footTop: fr.top, footBottom: fr.bottom, lastBottom: last.bottom, vh: innerHeight }; });
    assert.ok(geo.footTop >= geo.bodyBottom - 0.5, `${theme}: buttons start below the scrolling area (${geo.footTop} >= ${geo.bodyBottom})`);
    assert.ok(geo.lastBottom <= geo.footTop + 0.5, `${theme}: the last line ends above the buttons (${geo.lastBottom} <= ${geo.footTop})`);
    assert.ok(geo.footBottom <= geo.vh + 0.5, 'buttons are on screen');
    ok(`${theme}: the buttons never cover recipe content (last line ends ${Math.round(geo.footTop - geo.lastBottom)}px above them)`);
    // while scrolling, what the browser actually draws inside the button area is the buttons, never a recipe card
    const covered = await page.evaluate(() => { const b = document.querySelector('[data-testid="rescue-body"]'); const f = document.querySelector('[data-testid="rescue-foot"]'); let bad = 0, n = 0;
      for (const frac of [0, 0.25, 0.5, 0.75, 1]) { b.scrollTop = (b.scrollHeight - b.clientHeight) * frac; const r = f.getBoundingClientRect();
        for (let y = r.top + 2; y < r.bottom - 2; y += 6) for (let x = 8; x < innerWidth - 8; x += 24) { n++; const e = document.elementFromPoint(x, y); if (e && e.closest('.sp-line')) bad++; } }
      return { bad, n }; });
    assert.equal(covered.bad, 0, `${theme}: no recipe card is drawn inside the button area (${covered.n} points tested)`); ok(`${theme}: no recipe card is drawn under the buttons at any scroll position (${covered.n} points)`);

    // text wraps: nothing is wider than the screen, no card clips its own text
    const clipped = await page.evaluate(() => [...document.querySelectorAll('.sp-line')].filter((l) => l.scrollWidth > l.clientWidth + 1 || l.querySelector('.sp-text').scrollHeight > l.clientHeight + 1).length);
    assert.equal(clipped, 0, `${theme}: no card clips or overflows`);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.ok(!wide, 'no sideways scrolling'); ok(`${theme}: every card wraps its text; nothing clips or scrolls sideways`);
    const fs = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.sp-line .sp-text')).fontSize));
    assert.ok(fs <= 19, `${theme}: card text is a reasonable size (${fs}px)`); ok(`${theme}: card text ${fs}px`);

    if (outDir) { await page.evaluate(() => { document.querySelector('[data-testid="rescue-body"]').scrollTop = 0; }); await page.screenshot({ path: `${outDir}/rescue-${theme.toLowerCase()}-top.png` });
      await page.evaluate(() => { const b = document.querySelector('[data-testid="rescue-body"]'); b.scrollTop = b.scrollHeight; }); await page.screenshot({ path: `${outDir}/rescue-${theme.toLowerCase()}-bottom.png` }); }
    await c.close();
  }
  await browser.close(); srv.close();
  assert.deepEqual(errors, [], 'no console errors'); console.log('rescue layout e2e passed');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
