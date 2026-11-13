// Port of core/importer/PageScan.kt. Reads the ingredient list and the directions from the *visible* page, independently of any recipe
// data block: used to fill in what the data block lacks and to check it for omissions.
import { elText as jtext, tagOf, attrOf, kids, parentsOf, ownText, select, isBlock, htmlLines } from './htmlparse.js';

export const Trust = { STRONG: 'STRONG', MEDIUM: 'MEDIUM', WEAK: 'WEAK' };
const line = (text, header = false) => ({ text, header });
export const items = (sec) => sec.lines.filter((l) => !l.header).map((l) => l.text);

const ingWords = "ingredients?|ingredientes?|ingr[ée]dients?|ingredienti|ingredi[ëe]nten|ingredienser|ingredienten|zutaten|sk[łl]adniki|ainekset|hozz[áa]val[óo]k|suroviny|ingredience|sastojci|what you.?ll need|you.?ll need|you will need|what you need|shopping list|ингредиенты|υλικά|malzemeler|材料";
const stepWords = "directions?|instructions?|method|preparation|steps?|procedure|how to make(?: it| this)?|how to prepare|cooking instructions|recipe instructions|zubereitung|anleitung|so geht.?s|pr[ée]paration|preparaci[óo]n|elaboraci[óo]n|preparazione|procedimento|bereiding|bereidingswijze|tillagning|g[öo]r s[åa] h[äa]r|fremgangsm[åa]de|s[åa]dan g[øo]r du|przygotowanie|spos[óo]b przygotowania|postup|elk[ée]sz[íi]t[ée]s|modo de preparo|preparo|valmistus|приготовление|εκτέλεση|hazırlanışı|作り方";
const ingHeading = new RegExp(`^\\W*(?:the |for the )?(?:${ingWords})\\W*$`, 'i');
const stepHeading = new RegExp(`^\\W*(?:the )?(?:${stepWords})\\W*$`, 'i');
const endHeading = /^\W*(?:notes?|recipe notes?|tips?|nutrition(?:al)?(?: facts| information| info)?|video|equipment|tools|comments?|reviews?|related|you (?:may|might) also like|more recipes|leave a (?:reply|comment)|faq|frequently asked questions|storage|substitutions?|variations?)\b.*$/i;
const ingName = /ingredi|zutat|ainekset|skladnik|sastojci|hozzaval|surovin/i;
const stepName = /instruction|direction|method|preparation|prepara[ct]i|procedure|procedim|(?:^|[-_ ])steps?(?:$|[-_ ])|recipe-?steps|zubereitung|anleitung|bereiding|tillagning|fremgangs|postup|elkeszit|how-?to/i;
const notStepName = /payment|shipping|prep-?time|time|nutrition|comment|share|social|rating|review|print|video|jump|toc|breadcrumb|nav|menu|sidebar|widget|footer|header/i;
const notIngName = /comment|share|social|rating|review|nav|menu|sidebar|widget|footer|search|filter|tag-?cloud|related/i;
const qtyStart = /^\s*(?:\d|[¼½¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚]|a\s+(?:pinch|dash|handful|few|splash|drizzle|couple)\b|an?\s+\d|one\b|two\b|three\b|four\b|half\b|juice of|zest of|pinch\b|dash\b|handful\b|salt\b|pepper\b|kosher salt|sea salt|freshly|olive oil|vegetable oil|cooking spray|oil for|butter for|water\b)/i;
const unitWord = /\b(?:cups?|c\.|tbsps?|tsps?|tablespoons?|teaspoons?|tbs|oz|ounces?|lbs?|pounds?|grams?|g|gr|kg|ml|cl|dl|l|liters?|litres?|cloves?|cans?|pinch|dash|slices?|sticks?|packages?|pkgs?|bunch|sprigs?|stalks?|heads?|quarts?|pints?|gallons?|el|tl|stück|prise|bund|dose|msk|tsk|krm|st|dkg|dag|szt|ks|pcs?|pieces?)\b/i;

