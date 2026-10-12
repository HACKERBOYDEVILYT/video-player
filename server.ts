import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Readable } from 'stream';
import { db, initDatabase, logAuditEvent } from './src/server/db';
import {
  validateUrlAndResolveDns,
  fetchWithSafeRedirects,
  sanitizeSafeFilename,
  verifyPassword,
  maskSensitiveUrlForLog,
} from './src/server/security';
import {
  getAllDownloadJobs,
  getDownloadJobById,
  createQueuedDownloadJob,
  pauseDownloadJob,
  resumeDownloadJob,
  cancelDownloadJob,
  deleteDownloadJobAndFile,
  renameDownloadedFile,
  getStorageUsageSummary,
  processDownloadQueue,
  getMaxDownloadSizeMb,
  setMaxDownloadSizeMb,
} from './src/server/downloadManager';

initDatabase();

export const app = express();
const PORT = 3000;
const SERVER_START_TIME = Date.now();
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

app.use(express.json({ limit: '2mb' }));

// Security headers middleware
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Configurable rate limiter
let maxRequestsPerMinute = 90;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function rateLimit(customMax?: number, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const limit = customMax || maxRequestsPerMinute;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = rateLimitMap.get(ip);
    if (!record || now > record.resetAt) {
      rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (record.count >= limit) {
      logAuditEvent('RATE_LIMIT', 'WARN', `Rate limit exceeded from IP ${ip}`, {
        path: req.path,
        limit,
      });
      return res.status(429).json({
        errorCode: 'RATE_LIMITED',
        error: 'অতিরিক্ত অনুরোধ পাঠানো হয়েছে। অনুগ্রহ করে কিছুক্ষণ অপেক্ষা করে আবার চেষ্টা করুন (Rate limit exceeded)।',
      });
    }
    record.count += 1;
    next();
  };
}

// Admin token generation & verification
function issueAdminToken(username: string, role: string): string {
  const payload = Buffer.from(
    JSON.stringify({ username, role, exp: Date.now() + 8 * 3600 * 1000 })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyAdminToken(token: string): { valid: boolean; username?: string; role?: string } {
  try {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return { valid: false };
    const expectedSig = crypto
      .createHmac('sha256', ADMIN_TOKEN_SECRET)
      .update(payload)
      .digest('base64url');
    if (sig !== expectedSig) return { valid: false };
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (Date.now() > decoded.exp || decoded.role !== 'admin') {
      return { valid: false };
    }
    return { valid: true, username: decoded.username, role: decoded.role };
  } catch {
    return { valid: false };
  }
}

function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      errorCode: 'UNAUTHORIZED',
      error: 'অ্যাডমিন ড্যাশবোর্ড অ্যাক্সেসের জন্য বৈধ টোকেন প্রয়োজন।',
    });
  }
  const token = authHeader.slice(7).trim();
  const verification = verifyAdminToken(token);
  if (!verification.valid) {
    return res.status(403).json({
      errorCode: 'FORBIDDEN',
      error: 'অ্যাডমিন সেশন মেয়াদোত্তীর্ণ বা অবৈধ। অনুগ্রহ করে পুনরায় লগইন করুন।',
    });
  }
  next();
}

function detectFormatFromUrlAndMime(urlStr: string, contentType: string): {
  format: 'MP4' | 'WEBM' | 'HLS' | 'OGV' | 'UNKNOWN';
  isHls: boolean;
  isDirectPlayable: boolean;
} {
  const lowerUrl = urlStr.toLowerCase().split('?')[0];
  const lowerMime = (contentType || '').toLowerCase();

  if (
    lowerUrl.endsWith('.m3u8') ||
    lowerMime.includes('application/vnd.apple.mpegurl') ||
    lowerMime.includes('application/x-mpegurl') ||
    lowerMime.includes('audio/mpegurl')
  ) {
    return { format: 'HLS', isHls: true, isDirectPlayable: true };
  }
  if (lowerUrl.endsWith('.webm') || lowerMime.includes('video/webm')) {
    return { format: 'WEBM', isHls: false, isDirectPlayable: true };
  }
  if (lowerUrl.endsWith('.ogv') || lowerUrl.endsWith('.ogg') || lowerMime.includes('video/ogg')) {
    return { format: 'OGV', isHls: false, isDirectPlayable: true };
  }
  if (
    lowerUrl.endsWith('.mp4') ||
    lowerUrl.endsWith('.m4v') ||
    lowerUrl.endsWith('.mov') ||
    lowerMime.includes('video/mp4') ||
    lowerMime.includes('video/quicktime') ||
    lowerMime.includes('application/octet-stream')
  ) {
    return { format: 'MP4', isHls: false, isDirectPlayable: true };
  }
  if (lowerMime.includes('text/html')) {
    return { format: 'UNKNOWN', isHls: false, isDirectPlayable: false };
  }
  return { format: 'MP4', isHls: false, isDirectPlayable: true };
}

