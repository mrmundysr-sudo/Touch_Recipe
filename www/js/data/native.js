// Access to Capacitor native plugins. Returns null in a plain browser, so every feature degrades gracefully.
export const cap = () => globalThis.Capacitor;
export const isNative = () => !!cap()?.isNativePlatform?.();
export function plugin(name) {
  const c = cap();
  if (!c) return null;
  try {
    if (c.isPluginAvailable && !c.isPluginAvailable(name)) return null;
    return c.Plugins?.[name] ?? c.registerPlugin?.(name) ?? null;
  } catch { return null; }
}
