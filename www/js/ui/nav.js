// Port of the NavHost in ui/Root.kt: a simple route stack with a short fade (none when motion is reduced).
import { h } from './dom.js';

export const Routes = {
  SPLASH: 'splash', HUB: 'hub', COLLECTION: 'collection', DETAIL: 'detail', COOK: 'cook', IMPORT: 'import', REVIEW: 'review',
  PLANNER: 'planner', GROCERY: 'grocery', DRAWER: 'drawer', SETTINGS: 'settings', CATEGORIES: 'categories', BACKUP: 'backup',
  THEMES: 'themes', HELP: 'help', TOOLS: 'tools', PRINT: 'print', RESCUE: 'rescue', UNFINISHED: 'unfinished', ORIGINAL: 'original',
};

export class Nav {
  constructor(host, routes, ctx) { this.host = host; this.routes = routes; this.ctx = ctx; this.stack = []; this.cur = null; this.busy = false; }
  get current() { return this.stack[this.stack.length - 1] ?? null; }
  get canGoBack() { return this.stack.length > 1; }
  _show(entry, dir) {
    const reduced = document.documentElement.dataset.reduced === '1';
    const old = this.cur;
    const factory = this.routes[entry.name];
    if (!factory) throw new Error('No route ' + entry.name);
    const screen = factory(entry.params || {}, this.ctx, this);
    const wrap = h('div', { class: 'screen' }, screen.el);
    if (!reduced) wrap.classList.add('enter');
    this.host.append(wrap);
    this.cur = { wrap, screen };
    if (old) {
      const drop = () => { try { old.screen.destroy?.(); } catch (e) { console.error(e); } old.wrap.remove(); };
      if (reduced) drop(); else { old.wrap.classList.add('leave'); setTimeout(drop, 170); }
    }
    document.dispatchEvent(new CustomEvent('route', { detail: entry }));
  }
  go(name, params = {}, opts = {}) {
    const entry = { name, params };
    if (opts.replace) this.stack[this.stack.length - 1] = entry; else if (opts.root) this.stack = [entry]; else {
      const top = this.current;
      if (opts.single && top && top.name === name) { return; }
      this.stack.push(entry);
    }
    this._show(entry, 1);
  }
  back() { if (this.stack.length > 1) { this.stack.pop(); this._show(this.current, -1); return true; } return false; }
  /** navigate(route) { popUpTo(target) }: drops everything above `target`, then shows the new route. */
  goPopUpTo(name, params, target) {
    while (this.stack.length > 1 && this.current.name !== target) this.stack.pop();
    const entry = { name, params }; this.stack.push(entry); this._show(entry, 1);
  }
  /** Like goBackOr(route) in Kotlin. */
  backOr(name, params = {}) { if (!this.back()) this.go(name, params, { root: true }); }
  /** Pops until the given route name (used to leave Review back to the previous list). */
  popTo(name) { while (this.stack.length > 1 && this.current.name !== name) this.stack.pop(); this._show(this.current, -1); }
}
