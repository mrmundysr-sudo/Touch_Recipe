// Port of core/importer/Reconcile.kt: compares a recipe read from a page's data block with what the visible page shows.
import { Ingredient, Direction, Severity, warn } from './models.js';
import { timerSeconds } from './durations.js';
import { Trust, items, ingredientLike, stepLike } from './pagescan.js';

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
export const tokens = (s) => norm(s).split(' ').filter((t) => t && !/^\p{N}+$/u.test(t));
const leadingQty = /^\s*(?:\d|[¼½¾⅓⅔⅛⅜⅝⅞])/;
const squash = (s) => norm(s).replace(/ /g, '');

/** 0..1 likeness of two lines; high when one line's words are all contained in the other. */
export function similarity(a, b) {
  const qa = squash(a), qb = squash(b);
  if (qa && qa === qb) return 1.0;
  const x = new Set(tokens(a)), y = new Set(tokens(b));
  if (!x.size || !y.size) return norm(a) === norm(b) && norm(a) ? 1.0 : 0.0;
  let common = 0; for (const t of x) if (y.has(t)) common++;
  return Math.max(common / Math.max(x.size, y.size), common === Math.min(x.size, y.size) && Math.min(x.size, y.size) >= 1 ? 0.8 : 0.0);
}

/** Greedy one-to-one matching of a onto b; returns for each a-index the matched b-index or -1. */
function match(a, b) {
  const used = new Array(b.length).fill(false), out = new Array(a.length).fill(-1);
  a.forEach((s, i) => {
    let best = -1, bs = 0;
    b.forEach((t, j) => { if (!used[j]) { const v = similarity(s, t); if (v > bs) { bs = v; best = j; } } });
    if (best >= 0 && bs >= 0.6) { used[best] = true; out[i] = best; }
  });
  return out;
}
const outcome = (value, warnings = [], unplaced = [], changed = false) => ({ value, warnings, unplaced, changed });
const toIngredients = (sec) => sec.lines.map((l) => Ingredient({ text: l.text, header: l.header }));
const toDirections = (sec) => sec.lines.map((l) => (l.header ? Direction({ text: l.text, header: true }) : Direction({ text: l.text, timerSeconds: timerSeconds(l.text) })));
const plural = (n) => (n === 1 ? '' : 's');

export function ingredients(data, page) {
  const s = data.filter((i) => !i.header).map((i) => i.text);
  if (!page) return outcome(data);
  const p = items(page);
  if (!s.length) {
    if (!p.length) return outcome(data);
    const strong = page.trust === Trust.STRONG;
    return outcome(toIngredients(page), [warn('ingredients', strong ? 'Ingredients were read from the recipe card on the page.' : 'Ingredients were guessed from the page layout. Please check them against the original.', strong ? Severity.INFO : Severity.WARNING)], [], true);
  }
  const m = match(s, p);
  const covered = m.filter((j) => j >= 0).length / s.length;
  const matchedP = new Set(m.filter((j) => j >= 0));
  const extra = p.filter((_, j) => !matchedP.has(j));
  const richer = m.reduce((n, j, i) => n + (j >= 0 && !leadingQty.test(s[i]) && leadingQty.test(p[j]) && tokens(s[i]).every((t) => tokens(p[j]).includes(t)) ? 1 : 0), 0);
  const stSet = new Set(tokens(s.join(' ')));
  const collapsed = s.length <= 2 && p.length >= 3 && s.some((x) => x.length > 120) && p.filter((l) => tokens(l).every((t) => stSet.has(t))).length >= p.length * 0.7;
  const trusted = page.trust !== Trust.WEAK;
  // where the page line and the data line say the same thing, the data line's cleaner text is kept
  const pageList = () => {
    const back = new Map(); m.forEach((j, i) => { if (j >= 0) back.set(j, i); });
    let k = -1;
    return page.lines.map((l) => { if (l.header) return Ingredient({ text: l.text, header: true }); k++; const i = back.get(k); return Ingredient({ text: i != null && squash(s[i]) === squash(l.text) ? s[i] : l.text }); });
  };
  if (trusted && s.length <= 2 && p.length >= 4 && p.filter(ingredientLike).length >= p.length * 0.6) {
    return outcome(pageList(), [warn('ingredients', `The page's recipe data held only ${s.length} ingredient line${plural(s.length)}, so the ${p.length} shown on the page were used.`, Severity.INFO)], s.filter((_, i) => m[i] < 0), true);
  }
  if (collapsed) return outcome(toIngredients(page), [warn('ingredients', "The page's recipe data ran the ingredients together, so they were read from the page itself.", Severity.INFO)], [], true);
  if (trusted && covered >= 0.8 && richer >= Math.max(2, Math.floor(s.length * 0.3))) {
    return outcome(pageList(), [warn('ingredients', "The page's recipe data left out some amounts, so ingredients were read from the page itself.", Severity.INFO)], [], true);
  }
  const extraLike = extra.filter(ingredientLike);
  if (extra.length && covered >= 0.8 && p.length <= s.length * 2 + 3 && (page.trust === Trust.STRONG || (trusted && extraLike.length >= extra.length * 0.6))) {
    return outcome(pageList(), [warn('ingredients', `The page shows ${p.length} ingredient lines but its recipe data had ${s.length}; the fuller list from the page was used.`, Severity.INFO)], [], true);
  }
  if (extraLike.length && covered >= 0.5) {
    const w = warn('ingredients', `The page appears to list ${p.length} ingredient lines but ${s.length} were imported. Possibly missing: ${extraLike.slice(0, 4).join('; ')}${extraLike.length > 4 ? '…' : ''}`);
    return outcome(data, [w], extraLike, false);
  }
  return outcome(data);
}

