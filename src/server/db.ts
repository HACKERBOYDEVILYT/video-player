import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { hashPassword } from './security';

const DATA_DIR = path.resolve(process.cwd(), 'storage');
const DB_PATH = path.join(DATA_DIR, 'noir_studio.sqlite');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);

export function initDatabase() {
  const schemaPath = path.resolve(process.cwd(), 'src/db/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schemaSql);

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

  // Ensure admin account is initialized via environment variable or generated session passphrase
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

  // Server restart recovery: Any job left in 'running' or 'queued' state when process exited is marked 'paused'
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
