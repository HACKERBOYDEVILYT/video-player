import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db, logAuditEvent } from './db';
import { fetchWithSafeRedirects, sanitizeSafeFilename, maskSensitiveUrlForLog } from './security';

export const DOWNLOADS_DIR = path.resolve(process.cwd(), 'storage/downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

export interface DownloadJobRow {
  id: string;
  title: string;
  url: string;
  final_url: string;
  filename: string;
  format: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  priority: 'high' | 'normal' | 'low';
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

const activeControllers = new Map<string, AbortController>();
let maxDownloadSizeMb = 1024; // Configurable by Admin (default 1 GB max per file)

export function setMaxDownloadSizeMb(mb: number) {
  maxDownloadSizeMb = Math.max(10, Math.min(4096, mb));
}

export function getMaxDownloadSizeMb(): number {
  return maxDownloadSizeMb;
}

function getConcurrencyLimit(): number {
  try {
    const row = db
      .prepare('SELECT max_concurrent_downloads FROM user_preferences WHERE user_id = ?')
      .get('default') as { max_concurrent_downloads?: number } | undefined;
    return Math.max(1, Math.min(5, row?.max_concurrent_downloads || 2));
  } catch {
    return 2;
  }
}

function getAutoRetryConfig(): { autoRetry: boolean; maxRetries: number } {
  try {
    const row = db
      .prepare('SELECT auto_retry_downloads, max_retry_count FROM user_preferences WHERE user_id = ?')
      .get('default') as { auto_retry_downloads?: number; max_retry_count?: number } | undefined;
    return {
      autoRetry: row?.auto_retry_downloads !== 0,
      maxRetries: row?.max_retry_count ?? 2,
    };
  } catch {
    return { autoRetry: true, maxRetries: 2 };
  }
}

function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export function getAllDownloadJobs(): DownloadJobRow[] {
  return db
    .prepare('SELECT * FROM download_jobs ORDER BY created_at DESC LIMIT 100')
    .all() as unknown as DownloadJobRow[];
}

export function getDownloadJobById(id: string): DownloadJobRow | undefined {
  return db
    .prepare('SELECT * FROM download_jobs WHERE id = ?')
    .get(id) as unknown as DownloadJobRow | undefined;
}

export function createQueuedDownloadJob(params: {
  title: string;
  url: string;
  format: string;
  priority?: 'high' | 'normal' | 'low';
  filename?: string;
}): { job: DownloadJobRow; isDuplicate: boolean } {
  const existing = db
    .prepare(
      `SELECT * FROM download_jobs
       WHERE url = ? AND status IN ('completed', 'running', 'queued')
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(params.url) as unknown as DownloadJobRow | undefined;

  if (existing && existing.status === 'completed' && existing.storage_path && fs.existsSync(existing.storage_path)) {
    return { job: existing, isDuplicate: true };
  }

  const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const ext =
    params.format === 'HLS'
      ? 'ts'
      : params.format === 'WEBM'
      ? 'webm'
      : 'mp4';
  const cleanFile = sanitizeSafeFilename(params.filename || params.title, ext);
  const storagePath = path.join(DOWNLOADS_DIR, `${id}_${cleanFile}`);
  const { maxRetries } = getAutoRetryConfig();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO download_jobs (
      id, title, url, final_url, filename, format, status, priority,
      loaded_bytes, total_bytes, speed_bps, eta_seconds, supports_range,
      retry_count, max_retries, sha256_checksum, storage_path,
      error_code, error_message, is_retryable, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, 0, NULL, 0, NULL, 0, 0, ?, NULL, ?, NULL, NULL, 1, ?, ?)`
  ).run(
    id,
    params.title,
    params.url,
    params.url,
    cleanFile,
    params.format,
    params.priority || 'normal',
    maxRetries,
    storagePath,
    now,
    now
  );

  const created = getDownloadJobById(id)!;
  setImmediate(() => processDownloadQueue());
  return { job: created, isDuplicate: false };
}

export function processDownloadQueue() {
  const limit = getConcurrencyLimit();
  const runningCountRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM download_jobs WHERE status = 'running'`)
    .get() as { cnt: number };

  const availableSlots = limit - (runningCountRow?.cnt || 0);
  if (availableSlots <= 0) return;

  // Priority ordering: high (1), normal (2), low (3), then oldest created_at
  const nextJobs = db
    .prepare(
      `SELECT * FROM download_jobs
       WHERE status = 'queued'
       ORDER BY
         CASE priority WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END ASC,
         created_at ASC
       LIMIT ?`
    )
    .all(availableSlots) as unknown as DownloadJobRow[];

  for (const job of nextJobs) {
    executeDownloadJob(job.id).catch(() => undefined);
  }
}

async function executeHlsDownload(job: DownloadJobRow, controller: AbortController) {
  const { response: manifestResp, finalUrl } = await fetchWithSafeRedirects(job.url, {
    headers: { 'User-Agent': 'NOIR-Video-Studio/2.0' },
    signal: controller.signal,
  });

  if (!manifestResp.ok) {
    throw {
      code: 'HLS_HTTP_ERROR',
      message: `HLS ম্যানিফেস্ট ডাউনলোড ব্যর্থ হয়েছে (HTTP ${manifestResp.status})`,
      retryable: manifestResp.status >= 500,
    };
  }

  const manifestText = await manifestResp.text();
  if (manifestText.includes('#EXT-X-KEY') && !manifestText.includes('METHOD=NONE')) {
    throw {
      code: 'DRM_ENCRYPTED_STREAM',
      message: 'এই HLS স্ট্রিমটি এনক্রিপ্টেড বা DRM সুরক্ষিত। NOIR Video Studio অ্যাক্সেস কন্ট্রোল বাইপাস করে না।',
      retryable: false,
    };
  }

  let mediaPlaylistUrl = finalUrl;
  let mediaManifestText = manifestText;

  // If Master Playlist, select the first variant stream URL
  if (manifestText.includes('#EXT-X-STREAM-INF')) {
    const lines = manifestText.split(/\r?\n/).map((l) => l.trim());
    let variantUri = '';
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1] && !lines[i + 1].startsWith('#')) {
        variantUri = lines[i + 1];
        break;
      }
    }
    if (!variantUri) {
      throw {
        code: 'HLS_PARSE_ERROR',
        message: 'HLS মাস্টার ম্যানিফেস্টে কোনো বৈধ ভিডিও ভ্যারিয়েন্ট পাওয়া যায়নি।',
        retryable: false,
      };
    }
    mediaPlaylistUrl = new URL(variantUri, finalUrl).toString();
    const subResp = await fetchWithSafeRedirects(mediaPlaylistUrl, {
      headers: { 'User-Agent': 'NOIR-Video-Studio/2.0' },
      signal: controller.signal,
    });
    if (!subResp.response.ok) {
      throw {
        code: 'HLS_VARIANT_ERROR',
        message: 'HLS ভ্যারিয়েন্ট প্লেলিস্ট লোড করা যায়নি।',
        retryable: true,
      };
    }
    mediaManifestText = await subResp.response.text();
    mediaPlaylistUrl = subResp.finalUrl;
  }

  if (mediaManifestText.includes('#EXT-X-KEY') && !mediaManifestText.includes('METHOD=NONE')) {
    throw {
      code: 'DRM_ENCRYPTED_STREAM',
      message: 'এই HLS ভ্যারিয়েন্টটি এনক্রিপ্টেড (#EXT-X-KEY)। এনক্রিপ্টেড স্ট্রিম ডাউনলোড সমর্থিত নয়।',
      retryable: false,
    };
  }

  const segmentUrls: string[] = [];
  const lines = mediaManifestText.split(/\r?\n/).map((l) => l.trim());
  for (const line of lines) {
    if (line && !line.startsWith('#')) {
      segmentUrls.push(new URL(line, mediaPlaylistUrl).toString());
    }
  }

  if (segmentUrls.length === 0) {
    throw {
      code: 'HLS_NO_SEGMENTS',
      message: 'HLS প্লেলিস্টে কোনো ডাউনলোডযোগ্য ভিডিও সেগমেন্ট (.ts/.m4s) পাওয়া যায়নি।',
      retryable: false,
    };
  }

  // Cap segments to 40 for fast, bounded server storage protection
  const boundedSegments = segmentUrls.slice(0, 40);
  const storagePath = job.storage_path || path.join(DOWNLOADS_DIR, `${job.id}_${job.filename}`);
  const fileStream = fs.createWriteStream(storagePath, { flags: 'w' });

  let loadedBytes = 0;
  const startTime = Date.now();

  try {
    for (let idx = 0; idx < boundedSegments.length; idx++) {
      if (controller.signal.aborted) break;
      const segUrl = boundedSegments[idx];
      const { response: segResp } = await fetchWithSafeRedirects(segUrl, {
        headers: { 'User-Agent': 'NOIR-Video-Studio/2.0' },
        signal: controller.signal,
      });

      if (!segResp.ok || !segResp.body) {
        throw {
          code: 'HLS_SEGMENT_FAILED',
          message: `সেগমেন্ট ${idx + 1}/${boundedSegments.length} ডাউনলোড ব্যর্থ হয়েছে।`,
          retryable: true,
        };
      }

      const buf = Buffer.from(await segResp.arrayBuffer());
      loadedBytes += buf.byteLength;

      if (loadedBytes > maxDownloadSizeMb * 1024 * 1024) {
        throw {
          code: 'FILE_TOO_LARGE',
          message: `ফাইলের আকার নির্ধারিত সীমা (${maxDownloadSizeMb} MB) অতিক্রম করেছে।`,
          retryable: false,
        };
      }

      fileStream.write(buf);

      const elapsedSec = Math.max(0.2, (Date.now() - startTime) / 1000);
      const speedBps = Math.round(loadedBytes / elapsedSec);
      const estimatedTotal = Math.round((loadedBytes / (idx + 1)) * boundedSegments.length);
      const remainingBytes = Math.max(0, estimatedTotal - loadedBytes);
      const etaSec = speedBps > 0 ? Math.round(remainingBytes / speedBps) : null;

      db.prepare(
        `UPDATE download_jobs
         SET loaded_bytes = ?, total_bytes = ?, speed_bps = ?, eta_seconds = ?, final_url = ?, updated_at = ?
         WHERE id = ?`
      ).run(loadedBytes, estimatedTotal, speedBps, etaSec, finalUrl, new Date().toISOString(), job.id);
    }
  } finally {
    await new Promise<void>((resolve) => fileStream.end(() => resolve()));
  }

  if (controller.signal.aborted) return;

  const checksum = await computeFileSha256(storagePath);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE download_jobs
     SET status = 'completed',
         loaded_bytes = ?,
         total_bytes = ?,
         speed_bps = 0,
         eta_seconds = 0,
         sha256_checksum = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(loadedBytes, loadedBytes, checksum, now, job.id);
}

export async function executeDownloadJob(jobId: string) {
  const job = getDownloadJobById(jobId);
  if (!job || job.status !== 'queued') return;

  const controller = new AbortController();
  activeControllers.set(jobId, controller);

  const nowStart = new Date().toISOString();
  db.prepare(
    `UPDATE download_jobs SET status = 'running', error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?`
  ).run(nowStart, jobId);

  try {
    if (job.format === 'HLS' || job.url.toLowerCase().includes('.m3u8')) {
      await executeHlsDownload(job, controller);
    } else {
      const storagePath = job.storage_path || path.join(DOWNLOADS_DIR, `${job.id}_${job.filename}`);
      let existingBytes = 0;
      if (job.loaded_bytes > 0 && fs.existsSync(storagePath)) {
        existingBytes = fs.statSync(storagePath).size;
      }

      const headers: Record<string, string> = {
        'User-Agent': 'NOIR-Video-Studio/2.0',
      };
      if (existingBytes > 0) {
        headers['Range'] = `bytes=${existingBytes}-`;
      }

      const { response, finalUrl } = await fetchWithSafeRedirects(job.url, {
        headers,
        signal: controller.signal,
      });

      if (!response.ok && response.status !== 206) {
        throw {
          code: `HTTP_${response.status}`,
          message: `রিমোট সার্ভার ফাইল ডাউনলোড প্রত্যাখ্যান করেছে (HTTP ${response.status})।`,
          retryable: response.status >= 500 || response.status === 429,
        };
      }

      const isPartial = response.status === 206;
      const acceptRanges =
        isPartial ||
        (response.headers.get('accept-ranges') || '').toLowerCase() === 'bytes';
      const contentLenHeader = response.headers.get('content-length');
      const parsedLen = contentLenHeader ? parseInt(contentLenHeader, 10) : null;
      const totalBytes =
        parsedLen !== null && !Number.isNaN(parsedLen)
          ? isPartial
            ? existingBytes + parsedLen
            : parsedLen
          : null;

      if (totalBytes && totalBytes > maxDownloadSizeMb * 1024 * 1024) {
        throw {
          code: 'FILE_TOO_LARGE',
          message: `ফাইলের আকার (${Math.round(totalBytes / (1024 * 1024))} MB) সার্ভারের সর্বোচ্চ সীমা (${maxDownloadSizeMb} MB) অতিক্রম করেছে।`,
          retryable: false,
        };
      }

      if (!response.body) {
        throw {
          code: 'EMPTY_BODY',
          message: 'রিমোট সার্ভার থেকে কোনো মিডিয়া স্ট্রিম পাওয়া যায়নি।',
          retryable: true,
        };
      }

      const writeFlags = isPartial && existingBytes > 0 ? 'a' : 'w';
      let loadedBytes = isPartial ? existingBytes : 0;
      const fileStream = fs.createWriteStream(storagePath, { flags: writeFlags });
      const reader = response.body.getReader();
      const startTime = Date.now();
      let sessionBytes = 0;
      let lastDbUpdate = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            loadedBytes += value.byteLength;
            sessionBytes += value.byteLength;

            if (loadedBytes > maxDownloadSizeMb * 1024 * 1024) {
              throw {
                code: 'FILE_TOO_LARGE',
                message: `ডাউনলোড সাইজ নির্ধারিত সীমা (${maxDownloadSizeMb} MB) অতিক্রম করেছে।`,
                retryable: false,
              };
            }

            if (!fileStream.write(Buffer.from(value))) {
              await new Promise<void>((resolve) => fileStream.once('drain', () => resolve()));
            }

            const nowMs = Date.now();
            if (nowMs - lastDbUpdate > 250) {
              lastDbUpdate = nowMs;
              const elapsedSec = Math.max(0.2, (nowMs - startTime) / 1000);
              const speedBps = Math.round(sessionBytes / elapsedSec);
              const etaSeconds =
                totalBytes && speedBps > 0
                  ? Math.max(0, Math.round((totalBytes - loadedBytes) / speedBps))
                  : null;

              db.prepare(
                `UPDATE download_jobs
                 SET loaded_bytes = ?,
                     total_bytes = ?,
                     speed_bps = ?,
                     eta_seconds = ?,
                     supports_range = ?,
                     final_url = ?,
                     updated_at = ?
                 WHERE id = ?`
              ).run(
                loadedBytes,
                totalBytes,
                speedBps,
                etaSeconds,
                acceptRanges ? 1 : 0,
                finalUrl,
                new Date().toISOString(),
                jobId
              );
            }
          }
        }
      } finally {
        await new Promise<void>((resolve) => fileStream.end(() => resolve()));
      }

      if (controller.signal.aborted) return;

      const checksum = await computeFileSha256(storagePath);
      db.prepare(
        `UPDATE download_jobs
         SET status = 'completed',
             loaded_bytes = ?,
             total_bytes = ?,
             speed_bps = 0,
             eta_seconds = 0,
             supports_range = ?,
             sha256_checksum = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(
        loadedBytes,
        loadedBytes,
        acceptRanges ? 1 : 0,
        checksum,
        new Date().toISOString(),
        jobId
      );
    }

    // Also add or mark in media_library as downloaded
    const completedJob = getDownloadJobById(jobId);
    if (completedJob && completedJob.status === 'completed') {
      logAuditEvent('DOWNLOAD', 'INFO', `Download completed: ${completedJob.filename}`, {
        jobId,
        bytes: completedJob.loaded_bytes,
        sha256: completedJob.sha256_checksum,
      });
    }
  } catch (err: unknown) {
    const currentJob = getDownloadJobById(jobId);
    if (!currentJob) return;

    // If paused or cancelled intentionally via controller.abort(), keep that status
    if (currentJob.status === 'paused' || currentJob.status === 'cancelled') {
      return;
    }

    const structured = err as { code?: string; message?: string; retryable?: boolean };
    const isRetryable = structured.retryable !== false;
    const errCode = structured.code || 'DOWNLOAD_ERROR';
    const errMsg =
      structured.message ||
      (err instanceof Error ? err.message : 'ডাউনলোড চলাকালীন নেটওয়ার্ক ত্রুটি ঘটেছে।');

    const { autoRetry } = getAutoRetryConfig();
    if (autoRetry && isRetryable && currentJob.retry_count < currentJob.max_retries) {
      const nextRetry = currentJob.retry_count + 1;
      db.prepare(
        `UPDATE download_jobs
         SET status = 'queued',
             retry_count = ?,
             speed_bps = 0,
             error_code = ?,
             error_message = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(
        nextRetry,
        errCode,
        `অটো-রিট্রাই (${nextRetry}/${currentJob.max_retries}): ${errMsg}`,
        new Date().toISOString(),
        jobId
      );
      setTimeout(() => processDownloadQueue(), 1500 * nextRetry);
    } else {
      db.prepare(
        `UPDATE download_jobs
         SET status = 'failed',
             speed_bps = 0,
             eta_seconds = NULL,
             error_code = ?,
             error_message = ?,
             is_retryable = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(errCode, errMsg, isRetryable ? 1 : 0, new Date().toISOString(), jobId);

      logAuditEvent('DOWNLOAD', 'ERROR', `Download failed: ${errMsg}`, {
        jobId,
        url: maskSensitiveUrlForLog(currentJob.url),
        errCode,
      });
    }
  } finally {
    activeControllers.delete(jobId);
    setImmediate(() => processDownloadQueue());
  }
}

export function pauseDownloadJob(jobId: string): DownloadJobRow | undefined {
  const job = getDownloadJobById(jobId);
  if (!job) return undefined;

  const warningMsg =
    job.supports_range === 0 && job.loaded_bytes > 0
      ? 'সতর্কতা: এই রিমোট সার্ভারটি HTTP Range সমর্থন করে না; Resume করলে প্রথম থেকে ডাউনলোড হতে পারে।'
      : null;

  db.prepare(
    `UPDATE download_jobs
     SET status = 'paused', speed_bps = 0, eta_seconds = NULL, error_message = ?, updated_at = ?
     WHERE id = ?`
  ).run(warningMsg, new Date().toISOString(), jobId);

  const ctrl = activeControllers.get(jobId);
  if (ctrl) {
    ctrl.abort();
    activeControllers.delete(jobId);
  }
  setImmediate(() => processDownloadQueue());
  return getDownloadJobById(jobId);
}

export function resumeDownloadJob(jobId: string): DownloadJobRow | undefined {
  const job = getDownloadJobById(jobId);
  if (!job) return undefined;

  db.prepare(
    `UPDATE download_jobs
     SET status = 'queued', error_code = NULL, error_message = NULL, updated_at = ?
     WHERE id = ?`
  ).run(new Date().toISOString(), jobId);

  setImmediate(() => processDownloadQueue());
  return getDownloadJobById(jobId);
}

export function cancelDownloadJob(jobId: string): DownloadJobRow | undefined {
  const job = getDownloadJobById(jobId);
  if (!job) return undefined;

  db.prepare(
    `UPDATE download_jobs
     SET status = 'cancelled', speed_bps = 0, eta_seconds = NULL, loaded_bytes = 0, updated_at = ?
     WHERE id = ?`
  ).run(new Date().toISOString(), jobId);

  const ctrl = activeControllers.get(jobId);
  if (ctrl) {
    ctrl.abort();
    activeControllers.delete(jobId);
  }

  // Clean up partial file on disk
  if (job.storage_path && fs.existsSync(job.storage_path)) {
    try {
      fs.unlinkSync(job.storage_path);
    } catch {
      // ignore unlink error
    }
  }

  setImmediate(() => processDownloadQueue());
  return getDownloadJobById(jobId);
}

export function deleteDownloadJobAndFile(jobId: string): boolean {
  const job = getDownloadJobById(jobId);
  if (!job) return false;

  const ctrl = activeControllers.get(jobId);
  if (ctrl) {
    ctrl.abort();
    activeControllers.delete(jobId);
  }

  if (job.storage_path && fs.existsSync(job.storage_path)) {
    try {
      fs.unlinkSync(job.storage_path);
    } catch {
      // ignore
    }
  }

  db.prepare('DELETE FROM download_jobs WHERE id = ?').run(jobId);
  setImmediate(() => processDownloadQueue());
  return true;
}

export function renameDownloadedFile(jobId: string, newFilename: string): DownloadJobRow | undefined {
  const job = getDownloadJobById(jobId);
  if (!job) return undefined;

  const ext = job.format === 'HLS' ? 'ts' : job.format === 'WEBM' ? 'webm' : 'mp4';
  const safeName = sanitizeSafeFilename(newFilename, ext);
  let newStoragePath = job.storage_path;

  if (job.storage_path && fs.existsSync(job.storage_path)) {
    const targetPath = path.join(DOWNLOADS_DIR, `${job.id}_${safeName}`);
    try {
      fs.renameSync(job.storage_path, targetPath);
      newStoragePath = targetPath;
    } catch {
      // keep existing path if rename fails
    }
  }

  db.prepare(
    `UPDATE download_jobs SET filename = ?, title = ?, storage_path = ?, updated_at = ? WHERE id = ?`
  ).run(safeName, newFilename.trim() || safeName, newStoragePath, new Date().toISOString(), jobId);

  return getDownloadJobById(jobId);
}

export function getStorageUsageSummary(): {
  totalFilesCount: number;
  totalDiskBytes: number;
  maxLimitMb: number;
} {
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    let totalDiskBytes = 0;
    for (const f of files) {
      const full = path.join(DOWNLOADS_DIR, f);
      const stat = fs.statSync(full);
      if (stat.isFile()) totalDiskBytes += stat.size;
    }
    return {
      totalFilesCount: files.length,
      totalDiskBytes,
      maxLimitMb: maxDownloadSizeMb,
    };
  } catch {
    return { totalFilesCount: 0, totalDiskBytes: 0, maxLimitMb: maxDownloadSizeMb };
  }
}
