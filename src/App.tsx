import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Download,
  ListVideo,
  History,
  Smartphone,
  Link2,
  FolderOpen,
  Search,
  CheckSquare,
  Square,
  Trash2,
  Plus,
  X,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  FileVideo,
  ShieldCheck,
  ClipboardPaste,
  Sliders,
  Heart,
  Share2,
  Edit3,
  Upload,
  Pause,
  RotateCcw,
  Sun,
  Moon,
  Home,
  Lock,
  Sparkles,
  HardDrive,
} from 'lucide-react';
import {
  VideoItem,
  VideoFormat,
  StreamInspectionResult,
  AnalyzedUrlRecord,
  BackendDownloadJob,
  DownloadPriority,
  HistoryEntry,
  Playlist,
  UserPreferences,
  NavSection,
} from './types';
import { PRESET_VIDEOS } from './data/presets';
import { UniversalPlayer, formatTimecode } from './components/UniversalPlayer';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { AndroidAppPanel } from './components/AndroidAppPanel';
import { AdminDashboardPanel } from './components/AdminDashboardPanel';

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) {
    return 'Stream';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

const STORAGE_KEYS = {
  HISTORY: 'noir_watch_history_v2',
  PLAYLISTS: 'noir_playlists_v2',
  FAVORITES: 'noir_favorites_v2',
  CUSTOM_MEDIA: 'noir_custom_media_v2',
};

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSection>('home');
  const [currentVideo, setCurrentVideo] = useState<VideoItem>(PRESET_VIDEOS[0]);
  const [resumeTimeSec, setResumeTimeSec] = useState<number>(0);
  const [theaterMode, setTheaterMode] = useState<boolean>(false);
  const [mobilePreviewMode, setMobilePreviewMode] = useState<boolean>(false);

  // User Preferences & Theme state
  const [preferences, setPreferences] = useState<UserPreferences>({
    user_id: 'default',
    theme: 'dark',
    max_concurrent_downloads: 2,
    auto_retry_downloads: 1,
    max_retry_count: 2,
    default_playback_speed: 1.0,
    storage_directory: '/storage/downloads',
    updated_at: new Date().toISOString(),
  });

  // Smart URL Analyzer state
  const [urlInput, setUrlInput] = useState<string>('');
  const [customTitle, setCustomTitle] = useState<string>('');
  const [selectedPriority, setSelectedPriority] = useState<DownloadPriority>('normal');
  const [isAuthorizedConfirmed, setIsAuthorizedConfirmed] = useState<boolean>(true);
  const [isInspecting, setIsInspecting] = useState<boolean>(false);
  const [inspectionResult, setInspectionResult] = useState<StreamInspectionResult | null>(null);
  const [analyzedHistory, setAnalyzedHistory] = useState<AnalyzedUrlRecord[]>([]);
  const [urlError, setUrlError] = useState<string | null>(null);

  // Backend Download Queue state
  const [downloadJobs, setDownloadJobs] = useState<BackendDownloadJob[]>([]);
  const [storageSummary, setStorageSummary] = useState<{
    totalFilesCount: number;
    totalDiskBytes: number;
    maxLimitMb: number;
  }>({ totalFilesCount: 0, totalDiskBytes: 0, maxLimitMb: 1024 });
  const [downloadFilter, setDownloadFilter] = useState<
    'ALL' | 'running' | 'queued' | 'paused' | 'completed' | 'failed'
  >('ALL');
  const [renamingJobId, setRenamingJobId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');

  // Media Library, Favorites, History & Playlists
  const [customMedia, setCustomMedia] = useState<VideoItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CUSTOM_MEDIA);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return [];
  });

  const [favoriteUrls, setFavoriteUrls] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.FAVORITES);
      if (saved) {
        const parsed: string[] = JSON.parse(saved);
        const filtered = parsed.filter((u) => !u.includes('gtv-videos-bucket'));
        if (filtered.length > 0) return filtered;
      }
    } catch {
      // ignore
    }
    return [PRESET_VIDEOS[0].url];
  });

  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.HISTORY);
      if (saved) {
        const parsed: HistoryEntry[] = JSON.parse(saved);
        const filtered = parsed.filter((h) => !h.url.includes('gtv-videos-bucket'));
        if (filtered.length > 0) return filtered;
      }
    } catch {
      // ignore
    }
    return [
      {
        id: PRESET_VIDEOS[0].id,
        title: PRESET_VIDEOS[0].title,
        url: PRESET_VIDEOS[0].url,
        format: PRESET_VIDEOS[0].format,
        thumbnail: PRESET_VIDEOS[0].thumbnail,
        lastPositionSec: 0,
        durationSec: 52,
        watchedAt: new Date(Date.now() - 1800 * 1000).toISOString(),
        license: PRESET_VIDEOS[0].license,
      },
    ];
  });

  const [playlists, setPlaylists] = useState<Playlist[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.PLAYLISTS);
      if (saved) {
        const parsed: Playlist[] = JSON.parse(saved);
        // Replace master playlist items with updated presets
        return parsed.map((pl) =>
          pl.id === 'pl-noir-master'
            ? { ...pl, items: PRESET_VIDEOS }
            : { ...pl, items: pl.items.filter((item) => !item.url.includes('gtv-videos-bucket')) }
        );
      }
    } catch {
      // ignore
    }
    return [
      {
        id: 'pl-noir-master',
        name: 'NOIR Cinema Master Queue',
        description: 'Robiul Video Studio কিউরেটেড MP4, WebM ও HLS স্ট্রিম প্লেলিস্ট',
        items: PRESET_VIDEOS,
        createdAt: new Date().toISOString(),
      },
    ];
  });

  const [activePlaylistId, setActivePlaylistId] = useState<string>('pl-noir-master');
  const [autoAdvanceQueue, setAutoAdvanceQueue] = useState<boolean>(true);
  const [newPlaylistName, setNewPlaylistName] = useState<string>('');

  // Library Filter & Sort state
  const [libraryTab, setLibraryTab] = useState<
    'ALL' | 'CONTINUE' | 'DOWNLOADED' | 'FAVORITES' | 'HISTORY'
  >('ALL');
  const [librarySearch, setLibrarySearch] = useState<string>('');
  const [libraryFormatFilter, setLibraryFormatFilter] = useState<'ALL' | 'MP4' | 'WEBM' | 'HLS'>(
    'ALL'
  );
  const [librarySortBy, setLibrarySortBy] = useState<'date' | 'name' | 'format'>('date');

  // Confirmation modal & toast state
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3400);
  }, []);

  // Sync theme class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (preferences.theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
  }, [preferences.theme]);

  // Fetch initial settings, download jobs & analyzer history from backend
  const fetchDownloadsAndStorage = useCallback(async () => {
    try {
      const resp = await fetch('/api/downloads');
      if (resp.ok) {
        const data = await resp.json();
        setDownloadJobs(data.jobs || []);
        if (data.storage) setStorageSummary(data.storage);
      }
    } catch {
      // ignore offline
    }
  }, []);

  const fetchAnalyzerHistory = useCallback(async () => {
    try {
      const resp = await fetch('/api/analyzer/history');
      if (resp.ok) {
        const data = await resp.json();
        setAnalyzedHistory(data.items || []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        if (data?.preferences) setPreferences(data.preferences);
      })
      .catch(() => undefined);

    fetchDownloadsAndStorage();
    fetchAnalyzerHistory();
  }, [fetchDownloadsAndStorage, fetchAnalyzerHistory]);

  // Poll backend download jobs whenever any job is running or queued
  useEffect(() => {
    const hasActive = downloadJobs.some((j) => j.status === 'running' || j.status === 'queued');
    const intervalMs = hasActive ? 750 : 4000;
    const timer = setInterval(() => {
      fetchDownloadsAndStorage();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [downloadJobs, fetchDownloadsAndStorage]);

  // LocalStorage sync for client library items
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
    } catch {
      // ignore
    }
  }, [history]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
    } catch {
      // ignore
    }
  }, [playlists]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favoriteUrls));
    } catch {
      // ignore
    }
  }, [favoriteUrls]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.CUSTOM_MEDIA, JSON.stringify(customMedia));
    } catch {
      // ignore
    }
  }, [customMedia]);

  const activePlaylist = playlists.find((p) => p.id === activePlaylistId) || playlists[0];

  // Record playback time into watch history
  const handleTimeUpdateRecord = useCallback(
    (currentTime: number, duration: number) => {
      setHistory((prev) => {
        const existingIndex = prev.findIndex((h) => h.url === currentVideo.url);
        const entry: HistoryEntry = {
          id: currentVideo.id,
          title: currentVideo.title,
          url: currentVideo.url,
          format: currentVideo.format,
          thumbnail: currentVideo.thumbnail,
          lastPositionSec: Math.floor(currentTime),
          durationSec: Math.floor(duration || 0),
          watchedAt: new Date().toISOString(),
          license: currentVideo.license,
        };
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated.splice(existingIndex, 1);
          return [entry, ...updated];
        }
        return [entry, ...prev.slice(0, 49)];
      });
    },
    [currentVideo]
  );

  // Auto-advance to next video in playlist
  const handleVideoEnded = useCallback(() => {
    if (!autoAdvanceQueue || !activePlaylist) return;
    const idx = activePlaylist.items.findIndex((item) => item.url === currentVideo.url);
    if (idx >= 0 && idx < activePlaylist.items.length - 1) {
      const nextVideo = activePlaylist.items[idx + 1];
      setResumeTimeSec(0);
      setCurrentVideo(nextVideo);
      showToast(`পরবর্তী ভিডিও চালু হচ্ছে: ${nextVideo.title}`);
    }
  }, [autoAdvanceQueue, activePlaylist, currentVideo.url, showToast]);

  // Toggle favorite video
  const handleToggleFavorite = useCallback(
    (video: VideoItem) => {
      setFavoriteUrls((prev) => {
        const exists = prev.includes(video.url);
        if (exists) {
          showToast('ফেভারিট তালিকা থেকে সরানো হয়েছে');
          return prev.filter((u) => u !== video.url);
        } else {
          showToast('ফেভারিট তালিকায় যুক্ত হয়েছে');
          return [video.url, ...prev];
        }
      });
    },
    [showToast]
  );

  // Paste from clipboard into URL input
  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrlInput(text.trim());
        setUrlError(null);
        showToast('ক্লিপবোর্ড থেকে লিংক পেস্ট করা হয়েছে');
      }
    } catch {
      showToast('ক্লিপবোর্ড পারমিশন পাওয়া যায়নি — কীবোর্ড দিয়ে পেস্ট করুন (Ctrl+V)');
    }
  };

  // Smart URL Analyzer: Inspect URL via Backend
  const handleInspectStreamUrl = async (targetUrlOverride?: string) => {
    const raw = (targetUrlOverride ?? urlInput).trim();
    if (!raw) {
      setUrlError('অনুগ্রহ করে একটি বৈধ MP4, WebM অথবা HLS (.m3u8) ভিডিও লিংক দিন।');
      return null;
    }

    setUrlError(null);
    setIsInspecting(true);
    setInspectionResult(null);

    try {
      const resp = await fetch('/api/video/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: raw }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setUrlError(data.error || 'স্ট্রিমটি যাচাই করা সম্ভব হয়নি।');
        setIsInspecting(false);
        return null;
      }
      const result = data as StreamInspectionResult;
      setInspectionResult(result);
      setIsInspecting(false);
      fetchAnalyzerHistory();
      return result;
    } catch {
      setUrlError('ব্যাকএন্ড সার্ভারের সাথে সংযোগ স্থাপন করা যায়নি।');
      setIsInspecting(false);
      return null;
    }
  };

  // Play URL directly
  const handleLoadAndPlayUrl = async (e?: React.FormEvent, overrideUrl?: string) => {
    if (e) e.preventDefault();
    const raw = (overrideUrl ?? urlInput).trim();
    if (!raw) {
      setUrlError('প্লে করার জন্য একটি বৈধ ভিডিও URL দিন।');
      return;
    }

    const inspected = await handleInspectStreamUrl(raw);
    if (!inspected && urlError) return;

    const detectedFormat: VideoFormat = inspected
      ? inspected.format
      : raw.toLowerCase().includes('.m3u8')
      ? 'HLS'
      : raw.toLowerCase().includes('.webm')
      ? 'WEBM'
      : 'MP4';

    const resolvedTitle =
      customTitle.trim() || inspected?.filename || `NOIR ${detectedFormat} Stream`;

    const newItem: VideoItem = {
      id: `custom-${Date.now()}`,
      title: resolvedTitle,
      subtitle: inspected
        ? `Verified ${inspected.contentType} · ${
            inspected.acceptRanges ? 'HTTP Range Supported' : 'Sequential Stream'
          }`
        : 'Direct Custom Stream URL',
      url: inspected ? inspected.finalUrl : raw,
      thumbnail: PRESET_VIDEOS[0].thumbnail,
      format: detectedFormat,
      resolution:
        inspected?.hlsVariants && inspected.hlsVariants.length > 0
          ? `${inspected.hlsVariants[0].resolution} HLS`
          : detectedFormat === 'HLS'
          ? 'Adaptive M3U8'
          : 'HD Stream',
      durationLabel: 'Stream',
      sizeLabel: inspected?.sizeBytes ? formatBytes(inspected.sizeBytes) : 'Stream',
      license: isAuthorizedConfirmed ? 'User Authorized Stream' : 'Standard Stream',
      isAuthorized: isAuthorizedConfirmed,
      addedAt: new Date().toISOString(),
    };

    setCustomMedia((prev) => {
      if (prev.some((m) => m.url === newItem.url)) return prev;
      return [newItem, ...prev];
    });

    setResumeTimeSec(0);
    setCurrentVideo(newItem);
    setActiveSection('player');
    showToast(`প্লেয়ারে স্ট্রিম লোড হয়েছে: ${newItem.title}`);
  };

  // Enqueue Authorized Download Job in Backend Queue
  const enqueueBackendDownload = useCallback(
    async (videoItem: VideoItem, priorityOverride?: DownloadPriority) => {
      if (!isAuthorizedConfirmed && !videoItem.isAuthorized) {
        setUrlError(
          'অনুমতি ছাড়া ভিডিও ডাউনলোড নিষিদ্ধ। অনুগ্রহ করে "অনুমতিপ্রাপ্ত ভিডিও" চেকবক্সটি নিশ্চিত করুন।'
        );
        showToast('ডাউনলোডের পূর্বে বৈধ অনুমতি বা লাইসেন্স নিশ্চিত করুন');
        return;
      }

      if (videoItem.url.startsWith('blob:')) {
        const a = document.createElement('a');
        a.href = videoItem.url;
        a.download = videoItem.title || 'local-video.mp4';
        a.click();
        showToast('লোকাল ফাইল সংরক্ষিত হয়েছে');
        return;
      }

      try {
        const resp = await fetch('/api/downloads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: videoItem.title,
            url: videoItem.url,
            format: videoItem.format,
            priority: priorityOverride || selectedPriority,
            authorized: true,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          setUrlError(data.error || 'ডাউনলোড কিউতে যুক্ত করা যায়নি।');
          showToast(data.error || 'ডাউনলোড ত্রুটি');
          return;
        }
        if (data.isDuplicate) {
          showToast(`ডুপ্লিকেট ফাইল শনাক্ত হয়েছে: "${data.job.filename}" ইতিমধ্যে ডাউনলোড করা আছে`);
        } else {
          showToast(`ডাউনলোড কিউতে যুক্ত হয়েছে: ${videoItem.title}`);
        }
        fetchDownloadsAndStorage();
      } catch {
        showToast('সার্ভারের সাথে সংযোগ বিচ্ছিন্ন হয়েছে');
      }
    },
    [isAuthorizedConfirmed, selectedPriority, fetchDownloadsAndStorage, showToast]
  );

  // Control Download Job (Pause / Resume / Cancel / Retry)
  const handleDownloadJobAction = async (
    jobId: string,
    action: 'pause' | 'resume' | 'cancel' | 'retry'
  ) => {
    try {
      const resp = await fetch(`/api/downloads/${jobId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (resp.ok) {
        fetchDownloadsAndStorage();
        const labelMap = {
          pause: 'পজ (Paused) করা হয়েছে',
          resume: 'পুনরায় শুরু (Resumed) হয়েছে',
          cancel: 'বাতিল (Cancelled) করা হয়েছে',
          retry: 'পুনরায় চেষ্টা (Retrying) করা হচ্ছে',
        };
        showToast(`ডাউনলোড জব ${labelMap[action]}`);
      }
    } catch {
      showToast('অ্যাকশন সম্পন্ন করা যায়নি');
    }
  };

  // Rename Downloaded File
  const handleRenameJobSubmit = async (jobId: string) => {
    if (!renameValue.trim()) return;
    try {
      const resp = await fetch(`/api/downloads/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: renameValue.trim() }),
      });
      if (resp.ok) {
        setRenamingJobId(null);
        setRenameValue('');
        fetchDownloadsAndStorage();
        showToast('ফাইলের নাম পরিবর্তন করা হয়েছে');
      }
    } catch {
      showToast('নাম পরিবর্তন ব্যর্থ হয়েছে');
    }
  };

  // Delete Download Job & File with Confirmation Dialog
  const confirmDeleteDownloadJob = (job: BackendDownloadJob) => {
    setConfirmModal({
      title: 'ডাউনলোড ও ফাইল মুছে ফেলবেন?',
      message: `আপনি কি নিশ্চিতভাবে "${job.filename}" ডাউনলোড রেকর্ড এবং স্টোরেজ ফাইলটি মুছে ফেলতে চান?`,
      onConfirm: async () => {
        setConfirmModal(null);
        await fetch(`/api/downloads/${job.id}`, { method: 'DELETE' });
        fetchDownloadsAndStorage();
        showToast('ডাউনলোড ফাইল মুছে ফেলা হয়েছে');
      },
    });
  };

  // Open local video file (.mp4, .webm, .mkv) from device
  const handleLocalFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    const ext = file.name.split('.').pop()?.toUpperCase() || 'LOCAL';
    const format: VideoFormat =
      ext === 'WEBM' ? 'WEBM' : ext === 'OGV' || ext === 'OGG' ? 'OGV' : 'MP4';

    const localVideo: VideoItem = {
      id: `local-${Date.now()}`,
      title: file.name,
      subtitle: 'লোকাল ডিভাইস ফাইল · অফলাইন ডিরেক্ট প্লেব্যাক',
      url: objectUrl,
      thumbnail: PRESET_VIDEOS[2].thumbnail,
      format,
      resolution: 'Local Media',
      durationLabel: 'Local',
      sizeLabel: formatBytes(file.size),
      license: 'Local Device File',
      isAuthorized: true,
      addedAt: new Date().toISOString(),
    };

    setCustomMedia((prev) => [localVideo, ...prev]);
    setResumeTimeSec(0);
    setCurrentVideo(localVideo);
    setActiveSection('player');
    showToast(`লোকাল ভিডিও ফাইল চালু হয়েছে: ${file.name}`);
  };

  // Add video to active playlist
  const handleAddToPlaylist = useCallback(
    (video: VideoItem) => {
      setPlaylists((prev) =>
        prev.map((pl) => {
          if (pl.id !== activePlaylistId) return pl;
          if (pl.items.some((i) => i.url === video.url)) return pl;
          return { ...pl, items: [...pl.items, video] };
        })
      );
      showToast(`"${activePlaylist?.name}" প্লেলিস্টে যুক্ত করা হয়েছে`);
    },
    [activePlaylistId, activePlaylist?.name, showToast]
  );

  // Export Library & Playlists Backup JSON
  const handleExportLibraryBackup = () => {
    const payload = {
      app: 'NOIR Video Studio (Robiul Video Studio)',
      exportedAt: new Date().toISOString(),
      playlists,
      history,
      favoriteUrls,
      customMedia,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `noir-video-studio-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('মিডিয়া লাইব্রেরি ও প্লেলিস্ট ব্যাকআপ এক্সপোর্ট হয়েছে');
  };

  // Import Library & Playlists Backup JSON
  const handleImportLibraryBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed.playlists)) setPlaylists(parsed.playlists);
      if (Array.isArray(parsed.history)) setHistory(parsed.history);
      if (Array.isArray(parsed.favoriteUrls)) setFavoriteUrls(parsed.favoriteUrls);
      if (Array.isArray(parsed.customMedia)) setCustomMedia(parsed.customMedia);
      showToast('ব্যাকআপ ফাইল থেকে লাইব্রেরি ও প্লেলিস্ট রিস্টোর সম্পন্ন হয়েছে');
    } catch {
      showToast('ব্যাকআপ JSON ফাইলটি সঠিক নয়');
    }
  };

  // Save User Preferences to Backend
  const handleSaveSettings = async (nextPrefs: UserPreferences) => {
    setPreferences(nextPrefs);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextPrefs),
      });
      showToast('সেটিংস সফলভাবে সংরক্ষিত হয়েছে');
    } catch {
      showToast('লোকাল সেটিংস আপডেট হয়েছে');
    }
  };

  // Combined Media Library items
  const allLibraryVideos: VideoItem[] = [
    ...PRESET_VIDEOS,
    ...customMedia.filter((cm) => !PRESET_VIDEOS.some((p) => p.url === cm.url)),
    ...downloadJobs
      .filter((j) => j.status === 'completed')
      .map((j) => ({
        id: j.id,
        title: j.title,
        subtitle: `Downloaded File · SHA-256: ${(j.sha256_checksum || '').slice(0, 12)}...`,
        url: `/api/downloads/${j.id}/file`,
        thumbnail: PRESET_VIDEOS[1].thumbnail,
        format: j.format,
        resolution: 'Offline Saved',
        durationLabel: 'Saved',
        sizeLabel: formatBytes(j.loaded_bytes),
        license: 'Downloaded Local Copy',
        isAuthorized: true,
        isDownloaded: true,
        addedAt: j.updated_at,
      })),
  ];

  const filteredDownloadJobs = downloadJobs.filter((job) => {
    if (downloadFilter === 'ALL') return true;
    return job.status === downloadFilter;
  });

  const activeRunningCount = downloadJobs.filter(
    (j) => j.status === 'running' || j.status === 'queued'
  ).length;

  return (
    <div className="min-h-screen noir-canvas pb-20 md:pb-12">
      <OfflineIndicator />

      {/* Confirmation Dialog Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md noir-card rounded-2xl p-6 shadow-2xl">
            <h3 className="text-base font-bold">{confirmModal.title}</h3>
            <p className="mt-2 text-xs text-zinc-300 leading-relaxed">{confirmModal.message}</p>
            <div className="mt-5 flex items-center justify-end gap-2.5">
              <button
                onClick={() => setConfirmModal(null)}
                className="min-h-[40px] px-4 py-2 rounded-lg noir-subcard text-xs font-medium"
              >
                বাতিল করুন
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500"
              >
                নিশ্চিত করুন
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-20 md:bottom-6 right-4 z-50 noir-card border-rose-500/60 px-4 py-2.5 rounded-xl shadow-2xl text-xs font-medium flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-rose-500 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/ogg,.mp4,.webm,.mkv,.mov"
        onChange={handleLocalFileSelect}
        className="hidden"
      />
      <input
        ref={backupInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleImportLibraryBackup}
        className="hidden"
      />

      {/* TOP BAR CONTRACT: Strictly 1 row, 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 noir-card border-t-0 border-x-0 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-4 sm:px-6 h-14">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="#home"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('home');
            }}
            className="text-lg font-bold tracking-tight hover:text-rose-500 transition-colors whitespace-nowrap shrink-0 font-display"
          >
            NOIR Video Studio
          </a>

          {/* Zone 2: 5 concise single-line text navigation links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-400">
            <a
              href="#home"
              onClick={(e) => {
                e.preventDefault();
                setActiveSection('home');
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeSection === 'home'
                  ? 'text-rose-500 border-rose-500'
                  : 'border-transparent hover:text-rose-400'
              }`}
            >
              Home
            </a>
            <a
              href="#player"
              onClick={(e) => {
                e.preventDefault();
                setActiveSection('player');
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeSection === 'player'
                  ? 'text-rose-500 border-rose-500'
                  : 'border-transparent hover:text-rose-400'
              }`}
            >
              Player
            </a>
            <a
              href="#downloads"
              onClick={(e) => {
                e.preventDefault();
                setActiveSection('downloads');
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeSection === 'downloads'
                  ? 'text-rose-500 border-rose-500'
                  : 'border-transparent hover:text-rose-400'
              }`}
            >
              Downloader {activeRunningCount > 0 ? `(${activeRunningCount})` : ''}
            </a>
            <a
              href="#library"
              onClick={(e) => {
                e.preventDefault();
                setActiveSection('library');
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeSection === 'library'
                  ? 'text-rose-500 border-rose-500'
                  : 'border-transparent hover:text-rose-400'
              }`}
            >
              Library
            </a>
            <a
              href="#admin"
              onClick={(e) => {
                e.preventDefault();
                setActiveSection('admin');
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeSection === 'admin'
                  ? 'text-rose-500 border-rose-500'
                  : 'border-transparent hover:text-rose-400'
              }`}
            >
              Admin
            </a>
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center shrink-0">
            <PWAInstallButton onOpenAndroidGuide={() => setActiveSection('android')} />
          </div>
        </div>
      </header>

      {/* Main Responsive Workspace Container */}
      <main
        className={`mx-auto px-4 sm:px-6 pt-5 transition-all duration-200 ${
          mobilePreviewMode
            ? 'max-w-[420px] border-x noir-border min-h-[calc(100vh-3.5rem)] shadow-2xl'
            : 'max-w-7xl'
        }`}
      >
        {/* Secondary Workspace Studio Bar (All 9 Modules + Theme Switcher) */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5 pb-3 border-b noir-border">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {(
              [
                { id: 'home', label: '01. Home Studio' },
                { id: 'player', label: '02. Video Player' },
                { id: 'analyzer', label: '03. Smart Analyzer' },
                { id: 'downloads', label: `04. Downloader (${downloadJobs.length})` },
                { id: 'library', label: '05. Media Library' },
                { id: 'playlists', label: '06. Playlists' },
                { id: 'settings', label: '07. Settings' },
                { id: 'admin', label: '08. Admin Console' },
                { id: 'android', label: '09. Android & APK' },
              ] as Array<{ id: NavSection; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveSection(tab.id)}
                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeSection === tab.id
                    ? 'bg-rose-600 text-white font-semibold'
                    : 'noir-subcard text-zinc-400 hover:text-rose-400'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() =>
                handleSaveSettings({
                  ...preferences,
                  theme: preferences.theme === 'dark' ? 'light' : 'dark',
                })
              }
              title="Dark / Light থিম পরিবর্তন করুন"
              className="min-h-[36px] px-3 py-1.5 rounded-lg noir-subcard text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
            >
              {preferences.theme === 'dark' ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-rose-400" />
                  <span>Light Theme</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-rose-600" />
                  <span>NOIR Dark</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Universal Smart URL Input & Action Bar (Paste, Clear, Analyze, Play, Download) */}
        <section className="noir-card rounded-2xl p-4 sm:p-5 mb-6">
          <form onSubmit={(e) => handleLoadAndPlayUrl(e)} className="space-y-3.5">
            <div className="flex flex-col lg:flex-row gap-3">
              {/* Stream URL Input with Paste & Clear */}
              <div className="relative flex-1 flex items-center">
                <Link2 className="w-4 h-4 text-zinc-400 absolute left-3.5 pointer-events-none" />
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => {
                    setUrlInput(e.target.value);
                    setUrlError(null);
                  }}
                  placeholder="Direct MP4, WebM অথবা HLS (.m3u8) স্ট্রিম URL পেস্ট করুন..."
                  className="w-full min-h-[44px] pl-10 pr-24 py-2.5 noir-subcard rounded-xl text-sm placeholder:text-zinc-500 focus:outline-none focus:border-rose-500 transition-colors"
                />
                <div className="absolute right-2 flex items-center gap-1">
                  {urlInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setUrlInput('');
                        setInspectionResult(null);
                        setUrlError(null);
                      }}
                      title="Clear URL"
                      className="px-2 py-1 text-xs text-zinc-400 hover:text-rose-400"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handlePasteClipboard}
                    title="ক্লিপবোর্ড থেকে পেস্ট করুন"
                    className="px-2.5 py-1 rounded-md noir-card text-xs font-medium text-rose-400 hover:border-rose-500/50 flex items-center gap-1"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" />
                    <span>Paste</span>
                  </button>
                </div>
              </div>

              {/* Custom Title & Priority */}
              <div className="flex gap-2 lg:w-72">
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="ভিডিওর নাম (ঐচ্ছিক)"
                  className="flex-1 min-h-[44px] px-3 py-2.5 noir-subcard rounded-xl text-xs placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
                />
                <select
                  value={selectedPriority}
                  onChange={(e) => setSelectedPriority(e.target.value as DownloadPriority)}
                  aria-label="Download Priority"
                  className="min-h-[44px] px-2.5 py-2 noir-subcard rounded-xl text-xs font-medium focus:outline-none focus:border-rose-500"
                >
                  <option value="high">High Priority</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low Priority</option>
                </select>
              </div>

              {/* Analyze, Play, Download, Local File Actions */}
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleInspectStreamUrl()}
                  disabled={isInspecting}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl noir-subcard text-xs font-semibold hover:border-rose-500/50 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`w-4 h-4 text-rose-500 ${isInspecting ? 'animate-spin' : ''}`} />
                  <span>Analyze</span>
                </button>

                <button
                  type="submit"
                  className="min-h-[44px] px-4 py-2 rounded-xl noir-subcard border-rose-500/50 text-rose-400 text-xs font-semibold hover:bg-rose-600 hover:text-white transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Play</span>
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const raw = urlInput.trim();
                    if (!raw) {
                      setUrlError('ডাউনলোড করার জন্য একটি বৈধ ভিডিও URL দিন।');
                      return;
                    }
                    const inspected = inspectionResult || (await handleInspectStreamUrl(raw));
                    if (!inspected) return;
                    enqueueBackendDownload({
                      id: `dl-${Date.now()}`,
                      title: customTitle.trim() || inspected.filename,
                      subtitle: inspected.contentType,
                      url: inspected.finalUrl,
                      thumbnail: PRESET_VIDEOS[0].thumbnail,
                      format: inspected.format,
                      resolution: inspected.isHls ? 'Adaptive M3U8' : 'Direct Stream',
                      durationLabel: 'Stream',
                      sizeLabel: formatBytes(inspected.sizeBytes),
                      license: 'Authorized',
                      isAuthorized: isAuthorizedConfirmed,
                    });
                  }}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Download className="w-4 h-4" />
                  <span>Download</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="ডিভাইস থেকে লোকাল MP4/WebM ফাইল ওপেন করুন"
                  className="min-h-[44px] px-3 py-2 rounded-xl noir-subcard text-xs font-semibold hover:border-rose-500/50 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <FolderOpen className="w-4 h-4 text-violet-400" />
                  <span>Local</span>
                </button>
              </div>
            </div>

            {/* Bottom Row: Permission Attestation & Sample Test Links */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={() => setIsAuthorizedConfirmed(!isAuthorizedConfirmed)}
                className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200 text-left"
              >
                {isAuthorizedConfirmed ? (
                  <CheckSquare className="w-4 h-4 text-rose-500 shrink-0" />
                ) : (
                  <Square className="w-4 h-4 text-zinc-500 shrink-0" />
                )}
                <span>
                  অনুমতিপ্রাপ্ত মিডিয়া: আমি নিশ্চিত করছি এই স্ট্রিমটি প্লে ও ডাউনলোড করার বৈধ অনুমতি বা ওপেন লাইসেন্স রয়েছে (DRM বাইপাসমুক্ত)
                </span>
              </button>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-zinc-500">টেস্ট সোর্স:</span>
                <button
                  type="button"
                  onClick={() => {
                    const sample =
                      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';
                    setUrlInput(sample);
                    setCustomTitle('For Bigger Blazes (Direct MP4)');
                    handleInspectStreamUrl(sample);
                  }}
                  className="text-zinc-300 hover:text-rose-400 underline underline-offset-4 whitespace-nowrap"
                >
                  Direct MP4 (2.38 MB)
                </button>
                <span aria-hidden="true" className="text-zinc-600">·</span>
                <button
                  type="button"
                  onClick={() => {
                    const sample = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
                    setUrlInput(sample);
                    setCustomTitle('Mux Multi-Bitrate HLS (.m3u8)');
                    handleInspectStreamUrl(sample);
                  }}
                  className="text-zinc-300 hover:text-rose-400 underline underline-offset-4 whitespace-nowrap"
                >
                  HLS / M3U8 Stream
                </button>
                <span aria-hidden="true" className="text-zinc-600">·</span>
                <button
                  type="button"
                  onClick={() => {
                    const sample = 'https://media.w3.org/2010/05/sintel/trailer.mp4';
                    setUrlInput(sample);
                    setCustomTitle('Sintel Open Movie Trailer');
                    handleInspectStreamUrl(sample);
                  }}
                  className="text-zinc-300 hover:text-rose-400 underline underline-offset-4 whitespace-nowrap"
                >
                  Sintel MP4
                </button>
              </div>
            </div>
          </form>

          {/* Error Diagnostic Banner */}
          {urlError && (
            <div className="mt-3 pt-3 border-t noir-border flex items-center justify-between gap-3 text-xs text-rose-400">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{urlError}</span>
              </div>
              <button onClick={() => setUrlError(null)} className="text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Smart Analyzer Live Result Summary */}
          {inspectionResult && (
            <div className="mt-3 pt-3 border-t noir-border flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-zinc-300 font-mono tabular-nums">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-sans font-semibold">{inspectionResult.filename}</span>
                <span aria-hidden="true">·</span>
                <span className="text-rose-400">{inspectionResult.format}</span>
                <span aria-hidden="true">·</span>
                <span>{inspectionResult.contentType}</span>
                <span aria-hidden="true">·</span>
                <span>{formatBytes(inspectionResult.sizeBytes)}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {inspectionResult.acceptRanges ? 'Resume Supported (Range)' : 'No Range Resume'}
                </span>
                <span aria-hidden="true">·</span>
                <span>Redirects: {inspectionResult.redirectHops}</span>
                {inspectionResult.isHls && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-violet-400">
                      {inspectionResult.hlsVariants.length > 0
                        ? `${inspectionResult.hlsVariants.length} HLS Variants`
                        : `${inspectionResult.hlsSegmentsCount} Segments`}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveSection('analyzer')}
                  className="min-h-[34px] px-3 py-1 rounded-lg noir-subcard text-xs font-medium hover:border-rose-500/50"
                >
                  বিস্তারিত রিপোর্ট
                </button>
                <button
                  type="button"
                  onClick={() => setInspectionResult(null)}
                  className="min-h-[34px] px-2 text-zinc-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ===================================================================
            MODULE 1: HOME STUDIO (Robiul Video Studio Overview + Player + Continue Watching)
           =================================================================== */}
        {activeSection === 'home' && (
          <div className="space-y-8">
            {/* Hero Studio Overview Strip */}
            <div className="noir-card rounded-2xl p-6 relative overflow-hidden">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div className="max-w-2xl">
                  <div className="text-xs font-mono text-rose-500 mb-2">
                    ROBIUL VIDEO STUDIO · NOIR CINEMA ENGINE v2.0
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                    প্রফেশনাল ইউনিভার্সাল ভিডিও প্লেয়ার এবং স্মার্ট ডাউনলোডার
                  </h1>
                  <p className="mt-2.5 text-sm text-zinc-400 leading-relaxed">
                    Direct MP4, WebM এবং Adaptive HLS (.m3u8) স্ট্রিমিং, A-B Repeat, ফ্রেম-বাই-ফ্রেম ন্যাভিগেশন, সাবটাইটেল ইম্পোর্ট, SSRF-সুরক্ষিত মাল্টি-জব ডাউনলোড কিউ এবং Android Media3 নেটিভ আর্কিটেকচার।
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-zinc-400 font-mono tabular-nums">
                    <span>SQLite ACID Database</span>
                    <span aria-hidden="true">·</span>
                    <span>SSRF & DNS Rebinding Guard</span>
                    <span aria-hidden="true">·</span>
                    <span>SHA-256 Checksum</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-rose-400">4K & HDR Ready</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 shrink-0 sm:w-80 font-mono tabular-nums">
                  <div className="noir-subcard rounded-xl p-3.5">
                    <span className="text-[11px] text-zinc-400 block font-sans">অ্যাক্টিভ ডাউনলোড</span>
                    <span className="text-xl font-bold text-rose-500 mt-1 block">
                      {activeRunningCount} / {preferences.max_concurrent_downloads}
                    </span>
                  </div>
                  <div className="noir-subcard rounded-xl p-3.5">
                    <span className="text-[11px] text-zinc-400 block font-sans">ডিস্ক স্টোরেজ</span>
                    <span className="text-xl font-bold mt-1 block">
                      {formatBytes(storageSummary.totalDiskBytes)}
                    </span>
                  </div>
                  <div className="noir-subcard rounded-xl p-3.5">
                    <span className="text-[11px] text-zinc-400 block font-sans">লাইব্রেরি মিডিয়া</span>
                    <span className="text-xl font-bold text-violet-400 mt-1 block">
                      {allLibraryVideos.length} টি
                    </span>
                  </div>
                  <div className="noir-subcard rounded-xl p-3.5">
                    <span className="text-[11px] text-zinc-400 block font-sans">ওয়াচ হিস্ট্রি</span>
                    <span className="text-xl font-bold mt-1 block">{history.length} টি</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Continue Watching Strip (if history exists) */}
            {history.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-bold">Continue Watching (সর্বশেষ পজিশন থেকে)</h2>
                  <button
                    onClick={() => {
                      setLibraryTab('CONTINUE');
                      setActiveSection('library');
                    }}
                    className="text-xs text-rose-400 hover:underline"
                  >
                    সব দেখুন
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {history.slice(0, 3).map((h) => {
                    const pct =
                      h.durationSec > 0
                        ? Math.min(100, Math.round((h.lastPositionSec / h.durationSec) * 100))
                        : 15;
                    return (
                      <div
                        key={h.url}
                        onClick={() => {
                          setResumeTimeSec(h.lastPositionSec);
                          setCurrentVideo({
                            id: h.id,
                            title: h.title,
                            subtitle: 'Continue Watching থেকে রিজিউম করা হয়েছে',
                            url: h.url,
                            thumbnail: h.thumbnail,
                            format: h.format,
                            resolution: h.format === 'HLS' ? 'Adaptive M3U8' : 'HD Stream',
                            durationLabel: formatTimecode(h.durationSec),
                            sizeLabel: 'Stream',
                            license: h.license,
                            isAuthorized: true,
                          });
                          setActiveSection('player');
                        }}
                        className="noir-card rounded-xl p-3 flex items-center gap-3.5 cursor-pointer hover:border-rose-500/50 transition-colors"
                      >
                        <div className="relative w-24 aspect-video rounded-lg overflow-hidden bg-black shrink-0">
                          <img
                            src={h.thumbnail}
                            alt={h.title}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-x-0 bottom-0 h-1 bg-zinc-800">
                            <div className="h-full bg-rose-600" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-xs font-bold truncate">{h.title}</h3>
                          <p className="text-[11px] text-zinc-400 font-mono tabular-nums mt-1">
                            {h.format} · Resume {formatTimecode(h.lastPositionSec)} /{' '}
                            {formatTimecode(h.durationSec)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Embedded Flagship Player + Queue Split */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8">
                <UniversalPlayer
                  video={currentVideo}
                  initialTimeSec={resumeTimeSec}
                  defaultSpeed={preferences.default_playback_speed}
                  theaterMode={theaterMode}
                  onToggleTheater={() => setTheaterMode(!theaterMode)}
                  onTimeUpdateRecord={handleTimeUpdateRecord}
                  onVideoEnded={handleVideoEnded}
                  onTriggerDownload={(v) => enqueueBackendDownload(v)}
                  onAddToPlaylist={handleAddToPlaylist}
                  onToggleFavorite={handleToggleFavorite}
                  isFavorite={favoriteUrls.includes(currentVideo.url)}
                />
              </div>

              <div className="lg:col-span-4 space-y-6">
                {/* Active Queue */}
                <div className="noir-card rounded-2xl p-4 sm:p-5">
                  <div className="flex items-center justify-between pb-3 border-b noir-border">
                    <div>
                      <h2 className="text-sm font-bold">NOIR Studio Queue</h2>
                      <p className="text-xs text-zinc-400 mt-0.5 truncate">
                        {activePlaylist?.name}
                      </p>
                    </div>
                    <button
                      onClick={() => setAutoAdvanceQueue(!autoAdvanceQueue)}
                      className={`px-2.5 py-1 rounded-md text-xs font-mono ${
                        autoAdvanceQueue
                          ? 'bg-rose-600/20 text-rose-400 border border-rose-500/40'
                          : 'noir-subcard text-zinc-400'
                      }`}
                    >
                      Auto: {autoAdvanceQueue ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  <div className="mt-3 space-y-2 max-h-[340px] overflow-y-auto pr-1">
                    {activePlaylist?.items.map((item, idx) => {
                      const isCurrent = item.url === currentVideo.url;
                      return (
                        <div
                          key={`${item.id}-${idx}`}
                          onClick={() => {
                            setResumeTimeSec(0);
                            setCurrentVideo(item);
                          }}
                          className={`p-2.5 rounded-xl border transition-colors cursor-pointer flex items-center gap-3 ${
                            isCurrent
                              ? 'noir-subcard border-rose-500/60'
                              : 'noir-subcard hover:border-zinc-700'
                          }`}
                        >
                          <img
                            src={item.thumbnail}
                            alt={item.title}
                            referrerPolicy="no-referrer"
                            className="w-18 aspect-video rounded-lg object-cover shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <h3
                              className={`text-xs font-semibold truncate ${
                                isCurrent ? 'text-rose-400' : ''
                              }`}
                            >
                              {idx + 1}. {item.title}
                            </h3>
                            <p className="text-[11px] text-zinc-400 font-mono tabular-nums mt-0.5">
                              {item.format} · {item.durationLabel} · {item.sizeLabel}
                            </p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              enqueueBackendDownload(item);
                            }}
                            title="ডাউনলোড কিউতে যুক্ত করুন"
                            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-rose-400"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            MODULE 2: DEDICATED UNIVERSAL VIDEO PLAYER VIEW
           =================================================================== */}
        {activeSection === 'player' && (
          <div className="space-y-6">
            <UniversalPlayer
              video={currentVideo}
              initialTimeSec={resumeTimeSec}
              defaultSpeed={preferences.default_playback_speed}
              theaterMode={theaterMode}
              onToggleTheater={() => setTheaterMode(!theaterMode)}
              onTimeUpdateRecord={handleTimeUpdateRecord}
              onVideoEnded={handleVideoEnded}
              onTriggerDownload={(v) => enqueueBackendDownload(v)}
              onAddToPlaylist={handleAddToPlaylist}
              onToggleFavorite={handleToggleFavorite}
              isFavorite={favoriteUrls.includes(currentVideo.url)}
            />

            {/* Curated Stream Switcher Below Player */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {PRESET_VIDEOS.map((item) => (
                <div
                  key={item.id}
                  onClick={() => {
                    setResumeTimeSec(0);
                    setCurrentVideo(item);
                  }}
                  className={`noir-card rounded-xl p-3 cursor-pointer transition-colors ${
                    currentVideo.url === item.url
                      ? 'border-rose-500'
                      : 'hover:border-rose-500/40'
                  }`}
                >
                  <img
                    src={item.thumbnail}
                    alt={item.title}
                    referrerPolicy="no-referrer"
                    className="w-full aspect-video rounded-lg object-cover mb-2.5"
                  />
                  <h3 className="text-xs font-bold truncate">{item.title}</h3>
                  <p className="mt-1 text-[11px] text-zinc-400 font-mono tabular-nums">
                    {item.format} · {item.resolution} · {item.sizeLabel}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===================================================================
            MODULE 3: SMART URL ANALYZER & DIAGNOSTICS
           =================================================================== */}
        {activeSection === 'analyzer' && (
          <div className="space-y-6">
            <div className="noir-card rounded-2xl p-5 sm:p-6">
              <h2 className="text-lg font-bold">
                Smart URL Analyzer ও টেকনিক্যাল ডায়াগনস্টিক রিপোর্ট
              </h2>
              <p className="text-xs text-zinc-400 mt-1">
                Direct MP4, WebM এবং M3U8 স্ট্রিমের রিডাইরেক্ট চেইন, MIME টাইপ, ফাইল সাইজ, HTTP Range Resume এবং HLS ম্যানিফেস্ট ভ্যারিয়েন্ট যাচাইকরণ
              </p>

              {!inspectionResult ? (
                <div className="py-10 text-center">
                  <Sparkles className="w-9 h-9 text-rose-500 mx-auto mb-2.5" />
                  <p className="text-xs text-zinc-400 max-w-md mx-auto">
                    উপরের URL বক্সে যেকোনো ভিডিও স্ট্রিম লিংক পেস্ট করে <strong>Analyze</strong> বাটনে ক্লিক করলে এখানে সম্পূর্ণ টেকনিক্যাল রিপোর্ট দেখা যাবে।
                  </p>
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono tabular-nums text-xs">
                    <div className="noir-subcard rounded-xl p-4">
                      <span className="text-zinc-400 block font-sans mb-1">শনাক্তকৃত ফরম্যাট ও MIME</span>
                      <span className="text-sm font-bold text-rose-400">
                        {inspectionResult.format} · {inspectionResult.contentType}
                      </span>
                    </div>
                    <div className="noir-subcard rounded-xl p-4">
                      <span className="text-zinc-400 block font-sans mb-1">ফাইল সাইজ ও Resume সাপোর্ট</span>
                      <span className="text-sm font-bold">
                        {formatBytes(inspectionResult.sizeBytes)} ·{' '}
                        {inspectionResult.acceptRanges ? 'Range Supported' : 'No Range'}
                      </span>
                    </div>
                    <div className="noir-subcard rounded-xl p-4">
                      <span className="text-zinc-400 block font-sans mb-1">
                        Redirect Hops ও ডাউনলোড উপযোগিতা
                      </span>
                      <span className="text-sm font-bold text-emerald-400">
                        {inspectionResult.redirectHops} Hops ·{' '}
                        {inspectionResult.isDownloadAllowed ? 'Download Compatible' : 'DRM Restricted'}
                      </span>
                    </div>
                  </div>

                  <div className="noir-subcard rounded-xl p-4 text-xs space-y-1.5 font-mono">
                    <div>
                      <span className="text-zinc-400">Original URL: </span>
                      <span className="break-all">{inspectionResult.url}</span>
                    </div>
                    <div>
                      <span className="text-zinc-400">Final Resolved URL: </span>
                      <span className="break-all text-rose-400">{inspectionResult.finalUrl}</span>
                    </div>
                    <div>
                      <span className="text-zinc-400">CORS Header Present: </span>
                      <span>
                        {inspectionResult.corsSupported
                          ? 'Yes (Direct Browser Playback)'
                          : 'No (Use NOIR Backend Stream Proxy)'}
                      </span>
                    </div>
                  </div>

                  {inspectionResult.isHls && (
                    <div className="noir-subcard rounded-xl p-4">
                      <h3 className="text-xs font-bold mb-2">
                        HLS / M3U8 Manifest Structure ({inspectionResult.hlsVariants.length} Variants,{' '}
                        {inspectionResult.hlsSegmentsCount} Segments)
                      </h3>
                      {inspectionResult.hlsVariants.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono tabular-nums text-xs">
                          {inspectionResult.hlsVariants.map((v, i) => (
                            <div key={i} className="noir-card rounded-lg p-2.5">
                              <div className="font-bold text-rose-400">{v.resolution}</div>
                              <div className="text-zinc-400">{v.bandwidth} kbps</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Recently Analyzed URLs History */}
            <div className="noir-card rounded-2xl p-5 sm:p-6">
              <div className="flex items-center justify-between pb-3 border-b noir-border">
                <h3 className="text-sm font-bold">সম্প্রতি যাচাইকৃত URL হিস্ট্রি ({analyzedHistory.length})</h3>
                {analyzedHistory.length > 0 && (
                  <button
                    onClick={async () => {
                      await fetch('/api/analyzer/history', { method: 'DELETE' });
                      fetchAnalyzerHistory();
                      showToast('অ্যানালাইজার হিস্ট্রি মুছে ফেলা হয়েছে');
                    }}
                    className="text-xs text-rose-400 hover:underline"
                  >
                    হিস্ট্রি মুছুন
                  </button>
                )}
              </div>

              {analyzedHistory.length === 0 ? (
                <p className="text-xs text-zinc-400 py-6 text-center">
                  এখনও কোনো URL অ্যানালাইজ করা হয়নি।
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {analyzedHistory.map((item) => (
                    <div
                      key={item.id}
                      className="noir-subcard rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-mono truncate text-zinc-200">{item.final_url}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-zinc-400 font-mono tabular-nums">
                          <span className="text-rose-400">{item.format}</span>
                          <span aria-hidden="true">·</span>
                          <span>{item.mime_type}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatBytes(item.size_bytes)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{item.accept_ranges ? 'Range OK' : 'No Range'}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => {
                            setUrlInput(item.final_url);
                            handleLoadAndPlayUrl(undefined, item.final_url);
                          }}
                          className="min-h-[34px] px-3 py-1 rounded-lg noir-card text-xs font-semibold hover:border-rose-500/50"
                        >
                          Play
                        </button>
                        <button
                          onClick={() =>
                            enqueueBackendDownload({
                              id: item.id,
                              title: `Analyzed ${item.format} Video`,
                              subtitle: item.mime_type,
                              url: item.final_url,
                              thumbnail: PRESET_VIDEOS[0].thumbnail,
                              format: item.format,
                              resolution: 'Stream',
                              durationLabel: 'Stream',
                              sizeLabel: formatBytes(item.size_bytes),
                              license: 'Authorized',
                              isAuthorized: true,
                            })
                          }
                          className="min-h-[34px] px-3 py-1 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500"
                        >
                          Download
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================================================================
            MODULE 4: ADVANCED DOWNLOAD MANAGER (Multi-Job Queue, Pause/Resume, SHA-256)
           =================================================================== */}
        {activeSection === 'downloads' && (
          <section className="noir-card rounded-2xl p-5 sm:p-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b noir-border">
              <div>
                <h2 className="text-lg font-bold">
                  Advanced Download Manager (মাল্টি-জব কিউ ও চেকসাম ভেরিফিকেশন)
                </h2>
                <p className="text-xs text-zinc-400 mt-1 font-mono tabular-nums">
                  সক্রিয় লিমিট: একসঙ্গে {preferences.max_concurrent_downloads} টি জব · ডিস্ক স্টোরেজ ব্যবহৃত:{' '}
                  {formatBytes(storageSummary.totalDiskBytes)} ({storageSummary.totalFilesCount} টি ফাইল)
                </p>
              </div>

              {/* Status Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1 p-1 noir-subcard rounded-lg">
                {(
                  [
                    { id: 'ALL', label: 'All' },
                    { id: 'running', label: 'Running' },
                    { id: 'queued', label: 'Queued' },
                    { id: 'paused', label: 'Paused' },
                    { id: 'completed', label: 'Completed' },
                    { id: 'failed', label: 'Failed' },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.id}
                    onClick={() => setDownloadFilter(st.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      downloadFilter === st.id
                        ? 'bg-rose-600 text-white font-semibold'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredDownloadJobs.length === 0 ? (
              <div className="py-12 text-center max-w-md mx-auto">
                <FileVideo className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
                <h3 className="text-base font-bold">এই ফিল্টারে কোনো ডাউনলোড জব নেই</h3>
                <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
                  নিচের বাটনে ক্লিক করে একটি টেস্ট MP4 অথবা HLS স্ট্রিম ডাউনলোড কিউতে যুক্ত করে রিয়েল-টাইম প্রগ্রেস, Pause/Resume ও SHA-256 চেকসাম পরীক্ষা করুন।
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <button
                    onClick={() => enqueueBackendDownload(PRESET_VIDEOS[2], 'high')}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500 transition-colors flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>ডাউনলোড টেস্ট MP4 (2.38 MB)</span>
                  </button>
                  <button
                    onClick={() => enqueueBackendDownload(PRESET_VIDEOS[3], 'normal')}
                    className="min-h-[42px] px-4 py-2 rounded-xl noir-subcard text-xs font-semibold hover:border-rose-500/50 transition-colors flex items-center gap-2"
                  >
                    <Download className="w-4 h-4 text-rose-400" />
                    <span>ডাউনলোড Sintel Trailer (4.17 MB)</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {filteredDownloadJobs.map((job) => {
                  const pct =
                    job.status === 'completed'
                      ? 100
                      : job.total_bytes && job.total_bytes > 0
                      ? Math.min(99, Math.round((job.loaded_bytes / job.total_bytes) * 100))
                      : job.loaded_bytes > 0
                      ? 55
                      : 0;

                  return (
                    <div
                      key={job.id}
                      className="p-4 rounded-xl noir-subcard flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          {renamingJobId === job.id ? (
                            <div className="flex items-center gap-2 flex-1">
                              <input
                                type="text"
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                className="px-2.5 py-1 noir-card rounded-md text-xs font-mono flex-1"
                              />
                              <button
                                onClick={() => handleRenameJobSubmit(job.id)}
                                className="px-2.5 py-1 rounded-md bg-rose-600 text-white text-xs font-semibold"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setRenamingJobId(null)}
                                className="px-2 py-1 text-xs text-zinc-400"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <h3 className="text-sm font-bold truncate">{job.filename}</h3>
                          )}
                          <span className="text-xs font-mono tabular-nums font-semibold text-rose-400 shrink-0">
                            {job.status.toUpperCase()} · {pct}%
                          </span>
                        </div>

                        {/* Unboxed Metadata Line */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-zinc-400 font-mono tabular-nums">
                          <span className="text-rose-400">{job.format}</span>
                          <span aria-hidden="true">·</span>
                          <span>Priority: {job.priority.toUpperCase()}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {formatBytes(job.loaded_bytes)} / {formatBytes(job.total_bytes)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {job.supports_range ? 'HTTP Range Resume' : 'No Range Support'}
                          </span>
                          {job.status === 'running' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-emerald-400">
                                {formatBytes(job.speed_bps)}/s
                              </span>
                              {job.eta_seconds !== null && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>ETA {job.eta_seconds}s</span>
                                </>
                              )}
                            </>
                          )}
                          {job.sha256_checksum && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span
                                title={`SHA-256: ${job.sha256_checksum}`}
                                className="text-violet-400"
                              >
                                SHA-256: {job.sha256_checksum.slice(0, 14)}...
                              </span>
                            </>
                          )}
                        </div>

                        {job.error_message && (
                          <p className="mt-1.5 text-xs text-amber-400">{job.error_message}</p>
                        )}

                        <div className="mt-3 h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-150 ${
                              job.status === 'failed'
                                ? 'bg-rose-500'
                                : job.status === 'completed'
                                ? 'bg-emerald-500'
                                : job.status === 'paused'
                                ? 'bg-amber-500'
                                : 'bg-rose-600'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>

                      {/* Job Control Actions */}
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {job.status === 'running' && (
                          <button
                            onClick={() => handleDownloadJobAction(job.id, 'pause')}
                            className="min-h-[38px] px-3 py-1.5 rounded-lg noir-card text-xs font-medium hover:border-rose-500/50 flex items-center gap-1.5"
                          >
                            <Pause className="w-3.5 h-3.5 text-amber-400" />
                            <span>Pause</span>
                          </button>
                        )}

                        {job.status === 'paused' && (
                          <button
                            onClick={() => handleDownloadJobAction(job.id, 'resume')}
                            className="min-h-[38px] px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500 flex items-center gap-1.5"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Resume</span>
                          </button>
                        )}

                        {(job.status === 'failed' || job.status === 'cancelled') && (
                          <button
                            onClick={() => handleDownloadJobAction(job.id, 'retry')}
                            className="min-h-[38px] px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500 flex items-center gap-1.5"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Retry</span>
                          </button>
                        )}

                        {(job.status === 'running' ||
                          job.status === 'queued' ||
                          job.status === 'paused') && (
                          <button
                            onClick={() => handleDownloadJobAction(job.id, 'cancel')}
                            className="min-h-[38px] px-3 py-1.5 rounded-lg noir-card text-xs font-medium text-rose-400 hover:border-rose-500/40"
                          >
                            Cancel
                          </button>
                        )}

                        {job.status === 'completed' && (
                          <>
                            <button
                              onClick={() => {
                                setResumeTimeSec(0);
                                setCurrentVideo({
                                  id: job.id,
                                  title: job.filename,
                                  subtitle: `Offline Downloaded Media · SHA-256 Verified`,
                                  url: `/api/downloads/${job.id}/file`,
                                  thumbnail: PRESET_VIDEOS[1].thumbnail,
                                  format: job.format,
                                  resolution: 'Local Saved',
                                  durationLabel: 'Saved',
                                  sizeLabel: formatBytes(job.loaded_bytes),
                                  license: 'Downloaded Copy',
                                  isAuthorized: true,
                                });
                                setActiveSection('player');
                              }}
                              className="min-h-[38px] px-3 py-1.5 rounded-lg noir-card text-xs font-semibold text-rose-400 hover:border-rose-500/50 flex items-center gap-1.5"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              <span>Open</span>
                            </button>

                            <a
                              href={`/api/downloads/${job.id}/file`}
                              download={job.filename}
                              className="min-h-[38px] px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500 flex items-center gap-1.5"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Save File</span>
                            </a>

                            <button
                              onClick={() => {
                                setRenamingJobId(job.id);
                                setRenameValue(job.filename);
                              }}
                              title="ফাইল রিনেম করুন"
                              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg noir-card text-zinc-300 hover:text-white"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={async () => {
                                await navigator.clipboard.writeText(job.url);
                                showToast('সোর্স লিংক কপি হয়েছে');
                              }}
                              title="লিংক শেয়ার/কপি করুন"
                              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg noir-card text-zinc-300 hover:text-white"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}

                        <button
                          onClick={() => confirmDeleteDownloadJob(job)}
                          title="ডাউনলোড মুছে ফেলুন"
                          className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg noir-card text-zinc-400 hover:text-rose-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ===================================================================
            MODULE 5: SMART MEDIA LIBRARY (Continue Watching, Favorites, Downloaded, Backup)
           =================================================================== */}
        {activeSection === 'library' && (
          <div className="space-y-6">
            <div className="noir-card rounded-2xl p-5 sm:p-6">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b noir-border">
                <div>
                  <h2 className="text-lg font-bold">
                    Smart Media Library ও অফলাইন কালেকশন
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1">
                    Continue Watching, Downloaded Videos, Favorites, ওয়াচ হিস্ট্রি এবং লাইব্রেরি ব্যাকআপ/রিস্টোর
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleExportLibraryBackup}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg noir-subcard text-xs font-medium hover:border-rose-500/50 flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5 text-rose-400" />
                    <span>Backup JSON</span>
                  </button>
                  <button
                    onClick={() => backupInputRef.current?.click()}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg noir-subcard text-xs font-medium hover:border-rose-500/50 flex items-center gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5 text-violet-400" />
                    <span>Restore JSON</span>
                  </button>
                </div>
              </div>

              {/* Filter & Search Row */}
              <div className="mt-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1 p-1 noir-subcard rounded-lg">
                  {(
                    [
                      { id: 'ALL', label: `All Media (${allLibraryVideos.length})` },
                      { id: 'CONTINUE', label: `Continue Watching (${history.length})` },
                      {
                        id: 'DOWNLOADED',
                        label: `Downloaded (${
                          downloadJobs.filter((j) => j.status === 'completed').length
                        })`,
                      },
                      { id: 'FAVORITES', label: `Favorites (${favoriteUrls.length})` },
                      { id: 'HISTORY', label: 'Watch History' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setLibraryTab(t.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        libraryTab === t.id
                          ? 'bg-rose-600 text-white font-semibold'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={librarySearch}
                      onChange={(e) => setLibrarySearch(e.target.value)}
                      placeholder="মিডিয়া খুঁজুন..."
                      className="min-h-[38px] pl-8 pr-3 py-1.5 noir-subcard rounded-lg text-xs"
                    />
                  </div>

                  <select
                    value={libraryFormatFilter}
                    onChange={(e) =>
                      setLibraryFormatFilter(e.target.value as 'ALL' | 'MP4' | 'WEBM' | 'HLS')
                    }
                    className="min-h-[38px] px-2.5 py-1.5 noir-subcard rounded-lg text-xs"
                  >
                    <option value="ALL">All Formats</option>
                    <option value="MP4">MP4</option>
                    <option value="WEBM">WebM</option>
                    <option value="HLS">HLS / M3U8</option>
                  </select>

                  <select
                    value={librarySortBy}
                    onChange={(e) =>
                      setLibrarySortBy(e.target.value as 'date' | 'name' | 'format')
                    }
                    className="min-h-[38px] px-2.5 py-1.5 noir-subcard rounded-lg text-xs"
                  >
                    <option value="date">Sort by Date</option>
                    <option value="name">Sort by Name</option>
                    <option value="format">Sort by Format</option>
                  </select>
                </div>
              </div>

              {/* Render Selected Library View */}
              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {allLibraryVideos
                  .filter((v) => {
                    if (libraryTab === 'FAVORITES' && !favoriteUrls.includes(v.url)) return false;
                    if (libraryTab === 'DOWNLOADED' && !v.isDownloaded) return false;
                    if (
                      libraryTab === 'CONTINUE' &&
                      !history.some((h) => h.url === v.url && h.lastPositionSec > 0)
                    )
                      return false;
                    if (libraryFormatFilter !== 'ALL' && v.format !== libraryFormatFilter)
                      return false;
                    if (
                      librarySearch &&
                      !v.title.toLowerCase().includes(librarySearch.toLowerCase())
                    )
                      return false;
                    return true;
                  })
                  .sort((a, b) => {
                    if (librarySortBy === 'name') return a.title.localeCompare(b.title);
                    if (librarySortBy === 'format') return a.format.localeCompare(b.format);
                    return 0;
                  })
                  .map((item) => {
                    const isFav = favoriteUrls.includes(item.url);
                    const histRecord = history.find((h) => h.url === item.url);
                    return (
                      <article
                        key={`${item.id}-${item.url}`}
                        className="noir-subcard rounded-2xl overflow-hidden flex flex-col justify-between"
                      >
                        <div>
                          <div
                            onClick={() => {
                              setResumeTimeSec(histRecord?.lastPositionSec || 0);
                              setCurrentVideo(item);
                              setActiveSection('player');
                            }}
                            className="relative aspect-video bg-black cursor-pointer group overflow-hidden"
                          >
                            <img
                              src={item.thumbnail}
                              alt={item.title}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end justify-between p-3">
                              <span className="text-xs font-mono tabular-nums text-zinc-200">
                                {histRecord
                                  ? `Resume ${formatTimecode(histRecord.lastPositionSec)}`
                                  : item.durationLabel}
                              </span>
                              <span className="w-8 h-8 rounded-full bg-rose-600 text-white flex items-center justify-center">
                                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                              </span>
                            </div>
                          </div>

                          <div className="p-3.5">
                            <h3 className="text-xs font-bold line-clamp-1">{item.title}</h3>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400 font-mono tabular-nums">
                              <span className="text-rose-400">{item.format}</span>
                              <span aria-hidden="true">·</span>
                              <span>{item.resolution}</span>
                              <span aria-hidden="true">·</span>
                              <span>{item.sizeLabel}</span>
                            </div>
                          </div>
                        </div>

                        <div className="px-3.5 pb-3.5 pt-2 border-t noir-border flex items-center justify-between gap-2">
                          <button
                            onClick={() => handleToggleFavorite(item)}
                            className={`min-h-[34px] px-2.5 rounded-lg noir-card text-xs flex items-center gap-1 ${
                              isFav ? 'text-rose-500' : 'text-zinc-400'
                            }`}
                          >
                            <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-current' : ''}`} />
                            <span>Fav</span>
                          </button>

                          <button
                            onClick={() => enqueueBackendDownload(item)}
                            className="min-h-[34px] px-3 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500 flex items-center gap-1"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download</span>
                          </button>
                        </div>
                      </article>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            MODULE 6: CUSTOM PLAYLIST MANAGER
           =================================================================== */}
        {activeSection === 'playlists' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-4 noir-card rounded-2xl p-5 h-fit">
              <h2 className="text-base font-bold">কাস্টম প্লেলিস্ট সমূহ</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const trimmed = newPlaylistName.trim();
                  if (!trimmed) return;
                  const newPl: Playlist = {
                    id: `pl-${Date.now()}`,
                    name: trimmed,
                    description: 'Custom NOIR Video Studio Playlist',
                    items: [currentVideo],
                    createdAt: new Date().toISOString(),
                  };
                  setPlaylists((prev) => [newPl, ...prev]);
                  setActivePlaylistId(newPl.id);
                  setNewPlaylistName('');
                  showToast(`নতুন প্লেলিস্ট "${trimmed}" তৈরি হয়েছে`);
                }}
                className="mt-4 flex gap-2"
              >
                <input
                  type="text"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  placeholder="নতুন প্লেলিস্টের নাম..."
                  className="flex-1 min-h-[40px] px-3 py-2 noir-subcard rounded-lg text-xs"
                />
                <button
                  type="submit"
                  className="min-h-[40px] px-3.5 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500 flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  <span>তৈরি</span>
                </button>
              </form>

              <div className="mt-4 space-y-2">
                {playlists.map((pl) => (
                  <div
                    key={pl.id}
                    onClick={() => setActivePlaylistId(pl.id)}
                    className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between ${
                      pl.id === activePlaylist?.id
                        ? 'noir-subcard border-rose-500'
                        : 'noir-subcard hover:border-zinc-700'
                    }`}
                  >
                    <div className="min-w-0">
                      <h3 className="text-xs font-bold truncate">{pl.name}</h3>
                      <p className="text-[11px] text-zinc-400 font-mono tabular-nums mt-0.5">
                        {pl.items.length} টি ভিডিও
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-8 noir-card rounded-2xl p-5">
              <div className="flex items-center justify-between pb-4 border-b noir-border">
                <div>
                  <h2 className="text-base font-bold">{activePlaylist?.name}</h2>
                  <p className="text-xs text-zinc-400 mt-0.5">{activePlaylist?.description}</p>
                </div>
                <button
                  onClick={() => handleAddToPlaylist(currentVideo)}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-lg noir-subcard text-xs font-semibold text-rose-400 hover:border-rose-500/50"
                >
                  + বর্তমান ভিডিও যুক্ত করুন
                </button>
              </div>

              <div className="mt-4 space-y-2.5">
                {activePlaylist?.items.map((item, idx) => (
                  <div
                    key={`${item.id}-${idx}`}
                    className="p-3 rounded-xl noir-subcard flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-mono tabular-nums text-zinc-500 w-5">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <img
                        src={item.thumbnail}
                        alt={item.title}
                        referrerPolicy="no-referrer"
                        className="w-18 aspect-video rounded-lg object-cover shrink-0"
                      />
                      <div className="min-w-0">
                        <h3 className="text-xs font-bold truncate">{item.title}</h3>
                        <p className="text-[11px] text-zinc-400 font-mono tabular-nums mt-0.5">
                          {item.format} · {item.resolution} · {item.sizeLabel}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => {
                          setResumeTimeSec(0);
                          setCurrentVideo(item);
                          setActiveSection('player');
                        }}
                        className="min-h-[36px] px-3 py-1 rounded-lg bg-rose-600 text-white text-xs font-semibold"
                      >
                        Play
                      </button>
                      <button
                        onClick={() =>
                          setPlaylists((prev) =>
                            prev.map((p) =>
                              p.id === activePlaylist.id
                                ? { ...p, items: p.items.filter((i) => i.url !== item.url) }
                                : p
                            )
                          )
                        }
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-400 hover:text-rose-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            MODULE 7: SETTINGS & PREFERENCES
           =================================================================== */}
        {activeSection === 'settings' && (
          <div className="max-w-3xl mx-auto noir-card rounded-2xl p-6 space-y-6">
            <div>
              <h2 className="text-lg font-bold">NOIR Video Studio — অ্যাপ ও ডাউনলোডার সেটিংস</h2>
              <p className="text-xs text-zinc-400 mt-1">
                থিম, ডাউনলোড কনকারেন্সি লিমিট, অটো-রিট্রাই, স্টোরেজ ডিরেক্টরি এবং ডিফল্ট প্লেব্যাক কনফিগারেশন
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  ইন্টারফেস থিম (UI Theme)
                </label>
                <select
                  value={preferences.theme}
                  onChange={(e) =>
                    setPreferences({
                      ...preferences,
                      theme: e.target.value as 'dark' | 'light',
                    })
                  }
                  className="w-full min-h-[42px] px-3 py-2 noir-subcard rounded-xl text-xs"
                >
                  <option value="dark">NOIR Dark Cinematic (Black / Charcoal / Crimson)</option>
                  <option value="light">Studio Daylight (Clean Light Theme)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  একসঙ্গে সর্বোচ্চ সক্রিয় ডাউনলোড (Max Concurrent Jobs: 1–5)
                </label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={preferences.max_concurrent_downloads}
                  onChange={(e) =>
                    setPreferences({
                      ...preferences,
                      max_concurrent_downloads: Number(e.target.value),
                    })
                  }
                  className="w-full min-h-[42px] px-3 py-2 noir-subcard rounded-xl text-xs font-mono tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  ডিফল্ট প্লেব্যাক স্পিড (Default Speed)
                </label>
                <select
                  value={preferences.default_playback_speed}
                  onChange={(e) =>
                    setPreferences({
                      ...preferences,
                      default_playback_speed: Number(e.target.value),
                    })
                  }
                  className="w-full min-h-[42px] px-3 py-2 noir-subcard rounded-xl text-xs font-mono tabular-nums"
                >
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                    <option key={s} value={s}>
                      {s}x
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  ব্যর্থ ডাউনলোডে সর্বোচ্চ অটো-রিট্রাই সংখ্যা (Max Auto-Retries)
                </label>
                <input
                  type="number"
                  min={0}
                  max={5}
                  value={preferences.max_retry_count}
                  onChange={(e) =>
                    setPreferences({
                      ...preferences,
                      max_retry_count: Number(e.target.value),
                    })
                  }
                  className="w-full min-h-[42px] px-3 py-2 noir-subcard rounded-xl text-xs font-mono tabular-nums"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  ডাউনলোড স্টোরেজ ডিরেক্টরি (Server / Android Scoped Storage Path)
                </label>
                <input
                  type="text"
                  value={preferences.storage_directory}
                  onChange={(e) =>
                    setPreferences({
                      ...preferences,
                      storage_directory: e.target.value,
                    })
                  }
                  className="w-full min-h-[42px] px-3 py-2 noir-subcard rounded-xl text-xs font-mono"
                />
              </div>
            </div>

            <div className="pt-4 border-t noir-border flex items-center justify-end gap-3">
              <button
                onClick={() => handleSaveSettings(preferences)}
                className="min-h-[42px] px-5 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500 transition-colors"
              >
                সেটিংস সংরক্ষণ করুন
              </button>
            </div>
          </div>
        )}

        {/* ===================================================================
            MODULE 8: SECURE ADMIN DASHBOARD
           =================================================================== */}
        {activeSection === 'admin' && <AdminDashboardPanel onShowToast={showToast} />}

        {/* ===================================================================
            MODULE 9: ANDROID NATIVE & APK RELEASE PORTAL
           =================================================================== */}
        {activeSection === 'android' && (
          <AndroidAppPanel
            mobilePreviewMode={mobilePreviewMode}
            onToggleMobilePreview={() => setMobilePreviewMode(!mobilePreviewMode)}
          />
        )}
      </main>

      {/* MOBILE BOTTOM TAB BAR (Thumb-Zone Navigation Anchor, <= 15% Sticky Viewport Cap) */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 noir-card border-b-0 border-x-0 grid grid-cols-5 items-center h-16 px-1"
      >
        <button
          onClick={() => setActiveSection('home')}
          className={`min-h-[44px] flex flex-col items-center justify-center ${
            activeSection === 'home' ? 'text-rose-500' : 'text-zinc-400'
          }`}
        >
          <Home className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight mt-1 whitespace-nowrap">
            Home
          </span>
        </button>

        <button
          onClick={() => setActiveSection('player')}
          className={`min-h-[44px] flex flex-col items-center justify-center ${
            activeSection === 'player' ? 'text-rose-500' : 'text-zinc-400'
          }`}
        >
          <Play className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight mt-1 whitespace-nowrap">
            Player
          </span>
        </button>

        <button
          onClick={() => setActiveSection('downloads')}
          className={`min-h-[44px] flex flex-col items-center justify-center ${
            activeSection === 'downloads' ? 'text-rose-500' : 'text-zinc-400'
          }`}
        >
          <Download className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight mt-1 whitespace-nowrap">
            Downloads
          </span>
        </button>

        <button
          onClick={() => setActiveSection('library')}
          className={`min-h-[44px] flex flex-col items-center justify-center ${
            activeSection === 'library' ? 'text-rose-500' : 'text-zinc-400'
          }`}
        >
          <ListVideo className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight mt-1 whitespace-nowrap">
            Library
          </span>
        </button>

        <button
          onClick={() => setActiveSection('admin')}
          className={`min-h-[44px] flex flex-col items-center justify-center ${
            activeSection === 'admin' ? 'text-rose-500' : 'text-zinc-400'
          }`}
        >
          <Lock className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight mt-1 whitespace-nowrap">
            Admin
          </span>
        </button>
      </nav>
    </div>
  );
}
