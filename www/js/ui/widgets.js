// Port of ui/components/*: snackbar (top, with Undo), bottom sheets, dialogs, buttons, chips, FitText,
// the photo image with a safe placeholder and EditableRows (drag handles, move up/down, delete with undo).
import { h, mount } from './dom.js';
import { newId } from '../engine/models.js';

// ---------- snackbar: shown at the top, over the pages' decorative title space ----------
let snackHost = null;
export function initSnack(root) { snackHost = h('div', { class: 'snack-host', 'aria-live': 'polite' }); root.append(snackHost); }
let snackTimer = null;
export function say(message, { action = null, onAction = null, ms = 3800 } = {}) {
  if (!snackHost) return;
  clearTimeout(snackTimer);
  mount(snackHost, h('div', { class: 'snack', role: 'status', 'data-testid': 'snack' },
    h('span', { class: 'snack-text' }, message),
    action ? h('button', { class: 'snack-action', type: 'button', onclick: () => { clearTimeout(snackTimer); mount(snackHost); onAction && onAction(); } }, action) : null));
  snackTimer = setTimeout(() => mount(snackHost), ms);
}
export const undoable = (message, onUndo) => say(message, { action: 'Undo', onAction: onUndo, ms: 6500 });

// ---------- overlays ----------
let overlayHost = null;
export function initOverlays(root) { overlayHost = h('div', { class: 'overlay-host' }); root.append(overlayHost); }

