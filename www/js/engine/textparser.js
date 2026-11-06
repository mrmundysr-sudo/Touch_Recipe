// Port of core/importer/TextRecipeParser.kt: pasted / typed / OCR / caption text -> draft recipe.
import { Recipe, Ingredient, Direction, Confidence, ImportMethod, Severity, warn } from './models.js';
import { looseMinutes, timerSeconds } from './durations.js';

const ingHeader = /^\W*(ingredients?|what you.?ll need|you will need|for the .*)\W*:?\s*$/i;
const dirHeader = /^\W*(directions?|instructions?|method|preparation|steps?|procedure|how to make( it)?)\W*:?\s*$/i;
const noteHeader = /^\W*(notes?|tips?|substitutions?|variations?|cook'?s notes?)\W*:?\s*$/i;
const bullet = /^[\s•·●○▪■□◦\-–—*+>]+/;
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

/** Removes page furniture (footers, stamps, page numbers, bare web addresses, lone punctuation, UI words). Returns the cleaned text and the first page address found. */
export function cleanPageText(raw) {
  let sourceUrl = null;
  const out = [];
  for (const line0 of raw.replace(/\r/g, '').split('\n')) {
    let line = line0.trim();
    if (!line) { out.push(''); continue; }
    const first = /https?:\/\/\S+/.exec(line);
    line = line.replace(INLINE_FOOTER, ' ').replace(INLINE_URL_FRAGMENT, ' ').trim();
    if (URL_ONLY.test(line)) { if (!sourceUrl) sourceUrl = line.replace(/#.*$/, '').replace(/[.,)]+$/, ''); continue; }
    if (!line) { if (first && !sourceUrl) sourceUrl = first[0].replace(/#.*$/, '').replace(/[.,)]+$/, ''); continue; }
    if (STAMP.test(line) || PAGE_NO.test(line) || LONE_MARK.test(line) || FURNITURE.has(line.toLowerCase())) continue;
    out.push(line);
  }
  return { text: out.join('\n'), sourceUrl };
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

export function parse(raw, method = ImportMethod.TEXT, sourceUrl = null) {
  const warnings = [];
  const cleaned = cleanPageText(raw.replace(/\u00a0/g, ' '));
  sourceUrl = sourceUrl ?? cleaned.sourceUrl;
  const lines = cleaned.text.split('\n').map((l) => l.trim());
  const extras = []; let author = null;
  if (!lines.some((l) => l)) {
    return { recipe: Recipe({ sourceUrl, rawSource: raw }), method, confidence: Confidence.LOW, warnings: [warn('recipe', 'No text was found to build a recipe from.', Severity.ERROR)], imageCandidates: [] };
  }
  let prep = null, cook = null, total = null, servings = null;
  const sections = { pre: [], ing: [], dir: [], note: [] };
  let current = 'pre', sawIngHeader = false, sawDirHeader = false;

  for (const line of lines) {
    if (!line) continue;
    if (current === 'pre') {
      const diff = /^di.{0,3}cult\w*\s*[:\-]\s*(\S.*)$/i.exec(line);
      if (diff && line.length < 60) { extras.push(`Difficulty: ${diff[1].trim()}`); continue; }
      const by = /^by\s+(\S[^:]{1,40})$/i.exec(line);
      if (by && sections.pre.length <= 2 && !/\d/.test(line)) { author = by[1].trim(); continue; }
    }
    const mm = metaRe.exec(line);
    if (mm && mm[2].trim() && line.length < 70) {
      const key = mm[1].toLowerCase(), v = mm[2];
      if (key.startsWith('prep')) prep = looseMinutes(v) ?? prep;
      else if (key.startsWith('cook')) cook = looseMinutes(v) ?? cook;
      else if (key.startsWith('total') || key.startsWith('ready')) total = looseMinutes(v) ?? total;
      else servings = firstInt(v) ?? servings;
      continue;
    }
    if (ingHeader.test(line) && !line.toLowerCase().startsWith('for the ')) { current = 'ing'; sawIngHeader = true; continue; }
    if (dirHeader.test(line)) { current = 'dir'; sawDirHeader = true; continue; }
    if (noteHeader.test(line)) { current = 'note'; continue; }
    sections[current].push(line);
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

  const titleLine = sections.pre.find((l) => l.length < 120);
  const title = titleLine !== undefined ? cleanTitle(titleLine) : '';
  const ingredients = [];
  for (const l of sections.ing) {
    const t = l.replace(bullet, '').trim();
    if (!t) continue;
    const isHeader = t.endsWith(':') || (t.length < 40 && t === t.toUpperCase() && [...t].some(isLetter) && !qtyStart.test(t));
    ingredients.push(Ingredient({ text: isHeader ? trimSet(t, [':']).trim() : t, header: isHeader }));
  }
  const directions = mergeWrapped(sections.dir.map((l) => ({ text: l.replace(bullet, '').replace(stepNum, '').trim(), mark: bullet.test(l) || stepNum.test(l) })).filter((x) => x.text))
    .map((t) => Direction({ text: t, timerSeconds: timerSeconds(t) }));
  let host = null; if (sourceUrl) { try { host = new URL(sourceUrl).host.replace(/^www\./, '') || null; } catch { host = null; } }
  const notes = [...(author && sourceUrl ? [`By ${author}`] : []), ...extras, ...sections.note.map((l) => l.replace(bullet, '').trim())].join('\n');
  const intro = sections.pre.slice(1).join(' ').trim();

  if (!title) warnings.push(warn('title', "We couldn't tell what this recipe is called. Please add a title."));
  if (!ingredients.some((i) => !i.header)) warnings.push(warn('ingredients', 'No ingredients were recognised. Check the ingredients list.'));
  if (!directions.length) warnings.push(warn('directions', 'No directions were recognised. Check the directions.'));
  warnings.push(warn('recipe', method === ImportMethod.OCR ? 'Text was read from a photo or file and may contain mistakes. Please check quantities and steps.' : 'Recipe text was interpreted automatically. Please check each field.', Severity.INFO));

  const confidence = title && ingredients.length && directions.length && (sawIngHeader || sawDirHeader) && method !== ImportMethod.OCR ? Confidence.MEDIUM : Confidence.LOW;
  const recipe = Recipe({ title, description: intro, notes, sourceUrl, sourceName: host ?? author, prepMinutes: prep, cookMinutes: cook, totalMinutes: total, servings, ingredients, directions, rawSource: raw });
  return { recipe, method, confidence, warnings, imageCandidates: [] };
}
