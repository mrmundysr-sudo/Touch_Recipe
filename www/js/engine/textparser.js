// Port of core/importer/TextRecipeParser.kt: pasted / typed / OCR / caption text -> draft recipe.
import { Recipe, Ingredient, Direction, Confidence, ImportMethod, Severity, warn } from './models.js';
import { looseMinutes, timerSeconds } from './durations.js';
import { ingredientLike, stepLike } from './pagescan.js';
import { validate } from './validator.js';

// a heading may carry a count or the scale buttons of a recipe card: "Ingredients (12)", "Ingredients 1x 2x 3x", "Ingredients: 10"
const HEAD_TAIL = '(?:\\s*\\(?\\d{1,3}\\)?|(?:\\s+\\d(?:/\\d)?\\s?x)+|\\s+(?:us customary|metric|scale|cook mode)(?:\\s.*)?)?';
const ingHeader = new RegExp('^\\W*(ingredients?|what you.?ll need|you will need|for the .*)\\W*' + HEAD_TAIL + '\\W*$', 'i');
const dirHeader = new RegExp('^\\W*(directions?|instructions?|method|preparation|steps?|procedure|how to make( it)?)\\W*' + HEAD_TAIL + '\\W*$', 'i');
const noteHeader = /^\W*(notes?|tips?|substitutions?|variations?|cook'?s notes?)\W*:?\s*$/i;
// any leading marks (bullets, tick boxes, circled numbers, private-use glyphs) that are not text, a digit, a fraction or a bracket
const bullet = /^[^\p{L}\p{Nd}(\[¼½¾⅓⅔⅛⅜⅝⅞]+/u;
const stepNum = /^\s*(?:step\s*)?\d{1,2}\s*[.):\-]\s+/i;
const qtyStart = /^\s*(?:\d|[¼½¾⅓⅔⅛⅜⅝⅞]|a\s+(?:pinch|dash|handful|few)|one\s|two\s|three\s|half\s)/i;
const unitWord = /\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g|kg|ml|l|cloves?|cans?|pinch|dash|slices?|sticks?|packages?|bunch|sprigs?)\b/i;
const metaRe = /^\W*(prep(?:aration)?(?: time)?|cook(?:ing)?(?: time)?|total(?: time)?|ready in|serv(?:es|ings?)|yield|makes)\s*[:\-]?\s*(.*)$/i;

// Browser print/PDF furniture that must never become part of a recipe.
const FURNITURE = new Set(['learn more', 'print', 'print recipe', 'save', 'save recipe', 'share', 'pin', 'pin it', 'jump to recipe', 'advertisement', 'skip to content', 'menu']);
const URL_ONLY = /^(?:https?:\/\/|www\.)\S+$/i;
const STAMP = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}[,\s]+\d{1,2}[: ]\d{2}(?:\s*[AaPp]\.?[Mm]\.?)?$/;
const PAGE_NO = /^page\s+\d+\s*(?:of|\/)\s*\d+$/i;
const LONE_MARK = /^[^\p{L}\p{N}]{1,3}$/u;
const INLINE_FOOTER = /\s*(?:https?:\/\/\S+\s+)?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}[,\s]+\d{1,2}[: ]\d{2}(?:\s*[AaPp][Mm])?\b/g;
const INLINE_URL_FRAGMENT = /\s*https?:\/\/\S*#\S*/g;
/** Chrome/Safari print header: "11/6/26, 3:04 PM  Page title". */
const STAMPED_HEADER = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}[:\s\u2236]\d{2}(?:\s*[AaPp]\.?[Mm]\.?)?\s+\S.*$/;
const STAMP_PREFIX = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}[:\s\u2236]\d{2}(?:\s*[AaPp]\.?[Mm]\.?)?\s+/;
const PAGE_MARK = /\s*\bpage\s+\d+\s*(?:of|\/)\s*\d+\b\s*/i;
const PAGE_FRACTION = /\s+\d{1,3}\/\d{1,3}$/;
const END_HEADER = /^\W*(nutrition(?:al)?(?: facts| information| info)?(?: \(?per serving\)?)?|comments?|reviews?|leave a (?:reply|comment|review)|you (?:may|might) also (?:like|enjoy)|related recipes|more recipes|did you make this(?: recipe)?\??|share this recipe|about the author|popular recipes)\W*:?\s*$/i;
/** "Step 1", "Step 2:" label a single step; they are not the Directions heading. */
const STEP_LABEL = /^\W*steps?\s*\d/i;
const LEADING_STEP_NUMBER = /^\s*(?:step\s*)?(\d{1,2})\s*[.):\-]\s+/i;
const META_EACH = /(prep(?:aration)?(?: time)?|cook(?:ing)?(?: time)?|total(?: time)?|ready in|serv(?:es|ings?)|yield|makes)\s*[:\-]?\s*(.*?)(?=\s+(?:prep(?:aration)?(?: time)?|cook(?:ing)?(?: time)?|total(?: time)?|ready in|serv(?:es|ings?)|yield|makes)\s*[:\-]|$)/gi;

