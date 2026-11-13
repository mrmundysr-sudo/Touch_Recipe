// Shared HTML access for the importers: the parser is injected (DOMParser in the app, linkedom in tests), and the DOM helpers
// below behave like jsoup's, which the Android importer was written against.
let parseHtml = (html) => new DOMParser().parseFromString(html, 'text/html');
export const setHtmlParser = (fn) => { parseHtml = fn; };
export const parse = (html) => parseHtml(html);

export const BLOCK = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL', 'TBODY', 'THEAD', 'TFOOT', 'CAPTION', 'DETAILS', 'MENU', 'CENTER']);
/** jsoup-style text(): whitespace normalised and trimmed, block elements separated by a space. */
export function elText(node) {
  const walk = (n) => {
    if (n.nodeType === 3) return n.nodeValue;
    if (n.nodeType === 9 || n.nodeType === 11) return [...n.childNodes].map(walk).join('');
    if (n.nodeType !== 1) return '';
    const tag = n.tagName.toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE') return '';
    const inner = [...n.childNodes].map(walk).join('');
    return BLOCK.has(tag) ? ` ${inner} ` : inner;
  };
  return walk(node).replace(/\s+/g, ' ').trim();
}

export const tagOf = (el) => el.tagName.toLowerCase();
export const attrOf = (el, name) => el?.getAttribute?.(name) ?? '';
export const kids = (el) => [...el.children];
export const parentsOf = (el) => { const out = []; let p = el.parentElement; while (p) { out.push(p); p = p.parentElement; } return out; };
export const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('');
/** jsoup's Element.select: the element itself counts when it matches, then its descendants in document order. */
export const select = (el, css) => [...(el.matches && el.matches(css) ? [el] : []), ...el.querySelectorAll(css)];
export const isBlock = (el) => BLOCK.has(el.tagName.toUpperCase());
/** Text of an HTML fragment with <br>, </p>, </div> and </li> turned into line breaks, one entry per non-empty line. */
export function htmlLines(html) {
  const doc = parseHtml(html.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n'));
  return (doc.body ?? doc).textContent.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
