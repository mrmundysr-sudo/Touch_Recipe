// Port of ui/art/ArtManifest.kt + ArtScreen.kt: the illustrated page, pixel-accurate cutout hit testing,
// the first-load illumination, tap flashes and accessibility/keyboard nodes. 1 design px = 1 px of the 841-wide artwork.
import { h } from './dom.js';

export class ArtLoader {
  constructor(base = 'art/') { this.base = base; this.cuts = new Map(); this.data = new Map(); this.manifest = null; }
  async init() {
    const res = await fetch(this.base + 'manifest.json');
    this.manifest = await res.json();
    this.aspect = this.manifest.artSize[0] / this.manifest.artSize[1];
    return this;
  }
  page(key) {
    const p = this.manifest.pages[key];
    if (!p) throw new Error(`Unknown art page '${key}'`);
    const rect = (a) => ({ x: a[0], y: a[1], w: a[2], h: a[3], cx: a[0] + a[2] / 2, cy: a[1] + a[3] / 2 });
    return {
      key, clean: this.base.replace(/art\/$/, '') + p.clean, bg: p.bg,
      targets: p.targets.map((t) => ({ ...t, box: rect(t.box), hit: rect(t.hit), layerUrl: t.layer ? this.base.replace(/art\/$/, '') + t.layer : null })),
      regions: Object.fromEntries(Object.entries(p.regions || {}).map(([k, v]) => [k, rect(v)])),
      days: (p.days || []).map((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, rect(v)]))),
      region(name) { const r = this.regions[name]; if (!r) throw new Error(`Missing art region '${name}' on page '${key}'`); return r; },
      target(id) { return this.targets.find((t) => t.id === id); },
    };
  }
  /** Loads a cutout's alpha channel once so taps can be resolved against the real object silhouette. */
  async loadCut(url) {
    if (this.cuts.has(url)) return this.cuts.get(url);
    const p = (async () => {
      try {
        const blob = await (await fetch(url)).blob();
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0);
        const data = ctx.getImageData(0, 0, c.width, c.height);
        this.data.set(url, data);
        return data;
      } catch { return null; }
    })();
    this.cuts.set(url, p);
    return p;
  }
  async preload(page) { await Promise.all(page.targets.filter((t) => t.layerUrl).map((t) => this.loadCut(t.layerUrl))); }
  contains(r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
  opaqueAt(t, nx, ny) {
    if (!t.layerUrl || !this.contains(t.box, nx, ny)) return false;
    const img = this.data.get(t.layerUrl);
    if (!img) return false;
    const px = Math.min(img.width - 1, Math.max(0, Math.floor(((nx - t.box.x) / t.box.w) * img.width)));
    const py = Math.min(img.height - 1, Math.max(0, Math.floor(((ny - t.box.y) / t.box.h) * img.height)));
    return img.data[(py * img.width + px) * 4 + 3] > 24;
  }
  /** Resolves a tap: opaque object pixels first (top-most wins), then the smallest explicit box, then the nearest generous hit region. */
  resolve(page, nx, ny) {
    for (const t of [...page.targets].reverse()) if (this.opaqueAt(t, nx, ny)) return t;
    const boxes = page.targets.filter((t) => !t.layerUrl && this.contains(t.box, nx, ny)).sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h);
    if (boxes.length) return boxes[0];
    const inside = page.targets.filter((t) => this.contains(t.hit, nx, ny));
    if (!inside.length) return null;
    const score = (t) => { const dx = (nx - t.box.cx) / t.box.w, dy = (ny - t.box.cy) / t.box.h; return dx * dx + dy * dy; };
    return inside.reduce((a, b) => (score(b) < score(a) ? b : a));
  }
}

export const pct = (n) => `${(n * 100).toFixed(4)}%`;
export const place = (el, r) => { Object.assign(el.style, { position: 'absolute', left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }); return el; };
export const dp = (n) => `calc(var(--u) * ${n})`;
export const sp = (n) => `calc(var(--u) * ${n} * var(--ts, 1))`;

/**
 * Builds an illustrated page. Returns { el, stage, page, scope, setEnabled, setGlowing, setDescribe, destroy }.
 * opts: { title, onTarget(id), describe(target)->string|null, enabled(id)->bool, glowing:Set, prefs }
 */