/** Modal bottom sheet. content: Node or (close)=>Node. Returns { close, el }. */
export function sheet({ content, onDismiss, tall = false, label = '' }) {
  const prev = document.activeElement;
  const back = h('div', { class: 'sheet-backdrop' });
  const grab = h('div', { class: 'sheet-grab', 'aria-hidden': 'true' });
  const body = h('div', { class: 'sheet-body' });
  const panel = h('div', { class: 'sheet' + (tall ? ' tall' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, grab, body);
  const wrap = h('div', { class: 'sheet-wrap' }, back, panel);
  let closed = false;
  const close = (dismissed = true) => {
    if (closed) return; closed = true;
    panel.classList.add('out'); back.classList.add('out');
    setTimeout(() => { wrap.remove(); try { prev?.focus?.(); } catch { /* ignore */ } }, 180);
    if (dismissed && onDismiss) onDismiss();
  };
  back.addEventListener('click', () => close());
  // drag the grabber down to dismiss
  let sy = null;
  grab.addEventListener('touchstart', (e) => { sy = e.touches[0].clientY; }, { passive: true });
  grab.addEventListener('touchmove', (e) => { if (sy != null) { const d = Math.max(0, e.touches[0].clientY - sy); panel.style.transform = `translateY(${d}px)`; } }, { passive: true });
  grab.addEventListener('touchend', (e) => { if (sy != null) { const d = (e.changedTouches[0].clientY - sy); sy = null; if (d > 90) close(); else panel.style.transform = ''; } });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  const node = typeof content === 'function' ? content(close) : content;
  body.append(node);
  overlayHost.append(wrap);
  requestAnimationFrame(() => { panel.classList.add('in'); back.classList.add('in'); const f = panel.querySelector('input,textarea,select,button'); if (f && !tall) { /* leave focus to the user; avoids a surprise keyboard */ } });
  return { close, el: panel, body };
}

export function dialog({ title, text, confirm = 'OK', cancel = 'Cancel', destructive = false, onConfirm, onCancel, content = null, noCancel = false, dismissable = true }) {
  const back = h('div', { class: 'dialog-backdrop' });
  let wrap;
  const close = () => wrap.remove();
  const box = h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2', { class: 'dialog-title' }, title),
    content || h('div', { class: 'dialog-text' }, ...String(text || '').split('\n').map((l) => h('p', null, l))),
    h('div', { class: 'dialog-actions' },
      noCancel ? null : h('button', { class: 'text-btn', type: 'button', onclick: () => { close(); onCancel && onCancel(); } }, cancel),
      confirm ? h('button', { class: 'text-btn' + (destructive ? ' danger' : ''), type: 'button', 'data-testid': 'dialog-confirm', onclick: () => { close(); onConfirm && onConfirm(); } }, confirm) : null));
  wrap = h('div', { class: 'dialog-wrap' }, back, box);
  if (dismissable) back.addEventListener('click', () => { close(); onCancel && onCancel(); });
  overlayHost.append(wrap);
  return { close };
}
export const confirmDialog = (title, text, confirm, onConfirm, destructive = false) => dialog({ title, text, confirm, destructive, onConfirm });

// ---------- controls ----------
export const bigButton = (label, onClick, { primary = true, disabled = false, cls = '', testid = null } = {}) =>
  h('button', { class: `big-btn ${primary ? 'primary' : 'outline'} ${cls}`, type: 'button', disabled, onclick: onClick, 'data-testid': testid }, label);
export const textButton = (label, onClick, cls = '') => h('button', { class: `text-btn ${cls}`, type: 'button', onclick: onClick }, label);

export function chip(label, selected, onClick, extra = {}) {
  return h('button', { class: 'chip' + (selected ? ' selected' : ''), type: 'button', 'aria-pressed': String(!!selected), onclick: onClick, ...extra }, selected ? `✓ ${label}` : label);
}
export const backChip = (onClick) => h('button', { class: 'back-chip', type: 'button', 'aria-label': 'Back', 'data-testid': 'back-chip', onclick: onClick }, '←');
export const iconBtn = (label, glyph, onClick, cls = '') => h('button', { class: `icon-btn ${cls}`, type: 'button', 'aria-label': label, onclick: onClick }, glyph);

/** Text that shrinks (down to minScale) to stay inside a fixed artwork region instead of clipping. */
export function fitText(text, { minScale = 0.55, cls = '', style = '', lines = 1 } = {}) {
  const el = h('div', { class: 'fit ' + cls, style }, text);
  if (lines > 1) Object.assign(el.style, { whiteSpace: 'normal', display: '-webkit-box', webkitLineClamp: String(lines), webkitBoxOrient: 'vertical', overflow: 'hidden' });
  const fit = () => {
    if (!el.isConnected) return;
    let scale = 1, n = 0;
    const base = parseFloat(getComputedStyle(el).fontSize);
    const over = () => (lines > 1 ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1);
    while (over() && scale > minScale && n++ < 20) { scale = Math.max(minScale, scale * 0.9); el.style.fontSize = `${base * scale}px`; }
  };
  requestAnimationFrame(() => requestAnimationFrame(fit));
  return el;
}

/** Recipe photo with a safe placeholder: missing or unreadable files never break layout. */
export function photoImg(photos, name, { fallback = '', cls = '', alt = '' } = {}) {
  const box = h('div', { class: 'photo ' + cls, role: alt ? 'img' : null, 'aria-label': alt || null },
    h('span', { class: 'photo-fallback' }, (fallback.trim()[0] || '✦').toUpperCase()));
  if (name) photos.url(name).then((u) => { if (u) { box.textContent = ''; box.append(h('img', { src: u, alt: '', draggable: 'false' })); } }).catch(() => {});
  return box;
}

// ---------- EditableRows ----------
/**
 * rows: [{id,text,header}] ; callbacks onRows(newRows) onDelete(row,index). Returns {el, focusLast()}.
 * Drag handle reorders (pointer events); the up/down buttons and Enter-to-add-next-row serve everyone else.
 */
export function editableRows({ rows, onRows, onDelete, numbered = false, hint, showErrors = false, newRow, tag = 'rows', compact = false, fontSize = null, lineHeight = null }) {
  const list = h('div', { class: 'rows' + (compact ? ' compact' : ''), 'data-testid': tag });
  const state = { rows };
  let focusId = null;
  const set = (r) => { state.rows = r; onRows(r); render(); };
  const move = (from, to) => { if (from === to || to < 0 || to >= state.rows.length) return; const r = [...state.rows]; const [x] = r.splice(from, 1); r.splice(to, 0, x); set(r); };
  function render() {
    let n = 0;
    const kids = state.rows.map((row, index) => {
      const num = row.header ? 0 : ++n;
      const invalid = showErrors && !row.text.trim();
      const input = h('input', {
        class: 'row-input' + (row.header ? ' header' : ''), type: 'text', value: row.text, style: fontSize ? `font-size:${fontSize};${lineHeight ? 'line-height:' + lineHeight : ''}` : null, autocapitalize: 'sentences', enterkeyhint: 'next',
        placeholder: invalid ? `${hint} (can't be empty)` : hint, 'aria-label': (numbered ? `Step ${num}` : `Item ${index + 1}`) + (row.header ? ', section title' : ''), 'data-row': String(index),
        oninput: (e) => { state.rows[index] = { ...state.rows[index], text: e.target.value }; onRows(state.rows); },
        onkeydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (index === state.rows.length - 1) { const nr = newRow(); focusId = nr.id; set([...state.rows, nr]); } else list.querySelectorAll('.row-input')[index + 1]?.focus(); }
        },
      });
      const handle = h('div', { class: 'row-handle', role: 'button', tabindex: '0', 'aria-label': 'Reorder handle. Drag, or use the arrow buttons.',
        onkeydown: (e) => { if (e.key === 'ArrowUp') { e.preventDefault(); move(index, index - 1); } if (e.key === 'ArrowDown') { e.preventDefault(); move(index, index + 1); } } }, '⠿');
      handle.addEventListener('pointerdown', (e) => startDrag(e, index, rowEl));
      const rowEl = h('div', { class: 'row-item' + (invalid ? ' invalid' : ''), 'data-testid': `${tag}:row:${index}`, 'data-id': row.id },
        handle,
        numbered && !row.header ? h('div', { class: 'row-num' }, String(num)) : null,
        input,
        h('div', { class: 'row-moves' },
          h('button', { class: 'mini', type: 'button', 'aria-label': 'Move up', disabled: index === 0, onclick: () => move(index, index - 1) }, '▲'),
          h('button', { class: 'mini', type: 'button', 'aria-label': 'Move down', disabled: index === state.rows.length - 1, onclick: () => move(index, index + 1) }, '▼')),
        h('button', { class: 'row-del', type: 'button', 'aria-label': `Delete ${numbered ? 'step ' + num : 'item ' + (index + 1)}`, onclick: () => onDelete(row, index) }, '−'));
      return rowEl;
    });
    mount(list, kids);
    if (focusId) { const i = state.rows.findIndex((r) => r.id === focusId); focusId = null; if (i >= 0) { const inp = list.querySelectorAll('.row-input')[i]; inp?.focus(); inp?.scrollIntoView({ block: 'nearest' }); } }
  }
  function startDrag(e, index, rowEl) {
    e.preventDefault();
    const items = [...list.children];
    const rects = items.map((el) => el.getBoundingClientRect());
    const startY = e.clientY;
    let to = index;
    rowEl.classList.add('dragging');
    const onMove = (ev) => {
      const dy = ev.clientY - startY;
      rowEl.style.transform = `translateY(${dy}px)`;
      const cy = rects[index].top + rects[index].height / 2 + dy;
      to = rects.findIndex((r) => cy >= r.top && cy <= r.bottom);
      if (to < 0) to = cy < rects[0].top ? 0 : rects.length - 1;
    };
    const end = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); rowEl.classList.remove('dragging'); rowEl.style.transform = ''; if (to !== index) move(index, to); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  }
  render();
  return { el: list, setRows(r) { state.rows = r; render(); }, get rows() { return state.rows; }, focusLast() { const i = list.querySelectorAll('.row-input'); i[i.length - 1]?.focus(); } };
}
export const EditRow = (text = '', header = false) => ({ id: newId(), text, header });