export function directions(data, page) {
  const s = data.filter((d) => !d.header).map((d) => d.text);
  if (!page) return outcome(data);
  const p = items(page);
  if (!p.length) return outcome(data);
  if (!s.length) {
    const strong = page.trust === Trust.STRONG;
    return outcome(toDirections(page), [warn('directions', strong ? 'Directions were read from the recipe card on the page.' : 'Directions were guessed from the page layout. Please check them against the original.', strong ? Severity.INFO : Severity.WARNING)], [], true);
  }
  const st = tokens(s.join(' ')), pt = tokens(p.join(' '));
  if (!st.length || !pt.length) return outcome(data);
  const sSet = new Set(st), pSet = new Set(pt);
  const sInP = st.filter((t) => pSet.has(t)).length / st.length;   // how much of the data block the page also shows
  const pInS = pt.filter((t) => sSet.has(t)).length / pt.length;   // how much of the page text the data block has
  const trusted = page.trust !== Trust.WEAK;
  if (trusted && Math.floor(s.reduce((n, x) => n + x.length, 0) / s.length) < 45 && pt.length >= st.length * 3 && p.filter(stepLike).length >= 2) {
    return outcome(toDirections(page), [warn('directions', "The page's recipe data held only step titles, so the full directions were read from the page itself.", Severity.INFO)], s.filter((t) => p.every((x) => similarity(t, x) < 0.6)), true);
  }
  if (pInS >= 0.9) {
    // same words; prefer the page only when the data block ran several steps into one
    if (trusted && s.length === 1 && p.length >= 2 && sInP >= 0.9 && pt.length <= st.length * 1.2) {
      return outcome(toDirections(page), [warn('directions', "The page's recipe data ran the steps together, so they were read from the page itself.", Severity.INFO)], [], true);
    }
    return outcome(data);
  }
  if (trusted && sInP >= 0.85 && pt.length >= st.length * 1.1 && pt.length <= st.length * 2.5) {
    return outcome(toDirections(page), [warn('directions', 'The page shows more direction text than its recipe data had; the fuller version from the page was used.', Severity.INFO)], [], true);
  }
  if (sInP >= 0.5 && pt.length >= st.length * 1.2) {
    const m = match(p, s);
    const missing = p.filter((t, i) => m[i] < 0 && stepLike(t));
    if (missing.length) return outcome(data, [warn('directions', `The page appears to have more direction text than was imported (${missing.length} passage${plural(missing.length)}). Compare with the original.`)], missing, false);
  }
  return outcome(data);
}
