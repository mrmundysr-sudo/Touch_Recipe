// Port of core/importer/WebRecipeExtractor.kt: schema.org JSON-LD -> microdata -> HTML heuristics.
// It only reads what the user's own request returned; it does not bypass access controls.
// `parseHtml(html) -> Document` is injected (DOMParser in the app, linkedom in tests).
import { Recipe, Ingredient, Direction, Confidence, ImportMethod, Severity, warn } from './models.js';
import { toMinutes, timerSeconds, looseMinutes } from './durations.js';

let parseHtml = (html) => new DOMParser().parseFromString(html, 'text/html');
export const setHtmlParser = (fn) => { parseHtml = fn; };

const BLOCK = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL']);
/** jsoup-style text(): whitespace normalised and trimmed, block elements separated by a space. */
export function elText(node) {
  const walk = (n) => {
    if (n.nodeType === 3) return n.nodeValue;
    if (n.nodeType === 9 || n.nodeType === 11) return [...n.childNodes].map(walk).join('');
    if (n.nodeType !== 1) return '';
    const tag = n.tagName.toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE') return '';
    const inner = [...n.childNodes].map(walk).join('');
    return BLOCK.has(tag) ? ` ${inner} ` : inner;
  };
  return walk(node).replace(/\s+/g, ' ').trim();
}
const attr = (el, name) => el?.getAttribute?.(name) ?? '';
const blank = (s) => !s || !s.trim();
const isObj = (e) => e && typeof e === 'object' && !Array.isArray(e);
const num = (s) => { const m = /\d+/.exec(s); return m ? parseInt(m[0], 10) : null; };

function str(e) {
  if (e == null) return '';
  if (Array.isArray(e)) return str(e[0]);
  if (isObj(e)) return str(e.name ?? e.text ?? e['@value'] ?? e.url);
  return String(e);
}

function clean(s) {
  if (blank(s)) return '';
  const html = s.includes('<') && s.includes('>') ? s : `<p>${s}</p>`;
  return elText(parseHtml(html).body ?? parseHtml(html)).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

function absolute(u, base) {
  try {
    const t = u.trim();
    const r = t.startsWith('//') ? `https:${t}` : base && !t.startsWith('http') ? new URL(t, base).toString() : t;
    return r.startsWith('http://') || r.startsWith('https://') ? r : null;
  } catch { return null; }
}
const hostOf = (url) => { try { return new URL(url).host.replace(/^www\./, '') || null; } catch { return null; } };

export function failed(url, msg) {
  return { recipe: Recipe({ sourceUrl: url }), method: ImportMethod.HTML, confidence: Confidence.LOW, warnings: [warn('recipe', msg, Severity.ERROR)], imageCandidates: [] };
}

// ---------- JSON-LD ----------
const fixJson = (t) => t.replace(/[\u0000-\u001F]/g, ' ').replace(/,\s*([}\]])/g, '$1');
/** Splits text into its top-level {...} / [...] values (string-aware) so concatenated or junk-wrapped JSON can still be read. */
function topLevelValues(t) {
  const out = []; let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { if (depth > 0) inStr = true; continue; }
    if (c === '{' || c === '[') { if (depth === 0) start = i; depth++; }
    else if ((c === '}' || c === ']') && depth > 0) { depth--; if (depth === 0 && start >= 0) { out.push(t.slice(start, i + 1)); start = -1; } }
  }
  return out;
}
/** Reads every JSON value in a ld+json block, tolerating a BOM, comments/CDATA wrappers, `var x =` prefixes, trailing semicolons and commas,
 *  raw control characters, and several objects in one block. */
export function parseLenientAll(raw) {
  let s = raw.replace(/^\uFEFF/, '').replace(/^\s*<!--/, '').replace(/-->\s*$/, '').replace('//<![CDATA[', '').replace('//]]>', '').trim();
  s = s.replace(/^(?:(?:var|let|const)\s+\w+\s*=|window\.[\w.]+\s*=)\s*/, '').replace(/[;\s]+$/, '');
  for (const cand of [s, fixJson(s)]) { try { return [JSON.parse(cand)]; } catch { /* try the next repair */ } }
  const out = [];
  for (const chunk of topLevelValues(s)) { for (const cand of [chunk, fixJson(chunk)]) { try { out.push(JSON.parse(cand)); break; } catch { /* next */ } } }
  return out;
}

