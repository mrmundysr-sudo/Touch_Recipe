// Touch Recipe to Touch Recipe sharing (docs/SHARE_APP_TO_APP_PLAN.md): choose recipes -> one .touchrecipe file -> the normal share sheet;
// receiving shows a preview first and asks about every duplicate. Nothing is saved until the person taps Add.
import { h, mount } from '../ui/dom.js';
import { sheet, bigButton, textButton, say, undoable, photoImg } from '../ui/widgets.js';
import { saveFile, BackupException } from '../data/backup.js';
import { buildShare, parseShare, importShared, classify, SHARE_EXT } from '../data/share.js';
import { pickFile } from '../ui/shared.js';
import { plugin } from '../data/native.js';

const msgOf = (e) => (e instanceof BackupException ? e.message : "That didn't work. Nothing was changed.");
const mgrArgs = (ctx) => ({ repo: ctx.repo, photos: ctx.photos, appVersion: ctx.appInfo?.version ?? '' });

/** The "Send to another Touch Recipe user" sheet: a checklist, then one file through the share sheet. */
export function sendSheet(ctx) {
  const recipes = ctx.repo.recipes().sort((a, b) => (a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1));
  sheet({ label: 'Send recipes to another Touch Recipe user', tall: true, content: (close) => {
    const chosen = new Set(); const list = h('div', { class: 'sh-list', 'data-testid': 'send-list' }); const status = h('p', { class: 'sheet-note', 'aria-live': 'polite', 'data-testid': 'send-status' });
    const go = bigButton('Send', async () => {
      go.disabled = true;
      try { const s = await buildShare(mgrArgs(ctx), recipes.filter((r) => chosen.has(r.id)).map((r) => r.id)); await saveFile(s.name, s.bytes, 'application/octet-stream'); close(false); say(`${s.count} recipe${s.count === 1 ? '' : 's'} ready to send`); }
      catch (e) { if (!/cancel/i.test(String(e?.message))) status.textContent = msgOf(e); }
      draw();
    }, { testid: 'send-go' });
    const draw = () => {
      mount(list, recipes.map((r) => { const on = chosen.has(r.id);
        const row = h('button', { class: 'sh-row' + (on ? ' on' : ''), type: 'button', role: 'checkbox', 'aria-checked': String(on), 'data-testid': 'send-row', onclick: () => { on ? chosen.delete(r.id) : chosen.add(r.id); draw(); } },
          h('span', { class: 'sh-box', 'aria-hidden': 'true' }, on ? '✓' : ''), h('span', { class: 'sh-title' }, r.title.trim() || 'Untitled recipe'));
        return row; }));
      go.disabled = chosen.size === 0; go.textContent = chosen.size ? `Send ${chosen.size} recipe${chosen.size === 1 ? '' : 's'}` : 'Choose recipes to send';
    };
    draw();
    return h('div', { class: 'sheet-col' }, h('h2', { class: 'sheet-title' }, 'Send to another Touch Recipe user'),
      h('p', { class: 'sheet-note' }, 'Choose one or more recipes. They arrive exactly as they are here, with their photos, and your own recipes are not changed.'),
      h('div', { class: 'sheet-row' }, textButton('Select all', () => { recipes.forEach((r) => chosen.add(r.id)); draw(); }), textButton('Select none', () => { chosen.clear(); draw(); })),
      list, status, h('div', { class: 'sheet-row' }, bigButton('Cancel', () => close(), { primary: false }), go));
  } });
}