/** Full-height editor for ingredient/direction lists: add, edit, delete with undo, reorder, auto-renumber. */
export function rowsEditorSheet({ title, initial, hint, numbered, allowHeaders = false, note = null, onSave }) {
  let rows = initial.length ? initial : [EditRow('')];
  let showErrors = false;
  let ed;
  const snackSlot = h('div', { class: 'sheet-snack' });
  const flash = (msg, undo) => { mount(snackSlot, h('div', { class: 'snack' }, h('span', { class: 'snack-text' }, msg), undo ? h('button', { class: 'snack-action', type: 'button', onclick: () => { mount(snackSlot); undo(); } }, 'Undo') : null)); setTimeout(() => mount(snackSlot), 5000); };
  const build = (close) => {
    const make = () => editableRows({ rows, hint, numbered, showErrors, newRow: () => EditRow(''), tag: 'editor-rows',
      onRows: (r) => { rows = r; },
      onDelete: (row, index) => { const before = rows; rows = rows.filter((x) => x.id !== row.id); ed.setRows(rows); flash(`Removed line ${index + 1}`, () => { rows = before; ed.setRows(rows); }); } });
    ed = make();
    const scroller = h('div', { class: 'sheet-scroll' }, ed.el);
    return h('div', { class: 'sheet-col' },
      h('h2', { class: 'sheet-title' }, title),
      note ? h('p', { class: 'sheet-note' }, note) : null,
      scroller, snackSlot,
      h('div', { class: 'sheet-row' },
        bigButton(numbered ? 'Add step' : 'Add line', () => { rows = [...rows, EditRow('')]; ed.setRows(rows); ed.focusLast(); }, { primary: false }),
        allowHeaders ? bigButton('Add section', () => { rows = [...rows, EditRow('', true)]; ed.setRows(rows); ed.focusLast(); }, { primary: false }) : null),
      h('div', { class: 'sheet-row' },
        bigButton('Cancel', () => close(), { primary: false }),
        bigButton('Save', () => {
          const cleaned = rows.filter((r) => r.text.trim());
          if (cleaned.length !== rows.length && !showErrors) { showErrors = true; ed.el.replaceWith((ed = make()).el); flash('Empty lines are marked. Save again to remove them.'); }
          else { onSave(cleaned); close(false); }
        }, { testid: 'editor-save' })));
  };
  return sheet({ content: build, tall: true, label: title });
}

export function menu(anchor, items) {
  const back = h('div', { class: 'menu-backdrop' });
  const box = h('div', { class: 'menu', role: 'menu' }, items.map((it) => h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onclick: () => { wrap.remove(); it.onClick(); } }, it.label)));
  const wrap = h('div', { class: 'menu-wrap' }, back, box);
  back.addEventListener('click', () => wrap.remove());
  overlayHost.append(wrap);
  const r = anchor.getBoundingClientRect();
  box.style.top = `${Math.min(r.bottom + 4, window.innerHeight - box.offsetHeight - 12)}px`;
  box.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  return { close: () => wrap.remove() };
}
