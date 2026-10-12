import dns from 'dns/promises';
import net from 'net';
import path from 'path';
import crypto from 'crypto';

export interface SecurityValidationResult {
  valid: boolean;
  parsedUrl?: URL;
  finalUrl?: string;
  redirectHops?: number;
  errorCode?:
    | 'INVALID_URL'
    | 'DISALLOWED_PROTOCOL'
    | 'SSRF_BLOCKED_HOST'
    | 'SSRF_PRIVATE_IP'
    | 'DNS_RESOLUTION_FAILED'
    | 'TOO_MANY_REDIRECTS'
    | 'PLATFORM_PAGE_URL'
    | 'DRM_OR_ENCRYPTED';
  reason?: string;
  isPlatformPage?: boolean;
  platformName?: string;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  '0.0.0.0',
  '127.0.0.1',
  '::1',
  '::',
  'metadata.google.internal',
  'metadata',
  'instance-data',
  '169.254.169.254',
]);

const KNOWN_PAGE_PLATFORMS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i, name: 'YouTube' },
  { pattern: /(^|\.)facebook\.com$|(^|\.)fb\.watch$/i, name: 'Facebook' },
  { pattern: /(^|\.)tiktok\.com$/i, name: 'TikTok' },
  { pattern: /(^|\.)instagram\.com$/i, name: 'Instagram' },
  { pattern: /(^|\.)netflix\.com$/i, name: 'Netflix' },
  { pattern: /(^|\.)spotify\.com$/i, name: 'Spotify' },
];

export function isPrivateOrReservedIP(ip: string): boolean {
  const cleaned = ip.replace(/^\[|\]$/g, '').trim();

  if (net.isIPv4(cleaned)) {
    const parts = cleaned.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    // 0.0.0.0/8 (Current network)
    if (parts[0] === 0) return true;
    // 10.0.0.0/8 (Private network)
    if (parts[0] === 10) return true;
    // 100.64.0.0/10 (Shared Address Space / CGNAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (Link-local & Cloud Metadata 169.254.169.254)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 172.16.0.0/12 (Private network)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.0.0.0/24 & 192.0.2.0/24
    if (parts[0] === 192 && parts[1] === 0 && (parts[2] === 0 || parts[2] === 2)) return true;
    // 192.168.0.0/16 (Private network)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 198.18.0.0/15 (Benchmark)
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved/Broadcast)
    if (parts[0] >= 224) return true;
    return false;
  }

  if (net.isIPv6(cleaned)) {
    const lower = cleaned.toLowerCase();
    if (lower === '::1' || lower === '::' || lower === '0:0:0:0:0:0:0:1' || lower === '0:0:0:0:0:0:0:0') {
      return true;
    }
    // Unique local addresses fc00::/7 (fc... or fd...)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // Link-local fe80::/10
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return true;
    }
    // Multicast ff00::/8
    if (lower.startsWith('ff')) return true;
    // IPv4-mapped IPv6 addresses ::ffff:a.b.c.d
    if (lower.startsWith('::ffff:')) {
      const ipv4Part = lower.slice(7);
      if (net.isIPv4(ipv4Part)) {
        return isPrivateOrReservedIP(ipv4Part);
      }
      return true;
    }
    return false;
  }

  return true;
}

export function detectPlatformWebpage(parsedUrl: URL): { isPlatformPage: boolean; platformName?: string } {
  const host = parsedUrl.hostname.toLowerCase();
  const pathLower = parsedUrl.pathname.toLowerCase();
  const hasDirectExt = /\.(mp4|webm|m3u8|ogv|mov|m4v)$/i.test(pathLower);
  if (hasDirectExt) {
    return { isPlatformPage: false };
  }
  for (const item of KNOWN_PAGE_PLATFORMS) {
    if (item.pattern.test(host)) {
      return { isPlatformPage: true, platformName: item.name };
    }
  }
  return { isPlatformPage: false };
}

