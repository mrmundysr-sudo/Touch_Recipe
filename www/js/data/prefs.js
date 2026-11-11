// Port of data/Prefs.kt: small, privacy-conscious preference store (local only, included in backups, no identifiers).
import { decodeTimers, encodeTimers } from '../engine/timer.js';

export const ThemeMode = ['SYSTEM', 'LIGHT', 'DARK', 'GARDEN', 'HARVEST', 'BERRY'];
export const MotionPref = ['SYSTEM', 'REDUCED'];
export const TextSize = { NORMAL: { scale: 1.0, label: 'Normal' }, LARGE: { scale: 1.2, label: 'Large' }, XLARGE: { scale: 1.4, label: 'Extra large' } };

export class MemoryStorage { constructor() { this.m = new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } key(i) { return [...this.m.keys()][i] ?? null; } get length() { return this.m.size; } }

export class Prefs {
  constructor(storage = globalThis.localStorage) {
    this.sp = storage ?? new MemoryStorage(); this.subs = new Set();
    this._timers = decodeTimers(this.sp.getItem('kitchen_timers'));
  }
  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  _emit() { this.subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); }
  _str(k, d) { try { return this.sp.getItem(k) ?? d; } catch { return d; } }
  _bool(k, d) { const v = this._str(k, null); return v == null ? d : v === 'true'; }
  _set(k, v) { try { this.sp.setItem(k, String(v)); } catch { /* storage unavailable */ } this._emit(); }

  get theme() { const v = this._str('theme', 'SYSTEM'); return ThemeMode.includes(v) ? v : 'SYSTEM'; }
  setTheme(m) { this._set('theme', m); }
  get textSize() { const v = this._str('text_size', 'LARGE'); return TextSize[v] ? v : 'LARGE'; }
  setTextSize(t) { this._set('text_size', t); }
  get glowGuide() { return this._bool('glow', true); }
  setGlowGuide(v) { this._set('glow', v); }
  get motion() { const v = this._str('motion', 'SYSTEM'); return MotionPref.includes(v) ? v : 'SYSTEM'; }
  setMotion(m) { this._set('motion', m); }
  get keepAwake() { return this._bool('keep_awake', true); }
  setKeepAwake(v) { this._set('keep_awake', v); }
  get sundayStart() { return this._bool('sunday_start', false); }
  setSundayStart(v) { this._set('sunday_start', v); }
  get timerVibrate() { return this._bool('vibrate', true); }
  setTimerVibrate(v) { this._set('vibrate', v); }

  get timers() { return this._timers; }
  saveTimers(list) { this._timers = list; this._set('kitchen_timers', encodeTimers(list)); }

  get welcomeSeen() { return this._bool('welcome_seen', false); }
  set welcomeSeen(v) { this._set('welcome_seen', v); }
  get notifAsked() { return this._bool('notif_asked', false); }
  set notifAsked(v) { this._set('notif_asked', v); }
  get sortOrder() { return this._str('sort', 'RECENT'); }
  set sortOrder(v) { this._set('sort', v); }

  glowPlays(page) { return parseInt(this._str('glow_' + page, '0'), 10) || 0; }
  markGlowPlayed(page) { try { this.sp.setItem('glow_' + page, String(this.glowPlays(page) + 1)); } catch { /* ignore */ } }
  resetGlow() {
    try { const ks = []; for (let i = 0; i < this.sp.length; i++) ks.push(this.sp.key(i)); ks.filter((k) => k && k.startsWith('glow_')).forEach((k) => this.sp.removeItem(k)); } catch { /* ignore */ }
    this.welcomeSeen = false;
  }
  exportable() {
    return { theme: this.theme, text_size: this.textSize, glow: String(this.glowGuide), motion: this.motion, keep_awake: String(this.keepAwake), sunday_start: String(this.sundayStart), vibrate: String(this.timerVibrate) };
  }
  restore(m) {
    if (m.theme && ThemeMode.includes(m.theme)) this.setTheme(m.theme);
    if (m.text_size && TextSize[m.text_size]) this.setTextSize(m.text_size);
    if (m.glow != null) this.setGlowGuide(m.glow === 'true');
    if (m.motion && MotionPref.includes(m.motion)) this.setMotion(m.motion);
    if (m.keep_awake != null) this.setKeepAwake(m.keep_awake === 'true');
    if (m.sunday_start != null) this.setSundayStart(m.sunday_start === 'true');
    if (m.vibrate != null) this.setTimerVibrate(m.vibrate === 'true');
  }
}
