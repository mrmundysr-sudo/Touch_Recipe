// Port of core/importer/LayoutReader.kt: puts positioned text (PDF text layer or recognised lines) back into reading order.
// Columns are read one after the other (never interleaved), rows of a table stay together, paragraph gaps become blank lines.
// A line is { text, left, top, right, bottom, page = 0, confidence = null }; y grows downward, any consistent unit.
// 2026-11 (iOS PDF repair): fraction pieces are joined, an amount column that sits beside multi-line ingredients is kept as one
// table block, wrapped big headings are joined, and a second recipe card on the same page is set aside instead of mixed in.
// Not yet in core/importer/LayoutReader.kt (Android); see docs/knowledge/reports/2026-11-13-ios-pdf-layout.md.
const ln = (o) => ({ page: 0, confidence: null, ...o });
export const textLine = ln;
const height = (l) => l.bottom - l.top;
const midY = (l) => (l.top + l.bottom) / 2;
const minConf = (a, b) => { const v = [a, b].filter((x) => x != null); return v.length ? Math.min(...v) : null; };
const median = (v) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : 0);
const furnitureKey = (s) => s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
const byTopThenLeft = (a, b) => midY(a) - midY(b) || a.left - b.left;

export function read(lines) { return readWithNotes(lines).text; }

/** Like read(), plus { notes, extra }: notes are things the person should be told, extra is text of other recipes left out. */
export function readWithNotes(lines) {
  const out = [];
  const ctx = { alt: [], notes: [], applied: false };
  const groups = new Map();
  for (const l of lines.filter((x) => x.text && x.text.trim())) { const k = l.page ?? 0; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(ln(l)); }
  const pageKeys = [...groups.keys()].sort((a, b) => a - b);
  const pages = pageKeys.map((k) => mergeRows(prepare(groups.get(k))));
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
    const h = Math.max(median(rows.filter((l) => !l.table).map(height)), 0.001);
    const ordered = [];
    cut(rows, h, ordered, 0, ctx);
    emit(ordered, h, out);
  }
  // a web address printed in the footer is the recipe's source: keep it once, on its own line
  const url = /https?:\/\/\S+/.exec(dropped.join(' '));
  let text = out.join('\n');
  if (url) text += `\n${url[0]}\n`;
  const tidy = (t) => t.replace(/\n{3,}/g, '\n\n').trim();
  const extra = [];
  if (ctx.alt.length) { emit(ctx.alt, 14, extra); ctx.notes.push('This page shows more than one recipe. The first one was read; the other was left out (it is kept with the original).'); }
  return { text: tidy(text), notes: ctx.notes, extra: tidy(extra.join('\n')) };
}

/** Writes blocks of lines as text: a paragraph gap becomes a blank line and a heading that wrapped onto several lines is joined. */
function emit(blocks, h, out) {
  const big = (l) => !l.table && height(l) >= h * 1.6;
  for (const block of blocks) {
    let prev = null, last = -1;
    for (const l of block) {
      if (prev && l.top - prev.bottom > h * 0.9) { out.push(''); last = -1; }
      if (prev && last >= 0 && big(prev) && big(l) && Math.abs(height(l) - height(prev)) <= height(prev) * 0.2 && l.top - prev.bottom <= height(l) * 0.5 && !/[.:;!?]$/.test(prev.text.trim())) out[last] += ` ${l.text.trim()}`;
      else { out.push(l.text.trim()); last = out.length - 1; }
      prev = l;
    }
    out.push('');
  }
}