/** Opens a received file (bytes): preview, ask about duplicates, then add. */
export async function receiveShare(ctx, bytes) {
  let parsed;
  try { parsed = await parseShare(bytes); } catch (e) { say(msgOf(e), { ms: 6500 }); return false; }
  const rows = classify(parsed.recipes, ctx.repo.recipes()); const dups = rows.filter((r) => r.dup);
  const choice = new Map(dups.map((r) => [r.recipe.id, 'skip']));
  const nNew = rows.length - dups.length;
  sheet({ label: 'Add shared recipes', tall: true, content: (close) => {
    const list = h('div', { class: 'sh-list', 'data-testid': 'receive-list' });
    const OPTS = [['skip', 'Skip'], ['copy', 'Keep both'], ['replace', 'Replace mine']];
    const photoEl = (r) => (r.photo && parsed.photoData.has(r.photo) ? h('img', { class: 'sh-thumb', alt: '', src: URL.createObjectURL(new Blob([parsed.photoData.get(r.photo)], { type: 'image/jpeg' })) }) : null);
    const draw = () => mount(list, rows.map(({ recipe, dup }) => h('div', { class: 'sh-item', 'data-testid': dup ? 'receive-dup' : 'receive-new' }, photoEl(recipe),
      h('div', { class: 'sh-main' }, h('div', { class: 'sh-title' }, recipe.title || 'Untitled recipe'),
        h('div', { class: 'sh-sub' }, dup ? 'You already have this recipe' : 'New to you'),
        dup ? h('div', { class: 'chips', role: 'radiogroup', 'aria-label': `What to do with ${recipe.title}` }, ...OPTS.map(([k, label]) => h('button', { class: 'chip' + (choice.get(recipe.id) === k ? ' selected' : ''), type: 'button', role: 'radio', 'aria-checked': String(choice.get(recipe.id) === k), 'data-testid': `dup-${k}`, onclick: () => { choice.set(recipe.id, k); draw(); } }, choice.get(recipe.id) === k ? `✓ ${label}` : label))) : null))));
    draw();
    const all = dups.length > 1 ? h('div', { class: 'sheet-row' }, h('span', { class: 'sheet-note', style: 'flex:1' }, 'For all the duplicates:'), ...OPTS.map(([k, l]) => textButton(l, () => { dups.forEach((d) => choice.set(d.recipe.id, k)); draw(); }))) : null;
    const add = bigButton('Add', async () => {
      add.disabled = true;
      try {
        const r = await importShared(ctx, parsed, choice); close(false);
        const bits = [r.added - r.copied && `${r.added - r.copied} added`, r.copied && `${r.copied} kept as copies`, r.replaced && `${r.replaced} replaced`, r.skipped && `${r.skipped} skipped`].filter(Boolean);
        r.added || r.replaced ? undoable(bits.join(', '), () => r.undo()) : say(bits.join(', ') || 'Nothing was added');
      } catch (e) { add.disabled = false; say(msgOf(e), { ms: 6500 }); }
    }, { testid: 'receive-add' });
    return h('div', { class: 'sheet-col' }, h('h2', { class: 'sheet-title' }, `Add ${rows.length} shared recipe${rows.length === 1 ? '' : 's'}?`),
      h('p', { class: 'sheet-note', 'data-testid': 'receive-summary' }, `${nNew} new${dups.length ? `, ${dups.length} already here` : ''}. Nothing is changed until you tap Add.`), all, list,
      h('div', { class: 'sheet-row' }, bigButton('Not now', () => close(), { primary: false }), add));
  } });
  return true;
}

/** "Open a shared recipe file" from inside the app. */
export async function openSharedFileFromPicker(ctx) {
  const f = await pickFile({ accept: `.${SHARE_EXT},.zip,application/octet-stream` }); if (!f) return;
  await receiveShare(ctx, new Uint8Array(await f.arrayBuffer()));
}

/** Files opened from Messages / AirDrop / Files arrive as a URL from the system; read them with the Filesystem plugin. */
export function listenForOpenedFiles(ctx) {
  const app = plugin('App'), fs = plugin('Filesystem'); if (!app?.addListener || !fs) return;
  app.addListener('appUrlOpen', async ({ url }) => {
    if (!url || !/\.(touchrecipe)(\?|$)/i.test(url)) return;
    try { const r = await fs.readFile({ path: url }); const bin = atob(typeof r.data === 'string' ? r.data : ''); const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0)); await receiveShare(ctx, bytes); }
    catch { say("That file couldn't be opened. Nothing was changed.", { ms: 6500 }); }
  });
}
