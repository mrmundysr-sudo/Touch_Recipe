// Port of RecipeImagesTest.kt: card found at an angle, no false crop, dish photo found without the text, yellowed paper,
// a plain photo not mistaken for a page, levels, and web photo ranking and exclusions. Pictures are drawn for the test;
// real cards and lighting are a device test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import * as Web from '../www/js/engine/webextract.js';
import * as P from '../www/js/engine/pageimages.js';
import { rankImages } from '../www/js/engine/imagecandidates.js';

Web.setHtmlParser((html) => parseHTML(/<html[\s>]/i.test(html) ? html : `<html><head></head><body>${html}</body></html>`).document);
const rgb = (r, g, b) => (255 << 24) | (r << 16) | (g << 8) | b;
const canvas = (w, h, c) => new Int32Array(w * h).fill(c);
const rect = (a, w, x0, y0, x1, y1, f) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * w + x] = f(x, y); };
const quad = (a, w, h, pts, color) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let inside = true; for (let i = 0; i < 4; i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % 4]; if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) { inside = false; break; } } if (inside) a[y * w + x] = color; } };
const textLines = (a, w, x0, x1, y0, y1) => { for (let y = y0; y < y1; y += 9) for (let x = x0; x < x1; x++) if (Math.floor(x / 7) % 5 !== 4) { a[y * w + x] = rgb(40, 40, 40); a[(y + 1) * w + x] = rgb(40, 40, 40); } };
const paper = rgb(236, 230, 214);
const px = (w, h, a) => P.pixels(w, h, a);

test('a card on a dark table is found even when photographed at an angle', () => {
  const w = 300, h = 220, img = canvas(w, h, rgb(52, 38, 30));
  const corners = [[60, 30], [250, 48], [236, 190], [44, 168]]; quad(img, w, h, corners, paper);
  const q = P.findDocument(px(w, h, img)); assert.ok(q, 'a clear card must be found');
  P.quadPoints(q).forEach((p, i) => { assert.ok(Math.abs(p.x * w - corners[i][0]) <= 5 && Math.abs(p.y * h - corners[i][1]) <= 5, `corner ${i}`); });
  assert.ok(q.confidence > 0.85);
});
test('no crop is offered when the page fills the picture or nothing stands out', () => {
  const w = 300, h = 220;
  const full = canvas(w, h, paper); textLines(full, w, 20, 280, 30, 200);
  assert.equal(P.findDocument(px(w, h, full)), null);
  assert.equal(P.findDocument(px(w, h, canvas(w, h, rgb(120, 120, 120)))), null);
  const blob = canvas(w, h, rgb(40, 40, 40)); rect(blob, w, 40, 30, 260, 90, () => paper); rect(blob, w, 40, 90, 110, 200, () => paper);
  assert.equal(P.findDocument(px(w, h, blob)), null);
});
test('the dish photo on a cookbook page is cut out without the text', () => {
  const w = 240, h = 320, img = canvas(w, h, paper);
  textLines(img, w, 16, 224, 14, 40);
  rect(img, w, 30, 54, 210, 164, (x, y) => rgb(150 + (x % 60), 70 + (y % 50), 30 + ((x + y) % 40)));
  textLines(img, w, 16, 224, 180, 306);
  const r = P.findPhotoRegion(px(w, h, img)); assert.ok(r);
  assert.ok(Math.abs(r.left * w - 30) <= 7 && Math.abs(r.top * h - 54) <= 7 && Math.abs(r.right * w - 210) <= 7 && Math.abs(r.bottom * h - 164) <= 7);
  assert.ok(r.confidence > 0.7);
});
test('a black and white photo on yellowed paper is found and text alone is not', () => {
  const w = 240, h = 320, old = rgb(226, 205, 150);
  const img = canvas(w, h, old); textLines(img, w, 16, 224, 14, 150); rect(img, w, 60, 170, 190, 290, (x, y) => { const v = 60 + ((x * 3 + y * 2) % 90); return rgb(v, v, v); });
  const r = P.findPhotoRegion(px(w, h, img)); assert.ok(r); assert.ok(Math.abs(r.top * h - 170) <= 7 && Math.abs(r.bottom * h - 290) <= 7);
  const onlyText = canvas(w, h, old); textLines(onlyText, w, 16, 224, 14, 300);
  assert.equal(P.findPhotoRegion(px(w, h, onlyText)), null, 'a handwritten card with no picture gets no invented cover');
});
test('a plain photograph is not mistaken for a page and two pictures lower the confidence', () => {
  const w = 240, h = 320, photo = new Int32Array(w * h).map((_, i) => { const x = i % w, y = Math.floor(i / w); return rgb(90 + (x * 7 + y * 3) % 150, 40 + (x * 5 + y * 11) % 170, 20 + (x * 13 + y * 5) % 120); });
  assert.equal(P.findPhotoRegion(px(w, h, photo)), null);
  const two = canvas(w, h, paper); rect(two, w, 20, 20, 220, 130, (x) => rgb(180, 60 + (x % 40), 30)); textLines(two, w, 16, 224, 140, 180); rect(two, w, 30, 196, 200, 300, (_, y) => rgb(40, 120 + (y % 40), 60));
  const r = P.findPhotoRegion(px(w, h, two)); assert.ok(r === null || r.confidence < 0.6);
});
test('levels brighten a dull scan and leave a good one alone', () => {
  const w = 100, h = 100, dull = new Int32Array(w * h).map((_, i) => (Math.floor(i / w) % 10 === 0 ? rgb(70, 70, 70) : rgb(170, 165, 150)));
  const [scale, offset] = P.autoLevels(px(w, h, dull));
  assert.ok(scale > 1.5); assert.ok(70 * scale + offset < 30, 'ink goes towards black'); assert.ok(165 * scale + offset > 230, 'paper goes towards white');
  assert.deepEqual(P.autoLevels(px(w, h, canvas(w, h, rgb(128, 128, 128)))), [1, 0]);
});

