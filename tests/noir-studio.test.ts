import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPrivateOrReservedIP,
  validateUrlAndResolveDns,
  sanitizeSafeFilename,
  hashPassword,
  verifyPassword,
  maskSensitiveUrlForLog,
} from '../src/server/security';
import { initDatabase } from '../src/server/db';
import {
  createQueuedDownloadJob,
  pauseDownloadJob,
  resumeDownloadJob,
  cancelDownloadJob,
  renameDownloadedFile,
  deleteDownloadJobAndFile,
} from '../src/server/downloadManager';

initDatabase();

describe('NOIR Video Studio — Security & SSRF Protection Suite', () => {
  it('blocks loopback, private IPv4, link-local, and cloud metadata IPs', () => {
    assert.equal(isPrivateOrReservedIP('127.0.0.1'), true);
    assert.equal(isPrivateOrReservedIP('10.0.0.1'), true);
    assert.equal(isPrivateOrReservedIP('172.16.5.4'), true);
    assert.equal(isPrivateOrReservedIP('192.168.1.100'), true);
    assert.equal(isPrivateOrReservedIP('169.254.169.254'), true);
    assert.equal(isPrivateOrReservedIP('0.0.0.0'), true);
    assert.equal(isPrivateOrReservedIP('8.8.8.8'), false);
    assert.equal(isPrivateOrReservedIP('1.1.1.1'), false);
  });

  it('blocks IPv6 loopback, unique local, link-local, and IPv4-mapped private IPs', () => {
    assert.equal(isPrivateOrReservedIP('::1'), true);
    assert.equal(isPrivateOrReservedIP('fc00::1'), true);
    assert.equal(isPrivateOrReservedIP('fe80::1'), true);
    assert.equal(isPrivateOrReservedIP('::ffff:127.0.0.1'), true);
    assert.equal(isPrivateOrReservedIP('::ffff:10.0.0.1'), true);
    assert.equal(isPrivateOrReservedIP('2606:4700:4700::1111'), false);
  });

  it('rejects dangerous schemes (file://, ftp://, javascript:) and localhost URLs', async () => {
    const fileRes = await validateUrlAndResolveDns('file:///etc/passwd', true);
    assert.equal(fileRes.valid, false);
    assert.equal(fileRes.errorCode, 'DISALLOWED_PROTOCOL');

    const localRes = await validateUrlAndResolveDns('http://localhost:3000/api/health', true);
    assert.equal(localRes.valid, false);
    assert.equal(localRes.errorCode, 'SSRF_BLOCKED_HOST');

    const metadataRes = await validateUrlAndResolveDns(
      'http://169.254.169.254/latest/meta-data/',
      true
    );
    assert.equal(metadataRes.valid, false);
    assert.equal(metadataRes.errorCode, 'SSRF_BLOCKED_HOST');
  });

  it('detects general YouTube/Facebook/TikTok webpage URLs and refuses to treat them as direct MP4', async () => {
    const ytRes = await validateUrlAndResolveDns('https://www.youtube.com/watch?v=dQw4w9WgXcQ', true);
    assert.equal(ytRes.valid, false);
    assert.equal(ytRes.errorCode, 'PLATFORM_PAGE_URL');
    assert.equal(ytRes.isPlatformPage, true);

    const directMp4 = await validateUrlAndResolveDns(
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      true
    );
    assert.equal(directMp4.valid, true);
  });

  it('prevents path traversal in filenames and redacts sensitive URL tokens', () => {
    const cleaned = sanitizeSafeFilename('../../etc/passwd', 'mp4');
    assert.equal(cleaned.includes('..'), false);
    assert.equal(cleaned.includes('/'), false);
    assert.equal(cleaned.endsWith('.mp4'), true);

    const masked = maskSensitiveUrlForLog('https://cdn.example.com/video.mp4?token=secret123&id=9');
    assert.equal(masked.includes('secret123'), false);
    assert.equal(masked.includes('REDACTED'), true);
  });

  it('hashes and verifies admin passwords using timing-safe scrypt', () => {
    const { hash, salt } = hashPassword('MySecurePass#2026');
    assert.equal(verifyPassword('MySecurePass#2026', hash, salt), true);
    assert.equal(verifyPassword('WrongPassword', hash, salt), false);
  });
});

describe('NOIR Video Studio — Download Job Lifecycle & Database Suite', () => {
  it('creates, pauses, resumes, renames, cancels, and deletes a download job cleanly', () => {
    const { job } = createQueuedDownloadJob({
      title: 'Unit Test Clip',
      url: 'https://example.com/sample-test-video.mp4',
      format: 'MP4',
      priority: 'high',
    });

    assert.ok(job.id.startsWith('job-'));
    assert.equal(job.priority, 'high');

    const paused = pauseDownloadJob(job.id);
    assert.equal(paused?.status, 'paused');

    const resumed = resumeDownloadJob(job.id);
    assert.equal(resumed?.status, 'queued');

    const renamed = renameDownloadedFile(job.id, 'custom-renamed-clip.mp4');
    assert.equal(renamed?.filename, 'custom-renamed-clip.mp4');

    const cancelled = cancelDownloadJob(job.id);
    assert.equal(cancelled?.status, 'cancelled');

    const deleted = deleteDownloadJobAndFile(job.id);
    assert.equal(deleted, true);
  });
});
