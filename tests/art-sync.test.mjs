import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('iOS art matches the Android art byte for byte', () => {
  const a = path.join(root, 'app/src/main/assets/art');
  const w = path.join(root, 'www/art');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)).map((f) => path.join(e.name, f)) : [e.name]);
  const files = walk(a);
  assert.ok(files.length > 20);
  for (const f of files) assert.ok(fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(w, f))), f);
});