function collectRecipes(e, out) {
  if (Array.isArray(e)) { e.forEach((x) => collectRecipes(x, out)); return; }
  if (!isObj(e)) return;
  const type = e['@type'];
  const types = Array.isArray(type) ? type.map(str) : type == null ? [] : [str(type)];
  if (types.some((t) => t.toLowerCase() === 'recipe' || t.toLowerCase().endsWith('/recipe'))) out.push(e);
  for (const k of ['@graph', 'mainEntity', 'itemListElement', 'item']) if (e[k] != null) collectRecipes(e[k], out);
}

export function jsonLdRecipes(doc) {
  const out = [];
  for (const el of doc.querySelectorAll('script[type*="ld+json"]')) {
    for (const parsed of parseLenientAll(el.textContent || '')) collectRecipes(parsed, out);
  }
  return out;
}

function images(node, base) {
  const urls = [];
  const walk = (e) => {
    if (e == null) return;
    if (Array.isArray(e)) e.forEach(walk);
    else if (isObj(e)) walk(e.url ?? e.contentUrl ?? e['@id']);
    else if (String(e).trim()) urls.push(String(e));
  };
  walk(node);
  return [...new Set(urls.map((u) => absolute(u, base)).filter(Boolean))];
}

function instructionSteps(node) {
  const steps = [];
  const walk = (e) => {
    if (e == null) return;
    if (Array.isArray(e)) { e.forEach(walk); return; }
    if (isObj(e)) {
      if (str(e['@type']).toLowerCase() === 'howtosection' || e.itemListElement != null) {
        const name = clean(str(e.name));
        if (name) steps.push('§' + name);
        walk(e.itemListElement);
      } else {
        const t = clean(str(e.text ?? e.description ?? e.name));
        if (t) steps.push(t);
      }
      return;
    }
    const html = String(e).replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n');
    const body = parseHtml(html).body ?? parseHtml(html);
    steps.push(...(body.textContent || '').split('\n').map(clean).filter(Boolean));
  };
  walk(node);
  return steps;
}

export function servingsFrom(node) {
  const s = Array.isArray(node) ? (node.map(str).find((x) => /\d/.test(x)) ?? str(node[0])) : str(node);
  const n = num(s);
  return n != null && n >= 1 && n <= 999 ? n : null;
}

const dedupeConsecutive = (lines) => lines.reduce((acc, l) => { if (acc[acc.length - 1] !== l) acc.push(l); return acc; }, []);