// 1. Health Check API
app.get('/api/health', (_req: Request, res: Response) => {
  const jobs = getAllDownloadJobs();
  const running = jobs.filter((j) => j.status === 'running').length;
  const queued = jobs.filter((j) => j.status === 'queued').length;
  res.json({
    status: 'ok',
    service: 'NOIR Video Studio API (Robiul Video Studio)',
    uptimeSeconds: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
    database: 'connected (SQLite ACID)',
    activeDownloads: running,
    queuedDownloads: queued,
    timestamp: new Date().toISOString(),
  });
});

// 2. Smart URL Analyzer API
app.post('/api/video/inspect', rateLimit(45, 60_000), async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      errorCode: 'INVALID_URL',
      error: 'ভিডিও URL প্রদান করা আবশ্যক।',
    });
  }

  const securityCheck = await validateUrlAndResolveDns(url);
  if (!securityCheck.valid) {
    logAuditEvent(
      securityCheck.errorCode?.startsWith('SSRF') ? 'SECURITY_SSRF' : 'SYSTEM',
      'WARN',
      securityCheck.reason || 'URL validation rejected',
      { url: maskSensitiveUrlForLog(url), errorCode: securityCheck.errorCode }
    );
    return res.status(400).json({
      errorCode: securityCheck.errorCode || 'INVALID_URL',
      error: securityCheck.reason || 'অবৈধ URL।',
      isPlatformPage: securityCheck.isPlatformPage || false,
      platformName: securityCheck.platformName,
    });
  }

  const targetUrl = securityCheck.parsedUrl!.toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    let probeResult = await fetchWithSafeRedirects(targetUrl, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'NOIR-Video-Studio/2.0',
        Accept: '*/*',
      },
      signal: controller.signal,
    }).catch(() => null);

    if (
      !probeResult ||
      !probeResult.response.ok ||
      probeResult.response.status === 405 ||
      probeResult.response.status === 403
    ) {
      probeResult = await fetchWithSafeRedirects(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'NOIR-Video-Studio/2.0',
          Range: 'bytes=0-1023',
        },
        signal: controller.signal,
      });
    }

    clearTimeout(timeout);

    const { response, finalUrl, redirectHops } = probeResult;
    if (!response.ok && response.status !== 206) {
      return res.status(422).json({
        errorCode: `HTTP_${response.status}`,
        error: `রিমোট সার্ভার স্ট্রিমটি প্রত্যাখ্যান করেছে (HTTP ${response.status})। লিংকটি মেয়াদোত্তীর্ণ বা অ্যাক্সেস সীমাবদ্ধ হতে পারে।`,
      });
    }

    const contentType = response.headers.get('content-type') || '';
    const contentLengthHeader = response.headers.get('content-length');
    const contentRangeHeader = response.headers.get('content-range');
    const acceptRangesHeader = response.headers.get('accept-ranges') || 'none';
    const corsHeader = response.headers.get('access-control-allow-origin');

    let totalBytes: number | null = null;
    if (contentRangeHeader && contentRangeHeader.includes('/')) {
      const totalPart = contentRangeHeader.split('/')[1];
      const parsedTotal = parseInt(totalPart, 10);
      if (!Number.isNaN(parsedTotal)) totalBytes = parsedTotal;
    } else if (contentLengthHeader) {
      const parsedLen = parseInt(contentLengthHeader, 10);
      if (!Number.isNaN(parsedLen) && parsedLen > 1024) totalBytes = parsedLen;
    }

    const detected = detectFormatFromUrlAndMime(finalUrl, contentType);
    if (!detected.isDirectPlayable) {
      if (response.body) await response.body.cancel().catch(() => undefined);
      return res.status(422).json({
        errorCode: 'UNSUPPORTED_HTML_PAGE',
        error: 'প্রদত্ত লিংকটি একটি HTML ওয়েবপেজ, সরাসরি ভিডিও স্ট্রিম নয়। অনুগ্রহ করে সরাসরি MP4, WebM বা M3U8 স্ট্রিম লিংক দিন।',
      });
    }

    let hlsVariants: Array<{ resolution: string; bandwidth: number; codecs?: string }> = [];
    let hlsAudioTracks: string[] = [];
    let hlsSubtitleTracks: string[] = [];
    let hlsSegmentsCount = 0;
    let isEncryptedDrm = false;

    if (detected.isHls) {
      const manifestFetch = await fetchWithSafeRedirects(finalUrl, {
        headers: { 'User-Agent': 'NOIR-Video-Studio/2.0' },
      }).catch(() => null);

      if (manifestFetch && manifestFetch.response.ok) {
        const text = await manifestFetch.response.text();
        if (text.includes('#EXT-X-KEY') && !text.includes('METHOD=NONE')) {
          isEncryptedDrm = true;
        }
        const lines = text.split(/\r?\n/);
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (line.startsWith('#EXT-X-STREAM-INF:')) {
            const resMatch = line.match(/RESOLUTION=(\d+x\d+)/i);
            const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
            const codecMatch = line.match(/CODECS="([^"]+)"/i);
            hlsVariants.push({
              resolution: resMatch ? resMatch[1] : 'Adaptive',
              bandwidth: bwMatch ? Math.round(parseInt(bwMatch[1], 10) / 1000) : 0,
              codecs: codecMatch ? codecMatch[1] : undefined,
            });
          } else if (line.startsWith('#EXT-X-MEDIA:') && line.includes('TYPE=AUDIO')) {
            const nameMatch = line.match(/NAME="([^"]+)"/i);
            if (nameMatch) hlsAudioTracks.push(nameMatch[1]);
          } else if (line.startsWith('#EXT-X-MEDIA:') && line.includes('TYPE=SUBTITLES')) {
            const nameMatch = line.match(/NAME="([^"]+)"/i);
            if (nameMatch) hlsSubtitleTracks.push(nameMatch[1]);
          } else if (line.startsWith('#EXTINF:')) {
            hlsSegmentsCount += 1;
          }
        }
      }
    }

    if (response.body) {
      await response.body.cancel().catch(() => undefined);
    }

    const ext = detected.isHls ? 'm3u8' : detected.format === 'WEBM' ? 'webm' : 'mp4';
    const filename = sanitizeSafeFilename(finalUrl, ext);
    const acceptRanges = acceptRangesHeader === 'bytes' || Boolean(contentRangeHeader);
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO analyzed_urls (
        id, original_url, final_url, format, mime_type, size_bytes,
        accept_ranges, is_hls, is_direct_playable, is_download_allowed,
        redirect_hops, platform_notice, status_code, analyzed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `anl-${Date.now()}`,
      targetUrl,
      finalUrl,
      detected.format,
      contentType || (detected.isHls ? 'application/vnd.apple.mpegurl' : 'video/mp4'),
      totalBytes,
      acceptRanges ? 1 : 0,
      detected.isHls ? 1 : 0,
      1,
      isEncryptedDrm ? 0 : 1,
      redirectHops,
      isEncryptedDrm ? 'Encrypted / DRM Protected Stream' : null,
      response.status,
      now
    );

    return res.json({
      url: targetUrl,
      finalUrl,
      redirectHops,
      filename,
      format: detected.format,
      isHls: detected.isHls,
      isEncryptedDrm,
      contentType: contentType || (detected.isHls ? 'application/vnd.apple.mpegurl' : 'video/mp4'),
      sizeBytes: totalBytes,
      acceptRanges,
      corsSupported: Boolean(corsHeader),
      hlsVariants,
      hlsAudioTracks,
      hlsSubtitleTracks,
      hlsSegmentsCount,
      isDirectPlayable: true,
      isDownloadAllowed: !isEncryptedDrm,
      verifiedAt: now,
    });
  } catch (err: unknown) {
    clearTimeout(timeout);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const message = isTimeout
      ? 'সার্ভারের সাথে সংযোগের সময়সীমা শেষ হয়েছে (Connection Timeout 10s)।'
      : err instanceof Error
      ? err.message
      : 'ভিডিও সার্ভারের সাথে সংযোগ স্থাপন করা যায়নি।';
    return res.status(502).json({
      errorCode: isTimeout ? 'TIMEOUT' : 'NETWORK_FAILURE',
      error: message,
    });
  }
});

