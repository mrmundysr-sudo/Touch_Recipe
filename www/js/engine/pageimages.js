// Port of core/image/PageImages.kt: analysis of photographed recipe cards and pages, on a reduced copy as plain numbers.
// A Pixels value is { w, h, argb: Int32Array|number[] } (0xAARRGGBB). Points and regions are fractions of the image (0..1 from the top-left).
export const pixels = (w, h, argb) => { if (!(w > 0 && h > 0 && argb.length === w * h)) throw new Error('bad image'); return { w, h, argb }; };
const lumAt = (p, i) => { const c = p.argb[i]; return Math.floor((((c >> 16) & 255) * 299 + ((c >> 8) & 255) * 587 + (c & 255) * 114) / 1000); };
const satAt = (p, i) => { const c = p.argb[i]; const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : Math.floor(((mx - mn) * 255) / mx); };
export const FULL_QUAD = { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 }, confidence: 0 };
export const regionToQuad = (r) => ({ tl: { x: r.left, y: r.top }, tr: { x: r.right, y: r.top }, br: { x: r.right, y: r.bottom }, bl: { x: r.left, y: r.bottom }, confidence: r.confidence ?? 1 });
export const quadPoints = (q) => [q.tl, q.tr, q.br, q.bl];

export function otsu(lum) {
  const hist = new Array(256).fill(0); for (const v of lum) hist[v]++;
  const total = lum.length; let sum = 0; for (let i = 0; i <= 255; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 127;
  for (let i = 0; i <= 255; i++) {
    wB += hist[i]; if (wB === 0) continue;
    const wF = total - wB; if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; t = i; }
  }
  return t;
}

/** Cells of the largest connected group of true values (4-neighbourhood), as indices. */
export function largestComponent(mask, w, h) {
  const seen = new Uint8Array(mask.length); let best = null; const queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let head = 0, tail = 0; queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const i = queue[head++], x = i % w, y = (i - x) / w;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; queue[tail++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; queue[tail++] = i + 1; }
      if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; queue[tail++] = i - w; }
      if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; queue[tail++] = i + w; }
    }
    if (!best || tail > best.length) best = Int32Array.from(queue.subarray(0, tail));
  }
  return best;
}

const shoelace = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; s += x1 * y2 - x2 * y1; } return s / 2; };

/** Finds a recipe card or page lying on a darker surface. Answers only when a light, four-sided shape clearly stands out; otherwise null. */
export function findDocument(p) {
  const n = p.w * p.h;
  const lum = new Int32Array(n); for (let i = 0; i < n; i++) lum[i] = lumAt(p, i);
  const t = otsu(lum);
  let borderLight = 0, border = 0;
  const bx = Math.max(1, Math.floor(p.w / 25)), by = Math.max(1, Math.floor(p.h / 25));
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (x < bx || y < by || x >= p.w - bx || y >= p.h - by) { border++; if (lum[y * p.w + x] > t) borderLight++; }
  if (borderLight > border * 0.6) return null;           // light all the way to the edge: the page fills the picture, or there is no contrast
  let mx = 0, mn = 255; for (const v of lum) { if (v > mx) mx = v; if (v < mn) mn = v; }
  if (mx - mn < 50) return null;
  const mask = new Uint8Array(n); for (let i = 0; i < n; i++) mask[i] = lum[i] > t ? 1 : 0;
  const comp = largestComponent(mask, p.w, p.h); if (!comp) return null;
  const area = comp.length; if (area < n * 0.12) return null;
  const X = (i) => i % p.w, Y = (i) => Math.floor(i / p.w);
  let tl = comp[0], br = comp[0], tr = comp[0], bl = comp[0];
  let sumMin = Infinity, sumMax = -Infinity, diffMin = Infinity, diffMax = -Infinity;
  for (const i of comp) {
    const sum = X(i) + Y(i), diff = X(i) - Y(i);
    if (sumMin > sum) { sumMin = sum; tl = i; }
    if (sumMax < sum) { sumMax = sum; br = i; }
    if (diffMax < diff) { diffMax = diff; tr = i; }
    if (diffMin > diff) { diffMin = diff; bl = i; }
  }
  const pts = [tl, tr, br, bl].map((i) => [X(i), Y(i)]);
  const quadArea = Math.abs(shoelace(pts)); if (quadArea < 1) return null;
  const fit = Math.min(area / quadArea, quadArea / area);   // 1 when the light shape is exactly this four-sided figure
  const sides = pts.map(([ax, ay], i) => { const [cx, cy] = pts[(i + 1) % 4]; return Math.hypot(ax - cx, ay - cy); });
  if (fit < 0.82 || Math.min(...sides) < Math.min(p.w, p.h) * 0.2) return null;
  // the light shape must lie inside the four corners and fill them: an L or a ragged patch is not a card
  let inside = 0;
  for (const i of comp) {
    const px = X(i), py = Y(i); let ok = true;
    for (let k = 0; k < 4; k++) { const [ax, ay] = pts[k], [cx, cy] = pts[(k + 1) % 4]; if ((cx - ax) * (py - ay) - (cy - ay) * (px - ax) < -1.5 * sides[k]) { ok = false; break; } }
    if (ok) inside++;
  }
  if (inside < area * 0.93 || inside < quadArea * 0.86) return null;
  const pt = (i) => ({ x: (X(i) + 0.5) / p.w, y: (Y(i) + 0.5) / p.h });
  return { tl: pt(tl), tr: pt(tr), br: pt(br), bl: pt(bl), confidence: Math.max(0, Math.min(1, fit)) };
}

