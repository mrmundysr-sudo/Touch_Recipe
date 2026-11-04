// Port of data/ImportService.kt + Fetcher.kt + Ocr.kt. All import paths produce a draft; nothing is saved here.
// Network access happens only for URL imports the user asked for. Recognition runs on the device (Apple Vision) via a
// tiny native bridge; when it is missing (e.g. in a desktop browser) scanning explains that and offers Paste or Type.
import * as Text from '../engine/textparser.js';
import * as Web from '../engine/webextract.js';
import { ImportMethod, Confidence, Severity, warn } from '../engine/models.js';

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
  async recognizePdf(blob) {
    const p = plugin('TouchRecipeOcr');
    if (!p) throw new OcrUnavailable("Text recognition isn't available on this device.");
    try { const r = await p.recognizePdf({ pdf: await blobToB64(blob), maxPages: 6 }); return { text: r.text || '', pages: r.pages || 0 }; } catch { throw new OcrUnavailable("That PDF could not be read."); }
  }
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
  constructor({ fetcher = new HttpPageFetcher(), ocr = new VisionOcr(), photos } = {}) { this.fetcher = fetcher; this.ocr = ocr; this.photos = photos; }

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
      case 'text': return Text.parse(input.text);
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
      return { ...draft, recipe: { ...draft.recipe, sourceUrl: draft.recipe.sourceUrl ?? r.finalUrl } };
    }
    if (r.kind === 'blocked') throw new ImportFailure(`${r.message} Open the page in your browser, copy the recipe text, and use Paste or Type Recipe — your original link will be kept if you paste it in the source field.`, { blocked: true });
    throw new ImportFailure(r.message, { retryable: true, offline: !!r.offline });
  }
  /** Downloads the first usable image candidate into private storage; returns the stored file name. */
  async fetchPhoto(candidates) {
    for (const c of candidates.slice(0, 3)) { const b = await this.fetcher.fetchBytes(c); if (b) { const n = await this.photos.saveBlob(b); if (n) return n; } }
    return null;
  }
  ocrDraft(text) {
    if (!text.trim()) throw new ImportFailure('No text could be found. Try a sharper, well-lit photo, or use Paste or Type Recipe.', { retryable: true });
    return Text.parse(text, ImportMethod.OCR);
  }
  async fromImages(files, onStatus) {
    const parts = [];
    for (let i = 0; i < files.length; i++) {
      onStatus(`Reading text from the photo${files.length > 1 ? ` ${i + 1} of ${files.length}` : ''}…`);
      let img; try { img = await prepareImage(files[i]); } catch { throw new ImportFailure('That image could not be opened.'); }
      try { parts.push(await this.ocr.recognizeImage(img)); } catch (e) { if (e instanceof OcrUnavailable) throw new ImportFailure((e.message || 'Text recognition failed.') + ' You can still use Paste or Type Recipe.', { retryable: true }); throw e; }
    }
    return this.ocrDraft(parts.join('\n\n'));
  }
  async fromPdf(file, onStatus) {
    onStatus('Opening the PDF…');
    let r;
    try { onStatus('Reading the PDF…'); r = await this.ocr.recognizePdf(file); } catch (e) { throw new ImportFailure((e.message || 'That PDF could not be opened.') + ' You can still use Paste or Type Recipe.', { retryable: true }); }
    const d = this.ocrDraft(r.text);
    return r.pages >= 6 ? { ...d, warnings: [...d.warnings, warn('recipe', 'Only the first 6 pages were read.', Severity.INFO)] } : d;
  }
  async fromFile(f, onStatus) {
    const mime = f.mime || f.file.type || ''; const name = (f.file.name || '').toLowerCase();
    if (mime === 'application/pdf' || name.endsWith('.pdf')) return this.fromPdf(f.file, onStatus);
    if (mime.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/.test(name)) return this.fromImages([f.file], onStatus);
    if (f.file.size > 5_000_000) throw new ImportFailure('That file is too large.');
    if (mime.includes('html') || name.endsWith('.html') || name.endsWith('.htm')) return Web.extract(await f.file.text(), null);
    if (mime.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md')) return Text.parse(await f.file.text());
    throw new ImportFailure("This file type isn't supported yet. Supported: PDF, images, text and web pages.");
  }
}
