// Port of RealPageBenchmarkTest.kt: scores the web importer on real saved recipe pages (the recipe-scrapers test corpus, MIT)
// against their maintained expected results. The pages are third-party content and are not stored here: CI clones the corpus at a
// pinned commit and sets TR_CORPUS_DIR to its tests/test_data folder; without it this test is skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import * as Web from '../www/js/engine/webextract.js';

Web.setHtmlParser((html) => parseHTML(/<html[\s>]/i.test(html) ? html : `<html><head></head><body>${html}</body></html>`).document);
const dir = process.env.TR_CORPUS_DIR || '';

const norm = (s) => String(s ?? '').toLowerCase().replace(/&amp;/g, '&').replace(/\bteaspoons?\b/g, 'tsp').replace(/\btablespoons?\b/g, 'tbsp').normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (s) => norm(s).split(' ').filter((t) => t && !/^\d+$/.test(t));
const squash = (s) => norm(String(s ?? '').replace('(s)', 's').replace('(es)', 'es')).replace(/ /g, '');
function sim(a, b) {
  const qa = squash(a), qb = squash(b);
  if (qa && (qa === qb || qa.replace(/s+$/, '') === qb.replace(/s+$/, ''))) return 1;
  if (qa.length >= 6 && qb.length >= 6 && (qa.includes(qb) || qb.includes(qa)) && Math.min(qa.length, qb.length) >= 0.7 * Math.max(qa.length, qb.length)) return 0.9;
  const x = new Set(toks(a)), y = new Set(toks(b));
  if (!x.size || !y.size) return norm(a) === norm(b) ? 1 : 0;
  let c = 0; for (const t of x) if (y.has(t)) c++;
  return c / Math.max(x.size, y.size);
}
function match(exp, got) {
  const used = new Set(), idx = [];
  for (const e of exp) { let best = -1, bs = 0; got.forEach((g, j) => { if (used.has(j)) return; const s = sim(e, g); if (s > bs) { bs = s; best = j; } }); if (bs >= 0.6) { used.add(best); idx.push(best); } }
  return { recall: exp.length ? idx.length / exp.length : 1, precision: got.length ? used.size / got.length : 1, ordered: idx.every((v, i) => i === 0 || idx[i - 1] < v) };
}

test('real pages stay above the measured floors', { skip: !dir || !fs.existsSync(dir) ? 'set TR_CORPUS_DIR to recipe-scrapers/tests/test_data' : false, timeout: 600000 }, () => {
  let n = 0, complete = 0, major = 0, silentMajor = 0, orderOk = 0, lowPrecision = 0, crashed = 0, imgExpected = 0, imgFound = 0;
  for (const host of fs.readdirSync(dir).sort()) {
    const hd = path.join(dir, host); if (!fs.statSync(hd).isDirectory()) continue;
    for (const f of fs.readdirSync(hd).filter((x) => x.endsWith('.testhtml')).sort()) {
      const jf = path.join(hd, f.replace(/\.testhtml$/, '.json')); if (!fs.existsSync(jf)) continue;
      let exp; try { exp = JSON.parse(fs.readFileSync(jf, 'utf8')); } catch { continue; }
      const expIng = Array.isArray(exp.ingredients) ? exp.ingredients.filter((x) => typeof x === 'string') : [];
      const expSteps = Array.isArray(exp.instructions_list) ? exp.instructions_list : typeof exp.instructions === 'string' ? exp.instructions.split('\n').filter((x) => x.trim()) : [];
      if (!expIng.length || !expSteps.length) continue;
      n++;
      let d; try { d = Web.extract(fs.readFileSync(path.join(hd, f), 'utf8'), exp.canonical_url || `https://${host}/`); } catch { crashed++; major++; continue; }
      const ing = d.recipe.ingredients.filter((i) => !i.header).map((i) => i.text), steps = d.recipe.directions.filter((x) => !x.header).map((x) => x.text);
      const mi = match(expIng, ing); const et = toks(expSteps.join(' ')); const got = new Set(toks(steps.join(' ')));
      const cover = et.length ? et.filter((t) => got.has(t)).length / et.length : 1;
      const warned = d.warnings.some((w) => w.severity !== 'INFO');
      if (mi.recall >= 0.999 && cover >= 0.95) complete++;
      if (mi.recall < 0.7 || cover < 0.7) { major++; if (!warned) silentMajor++; }
      if (mi.ordered) orderOk++;
      if (ing.length && mi.precision < 0.8) lowPrecision++;
      if (exp.image) { imgExpected++; if (d.imageCandidates.length) imgFound++; }
    }
  }
  const pct = (k) => (100 * k / n);
  console.log(`REAL-PAGE BENCHMARK (JS) pages=${n} complete=${pct(complete).toFixed(1)}% majorLoss=${pct(major).toFixed(1)}% silentMajorLoss=${pct(silentMajor).toFixed(1)}% ingredientOrderOk=${pct(orderOk).toFixed(1)}% extraLines=${pct(lowPrecision).toFixed(1)}% photoFound=${(100 * imgFound / imgExpected).toFixed(1)}% crashed=${crashed}`);
  assert.ok(n >= 900, `corpus looks incomplete: ${n} pages`);
  assert.equal(crashed, 0, 'no page may crash the importer');
  assert.ok(pct(complete) >= 89.5, `complete imports fell to ${pct(complete)}%`);
  assert.ok(pct(major) <= 6.2, `major losses rose to ${pct(major)}%`);
  assert.ok(pct(silentMajor) <= 1.2, `silent major losses rose to ${pct(silentMajor)}%`);
  assert.ok(pct(orderOk) >= 98.5, `ingredient order kept on only ${pct(orderOk)}%`);
  assert.ok(pct(lowPrecision) <= 5.0, `extra ingredient lines rose to ${pct(lowPrecision)}%`);
  assert.ok(imgFound / imgExpected >= 0.985, 'photo found rate fell');
});
