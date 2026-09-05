// Open-Meteo lookup for the conditions a migraine log cares about: barometric
// pressure, humidity, temperature — and, from the companion air-quality
// endpoint, the pollutants with the most consistent migraine signal in the
// literature. No API key, no account; both endpoints are free for
// non-commercial use.
//
// One fetch of each endpoint covers a whole span of hours, so reading a single
// logged moment and backfilling three months of daily samples cost the same
// two requests.
const Weather = (() => {
  const WEATHER_HOURLY = [
    "temperature_2m",
    "relative_humidity_2m",
    "dew_point_2m",
    "pressure_msl",
    "wind_speed_10m",
    "weather_code",
  ].join(",");

  const AIR_HOURLY = [
    "pm2_5",
    "pm10",
    "ozone",
    "nitrogen_dioxide",
    "carbon_monoxide",
    "uv_index",
    "us_aqi",
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
  const MAX_PAST_DAYS = 92;

  function skyFromCode(code) {
    return WEATHER_CODES[code] || { label: "—", icon: "" };
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function dayKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  // The hour key Open-Meteo returns in `hourly.time` when timezone=auto:
  // a local, zoneless "2026-08-27T14:00".
  function hourKey(date) {
    return `${dayKey(date)}T${pad(date.getHours())}:00`;
  }

  function midnight(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // How far back the request must reach to cover the oldest moment asked for,
  // plus the day before it (the 24h-earlier reading lives there).
  function pastDaysFor(dates) {
    const oldest = dates.reduce((a, b) => (a < b ? a : b));
    const daysBack = Math.round((midnight(new Date()) - midnight(oldest)) / 86400000);
    return Math.min(Math.max(daysBack + 1, 1), MAX_PAST_DAYS);
  }

  // Open-Meteo returns the occasional transient 5xx under load. Retry a couple
  // of times with backoff so a one-off blip doesn't read as a hard failure.
  async function fetchJson(url, label, attempts = 3) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${label} request failed (${res.status})`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) await sleep(400 * (i + 1));
      }
    }
    throw lastErr;
  }

  function weatherUrl(lat, lng, pastDays) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lng);
    url.searchParams.set("hourly", WEATHER_HOURLY);
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("wind_speed_unit", "mph");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("past_days", pastDays);
    url.searchParams.set("forecast_days", 1);
    return url;
  }

  function airUrl(lat, lng, pastDays) {
    const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lng);
    url.searchParams.set("hourly", AIR_HOURLY);
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("past_days", pastDays);
    url.searchParams.set("forecast_days", 1);
    return url;
  }

  // Weather is required; air quality is a bonus. A failure or a shorter history
  // window on the air endpoint leaves those fields null rather than costing the
  // entry its weather — they're supporting evidence, not the reason to log.
  async function fetchSeries(lat, lng, pastDays) {
    const [weather, air] = await Promise.all([
      fetchJson(weatherUrl(lat, lng, pastDays), "Weather"),
      // One attempt only. Weather is worth waiting out a blip for; air quality
      // is not, and retrying it would put a second or more of backoff in front
      // of every log for a field that is allowed to be blank.
      fetchJson(airUrl(lat, lng, pastDays), "Air quality", 1).catch(() => null),
    ]);
    return { weather: weather.hourly, air: air ? air.hourly : null };
  }

  // Open-Meteo accepts both its current field names (`wind_speed_10m`) and the
  // older ones (`windspeed_10m`), and echoes back whichever was asked for. We
  // ask with the current names; this reads either so a response in the legacy
  // shape still lands.
  function series(hourly, ...names) {
    if (!hourly) return [];
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
    if (!times.length) return -1;
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

  // The day's pressure range, over the hours the response actually holds for
  // that calendar day. Stored raw as a low and a high — the swing between them
  // is the analyst's subtraction to make, like every other comparison here.
  function dayPressureRange(weatherHourly, date) {
    const prefix = dayKey(date);
    const times = weatherHourly.time;
    const pressure = series(weatherHourly, "pressure_msl");
    const values = [];
    for (let i = 0; i < times.length; i++) {
      if (times[i].startsWith(prefix) && pressure[i] != null) values.push(pressure[i]);
    }
    if (!values.length) return { low: null, high: null };
    return { low: Math.min(...values), high: Math.max(...values) };
  }

  // Every stored value for one hour, exactly as the two APIs reported it.
  // Nothing here reaches across hours — comparisons are stored as separate raw
  // readings so the arithmetic stays with whoever analyses the export.
  function readingAt({ weather, air }, date) {
    const idx = findHour(weather.time, date);
    if (idx === -1) return null;

    const pressureHpa = series(weather, "pressure_msl")[idx] ?? null;
    const sky = skyFromCode(series(weather, "weather_code", "weathercode")[idx]);
    const range = dayPressureRange(weather, date);

    // The air endpoint has its own time array and may not reach as far back,
    // so it gets its own lookup rather than borrowing the weather index.
    const airIdx = air ? findHour(air.time, date) : -1;
    const at = (...names) => (airIdx === -1 ? null : series(air, ...names)[airIdx] ?? null);

    return {
      observedAt: weather.time[idx],
      pressureHpa,
      pressureInHg: pressureHpa != null ? pressureHpa * HPA_TO_INHG : null,
      dayPressureLow: range.low,
      dayPressureHigh: range.high,
      humidity: series(weather, "relative_humidity_2m", "relativehumidity_2m")[idx] ?? null,
      dewPoint: series(weather, "dew_point_2m", "dewpoint_2m")[idx] ?? null,
      temperature: series(weather, "temperature_2m")[idx] ?? null,
      windSpeed: series(weather, "wind_speed_10m", "windspeed_10m")[idx] ?? null,
      skyCondition: sky.label,
      skyIcon: sky.icon,
      pm25: at("pm2_5"),
      pm10: at("pm10"),
      ozone: at("ozone"),
      nitrogenDioxide: at("nitrogen_dioxide"),
      carbonMonoxide: at("carbon_monoxide"),
      uvIndex: at("uv_index"),
      usAqi: at("us_aqi"),
    };
  }

  // The reading for a moment, plus the one 24 hours before it at the same
  // place. The earlier hour is found by real elapsed time rather than by
  // stepping back 24 rows, so a DST day still lands on the hour that was
  // genuinely 24 hours before.
  function pairAt(data, date) {
    const reading = readingAt(data, date);
    if (!reading) return null;

    // The one derived value kept: nothing else stores the hour three back, so
    // a 3h trend can't be recovered from the raw readings alone.
    const times = data.weather.time;
    const pressure = series(data.weather, "pressure_msl");
    const idx = findHour(times, date);
    const threeBack = idx >= 3 ? pressure[idx - 3] ?? null : null;
    const pressureChange3h = reading.pressureHpa != null && threeBack != null
      ? reading.pressureHpa - threeBack
      : null;

    return {
      reading: { ...reading, pressureChange3h },
      prior24h: readingAt(data, new Date(date.getTime() - 24 * 3600 * 1000)),
    };
  }

  async function fetchWeather(lat, lng, date) {
    const data = await fetchSeries(lat, lng, pastDaysFor([date]));
    const pair = pairAt(data, date);
    if (!pair) throw new Error("No hourly data for that time");
    return pair;
  }

  // Many moments from a single pair of requests — used to backfill the daily
  // background samples that give attack days something to be compared against.
  // Dates that fall outside the returned window are simply absent from the map.
  async function fetchMany(lat, lng, dates) {
    if (!dates.length) return new Map();
    const data = await fetchSeries(lat, lng, pastDaysFor(dates));
    const out = new Map();
    for (const date of dates) {
      const pair = pairAt(data, date);
      if (pair) out.set(date.getTime(), pair);
    }
    return out;
  }

  return { fetchWeather, fetchMany, HPA_TO_INHG, MAX_PAST_DAYS };
})();
