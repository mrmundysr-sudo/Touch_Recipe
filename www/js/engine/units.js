// Port of core/grocery/Units.kt.
export const Family = { US_VOLUME: 'US_VOLUME', METRIC_VOLUME: 'METRIC_VOLUME', US_WEIGHT: 'US_WEIGHT', METRIC_WEIGHT: 'METRIC_WEIGHT', COUNT: 'COUNT' };

const table = [
  ['tsp', Family.US_VOLUME, 1], ['tbsp', Family.US_VOLUME, 3], ['fl oz', Family.US_VOLUME, 6],
  ['cup', Family.US_VOLUME, 48], ['pint', Family.US_VOLUME, 96], ['quart', Family.US_VOLUME, 192], ['gallon', Family.US_VOLUME, 768],
  ['ml', Family.METRIC_VOLUME, 1], ['l', Family.METRIC_VOLUME, 1000],
  ['oz', Family.US_WEIGHT, 1], ['lb', Family.US_WEIGHT, 16],
  ['g', Family.METRIC_WEIGHT, 1], ['kg', Family.METRIC_WEIGHT, 1000],
].map(([name, family, factor]) => ({ name, family, factor }));
const byName = new Map(table.map((u) => [u.name, u]));

const synonyms = new Map();
const add = (canon, ...names) => names.forEach((n) => synonyms.set(n, canon));
add('tsp', 'tsp', 'tsps', 'teaspoon', 'teaspoons', 't');
add('tbsp', 'tbsp', 'tbsps', 'tbs', 'tablespoon', 'tablespoons', 'tbl');
add('fl oz', 'floz', 'fl.oz', 'fluid ounce', 'fluid ounces');
add('cup', 'cup', 'cups', 'c');
add('pint', 'pint', 'pints', 'pt');
add('quart', 'quart', 'quarts', 'qt');
add('gallon', 'gallon', 'gallons', 'gal');
add('ml', 'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres');
add('l', 'l', 'liter', 'liters', 'litre', 'litres');
add('oz', 'oz', 'ounce', 'ounces');
add('lb', 'lb', 'lbs', 'pound', 'pounds');
add('g', 'g', 'gram', 'grams', 'gramme', 'grammes');
add('kg', 'kg', 'kilogram', 'kilograms', 'kilo', 'kilos');

const countUnits = new Set(['clove', 'cloves', 'can', 'cans', 'pinch', 'pinches', 'dash', 'dashes', 'slice', 'slices', 'bunch', 'bunches',
  'package', 'packages', 'pkg', 'packet', 'packets', 'stick', 'sticks', 'head', 'heads', 'sprig', 'sprigs',
  'stalk', 'stalks', 'jar', 'jars', 'bottle', 'bottles', 'bag', 'bags', 'box', 'boxes', 'piece', 'pieces',
  'fillet', 'fillets', 'handful', 'handfuls', 'sheet', 'sheets', 'loaf', 'loaves', 'bulb', 'bulbs']);

const trimDots = (t) => t.toLowerCase().replace(/\.+$/, '');

export const Units = {
  display(unit, amount) {
    switch (unit) {
      case 'cup': case 'pint': case 'quart': case 'gallon': case 'lb':
        return amount > 1 && unit !== 'lb' ? unit + 's' : unit;
      case 'fl oz': case 'tsp': case 'tbsp': case 'oz': case 'ml': case 'l': case 'g': case 'kg':
        return unit;
      default:
        if (amount > 1 && !unit.endsWith('s')) {
          if (unit.endsWith('ch') || unit.endsWith('sh') || unit.endsWith('x')) return unit + 'es';
          return unit === 'loaf' ? 'loaves' : unit + 's';
        }
        return unit;
    }
  },
  lookup(token) { const c = synonyms.get(trimDots(token)); return c ? byName.get(c) : undefined; },
  isCountUnit(token) { return countUnits.has(trimDots(token)); },
  byCanonical(name) { return byName.get(name); },
  best(family, base) {
    switch (family) {
      case Family.US_VOLUME: {
        // Roll tablespoon totals up to cups once they are a clean fraction (10 tbsp -> 5/8 cup, 16 tsp -> 1/3 cup).
        if (base >= 12) { const c = base / 48; const e = c * 8, t = c * 3; if (Math.abs(e - Math.round(e)) < 0.02 || Math.abs(t - Math.round(t)) < 0.02) return [c, 'cup']; }
        return base >= 48 ? [base / 48, 'cup'] : base >= 3 ? [base / 3, 'tbsp'] : [base, 'tsp'];
      }
      case Family.METRIC_VOLUME: return base >= 1000 ? [base / 1000, 'l'] : [base, 'ml'];
      case Family.US_WEIGHT: return base >= 16 ? [base / 16, 'lb'] : [base, 'oz'];
      case Family.METRIC_WEIGHT: return base >= 1000 ? [base / 1000, 'kg'] : [base, 'g'];
      default: return [base, ''];
    }
  },
};
