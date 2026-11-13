// Developer-only browser check of the recipe photo: the framing editor (fixed frame, the whole picture behind it, drag / pinch / wheel / slider, Reset, Replace),
// the framing saved with the recipe and applied on the other screens, the picker (adverts and banners listed apart, never chosen), the "check it" notice for a photo
// chosen automatically, and web pictures judged one by one.  node tools/e2e-photo.cjs [outdir]
const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const outDir = process.argv[2] || null;
  const { serve } = await import('./serve.mjs'); const srv = await serve(0); const port = srv.address().port;
  const browser = await chromium.launch(); const ok = (m) => console.log('ok  -', m); const errors = [];
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: false });
  const page = await c.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(() => { window.Capacitor = { isNativePlatform: () => false, isPluginAvailable: (n) => n === 'TouchRecipeOcr', Plugins: { TouchRecipeOcr: { recognizeImage: async () => ({ text: 'Pie\nIngredients\n2 cups flour\n1 egg\n3 tbsp butter\nDirections\n1. Mix it well.\n2. Bake until golden.' }) } } }; });
  await page.goto(`http://localhost:${port}/`); await page.waitForFunction(() => window.__app, null, { timeout: 15000 });
  await page.evaluate(() => { window.__app.ctx.prefs.welcomeSeen = true; window.__app.ctx.prefs.setTheme('DARK'); }); await page.waitForTimeout(1000);
  const tid = (id) => page.locator(`[data-testid="${id}"]`);

  // pictures drawn for the test: a 1600 x 1000 "dish" (four coloured quarters with a dot, so a crop is visible), a colourful 900 x 700, a banner, a tiny one
  await page.evaluate(() => {
    window.__blob = (w, h, kind) => new Promise((res) => {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
      if (kind === 'flat') { g.fillStyle = '#c33'; g.fillRect(0, 0, w, h); } else {
        const cols = ['#d33', '#3a3', '#33d', '#dd3']; for (let q = 0; q < 4; q++) { g.fillStyle = cols[q]; g.fillRect((q % 2) * w / 2, Math.floor(q / 2) * h / 2, w / 2, h / 2); }
        for (let i = 0; i < 30; i++) { g.fillStyle = `hsl(${i * 12},80%,50%)`; g.beginPath(); g.arc((i * 97) % w, (i * 53) % h, Math.min(w, h) / 14, 0, 7); g.fill(); }
      }
      cv.toBlob(res, 'image/jpeg', 0.9);
    });
  });
  const setup = (extra = '') => page.evaluate(async (extra) => {
    const { ctx, nav } = window.__app; const blob = await window.__blob(1600, 1000, 'dish'); const name = await ctx.photos.saveBlob(blob);
    const d = await ctx.importer.import({ type: 'text', text: 'Gran\'s Pancakes\nIngredients\n2 cups flour\n1 egg\nMethod\nMix it.\nBake it.' });
    d.recipe = { ...d.recipe, photo: name }; ctx.importSession.draft = d; ctx.importSession.photoFile = name; ctx.importSession.photoChecked = false;
    if (extra === 'candidates') {
      const { choose } = await import('/js/engine/photopick.js');
      ctx.importSession.photos = choose([{ id: 'ad', label: 'Picture 1 in the PDF (750 × 300)', source: 'pdf', order: 0, width: 750, height: 300, hasMask: true, blob: await window.__blob(750, 300, 'flat') },
        { id: 'good', label: 'Picture 2 in the PDF (900 × 700)', source: 'pdf', order: 1, width: 900, height: 700, blob: await window.__blob(900, 700, 'dish') }]);
    }
    nav.go('rescue', {}); return name;
  }, extra);
  const rect = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
  const imgRect = () => rect('[data-testid="pe-img"]'), frameRect = () => rect('[data-testid="pe-frame"]');
  const setZoom = async (z) => { await tid('pe-zoom').evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, z); await page.waitForTimeout(80); };
  const drag = async (dx, dy) => { const s = await rect('[data-testid="pe-stage"]'); const x = s.l + s.w / 2, y = s.t + s.h / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 }); await page.mouse.move(x + dx, y + dy, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(80); };
  const covers = async () => { const i = await imgRect(), f = await frameRect(); return i.l <= f.l + 0.6 && i.t <= f.t + 0.6 && i.r >= f.r - 0.6 && i.b >= f.b - 0.6; };

  // ---------- the editor ----------
  await setup(); await page.waitForTimeout(1200);
  assert.equal(await tid('rescue-photo').count(), 1); assert.match(await tid('rescue-photo').textContent(), /Adjust photo/);
  await tid('rescue-photo').click(); await page.waitForTimeout(700);
  assert.equal(await tid('pe-stage').count(), 1, 'the editor opens'); await page.waitForFunction(() => document.querySelector('[data-testid="pe-img"]').naturalWidth > 0);
  const f0 = await frameRect(), i0 = await imgRect(); assert.ok(Math.abs(f0.w / f0.h - 1.6) < 0.01, 'the frame has a fixed 16:10 shape'); assert.ok(await covers(), 'the picture covers the frame');
  assert.ok(Math.abs(i0.w - f0.w) < 1 && Math.abs(i0.h - f0.h) < 1, 'at zoom 1 the picture just fills the frame'); ok('the editor shows a fixed 16:10 frame with the picture exactly covering it at zoom 1');
  await drag(80, 40); const i1 = await imgRect(); assert.ok(Math.abs(i1.l - i0.l) < 1, 'at zoom 1 there is nothing to move');
  await setZoom(2); const i2 = await imgRect(), f2 = await frameRect(); assert.ok(Math.abs(i2.w - 2 * f2.w) < 2, `zoom 2 doubles the picture (${i2.w} vs ${f2.w})`); assert.ok(Math.abs(f2.w - f0.w) < 0.5 && Math.abs(f2.l - f0.l) < 0.5, 'the frame itself never moves or changes size');
  assert.ok(i2.w > f2.w + 20 && i2.h > f2.h + 20, 'the whole picture is behind the frame, larger than it'); assert.ok(await covers());
  await drag(-60, -30); const i3 = await imgRect(); assert.ok(i3.l < i2.l - 40 && i3.t < i2.t - 15, 'dragging moves the picture under the frame'); assert.ok(await covers(), 'and never leaves an empty edge');
  await drag(-9999 > -2000 ? -2000 : -2000, 0); assert.ok(await covers(), 'dragging far stops at the edge'); ok('zoom and pan: the frame stays put, the picture moves under it, the whole picture is visible behind, no empty edges');
  await page.mouse.move((await frameRect()).l + 50, (await frameRect()).t + 40); await page.mouse.wheel(0, -300); await page.waitForTimeout(100); assert.ok(parseFloat(await tid('pe-zoom').inputValue()) > 2, 'the mouse wheel zooms');
  await tid('pe-out').click(); await tid('pe-in').click(); await tid('pe-in').click(); await page.waitForTimeout(80); assert.ok(parseFloat(await tid('pe-zoom').inputValue()) > 2.2, 'the + and - buttons zoom'); ok('wheel and + / - zoom too');
  if (outDir) await page.screenshot({ path: `${outDir}/photo-editor.png` });
  await tid('pe-reset').click(); await page.waitForTimeout(100); const ir = await imgRect(), fr = await frameRect(); assert.ok(Math.abs(ir.w - fr.w) < 1 && parseFloat(await tid('pe-zoom').inputValue()) === 1, 'Reset puts the framing back'); ok('Reset');
  await setZoom(2.5); await drag(-70, -40); const saved = await imgRect();
  await tid('pe-done').click(); await page.waitForTimeout(500);
  const framed = await page.evaluate(() => { const box = document.querySelector('.rr-photo'), img = box.querySelector('img'); return { bw: box.clientWidth, iw: parseFloat(img.style.width), left: parseFloat(img.style.left) }; });
  assert.ok(framed.iw > framed.bw * 2.4 && framed.left < 0, `the recipe shows the framed part (${JSON.stringify(framed)})`); ok('Done: the recipe photo shows only the framed part');

  // ---------- saved with the recipe: reopen later, other screens ----------
  await page.locator('.back-chip').first().click(); await page.waitForTimeout(700);
  await page.evaluate(() => window.__app.nav.go('unfinished', {})); await page.waitForTimeout(700); await tid('unfinished-continue').click(); await page.waitForTimeout(1000);
  await tid('rescue-photo').click(); await page.waitForTimeout(700); await page.waitForFunction(() => document.querySelector('[data-testid="pe-img"]').naturalWidth > 0);
  assert.ok(Math.abs(parseFloat(await tid('pe-zoom').inputValue()) - 2.5) < 0.01, 'the framing was saved with the draft and comes back'); const again = await imgRect(); assert.ok(Math.abs(again.w - saved.w) < 3 && Math.abs(again.l - saved.l) < 3, 'the same part is framed'); ok('the framing is saved with the recipe and reopens exactly as it was');
  await tid('pe-done').click(); await page.waitForTimeout(400);
  await tid('rescue-create').click(); await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.__app.nav.current.name), 'detail');
  const det = await page.evaluate(() => { const box = document.querySelector('.sp-photo'), img = box && box.querySelector('img'); return img ? { bw: box.clientWidth, iw: parseFloat(img.style.width), left: parseFloat(img.style.left) } : null; });
  assert.ok(det && det.iw > det.bw * 2 && det.left <= 0, `the recipe page uses the framing (${JSON.stringify(det)})`);
  const recipeId = await page.evaluate(() => window.__app.nav.current.params.id);
  const stored = await page.evaluate(async (id) => { const r = await window.__app.ctx.repo.getRecipe(id); return r.photoFrame; }, recipeId); assert.ok(stored && Math.abs(stored.zoom - 2.5) < 0.01, JSON.stringify(stored)); ok('the saved recipe stores the framing; its page shows the framed part');
  await page.evaluate(() => window.__app.nav.go('collection', {})); await page.waitForTimeout(700);
  const card = await page.evaluate(() => { const box = document.querySelector('.rcard .photo'), img = box && box.querySelector('img'); return img ? { bw: box.clientWidth, iw: parseFloat(img.style.width) } : null; }); assert.ok(card && card.iw > card.bw, 'the collection card uses it too (a different shape, same framing)'); ok('the collection card uses the same framing in its own shape');
  // adjust later from the recipe page, Reset, Done -> default framing stored
  await page.evaluate((id) => window.__app.nav.go('detail', { id }), recipeId); await page.waitForTimeout(800); await page.locator('.sp-photo').first().click().catch(() => {});
  await page.waitForTimeout(500);
  if (await tid('pe-stage').count() === 0) { await page.locator('[data-testid="photo-change"], [aria-label*="photo" i]').first().click().catch(() => {}); await page.waitForTimeout(500); }
  if (await tid('pe-stage').count()) { await tid('pe-reset').click(); await tid('pe-done').click(); await page.waitForTimeout(500);
    assert.equal(await page.evaluate(async (id) => (await window.__app.ctx.repo.getRecipe(id)).photoFrame, recipeId), null, 'Reset + Done stores the default framing (null)'); ok('adjusting later from the recipe page: Reset + Done returns to the default framing'); }

  // ---------- Replace, the picker, adverts ----------
  await setup('candidates'); await page.waitForTimeout(1200);
  assert.equal(await tid('photo-check').count(), 1, 'a photo chosen automatically from a PDF is flagged for a check');
  await tid('rescue-photo').click(); await page.waitForTimeout(600); await tid('pe-replace').click(); await page.waitForTimeout(600);
  assert.equal(await page.locator('[data-testid="pp-good"] [data-testid="pp-thumb"]').count(), 1, 'one real photo is offered'); assert.equal(await page.locator('[data-testid="pp-other"] [data-testid="pp-thumb"]').count(), 1, 'the advert is listed apart');
  assert.match(await page.locator('[data-testid="pp-other"] .pp-note').textContent(), /banner or an advert/); assert.equal(await page.locator('[data-testid="pp-good"] [data-cand="ad"]').count(), 0);
  assert.equal(await page.evaluate(() => window.__app.ctx.importSession.photos.selectedId), 'good', 'only the real photo was ever chosen'); if (outDir) await page.screenshot({ path: `${outDir}/photo-picker.png` });
  const before = await page.evaluate(() => document.querySelector('.rr-photo img') && document.querySelector('.rr-photo img').src);
  await page.locator('[data-testid="pp-good"] [data-testid="pp-thumb"]').click(); await page.waitForTimeout(900);
  assert.equal(await tid('pe-stage').count(), 1, 'after choosing, the editor opens so the framing can be adjusted'); await tid('pe-done').click(); await page.waitForTimeout(500);
  const after = await page.evaluate(() => document.querySelector('.rr-photo img').src); assert.notEqual(after, before, 'the photo was replaced'); ok('Replace: the picker lists the real photo, keeps the advert apart (labelled), and the chosen picture opens in the editor');
  assert.equal(await tid('photo-check').count(), 0, 'once the person has chosen and approved a photo, the notice goes'); ok('a photo chosen automatically carries a "check it" notice until it is adjusted, replaced or approved');

  // ---------- web pictures, one by one ----------
  const web = await page.evaluate(async () => {
    const { ctx } = window.__app; const imgs = { good: await window.__blob(1200, 800, 'dish'), tiny: await window.__blob(100, 100, 'dish'), banner: await window.__blob(1000, 300, 'flat') };
    ctx.importer.fetcher = { fetchBytes: async (u) => (u.includes('fail') ? null : u.includes('good') ? imgs.good : u.includes('tiny') ? imgs.tiny : u.includes('junk') ? new Blob(['not a picture']) : imgs.banner) };
    const r = await ctx.importer.webPhotos(['https://x.com/a/fail.jpg', 'https://x.com/a/tiny.jpg', 'https://x.com/a/junk.jpg', 'https://x.com/a/banner.jpg', 'https://x.com/a/good.jpg']);
    return { selected: r.selectedId, reason: r.reason, tried: r.tried, loaded: r.loaded, rej: r.candidates.map((c) => [c.id, c.rejected]) };
  });
  assert.equal(web.tried, 5); assert.equal(web.loaded, 3, 'a failed download and a file that is not a picture are skipped, the rest are looked at'); assert.equal(web.selected, 'web:4', 'the real photo is chosen although it is the LAST of five (the old code looked at three)');
  assert.deepEqual(Object.fromEntries(web.rej), { 'web:4': null, 'web:1': 'tiny', 'web:3': 'banner' }); ok('web pictures: failures skipped, tiny and banner rejected, the real photo found even when it is not among the first three');

  // ---------- a photographed or scanned recipe page ----------
  const scan = await page.evaluate(async () => {
    const { ctx } = window.__app; const W = 1000, H = 1400; const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    g.fillStyle = 'rgb(236,230,214)'; g.fillRect(0, 0, W, H);                                 // a scanned page: paper all the way to the edge
    g.fillStyle = 'rgb(40,40,40)'; const lines = (y0, y1) => { for (let y = y0; y < y1; y += 36) for (let x = 64; x < W - 64; x++) if (Math.floor(x / 7) % 5 !== 4) { g.fillRect(x, y, 1, 5); g.fillRect(x, y + 6, 1, 3); } };
    lines(60, 160); lines(740, 1340);                                                         // lines of text above and below
    for (let y = 230; y < 690; y += 4) for (let x = 125; x < 875; x += 4) { g.fillStyle = `rgb(${150 + (x % 60)},${70 + (y % 50)},${30 + ((x + y) % 40)})`; g.fillRect(x, y, 4, 4); }   // the photo of the dish printed on the page
    const file = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.92));
    const d = await ctx.importer.import({ type: 'image', file }, () => {});
    return { sel: d.photos.selectedId, need: d.photos.needsCheck, cands: d.photos.candidates.map((c) => [c.id, c.source, c.width > 100, c.rejected]), warn: (d.warnings.find((w) => w.field === 'photo') || {}).message || null, cleaned: d.source.cleaned.length, kept: d.source.files.length };
  });
  assert.equal(scan.sel, 'page', 'the photo printed on the page is found and offered'); assert.equal(scan.need, true, 'it is shown for the person to approve or adjust'); assert.deepEqual(scan.cands[0].slice(1), ['page', true, null]);
  assert.match(scan.warn, /chosen automatically/); assert.ok(scan.cleaned >= 1 && scan.kept >= 1, 'the original picture is kept intact and a straightened page is made'); ok('photographed page: straightened, the printed dish photo found and offered as the cover (to adjust or approve); the original is kept intact');

  await browser.close(); srv.close();
  assert.deepEqual(errors, [], 'no console errors'); console.log('photo e2e passed');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
