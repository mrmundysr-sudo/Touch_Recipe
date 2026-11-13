// A plain, continuously scrolling page for the functional screens (Recipe Rescue, Unfinished Recipes, Original, and the scrolling
// Detail/Cook/Grocery/Review pages). Everything is real text and real buttons; no artwork is needed to use it. Each page exposes
// named art slots (data-art-slot) where the owner's artwork can later be placed without touching the logic.
import { h } from './dom.js';
import { backChip } from './widgets.js';

export function ScrollPage({ title, onBack, actions = [], slot = null, testid = null }) {
  const body = h('div', { class: 'sp-body', 'data-testid': testid ? `${testid}-body` : null });
  const head = h('div', { class: 'sp-head' }, backChip(onBack), h('h1', { class: 'sp-title', role: 'heading', 'aria-level': '1' }, title), h('div', { class: 'sp-actions' }, ...actions));
  // the action buttons live in `foot`, below the scrolling area, so they never sit on top of the content
  const foot = h('div', { class: 'sp-foot', 'data-testid': testid ? `${testid}-foot` : null });
  const el = h('div', { class: 'sp', 'data-art-slot': slot, 'data-testid': testid, role: 'main', 'aria-label': title }, head, body, foot);
  return { el, body, head, foot, setTitle: (t) => { head.querySelector('.sp-title').textContent = t; el.setAttribute('aria-label', t); }, destroy: null };
}

/** A small titled block inside a scrolling page. */
export const Section = (title, ...kids) => h('section', { class: 'sp-sec' }, title ? h('h2', { class: 'sp-h2' }, title) : null, ...kids);
