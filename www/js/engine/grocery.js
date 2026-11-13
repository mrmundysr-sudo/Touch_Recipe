// Port of core/grocery/GroceryEngine.kt (parsing, aisles, merging planned meals, protecting user edits).
import { parseLeading, factor as qFactor, format } from './quantity.js';
import { Family, Units } from './units.js';
import { GroceryItem, newId } from './models.js';

export const AISLE_PRODUCE = 'produce', AISLE_MEAT = 'meat', AISLE_DAIRY = 'dairy', AISLE_PANTRY = 'pantry', AISLE_BAKERY = 'bakery';
export const DEFAULT_AISLES = [AISLE_PRODUCE, AISLE_MEAT, AISLE_DAIRY, AISLE_PANTRY, AISLE_BAKERY];

const prepWords = new RegExp(
  '\\b(fresh|freshly|large|small|medium|big|extra|ripe|raw|chopped|minced|diced|sliced|grated|shredded|peeled|' +
  'softened|melted|divided|packed|optional|finely|roughly|thinly|boneless|skinless|cold|warm|hot|room temperature|to taste|' +
  'for serving|for garnish|plus more|about|approximately|cut into[^,]*)\\b', 'gi');

const trimChars = (s, chars) => { let a = 0, b = s.length; while (a < b && chars.includes(s[a])) a++; while (b > a && chars.includes(s[b - 1])) b--; return s.slice(a, b); };
const upFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function quantityText(g) {
  if (g.quantity == null) return '';
  return format(g.quantity) + (g.unit ? ' ' + Units.display(g.unit, g.quantity) : '');
}

function singularUnit(u) {
  if (u === 'pinches') return 'pinch';
  if (u === 'dashes') return 'dash';
  if (u === 'bunches') return 'bunch';
  if (u === 'loaves') return 'loaf';
  if (u.endsWith('es') && u.length > 4 && (u.endsWith('ches') || u.endsWith('xes'))) return u.slice(0, -2);
  if (u.endsWith('s')) return u.slice(0, -1);
  return u;
}

export function parse(line) {
  const text = line.trim();
  const q = parseLeading(text);
  if (!q) return { quantity: null, unit: null, unitText: '', name: text };
  let rest = text.slice(q.endIndex).trim();
  const amount = q.high ?? q.low;
  const paren = /^\(([^)]*)\)\s*/.exec(rest);
  let sizeNote = '';
  if (paren) { sizeNote = paren[1]; rest = rest.slice(paren[0].length); }
  const tokenMatch = /^([A-Za-z.]+(?:\s?oz)?)\b/.exec(rest);
  let unit = null, unitText = '';
  if (tokenMatch) {
    const tok = tokenMatch[1];
    const two = /^(fl\.?\s?oz|fluid ounces?)/i.exec(rest);
    const u = two ? Units.byCanonical('fl oz') : Units.lookup(tok);
    const strip = (n) => { rest = rest.slice(n).trim(); if (rest.startsWith('of ')) rest = rest.slice(3); rest = rest.trim(); };
    if (u) { unit = u; unitText = u.name; strip(two ? two[0].length : tok.length); }
    else if (Units.isCountUnit(tok)) { unitText = singularUnit(tok.toLowerCase().replace(/\.+$/, '')); strip(tok.length); }
  }
  // "29oz can of Veg-All": the number is the container size, not a quantity -> 1 can (29 oz)
  if (unit && !sizeNote && !paren && (unit.family === Family.US_WEIGHT || unit.family === Family.METRIC_WEIGHT || unit.family === Family.METRIC_VOLUME || unit.name === 'fl oz')) {
    const cont = /^(cans?|jars?|packages?|pkgs?|bags?|bottles?|boxes?|cartons?|containers?|packs?)\b\s*(?:of\s+)?/i.exec(rest);
    if (cont) return { quantity: 1, unit: null, unitText: singularUnit(cont[1].toLowerCase()), name: `${rest.slice(cont[0].length).trim()} (${format(amount)} ${unit.name})` };
  }
  if (sizeNote) rest = `${rest} (${sizeNote})`;
  return { quantity: amount, unit, unitText, name: rest.trim() };
}

export function displayName(raw) {
  const noParen = raw.replace(/\([^)]*\)/g, ' ');
  const head = noParen.split(',')[0];
  const cleaned = trimChars(head.replace(/\s+/g, ' ').trim(), ['-', '–', ' ']).replace(/^((large|small|medium|big|extra|ripe|fresh|freshly)\s+)+/i, '');
  return cleaned || raw.trim();
}

