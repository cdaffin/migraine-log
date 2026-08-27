// Open-Meteo lookup for the conditions that matter to a migraine log:
// barometric pressure (and how fast it's moving), humidity, temperature.
// No API key, no account — the endpoint is free for non-commercial use.
const Weather = (() => {
  const HOURLY = [
    "temperature_2m",
    "relative_humidity_2m",
    "dew_point_2m",
    "pressure_msl",
    "wind_speed_10m",
    "weather_code",
  ].join(",");

  // WMO weather codes, as used by Open-Meteo's `weather_code` field.
  const WEATHER_CODES = {
    0: { label: "Clear", icon: "☀️" },
    1: { label: "Mostly Clear", icon: "🌤️" },
    2: { label: "Partly Cloudy", icon: "⛅" },
    3: { label: "Overcast", icon: "☁️" },
    45: { label: "Fog", icon: "🌫️" },
    48: { label: "Fog", icon: "🌫️" },
    51: { label: "Light Drizzle", icon: "🌦️" },
    53: { label: "Drizzle", icon: "🌦️" },
    55: { label: "Heavy Drizzle", icon: "🌦️" },
    56: { label: "Freezing Drizzle", icon: "🌧️" },
    57: { label: "Freezing Drizzle", icon: "🌧️" },
    61: { label: "Light Rain", icon: "🌧️" },
    63: { label: "Rain", icon: "🌧️" },
    65: { label: "Heavy Rain", icon: "🌧️" },
    66: { label: "Freezing Rain", icon: "🌧️" },
    67: { label: "Freezing Rain", icon: "🌧️" },
    71: { label: "Light Snow", icon: "🌨️" },
    73: { label: "Snow", icon: "🌨️" },
    75: { label: "Heavy Snow", icon: "🌨️" },
    77: { label: "Snow Grains", icon: "🌨️" },
    80: { label: "Rain Showers", icon: "🌦️" },
    81: { label: "Rain Showers", icon: "🌦️" },
    82: { label: "Heavy Rain Showers", icon: "🌦️" },
    85: { label: "Snow Showers", icon: "🌨️" },
    86: { label: "Snow Showers", icon: "🌨️" },
    95: { label: "Thunderstorm", icon: "⛈️" },
    96: { label: "Thunderstorm w/ Hail", icon: "⛈️" },
    99: { label: "Thunderstorm w/ Hail", icon: "⛈️" },
  };

  const HPA_TO_INHG = 0.02953;

  function skyFromCode(code) {
    return WEATHER_CODES[code] || { label: "—", icon: "" };
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  // The hour key Open-Meteo returns in `hourly.time` when timezone=auto:
  // a local, zoneless "2026-08-27T14:00".
  function hourKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
  }

  function midnight(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchOnce(lat, lng, date) {
    // `past_days` reaches back from today; add one so the 24h-earlier reading
    // used for the pressure trend is always inside the window. The forecast
    // endpoint covers ~3 months of history, so unlike the archive endpoint
    // there's no multi-day publishing lag to work around.
    const daysBack = Math.round((midnight(new Date()) - midnight(date)) / 86400000);
    const pastDays = Math.min(Math.max(daysBack + 1, 1), 92);

    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lng);
    url.searchParams.set("hourly", HOURLY);
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("wind_speed_unit", "mph");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("past_days", pastDays);
    url.searchParams.set("forecast_days", 1);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Weather request failed (${res.status})`);
    return res.json();
  }

  // Open-Meteo returns the occasional transient 5xx under load. Retry a couple
  // of times with backoff so a one-off blip doesn't read as a hard failure.
  async function fetchData(lat, lng, date, attempts = 3) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fetchOnce(lat, lng, date);
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) await sleep(400 * (i + 1));
      }
    }
    throw lastErr;
  }

  // Open-Meteo accepts both its current field names (`wind_speed_10m`) and the
  // older ones (`windspeed_10m`), and echoes back whichever was asked for. We
  // ask with the current names; this reads either so a response in the legacy
  // shape still lands.
  function series(hourly, ...names) {
    for (const name of names) {
      if (Array.isArray(hourly[name])) return hourly[name];
    }
    return [];
  }

  // Hours are matched on the local label Open-Meteo returns. When the exact
  // label is missing — a DST jump, or a clock a little out of step — the
  // nearest hour within the tolerance stands in; anything further away means
  // the moment isn't in the returned window at all, which is a miss, not a
  // reading to be approximated.
  const MATCH_TOLERANCE_MS = 90 * 60 * 1000;

  function findHour(times, date) {
    const exact = times.indexOf(hourKey(date));
    if (exact !== -1) return exact;

    const target = date.getTime();
    let best = -1;
    let bestDiff = Infinity;
    times.forEach((t, i) => {
      const diff = Math.abs(new Date(t).getTime() - target);
      if (diff < bestDiff) {
        best = i;
        bestDiff = diff;
      }
    });
    return bestDiff <= MATCH_TOLERANCE_MS ? best : -1;
  }

  // Every stored value for one hour, exactly as the API reported it. Nothing
  // here reaches across hours — the 24h comparison is stored as two raw
  // readings so the arithmetic stays with whoever analyses the export.
  function readingAt(hourly, idx) {
    const pressureHpa = series(hourly, "pressure_msl")[idx] ?? null;
    const sky = skyFromCode(series(hourly, "weather_code", "weathercode")[idx]);
    return {
      observedAt: hourly.time[idx],
      pressureHpa,
      pressureInHg: pressureHpa != null ? pressureHpa * HPA_TO_INHG : null,
      humidity: series(hourly, "relative_humidity_2m", "relativehumidity_2m")[idx] ?? null,
      dewPoint: series(hourly, "dew_point_2m", "dewpoint_2m")[idx] ?? null,
      temperature: series(hourly, "temperature_2m")[idx] ?? null,
      windSpeed: series(hourly, "wind_speed_10m", "windspeed_10m")[idx] ?? null,
      skyCondition: sky.label,
      skyIcon: sky.icon,
    };
  }

  // Returns the reading for the logged moment plus the one from 24 hours
  // earlier at the same place, both raw. The earlier hour is found by real
  // elapsed time rather than by stepping back 24 rows, so a DST day still
  // lands on the hour that was genuinely 24 hours before.
  async function fetchWeather(lat, lng, date) {
    const data = await fetchData(lat, lng, date);
    const times = data.hourly.time;

    const idx = findHour(times, date);
    if (idx === -1) {
      throw new Error("No hourly data for that time");
    }

    const priorDate = new Date(date.getTime() - 24 * 3600 * 1000);
    const priorIdx = findHour(times, priorDate);

    // The one derived value that survives: nothing else stores the hour three
    // back, so a 3h trend can't be recovered from the raw readings alone.
    const pressure = series(data.hourly, "pressure_msl");
    const pressure3hAgo = idx >= 3 ? pressure[idx - 3] ?? null : null;
    const reading = readingAt(data.hourly, idx);
    const pressureChange3h = reading.pressureHpa != null && pressure3hAgo != null
      ? reading.pressureHpa - pressure3hAgo
      : null;

    return {
      reading: { ...reading, pressureChange3h },
      // Null when the earlier hour falls outside the window the API returned —
      // the entry is still worth keeping on the strength of its own reading.
      prior24h: priorIdx === -1 ? null : readingAt(data.hourly, priorIdx),
    };
  }

  return { fetchWeather, HPA_TO_INHG };
})();