function fromJsonLd(r, doc, pageUrl) {
  const warnings = [];
  const title = clean(str(r.name)) || clean(doc.title || '');
  const rawIng = r.recipeIngredient ?? r.ingredients;
  const ingLines = (Array.isArray(rawIng) ? rawIng : rawIng != null && !isObj(rawIng) ? [rawIng] : []).map((x) => clean(str(x))).filter(Boolean);
  const ingredients = dedupeConsecutive(ingLines).map((t) => Ingredient({ text: t }));
  const directions = instructionSteps(r.recipeInstructions).map((s) => (s.startsWith('§') ? Direction({ text: s.slice(1).trim().replace(/:+$/, ''), header: true }) : Direction({ text: s, timerSeconds: timerSeconds(s) })));
  const author = Array.isArray(r.author) ? str(r.author[0]) : str(r.author);
  const publisher = clean(str(r.publisher));
  const host = pageUrl ? hostOf(pageUrl) : null;
  const sourceName = [clean(author), publisher].find((x) => x && !x.startsWith('http')) ?? host;
  const rc = r.recipeCategory;
  const cats = (Array.isArray(rc) ? rc.map(str) : rc == null ? [] : str(rc).split(',')).map(clean).filter(Boolean);
  const rcu = r.recipeCuisine;
  const cuisine = clean(Array.isArray(rcu) ? str(rcu[0]) : str(rcu)) || null;
  const prep = toMinutes(str(r.prepTime)), cook = toMinutes(str(r.cookTime)), total = toMinutes(str(r.totalTime));
  const og = attr(doc.querySelector('meta[property="og:image"]'), 'content');
  const imgs = [...new Set([...images(r.image, pageUrl), ...(og ? [absolute(og, pageUrl)] : [])].filter(Boolean))];
  const servings = servingsFrom(r.recipeYield);
  const metaDesc = clean(attr(doc.querySelector('meta[property="og:description"]'), 'content') || attr(doc.querySelector('meta[name="description"]'), 'content'));
  const description = clean(str(r.description)) || metaDesc;
  const notes = clean(str(r.recipeNotes ?? r.notes));

  if (!ingredients.length) warnings.push(warn('ingredients', "The page's recipe data had no ingredients. Please add them."));
  if (!directions.length) warnings.push(warn('directions', "The page's recipe data had no directions. Please add them."));
  if (servings == null) warnings.push(warn('servings', 'Servings were not given.', Severity.INFO));
  if (prep == null && cook == null && total == null) warnings.push(warn('times', 'No times were given.', Severity.INFO));
  if (!imgs.length) warnings.push(warn('photo', 'No photo was found.', Severity.INFO));
  if (sourceName == null && pageUrl == null) warnings.push(warn('source', 'Source is unknown.', Severity.INFO));
  const stepTexts = directions.map((d) => d.text);
  if (stepTexts.length && stepTexts.every((t) => t.length < 4)) warnings.push(warn('directions', 'Some directions look incomplete. Compare with the original page.'));

  const recipe = Recipe({
    title, description, notes, sourceUrl: pageUrl, sourceName, cuisine, prepMinutes: prep, cookMinutes: cook, totalMinutes: total, servings,
    ingredients, directions, rawSource: JSON.stringify(r).slice(0, 60000),
  });
  const ok = title && ingredients.length && directions.some((d) => !d.header);
  const draft = { recipe, method: ImportMethod.JSON_LD, confidence: ok ? Confidence.HIGH : Confidence.MEDIUM, warnings, imageCandidates: imgs };
  if (cats.length) draft.warnings = [...warnings, warn('categories', `Suggested categories from the page: ${cats.join(', ')}`, Severity.INFO)];
  return draft;
}

// ---------- Microdata ----------
function microdata(doc, pageUrl) {
  const root = doc.querySelector('[itemtype*="schema.org/Recipe"]');
  if (!root) return null;
  const prop = (name) => [...root.querySelectorAll(`[itemprop="${name}"]`)];
  const text = (name) => { const el = prop(name)[0]; return el ? clean(attr(el, 'content') || elText(el)) : ''; };
  const ingredients = [...prop('recipeIngredient'), ...prop('ingredients')].map((e) => clean(elText(e))).filter(Boolean).map((t) => Ingredient({ text: t }));
  const steps = prop('recipeInstructions').flatMap((el) => {
    const lis = [...el.querySelectorAll('li, p')];
    return lis.length ? lis.map((x) => clean(elText(x))) : clean(el.textContent || '').split(/(?<=\.)\s{2,}|\n/).map(clean);
  }).filter(Boolean);
  const imgEl = prop('image')[0];
  const img = imgEl ? absolute(attr(imgEl, 'src') || attr(imgEl, 'content') || attr(imgEl, 'href') || '', pageUrl) : null;
  const time = (name) => { const el = prop(name)[0]; return el ? toMinutes(attr(el, 'datetime') || attr(el, 'content') || elText(el)) : null; };
  const recipe = Recipe({
    title: text('name'), description: text('description'), sourceUrl: pageUrl, sourceName: pageUrl ? hostOf(pageUrl) : null,
    prepMinutes: time('prepTime'), cookMinutes: time('cookTime'), servings: num(text('recipeYield')),
    ingredients, directions: steps.map((t) => Direction({ text: t, timerSeconds: timerSeconds(t) })),
  });
  return { recipe, method: ImportMethod.MICRODATA, confidence: ingredients.length && steps.length ? Confidence.MEDIUM : Confidence.LOW,
    warnings: [warn('recipe', "Read from the page's embedded recipe markup. Please check each field.", Severity.INFO)], imageCandidates: img ? [img] : [] };
}

