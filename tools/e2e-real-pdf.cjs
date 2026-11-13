// Stage 4 for the owner's real PDF: import it through the app's own code in a phone-size browser and check the real Recipe Rescue screen
// against the correct result, word for word. Needs the private PDF (tests/private/veg-all.pdf or TR_REAL_PDF), Playwright and poppler.
//   node tools/e2e-real-pdf.cjs [outdir]
// The native bridge (PDFKit/Vision) is replaced by poppler's answer for the same file (words with positions, plain text) and by pdftoppm for
// the page picture; everything after the bridge is the app's own code. What PDFKit itself returns can only be read on a device.
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
(async () => {
  const pdf = process.env.TR_REAL_PDF || path.join(__dirname, '..', 'tests', 'private', 'veg-all.pdf');
  if (!fs.existsSync(pdf)) { console.log('SKIPPED: real PDF not present (tests/private/veg-all.pdf or TR_REAL_PDF)'); process.exit(0); }
  const outDir = process.argv[2] || null; if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const expected = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'real-pdf', 'veg-all.expected.json'), 'utf8'));
  const { bridgeAnswer } = await import('./pdf-stages.mjs');
  const { serve } = await import('./serve.mjs'); const srv = await serve(0); const port = srv.address().port;
  const browser = await chromium.launch(); const ok = (m) => console.log('ok  -', m);
  const calls = []; const errors = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-pdf-'));
  execFileSync('pdftoppm', ['-jpeg', '-r', '130', '-f', '1', '-l', '1', pdf, path.join(tmp, 'page')]);
  const pageJpeg = fs.readdirSync(tmp).filter((f) => f.endsWith('.jpg')).map((f) => fs.readFileSync(path.join(tmp, f)).toString('base64'))[0];

  for (const theme of ['DARK', 'LIGHT']) {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await c.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.exposeFunction('__bridge', async (method, args) => {
      calls.push(`${method}${args.forceOcr ? ':picture' : ''}`);
      if (method === 'recognizePdf') { if (args.forceOcr) throw new Error('picture reading was requested'); return bridgeAnswer(pdf); }
      if (method === 'renderPdfPage') return { image: pageJpeg };
      throw new Error('unsupported');
    });
    await page.addInitScript(() => { window.Capacitor = { isNativePlatform: () => false, isPluginAvailable: (n) => n === 'TouchRecipeOcr', Plugins: { TouchRecipeOcr: {
      recognizePdf: (a) => window.__bridge('recognizePdf', { forceOcr: !!a.forceOcr }), renderPdfPage: () => window.__bridge('renderPdfPage', {}), recognizeImage: () => Promise.reject(new Error('no photo in this test')) } } }; });
    await page.goto(`http://localhost:${port}/`); await page.waitForFunction(() => window.__app, null, { timeout: 15000 });
    await page.evaluate((t) => { window.__app.ctx.prefs.welcomeSeen = true; window.__app.ctx.prefs.setTheme(t); }, theme); await page.waitForTimeout(1000);

    // import the real PDF the way the app does
    const b64 = fs.readFileSync(pdf).toString('base64');
    const draft = await page.evaluate(async (b64) => {
      const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      const file = new File([a], 'Veg-All Chicken Pot Pie Recipe - Food.com.pdf', { type: 'application/pdf' });
      const { ctx, nav } = window.__app;
      const d = await ctx.importer.import({ type: 'pdf', file }, () => {});
      ctx.importSession.draft = d; nav.go('rescue', {});
      return { title: d.recipe.title, ing: d.recipe.ingredients.map((i) => i.text), dir: d.recipe.directions.map((x) => x.text), notes: d.recipe.notes, sourceKind: d.source.kind, files: d.source.files.length, cleaned: d.source.cleaned.length, text: d.source.text };
    }, b64);
    await page.waitForTimeout(1500);
    assert.deepEqual(draft.ing, expected.ingredients, `${theme}: parsed ingredients`); assert.deepEqual(draft.dir, expected.directions, `${theme}: parsed directions`);
    assert.equal(draft.title, expected.title); ok(`${theme}: the app's import of the real PDF gives the exact title, ingredients and directions`);
    assert.ok(!calls.some((x) => x.includes('picture')), 'picture reading never requested'); ok(`${theme}: the PDF's own text was read; picture reading was never asked for (${calls.join(', ')})`);

    // STAGE 4: what the Recipe Rescue screen actually shows
    const tid = (id) => page.locator(`[data-testid="${id}"]`);
    const screen = await page.evaluate(() => ({
      title: document.querySelector('[data-testid="field-title"] .sp-text')?.textContent || '',
      ing: [...document.querySelectorAll('[data-testid="ing-line"] .sp-text')].map((e) => e.firstChild ? e.firstChild.textContent : ''),
      dir: [...document.querySelectorAll('[data-testid="dir-line"] .sp-text')].map((e) => e.firstChild ? e.firstChild.textContent : ''),
      marked: document.querySelectorAll('[data-review]').length, hasCount: !!document.querySelector('[data-testid="review-count"]'),
    }));
    assert.equal(screen.title.replace(/^Title\s*/, ''), expected.title, `${theme}: the title on screen`);
    assert.deepEqual(screen.ing, expected.ingredients, `${theme}: ingredient cards show exactly the parsed ingredients`);
    assert.deepEqual(screen.dir, expected.directions.map((d, i) => `${i + 1}. ${d}`), `${theme}: step cards show exactly the parsed steps, numbered in order`);
    assert.equal(screen.marked, 0, 'no card is marked "Check this line"'); assert.ok(!screen.hasCount, 'no "lines to check" banner');
    ok(`${theme}: the Rescue screen shows ${screen.ing.length} ingredient cards and ${screen.dir.length} step cards, word for word, none marked`);

    const emptyHeadings = await page.evaluate(() => [...document.querySelectorAll('.sp-sec')].filter((sec) => sec.querySelector(':scope > .sp-h2') && sec.children.length < 2).map((sec) => sec.querySelector('.sp-h2').textContent));
    assert.deepEqual(emptyHeadings, [], `${theme}: no heading without content under it`);
    // nothing hidden: every card shows its whole text, nothing sits under the buttons, nothing scrolls sideways, every line can be scrolled to
    const geo = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="rescue-body"]'), f = document.querySelector('[data-testid="rescue-foot"]');
      const cards = [...b.querySelectorAll('.sp-line')];
      const clipped = cards.filter((l) => l.scrollWidth > l.clientWidth + 1 || l.querySelector('.sp-text').scrollHeight > l.clientHeight + 1).length;
      let underButtons = 0, reached = new Set(); const fr = f.getBoundingClientRect();
      for (let k = 0; k <= 20; k++) { b.scrollTop = (b.scrollHeight - b.clientHeight) * (k / 20); const br = b.getBoundingClientRect();
        cards.forEach((l, i) => { const r = l.getBoundingClientRect(); if (r.top >= br.top - 0.5 && r.bottom <= br.bottom + 0.5) reached.add(i); });
        for (let y = fr.top + 2; y < fr.bottom - 2; y += 6) for (let x = 8; x < innerWidth - 8; x += 24) { const e = document.elementFromPoint(x, y); if (e && e.closest('.sp-line')) underButtons++; } }
      return { clipped, underButtons, reached: reached.size, cards: cards.length, sideways: document.documentElement.scrollWidth > innerWidth + 1, footTop: fr.top, bodyBottom: b.getBoundingClientRect().bottom };
    });
    assert.equal(geo.clipped, 0, `${theme}: no card clips its text`); assert.equal(geo.underButtons, 0, `${theme}: no card under the buttons`);
    assert.equal(geo.reached, geo.cards, `${theme}: every card can be scrolled fully into view (${geo.reached}/${geo.cards})`); assert.ok(!geo.sideways); assert.ok(geo.footTop >= geo.bodyBottom - 0.5);
    ok(`${theme}: every one of the ${geo.cards} cards is fully visible when scrolled to; nothing is clipped, covered, or off to the side`);

    // the Original tab: the kept page picture and the kept text, including the other recipe
    await tid('tab-original').click(); await page.waitForTimeout(600);
    const orig = await page.evaluate(() => ({ imgs: document.querySelectorAll('[data-testid="original-image"]').length, lines: [...document.querySelectorAll('[data-testid="orig-line"]')].map((e) => e.textContent) }));
    const broken = await page.evaluate(() => [...document.querySelectorAll('[data-testid="original-image"]')].filter((i) => !i.complete || i.naturalWidth === 0).length);
    assert.equal(broken, 0, `${theme}: every picture in the Original tab loads (no broken image)`);
    assert.ok(orig.imgs >= 1, `${theme}: the page picture is kept and shown`);
    const joined = orig.lines.join('\n');
    const note = await page.locator('[data-testid="read-note"]').textContent(); assert.match(note, /Read from the PDF's own text with positions \(286 pieces\)/, `${theme}: the Original tab says how the file was read`);
    for (const ing of ['VEG-ALL CHICKEN POT PIE', 'BOURBON CHICKEN', 'Another recipe on the same page']) assert.ok(joined.includes(ing), `${theme}: Original keeps "${ing}"`);
    ok(`${theme}: the Original tab shows the PDF page picture and all ${orig.lines.length} text lines, including the other recipe`);

    if (outDir) {
      await tid('tab-recipe').click(); await page.waitForTimeout(400);
      const body = '[data-testid="rescue-body"]';
      await page.evaluate((b) => { document.querySelector(b).scrollTop = 0; }, body); await page.screenshot({ path: path.join(outDir, `rescue-${theme.toLowerCase()}-1-top.png`) });
      await page.evaluate((b) => { const e = document.querySelector(b); e.scrollTop = e.scrollHeight * 0.45; }, body); await page.screenshot({ path: path.join(outDir, `rescue-${theme.toLowerCase()}-2-middle.png`) });
      await page.evaluate((b) => { const e = document.querySelector(b); e.scrollTop = e.scrollHeight; }, body); await page.screenshot({ path: path.join(outDir, `rescue-${theme.toLowerCase()}-3-bottom.png`) });
      await tid('tab-original').click(); await page.waitForTimeout(500); await page.screenshot({ path: path.join(outDir, `rescue-${theme.toLowerCase()}-4-original.png`) });
      fs.writeFileSync(path.join(outDir, `screen-${theme.toLowerCase()}.json`), JSON.stringify({ screen, draft: { ing: draft.ing, dir: draft.dir, notes: draft.notes } }, null, 2));
    }
    await c.close();
  }
  await browser.close(); srv.close();
  assert.deepEqual(errors, [], 'no console errors'); console.log('real-PDF rescue e2e passed');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
