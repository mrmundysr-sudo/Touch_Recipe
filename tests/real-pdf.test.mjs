// The owner's REAL PDF (Veg-All Chicken Pot Pie, a web page printed to PDF) through every stage of the iOS import, compared word for word.
// The PDF is private (third-party page, public repository): see tests/fixtures/real-pdf/README.md. Without it every test here is SKIPPED, not passed.
// Stage 1 comes from poppler as a stand-in for PDFKit (Apple-only); stages 2-3 and the import path are the app's own code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as Text from '../www/js/engine/textparser.js';
import * as R from '../www/js/engine/rescue.js';
import { vocabulary, fragmentRate } from '../www/js/engine/wordheal.js';
import { ImportService, VisionOcr } from '../www/js/data/importer.js';
import { stagesOf, bridgeAnswer } from '../tools/pdf-stages.mjs';

const pdf = process.env.TR_REAL_PDF || (fs.existsSync(new URL('./private/veg-all.pdf', import.meta.url)) ? new URL('./private/veg-all.pdf', import.meta.url).pathname : null);
const hasPoppler = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const skip = !pdf ? 'real PDF not present (tests/private/veg-all.pdf or TR_REAL_PDF)' : !hasPoppler ? 'poppler (pdftotext) not installed' : false;
const expected = JSON.parse(fs.readFileSync(new URL('./fixtures/real-pdf/veg-all.expected.json', import.meta.url), 'utf8'));
const S = skip ? null : stagesOf(pdf);
const tokens = (t) => t.split(/\s+/).filter(Boolean);
const flat = (t) => t.replace(/\s+/g, ' ').trim();
/** A word counts as whole when each hyphen-separated part (or a plain number/fraction) is a word of the page's own text. */
const wholeWord = (w, vocab) => { const c = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''); return !c || c.split('-').every((p) => !p || /^[\d/]+$/.test(p) || vocab.has(p.toLowerCase())); };

test('stage 1: the real PDF has a clean text layer and must be read from it, never by picture', { skip }, () => {
  assert.equal(S.stage1.looksGarbled, false, 'the quoted paragraph that wraps over several lines is not damage; if this is true the app reads the page PICTURE (Vision), where an advertisement covers text and the right card is clipped');
  assert.ok(S.stage1.pieces > 200, 'the bridge answers with positioned pieces');
  const vocab = vocabulary(S.stage1.plainText);
  for (const w of ['cream', 'potato', 'Veg', 'All', 'pie', 'crusts', 'thawed', 'deep', 'dish', 'egg', 'lightly', 'beaten', 'optional', 'black', 'pepper']) assert.ok(vocab.has(w.toLowerCase()), `plain text holds "${w}" whole`);
});

test('stage 2: the layout reader gives the first card in reading order, every line intact', { skip }, () => {
  const text = S.stage2.text;
  const lines = text.split('\n');
  // each ingredient is one line, amount first
  for (const ing of expected.ingredients) assert.ok(lines.includes(ing), `ingredient line intact: ${ing}`);
  // the ingredient lines are in order and after the INGREDIENTS heading
  const at = expected.ingredients.map((i) => lines.indexOf(i));
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'ingredients in page order');
  assert.ok(at[0] > lines.indexOf('INGREDIENTS'), 'ingredients come after their heading');
  // directions: numbered, wrapped lines joined
  const dirText = flat(lines.slice(lines.indexOf('DIRECTIONS') + 1, lines.indexOf('INGREDIENTS')).join(' '));
  expected.directions.forEach((d, i) => assert.ok(dirText.includes(`${i + 1}. ${d.replace(/ crimp/, ' crimp')}`.replace(/\s+/g, ' ')), `direction ${i + 1} intact: ${d}`));
  // the other card never enters the first card's text, and is kept apart
  for (const m of expected.otherRecipeMarkers) assert.ok(!text.includes(m), `"${m}" is not in the first recipe's text`);
  assert.match(S.stage2.otherRecipe, /BOURBON CHICKEN/); assert.ok(S.stage2.notes.some((n) => /more than one recipe/.test(n)));
  // no word is split or glued: every word of the first card's text is a whole word of the PDF's own text
  const vocab = vocabulary(S.stage1.plainText);
  const bad = tokens(text).filter((t) => !wholeWord(t, vocab));
  assert.deepEqual(bad, [], 'every word is a whole word of the page');
  assert.equal(fragmentRate(text), 0);
  assert.deepEqual(S.stage2.cautions, [], 'nothing left that the app is unsure about');
});

