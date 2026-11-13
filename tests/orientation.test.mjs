// Recipe Rescue may turn sideways; every other screen stays portrait. The web side asks the native app; the native side is patched in by tools/patch_ios.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { allowLandscape, isWideScreen } from '../www/js/ui/orientation.js';

test('wide screens (a phone on its side, a tablet) get the side-by-side layout; an upright phone does not', () => {
  assert.equal(isWideScreen(390, 844), false, 'iPhone upright');
  assert.equal(isWideScreen(430, 932), false, 'large iPhone upright');
  assert.equal(isWideScreen(844, 390), true, 'iPhone on its side');
  assert.equal(isWideScreen(932, 430), true, 'large iPhone on its side');
  assert.equal(isWideScreen(1024, 768), true, 'tablet');
  assert.equal(isWideScreen(820, 1180), true, 'tablet upright is still wide enough');
  assert.equal(isWideScreen(500, 400), false, 'a small landscape window is too narrow for two panes');
});

test('allowLandscape asks the native bridge, tells whether it answered, and never throws', async () => {
  assert.equal(await allowLandscape(true), false, 'no native app (a plain browser): nothing happens');
  const asked = [];
  globalThis.Capacitor = { isPluginAvailable: () => true, Plugins: { TouchRecipeOcr: { setOrientation: async (a) => { asked.push(a.landscape); } } } };
  try {
    assert.equal(await allowLandscape(true), true); assert.equal(await allowLandscape(false), true);
    assert.deepEqual(asked, [true, false]);
    globalThis.Capacitor.Plugins.TouchRecipeOcr.setOrientation = async () => { throw new Error('native failed'); };
    assert.equal(await allowLandscape(true), false, 'a failing native call is swallowed');
  } finally { delete globalThis.Capacitor; }
});

test('the native patch declares landscape but answers "portrait only" unless Recipe Rescue asked, and can force portrait back', () => {
  const py = fs.readFileSync(new URL('../tools/patch_ios.py', import.meta.url), 'utf8');
  assert.match(py, /UISupportedInterfaceOrientations"\] = \["UIInterfaceOrientationPortrait", "UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"\]/);
  assert.match(py, /static var allowLandscape = false/, 'portrait is the default');
  assert.match(py, /override var supportedInterfaceOrientations[\s\S]*?allowLandscape \? \[\.portrait, \.landscapeLeft, \.landscapeRight\] : \.portrait/);
  assert.match(py, /CAPPluginMethod\(name: "setOrientation"/);
  assert.match(py, /requestGeometryUpdate\(\.iOS\(interfaceOrientations: \.portrait\)\)/, 'leaving the screen turns the phone upright again (iOS 16+)');
  assert.match(py, /setNeedsUpdateOfSupportedInterfaceOrientations/);
  assert.match(py, /attemptRotationToDeviceOrientation/, 'older iOS versions');
  // only the Rescue screen asks for landscape
  const users = fs.readdirSync(new URL('../www/js', import.meta.url), { recursive: true }).filter((f) => f.endsWith('.js')).filter((f) => /allowLandscape\(/.test(fs.readFileSync(new URL('../www/js/' + f, import.meta.url), 'utf8'))).sort();
  assert.deepEqual(users, ['screens/rescue.js', 'ui/orientation.js'], 'no other screen asks for landscape');
});
