// Manual cut-out: drag the four corners over a picture and keep that part. The original picture is never changed.
import { h } from '../ui/dom.js';
import { sheet, bigButton } from '../ui/widgets.js';
import * as Img from '../data/imagetools.js';

export function cropSheet(blob, { title = 'Crop', onDone }) {
  sheet({ label: title, tall: true, content: (close) => {
    const url = URL.createObjectURL(blob);
    const img = h('img', { src: url, alt: 'Picture to crop', style: 'width:100%;display:block;pointer-events:none' });
    const box = h('div', { class: 'crop-box', 'data-testid': 'crop-box' });
    const stage = h('div', { class: 'crop-stage' }, img, box);
    const r = { l: 0.1, t: 0.1, r: 0.9, b: 0.9 };
    const handles = ['tl', 'tr', 'br', 'bl'].map((k) => { const el = h('div', { class: 'crop-handle', 'data-testid': `crop-${k}`, role: 'slider', 'aria-label': `Crop corner ${k}` }); stage.append(el); return [k, el]; });
    const layout = () => {
      box.style.left = r.l * 100 + '%'; box.style.top = r.t * 100 + '%'; box.style.width = (r.r - r.l) * 100 + '%'; box.style.height = (r.b - r.t) * 100 + '%';
      for (const [k, el] of handles) { el.style.left = (k.includes('l') ? r.l : r.r) * 100 + '%'; el.style.top = (k.includes('t') ? r.t : r.b) * 100 + '%'; }
    };
    for (const [k, el] of handles) {
      el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); e.preventDefault(); });
      el.addEventListener('pointermove', (e) => {
        if (!el.hasPointerCapture(e.pointerId)) return;
        const b = stage.getBoundingClientRect(); const x = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y = Math.min(1, Math.max(0, (e.clientY - b.top) / b.height));
        if (k.includes('l')) r.l = Math.min(x, r.r - 0.05); else r.r = Math.max(x, r.l + 0.05);
        if (k.includes('t')) r.t = Math.min(y, r.b - 0.05); else r.b = Math.max(y, r.t + 0.05);
        layout();
      });
    }
    layout();
    const auto = async () => { const f = Img.findPhotoRegion(await Img.decode(blob, 2400)); if (f) { Object.assign(r, { l: f.left, t: f.top, r: f.right, b: f.bottom }); layout(); } };
    return h('div', { class: 'sheet-col' }, h('h2', { class: 'sheet-title' }, title), h('p', { class: 'sheet-note' }, 'Drag the four round handles so the box covers just the part you want.'), h('div', { class: 'sheet-scroll' }, stage),
      h('div', { class: 'sheet-row' }, bigButton('Find the photo for me', auto, { primary: false, testid: 'crop-auto' }), bigButton('Keep this part', async () => { close(false); onDone(await Img.cropRegion(blob, { left: r.l, top: r.t, right: r.r, bottom: r.b })); }, { testid: 'crop-keep' })),
      bigButton('Cancel', () => close(), { primary: false }));
  }, onDismiss: () => {} });
}
