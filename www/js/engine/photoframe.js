// The framing of a recipe photo: the whole picture is kept as it is, and the recipe stores only WHERE the fixed frame sits on it.
// A frame is { zoom, cx, cy }: `zoom` >= 1 (1 = the picture just covers the frame), (cx, cy) = the point of the picture (fractions 0..1) that sits in the centre of the frame.
// Because it is a point and a zoom, not a rectangle, the same framing works for any frame shape (a wide cover, a square thumbnail, a planner tile).
export const MIN_ZOOM = 1, MAX_ZOOM = 4;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v) => Math.round(v * 10000) / 10000;

export const defaultFrame = () => ({ zoom: 1, cx: 0.5, cy: 0.5 });
export const isDefaultFrame = (f) => !f || (f.zoom === 1 && f.cx === 0.5 && f.cy === 0.5);
/** A frame read back from storage: numbers only, or null (the default framing). Nothing else is trusted. */
export function sanitizeFrame(f) {
  if (!f || typeof f !== 'object') return null;
  const zoom = Number(f.zoom), cx = Number(f.cx), cy = Number(f.cy);
  if (![zoom, cx, cy].every(Number.isFinite)) return null;
  const out = { zoom: round(clamp(zoom, MIN_ZOOM, MAX_ZOOM)), cx: round(clamp(cx, 0, 1)), cy: round(clamp(cy, 0, 1)) };
  return isDefaultFrame(out) ? null : out;
}
/** The scale at which a picture iw x ih just covers a frame fw x fh. */
export const coverScale = (iw, ih, fw, fh) => Math.max(fw / iw, fh / ih);

/** Keeps the zoom in range and the centre where the picture still covers the whole frame (no empty edges). */
export function clampFrame(f, iw, ih, fw, fh) {
  const zoom = clamp(Number.isFinite(f?.zoom) ? f.zoom : 1, MIN_ZOOM, MAX_ZOOM);
  const s = coverScale(iw, ih, fw, fh) * zoom;
  const vw = Math.min(1, fw / (iw * s)), vh = Math.min(1, fh / (ih * s));   // the part of the picture the frame shows
  return { zoom, cx: clamp(Number.isFinite(f?.cx) ? f.cx : 0.5, vw / 2, 1 - vw / 2), cy: clamp(Number.isFinite(f?.cy) ? f.cy : 0.5, vh / 2, 1 - vh / 2) };
}
/** Where the picture sits inside a frame fw x fh (pixels, origin top-left of the frame) and how big it is drawn. */
export function frameRect(f, iw, ih, fw, fh) {
  const c = clampFrame(f, iw, ih, fw, fh); const s = coverScale(iw, ih, fw, fh) * c.zoom; const w = iw * s, h = ih * s;
  return { w, h, left: fw / 2 - c.cx * w, top: fh / 2 - c.cy * h, frame: c };
}
/** Dragging the picture by (dx, dy) pixels under the frame: the shown point moves the other way. */
export function panFrame(f, dx, dy, iw, ih, fw, fh) {
  const c = clampFrame(f, iw, ih, fw, fh); const s = coverScale(iw, ih, fw, fh) * c.zoom;
  return clampFrame({ ...c, cx: c.cx - dx / (iw * s), cy: c.cy - dy / (ih * s) }, iw, ih, fw, fh);
}
/** Zooming keeps the point under (px, py) (pixels in the frame; the centre by default) where it is. */
export function zoomFrame(f, zoom, iw, ih, fw, fh, px = fw / 2, py = fh / 2) {
  const before = frameRect(f, iw, ih, fw, fh); const nz = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const ix = (px - before.left) / before.w, iy = (py - before.top) / before.h;   // the picture point under the pointer
  const s = coverScale(iw, ih, fw, fh) * nz;
  return clampFrame({ zoom: nz, cx: ix - (px - fw / 2) / (iw * s), cy: iy - (py - fh / 2) / (ih * s) }, iw, ih, fw, fh);
}
/** What is stored with the recipe: rounded, and null when it is the default framing. */
export const storeFrame = (f) => sanitizeFrame(f && { zoom: f.zoom, cx: f.cx, cy: f.cy });
