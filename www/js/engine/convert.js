// Port of core/units/Convert.kt.
import { format as qFormat } from './quantity.js';

export const Kind = { VOLUME: 'Volume', WEIGHT: 'Weight', TEMPERATURE: 'Temperature' };
const ML_PER_TSP = 4.92892159375, G_PER_OZ = 28.349523125;
export const volumeUnits = ['tsp', 'tbsp', 'fl oz', 'cup', 'pint', 'quart', 'gallon', 'ml', 'l'];
export const weightUnits = ['oz', 'lb', 'g', 'kg'];
export const temperatureUnits = ['°F', '°C', 'Gas mark'];
export const unitsFor = (kind) => (kind === Kind.VOLUME ? volumeUnits : kind === Kind.WEIGHT ? weightUnits : temperatureUnits);

const mlPer = (u) => ({ tsp: ML_PER_TSP, tbsp: ML_PER_TSP * 3, 'fl oz': ML_PER_TSP * 6, cup: ML_PER_TSP * 48, pint: ML_PER_TSP * 96, quart: ML_PER_TSP * 192, gallon: ML_PER_TSP * 768, ml: 1, l: 1000 })[u] ?? (() => { throw new Error('unit ' + u); })();
const gPer = (u) => ({ oz: G_PER_OZ, lb: G_PER_OZ * 16, g: 1, kg: 1000 })[u] ?? (() => { throw new Error('unit ' + u); })();
const gasMarks = [[1, 275], [2, 300], [3, 325], [4, 350], [5, 375], [6, 400], [7, 425], [8, 450], [9, 475]];
const minBy = (arr, f) => arr.reduce((best, x) => (f(x) < f(best) ? x : best), arr[0]);
const toF = (v, from) => (from === '°F' ? v : from === '°C' ? (v * 9) / 5 + 32 : minBy(gasMarks, (g) => Math.abs(g[0] - v))[1]);

export function convert(kind, value, from, to) {
  if (kind === Kind.VOLUME) return (value * mlPer(from)) / mlPer(to);
  if (kind === Kind.WEIGHT) return (value * gPer(from)) / gPer(to);
  const f = toF(value, from);
  if (to === '°F') return f;
  if (to === '°C') return ((f - 32) * 5) / 9;
  return minBy(gasMarks, (g) => Math.abs(g[1] - f))[0];
}

export function format(kind, v, unit) {
  if (kind === Kind.TEMPERATURE) return (unit === 'Gas mark' ? String(Math.trunc(v)) : String(Math.round(v))) + (unit === 'Gas mark' ? ' (gas mark)' : unit);
  let s;
  if (v < 0.01) s = v.toFixed(4);
  else if (v < 10) { const f = qFormat(v); s = f.includes('/') ? `${f} (${v.toFixed(2)})` : f; }
  else s = v.toFixed(1).replace(/\.0$/, '');
  return `${s} ${unit}`;
}

export const equivalents = ['3 tsp = 1 tbsp', '2 tbsp = 1 fl oz', '4 tbsp = 1/4 cup', '5 1/3 tbsp = 1/3 cup', '8 tbsp = 1/2 cup', '16 tbsp = 1 cup',
  '1 cup = 8 fl oz = 237 ml', '2 cups = 1 pint', '2 pints = 1 quart', '4 quarts = 1 gallon', '1 stick butter = 1/2 cup = 113 g',
  '1 lb = 16 oz = 454 g', '1 oz = 28 g', '1 cup flour ≈ 120 g', '1 cup sugar ≈ 200 g', '1 cup butter = 227 g'];
export const ovenTemps = ['Very slow: 250 °F / 120 °C', 'Slow: 300 °F / 150 °C (gas mark 2)', 'Moderate: 350 °F / 180 °C (gas mark 4)', 'Moderately hot: 400 °F / 200 °C (gas mark 6)', 'Hot: 450 °F / 230 °C (gas mark 8)'];
