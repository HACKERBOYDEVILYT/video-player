import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { hashPassword } from './security.ts';

const require = createRequire(import.meta.url);
const DATA_DIR = path.resolve(process.cwd(), 'storage');
const DB_PATH = path.join(DATA_DIR, 'noir_studio.sqlite');
const JSON_FALLBACK_PATH = path.join(DATA_DIR, 'noir_studio_fallback.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export interface StatementLike {
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
  run: (...params: unknown[]) => { changes?: number };
}

export interface DatabaseLike {
  exec: (sql: string) => void;
  prepare: (sql: string) => StatementLike;
}

// Resilient JSON fallback store if running on a Node runtime without node:sqlite (e.g. Node 18/20 container)
function createJsonFallbackDb(): DatabaseLike {
  interface StoreData {
    users: Record<string, unknown>[];
    user_preferences: Record<string, unknown>[];
    analyzed_urls: Record<string, unknown>[];
    download_jobs: Record<string, unknown>[];
    audit_logs: Record<string, unknown>[];
  }

  let state: StoreData = {
    users: [],
    user_preferences: [],
    analyzed_urls: [],
    download_jobs: [],
    audit_logs: [],
  };

  if (fs.existsSync(JSON_FALLBACK_PATH)) {
    try {
      state = JSON.parse(fs.readFileSync(JSON_FALLBACK_PATH, 'utf-8'));
    } catch {
      // use fresh state
    }
  }

  const persist = () => {
    try {
      fs.writeFileSync(JSON_FALLBACK_PATH, JSON.stringify(state, null, 2), 'utf-8');
    } catch {
      // ignore write error
    }
  };

  return {
    exec: (_sql: string) => {
      persist();
    },
    prepare: (sql: string): StatementLike => {
      const norm = sql.replace(/\s+/g, ' ').trim();
      return {
        get: (...params: unknown[]) => {
          if (norm.includes('FROM user_preferences WHERE user_id = ?')) {
            return state.user_preferences.find((p) => p.user_id === params[0]);
          }
          if (norm.includes('FROM users WHERE username = ?')) {
            return state.users.find((u) => u.username === params[0]);
          }
          if (norm.includes('FROM download_jobs WHERE url = ?')) {
            return state.download_jobs.find(
              (j) =>
                j.url === params[0] &&
                ['completed', 'running', 'queued'].includes(String(j.status))
            );
          }
          if (norm.includes('FROM download_jobs WHERE id = ?')) {
            return state.download_jobs.find((j) => j.id === params[0]);
          }
          if (norm.includes("SELECT COUNT(*) as cnt FROM download_jobs WHERE status = 'running'")) {
            return { cnt: state.download_jobs.filter((j) => j.status === 'running').length };
          }
          return undefined;
        },
        all: (...params: unknown[]) => {
          if (norm.includes('FROM download_jobs WHERE status = \'queued\'')) {
            const limit = Number(params[0]) || 2;
            return state.download_jobs
              .filter((j) => j.status === 'queued')
              .slice(0, limit);
          }
          if (norm.includes('FROM download_jobs')) {
            return [...state.download_jobs].reverse().slice(0, 100);
          }
          if (norm.includes('FROM analyzed_urls')) {
            return [...state.analyzed_urls].reverse().slice(0, 25);
          }
          if (norm.includes('FROM audit_logs')) {
            return [...state.audit_logs].reverse().slice(0, 40);
          }
          return [];
        },
        run: (...params: unknown[]) => {
          if (norm.startsWith('INSERT INTO user_preferences')) {
            state.user_preferences.push({
              user_id: params[0],
              theme: params[1],
              max_concurrent_downloads: params[2],
              auto_retry_downloads: params[3],
              max_retry_count: params[4],
              default_playback_speed: params[5],
              storage_directory: params[6],
              updated_at: params[7],
            });
          } else if (norm.startsWith('UPDATE user_preferences')) {
            const pref = state.user_preferences.find((p) => p.user_id === 'default');
            if (pref) {
              pref.theme = params[0];
              pref.max_concurrent_downloads = params[1];
              pref.auto_retry_downloads = params[2];
              pref.max_retry_count = params[3];
              pref.default_playback_speed = params[4];
              pref.storage_directory = params[5];
              pref.updated_at = params[6];
            }
          } else if (norm.startsWith('INSERT INTO users')) {
            state.users.push({
              id: params[0],
              username: params[1],
              password_hash: params[2],
              password_salt: params[3],
              role: 'admin',
              created_at: params[4],
            });
          } else if (norm.startsWith('INSERT INTO analyzed_urls')) {
            state.analyzed_urls.push({
              id: params[0],
              original_url: params[1],
              final_url: params[2],
              format: params[3],
              mime_type: params[4],
              size_bytes: params[5],
              accept_ranges: params[6],
              is_hls: params[7],
              is_direct_playable: params[8],
              is_download_allowed: params[9],
              redirect_hops: params[10],
              platform_notice: params[11],
              status_code: params[12],
              analyzed_at: params[13],
            });
          } else if (norm.startsWith('DELETE FROM analyzed_urls')) {
            state.analyzed_urls = [];
          } else if (norm.startsWith('INSERT INTO download_jobs')) {
            state.download_jobs.push({
              id: params[0],
              title: params[1],
              url: params[2],
              final_url: params[3],
              filename: params[4],
              format: params[5],
              status: 'queued',
              priority: params[6],
              loaded_bytes: 0,
              total_bytes: null,
              speed_bps: 0,
              eta_seconds: null,
              supports_range: 0,
              retry_count: 0,
              max_retries: params[7],
              sha256_checksum: null,
              storage_path: params[8],
              error_code: null,
              error_message: null,
              is_retryable: 1,
              created_at: params[9],
              updated_at: params[10],
            });
          } else if (norm.startsWith('DELETE FROM download_jobs WHERE id = ?')) {
            state.download_jobs = state.download_jobs.filter((j) => j.id !== params[0]);
          } else if (norm.startsWith('INSERT INTO audit_logs')) {
            state.audit_logs.push({
              id: params[0],
              category: params[1],
              severity: params[2],
              message: params[3],
              details_json: params[4],
              created_at: params[5],
            });
          }
          persist();
          return { changes: 1 };
        },
      };
    },
  };
}