// Get recently analyzed URLs history
app.get('/api/analyzer/history', (_req: Request, res: Response) => {
  const rows = db
    .prepare('SELECT * FROM analyzed_urls ORDER BY analyzed_at DESC LIMIT 25')
    .all();
  res.json({ items: rows });
});

// Delete analyzed URL history
app.delete('/api/analyzer/history', (_req: Request, res: Response) => {
  db.prepare('DELETE FROM analyzed_urls').run();
  res.json({ ok: true });
});

// 3. Secure Stream Proxy (Supports HTTP Range for seeking & CORS bypass)
app.get('/api/video/stream', rateLimit(180, 60_000), async (req: Request, res: Response) => {
  const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
  const validation = await validateUrlAndResolveDns(rawUrl);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.reason || 'Invalid stream URL.' });
  }

  try {
    const headers: Record<string, string> = {
      'User-Agent': 'NOIR-Video-Studio/2.0',
    };
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const { response: upstream } = await fetchWithSafeRedirects(
      validation.parsedUrl!.toString(),
      { headers }
    );

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({ error: `Upstream returned ${upstream.status}` });
    }

    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const val = upstream.headers.get(h);
      if (val) res.setHeader(h, val);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (!upstream.body) return res.end();

    const nodeStream = Readable.fromWeb(upstream.body as import('stream/web').ReadableStream);
    req.on('close', () => nodeStream.destroy());
    nodeStream.pipe(res);
  } catch {
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to proxy video stream.' });
    }
  }
});

