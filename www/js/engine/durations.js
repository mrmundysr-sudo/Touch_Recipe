// Port of core/importer/Durations.kt.
const num = (s) => parseFloat(String(s).replace(',', '.'));

export function toMinutes(raw) {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const iso = /^P(?:(\d+(?:[.,]\d+)?)W)?(?:(\d+(?:[.,]\d+)?)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/i.exec(s);
  if (iso && s.length > 1) {
    const g = (i) => (iso[i] ? num(iso[i]) : 0);
    const minutes = g(1) * 7 * 24 * 60 + g(2) * 24 * 60 + g(3) * 60 + g(4) + g(5) / 60;
    return minutes > 0 ? Math.max(1, Math.round(minutes)) : null;
  }
  return looseMinutes(s);
}

export function looseMinutes(s) {
  let total = 0, found = false;
  for (const m of s.matchAll(/(\d+(?:[.,]\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi)) {
    const v = num(m[1]);
    const u = m[2].toLowerCase();
    total += u.startsWith('d') ? v * 1440 : u.startsWith('h') ? v * 60 : u.startsWith('m') ? v : v / 60;
    found = true;
  }
  if (!found) { const plain = /^\d+$/.exec(s.trim()); return plain ? parseInt(plain[0], 10) : null; }
  return total > 0 ? Math.max(1, Math.round(total)) : null;
}

export function timerSeconds(direction) {
  const m = /(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|to|or)\s*(\d+(?:[.,]\d+)?))?\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/i.exec(direction);
  if (!m) return null;
  const v = num(m[1]);
  const u = m[3].toLowerCase();
  const seconds = u.startsWith('h') ? v * 3600 : u.startsWith('m') ? v * 60 : v;
  const r = Math.round(seconds);
  return r >= 5 && r <= 24 * 3600 ? r : null;
}
