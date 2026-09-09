<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1TSTROmMZDi_NK0VF4oiiW_i2TPkn1j5C

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure API keys by creating a `.env.local` file:

   Copy the example file and add your API keys:
   ```bash
   cp .env.local.example .env.local
   ```

   **Both API keys are required for full functionality:**

   - **`ANTHROPIC_API_KEY`** - Required for Chat and Analysis features
     - Get it from [Anthropic Console](https://console.anthropic.com/settings/keys)

   - **`GOOGLE_MAPS_API_KEY`** - Required for Interactive Map feature
     - Get it from [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/)
     - Ensure the "Maps JavaScript API" is enabled for your project
     - Consider adding API restrictions for security
     - May incur charges based on usage

   **Security Note:** API keys are stored on the backend only and never exposed to the client browser.

   **Note:** The app will work partially with only one key configured. Features requiring a missing key will show a configuration message.

   The backend stack reads its own `.env` (copy `.env.example`); every value
   there has a working default, so `docker compose up -d` starts with no
   configuration at all.

3. Start the backend stack (TimescaleDB, Redis, ingestion, analytics, gateway), then the frontend:
   ```bash
   docker compose up -d   # first run builds the images; allow several minutes
   npm run dev
   ```

   Check the backend is up with `curl http://localhost:8080/health` (or `npm run phone:urls`).

4. Open your browser to `http://localhost:5174`

## Architecture

This application uses a secure client-server architecture:

- **Frontend** (Vite + React): Runs on `http://localhost:5174`
- **Backend** (Express): Runs on `http://localhost:3001`

API keys are stored securely in `.env.local` and only accessed by the backend server. The frontend makes requests to the backend API endpoints, which handle all communication with Google services.

## Android / Google Play

This repository includes a Capacitor Android wrapper. A debug APK is built automatically by the **Android APK** GitHub Actions workflow on every push to `main` (download it from the workflow run's artifacts), or locally with `npm run apk:debug`.

- Build and sideload an APK, and connect it to a backend on your Wi-Fi or over Tailscale: `docs/ANDROID_APK.md`
- Play Store runbook: `docs/ANDROID_PLAY_STORE.md`
- Data safety mapping: `docs/PLAY_STORE_DATA_SAFETY.md`
- Privacy policy template: `PRIVACY_POLICY.md`
