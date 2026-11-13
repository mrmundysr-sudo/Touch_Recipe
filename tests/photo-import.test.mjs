// The recipe photo at import time. A source's pictures are collected, judged by rules (adverts and banners never chosen), and the person is told what happened.
// The owner's Veg-All PDF contains ONE picture, an advertisement (750 x 300, with a see-through mask); the old code cut it off the rendered page and used it as the recipe photo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { ImportService, photoWarning } from '../www/js/data/importer.js';
import { rankImages, usable } from '../www/js/engine/imagecandidates.js';
import { Severity } from '../www/js/engine/models.js';

const TEXT = 'Pie\nIngredients\n2 cups flour\n1 egg\n3 tbsp butter\nDirections\n1. Mix everything well.\n2. Bake until golden.';
const blob = (n) => new Blob([new Uint8Array(n)], { type: 'image/jpeg' });
const svc = (extract) => new ImportService({ photos: null, ocr: { recognizePdf: async () => ({ text: TEXT, extra: '', notes: [], method: 'plain', pieces: 0, pages: 1 }), ...(extract === undefined ? {} : { extractPdfImages: async () => extract }) } });

test('a PDF whose only picture is an advert: no recipe photo is chosen, the advert is listed as "probably not the dish", the person is told', async () => {
  const d = await svc([{ blob: blob(300), width: 750, height: 300, page: 0, hasMask: true }]).fromPdf({ name: 'veg-all.pdf' }, () => {});
  assert.equal(d.photos.selectedId, null); assert.equal(d.photos.reason, 'only-rejected');
  assert.equal(d.photos.candidates.length, 1); assert.equal(d.photos.candidates[0].rejected, 'banner'); assert.match(d.photos.candidates[0].label, /750 × 300/);
  assert.equal(d.dishPhotoBlob, undefined, 'nothing is cut off the page picture and used');
  const w = d.warnings.find((x) => x.field === 'photo'); assert.ok(w && w.severity === Severity.WARNING && /advert or a banner/.test(w.message));
});
test('a PDF with a real photo and an advert: the photo is chosen (and shown for a check), the advert is not', async () => {
  const d = await svc([{ blob: blob(500), width: 750, height: 300, page: 0, hasMask: true }, { blob: blob(800), width: 900, height: 700, page: 0, hasMask: false }]).fromPdf({ name: 'x.pdf' }, () => {});
  assert.equal(d.photos.selectedId, 'pdf:1'); assert.equal(d.photos.needsCheck, true); assert.equal(d.photos.reason, 'one');
  assert.equal(d.photos.candidates.find((c) => c.id === 'pdf:0').rejected, 'banner');
  assert.ok(d.warnings.some((x) => x.field === 'photo' && /chosen automatically/.test(x.message)));
});
test('a PDF with no pictures, or a bridge that cannot take them out: no photo, and nothing is guessed from the page', async () => {
  const none = await svc([]).fromPdf({ name: 'x.pdf' }, () => {}); assert.equal(none.photos.selectedId, null); assert.equal(none.photos.reason, 'none'); assert.ok(none.warnings.some((x) => x.field === 'photo' && x.severity === Severity.INFO));
  const old = await svc(null).fromPdf({ name: 'x.pdf' }, () => {}); assert.equal(old.photos.selectedId, null); assert.equal(old.dishPhotoBlob, undefined);
  assert.equal(photoWarning(null), null); assert.equal(photoWarning({ selectedId: 'a', needsCheck: false, reason: 'one' }), null, 'one clear photo from the page itself needs no note');
});

test('filename words: a photo is not thrown away because a junk word is hidden INSIDE a longer word', () => {
  for (const ok of ['Honey-Mustard-Chicken.jpg', 'Sharing-Pie-Platter.jpg', 'blueprint-stew.jpg', 'Starter-Soup.jpg', 'Starbucks-Copycat-Pie.jpg', 'badger-cake.jpg', 'authority-chili.jpg', 'operating-room-cake.jpg']) assert.equal(usable(`https://x.com/p/${ok}`), true, ok);
  for (const bad of ['site-logo.png', 'star-rating-5.jpg', 'printable-badge.jpg', 'banner-ad-2.jpg', 'facebook-share.jpg', 'icons.png', 'ad.jpg', 'avatar_12.jpg', 'pixel.gif', '1x1.jpg']) assert.equal(usable(`https://x.com/p/${bad}`), false, bad);
});
test('a photo that is only in <picture><source srcset> is found', () => {
  const html = '<html><body><article><picture><source srcset="/img/pie-400.jpg 400w, /img/pie-1200.jpg 1200w"><img alt=""></picture><p>Pie</p></article></body></html>';
  const urls = rankImages(parseHTML(html).document, [], 'https://www.example.com/r/pie');
  assert.deepEqual(urls, ['https://www.example.com/img/pie-1200.jpg']);
});
