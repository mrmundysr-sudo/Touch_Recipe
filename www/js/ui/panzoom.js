// Zoom and pan for one pane of the Recipe Rescue side-by-side comparison. The maths is pure (so it can be tested without a browser);
// attachGestures() wires pointer events (pinch = two fingers, pan = one finger) to a transparent overlay that sits above the pane.
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

/**
 * overlay: the element that receives the touches. api: { get(), set(view), size() -> {vw, vh, cw, ch}, canPan(), onScroll(dy) }.
 * Two fingers always pinch (and move); one finger pans only when api.canPan() is true.
 */
export function attachGestures(overlay, api) {
  const pts = new Map(); let lastDist = 0, lastMid = null;
  const mid = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
  const local = (e) => { const r = overlay.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  overlay.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    try { overlay.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    pts.set(e.pointerId, local(e));
    if (pts.size === 2) { const m = mid(); lastDist = m.d; lastMid = { x: m.x, y: m.y }; }
  });
  overlay.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    e.preventDefault(); e.stopPropagation();
    const prev = pts.get(e.pointerId), now = local(e); pts.set(e.pointerId, now);
    const { vw, vh, cw, ch } = api.size();
    if (pts.size >= 2) {
      const m = mid();
      if (lastDist > 0) {
        let v = zoomAt(api.get(), m.d / lastDist, m.x, m.y, vw, vh, cw, ch);
        if (lastMid) v = panBy(v, m.x - lastMid.x, m.y - lastMid.y, vw, vh, cw, ch);   // two fingers moving together also pan
        api.set(v);
      }
      lastDist = m.d; lastMid = { x: m.x, y: m.y };
    } else if (api.canPan()) {
      const v = api.get();
      if (v.s > 1) api.set(panBy(v, now.x - prev.x, now.y - prev.y, vw, vh, cw, ch)); else api.onScroll(prev.y - now.y);
    }
  });
  const up = (e) => { pts.delete(e.pointerId); lastDist = 0; lastMid = null; if (pts.size === 1) { /* continue as a one-finger drag */ } };
  overlay.addEventListener('pointerup', up); overlay.addEventListener('pointercancel', up);
  // a plain tap or a stray click on the overlay must never reach the text underneath
  overlay.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
  return () => pts.clear();
}
