// Minimal IndexedDB wrapper.
const DB_NAME = 'flashcards';
const DB_VERSION = 1;
export const STORES = ['decks', 'notetypes', 'notes', 'cards', 'revlog', 'media', 'kv'];

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (db.objectStoreNames.contains(s)) continue;
        const keyPath = s === 'media' ? 'name' : s === 'kv' ? 'key' : 'id';
        const store = db.createObjectStore(s, { keyPath });
        if (s === 'revlog') store.createIndex('cid', 'cid');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database is blocked by another tab'));
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(store, range) {
  const db = await open();
  return reqP(db.transaction(store).objectStore(store).getAll(range));
}

export async function get(store, key) {
  const db = await open();
  return reqP(db.transaction(store).objectStore(store).get(key));
}

export async function getAllKeys(store) {
  const db = await open();
  return reqP(db.transaction(store).objectStore(store).getAllKeys());
}

export async function byIndex(store, index, key) {
  const db = await open();
  return reqP(db.transaction(store).objectStore(store).index(index).getAll(key));
}

/**
 * Apply a batch of writes atomically.
 * ops: { put: { store: [records] }, del: { store: [keys] }, clear: [stores] }
 */
export async function commit(ops) {
  const names = new Set([...Object.keys(ops.put || {}), ...Object.keys(ops.del || {}), ...(ops.clear || [])]);
  if (!names.size) return;
  const db = await open();
  const tx = db.transaction([...names], 'readwrite');
  for (const s of ops.clear || []) tx.objectStore(s).clear();
  for (const [s, keys] of Object.entries(ops.del || {})) {
    const os = tx.objectStore(s);
    for (const k of keys) os.delete(k);
  }
  for (const [s, recs] of Object.entries(ops.put || {})) {
    const os = tx.objectStore(s);
    for (const r of recs) os.put(r);
  }
  return done(tx);
}

export async function count(store) {
  const db = await open();
  return reqP(db.transaction(store).objectStore(store).count());
}
