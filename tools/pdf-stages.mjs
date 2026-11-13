// Developer tool: runs a real PDF through every stage of the iOS import and writes what each stage produced.
//   node tools/pdf-stages.mjs <file.pdf> [outdir]
// Stage 1 (raw text pieces and positions) comes from poppler (`pdftotext -bbox` and `-raw`), because PDFKit and Vision exist only on
// Apple devices. It stands in for PDFKit: it has the real words and positions of the file, in the same shape the native bridge returns
// ({ text, lines: [{ text, left, top, right, bottom, page }], pages }). What PDFKit itself returns for the same file can only be
// captured on a device or a macOS runner; the on-device stage notes (Original tab) say which route was used.
// Stage 2: the layout reader.  Stage 3: the parser.  Stage 4 (the Recipe Rescue screen) is captured by tools/e2e-real-pdf.cjs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Text from '../www/js/engine/textparser.js';
import { pdfText } from '../www/js/data/importer.js';

const unescapeXml = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The bridge's answer for a PDF, built from poppler: plain text in drawing order and one piece per word with its box. */
export function bridgeAnswer(pdfPath, { pdftotext = 'pdftotext' } = {}) {
  const raw = execFileSync(pdftotext, ['-raw', pdfPath, '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const html = execFileSync(pdftotext, ['-bbox', pdfPath, '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const lines = []; let page = -1;
  for (const m of html.matchAll(/<page\b|<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)<\/word>/g)) {
    if (m[0] === '<page') { page++; continue; }
    lines.push({ text: unescapeXml(m[5]), left: +m[1], top: +m[2], right: +m[3], bottom: +m[4], page });
  }
  return { text: raw.trim(), lines, pages: page + 1 };
}

/** Every stage of the import of one PDF, as data. */
export function stagesOf(pdfPath, opts) {
  const bridge = bridgeAnswer(pdfPath, opts);
  const garbled = Text.looksGarbled(bridge.text);                 // true would send the app to picture reading (Vision) instead of the text layer
  const read = pdfText(bridge);                                    // stage 2: heal pieces, layout reader
  const d = Text.parse(read.text);                                 // stage 3: parser
  const r = d.recipe;
  return {
    stage1: { pages: bridge.pages, pieces: bridge.lines.length, plainText: bridge.text, looksGarbled: garbled },
    stage2: { text: read.text, otherRecipe: read.extra, notes: read.notes, cautions: read.cautions || [] },
    stage3: { title: r.title, servings: r.servings, prepMinutes: r.prepMinutes, cookMinutes: r.cookMinutes, totalMinutes: r.totalMinutes, description: r.description, notes: r.notes,
      ingredients: r.ingredients.map((i) => ({ text: i.text, header: !!i.header })), directions: r.directions.map((x) => x.text), warnings: d.warnings.map((w) => `${w.severity}: ${w.message}`) },
    bridge,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pdf = process.argv[2]; if (!pdf) { console.error('usage: node tools/pdf-stages.mjs <file.pdf> [outdir]'); process.exit(2); }
  const s = stagesOf(pdf); const out = process.argv[3];
  const report = [`STAGE 1  raw text: ${s.stage1.pieces} pieces on ${s.stage1.pages} page(s); text layer judged damaged (would use picture reading): ${s.stage1.looksGarbled}`,
    '\nSTAGE 2  layout reader output (before parsing):\n' + s.stage2.text, '\n--- other recipe set aside ---\n' + s.stage2.otherRecipe, '\nnotes: ' + JSON.stringify(s.stage2.notes) + '  cautions: ' + JSON.stringify(s.stage2.cautions),
    `\nSTAGE 3  parsed: title=${JSON.stringify(s.stage3.title)} servings=${s.stage3.servings} total=${s.stage3.totalMinutes}`,
    'ingredients:\n' + s.stage3.ingredients.map((i) => '  - ' + i.text).join('\n'), 'directions:\n' + s.stage3.directions.map((x, k) => `  ${k + 1}. ${x}`).join('\n'), 'notes: ' + JSON.stringify(s.stage3.notes), 'description: ' + JSON.stringify(s.stage3.description), 'warnings: ' + JSON.stringify(s.stage3.warnings)].join('\n');
  console.log(report);
  if (out) { fs.mkdirSync(out, { recursive: true }); const { bridge, ...rest } = s; fs.writeFileSync(path.join(out, 'stages.json'), JSON.stringify(rest, null, 2)); fs.writeFileSync(path.join(out, 'pieces.json'), JSON.stringify(bridge.lines)); fs.writeFileSync(path.join(out, 'report.txt'), report); }
}
