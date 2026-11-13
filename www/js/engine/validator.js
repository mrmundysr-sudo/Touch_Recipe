// Port of core/importer/ImportValidator.kt: completeness checks applied to every import. It only adds findings; it never changes recipe content.
import { Severity, warn } from './models.js';

const qty = /(?<![\p{L}\d/])(?:\d+(?:[.,/]\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])\s*(?:cups?|tbsps?|tsps?|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|kg|ml|l)\b/giu;
const dangling = /(?:,|;|\b(?:and|or|the|to|with|of|until|a|an|in|for|into|about)|…|\.\.\.)$/i;
const leadingQty = /^\s*(?:\d|[¼½¾⅓⅔⅛⅜⅝⅞])/;

export function validate(d) {
  const r = d.recipe;
  const out = [...d.warnings];
  const add = (field, msg, sev = Severity.WARNING) => { if (!out.some((w) => w.field === field && w.message === msg)) out.push(warn(field, msg, sev)); };
  const ings = r.ingredients.filter((i) => !i.header), steps = r.directions.filter((x) => !x.header);
  if (!r.title.trim() && !out.some((w) => w.field === 'title')) add('title', 'No title was found. Please add one.');
  if (!ings.length && !out.some((w) => w.field === 'ingredients' && w.severity !== Severity.INFO)) add('ingredients', 'No ingredients were found. Compare with the original and add them.');
  if (!steps.length && !out.some((w) => w.field === 'directions' && w.severity !== Severity.INFO)) add('directions', 'No directions were found. Compare with the original and add them.');

  const runTogether = ings.filter((i) => i.text.length > 110 && (i.text.match(qty) || []).length >= 3);
  if (runTogether.length) add('ingredients', `${runTogether.length} ingredient line${runTogether.length === 1 ? ' looks' : 's look'} like several ingredients run together. Please split ${runTogether.length === 1 ? 'it' : 'them'}.`);
  if (ings.length === 1 && steps.length >= 2) add('ingredients', 'Only one ingredient was found, which is unusual. Compare with the original.');
  if (ings.length >= 5 && !ings.some((i) => leadingQty.test(i.text))) add('ingredients', 'None of the ingredients has an amount. The amounts may not have been captured.');

  // ingredient lines that ended up at the top of the directions: name them so the owner can see exactly which ones to move
  const lead = []; for (const x of steps) { const t = x.text.trim(); if (leadingQty.test(t) && t.length < 120 && !/[.!?]$/.test(t) && !/^\d+\s*[.)]\s/.test(t)) lead.push(t); else break; }
  if (lead.length >= 2) add('directions', `The first ${lead.length} directions look like ingredients (starting "${lead[0].slice(0, 40)}"). Move them to the ingredients.`);

  const last = steps.length ? steps[steps.length - 1].text.trim() : null;
  if (last && last.split(' ').length >= 4 && dangling.test(last)) add('directions', 'The last direction seems to stop mid-sentence. Some text may be missing.');
  if (steps.length && steps.every((x) => x.text.length < 4)) add('directions', 'Some directions look incomplete. Compare with the original page.');
  if (steps.length && ings.length >= 6 && steps.reduce((n, x) => n + x.text.length, 0) < 60) add('directions', 'The directions are very short for this many ingredients. Some text may be missing.');
  if (steps.length === 1 && ings.length >= 5 && steps[0].text.length < 200) add('directions', `Only one short direction was found for ${ings.length} ingredients. Some steps may be missing.`);
  if (steps.length === 1 && steps[0].text.length > 700) add('directions', 'All the directions arrived as one long step. You may want to split it.', Severity.INFO);

  const un = d.unplaced || [];
  if (un.length) add('recipe', `${un.length} line${un.length === 1 ? '' : 's'} from the source could not be placed and ${un.length === 1 ? 'is' : 'are'} kept for you to review.`);
  return { ...d, warnings: out };
}
