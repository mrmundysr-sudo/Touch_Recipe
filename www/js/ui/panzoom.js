// Zoom and pan for one pane of the Recipe Rescue side-by-side comparison. The maths is pure (so it can be tested without a browser);
// attachGestures() wires one-finger pointer events (PAN drags, ZOOM slides up/down) to a transparent overlay above the pane.
export const MIN_SCALE = 1, MAX_SCALE = 4;
export const fit = () => ({ s: 1, x: 0, y: 0 });
export const isFit = (v) => v.s === 1 && v.x === 0 && v.y === 0;

/** Keeps the zoomed content covering the pane: vw/vh = pane size, cw/ch = unscaled content size. */
export function clamp(v, vw, vh, cw, ch) {
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.s));
  if (s === 1) return { s: 1, x: 0, y: 0 };
  const minX = Math.min(0, vw - cw * s), minY = Math.min(0, vh - ch * s);
  return { s, x: Math.min(0, Math.max(minX, v.x)), y: Math.min(0, Math.max(minY, v.y)) };
}

/** Scales by `factor` keeping the content point under (px, py) (pane coordinates) where it is. */
export function zoomAt(v, factor, px, py, vw, vh, cw, ch) {
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.s * factor));
  const k = s / v.s;
  return clamp({ s, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, vw, vh, cw, ch);
}

export const panBy = (v, dx, dy, vw, vh, cw, ch) => clamp({ ...v, x: v.x + dx, y: v.y + dy }, vw, vh, cw, ch);
export const percent = (v) => `${Math.round(v.s * 100)}%`;
export const cssTransform = (v) => (isFit(v) ? '' : `translate(${v.x}px, ${v.y}px) scale(${v.s})`);

// ---- One-finger controls (Touch Gesture Standard v1.1, as in Touch Photo Collage) ----
export const PX_PER_DOUBLING = 160, KNEE_PX = 4, TAP_SLOP = 12;
/** ZOOM: sliding up zooms in, down zooms out; exponential, so up-then-down returns exactly to the start. */
export const zoomFactor = (dy, pxPerDoubling = PX_PER_DOUBLING) => Math.pow(2, -dy / pxPerDoubling);
/** Soft start: inside the first KNEE_PX the movement is scaled by |v|/KNEE_PX (0 at the touch point, 1 at the knee), so there is no jump and resting tremor is filtered. */
export const knee = (dx, dy, k = KNEE_PX) => { const m = Math.hypot(dx, dy), f = m >= k ? 1 : m / k; return { x: dx * f, y: dy * f }; };

/**
 * overlay: the element that receives the touches. api: { get(), set(view), size() -> {vw, vh, cw, ch}, mode() -> 'pan' | 'zoom', onScroll(dy), onTouch() }.
 * One finger only. PAN: the content follows the finger. ZOOM: sliding up zooms in, down zooms out, around the point first touched (sideways is ignored).
 * Every move is applied at once from the first pixel (no easing); a touch that lifts without moving much (a tap) changes nothing.
 */
export function attachGestures(overlay, api) {
  let id = null, start = null, from = null, prevEff = null, startView = null, maxD = 0;
  const local = (e) => { const r = overlay.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  overlay.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (id !== null) return;                       // a second finger is ignored: pinch is not used
    id = e.pointerId; try { overlay.setPointerCapture(id); } catch { /* synthetic events */ }
    start = local(e); from = { x: e.clientX, y: e.clientY }; prevEff = { x: 0, y: 0 }; startView = api.get(); maxD = 0;
    if (api.onTouch) api.onTouch();
  });
  overlay.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    e.preventDefault(); e.stopPropagation();
    const dx = e.clientX - from.x, dy = e.clientY - from.y; maxD = Math.max(maxD, Math.hypot(dx, dy));
    const eff = knee(dx, dy), ddx = eff.x - prevEff.x, ddy = eff.y - prevEff.y; prevEff = eff;
    const { vw, vh, cw, ch } = api.size();
    if (api.mode() === 'zoom') {
      if (ddy) api.set(zoomAt(api.get(), zoomFactor(ddy), start.x, start.y, vw, vh, cw, ch));
    } else {
      const v = api.get();
      if (v.s > 1) api.set(panBy(v, ddx, ddy, vw, vh, cw, ch)); else api.onScroll(-ddy);
    }
  });
  const up = (e) => {
    if (e.pointerId !== id) return;
    if (maxD < TAP_SLOP && startView) api.set(startView);   // a tap or tremor commits nothing
    id = null; startView = null;
  };
  overlay.addEventListener('pointerup', up); overlay.addEventListener('pointercancel', up);
  // a plain tap or a stray click on the overlay must never reach the text underneath
  overlay.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
  return () => { id = null; };
}