const CELL = 6;
/** Finds a photograph of the dish printed on a cookbook page or card: a solid block of picture among lines of text. Returns { left, top, right, bottom, confidence } or null. */
export function findPhotoRegion(p) {
  const n = p.w * p.h;
  const hist = new Array(256).fill(0); for (let i = 0; i < n; i++) hist[lumAt(p, i)]++;
  let paper = 0, peak = -1;
  for (let v = 0; v <= 255; v++) { let around = 0; for (let k = Math.max(0, v - 6); k <= Math.min(255, v + 6); k++) around += hist[k]; if (around > peak) { peak = around; paper = v; } }
  if (peak < n * 0.25) return null;                      // no dominant paper tone: this is a photograph, not a page
  let paperSat = 0, paperCount = 0;
  for (let i = 0; i < n; i++) if (Math.abs(lumAt(p, i) - paper) <= 12) { paperSat += satAt(p, i); paperCount++; }
  const baseSat = paperCount === 0 ? 0 : Math.floor(paperSat / paperCount);
  const cw = Math.floor(p.w / CELL), ch = Math.floor(p.h / CELL);
  if (cw < 6 || ch < 6) return null;
  const cells = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    let off = 0, sat = 0;
    for (let y = cy * CELL; y < (cy + 1) * CELL; y++) for (let x = cx * CELL; x < (cx + 1) * CELL; x++) { const i = y * p.w + x; if (Math.abs(lumAt(p, i) - paper) > 30) off++; sat += satAt(p, i); }
    const count = CELL * CELL;
    cells[cy * cw + cx] = off > count * 0.7 || (Math.floor(sat / count) > baseSat + 45 && off > count * 0.35) ? 1 : 0;
  }
  const comp = largestComponent(cells, cw, ch); if (!comp) return null;
  let l = cw, r = -1, t = ch, b = -1;
  for (const i of comp) { const x = i % cw, y = Math.floor(i / cw); if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; }
  const bw = r - l + 1, bh = b - t + 1;
  const fill = comp.length / (bw * bh), share = (bw * bh) / (cw * ch), aspect = bw / bh;
  if (fill < 0.72 || share < 0.04 || share > 0.8 || bw < cw * 0.15 || bh < ch * 0.1 || aspect < 0.35 || aspect > 3.2) return null;
  // other sizeable picture blocks make the choice uncertain
  const main = new Set(comp); const rest = new Uint8Array(cells.length); for (let i = 0; i < cells.length; i++) rest[i] = cells[i] && !main.has(i) ? 1 : 0;
  const second = largestComponent(rest, cw, ch)?.length ?? 0;
  const confidence = Math.max(0, Math.min(1, fill * (second > comp.length * 0.5 ? 0.5 : 1) * Math.min(1, share / 0.08)));
  return { left: (l * CELL) / p.w, top: (t * CELL) / p.h, right: Math.min(1, ((r + 1) * CELL) / p.w), bottom: Math.min(1, ((b + 1) * CELL) / p.h), confidence };
}

/** Brightness and contrast for a cleaned page. Returns [scale, offset] for each colour channel: out = in * scale + offset; [1, 0] when already full range. */
export function autoLevels(p) {
  const hist = new Array(256).fill(0); const n = p.w * p.h; for (let i = 0; i < n; i++) hist[lumAt(p, i)]++;
  const percentile = (q) => { let acc = 0; const target = Math.floor(n * q); for (let v = 0; v <= 255; v++) { acc += hist[v]; if (acc >= target) return v; } return 255; };
  const lo = percentile(0.02), hi = percentile(0.92);
  if (hi - lo < 40) return [1, 0];
  const scale = Math.max(1, Math.min(2.4, 245 / (hi - lo)));
  return [scale, -lo * scale + 5];
}