/** True for a line that reads like one ingredient ("2 cups flour", "Salt, to taste"). */
export function ingredientLike(lineText) {
  const t = lineText.trim();
  if (t.length < 2 || t.length > 200) return false;
  const words = t.split(/\s+/).length;
  if (t.endsWith('.') && words > 14) return false;
  if (qtyStart.test(t)) return true;
  return words <= 6 && unitWord.test(t);
}
/** True for a line that reads like a cooking step: a sentence of some length that is not an ingredient line. */
export function stepLike(lineText) {
  const t = lineText.trim();
  return t.length >= 25 && (t.match(/ /g) || []).length >= 4 && !(ingredientLike(t) && t.length < 60);
}

const INLINE = new Set(['b', 'i', 'em', 'strong', 'a', 'sup', 'sub', 'u', 'small', 'mark', 'font', 'abbr']);
/** Element text with a space between neighbouring pieces, so "<span>1</span><span>cup</span>" reads "1 cup" rather than "1cup". */
export function text(el) {
  let sb = '';
  const walk = (n) => {
    if (n.nodeType === 3) { sb += n.nodeValue; return; }
    if (n.nodeType !== 1) return;
    const t = tagOf(n);
    if (t === 'script' || t === 'style') return;
    const glue = INLINE.has(t);
    if (!glue && sb && !/\s$/.test(sb)) sb += ' ';
    n.childNodes.forEach(walk);
    if (!glue && sb && !/\s$/.test(sb)) sb += ' ';
  };
  walk(el);
  return sb.replace(/ /g, ' ').replace(/\s+/g, ' ').replace(/ ([,.;:)])/g, '$1').replace(/\( /g, '(').trim();
}
const norm = (s) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const bulletRe = /^[^\p{L}\p{Nd}(\[¼½¾⅓⅔⅛⅜⅝⅞]+(?=\S)/u;
const stepNumRe = /^\s*(?:step\s*)?\d{1,2}\s*[.):]\s+(?=\S)|^\s*step\s*\d{1,2}\s*[.):\-–—]?\s*/i;
const cleanIng = (s) => norm(s).replace(bulletRe, '').trim();
const cleanStep = (s) => norm(s).replace(bulletRe, '').replace(stepNumRe, '').trim();
const cls = (el) => `${attrOf(el, 'class')} ${attrOf(el, 'id')}`;
const headingTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const onlyQty = /^[\d\s/.,¼½¾⅓⅔⅛⅜⅝⅞-]+$/;
const looseStepHeading = /^.{0,30}(?:how to make|how to cook|here.?s how|let.?s get started|let.?s (?:make|cook|bake)|step.by.step|what to do|to make (?:the|this|it)|make it|assembly|to assemble|putting it together).{0,40}$/i;
const isStepHeading = (t) => stepHeading.test(t) || looseStepHeading.test(t);
const trimEnd = (s, ch) => { let e = s.length; while (e > 0 && s[e - 1] === ch) e--; return s.slice(0, e); };

export function scan(source) {
  const doc = source.cloneNode(true);
  const kill = (css) => doc.querySelectorAll(css).forEach((e) => e.remove());
  kill('script, style, noscript, template, svg, iframe, select, button, nav, form, footer, aside, [hidden], [role=contentinfo], [role=navigation], [role=dialog], .screen-reader-text, .sr-only, .visually-hidden, .wprm-screen-reader-text');
  // page furniture, matched by exact class or id so a wrapper such as "has-sidebar" is never removed
  doc.querySelectorAll('#comments, #respond, #disqus_thread, #sidebar, #footer, .comments, .comments-area, .comment-list, .commentlist, .comment-respond, .sidebar, .widget-area, .related-posts, .related-recipes, .site-footer, .newsletter, .newsletter-signup, .cookie-banner, .cookie-notice, .modal, .popup, .social-share, .share-buttons, .breadcrumbs, .breadcrumb')
    .forEach((e) => { if (!['body', 'html', 'main', 'article'].includes(tagOf(e))) e.remove(); });
  const ing = ingredients(doc);
  const steps = stepsOf(doc, ing ? ing[1] : null);
  return { ingredients: ing ? ing[0] : null, steps };
}

const uniq = (a) => [...new Set(a)];
const hasAny = (lines) => lines.some((l) => !l.header);

