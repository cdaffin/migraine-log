// Migraine Log — one button. Tapping it stores the moment, then fills in the
// weather for that moment and place. Everything lives in IndexedDB on this
// device; CSV export is the way data gets out.

const state = {
  entries: [],
  location: null,   // { lat, lng, label }
  openId: null,     // entry expanded in the history list
};

const LOCATION_KEY = "migraine-log.location";
// Bumped when an entry gains new weather fields, so entries stored under an
// older shape get re-fetched once instead of staying half-filled forever.
const WEATHER_SCHEMA = 2;
const el = (id) => document.getElementById(id);

// ---------------------------------------------------------------- formatting

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function fmtDayTime(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return `Today, ${fmtTime(iso)}`;
  if (sameDay(d, yesterday)) return `Yesterday, ${fmtTime(iso)}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + `, ${fmtTime(iso)}`;
}

// A 3-hour swing is the number that tends to line up with attacks, so it gets
// words rather than just a signed figure.
function trendLabel(change3h) {
  if (change3h == null) return { text: "—", arrow: "", cls: "" };
  if (change3h <= -2) return { text: "falling fast", arrow: "↓", cls: "trend-down" };
  if (change3h <= -0.7) return { text: "falling", arrow: "↓", cls: "trend-down" };
  if (change3h >= 2) return { text: "rising fast", arrow: "↑", cls: "trend-up" };
  if (change3h >= 0.7) return { text: "rising", arrow: "↑", cls: "trend-up" };
  return { text: "steady", arrow: "→", cls: "trend-flat" };
}

function signed(value, digits) {
  if (value == null) return "—";
  const fixed = Number(value).toFixed(digits);
  return Number(value) > 0 ? `+${fixed}` : fixed;
}

function showToast(message) {
  const toast = el("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 3200);
}

// ------------------------------------------------------------------ location

function loadSavedLocation() {
  try {
    const raw = localStorage.getItem(LOCATION_KEY);
    if (raw) state.location = JSON.parse(raw);
  } catch {
    // A corrupt or blocked localStorage just means we ask for GPS instead.
  }
  renderLocation();
}

function saveLocation(lat, lng, label) {
  state.location = { lat, lng, label: label || `${lat.toFixed(3)}°, ${lng.toFixed(3)}°` };
  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify(state.location));
  } catch {
    // Non-fatal: the location still works for this session.
  }
  renderLocation();
}

function renderLocation() {
  const display = el("location-display");
  if (!state.location) {
    display.textContent = "Not set — uses your device location on the first log.";
    display.classList.add("placeholder");
  } else {
    display.textContent = state.location.label;
    display.classList.remove("placeholder");
  }
}

function getPosition(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

// Best-effort coordinates for a log that's happening right now. A recent
// cached fix is good enough — weather is a hourly, kilometres-wide reading, and
// waiting on a GPS lock while someone has a migraine is the wrong trade. Falls
// back to the saved location whenever the device won't say.
async function resolveLocation({ quick = true } = {}) {
  if (navigator.geolocation) {
    try {
      const pos = await getPosition({
        enableHighAccuracy: false,
        timeout: quick ? 8000 : 15000,
        maximumAge: quick ? 600000 : 60000,
      });
      saveLocation(pos.coords.latitude, pos.coords.longitude);
      return state.location;
    } catch {
      // Denied, unavailable, or timed out — the saved location covers it.
    }
  }
  return state.location;
}

async function useCurrentLocation() {
  const btn = el("btn-use-current");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Locating…";
  try {
    if (!navigator.geolocation) throw new Error("Location isn't available in this browser");
    const pos = await getPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    saveLocation(pos.coords.latitude, pos.coords.longitude);
    showToast("Location set");
    backfillPending();
  } catch (err) {
    const denied = err && err.code === 1;
    showToast(denied
      ? "Location access denied — enable it in Settings, or set a city below"
      : `Couldn't get location (${err.message || "unavailable"}) — try setting a city`);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function searchCity() {
  const query = el("city-input").value.trim();
  if (!query) return;
  const btn = el("btn-city-search");
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", query);
    url.searchParams.set("count", "1");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    const data = await res.json();
    const hit = data.results && data.results[0];
    if (!hit) {
      showToast(`No match for "${query}"`);
      return;
    }
    const label = [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(", ");
    saveLocation(hit.latitude, hit.longitude, label);
    el("city-search").classList.add("hidden");
    el("city-input").value = "";
    showToast(`Location set to ${label}`);
    backfillPending();
  } catch (err) {
    showToast(`Couldn't look that up: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Search";
  }
}

// ------------------------------------------------------------------- logging

async function logMigraine() {
  const btn = el("btn-log");
  btn.disabled = true;
  btn.classList.add("logging");

  const now = new Date();
  const entry = {
    id: crypto.randomUUID(),
    date: now.toISOString(),
    severity: null,
    notes: "",
    weatherStatus: "pending",
  };

  // Saved before the network is touched: the timestamp is the part that can't
  // be recovered later, and weather for a past hour always can be.
  await DB.put(entry);
  state.entries.unshift(entry);
  render();
  el("log-status").textContent = `Logged ${fmtTime(entry.date)} — checking conditions…`;

  try {
    const location = await resolveLocation();
    if (!location) {
      entry.weatherStatus = "no-location";
      await DB.put(entry);
      el("log-status").textContent = `Logged ${fmtTime(entry.date)} — no location yet`;
      showToast("Saved. Set a location below and the weather fills itself in.");
      render();
      return;
    }

    const filled = await attachWeather(entry, location);
    const trend = trendLabel(filled.pressureChange3h);
    el("log-status").textContent = filled.pressureInHg != null
      ? `Logged ${fmtTime(entry.date)} — ${filled.pressureInHg.toFixed(2)} inHg ${trend.text}, ${Math.round(filled.humidity)}% humidity`
      : `Logged ${fmtTime(entry.date)}`;
  } catch (err) {
    entry.weatherStatus = "pending";
    await DB.put(entry);
    el("log-status").textContent = `Logged ${fmtTime(entry.date)} — weather will fill in later`;
    showToast(`Saved. Weather lookup failed (${err.message}) — it'll retry.`);
  } finally {
    btn.disabled = false;
    btn.classList.remove("logging");
    render();
  }
}

// Fetches conditions for an entry's timestamp/place and folds them in. The
// logged hour's reading sits at the top level; the hour 24 hours before it is
// kept whole, alongside, so both stay raw.
async function attachWeather(entry, location) {
  const { reading, prior24h } = await Weather.fetchWeather(
    location.lat, location.lng, new Date(entry.date)
  );
  Object.assign(entry, reading, {
    prior24h,
    latitude: location.lat,
    longitude: location.lng,
    locationLabel: location.label,
    weatherStatus: "ok",
    weatherSchema: WEATHER_SCHEMA,
  });
  // Entries written before the raw pair existed carry a computed 24h delta;
  // the two readings replace it.
  delete entry.pressureChange24h;
  await DB.put(entry);
  const idx = state.entries.findIndex((e) => e.id === entry.id);
  if (idx !== -1) state.entries[idx] = entry;
  return entry;
}

// Anything logged while offline (or before a location existed) gets its
// conditions filled in on the next launch or the next time we come back
// online — as does anything stored before the current set of weather fields,
// which is re-fetched once to pick them up. Open-Meteo keeps ~3 months of
// hourly history, which is the practical limit on how late a backfill can be.
async function backfillPending() {
  const cutoff = Date.now() - 85 * 86400000;
  const pending = state.entries.filter((e) =>
    (e.weatherStatus !== "ok" || e.weatherSchema !== WEATHER_SCHEMA) &&
    new Date(e.date).getTime() > cutoff
  );
  if (!pending.length || !navigator.onLine) return;

  const location = state.location;
  if (!location) return;

  let filled = 0;
  // A handful at a time — a long backlog finishes over a few launches rather
  // than firing dozens of requests at once.
  for (const entry of pending.slice(0, 10)) {
    try {
      const at = entry.latitude != null
        ? { lat: entry.latitude, lng: entry.longitude, label: entry.locationLabel }
        : location;
      await attachWeather(entry, at);
      filled++;
    } catch {
      break; // network is unhappy; try again next launch
    }
  }
  if (filled) {
    render();
    showToast(`Filled in weather for ${filled} earlier ${filled === 1 ? "entry" : "entries"}`);
  }
}

// ------------------------------------------------------------------ entry UI

async function setSeverity(id, value) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  // Tapping the current value again clears it.
  entry.severity = entry.severity === value ? null : value;
  await DB.put(entry);
  render();
}