/** Joins fragments that sit on one baseline with only a word gap between them. Wider gaps stay separate cells. */
function mergeRows(all) {
  const tables = all.filter((l) => l.table), src = all.filter((l) => !l.table);
  if (!src.length) return tables;
  return [...mergeBands(src), ...tables];
}
function mergeBands(src) {
  const h = Math.max(median(src.map(height)), 0.001);
  const sorted = [...src].sort(byTopThenLeft);
  const bands = [];
  for (const l of sorted) { const band = bands[bands.length - 1]; if (band && Math.abs(midY(band[0]) - midY(l)) < h * 0.45) band.push(l); else bands.push([l]); }
  const out = [];
  for (const band of bands) {
    let cur = null;
    for (const l of [...band].sort((a, b) => a.left - b.left)) {
      // a piece that overlaps the one before it by more than a third of a line height is another layer of the page (text hidden under
      // visible text, as in a printed web page's clipped card): it is never glued onto it
      if (cur && l.left - cur.right < h * 1.2 && l.left - cur.right > -h * 0.33) {
        const spaced = l.left - cur.right > h * 0.15 || cur.text.endsWith(' ') || l.text.startsWith(' ');
        cur = ln({ text: spaced ? `${cur.text.trimEnd()} ${l.text.trimStart()}` : cur.text + l.text, left: cur.left, top: Math.min(cur.top, l.top), right: Math.max(cur.right, l.right), bottom: Math.max(cur.bottom, l.bottom), page: cur.page, confidence: minConf(cur.confidence, l.confidence) });
      } else { if (cur) out.push(cur); cur = l; }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** Recursive XY-cut: split a region at a clear vertical gutter (columns) or else at a wide horizontal gap. */
function cut(lines, h, out, depth, ctx = { alt: [], notes: [], applied: true }) {
  const hasTable = lines.some((l) => l.table);
  if ((lines.length <= 2 && !hasTable) || depth > 12) { out.push(rowsInOrder(lines, h)); return; }
  const gutter = verticalGutter(lines, h);
  if (gutter != null) {
    const left = lines.filter((l) => (l.left + l.right) / 2 < gutter), right = lines.filter((l) => (l.left + l.right) / 2 >= gutter);
    if (left.length && right.length && !isTable(left, right, h)) {
      cut(left, h, out, depth + 1, ctx);
      // two complete recipe cards side by side: the first is the recipe, the second is kept apart (never mixed into it)
      if (!ctx.applied && isRecipeCard(left) && isRecipeCard(right)) { ctx.applied = true; cut(right, h, ctx.alt, depth + 1, ctx); }
      else cut(right, h, out, depth + 1, ctx);
      return;
    }
  }
  if (hasTable) { around(lines, h, out, depth, ctx); return; }
  // horizontal cut at a wide gap that leaves a part which can then be cut into columns
  const byTop = [...lines].sort((a, b) => a.top - b.top);
  const gaps = []; let bottom = byTop[0].bottom;
  for (let i = 1; i < byTop.length; i++) { const gap = byTop[i].top - bottom; if (gap > h * 0.6) gaps.push([gap, i]); bottom = Math.max(bottom, byTop[i].bottom); }
  for (const [, at] of [...gaps].sort((a, b) => b[0] - a[0]).slice(0, 8)) {
    const upper = byTop.slice(0, at), lower = byTop.slice(at);
    if (verticalGutter(upper, h) != null || verticalGutter(lower, h) != null) { cut(upper, h, out, depth + 1, ctx); cut(lower, h, out, depth + 1, ctx); return; }
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
    if (p && !p.table && !l.table && Math.abs(midY(p) - midY(l)) < h * 0.45 && l.left >= p.right) {
      out[out.length - 1] = ln({ text: `${p.text.trimEnd()} ${l.text.trimStart()}`, left: p.left, top: Math.min(p.top, l.top), right: l.right, bottom: Math.max(p.bottom, l.bottom), page: p.page, confidence: minConf(p.confidence, l.confidence) });
    } else out.push(l);
  }
  return out;
}

// ---- fraction pieces and amount columns (iOS PDF repair, 2026-11) ----

/** A region that holds a whole recipe: an Ingredients heading and a Directions heading (a table block carries its heading in its first line). */
function isRecipeCard(lines) {
  const marks = (re) => lines.some((l) => (l.table ? l.text.split('\n') : [l.text]).some((t) => re.test(t.trim())));
  return marks(/^ingredients\b/i) && marks(/^(directions|instructions|method|preparation)\b/i);
}

function prepare(frags) {
  const h = Math.max(median(frags.map(height)), 0.001);
  return peelTables(joinFractionPieces(frags, h), h);
}

const FRACTION = /^\d+\s*[⁄/]\s*\d+$/;
/** PDF text layers often draw 1⁄2 as three loose pieces (numerator, slash, denominator, at different heights): put them back together as 1/2. */
function joinFractionPieces(frags, h) {
  const tiny = (l) => !l.table && l.text.trim().length <= 2 && l.right - l.left <= h * 1.0 && /^[\d⁄/]+$/.test(l.text.trim());
  const pieces = frags.filter(tiny).sort((a, b) => a.left - b.left);
  const used = new Set(), made = [];
  for (let i = 0; i < pieces.length; i++) {
    if (used.has(pieces[i])) continue;
    const group = [pieces[i]];
    for (let j = i + 1; j < pieces.length; j++) {
      const last = group[group.length - 1], n = pieces[j];
      if (used.has(n)) continue;
      if (n.left - last.right <= h * 0.25 && n.top < last.bottom && last.top < n.bottom) group.push(n);
    }
    const text = group.map((g) => g.text.trim()).join('');
    if (group.length >= 2 && FRACTION.test(text)) {
      group.forEach((g) => used.add(g));
      made.push(ln({ text: text.replace(/[⁄]/g, '/'), left: Math.min(...group.map((g) => g.left)), top: Math.min(...group.map((g) => g.top)), right: Math.max(...group.map((g) => g.right)), bottom: Math.max(...group.map((g) => g.bottom)), page: group[0].page, confidence: group.reduce((c, g) => minConf(c, g.confidence), null) }));
    }
  }
  return used.size ? [...frags.filter((l) => !used.has(l)), ...made] : frags;
}

const AMOUNT = /^(?:\d+\s+)?\d+\s*[⁄/]\s*\d+$|^\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?$|^(?:\d+\s*)?[½⅓⅔¼¾⅛⅜⅝⅞]$/;

/**
 * Recipe sites print ingredients as a table: an amount column, then the ingredient text. The amount is centred on its
 * ingredient, so with a two- or three-line ingredient it sits beside the middle line, and no plain row-by-row reading pairs
 * them up. Here a stack of short numeric pieces whose edge lines up, each with text a clear gap to its right, is read as that
 * table: ingredient lines are grouped into blocks and each amount goes to the block it overlaps. The whole table then travels
 * through the column cut as one piece, so the column beside it can never be mixed into its rows.
 */
function peelTables(frags, h) {
  let cur = frags;
  for (let round = 0; round < 6; round++) {
    const made = peelOne(cur, h);
    if (!made) break;
    cur = made;
  }
  return cur;
}

function peelOne(frags, h) {
  const tol = h * 0.25;
  const amounts = frags.filter((l) => !l.table && AMOUNT.test(l.text.trim()) && l.right - l.left <= h * 4);
  if (amounts.length < 3) return null;
  const stacks = [];
  for (const edge of ['right', 'left']) {
    const sorted = [...amounts].sort((a, b) => a[edge] - b[edge]);
    let run = [];
    const flush = () => { if (run.length >= 3) stacks.push([...run].sort((a, b) => a.top - b.top)); run = []; };
    for (const a of sorted) { if (run.length && a[edge] - run[run.length - 1][edge] > tol) flush(); run.push(a); }
    flush();
  }
  const overlap = (a, b) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  for (const stack of stacks.sort((a, b) => b.length - a.length)) {
    const members = new Set(stack);
    const others = frags.filter((l) => !members.has(l) && !l.table);
    // the ingredient text to the right of each amount, a clear gap away (a word space is not enough: that is an ordinary "2 cups flour")
    const near = stack.map((a) => others.filter((o) => o.left >= a.right + h * 0.5 && o.left <= a.right + h * 3.2 && overlap(a, o) >= height(a) * 0.4).sort((x, y) => x.left - y.left)[0]).filter(Boolean);
    if (near.length < 3 || near.length < stack.length * 0.6) continue;
    const L = median(near.map((o) => o.left));
    if (near.filter((o) => Math.abs(o.left - L) <= tol).length < near.length * 0.7) continue;
    const top0 = stack[0].top - h * 4, bottom0 = stack[stack.length - 1].bottom + h * 4;
    const band = others.filter((o) => o.left >= L - tol && o.bottom >= top0 && o.top <= bottom0).sort((a, b) => a.left - b.left);
    // the text column ends at the first clear gap to the right
    let reach = -Infinity, R = Infinity;
    for (const o of band) { if (reach > -Infinity && o.left - reach >= h * 1.2) { R = reach; break; } reach = Math.max(reach, o.right); }
    const words = band.filter((o) => o.right <= R + 0.01);
    const lines = textLines(words, h);
    if (!lines.length) continue;
    const blocks = [];
    for (const l of lines) { const b = blocks[blocks.length - 1]; if (b && l.top - b.bottom <= h * 0.4) b.lines.push(l), b.bottom = Math.max(b.bottom, l.bottom); else blocks.push({ lines: [l], top: l.top, bottom: l.bottom }); }
    const centre = (o) => (o.top + o.bottom) / 2;
    const target = (a) => blocks.map((b) => ({ b, o: overlap(a, b) })).sort((x, y) => y.o - x.o || Math.abs(centre(x.b) - centre(a)) - Math.abs(centre(y.b) - centre(a)))[0];
    const given = new Map();
    for (const a of stack) { const t = target(a); if (t && t.o > -h * 0.5) { if (!given.has(t.b)) given.set(t.b, []); given.get(t.b).push(a); } }
    if (given.size < 3) continue;
    const joined = (b) => b.lines.reduce((t, l) => (t ? (/-$/.test(t) ? t + l.text : `${t} ${l.text}`) : l.text), '');
    const taken = new Set([...given.values()].flat());
    const rows = blocks.filter((b) => b.bottom >= Math.min(...[...given.keys()].map((k) => k.top)) && b.top <= Math.max(...[...given.keys()].map((k) => k.bottom)));
    const text = rows.map((b) => `${(given.get(b) || []).sort((x, y) => x.left - y.left).map((a) => a.text.trim()).join(' ')} ${joined(b)}`.trim());
    const bodyTop = Math.min(...rows.map((b) => b.top)), bodyBottom = Math.max(...rows.map((b) => b.bottom));
    const body = new Set(words.filter((w) => w.bottom >= bodyTop - 0.5 && w.top <= bodyBottom + 0.5));
    const left = Math.min(...[...taken].map((a) => a.left), L);
    // a short heading right above the table (Ingredients) belongs to it
    const above = others.filter((o) => !body.has(o) && o.bottom <= bodyTop + 0.5 && bodyTop - o.bottom <= h * 1.5 && o.left >= left - tol && o.right <= R + 0.01).sort((a, b) => b.bottom - a.bottom);
    let heading = [];
    if (above.length) { heading = above.filter((o) => Math.abs(centre(o) - centre(above[0])) < h * 0.45); if (heading.length > 4) heading = []; }
    const headText = heading.sort((a, b) => a.left - b.left).map((o) => o.text.trim()).join(' ');
    const parts = [...body, ...heading, ...taken];
    const table = ln({ text: [headText, ...text].filter(Boolean).join('\n'), left: Math.min(...parts.map((p) => p.left)), top: Math.min(...parts.map((p) => p.top)), right: Math.max(...parts.map((p) => p.right)), bottom: Math.max(...parts.map((p) => p.bottom)), page: stack[0].page, table: true });
    const gone = new Set(parts);
    return [...frags.filter((l) => !gone.has(l)), table];
  }
  return null;
}

/** Words that sit on one baseline become one line (left to right); lines come back top to bottom. */
function textLines(words, h) {
  const sorted = [...words].sort(byTopThenLeft), bands = [];
  for (const w of sorted) { const b = bands[bands.length - 1]; if (b && Math.abs(midY(b[0]) - midY(w)) < h * 0.45) b.push(w); else bands.push([w]); }
  return bands.map((b) => { const ws = [...b].sort((x, y) => x.left - y.left); return ln({ text: ws.map((w) => w.text.trim()).join(' '), left: ws[0].left, top: Math.min(...ws.map((w) => w.top)), right: Math.max(...ws.map((w) => w.right)), bottom: Math.max(...ws.map((w) => w.bottom)), page: ws[0].page }); });
}

/** A table block is a column of its own: what is above it, what is beside it on the left and right, and what is below it are read in that order. */
function around(lines, h, out, depth, ctx) {
  const T = lines.filter((l) => l.table).sort((a, b) => a.top - b.top)[0];
  const above = [], left = [], right = [], below = [];
  for (const l of lines) {
    if (l === T) continue;
    const cy = midY(l), cx = (l.left + l.right) / 2;
    if (cy < T.top) above.push(l); else if (cy > T.bottom) below.push(l); else if (cx < (T.left + T.right) / 2) left.push(l); else right.push(l);
  }
  if (above.length) cut(above, h, out, depth + 1, ctx);
  if (left.length) cut(left, h, out, depth + 1, ctx);
  out.push([T]);
  if (right.length) cut(right, h, out, depth + 1, ctx);
  if (below.length) cut(below, h, out, depth + 1, ctx);
}
