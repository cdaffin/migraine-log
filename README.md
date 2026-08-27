# Migraine Log

One button. Tap it when an attack starts and it records the moment plus the
weather that goes with it — barometric pressure, humidity, dew point,
temperature, wind, sky — and the same set of readings from 24 hours earlier at
the same place. Everything stays on the device; CSV export is how the data gets
out.

## What a tap records

| Field | Notes |
| --- | --- |
| Date & time | The moment of the tap, saved before anything else is attempted |
| Pressure | inHg and hPa |
| Humidity, dew point, temp, wind, sky | From the same hour |
| 24h prior reading | The same set of values, same place, 24 hours before the logged timestamp |
| 3h pressure change | The one derived figure kept, since nothing else stores the hour three back |
| Location | Device GPS, or the saved fallback location |
| Severity, notes | Optional, added afterwards by tapping the entry |

The two readings are stored and exported raw, side by side — there is no 24h
difference column on purpose. Subtracting them is the spreadsheet's job, which
leaves the analysis free to look at whatever window or variable it wants rather
than the one this app picked.

The earlier hour is located by real elapsed time, not by counting 24 rows back,
so a daylight-saving changeover still lands on the hour that was genuinely 24
hours before. When it falls outside the window the API returned, those columns
are simply left empty and the entry is kept on the strength of its own reading.

Weather comes from [Open-Meteo](https://open-meteo.com/) — no API key, no
account. City lookup uses their geocoding endpoint.

## How it behaves

- **The timestamp is never at risk.** The entry is written to IndexedDB before
  the network is touched. If the weather call fails, the entry is kept and
  marked pending.
- **Pending entries fill themselves in** on the next launch or the next time
  the browser comes back online. Open-Meteo serves ~3 months of hourly history,
  so a backfill can be quite late and still be accurate. Entries stored before
  a new weather field existed are re-fetched once by the same pass, tracked by
  `WEATHER_SCHEMA` in `js/app.js` — bump it when the stored shape grows.
- **Location falls back.** It asks the device first (accepting a fix up to ten
  minutes old, so nobody waits on a GPS lock mid-migraine) and uses the saved
  location when the device won't answer. Set that fallback by city, or from
  the current location, in the card at the bottom.
- **Offline-capable.** A service worker caches the app shell, so it opens and
  logs without a connection.

## Passphrase

The app asks for a passphrase before it shows anything, and stays unlocked on
that device until **Lock this device** is tapped (bottom of the screen).

Only the SHA-256 hash of the passphrase is in the source — the passphrase
itself is never written to this repo or stored on the device, so a reader of
the code doesn't get it. To change it, generate a new hash and replace `HASH`
at the top of `js/lock.js`:

```
printf '%s' 'your new passphrase' | shasum -a 256
```

**What this does and doesn't do.** There is no server: every entry lives in
this browser's IndexedDB, on this device. So the gate is worth exactly what a
screen lock is worth — it stops someone who picks up an unlocked phone from
reading the log. It does not encrypt anything, and anyone with developer tools
on an unlocked device can read the database directly. Opening the site on
*another* device shows an empty log regardless, since nothing is shared.

For a lock that a browser can't walk past, use Netlify's own site-level
password protection (Site configuration → Access control), which is enforced
before any file is served. That is a paid Netlify feature.

## Deploying to Netlify

A static site with no build step. Point a Netlify site at this repo and it
works as-is — `netlify.toml` sets the publish directory to the repo root, so
there is nothing to configure.

1. Netlify → **Add new site → Import an existing project**
2. Pick this repository
3. Leave the build command empty; publish directory comes from `netlify.toml`
4. Deploy

## Installing on iPhone

1. Open your site's URL in **Safari**
2. Share icon → **Add to Home Screen**
3. Launch from the home screen — full screen, no browser chrome

Installed, the CSV export goes through the iOS share sheet (a plain download
has nowhere to land in a standalone app). In a normal browser tab it downloads
as a file.

## Local development

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Service workers and `crypto.randomUUID()`
need `localhost` or HTTPS — a `file://` URL won't work.

## Icons

`icons/make-icons.py` draws the PNGs (a barometer dial) with no image library.
Re-run it from the `icons` directory after changing the design.
