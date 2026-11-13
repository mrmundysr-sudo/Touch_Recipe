// Repairs words that were cut into pieces by a bad spacing guess ("s poon", "chic ken", "Chin ese").
// It never guesses from a dictionary. The evidence is the PDF's own plain text, which is not cut up (it is only in the wrong
// order): two or more neighbouring pieces are joined only when (1) the joined word occurs in the plain text and (2) at least one
// of the pieces is NOT a word of the plain text on its own. Real words always occur in the plain text, so a piece that does not
// is a fragment. Anything else is left exactly as it was.
const LETTERS = /^\p{L}+$/u;
const LEAD = /^[^\p{L}\p{N}]*/u;
const TRAIL = /[^\p{L}\p{N}]*$/u;

export const vocabulary = (text) => new Set((String(text || '').toLowerCase().match(/[\p{L}\p{N}]+(?:['’]\p{L}+)?/gu) || []).map((w) => w.replace('’', "'")));

/** Splits "(spoon," into its leading marks, its letters and its trailing marks. */
const parts = (t) => { const lead = LEAD.exec(t)[0]; const rest = t.slice(lead.length); const trail = TRAIL.exec(rest)[0]; return { lead, body: rest.slice(0, rest.length - trail.length), trail }; };

/** Joins the fragments of split words in one line. Returns the line unchanged when nothing is attested. */
export function healLine(line, vocab) {
  if (!vocab || !vocab.size || !line.includes(' ')) return line;
  const tok = line.split(' ');
  const out = [];
  for (let i = 0; i < tok.length;) {
    let hit = null;
    for (let k = Math.min(8, tok.length - i); k >= 2 && !hit; k--) {
      const p = tok.slice(i, i + k).map(parts);
      if (p.some((x) => !LETTERS.test(x.body))) continue;                       // letters only (an amount or a number is never a fragment)
      if (p.slice(0, -1).some((x) => x.trail) || p.slice(1).some((x) => x.lead)) continue;   // a comma or a bracket ends a word: they are two words
      const word = p.map((x) => x.body).join('');
      if (!vocab.has(word.toLowerCase())) continue;
      if (!p.some((x) => !vocab.has(x.body.toLowerCase()))) continue;           // every piece is a real word on its own: leave them alone
      hit = { k, text: p[0].lead + word + p[k - 1].trail };
    }
    if (hit) { out.push(hit.text); i += hit.k; } else { out.push(tok[i]); i++; }
  }
  // a mark left alone after a space ("crust ." "Serves :") belongs to the word before it
  for (let j = out.length - 1; j > 0; j--) if (/^[:;,.!?)\u201d]+$/.test(out[j])) { out[j - 1] += out[j]; out.splice(j, 1); }
  return out.join(' ');
}

const midY = (l) => (l.top + l.bottom) / 2;
/**
 * The same repair on the positioned pieces, BEFORE the layout reader: the reader decides columns and rows from the gaps between
 * pieces, and a word cut in pieces looks like several narrow columns. Neighbouring pieces on one line (gap under one line height)
 * are joined only on the same proof as above. Returns new pieces; the input is not changed.
 */
export function healPieces(lines, plain) {
  const vocab = vocabulary(plain);
  if (!vocab.size) return lines;
  const rows = [];
  for (const l of [...lines].sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || midY(a) - midY(b) || a.left - b.left)) {
    const row = rows.find((r) => (r[0].page ?? 0) === (l.page ?? 0) && Math.abs(midY(r[0]) - midY(l)) < Math.min(r[0].bottom - r[0].top, l.bottom - l.top) * 0.4);
    if (row) row.push(l); else rows.push([l]);
  }
  const out = [];
  for (const row of rows) {
    row.sort((a, b) => a.left - b.left);
    for (let i = 0; i < row.length;) {
      let hit = null;
      for (let k = Math.min(8, row.length - i); k >= 2 && !hit; k--) {
        const seg = row.slice(i, i + k);
        const h = Math.max(...seg.map((x) => x.bottom - x.top));
        if (seg.some((x, j) => j > 0 && x.left - seg[j - 1].right > h * 1.0)) continue;   // a real gap between columns: never joined
        const text = healLine(seg.map((x) => x.text.trim()).join(' '), vocab);
        if (!text.includes(' ') && seg.length > 1) hit = text;
        else if (seg.length === 2 && /^[:;,.!?)\u201d]+$/.test(seg[1].text.trim())) hit = seg[0].text.trim() + seg[1].text.trim();
        if (hit) hit = { k, text: hit, seg };
      }
      if (hit) {
        const b = hit.seg;
        out.push({ ...b[0], text: hit.text, left: Math.min(...b.map((x) => x.left)), right: Math.max(...b.map((x) => x.right)), top: Math.min(...b.map((x) => x.top)), bottom: Math.max(...b.map((x) => x.bottom)) });
        i += hit.k;
      } else { out.push(row[i]); i++; }
    }
  }
  return out;
}

export const healText = (text, plain) => { const v = vocabulary(plain); return String(text).split('\n').map((l) => healLine(l, v)).join('\n'); };

const SMALL_OK = new Set(['a', 'i', 'x']);
/** Share of the words that are one stray letter (not "a", "I" or "x"); a cut-up text has many, a clean one almost none. */
export function fragmentRate(text) {
  const words = String(text || '').match(/\p{L}+/gu) || [];
  if (!words.length) return 0;
  return words.filter((w) => w.length === 1 && !SMALL_OK.has(w.toLowerCase())).length / words.length;
}