async function saveNotes(id, text) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry || entry.notes === text) return;
  entry.notes = text;
  await DB.put(entry);
}

async function deleteEntry(id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  if (!confirm(`Delete the entry from ${fmtDayTime(entry.date)}?`)) return;
  await DB.remove(id);
  state.entries = state.entries.filter((e) => e.id !== id);
  if (state.openId === id) state.openId = null;
  render();
  showToast("Entry deleted");
}

async function exportCSV() {
  if (!state.entries.length) {
    showToast("Nothing to export yet");
    return;
  }
  await CSVio.download(state.entries);
}

// ----------------------------------------------------------------- rendering

function cellsHtml(cells) {
  return cells.map(([label, value]) => `
    <div class="reading">
      <span class="reading-label">${label}</span>
      <span class="reading-value">${value}</span>
    </div>`).join("");
}

function pressureCell(reading) {
  return reading.pressureInHg != null
    ? `${reading.pressureInHg.toFixed(2)}<span class="unit"> inHg</span>`
    : "—";
}

function humidityCell(reading) {
  return reading.humidity != null ? `${Math.round(reading.humidity)}<span class="unit">%</span>` : "—";
}

function tempCell(reading) {
  return reading.temperature != null ? `${Math.round(reading.temperature)}<span class="unit">°F</span>` : "—";
}