export function ArtPage(art, key, opts = {}) {
  const page = art.page(key);
  const prefs = opts.prefs;
  const reduced = () => document.documentElement.dataset.reduced === '1';
  const el = h('div', { class: 'art-viewport', role: 'region', 'aria-label': opts.title || key, style: `background:${page.bg}` });
  const stage = h('div', { class: 'art-stage', 'data-page': key });
  el.append(stage);
  stage.append(h('img', { class: 'art-img', src: page.clean, alt: '', draggable: 'false' }));
  const state = { enabled: opts.enabled || (() => true), glowing: opts.glowing || new Set(), describe: opts.describe || (() => null) };

  // illumination layer
  const glowEls = new Map();
  const glowLayer = h('div', { class: 'art-glow' });
  page.targets.forEach((t) => {
    if (t.glow === false) return;
    const g = h('div', { class: 'glow ' + (t.layerUrl ? 'glow-cut' : 'glow-box'), 'data-glow': t.id });
    if (t.layerUrl) { g.style.webkitMaskImage = g.style.maskImage = `url(${t.layerUrl})`; }
    place(g, t.box);
    glowEls.set(t.id, g); glowLayer.append(g);
  });
  stage.append(glowLayer);

  // tap layer: whole physical objects resolve through their cutout alpha first
  const trigger = (id) => {
    if (!state.enabled(id)) return;
    const g = glowEls.get(id);
    if (g) { g.classList.remove('flash'); void g.offsetWidth; g.classList.add('flash'); }
    setTimeout(() => opts.onTarget && opts.onTarget(id), reduced() ? 0 : 130);
  };
  const tapLayer = h('div', { class: 'art-tap' });
  tapLayer.addEventListener('click', (e) => {
    const r = stage.getBoundingClientRect();
    const t = art.resolve(page, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    if (t) trigger(t.id);
  });
  stage.append(tapLayer);

  // accessibility / keyboard nodes (one real button per target)
  const nodes = new Map();
  page.targets.forEach((t) => {
    const b = h('button', { class: 'art-target', type: 'button', 'data-art': t.id, 'data-testid': `art:${t.id}`, 'aria-label': state.describe(t) || t.label, title: t.hint,
      onclick: (e) => { if (e.detail === 0 || e.pointerType === '') trigger(t.id); } });
    place(b, t.hit);
    nodes.set(t.id, b); stage.append(b);
  });
  const refreshLabels = () => page.targets.forEach((t) => { const b = nodes.get(t.id); b.setAttribute('aria-label', state.describe(t) || t.label); b.disabled = !state.enabled(t.id); });

  // overlay for code-rendered content (rows, text); sits above the tap layer
  const content = h('div', { class: 'art-content' });
  stage.append(content);

  // first-load illumination: teaches the first two visits of each page, then stays out of the way
  let played = false;
  const playIntro = () => {
    if (played) return; played = true;
    const guide = prefs ? prefs.glowGuide : true;
    const plays = prefs ? prefs.glowPlays(key) : 0;
    if (!guide || plays >= 2 || (art.shown && art.shown.has(key))) return;
    (art.shown ||= new Set()).add(key); prefs?.markGlowPlayed(key);
    const list = page.targets.filter((t) => t.glow !== false);
    list.forEach((t, i) => {
      const g = glowEls.get(t.id);
      g.style.animationDelay = reduced() ? '0ms' : `${120 * i}ms`;
      g.classList.add(reduced() ? 'intro-reduced' : 'intro');
      setTimeout(() => g.classList.remove('intro', 'intro-reduced'), (reduced() ? 700 : 520) + (reduced() ? 0 : 120 * i) + 50);
    });
  };
  art.preload(page).catch(() => {});
  requestAnimationFrame(() => setTimeout(playIntro, 60));

  const scope = {
    page, stage, content, art, dp, sp, place,
    region(name) { return place(h('div'), page.region(name)); },
  };
  return {
    el, stage, page, scope, content, trigger,
    setGlowing(set) { state.glowing = set; glowEls.forEach((g, id) => g.classList.toggle('on', set.has(id))); },
    refreshLabels,
    setEnabled(fn) { state.enabled = fn; refreshLabels(); },
    setDescribe(fn) { state.describe = fn; refreshLabels(); },
    destroy() {},
  };
}