// ---------------- ingredients ----------------
function ingredients(doc) {
  const pl = plugin(doc, '.wprm-recipe-ingredients-container', '.wprm-recipe-ingredient-group', '.wprm-recipe-group-name', 'li.wprm-recipe-ingredient, .wprm-recipe-ingredient', cleanIng);
  if (pl) return [{ lines: pl[0], trust: Trust.STRONG, how: 'recipe card' }, pl[1]];
  for (const sel of ['.tasty-recipes-ingredients', '.tasty-recipe-ingredients', '.mv-create-ingredients', '.wpurp-recipe-ingredients', '.ERSIngredients', '.easyrecipe .ingredients', '#zlrecipe-ingredients-list', '.zlrecipe-ingredients', '.jetpack-recipe-ingredients', '.recipe-card-ingredients', '.wp-block-recipe-card-ingredients', '.cooked-recipe-ingredients', '.simple-recipe-pro .ingredients', '.wpzoom-recipe-card .recipe-card-ingredients, .ingredients-list']) {
    const root = doc.querySelector(sel); if (!root) continue;
    const lines = listLines(root, cleanIng);
    if (lines.filter((l) => !l.header).length >= 2) return [{ lines, trust: Trust.STRONG, how: 'recipe card' }, root];
  }
  const props = [...doc.querySelectorAll('[itemprop=recipeIngredient], [itemprop=ingredients], [property=recipeIngredient], [property=ingredients], [property$="schema.org/recipeIngredient"]')];
  if (props.length >= 2) {
    const lines = dedupe(props.map((e) => line(cleanIng(attrOf(e, 'content') || text(e)))).filter((l) => l.text));
    if (lines.length >= 2) return [{ lines, trust: Trust.STRONG, how: 'recipe markup' }, commonAncestor(props)];
  } else if (props.length === 1) {
    const lines = listLines(props[0], cleanIng);
    if (lines.filter((l) => !l.header).length >= 2) return [{ lines, trust: Trust.STRONG, how: 'recipe markup' }, props[0]];
  }
  // a container named for ingredients
  let best = null;
  for (const el of doc.querySelectorAll('[class], [id]')) {
    const name = cls(el);
    if (!ingName.test(name) || notIngName.test(name)) continue;
    if (['li', 'a', 'span', 'label', 'input', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body', 'html', 'main', 'article'].includes(tagOf(el))) continue;
    const lines = listLines(el, cleanIng);
    const its = items({ lines });
    if (its.length < 2 || its.length > 120) continue;
    const like = its.filter(ingredientLike).length;
    const long = its.filter((t) => t.length > 160).length;
    if (like < 2 || like < its.length * 0.5) continue;
    const score = like - 2.0 * long - (its.length - like) * 0.5;
    if (!best || score > best.score + 0.01 || (Math.abs(score - best.score) <= 0.01 && jtext(el).length < jtext(best.el).length)) best = { lines, el, score };
  }
  if (best) return [{ lines: best.lines, trust: Trust.MEDIUM, how: 'ingredients section' }, best.el];
  // a heading that says "Ingredients"
  const byHeading = headings(doc, ingHeading).map((h) => [h, following(h, cleanIng, (t) => isStepHeading(t) || endHeading.test(t), ingredientLike, 0.5)])
    .filter(([, r]) => r[0].filter((l) => !l.header).length >= 2);
  if (byHeading.length >= 2 && byHeading.reduce((n, [, r]) => n + r[0].length, 0) <= 80 && new Set(byHeading.map(([, r]) => JSON.stringify(r[0].map((l) => l.text)))).size === byHeading.length) {
    // a recipe in several parts, each with its own "Ingredients" heading
    const out = [];
    for (const [h, r] of byHeading) { const t = precedingHeading(h); if (t && !ingHeading.test(t)) out.push(line(trimEnd(t, ':'), true)); out.push(...r[0]); }
    return [{ lines: dedupe(out), trust: Trust.WEAK, how: 'ingredient headings' }, byHeading[byHeading.length - 1][1][1]];
  }
  if (byHeading.length) {
    const score = (r) => r[0].filter((l) => !l.header && ingredientLike(l.text)).length;
    let top = byHeading[0]; for (const x of byHeading) if (score(x[1]) > score(top[1])) top = x;
    return [{ lines: top[1][0], trust: Trust.MEDIUM, how: 'ingredients heading' }, top[1][1]];
  }
  // lists that are mostly ingredient lines (several short lists under their own sub-headings are joined)
  const lists = [...doc.querySelectorAll('ul, ol')].map((l) => [l, kids(l).filter((c) => tagOf(c) === 'li').map((c) => cleanIng(text(c))).filter(Boolean)])
    .filter(([, its]) => its.length >= 2 && its.filter((t) => ingredientLike(t) && t.length < 140).length >= its.length * 0.7 && its.filter((t) => qtyStart.test(t)).length >= its.length * 0.5);
  const total = lists.reduce((n, [, its]) => n + its.length, 0);
  if (total >= 3 && lists.length) {
    let biggest = lists[0]; for (const x of lists) if (x[1].length > biggest[1].length) biggest = x;
    const group = lists.length > 1 && total <= 60 ? lists : [biggest];
    const out = [];
    for (const [el, its] of group) {
      if (group.length > 1) { const h = precedingHeading(el); if (h && !ingHeading.test(h) && h.length < 60) out.push(line(trimEnd(h, ':'), true)); }
      its.forEach((t) => out.push(line(t)));
    }
    return [{ lines: dedupe(out), trust: Trust.WEAK, how: 'list' }, group[group.length - 1][0]];
  }
  return null;
}

// ---------------- directions ----------------
function stepsOf(doc, ingredientRoot) {
  const pl = plugin(doc, '.wprm-recipe-instructions-container', '.wprm-recipe-instruction-group', '.wprm-recipe-group-name', '.wprm-recipe-instruction-text', cleanStep, 'li.wprm-recipe-instruction');
  if (pl) return { lines: pl[0], trust: Trust.STRONG, how: 'recipe card' };
  for (const sel of ['.tasty-recipes-instructions', '.tasty-recipe-instructions', '.mv-create-instructions', '.wpurp-recipe-instructions', '.ERSInstructions', '.easyrecipe .instructions', '#zlrecipe-instructions-list', '.zlrecipe-instructions', '.jetpack-recipe-directions', '.recipe-card-directions', '.wp-block-recipe-card-directions', '.cooked-recipe-directions', '.directions-list, .instructions-list']) {
    const root = doc.querySelector(sel); if (!root) continue;
    const lines = listLines(root, cleanStep, true);
    if (hasAny(lines)) return { lines, trust: Trust.STRONG, how: 'recipe card' };
  }
  const props = [...doc.querySelectorAll('[itemprop=recipeInstructions], [property=recipeInstructions], [property$="schema.org/recipeInstructions"]')];
  if (props.length) {
    const lines = dedupe(props.flatMap((p) => {
      const texts = [...p.querySelectorAll('[itemprop=text], [property=text]')];
      if (props.length === 1 || texts.length || p.querySelectorAll('li, p').length) return texts.length ? texts.map((e) => line(cleanStep(text(e)))) : listLines(p, cleanStep, true);
      return [line(cleanStep(attrOf(p, 'content') || jtext(p)))];
    }).filter((l) => l.text));
    if (lines.some((l) => !l.header && l.text.length >= 15)) return { lines, trust: Trust.STRONG, how: 'recipe markup' };
  }
  const stepProps = [...doc.querySelectorAll('[itemprop=step] [itemprop=text], [itemprop=itemListElement] [itemprop=text]')];
  if (stepProps.length >= 2) return { lines: dedupe(stepProps.map((e) => line(cleanStep(text(e)))).filter((l) => l.text)), trust: Trust.STRONG, how: 'recipe markup' };
  // a container named for directions
  let best = null;
  const bodyLen = doc.body ? jtext(doc.body).length : 0;
  for (const el of doc.querySelectorAll('[class], [id]')) {
    const name = cls(el);
    if (!stepName.test(name) || notStepName.test(name) || ingName.test(name)) continue;
    if (['li', 'a', 'span', 'label', 'input', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body', 'html', 'main', 'article'].includes(tagOf(el))) continue;
    if (ingredientRoot && (el === ingredientRoot || parentsOf(ingredientRoot).includes(el))) continue;
    const len = jtext(el).length;
    if (len < 40 || (bodyLen > 3000 && len > bodyLen * 0.7)) continue;
    const lines = listLines(el, cleanStep, true);
    const its = items({ lines });
    if (!its.length || its.length > 80) continue;
    const like = its.filter(stepLike);
    if (!like.length || like.length < its.length * 0.5) continue;
    const score = like.reduce((n, t) => n + t.length, 0);
    if (!best || score > best.score || (score === best.score && len < jtext(best.el).length)) best = { lines, el, score };
  }
  if (best) return { lines: best.lines, trust: Trust.MEDIUM, how: 'directions section' };
  const stepScore = (ls) => ls.reduce((n, l) => n + (!l.header && stepLike(l.text) ? l.text.length : 0), 0);
  const stepsByHeading = headings(doc, stepHeading).map((h) => [h, following(h, cleanStep, (t) => endHeading.test(t) || ingHeading.test(t), stepLike, 0.34, true)[0]])
    .filter(([, ls]) => ls.some((l) => !l.header && stepLike(l.text)));
  if (stepsByHeading.length >= 2 && stepsByHeading.reduce((n, [, ls]) => n + ls.length, 0) <= 80 && new Set(stepsByHeading.map(([, ls]) => JSON.stringify(ls.map((l) => l.text)))).size === stepsByHeading.length) {
    const out = [];
    for (const [h, r] of stepsByHeading) { const t = precedingHeading(h); if (t && !stepHeading.test(t) && !ingHeading.test(t)) out.push(line(trimEnd(t, ':'), true)); out.push(...r); }
    return { lines: dedupe(out), trust: Trust.WEAK, how: 'direction headings' };
  }
  if (stepsByHeading.length) {
    let top = stepsByHeading[0][1]; for (const [, ls] of stepsByHeading) if (stepScore(ls) > stepScore(top)) top = ls;
    return { lines: top, trust: Trust.MEDIUM, how: 'directions heading' };
  }
  const loose = headings(doc, looseStepHeading).map((h) => following(h, cleanStep, (t) => endHeading.test(t) || ingHeading.test(t), stepLike, 0.5, true)[0]).filter((ls) => ls.some((l) => !l.header && stepLike(l.text)));
  if (loose.length) { let top = loose[0]; for (const ls of loose) if (stepScore(ls) > stepScore(top)) top = ls; return { lines: top, trust: Trust.WEAK, how: 'directions heading' }; }
  // no heading at all: the first run of step-like list items or paragraphs after the ingredients
  if (ingredientRoot) {
    const all = [...doc.querySelectorAll('*')];
    const at = all.indexOf(ingredientRoot);
    const after = at < 0 ? [] : all.slice(at + 1).filter((el) => !parentsOf(el).includes(ingredientRoot));
    const ol = after.find((el) => tagOf(el) === 'ol' && kids(el).filter((c) => tagOf(c) === 'li' && stepLike(jtext(c))).length >= 2);
    if (ol) return { lines: kids(ol).filter((c) => tagOf(c) === 'li').map((c) => line(cleanStep(text(c)))).filter((l) => l.text), trust: Trust.WEAK, how: 'list after ingredients' };
    let run = [];
    for (const el of after) {
      if (!['p', 'li'].includes(tagOf(el))) { if (headingTags.has(tagOf(el)) && run.length >= 2) break; else continue; }
      const t = cleanStep(text(el));
      if (stepLike(t)) run.push(line(t)); else if (run.length >= 2) break; else if (t.length > 3) run = [];
      if (run.length >= 40) break;
    }
    if (run.length >= 2) return { lines: dedupe(run), trust: Trust.WEAK, how: 'text after ingredients' };
  }
  return null;
}

// ---------------- helpers ----------------
function dedupe(lines) {
  // a list rendered twice (desktop and mobile copies) is kept once
  const n = lines.length;
  if (n >= 4 && n % 2 === 0 && JSON.stringify(lines.slice(0, n / 2).map((l) => l.text)) === JSON.stringify(lines.slice(n / 2).map((l) => l.text))) return lines.slice(0, n / 2);
  return lines.reduce((acc, l) => { if (acc[acc.length - 1]?.text !== l.text) acc.push(l); return acc; }, []);
}

function plugin(doc, container, group, groupName, item, clean, fallbackItems = null) {
  const root = doc.querySelector(container); if (!root) return null;
  const out = [];
  let groups = [...root.querySelectorAll(group)]; if (!groups.length) groups = [root];
  for (const g of groups) {
    const n = g.querySelector(groupName);
    if (n) { const t = trimEnd(clean(jtext(n)), ':'); if (t) out.push(line(t, true)); }
    let its = [...g.querySelectorAll(item)];
    if (!its.length && fallbackItems) its = [...g.querySelectorAll(fallbackItems)];
    // nested matches (li.x containing span.x) would repeat text: keep outermost only
    const set = new Set(its);
    its.filter((el) => !parentsOf(el).some((p) => set.has(p))).forEach((el) => { const t = clean(text(el)); if (t) out.push(line(t)); });
  }
  return hasAny(out) ? [dedupe(out), root] : null;
}

const isSubHeading = (el) => headingTags.has(tagOf(el)) || (['strong', 'b', 'dt'].includes(tagOf(el)) && jtext(el).length < 60)
  || (tagOf(el) === 'p' && el.children.length === 1 && ['strong', 'b'].includes(tagOf(el.children[0])) && jtext(el) === jtext(el.children[0]) && jtext(el).length < 60);

/** Lines of a section: list items, table rows, paragraphs, or `<br>`-separated text, with short headings kept as sub-headers. */
function listLines(root, clean, paragraphs = false) {
  const out = [];
  const lis = select(root, 'li').filter((li) => select(li, 'li').length <= 1);
  const rows = lis.length === 0 ? select(root, 'tr').filter((r) => select(r, 'tr').length <= 1) : [];
  const blocks = lis.length ? lis : rows.length >= 2 ? rows : select(root, 'p, div, dd').filter((el) => ownText(el).trim() || tagOf(el) === 'p').filter((el) => select(el, 'p, div, dd').length <= 1);
  if (lis.length === 0 && rows.length < 2 && blocks.length >= 4) {
    // amount and name in separate small boxes: the row that holds them is the line
    const parents = uniq(blocks.map((b) => b.parentElement).filter((p) => p && p !== root));
    const rowLike = parents.filter((p) => { const n = blocks.filter((b) => b.parentElement === p).length; const len = jtext(p).length; return len >= 2 && len <= 160 && n >= 2 && n <= 4; });
    if (rowLike.length >= 2 && rowLike.length * 2 >= parents.length) {
      const out2 = parents.flatMap((p) => (rowLike.includes(p) ? [clean(text(p))] : blocks.filter((b) => b.parentElement === p).map((b) => clean(text(b))))).filter(Boolean).map((t) => line(t));
      return dedupe(out2);
    }
  }
  if (!blocks.length) { htmlLines(root.innerHTML).map(clean).filter(Boolean).forEach((t) => out.push(line(t))); return dedupe(out); }
  const set = new Set(blocks);
  // walk in document order so sub-headings land between the right items
  for (const el of root.querySelectorAll('*')) {
    if (set.has(el)) {
      if (isSubHeading(el) && lis.length === 0) { const t = trimEnd(clean(text(el)), ':'); if (t) out.push(line(t, true)); continue; }
      const pieces = el.querySelector('br') && lis.length === 0 ? htmlLines(el.innerHTML) : [text(el)];
      pieces.map(clean).filter(Boolean).forEach((t) => out.push(line(t)));
    } else if (headingTags.has(tagOf(el)) || (['strong', 'b'].includes(tagOf(el)) && !parentsOf(el).some((p) => set.has(p)) && jtext(el).length < 60)) {
      if (!parentsOf(el).some((p) => set.has(p))) { const t = trimEnd(clean(text(el)), ':'); if (t && t.length < 80) out.push(line(t, true)); }
    }
  }
  if (!paragraphs) {
    let i = 0;
    while (i < out.length - 1) { if (!out[i].header && !out[i + 1].header && onlyQty.test(out[i].text)) { out[i] = line(`${out[i].text} ${out[i + 1].text}`); out.splice(i + 1, 1); } else i++; }
  }
  // a leading header that just names the section ("Ingredients") is not a sub-header
  while (out.length && out[0].header && (ingHeading.test(out[0].text) || stepHeading.test(out[0].text))) out.shift();
  while (out.length && out[out.length - 1].header) out.pop();
  return dedupe(out);
}

function headings(doc, re) {
  const all = [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6, strong, b, p, div, span, dt, legend, th')].filter((el) => {
    const t = jtext(el).trim();
    return t.length >= 3 && t.length <= 70 && re.test(trimEnd(t, ':')) && (headingTags.has(tagOf(el)) || ![...el.children].some(isBlock));
  });
  // the same heading text is matched on a wrapper and its inner element: keep the innermost
  return all.filter((el) => !all.some((o) => o !== el && parentsOf(o).includes(el))).slice(0, 8);
}

function precedingHeading(el) {
  let cur = el, hops = 0;
  while (cur && hops < 4) {
    let sib = cur.previousElementSibling, n = 0;
    while (sib && n < 2) {
      const h = headingTags.has(tagOf(sib)) || isSubHeading(sib) ? sib : [...sib.querySelectorAll('h1, h2, h3, h4, h5, h6')].pop();
      if (h) { const t = norm(jtext(h)); return t.length >= 2 && t.length <= 60 ? t : null; }
      if (jtext(sib).length > 80) return null;
      sib = sib.previousElementSibling; n++;
    }
    cur = cur.parentElement; hops++;
  }
  return null;
}

function commonAncestor(els) {
  let a = els[0]?.parentElement ?? null;
  while (a && !els.every((e) => parentsOf(e).includes(a))) a = a.parentElement;
  return a;
}

/** Collects the content that follows a section heading, up to the next unrelated heading. Returns [lines, containerElement]. */
function following(h, clean, stop, good, minRatio, paragraphs = false) {
  let start = h, climbs = 0;
  while (!start.nextElementSibling && start.parentElement && climbs < 4) { start = start.parentElement; climbs++; }
  // a heading wrapped alone in a div/header: step out so its siblings are the content
  while (climbs < 4 && start.parentElement && start.parentElement.children.length === 1) { start = start.parentElement; climbs++; }
  const hLevel = headingTags.has(tagOf(h)) ? parseInt(tagOf(h).slice(1), 10) : 7;
  const out = [];
  let sib = start.nextElementSibling, misses = 0, last = null;
  while (sib && misses < 4) {
    const t = jtext(sib).trim();
    if (!t) { sib = sib.nextElementSibling; continue; }
    const isHeading = headingTags.has(tagOf(sib));
    if (t.length < 70 && stop(trimEnd(t, ':'))) break;
    if (isHeading) {
      const level = parseInt(tagOf(sib).slice(1), 10);
      if (level <= hLevel && hasAny(out)) break;
      if (t.length < 80) { out.push(line(trimEnd(clean(t), ':'), true)); sib = sib.nextElementSibling; continue; }
    }
    const inner = [...sib.querySelectorAll('h1, h2, h3, h4, h5, h6, strong, b')].find((e) => jtext(e).length < 60 && stop(trimEnd(jtext(e).trim(), ':')));
    const lines = ['ul', 'ol', 'div', 'section', 'table', 'dl'].includes(tagOf(sib)) ? listLines(sib, clean, paragraphs)
      : sib.querySelector('br') ? htmlLines(sib.innerHTML).map((x) => line(clean(x))) : [line(clean(t), isSubHeading(sib))];
    const kept = inner ? takeWhile(lines, (l) => !stop(l.text)) : lines;
    const its = items({ lines: kept });
    const ok = its.length > 0 && its.filter(good).length >= its.length * minRatio;
    if (ok || (kept.length && kept.every((l) => l.header))) { out.push(...kept); last = sib; misses = 0; } else if (hasAny(out)) break; else misses++;
    if (inner) break;
    sib = sib.nextElementSibling;
  }
  while (out.length && out[out.length - 1].header) out.pop();
  return [dedupe(out), last?.parentElement ?? start.parentElement];
}
const takeWhile = (a, f) => { const o = []; for (const x of a) { if (!f(x)) break; o.push(x); } return o; };
