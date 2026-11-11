// Port of core/planner/Planner.kt. Dates are ISO strings (YYYY-MM-DD) and are handled at local noon so DST never shifts a day.
const pad = (n) => String(n).padStart(2, '0');
export const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (iso, n) => { const d = fromIso(iso); d.setDate(d.getDate() + n); return toIso(d); };
export const today = () => toIso(new Date());
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** first: 0=Sunday ... 1=Monday (default). */
export function weekStart(iso, first = 1) {
  let d = fromIso(iso);
  while (d.getDay() !== first) d.setDate(d.getDate() - 1);
  return toIso(d);
}
export const days = (ws) => Array.from({ length: 7 }, (_, i) => addDays(ws, i));
export const dayLabel = (iso) => DAY[fromIso(iso).getDay()];
export const dateLabel = (iso) => { const d = fromIso(iso); return `${MON[d.getMonth()]} ${d.getDate()}`; };
export function rangeLabel(ws) {
  const a = fromIso(ws), e = fromIso(addDays(ws, 6));
  if (a.getFullYear() === e.getFullYear()) return `${dateLabel(ws)} – ${dateLabel(toIso(e))}`;
  const f = (d) => `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return `${f(a)} – ${f(e)}`;
}
