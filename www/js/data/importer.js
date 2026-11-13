// Port of data/ImportService.kt + Fetcher.kt + Ocr.kt. All import paths produce a draft; nothing is saved here.
// Network access happens only for URL imports the user asked for. Recognition runs on the device (Apple Vision) via a
// tiny native bridge; when it is missing (e.g. in a desktop browser) scanning explains that and offers Paste or Type.
import * as Text from '../engine/textparser.js';
import * as Layout from '../engine/layout.js';
import { healText, healPieces, fragmentRate } from '../engine/wordheal.js';
import { choose, statsFromPixels } from '../engine/photopick.js';
import * as Web from '../engine/webextract.js';
import { ImportMethod, Confidence, Severity, warn } from '../engine/models.js';
import { emptySource, pageText } from '../engine/rescue.js';
import * as Img from './imagetools.js';

export class ImportFailure extends Error {
  constructor(userMessage, { retryable = false, offline = false, blocked = false } = {}) { super(userMessage); this.userMessage = userMessage; this.retryable = retryable; this.offline = offline; this.blocked = blocked; }
}
export class OcrUnavailable extends Error {}

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 TouchRecipe/1.0';
import { plugin, isNative } from './native.js';
const nativeHttp = () => (isNative() ? plugin('CapacitorHttp') : null);

const b64ToBlob = (b64, type = 'application/octet-stream') => { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type }); };
export const blobToB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