function readingGrid(entry) {
  if (entry.weatherStatus !== "ok") return "";
  const trend = trendLabel(entry.pressureChange3h);
  return cellsHtml([
    ["Pressure", pressureCell(entry)],
    ["3h trend", `<span class="${trend.cls}">${trend.arrow} ${signed(entry.pressureChange3h, 1)}<span class="unit"> hPa</span></span>`],
    ["Humidity", humidityCell(entry)],
    ["Temp", tempCell(entry)],
    ["Wind", entry.windSpeed != null ? `${entry.windSpeed.toFixed(1)}<span class="unit"> mph</span>` : "—"],
    ["Sky", `${entry.skyIcon || ""} ${esc(entry.skyCondition || "—")}`],
  ]);
}

// The same place, 24 hours earlier — shown as its own reading rather than as a
// change, matching how it's stored and exported.
function priorBlock(entry) {
  if (entry.weatherStatus !== "ok") return "";
  if (!entry.prior24h) {
    return `<p class="hint">No reading available for 24 hours before this one.</p>`;
  }
  const prior = entry.prior24h;
  return `
    <div class="prior-block">
      <span class="section-label">24 hours before</span>
      <div class="reading-grid">${cellsHtml([
        ["Pressure", pressureCell(prior)],
        ["Humidity", humidityCell(prior)],
        ["Temp", tempCell(prior)],
      ])}</div>
    </div>`;
}

function statusNote(entry) {
  if (entry.weatherStatus === "ok") return "";
  if (entry.weatherStatus === "no-location") {
    return "No location set when this was logged — set one below and it fills in.";
  }
  return "Weather pending — fills in automatically next time you're online.";
}

function renderLatest() {
  const card = el("latest-card");
  const latest = state.entries[0];
  if (!latest) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");
  el("latest-when").textContent = fmtDayTime(latest.date);
  el("latest-grid").innerHTML = readingGrid(latest);
  el("latest-prior").innerHTML = priorBlock(latest);

  const note = el("latest-note");
  const text = statusNote(latest);
  note.textContent = text;
  note.classList.toggle("hidden", !text);
}

