// Port of data/TimerAlarm.kt. Timer alerts use Capacitor's Local Notifications plugin when the app runs natively;
// in a plain browser everything degrades to a no-op, and the in-app "Time's up" dialog still works.
import { plugin, isNative } from './native.js';
const idFor = (key) => { let h = 0; for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % 2147483000 + 1; };

export const notifier = {
  native() { return isNative(); },
  async state() { try { return (await plugin('LocalNotifications').checkPermissions()).display; } catch { return 'unavailable'; } },
  /** True when we should explain notifications before asking (native, not decided yet). */
  async shouldExplain() { if (!this.native()) return false; const s = await this.state(); return s === 'prompt' || s === 'prompt-with-rationale'; },
  async request() { try { return (await plugin('LocalNotifications').requestPermissions()).display; } catch { return 'denied'; } },
  async schedule(key, body, endAtMs, title = 'Timer finished') {
    try {
      const p = plugin('LocalNotifications'); if (!p) return false;
      const id = idFor(key);
      await p.cancel({ notifications: [{ id }] });
      if (endAtMs <= Date.now()) return false;
      await p.schedule({ notifications: [{ id, title, body, schedule: { at: new Date(endAtMs) }, sound: 'default' }] });
      return true;
    } catch { return false; }
  },
  async cancel(key) { try { await plugin('LocalNotifications')?.cancel({ notifications: [{ id: idFor(key) }] }); } catch { /* ignore */ } },
  async buzz() { try { const hp = plugin('Haptics'); if (hp) { await hp.notification({ type: 'SUCCESS' }); setTimeout(() => hp.notification({ type: 'WARNING' }).catch(() => {}), 500); } else navigator.vibrate?.([400, 200, 400]); } catch { /* ignore */ } },
};

/** Keeps the screen on while cooking (Screen Wake Lock API, iOS 16.4+). */
export function keepAwake(on) {
  let lock = null;
  const acquire = async () => { try { if (on && navigator.wakeLock && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen'); } catch { /* ignore */ } };
  const onVis = () => { if (document.visibilityState === 'visible') acquire(); };
  document.addEventListener('visibilitychange', onVis);
  acquire();
  return () => { document.removeEventListener('visibilitychange', onVis); try { lock?.release(); } catch { /* ignore */ } };
}
