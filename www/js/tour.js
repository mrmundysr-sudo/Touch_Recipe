// CI-only screen tour. The iOS build-check workflow injects `window.__TOUR__ = 1` into the generated copy of index.html so the
// simulator visits every screen with demo data and screenshots can be reviewed. It is never present in the project sources
// or in TestFlight builds, and it only runs when that flag exists.
import { Recipe, Ingredient, Direction } from './engine/models.js';
import * as Planner from './engine/planner.js';

export async function runTour({ ctx, nav }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  ctx.prefs.welcomeSeen = true;
  const r = Recipe({ id: 'r1', title: 'Spaghetti al Pomodoro', description: 'A simple weeknight classic.', servings: 4, prepMinutes: 10, cookMinutes: 20, categoryIds: ['b_dinner'], sourceName: 'example.com',
    ingredients: ['400 g spaghetti', '1 can (14 oz) crushed tomatoes', '2 cloves garlic', '3 tbsp olive oil', 'Fresh basil', 'Salt'].map((text) => Ingredient({ text })),
    directions: [['Boil the pasta in salted water for 10 minutes.', 600], ['Warm the oil and garlic, add tomatoes and simmer for 15 minutes.', 900], ['Toss everything together with basil.', null]].map(([text, timerSeconds]) => Direction({ text, timerSeconds })) });
  await ctx.repo.saveRecipe(r);
  await ctx.repo.saveRecipe(Recipe({ id: 'r2', title: 'Lemon Cake', servings: 8, categoryIds: ['b_desserts'], favorite: true, ingredients: [Ingredient({ text: '2 cups flour' })], directions: [Direction({ text: 'Bake.' })] }));
  await ctx.repo.assignMeal(Planner.today(), 'r1', 4);
  await ctx.repo.generateGroceries(ctx.week.value);
  for (const [n, q, a] of [['Milk', '1 l', 'dairy'], ['Eggs', '12', 'dairy'], ['Sourdough loaf', '', 'bakery'], ['Chicken thighs', '1.5 lb', 'meat'], ['Lemons', '3', 'produce']]) await ctx.repo.addGroceryItem(ctx.week.value, n, q, a);
  const steps = [['hub'], ['collection'], ['detail', { id: 'r1' }], ['cook', { id: 'r1' }], ['import'], ['review', { edit: 'r1' }], ['planner'], ['grocery'], ['drawer'], ['settings'], ['tools'], ['themes']];
  for (const [name, params] of steps) { nav.go(name, params || {}, { root: true }); await sleep(4500); }
}
