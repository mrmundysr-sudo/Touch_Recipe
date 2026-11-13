// One screen (Recipe Rescue) may turn sideways; every other screen stays portrait. The native side (tools/patch_ios.py, MainViewController)
// answers "portrait only" unless this has asked for landscape. In a plain browser there is no native side and nothing happens.
import { plugin } from '../data/native.js';

/** Asks the native app to allow (true) or forbid (false) landscape. Never throws; resolves true when the native side answered. */
export async function allowLandscape(on) {
  try { const p = plugin('TouchRecipeOcr'); if (!p || typeof p.setOrientation !== 'function') return false; await p.setOrientation({ landscape: !!on }); return true; } catch { return false; }
}

/** Wide enough to show the original and the recipe card side by side: a phone on its side, a tablet, a desktop window. */
export const isWideScreen = (width, height) => width >= 760 || (width > height && width >= 560);