/** Plain user-directed HTTP GET. Does not log in, solve challenges or evade blocks: a blocked page is reported as blocked. */
export class HttpPageFetcher {
  async fetchPage(url) {
    try {
      const http = nativeHttp();
      let status, final = url, type = '', body;
      if (http) {
        const r = await http.get({ url, headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' }, responseType: 'text', connectTimeout: 12000, readTimeout: 15000 });
        status = r.status; final = r.url || url; type = String(r.headers?.['Content-Type'] ?? r.headers?.['content-type'] ?? '').toLowerCase(); body = typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? '');
      } else {
        const res = await fetch(url, { redirect: 'follow', headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' } });
        status = res.status; final = res.url || url; type = (res.headers.get('content-type') || '').toLowerCase(); body = await res.text();
      }
      if ([401, 403, 429, 451, 503].includes(status)) return { kind: 'blocked', status, message: `The site declined to share this page automatically (HTTP ${status}).` };
      if (status < 200 || status > 299) return { kind: 'failure', message: `The page answered with an error (HTTP ${status}).` };
      if (type && !/html|xml|text|json/.test(type)) return { kind: 'failure', message: 'That link is not a web page.' };
      return { kind: 'page', body: body.slice(0, 6 * 1024 * 1024), finalUrl: final };
    } catch (e) {
      const m = String(e && e.message || e);
      if (/timed? ?out/i.test(m)) return { kind: 'failure', message: 'The site took too long to answer.', offline: true };
      if (/ssl|certificate|secure/i.test(m)) return { kind: 'failure', message: 'A secure connection to the site could not be made.' };
      return { kind: 'failure', message: 'No internet connection, or the address could not be found.', offline: true };
    }
  }
  async fetchBytes(url, maxBytes = 8 * 1024 * 1024) {
    try {
      const http = nativeHttp();
      if (http) { const r = await http.get({ url, headers: { 'User-Agent': UA, Accept: 'image/*' }, responseType: 'blob' }); if (r.status < 200 || r.status > 299 || !r.data) return null; const b = b64ToBlob(r.data, 'image/jpeg'); return b.size > maxBytes ? null : b; }
      const res = await fetch(url, { redirect: 'follow' }); if (!res.ok) return null; const b = await res.blob(); return b.size > maxBytes ? null : b;
    } catch { return null; }
  }
}

/** Apple Vision text recognition through the native bridge (see tools/patch_ios.py). */
export class VisionOcr {
  get available() { return !!plugin('TouchRecipeOcr'); }
  async recognizeImage(blob) {
    const p = plugin('TouchRecipeOcr');
    if (!p) throw new OcrUnavailable("Text recognition isn't available on this device.");
    try { return (await p.recognizeImage({ image: await blobToB64(blob) })).text || ''; } catch { throw new OcrUnavailable("Text recognition isn't available right now."); }
  }
  /** forceOcr: skip the PDF's text layer and read the rendered pages instead (the layer can be damaged by web-font ligatures). */
  async recognizePdf(blob, { forceOcr = false } = {}) {
    const p = plugin('TouchRecipeOcr');
    if (!p) throw new OcrUnavailable("Text recognition isn't available on this device.");
    try { const r = await p.recognizePdf({ pdf: await blobToB64(blob), maxPages: 6, forceOcr }); return { ...pdfText(r), pages: r.pages || 0, picture: forceOcr }; } catch { throw new OcrUnavailable("That PDF could not be read."); }
  }
  /** The pictures EMBEDDED in a PDF, taken out directly (not cut from a rendered page). Null when the native app cannot do it (then nothing is guessed from them). */
  async extractPdfImages(blob) {
    const p = plugin('TouchRecipeOcr'); if (!p) return null;
    try {
      const r = await p.extractPdfImages({ pdf: await blobToB64(blob), maxPages: 6, maxImages: 12 });
      if (!r || !Array.isArray(r.images)) return null;
      return r.images.map((i) => ({ blob: b64ToBlob(i.image, 'image/jpeg'), width: i.width, height: i.height, page: i.page, hasMask: !!i.hasMask }));
    } catch { return null; }
  }
}

/**
 * The text of a PDF from the bridge's answer. The bridge sends the text in the order the file draws it, which on a page with
 * columns (or a table of amounts and ingredients) is not the reading order, and also the pieces of text with their positions on
 * the page (`lines`). The pieces go through the layout reader; the plain text is only the fallback, used when there are no pieces
 * or when the reader's result is missing a lot of what the page holds (it never silently loses text).
 */
export function pdfText(r) {
  const plain = r.text || '';
  const cautions = [];
  if (Array.isArray(r.lines) && r.lines.length) {
    try {
      const out = Layout.readWithNotes(healPieces(r.lines, plain));
      const size = (t) => t.replace(/\s/g, '').length;
      if (out.text.trim() && size(out.text) + size(out.extra) >= size(plain) * 0.6) {
        // words cut in pieces by a bad spacing guess are put back together, but only where the plain text proves the word
        const text = healText(out.text, plain), extra = healText(out.extra, plain);
        // what is still cut up is not rearranged or guessed: the person is told to check the text against the original
        if (fragmentRate(text) > 0.02) cautions.push('Some words in this PDF were read in pieces and could not be put back together. Check the text against the original.');
        return { text, extra, notes: out.notes, method: 'positions', pieces: r.lines.length, ...(cautions.length ? { cautions } : {}) };
      }
    } catch { /* fall back to the plain text */ }
  }
  return { text: plain, extra: '', notes: [], method: 'plain', pieces: 0 };
}

/** What a picture is: its size and a reduced look at its colours. Null when it cannot be opened (a broken download is not a picture). */
export async function analyzeImage(blob) {
  try {
    const bmp = await createImageBitmap(blob); const width = bmp.width, height = bmp.height; if (!width || !height) return null;
    let stats = null;
    try {
      const k = Math.min(1, 48 / Math.max(width, height)); const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(width * k)); c.height = Math.max(1, Math.round(height * k));
      const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, c.width, c.height); const d = g.getImageData(0, 0, c.width, c.height).data; const argb = new Array(c.width * c.height);
      for (let i = 0; i < argb.length; i++) argb[i] = (255 << 24) | (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];
      stats = statsFromPixels(argb);
    } catch { /* size alone is still useful */ }
    return { width, height, stats };
  } catch { return null; }
}
/** The note shown with the import for the photo outcome (null when nothing needs saying). */
export function photoWarning(photos) {
  if (!photos) return null;
  if (photos.selectedId && photos.needsCheck) return warn('photo', 'A photo was chosen automatically. Check it, or choose another.', Severity.WARNING);
  if (photos.reason === 'only-rejected') return warn('photo', 'A picture was found, but it looks like an advert or a banner, so it was not used as the recipe photo. You can add your own.', Severity.WARNING);
  if (photos.reason === 'only-guesses') return warn('photo', 'No photo was found in the source. A guess from the page picture is offered when you choose a photo.', Severity.INFO);
  if (photos.reason === 'none') return warn('photo', 'No photo was found in the source.', Severity.INFO);
  return null;
}

/** One PDF page as a picture (native), or null when the bridge is missing. */
export async function renderPdfPage(blob, page = 0) {
  const p = plugin('TouchRecipeOcr'); if (!p) return null;
  try { const r = await p.renderPdfPage({ pdf: await blobToB64(blob), page, maxEdge: 2000 }); return r.image ? b64ToBlob(r.image, 'image/jpeg') : null; } catch { return null; }
}

/** Downscales and re-encodes an image (honouring EXIF rotation) so recognition is fast and the payload small. */
export async function prepareImage(blob, maxEdge = 2200) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
}

