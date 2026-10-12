import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  Lock,
  Activity,
  Server,
  HardDrive,
  RefreshCw,
  LogOut,
  CheckCircle2,
  Sliders,
} from 'lucide-react';
import { AdminTelemetryData } from '../types';

interface AdminDashboardPanelProps {
  onShowToast: (msg: string) => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i += 1;
  }
  return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export const AdminDashboardPanel: React.FC<AdminDashboardPanelProps> = ({ onShowToast }) => {
  const [adminToken, setAdminToken] = useState<string | null>(() =>
    sessionStorage.getItem('noir_admin_token')
  );
  const [username, setUsername] = useState('robiul_admin');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [telemetry, setTelemetry] = useState<AdminTelemetryData | null>(null);
  const [isLoadingTelemetry, setIsLoadingTelemetry] = useState(false);
  const [rateLimitInput, setRateLimitInput] = useState(90);
  const [maxFileSizeInput, setMaxFileSizeInput] = useState(1024);

  const fetchTelemetry = useCallback(
    async (token: string) => {
      setIsLoadingTelemetry(true);
      try {
        const resp = await fetch('/api/admin/telemetry', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.status === 401 || resp.status === 403) {
          sessionStorage.removeItem('noir_admin_token');
          setAdminToken(null);
          setAuthError('অ্যাডমিন সেশনের মেয়াদ শেষ হয়েছে। অনুগ্রহ করে পুনরায় লগইন করুন।');
          setIsLoadingTelemetry(false);
          return;
        }
        const data = (await resp.json()) as AdminTelemetryData;
        setTelemetry(data);
        setRateLimitInput(data.limits.maxRequestsPerMinute);
        setMaxFileSizeInput(data.limits.maxDownloadSizeMb);
      } catch {
        setAuthError('সার্ভার টেলিমেট্রি লোড করা যায়নি।');
      } finally {
        setIsLoadingTelemetry(false);
      }
    },
    []
  );

  useEffect(() => {
    if (adminToken) {
      fetchTelemetry(adminToken);
    }
  }, [adminToken, fetchTelemetry]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsLoggingIn(true);
    try {
      const resp = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setAuthError(data.error || 'অ্যাডমিন লগইন ব্যর্থ হয়েছে।');
        setIsLoggingIn(false);
        return;
      }
      sessionStorage.setItem('noir_admin_token', data.token);
      setAdminToken(data.token);
      setPassword('');
      onShowToast('অ্যাডমিন ড্যাশবোর্ডে সফলভাবে প্রবেশ করেছেন');
    } catch {
      setAuthError('সার্ভারের সাথে সংযোগ স্থাপন করা যায়নি।');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleUpdateLimits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    try {
      const resp = await fetch('/api/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          rateLimitPerMin: Number(rateLimitInput),
          maxFileSizeMb: Number(maxFileSizeInput),
        }),
      });
      if (resp.ok) {
        onShowToast('সার্ভার লিমিট ও কনফিগারেশন আপডেট হয়েছে');
        fetchTelemetry(adminToken);
      }
    } catch {
      onShowToast('কনফিগারেশন আপডেট ব্যর্থ হয়েছে');
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem('noir_admin_token');
    setAdminToken(null);
    setTelemetry(null);
    onShowToast('অ্যাডমিন সেশন থেকে লগআউট সম্পন্ন');
  };

  if (!adminToken) {
    return (
      <div className="max-w-md mx-auto noir-card rounded-2xl p-6 sm:p-8 my-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-rose-600/15 border border-rose-500/40 flex items-center justify-center text-rose-500">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold">NOIR Admin Security Gateway</h2>
            <p className="text-xs text-zinc-400">
              সার্ভার-সাইড রোল ও টোকেন যাচাইকরণ (Role-Based Access Control)
            </p>
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              অ্যাডমিন ইউজারনেম (Username)
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full min-h-[42px] px-3.5 py-2 noir-subcard rounded-xl text-sm focus:outline-none focus:border-rose-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              পাসওয়ার্ড (Password)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="আপনার অ্যাডমিন পাসওয়ার্ড দিন..."
              required
              className="w-full min-h-[42px] px-3.5 py-2 noir-subcard rounded-xl text-sm focus:outline-none focus:border-rose-500"
            />
          </div>

          {authError && (
            <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2.5">
              {authError}
            </p>
          )}

          <button
            type="submit"
            disabled={isLoggingIn}
            className="w-full min-h-[44px] rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500 transition-colors"
          >
            {isLoggingIn ? 'যাচাই করা হচ্ছে...' : 'অ্যাডমিন ড্যাশবোর্ডে লগইন করুন'}
          </button>
        </form>

        <div className="mt-5 pt-4 border-t noir-border flex items-center justify-between gap-2 text-xs text-zinc-400">
          <span>ডেভেলপমেন্ট এনভায়রনমেন্ট ক্রেডেনশিয়াল:</span>
          <button
            type="button"
            onClick={() => {
              setUsername('robiul_admin');
              setPassword('NoirStudio#2026');
            }}
            className="text-rose-400 hover:underline font-mono"
          >
            অটো-ফিল টেস্ট লগইন
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="noir-card rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">
            NOIR Video Studio — সিকিউর অ্যাডমিন ও টেলিমেট্রি ড্যাশবোর্ড
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            রিয়েল-টাইম API হেলথ, ডাউনলোড কিউ স্ট্যাটাস, SSRF অডিট লগ এবং সার্ভার লিমিট কনফিগারেশন
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => fetchTelemetry(adminToken)}
            disabled={isLoadingTelemetry}
            className="min-h-[40px] px-3.5 py-2 rounded-lg noir-subcard text-xs font-semibold hover:border-rose-500/50 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className={`w-4 h-4 text-rose-400 ${isLoadingTelemetry ? 'animate-spin' : ''}`} />
            <span>রিফ্রেশ</span>
          </button>

          <button
            onClick={handleLogout}
            className="min-h-[40px] px-3.5 py-2 rounded-lg bg-rose-600/15 border border-rose-500/40 text-xs font-semibold text-rose-400 hover:bg-rose-600 hover:text-white transition-colors flex items-center gap-1.5"
          >
            <LogOut className="w-4 h-4" />
            <span>লগআউট</span>
          </button>
        </div>
      </div>

      {/* 4-Column Telemetry Summary */}
      {telemetry && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="noir-card rounded-2xl p-4">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>API ও ব্যাকএন্ড স্ট্যাটাস</span>
                <Activity className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="mt-2 text-xl font-bold font-mono tabular-nums text-emerald-400 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" />
                <span>{telemetry.health}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-400 font-mono tabular-nums">
                Uptime: {telemetry.uptimeSeconds}s · {telemetry.nodeVersion}
              </p>
            </div>

            <div className="noir-card rounded-2xl p-4">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>ডাউনলোড জব পরিসংখ্যান</span>
                <Server className="w-4 h-4 text-rose-400" />
              </div>
              <div className="mt-2 text-xl font-bold font-mono tabular-nums">
                {telemetry.stats.runningJobs} Running / {telemetry.stats.queuedJobs} Queued
              </div>
              <p className="mt-1 text-xs text-zinc-400 font-mono tabular-nums">
                Completed: {telemetry.stats.completedJobs} · Failed: {telemetry.stats.failedJobs}
              </p>
            </div>

            <div className="noir-card rounded-2xl p-4">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>সার্ভার মেমোরি (RAM)</span>
                <Activity className="w-4 h-4 text-violet-400" />
              </div>
              <div className="mt-2 text-xl font-bold font-mono tabular-nums">
                {telemetry.memoryUsageMb.heapUsed} MB / {telemetry.memoryUsageMb.rss} MB
              </div>
              <p className="mt-1 text-xs text-zinc-400 font-mono tabular-nums">
                Heap Total: {telemetry.memoryUsageMb.heapTotal} MB (Streaming Backpressure)
              </p>
            </div>

            <div className="noir-card rounded-2xl p-4">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>ডিস্ক স্টোরেজ ব্যবহার</span>
                <HardDrive className="w-4 h-4 text-rose-400" />
              </div>
              <div className="mt-2 text-xl font-bold font-mono tabular-nums">
                {formatBytes(telemetry.storage.totalDiskBytes)}
              </div>
              <p className="mt-1 text-xs text-zinc-400 font-mono tabular-nums">
                {telemetry.storage.totalFilesCount} ফাইল · লিমিট {telemetry.storage.maxLimitMb} MB/ফাইল
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Operational Limits Form */}
            <div className="lg:col-span-4 noir-card rounded-2xl p-5 h-fit">
              <div className="flex items-center gap-2 text-sm font-bold mb-3">
                <Sliders className="w-4 h-4 text-rose-400" />
                <span>কনফিগারেবল অপারেশনাল লিমিট</span>
              </div>
              <form onSubmit={handleUpdateLimits} className="space-y-4">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    প্রতি মিনিটে সর্বোচ্চ API অনুরোধ (Rate Limit / IP)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={600}
                    value={rateLimitInput}
                    onChange={(e) => setRateLimitInput(Number(e.target.value))}
                    className="w-full min-h-[40px] px-3 py-2 noir-subcard rounded-lg text-xs font-mono tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    সর্বোচ্চ ফাইল ডাউনলোড সাইজ (MB)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={4096}
                    value={maxFileSizeInput}
                    onChange={(e) => setMaxFileSizeInput(Number(e.target.value))}
                    className="w-full min-h-[40px] px-3 py-2 noir-subcard rounded-lg text-xs font-mono tabular-nums"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full min-h-[42px] rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500 transition-colors"
                >
                  সার্ভার লিমিট সংরক্ষণ করুন
                </button>
              </form>
            </div>

            {/* Security & Operational Audit Logs */}
            <div className="lg:col-span-8 noir-card rounded-2xl p-5">
              <div className="flex items-center justify-between pb-3 border-b noir-border">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                  <span>সিকিউরিটি, SSRF ব্লক এবং সিস্টেম অডিট লগ</span>
                </div>
                <span className="text-xs font-mono tabular-nums text-zinc-400">
                  সর্বশেষ {telemetry.auditLogs.length} ইভেন্ট
                </span>
              </div>

              <div className="mt-3 space-y-2 max-h-[360px] overflow-y-auto pr-1">
                {telemetry.auditLogs.length === 0 ? (
                  <p className="text-xs text-zinc-400 py-8 text-center">
                    কোনো সিকিউরিটি বা এরর ইভেন্ট রেকর্ড হয়নি।
                  </p>
                ) : (
                  telemetry.auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3 rounded-xl noir-subcard text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 font-mono tabular-nums">
                          <span
                            className={
                              log.severity === 'ERROR'
                                ? 'text-rose-400 font-semibold'
                                : log.severity === 'WARN'
                                ? 'text-amber-400 font-semibold'
                                : 'text-emerald-400 font-semibold'
                            }
                          >
                            {log.severity}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-violet-400">{log.category}</span>
                          <span aria-hidden="true">·</span>
                          <span className="text-zinc-400">
                            {new Date(log.created_at).toLocaleTimeString('bn-BD')}
                          </span>
                        </div>
                        <p className="mt-1 text-zinc-200">{log.message}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
