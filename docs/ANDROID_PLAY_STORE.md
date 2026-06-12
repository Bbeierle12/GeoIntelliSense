# Android / Google Play submission runbook

## 1) Prerequisites
- Node.js + npm
- Android Studio (latest stable)
- Android SDK Platform 35 (verify latest Play requirement before submission)
- Java 17+

## 2) Configure production env vars
Create `.env.local` with production HTTPS endpoints:

```bash
VITE_GATEWAY_URL=https://api.your-domain.com
VITE_INGESTION_URL=https://ingestion.your-domain.com
```

## 3) Build and sync Capacitor assets
```bash
npm install
npm run build:mobile
```

## 4) Open Android project
```bash
npm run cap:open:android
```

## 5) Signing setup (keystore.properties)
Create `android/keystore.properties` (do not commit):

```properties
storeFile=../release.keystore
storePassword=***
keyAlias=***
keyPassword=***
```

Play App Signing should remain enabled in Play Console.

## 6) Build signed AAB in Android Studio
- Build > Generate Signed Bundle / APK
- Select Android App Bundle (AAB)
- Use release signing config

## 7) API levels and versioning
- `compileSdk` / `targetSdk`: 35 (Android 15)
- `minSdk`: 23
- `versionCode`: 1
- `versionName`: 1.0.0
- Re-check current Play required target API level at submission time.

## 8) Required Play listing assets
- App icon: **512×512**, 32-bit PNG
- Feature graphic: **1024×500**, PNG/JPG
- Screenshots: **2–8 per device type**
- Short description + full description
- Privacy policy URL (host `PRIVACY_POLICY.md` content)

## 9) Compliance forms
- Data safety: complete using `docs/PLAY_STORE_DATA_SAFETY.md`
- Content rating questionnaire
- App access declarations (if required)

## 10) Release flow
1. Upload AAB to **Internal testing**
2. Validate install/startup/network/location flows on real devices
3. Address policy/pre-launch report findings
4. Promote to production rollout

## 11) Icon/splash replacement checklist
Replace placeholder assets before production:
- `public/icons/icon-192.png`
- `public/icons/icon-512.png`
- `public/icons/icon-512-maskable.png`
- Android launcher/adaptive icon resources under `android/app/src/main/res/mipmap-*`
- Play Console icon upload (512×512)