const urlRegex = /https?:\/\/[^\s<>"']+/i;
const socialHosts = ['tiktok.com', 'instagram.com', 'facebook.com', 'fb.watch', 'fb.com'];

export class ImportService {
  constructor({ fetcher = new HttpPageFetcher(), ocr = new VisionOcr(), photos, originals = null, clock = () => Date.now() } = {}) { this.fetcher = fetcher; this.ocr = ocr; this.photos = photos; this.originals = originals; this.clock = clock; }
  /** Keeps the original of an import (the page text, pictures or PDF) so it can be looked at later; never required for the import to work. */
  withSource(draft, source) { return { ...draft, source: { ...emptySource(), capturedAt: this.clock(), ...source } }; }

  classify(text) {
    const t = text.trim();
    const m = urlRegex.exec(t);
    if (m && (t.split('\n').length <= 3 || (m.index === 0 && t.length - m[0].length < 200))) return { type: 'url', url: m[0].replace(/[.,)]+$/, '') };
    if (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(t)) return { type: 'url', url: 'https://' + t };
    return { type: 'text', text: t };
  }
  async import(input, onStatus = () => {}) {
    switch (input.type) {
      case 'url': return this.fromUrl(input.url, onStatus);
      case 'text': return this.withSource(Text.parse(input.text), { kind: 'TEXT', text: input.text.slice(0, 2_000_000) });
      case 'image': return this.fromImages([input.file], onStatus);
      case 'pdf': return this.fromPdf(input.file, onStatus);
      case 'file': return this.fromFile(input, onStatus);
      default: throw new ImportFailure('That kind of import is not supported.');
    }
  }
  normalizeUrl(raw) {
    let t = raw.trim().replace(/^<+|>+$/g, '');
    if (!t || t.includes(' ')) { const m = urlRegex.exec(t); if (!m) return null; t = m[0]; }
    if (!/^https?:\/\//i.test(t)) { if (t.includes('://')) return null; t = 'https://' + t; }
    let u; try { u = new URL(t); } catch { return null; }
    if (!u.hostname || !u.hostname.includes('.')) return null;
    return t;
  }
  async tiktokCaption(url) {
    try { const r = await this.fetcher.fetchPage('https://www.tiktok.com/oembed?url=' + encodeURIComponent(url)); if (r.kind !== 'page') return null; return JSON.parse(r.body).title ?? null; } catch { return null; }
  }
  async fromUrl(raw, onStatus) {
    const url = this.normalizeUrl(raw);
    if (!url) throw new ImportFailure("That doesn't look like a web link. Check the address and try again.");
    let host = ''; try { host = new URL(url).hostname.toLowerCase(); } catch { /* ignore */ }
    const social = socialHosts.some((s) => host === s || host.endsWith('.' + s));
    onStatus(`Contacting ${host.replace(/^www\./, '')}…`);
    let caption = null;
    if (social && host.includes('tiktok')) caption = await this.tiktokCaption(url);
    const r = await this.fetcher.fetchPage(url);
    if (r.kind === 'page') {
      onStatus('Looking for recipe data…');
      let draft = Web.extract(r.body, r.finalUrl);
      if (social || (!draft.recipe.ingredients.length && !draft.recipe.directions.length)) {
        const doc = Web.parseDoc(r.body);
        const og = caption ?? ((x) => (x.length > 40 ? x : null))([doc.querySelector('meta[property="og:title"]')?.getAttribute('content'), doc.querySelector('meta[property="og:description"]')?.getAttribute('content')].filter(Boolean).join('\n'));
        if (og != null && (social || !draft.recipe.title.trim())) {
          const t = Text.parse(og, ImportMethod.SOCIAL_CAPTION, r.finalUrl);
          if (t.recipe.ingredients.length || t.recipe.directions.length || social) {
            draft = { ...t, recipe: { ...t.recipe, sourceUrl: r.finalUrl, sourceName: host.replace(/^www\./, ''), title: t.recipe.title.trim() ? t.recipe.title : draft.recipe.title },
              warnings: [warn('recipe', 'Social platforms rarely share full recipes. We used the post\'s public caption; the rest may need to be typed in or pasted.', Severity.WARNING), ...t.warnings.filter((w) => w.severity !== Severity.INFO)],
              imageCandidates: draft.imageCandidates, confidence: Confidence.LOW };
          }
        }
      }
      if (/just a moment/i.test(r.body) && !draft.recipe.ingredients.length) throw new ImportFailure('This site asked for a browser check, so the recipe couldn\'t be read. Open the page in your browser, copy the recipe text, and use Paste or Type Recipe.', { blocked: true });
      return this.withSource({ ...draft, recipe: { ...draft.recipe, sourceUrl: draft.recipe.sourceUrl ?? r.finalUrl } }, { kind: 'WEB', url: r.finalUrl, text: pageText(r.body) });
    }
    if (r.kind === 'blocked') throw new ImportFailure(`${r.message} Open the page in your browser, copy the recipe text, and use Paste or Type Recipe — your original link will be kept if you paste it in the source field.`, { blocked: true });
    throw new ImportFailure(r.message, { retryable: true, offline: !!r.offline });
  }
  /** Downloads the first usable image candidate into private storage; returns the stored file name. */
  async fetchPhoto(candidates) {
    for (const c of candidates.slice(0, 3)) { const b = await this.fetcher.fetchBytes(c); if (b) { const n = await this.photos.saveBlob(b); if (n) return n; } }
    return null;
  }
  /** The pictures of a web page, looked at one by one (up to six, three at a time). A download that fails or is not a picture is skipped; the rest are still considered. */
  async webPhotos(urls) {
    const list = (urls || []).slice(0, 6); const found = [];
    for (let k = 0; k < list.length; k += 3) {
      const batch = await Promise.all(list.slice(k, k + 3).map(async (u, j) => {
        const order = k + j; const blob = await this.fetcher.fetchBytes(u); if (!blob) return null;
        const a = await analyzeImage(blob); if (!a) return null;
        return { id: `web:${order}`, label: order === 0 ? "The page's main picture" : `Picture ${order + 1} from the page`, source: 'web', order, blob, ...a };
      }));
      found.push(...batch.filter(Boolean));
    }
    const photos = choose(found); photos.tried = list.length; photos.loaded = found.length; return photos;
  }
  ocrDraft(text) {
    if (!text.trim()) throw new ImportFailure('No text could be found. Try a sharper, well-lit photo, or use Paste or Type Recipe.', { retryable: true });
    return Text.parse(text, ImportMethod.OCR);
  }
  async fromImages(files, onStatus) {
    const parts = [], kept = [], cleaned = []; let dish = null;
    for (let i = 0; i < files.length; i++) {
      onStatus(`Reading text from the photo${files.length > 1 ? ` ${i + 1} of ${files.length}` : ''}…`);
      let img; try { img = await prepareImage(files[i]); } catch { throw new ImportFailure('That image could not be opened.'); }
      try { parts.push(await this.ocr.recognizeImage(img)); } catch (e) { if (e instanceof OcrUnavailable) throw new ImportFailure((e.message || 'Text recognition failed.') + ' You can still use Paste or Type Recipe.', { retryable: true }); throw e; }
      if (this.originals) {
        try {
          kept.push(await this.originals.saveFile(files[i], 'jpg'));
          onStatus('Straightening the page…');
          const c = await Img.cleanedPage(files[i]); cleaned.push(await this.originals.saveFile(c.blob, 'jpg'));
          // the page is straightened FIRST, then searched for the printed dish photo (the table around a photographed page would otherwise be taken for a picture)
          if (!dish) { onStatus('Looking for a photo of the dish…'); dish = await Img.dishPhoto(c.found ? c.blob : files[i]) || (c.found ? await Img.dishPhoto(files[i]) : null); }
        } catch { /* keeping the original is best effort */ }
      }
    }
    const d = this.ocrDraft(parts.join('\n\n'));
    let dishFile = null; if (dish && this.originals) { try { dishFile = await this.originals.saveFile(dish.blob, 'jpg'); } catch { /* ignore */ } }
    const out = this.withSource(d, { kind: 'IMAGE', files: kept, cleaned, text: parts.join('\n\n'), dishPhoto: dishFile });
    if (dish) out.dishPhotoBlob = dish.blob;
    // the photo printed on the photographed or scanned page is OFFERED as the cover; the person adjusts or approves it
    const a = dish ? await analyzeImage(dish.blob) : null;
    out.photos = choose(dish ? [{ id: 'page', label: 'The photo found on the page', source: 'page', blob: dish.blob, width: a ? a.width : 0, height: a ? a.height : 0, stats: a ? a.stats : null }] : []);
    const pw = photoWarning(out.photos); if (pw) out.warnings = [...out.warnings, pw];
    return out;
  }
  async fromPdf(file, onStatus) {
    onStatus('Opening the PDF…');
    let r;
    try { onStatus('Reading the PDF…'); r = await this.ocr.recognizePdf(file); r = await this.preferCleanText(file, r, onStatus); } catch (e) { throw new ImportFailure((e.message || 'That PDF could not be opened.') + ' You can still use Paste or Type Recipe.', { retryable: true }); }
    const read = this.ocrDraft(r.text);
    const d0 = (r.notes?.length || r.cautions?.length) ? { ...read, warnings: [...read.warnings, ...(r.notes || []).map((n) => warn('recipe', n, Severity.INFO)), ...(r.cautions || []).map((n) => warn('recipe', n, Severity.WARNING))] } : read;
    let name = null; if (this.originals) { try { name = await this.originals.saveFile(file, 'pdf'); } catch { /* ignore */ } }
    // every page up to four is kept as a picture for the Original tab (never changed)
    let cleaned = [], firstPage = null;
    if (this.originals) {
      try {
        const pages = Math.max(1, Math.min(r.pages || 1, 4));
        for (let i = 0; i < pages; i++) {
          const pg = await renderPdfPage(file, i);
          if (!pg) { if (i === 0) break; continue; }
          if (i === 0) firstPage = pg;
          cleaned.push(await this.originals.saveFile(pg, 'jpg'));
        }
      } catch { /* optional */ }
    }
    // the recipe photo: the pictures EMBEDDED in the PDF, taken out directly. A picture guessed from the rendered page is never used on its own: on a printed web page it is
    // usually an advertisement (the owner's Veg-All PDF has one drawn over the recipe).
    onStatus('Looking for the recipe photo…');
    const embedded = this.ocr.extractPdfImages ? await this.ocr.extractPdfImages(file) : null;
    const cands = [];
    if (embedded) {
      for (let i = 0; i < embedded.length; i++) {
        const e = embedded[i]; const a = await analyzeImage(e.blob); const w = a ? a.width : e.width, hh = a ? a.height : e.height;
        const scan = w * hh >= 1.0e6 && w / hh >= 0.6 && w / hh <= 0.9 && !e.hasMask;   // a whole scanned page, not a photo on it
        if (scan) { const dish = await Img.dishPhoto(e.blob); if (dish) { const da = await analyzeImage(dish.blob); cands.push({ id: `scan:${i}`, label: 'The photo found on the scanned page', source: 'page', blob: dish.blob, width: da ? da.width : 0, height: da ? da.height : 0, stats: da ? da.stats : null }); } continue; }
        cands.push({ id: `pdf:${i}`, label: `Picture ${i + 1} in the PDF (${w} \u00d7 ${hh})`, source: 'pdf', order: i, blob: e.blob, width: w, height: hh, hasMask: e.hasMask, stats: a ? a.stats : null });
      }
    } else if (firstPage) {
      const dish = await Img.dishPhoto(firstPage);
      if (dish) { const da = await analyzeImage(dish.blob); cands.push({ id: 'guess:0', label: 'A guess from the page picture', note: 'Guessed, not taken from the PDF: check it', source: 'guess', noAuto: true, blob: dish.blob, width: da ? da.width : 0, height: da ? da.height : 0, stats: da ? da.stats : null }); }
    }
    const photos = choose(cands);
    // which route read the file, kept with the original so a screenshot of the Original tab shows it
    const readNote = r.picture ? 'a picture of each page (the PDF\'s own text looked damaged)' : r.method === 'positions' ? `the PDF\'s own text with positions (${r.pieces} pieces)` : 'the PDF\'s own text, without positions';
    const d = this.withSource(d0, { kind: 'PDF', readNote: `Read from ${readNote}.`, files: name ? [name] : [], cleaned, text: r.extra ? `${r.text}\n\n--- Another recipe on the same page ---\n\n${r.extra}` : r.text, dishPhoto: null });
    d.photos = photos; const pw = photoWarning(photos); if (pw) d.warnings = [...d.warnings, pw];
    return r.pages >= 6 ? { ...d, warnings: [...d.warnings, warn('recipe', 'Only the first 6 pages were read.', Severity.INFO)] } : d;
  }
  /** A PDF made by a browser can carry a damaged text layer ("Southern \"ied Chicken", "Di!iculty"): if so, read the pages by OCR and use that when it is as complete. */
  async preferCleanText(file, r, onStatus) {
    if (!Text.looksGarbled(r.text)) return r;
    try {
      onStatus('Checking the text against the page picture…');
      const o = await this.ocr.recognizePdf(file, { forceOcr: true });
      if (o.text.trim().length >= r.text.trim().length * 0.6) return o;
    } catch { /* keep the text layer */ }
    return r;
  }
  async fromFile(f, onStatus) {
    const mime = f.mime || f.file.type || ''; const name = (f.file.name || '').toLowerCase();
    if (mime === 'application/pdf' || name.endsWith('.pdf')) return this.fromPdf(f.file, onStatus);
    if (mime.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/.test(name)) return this.fromImages([f.file], onStatus);
    if (f.file.size > 5_000_000) throw new ImportFailure('That file is too large.');
    if (mime.includes('html') || name.endsWith('.html') || name.endsWith('.htm')) { const html = await f.file.text(); return this.withSource(Web.extract(html, null), { kind: 'WEB', text: pageText(html) }); }
    if (mime.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md')) { const t = await f.file.text(); return this.withSource(Text.parse(t), { kind: 'TEXT', text: t.slice(0, 2_000_000) }); }
    throw new ImportFailure("This file type isn't supported yet. Supported: PDF, images, text and web pages.");
  }
}
