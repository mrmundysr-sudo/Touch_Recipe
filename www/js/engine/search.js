// Port of core/search/RecipeSearch.kt.
import { effectiveTotal, searchText } from './models.js';

export const Sort = {
  RECENT: 'Recently added', TITLE: 'Title A–Z', QUICKEST: 'Quickest first', FAVORITES: 'Favorites first', OLDEST: 'Oldest first',
};
const lc = (s) => s.toLowerCase();

export function filter(recipes, categories, query, categoryId, favoritesOnly, sort) {
  const names = new Map(categories.map((c) => [c.id, lc(c.name)]));
  const words = lc(query).split(/\s+/).filter(Boolean);
  const filtered = recipes.filter((r) => {
    if (favoritesOnly && !r.favorite) return false;
    if (categoryId != null && !r.categoryIds.includes(categoryId)) return false;
    if (!words.length) return true;
    const hay = searchText(r);
    const cats = r.categoryIds.map((id) => names.get(id)).filter(Boolean).join(' ');
    return words.every((w) => hay.includes(w) || cats.includes(w));
  });
  const byTitle = (a, b) => (lc(a.title) < lc(b.title) ? -1 : lc(a.title) > lc(b.title) ? 1 : 0);
  const out = [...filtered];
  switch (sort) {
    case Sort.RECENT: return out.sort((a, b) => b.createdAt - a.createdAt);
    case Sort.OLDEST: return out.sort((a, b) => a.createdAt - b.createdAt);
    case Sort.TITLE: return out.sort(byTitle);
    case Sort.QUICKEST: return out.sort((a, b) => ((effectiveTotal(a) ?? Infinity) - (effectiveTotal(b) ?? Infinity)) || byTitle(a, b));
    case Sort.FAVORITES: return out.sort((a, b) => (Number(b.favorite) - Number(a.favorite)) || byTitle(a, b));
    default: return out;
  }
}