// ---------- HTML heuristics ----------
const ingredientSelectors = ['.wprm-recipe-ingredient', '.tasty-recipes-ingredients li', '.mv-create-ingredients li', '.recipe-ingredients li',
  '[class*=ingredients] li', '[id*=ingredients] li', '[class*=ingredient] li', 'li[class*=ingredient]', 'li[itemprop=recipeIngredient]'];
const directionSelectors = ['.wprm-recipe-instruction-text', '.tasty-recipes-instructions li', '.mv-create-instructions li', '.recipe-directions li', '.recipe-instructions li',
  '[class*=instructions] li', '[class*=directions] li', '[id*=instructions] li', '[class*=method] li', '[class*=steps] li', '[class*=instruction] p'];

const LABEL_RE = /^\W*(prep(?:aration)?(?: time)?|cook(?:ing)?(?: time)?|total(?: time)?|ready in|serv(?:es|ings?)|yield|makes)\s*[:\-]?\s*(.*)$/i;
/** Visible "Servings: 10", "Prep time: 10 minutes" ... labels (used when a page has no recipe data block). */
export function labeledMeta(doc) {
  const out = { prep: null, cook: null, total: null, servings: null };
  for (const el of doc.querySelectorAll('li, p, div, span, td, dd, dt, strong, b, h4, h5, h6')) {
    const t = elText(el);
    if (t.length < 5 || t.length > 60) continue;
    const m = LABEL_RE.exec(t);
    if (!m || !/\d/.test(m[2])) continue;
    const key = m[1].toLowerCase(), v = m[2];
    if (key.startsWith('prep')) out.prep ??= looseMinutes(v);
    else if (key.startsWith('cook')) out.cook ??= looseMinutes(v);
    else if (key.startsWith('total') || key.startsWith('ready')) out.total ??= looseMinutes(v);
    else out.servings ??= num(v);
  }
  return out;
}

function heuristic(doc, pageUrl) {
  const ogTitle = attr(doc.querySelector('meta[property="og:title"]'), 'content');
  const h1 = doc.querySelector('h1');
  const title = clean(ogTitle || (h1 ? elText(h1) : '') || doc.title || '').replace(/\s*[|\-–—]\s*[^|\-–—]{0,40}$/, '').trim();
  const pick = (selectors) => {
    for (const s of selectors) {
      const texts = [...new Set([...doc.querySelectorAll(s)].map((e) => clean(elText(e))).filter(Boolean))];
      if (texts.length >= 2) return texts;
    }
    return [];
  };
  let ingredients = pick(ingredientSelectors);
  let steps = pick(directionSelectors);
  if (!ingredients.length || !steps.length) {
    const listAfter = (heading) => {
      const h = [...doc.querySelectorAll('h1,h2,h3,h4,h5,strong,b')].find((e) => heading.test(elText(e).trim().replace(/:+$/, '')));
      if (!h) return [];
      const p = h.parentElement;
      let n = p && ['DIV', 'SECTION'].includes(p.tagName.toUpperCase()) && p.children.length === 1 ? p : h;
      let sib = n.nextElementSibling, hops = 0;
      while (sib && hops < 6) {
        const items = ['UL', 'OL'].includes(sib.tagName.toUpperCase()) ? [...sib.querySelectorAll('li')] : [...sib.querySelectorAll('li, p')];
        const t = items.map((e) => clean(elText(e))).filter(Boolean);
        if (t.length >= 2) return t;
        sib = sib.nextElementSibling; hops++;
      }
      return [];
    };
    if (!ingredients.length) ingredients = listAfter(/^ingredients?$/i);
    if (!steps.length) steps = listAfter(/^(directions?|instructions?|method|preparation|steps?)$/i);
  }
  const og = attr(doc.querySelector('meta[property="og:image"]'), 'content');
  const img = og ? absolute(og, pageUrl) : null;
  const desc = clean(attr(doc.querySelector('meta[property="og:description"]'), 'content') || attr(doc.querySelector('meta[name="description"]'), 'content'));
  const lm = labeledMeta(doc);
  const recipe = Recipe({
    title, description: desc, sourceUrl: pageUrl, sourceName: pageUrl ? hostOf(pageUrl) : null,
    prepMinutes: lm.prep, cookMinutes: lm.cook, totalMinutes: lm.total, servings: lm.servings,
    ingredients: ingredients.map((t) => Ingredient({ text: t })), directions: steps.map((t) => Direction({ text: t, timerSeconds: timerSeconds(t) })),
  });
  const w = [warn('recipe', 'This page has no standard recipe data, so we guessed from its layout. Please check every field.', Severity.WARNING)];
  if (!ingredients.length) w.push(warn('ingredients', 'No ingredients were found.'));
  if (!steps.length) w.push(warn('directions', 'No directions were found.'));
  return { recipe, method: ImportMethod.HTML, confidence: Confidence.LOW, warnings: w, imageCandidates: img ? [img] : [] };
}

