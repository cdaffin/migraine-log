# Migraine Log

One button. Tap it when an attack starts and it records the moment plus the
weather that goes with it — barometric pressure, humidity, dew point,
temperature, wind, sky — and the same set of readings from 24 hours earlier at
the same place. Entries are kept in the browser and copied to a passphrase-gated
store on the server, so the log survives a lost phone or a cleared browser. CSV
export is how the data gets out.

## What a tap records

| Field | Notes |
| --- | --- |
| Date & time | The moment of the tap, saved before anything else is attempted |
| Pressure | inHg and hPa |
| Humidity, dew point, temp, wind, sky | From the same hour |
| 24h prior reading | The same set of values, same place, 24 hours before the logged timestamp |
| 3h pressure change | The one derived figure kept, since nothing else stores the hour three back |
| Location | Device GPS, or the saved fallback location |
| Air quality | US AQI, PM2.5, PM10, ozone, NO₂, CO, UV index, from the same hour |
| Notes | Optional, added afterwards by tapping the entry |

Tapping an entry also lets you correct its date and time — the weather is tied
to that moment, so changing it re-reads the conditions for the new time rather
than leaving a reading that describes a time the entry no longer claims.

The two readings are stored and exported raw, side by side — there is no 24h
difference column on purpose. Subtracting them is the spreadsheet's job, which
leaves the analysis free to look at whatever window or variable it wants rather
than the one this app picked.

The earlier hour is located by real elapsed time, not by counting 24 rows back,
so a daylight-saving changeover still lands on the hour that was genuinely 24
hours before. When it falls outside the window the API returned, those columns
are simply left empty and the entry is kept on the strength of its own reading.

## Comparison days

A log of attacks on its own cannot answer "does falling pressure bring these
on?" — there is nothing to compare against. Thirty entries showing falling
pressure mean nothing until you know what the pressure did on the days you were
fine. It might just be what the season does.

So the app also records a **daily background sample**: the same readings, at
local noon, for every day. No tap and no notification — whenever the app is
opened it quietly fills in each day it missed, reaching back up to 88 days.
However many days are outstanding, it costs two requests, because one call to
each endpoint returns the whole span.

Those samples never appear in the history list, the entry count, or the "last
logged" card. They exist for the export, where the **`Attack`** column is `1`
for a logged attack and `0` for a background day. Filtering or averaging on
that column is what makes the file analysable — without the `0` rows there is
no baseline.

Sampling begins once the app knows a location, which the first tap establishes
(or set one by city in the card at the bottom).

Weather comes from [Open-Meteo](https://open-meteo.com/) — no API key, no
account — with pollutants from their companion air-quality endpoint. City
lookup uses their geocoding endpoint. Air quality is treated as optional: if
that endpoint fails those columns are blank and the weather reading is kept, and
it is never retried, so a broken air endpoint can't slow down logging an
attack.

## How it behaves

- **The timestamp is never at risk.** The entry is written to IndexedDB before
  the network is touched. If the weather call fails, the entry is kept and
  marked pending.
- **The device is the working store; the server is the copy.** A tap always
  succeeds locally and never waits on a round trip. The entry is pushed to
  `/api/log` straight after, and anything the server hasn't acknowledged is
  retried on the next launch or `online` event — including deletes, which are
  queued so a later pull can't resurrect them. Where two edits collide, the one
  with the newer `updatedAt` wins.
- **Background samples are complete or absent.** Unlike attacks, a sample is
  only written once its weather is in hand, so it never needs the pending
  retry. Its id is derived from the date, which makes re-sampling a day an
  overwrite rather than a duplicate.
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

The same passphrase is sent to `/api/log` as the `x-log-pass` header, where the
function compares it against `LOG_PASSWORD` in constant time. **That server-side
check is the real one** — it runs somewhere the browser can't talk past, and it
is what stands between the log and anyone who finds the URL.

**What this does and doesn't do.** Entries now leave the device: they are stored
server-side in Netlify Blobs, readable by anyone holding the passphrase, and by
whoever administers the Netlify account. Nothing is encrypted at rest beyond
what Netlify provides. The client-side gate on its own is worth what a screen
lock is worth — it stops someone who picks up an unlocked phone — and anyone
with developer tools on an unlocked device can read the local database and the
stored passphrase directly.

For a lock in front of the static files themselves, add Netlify's site-level
password protection (Site configuration → Access control), enforced before any
file is served. That is a paid Netlify feature, and it stacks with this one.

## Deploying to Netlify

A static site with no build step. Point a Netlify site at this repo and it
works as-is — `netlify.toml` sets the publish directory to the repo root, so
there is nothing to configure.

1. Netlify → **Add new site → Import an existing project**
2. Pick this repository
3. Leave the build command empty; publish directory and the functions directory
   both come from `netlify.toml`
4. **Set `LOG_PASSWORD`** under Site configuration → Environment variables, to
   the same passphrase the app asks for. Without it `/api/log` answers 503 and
   nothing syncs — the app still logs locally, and pushes once the variable is
   set.
5. Deploy

The function stores everything in one Netlify Blob (store `migraine-log`, key
`entries`). Blobs are provisioned automatically; there is nothing to create.

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
