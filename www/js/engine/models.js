// Port of core/model/Models.kt. Plain data: factories fill the same defaults as the Kotlin data classes.
export const newId = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

export const Ingredient = (o) => ({ id: newId(), text: '', header: false, checked: false, ...o });
export const Direction = (o) => ({ id: newId(), text: '', timerSeconds: null, header: false, image: null, ...o });
export const Recipe = (o = {}) => ({
  id: newId(), title: '', description: '', notes: '', photo: null, sourceUrl: null, sourceName: null, cuisine: null,
  prepMinutes: null, cookMinutes: null, totalMinutes: null, servings: null, ingredients: [], directions: [], categoryIds: [],
  favorite: false, rawSource: null, createdAt: 0, updatedAt: 0, ...o,
});
export const GroceryItem = (o) => ({
  id: newId(), weekStart: '', name: '', quantityText: '', aisle: 'pantry', checked: false, sortIndex: 0, key: '',
  generated: false, edited: false, sources: [], ...o,
});

export const effectiveTotal = (r) => r.totalMinutes ?? ((r.prepMinutes != null || r.cookMinutes != null) ? (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0) : null);
export const searchText = (r) => (
  [r.title, r.description, r.notes, r.sourceUrl ?? '', r.sourceName ?? '', r.cuisine ?? '', ...r.ingredients.map((i) => i.text)].join('\n') + '\n'
).toLowerCase();

export const Confidence = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' };
export const ImportMethod = { JSON_LD: 'JSON_LD', MICRODATA: 'MICRODATA', HTML: 'HTML', TEXT: 'TEXT', OCR: 'OCR', SOCIAL_CAPTION: 'SOCIAL_CAPTION', MANUAL: 'MANUAL' };
export const Severity = { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR' };
export const warn = (field, message, severity = Severity.WARNING) => ({ field, message, severity });
