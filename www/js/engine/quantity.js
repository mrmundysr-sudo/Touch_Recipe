// Port of core/quantity/Quantity.kt: leading-quantity parsing, safe scaling and friendly formatting.
const vulgar = {
  '¼': 0.25, '½': 0.5, '¾': 0.75, '⅐': 1 / 7, '⅑': 1 / 9, '⅒': 0.1, '⅓': 1 / 3, '⅔': 2 / 3, '⅕': 0.2, '⅖': 0.4,
  '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};
const VULGAR_CLASS = '[¼½¾⅐-⅞]';

/** Anchored match (Kotlin's \G) of `src` at index `i` of `s`; returns the RegExp exec array with `.end`. */
export function at(src, s, i, flags = '') {
  const re = new RegExp(src, 'y' + flags);
  re.lastIndex = i;
  const m = re.exec(s);
  if (m) m.end = i + m[0].length;
  return m;
}

function number(s, start) {
  let i = start;
  const m = at('\\d+', s, i);
  if (m) {
    i = m.end;
    let v = parseFloat(m[0]);
    const dec = at('[.,](\\d{1,2})(?!\\d)', s, i);
    if (dec) { v += parseFloat('0.' + dec[1]); return [v, dec.end]; }
    const fr = at('\\s?/\\s?(\\d+)', s, i);
    if (fr) {
      const d = parseFloat(fr[1]);
      if (d === 0) return null;
      return [v / d, fr.end];
    }
    if (i < s.length && vulgar[s[i]] !== undefined) return [v + vulgar[s[i]], i + 1];
    const mixed = at('[ \\u00a0\\u2009\\-](\\d+)\\s?/\\s?(\\d+)', s, i);
    if (mixed) {
      const d = parseFloat(mixed[2]);
      if (d !== 0) return [v + parseFloat(mixed[1]) / d, mixed.end];
    }
    const mv = at('[ \\u00a0\\u2009](' + VULGAR_CLASS + ')', s, i);
    if (mv) return [v + vulgar[mv[1]], mv.end];
    return [v, i];
  }
  if (start < s.length && vulgar[s[start]] !== undefined) return [vulgar[s[start]], start + 1];
  if (start < s.length && s[start] === '.') {
    const d = at('\\.(\\d+)', s, start);
    if (d) return [parseFloat('0.' + d[1]), d.end];
  }
  return null;
}

export function parseLeading(line) {
  const s = line.trimStart();
  const offset = line.length - s.length;
  const first = number(s, 0);
  if (!first) return null;
  const low = first[0];
  let end = first[1];
  let high = null;
  const range = at('\\s*(?:-|–|—|to|or)\\s*', s, end, 'i');
  if (range) {
    const second = number(s, range.end);
    if (second && second[0] >= low) { high = second[0]; end = second[1]; }
  }
  if (end < s.length && /\p{L}/u.test(s[end]) && s[end] !== ' ') {
    const unitGlued = at('(g|kg|ml|l|oz|lb|lbs|cl|dl|tsp|tbsp)\\b', s, end, 'i');
    if (!unitGlued) return null;
  }
  return { low, high, endIndex: end + offset };
}

function reduce(n, d) {
  let a = n, b = d;
  while (b !== 0) { const t = a % b; a = b; b = t; }
  return a === 0 ? [n, d] : [n / a, d / a];
}

// Kotlin's roundToInt rounds half up (toward +infinity); Math.round does the same for the values used here.
export function format(value) {
  if (value <= 0) return '0';
  if (value >= 100) return String(Math.round(value));
  const whole = Math.floor(value);
  const frac = value - whole;
  if (frac < 0.02) return String(whole);
  if (frac > 0.98) return String(whole + 1);
  if (value < 10) {
    const eighths = frac * 8;
    const nearest = Math.round(eighths);
    if (Math.abs(eighths - nearest) < 0.16) {
      const [n, d] = reduce(nearest, 8);
      if (n === 0) return String(whole);
      if (n === d) return String(whole + 1);
      if (whole === 0) return `${n}/${d}`;
      return `${whole} ${n}/${d}`;
    }
    const thirds = frac * 3;
    const t = Math.round(thirds);
    if (Math.abs(thirds - t) < 0.06 && t >= 1 && t <= 2) return whole === 0 ? `${t}/3` : `${whole} ${t}/3`;
  }
  const r = Math.round(value * 10) / 10;
  return r === Math.floor(r) ? String(Math.trunc(r)) : String(r);
}

const regular = new Set(['cup', 'tablespoon', 'teaspoon', 'ounce', 'pound', 'clove', 'can', 'slice', 'stick', 'package', 'head', 'sprig', 'stalk', 'jar', 'bottle', 'piece', 'fillet', 'bag', 'box']);

export function adjustUnitNumber(rest, amount) {
  const m = /^(\s+)([A-Za-z]+)(?=[\s,.;)]|$)/.exec(rest);
  if (!m) return rest;
  const word = m[2];
  const lower = word.toLowerCase();
  const singular = lower.endsWith('s') && regular.has(lower.slice(0, -1)) ? lower.slice(0, -1) : lower;
  if (!regular.has(singular)) return rest;
  const out = amount > 1.0 ? singular + 's' : singular;
  const cased = word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase() ? out[0].toUpperCase() + out.slice(1) : out;
  return m[1] + cased + rest.slice(m[0].length);
}

export function scale(line, factor) {
  if (factor === 1 || factor <= 0 || !Number.isFinite(factor)) return line;
  const q = parseLeading(line);
  if (!q) return line;
  const lead = line.slice(0, line.length - line.trimStart().length);
  const rest = line.slice(q.endIndex);
  const low = format(q.low * factor);
  const scaledTop = (q.high ?? q.low) * factor;
  const text = q.high != null ? `${low}-${format(q.high * factor)}` : low;
  return lead + text + adjustUnitNumber(rest, scaledTop);
}

export function factor(baseServings, targetServings) {
  if (baseServings == null || baseServings <= 0 || targetServings == null || targetServings <= 0) return 1;
  return targetServings / baseServings;
}