export async function validateUrlAndResolveDns(
  rawUrl: string,
  skipDnsLookup = false
): Promise<SecurityValidationResult> {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return {
      valid: false,
      errorCode: 'INVALID_URL',
      reason: 'একটি বৈধ ভিডিও URL প্রদান করুন (Empty URL)।',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return {
      valid: false,
      errorCode: 'INVALID_URL',
      reason: 'URL ফরম্যাট সঠিক নয়। সম্পূর্ণ http:// বা https:// লিংক দিন।',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      errorCode: 'DISALLOWED_PROTOCOL',
      reason: `অনিরাপদ প্রোটোকল (${parsed.protocol}) ব্লক করা হয়েছে। শুধুমাত্র HTTP এবং HTTPS অনুমোদিত।`,
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      errorCode: 'SSRF_BLOCKED_HOST',
      reason: 'URL-এর ভেতরে ইউজারনেম বা ক্রেডেনশিয়াল থাকা নিরাপত্তার কারণে নিষিদ্ধ।',
    };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.arpa')
  ) {
    return {
      valid: false,
      errorCode: 'SSRF_BLOCKED_HOST',
      reason: 'নিরাপত্তা নীতির কারণে লোকালহোস্ট, ইন্টারনাল সার্ভিস বা ক্লাউড মেটাডাটা হোস্ট ব্লক করা হয়েছে (SSRF Protection)।',
    };
  }

  const platformCheck = detectPlatformWebpage(parsed);
  if (platformCheck.isPlatformPage) {
    return {
      valid: false,
      errorCode: 'PLATFORM_PAGE_URL',
      isPlatformPage: true,
      platformName: platformCheck.platformName,
      reason: `${platformCheck.platformName}-এর সাধারণ ওয়েবপেজ লিংক সরাসরি MP4 বা M3U8 স্ট্রিম নয়। NOIR Video Studio কোনো DRM বা প্ল্যাটফর্ম অ্যাক্সেস কন্ট্রোল বাইপাস করে না। অনুগ্রহ করে সরাসরি অনুমোদিত মিডিয়া স্ট্রিম (.mp4, .webm, .m3u8) ব্যবহার করুন।`,
    };
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIP(hostname)) {
      return {
        valid: false,
        errorCode: 'SSRF_PRIVATE_IP',
        reason: `প্রাইভেট বা সংরক্ষিত নেটওয়ার্ক আইপি (${hostname}) অ্যাক্সেস কঠোরভাবে নিষিদ্ধ (SSRF Protection)।`,
      };
    }
    return { valid: true, parsedUrl: parsed, finalUrl: parsed.toString(), redirectHops: 0 };
  }

  if (!skipDnsLookup) {
    try {
      const records = await dns.lookup(hostname, { all: true });
      if (!records || records.length === 0) {
        return {
          valid: false,
          errorCode: 'DNS_RESOLUTION_FAILED',
          reason: `ডোমেইন (${hostname}) খুঁজে পাওয়া যায়নি (DNS Resolution Failed)।`,
        };
      }
      for (const rec of records) {
        if (isPrivateOrReservedIP(rec.address)) {
          return {
            valid: false,
            errorCode: 'SSRF_PRIVATE_IP',
            reason: `DNS Rebinding / SSRF সুরক্ষা: ডোমেইনটি একটি প্রাইভেট আইপিতে (${rec.address}) নির্দেশ করছে যা ব্লক করা হয়েছে।`,
          };
        }
      }
    } catch {
      return {
        valid: false,
        errorCode: 'DNS_RESOLUTION_FAILED',
        reason: `ডোমেইন (${hostname}) যাচাই করা সম্ভব হয়নি (DNS Lookup Error)।`,
      };
    }
  }

  return { valid: true, parsedUrl: parsed, finalUrl: parsed.toString(), redirectHops: 0 };
}

/**
 * Follows redirects manually up to maxHops, validating each redirect destination
 * against SSRF, private IPs, and disallowed schemes at every step.
 */
export async function fetchWithSafeRedirects(
  initialUrl: string,
  init: RequestInit = {},
  maxHops = 5
): Promise<{ response: globalThis.Response; finalUrl: string; redirectHops: number }> {
  let currentUrl = initialUrl;
  let hops = 0;

  while (hops <= maxHops) {
    const validation = await validateUrlAndResolveDns(currentUrl);
    if (!validation.valid) {
      throw new Error(validation.reason || 'Redirect destination blocked by SSRF policy.');
    }

    const response = await fetch(currentUrl, {
      ...init,
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      const locationHeader = response.headers.get('location');
      if (!locationHeader) {
        return { response, finalUrl: currentUrl, redirectHops: hops };
      }
      const nextUrl = new URL(locationHeader, currentUrl).toString();
      hops += 1;
      if (hops > maxHops) {
        throw new Error('অতিরিক্ত রিডাইরেক্ট শনাক্ত হয়েছে (Too many redirects, max 5)।');
      }
      currentUrl = nextUrl;
      continue;
    }

    return { response, finalUrl: currentUrl, redirectHops: hops };
  }

  throw new Error('Redirect limit exceeded.');
}

export function sanitizeSafeFilename(rawName: string, fallbackExt = 'mp4'): string {
  const base = path.basename(rawName || `noir-video.${fallbackExt}`);
  const withoutTraversal = base.replace(/\.\.+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
  const trimmed = withoutTraversal.replace(/^_+|_+$/g, '').slice(0, 96) || 'noir-media';
  if (!/\.[a-zA-Z0-9]{2,5}$/.test(trimmed)) {
    return `${trimmed}.${fallbackExt}`;
  }
  return trimmed;
}

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const usedSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, usedSalt, 64).toString('hex');
  return { hash, salt: usedSalt };
}

export function verifyPassword(password: string, expectedHash: string, salt: string): boolean {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function maskSensitiveUrlForLog(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const sensitiveParams = ['token', 'key', 'sig', 'signature', 'auth', 'password', 'secret', 'hdnea'];
    for (const p of sensitiveParams) {
      if (u.searchParams.has(p)) {
        u.searchParams.set(p, '***REDACTED***');
      }
    }
    return u.toString();
  } catch {
    return '[invalid-url]';
  }
}
