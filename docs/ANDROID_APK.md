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

## 3) Point the app at a server

The app is a client. Its data comes from the GeoIntelliSense backend
(`docker compose up` in this repository, or a hosted deployment). On first
launch with no server baked in, every screen reports "No server configured".

1. Open **Settings** (gear icon in the sidebar).
2. Under **API & Connection > Server Connection** enter:
   - **Gateway URL**: the gateway service (port 8080 in docker compose)
   - **Ingestion URL**: the ingestion service (port 3001 in docker compose)
3. Tap **Save & reconnect**. The app reloads and **Backend Status** should
   show *Connected*.

Rules for the address:

- Public servers must use `https://`.
- Plain `http://` is accepted only for private-network hosts such as
  `http://192.168.1.20:8080`, `http://10.0.0.5:3001`, or `http://mybox.local:8080`,
  and only in **debug** builds. Release builds enforce HTTPS at the OS level.

### Talking to a laptop on the same Wi-Fi

```bash
docker compose up -d           # backend on the laptop
ip addr | grep "inet 192"      # find the laptop's LAN IP, e.g. 192.168.1.20
```

Then in the app enter `http://192.168.1.20:8080` and `http://192.168.1.20:3001`.
Make sure the laptop firewall allows inbound connections on those ports.

## Troubleshooting

- **Stuck on "Loading GeoIntelliSense..."**: with the phone connected over
  USB, open `chrome://inspect` on a desktop Chrome to see the WebView console
  (debug builds only).
- **"Disconnected" after saving**: verify the URL opens in the phone's
  browser (`http://<ip>:3001/health` should return OK). Check the firewall.
- **Maps screen shows a configuration message**: the gateway needs a
  `GOOGLE_MAPS_API_KEY` in its `.env.local`; the phone never holds API keys.
