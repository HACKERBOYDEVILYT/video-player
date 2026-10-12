import React, { useState } from 'react';
import { Smartphone, Download, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  onOpenAndroidGuide?: () => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ onOpenAndroidGuide }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return (
      <button
        onClick={onOpenAndroidGuide}
        className="min-h-[40px] px-4 py-2 text-xs font-semibold noir-subcard rounded-lg hover:border-rose-500/50 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
      >
        <Smartphone className="w-4 h-4 text-rose-500" />
        <span>Android Studio & APK</span>
      </button>
    );
  }

  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-500 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
      >
        <Download className="w-4 h-4" />
        <span>Install NOIR App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-500 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
        >
          <Smartphone className="w-4 h-4" />
          <span>Install on iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-sm rounded-2xl noir-card p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold">Install on iPhone / iPad</h3>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center text-zinc-400 hover:text-white"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="mt-3 text-sm text-zinc-300 leading-relaxed">
                1. Tap the <strong>Share</strong> button in Safari toolbar.<br />
                2. Scroll down and select <strong>Add to Home Screen</strong>.
              </p>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[44px] rounded-lg bg-rose-600 py-2 text-xs font-semibold text-white hover:bg-rose-500 transition-colors whitespace-nowrap"
              >
                Got It
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <button
      onClick={onOpenAndroidGuide}
      className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-500 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
    >
      <Smartphone className="w-4 h-4" />
      <span>Android APK & App</span>
    </button>
  );
};
