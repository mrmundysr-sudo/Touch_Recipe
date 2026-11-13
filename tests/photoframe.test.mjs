// Photo framing: the picture is never cut; the recipe keeps a zoom and a centre point. Zoom and pan under a fixed frame, any frame shape, no empty edges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultFrame, isDefaultFrame, sanitizeFrame, clampFrame, frameRect, panFrame, zoomFrame, storeFrame } from '../www/js/engine/photoframe.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const IW = 1600, IH = 1000, FW = 320, FH = 200;   // a 16:10 picture in a 16:10 frame

test('the default framing just covers the frame, centred; a taller or wider picture is centred and covers', () => {
  let r = frameRect(defaultFrame(), IW, IH, FW, FH); close(r.w, 320); close(r.h, 200); close(r.left, 0); close(r.top, 0);
  r = frameRect(defaultFrame(), 1000, 1000, FW, FH); close(r.w, 320); close(r.h, 320); close(r.left, 0); close(r.top, -60);    // a square picture: the frame shows its middle band
  r = frameRect(defaultFrame(), 2000, 500, FW, FH); close(r.h, 200); close(r.w, 800); close(r.left, -240); close(r.top, 0);   // a panorama: the frame shows its middle
});
test('zooming shows less of the picture; the picture always covers the frame (no empty edges)', () => {
  const z = { zoom: 2, cx: 0.5, cy: 0.5 }; const r = frameRect(z, IW, IH, FW, FH); close(r.w, 640); close(r.left, -160);
  for (const f of [{ zoom: 2, cx: 0, cy: 0 }, { zoom: 2, cx: 1, cy: 1 }, { zoom: 3.3, cx: -5, cy: 9 }, { zoom: 0.2, cx: 0.9, cy: 0.1 }, { zoom: 99, cx: 0.5, cy: 0.5 }]) {
    const q = frameRect(f, IW, IH, FW, FH); assert.ok(q.left <= 1e-6 && q.top <= 1e-6 && q.left + q.w >= FW - 1e-6 && q.top + q.h >= FH - 1e-6, JSON.stringify(f));
    assert.ok(q.frame.zoom >= 1 && q.frame.zoom <= 4);
  }
});
test('panning moves the picture under the frame, and stops at the edges', () => {
  const z = { zoom: 2, cx: 0.5, cy: 0.5 };
  const p = panFrame(z, -80, 0, IW, IH, FW, FH);   // drag the picture 80 px to the left: the frame now shows more of the right
  assert.ok(p.cx > 0.5); close(frameRect(p, IW, IH, FW, FH).left, -160 - 80);
  const far = panFrame(z, -9999, 9999, IW, IH, FW, FH); assert.ok(far.cx <= 0.75 + 1e-9 && far.cy >= 0.25 - 1e-9, 'stopped at the edge');
  const flat = panFrame(defaultFrame(), 50, 50, IW, IH, FW, FH); assert.deepEqual(flat, defaultFrame(), 'at zoom 1 there is nothing to pan');
});
test('zooming around a point keeps that point of the picture where it was', () => {
  const start = { zoom: 1.5, cx: 0.4, cy: 0.45 }; const px = 250, py = 60;
  const a = frameRect(start, IW, IH, FW, FH); const ix = (px - a.left) / a.w, iy = (py - a.top) / a.h;
  const nz = zoomFrame(start, 2.5, IW, IH, FW, FH, px, py); const b = frameRect(nz, IW, IH, FW, FH);
  close((px - b.left) / b.w, ix, 1e-3); close((py - b.top) / b.h, iy, 1e-3);
});
test('one framing works for another frame shape', () => {
  const f = { zoom: 2, cx: 0.3, cy: 0.6 };
  for (const [fw, fh] of [[100, 100], [320, 200], [90, 160]]) { const r = frameRect(f, IW, IH, fw, fh); assert.ok(r.left <= 1e-6 && r.top <= 1e-6 && r.left + r.w >= fw - 1e-6 && r.top + r.h >= fh - 1e-6); }
});
test('what is stored: numbers only, rounded, null for the default, junk is ignored', () => {
  assert.equal(storeFrame(defaultFrame()), null); assert.equal(sanitizeFrame(null), null); assert.equal(sanitizeFrame('x'), null); assert.equal(sanitizeFrame({ zoom: 'a', cx: 0, cy: 0 }), null);
  assert.deepEqual(storeFrame({ zoom: 2.123456789, cx: 0.3333333, cy: 0.5 }), { zoom: 2.1235, cx: 0.3333, cy: 0.5 });
  assert.deepEqual(sanitizeFrame({ zoom: 50, cx: -1, cy: 2 }), { zoom: 4, cx: 0, cy: 1 }, 'out-of-range values are brought back in range');
  assert.equal(isDefaultFrame(null), true); assert.equal(isDefaultFrame({ zoom: 1, cx: 0.5, cy: 0.5 }), true); assert.equal(isDefaultFrame({ zoom: 1.1, cx: 0.5, cy: 0.5 }), false);
});