// 4. Advanced Download Queue APIs
app.get('/api/downloads', (_req: Request, res: Response) => {
  const jobs = getAllDownloadJobs();
  const storage = getStorageUsageSummary();
  res.json({ jobs, storage });
});

app.post('/api/downloads', rateLimit(30, 60_000), async (req: Request, res: Response) => {
  const { title, url, format, priority, filename, authorized } = req.body as {
    title?: string;
    url?: string;
    format?: string;
    priority?: 'high' | 'normal' | 'low';
    filename?: string;
    authorized?: boolean;
  };

  if (!authorized) {
    return res.status(403).json({
      errorCode: 'PERMISSION_DENIED',
      error: 'অনুমতি ছাড়া ভিডিও ডাউনলোড নিষিদ্ধ। অনুগ্রহ করে বৈধ অনুমতি বা লাইসেন্স নিশ্চিত করুন।',
    });
  }

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ errorCode: 'INVALID_URL', error: 'ভিডিও URL প্রদান করুন।' });
  }

  const securityCheck = await validateUrlAndResolveDns(url);
  if (!securityCheck.valid) {
    logAuditEvent('SECURITY_SSRF', 'WARN', `Blocked download creation: ${securityCheck.reason}`, {
      url: maskSensitiveUrlForLog(url),
    });
    return res.status(400).json({
      errorCode: securityCheck.errorCode,
      error: securityCheck.reason,
    });
  }

  const resolvedFormat =
    format ||
    (url.toLowerCase().includes('.m3u8')
      ? 'HLS'
      : url.toLowerCase().includes('.webm')
      ? 'WEBM'
      : 'MP4');

  const { job, isDuplicate } = createQueuedDownloadJob({
    title: title || 'NOIR Studio Video',
    url: securityCheck.parsedUrl!.toString(),
    format: resolvedFormat,
    priority: priority || 'normal',
    filename,
  });

  res.status(isDuplicate ? 200 : 201).json({ job, isDuplicate });
});

app.post('/api/downloads/:id/action', (req: Request, res: Response) => {
  const { id } = req.params;
  const { action } = req.body as { action?: 'pause' | 'resume' | 'cancel' | 'retry' };

  if (action === 'pause') {
    const updated = pauseDownloadJob(id);
    if (!updated) return res.status(404).json({ error: 'ডাউনলোড জব খুঁজে পাওয়া যায়নি।' });
    return res.json({ job: updated });
  }
  if (action === 'resume' || action === 'retry') {
    const updated = resumeDownloadJob(id);
    if (!updated) return res.status(404).json({ error: 'ডাউনলোড জব খুঁজে পাওয়া যায়নি।' });
    return res.json({ job: updated });
  }
  if (action === 'cancel') {
    const updated = cancelDownloadJob(id);
    if (!updated) return res.status(404).json({ error: 'ডাউনলোড জব খুঁজে পাওয়া যায়নি।' });
    return res.json({ job: updated });
  }

  return res.status(400).json({ error: 'Invalid action. Use pause, resume, cancel, or retry.' });
});

