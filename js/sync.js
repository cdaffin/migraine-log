// Server-side copy of the log, kept in Netlify Blobs behind /api/log.
//
// IndexedDB stays the working store: a tap writes locally first and always
// succeeds, so logging works with no signal and never waits on a round trip.
// This module pushes those local changes up and pulls the shared log down, so
// the data outlives the browser it was typed into.
const Sync = (() => {
  const PENDING_DELETES_KEY = "migraine-log.pendingDeletes";

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
  }

  // Deletes that couldn't reach the server are replayed later — otherwise the
  // next pull would resurrect an entry the user already removed.
  function pendingDeletes() {
    try { return JSON.parse(safeGet(PENDING_DELETES_KEY) || "[]"); } catch { return []; }
  }
  function setPendingDeletes(ids) {
    safeSet(PENDING_DELETES_KEY, JSON.stringify(ids));
  }
  function queueDelete(id) {
    const ids = pendingDeletes();
    if (!ids.includes(id)) { ids.push(id); setPendingDeletes(ids); }
  }
  function unqueueDelete(id) {
    setPendingDeletes(pendingDeletes().filter((x) => x !== id));
  }

  class AuthError extends Error {}

  async function api(method, body) {
    const res = await fetch("/api/log", {
      method,
      headers: {
        "content-type": "application/json",
        "x-log-pass": Lock.passphrase(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 || res.status === 503) {
      const detail = await res.json().catch(() => ({}));
      throw new AuthError(detail.error || "Not authorized");
    }
    if (!res.ok) throw new Error(`Sync failed (${res.status})`);
    return res.json();
  }

  async function push(entry) {
    await api("POST", { op: "upsert", entry });
  }

  async function remove(id) {
    try {
      await api("POST", { op: "delete", id });
      unqueueDelete(id);
    } catch (err) {
      queueDelete(id);
      throw err;
    }
  }

  async function pull() {
    const { entries } = await api("GET");
    return Array.isArray(entries) ? entries : [];
  }

  async function importAll(entries) {
    if (entries.length) await api("POST", { op: "import", entries });
  }

  async function flushDeletes() {
    for (const id of pendingDeletes()) {
      try {
        await api("POST", { op: "delete", id });
        unqueueDelete(id);
      } catch {
        break; // still offline or unauthorized; try again next time
      }
    }
  }

  return { push, remove, pull, importAll, flushDeletes, queueDelete, AuthError };
})();
