// Port of core/importer/ImageCandidates.kt: chooses the recipe's photograph from a web page, best first. Logos, avatars, adverts,
// icons and tracking pixels are left out; several good candidates are kept so the user can switch.
import { tagOf, attrOf, parentsOf, select } from './htmlparse.js';

const junk = /logo|icon|avatar|gravatar|sprite|spacer|pixel|blank|placeholder|loading|spinner|badge|banner|advert|\/ads?\/|doubleclick|emoji|smil(?:e|ies)|button|share|social|pinterest|facebook|twitter|instagram|youtube|rating|star|print|author|profile|1x1|data:image/i;
const notPhoto = /\.(?:svg|gif|ico)(?:[?#].*)?$/i;
const badContainer = /comment|sidebar|related|author|avatar|advert|sponsor|social|share|footer|nav|menu|widget|newsletter|popup|modal|breadcrumb|logo/i;

export function usable(url) {
  const last = url.slice(url.lastIndexOf('/') + 1) || url;
  return url.length >= 12 && url.length <= 2000 && !junk.test(last) && !notPhoto.test(url) && !url.startsWith('data:');
}
export function absolute(u, base) {
  try {
    const t = u.trim();
    const r = t.startsWith('//') ? `https:${t}` : base && !t.startsWith('http') ? new URL(t, base).toString() : t;
    return r.startsWith('http://') || r.startsWith('https://') ? r : null;
  } catch { return null; }
}
/** The widest entry of a `srcset`. */
function fromSrcset(s) {
  let best = null, bw = -1;
  for (const part of s.split(',')) {
    const bits = part.trim().split(/\s+/); const url = bits[0]; if (!url) continue;
    const w = parseFloat((bits[1] || '1').replace(/[wx]$/, '')); const width = Number.isNaN(w) ? 1 : w;
    if (width > bw) { bw = width; best = url; }
  }
  return best;
}
function imageUrl(img) {
  for (const a of ['data-pin-media', 'data-lazy-src', 'data-src', 'data-original', 'data-orig-file', 'data-large-file']) { const v = attrOf(img, a); if (v.trim() && !v.startsWith('data:')) return v; }
  for (const a of ['data-lazy-srcset', 'data-srcset', 'srcset']) { const v = attrOf(img, a); if (v.trim()) { const u = fromSrcset(v); if (u) return u; } }
  const src = attrOf(img, 'src'); return src.trim() && !src.startsWith('data:') ? src : null;
}

export function rankImages(doc, structured, pageUrl) {
  const out = new Set();
  const add = (u) => { const a = u ? absolute(u, pageUrl) : null; if (a && usable(a)) out.add(a); };
  // 1. the picture the recipe data names
  structured.forEach(add);
  // 2. the page's declared main image
  for (const sel of ['meta[property="og:image:secure_url"]', 'meta[property="og:image"]', 'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]', 'meta[itemprop="image"]']) doc.querySelectorAll(sel).forEach((e) => add(attrOf(e, 'content')));
  doc.querySelectorAll('link[rel="image_src"]').forEach((e) => add(attrOf(e, 'href')));
  doc.querySelectorAll('[itemprop="image"]').forEach((e) => add(attrOf(e, 'src') || attrOf(e, 'content') || attrOf(e, 'href')));
  // 3. pictures inside the recipe itself, in page order
  let scopes = [...doc.querySelectorAll('.wprm-recipe-container, .tasty-recipes, .mv-create-card, [itemtype*="schema.org/Recipe"], [class*=recipe-card], [class*=recipe-content], [class*=recipe__], article, main')];
  if (!scopes.length) scopes = doc.body ? [doc.body] : [];
  let taken = 0;
  for (const scope of scopes) for (const img of scope.querySelectorAll('img')) {
    if (taken >= 8) break;
    if (parentsOf(img).some((p) => p !== scope && badContainer.test(`${attrOf(p, 'class')} ${attrOf(p, 'id')}`) && !['body', 'html', 'main', 'article'].includes(tagOf(p)))) continue;
    const w = parseInt(attrOf(img, 'width'), 10), h = parseInt(attrOf(img, 'height'), 10);
    if ((!Number.isNaN(w) && w < 240) || (!Number.isNaN(h) && h < 160)) continue;                       // thumbnails, icons, pixels
    if (!Number.isNaN(w) && !Number.isNaN(h) && (w / h > 3.2 || h / w > 2.6)) continue;                 // banners and strips
    const before = out.size; add(imageUrl(img)); if (out.size > before) taken++;
  }
  return [...out].slice(0, 10);
}
