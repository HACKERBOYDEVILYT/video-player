# NOIR Video Studio — Robiul Video Studio Edition

Professional Universal Video Player & Authorized Stream Downloader for **Web (React + TypeScript + Vite)** and **Android (Capacitor + Jetpack Media3 ExoPlayer + Scoped Storage)**, powered by a hardened **Node.js + Express + SQLite ACID** backend.

---

## 1. Project Folder Structure

```text
/
├── .github/workflows/
│   ├── release.yml                  # Automated Android APK, AAB & Production Release workflow
│   ├── website.yml                  # Automated Website CI/CD, Security Tests & GitHub Pages Deploy
│   └── android-apk-release.yml      # Companion Android APK workflow
├── public/
│   ├── icon.svg                     # Brand vector icon
│   ├── pwa-192x192.png              # Android/Desktop PWA icon (192x192)
│   ├── pwa-512x512.png              # Android/Desktop PWA icon (512x512)
│   ├── pwa-maskable-512x512.png     # Android Adaptive Maskable icon (512x512)
│   └── apple-touch-icon.png         # iOS Safari Home Screen icon (180x180)
├── src/
│   ├── assets/images/               # Generated high-contrast cinema poster thumbnails
│   ├── components/
│   │   ├── UniversalPlayer.tsx      # HTML5 + HLS.js player (A-B loop, frame step, subtitles, gestures)
│   │   ├── AdminDashboardPanel.tsx  # RBAC-protected Admin Console & SSRF/Rate-limit Audit Logs
│   │   ├── AndroidAppPanel.tsx      # Native Android Media3 ExoPlayer, Manifest & APK Release Portal
│   │   ├── PWAInstallButton.tsx     # Standalone WebAPK / PWA installer
│   │   └── OfflineIndicator.tsx     # Real-time connectivity banner
│   ├── data/
│   │   └── presets.ts               # Open-License (CC-BY 3.0 / Public Domain) MP4 & HLS streams
│   ├── db/
│   │   └── schema.sql               # Relational SQL schema & indexes (SQLite & PostgreSQL compatible)
│   ├── hooks/
│   │   └── usePWAInstall.ts         # Browser installability & online state hooks
│   ├── server/
│   │   ├── db.ts                    # SQLite (node:sqlite) database initialization & audit logger
│   │   ├── security.ts              # SSRF guard, DNS resolution, safe redirect follower, scrypt auth
│   │   └── downloadManager.ts       # Multi-job priority download queue, HLS processor, SHA-256 verifier
│   ├── App.tsx                      # Main 9-module studio workspace
│   ├── index.css                    # NOIR Dark Cinematic & Studio Light theme variables
│   ├── main.tsx                     # Application entry point
│   └── types.ts                     # Shared TypeScript interfaces
├── tests/
│   └── noir-studio.test.ts          # Automated SSRF, URL validation, auth, and download lifecycle tests
├── capacitor.config.json            # Capacitor Android native project configuration
├── server.ts                        # Full-stack Express API gateway + Vite middleware
├── package.json
└── vite.config.ts
```

---

## 2. Core Features & Technical Capabilities

1. **Universal Video Player (`UniversalPlayer.tsx`)**:
   - Direct `MP4`, `WebM`, `OGV`, Local files, and Adaptive `HLS / M3U8` via `hls.js` + native Safari fallback.
   - Speed control (`0.25x` to `2.0x`), HLS bitrate/resolution selector, Audio track selector, `.SRT`/`.VTT` subtitle import (with automatic SRT-to-VTT conversion), A–B Repeat Loop, Frame-by-frame stepping (`,`/`.`), Double-tap `-10s`/`+10s` seek, Mobile vertical swipe gestures for Brightness & Volume, Picture-in-Picture, and Screen Orientation Lock.
2. **Smart URL Analyzer (`POST /api/video/inspect`)**:
   - Inspects direct media streams across up to 5 validated HTTP redirects.
   - Detects MIME type, file size, HTTP Range resume capability, CORS headers, and HLS variant streams/segments.
   - Explicitly detects general webpage URLs (YouTube, Facebook, TikTok, etc.) and encrypted DRM (`#EXT-X-KEY`) streams without attempting unauthorized DRM bypass.
3. **Advanced Download Manager (`/api/downloads`)**:
   - Persistent SQLite job queue with configurable concurrency (`1–5`), priority ordering (`high` > `normal` > `low`), real byte progress, speed (`MB/s`), ETA, HTTP `Range` Pause/Resume, Cancel with file cleanup, Auto-Retry on transient errors, Duplicate detection, and SHA-256 Checksum verification.
4. **Hardened Security (`src/server/security.ts`)**:
   - Full SSRF protection blocking `localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254` (cloud metadata), IPv6 `::1`/`fc00::/7`/`fe80::/10`, and IPv4-mapped IPv6 addresses.
   - DNS resolution validation on every redirect hop to prevent DNS rebinding.

---

## 3. Setup, Run & Testing Instructions

```bash
# 1. Install dependencies
npm install

# 2. Run automated security & download lifecycle unit tests
npm test

# 3. Start full-stack development server (Port 3000)
npm run dev

# 4. Build production frontend bundle
npm run build

# 5. Start production server
npm start
```

---

## 4. Android APK / AAB Build & GitHub Release

### Option A: Automated GitHub Actions APK Release
Push this repository to GitHub and create a version tag (e.g., `v2.0.0`):
```bash
git add .
git commit -m "release: NOIR Video Studio v2.0.0"
git tag v2.0.0
git push origin main --tags
```
The workflow in `.github/workflows/android-apk-release.yml` automatically runs unit tests, compiles the production web bundle, initializes Capacitor Android, builds `NOIR-Video-Studio-debug.apk`, and attaches it to a new GitHub Release.

### Option B: Local Android Studio Build
```bash
npm run build
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
```
For native Jetpack Media3 ExoPlayer and Android 10+ Scoped Storage integration, copy `NoirNativeMediaEngine.kt` and `AndroidManifest.xml` from the **09. Android & APK** tab inside the application.