test('stage 3: the parser puts every word in the right section', { skip }, () => {
  const r = S.stage3;
  assert.equal(r.title, expected.title);
  assert.equal(r.servings, expected.servings); assert.equal(r.totalMinutes, expected.totalMinutes);
  assert.deepEqual(r.ingredients.map((i) => i.text), expected.ingredients);
  assert.ok(r.ingredients.every((i) => !i.header), 'no ingredient became a heading');
  assert.deepEqual(r.directions, expected.directions);
  for (const n of expected.notesContain) assert.ok(r.notes.includes(n), `notes hold "${n}"`);
  const lists = [...r.ingredients.map((i) => i.text), ...r.directions];
  for (const m of [...expected.otherRecipeMarkers, ...expected.detailMarkers]) assert.ok(!lists.some((l) => l.includes(m)), `"${m}" is in neither list`);
  assert.ok(!/1\/2 cup milk|Combine first/.test(r.description + r.notes), 'list text is not repeated in the description or notes');
  assert.equal(new Set(lists).size, lists.length, 'no line appears twice');
  assert.ok(lists.every((l) => /\p{L}/u.test(l)), 'no line is only a number');
  assert.ok(lists.every((l) => !/^\W*\d{1,3}[.)]?\W*$/.test(l)));
  // every word of every list line is a whole word of the page
  const vocab = vocabulary(S.stage1.plainText);
  for (const l of lists) for (const t of tokens(l)) assert.ok(wholeWord(t, vocab), `"${t}" in "${l}" is a whole word`);
  // Recipe Rescue would mark none of these lines
  const recipe = Text.parse(S.stage2.text).recipe;
  assert.deepEqual(R.linesToReview(recipe), [], 'no line is marked "Check this line"');
});

test('import path: the real PDF is read from its text layer; picture reading is never asked for', { skip }, async () => {
  const calls = [];
  // Node has no FileReader (the app's blobToB64 uses it in the browser)
  globalThis.FileReader ??= class { readAsDataURL(b) { b.arrayBuffer().then((buf) => { this.result = 'data:application/pdf;base64,' + Buffer.from(buf).toString('base64'); this.onload?.(); }).catch((e) => { this.error = e; this.onerror?.(); }); } };
  const fake = { recognizePdf: async (args) => { calls.push(args.forceOcr ? 'picture' : 'text'); return bridgeAnswer(pdf); } };
  // the same VisionOcr code the app uses, with the native plugin replaced by poppler's answer
  globalThis.Capacitor = { isPluginAvailable: () => true, Plugins: { TouchRecipeOcr: { recognizePdf: async (a) => fake.recognizePdf(a), renderPdfPage: async () => ({}) } } };
  try {
    const svc = new ImportService({ photos: null, ocr: new VisionOcr() });
    const d = await svc.fromPdf(new Blob([fs.readFileSync(pdf)], { type: 'application/pdf' }), () => {});
    assert.deepEqual(calls, ['text'], 'one read of the text layer, no picture reading');
    assert.equal(d.recipe.title, expected.title);
    assert.deepEqual(d.recipe.ingredients.map((i) => i.text), expected.ingredients);
    assert.deepEqual(d.recipe.directions.map((x) => x.text), expected.directions);
    assert.match(d.source.text, /Another recipe on the same page[\s\S]*BOURBON CHICKEN/, 'the second recipe is kept with the original');
    assert.ok(d.source.text.includes('VEG-ALL CHICKEN POT PIE'), 'the original text is kept');
  } finally { delete globalThis.Capacitor; }
});
