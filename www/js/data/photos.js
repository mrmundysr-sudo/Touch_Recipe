// Port of data/PhotoStore.kt: recipe photos are downscaled and kept in the app's private storage.
import { newId } from '../engine/models.js';

export const MAX_EDGE = 1600, MAX_BYTES = 25 * 1024 * 1024;

export class PhotoStore {
  constructor(backend) { this.backend = backend; this.urls = new Map(); }
  async saveBlob(blob) {
    try {
      if (!blob || blob.size > MAX_BYTES) return null;
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      if (!bmp.width || !bmp.height) return null;
      const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
      if (!out) return null;
      const name = newId() + '.jpg';
      await this.backend.putPhoto(name, out);
      return name;
    } catch { return null; }
  }
  async saveBytes(bytes) { return this.saveBlob(new Blob([bytes])); }
  async blob(name) { return name ? this.backend.getPhoto(name) : null; }
  async exists(name) { return !!(name && (await this.backend.getPhoto(name))); }
  async url(name) {
    if (!name) return null;
    if (this.urls.has(name)) return this.urls.get(name);
    const b = await this.backend.getPhoto(name);
    if (!b) return null;
    const u = URL.createObjectURL(b);
    this.urls.set(name, u);
    return u;
  }
  async delete(name) { if (name) { await this.backend.deletePhoto(name); const u = this.urls.get(name); if (u) { URL.revokeObjectURL(u); this.urls.delete(name); } } }
  async all() { return this.backend.photoNames(); }
  /** Removes photos that no recipe refers to (called at startup). */
  async sweep(referenced) { for (const n of await this.all()) if (!referenced.has(n)) await this.delete(n); }
}
