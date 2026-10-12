export type VideoFormat = 'MP4' | 'WEBM' | 'HLS' | 'OGV' | 'LOCAL';

export interface VideoItem {
  id: string;
  title: string;
  subtitle: string;
  url: string;
  thumbnail: string;
  format: VideoFormat;
  resolution: string;
  durationLabel: string;
  sizeLabel: string;
  license: string;
  isAuthorized: boolean;
  isFavorite?: boolean;
  isDownloaded?: boolean;
  addedAt?: string;
  lastPositionSec?: number;
  durationSec?: number;
  subtitleVttUrl?: string;
}

export interface StreamInspectionResult {
  url: string;
  finalUrl: string;
  redirectHops: number;
  filename: string;
  format: VideoFormat;
  isHls: boolean;
  isEncryptedDrm: boolean;
  contentType: string;
  sizeBytes: number | null;
  acceptRanges: boolean;
  corsSupported: boolean;
  hlsVariants: Array<{ resolution: string; bandwidth: number; codecs?: string }>;
  hlsAudioTracks: string[];
  hlsSubtitleTracks: string[];
  hlsSegmentsCount: number;
  isDirectPlayable: boolean;
  isDownloadAllowed: boolean;
  verifiedAt: string;
}

export interface AnalyzedUrlRecord {
  id: string;
  original_url: string;
  final_url: string;
  format: VideoFormat;
  mime_type: string;
  size_bytes: number | null;
  accept_ranges: number;
  is_hls: number;
  is_direct_playable: number;
  is_download_allowed: number;
  redirect_hops: number;
  platform_notice: string | null;
  status_code: number;
  analyzed_at: string;
}

export type BackendDownloadStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type DownloadPriority = 'high' | 'normal' | 'low';

export interface BackendDownloadJob {
  id: string;
  title: string;
  url: string;
  final_url: string;
  filename: string;
  format: VideoFormat;
  status: BackendDownloadStatus;
  priority: DownloadPriority;
  loaded_bytes: number;
  total_bytes: number | null;
  speed_bps: number;
  eta_seconds: number | null;
  supports_range: number;
  retry_count: number;
  max_retries: number;
  sha256_checksum: string | null;
  storage_path: string | null;
  error_code: string | null;
  error_message: string | null;
  is_retryable: number;
  created_at: string;
  updated_at: string;
}

export interface HistoryEntry {
  id: string;
  title: string;
  url: string;
  format: VideoFormat;
  thumbnail: string;
  lastPositionSec: number;
  durationSec: number;
  watchedAt: string;
  license: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  items: VideoItem[];
  createdAt: string;
}

export interface UserPreferences {
  user_id: string;
  theme: 'dark' | 'light';
  max_concurrent_downloads: number;
  auto_retry_downloads: number;
  max_retry_count: number;
  default_playback_speed: number;
  storage_directory: string;
  updated_at: string;
}

export interface AdminTelemetryData {
  health: string;
  uptimeSeconds: number;
  nodeVersion: string;
  memoryUsageMb: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
  limits: {
    maxRequestsPerMinute: number;
    maxDownloadSizeMb: number;
  };
  stats: {
    totalJobs: number;
    runningJobs: number;
    queuedJobs: number;
    pausedJobs: number;
    completedJobs: number;
    failedJobs: number;
    cancelledJobs: number;
  };
  storage: {
    totalFilesCount: number;
    totalDiskBytes: number;
    maxLimitMb: number;
  };
  auditLogs: Array<{
    id: string;
    category: string;
    severity: string;
    message: string;
    details_json: string | null;
    created_at: string;
  }>;
}

export type NavSection =
  | 'home'
  | 'player'
  | 'analyzer'
  | 'downloads'
  | 'library'
  | 'playlists'
  | 'settings'
  | 'admin'
  | 'android';
