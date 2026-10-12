import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/usePWAInstall';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 md:bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-medium text-white shadow-lg">
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>অফলাইন মোড — ক্যাশ করা প্লেলিস্ট এবং লোকাল ভিডিও প্লেব্যাক সচল রয়েছে।</span>
    </div>
  );
};
