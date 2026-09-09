# Installing GeoIntelliSense on an Android phone (APK)

This guide covers getting a sideloadable APK onto a Pixel (tested target:
Pixel 10 Pro XL, Android 16). For Play Store publishing see
`ANDROID_PLAY_STORE.md`.

## 1) Get the APK

**From GitHub Actions (no local toolchain needed)**

1. Open the repository's **Actions** tab and pick the **Android APK** workflow.
2. Open the latest green run (or click **Run workflow** to build on demand,
   optionally entering your server addresses so they are baked in).
3. Download the `GeoIntelliSense-debug-apk` artifact and unzip it to get
   `app-debug.apk`.

Pushing a tag such as `v1.0.0` also attaches the APK to a GitHub Release.

**Locally**

Prerequisites: Node 22, JDK 21, Android SDK with platform 36 and build-tools
36.0.0 (Android Studio installs these; set `ANDROID_HOME`).

```bash
npm ci
npm run apk:debug
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

To bake server addresses into the build instead of entering them in-app:

```bash
VITE_GATEWAY_URL=https://api.example.com \
VITE_INGESTION_URL=https://ingestion.example.com \
npm run apk:debug
```

## 2) Install on the phone

**Option A: copy the file**

1. Transfer `app-debug.apk` to the phone (Google Drive, USB, email, etc.).
2. Open it from the **Files** app. When prompted, allow the Files app to
   install unknown apps. Confirm the install.
3. Play Protect may warn that the app is from an unknown developer. Tap
   **More details > Install anyway**.

**Option B: adb**

1. On the phone: **Settings > About phone**, tap **Build number** seven times,
   then **Settings > System > Developer options > USB debugging**.
2. Connect the phone by USB and accept the debugging prompt.
3. Run:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Debug APKs are signed with the standard Android debug key. Reinstalling a
newer build over an older one works as long as both were built with the same
debug key (same machine or the same GitHub Actions runner image key). If the
install is refused with a signature error, uninstall the old copy first.

## Quick start: live data on the phone today

You need a computer on the same Wi-Fi as the phone, with Docker Desktop (or
Docker Engine) and Node installed. The whole thing is about 15 minutes, most
of it the first image build.

```bash
git clone <this repo> && cd GeoIntelliSense
cp .env.example .env          # optional: add API keys (see below)
docker compose up -d          # first run builds the Rust + Python images
npm ci && npm run phone:urls  # prints the two URLs to type into the phone
```

Install the debug APK on the phone (section 2 below), open **Settings > API &
Connection > Server Connection**, enter the two `http://<your-ip>:...` URLs
that `npm run phone:urls` printed, and tap **Save & reconnect**. The
dashboard fills in within a few seconds.

What is live without any API key: weather forecast (NWS), earthquakes
(USGS), water levels (USGS), temperature-inversion status, and the AQI
prediction model. AQI readings are **simulated** until you add a PurpleAir
key. To light up the rest, put these in `.env` and run
`docker compose up -d` again (each is a free signup that issues a key
immediately or by email within minutes):

| Key | Unlocks | Get it at |
| --- | --- | --- |
| `PURPLEAIR_API_KEY` | live AQI from neighbourhood sensors, 24h trend | https://develop.purpleair.com/ |
| `NASA_FIRMS_KEY` | active fires widget | https://firms.modaps.eosdis.nasa.gov/api/map_key/ |
| `AIRNOW_API_KEY` | official EPA observations/forecast | https://docs.airnowapi.org/account/request/ |
| `NOAA_CDO_TOKEN` | historical weather in Analysis | https://www.ncdc.noaa.gov/cdo-web/token |
| `ANTHROPIC_API_KEY` | AI chat and analysis | https://console.anthropic.com/settings/keys |
| `GOOGLE_MAPS_API_KEY` | interactive map screen | https://console.cloud.google.com/google/maps-apis/ |

### Off Wi-Fi: keep it working on cellular with Tailscale