function singular(w) {
  if (w.length <= 3) return w;
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('oes')) return w.slice(0, -2);
  if (w.endsWith('ches') || w.endsWith('shes') || w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ss') || w.endsWith('us')) return w;
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

export function normalizeKey(name) {
  let s = displayName(name).toLowerCase();
  s = s.replace(prepWords, ' ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const stop = new Set(['of', 'and', 'or', 'the', 'a']);
  return s.split(' ').filter((w) => w && !stop.has(w)).map(singular).join(' ');
}

const MEAT = ['chicken', 'beef', 'pork', 'turkey', 'bacon', 'sausage', 'ham', 'lamb', 'steak', 'salmon', 'shrimp', 'tuna', 'cod', 'fish', 'crab', 'lobster', 'scallop', 'prosciutto', 'anchovy', 'mince'];
const DAIRY = ['milk', 'cream', 'butter', 'cheese', 'yogurt', 'yoghurt', 'egg', 'parmesan', 'mozzarella', 'cheddar', 'ricotta', 'feta', 'sour cream', 'buttermilk', 'ghee'];
const BAKERY = ['bread', 'bun', 'roll', 'baguette', 'tortilla', 'pita', 'naan', 'bagel', 'croissant', 'brioche', 'ciabatta', 'loaf'];
const PRODUCE = ['onion', 'garlic', 'tomato', 'potato', 'carrot', 'celery', 'lettuce', 'spinach', 'kale', 'pepper', 'lemon', 'lime', 'apple', 'banana', 'basil', 'parsley', 'cilantro', 'mint', 'thyme', 'rosemary', 'ginger', 'cucumber', 'zucchini', 'mushroom', 'broccoli', 'cauliflower', 'cabbage', 'avocado', 'orange', 'berry', 'strawberry', 'blueberry', 'scallion', 'shallot', 'leek', 'corn', 'pea', 'bean sprout', 'squash', 'eggplant', 'asparagus', 'dill', 'chive', 'sage', 'fruit', 'herb', 'arugula', 'beet', 'radish'];
const NOT_PRODUCE = ['sauce', 'paste', 'powder', 'flake', 'dried', 'ground', 'canned', 'juice'];

export function aisleFor(key) {
  const k = key.toLowerCase();
  const has = (words) => words.some((w) => new RegExp('\\b' + w + '(s|es)?\\b').test(k));
  if (has(MEAT)) return AISLE_MEAT;
  if (has(DAIRY)) return AISLE_DAIRY;
  if (has(BAKERY)) return AISLE_BAKERY;
  if (has(PRODUCE) && !has(NOT_PRODUCE)) return AISLE_PRODUCE;
  return AISLE_PANTRY;
}

/** meals: [{recipe, servings}] -> merged generated items. */
export function generate(meals) {
  const acc = new Map();
  for (const meal of meals) {
    const f = qFactor(meal.recipe.servings, meal.servings);
    const ref = { recipeId: meal.recipe.id, title: meal.recipe.title };
    for (const ing of meal.recipe.ingredients) {
      if (ing.header || !ing.text.trim()) continue;
      const p = parse(ing.text);
      const nameKey = normalizeKey(p.name);
      if (!nameKey) continue;
      const family = p.unit ? p.unit.family : Family.COUNT;
      const unitLabel = p.unit ? '' : p.unitText;
      const key = `${nameKey}|${p.unit ? family : p.unitText}`;
      if (!acc.has(key)) acc.set(key, { key: nameKey, name: displayName(p.name), family, unitLabel, base: 0, sources: new Map() });
      const a = acc.get(key);
      a.sources.set(meal.recipe.id, ref);
      if (p.quantity == null) { if (a.base === 0) a.base = null; }
      else a.base = (a.base ?? 0) + p.quantity * f * (p.unit ? p.unit.factor : 1);
    }
  }
  return [...acc].map(([k, a]) => {
    let qty, unit;
    if (a.base == null || a.base === 0) { qty = null; unit = a.unitLabel; }
    else if (a.family === Family.COUNT) { qty = a.base; unit = a.unitLabel; }
    else [qty, unit] = Units.best(a.family, a.base);
    return { key: k, name: upFirst(a.name), quantity: qty, unit, family: a.family, aisle: aisleFor(a.key), sources: [...a.sources.values()] };
  });
}

export function merge(weekStart, existing, generated) {
  const byKey = new Map(existing.filter((i) => i.generated).map((i) => [i.key, i]));
  const out = existing.filter((i) => !i.generated);
  const seen = new Set();
  let next = existing.reduce((m, i) => Math.max(m, i.sortIndex), -1) + 1;
  for (const g of generated) {
    seen.add(g.key);
    const old = byKey.get(g.key);
    if (!old) out.push(GroceryItem({ id: newId(), weekStart, name: g.name, quantityText: quantityText(g), aisle: g.aisle, sortIndex: next++, key: g.key, generated: true, sources: g.sources }));
    else out.push(old.edited ? { ...old, sources: g.sources } : { ...old, name: g.name, quantityText: quantityText(g), sources: g.sources });
  }
  out.push(...existing.filter((i) => i.generated && !seen.has(i.key) && (i.checked || i.edited)));
  return out;
}
