// Runs what PDFKit returned (bridge.json from probe.swift) through the app's own stages and compares the WORDS with the invented page.
//   node tools/pdfkit-probe/verify.mjs outdir/bridge.json
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as Text from '../../www/js/engine/textparser.js';
import * as R from '../../www/js/engine/rescue.js';
import { pdfText } from '../../www/js/data/importer.js';
import { vocabulary, fragmentRate } from '../../www/js/engine/wordheal.js';
import { choose } from '../../www/js/engine/photopick.js';

const bridge = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(`STAGE 1 (PDFKit): ${bridge.lines.length} pieces; garbled verdict: ${Text.looksGarbled(bridge.text)}`);
console.log('plain text from PDFKit (drawing order):\n' + bridge.text.split('\n').slice(0, 40).join(' | '));
console.log('first pieces (text @ left,top,right,bottom):');
for (const l of bridge.lines.slice(0, 60)) console.log(`  ${JSON.stringify(l.text)} @ ${l.left.toFixed(1)},${l.top.toFixed(1)},${l.right.toFixed(1)},${l.bottom.toFixed(1)}`);
const split = bridge.lines.filter((l) => /^\p{L}{1,2}$/u.test(l.text) && !['a', 'A', 'I', 'of', 'to', 'in', 'on', 'or', 'by', 'at', 'an', 'is', 'it', 'as', 'be', 'No', 'In'].includes(l.text));
console.log(`pieces that are a lone letter or two (possible cuts): ${split.length}${split.length ? ' -> ' + split.map((l) => l.text).join(' ') : ''}`);

const read = pdfText(bridge);
console.log('\nSTAGE 2 (layout reader):\n' + read.text + '\n--- other recipe ---\n' + read.extra + '\nnotes: ' + JSON.stringify(read.notes) + ' cautions: ' + JSON.stringify(read.cautions || []));
const d = Text.parse(read.text); const r = d.recipe;
console.log('\nSTAGE 3 (parser): title=' + JSON.stringify(r.title) + ' servings=' + r.servings);
console.log('ingredients: ' + JSON.stringify(r.ingredients.map((i) => i.text)));
console.log('directions: ' + JSON.stringify(r.directions.map((x) => x.text)));

const expIng = ['2 (10 3/4 ounce) cans cream of mushroom soup', '1 (16 ounce) can mixed vegetables, drained', '2 cups cooked chicken, diced', '1/2 cup milk', '1/2 teaspoon thyme', '1/2 teaspoon black pepper', '2 (9 inch) frozen pie crusts, thawed', '1 egg, lightly beaten'];
const expDir = ['Combine first 6 ingredients.', 'Spoon into prepared pie crust.', 'Cover with top crust; crimp edges to seal.', 'Slit the top and brush with egg.', 'Bake at 375 degrees for 40 minutes.', 'Cool 10 minutes before serving.'];
const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };
check(r.title === 'SAVORY CHICKEN PIE', `title: ${r.title}`);
check(JSON.stringify(r.ingredients.map((i) => i.text)) === JSON.stringify(expIng), 'ingredients differ');
check(JSON.stringify(r.directions.map((x) => x.text)) === JSON.stringify(expDir), 'directions differ');
const lists = [...r.ingredients.map((i) => i.text), ...r.directions.map((x) => x.text)];
check(!lists.some((l) => /GINGER|COOKIES|Ben Baker|Ready In|Serves|Submitted/.test(l)), 'details or the second recipe entered a list');
check(new Set(lists).size === lists.length, 'a line appears twice'); check(lists.every((l) => /\p{L}/u.test(l)), 'a line is only a number');
check(fragmentRate(read.text) === 0, 'stray single letters in the layout text');
check(R.linesToReview(r).length === 0, 'lines are marked for review');
const vocab = vocabulary(bridge.text); const bad = read.text.split(/\s+/).filter((t) => { const c = t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''); return c && !c.split('-').every((p) => !p || /^[\d/]+$/.test(p) || vocab.has(p.toLowerCase())); });
check(bad.length === 0, `words that are not whole words of PDFKit's own text: ${bad.join(' ')}`);
// the pictures embedded in the PDF, as the native code took them out: the photo is chosen, the advert (banner shape + see-through mask) is not
const imagesPath = process.argv[2].replace(/bridge\.json$/, 'images.json');
const images = JSON.parse(fs.readFileSync(imagesPath, 'utf8'));
console.log('\nEMBEDDED PICTURES: ' + JSON.stringify(images));
check(images.length === 2, `two embedded pictures expected, found ${images.length}`);
const cands = images.map((im, i) => ({ id: `pdf:${i}`, label: `Picture ${i + 1}`, source: 'pdf', order: i, width: im.width, height: im.height, hasMask: im.hasMask }));
const pick = choose(cands);
const photo = cands.find((c) => c.width === 600 && c.height === 450), ad = cands.find((c) => c.width === 750 && c.height === 300);
check(!!photo && !!ad, 'the photo (600x450) and the advert (750x300) are both found with their true sizes');
if (photo && ad) {
  check(photo.hasMask === false, 'the photo has no mask'); check(ad.hasMask === true, 'the advert is reported with its see-through mask');
  check(pick.selectedId === photo.id, `the photo is the recipe photo (selected ${pick.selectedId})`);
  check(pick.candidates.find((c) => c.id === ad.id).rejected === 'banner', 'the advert is rejected as a banner');
}
if (problems.length) { console.log('\nPROBLEMS:\n - ' + problems.join('\n - ')); process.exit(1); }
console.log('\nPDFKit probe: every word and section is right');