app.patch('/api/downloads/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { filename } = req.body as { filename?: string };
  if (!filename || typeof filename !== 'string') {
    return res.status(400).json({ error: 'নতুন ফাইলনেম প্রদান করুন।' });
  }
  const updated = renameDownloadedFile(id, filename);
  if (!updated) return res.status(404).json({ error: 'ডাউনলোড জব খুঁজে পাওয়া যায়নি।' });
  res.json({ job: updated });
});

app.delete('/api/downloads/:id', (req: Request, res: Response) => {
  const ok = deleteDownloadJobAndFile(req.params.id);
  if (!ok) return res.status(404).json({ error: 'ডাউনলোড জব খুঁজে পাওয়া যায়নি।' });
  res.json({ ok: true });
});

app.get('/api/downloads/:id/file', (req: Request, res: Response) => {
  const job = getDownloadJobById(req.params.id);
  if (!job || job.status !== 'completed' || !job.storage_path || !fs.existsSync(job.storage_path)) {
    return res.status(404).json({ error: 'ডাউনলোড করা ফাইলটি সার্ভারে খুঁজে পাওয়া যায়নি।' });
  }
  res.download(job.storage_path, job.filename);
});

// Direct browser stream download fallback
app.get('/api/video/download', rateLimit(25, 60_000), async (req: Request, res: Response) => {
  const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
  const authorized = req.query.authorized === 'true';

  if (!authorized) {
    return res.status(403).json({
      error: 'অনুমতি ছাড়া ভিডিও ডাউনলোড নিষিদ্ধ (Permission required)।',
    });
  }

  const validation = await validateUrlAndResolveDns(rawUrl);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.reason || 'অবৈধ URL।' });
  }

  try {
    const { response: upstream, finalUrl } = await fetchWithSafeRedirects(
      validation.parsedUrl!.toString(),
      { headers: { 'User-Agent': 'NOIR-Video-Studio/2.0' } }
    );

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `HTTP ${upstream.status}` });
    }

    const contentType = upstream.headers.get('content-type') || 'video/mp4';
    const contentLength = upstream.headers.get('content-length');
    const detected = detectFormatFromUrlAndMime(finalUrl, contentType);
    const ext = detected.isHls ? 'm3u8' : detected.format === 'WEBM' ? 'webm' : 'mp4';
    const customName =
      typeof req.query.filename === 'string' && req.query.filename.trim()
        ? sanitizeSafeFilename(req.query.filename, ext)
        : sanitizeSafeFilename(finalUrl, ext);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${customName}"`);
    if (contentLength) res.setHeader('Content-Length', contentLength);

    if (!upstream.body) return res.end();
    const nodeStream = Readable.fromWeb(upstream.body as import('stream/web').ReadableStream);
    req.on('close', () => nodeStream.destroy());
    nodeStream.pipe(res);
  } catch {
    if (!res.headersSent) {
      res.status(502).json({ error: 'ডাউনলোড সংযোগ বিচ্ছিন্ন হয়েছে।' });
    }
  }
});

// 5. User Settings & Preferences API
app.get('/api/settings', (_req: Request, res: Response) => {
  const prefs = db
    .prepare('SELECT * FROM user_preferences WHERE user_id = ?')
    .get('default');
  res.json({ preferences: prefs });
});

app.put('/api/settings', (req: Request, res: Response) => {
  const {
    theme,
    max_concurrent_downloads,
    auto_retry_downloads,
    max_retry_count,
    default_playback_speed,
    storage_directory,
  } = req.body as Record<string, unknown>;

  const concurrency = Math.max(1, Math.min(5, Number(max_concurrent_downloads) || 2));
  const retryCount = Math.max(0, Math.min(5, Number(max_retry_count) ?? 2));
  const speed = Math.max(0.25, Math.min(2.0, Number(default_playback_speed) || 1.0));

  db.prepare(
    `UPDATE user_preferences
     SET theme = ?,
         max_concurrent_downloads = ?,
         auto_retry_downloads = ?,
         max_retry_count = ?,
         default_playback_speed = ?,
         storage_directory = ?,
         updated_at = ?
     WHERE user_id = 'default'`
  ).run(
    theme === 'light' ? 'light' : 'dark',
    concurrency,
    auto_retry_downloads ? 1 : 0,
    retryCount,
    speed,
    typeof storage_directory === 'string' && storage_directory.trim()
      ? storage_directory.trim()
      : '/storage/downloads',
    new Date().toISOString()
  );

  setImmediate(() => processDownloadQueue());
  const updated = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get('default');
  res.json({ preferences: updated });
});

