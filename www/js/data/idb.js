// IndexedDB backend: the app state as one JSON document plus a blob store for photos. Local only.
const DB = 'touch-recipe', VERSION = 1;
function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const wrap = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

export class IdbBackend {
  constructor() { this.dbp = open(); }
  async store(name, mode = 'readonly') { return (await this.dbp).transaction(name, mode).objectStore(name); }
  async load() { return (await wrap((await this.store('kv')).get('state'))) ?? null; }
  async save(state) { return wrap((await this.store('kv', 'readwrite')).put(JSON.parse(JSON.stringify(state)), 'state')); }
  async putPhoto(name, blob) { return wrap((await this.store('photos', 'readwrite')).put(blob, name)); }
  async getPhoto(name) { return wrap((await this.store('photos')).get(name)); }
  async deletePhoto(name) { return wrap((await this.store('photos', 'readwrite')).delete(name)); }
  async photoNames() { return wrap((await this.store('photos')).getAllKeys()); }
  async clearPhotos() { return wrap((await this.store('photos', 'readwrite')).clear()); }
}
