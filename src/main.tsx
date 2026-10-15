import React, { Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class RootErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('NOIR Video Studio Runtime Error:', error, errorInfo);
  }

  handleReset = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // ignore
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#020617] text-white flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#0F172A] border border-red-500/30 rounded-2xl p-6 text-center shadow-2xl">
            <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 font-bold text-xl">
              !
            </div>
            <h2 className="text-xl font-bold mb-2">NOIR Video Studio</h2>
            <p className="text-sm text-zinc-400 mb-4">
              অ্যাপ্লিকেশনে একটি অপ্রত্যাশিত ত্রুটি ঘটেছে। নিচের বাটনে ক্লিক করে অ্যাপটি রিলোড করুন।
            </p>
            {this.state.error && (
              <pre className="text-xs font-mono text-red-300 bg-black/40 p-3 rounded-lg overflow-x-auto text-left mb-5">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                রিলোড করুন
              </button>
              <button
                onClick={this.handleReset}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                ক্যাশে রিসেট করুন
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  try {
    const root = createRoot(rootElement);
    root.render(
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    );
    (window as unknown as { __NOIR_APP_MOUNTED__?: boolean }).__NOIR_APP_MOUNTED__ = true;
  } catch (err) {
    console.error('Root mount failed:', err);
    rootElement.innerHTML = `
      <div style="min-height: 100vh; background-color: #020617; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px; text-align: center;">
        <div style="font-weight: 800; font-size: 22px; color: #f43f5e; margin-bottom: 8px;">NOIR VIDEO STUDIO</div>
        <div style="font-size: 14px; color: #94a3b8; max-width: 420px; margin-bottom: 20px;">
          মাউন্ট করার সময় সমস্যা হয়েছে। অনুগ্রহ করে নিচের বাটনে ক্লিক করে রিলোড দিন।
        </div>
        <button onclick="localStorage.clear(); window.location.reload();" style="padding: 10px 24px; background-color: #e11d48; color: white; border: none; border-radius: 12px; font-weight: 600; cursor: pointer;">
          ক্যাশে রিসেট ও রিলোড
        </button>
      </div>
    `;
  }
}
