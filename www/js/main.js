// App boot: storage, preferences, theme, art manifest, routes.
import { h } from './ui/dom.js';
import { ArtLoader } from './ui/art.js';
import { Nav, Routes } from './ui/nav.js';
import { initSnack, initOverlays } from './ui/widgets.js';
import { Repository } from './data/repo.js';
import { IdbBackend } from './data/idb.js';
import { PhotoStore } from './data/photos.js';
import { Prefs, TextSize } from './data/prefs.js';
import * as Planner from './engine/planner.js';
import { splashScreen, hubScreen, drawerScreen } from './screens/hub.js';
import { collectionScreen } from './screens/collection.js';
import { detailScreen } from './screens/detail.js';

export const routes = {
  [Routes.SPLASH]: splashScreen, [Routes.HUB]: hubScreen, [Routes.DRAWER]: drawerScreen,
  [Routes.COLLECTION]: collectionScreen, [Routes.DETAIL]: detailScreen,
};
export async function registerLateRoutes() {
  const mods = await Promise.allSettled([import('./screens/cook.js'), import('./screens/import.js'), import('./screens/review.js'), import('./screens/planner.js'), import('./screens/grocery.js'), import('./screens/utility.js')]);
  const [cook, imp, review, planner, grocery, util] = mods.map((m) => (m.status === 'fulfilled' ? m.value : {}));
  Object.assign(routes, {
    ...(cook.cookScreen ? { [Routes.COOK]: cook.cookScreen } : {}), ...(imp.importScreen ? { [Routes.IMPORT]: imp.importScreen } : {}), ...(review.reviewScreen ? { [Routes.REVIEW]: review.reviewScreen } : {}),
    ...(planner.plannerScreen ? { [Routes.PLANNER]: planner.plannerScreen } : {}), ...(grocery.groceryScreen ? { [Routes.GROCERY]: grocery.groceryScreen } : {}),
    ...(util.settingsScreen ? { [Routes.SETTINGS]: util.settingsScreen, [Routes.CATEGORIES]: util.categoriesScreen, [Routes.BACKUP]: util.backupScreen, [Routes.THEMES]: util.themesScreen, [Routes.HELP]: util.helpScreen, [Routes.TOOLS]: util.toolsScreen, [Routes.PRINT]: util.printScreen } : {}),
  });
}

function applyTheme(prefs) {
  const root = document.documentElement;
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const t = prefs.theme;
  root.dataset.theme = t === 'SYSTEM' ? (mq.matches ? 'dark' : 'light') : t.toLowerCase();
  root.style.setProperty('--ts', String(TextSize[prefs.textSize].scale));
  const reduced = prefs.motion === 'REDUCED' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.dataset.reduced = reduced ? '1' : '0';
}

import { ImportService } from './data/importer.js';
import { plugin } from './data/native.js';
export async function boot({ backend = new IdbBackend(), storage = globalThis.localStorage } = {}) {
  const prefs = new Prefs(storage);
  applyTheme(prefs);
  prefs.subscribe(() => applyTheme(prefs));
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(prefs));
  try { navigator.storage?.persist?.(); } catch { /* best effort: ask the OS not to evict recipes under storage pressure */ }
  const repo = await new Repository(backend).init();
  const photos = new PhotoStore(backend);
  const art = await new ArtLoader('art/').init();
  const weekState = { v: Planner.weekStart(Planner.today(), prefs.sundayStart ? 0 : 1), subs: new Set(), get value() { return this.v; }, set(x) { this.v = x; this.subs.forEach((f) => f()); }, subscribe(f) { this.subs.add(f); return () => this.subs.delete(f); } };
  const importer = new ImportService({ photos });
  let appInfo = null; try { appInfo = await plugin('App')?.getInfo?.(); } catch { /* browser */ }
  const ctx = { repo, prefs, photos, art, backend, importer, appInfo, week: weekState, importSession: { draft: null, photoFile: null, clear() { this.draft = null; this.photoFile = null; } }, pending: { share: null } };
  const root = document.getElementById('app');
  const host = h('div', { id: 'host', style: 'position:absolute;inset:0' });
  root.append(host);
  initOverlays(root); initSnack(root);
  await registerLateRoutes();
  const nav = new Nav(host, routes, ctx);
  ctx.nav = nav;
  window.__app = { ctx, nav };
  nav.go(Routes.SPLASH, {}, { root: true });
  if (window.__TOUR__) setTimeout(() => import('./tour.js').then((m) => m.runTour({ ctx, nav })).catch((e) => console.error(e)), 2500);
  return { ctx, nav };
}

if (typeof document !== 'undefined' && !window.__NO_BOOT__) boot().catch((e) => { console.error(e); document.body.append(h('pre', { style: 'color:#fff;padding:16px;position:fixed;z-index:99;white-space:pre-wrap' }, String(e && e.stack || e))); });
