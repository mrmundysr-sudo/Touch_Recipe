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

function mergeWrapped(lines) {
  const out = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && !'.!?:)'.includes(prev[prev.length - 1]) && l[0] === l[0].toLowerCase() && l[0] !== l[0].toUpperCase()) {
      out[out.length - 1] = prev.endsWith('-') ? prev.slice(0, -1) + l : `${prev} ${l}`;
    } else out.push(l);
  }
  return out;
}

export function parse(raw, method = ImportMethod.TEXT, sourceUrl = null) {
  const warnings = [];
  const lines = raw.replace(/\r/g, '').replace(/ /g, ' ').split('\n').map((l) => l.trim());
  if (!lines.some((l) => l)) {
    return { recipe: Recipe({ sourceUrl, rawSource: raw }), method, confidence: Confidence.LOW, warnings: [warn('recipe', 'No text was found to build a recipe from.', Severity.ERROR)], imageCandidates: [] };
  }
  let prep = null, cook = null, total = null, servings = null;
  const sections = { pre: [], ing: [], dir: [], note: [] };
  let current = 'pre', sawIngHeader = false, sawDirHeader = false;

  for (const line of lines) {
    if (!line) continue;
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
  const directions = mergeWrapped(sections.dir.map((l) => l.replace(bullet, '').replace(stepNum, '').trim()).filter(Boolean))
    .map((t) => Direction({ text: t, timerSeconds: timerSeconds(t) }));
  const notes = sections.note.map((l) => l.replace(bullet, '').trim()).join('\n');
  const intro = sections.pre.slice(1).join(' ').trim();

  if (!title) warnings.push(warn('title', "We couldn't tell what this recipe is called. Please add a title."));
  if (!ingredients.some((i) => !i.header)) warnings.push(warn('ingredients', 'No ingredients were recognised. Check the ingredients list.'));
  if (!directions.length) warnings.push(warn('directions', 'No directions were recognised. Check the directions.'));
  warnings.push(warn('recipe', method === ImportMethod.OCR ? 'Text was read from a photo or file and may contain mistakes. Please check quantities and steps.' : 'Recipe text was interpreted automatically. Please check each field.', Severity.INFO));

  const confidence = title && ingredients.length && directions.length && (sawIngHeader || sawDirHeader) && method !== ImportMethod.OCR ? Confidence.MEDIUM : Confidence.LOW;
  const recipe = Recipe({ title, description: intro, notes, sourceUrl, prepMinutes: prep, cookMinutes: cook, totalMinutes: total, servings, ingredients, directions, rawSource: raw });
  return { recipe, method, confidence, warnings, imageCandidates: [] };
}
