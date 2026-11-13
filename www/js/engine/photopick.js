// Which picture of a source is the recipe photo? Pure rules on what is known about each picture (size, shape, mask, colour, where it came from).
//  - Banners, strips, tiny pictures, pictures with a see-through mask (adverts, logos) and mostly one-colour graphics are REJECTED: never chosen on their own,
//    but still listed so the person can use one if they really want it.
//  - Exactly one picture left: it is used automatically. Several: the finished-dish photo is preferred and the person is asked to check. None: no photo.
export const MIN_EDGE = 160, MIN_AREA = 40000;
export const BANNER_WIDE = 2.2, BANNER_TALL = 0.45;

/** { sat: mean saturation 0..1, flat: share of pixels within 12 of the median colour } from 0xAARRGGBB values (a reduced copy of the picture). */
export function statsFromPixels(argb) {
  const n = argb.length; if (!n) return { sat: 0, flat: 1 };
  const med = (ch) => { const v = new Uint8Array(n); for (let i = 0; i < n; i++) v[i] = (argb[i] >> ch) & 255; v.sort(); return v[n >> 1]; };
  const mr = med(16), mg = med(8), mb = med(0);
  let flat = 0, sat = 0;
  for (let i = 0; i < n; i++) {
    const r = (argb[i] >> 16) & 255, g = (argb[i] >> 8) & 255, b = argb[i] & 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat += mx === 0 ? 0 : (mx - mn) / mx;
    if (Math.abs(r - mr) <= 12 && Math.abs(g - mg) <= 12 && Math.abs(b - mb) <= 12) flat++;
  }
  return { sat: sat / n, flat: flat / n };
}

/** Why a picture cannot be the recipe photo (null when it can), with a short note for the person. */
export function assess(c) {
  const w = c.width || 0, h = c.height || 0;
  if (Math.min(w, h) < MIN_EDGE || w * h < MIN_AREA) return { rejected: 'tiny', note: 'Too small to be the recipe photo' };
  const aspect = w / h;
  if (aspect > BANNER_WIDE || aspect < BANNER_TALL) return { rejected: 'banner', note: 'Looks like a banner or an advert (a wide or tall strip)' };
  if (c.hasMask) return { rejected: 'mask', note: 'Has a see-through mask: looks like an advert or a logo' };
  if (c.stats && (c.stats.flat > 0.85 || (c.stats.sat < 0.04 && c.stats.flat > 0.6))) return { rejected: 'flat', note: 'Mostly one colour: looks like a graphic' };
  return { rejected: null, note: '' };
}
/** Higher is more likely the finished dish: bigger, more colourful, named first by the page or found as the photo on a recipe page. */
export function score(c) {
  const area = Math.min(1.5, Math.log(Math.max(1, (c.width || 0) * (c.height || 0))) / Math.log(1e6));
  const colour = c.stats ? Math.min(1, c.stats.sat * 2) : 0.3;
  const order = c.order == null ? 0 : Math.max(0, 0.6 - 0.15 * c.order);   // the page's own first choice
  const printed = c.source === 'page' ? 0.5 : 0;                            // the photo found printed on the recipe page
  return area + colour + order + printed;
}
/** Adds `rejected`, `note` and `score` to every candidate and picks one. needsCheck = the person should look at it before saving. */
export function choose(candidates) {
  const all = candidates.map((c) => { const a = assess(c); return { ...c, rejected: a.rejected, note: c.note || a.note, score: score(c) }; })
    .sort((x, y) => (x.rejected ? 1 : 0) - (y.rejected ? 1 : 0) || y.score - x.score);
  // `noAuto`: a guess that may be offered but never chosen on its own (e.g. a region found on the picture of a PDF page)
  const eligible = all.filter((c) => !c.rejected && !c.noAuto);
  if (!eligible.length) return { candidates: all, selectedId: null, needsCheck: false, reason: all.some((c) => c.rejected) ? 'only-rejected' : all.length ? 'only-guesses' : 'none' };
  const best = eligible[0];
  return { candidates: all, selectedId: best.id, needsCheck: eligible.length > 1 || best.source === 'page' || best.source === 'pdf', reason: eligible.length > 1 ? 'several' : 'one' };
}
