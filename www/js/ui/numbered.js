// A plain numbered-list editor for the ingredients and the steps of Recipe Rescue, made for repairing a badly imported section quickly.
//  - every entry has its own number (1, 2, 3 ...); ingredients and steps are numbered separately (two lists);
//  - Pasting keeps ALL the pasted text in the entry it goes into (line breaks become spaces); nothing is split at sentences, lines or guessed boundaries;
//  - Enter anywhere inside an entry splits it at that exact cursor position: the text after the cursor becomes a new entry with the next number
//    (a selected stretch of text is replaced by the break);
//  - Backspace at the very start of an entry joins it to the end of the entry above and its number goes (Delete at the very end joins the next one);
//  - Select entries -> Delete / Replace with text; Replace all: remove a bad section, paste the right text as ONE entry, add the breaks where they belong;
//  - Undo reverses each split, join, paste, delete or replace on its own step: what was typed before is taken in as a separate step first.
// The row logic is plain functions on arrays of { id, text } so it can be tested without a browser.
import { h } from './dom.js';
import { newId } from '../engine/models.js';
import { isHeadingText } from '../engine/rescue.js';

const trimEnd = (t) => t.replace(/\s+$/, '');
const trimStart = (t) => t.replace(/^\s+/, '');
const joinText = (a, b) => (a.trim() && b.trim() ? `${trimEnd(a)} ${trimStart(b)}` : a + b);
/** Pasted text goes in as ONE piece: only the line breaks (and tabs) become spaces. Everything else is kept exactly. */
export const oneEntry = (text) => String(text).replace(/\s*[\r\n]+\s*/g, ' ').replace(/\t/g, ' ');

/** Enter: the text before the cursor stays, the text after it becomes the next numbered entry, the cursor goes to its start. */
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
/** Paste `text` over the selection start..end of entry i: all of it goes into this one entry. */
export function pasteInto(rows, i, start, end, text) {
  const piece = oneEntry(text); if (!piece) return null;
  const t = rows[i].text; const before = t.slice(0, start), after = t.slice(end); const out = rows.slice();
  out[i] = { ...rows[i], text: before + piece + after };
  return { rows: out, focus: { row: i, caret: (before + piece).length } };
}
/** Removes the entries whose ids are in `ids`. The cursor goes to the entry that took the first one's place. */
export function removeRows(rows, ids) {
  const first = rows.findIndex((r) => ids.has(r.id)); if (first < 0) return null;
  const out = rows.filter((r) => !ids.has(r.id));
  return { rows: out, focus: out.length ? { row: Math.min(first, out.length - 1), caret: 0 } : null };
}
/** Replaces the entries whose ids are in `ids` with ONE entry holding `text`, placed where the first of them was. */
export function replaceRows(rows, ids, text) {
  const first = rows.findIndex((r) => ids.has(r.id)); if (first < 0) return null;
  const piece = oneEntry(text).trim(); const out = []; let placed = false;
  rows.forEach((r) => { if (ids.has(r.id)) { if (!placed) { placed = true; if (piece) out.push({ id: r.id, text: piece }); } } else out.push(r); });
  const row = Math.min(first, out.length - 1);
  return { rows: out, focus: out.length ? { row, caret: out[row] ? out[row].text.length : 0 } : null };
}

/**
 * The editor. `rows`: [{ id, text }]. `onChange(rows)` is called after a pause in typing and at once after every split, join, paste, delete or replace, and on leaving the list.
 * `review(text)` may return a short reason to show under an entry. `ask({ title, hint, ok, onOk })` opens a box to paste text (for Replace). `notify(label)` may offer an Undo.
 * `onUndo` / `onRedo` serve Ctrl/Cmd+Z. `onCaret({ row, caret })` reports where the cursor is. `focus` puts the cursor in an entry when the list is drawn. Returns { el, commit, destroy }.
 */
