// IndexedDB wrapper — a single "attacks" store, keyed by id and indexed by
// date so the history list comes back in order.
const DB = (() => {
  const DB_NAME = "MigraineLogDB";
  const DB_VERSION = 1;

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("attacks")) {
          const store = db.createObjectStore("attacks", { keyPath: "id" });
          store.createIndex("date", "date");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function store(mode) {
    return openDB().then((db) => db.transaction("attacks", mode).objectStore("attacks"));
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    // Insert or replace — the log button inserts, editing severity/notes and
    // the offline weather backfill both replace.
    async put(entry) {
      const s = await store("readwrite");
      await reqToPromise(s.put(entry));
    },

    async get(id) {
      const s = await store("readonly");
      return reqToPromise(s.get(id));
    },

    async remove(id) {
      const s = await store("readwrite");
      await reqToPromise(s.delete(id));
    },

    // Newest first.
    async all() {
      const s = await store("readonly");
      const all = await reqToPromise(s.getAll());
      return all.sort((a, b) => new Date(b.date) - new Date(a.date));
    },
  };
})();