Install [Tailscale](https://tailscale.com/download) on the computer and the
phone and sign both into the same account. The phone then reaches the backend
from anywhere, including on cellular. The computer must stay on and running
`docker compose`.

Publish both services over HTTPS with `tailscale serve`. This is the address
pair to use — see the mixed-content warning under *Rules for the address*
below for why `http://` so often looks like it saved and then does nothing.
`tailscale serve` uses a real Let's Encrypt certificate for the MagicDNS name,
so there is no certificate warning to click through. Pick spare ports if a
Funnel already owns 443:

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:8080
tailscale serve --bg --https=8444 http://127.0.0.1:3001
```

```
Gateway URL:   https://<machine>.<tailnet>.ts.net:8443
Ingestion URL: https://<machine>.<tailnet>.ts.net:8444
```

`npm run phone:urls` prints these ready to type, checks that both answer, and
falls back to the plain-http and LAN addresses if no serve listener is set up.

### Always on: host it on a VPS

Any Linux VPS with Docker works: clone the repo, `docker compose up -d`,
point a DNS name at it, and put HTTPS in front (Caddy with a domain block,
or the host's load balancer). Then bake the public URLs into the build with
the workflow's **Run workflow** inputs or the `VITE_*` variables, and the
app needs no in-app setup at all.

## 3) Point the app at a server

The app is a client. Its data comes from the GeoIntelliSense backend
(`docker compose up` in this repository, or a hosted deployment). On first
launch with no server baked in, every screen reports "No server configured".

1. Open **Settings** (gear icon at the bottom of the sidebar).
2. Under **API & Connection > Server Connection** enter:
   - **Gateway URL**: the gateway service (port 8080 in docker compose)
   - **Ingestion URL**: the ingestion service (port 3001 in docker compose)
3. Tap **Save & reconnect**. The app reloads and **Backend Status** should
   show *Connected*.

Rules for the address:

- Public servers must use `https://`.
- Plain `http://` is accepted only for private-network hosts such as
  `http://192.168.1.20:8080`, `http://10.0.0.5:3001`, `http://100.101.102.103:8080`
  or `http://mybox.tailnet.ts.net:8080` (Tailscale), `http://mybox:8080`, or
  `http://mybox.local:8080`, and only in **debug** builds.
  Release builds enforce HTTPS at the OS level.

> **`http://` saved fine but nothing happens? That is mixed content.**
> The WebView origin is `https://localhost` (`androidScheme: 'https'`), so an
> `http://` request is mixed content and the WebView discards it *before* it
> reaches the network — the address validates, the app reloads, Backend Status
> stays *Disconnected*, and the server sees no request at all. It works only in
> a build with **both** `android.allowMixedContent: true` in
> `capacitor.config.ts` **and** `android:usesCleartextTraffic="true"` from
> `android/app/src/debug/AndroidManifest.xml`. An APK built before those landed
> can never use an `http://` address, however many times you press
> *Save & reconnect*. Prefer an `https://` address; it has none of this.
>
> To tell the two failures apart, check the gateway access log
> (`docker compose logs --tail 50 gateway`): a request from the phone appears
> with `"X-Forwarded-For": ["100.x.y.z"]`. Nothing there means the phone never
> sent it — mixed content, not firewall, not Tailscale.

### Talking to a laptop on the same Wi-Fi

```bash
docker compose up -d           # backend on the laptop
npm run phone:urls             # prints the laptop's LAN IP as ready-to-type URLs
```

Then in the app enter the printed `http://<ip>:8080` and `http://<ip>:3001`.
Make sure the laptop firewall allows inbound connections on those ports
(Windows Defender and macOS both prompt the first time Docker listens).

## Troubleshooting

- **Stuck on "Loading GeoIntelliSense..."**: with the phone connected over
  USB, open `chrome://inspect` on a desktop Chrome to see the WebView console
  (debug builds only).
- **"Disconnected" after saving**: verify the URL opens in the phone's
  browser (`http://<ip>:3001/health` should return OK). Check the firewall.
- **Maps screen shows a configuration message**: the gateway needs a
  `GOOGLE_MAPS_API_KEY` in its `.env.local`; the phone never holds API keys.
