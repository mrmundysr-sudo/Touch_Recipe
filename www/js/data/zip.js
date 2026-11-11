// Minimal ZIP writer/reader (stored + deflate) so backups use the same container as the Android app. No dependencies.
const te = new TextEncoder(), td = new TextDecoder();
let crcTable = null;
export function crc32(bytes) {
  if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
}
const u16 = (v, n) => { v.push(n & 255, (n >>> 8) & 255); };
const u32 = (v, n) => { v.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255); };

/** entries: [{name, data: Uint8Array|string}] -> Uint8Array (stored, no compression: photos are already JPEG). */
export function zip(entries) {
  const chunks = [], central = []; let offset = 0;
  for (const e of entries) {
    const name = te.encode(e.name), data = typeof e.data === 'string' ? te.encode(e.data) : e.data, crc = crc32(data);
    const h = []; u32(h, 0x04034b50); u16(h, 20); u16(h, 0x0800); u16(h, 0); u16(h, 0); u16(h, 0x21); u32(h, crc); u32(h, data.length); u32(h, data.length); u16(h, name.length); u16(h, 0);
    chunks.push(new Uint8Array(h), name, data);
    const c = []; u32(c, 0x02014b50); u16(c, 20); u16(c, 20); u16(c, 0x0800); u16(c, 0); u16(c, 0); u16(c, 0x21); u32(c, crc); u32(c, data.length); u32(c, data.length); u16(c, name.length); u16(c, 0); u16(c, 0); u16(c, 0); u16(c, 0); u32(c, 0); u32(c, offset);
    central.push(new Uint8Array(c), name);
    offset += h.length + name.length + data.length;
  }
  const cdStart = offset; let cdSize = 0; for (const p of central) cdSize += p.length;
  const end = []; u32(end, 0x06054b50); u16(end, 0); u16(end, 0); u16(end, entries.length); u16(end, entries.length); u32(end, cdSize); u32(end, cdStart); u16(end, 0);
  const all = [...chunks, ...central, new Uint8Array(end)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** -> [{name, data: Uint8Array}] ; throws on a malformed archive. */
export async function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1; for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('not a zip');
  const count = dv.getUint16(end + 10, true); let p = dv.getUint32(end + 16, true);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad central directory');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = td.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    const lnlen = dv.getUint16(lho + 26, true), lxlen = dv.getUint16(lho + 28, true), start = lho + 30 + lnlen + lxlen;
    const raw = bytes.subarray(start, start + csize);
    if (name.endsWith('/')) continue;
    out.push({ name, data: method === 0 ? raw : method === 8 ? await inflateRaw(raw) : (() => { throw new Error('unsupported compression'); })() });
  }
  return out;
}
