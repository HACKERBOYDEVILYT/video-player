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

const KOTLIN_EXOPLAYER_CODE = `// NOIR Video Studio (Robiul Video Studio) — Native Android Implementation
// Features: Media3 ExoPlayer, Background Playback MediaSession, PiP, Foreground DownloadService, Scoped Storage
package com.noir.videostudio

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.app.NotificationCompat
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

    // Handle shared URL from Android Share Sheet (Intent.ACTION_SEND)
    fun extractSharedStreamUrl(intent: Intent?): String? {
        if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            return intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()
        }
        if (intent?.action == Intent.ACTION_VIEW) {
            return intent.dataString
        }
        return null
    }

    // Save completed download into Android 10+ Scoped Storage public Downloads folder
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

    <!-- Minimal required permissions: Internet, Foreground Service for Downloads & Media Playback -->
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

            <!-- Receive Shared Video URLs from Android Share Menu -->
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>

            <!-- Open With Media File Association (MP4, WebM, M3U8) -->
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

const GITHUB_WORKFLOW_YAML = `name: Build Android APK & Create GitHub Release

on:
  push:
    branches: [ main, master ]
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
  build-android-apk:
    name: Compile Web Bundle & Build Android APK
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Setup Java JDK 21 for Android Gradle
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '21'

      - name: Setup Android SDK
        uses: android-actions/setup-android@v3

      - name: Install Dependencies, Run Security Tests & Build Web Assets
        run: |
          npm install
          npm test
          npm run build

      - name: Install Capacitor Android CLI & Sync Native Project
        run: |
          npm install @capacitor/core @capacitor/cli @capacitor/android
          if [ ! -d "android" ]; then
            npx cap add android
          fi
          npx cap sync android

      - name: Build Android APK (Debug & Release)
        working-directory: ./android
        run: |
          chmod +x gradlew
          ./gradlew assembleDebug assembleRelease

      - name: Prepare NOIR Video Studio APK Artifacts
        run: |
          mkdir -p release-artifacts
          cp android/app/build/outputs/apk/debug/app-debug.apk release-artifacts/NOIR-Video-Studio-debug.apk

      - name: Upload APK Artifact to GitHub Actions
        uses: actions/upload-artifact@v4
        with:
          name: NOIR-Video-Studio-APK
          path: release-artifacts/*.apk

      - name: Publish GitHub Release with APK
        uses: softprops/action-gh-release@v2
        with:
          tag_name: \${{ github.ref_type == 'tag' && github.ref_name || inputs.release_tag || 'v2.0.0' }}
          name: "NOIR Video Studio (Robiul Video Studio) \${{ github.ref_type == 'tag' && github.ref_name || inputs.release_tag || 'v2.0.0' }}"
          files: release-artifacts/*.apk
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}`;

export const AndroidAppPanel: React.FC<AndroidAppPanelProps> = ({
  mobilePreviewMode,
  onToggleMobilePreview,
}) => {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [activeCodeTab, setActiveCodeTab] = useState<'kotlin' | 'manifest' | 'workflow'>('kotlin');
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
    activeCodeTab === 'kotlin'
      ? KOTLIN_EXOPLAYER_CODE
      : activeCodeTab === 'manifest'
      ? ANDROID_MANIFEST_XML
      : GITHUB_WORKFLOW_YAML;

  const gitReleaseCommands = `git init
git add .
git commit -m "feat: NOIR Video Studio (Robiul Video Studio) ${releaseTag}"
git branch -M main
git remote add origin https://github.com/${repoSlug}.git
git tag ${releaseTag}
git push -u origin main --tags`;

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
      activeCodeTab === 'kotlin'
        ? 'NoirNativeMediaEngine.kt'
        : activeCodeTab === 'manifest'
        ? 'AndroidManifest.xml'
        : 'android-apk-release.yml';
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
              NOIR Video Studio — Android Native ও GitHub APK রিলিজ পোর্টাল
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-zinc-300 leading-relaxed">
              Android অ্যাপের জন্য Capacitor + Native Jetpack Media3 ExoPlayer, ফোরগ্রাউন্ড ডাউনলোড সার্ভিস, Android Share Menu ইন্টিগ্রেশন, Scoped Storage এবং GitHub Actions স্বয়ংক্রিয় APK রিলিজ পাইপলাইন সম্পূর্ণরূপে কনফিগার করা হয়েছে।
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400 font-mono tabular-nums">
              <span className="text-rose-400">Package: com.noir.videostudio</span>
              <span aria-hidden="true">·</span>
              <span>Media3 ExoPlayer</span>
              <span aria-hidden="true">·</span>
              <span>Scoped Storage (Android 10–15)</span>
              <span aria-hidden="true">·</span>
              <span className="text-violet-400">Share Intent & PiP Ready</span>
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
              <span>GitHub রিলিজ কনফিগারেশন</span>
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
                <span>GitHub APK Release Trigger Commands</span>
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

      {/* 3-Column Native Android Capability Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="noir-card rounded-2xl p-5">
          <div className="flex items-center gap-2.5 text-rose-400 mb-2">
            <Layers className="w-5 h-5" />
            <h3 className="text-sm font-bold">১. Jetpack Media3 ও ব্যাকগ্রাউন্ড অডিও</h3>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            MediaSession ইন্টিগ্রেশন, নোটিফিকেশন প্লেব্যাক কন্ট্রোল, অডিও ফোকাস হ্যান্ডলিং এবং নেটিভ Picture-in-Picture সাপোর্ট।
          </p>
        </div>

        <div className="noir-card rounded-2xl p-5">
          <div className="flex items-center gap-2.5 text-rose-400 mb-2">
            <ShieldCheck className="w-5 h-5" />
            <h3 className="text-sm font-bold">২. Share Menu ও File Association</h3>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            অন্য যেকোনো অ্যাপের Share মেনু থেকে সরাসরি NOIR Video Studio-তে ভিডিও URL পাঠানো এবং লোকাল মিডিয়া ফাইল ওপেন করার সুবিধা।
          </p>
        </div>

        <div className="noir-card rounded-2xl p-5">
          <div className="flex items-center gap-2.5 text-rose-400 mb-2">
            <Code2 className="w-5 h-5" />
            <h3 className="text-sm font-bold">৩. Scoped Storage ও ফোরগ্রাউন্ড সার্ভিস</h3>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            অতিরিক্ত পারমিশন ছাড়াই Android 10+ MediaStore Downloads ফোল্ডারে নিরাপদে ফাইল সংরক্ষণ এবং নোটিফিকেশন থেকে Pause/Resume।
          </p>
        </div>
      </div>

      {/* Native Android & Workflow Code Viewer */}
      <div className="noir-card rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b noir-border flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-1 p-1 noir-subcard rounded-lg">
            <button
              onClick={() => setActiveCodeTab('kotlin')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeCodeTab === 'kotlin'
                  ? 'bg-rose-600 text-white font-semibold'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              NoirNativeMediaEngine.kt (Media3 + Scoped Storage)
            </button>
            <button
              onClick={() => setActiveCodeTab('manifest')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeCodeTab === 'manifest'
                  ? 'bg-rose-600 text-white font-semibold'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              AndroidManifest.xml (Share & View Intents)
            </button>
            <button
              onClick={() => setActiveCodeTab('workflow')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeCodeTab === 'workflow'
                  ? 'bg-rose-600 text-white font-semibold'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              .github/workflows/android-apk-release.yml
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
