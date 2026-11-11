// Port of core/categories/Categories.kt.
export const MAX_CUSTOM_CATEGORIES = 50;
export const MAX_CATEGORY_NAME = 40;

export const starter = ['Breakfast', 'Lunch', 'Dinner', 'Appetizers', 'Main Dishes', 'Side Dishes', 'Snacks', 'Desserts', 'Drinks'];

export const groups = [
  ['Meal and course', ['Breakfast', 'Brunch', 'Lunch', 'Dinner', 'Appetizers', 'Main Dishes', 'Side Dishes', 'Snacks', 'Desserts', 'Drinks', 'Sauces, Dressings and Condiments']],
  ['Dish and cooking style', ['Soup and Stew', 'Salad', 'Pasta and Noodles', 'Rice and Grains', 'Casserole and Bake', 'Sandwich and Wrap', 'Pizza and Flatbread', 'Tacos and Burritos', 'Stir-Fry', 'Sheet-Pan Meal', 'One-Pot Meal', 'Slow Cooker', 'Pressure Cooker', 'Air Fryer', 'Grilling and BBQ', 'Roasting', 'No-Cook', 'Bread and Rolls', 'Cookies and Bars', 'Cakes and Cupcakes', 'Pies and Tarts', 'Preserves and Pickles']],
  ['Main ingredient', ['Chicken and Turkey', 'Beef', 'Pork', 'Lamb', 'Seafood', 'Eggs', 'Beans and Lentils', 'Tofu and Plant Protein', 'Vegetables', 'Fruit', 'Dairy and Cheese', 'Nuts and Seeds']],
  ['Cuisine and flavor', ['American', 'Southern', 'Cajun and Creole', 'Italian', 'Mexican', 'French', 'Greek', 'Mediterranean', 'Spanish', 'British and Irish', 'German', 'Caribbean', 'Chinese', 'Japanese', 'Korean', 'Thai', 'Vietnamese', 'Filipino', 'Indian', 'Middle Eastern', 'North African', 'Ethiopian']],
  ['Dietary and eating preference', ['Vegetarian', 'Vegan', 'Pescatarian', 'Gluten-Free', 'Dairy-Free', 'Nut-Free', 'Egg-Free', 'Low-Carb', 'Keto', 'Paleo', 'High-Protein', 'Low-Sodium', 'Low-Sugar']],
  ['Time, planning and occasion', ['30 Minutes or Less', 'Quick and Easy', 'Make-Ahead', 'Meal Prep', 'Freezer-Friendly', 'Budget-Friendly', 'Family Favorite', 'Kid-Friendly', 'Comfort Food', 'Holiday', 'Party', 'Potluck', 'Special Occasion', 'Camping and Outdoors']],
];

export const idFor = (name) => 'b_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export function seed() {
  let order = 0;
  return groups.flatMap(([group, names]) => names.map((n) => ({ id: idFor(n), name: n, group, builtIn: true, enabled: starter.includes(n), sortOrder: order++ })));
}

export const cleanName = (n) => n.trim().replace(/\s+/g, ' ');

/** -> {ok:true,name} | {ok:false,reason} */
export function validateNew(name, existing) {
  const n = cleanName(name);
  if (!n) return { ok: false, reason: 'Type a category name first.' };
  if (n.length > MAX_CATEGORY_NAME) return { ok: false, reason: `Category names can be up to ${MAX_CATEGORY_NAME} characters.` };
  if (existing.filter((c) => !c.builtIn).length >= MAX_CUSTOM_CATEGORIES) return { ok: false, reason: `You have reached the limit of ${MAX_CUSTOM_CATEGORIES} custom categories. Delete one to add another.` };
  const dup = existing.find((c) => c.name.toLowerCase() === n.toLowerCase());
  if (dup) return { ok: false, reason: `"${dup.name}" already exists.` };
  return { ok: true, name: n };
}

export function validateRename(id, name, existing) {
  const n = cleanName(name);
  if (!n) return { ok: false, reason: "Category name can't be empty." };
  if (n.length > MAX_CATEGORY_NAME) return { ok: false, reason: `Category names can be up to ${MAX_CATEGORY_NAME} characters.` };
  const dup = existing.find((c) => c.id !== id && c.name.toLowerCase() === n.toLowerCase());
  if (dup) return { ok: false, reason: `"${dup.name}" already exists.` };
  return { ok: true, name: n };
}
