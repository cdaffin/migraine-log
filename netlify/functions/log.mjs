import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

// The server-side copy of the log, held in one Netlify Blob and gated by the
// passphrase in the LOG_PASSWORD environment variable (set in the Netlify
// dashboard, never in the repo). Every request must carry a matching
// x-log-pass header, which is what keeps anyone who finds the URL out.
const STORE = "migraine-log";
const KEY = "entries";
const MAX_BODY = 4 * 1024 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Constant-time passphrase check. Returns null when OK, or an error response.
function checkPass(req) {
  const expected = process.env.LOG_PASSWORD;
  if (!expected) {
    return json({ error: "LOG_PASSWORD isn't set on the server yet." }, 503);
  }
  const given = req.headers.get("x-log-pass") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // Length is checked first because timingSafeEqual throws on a mismatch. The
  // early return leaks length only, never content.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return json({ error: "Wrong passphrase." }, 401);
  }
  return null;
}

function store() {
  return getStore({ name: STORE, consistency: "strong" });
}

async function readEntries(s) {
  const data = await s.get(KEY, { type: "json" });
  return data && Array.isArray(data.entries) ? data.entries : [];
}

// Last write wins, decided by the entry's own updatedAt rather than arrival
// order — two devices syncing out of order still converge on the newer edit.
function upsert(entries, incoming) {
  const i = entries.findIndex((e) => e.id === incoming.id);
  if (i === -1) {
    entries.push(incoming);
    return entries;
  }
  const existing = entries[i];
  if ((incoming.updatedAt || "") >= (existing.updatedAt || "")) entries[i] = incoming;
  return entries;
}

export default async (req) => {
  const authErr = checkPass(req);
  if (authErr) return authErr;

  const s = store();

  if (req.method === "GET") {
    return json({ entries: await readEntries(s) });
  }

  if (req.method === "POST") {
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ error: "Payload too large" }, 413);

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    let entries = await readEntries(s);

    switch (body.op) {
      case "upsert":
        if (!body.entry || !body.entry.id) return json({ error: "Missing entry" }, 400);
        entries = upsert(entries, body.entry);
        break;

      case "delete":
        if (!body.id) return json({ error: "Missing id" }, 400);
        entries = entries.filter((e) => e.id !== body.id);
        break;

      case "import": {
        // Bulk merge, used once per device to seed the server from whatever is
        // already in that browser. Deduped by id, so re-running is harmless.
        if (!Array.isArray(body.entries)) return json({ error: "Missing entries" }, 400);
        for (const entry of body.entries) {
          if (entry && entry.id) entries = upsert(entries, entry);
        }
        break;
      }

      default:
        return json({ error: "Unknown op" }, 400);
    }

    await s.setJSON(KEY, { entries });
    return json({ ok: true, count: entries.length });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/log" };