/** "Best Banana Bread Recipe - Site Name" -> "Best Banana Bread Recipe". */
export function pageTitle(t) {
  const parts = t.trim().split(/\s+[|\-–—•·:]\s+/);
  const best = (parts.length > 1 && parts[0].length >= 6 ? parts[0] : t.trim()).replace(/\s+recipe$/i, '').trim();
  return best.length >= 3 && best.length <= 120 ? best : null;
}

/** Removes page furniture (footers, stamps, page numbers, bare web addresses, lone punctuation, UI words). Returns the cleaned text and the first page address found. */
export function cleanPageText(raw) {
  let sourceUrl = null, titleHint = null;
  const out = [];
  for (const line0 of raw.replace(/\r/g, '').split('\n')) {
    let line = line0.trim();
    if (!line) { out.push(''); continue; }
    const first = /https?:\/\/\S+/.exec(line);
    if (first && PAGE_MARK.test(line)) line = line.replace(new RegExp(PAGE_MARK.source, 'gi'), ' ').trim();
    if (first && line.startsWith(first[0])) line = line.replace(PAGE_FRACTION, '');
    if (STAMPED_HEADER.test(line) && !first) {
      // the browser prints the page title beside the date: the best title a printed page has
      if (titleHint == null) titleHint = pageTitle(line.replace(STAMP_PREFIX, ''));
      continue;
    }
    line = line.replace(INLINE_FOOTER, ' ').replace(INLINE_URL_FRAGMENT, ' ').trim();
    if (URL_ONLY.test(line)) { if (!sourceUrl) sourceUrl = line.replace(/#.*$/, '').replace(/[.,)]+$/, ''); continue; }
    if (!line) { if (first && !sourceUrl) sourceUrl = first[0].replace(/#.*$/, '').replace(/[.,)]+$/, ''); continue; }
    if (STAMP.test(line) || PAGE_NO.test(line) || LONE_MARK.test(line) || FURNITURE.has(line.toLowerCase())) continue;
    out.push(line);
  }
  return { text: out.join('\n'), sourceUrl, titleHint };
}

/** True when a PDF text layer looks damaged by web-font ligatures (e.g. "Di!iculty", an unmatched quote inside a word): read the page by OCR instead. */
export function looksGarbled(text) {
  if (/[A-Za-z][!#%*][a-z]/.test(text) || /\uFFFD/.test(text)) return true;
  for (const line of text.split('\n')) { const q = (line.match(/"/g) || []).length; if (q % 2 === 1 && !/[“”]/.test(line)) return true; }
  return false;
}

const trimSet = (s, chars) => { let a = 0, b = s.length; while (a < b && chars.includes(s[a])) a++; while (b > a && chars.includes(s[b - 1])) b--; return s.slice(a, b); };
const isLetter = (c) => /\p{L}/u.test(c);
const firstInt = (s) => { const m = /\d+/.exec(s); return m ? parseInt(m[0], 10) : null; };
const cleanTitle = (s) => trimSet(s.replace(bullet, '').trim(), ['#', '*', ' ']).trim();

export function looksLikeIngredient(line) {
  const t = line.replace(bullet, '').trim();
  if (t.length > 120 || !t) return false;
  if (stepNum.test(t) && !qtyStart.test(t.replace(stepNum, ''))) return false;
  const words = t.split(' ').length;
  if (qtyStart.test(t) && (unitWord.test(t) || words <= 6)) return !endsLikeSentence(t) || unitWord.test(t);
  return words <= 4 && unitWord.test(t);
}
const endsLikeSentence = (t) => t.endsWith('.') && t.split(' ').length > 8;

/** Joins wrapped lines into steps. A line continues the previous one when that one has no sentence ending and it starts like a continuation
 *  (lowercase, an opening bracket or a comma); lines that carried their own bullet or number always start a new step. */
function mergeWrapped(items) {
  const out = [];
  for (const { text, mark } of items) {
    const prev = out[out.length - 1];
    const open = prev !== undefined && !/[.!?:;]$/.test(prev);
    if (!mark && open && /^[a-z(\[,;)]/.test(text)) out[out.length - 1] = prev.endsWith('-') && /^[a-z]/.test(text) ? prev.slice(0, -1) + text : `${prev} ${text}`;
    else out.push(text);
  }
  return out;
}

const maxBy = (arr, f) => { let best = arr[0], bs = -Infinity; for (const x of arr) { const v = f(x); if (v > bs) { bs = v; best = x; } } return best; };
const ingLike = (l) => looksLikeIngredient(l) || ingredientLike(l.replace(bullet, ''));
const subHeader = (l) => l.length < 50 && (l.endsWith(':') || (/^for /i.test(l) && l.split(' ').length <= 4 && !/[\d,]/.test(l)));
const stepChars = (b) => b.filter(stepLike).reduce((n, l) => n + l.length, 0);

/** How convincing a block under an "Ingredients" heading is: many ingredient lines, few others, directions right after it. */
function ingScore(b, dirBlocks) {
  const n = b.lines.length; if (!n) return -1;
  const head = b.lines.slice(0, 40); const l = head.filter(ingLike).length;
  const nexts = dirBlocks.map((x) => x.order).filter((o) => o > b.order);
  const next = nexts.length ? Math.min(...nexts) : null;
  return l * Math.sqrt(l / head.length) + (next != null && next - b.order <= n + 2 ? 2.0 : 0.0);
}

export function parse(raw, method = ImportMethod.TEXT, sourceUrl = null, titleHint = null) {
  const warnings = [];
  const cleaned = cleanPageText(raw.replace(/\u00a0/g, ' '));
  sourceUrl = sourceUrl ?? cleaned.sourceUrl;
  const lines = cleaned.text.split('\n').map((l) => l.trim());
  const extras = []; let author = null;
  if (!lines.some((l) => l)) {
    return { recipe: Recipe({ sourceUrl, rawSource: raw }), method, confidence: Confidence.LOW, warnings: [warn('recipe', 'No text was found to build a recipe from.', Severity.ERROR)], imageCandidates: [], unplaced: [] };
  }
  let prep = null, cook = null, total = null, servings = null;
  const sections = { pre: [], ing: [], dir: [], note: [] };
  let current = 'pre', sawIngHeader = false, sawDirHeader = false;
  const stepNumbers = [];
  // every "Ingredients" / "Directions" heading starts its own block; the best block of each kind is chosen afterwards,
  // so a printed web page's menus and sidebars do not end up in the recipe
  const ingBlocks = [], dirBlocks = [];
  let order = 0;

  for (const line of lines) {
    if (!line) continue;
    order++;
    if (current === 'pre') {
      const diff = /^di.{0,3}cult\w*\s*[:\-]\s*(\S.*)$/i.exec(line);
      if (diff && line.length < 60) { extras.push(`Difficulty: ${diff[1].trim()}`); continue; }
      const by = /^by\s+(\S[^:]{1,40})$/i.exec(line);
      if (by && sections.pre.length <= 2 && !/\d/.test(line)) { author = by[1].trim(); continue; }
    }
    const mm = metaRe.exec(line);
    if (mm && mm[2].trim() && line.length < 140 && current !== 'dir') {
      // one line may carry several values: "Servings: 36  Prep time: 20 minutes  Cook time: 11 minutes"
      const parts = [...line.matchAll(META_EACH)];
      if (line.length < 70 || parts.length >= 2) {
        for (const m of parts.length ? parts : [mm]) {
          const key = m[1].toLowerCase(), v = m[2];
          if (key.startsWith('prep')) prep = looseMinutes(v) ?? prep;
          else if (key.startsWith('cook')) cook = looseMinutes(v) ?? cook;
          else if (key.startsWith('total') || key.startsWith('ready')) total = looseMinutes(v) ?? total;
          else servings = firstInt(v) ?? servings;
        }
        continue;
      }
    }
    if (ingHeader.test(line) && !line.toLowerCase().startsWith('for the ')) { current = 'ing'; sawIngHeader = true; ingBlocks.push({ order, lines: [] }); continue; }
    if (dirHeader.test(line) && !STEP_LABEL.test(line)) { current = 'dir'; sawDirHeader = true; dirBlocks.push({ order, lines: [] }); continue; }
    if (noteHeader.test(line)) { current = 'note'; continue; }
    if ((sawIngHeader || sawDirHeader) && END_HEADER.test(line)) { current = 'post'; continue; }
    if (current === 'post') continue;   // page furniture after the recipe; the full text is still kept in rawSource
    if (current === 'ing') ingBlocks[ingBlocks.length - 1].lines.push(line);
    else if (current === 'dir') dirBlocks[dirBlocks.length - 1].lines.push(line);
    else sections[current].push(line);
  }
  const unplaced = [];
  if (ingBlocks.length) {
    const best = maxBy(ingBlocks, (b) => ingScore(b, dirBlocks));
    let chosen = best.lines;
    if (sawDirHeader) {
      // cut the block where ingredient lines stop; a few cut lines are kept for review
      let miss = 0, cutAt = chosen.length;
      for (let i = 0; i < chosen.length; i++) {
        const l = chosen[i];
        if (ingLike(l) || subHeader(l)) miss = 0;
        else if (l.length > 140 || ++miss === 5) { cutAt = i - (l.length > 140 ? 0 : 4); break; }
      }
      if (cutAt < chosen.length && chosen.slice(0, cutAt).filter(ingLike).length >= 2) { unplaced.push(...chosen.slice(cutAt).filter(ingLike).slice(0, 8)); chosen = chosen.slice(0, cutAt); }
      // further blocks that are clearly ingredient lists (a recipe in parts), unless they repeat the chosen one
      const seen = new Set(chosen);
      ingBlocks.filter((b) => b !== best && b.lines.length >= 2 && b.lines.filter(ingLike).length >= b.lines.length * 0.7 && b.lines.length <= 40 && b.lines.filter((l) => seen.has(l)).length < b.lines.length * 0.5)
        .sort((a, b) => a.order - b.order).forEach((b) => { chosen = b.order < best.order ? [...b.lines, ...chosen] : [...chosen, ...b.lines]; });
    }
    sections.ing.push(...chosen);
  }
  if (dirBlocks.length) {
    const top = ingBlocks.length ? maxBy(ingBlocks, (b) => ingScore(b, dirBlocks)) : null;
    const ingAt = top ? top.order : 0;
    const after = dirBlocks.filter((b) => b.order > ingAt && stepChars(b.lines) > 0);
    const best = after[0] ?? maxBy(dirBlocks, (b) => stepChars(b.lines));
    let chosen = best.lines;
    // trailing menu-like lines (short, not sentences) after the last real step are page furniture
    let lastStep = -1; for (let i = chosen.length - 1; i >= 0; i--) if (stepLike(chosen[i]) || stepNum.test(chosen[i])) { lastStep = i; break; }
    if (lastStep >= 0 && chosen.length - lastStep > 4) chosen = chosen.slice(0, lastStep + 1);
    // a long run of short lines in the middle is a menu or an advert block, not a step
    let run = 0, cut = -1;
    for (let i = 0; i < chosen.length; i++) { const l = chosen[i]; if (l.length < 25 && !stepNum.test(l) && !subHeader(l)) { if (++run === 6) { cut = i - 5; break; } } else run = 0; }
    if (cut > 0 && chosen.slice(0, cut).some(stepLike)) chosen = chosen.slice(0, cut);
    chosen.forEach((l) => { const m = LEADING_STEP_NUMBER.exec(l); if (m) stepNumbers.push(parseInt(m[1], 10)); });
    sections.dir.push(...chosen);
  }

  if (!sawIngHeader && !sawDirHeader) {
    const pre = sections.pre;
    const title = pre.find((l) => !looksLikeIngredient(l) && l.length < 100);
    const body = pre.filter((l) => l !== title);
    sections.pre = title !== undefined ? [title] : [];
    for (const l of body) (looksLikeIngredient(l) && l.length < 120 ? sections.ing : sections.dir).push(l);
  } else if (sawIngHeader && !sawDirHeader && sections.dir.length === 0) {
    const ing = sections.ing;
    const split = ing.findIndex((l) => !looksLikeIngredient(l) && l.length > 40);
    if (split > 0) { const tail = ing.splice(split); sections.dir.push(...tail); }
  }

  const hint = titleHint ?? cleaned.titleHint;
  const pagePrint = sections.pre.length > 12;   // a whole printed page: what precedes the recipe is mostly menus
  const titleLine = sections.pre.find((l) => l.length < 120);
  const title = hint ? cleanTitle(hint) : titleLine !== undefined ? cleanTitle(titleLine) : '';
  const ingredients = [];
  for (const l of sections.ing) {
    const t = l.replace(bullet, '').trim();
    if (!t) continue;
    // a wrapped line ("1 cup butter," / "softened") continues the ingredient above it
    const prevIng = ingredients[ingredients.length - 1];
    if (prevIng && !prevIng.header && !bullet.test(l) && !qtyStart.test(t) && (/\p{Ll}/u.test(t[0]) && t[0] === t[0].toLowerCase() || t[0] === '(' || prevIng.text.endsWith(',') || prevIng.text.endsWith(' and') || prevIng.text.endsWith(' or')) && t.length < 80 && !t.endsWith(':')) {
      ingredients[ingredients.length - 1] = { ...prevIng, text: `${prevIng.text} ${t}` }; continue;
    }
    const isHeader = t.endsWith(':') || (t.length < 40 && /^for /i.test(t) && t.split(' ').length <= 4 && !/[\d,]/.test(t)) || (t.length < 40 && t === t.toUpperCase() && [...t].some(isLetter) && !qtyStart.test(t));
    ingredients.push(Ingredient({ text: isHeader ? trimSet(t, [':']).trim() : t, header: isHeader }));
  }
  const directions = mergeWrapped(sections.dir.map((l) => ({ text: l.replace(bullet, '').replace(stepNum, '').trim(), mark: bullet.test(l) || stepNum.test(l) })).filter((x) => x.text))
    .map((t) => Direction({ text: t, timerSeconds: timerSeconds(t) }));
  let host = null; if (sourceUrl) { try { host = new URL(sourceUrl).host.replace(/^www\./, '') || null; } catch { host = null; } }
  const notes = [...(author && sourceUrl ? [`By ${author}`] : []), ...extras, ...sections.note.map((l) => l.replace(bullet, '').trim())].join('\n');
  const intro = pagePrint ? '' : (hint == null ? sections.pre.slice(1) : sections.pre.filter((l) => cleanTitle(l) !== title)).join(' ').trim();

  if (!title) warnings.push(warn('title', "We couldn't tell what this recipe is called. Please add a title."));
  if (!ingredients.some((i) => !i.header)) warnings.push(warn('ingredients', 'No ingredients were recognised. Check the ingredients list.'));
  if (!directions.length) warnings.push(warn('directions', 'No directions were recognised. Check the directions.'));
  warnings.push(warn('recipe', method === ImportMethod.OCR ? 'Text was read from a photo or file and may contain mistakes. Please check quantities and steps.' : 'Recipe text was interpreted automatically. Please check each field.', Severity.INFO));
  // numbered steps that skip a number mean a step was lost on the way in
  const distinct = [...new Set(stepNumbers)];
  if (distinct.length >= 3 && distinct.every((v, i) => i === 0 || distinct[i - 1] < v) && distinct[0] === 1) {
    const missing = []; for (let n = 1; n <= distinct[distinct.length - 1]; n++) if (!distinct.includes(n)) missing.push(n);
    if (missing.length && missing.length <= 5) warnings.push(warn('directions', `Step${missing.length === 1 ? '' : 's'} ${missing.join(', ')} ${missing.length === 1 ? 'seems' : 'seem'} to be missing: the numbering jumps. Compare with the original.`));
  }

  const confidence = title && ingredients.length && directions.length && (sawIngHeader || sawDirHeader) && method !== ImportMethod.OCR ? Confidence.MEDIUM : Confidence.LOW;
  const recipe = Recipe({ title, description: intro, notes, sourceUrl, sourceName: host ?? author, prepMinutes: prep, cookMinutes: cook, totalMinutes: total, servings, ingredients, directions, rawSource: raw });
  return validate({ recipe, method, confidence, warnings, imageCandidates: [], unplaced: [...new Set(unplaced)] });
}
