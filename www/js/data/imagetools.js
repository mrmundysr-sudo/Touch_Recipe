// Port of data/PageImageTools.kt using canvas: automatic page/card detection, straightening, brightness levels and dish-photo cut-out.
// All work happens on this device. The original picture is never changed; every result is a new file.
import * as PI from '../engine/pageimages.js';

const toBlob = (c, q = 0.9) => new Promise((r) => c.toBlob(r, 'image/jpeg', q));
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

export async function decode(blob, maxEdge = 2400) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const k = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const c = canvas(bmp.width * k, bmp.height * k); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}
/** A reduced copy as plain numbers for the analysis in engine/pageimages.js. */
export function smallPixels(src, edge) {
  const k = Math.min(1, edge / Math.max(src.width, src.height));
  const c = canvas(src.width * k, src.height * k); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const argb = new Array(c.width * c.height);
  for (let i = 0; i < argb.length; i++) argb[i] = (255 << 24) | (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];
  return PI.pixels(c.width, c.height, argb);
}
export const findDocument = (src) => PI.findDocument(smallPixels(src, 300));
export const findPhotoRegion = (src) => PI.findPhotoRegion(smallPixels(src, 240));

const lerp = (a, b, t) => a + (b - a) * t;
/** Straightens the four corners (fractions of the picture) into an upright page. Output is capped at 2200 px on the long side. */
export function warpQuad(src, q) {
  const P = (p) => ({ x: p.x * src.width, y: p.y * src.height });
  const tl = P(q.tl), tr = P(q.tr), br = P(q.br), bl = P(q.bl);
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let w = Math.max(d(tl, tr), d(bl, br)), h = Math.max(d(tl, bl), d(tr, br));
  const k = Math.min(1, 2200 / Math.max(w, h)); w = Math.max(8, Math.round(w * k)); h = Math.max(8, Math.round(h * k));
  const out = canvas(w, h), og = out.getContext('2d'), sg = src.getContext('2d');
  const sd = sg.getImageData(0, 0, src.width, src.height), od = og.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = h === 1 ? 0 : y / (h - 1);
    const lx = lerp(tl.x, bl.x, v), ly = lerp(tl.y, bl.y, v), rx = lerp(tr.x, br.x, v), ry = lerp(tr.y, br.y, v);
    for (let x = 0; x < w; x++) {
      const u = w === 1 ? 0 : x / (w - 1);
      const sx = Math.min(src.width - 1, Math.max(0, lerp(lx, rx, u))), sy = Math.min(src.height - 1, Math.max(0, lerp(ly, ry, u)));
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(src.width - 1, x0 + 1), y1 = Math.min(src.height - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
      const o = (y * w + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const a = sd.data[(y0 * src.width + x0) * 4 + ch], b = sd.data[(y0 * src.width + x1) * 4 + ch], c2 = sd.data[(y1 * src.width + x0) * 4 + ch], e = sd.data[(y1 * src.width + x1) * 4 + ch];
        od.data[o + ch] = lerp(lerp(a, b, fx), lerp(c2, e, fx), fy);
      }
      od.data[o + 3] = 255;
    }
  }
  og.putImageData(od, 0, 0); return out;
}
/** Stretches paper towards white and ink towards black (same rule as the Android Levels). */
export function applyLevels(c) {
  const g = c.getContext('2d'), img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  const n = c.width * c.height, argb = new Array(n);
  for (let i = 0; i < n; i++) argb[i] = (255 << 24) | (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];
  const [scale, offset] = PI.autoLevels(PI.pixels(c.width, c.height, argb));
  if (scale === 1 && offset === 0) return c;
  for (let i = 0; i < n; i++) for (let ch = 0; ch < 3; ch++) d[i * 4 + ch] = Math.max(0, Math.min(255, d[i * 4 + ch] * scale + offset));
  g.putImageData(img, 0, 0); return c;
}
export async function cleanedPage(blob, quad = null) {
  const src = await decode(blob); const q = quad || findDocument(src);
  const page = q ? warpQuad(src, q) : src; return { blob: await toBlob(applyLevels(page)), found: !!q };
}
export async function cropRegion(blob, region) {
  const src = await decode(blob, 3000);
  const x = Math.round(region.left * src.width), y = Math.round(region.top * src.height), w = Math.max(8, Math.round((region.right - region.left) * src.width)), h = Math.max(8, Math.round((region.bottom - region.top) * src.height));
  const c = canvas(w, h); c.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h); return toBlob(c, 0.9);
}
/** Looks for the printed photograph of the dish on a page picture. Returns { blob, confidence } or null. */
export async function dishPhoto(blob) {
  try { const src = await decode(blob, 2400); const r = findPhotoRegion(src); if (!r) return null; return { blob: await cropRegion(blob, r), confidence: r.confidence, region: r }; } catch { return null; }
}
export { toBlob, canvas };
