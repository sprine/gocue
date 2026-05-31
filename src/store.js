// Persistence layer. Hides IndexedDB entirely: object stores, key paths, the
// transaction dance, and the fact that a cue's decoded buffer/blob must be
// stripped before saving. Callers see plain async methods.

const DB_NAME = 'gocue', VERSION = 1;
const STORES = ['meta', 'audio', 'app'];      // meta+audio keyed by 'id', app keyed by 'k'

const stripCue = c => { const { buffer, blob, ...meta } = c; return meta; };

export class Store {
  /**
   * Always resolves. If IndexedDB is unavailable (e.g. private browsing) it
   * returns a NullStore with the same interface, so callers never special-case
   * the failure — the app just runs without persistence.
   */
  static open() {
    return new Promise(resolve => {
      let req;
      try { req = indexedDB.open(DB_NAME, VERSION); }
      catch { return resolve(new NullStore()); }
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES)
          if (!db.objectStoreNames.contains(s))
            db.createObjectStore(s, { keyPath: s === 'app' ? 'k' : 'id' });
      };
      req.onsuccess = () => resolve(new Store(req.result));
      req.onerror = () => resolve(new NullStore());
    });
  }

  constructor(db) { this.db = db; }

  /** Returns everything needed to rebuild a show: { metas, blobs:Map<id,Blob>, app }. */
  loadAll() {
    return Promise.all([this.#getAll('meta'), this.#getAll('audio'), this.#get('app', 'state')])
      .then(([metas, audios, app]) => ({
        metas, app, blobs: new Map(audios.map(a => [a.id, a.blob])),
      }));
  }

  saveCue(cue) { this.#store('meta', 'readwrite').put(stripCue(cue)); }
  saveAudio(id, blob) { this.#store('audio', 'readwrite').put({ id, blob }); }
  removeCue(id) {
    this.#store('meta', 'readwrite').delete(id);
    this.#store('audio', 'readwrite').delete(id);
  }
  saveApp(app) { this.#store('app', 'readwrite').put({ k: 'state', ...app }); }
  clear() { for (const s of STORES) this.#store(s, 'readwrite').clear(); }

  // ---- internals ----
  #store(name, mode) { return this.db.transaction(name, mode).objectStore(name); }
  #getAll(name) { return new Promise(r => { const q = this.#store(name, 'readonly').getAll(); q.onsuccess = () => r(q.result || []); }); }
  #get(name, key) { return new Promise(r => { const q = this.#store(name, 'readonly').get(key); q.onsuccess = () => r(q.result); }); }
}

/** No-op store used when IndexedDB can't be opened. Same shape, does nothing. */
class NullStore {
  loadAll() { return Promise.resolve({ metas: [], blobs: new Map(), app: null }); }
  saveCue() {} saveAudio() {} removeCue() {} saveApp() {} clear() {}
}
