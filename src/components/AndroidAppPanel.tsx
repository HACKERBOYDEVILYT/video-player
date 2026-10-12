import React, { useState, useEffect } from 'react';
import {
  Smartphone,
  Copy,
  Check,
  Download,
  Code2,
  ShieldCheck,
  Layers,
  GitBranch,
  Globe,
  Terminal,
  ExternalLink,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface AndroidAppPanelProps {
  mobilePreviewMode: boolean;
  onToggleMobilePreview: () => void;
}

const RELEASE_YAML_CODE = `name: Android APK & Production Bundle Release (release.yml)

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      release_tag:
        description: 'Release version tag (e.g. v2.0.0)'
        required: false
        default: 'v2.0.0'

permissions:
  contents: write

jobs:
  android-apk-release:
    name: Build Android APK & Publish GitHub Release
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Setup Java JDK 21 (Temurin)
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '21'

      - name: Setup Android SDK
        uses: android-actions/setup-android@v3

      - name: Install Dependencies, Run Security Tests & Build Web Bundle
        run: |
          npm install
          npm test
          npm run lint
          npm run build

      - name: Sync Capacitor Android Project
        run: |
          npm install @capacitor/core @capacitor/cli @capacitor/android
          if [ ! -d "android" ]; then
            npx cap add android
          fi
          npx cap sync android

      - name: Build Android Debug & Release APK / AAB
        working-directory: ./android
        run: |
          chmod +x gradlew
          ./gradlew assembleDebug assembleRelease bundleRelease

      - name: Package Release Artifacts (APK, AAB & Web Dist Zip)
        run: |
          mkdir -p release-artifacts
          cp android/app/build/outputs/apk/debug/app-debug.apk release-artifacts/NOIR-Video-Studio-debug.apk
          if [ -f android/app/build/outputs/apk/release/app-release-unsigned.apk ]; then
            cp android/app/build/outputs/apk/release/app-release-unsigned.apk release-artifacts/NOIR-Video-Studio-release-unsigned.apk
          fi
          if [ -f android/app/build/outputs/bundle/release/app-release.aab ]; then
            cp android/app/build/outputs/bundle/release/app-release.aab release-artifacts/NOIR-Video-Studio-release.aab
          fi
          tar -czf release-artifacts/NOIR-Video-Studio-web-bundle.tar.gz dist server.ts package.json capacitor.config.json

      - name: Generate SHA-256 Checksums for Release Assets
        working-directory: ./release-artifacts
        run: sha256sum * > SHA256SUMS.txt

      - name: Upload Artifacts to GitHub Actions Run
        uses: actions/upload-artifact@v4
        with:
          name: NOIR-Video-Studio-Release-Bundle
          path: release-artifacts/*

      - name: Create GitHub Release & Attach APK / Web Bundle
        uses: softprops/action-gh-release@v2
        with:
          tag_name: \${{ github.ref_type == 'tag' && github.ref_name || inputs.release_tag || 'v2.0.0' }}
          name: "NOIR Video Studio (Robiul Video Studio) \${{ github.ref_type == 'tag' && github.ref_name || inputs.release_tag || 'v2.0.0' }}"
          files: release-artifacts/*
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}`;

const WEBSITE_YAML_CODE = `name: Website CI/CD Build, Test & Deploy (website.yml)

on:
  push:
    branches: [ main, master ]
  pull_request:
    branches: [ main, master ]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "website-deploy"
  cancel-in-progress: true

jobs:
  build-and-test-website:
    name: Lint, Security Test & Build Website Bundle
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install Dependencies
        run: npm install --no-audit --no-fund

      - name: Run TypeScript Typecheck & Linting
        run: npm run lint

      - name: Run SSRF Security & Download Lifecycle Unit Tests
        run: npm test

      - name: Build Production Website & PWA Assets (Vite + Workbox)
        env:
          GITHUB_ACTIONS: 'true'
        run: npm run build

      - name: Add SPA Fallback (404.html) & .nojekyll for GitHub Pages
        run: |
          cp dist/index.html dist/404.html
          touch dist/.nojekyll

      - name: Upload Production Website Build Artifact
        uses: actions/upload-artifact@v4
        with:
          name: noir-website-dist
          path: dist/

      - name: Enable & Configure GitHub Pages Automatically
        if: github.event_name != 'pull_request'
        uses: actions/configure-pages@v5
        with:
          enablement: true

      - name: Upload GitHub Pages Artifact
        if: github.event_name != 'pull_request'
        uses: actions/upload-pages-artifact@v3
        with:
          path: './dist'

  deploy-website:
    name: Deploy Website to GitHub Pages
    if: github.event_name != 'pull_request' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/master')
    needs: build-and-test-website
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}

    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4`;

const KOTLIN_EXOPLAYER_CODE = `// NOIR Video Studio (Robiul Video Studio) — Native Android Implementation
// Features: Media3 ExoPlayer, Background Playback MediaSession, PiP, Foreground DownloadService, Scoped Storage
package com.noir.videostudio

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession

class NoirNativeMediaEngine(private val context: Context) {
    var exoPlayer: ExoPlayer? = null
    private var mediaSession: MediaSession? = null

    fun initializePlayer(streamUrl: String, playInBackground: Boolean = true): ExoPlayer {
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
            .build()

        val player = ExoPlayer.Builder(context)
            .setAudioAttributes(audioAttributes, true)
            .setHandleAudioBecomingNoisy(true)
            .build()

        val isHls = streamUrl.lowercase().contains(".m3u8")
        val mediaItem = if (isHls) {
            MediaItem.Builder()
                .setUri(Uri.parse(streamUrl))
                .setMimeType(MimeTypes.APPLICATION_M3U8)
                .build()
        } else {
            MediaItem.fromUri(Uri.parse(streamUrl))
        }

        player.setMediaItem(mediaItem)
        player.prepare()

        if (playInBackground) {
            mediaSession = MediaSession.Builder(context, player).build()
        }
        exoPlayer = player
        return player
    }

    fun extractSharedStreamUrl(intent: Intent?): String? {
        if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            return intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()
        }
        if (intent?.action == Intent.ACTION_VIEW) {
            return intent.dataString
        }
        return null
    }

    fun saveToPublicDownloadsScoped(fileName: String, mimeType: String, bytes: ByteArray): Uri? {
        val resolver = context.contentResolver
        val contentValues = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            put(MediaStore.Downloads.MIME_TYPE, mimeType)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/NOIRVideoStudio")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues) ?: return null
        resolver.openOutputStream(uri)?.use { it.write(bytes) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            contentValues.clear()
            contentValues.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, contentValues, null, null)
        }
        return uri
    }

    fun release() {
        mediaSession?.release()
        mediaSession = null
        exoPlayer?.release()
        exoPlayer = null
    }
}`;

const ANDROID_MANIFEST_XML = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.noir.videostudio">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <application
        android:allowBackup="true"
        android:label="NOIR Video Studio"
        android:supportsRtl="true"
        android:usesCleartextTraffic="false"
        android:theme="@style/Theme.AppCompat.DayNight.NoActionBar">

        <activity
            android:name=".MainActivity"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:supportsPictureInPicture="true"
            android:launchMode="singleTask"
            android:exported="true">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>

            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="http" />
                <data android:scheme="https" />
                <data android:scheme="content" />
                <data android:mimeType="video/*" />
                <data android:mimeType="application/vnd.apple.mpegurl" />
                <data android:mimeType="application/x-mpegurl" />
            </intent-filter>
        </activity>
    </application>
</manifest>`;

export const AndroidAppPanel: React.FC<AndroidAppPanelProps> = ({
  mobilePreviewMode,
  onToggleMobilePreview,
}) => {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [activeCodeTab, setActiveCodeTab] = useState<
    'release_yml' | 'website_yml' | 'kotlin' | 'manifest'
  >('release_yml');
  const [copied, setCopied] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCli, setCopiedCli] = useState(false);
  const [repoSlug, setRepoSlug] = useState('robiul/noir-video-studio');
  const [releaseTag, setReleaseTag] = useState('v2.0.0');
  const [liveDeployUrl, setLiveDeployUrl] = useState<string>(
    typeof window !== 'undefined' ? window.location.origin : ''
  );

  useEffect(() => {
    fetch('/api/release/status')
      .then((r) => r.json())
      .then((data) => {
        if (data?.deployedUrl && data.deployedUrl !== 'MY_APP_URL') {
          setLiveDeployUrl(data.deployedUrl);
        }
      })
      .catch(() => undefined);
  }, []);

  const currentCode =
    activeCodeTab === 'release_yml'
      ? RELEASE_YAML_CODE
      : activeCodeTab === 'website_yml'
      ? WEBSITE_YAML_CODE
      : activeCodeTab === 'kotlin'
      ? KOTLIN_EXOPLAYER_CODE
      : ANDROID_MANIFEST_XML;

  const gitReleaseCommands = `git init
git add .
git commit -m "feat: add release.yml and website.yml for NOIR Video Studio ${releaseTag}"
git branch -M main
git remote add origin https://github.com/${repoSlug}.git
git push -u origin main
git tag ${releaseTag}
git push origin ${releaseTag}`;

  const handleCopyCode = async () => {
    await navigator.clipboard.writeText(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyAppUrl = async () => {
    await navigator.clipboard.writeText(liveDeployUrl || window.location.href);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleCopyCli = async () => {
    await navigator.clipboard.writeText(gitReleaseCommands);
    setCopiedCli(true);
    setTimeout(() => setCopiedCli(false), 2000);
  };

  const handleDownloadSourceFile = () => {
    const blob = new Blob([currentCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      activeCodeTab === 'release_yml'
        ? 'release.yml'
        : activeCodeTab === 'website_yml'
        ? 'website.yml'
        : activeCodeTab === 'kotlin'
        ? 'NoirNativeMediaEngine.kt'
        : 'AndroidManifest.xml';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Live Cloud Deployment & GitHub APK Release Status Card */}
      <div className="noir-card rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="max-w-2xl">
            <h2 className="text-lg sm:text-xl font-bold">
              NOIR Video Studio — GitHub CI/CD (<code className="text-rose-400">release.yml</code> ও <code className="text-rose-400">website.yml</code>) এবং Android পোর্টাল
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-zinc-300 leading-relaxed">
              প্রজেক্টের <code className="font-mono text-rose-400">.github/workflows/release.yml</code> (Android APK, AAB এবং SHA-256 চেকসামসহ GitHub রিলিজ) এবং <code className="font-mono text-rose-400">.github/workflows/website.yml</code> (Website লিন্টিং, সিকিউরিটি টেস্ট, প্রোডাকশন বিল্ড ও স্বয়ংক্রিয় ওয়েবসাইট ডিপ্লয়মেন্ট) দুটিই যুক্ত করা হয়েছে।
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400 font-mono tabular-nums">
              <span className="text-rose-400">release.yml (APK/AAB Release)</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-400">website.yml (Website Deploy)</span>
              <span aria-hidden="true">·</span>
              <span>Media3 ExoPlayer</span>
              <span aria-hidden="true">·</span>
              <span className="text-violet-400">Scoped Storage Ready</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              onClick={onToggleMobilePreview}
              className="min-h-[44px] px-4 py-2.5 rounded-xl noir-subcard text-xs font-semibold hover:border-rose-500/50 transition-colors flex items-center gap-2 whitespace-nowrap"
            >
              <Smartphone className="w-4 h-4 text-rose-400" />
              <span>{mobilePreviewMode ? 'ডেস্কটপ ভিউতে ফিরুন' : 'Android Mobile প্রিভিউ'}</span>
            </button>

            {isInstallable ? (
              <button
                onClick={install}
                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-rose-600 text-xs font-semibold text-white hover:bg-rose-500 transition-colors flex items-center gap-2 whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                <span>Android WebAPK ইনস্টল করুন</span>
              </button>
            ) : (
              <button
                onClick={handleCopyAppUrl}
                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-rose-600 text-xs font-semibold text-white hover:bg-rose-500 transition-colors flex items-center gap-2 whitespace-nowrap"
              >
                {copiedUrl ? <Check className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                <span>
                  {copiedUrl
                    ? 'ডিপ্লয়েড URL কপি হয়েছে'
                    : isInstalled
                    ? 'অ্যাপ ইনস্টল করা আছে'
                    : 'লাইভ ডিপ্লয়েড লিংক কপি করুন'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Live Deployed URL & GitHub Trigger Configurator */}
        <div className="mt-6 pt-5 border-t noir-border grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 space-y-3">
            <h3 className="text-xs font-bold flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-rose-400" />
              <span>GitHub রিলিজ ও ওয়েবসাইট ডিপ্লয়মেন্ট কনফিগারেশন</span>
            </h3>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                GitHub Repository (owner/repo)
              </label>
              <input
                type="text"
                value={repoSlug}
                onChange={(e) => setRepoSlug(e.target.value)}
                className="w-full min-h-[40px] px-3 py-2 noir-subcard rounded-lg text-xs font-mono focus:outline-none focus:border-rose-500"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                APK Release Version Tag
              </label>
              <input
                type="text"
                value={releaseTag}
                onChange={(e) => setReleaseTag(e.target.value)}
                className="w-full min-h-[40px] px-3 py-2 noir-subcard rounded-lg text-xs font-mono tabular-nums focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="pt-1 flex items-center justify-between text-xs text-zinc-400">
              <span>Live Web & API Host:</span>
              <a
                href={liveDeployUrl || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-rose-400 hover:underline flex items-center gap-1 truncate max-w-[220px]"
              >
                <span className="truncate">{liveDeployUrl}</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            </div>
          </div>

          <div className="lg:col-span-7 noir-subcard rounded-xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2 pb-2.5 border-b noir-border">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <Terminal className="w-4 h-4 text-rose-400" />
                <span>GitHub Push & Tag Release Commands</span>
              </div>
              <button
                onClick={handleCopyCli}
                className="min-h-[32px] px-2.5 py-1 rounded-md noir-card text-xs hover:border-rose-500/50 transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                {copiedCli ? <Check className="w-3.5 h-3.5 text-rose-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedCli ? 'কপি হয়েছে' : 'কমান্ড কপি করুন'}</span>
              </button>
            </div>
            <pre className="mt-3 text-xs font-mono text-zinc-300 overflow-x-auto leading-relaxed">
              <code>{gitReleaseCommands}</code>
            </pre>
          </div>
        </div>
      </div>

      {/* 3-Column Native Android & CI/CD Capability Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="noir-card rounded-2xl p-5">
          <div className="flex items-center gap-2.5 text-rose-400 mb-2">
            <Layers className="w-5 h-5" />
            <h3 className="text-sm font-bold">১. release.yml (APK, AAB ও SHA-256)</h3>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            ট্যাগ পুশ করলেই স্বয়ংক্রিয়ভাবে Debug APK, Release Unsigned APK, Play Store AAB এবং SHA-256 চেকসাম তৈরি করে GitHub Releases-এ যুক্ত করে।
          </p>
        </div>

        <div className="noir-card rounded-2xl p-5">
          <div className="flex items-center gap-2.5 text-rose-400 mb-2">
            <ShieldCheck className="w-5 h-5" />
            <h3 className="text-sm font-bold">২. website.yml (ওয়েবসাইট CI/CD ও ডিপ্লয়)</h3>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            প্রতিটি পুশে TypeScript লিন্ট, SSRF সিকিউরিটি ইউনিট টেস্ট, Vite প্রোডাকশন বিল্ড এবং স্বয়ংক্রিয় GitHub Pages ওয়েবসাইট ডিপ্লয়মেন্ট সম্পন্ন করে।
          </p>
        </div>

        <div className="noir-card rounded-2xl p-5">
          <div className="flex items-center gap-2.5 text-rose-400 mb-2">
            <Code2 className="w-5 h-5" />
            <h3 className="text-sm font-bold">৩. Media3 ExoPlayer ও Scoped Storage</h3>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Android অ্যাপের জন্য ব্যাকগ্রাউন্ড অডিও MediaSession, Share Menu রিসিভার এবং Android 10+ Scoped Storage ডাউনলোড ইঞ্জিন।
          </p>
        </div>
      </div>

      {/* Workflow (release.yml / website.yml) & Native Android Code Viewer */}
      <div className="noir-card rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b noir-border flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-1 p-1 noir-subcard rounded-lg">
            <button
              onClick={() => setActiveCodeTab('release_yml')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeCodeTab === 'release_yml'
                  ? 'bg-rose-600 text-white font-semibold'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              .github/workflows/release.yml
            </button>
            <button
              onClick={() => setActiveCodeTab('website_yml')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeCodeTab === 'website_yml'
                  ? 'bg-rose-600 text-white font-semibold'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              .github/workflows/website.yml
            </button>
            <button
              onClick={() => setActiveCodeTab('kotlin')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeCodeTab === 'kotlin'
                  ? 'bg-rose-600 text-white font-semibold'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              NoirNativeMediaEngine.kt
            </button>
            <button
              onClick={() => setActiveCodeTab('manifest')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeCodeTab === 'manifest'
                  ? 'bg-rose-600 text-white font-semibold'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              AndroidManifest.xml
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyCode}
              className="min-h-[38px] px-3 py-1.5 rounded-lg noir-subcard text-xs font-medium hover:border-rose-500/50 transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-rose-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'কপি সম্পন্ন' : 'কোড কপি করুন'}</span>
            </button>

            <button
              onClick={handleDownloadSourceFile}
              className="min-h-[38px] px-3 py-1.5 rounded-lg bg-rose-600 text-xs font-semibold text-white hover:bg-rose-500 transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>ফাইল ডাউনলোড</span>
            </button>
          </div>
        </div>

        <pre className="p-5 text-xs font-mono text-zinc-300 overflow-x-auto leading-relaxed bg-[#050508] max-h-[420px]">
          <code>{currentCode}</code>
        </pre>
      </div>
    </div>
  );
};
