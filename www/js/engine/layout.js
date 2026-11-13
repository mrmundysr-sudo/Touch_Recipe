// Port of core/importer/LayoutReader.kt: puts positioned text (PDF text layer or recognised lines) back into reading order.
// Columns are read one after the other (never interleaved), rows of a table stay together, paragraph gaps become blank lines.
// A line is { text, left, top, right, bottom, page = 0, confidence = null }; y grows downward, any consistent unit.
const ln = (o) => ({ page: 0, confidence: null, ...o });
export const textLine = ln;
const height = (l) => l.bottom - l.top;
const midY = (l) => (l.top + l.bottom) / 2;
const minConf = (a, b) => { const v = [a, b].filter((x) => x != null); return v.length ? Math.min(...v) : null; };
const median = (v) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : 0);
const furnitureKey = (s) => s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
const byTopThenLeft = (a, b) => midY(a) - midY(b) || a.left - b.left;

export function read(lines) {
  const out = [];
  const groups = new Map();
  for (const l of lines.filter((x) => x.text && x.text.trim())) { const k = l.page ?? 0; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(ln(l)); }
  const pageKeys = [...groups.keys()].sort((a, b) => a - b);
  const pages = pageKeys.map((k) => mergeRows(groups.get(k)));
  // running headers and footers: the same line (page numbers aside) at the edge of most pages
  const edgeKeys = pages.map((rows) => { const s = [...rows].sort((a, b) => a.top - b.top); return new Set([...s.slice(0, 2), ...s.slice(-2)].map((l) => furnitureKey(l.text))); });
  const furniture = new Set();
  if (pages.length >= 2) {
    const counts = new Map(); for (const set of edgeKeys) for (const k of set) counts.set(k, (counts.get(k) || 0) + 1);
    for (const [k, v] of counts) if (v >= Math.max(2, Math.floor(pages.length * 0.6)) && k.length >= 4) furniture.add(k);
  }
  const dropped = [];
  for (const allRows of pages) {
    const sortedRows = [...allRows].sort((a, b) => a.top - b.top);
    const edge = new Set([...sortedRows.slice(0, 2), ...sortedRows.slice(-2)].filter((l) => furniture.has(furnitureKey(l.text))));
    dropped.push(...[...edge].map((l) => l.text));
    const rows = allRows.filter((l) => !edge.has(l));
    if (!rows.length) continue;
    const h = Math.max(median(rows.map(height)), 0.001);
    const ordered = [];
    cut(rows, h, ordered, 0);
    for (const block of ordered) {
      let prev = null;
      for (const l of block) {
        if (prev && l.top - prev.bottom > h * 0.9) out.push('');
        out.push(l.text.trim()); prev = l;
      }
      out.push('');
    }
  }
  // a web address printed in the footer is the recipe's source: keep it once, on its own line
  const url = /https?:\/\/\S+/.exec(dropped.join(' '));
  let text = out.join('\n');
  if (url) text += `\n${url[0]}\n`;
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/** Joins fragments that sit on one baseline with only a word gap between them. Wider gaps stay separate cells. */
function mergeRows(src) {
  const h = Math.max(median(src.map(height)), 0.001);
  const sorted = [...src].sort(byTopThenLeft);
  const bands = [];
  for (const l of sorted) { const band = bands[bands.length - 1]; if (band && Math.abs(midY(band[0]) - midY(l)) < h * 0.45) band.push(l); else bands.push([l]); }
  const out = [];
  for (const band of bands) {
    let cur = null;
    for (const l of [...band].sort((a, b) => a.left - b.left)) {
      if (cur && l.left - cur.right < h * 1.2) {
        const spaced = l.left - cur.right > h * 0.15 || cur.text.endsWith(' ') || l.text.startsWith(' ');
        cur = ln({ text: spaced ? `${cur.text.trimEnd()} ${l.text.trimStart()}` : cur.text + l.text, left: cur.left, top: Math.min(cur.top, l.top), right: Math.max(cur.right, l.right), bottom: Math.max(cur.bottom, l.bottom), page: cur.page, confidence: minConf(cur.confidence, l.confidence) });
      } else { if (cur) out.push(cur); cur = l; }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** Recursive XY-cut: split a region at a clear vertical gutter (columns) or else at a wide horizontal gap. */
function cut(lines, h, out, depth) {
  if (lines.length <= 2 || depth > 12) { out.push(rowsInOrder(lines, h)); return; }
  const gutter = verticalGutter(lines, h);
  if (gutter != null) {
    const left = lines.filter((l) => (l.left + l.right) / 2 < gutter), right = lines.filter((l) => (l.left + l.right) / 2 >= gutter);
    if (left.length && right.length && !isTable(left, right, h)) { cut(left, h, out, depth + 1); cut(right, h, out, depth + 1); return; }
  }
  // horizontal cut at a wide gap that leaves a part which can then be cut into columns
  const byTop = [...lines].sort((a, b) => a.top - b.top);
  const gaps = []; let bottom = byTop[0].bottom;
  for (let i = 1; i < byTop.length; i++) { const gap = byTop[i].top - bottom; if (gap > h * 0.6) gaps.push([gap, i]); bottom = Math.max(bottom, byTop[i].bottom); }
  for (const [, at] of [...gaps].sort((a, b) => b[0] - a[0]).slice(0, 8)) {
    const upper = byTop.slice(0, at), lower = byTop.slice(at);
    if (verticalGutter(upper, h) != null || verticalGutter(lower, h) != null) { cut(upper, h, out, depth + 1); cut(lower, h, out, depth + 1); return; }
  }
  out.push(rowsInOrder(lines, h));
}

/** x position of a gap that no line crosses, with at least three lines on each side. */
function verticalGutter(lines, h) {
  if (lines.length < 6) return null;
  const minX = Math.min(...lines.map((l) => l.left)), maxX = Math.max(...lines.map((l) => l.right));
  const spans = lines.map((l) => [l.left, l.right]).sort((a, b) => a[0] - b[0]);
  let reach = spans[0][1], best = null, bestW = h * 1.5;
  for (const s of spans.slice(1)) {
    if (s[0] > reach) {
      const w = s[0] - reach, x = (s[0] + reach) / 2;
      const l = lines.filter((q) => q.right <= x).length, r = lines.filter((q) => q.left >= x).length;
      if (w > bestW && l >= 3 && r >= 3 && x > minX + (maxX - minX) * 0.15 && x < minX + (maxX - minX) * 0.85) { bestW = w; best = x; }
    }
    reach = Math.max(reach, s[1]);
  }
  return best;
}

/** True when the two sides are cells of the same rows (amount | ingredient) rather than independent columns. */
function isTable(left, right, h) {
  const paired = left.filter((l) => right.some((r) => Math.abs(midY(r) - midY(l)) < h * 0.45)).length;
  const avg = (a) => a.reduce((n, l) => n + l.text.length, 0) / a.length;
  const l = avg(left), r = avg(right);
  const longer = l >= r ? left : right;
  // cells are short on both sides and are not sentences; a list beside running text is two columns, not a table
  return paired >= left.length * 0.7 && paired >= right.length * 0.6 && Math.min(l, r) <= 14 && Math.max(l, r) <= 30 && longer.filter((x) => x.text.trimEnd().endsWith('.')).length < longer.length * 0.3;
}

function rowsInOrder(lines, h) {
  const sorted = [...lines].sort(byTopThenLeft);
  const out = [];
  for (const l of sorted) {
    const p = out[out.length - 1];
    if (p && Math.abs(midY(p) - midY(l)) < h * 0.45 && l.left >= p.right) {
      out[out.length - 1] = ln({ text: `${p.text.trimEnd()} ${l.text.trimStart()}`, left: p.left, top: Math.min(p.top, l.top), right: l.right, bottom: Math.max(p.bottom, l.bottom), page: p.page, confidence: minConf(p.confidence, l.confidence) });
    } else out.push(l);
  }
  return out;
}