function createDatabaseInstance(): DatabaseLike {
  try {
    const sqlite = require('node:sqlite');
    if (sqlite && typeof sqlite.DatabaseSync === 'function') {
      return new sqlite.DatabaseSync(DB_PATH) as DatabaseLike;
    }
  } catch {
    // Fallback if node:sqlite is unavailable on older Node runtimes
  }
  return createJsonFallbackDb();
}

export const db: DatabaseLike = createDatabaseInstance();

export function initDatabase() {
  const schemaPath = path.resolve(process.cwd(), 'src/db/schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schemaSql);
  }

  // Ensure default user preferences exist
  const prefStmt = db.prepare('SELECT user_id FROM user_preferences WHERE user_id = ?');
  const existingPref = prefStmt.get('default');
  if (!existingPref) {
    db.prepare(
      `INSERT INTO user_preferences (
        user_id, theme, max_concurrent_downloads, auto_retry_downloads, max_retry_count, default_playback_speed, storage_directory, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('default', 'dark', 2, 1, 2, 1.0, '/storage/downloads', new Date().toISOString());
  }

  // Ensure admin account is initialized
  const adminUser = process.env.ADMIN_USERNAME || 'robiul_admin';
  const adminPass = process.env.ADMIN_INITIAL_PASS || 'NoirStudio#2026';
  const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get(adminUser);
  if (!existingAdmin) {
    const { hash, salt } = hashPassword(adminPass);
    db.prepare(
      `INSERT INTO users (id, username, password_hash, password_salt, role, created_at)
       VALUES (?, ?, ?, ?, 'admin', ?)`
    ).run(`usr-${crypto.randomUUID()}`, adminUser, hash, salt, new Date().toISOString());
  }

  // Server restart recovery
  db.prepare(
    `UPDATE download_jobs
     SET status = 'paused',
         speed_bps = 0,
         eta_seconds = NULL,
         error_message = 'সার্ভার রিস্টার্ট হয়েছে — Resume বাটনে ক্লিক করে পুনরায় শুরু করুন',
         updated_at = ?
     WHERE status IN ('running', 'queued')`
  ).run(new Date().toISOString());
}

export function logAuditEvent(
  category: 'SECURITY_SSRF' | 'RATE_LIMIT' | 'AUTH' | 'DOWNLOAD' | 'SYSTEM',
  severity: 'INFO' | 'WARN' | 'ERROR',
  message: string,
  details?: Record<string, unknown>
) {
  try {
    db.prepare(
      `INSERT INTO audit_logs (id, category, severity, message, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      category,
      severity,
      message,
      details ? JSON.stringify(details) : null,
      new Date().toISOString()
    );
  } catch {
    // non-fatal logging
  }
}
