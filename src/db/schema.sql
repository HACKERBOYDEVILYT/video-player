-- ============================================================================
-- NOIR Video Studio (Robiul Video Studio) — Production Relational Schema
-- Compatible with SQLite (node:sqlite) and PostgreSQL 15+
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT 'dark',
  max_concurrent_downloads INTEGER NOT NULL DEFAULT 2,
  auto_retry_downloads INTEGER NOT NULL DEFAULT 1,
  max_retry_count INTEGER NOT NULL DEFAULT 2,
  default_playback_speed REAL NOT NULL DEFAULT 1.0,
  storage_directory TEXT NOT NULL DEFAULT '/storage/downloads',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analyzed_urls (
  id TEXT PRIMARY KEY,
  original_url TEXT NOT NULL,
  final_url TEXT NOT NULL,
  format TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER,
  accept_ranges INTEGER NOT NULL DEFAULT 0,
  is_hls INTEGER NOT NULL DEFAULT 0,
  is_direct_playable INTEGER NOT NULL DEFAULT 1,
  is_download_allowed INTEGER NOT NULL DEFAULT 1,
  redirect_hops INTEGER NOT NULL DEFAULT 0,
  platform_notice TEXT,
  status_code INTEGER NOT NULL DEFAULT 200,
  analyzed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS download_jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  final_url TEXT NOT NULL,
  filename TEXT NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL, -- 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  priority TEXT NOT NULL DEFAULT 'normal', -- 'high' | 'normal' | 'low'
  loaded_bytes INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER,
  speed_bps INTEGER NOT NULL DEFAULT 0,
  eta_seconds INTEGER,
  supports_range INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 2,
  sha256_checksum TEXT,
  storage_path TEXT,
  error_code TEXT,
  error_message TEXT,
  is_retryable INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_download_jobs_status ON download_jobs(status);
CREATE INDEX IF NOT EXISTS idx_download_jobs_created ON download_jobs(created_at DESC);

CREATE TABLE IF NOT EXISTS media_library (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  url TEXT NOT NULL,
  thumbnail TEXT NOT NULL,
  format TEXT NOT NULL,
  resolution TEXT NOT NULL,
  duration_sec REAL NOT NULL DEFAULT 0,
  size_bytes INTEGER,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_downloaded INTEGER NOT NULL DEFAULT 0,
  download_job_id TEXT,
  last_position_sec REAL NOT NULL DEFAULT 0,
  subtitle_vtt TEXT,
  license TEXT NOT NULL DEFAULT 'Authorized Media',
  added_at TEXT NOT NULL,
  last_played_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_library_last_played ON media_library(last_played_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_library_favorite ON media_library(is_favorite);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  item_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL, -- 'SECURITY_SSRF' | 'RATE_LIMIT' | 'AUTH' | 'DOWNLOAD' | 'SYSTEM'
  severity TEXT NOT NULL, -- 'INFO' | 'WARN' | 'ERROR'
  message TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