const rank = (html, structured = []) => rankImages(parseHTML(html).document, structured, 'https://www.example.com/r/stew');
test('recipe data image comes first, then the page image, then recipe pictures', () => {
  const html = `<html><head><meta property="og:image" content="/img/og-stew.jpg"></head><body><article>
    <img src="/img/logo.png" width="300" height="80"><img src="/img/step1.jpg" width="800" height="600"><img data-lazy-src="/img/step2.jpg" src="data:image/gif;base64,AAAA" width="800" height="600"></article></body></html>`;
  assert.deepEqual(rank(html, ['https://cdn.example.com/stew-main.jpg']), ['https://cdn.example.com/stew-main.jpg', 'https://www.example.com/img/og-stew.jpg', 'https://www.example.com/img/step1.jpg', 'https://www.example.com/img/step2.jpg']);
});
test('logos, avatars, adverts, icons and pixels are never chosen', () => {
  const html = `<html><body><main>
    <img src="https://ads.example.net/banner-728.jpg" width="728" height="90"><img src="/wp-content/uploads/site-logo.png"><img src="https://secure.gravatar.com/avatar/abc.jpg" width="96" height="96">
    <img src="/pixel.gif" width="1" height="1"><img src="/img/pinterest-share.png"><div class="comments"><img src="/img/reader-photo.jpg" width="600" height="400"></div>
    <div class="related-posts"><img src="/img/other-recipe.jpg" width="600" height="400"></div><img src="/img/icon.svg">
    <img srcset="/img/stew-400.jpg 400w, /img/stew-1200.jpg 1200w" src="/img/stew-400.jpg" width="1200" height="800"></main></body></html>`;
  assert.deepEqual(rank(html), ['https://www.example.com/img/stew-1200.jpg']);
});
test('a page without recipe data still gets its photo and a page with none says so', () => {
  const pageHtml = '<html><head><title>Stew</title></head><body><h1>Stew</h1><img src="/img/stew.jpg" width="900" height="600"><h2>Ingredients</h2><ul><li>2 lb beef</li><li>1 onion</li></ul><h2>Method</h2><ol><li>Brown the beef well in a heavy pot.</li><li>Add the onion and simmer for 2 hours.</li></ol></body></html>';
  const d = Web.extract(pageHtml, 'https://www.example.com/r/stew');
  assert.deepEqual(d.imageCandidates, ['https://www.example.com/img/stew.jpg']);
  const none = Web.extract(pageHtml.replace('<img src="/img/stew.jpg" width="900" height="600">', ''), 'https://www.example.com/r/stew');
  assert.equal(none.imageCandidates.length, 0); assert.ok(none.warnings.some((w) => w.field === 'photo'));
});
