// Port of core/timer/CookTimer.kt and NamedTimers.kt. Wall-clock based so timers survive leaving the screen or app.
import { newId } from './models.js';

export const CookTimer = (totalMs = 0, remainingMs = 0, endAtMs = null) => ({ totalMs, remainingMs, endAtMs });
export const timerRunning = (t) => t.endAtMs != null;
export const timerConfigured = (t) => t.totalMs > 0;
export const remaining = (t, now) => (t.endAtMs != null ? Math.max(0, t.endAtMs - now) : t.remainingMs);
export const finished = (t, now) => timerConfigured(t) && remaining(t, now) === 0 && (t.endAtMs != null || t.remainingMs === 0);
export function start(t, now) {
  if (!timerConfigured(t)) return t;
  const left = t.remainingMs <= 0 ? t.totalMs : t.remainingMs;
  return { ...t, remainingMs: left, endAtMs: now + left };
}
export const pause = (t, now) => (t.endAtMs == null ? t : { ...t, remainingMs: remaining(t, now), endAtMs: null });
export const reset = (t) => ({ ...t, remainingMs: t.totalMs, endAtMs: null });
export const withDuration = (seconds) => (seconds == null || seconds <= 0 ? CookTimer() : CookTimer(seconds * 1000, seconds * 1000, null));
export function formatMs(ms) {
  const total = Math.floor((ms + 999) / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

export const MAX_TIMERS = 10;
export const NamedTimer = (o) => ({ id: newId(), name: '', totalMs: 0, remainingMs: o.totalMs ?? 0, endAtMs: null, ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) });
export const namedTimerClock = (n) => CookTimer(n.totalMs, n.remainingMs, n.endAtMs);
export const withClock = (n, t) => ({ ...n, totalMs: t.totalMs, remainingMs: t.remainingMs, endAtMs: t.endAtMs });
export const isDone = (n, now) => n.endAtMs != null && remaining(namedTimerClock(n), now) === 0;
export function defaultName(existing) {
  let i = 1;
  while (existing.some((t) => t.name.toLowerCase() === `timer ${i}`)) i++;
  return `Timer ${i}`;
}
export function addTimer(list, name, minutes, now, startNow = true) {
  if (list.length >= MAX_TIMERS || minutes <= 0) return list;
  const base = NamedTimer({ name: name.trim().slice(0, 40) || defaultName(list), totalMs: minutes * 60000 });
  return [...list, startNow ? withClock(base, start(namedTimerClock(base), now)) : base];
}
export function settle(list, now) {
  const done = list.filter((t) => isDone(t, now));
  if (!done.length) return [list, []];
  return [list.map((t) => (isDone(t, now) ? { ...t, remainingMs: 0, endAtMs: null } : t)), done];
}
export const decodeTimers = (text) => { if (!text || !text.trim()) return []; try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; } };
export const encodeTimers = (list) => JSON.stringify(list);
