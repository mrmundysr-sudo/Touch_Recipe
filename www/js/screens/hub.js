// Port of ui/screens/HubScreens.kt: splash, Kitchen Hub (with welcome + cook chooser) and the Junk Drawer.
import { h } from '../ui/dom.js';
import { ArtPage } from '../ui/art.js';
import { Routes } from '../ui/nav.js';
import { dialog } from '../ui/widgets.js';

export function splashScreen(params, ctx, nav) {
  let done = false;
  const go = () => { if (done) return; done = true; nav.go(Routes.HUB, {}, { root: true }); };
  const art = ArtPage(ctx.art, 'splash', { title: 'Touch Recipe', prefs: ctx.prefs, onTarget: () => {} });
  art.el.addEventListener('click', go);
  // Prepare local data while the splash is visible, but never trap the user: a hard 1.6 s ceiling and tap-to-skip.
  (async () => {
    const min = new Promise((r) => setTimeout(r, 900));
    await Promise.race([(async () => { await ctx.repo.ensureSeeded(); await ctx.photos.sweep(new Set(ctx.repo.recipes().map((r) => r.photo).filter(Boolean))); })(), new Promise((r) => setTimeout(r, 1600))]).catch(() => {});
    await min; go();
  })();
  return art;
}

function cookChooser(ctx, nav, recipes) {
  const usable = recipes.filter((r) => r.directions.some((d) => !d.header));
  let dlg;
  const content = recipes.length === 0
    ? h('p', null, "You don't have any recipes yet. Bring one in first, then come back to the stove.")
    : h('div', { style: 'max-height:360px;overflow:auto', 'data-testid': 'cook-chooser' }, usable.map((r) => h('button', { class: 'listrow', type: 'button', onclick: () => { dlg.close(); nav.go(Routes.COOK, { id: r.id }); } }, r.title.trim() || 'Untitled recipe')));
  dlg = dialog({ title: 'What are we cooking?', content, confirm: recipes.length === 0 ? 'Import a recipe' : null, cancel: 'Close', onConfirm: () => nav.go(Routes.IMPORT) });
}

export function hubScreen(params, ctx, nav) {
  const art = ArtPage(ctx.art, 'hub', {
    title: 'Kitchen Hub', prefs: ctx.prefs,
    onTarget: (id) => {
      switch (id) {
        case 'stove': {
          const active = ctx.repo.activeCookSession();
          if (active && ctx.repo.getRecipe(active.recipeId)) nav.go(Routes.COOK, { id: active.recipeId });
          else cookChooser(ctx, nav, ctx.repo.recipes());
          break;
        }
        case 'calendar': nav.go(Routes.PLANNER); break;
        case 'new_recipe': nav.go(Routes.IMPORT); break;
        case 'search': nav.go(Routes.COLLECTION, { search: true }); break;
        case 'grocery': nav.go(Routes.GROCERY); break;
        case 'drawer': nav.go(Routes.DRAWER); break;
        case 'rolodex': nav.go(Routes.COLLECTION); break;
      }
    },
  });
  let welcome = null;
  if (!ctx.prefs.welcomeSeen) {
    welcome = dialog({ title: 'Welcome to Touch Recipe', confirm: "Let's cook", noCancel: true, dismissable: false,
      text: "Tap anything in the kitchen to explore: the Rolodex holds your recipes, the fridge card brings new ones in, and the stove starts cooking.\n\nYour recipes stay on this phone. Nothing is uploaded unless you choose to import from a web link.",
      onConfirm: () => { ctx.prefs.welcomeSeen = true; } });
  }
  art.destroy = () => welcome?.close();
  return art;
}

export function drawerScreen(params, ctx, nav) {
  return ArtPage(ctx.art, 'drawer', {
    title: 'Kitchen Junk Drawer', prefs: ctx.prefs,
    onTarget: (id) => {
      const m = { settings: Routes.SETTINGS, categories: Routes.CATEGORIES, backup: Routes.BACKUP, themes: Routes.THEMES, help: Routes.HELP, tools: Routes.TOOLS, print: Routes.PRINT };
      if (id === 'back') nav.backOr(Routes.HUB); else if (m[id]) nav.go(m[id]);
    },
  });
}