// 6. Admin Authentication & Protected Telemetry APIs
app.post('/api/admin/login', rateLimit(15, 60_000), (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    return res.status(400).json({ error: 'ইউজারনেম এবং পাসওয়ার্ড প্রদান করুন।' });
  }

  const userRow = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username.trim()) as
    | { id: string; username: string; password_hash: string; password_salt: string; role: string }
    | undefined;

  if (!userRow || !verifyPassword(password, userRow.password_hash, userRow.password_salt)) {
    logAuditEvent('AUTH', 'WARN', `Failed admin login attempt for username: ${username}`);
    return res.status(401).json({
      errorCode: 'INVALID_CREDENTIALS',
      error: 'ভুল ইউজারনেম অথবা পাসওয়ার্ড।',
    });
  }

  if (userRow.role !== 'admin') {
    return res.status(403).json({ error: 'আপনার অ্যাডমিন অ্যাক্সেস নেই।' });
  }

  const token = issueAdminToken(userRow.username, userRow.role);
  logAuditEvent('AUTH', 'INFO', `Admin logged in: ${userRow.username}`);
  res.json({
    token,
    user: { username: userRow.username, role: userRow.role },
  });
});

app.get('/api/admin/telemetry', requireAdminAuth, (_req: Request, res: Response) => {
  const jobs = getAllDownloadJobs();
  const storage = getStorageUsageSummary();
  const mem = process.memoryUsage();
  const logs = db
    .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 40')
    .all();

  const stats = {
    totalJobs: jobs.length,
    runningJobs: jobs.filter((j) => j.status === 'running').length,
    queuedJobs: jobs.filter((j) => j.status === 'queued').length,
    pausedJobs: jobs.filter((j) => j.status === 'paused').length,
    completedJobs: jobs.filter((j) => j.status === 'completed').length,
    failedJobs: jobs.filter((j) => j.status === 'failed').length,
    cancelledJobs: jobs.filter((j) => j.status === 'cancelled').length,
  };

  res.json({
    health: 'NOMINAL',
    uptimeSeconds: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
    nodeVersion: process.version,
    memoryUsageMb: {
      rss: Math.round(mem.rss / (1024 * 1024)),
      heapUsed: Math.round(mem.heapUsed / (1024 * 1024)),
      heapTotal: Math.round(mem.heapTotal / (1024 * 1024)),
    },
    limits: {
      maxRequestsPerMinute,
      maxDownloadSizeMb: getMaxDownloadSizeMb(),
    },
    stats,
    storage,
    auditLogs: logs,
  });
});

app.post('/api/admin/config', requireAdminAuth, (req: Request, res: Response) => {
  const { rateLimitPerMin, maxFileSizeMb } = req.body as {
    rateLimitPerMin?: number;
    maxFileSizeMb?: number;
  };

  if (typeof rateLimitPerMin === 'number' && rateLimitPerMin >= 10 && rateLimitPerMin <= 600) {
    maxRequestsPerMinute = Math.round(rateLimitPerMin);
  }
  if (typeof maxFileSizeMb === 'number' && maxFileSizeMb >= 10 && maxFileSizeMb <= 4096) {
    setMaxDownloadSizeMb(Math.round(maxFileSizeMb));
  }

  logAuditEvent('SYSTEM', 'INFO', 'Admin updated server operational limits', {
    maxRequestsPerMinute,
    maxDownloadSizeMb: getMaxDownloadSizeMb(),
  });

  res.json({
    ok: true,
    limits: {
      maxRequestsPerMinute,
      maxDownloadSizeMb: getMaxDownloadSizeMb(),
    },
  });
});

// 7. Release & Deployment Status
app.get('/api/release/status', (_req: Request, res: Response) => {
  res.json({
    appName: 'NOIR Video Studio — Robiul Video Studio',
    packageId: 'com.noir.videostudio',
    version: 'v2.0.0',
    deployedUrl: process.env.APP_URL || '',
    workflows: {
      releaseYaml: '.github/workflows/release.yml',
      websiteYaml: '.github/workflows/website.yml',
      androidApkReleaseYaml: '.github/workflows/android-apk-release.yml',
    },
    capacitorConfigPath: 'capacitor.config.json',
    pwaManifestReady: true,
    apkArtifacts: [
      'NOIR-Video-Studio-debug.apk',
      'NOIR-Video-Studio-release-unsigned.apk',
      'NOIR-Video-Studio-release.aab',
    ],
    timestamp: new Date().toISOString(),
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`NOIR Video Studio (Robiul Video Studio) server listening on http://0.0.0.0:${PORT}`);
    });
  }
}

startServer();
