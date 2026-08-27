// CSV export — one row per logged attack, in a shape that opens cleanly in
// Numbers/Excel/Sheets and is easy to hand to a neurologist.
const CSVio = (() => {
  // Two raw readings per row — the logged hour, then the same place 24 hours
  // earlier. Deliberately no 24h difference column: the pair is there to be
  // subtracted in the spreadsheet, however the analysis wants to do it.
  const COLUMNS = [
    ["Date", (e) => fmtDate(e.date)],
    ["Time", (e) => fmtTime(e.date)],
    ["Pressure (inHg)", (e) => num(e.pressureInHg, 2)],
    ["Pressure (hPa)", (e) => num(e.pressureHpa, 1)],
    ["3h Change (hPa)", (e) => signed(e.pressureChange3h, 1)],
    ["Humidity (%)", (e) => num(e.humidity, 0)],
    ["Dew Point (F)", (e) => num(e.dewPoint, 0)],
    ["Temp (F)", (e) => num(e.temperature, 0)],
    ["Wind (mph)", (e) => num(e.windSpeed, 1)],
    ["Sky", (e) => e.skyCondition || ""],
    ["24h Prior Observed", (e) => prior(e).observedAt || ""],
    ["24h Prior Pressure (inHg)", (e) => num(prior(e).pressureInHg, 2)],
    ["24h Prior Pressure (hPa)", (e) => num(prior(e).pressureHpa, 1)],
    ["24h Prior Humidity (%)", (e) => num(prior(e).humidity, 0)],
    ["24h Prior Dew Point (F)", (e) => num(prior(e).dewPoint, 0)],
    ["24h Prior Temp (F)", (e) => num(prior(e).temperature, 0)],
    ["24h Prior Wind (mph)", (e) => num(prior(e).windSpeed, 1)],
    ["24h Prior Sky", (e) => prior(e).skyCondition || ""],
    ["Latitude", (e) => num(e.latitude, 5)],
    ["Longitude", (e) => num(e.longitude, 5)],
    ["Weather Status", (e) => e.weatherStatus || ""],
    ["Notes", (e) => (e.notes || "").replace(/\n/g, " | ")],
  ];

  // Entries logged before the 24h-prior reading existed, or whose earlier hour
  // fell outside the API window, simply leave those columns empty.
  function prior(entry) {
    return entry.prior24h || {};
  }

  function csvField(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function num(value, digits) {
    return value == null ? "" : Number(value).toFixed(digits);
  }

  // Trend columns read much better with an explicit "+" — a spreadsheet still
  // parses "+2.4" as a number.
  function signed(value, digits) {
    if (value == null) return "";
    const fixed = Number(value).toFixed(digits);
    return Number(value) > 0 ? `+${fixed}` : fixed;
  }

  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric",
    });
  }

  function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit",
    });
  }

  function exportCSV(entries) {
    const header = COLUMNS.map(([name]) => csvField(name)).join(",");
    const rows = entries.map((entry) =>
      COLUMNS.map(([, read]) => csvField(read(entry))).join(",")
    );
    return [header, ...rows].join("\n");
  }

  // True only when running as an installed home-screen app (iOS Safari's
  // navigator.standalone, or the standard display-mode media query elsewhere).
  // That's the one situation where a plain <a download> is unreliable — there's
  // no browser chrome or download manager to catch it, so the share sheet is
  // the only way out. A normal browser tab downloads fine.
  function isStandaloneApp() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  }

  function filename() {
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10);
    return `migraine-log-${stamp}.csv`;
  }

  async function download(entries) {
    const csv = exportCSV(entries);
    const name = filename();
    const blob = new Blob([csv], { type: "text/csv" });

    if (isStandaloneApp() && navigator.canShare) {
      const file = new File([blob], name, { type: "text/csv" });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "Migraine Log" });
          return;
        } catch (err) {
          if (err.name === "AbortError") return; // user dismissed the share sheet
          // fall through to the link-download fallback on any other error
        }
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return { exportCSV, download };
})();