function mergeMissing(base, fill) {
  const b = base.recipe, f = fill.recipe;
  const r = { ...b, title: blank(b.title) ? f.title : b.title, description: blank(b.description) ? f.description : b.description,
    ingredients: b.ingredients.length ? b.ingredients : f.ingredients, directions: b.directions.length ? b.directions : f.directions,
    prepMinutes: b.prepMinutes ?? f.prepMinutes, cookMinutes: b.cookMinutes ?? f.cookMinutes, totalMinutes: b.totalMinutes ?? f.totalMinutes, servings: b.servings ?? f.servings };
  const filled = (!b.ingredients.length && f.ingredients.length) || (!b.directions.length && f.directions.length);
  const warnings = base.warnings.filter((w) => !((w.field === 'ingredients' && r.ingredients.length) || (w.field === 'directions' && r.directions.length)))
    .concat(filled ? [warn('recipe', 'Some parts were guessed from the page layout. Please check them.', Severity.WARNING)] : []);
  return { ...base, recipe: r, warnings, imageCandidates: [...new Set([...base.imageCandidates, ...fill.imageCandidates])], confidence: filled ? Confidence.MEDIUM : base.confidence };
}

export function extract(html, pageUrl) {
  let doc;
  try { doc = parseHtml(html); } catch { return failed(pageUrl, 'The page could not be read.'); }
  const warnings = [];
  const ld = jsonLdRecipes(doc);
  let draft = null;
  if (ld.length) {
    const size = (x) => (Array.isArray(x.recipeIngredient) ? x.recipeIngredient.length : Array.isArray(x.ingredients) ? x.ingredients.length : 0);
    const best = ld.reduce((a, b) => (size(b) > size(a) ? b : a));
    draft = fromJsonLd(best, doc, pageUrl);
    if (ld.length > 1) draft = { ...draft, warnings: [...draft.warnings, warn('recipe', `This page contains ${ld.length} recipes. We imported the most complete one; check that it's the one you wanted.`, Severity.INFO)] };
  }
  if (!draft || (!draft.recipe.ingredients.length && !draft.recipe.directions.length)) {
    const micro = microdata(doc, pageUrl);
    if (micro && (micro.recipe.ingredients.length || micro.recipe.directions.length)) draft = micro;
  }
  if (!draft || !draft.recipe.ingredients.length || !draft.recipe.directions.length) {
    const heur = heuristic(doc, pageUrl);
    draft = draft ? mergeMissing(draft, heur) : heur;
  }
  if (blank(draft.recipe.title) || (!draft.recipe.ingredients.length && !draft.recipe.directions.length)) {
    warnings.push(warn('recipe', 'No recipe could be found on this page. It may need you to sign in, load more content, or block automatic access. You can paste the recipe text instead.', Severity.ERROR));
  }
  return { ...draft, warnings: [...draft.warnings, ...warnings] };
}

export const parseDoc = (html) => parseHtml(html);
