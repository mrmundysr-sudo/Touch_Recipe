// The recipe photo: choose it (from what the import found, the library or the camera), then frame it. Plain and simple.
//  - The picture is kept whole. A FIXED FRAME shows the part that is used; the whole picture sits behind it (dimmed outside the frame).
//  - Drag to move the picture under the frame; pinch, wheel, the slider or + / - to zoom. What is inside the frame is the crop.
//  - The framing (zoom and centre) is saved with the recipe, so it can be adjusted later. Reset puts it back; Replace picks another picture.
import { h, mount } from '../ui/dom.js';
import { sheet, bigButton, textButton, say } from '../ui/widgets.js';
import { pickFile } from '../ui/shared.js';
import { frameRect, clampFrame, panFrame, zoomFrame, defaultFrame, storeFrame, sanitizeFrame, MIN_ZOOM, MAX_ZOOM } from '../engine/photoframe.js';

export const FRAME_ASPECT = 16 / 10;   // the fixed frame of the editor (width / height)

const loadSize = (url) => new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res(null); i.src = url; });

/** The framing editor. onDone(frame) gets the frame to store (null = default); onReplace() is called after the editor closes when the person taps Replace. */
export function photoEditorSheet(ctx, { name, frame = null, onDone, onReplace = null }) {
  sheet({ label: 'Adjust photo', tall: true, content: (close) => {
    const stage = h('div', { class: 'pe-stage', 'data-testid': 'pe-stage' });
    const frameEl = h('div', { class: 'pe-frame', 'data-testid': 'pe-frame' });
    const img = h('img', { class: 'pe-img', alt: 'The whole photo', draggable: 'false', 'data-testid': 'pe-img' });
    stage.append(img, frameEl);
    const zoomIn = h('input', { type: 'range', class: 'pe-zoom', min: String(MIN_ZOOM), max: String(MAX_ZOOM), step: '0.01', value: '1', 'aria-label': 'Zoom', 'data-testid': 'pe-zoom' });
    let nat = null, f = sanitizeFrame(frame) || defaultFrame(), box = { fw: 0, fh: 0, left: 0, top: 0 };
    const layout = () => {
      if (!nat) return;
      const sw = stage.clientWidth, sh = stage.clientHeight; if (!sw || !sh) return;
      const fw = Math.min(sw * 0.82, sh * 0.82 * FRAME_ASPECT), fh = fw / FRAME_ASPECT; box = { fw, fh, left: (sw - fw) / 2, top: (sh - fh) / 2 };
      Object.assign(frameEl.style, { width: `${fw}px`, height: `${fh}px`, left: `${box.left}px`, top: `${box.top}px` });
      const r = frameRect(f, nat.w, nat.h, fw, fh); f = r.frame;
      Object.assign(img.style, { width: `${r.w}px`, height: `${r.h}px`, left: `${box.left + r.left}px`, top: `${box.top + r.top}px` });
      zoomIn.value = String(f.zoom);
    };
    const set = (nf) => { f = nf; layout(); };
    const pan = (dx, dy) => set(panFrame(f, dx, dy, nat.w, nat.h, box.fw, box.fh));
    const zoomTo = (z, px, py) => set(zoomFrame(f, z, nat.w, nat.h, box.fw, box.fh, px, py));
    // pointers: one = pan, two = pinch
    const pts = new Map(); let pinch = null;
    stage.addEventListener('pointerdown', (e) => { if (!nat) return; stage.setPointerCapture?.(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); pinch = null; e.preventDefault(); });
    stage.addEventListener('pointermove', (e) => {
      if (!nat || !pts.has(e.pointerId)) return; const old = pts.get(e.pointerId); const cur = { x: e.clientX, y: e.clientY };
      if (pts.size === 1) { pts.set(e.pointerId, cur); pan(cur.x - old.x, cur.y - old.y); return; }
      pts.set(e.pointerId, cur); const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) { const sr = stage.getBoundingClientRect(); zoomTo(pinch.zoom * (d / pinch.d), (a.x + b.x) / 2 - sr.left - box.left, (a.y + b.y) / 2 - sr.top - box.top); } else pinch = { d, zoom: f.zoom };
    });
    const up = (e) => { pts.delete(e.pointerId); pinch = null; }; stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', (e) => { if (!nat) return; e.preventDefault(); const sr = stage.getBoundingClientRect(); zoomTo(f.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - sr.left - box.left, e.clientY - sr.top - box.top); }, { passive: false });
    zoomIn.addEventListener('input', () => { if (nat) zoomTo(parseFloat(zoomIn.value)); });
    const step = (d) => () => { if (nat) zoomTo(f.zoom * d); };
    ctx.photos.url(name).then(async (u) => {
      if (!u) { say("That photo couldn't be opened."); close(); return; }
      nat = await loadSize(u); if (!nat) { say("That photo couldn't be opened."); close(); return; }
      img.src = u; requestAnimationFrame(layout); if (typeof ResizeObserver !== 'undefined') new ResizeObserver(layout).observe(stage);
    });
    return h('div', { class: 'sheet-col' }, h('h2', { class: 'sheet-title' }, 'Adjust photo'),
      h('p', { class: 'sheet-note' }, 'The bright box is what the recipe shows. Drag the picture to move it, and pinch or use the slider to zoom.'), stage,
      h('div', { class: 'pe-zoom-row' }, h('button', { class: 'nl-btn', type: 'button', 'aria-label': 'Zoom out', onclick: step(1 / 1.25), 'data-testid': 'pe-out' }, '−'), zoomIn, h('button', { class: 'nl-btn', type: 'button', 'aria-label': 'Zoom in', onclick: step(1.25), 'data-testid': 'pe-in' }, '+')),
      h('div', { class: 'sheet-row' }, bigButton('Reset', () => set(defaultFrame()), { primary: false, testid: 'pe-reset' }), onReplace ? bigButton('Replace…', () => { close(false); onReplace(); }, { primary: false, testid: 'pe-replace' }) : null),
      h('div', { class: 'sheet-row' }, bigButton('Cancel', () => close(), { primary: false }), bigButton('Done', () => { close(false); onDone(storeFrame(f)); }, { testid: 'pe-done' })));
  } });
}

