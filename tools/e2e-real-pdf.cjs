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
  // stand-in for the native extractPdfImages: poppler lists and extracts the PDF's embedded pictures; a picture that has a soft mask is reported hasMask (like the Swift code)
  const embeddedImages = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-img-'));
    const list = execFileSync('pdfimages', ['-list', pdf], { encoding: 'utf8' }).split('\n').slice(2).map((l) => l.trim().split(/\s+/)).filter((c) => c.length > 10);
    execFileSync('pdfimages', ['-png', pdf, path.join(dir, 'img')]);
    const files = fs.readdirSync(dir).sort(); const masks = new Set(list.filter((c) => c[2] === 'smask').map((c) => `${c[10]} ${c[11]}`));
    return list.map((c, i) => ({ c, i })).filter(({ c }) => c[2] === 'image').map(({ c, i }) => ({ image: fs.readFileSync(path.join(dir, files[i])).toString('base64'), width: +c[3], height: +c[4], page: +c[0] - 1, hasMask: masks.has(`${c[10]} ${c[11]}`) }));
  };
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
      if (method === 'extractPdfImages') return { images: embeddedImages() };
      throw new Error('unsupported');
    });
    await page.addInitScript(() => { window.Capacitor = { isNativePlatform: () => false, isPluginAvailable: (n) => n === 'TouchRecipeOcr', Plugins: { TouchRecipeOcr: {
      recognizePdf: (a) => window.__bridge('recognizePdf', { forceOcr: !!a.forceOcr }), renderPdfPage: () => window.__bridge('renderPdfPage', {}), extractPdfImages: () => window.__bridge('extractPdfImages', {}), recognizeImage: () => Promise.reject(new Error('no photo in this test')) } } }; });
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
      return { photos: { selected: d.photos.selectedId, reason: d.photos.reason, cands: d.photos.candidates.map((c) => [c.id, c.rejected, c.width, c.height, !!c.hasMask]), warn: (d.warnings.find((w) => w.field === 'photo') || {}).message || null }, dishBlob: !!d.dishPhotoBlob, title: d.recipe.title, ing: d.recipe.ingredients.map((i) => i.text), dir: d.recipe.directions.map((x) => x.text), notes: d.recipe.notes, sourceKind: d.source.kind, files: d.source.files.length, cleaned: d.source.cleaned.length, text: d.source.text };
    }, b64);
    await page.waitForTimeout(1500);
    assert.deepEqual(draft.ing, expected.ingredients, `${theme}: parsed ingredients`); assert.deepEqual(draft.dir, expected.directions, `${theme}: parsed directions`);
    assert.equal(draft.title, expected.title); ok(`${theme}: the app's import of the real PDF gives the exact title, ingredients and directions`);
    // the PDF's only picture is the advertisement: it is NOT the recipe photo (the old code cut it off the page picture and used it)
    assert.equal(draft.photos.selected, null, `${theme}: no recipe photo is chosen`); assert.equal(draft.photos.reason, 'only-rejected'); assert.equal(draft.dishBlob, false, 'nothing was cut off the page picture');
    assert.equal(draft.photos.cands.length, 1); assert.deepEqual(draft.photos.cands[0].slice(1), ['banner', 750, 300, true], `${theme}: the advert is found with its true size and mask, and rejected as a banner`);
    assert.match(draft.photos.warn, /advert or a banner/); ok(`${theme}: the PDF's only picture (an advert, 750 x 300, with a mask) is found and NOT used as the recipe photo; the person is told`);
    assert.ok(!calls.some((x) => x.includes('picture')), 'picture reading never requested'); ok(`${theme}: the PDF's own text was read; picture reading was never asked for (${calls.join(', ')})`);

    // STAGE 4: what the plain Recipe Rescue screen actually shows (our side: numbered lists)
    const tid = (id) => page.locator(`[data-testid="${id}"]`);
    const texts = (id) => page.locator(`[data-testid="${id}-text"]`).evaluateAll((els) => els.map((e) => e.value));
    const nums = (id) => page.locator(`[data-testid="${id}-num"]`).allTextContents();
    assert.equal(await page.locator('.rr-photo').count(), 0, `${theme}: no photo is shown on the recipe`); assert.match(await tid('rescue-photo').textContent(), /Add photo/);
    assert.equal(await tid('rr-title').inputValue(), expected.title, `${theme}: the title on screen`);
    assert.equal(await tid('rr-servings').inputValue(), String(expected.servings));
    assert.deepEqual(await texts('ing'), expected.ingredients, `${theme}: the ingredient entries are exactly the parsed ingredients`);
    assert.deepEqual(await nums('ing'), expected.ingredients.map((_, i) => `${i + 1}.`), `${theme}: numbered 1..${expected.ingredients.length}`);
    assert.deepEqual(await texts('dir'), expected.directions, `${theme}: the step entries are exactly the parsed steps`);
    assert.deepEqual(await nums('dir'), expected.directions.map((_, i) => `${i + 1}.`), `${theme}: numbered 1..${expected.directions.length}`);
    assert.equal(await page.locator('[data-testid="review-note"]:visible').count(), 0, 'no entry is marked "Check this line"'); assert.equal(await tid('review-count').count(), 0, 'no "lines to check" banner');
    ok(`${theme}: our side shows the title, ${expected.ingredients.length} numbered ingredients and ${expected.directions.length} numbered steps, word for word, none marked`);

    // nothing hidden: every entry shows its whole text, nothing sideways, every entry can be scrolled fully into view, the Create button is below the content
    const geo = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="pane-recipe"]'); const foot = document.querySelector('[data-testid="rescue-foot"]');
      const entries = [...pane.querySelectorAll('.nl-text')]; const clipped = entries.filter((e) => e.scrollHeight > e.clientHeight + 3).length;
      const reached = new Set(); for (let k = 0; k <= 30; k++) { pane.scrollTop = (pane.scrollHeight - pane.clientHeight) * (k / 30); const pr = pane.getBoundingClientRect(); entries.forEach((e, i) => { const r = e.getBoundingClientRect(); if (r.top >= pr.top - 0.5 && r.bottom <= pr.bottom + 0.5) reached.add(i); }); }
      return { clipped, reached: reached.size, entries: entries.length, sideways: document.documentElement.scrollWidth > innerWidth + 1, footTop: foot.getBoundingClientRect().top, paneBottom: pane.getBoundingClientRect().bottom };
    });
    assert.equal(geo.clipped, 0, `${theme}: no entry clips its text`); assert.equal(geo.reached, geo.entries, `${theme}: every entry can be scrolled fully into view (${geo.reached}/${geo.entries})`); assert.ok(!geo.sideways); assert.ok(geo.footTop >= geo.paneBottom - 0.5);
    ok(`${theme}: all ${geo.entries} entries are fully visible when scrolled to; nothing is clipped or off to the side`);
    const emptyHeads = await page.evaluate(() => [...document.querySelectorAll('.rr-group')].filter((g) => g.querySelector(':scope > .rr-label') && g.children.length < 2).map((g) => g.textContent)); assert.deepEqual(emptyHeads, [], `${theme}: no heading without content`);

    // the Original side: the kept page picture and the kept text, including the other recipe
    await tid('tab-original').click(); await page.waitForTimeout(600);
    const orig = await page.evaluate(() => ({ imgs: document.querySelectorAll('[data-testid="original-image"]').length, text: document.querySelector('[data-testid="orig-text"]')?.textContent || '' }));
    const broken = await page.evaluate(() => [...document.querySelectorAll('[data-testid="original-image"]')].filter((i) => !i.complete || i.naturalWidth === 0).length);
    assert.equal(broken, 0, `${theme}: every picture on the original side loads (no broken image)`); assert.ok(orig.imgs >= 1, `${theme}: the page picture is kept and shown`);
    const note = await page.locator('[data-testid="read-note"]').textContent(); assert.match(note, /Read from the PDF's own text with positions \(286 pieces\)/, `${theme}: the original side says how the file was read`);
    for (const word of ['VEG-ALL CHICKEN POT PIE', 'BOURBON CHICKEN', 'Another recipe on the same page', '1/2 teaspoon black pepper']) assert.ok(orig.text.includes(word), `${theme}: the original text keeps "${word}"`);
    ok(`${theme}: the original side shows the real page picture and its whole text (${orig.text.split('\n').length} lines), including the other recipe`);

    // on its side: the original on the left, our recipe on the right, both wide
    await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(600);
    const L = await page.evaluate(() => { const a = document.querySelector('[data-testid="pane-original"]').getBoundingClientRect(), b = document.querySelector('[data-testid="pane-recipe"]').getBoundingClientRect(); return { al: a.left, ar: a.right, bl: b.left, br: b.right, bw: b.width, aw: a.width }; });
    assert.ok(L.ar <= L.bl + 0.5 && L.aw > 300 && L.bw > 300, `${theme}: original left, recipe right, both wide (${Math.round(L.aw)} / ${Math.round(L.bw)})`);
    assert.deepEqual(await texts('ing'), expected.ingredients, 'the same entries on its side'); ok(`${theme}: on its side the original is on the left and the recipe on the right, each ${Math.round(L.aw)}px wide`);
    if (outDir) { await page.screenshot({ path: path.join(outDir, `rescue-${theme.toLowerCase()}-landscape.png`) }); }
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
    if (outDir) {
      await tid('tab-recipe').click(); await page.waitForTimeout(400);
      const body = '[data-testid="pane-recipe"]';
      await page.evaluate((b) => { document.querySelector(b).scrollTop = 0; }, body); await page.screenshot({ path: path.join(outDir, `rescue-${theme.toLowerCase()}-1-top.png`) });
      await page.evaluate((b) => { const e = document.querySelector(b); e.scrollTop = e.scrollHeight * 0.4; }, body); await page.screenshot({ path: path.join(outDir, `rescue-${theme.toLowerCase()}-2-middle.png`) });
      await page.evaluate((b) => { const e = document.querySelector(b); e.scrollTop = e.scrollHeight; }, body); await page.screenshot({ path: path.join(outDir, `rescue-${theme.toLowerCase()}-3-bottom.png`) });
      await tid('tab-original').click(); await page.waitForTimeout(500); await page.screenshot({ path: path.join(outDir, `rescue-${theme.toLowerCase()}-4-original.png`) });
      fs.writeFileSync(path.join(outDir, `screen-${theme.toLowerCase()}.json`), JSON.stringify({ ingredients: await (async () => { await tid('tab-recipe').click(); await page.waitForTimeout(300); return texts('ing'); })(), steps: await texts('dir') }, null, 2));
    }
    await c.close();
  }
  await browser.close(); srv.close();
  assert.deepEqual(errors, [], 'no console errors'); console.log('real-PDF rescue e2e passed');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
