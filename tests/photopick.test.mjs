// Choosing the recipe photo from what a source offers: adverts and banners are never picked; one real photo is used automatically; several: the dish is preferred and the person checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, choose, statsFromPixels } from '../www/js/engine/photopick.js';

const px = (r, g, b) => (255 << 24) | (r << 16) | (g << 8) | b;
const cand = (id, w, h, o = {}) => ({ id, label: id, width: w, height: h, source: 'web', ...o });

test('the real PDF\'s only picture (a 750 x 300 advert with a see-through mask) is rejected: no recipe photo is chosen', () => {
  const r = choose([cand('ad', 750, 300, { source: 'pdf', hasMask: true })]);
  assert.equal(r.selectedId, null); assert.equal(r.reason, 'only-rejected');
  assert.equal(r.candidates[0].rejected, 'banner'); assert.match(r.candidates[0].note, /banner or an advert/);
});
test('rejections: tiny, banner (wide and tall), masked, flat', () => {
  assert.equal(assess(cand('a', 100, 100)).rejected, 'tiny'); assert.equal(assess(cand('a', 1200, 100)).rejected, 'tiny', 'a thin strip is too small in one direction');
  assert.equal(assess(cand('a', 1000, 400)).rejected, 'banner'); assert.equal(assess(cand('a', 300, 900)).rejected, 'banner');
  assert.equal(assess(cand('a', 800, 600, { hasMask: true })).rejected, 'mask');
  assert.equal(assess(cand('a', 800, 600, { stats: { sat: 0.01, flat: 0.95 } })).rejected, 'flat');
  assert.equal(assess(cand('a', 800, 600, { stats: { sat: 0.35, flat: 0.2 } })).rejected, null, 'a colourful photo is fine');
  assert.equal(assess(cand('a', 1600, 1000)).rejected, null);
});
test('exactly one usable picture: used automatically, no check needed (when the page itself named it)', () => {
  const r = choose([cand('ad', 750, 300, { hasMask: true }), cand('dish', 1200, 800, { order: 0 })]);
  assert.equal(r.selectedId, 'dish'); assert.equal(r.needsCheck, false); assert.equal(r.reason, 'one'); assert.equal(r.candidates.find((c) => c.id === 'ad').rejected, 'banner');
  assert.equal(choose([cand('d', 1200, 800, { source: 'pdf' })]).needsCheck, true, 'a picture pulled out of a PDF is always shown for a check');
});
test('several usable pictures: the finished-dish photo is preferred; the person is asked to check; the rest are kept to choose from', () => {
  const r = choose([cand('thumb', 400, 300, { order: 3 }), cand('page', 900, 700, { source: 'page' }), cand('hero', 1600, 1000, { order: 0, stats: { sat: 0.4, flat: 0.1 } })]);
  assert.equal(r.reason, 'several'); assert.equal(r.needsCheck, true); assert.equal(r.candidates.length, 3);
  assert.equal(r.selectedId, 'hero'); assert.equal(choose([cand('x', 900, 700, { source: 'page' }), cand('y', 800, 600, { order: 1 })]).selectedId, 'x', 'the photo printed on the recipe page beats an ordinary picture');
  assert.deepEqual(r.candidates.map((c) => c.rejected), [null, null, null]);
});
test('nothing found: no photo, nothing invented', () => { const r = choose([]); assert.equal(r.selectedId, null); assert.equal(r.reason, 'none'); });
test('colour statistics tell a photo from a flat graphic', () => {
  assert.deepEqual(statsFromPixels(new Array(100).fill(px(200, 30, 30))).flat, 1);
  const photo = Array.from({ length: 400 }, (_, i) => px((i * 7) % 256, (i * 13) % 256, (i * 29) % 256)); const s = statsFromPixels(photo); assert.ok(s.flat < 0.3 && s.sat > 0.3, JSON.stringify(s));
});