function severityRow(entry) {
  const buttons = Array.from({ length: 10 }, (_, i) => {
    const value = i + 1;
    const on = entry.severity === value ? " on" : "";
    return `<button type="button" class="sev${on}" data-severity="${value}" data-id="${entry.id}">${value}</button>`;
  }).join("");
  return `<div class="severity-row">${buttons}</div>`;
}

function entryItem(entry) {
  const trend = trendLabel(entry.pressureChange3h);
  const summary = entry.weatherStatus === "ok"
    ? `${entry.pressureInHg != null ? entry.pressureInHg.toFixed(2) + " inHg" : "—"} <span class="${trend.cls}">${trend.arrow}</span> · ${entry.humidity != null ? Math.round(entry.humidity) + "% RH" : "—"}`
    : `<span class="pending-tag">weather pending</span>`;

  const open = state.openId === entry.id;

  return `
    <li class="entry${open ? " open" : ""}" data-id="${entry.id}">
      <button type="button" class="entry-head" data-toggle="${entry.id}">
        <span class="entry-when">${esc(fmtDayTime(entry.date))}</span>
        <span class="entry-summary">${summary}</span>
        ${entry.severity ? `<span class="severity-chip">${entry.severity}</span>` : ""}
        <span class="chevron" aria-hidden="true">${open ? "▾" : "▸"}</span>
      </button>
      ${open ? `
      <div class="entry-body">
        <div class="reading-grid">${readingGrid(entry)}</div>
        ${priorBlock(entry)}
        ${statusNote(entry) ? `<p class="hint">${statusNote(entry)}</p>` : ""}
        <span class="section-label">Severity</span>
        ${severityRow(entry)}
        <span class="section-label">Notes</span>
        <textarea class="notes" rows="2" data-notes="${entry.id}"
          placeholder="Triggers, meds, how long it lasted">${esc(entry.notes || "")}</textarea>
        <button type="button" class="delete-button" data-delete="${entry.id}">Delete entry</button>
      </div>` : ""}
    </li>`;
}

function render() {
  renderLatest();

  const list = el("entry-list");
  list.innerHTML = state.entries.map(entryItem).join("");
  el("empty-state").classList.toggle("hidden", state.entries.length > 0);

  const count = state.entries.length;
  el("entry-count").textContent = count ? `${count} ${count === 1 ? "entry" : "entries"}` : "";
}

// -------------------------------------------------------------------- wiring

function wireEvents() {
  el("btn-log").addEventListener("click", logMigraine);
  el("btn-export").addEventListener("click", exportCSV);
  el("btn-use-current").addEventListener("click", useCurrentLocation);
  el("btn-city-search").addEventListener("click", searchCity);

  el("btn-toggle-search").addEventListener("click", () => {
    const box = el("city-search");
    box.classList.toggle("hidden");
    if (!box.classList.contains("hidden")) el("city-input").focus();
  });

  el("city-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      searchCity();
    }
  });

  // The history list is re-rendered wholesale, so its handlers live on the
  // container rather than on each row.
  const list = el("entry-list");
  list.addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-toggle]");
    if (toggle) {
      const id = toggle.dataset.toggle;
      state.openId = state.openId === id ? null : id;
      render();
      return;
    }
    const sev = e.target.closest("[data-severity]");
    if (sev) {
      setSeverity(sev.dataset.id, Number(sev.dataset.severity));
      return;
    }
    const del = e.target.closest("[data-delete]");
    if (del) deleteEntry(del.dataset.delete);
  });

  // Notes save on blur — no save button, and no write on every keystroke.
  list.addEventListener("focusout", (e) => {
    const notes = e.target.closest("[data-notes]");
    if (notes) saveNotes(notes.dataset.notes, notes.value.trim());
  });

  window.addEventListener("online", backfillPending);
}

async function init() {
  wireEvents();
  loadSavedLocation();
  state.entries = await DB.all();
  render();
  backfillPending();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // Offline support is a bonus; the app works without it.
    });
  }
}

init();