export function numberedList({ rows, label, testid, placeholder = '', onChange, review = null, ask = null, notify = null, onUndo = null, onRedo = null, onCaret = null, focus = null }) {
  let list = rows.length ? rows.map((r) => ({ ...r })) : [{ id: newId(), text: '' }];
  const el = h('div', { class: 'nl', 'data-testid': testid });
  const tools = h('div', { class: 'nl-tools', 'data-testid': `${testid}-tools` });
  const body = h('div', { class: 'nl-rows' });
  el.append(tools, body);
  let timer = null, selecting = false, picked = new Set(), parts = [];
  const commit = () => { clearTimeout(timer); timer = null; onChange(list.map((r) => ({ id: r.id, text: r.text }))); };
  const later = () => { clearTimeout(timer); timer = setTimeout(commit, 400); };
  const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
  /** One structural change = one Undo step: whatever was typed before is taken in first, as a step of its own. */
  const change = (res, note = null) => {
    if (!res) return;
    commit(); list = res.rows.length ? res.rows : [{ id: newId(), text: '' }]; picked = new Set([...picked].filter((id) => list.some((r) => r.id === id)));
    commit(); draw(res.focus); if (note && notify) notify(note);
  };

  /** Numbers follow the text as it is typed: a line that ends with a colon is a heading and has no number. */
  function renumber() {
    let n = 0;
    parts.forEach(({ r, row, num, ta }) => {
      const heading = isHeadingText(r.text);
      row.classList.toggle('heading', heading); num.textContent = heading ? '' : `${++n}.`;
      ta.setAttribute('aria-label', heading ? `${label} heading` : `${label} ${n}`);
    });
  }
  function drawTools() {
    const btn = (text, onClick, { disabled = false, testid: t = null } = {}) => { const b = h('button', { class: 'nl-btn', type: 'button', disabled, 'data-testid': t }, text); b.addEventListener('click', onClick); return b; };
    const nPicked = picked.size;
    const buttons = !selecting ? [
      btn('Select entries', () => { selecting = true; picked = new Set(); draw(); }, { testid: `${testid}-select` }),
      btn('Replace all…', () => replaceAll(), { testid: `${testid}-replace-all` }),
    ] : [
      btn('Select all', () => { picked = new Set(list.map((r) => r.id)); draw(); }, { testid: `${testid}-select-all` }),
      btn(nPicked ? `Delete ${nPicked}` : 'Delete', () => change(removeRows(list, picked), 'Deleted'), { disabled: !nPicked, testid: `${testid}-delete` }),
      btn('Replace with text…', () => replaceSelected(), { disabled: !nPicked, testid: `${testid}-replace` }),
      btn('Done', () => { selecting = false; picked = new Set(); draw(); }, { testid: `${testid}-done` }),
    ];
    tools.textContent = ''; tools.append(...buttons);
  }
  function replaceSelected() {
    if (!picked.size || !ask) return;
    const ids = new Set(picked);
    ask({ title: `Replace ${ids.size === 1 ? 'this entry' : `these ${ids.size} entries`}`, hint: 'Paste the right text. It goes in as one entry; press Enter to break it up.', ok: 'Replace', onOk: (text) => { selecting = false; picked = new Set(); change(replaceRows(list, ids, text), 'Replaced'); } });
  }
  function replaceAll() {
    if (!ask) return;
    const ids = new Set(list.map((r) => r.id));
    ask({ title: 'Replace everything', hint: 'Paste the right text. It goes in as one entry; press Enter to break it up.', ok: 'Replace', onOk: (text) => change(replaceRows(list, ids, text) ?? { rows: [{ id: newId(), text: oneEntry(text).trim() }], focus: { row: 0, caret: 0 } }, 'Replaced') });
  }

  function draw(at = null) {
    body.textContent = ''; parts = []; drawTools();
    list.forEach((r, i) => {
      const ta = h('textarea', { class: 'nl-text', rows: '1', placeholder: i === 0 && !r.text ? placeholder : '', 'data-testid': `${testid}-text`, spellcheck: 'true', autocapitalize: 'sentences' });
      ta.value = r.text;
      const note = h('div', { class: 'nl-note', 'data-testid': 'review-note', hidden: true });
      const num = h('div', { class: 'nl-num', 'aria-hidden': 'true', 'data-testid': `${testid}-num` });
      const pick = selecting ? h('input', { type: 'checkbox', class: 'nl-pick', checked: picked.has(r.id), 'aria-label': `Select entry ${i + 1}`, 'data-testid': `${testid}-pick` }) : null;
      if (pick) pick.addEventListener('change', () => { pick.checked ? picked.add(r.id) : picked.delete(r.id); row.classList.toggle('picked', pick.checked); drawTools(); });
      const row = h('div', { class: `nl-row${selecting && picked.has(r.id) ? ' picked' : ''}`, 'data-testid': `${testid}-row` }, pick, num, h('div', { class: 'nl-body' }, ta, note));
      const flag = () => { const why = review && !isHeadingText(ta.value) ? review(ta.value) : null; note.hidden = !why; note.textContent = why ? `Check this line: ${why}.` : ''; row.classList.toggle('review', !!why); };
      const where = () => { if (onCaret) onCaret({ row: parts.findIndex((p) => p.ta === ta), caret: ta.selectionStart }); };
      ta.addEventListener('input', () => { r.text = ta.value; grow(ta); renumber(); flag(); later(); where(); });
      ['focus', 'click', 'keyup', 'select'].forEach((ev) => ta.addEventListener(ev, where));
      ta.addEventListener('keydown', (e) => {
        if (e.isComposing) return;
        const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
        if (mod && ['z', 'Z', 'y', 'Y'].includes(e.key)) { const redo = e.key === 'y' || e.key === 'Y' || e.shiftKey; const f = redo ? onRedo : onUndo; if (f) { e.preventDefault(); commit(); f(); } return; }
        const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0, atEnd = ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length;
        if (e.key === 'Enter' && !mod) { e.preventDefault(); change(splitRow(list, i, ta.selectionStart, ta.selectionEnd)); }
        else if (e.key === 'Backspace' && atStart && i > 0) { e.preventDefault(); change(mergeUp(list, i)); }
        else if (e.key === 'Delete' && atEnd && i < list.length - 1) { e.preventDefault(); change(mergeDown(list, i)); }
      });
      ta.addEventListener('paste', (e) => {
        const text = e.clipboardData && e.clipboardData.getData('text'); if (!text) return;
        e.preventDefault(); change(pasteInto(list, i, ta.selectionStart, ta.selectionEnd, text));
      });
      ta.addEventListener('blur', () => {
        commit();
        setTimeout(() => {   // leaving the whole list: drop the empty entries (always keep one to type in)
          if (selecting || el.contains(document.activeElement) || !el.isConnected) return;
          const kept = list.filter((x) => x.text.trim()); if (kept.length === list.length) return;
          list = kept.length ? kept : [{ id: newId(), text: '' }]; draw();
        }, 0);
      });
      parts.push({ r, row, num, ta }); body.append(row); flag();
      requestAnimationFrame(() => grow(ta));
    });
    renumber();
    if (at) { const i = Math.max(0, Math.min(at.row, list.length - 1)); const ta = parts[i] && parts[i].ta; if (ta) { ta.focus(); const c = Math.max(0, Math.min(at.caret ?? 0, ta.value.length)); try { ta.setSelectionRange(c, c); } catch { /* ignore */ } } }
  }
  draw(focus);
  return { el, commit, destroy: () => { clearTimeout(timer); timer = null; } };
}
