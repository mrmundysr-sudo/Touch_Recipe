// A plain numbered-list editor for the ingredients and the steps of Recipe Rescue.
//  - every entry has its own number (1, 2, 3 ...), shown beside it;
//  - Enter in the middle of an entry starts a NEW entry: the text after the cursor moves into it and it gets the next number;
//  - Backspace at the very start of an entry joins it to the entry above and its number disappears (Delete at the very end does the same with the next one);
//  - pasting several lines makes one entry per line (list marks and "1." numbers are removed, the numbering is automatic).
// The row logic is plain functions on arrays of { id, text } so it can be tested without a browser.
import { h } from './dom.js';
import { newId } from '../engine/models.js';
import { isHeadingText } from '../engine/rescue.js';

const trimEnd = (t) => t.replace(/\s+$/, '');
const trimStart = (t) => t.replace(/^\s+/, '');
const joinText = (a, b) => (a.trim() && b.trim() ? `${trimEnd(a)} ${trimStart(b)}` : a + b);

/** Enter: the text before the cursor stays, the text after it becomes the next entry. */
export function splitRow(rows, i, start, end = start) {
  const t = rows[i].text; const out = rows.slice();
  out.splice(i, 1, { ...rows[i], text: trimEnd(t.slice(0, start)) }, { id: newId(), text: trimStart(t.slice(end)) });
  return { rows: out, focus: { row: i + 1, caret: 0 } };
}
/** Backspace at the start of entry i: it joins the entry above; the cursor sits at the join. Null when there is nothing above. */
export function mergeUp(rows, i) {
  if (i <= 0) return null;
  const prev = rows[i - 1].text; const out = rows.slice();
  out.splice(i - 1, 2, { ...rows[i - 1], text: joinText(prev, rows[i].text) });
  return { rows: out, focus: { row: i - 1, caret: trimEnd(prev).length } };
}
/** Delete at the end of entry i: the entry below joins it. Null when there is nothing below. */
export function mergeDown(rows, i) {
  if (i >= rows.length - 1) return null;
  const cur = rows[i].text; const out = rows.slice();
  out.splice(i, 2, { ...rows[i], text: joinText(cur, rows[i + 1].text) });
  return { rows: out, focus: { row: i, caret: trimEnd(cur).length } };
}
/** Paste `lines` (already cleaned) over the selection start..end of entry i. One line goes into the entry; more lines make new entries. */
export function pasteInto(rows, i, start, end, lines) {
  if (!lines.length) return null;
  const t = rows[i].text; const before = t.slice(0, start), after = t.slice(end); const out = rows.slice();
  if (lines.length === 1) { out[i] = { ...rows[i], text: before + lines[0] + after }; return { rows: out, focus: { row: i, caret: (before + lines[0]).length } }; }
  const made = lines.slice(1).map((l, k) => ({ id: newId(), text: k === lines.length - 2 ? l + after : l }));
  out.splice(i, 1, { ...rows[i], text: before + lines[0] }, ...made);
  return { rows: out, focus: { row: i + made.length, caret: lines[lines.length - 1].length } };
}

/**
 * The editor. `rows`: [{ id, text }]. `clean(text)` turns pasted text into lines. `onChange(rows)` is called after a pause, after Enter / joins / paste, and on leaving
 * the list. `review(text)` may return a short reason to show under an entry. Returns { el, commit, destroy }.
 */
export function numberedList({ rows, label, testid, placeholder = '', clean, onChange, review = null }) {
  let list = rows.length ? rows.map((r) => ({ ...r })) : [{ id: newId(), text: '' }];
  const el = h('div', { class: 'nl', 'data-testid': testid });
  let timer = null;
  const commit = () => { clearTimeout(timer); timer = null; onChange(list.map((r) => ({ id: r.id, text: r.text }))); };
  const later = () => { clearTimeout(timer); timer = setTimeout(commit, 400); };
  const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
  const apply = (res) => { list = res.rows; commit(); draw(res.focus); };

  let parts = [];
  /** Numbers follow the text as it is typed: a line that ends with a colon is a heading and has no number. */
  function renumber() {
    let n = 0;
    parts.forEach(({ r, row, num, ta }) => {
      const heading = isHeadingText(r.text);
      row.classList.toggle('heading', heading); num.textContent = heading ? '' : `${++n}.`;
      ta.setAttribute('aria-label', heading ? `${label} heading` : `${label} ${n}`);
    });
  }
  function draw(focus = null) {
    el.textContent = ''; parts = [];
    list.forEach((r, i) => {
      const ta = h('textarea', { class: 'nl-text', rows: '1', placeholder: i === 0 && !r.text ? placeholder : '', 'data-testid': `${testid}-text`, spellcheck: 'true', autocapitalize: 'sentences' });
      ta.value = r.text;
      const note = h('div', { class: 'nl-note', 'data-testid': 'review-note', hidden: true });
      const num = h('div', { class: 'nl-num', 'aria-hidden': 'true', 'data-testid': `${testid}-num` });
      const row = h('div', { class: 'nl-row', 'data-testid': `${testid}-row` }, num, h('div', { class: 'nl-body' }, ta, note));
      const flag = () => { const why = review && !isHeadingText(ta.value) ? review(ta.value) : null; note.hidden = !why; note.textContent = why ? `Check this line: ${why}.` : ''; row.classList.toggle('review', !!why); };
      ta.addEventListener('input', () => { r.text = ta.value; grow(ta); renumber(); flag(); later(); });
      ta.addEventListener('keydown', (e) => {
        if (e.isComposing) return;
        const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0, atEnd = ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length;
        if (e.key === 'Enter') { e.preventDefault(); apply(splitRow(list, i, ta.selectionStart, ta.selectionEnd)); }
        else if (e.key === 'Backspace' && atStart && i > 0) { e.preventDefault(); apply(mergeUp(list, i)); }
        else if (e.key === 'Delete' && atEnd && i < list.length - 1) { e.preventDefault(); apply(mergeDown(list, i)); }
      });
      ta.addEventListener('paste', (e) => {
        const text = e.clipboardData && e.clipboardData.getData('text'); if (!text) return;
        const lines = clean(text); if (!lines.length) return;
        e.preventDefault(); apply(pasteInto(list, i, ta.selectionStart, ta.selectionEnd, lines));
      });
      ta.addEventListener('blur', () => {
        commit();
        setTimeout(() => {   // leaving the whole list: drop the empty entries (always keep one to type in)
          if (el.contains(document.activeElement) || !el.isConnected) return;
          const kept = list.filter((x) => x.text.trim()); if (kept.length === list.length) return;
          list = kept.length ? kept : [{ id: newId(), text: '' }]; draw();
        }, 0);
      });
      parts.push({ r, row, num, ta }); el.append(row); flag();
      requestAnimationFrame(() => grow(ta));
      if (focus && focus.row === i) { ta.focus(); try { ta.setSelectionRange(focus.caret, focus.caret); } catch { /* ignore */ } }
    });
    renumber();
  }
  draw();
  return { el, commit, destroy: () => { clearTimeout(timer); timer = null; } };
}