/**
 * Choose the picture. `candidates`: [{ id, label, note, blob, width, height, rejected }] (what the import found); the library and the camera are always offered.
 * onPick({ name }) gets the stored photo name (a new file, default framing); onNone() removes the photo; onCut() (optional) opens the cut-out of the original.
 */
export function photoPickerSheet(ctx, { candidates = [], selectedId = null, current = null, onPick, onNone = null, onCut = null }) {
  const urls = [];
  sheet({ label: 'Choose the recipe photo', tall: true, onDismiss: () => urls.forEach((u) => URL.revokeObjectURL(u)), content: (close) => {
    const store = async (blob) => { const n = blob && await ctx.photos.saveBlob(blob); if (!n) { say("That photo couldn't be used."); return; } close(false); onPick({ name: n }); };
    const thumb = (c) => {
      const u = URL.createObjectURL(c.blob); urls.push(u);
      return h('button', { class: `pp-thumb${c.id === selectedId ? ' selected' : ''}${c.rejected ? ' rejected' : ''}`, type: 'button', 'data-testid': `pp-thumb`, 'data-cand': c.id, onclick: () => store(c.blob), 'aria-label': `Use this picture: ${c.label}` },
        h('img', { src: u, alt: '', draggable: 'false' }), h('span', { class: 'pp-cap' }, c.label), c.note ? h('span', { class: 'pp-note' }, c.note) : null);
    };
    const good = candidates.filter((c) => !c.rejected), other = candidates.filter((c) => c.rejected);
    return h('div', { class: 'sheet-col' }, h('h2', { class: 'sheet-title' }, 'Choose the recipe photo'),
      candidates.length ? null : h('p', { class: 'sheet-note', 'data-testid': 'pp-none' }, 'No picture was found in the source. You can use one from your photos, take one, or cut one out of the original.'),
      good.length ? h('div', { class: 'pp-grid', 'data-testid': 'pp-good' }, ...good.map(thumb)) : null,
      other.length ? h('div', { class: 'pp-other' }, h('p', { class: 'sheet-note' }, 'Other pictures found (probably not the dish: banners, adverts, icons)'), h('div', { class: 'pp-grid', 'data-testid': 'pp-other' }, ...other.map(thumb))) : null,
      bigButton('Choose from photo library', async () => { const fl = await pickFile({ accept: 'image/*' }); if (fl) store(fl); }, { primary: false, testid: 'pp-library' }),
      bigButton('Take a photo', async () => { const fl = await pickFile({ accept: 'image/*', capture: 'environment' }); if (fl) store(fl); }, { primary: false, testid: 'pp-camera' }),
      onCut ? bigButton('Cut a photo out of the original…', () => { close(false); onCut(); }, { primary: false, testid: 'pp-cut' }) : null,
      current && onNone ? bigButton('No photo', () => { close(false); onNone(); }, { primary: false, testid: 'pp-none-btn' }) : null,
      bigButton('Cancel', () => close(), { primary: false }));
  } });
}

/**
 * The whole flow: no photo yet -> choose one, then frame it; a photo -> frame it (Replace chooses another). onApply({ photo, frame }) is called with the final state
 * (`photo` null removes it). The picture is stored whole; only the framing is saved beside it.
 */
export function photoFlow(ctx, { photo = null, frame = null, candidates = [], selectedId = null, onCut = null, onApply }) {
  const edit = (name, fr) => photoEditorSheet(ctx, { name, frame: fr, onDone: (nf) => onApply({ photo: name, frame: nf }), onReplace: () => choose(name) });
  const choose = (current) => photoPickerSheet(ctx, { candidates, selectedId, current, onCut, onNone: () => onApply({ photo: null, frame: null }), onPick: ({ name }) => { onApply({ photo: name, frame: null }); edit(name, null); } });
  if (photo) edit(photo, frame); else choose(null);
}
